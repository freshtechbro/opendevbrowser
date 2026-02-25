# Multi-Tab Parallel Operations Spec

Concrete technical spec for reliable multi-tab parallel operations across OpenDevBrowser modes with strict DRY boundaries, memory-aware throughput control, and progressive documentation anti-drift gates.

---

## Overview

### Scope
- Deliver one parallel-execution model for:
  - `managed` (headed and headless)
  - `cdpConnect` (headed and headless)
  - `extension` via `/ops` (headed)
  - `extension` legacy via `/cdp` (headed compatibility mode)
- Explicit support boundary:
  - extension headless is **not supported** in this rollout; attempts must fail with explicit `unsupported_mode`.
- Define a single parity contract across tool API, CLI, and daemon RPC surfaces.
- Add adaptive memory governance to control how many tabs can run in parallel at any moment.
- Add phase-end documentation sweeps to prevent docs/architecture/frontend/AGENTS drift.

### Out of scope
- Feature flags, phased release toggles, backward-compat shims.
- New transport channels or bespoke schedulers per mode.
- Parallel throughput guarantees for legacy `/cdp` (kept sequential by design).

### Current behavior (code-verified)
- `BrowserManager` serializes many target operations through session-level mutex use.
  - Evidence: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/browser-manager.ts:170`
  - Evidence: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/browser-manager.ts:951`
- `OpsRuntime` serializes all session commands through one session queue.
  - Evidence: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-runtime.ts:1079`
- Relay supports multiple `/ops` clients but single `/cdp` client.
  - Evidence: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/relay/relay-server.ts:171`
  - Evidence: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/relay/relay-server.ts:138`
- `/cdp` attach is blocked for ops-owned targets.
  - Evidence: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/relay/relay-server.ts:779`

### Design goals
- Deterministic ordering on same target.
- Isolated execution across targets/tabs.
- Adaptive throughput under memory pressure.
- Explicit mode parity contract with declared divergences only.
- Progressive docs alignment after every phase.

### Key decisions
- Primary extension concurrency surface remains `/ops`.
- Legacy `/cdp` remains compatibility-only and sequential.
- Introduce one concurrency key: `ExecutionKey = (sessionId, targetId)`.
- Introduce one governor for all parallel-capable modes: `ParallelismGovernor`.
- Add a declared-divergence registry to prevent accidental behavior drift.

---

## External Research Summary (Primary Sources)

