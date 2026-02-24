# DOM Ref Resolution and Profile Lock Hardening Spec

Spec for hardening ref-based DOM operations and launch profile handling without destabilizing `/ops` command behavior.

---

## Overview

### Context and scope
- Current ref resolution stores both `selector` and `backendNodeId` in snapshot entries.
- Managed mode operations currently execute against `locator(selector)`.
- `/ops` mode currently executes selector-based actions in extension DOM bridge (`document.querySelector`).
- Reported bug is valid: selector collisions trigger strict-mode failures in managed mode when selectors are not unique.
- Profile lock failures are valid and reproducible when launching concurrent sessions with the same persisted profile.

### Verification evidence (local)
- Managed strict-mode repro confirmed on 2026-02-22:
  - `dom-value` and `dom-attr` fail with duplicate `aria-label` selectors (`locator('[aria-label="search"]') resolved to 2 elements`).
- Profile-lock repro confirmed on 2026-02-22:
  - second concurrent launch on the same persisted profile fails with ProcessSingleton/`SingletonLock` errors.
- `/ops` behavior note from code audit:
  - `/ops` DOM bridge uses `document.querySelector`, which returns first match; duplicate selectors can silently target the wrong element even when no strict-mode exception is raised.

### Key decisions
- Preserve `/ops` wire protocol and command names; no breaking envelope changes.
- Use a phased fix:
  - Phase A: selector uniqueness hardening in snapshot selector generation (managed + `/ops` snapshot builders).
  - Phase B: managed-only backend-node resolution for DOM state commands (`domGetAttr`, `domGetValue`, `domIsVisible`, `domIsEnabled`, `domIsChecked`).
  - Phase C (optional): broader backend-node migration for interaction commands after parity validation.
- Do not implement aggressive automatic lock deletion. Add safe diagnostics and explicit fallback guidance first.

### External research summary (primary sources)
- Playwright locators are strict and throw when multiple elements match; using `.first()`/`.nth()` is documented but not recommended for robustness.
- Playwright persistent contexts do not support multiple browser instances for one `userDataDir`.
- CDP `DOM.resolveNode` resolves by `NodeId` or `BackendNodeId`; `BackendNodeId` is designed for nodes not pushed to frontend mirrors.
- CDP `DOM.documentUpdated` invalidates `NodeId` (inference: backend-node-driven flows still require stale-reference handling after navigation).
- Chromium ProcessSingleton semantics are designed to avoid profile corruption when multiple instances target one profile.

