# Code Review Report

Generated: 2025-12-27

## Scope
- Reviewed implementation against `docs/REMEDIATION_PLAN.md` and `docs/ARCHITECTURE_GAPS_REPORT.md`.
- Validated external review feedback items and incorporated confirmed issues.

## Sources
- `docs/REMEDIATION_PLAN.md`
- `docs/ARCHITECTURE_GAPS_REPORT.md`
- `docs/PLAN.md`
- `docs/opendevbrowser-plan.md`
- `docs/IMPLEMENTATION_BLUEPRINT.md`
- `docs/ARCHITECTURE_COMPARISON.md`

## Summary
- High: 2
- Medium: 7
- Low: 9
- Tests executed: none

## Findings

### High

H-1. DevTools redaction does not strip all query params by default and has no opt-out toggles, which conflicts with the remediation plan and can leak tokens in non-standard params.
- Evidence: `src/devtools/network-tracker.ts:3` `src/devtools/network-tracker.ts:5` `src/config.ts:32` `docs/REMEDIATION_PLAN.md:210`
- Impact: Sensitive data can appear in tool output and logs.
- Recommendation: Strip all query params by default and add config toggles for full URLs/console output.

H-2. Export sanitization relies on regex and then injects HTML via `dangerouslySetInnerHTML`, which is not a robust XSS boundary.
- Evidence: `src/export/dom-capture.ts:8` `src/export/react-emitter.ts:8`
- Impact: Exported components can ship XSS gadgets if HTML is rendered in a trusted context.
- Recommendation: Use DOM-based sanitization in browser context or a robust sanitizer (e.g., DOMPurify), and keep unsafe export gated behind explicit config.

### Medium

M-1. `allowUnsafeExport` exists but is not wired; plan expects an explicit unsafe export flag and warning in emitted TSX.
- Evidence: `src/config.ts:10` `src/browser/browser-manager.ts:421` `src/export/react-emitter.ts:8` `docs/REMEDIATION_PLAN.md:167`
- Impact: Config does not control export safety, and consumers get no warning when unsafe export is intended.
- Recommendation: Pass config into export pipeline, toggle sanitization, and emit a warning comment when unsafe.

M-2. Malformed JSONC config handling diverges from plan: parse errors silently fall back to defaults.
- Evidence: `src/config.ts:64` `tests/config.test.ts:100` `docs/REMEDIATION_PLAN.md:67`
- Impact: Misconfiguration goes unnoticed; plan requires a clear error.
- Recommendation: Decide desired behavior, then align config loader and tests to match.

M-3. `TargetManager.closeTarget` can leave stale entries if `page.close()` throws.
- Evidence: `src/browser/target-manager.ts:146`
- Impact: Zombie targets remain and may corrupt state.
- Recommendation: Move cleanup into a `finally` block or wrap close in `try/catch` with guaranteed cleanup.

M-4. Snapshot redaction hides any label containing "password", masking auth UI text.
- Evidence: `src/snapshot/snapshotter.ts:342`
- Impact: Agents can lose access to common auth flows ("Forgot Password?", "Reset Password").
- Recommendation: Remove this keyword redaction or scope it to actual secret values only.

M-5. Export fidelity is limited: only the root element's computed styles are captured.
- Evidence: `src/export/dom-capture.ts:34` `src/export/css-extract.ts:3`
- Impact: Cloned components can lose styling for children dependent on global CSS.
- Recommendation: Inline styles for the subtree or extract CSS rules for all nodes.

M-6. Documentation still shows schema-breaking config and claims all gaps are remediated.
- Evidence: `docs/opendevbrowser-plan.md:262` `docs/IMPLEMENTATION_BLUEPRINT.md:114` `docs/ARCHITECTURE_COMPARISON.md:106`
- Impact: Docs mislead users and agents; plan compliance unclear.
- Recommendation: Update docs to match global config file strategy and gap status.

M-7. Browser manager uses silent catch blocks that discard errors without context.
- Evidence: `src/browser/browser-manager.ts:179` `src/browser/browser-manager.ts:232` `src/browser/browser-manager.ts:255` `src/browser/browser-manager.ts:288`
- Impact: Operational errors (detached pages, navigation failures) are masked, complicating debugging and telemetry.
- Recommendation: Add minimal structured handling (e.g., record a warning flag) or log non-sensitive context while keeping UX resilient.

### Low

