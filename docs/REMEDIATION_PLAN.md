# Remediation Plan: Architecture Gap Fixes

**Generated**: 2025-12-27  
**Status**: Approved for implementation  
**Config Strategy**: Global plugin-owned file  
**Export Strategy**: Sanitized HTML

---

## Overview

This plan addresses 7 gaps identified in the Architecture Gaps Report. Tasks are ordered by priority and dependency.

---

## Task 1: Plugin-Owned Global Config File

### Purpose
Comply with OpenCode's strict config schema by moving plugin config to a separate file that the plugin owns, ensuring zero-config installation works out-of-box.

### Reasoning
- OpenCode's `opencode.json` schema rejects unknown keys
- Current approach (`config.opendevbrowser`) breaks schema validation
- oh-my-opencode pattern demonstrates the correct approach: plugin reads from `~/.config/opencode/<plugin-name>.jsonc`

### Acceptance Criteria
- [ ] Plugin reads config from `~/.config/opencode/opendevbrowser.jsonc` (if exists)
- [ ] Falls back to sensible defaults when file doesn't exist (zero-config)
- [ ] Config file is optional; plugin works without it
- [ ] README updated with installation instructions
- [ ] AGENTS.md updated with "For LLM Agents" installation playbook

### Subtasks

#### 1.1 Create config file loader
- **File**: `src/config.ts`
- **Changes**:
  - Add `loadPluginConfig()` function that reads `~/.config/opencode/opendevbrowser.jsonc`
  - Handle file-not-found gracefully (return empty object)
  - Parse JSONC (JSON with comments) using existing parser or simple strip
  - Merge with defaults via existing Zod schema
- **Acceptance**: Unit test passes for file exists/not-exists/malformed cases

#### 1.2 Update plugin entry to use new config loader
- **File**: `src/index.ts`
- **Changes**:
  - Replace `resolveConfig({})` with `loadPluginConfig()` then `resolveConfig()`
  - Remove expectation of config passed via OpenCode hook (keep hook for runtime updates only)
- **Acceptance**: Plugin starts with defaults when no config file exists

#### 1.3 Remove schema-breaking config keys from docs
- **Files**: `README.md`, `docs/PLAN.md`, `docs/opendevbrowser-plan.md`
- **Changes**:
  - Remove examples showing `opendevbrowser` key in `opencode.json`
  - Add example of `~/.config/opencode/opendevbrowser.jsonc`
  - Document that `opencode.json` only needs plugin array entry
- **Acceptance**: No docs reference `config.opendevbrowser` pattern

#### 1.4 Add "For LLM Agents" installation playbook to AGENTS.md
- **File**: `AGENTS.md`
- **Changes**:
  - Add section with step-by-step for agents to install plugin
  - Include: check if `opencode.json` exists, read, add to `plugin` array, write back
  - Emphasize: do NOT add unknown keys to OpenCode config
- **Acceptance**: Playbook is copy-paste ready for agents

#### 1.5 Add config loader tests
- **File**: `tests/config.test.ts`
- **Changes**:
  - Test: no config file → defaults
  - Test: valid config file → merged config
  - Test: malformed JSONC → throws with clear error
  - Test: partial config → merged with defaults
- **Acceptance**: All tests pass

### Impacted Files
- `src/config.ts` (modify)
- `src/index.ts` (modify)
- `tests/config.test.ts` (modify)
- `README.md` (modify)
- `AGENTS.md` (modify)
- `docs/PLAN.md` (modify)
- `docs/opendevbrowser-plan.md` (modify)

---

## Task 2: Secure CDP Endpoint Validation

### Purpose
Prevent security bypass of local-only CDP policy by using proper URL hostname parsing instead of substring matching.

### Reasoning
- Substring check (`includes('localhost')`) is trivially bypassed
- `ws://127.0.0.1.evil.com/` passes current check but connects to attacker
- OWASP and security best practices require proper URL parsing

### Acceptance Criteria
- [ ] CDP endpoints validated via `new URL(endpoint).hostname`
- [ ] Allowlist: `localhost`, `127.0.0.1`, `::1`, `[::1]`
- [ ] Bypass attempts rejected with clear error
- [ ] Tests cover bypass patterns

### Subtasks

#### 2.1 Replace substring check with URL parsing
- **File**: `src/browser/browser-manager.ts`
- **Changes**:
  - Create `isLocalHost(urlString: string): boolean` helper
  - Parse URL, extract hostname, check against allowlist
  - Handle malformed URLs gracefully (reject)
  - Replace `ensureLocalEndpoint` implementation
- **Acceptance**: Bypass URLs rejected; valid localhost URLs accepted

#### 2.2 Add bypass-pattern tests
- **File**: `tests/browser-manager.test.ts`
- **Changes**:
  - Test: `ws://127.0.0.1:9222/...` → allowed
  - Test: `ws://localhost:9222/...` → allowed
  - Test: `ws://[::1]:9222/...` → allowed
  - Test: `ws://127.0.0.1.evil.com/...` → rejected
  - Test: `ws://localhost@evil.com/...` → rejected
  - Test: `ws://evil.com?host=localhost` → rejected
  - Test: malformed URL → rejected
