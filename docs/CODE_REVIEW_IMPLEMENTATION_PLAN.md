# Code Review Implementation Plan

Generated: 2025-12-27

## Goal
Resolve all confirmed findings from `docs/CODE_REVIEW_REPORT.md` with safe defaults, minimal configuration burden, and clear documentation alignment.

## Principles
- Zero-config UX: fixes should work out of the box.
- Security by default; opt-in unsafe modes only.
- Keep `docs/PLAN.md`, `docs/opendevbrowser-plan.md`, and `docs/IMPLEMENTATION_BLUEPRINT.md` in sync when behavior changes.

## Decision Note (Defaults)
- Malformed JSONC: throw with explicit error to avoid silent misconfiguration.
- DevTools: strip query/hash by default; console redaction uses token heuristics; opt in via `devtools.showFullUrls/showFullConsole`.
- Export: DOM sanitization on by default; subtree styles inline; cap nodes at `export.maxNodes` (default 1000); `allowUnsafeExport` bypasses sanitization with warning.
- Snapshot: `snapshot.maxNodes` default 1000 and iframe skip warning emitted.

## Validation Summary (confirmed issues)
High
- DevTools redaction only handles known params and lacks toggles: `src/devtools/network-tracker.ts:3` `src/devtools/network-tracker.ts:5` `src/config.ts:32`
- Export sanitization is regex-based and feeds `dangerouslySetInnerHTML`: `src/export/dom-capture.ts:8` `src/export/react-emitter.ts:8`

Medium
- `allowUnsafeExport` exists but is unused: `src/config.ts:10` `src/browser/browser-manager.ts:421` `src/export/react-emitter.ts:8`
- Malformed JSONC falls back silently: `src/config.ts:64` `tests/config.test.ts:100`
- `closeTarget` can leave stale targets if `page.close()` throws: `src/browser/target-manager.ts:146`
- Snapshot redacts any label containing "password": `src/snapshot/snapshotter.ts:342`
- Export fidelity limited to root computed styles: `src/export/dom-capture.ts:34` `src/export/css-extract.ts:3`
- Docs still show schema-breaking config and "no gaps": `docs/opendevbrowser-plan.md:262` `docs/IMPLEMENTATION_BLUEPRINT.md:114` `docs/ARCHITECTURE_COMPARISON.md:106`
- Silent catch blocks in browser manager: `src/browser/browser-manager.ts:179` `src/browser/browser-manager.ts:232` `src/browser/browser-manager.ts:255` `src/browser/browser-manager.ts:288`

Low
- Console redaction regex over-redacts long identifiers: `src/devtools/console-tracker.ts:3`
- Sanitization regex duplicated in Node and browser contexts: `src/export/dom-capture.ts:8` `src/export/dom-capture.ts:43`
- Skill loader assumes `rootDir/skills` exists at runtime: `src/skills/skill-loader.ts:11`
- Disconnect does not explicitly detach ref invalidation listeners: `src/browser/browser-manager.ts:157` `src/browser/browser-manager.ts:521`
- `MAX_AX_NODES` is fixed and non-configurable: `src/snapshot/snapshotter.ts:94`
- Iframe warning/tests missing for snapshot refs: `src/snapshot/snapshotter.ts:211` `tests/snapshotter.test.ts:1`
- Selector function is a raw string literal: `src/snapshot/snapshotter.ts:137`
- `listTargets` title fetch is sequential: `src/browser/target-manager.ts:114`
- Lint error from unused `vi` import: `tests/chrome-locator.test.ts:1`

## Task 0: Re-validate documentation intent
**What:** Re-read remediation and architecture docs to confirm intended behavior before modifying code.  
**How:** Extract requirements and reconcile any conflicts (config errors, redaction defaults, export safety/fidelity).  
**Files:** `docs/REMEDIATION_PLAN.md`, `docs/ARCHITECTURE_GAPS_REPORT.md`, `docs/PLAN.md`, `docs/opendevbrowser-plan.md`, `docs/IMPLEMENTATION_BLUEPRINT.md`, `docs/ARCHITECTURE_COMPARISON.md`  
**Why:** Ensures changes align with documented UX/security expectations.  
**Acceptance:** A short decision note for defaults is captured in the implementation PR/summary.

