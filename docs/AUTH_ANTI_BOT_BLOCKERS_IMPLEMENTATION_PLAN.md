# Auth & Anti-Bot Blockers Implementation Plan (v2)

Second implementation plan focused on execution sequencing, live-mode hardening, and release readiness for blocker detection and manual resolution workflows.

---

## Overview

### Current baseline (2026-02-14)
- Blocker metadata plumbing and stabilization tests are already implemented across core runtime paths.
- Remaining risk is operational: extension-connected validation coverage, artifact quality consistency, and release-facing runbook parity.
- This v2 plan keeps all changes additive and avoids contract-breaking payload shifts.

### Key decisions
- Keep `error.code` taxonomy unchanged; blocker data remains additive under `meta.blocker`.
- Prioritize deterministic blocker outputs across managed, extension, and cdpConnect invoke paths.
- Use existing runtime/session surfaces; no new long-running service.
- Treat live-matrix evidence as release-gate input, not optional documentation.

---

## Task 1 — Freeze v2 Contract and Canonical Examples

### Reasoning
Execution and release work fail when teams interpret blocker payload shape differently.

### What to do
Lock the v2 blocker payload contract and publish canonical examples per surface.

### How
1. Finalize one canonical payload map for `goto`, `wait`, `debug-trace-snapshot`, and `macro-resolve --execute`.
2. Add one minimal success example and one blocker example for each surface.
3. Document field-level backward compatibility rules (additive-only in v2).

### Files impacted
- `docs/AUTH_ANTI_BOT_BLOCKERS_IMPLEMENTATION_PLAN.md`
- `docs/AUTH_ANTI_BOT_BLOCKERS_REPORT.md`
- `docs/CLI.md`

### End goal
Every caller path has an unambiguous blocker contract reference.

### Acceptance criteria
- [ ] Canonical field placement is defined per surface.
- [ ] Examples cover `auth_required`, `anti_bot_challenge`, and `env_limited`.
- [ ] Additive-only compatibility rule is explicit.

---

## Task 2 — Deterministic Classifier Calibration Pass

### Reasoning
Operational drift appears when identical signals classify differently by mode.

### What to do
Calibrate classifier precedence/confidence so mode differences do not change blocker type semantics.

### How
1. Re-assert precedence order in runtime classification branches.
2. Normalize confidence thresholds for login redirect, challenge-title, and blocked-asset cases.
3. Add deterministic branch tests for edge combinations (status `200` + challenge title, `403` + no challenge title, asset host failures).

### Files impacted
- `src/providers/blocker.ts`
- `src/providers/index.ts`
- `src/browser/browser-manager.ts`
- `tests/providers-blocker.test.ts`
- `tests/providers-blocker-branches.test.ts`
- `tests/providers-runtime.test.ts`

### End goal
Classifier output is repeatable across runtime modes and call surfaces.

### Acceptance criteria
- [ ] Same evidence yields same blocker `type` and `retryable` result.
- [ ] Redirect to `/i/flow/login` resolves to `auth_required`.
- [ ] Challenge-title + recaptcha evidence resolves to `anti_bot_challenge`.

---

## Task 3 — Manual Resolution Loop Reliability

### Reasoning
Blocker metadata is only useful if operators can resolve and resume deterministically.

### What to do
Harden resolver state transitions for pause, verify, resume, and timeout.

### How
1. Validate `clear -> active -> resolving -> clear/active` transition behavior in session state.
2. Ensure verifier actions are deterministic (`goto`, `wait`, `debug-trace-snapshot` evidence checks).
3. Enforce timeout behavior with explicit `env_limited` or unresolved outcomes when verification cannot complete.

### Files impacted
- `src/browser/session-store.ts`
- `src/browser/browser-manager.ts`
- `src/cli/daemon-commands.ts`
- `tests/session-store.test.ts`
- `tests/daemon-commands.integration.test.ts`
- `tests/tools.test.ts`