- Chrome extension service workers can be suspended when idle; parallel runtime must be reconnect-safe and idempotent.
  - Source: [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Chrome Tabs API exposes `discarded`, `frozen`, and `autoDiscardable`, which are useful memory-pressure signals and breakpoint triggers.
  - Source: [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- CDP `Performance.getMetrics` can provide per-target runtime metrics for adaptive decisions.
  - Source: [CDP Performance domain](https://chromedevtools.github.io/devtools-protocol/tot/Performance/)
- CDP Target flat sessions and detach semantics require robust multi-session detach handling.
  - Source: [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/)
- DOM document updates invalidate node identities, so stale refs must be refreshed/retried.
  - Source: [CDP DOM.documentUpdated](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#event-documentUpdated)
- Playwright warns against parallel persistent profile reuse (`userDataDir` collisions).
  - Source: [Playwright launchPersistentContext](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- Node provides process RSS and heap metrics for host/process pressure estimation.
  - Source: [Node process.memoryUsage](https://nodejs.org/api/process.html#processmemoryusage)
  - Source: [Node process.memoryUsage.rss](https://nodejs.org/api/process.html#processmemoryusagerss)

---

## Architecture Proposal

### Unified concurrency contract
- `TargetScoped` commands queue by `(sessionId,targetId)`:
  - `goto`, `snapshot`, `click`, `hover`, `press`, `type`, `check`, `uncheck`, `scrollIntoView`, `screenshot`, export capture, devtools polls.
- `SessionStructural` commands queue by `sessionId` only:
  - connect/disconnect, new target/tab, close target/tab, target selection/list, session lease operations.
- Rule:
  - Same target: strict FIFO.
  - Different targets in same session: parallel up to `effectiveParallelCap`.

### Parallelism governor (DRY shared policy)
- Single policy implementation used by:
  - Node side (`BrowserManager` path)
  - Extension `/ops` runtime path
- Legacy `/cdp` bypasses governor and stays fixed at cap `1`.

#### Governance inputs
- Host pressure:
  - `os.freemem()/os.totalmem()` (Node host-level pressure proxy)
- Process pressure:
  - `process.memoryUsage.rss()` with configurable soft/hard budgets
- Runtime pressure:
  - target queue depth and queue age
- Extension tab lifecycle pressure:
  - `discarded` / `frozen` signal incidence from tab events

#### Effective cap model
- `effectiveParallelCap = clamp(floor, staticCap, staticCap - penalties + recoveries)`
- Penalties are additive and conservative:
  - medium pressure reduces cap by `1`
  - high pressure reduces by `2`
  - critical pressure clamps to floor
- Hysteresis:
  - cap can reduce immediately
  - cap increases only after stable window (default 30s) to avoid oscillation

#### Deterministic thresholds (initial policy constants)
| Policy key | Default | Rule |
|---|---:|---|
| `sampleIntervalMs` | 2000 | evaluate governor every 2s |
| `recoveryStableWindows` | 3 | require 3 consecutive healthy windows before cap increase |
| `hostFreeMemMediumPct` | 25 | medium pressure when free memory falls below this |
| `hostFreeMemHighPct` | 18 | high pressure when free memory falls below this |
| `hostFreeMemCriticalPct` | 10 | critical pressure when free memory falls below this |
| `rssSoftPct` | 65 | medium pressure when process RSS exceeds this % of configured budget |
| `rssHighPct` | 75 | high pressure when process RSS exceeds this % of configured budget |
| `rssCriticalPct` | 85 | critical pressure when process RSS exceeds this % of configured budget |
| `queueAgeHighMs` | 2000 | high queue penalty threshold |
| `queueAgeCriticalMs` | 5000 | critical queue penalty threshold |

Policy source of truth:
- one canonical policy schema/default in `src/config.ts`;
- extension `/ops` runtime consumes resolved policy from runtime/session payload, not duplicated constants.

#### Default mode caps (initial rollout)
| Mode variant | Floor | Static cap | Notes |
|---|---:|---:|---|
| managed headed | 1 | 6 | full parity target |
| managed headless | 1 | 8 | full parity target |
| cdpConnect headed | 1 | 6 | full parity target |
| cdpConnect headless | 1 | 8 | full parity target |
| extension `/ops` headed | 1 | 6 | service-worker lifecycle constraints apply |
| extension legacy `/cdp` headed | 1 | 1 | explicit sequential compatibility |

#### Backpressure semantics
- If `inFlight >= effectiveParallelCap`:
  - queue request with bounded wait timeout
  - if timeout expires: return structured `parallelism_backpressure` error with telemetry payload
- Backpressure envelope is normalized across tool/CLI/daemon surfaces.

### Parity and anti-drift contract
- Canonical normalized result schema for matrix comparison:
  - required comparator fields:
    - `mode`, `surface`, `command`, `status`, `error.code`, `error.class`, `targetId`, `blockerMeta`.
  - optional diagnostic fields (non-blocking unless explicitly asserted by scenario):
    - `latencyMs`, `artifactHashes`.
- Mode/surface-specific fields can exist but are excluded from comparator unless declared.
- Visual-only artifacts are excluded from strict parity by default and must be scenario-opted-in.
- Declared divergence policy:
  - all known intentional divergences must be listed in `docs/PARITY_DECLARED_DIVERGENCES.md`.
  - any new comparator mismatch without declaration fails parity gate.

---

## Phase Plan

### Phase 1: Contract and safe throughput
- Freeze concurrency + parity contract.
- Ship session-per-tab operational baseline.
- Introduce governor scaffolding with read-only telemetry.
- Run documentation sweep.

### Phase 2: Target-scoped runtime execution
- Implement target-aware API path.
- Replace session locks/queues with target-scoped schedulers.
- Enable governor enforcement.
- Run documentation sweep.

### Phase 3: Parity hardening and anti-drift automation
- Add normalized parity harness and declared divergence enforcement.
- Expand matrix + soak + memory pressure drills.
- Run documentation sweep.

### Phase 4: Release hardening
- Close residual breakpoint failures.
- Final docs/frontend sync pass and release notes.

---

## Task 1 — Freeze Concurrency + Parity Contract

### Reasoning
Without one contract, each mode drifts under incremental fixes.

### What to do
Document one canonical contract for command classes, queueing semantics, and parity expectations.

### How
1. Add contract section in `docs/ARCHITECTURE.md` and cross-link this spec.
2. Annotate command taxonomy in `docs/SURFACE_REFERENCE.md`.
3. Add explicit parity scope notes in `docs/CLI.md` and `docs/EXTENSION.md`.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/ARCHITECTURE.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/SURFACE_REFERENCE.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CLI.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/EXTENSION.md`

### End goal
All surfaces implement against one deterministic contract.

### Acceptance criteria
- [ ] Contract exists in one canonical section and is cross-referenced.
- [ ] Command taxonomy is consistent across docs.
- [ ] Legacy `/cdp` divergence is explicit and consistent.

---

## Task 2 — Implement Memory-Aware Parallelism Governor

### Reasoning
Unbounded parallel tabs degrade stability and can crash/suspend runtime under memory pressure.

### What to do
Implement a shared `ParallelismGovernor` that computes `effectiveParallelCap` from memory/queue pressure.

### How
1. Define governor policy schema/defaults once in `src/config.ts` and expose typed contract from `src/core/types.ts`.
2. Collect host/process pressure metrics in Node runtime.
3. Pass resolved governor policy through relay/runtime session bootstrap so extension `/ops` consumes the same policy values.
4. Collect extension tab lifecycle pressure signals (`discarded`, `frozen`) where available.
5. Enforce cap + bounded wait + normalized `parallelism_backpressure` error.
6. Apply deterministic hysteresis/recovery rules from the policy table.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/core/types.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/config.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/relay/protocol.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/browser-manager.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-runtime.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/tools/workflow-runtime.ts`

### End goal
Parallelism scales safely and predictably under changing memory pressure.

### Acceptance criteria
- [ ] Cap reduces under medium/high/critical pressure and recovers with hysteresis.
- [ ] For the same mode policy and pressure class, computed cap transitions are deterministic and equal across Node and `/ops`.
- [ ] Backpressure error envelope is parity-consistent across tool/CLI/daemon.
- [ ] Legacy `/cdp` remains fixed cap `1`.

---

## Task 3 — Interim Throughput: Session-Per-Tab Baseline

### Reasoning
Safe immediate throughput gains are needed before full in-session scheduler refactor.

### What to do
Standardize one-worker-one-session guidance for concurrent multitab workflows.

### How
1. Update CLI/tool examples to avoid concurrent `targets.use` ping-pong.
2. Add troubleshooting guidance for crosstalk symptoms.
3. Update matrix script examples to show session isolation pattern.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CLI.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/TROUBLESHOOTING.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/scripts/live-regression-matrix.mjs`

### End goal
Teams can run safe parallel tab workflows immediately with current runtime.

### Acceptance criteria
- [ ] Official docs/examples use session-per-tab for parallel workloads.
- [ ] Matrix script emits session isolation evidence.
- [ ] Troubleshooting includes crosstalk diagnosis and remediation.

---

## Task 4 — Add Target-Aware Manager API

### Reasoning
Implicit active-target state is the core source of cross-tab races.

### What to do
Move `TargetScoped` execution to explicit `targetId` routing.

### How
1. Extend manager interfaces with target-explicit methods.
2. Route tool/CLI/daemon calls through target-explicit path.
3. Keep active-target state only as ergonomic fallback, not correctness dependency.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/manager-types.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/browser-manager.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/ops-browser-manager.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/remote-manager.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/daemon-commands.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/tools/index.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/tools/workflow-runtime.ts`

### End goal
Target identity, not mutable active state, controls execution routing.

### Acceptance criteria
- [ ] `TargetScoped` commands can run without prior `targets.use`.
- [ ] No duplicated old/new codepaths remain.
- [ ] Active-target helper path does not affect correctness under concurrency.

---

## Task 5 — Node Scheduler: Session Mutex to Target Queues

### Reasoning
Session-level mutex blocks independent target parallelism.

### What to do
Replace broad per-session locking with target-scoped scheduling plus lightweight structural lock.

### How
1. Introduce target queue map keyed by `(sessionId,targetId)`.
2. Keep small session structural lock for target list mutations.
3. Cleanup queue state on target/session teardown.
4. Plug governor cap checks into queue admission.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/browser-manager.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/target-manager.ts`

### End goal
Different targets within one session progress in parallel safely.

### Acceptance criteria
- [ ] Same target commands remain FIFO.
- [ ] Different target commands can run concurrently up to effective cap.
- [ ] Queue/lock maps are fully cleaned up on teardown.

---

## Task 6 — `/ops` Scheduler: Single Queue to Target Queues

### Reasoning
`OpsRuntime` session-wide queue currently serializes all tab work.

### What to do
Implement target-scoped `/ops` scheduling with unchanged ownership invariants.

### How
1. Add per-target queue state to ops session store.
2. Route `TargetScoped` commands by explicit target identity.
3. Keep lease/owner checks unchanged before execution.
4. Integrate governor admission and backpressure envelope.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-session-store.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-runtime.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/dom-bridge.ts`

### End goal
`/ops` supports true in-session multi-target parallelism without lease bleed.

### Acceptance criteria
- [ ] Distinct targets run concurrently in one ops session.
- [ ] Lease mismatch still returns `not_owner`.
- [ ] `ops_session_*` lifecycle events stay accurate under load.

---

## Task 7 — Parity Harness + Declared Divergence Gate

### Reasoning
Without explicit comparator and divergence registry, drift reappears silently.

### What to do
Add normalized parity harness across mode/surface combinations and gate unknown divergences.

### How
1. Add normalized parity comparator utility.
2. Add declared divergence registry and validator.
3. Wire matrix tests to fail on undeclared mismatch.
4. Emit parity report artifact for release review.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/parity-matrix.test.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/daemon-commands.integration.test.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/scripts/live-regression-matrix.mjs`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/PARITY_DECLARED_DIVERGENCES.md` (new file)

### End goal
Parity drift is blocked by tests, not discovered after release.

### Acceptance criteria
- [ ] Comparator covers tool/CLI/daemon normalized outputs.
- [ ] All intentional divergences are documented in one registry.
- [ ] Undeclared mismatch fails CI/matrix gate.

---

## Task 8 — Legacy `/cdp` Compatibility Guardrails

### Reasoning
Legacy `/cdp` is intentionally constrained and must be explicit to users.

### What to do
Codify sequential-only behavior and warnings for legacy extension `/cdp`.

### How
1. Keep single-client `/cdp` behavior and diagnostics.
2. Add runtime warning for parallel anti-patterns in legacy mode.
3. Keep `/ops` default route and explicit legacy opt-in.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/relay/relay-server.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/daemon-commands.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CLI.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/TROUBLESHOOTING.md`

### End goal
Legacy mode remains usable but predictable and bounded.

### Acceptance criteria
- [ ] Sequential-only behavior is documented and test-covered.
- [ ] Second `/cdp` client rejection remains explicit.
- [ ] Mixed `/ops` + `/cdp` attach boundary remains enforced.

---

## Task 9 — Progressive Documentation Sweep After Each Phase

### Reasoning
Implementation quality regresses quickly when docs are updated only at the end.

### What to do
Run mandatory documentation alignment sweep at the end of every phase.

### How
1. Execute this task separately for every phase (`P1`, `P2`, `P3`, `P4`) before phase closure.
2. Update core docs based on changed behavior/surfaces:
   - `README.md`
   - `docs/ARCHITECTURE.md`
   - `docs/CLI.md`
   - `docs/SURFACE_REFERENCE.md`
   - `docs/EXTENSION.md`
   - `docs/TROUBLESHOOTING.md`
   - `docs/FRONTEND.md`
3. Review and update nested guidance files if behavior/contracts changed:
   - `AGENTS.md`, `docs/AGENTS.md`, `src/AGENTS.md`, `src/cli/AGENTS.md`, `src/relay/AGENTS.md`, `src/tools/AGENTS.md`, `extension/AGENTS.md`, `extension/src/ops/AGENTS.md`, `extension/src/services/AGENTS.md`, `frontend/AGENTS.md`, `frontend/src/AGENTS.md`
4. Regenerate frontend documentation artifacts:
   - `cd frontend && npm run sync:assets`
   - `cd frontend && npm run generate:docs`
   - `cd frontend && npm run lint && npm run typecheck && npm run build`
5. Run docs drift validation tests and link checks.
6. Record phase-level doc sweep completion in version history/release notes.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/README.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/ARCHITECTURE.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CLI.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/SURFACE_REFERENCE.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/EXTENSION.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/TROUBLESHOOTING.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/FRONTEND.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/relay/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/tools/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/frontend/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/frontend/src/AGENTS.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/frontend/scripts/generate-docs.mjs`

### End goal
Documentation remains phase-synchronized with runtime truth.

### Acceptance criteria
- [ ] Required docs list updated after each phase.
- [ ] Frontend docs are regenerated from source, not hand-edited.
- [ ] Nested AGENTS guidance reflects changed contracts/surfaces.
- [ ] Docs drift tests/link checks pass before moving to next phase.

---

## Task 10 — Full Regression Matrix + Release Gates

### Reasoning
Concurrency issues appear first in churn and pressure scenarios; release must be evidence-based.

### What to do
Ship deterministic matrix and soak gates covering functional parity, memory governance, and lifecycle edge cases.

### How
1. Implement/expand matrix scenarios from section below.
2. Add memory-pressure drill tests and cap transition assertions.
3. Add 30-60 minute soak suites with queue leak and orphan session checks.
4. Add policy-parity fixture: same synthetic pressure profile must produce identical cap transitions in Node and `/ops`.
5. Enforce full quality gate and parity gate before release.

### Files impacted
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/browser-manager.test.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/ops-browser-manager.test.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-ops-runtime.test.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/relay-server.test.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/parity-matrix.test.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/daemon-commands.integration.test.ts`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/scripts/live-regression-matrix.mjs`

### End goal
Parallel operations are stable, memory-safe, and parity-guarded across supported modes.

### Acceptance criteria
- [ ] Deterministic matrix scenarios are green; `env_limited` does not satisfy release gate.
- [ ] Memory pressure scenarios validate cap downshift and recovery.
- [ ] Policy-parity fixture validates identical cap transitions for equivalent pressure profiles in Node and `/ops`.
- [ ] No queue/session leaks in soak results.
- [ ] Full quality gate is green (`lint`, `tsc --noEmit`, `build`, `test`).

---

## Mode-by-Mode Test Matrix

| ID | Mode variant | Dimension | Scenario | Expected result | Gate |
|---|---|---|---|---|---|
| M1 | managed headed | baseline parallel | 2 targets run `goto` + `click` concurrently | no crosstalk, target FIFO preserved | Required |
| M2 | managed headless | baseline parallel | same as M1 | same normalized outcome as M1 | Required |
| M3 | managed headed | same-target ordering | concurrent storm on one target | strict FIFO, no dropped ops | Required |
| M4 | managed headless | memory downshift | synthetic memory pressure crosses high threshold | cap reduces, no crash | Required |
| M5 | cdpConnect headed | baseline parallel | 2 CDP targets in one session | parity with managed contract | Required |
| M6 | cdpConnect headless | baseline parallel | same as M5 | parity with M5 normalized output | Required |
| M7 | cdpConnect headed | reconnect churn | remote debug reconnect mid-run | explicit recover/fail path, no hang | Required |
| M8 | cdpConnect headless | memory recovery | pressure falls below threshold | cap recovers only after hysteresis window | Required |
| M9 | extension `/ops` headed | multi-client isolation | two clients, separate sessions | no lease bleed, both complete | Required |
| M10 | extension `/ops` headed | in-session target parallel | same session, different targets | concurrent progress without active-target collision | Required |
| M11 | extension `/ops` headed | ownership check | wrong lease/client issues command | `not_owner`, session healthy | Required |
| M12 | extension `/ops` headed | service worker churn | worker suspension/reconnect during workload | request retry path succeeds or fails explicit | Required |
| M13 | extension `/ops` headed | tab lifecycle pressure | active tab becomes `discarded`/`frozen` | clear recoverable error, no scheduler deadlock | Required |
| M14 | extension `/ops` headed | payload boundary | oversized payload response path | chunk/reassembly or bounded rejection with reason | Required |
| M15 | extension legacy `/cdp` headed | compatibility baseline | sequential multitab flow | succeeds sequentially within documented limits | Required |
| M16 | extension legacy `/cdp` headed | single-client guard | second `/cdp` client connects | explicit rejection/close code | Required |
| M17 | mixed `/ops` + `/cdp` | channel boundary | `/cdp` attach to ops-owned target | `cdp_attach_blocked` enforced | Required |
| M18 | all modes | ref invalidation | navigation mid-flow invalidates refs | recoverable stale-ref path (refresh or explicit fail) | Required |
| M19 | all modes | timeout parity | slow actions exceed timeout | normalized timeout classification, no deadlock | Required |
| M20 | all modes | backpressure parity | cap reached across surfaces | same `parallelism_backpressure` classification | Required |
| M21 | managed/cdpConnect headed vs headless | mode parity | run identical scenario pack in both variants | normalized outcomes match, declared divergence only | Required |
| M22 | all modes | observability parity | degraded states surfaced in status outputs | reason codes are explicit and consistent | Required |
| M23 | all parallel-capable modes | soak | 30-60 min mixed workload | stable memory trend, no queue/session leaks | Required |
| M24 | docs/frontend pipeline | docs drift | phase-end docs generation + links/tests | docs sync passes before phase close | Required |
| M25 | extension headless boundary | unsupported-mode behavior | attempt extension launch/connect in headless | explicit `unsupported_mode` response | Required |
| M26 | Node + extension `/ops` | governor parity | replay identical synthetic pressure profile in both runtimes | identical cap transition sequence and backpressure classification | Required |

---

## Breakpoint and Edge-Case Scenarios

| ID | Layer | Breakpoint scenario | Trigger | Impact | Detection | Mitigation |
|---|---|---|---|---|---|---|
| B1 | Governor | cap oscillation | pressure fluctuates near threshold | throughput thrash, latency spikes | cap timeline jitter | hysteresis + min hold window |
| B2 | Governor | cap never recovers | stale pressure metric | permanent underutilization | long-term low cap despite low pressure | metric freshness checks + fallback |
| B3 | Governor | wrong pressure source | heap-only tracking misses RSS growth | OOM risk | rising RSS with stable heap | prefer RSS + host pressure |
| B4 | Governor | starvation on bounded queue | long-running target monopolizes slots | head-of-line delays | queue age growth | per-target fairness + timeout |
| B5 | Governor | over-conservative floor | floor too low for healthy host | under-throughput | low CPU/memory but low parallelism | tune floor/caps from soak telemetry |
| B6 | Node runtime | profile lock collision | parallel persistent profile reuse | launch failure/corruption risk | lock errors, profile in use | unique profile/session or non-persistent mode |
| B7 | Node runtime | orphan queues | target/session closes during load | memory leak, stuck promises | queue map growth | deterministic teardown cleanup |
| B8 | Node runtime | stale target route | target closed after enqueue | wrong-target errors | target-not-found failures | late target existence check before execute |
| B9 | relay | extension disconnect | relay socket drop | command failures | health reason fields | reconnect flow + explicit failure class |
| B10 | relay | handshake incomplete | extension connected, not ready | blocked command routing | `handshake_incomplete` | launch/connect wait-for-handshake |
| B11 | relay | mixed-channel bleed | `/cdp` attaches to ops-owned target | ownership violation | `cdp_attach_blocked` | retain strict channel gate |
| B12 | relay | payload overflow | oversized request/response | rejected commands | max-bytes error | preflight payload bounds + chunking |
| B13 | extension SW | worker suspension | idle reclaim during run | transient command loss | disconnect/reconnect spikes | idempotent reconnect + retry budget |
| B14 | extension tabs | tab discarded | memory pressure discards tab | command invalidation | tab state flags | recoverable error + target reacquire |
| B15 | extension tabs | tab frozen | tab enters frozen lifecycle | delayed execution | inflated latency + timeout | timeout class mapping + resume retry |
| B16 | ops runtime | lease mismatch | stale client or lease | denied execution | `not_owner` errors | strict lease renewal and rebinding |
| B17 | ops runtime | target context drift | implicit target switching under concurrency | wrong-tab actions | cross-target flake signatures | explicit target routing only |
| B18 | legacy `/cdp` | second client collision | concurrent client attach | session instability | close code/errors | keep single-client invariant |
| B19 | CDP | detach fanout | multi-session detach events | stale router state | repeated detach events | idempotent detach cleanup |
| B20 | DOM/ref | node identity reset | document updates/navigation | stale refs | invalid ref errors | ref refresh + bounded retry |
| B21 | headed/headless | rendering drift | font/compositor differences | screenshot/layout mismatch | diff noise | normalized parity ignores visual-only deltas unless required |
| B22 | headed/headless | headless-only timing | faster event loop in headless | flaky timing assumptions | intermittent timeout patterns | deterministic waits + explicit readiness checks |
| B23 | tests | matrix gap | mode variant omitted | false confidence | missing matrix IDs | matrix completeness gate |
| B24 | docs | doc drift after phase | runtime changes without docs sync | operator confusion | link/tests mismatch | mandatory phase-end doc sweep |
| B25 | docs/frontend | generated-doc drift | source docs changed, frontend not regenerated | stale website docs | frontend docs tests fail | enforce frontend generation step per phase |
| B26 | config/parity | governor policy drift | duplicated defaults diverge across Node and extension runtime | inconsistent cap behavior and parity failures | same pressure fixture yields mismatched cap transitions | single policy source in config + injected policy payload + parity fixture |

---

## File-by-File Implementation Sequence

1. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/MULTITAB_PARALLEL_OPERATIONS_SPEC.md` — source of truth (this document)
2. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/core/types.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/config.ts` — governor config contract
3. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/manager-types.ts` — target-aware API surface
4. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/browser-manager.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/target-manager.ts` — Node scheduler + governor
5. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-session-store.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-runtime.ts` — `/ops` scheduler + governor
6. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/remote-manager.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/daemon-commands.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/tools/index.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/tools/workflow-runtime.ts` — plumbing + normalized envelopes
7. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/browser-manager.test.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/ops-browser-manager.test.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-ops-runtime.test.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/relay-server.test.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/parity-matrix.test.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/daemon-commands.integration.test.ts` + `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/scripts/live-regression-matrix.mjs` — parity/memory matrix gates
8. `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/PARITY_DECLARED_DIVERGENCES.md` (new file) — divergence registry
9. Docs sweep files + frontend doc generation outputs at end of each phase

---

## Dependencies to Add

| Package | Version | Purpose |
|---|---|---|
| None initially | N/A | Prefer existing Node/Playwright/runtime telemetry primitives and current test stack. |

---

## Task and Subtask Dependency Mapping

| Task | Depends on | Subtasks | Unblocks |
|---|---|---|---|
| Task 1 | None | contract docs, taxonomy docs, legacy policy docs | Tasks 2-10 |
| Task 2 | Task 1 | governor config, metrics collector, cap logic, backpressure envelope | Tasks 5,6,10 |
| Task 3 | Task 1 | session-per-tab docs, matrix script pattern updates | immediate safe throughput |
| Task 4 | Task 1 | target-explicit interfaces, routing updates | Tasks 5,6,7 |
| Task 5 | Tasks 2,4 | target queue map, structural lock, cleanup hooks | Task 10 parity/soak |
| Task 6 | Tasks 2,4 | ops queue map, lease-safe routing, cap enforcement | Task 10 parity/soak |
| Task 7 | Tasks 1,5,6 | comparator utility, divergence registry, CI gate | anti-drift enforcement |
| Task 8 | Task 1 | legacy warning surfaces, guardrail tests/docs | channel safety clarity |
| Task 9 | None (phase gate) | docs updates, AGENTS updates, frontend generation, drift tests | prevents docs drift each phase |
| Task 10 | Tasks 5,6,7,8 + per-phase Task 9 completion | matrix expansion, pressure drills, policy-parity fixture, soak gates, release checks | release readiness |

---

## Rollout and Release Gates

### Gate A — Contract
- Task 1 completed.
- No contradictory mode policy across docs.

### Gate B — Functional parallelism
- Task 5 + Task 6 completed.
- M1-M17 and M25 green.

### Gate C — Memory governance and resilience
- Task 2 completed.
- M18-M23 and M26 green, including cap downshift/recovery assertions.

### Gate D — Documentation anti-drift (phase-end mandatory)
- Task 9 completed for current phase.
- M24 green.

### Gate E — Quality
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test`

---

## Risks and Controls

- Risk: complex scheduler bloat.
  - Control: single scheduler model + single governor policy, reused across modes.
- Risk: parity drift between tool/CLI/daemon.
  - Control: normalized comparator + declared divergence gate.
- Risk: memory pressure instability under burst workloads.
  - Control: adaptive cap, hysteresis, bounded backpressure.
- Risk: stale docs after phased rollout.
  - Control: mandatory phase-end documentation sweep and frontend docs generation.

---

## Version History

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-02-23 | Initial end-to-end spec with phased tasks, breakpoints, and mode matrix. |
| 1.1 | 2026-02-23 | Added adaptive memory-governed tab caps, parity anti-drift contract, headed/headless parity coverage, and mandatory phase-end docs/frontend/AGENTS sweep workflow. |
| 1.2 | 2026-02-23 | Critical audit patch: resolved phase/docs gate contradiction, aligned release-gate policy, enforced DRY policy source flow, added deterministic governor thresholds, clarified extension-headless boundary, and replaced ambiguous wildcard file targets. |
| 1.3 | 2026-02-23 | Tightened scope and anti-drift rigor: clarified Task 3 naming, made governor cap parity acceptance deterministic, aligned Task 10 impacted files, and added explicit policy-drift matrix/breakpoint gate (`M26`/`B26`). |
