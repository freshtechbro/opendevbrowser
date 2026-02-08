# Extension-Only Mode Remediation Plan

Fix plan for extension-only command failures identified during the February 8, 2026 command-matrix and low-churn rerun.

---

## Overview

### Baseline context
- Repro artifacts:
  - `/tmp/opendevbrowser-extension-command-matrix-report.json`
  - `/tmp/opendevbrowser-extension-failed-subset-rerun-low-churn.json`
- Current environment baseline (from rerun): daemon healthy, extension connected + handshaken, ops endpoint available.
- Persistent defects observed:
  - Follow-up CLI session commands fail with `RELAY_LEASE_REQUIRED` after successful `launch --extension-only`.
  - `--extension-legacy` is parsed in session command handlers but rejected by global arg validation.
  - `targets.close` / `page.close` can invalidate the entire ops session.
  - Native uninstall path resolves to parent directory in bundled CLI runtime.

### Key decisions
- Fix root causes, not test harnesses.
- Keep behavior backward compatible for direct daemon callers that already pass `leaseId`.
- Require targeted regression tests with each bug fix before matrix reruns.
- Use low-churn rerun artifact as pass/fail baseline.

---

## Task 1 — Fix lease continuity across CLI invocations

### Reasoning
CLI commands run as separate OS processes, so the client’s in-memory `sessionLeases` map does not survive between `launch` and follow-up commands. Daemon currently requires `leaseId` for mutating extension-session operations when a lease exists.

### What to do
Allow normal CLI follow-up commands to succeed without explicit `leaseId` while preserving ownership checks.

### How
1. Update session authorization logic in `src/cli/daemon-commands.ts` (`authorizeSessionCommand`) so same-owner operations can proceed when `leaseId` is omitted.
2. Keep strict rejection for commands from non-owner `clientId` and for explicitly wrong `leaseId`.
3. Apply the same ownership model in `session.disconnect` path (`disconnectSession`) so disconnect works consistently from regular CLI invocations.
4. Keep explicit `leaseId` support in requests for compatibility with direct daemon/API workflows.
5. Ensure lease touch/usage timestamps continue updating on authorized commands.

### Files impacted
- `src/cli/daemon-commands.ts`
- `src/cli/daemon-state.ts` (only if helper behavior needs centralization)

### End goal
Extension sessions remain lease-protected but are usable from the one-command-per-process CLI UX.

### Acceptance criteria
- [ ] `launch --extension-only` followed by `status --session-id <id>` succeeds without `RELAY_LEASE_REQUIRED`
- [ ] `goto`, `targets-list`, `target-close`, `page-close`, and `disconnect` work after launch in separate CLI invocations
- [ ] Requests from a different `clientId` still fail authorization

---

## Task 2 — Align annotate authorization with session lease model

### Reasoning
`annotate` currently uses binding-only auth for extension mode while most other extension-session operations use lease-based authorization. This inconsistency increases edge-case behavior and test complexity.

### What to do
Use the same session authorization path for `annotate` as other extension-session commands.

### How
1. In `src/cli/daemon-commands.ts`, route extension-mode `annotate` auth through `authorizeSessionCommand` (or equivalent shared helper) rather than direct `requireBinding`.
2. Keep transport validation intact (`relay` requires extension mode, `direct` allowed on managed mode).
3. Update integration tests to reflect lease/owner auth rules for `annotate`.

### Files impacted
- `src/cli/daemon-commands.ts`
- `tests/daemon-commands.integration.test.ts`

### End goal
Single, predictable auth model for extension-session daemon commands.

### Acceptance criteria
- [ ] `annotate` in extension mode authorizes under the same lease-owner rules as other session commands
- [ ] Managed-mode `annotate` direct transport behavior is unchanged
- [ ] Existing annotate payload validation tests continue to pass

---

## Task 3 — Fix `--extension-legacy` global arg validation mismatch

### Reasoning
`launch` and `connect` parsers accept `--extension-legacy`, but `parseArgs` rejects it as an unknown flag before command-specific parsing runs.

### What to do
Add `--extension-legacy` to global arg validation and keep docs/help behavior consistent.

### How
1. Add `--extension-legacy` to `validFlags` in `src/cli/args.ts`.
2. Add/adjust tests in `tests/cli-args.test.ts` to ensure the flag is accepted for session commands.
3. Verify docs/help text remains accurate (`docs/CLI.md` already documents the flag; update only if needed).

### Files impacted
- `src/cli/args.ts`
- `tests/cli-args.test.ts`
- `docs/CLI.md` (if textual sync is needed)

### End goal
Legacy extension relay mode is consistently usable from CLI.

### Acceptance criteria
- [ ] `launch --extension-legacy` no longer errors with unknown flag
- [ ] `connect --extension-legacy` no longer errors with unknown flag
- [ ] Invalid unrelated flags are still rejected

---

## Task 4 — Prevent full ops session teardown when closing non-root targets/pages

### Reasoning
When any target tab is removed/detached, runtime calls `cleanupSession(...)` for the owning session. Since all target tabs map back to one session, closing a secondary tab can end the whole session.

### What to do
Change tab/detach handlers so non-root target closure removes that target, not the entire session.

### How
1. Update `extension/src/ops/ops-runtime.ts`:
   - In `handleTabRemoved` and `handleDebuggerDetach`, determine whether the event is for root tab/session tab versus a secondary target.
   - For secondary targets, remove only that target mapping/state.
   - Cleanup full session only when root context is gone or session has no remaining targets.