### End goal
Manual login/challenge flows resume reliably from the same session context.

### Acceptance criteria
- [ ] FSM transition coverage includes timeout and verifier-fail branches.
- [ ] Session resume path preserves context and emits updated blocker state.
- [ ] No unresolved blocker is silently marked as cleared.

---

## Task 4 — Extension-Connected Validation Hardening

### Reasoning
Recent runs were `env_limited` for extension mode, leaving a validation blind spot.

### What to do
Add deterministic extension-connected validation steps and assertions in the live matrix workflow.

### How
1. Extend matrix preflight to assert extension handshake and routing readiness before extension test cases.
2. Mark extension unavailable states as explicit setup failures with actionable hints.
3. Capture mode-specific blocker evidence snapshots for extension, managed, and cdpConnect comparisons.

### Files impacted
- `scripts/live-regression-matrix.mjs`
- `docs/AUTH_ANTI_BOT_BLOCKERS_REPORT.md`
- `docs/CLI.md`

### End goal
Extension-path blocker behavior is validated with the same rigor as managed/cdp paths.

### Acceptance criteria
- [ ] Matrix produces explicit extension readiness diagnostics.
- [ ] Extension-mode blocker assertions are exercised in at least one connected run.
- [ ] Mode comparison evidence is documented in report output.

---

## Task 5 — Artifact Quality and Redaction Enforcement

### Reasoning
Resolver decisions depend on artifacts; noisy or unsafe artifacts degrade operator accuracy.

### What to do
Ensure blocker artifact bundles are bounded, redacted, and diagnostically useful.

### How
1. Re-validate artifact caps for network/console/exception slices and host list bounds.
2. Confirm redaction applies before serialization and before prompt-guard consumption.
3. Add tests for oversize/malicious content truncation and sanitized hint generation.

### Files impacted
- `src/tools/debug_trace_snapshot.ts`
- `src/providers/safety/prompt-guard.ts`
- `tests/devtools.test.ts`
- `tests/providers-prompt-guard.test.ts`
- `tests/tools.test.ts`

### End goal
Artifacts are safe by default and still sufficient for unblock decisions.

### Acceptance criteria
- [ ] No secret-bearing fields are emitted in blocker artifacts.
- [ ] Artifact/event limits are enforced deterministically.
- [ ] Sanitized evidence remains actionable in blocker hints.

---

## Task 6 — Cross-Surface Parity and Failure Semantics

### Reasoning
Operators use mixed invoke paths; mismatched blocker behavior increases triage time.

### What to do
Verify blocker parity across tool, CLI, and daemon responses and preserve failure semantics.

### How
1. Add explicit parity assertions for `meta.blocker` placement and shape in each surface.
2. Validate macro execute-mode failures carry blocker metadata when available.
3. Ensure non-blocker paths remain unchanged and backward-compatible.

### Files impacted
- `src/tools/macro_resolve.ts`
- `src/cli/commands/macro-resolve.ts`
- `src/cli/daemon-commands.ts`
- `tests/macro-resolve.test.ts`
- `tests/parity-matrix.test.ts`
- `tests/daemon-commands.integration.test.ts`

### End goal
Tool/CLI/daemon users get equivalent blocker semantics for equivalent runs.

### Acceptance criteria
- [ ] Field shape parity checks pass across all invoke paths.
- [ ] Existing non-blocker outputs are unchanged.
- [ ] Macro failure outputs remain structured and additive.

---

## Task 7 — Release Gate Verification and Evidence Packaging

### Reasoning
A blocker feature without verified release evidence is high-risk to ship.

### What to do
Run and document full quality gates plus live blocker evidence required for release sign-off.