## Task 1: Config schema extensions and policy alignment
**What:** Add missing config controls and decide malformed JSONC behavior.  
**How:**  
1. Extend config schema with:
   - `devtools.showFullUrls` and `devtools.showFullConsole` (default false).
   - `snapshot.maxNodes` (default to a safe higher cap, e.g., 1000).
2. Decide malformed JSONC policy:
   - Option A: throw on parse errors (plan-aligned).
   - Option B: warn and fallback (UX-friendly).  
3. Update tests to match the chosen policy.  
**Files:** `src/config.ts`, `tests/config.test.ts`  
**Why:** Safe defaults with clear opt-ins reduce user friction and avoid silent misconfigurations.  
**Acceptance:** Config validates new keys; malformed JSONC behavior is explicit and tested.

## Task 2: DevTools redaction fixes
**What:** Prevent query param leakage and tune console redaction sensitivity.  
**How:**  
1. Redact full query strings by default; respect `devtools.showFullUrls` to keep them.
2. Update console redaction regex to reduce false positives (increase length threshold or add entropy heuristic).
3. Add tests for default redaction and opt-in behavior.  
**Files:** `src/devtools/network-tracker.ts`, `src/devtools/console-tracker.ts`, `tests/devtools.test.ts`, `src/config.ts`  
**Why:** Protect secrets without degrading diagnostic output.  
**Acceptance:** Default output strips queries; console redaction preserves non-secrets; tests cover both modes.

## Task 3: Export sanitization and unsafe export wiring
**What:** Replace regex sanitization with DOM-based sanitization and wire unsafe export config.  
**How:**  
1. In `captureDom`, parse HTML in a `template`/`div`, remove disallowed tags, strip `on*` attrs, remove dangerous URLs.
2. Add `allowUnsafeExport` flow to bypass sanitization only when explicitly enabled.
3. Emit a warning comment in TSX when unsafe mode is used.  
4. Ensure only one sanitizer source of truth (avoid duplicate regex logic).  
**Files:** `src/export/dom-capture.ts`, `src/export/react-emitter.ts`, `src/browser/browser-manager.ts`, `src/config.ts`, `tests/export.test.ts`  
**Why:** Regex sanitizers are fragile; explicit unsafe opt-in keeps UX safe.  
**Acceptance:** Sanitization robust against nested/malformed HTML; unsafe mode works and warns.

## Task 4: Export fidelity for subtree styles
**What:** Preserve styling for child nodes.  
**How:**  
1. Inline computed styles for each element in the captured subtree (bounded by node cap).
2. Preserve the existing CSS extraction for root if needed, but ensure children remain styled.  
3. Add a node cap and warning for large trees to prevent runaway output.  
**Files:** `src/export/dom-capture.ts`, `src/export/css-extract.ts`  
**Why:** Avoid producing broken clones when styles depend on global CSS.  
**Acceptance:** Child elements retain styling in exported output; no excessive output growth beyond cap.

## Task 5: Snapshot robustness improvements
**What:** Improve redaction accuracy, scalability, and transparency.  
**How:**  
1. Remove keyword redaction for "password" labels; keep high-entropy redaction only.
2. Make node cap configurable via `snapshot.maxNodes`.
3. Track skipped iframe nodes and surface a warning count in snapshot results.
4. Convert `SELECTOR_FUNCTION` to real TS function, pass `toString()` to CDP.
5. Add tests for selector precedence and iframe warning counts.  
**Files:** `src/snapshot/snapshotter.ts`, `src/tools/snapshot.ts`, `tests/snapshotter.test.ts`, `src/config.ts`  
**Why:** Improves UX on auth flows and complex pages without sacrificing safety.  
**Acceptance:** Snapshot output preserves labels; node cap configurable; iframe skips are visible; tests pass.

## Task 6: BrowserManager error handling
**What:** Remove silent catch blocks that discard errors without context.  
**How:**  
1. Replace empty catch blocks in `status`, `page`, `listPages`, `useTarget` with minimal context handling (non-sensitive flags or warnings).
2. Keep UX resilient by returning undefined values while retaining internal traceability.  
**Files:** `src/browser/browser-manager.ts`  
**Why:** Improves debuggability without exposing sensitive data.  
**Acceptance:** No empty catch blocks; behavior remains stable.