2. Ensure explicit `targets.close` and `page.close` path does not race into full-session cleanup due to event ordering.
3. Validate active target fallback behavior when the current active target is removed.
4. Keep emitted ops events semantically correct (`ops_tab_closed` vs `ops_session_closed`).

### Files impacted
- `extension/src/ops/ops-runtime.ts`
- `extension/src/ops/ops-session-store.ts` (if helper methods or root-target metadata are needed)
- `src/browser/ops-browser-manager.ts` (only if event contract adjustments require manager updates)

### End goal
Target/page close operations are safe and do not invalidate healthy sessions.

### Acceptance criteria
- [ ] Closing a non-root target via `targets.close` keeps session active
- [ ] Closing a named page via `page.close` keeps session active when other targets remain
- [ ] Session closes only when root/last target closure condition is met

---

## Task 5 — Add regression tests for ops close semantics

### Reasoning
Current tests focus on OpsBrowserManager request routing but do not directly test extension ops runtime/store close-event behavior.

### What to do
Add targeted extension ops runtime/store tests for close event edge cases.

### How
1. Add new tests for runtime-level tab removal/detach handling:
   - secondary target close should not kill session,
   - root/last target close should end session.
2. Add store-level tests if needed for target removal and active target fallback invariants.
3. Keep tests deterministic with existing Chrome mocks (`tests/extension-chrome-mock.ts`) and fake timers where needed.

### Files impacted
- `tests/extension-background.test.ts` (if easiest integration point)
- `tests/extension-ops-runtime.test.ts` (new file, recommended)
- `tests/extension-ops-session-store.test.ts` (new file, optional but recommended)

### End goal
Ops close semantics are enforced by regression coverage.

### Acceptance criteria
- [ ] New tests fail before fix and pass after fix
- [ ] No regressions in existing `tests/ops-browser-manager.test.ts`

---

## Task 6 — Fix native script path resolution for bundled CLI

### Reasoning
Bundled CLI executes from `dist/cli/index.js`; current relative resolver (`../../../scripts/native`) points outside the repo root and breaks native install/uninstall script discovery.

### What to do
Make script path discovery robust for both source layout and bundled distribution layout.

### How
1. Replace static relative path assumption in `getScriptsDir()` within `src/cli/commands/native.ts`.
2. Implement resilient resolution strategy:
   - Prefer locating package root (e.g., by walking up until `package.json` containing `name: opendevbrowser`), then join `scripts/native`.
   - Keep fallback paths for source/dev contexts.
3. Add/extend tests to assert resolver output ends in `/opendevbrowser/scripts/native` for bundled execution assumptions.
4. Recheck `native status` output path using built CLI (`node dist/cli/index.js native status --output-format json`).

### Files impacted
- `src/cli/commands/native.ts`
- `tests/cli-native.test.ts`
- `tests/native-installer.test.ts` (if resolver helpers are covered there)

### End goal
Native host commands resolve script files correctly in both dev and built runtimes.

### Acceptance criteria
- [ ] `hostScriptPath` resolves to `<repo>/scripts/native/host.cjs`
- [ ] `native uninstall` no longer fails due to missing script path in bundled CLI
- [ ] Existing native command tests pass

---

## Task 7 — Re-run extension-only command validation and capture deltas

### Reasoning
Fixes must be confirmed against the same extension-only scenarios that produced failures.

### What to do
Re-run focused and full extension command tests; compare against baseline artifacts.

### How
1. Run targeted test suite first:
```bash
npm run test -- tests/daemon-commands.integration.test.ts tests/daemon-client.test.ts tests/cli-args.test.ts tests/cli-native.test.ts tests/ops-browser-manager.test.ts
```
2. Run low-churn rerun script used in baseline (if present):
```bash
node /tmp/odb_rerun_low_churn.mjs
```
3. Run full matrix script (if present):
```bash
node /tmp/odb_ext_test_matrix.mjs
```
4. Diff before/after artifacts and summarize residual failures with exact command + error.

### Files impacted
- `/tmp/opendevbrowser-extension-failed-subset-rerun-low-churn.json` (generated)
- `/tmp/opendevbrowser-extension-command-matrix-report.json` (generated)
- `CONTINUITY.md`
- `sub_continuity.md` (append by sub-agent only)

### End goal
Extension-only test evidence shows closure of the identified defects.

### Acceptance criteria
- [ ] Previously persistent issues are resolved or clearly reduced with root-cause notes
- [ ] No new high-severity regressions introduced in extension mode
- [ ] Updated continuity ledger reflects final status and remaining gaps

---

## File-by-file implementation sequence

1. `src/cli/daemon-commands.ts` — Tasks 1, 2
2. `tests/daemon-commands.integration.test.ts` — Tasks 1, 2
3. `src/cli/args.ts` — Task 3
4. `tests/cli-args.test.ts` — Task 3
5. `extension/src/ops/ops-runtime.ts` — Task 4
6. `extension/src/ops/ops-session-store.ts` — Task 4 (if needed)
7. `tests/extension-ops-runtime.test.ts` — Task 5 (new file)
8. `tests/extension-ops-session-store.test.ts` — Task 5 (optional new file)
9. `src/cli/commands/native.ts` — Task 6
10. `tests/cli-native.test.ts` — Task 6
11. `tests/native-installer.test.ts` — Task 6 (if needed)
12. `/tmp` scripts + generated reports — Task 7
13. `CONTINUITY.md` — Task 7 closeout

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| None expected | n/a | Fixes should be achievable with existing code and test stack |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-08 | Initial remediation plan created from extension-only command matrix + low-churn rerun findings |