### How
1. Run: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test`.
2. Run live matrix and capture blocker-specific evidence summary.
3. Record final pass/env-limited/fail counts and attach short release-ready findings.

### Files impacted
- `docs/AUTH_ANTI_BOT_BLOCKERS_REPORT.md`
- `docs/CLI.md`
- `CONTINUITY.md` (local-only ledger)

### End goal
Release decision has objective quality and live-behavior evidence.

### Acceptance criteria
- [ ] Quality gates are green.
- [ ] Live matrix results are documented with blocker evidence deltas.
- [ ] Remaining environment limitations are clearly separated from product defects.

---

## Task 8 — Rollout Sequence and Contingency Plan

### Reasoning
Shipping blocker workflows without rollback criteria increases operational risk.

### What to do
Define rollout sequencing, ownership handoff, and rollback triggers for blocker changes.

### How
1. Publish ordered rollout steps (dev validation -> pre-release live run -> release).
2. Define rollback triggers (contract drift, parity regression, unexpected blocker inflation).
3. Add operator triage checklist for unresolved blockers (`resolved | unresolved | deferred` outcomes).

### Files impacted
- `docs/AUTH_ANTI_BOT_BLOCKERS_IMPLEMENTATION_PLAN.md`
- `docs/AUTH_ANTI_BOT_BLOCKERS_REPORT.md`
- `docs/CLI.md`

### End goal
Blocker features ship with clear execution order and safe fallback path.

### Acceptance criteria
- [ ] Rollout stages and owners are explicit.
- [ ] Rollback triggers are concrete and testable.
- [ ] Triage checklist is usable without code-level knowledge.

---

## File-by-file implementation sequence

1. `docs/AUTH_ANTI_BOT_BLOCKERS_IMPLEMENTATION_PLAN.md` — lock v2 contract, tasks, rollout criteria.
2. `src/providers/blocker.ts` — classifier calibration and precedence hardening.
3. `src/providers/index.ts` — runtime mapping normalization and additive payload behavior.
4. `src/browser/session-store.ts` — resolver FSM reliability.
5. `src/browser/browser-manager.ts` — verifier evidence and mode-aware blocker consistency.
6. `src/tools/debug_trace_snapshot.ts` — artifact/redaction enforcement.
7. `src/tools/macro_resolve.ts` — execute-mode blocker parity.
8. `src/cli/commands/macro-resolve.ts` — CLI parity.
9. `src/cli/daemon-commands.ts` — daemon parity and resume semantics.
10. `scripts/live-regression-matrix.mjs` — extension-connected readiness and evidence assertions.
11. `tests/providers-blocker.test.ts` — classifier behavior coverage.
12. `tests/providers-blocker-branches.test.ts` — classifier edge-branch coverage.
13. `tests/session-store.test.ts` — resolver transition coverage.
14. `tests/tools.test.ts` — tool payload and artifact coverage.
15. `tests/parity-matrix.test.ts` — tool/CLI/daemon placement parity.
16. `tests/macro-resolve.test.ts` — execute-mode parity and failure semantics.
17. `tests/daemon-commands.integration.test.ts` — daemon path reliability.
18. `docs/AUTH_ANTI_BOT_BLOCKERS_REPORT.md` — release evidence summary updates.
19. `docs/CLI.md` — operator-facing payload and runbook examples.

---

## Dependencies to add

Task and subtask dependency mapping:
- Tasks 1 and 2 must complete before Tasks 3, 5, and 6.
- Task 3 depends on Task 2 output stability.
- Task 4 can run in parallel with Tasks 2 and 3 but must finish before Task 7 evidence packaging.
- Tasks 5 and 6 should complete before Task 7.
- Task 8 depends on Tasks 4, 6, and 7 completion.

| Package | Version | Purpose |
|---|---|---|
| None | N/A | v2 uses existing runtime, test, and documentation stack |

---

## Version history

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-02-14 | Initial blocker implementation plan (contract, classifier, FSM, artifact, parity, docs). |
| 2.0 | 2026-02-14 | Second implementation plan focused on calibration, extension validation hardening, release gates, and rollout contingencies. |