- **Acceptance**: All bypass tests pass

### Impacted Files
- `src/browser/browser-manager.ts` (modify)
- `tests/browser-manager.test.ts` (modify)

---

## Task 3: Sanitize Export HTML

### Purpose
Prevent XSS gadgets from shipping in exported React components by sanitizing captured HTML before embedding.

### Reasoning
- `dangerouslySetInnerHTML` with unsanitized markup enables XSS
- Event handlers (`onerror`, `onclick`) execute even without `<script>` tags
- OWASP recommends DOMPurify or equivalent sanitization

### Acceptance Criteria
- [ ] Captured HTML sanitized before export
- [ ] Scripts, event handlers (`on*`), dangerous URLs (`javascript:`) removed
- [ ] Safe tags/attributes preserved (div, span, p, a[href], img[src], etc.)
- [ ] Optional config flag for unsafe/raw export (disabled by default)
- [ ] Tests verify sanitization

### Subtasks

#### 3.1 Add HTML sanitization utility
- **File**: `src/export/html-sanitizer.ts` (new)
- **Changes**:
  - Create `sanitizeHtml(html: string): string` function
  - Use in-browser sanitization during capture (page.evaluate with allowlist)
  - Remove: `<script>`, `<iframe>`, `<object>`, `<embed>`, `on*` attributes, `javascript:` URLs
  - Preserve: common safe tags and attributes
- **Acceptance**: Malicious payloads stripped; safe content preserved

#### 3.2 Integrate sanitizer into DOM capture
- **File**: `src/export/dom-capture.ts`
- **Changes**:
  - Sanitize `element.outerHTML` before returning
  - Or sanitize in `page.evaluate` context for better performance
- **Acceptance**: Captured HTML is pre-sanitized

#### 3.3 Add config option for unsafe export
- **File**: `src/config.ts`
- **Changes**:
  - Add `export.allowUnsafeHtml: boolean` (default: false)
  - Document that this bypasses sanitization
- **Acceptance**: Default is safe; explicit opt-in required for unsafe

#### 3.4 Update react-emitter to respect config
- **File**: `src/export/react-emitter.ts`
- **Changes**:
  - Accept config parameter
  - Add warning comment in generated TSX when unsafe mode used
- **Acceptance**: Generated component includes safety context

#### 3.5 Add sanitization tests
- **File**: `tests/export.test.ts`
- **Changes**:
  - Test: `<img onerror="alert(1)">` → `<img>`
  - Test: `<a href="javascript:evil()">` → `<a>`
  - Test: `<script>bad()</script>` → removed
  - Test: `<div onclick="x">` → `<div>`
  - Test: safe content preserved
- **Acceptance**: All sanitization tests pass

### Impacted Files
- `src/export/html-sanitizer.ts` (new)
- `src/export/dom-capture.ts` (modify)
- `src/export/react-emitter.ts` (modify)
- `src/config.ts` (modify)
- `tests/export.test.ts` (modify)

---

## Task 4: Redact Secrets in DevTools Output

### Purpose
Prevent accidental exposure of tokens, API keys, and credentials in network/console tool output.

### Reasoning
- URLs often contain auth tokens in query params
- Console logs may contain credentials
- Tool output goes to LLM context and may be logged

### Acceptance Criteria
- [ ] Network URLs have query params stripped by default
- [ ] Console text has token-like strings redacted
- [ ] Optional config flag to show full URLs (disabled by default)
- [ ] Redaction clearly marked (e.g., `[REDACTED]`)

### Subtasks

#### 4.1 Add URL redaction utility
- **File**: `src/devtools/redact.ts` (new)
- **Changes**:
  - Create `redactUrl(url: string): string` that strips query/hash
  - Create `redactText(text: string): string` for console output
  - Token detection: strings 20+ chars with mixed case/numbers, JWT patterns
- **Acceptance**: Tokens redacted; safe content preserved

#### 4.2 Integrate redaction into NetworkTracker
- **File**: `src/devtools/network-tracker.ts`
- **Changes**:
  - Apply `redactUrl()` to stored URLs
  - Preserve path for debugging context
- **Acceptance**: Query params not in poll output

#### 4.3 Integrate redaction into ConsoleTracker
- **File**: `src/devtools/console-tracker.ts`
- **Changes**:
  - Apply `redactText()` to stored text
- **Acceptance**: Token-like strings replaced with `[REDACTED]`

#### 4.4 Add config option for full output
- **File**: `src/config.ts`
- **Changes**:
  - Add `devtools.showFullUrls: boolean` (default: false)
  - Add `devtools.showFullConsole: boolean` (default: false)
- **Acceptance**: Defaults are safe; explicit opt-in for full output

#### 4.5 Add redaction tests
- **File**: `tests/devtools.test.ts`
- **Changes**:
  - Test: URL with token in query → path only
  - Test: Console with JWT → `[REDACTED]`
  - Test: Safe content preserved
