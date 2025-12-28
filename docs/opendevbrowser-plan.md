# OpenDevBrowser Plugin Plan (MVP + Roadmap)

## Purpose
OpenDevBrowser is an OpenCode plugin that provides **script-first, snapshot-first** browser automation and DOM extraction, optimized for speed and token efficiency. It is **not** an MCP orchestrator. All capabilities are native to the plugin, optionally enhanced by a companion Chrome extension.

## Goals (MVP)
- Fast, deterministic, **Dev Browser–style** UX: snapshot → refs → actions.
- Token-light outputs (AX-outline snapshots + cursor paging).
- Chrome-first via CDP with zero-config install.
- DOM extraction from terminal (selected elements and small subtrees).
- Batchable tool flow (`opendevbrowser_run`) for snappy automation.

## Progress (Synced)
- [x] Scaffold project files (package.json, tsconfig, src layout) and baseline config defaults.
- [x] Implement cache/chrome locator/downloader utilities and config validation.
- [x] Implement browser management (sessions, targets), snapshotter/refs, and script runner.
- [x] Implement tool handlers (launch/connect/etc, actions, dom extract, run, prompting guide).
- [x] Implement devtools trackers and export pipeline stubs; update docs/plan files with progress.
- [x] Wire lint/test scripts and baseline test tooling.
- [x] Implement tests with >=95% coverage and ensure passing.
- [x] Scaffold optional extension Phase 1 folder.
- [x] Add README usage examples and config snippets.
- [x] Implement relay server + extension bridge (Mode C) with auto-switch and forwarding.
- [x] Add relay handshake/forwarding tests and fallback behavior.
- [x] Add optional relay pairing token and extension reconnect/tab tracking updates.
- [x] Implement named page helpers (opendevbrowser_page/opendevbrowser_list/opendevbrowser_close) and name-to-target mapping.
- [x] Implement export tools (opendevbrowser_clone_page/opendevbrowser_clone_component) using export pipeline.
- [x] Implement lightweight perf metrics + screenshot tool (keep full tracing as non-goal).
- [x] Add extension unit tests (attach/detach, tab selection, reconnect).
- [x] Align build tooling in docs vs code (tsc build).

## Non-Goals (MVP)
- Visual / screenshot-based automation.
- Full DevTools debugger (breakpoints, step-through, source maps).
- Full-page “Superdesign clone & export project”.
- Performance tracing and HAR export.
- Full-fidelity screenshots as a primary automation signal.

---

## Recommended Defaults (Best Practices)
- **Default connection mode:** Mode A (plugin launches managed Chrome with CDP on `127.0.0.1`).
- **Browser detection:** system Chrome auto-detected; auto-fallback to Chrome for Testing download in plugin cache if Chrome is missing.
- **Driver:** `playwright-core` (CDP-backed) for reliable waits and selectors without downloading browsers by default.
- **Profile:** persistent but isolated (plugin-managed `user-data-dir` stored in plugin cache, per-project isolation).
- **Snapshots:** AX-outline only (pruned to actionable + semantic nodes), strict `maxChars` and cursor paging.
- **Security:** never return cookies/storage by default; bind to localhost only; raw CDP tool disabled unless explicitly enabled.

---

## Architecture Overview (Plugin-Native)
- Plugin module (OpenCode JS/TS): registers tools and manages lifecycle.
- BrowserManager: launch/connect to Chrome, manage persistent context and targets.
- ScriptRunner: executes multi-step scripts with helper utilities (waits, retries, selectors).
- Snapshotter: injects ARIA snapshot script and stores a ref map for stable selection.
- DevTools adapter: CDP sessions for network and console signals (perf later).
- Export pipeline: DOM + computed styles capture -> React component + CSS.
- Cache manager: stores profiles, browser downloads, and artifacts under plugin cache.
- Optional extension + relay: chrome.debugger in extension + local WebSocket bridge.

## Tool Surface (MVP)
All tools are namespaced to prevent collisions: `opendevbrowser_*`.

### Session / Connection
- `opendevbrowser_launch`
  - Args: `{ profile?, headless?, startUrl?, chromePath?, flags?, persistProfile? }`
  - Output: `{ ok, sessionId, mode:"A", browserWsEndpoint, activeTargetId?, warnings? }`

- `opendevbrowser_connect` (optional for MVP but small, Mode B)
  - Args: `{ wsEndpoint?, port?, host? }`
  - Output: `{ ok, sessionId, mode:"B", browserWsEndpoint, warnings? }`