References:
- [Playwright Locator strictness](https://playwright.dev/docs/locators)
- [Playwright launchPersistentContext](https://playwright.dev/docs/api/class-browsertype)
- [CDP DOM.resolveNode](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-resolveNode)
- [CDP DOM.documentUpdated](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#event-documentUpdated)
- [Chromium ProcessSingleton (POSIX)](https://chromium.googlesource.com/chromium/src/%2B/HEAD/chrome/browser/process_singleton_posix.cc)

---

## Task 1 — Contract and Invariant Baseline

### Reasoning
We need explicit boundaries before touching ref resolution so `/ops` and non-`/ops` behavior remains stable and reviewable.

### What to do
Define hard invariants for command contracts, lease ownership, and backward compatibility.

### How
1. Capture current invariants for `/ops`:
   - Command names remain unchanged.
   - `OpsRequest`/`OpsResponse`/`OpsErrorResponse` envelope schema remains unchanged.
   - Lease ownership checks remain mandatory (`opsSessionId` + `leaseId`).
2. Document allowed change surface:
   - Internal ref resolution logic.
   - Optional additive fields in payloads only (never required).
3. Add a no-regression checklist to this spec for reviewers and QA.

### Files impacted
- `docs/DOM_REF_RESOLUTION_AND_PROFILE_LOCK_HARDENING_SPEC.md`
- `docs/SURFACE_REFERENCE.md` (only if public contract text changes)

### End goal
A fixed contract boundary that prevents accidental `/ops` protocol drift.

### Acceptance criteria
- [ ] Spec lists immutable `/ops` contracts and mutable internals.
- [ ] No planned step requires protocol version bump.
- [ ] Lease ownership behavior remains unchanged in all paths.

---

## Task 2 — Phase A: Selector Uniqueness Hardening (Managed + `/ops`)

### Reasoning
The fastest low-risk mitigation is to avoid generating ambiguous selectors in snapshots. This reduces breakage across both managed and `/ops` modes without changing command contracts.

### What to do
Adjust selector generation to return `data-testid`/`aria-label` selectors only when unique in the current document; otherwise fall back to deterministic DOM path selector.

### How
1. Update selector generation in managed snapshot builder.
2. Mirror the same logic in extension `/ops` snapshot builder to preserve parity.
3. Keep existing ref payload shape (`ref`, `selector`, `backendNodeId`, ...).
4. Add tests for duplicate `aria-label` and duplicate `data-testid` collisions.

### Files impacted
- `src/snapshot/ops-snapshot.ts`
- `extension/src/ops/snapshot-shared.ts`
- `tests/browser-manager.test.ts`
- `tests/snapshotter.test.ts`
- `tests/ops-runtime.test.ts` (if needed for parity coverage)

### End goal
Generated refs use stable unique selectors more consistently, reducing strict-mode collisions.

### Acceptance criteria
- [ ] Duplicate `aria-label` test case no longer causes strict-mode errors in managed mode for existing commands.
- [ ] `/ops` snapshots produce consistent selector strategy with managed snapshots.
- [ ] Existing snapshot payload fields remain unchanged.

---

## Task 3 — Phase B: Managed Backend-Node Resolution for DOM State Commands

### Reasoning
The proposed fix targets DOM state tools specifically. Using `backendNodeId` for these commands increases targeting precision and decouples them from selector fragility.

### What to do
Implement managed-mode backend-node-based execution for DOM state commands with safe fallback to selector path.

### How
1. Add internal helper in `BrowserManager`:
   - Resolve `ref` to entry (`selector`, `backendNodeId`).
   - Open CDP session and call `DOM.resolveNode` by `backendNodeId`.
   - Execute state reads via `Runtime.callFunctionOn`.
2. If node resolution fails (stale ref, navigation), return canonical `Unknown ref/stale snapshot` error and require new snapshot.
3. Keep public tool/CLI responses unchanged (`{ value: ... }`).
4. Do not change command names or daemon command routing.

### Files impacted
- `src/browser/browser-manager.ts`
- `src/browser/manager-types.ts` (only if helper typing requires)
- `tests/browser-manager.test.ts`
- `tests/tools.test.ts` (only if behavior envelope assertions need updates)

### End goal
DOM state commands in managed mode no longer depend on potentially ambiguous selectors.

### Acceptance criteria
- [ ] `domGetAttr`, `domGetValue`, `domIsVisible`, `domIsEnabled`, `domIsChecked` pass duplicate-selector fixtures.
- [ ] Response shape remains unchanged across tool + CLI surfaces.
- [ ] Stale-ref behavior is deterministic and documented.

---

## Task 4 — Phase C (Optional): Interaction Command Backend Migration

### Reasoning
Local validation shows collisions also affect `click`, `hover`, and `type`. If we stop at DOM state tools only, user-facing flakiness remains.

### What to do
Evaluate whether to migrate interaction commands to backend-node execution or keep selector path with stronger uniqueness guarantees.

### How
1. Build comparison matrix:
   - Selector path + uniqueness hardening.
   - Backend-node action execution.
2. Benchmark complexity/risk, especially for text input and checkbox semantics.
3. Implement only if parity and reliability gains justify complexity.

### Files impacted
- `src/browser/browser-manager.ts`
- `tests/browser-manager.test.ts`
- `tests/parity-matrix.test.ts` (if behavior coverage gaps found)

### End goal
A deliberate decision on full migration versus hardened selectors, with evidence.

### Acceptance criteria
- [ ] Decision record includes measured tradeoffs.
- [ ] No hidden regressions in interaction behavior.
- [ ] `/ops` parity impact is explicitly assessed.

---

## Task 5 — Profile Lock Handling Hardening

### Reasoning
Profile lock errors are expected under concurrent profile use; unsafe cleanup can corrupt profiles. We need diagnostics and safe behavior first.

### What to do
Improve lock error handling and workflow guidance; add stale-lock cleanup only behind strict safety checks.

### How
1. Detect lock-specific launch errors and emit precise guidance:
   - active profile in use
   - suggest unique profile or non-persistent profile
2. For stale-lock cleanup, support only guarded path:
   - validate lock owner is not alive
   - remove lock artifacts only when safe
3. Update live matrix scripts to use unique profile names by default to avoid false negatives.

### Files impacted
- `src/browser/browser-manager.ts`
- `src/cli/daemon-commands.ts`
- `scripts/live-regression-matrix.mjs`
- `tests/browser-manager.test.ts`

### End goal
Fewer false failures, clearer remediation, and no unsafe profile mutation by default.

### Acceptance criteria
- [ ] Lock error messages differentiate concurrent-use vs stale-lock scenarios.
- [ ] Matrix runs avoid profile-collision failures by default.
- [ ] No automatic destructive cleanup without safety verification.

---

## Task 6 — `/ops` Safety Validation Matrix

### Reasoning
The user requirement is explicit: be careful with `/ops` operations. The spec must include dedicated `/ops` validation gates, not only managed-mode tests.

### What to do
Run a dedicated `/ops` regression matrix that verifies protocol, ownership, and DOM behavior stability.

### How
1. Validate `/ops` command contract unchanged:
   - `ops_hello`, `ops_request`, `ops_response`, `ops_error`, `ops_event`, `ops_chunk`.
2. Validate lease enforcement remains strict across command execution.
3. Validate DOM command behavior for duplicate selector pages in `/ops` mode.
4. Validate `/ops` + `/cdp` coexistence and `cdp_attach_blocked` invariants.

### Files impacted
- `tests/ops-browser-manager.test.ts`
- `tests/relay-server.test.ts`
- `tests/parity-matrix.test.ts`
- `docs/SURFACE_REFERENCE.md` (if matrix reveals contract drift)

### End goal
Evidence that selector/profile hardening does not destabilize `/ops` transport or ownership guarantees.

### Acceptance criteria
- [ ] `/ops` protocol envelopes unchanged.
- [ ] Lease ownership tests still pass.
- [ ] `/ops` DOM commands remain deterministic on duplicate-selector fixtures.
- [ ] `/cdp` attach blocking for ops-owned targets remains intact.

---

## Critical Review (Research-Backed)

### Critique of the original proposal
- Original proposal: “switch DOM state tools to `backendNodeId`.”
- Issue 1: too narrow. Local repro shows interaction commands fail on the same selector collision class.
- Issue 2: `/ops` is selector-based through extension DOM bridge and first-match semantics (`querySelector`). A managed-only backend-node fix improves only part of the surface and leaves `/ops` mis-target risk.
- Issue 3: profile “automatic lock cleanup” is risky; Chromium explicitly guards this path to avoid profile corruption.

### Option analysis

#### Option A: Managed-only backend-node fix for DOM state tools (as originally proposed)
- Pros:
  - Precise targeting for requested commands.
  - Minimal protocol impact.
- Cons:
  - Leaves interaction collisions unresolved.
  - Creates semantics gap with `/ops` mode.
- Verdict:
  - Necessary but insufficient as standalone fix.

#### Option B: Immediate full backend-node migration across managed + `/ops`
- Pros:
  - Strong precision across commands.
- Cons:
  - High complexity and risk in extension `/ops` runtime.
  - Higher chance of protocol/ownership regressions.
- Verdict:
  - Not recommended as first move.

#### Option C: Hybrid phased approach (recommended)
- Phase A: selector uniqueness hardening in both snapshot builders.
- Phase B: managed backend-node resolution for DOM state commands.
- Phase C: optional broader interaction migration with explicit parity data.
- Pros:
  - Fast reliability win.
  - Preserves `/ops` contract safety.
  - Allows measured adoption of backend-node precision.
- Cons:
  - Transitional architecture with mixed resolution strategies.
- Verdict:
  - Best risk-adjusted path.

### `/ops`-specific risks and controls
- Risk: changing payload requirements (breaking clients).
  - Control: additive-only optional fields; do not require new payload keys.
- Risk: lease bypass during refactor.
  - Control: keep existing lease enforcement untouched; add explicit tests.
- Risk: hidden behavior divergence between managed and `/ops`.
  - Control: parity matrix for duplicate-selector fixtures and session ownership.

### Inference notes
- CDP docs explicitly invalidate `NodeId` on full document update. Backend-node handling still requires stale-reference guards after navigation. This is an inference based on documented DOM lifecycle behavior and observed runtime invalidation patterns.

---

## File-by-file implementation sequence

1. `src/snapshot/ops-snapshot.ts` — Phase A selector uniqueness hardening (managed).
2. `extension/src/ops/snapshot-shared.ts` — Phase A parity hardening (`/ops`).
3. `src/browser/browser-manager.ts` — Phase B backend-node execution for DOM state commands.
4. `src/cli/daemon-commands.ts` — improve lock error diagnostics only (no contract changes).
5. `scripts/live-regression-matrix.mjs` — unique profile defaults for matrix stability.
6. `tests/browser-manager.test.ts` — duplicate-selector and stale-ref coverage.
7. `tests/ops-browser-manager.test.ts` and `tests/relay-server.test.ts` — `/ops` invariants.
8. `tests/parity-matrix.test.ts` — cross-surface parity assertions.

---

## Task dependency map

- Task 1 is prerequisite for all tasks.
- Task 2 is prerequisite for Task 4 (interaction migration decision).
- Task 3 can run after Task 2 and in parallel with Task 5.
- Task 6 depends on Tasks 2, 3, and 5.

Connection summary:
- Task 2 reduces immediate selector risk across both channels.
- Task 3 adds precision where requested in the original proposal.
- Task 5 prevents lock-related flake without unsafe profile mutation.
- Task 6 is the release gate proving `/ops` remains stable.

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| None | N/A | Existing Playwright/CDP stack is sufficient. |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-22 | Initial spec with phased plan + research-backed critique and `/ops` guardrails |
| 1.1 | 2026-02-22 | Added local verification evidence and explicit `/ops` first-match risk note |
| 1.2 | 2026-02-22 | Implemented Phases A/B + profile-lock diagnostics, added regression coverage, and validated full quality gates |

---

## Implementation Status (2026-02-22)

Completed in code and tests:
- Task 1 contract boundary preserved (no `/ops` envelope or command-surface changes).
- Task 2 selector uniqueness hardening in managed + `/ops` snapshot selector builders.
- Task 3 managed backend-node resolution for DOM state commands with deterministic stale-ref handling and selector fallback for non-stale backend failures.
- Task 5 profile-lock diagnostics hardening and unique-profile defaults in live regression matrix script.

Validation evidence:
- Quality gates passed: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run extension:build`, `npm run test`.
- Coverage gate passed with branches at `97.01%` (threshold `97%`).
- Added regression/stability tests in:
  - `tests/browser-manager.test.ts`
  - `tests/snapshotter.test.ts`
  - `tests/relay-server.test.ts`

Remaining:
- Task 4 remains optional and is not required for current hardening closure.
- Task 6 remains continuously enforced by existing `/ops` and relay suites; no protocol changes were introduced.