## Task 7: Target/session lifecycle hardening
**What:** Prevent zombie targets, reduce latency, and clean listeners.  
**How:**  
1. Wrap `closeTarget` cleanup in `finally` so state is cleaned even on close errors.
2. Parallelize `listTargets` title lookup with `Promise.all`.
3. On disconnect, detach ref invalidation listeners using stored cleanup callbacks.  
**Files:** `src/browser/target-manager.ts`, `src/browser/browser-manager.ts`  
**Why:** Keeps state consistent and improves responsiveness.  
**Acceptance:** No stale targets after failed closes; listTargets latency reduced; listeners cleaned on disconnect.

## Task 8: Skill asset path resilience
**What:** Ensure skill files are always discoverable in runtime builds.  
**How:**  
1. Confirm packaging includes `skills/` (already in `package.json`).
2. Add fallback logic for `SkillLoader` to locate project root if `rootDir/skills` missing.
3. Add tests for missing skill path behavior.  
**Files:** `src/skills/skill-loader.ts`, `tests/skill-loader.test.ts`, `package.json`  
**Why:** Prevent runtime failures when directory layout differs in `dist/`.  
**Acceptance:** Skill loader works in packaged builds and tests cover fallback.

## Task 9: Docs sync and lint fix
**What:** Update docs to match behavior and fix lint error.  
**How:**  
1. Remove schema-breaking config examples and update gap status.
2. Fix unused `vi` import in `tests/chrome-locator.test.ts`.  
**Files:** `docs/opendevbrowser-plan.md`, `docs/IMPLEMENTATION_BLUEPRINT.md`, `docs/ARCHITECTURE_COMPARISON.md`, `tests/chrome-locator.test.ts`  
**Why:** Keep docs accurate and CI green.  
**Acceptance:** Docs consistent with global config file strategy; lint passes.