- `opendevbrowser_disconnect`
  - Args: `{ sessionId, closeBrowser? }`
  - Output: `{ ok }`

- `opendevbrowser_status`
  - Args: `{ sessionId }`
  - Output: `{ ok, mode, activeTargetId?, url?, title? }`

### Targets / Tabs
- `opendevbrowser_targets_list`
  - Args: `{ sessionId, includeUrls? }`
  - Output: `{ ok, activeTargetId?, targets:[{ targetId, title?, url?, type }] }`

- `opendevbrowser_target_use`
  - Args: `{ sessionId, targetId }`
  - Output: `{ ok, activeTargetId, url?, title? }`

- `opendevbrowser_target_new`
  - Args: `{ sessionId, url? }`
  - Output: `{ ok, targetId }`

- `opendevbrowser_target_close`
  - Args: `{ sessionId, targetId }`
  - Output: `{ ok }`

### Named Pages
- `opendevbrowser_page`
  - Args: `{ sessionId, name, url? }`
  - Output: `{ ok, targetId }`

- `opendevbrowser_list`
  - Args: `{ sessionId }`
  - Output: `{ ok, pages:[{ name, targetId, url?, title? }] }`

- `opendevbrowser_close`
  - Args: `{ sessionId, name }`
  - Output: `{ ok }`

### Navigation / Wait
- `opendevbrowser_goto`
  - Args: `{ sessionId, url, waitUntil?, timeoutMs? }`
  - Output: `{ ok, finalUrl?, status?, timingMs }`

- `opendevbrowser_wait`
  - Args:
    - `{ sessionId, until: "domcontentloaded"|"load"|"networkidle", timeoutMs? }`
    - or `{ sessionId, ref, state?: "attached"|"visible"|"hidden", timeoutMs? }`
  - Output: `{ ok, timingMs }`

### Snapshot / Refs (Core Loop)
- `opendevbrowser_snapshot`
  - Args: `{ sessionId, format?: "outline"|"actionables", maxChars?, cursor? }`
  - Output: `{ ok, snapshotId, url?, title?, content, truncated, nextCursor?, refCount, timingMs }`

### Actions (Ref-first)
- `opendevbrowser_click`
  - Args: `{ sessionId, ref }`
  - Output: `{ ok, timingMs, navigated? }`

- `opendevbrowser_type`
  - Args: `{ sessionId, ref, text, clear?, submit? }`
  - Output: `{ ok, timingMs }`

- `opendevbrowser_select`
  - Args: `{ sessionId, ref, values }`
  - Output: `{ ok }`

- `opendevbrowser_scroll`
  - Args: `{ sessionId, dy, ref? }`
  - Output: `{ ok }`

### DOM Extraction (Required by brief)
- `opendevbrowser_dom_get_html`
  - Args: `{ sessionId, ref, maxChars? }`
  - Output: `{ ok, ref, outerHTML, truncated }`

- `opendevbrowser_dom_get_text`
  - Args: `{ sessionId, ref, maxChars? }`
  - Output: `{ ok, ref, text, truncated }`

### Batch Runner (Fast UX)
- `opendevbrowser_run`
  - Args: `{ sessionId, steps:[...], stopOnError?, maxSnapshotChars? }`
  - Output: `{ ok, results:[{ i, ok, data?, error? }], timingMs }`

### Prompting Guides (Skill Pack)
- `opendevbrowser_prompting_guide`
  - Args: `{ topic? }`
  - Output: `{ ok, guide }`

### Lightweight DevTools Signals
- `opendevbrowser_console_poll`
  - Args: `{ sessionId, sinceSeq?, max? }`
  - Output: `{ ok, events:[{ seq, level, text, ts }], nextSeq }`

- `opendevbrowser_network_poll`
  - Args: `{ sessionId, sinceSeq?, max? }`
  - Output: `{ ok, events:[{ seq, method, url, status?, resourceType?, ts }], nextSeq }`

### DevTools Additions
- `opendevbrowser_perf`
  - Args: `{ sessionId }`
  - Output: `{ ok, metrics:[{ name, value }] }`

- `opendevbrowser_screenshot`
  - Args: `{ sessionId, path? }`
  - Output: `{ ok, path? , base64? }`

---

## Snapshot & Ref Strategy
- Primary: AX tree (Accessibility domain) → prune to actionable + semantic nodes.
- `ref` maps to `{ backendNodeId, frameId, targetId }` internally.
- Refs invalidated on navigation; new snapshot required after document change.
- Output format is short, deterministic, and token-efficient.