- **Acceptance**: All redaction tests pass

### Impacted Files
- `src/devtools/redact.ts` (new)
- `src/devtools/network-tracker.ts` (modify)
- `src/devtools/console-tracker.ts` (modify)
- `src/config.ts` (modify)
- `tests/devtools.test.ts` (modify)

---

## Task 5: Fix Empty Catch Block

### Purpose
Comply with repo coding standard "Never use empty catch blocks".

### Reasoning
- Empty catch blocks hide errors and make debugging difficult
- Repo AGENTS.md explicitly prohibits this pattern

### Acceptance Criteria
- [ ] Empty catch block replaced with explicit no-op or logging
- [ ] Behavior preserved (url/title set to undefined on error)
- [ ] Lint passes

### Subtasks

#### 5.1 Update catch block in snapshotter
- **File**: `src/snapshot/snapshotter.ts`
- **Changes**:
  - Replace `catch { }` with `catch (_err) { void _err; }`
  - Or add a comment: `// Intentionally ignore - page may be navigating`
- **Acceptance**: No empty catch; lint passes

### Impacted Files
- `src/snapshot/snapshotter.ts` (modify)

---

## Task 6: Improve Ref Robustness

### Purpose
Make refs more stable and handle iframe limitations gracefully.

### Reasoning
- `:nth-child()` selectors break on any DOM mutation
- frameId is captured but not used, causing silent failures on iframe elements
- Better selector heuristics improve reliability

### Acceptance Criteria
- [ ] Snapshot filters to main frame only (short-term)
- [ ] Selector generation prefers data-testid/aria-label when available
- [ ] Warning emitted when iframe content detected but not actionable

### Subtasks

#### 6.1 Filter snapshot to main frame
- **File**: `src/snapshot/snapshotter.ts`
- **Changes**:
  - Only include AX nodes where frameId matches main frame (or is absent)
  - Log warning count of skipped iframe nodes
- **Acceptance**: No iframe refs in snapshot output

#### 6.2 Improve selector generation heuristics
- **File**: `src/snapshot/snapshotter.ts`
- **Changes**:
  - In SELECTOR_FUNCTION, check for `data-testid` attribute first
  - Then check for unique `aria-label`
  - Fall back to id, then nth-child chain
- **Acceptance**: Selectors prefer stable attributes

#### 6.3 Add selector robustness tests
- **File**: `tests/snapshotter.test.ts`
- **Changes**:
  - Test: element with data-testid → uses testid selector
  - Test: element with aria-label → uses aria selector
  - Test: element with id → uses id selector
  - Test: fallback to nth-child
- **Acceptance**: Selector preference order verified

### Impacted Files
- `src/snapshot/snapshotter.ts` (modify)
- `tests/snapshotter.test.ts` (modify)

---

## Task 7: Update Documentation

### Purpose
Ensure documentation accurately reflects current state and remediation progress.

### Reasoning
- Stale docs claiming "no gaps" mislead developers and agents
- Architecture comparison should reflect reality

### Acceptance Criteria
- [ ] `docs/ARCHITECTURE_COMPARISON.md` updated with gaps and remediation status
- [ ] `AGENTS.md` includes installation playbook and security defaults
- [ ] `README.md` reflects correct installation and config approach

### Subtasks

#### 7.1 Update ARCHITECTURE_COMPARISON.md
- **File**: `docs/ARCHITECTURE_COMPARISON.md`
- **Changes**:
  - Replace "Remaining Gaps: None" with actual gap list
  - Add remediation checklist with status
  - Reference this plan and gaps report
- **Acceptance**: Doc reflects reality

#### 7.2 Update AGENTS.md with ideal state
- **File**: `AGENTS.md`
- **Changes**:
  - Add "Config & Installation (OpenCode-compliant)" section
  - Add "Security Defaults" section
  - Add "For LLM Agents" installation playbook
- **Acceptance**: Agents have clear guidance

#### 7.3 Update README.md
- **File**: `README.md`
- **Changes**:
  - Installation: add `opendevbrowser@latest` to plugin array
  - Config: document `~/.config/opencode/opendevbrowser.jsonc`
  - Remove any references to `config.opendevbrowser` in opencode.json
- **Acceptance**: README matches approved approach

### Impacted Files
- `docs/ARCHITECTURE_COMPARISON.md` (modify)
- `AGENTS.md` (modify)
- `README.md` (modify)

---

## Implementation Order

1. **Task 5** (trivial) - Fix empty catch block
2. **Task 2** (low complexity) - Secure CDP validation
3. **Task 1** (medium) - Plugin-owned config file
4. **Task 4** (medium) - Redact secrets
5. **Task 3** (medium) - Sanitize export HTML
6. **Task 6** (medium) - Improve ref robustness
7. **Task 7** (low) - Update documentation

---

## Success Metrics

- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Plugin works with zero config (just add to plugin array)
- [ ] No XSS vectors in exported components
- [ ] No secrets in tool output by default
- [ ] Documentation accurate and complete