L-1. Console redaction regex redacts any 24+ character token, likely over-redacting non-secrets.
- Evidence: `src/devtools/console-tracker.ts:3`
- Impact: Debugging signal loss (long class names, stack traces, UUIDs).
- Recommendation: Increase minimum length or adopt entropy-based heuristics.

L-2. Sanitization regexes are duplicated between Node and browser contexts.
- Evidence: `src/export/dom-capture.ts:8` `src/export/dom-capture.ts:43`
- Impact: Drift risk when updating sanitization rules.
- Recommendation: Pass patterns into `$eval` or inject a single shared string.

L-3. Skill loader assumes assets are present under `rootDir/skills` in runtime builds.
- Evidence: `src/skills/skill-loader.ts:11`
- Impact: Missing skill files if build output excludes `skills/`.
- Recommendation: Ensure build copies assets or adjust runtime root to project root.

L-4. Disconnect does not explicitly detach ref invalidation listeners.
- Evidence: `src/browser/browser-manager.ts:157` `src/browser/browser-manager.ts:521`
- Impact: Potential retention of session closures; small leak risk.
- Recommendation: Iterate pages and invoke stored cleanup callbacks on disconnect.

L-5. `MAX_AX_NODES` is fixed and not configurable.
- Evidence: `src/snapshot/snapshotter.ts:94`
- Impact: Large pages may truncate actionable elements.
- Recommendation: Make this configurable via snapshot config or raise default.

L-6. Snapshot ref robustness is partial: iframe nodes are filtered without warnings and selector-precedence tests are missing.
- Evidence: `src/snapshot/snapshotter.ts:211` `tests/snapshotter.test.ts:1`
- Impact: Silent loss of iframe refs; tests do not enforce intended selector order.
- Recommendation: Emit a warning count for skipped iframe nodes and add selector tests.

L-7. Selector function is a raw string literal.
- Evidence: `src/snapshot/snapshotter.ts:137`
- Impact: No compile-time validation of selector logic.
- Recommendation: Define a real function and pass `toString()` to CDP.

L-8. `listTargets` fetches titles sequentially; can be slow with many tabs.
- Evidence: `src/browser/target-manager.ts:114`
- Impact: Latency under high tab counts.
- Recommendation: Use `Promise.all` for parallel title retrieval.

L-9. Unused import triggers lint error in chrome locator tests.
- Evidence: `tests/chrome-locator.test.ts:1`
- Impact: Lint failure in CI.
- Recommendation: Remove the unused `vi` import.

## Remediation and Gap Alignment

GAP-1 (config schema mismatch): Partial
- Evidence: Code uses global config file, but docs still show `opencode.json` config. `src/config.ts:52` `docs/opendevbrowser-plan.md:262`

GAP-2 (CDP local-only validation): Fixed
- Evidence: `src/browser/browser-manager.ts:566`

GAP-3 (unsafe export pipeline): Partial
- Evidence: Sanitization present but regex-based; unsafe export flag not wired. `src/export/dom-capture.ts:8` `src/config.ts:10`

GAP-4 (devtools secret leakage): Partial
- Evidence: Key-based redaction only and no config toggles. `src/devtools/network-tracker.ts:3` `src/devtools/console-tracker.ts:3`

GAP-5 (empty catch): Fixed
- Evidence: `src/snapshot/snapshotter.ts:45`

GAP-6 (ref robustness): Partial
- Evidence: Main-frame filter and selector heuristics exist, but warnings/tests missing. `src/snapshot/snapshotter.ts:211` `tests/snapshotter.test.ts:1`

GAP-7 (doc drift): Open
- Evidence: `docs/ARCHITECTURE_COMPARISON.md:106`

## Open Questions
- Should implementation align to the remediation plan (strict config errors, redaction toggles), or should the plan be updated to reflect current behavior?
- Do you want query params stripped entirely by default, or keep key-based redaction?
- Should export fidelity be upgraded to subtree CSS capture, or is the current lightweight clone acceptable?

## Suggested Next Steps
- Decide on the config error-handling policy, then update `src/config.ts` and `tests/config.test.ts`.
- Implement devtools redaction toggles and strict URL stripping if plan alignment is required.
- Wire `allowUnsafeExport` into the export pipeline and add a warning comment in emitted TSX.
- Add missing ref robustness warnings/tests and consider making `MAX_AX_NODES` configurable.