## Task 10: Verification
**What:** Ensure quality gates pass.  
**How:** Run `npm run lint` and `npm run test` after changes.  
**Files:** N/A (command only)  
**Why:** Maintain coverage and style compliance.  
**Acceptance:** Lint and tests pass; coverage remains >=95%.


 Validation Summary (all issues confirmed with file evidence)
  High

  - DevTools redaction only handles known params and lacks toggles: src/devtools/network-tracker.ts:3 src/devtools/
    network-tracker.ts:5 src/config.ts:32 docs/REMEDIATION_PLAN.md:210
  - Export sanitization is regex-based and feeds dangerouslySetInnerHTML: src/export/dom-capture.ts:8 src/export/
    react-emitter.ts:8

  Medium

  - allowUnsafeExport exists but is unused: src/config.ts:10 src/browser/browser-manager.ts:421 src/export/react-
    emitter.ts:8 docs/REMEDIATION_PLAN.md:167
  - Malformed JSONC falls back silently, contrary to plan: src/config.ts:64 tests/config.test.ts:100 docs/
    REMEDIATION_PLAN.md:67
  - closeTarget can leave stale targets if page.close() throws: src/browser/target-manager.ts:146
  - Snapshot redacts any label containing “password”: src/snapshot/snapshotter.ts:342
  - Export fidelity limited to root computed styles: src/export/dom-capture.ts:34 src/export/css-extract.ts:3
  - Docs still show schema-breaking config and “no gaps”: docs/opendevbrowser-plan.md:262 docs/
    IMPLEMENTATION_BLUEPRINT.md:114 docs/ARCHITECTURE_COMPARISON.md:106

  Low

  - Console redaction regex over-redacts long identifiers: src/devtools/console-tracker.ts:3
  - Sanitization regex duplicated in Node and browser contexts: src/export/dom-capture.ts:8 src/export/dom-
    capture.ts:43
  - Skill loader assumes rootDir/skills exists in runtime builds (conditional; package includes skills, but runtime
    root needs confirmation): src/skills/skill-loader.ts:11
  - Disconnect does not explicitly detach ref invalidation listeners: src/browser/browser-manager.ts:157 src/browser/
    browser-manager.ts:521
  - MAX_AX_NODES is fixed and non-configurable: src/snapshot/snapshotter.ts:94
  - Iframe warning/tests missing for snapshot refs: src/snapshot/snapshotter.ts:211 tests/snapshotter.test.ts:1
  - Selector function is a raw string literal: src/snapshot/snapshotter.ts:137
  - listTargets title fetch is sequential: src/browser/target-manager.ts:114

  ———

  Notes: Plan prioritizes UX and safe defaults, aligns with remediation/gap docs, and keeps docs in sync. New files:
  none planned unless we decide to extract sanitizer helpers into a standalone module.

  1. Task: Documentation review and decision alignment
     Subtask 1.1: What: Re-read docs/REMEDIATION_PLAN.md, docs/ARCHITECTURE_GAPS_REPORT.md, docs/PLAN.md, docs/
     opendevbrowser-plan.md, docs/IMPLEMENTATION_BLUEPRINT.md, docs/ARCHITECTURE_COMPARISON.md to confirm intent; How:
     extract required behaviors (config error policy, redaction defaults, export safety/fidelity) into a short
     decision note; Files: all docs listed; Why: ensure fixes align with intended UX/security; Acceptance: documented
     Subtask 2.1: What: Add devtools toggles (show full URLs/console) and snapshot maxNodes; How: extend Zod schema
     and types in src/config.ts; Files: src/config.ts; Why: enable safe defaults with opt-in verbosity; Acceptance:
     config validates new keys with defaults.
     Subtask 2.2: What: Optionally add export controls (e.g., export.allowUnsafeHtml, export.inlineSubtreeStyles,
     export.maxNodes) if needed for fidelity vs size; How: extend config schema and types; Files: src/config.ts; Why:
     preserve UX while keeping output manageable; Acceptance: defaults are safe and do not require user config.
  3. Task: DevTools redaction behavior + console regex tuning
     Subtask 3.1: What: Strip all query params by default; allow opt-in full URLs; How: update redactUrl to drop
     search unless devtools.showFullUrls; Files: src/devtools/network-tracker.ts, src/config.ts; Why: prevent token
     leakage per remediation plan; Acceptance: URLs are query-free by default and toggle restores full URL.
     Subtask 3.2: What: Make console redaction less aggressive; How: raise minimum length (e.g., 32+) and/or require
     mixed char classes, while keeping token|key|secret patterns; Files: src/devtools/console-tracker.ts; Why: reduce
     false positives without sacrificing security; Acceptance: tests show common long identifiers preserved while
     secrets redacted.
     Subtask 3.3: What: Update tests for new toggles and regex behavior; How: extend tests/devtools.test.ts; Files:
     tests/devtools.test.ts; Why: enforce plan-aligned behavior; Acceptance: tests cover default and opt-in cases.
  4. Task: Export sanitization and unsafe export wiring
     Subtask 4.1: What: Replace regex sanitization with DOM-based sanitization inside page.$eval; How: use template or
     div to parse, remove disallowed tags, strip on* attrs and dangerous URL protocols; Files: src/export/dom-
     capture.ts; Why: more robust and avoids regex brittleness; Acceptance: tests verify removal of scripts/handlers/
     unsafe URLs with nested structures.
     Subtask 4.2: What: Wire allowUnsafeExport; How: pass config into captureDom and emitReactComponent, skip sanitize
     when enabled, and add warning comment in emitted TSX; Files: src/browser/browser-manager.ts, src/export/dom-
     capture.ts, src/export/react-emitter.ts, src/config.ts; Why: explicit opt-in unsafe behavior; Acceptance: unsafe
     mode bypasses sanitization and injects warning comment.
     Subtask 4.3: What: Remove sanitization duplication; How: keep single sanitization implementation in browser
     context and remove Node-side regex or derive from a shared function string; Files: src/export/dom-capture.ts;
     Why: reduce drift risk; Acceptance: only one sanitizer source of truth.
  5. Task: Export fidelity for subtree styles
     Subtask 5.1: What: Inline computed styles for subtree elements by default (bounded by max nodes); How: traverse
     subtree in page.$eval, set style for each element; Files: src/export/dom-capture.ts, src/export/css-extract.ts
     (if needed); Why: improve clone fidelity without requiring config; Acceptance: child elements retain styling in
     output.
     Subtask 5.2: What: Add max node cap and warnings for large trees; How: track node count and return truncated flag
     or warning; Files: src/export/dom-capture.ts, src/export/react-emitter.ts (if warning surfaced); Why: preserve UX
     and output size; Acceptance: large trees do not blow up output and warnings are visible.
  6. Task: Snapshot correctness and robustness
     Subtask 6.1: What: Adjust redaction to avoid hiding “password” labels; How: remove keyword filter, keep high-
     entropy redaction only; Files: src/snapshot/snapshotter.ts; Why: preserve auth flow UX; Acceptance: “Forgot
     Password?” appears in snapshots.
     Subtask 6.2: What: Make MAX_AX_NODES configurable; How: add snapshot.maxNodes with default (e.g., 1000) and use
     in snapshot loop; Files: src/config.ts, src/snapshot/snapshotter.ts; Why: avoid truncation on complex pages;
     Acceptance: config controls max node cap.
     Subtask 6.3: What: Add iframe warning output; How: count skipped iframe nodes and return warnings in snapshot
     result; Files: src/snapshot/snapshotter.ts, src/tools/snapshot.ts, tests/snapshotter.test.ts; Why: transparency
     when refs are skipped; Acceptance: warning present when iframe nodes filtered.
     Subtask 6.4: What: Refactor selector function to real TS function and pass toString(); How: define function and
     use Runtime.callFunctionOn with string; Files: src/snapshot/snapshotter.ts; Why: compile-time validation;
     Acceptance: selector logic still works with tests updated.
     Subtask 6.5: What: Add tests for selector precedence and warnings; How: extend tests/snapshotter.test.ts; Files:
     tests/snapshotter.test.ts; Why: enforce planned selector order and warning behavior; Acceptance: tests cover
     testid/aria/id/nth-child and iframe warnings.
  7. Task: Target and session lifecycle hardening
     Subtask 7.1: What: Ensure closeTarget cleanup runs even on close failure; How: wrap page.close() in try/finally
     and always delete maps; Files: src/browser/target-manager.ts; Why: prevent zombie targets; Acceptance: cleanup
     executed on close error.
     Subtask 7.2: What: Parallelize listTargets title fetch; How: use Promise.all across pages; Files: src/browser/
     target-manager.ts; Why: lower latency with many tabs; Acceptance: titles/urls still returned correctly.
  8. Task: BrowserManager disconnect listener cleanup
     Subtask 8.1: What: Detach ref invalidation listeners on disconnect; How: iterate
     managed.targets.listPageEntries(), call cleanup from pageListeners.get(page) and remove; Files: src/browser/
     browser-manager.ts; Why: avoid retention of session closures; Acceptance: listeners removed before session
     deletion.
  9. Task: Skill loader asset path validation
     Subtask 9.1: What: Verify runtime directory root and packaging of skills/; How: confirm OpenCode plugin directory
     semantics and check build/package rules; Files: src/skills/skill-loader.ts, package.json, docs if needed; Why:
     ensure skills are loadable in production; Acceptance: skills path works in built package or adjusted with
     fallback logic.
  10. Task: Documentation sync and gap status updates
     Subtask 10.1: What: Update config examples and architecture status; How: remove opencode.json custom config
     examples, update gap status; Files: docs/opendevbrowser-plan.md, docs/IMPLEMENTATION_BLUEPRINT.md, docs/
     ARCHITECTURE_COMPARISON.md, docs/PLAN.md; Why: keep docs aligned and compliant; Acceptance: docs consistent and
     synced per docs/AGENTS.md.
  11. Task: QA and verification
     Subtask 11.1: What: Update tests for new behavior; How: extend existing tests and add new ones listed above;
     Files: tests/devtools.test.ts, tests/export.test.ts, tests/snapshotter.test.ts, tests/config.test.ts, tests/
     browser-manager.test.ts (if needed); Why: maintain coverage thresholds; Acceptance: npm run test and npm run lint
     pass.