---

## Security & Safety Defaults
- Bind CDP to `127.0.0.1` only.
- Refuse non-local endpoints unless explicitly allowed by config.
- Redact likely secrets in snapshots (password fields, token-like strings).
- Raw CDP tool disabled by default; can be enabled in config.

---

## Testing & Tooling
- Vitest with >=95% coverage thresholds for `src/` (extension excluded from coverage thresholds).
- Dependency audit updates may require minor test harness adjustments.

---

## Skill Pack (Initial Deployment)
- Bundle a small skill pack for best-practice prompting and script generation guidance.
- Store in `skills/opendevbrowser-best-practices/SKILL.md`.
- Load on demand via `opendevbrowser_prompting_guide` to avoid bloating other tools.

---

## Output Format (Default)
- **Default:** React component (TSX) + CSS for portability into Next.js or plain React apps.
- **Optional later:** JSON IR for advanced codegen or multi-framework export.

## Export Tools
- `opendevbrowser_clone_page` -> TSX + CSS bundle
- `opendevbrowser_clone_component` -> TSX + CSS for selected subtree

---

## Phased Roadmap (Reconciled Sequencing)
Extension is staged; the plugin remains fully functional without it.

### Phase 0 — Foundation (Mode A) (Done)
- Chrome executable detection and launcher
- Auto-download Chrome for Testing into plugin cache if Chrome is missing
- CDP WebSocket client + target attach
- Tools: `launch`, `disconnect`, `targets_list`, `target_use`, `goto`, `wait`

### Phase 1 — Dev Browser Loop (MVP Core) (Done)
- `snapshot` AX-outline + refs
- `click`, `type`, `select`, `scroll`
- `run` batch tool

### Phase 2 — DOM Extraction + Export Lite (Superdesign-lite) (Done)
- `dom_get_html`, `dom_get_text`
- Optional: `clone_component` IR for codegen
- Optional: injected element picker overlay

### Phase 3 — DevTools Observability (Done)
- Console + network polling
- Optional: screenshot (file output)

### Phase 4 — Mode B (connect to user Chrome) (Done)
- `connect` with safety checks and clear instructions

### Phase 5 — Optional Extension Bridge (Mode C) (Done)
- Local WS bridge + pairing token
- Extension uses `chrome.debugger` to proxy CDP
- Reliability hardening: reconnect, target tracking, tab grouping

### Post-MVP Gap Fixes (Done)
- Named pages helpers and name-to-target mapping.
- Export tools wired to export pipeline.
- Lightweight perf metrics + screenshot tool.
- Extension unit tests (attach/detach, tab selection, reconnect).
- Build tooling reconciliation (tsc vs tsup/bun).

---

## Config Example (OpenCode)
`opencode.json` should only declare the plugin:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opendevbrowser"]
}
```

Plugin-owned config (optional) lives at `~/.config/opencode/opendevbrowser.jsonc`:
```jsonc
{
  "headless": false,
  "profile": "default",
  "snapshot": { "maxChars": 16000, "maxNodes": 1000 },
  "export": { "maxNodes": 1000, "inlineStyles": true },
  "security": {
    "allowRawCDP": false,
    "allowNonLocalCdp": false,
    "allowUnsafeExport": false
  },
  "devtools": {
    "showFullUrls": false,
    "showFullConsole": false
  },
  "relayPort": 8787,
  "relayToken": ""
}
```

---

## Open Questions (Post-MVP)
- Do we prioritize extension bridge (Mode C) for enterprise users?
- Which extraction presets should be first (links, forms, tables)?
- Do we add a “snapshot diff” tool for faster incremental updates?

## Additions for Plan Parity (What Was Added and Why)
- **Driver choice (`playwright-core`):** added for reliability (auto-waits, stable selectors) while staying CDP-based and avoiding browser downloads by default.
- **Browser auto-detection + fallback download:** added to meet the zero-install UX if Chrome is missing.
- **Profile location (plugin cache, per-project isolation):** added for safer defaults and reduced cross-project leakage.
- **Architecture overview:** added to clarify internal components and how the plugin stays native without MCP.
- **Output format (React component + CSS):** added to align with current ecosystem practices and minimal overhead.
- **Extension staging note + reliability hardening:** added to ensure v1 works without the extension and to outline stability work for Mode C.
- **Roadmap phase numbering:** aligned to `docs/PLAN.md` to remove off-by-one confusion between plan files.
- **Skill pack (prompting guide):** added to make script generation more autonomous without inflating core tools.
