# Workflow Autonomy Implementation Spec

Implementation-ready specification for converting the workflow-autonomy investigations into phased execution work.

Source investigations:
- `docs/WORKFLOW_AUTONOMY_INVESTIGATION_2026-03-28.md`
- `docs/WORKFLOW_AUTONOMY_EXPANSION_INVESTIGATION_2026-03-29.md`

This document is the execution artifact. The two investigation docs remain the evidence trail.

---

## Overview

### Scope
- First-class workflow runners only:
  - `shopping`
  - `research`
  - `product_video`
- Governance-script centralization only:
  - `scripts/provider-direct-runs.mjs`
  - `scripts/provider-live-matrix.mjs`
  - `scripts/skill-runtime-audit.mjs`
  - `scripts/skill-runtime-scenarios.mjs`
  - `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json`

### Non-goals
- No provider fallback surgery in `src/providers/runtime-factory.ts`
- No runtime-policy rewrite in `src/providers/runtime-policy.ts`
- No new `workflow.data_extraction`, `workflow.login`, or `workflow.form_testing`
- No promotion of `web`, `community`, `social`, or `YouTube` into workflow runners
- No free-form planner inside provider/domain modules
- No runtime feature flags, shadow paths, or user-facing backward-compat branches
- No long-lived dual-shape workflow payload handling after phase 1 closes
- No production code changes in this document itself

### Key decisions
- Deterministic ownership stays in code:
  - runtime policy
  - browser mode and fallback precedence
  - cookie policy
  - challenge automation precedence
  - legal review gates
  - normalized failure taxonomy
  - normalization, enrichment, ranking, rendering, and artifact shaping
- Variable tactics move into bounded executors only where evidence supports it.
- `research`, `shopping`, and `product_video` remain the only first-class workflow kinds.
- `product_video` shares the substrate but does not become a free-form executor.
- Governance scripts are thinned and centralized, not deleted.

### Invariants
- `src/providers/index.ts` remains the authoritative `workflow.*` suspended-intent router.
- `src/providers/runtime-policy.ts` remains the canonical policy resolver.
- `src/providers/runtime-factory.ts` remains the canonical fallback and challenge orchestration seam.
- `src/providers/shopping/index.ts` remains the canonical owner of shopping provider catalog, region diagnostics, and legal checklist validation.
- `src/providers/{artifacts,constraint,enrichment,errors,normalize,registry,renderer,timebox}.ts` remain deterministic postprocess or policy helpers, not executor-owned logic.
- CLI and tool wrappers remain thin.
- Browser-surface packs remain packs.

### Acceptance bar for implementation-safe planning
- Every phase has:
  - explicit in-scope and out-of-scope statements
  - exact file ownership
  - resume and rollback considerations
  - phase-level blocking tests
  - explicit non-goals
- Unresolved items are marked `UNCONFIRMED` with a recommended option.

---

## Contract Model

### Runtime-owned contracts
- Keep in `src/providers/types.ts`:
  - `ProviderRuntimePolicyInput`
  - `ResolvedProviderRuntimePolicy`
  - `SuspendedIntentKind`
  - `SuspendedIntentSummary`
  - the suspended-intent payload field shape that carries workflow resume data
  - `WorkflowBrowserMode`
  - blocker and failure metadata

### New workflow substrate contracts
Recommended owner:
- `src/providers/workflow-contracts.ts`

Recommended additions:
- `WorkflowKind`
- `WorkflowPlan`
- `WorkflowPlanStep`
- `WorkflowCheckpoint`
- `WorkflowTraceEntry`
- `WorkflowResumeEnvelope`
- small helper types for step budgets, step policy, and compile output

Recommended contract boundary:
- compiler emits `WorkflowPlan`
- executor consumes `WorkflowPlan` and emits `WorkflowTraceEntry[]` plus raw execution payloads
- postprocessor consumes execution payloads and emits canonical workflow output
- resume routing continues to use current `workflow.*` kinds and carries a `WorkflowResumeEnvelope` through a runtime-owned suspended-intent payload contract defined in `src/providers/types.ts`
- `src/providers/workflow-contracts.ts` owns the envelope structure itself, but `src/providers/types.ts` remains the serialization owner for how that envelope is embedded into suspended intents

### Script governance contracts
Recommended owners:
- `scripts/shared/workflow-lane-scenarios.mjs`
- `scripts/shared/workflow-lane-verdicts.mjs`

Recommended centralized exports:
- auth-gated provider groups
- high-friction provider groups
- timeout buckets
- optional workflow probe definitions
- shared `ENV_LIMITED_CODES`
- shared verdict/classify helpers
- strict-gate exemptions and expected-timeout handling

### UNCONFIRMED items
- `UNCONFIRMED`: whether the workflow substrate should be one file or a small `workflow-*` cluster from phase 1.
  - Recommended option: start with one additive contracts file, split later only if implementation pressure forces it.
- `UNCONFIRMED`: whether a shared executor base file is needed.
  - Recommended option: keep `shopping-executor.ts` and `research-executor.ts` separate unless a real shared helper appears.

---

## Risk Register

### Risk 1: Resume compatibility drift
Problem:
- `src/providers/index.ts` currently resumes by re-entering workflow runners with workflow-specific payloads. Mid-plan checkpointing can drift if the new substrate changes payload shape carelessly.

Mitigation:
1. Introduce a `WorkflowResumeEnvelope` before any executor migration.
2. Keep `SuspendedIntentKind` unchanged.
3. Allow one narrow internal dual-shape migration path only for phase 1 so runners can accept raw legacy input or the new envelope while producers and resume routing converge.
4. Add phase-1 tests for `workflow.research`, `workflow.shopping`, and `workflow.product_video` resume compatibility.
5. Remove or collapse that temporary dual-shape path before phase 1 closes so no long-lived compatibility branch remains.

### Risk 2: Invariant leakage into executor code
Problem:
- Shopping and research executors could accidentally absorb legal gates, normalization, ranking, or artifact shaping.

Mitigation:
1. Split compile, execute, and postprocess ownership explicitly.
2. Keep legal, region, normalization, enrichment, ranking, and rendering helpers outside executor modules.
3. Add parity tests that pin meta, alerts, failures, and artifacts before executor activation.

### Risk 3: Governance-script drift
Problem:
- `provider-direct-runs` and `provider-live-matrix` still own overlapping scenario and verdict logic. If only one moves, release conclusions drift.

Mitigation:
1. Centralize scenario and verdict logic under `scripts/shared/`.
2. Make both direct and matrix scripts import the same helpers.
3. Add parity tests that assert shared classification behavior.

### Risk 4: Product-video overreach
Problem:
- The shared substrate could tempt a second autonomy expansion into `product_video`.

Mitigation:
1. Limit `product_video` to stage modeling, trace emission, and checkpoint wiring.
2. Keep its only adaptive seam as shopping-backed URL resolution.
3. Add explicit non-goals and tests that preserve deterministic artifact assembly.

### Risk 5: Hidden branch-gate regressions
Problem:
- Large suites such as `tests/providers-workflows-branches.test.ts` and `tests/providers-runtime-factory.test.ts` were not the primary evidence owners in the investigation docs, but they remain important closure gates.

Mitigation:
1. Treat their exact per-phase blocking subsets as `UNCONFIRMED` until enumerated during implementation.
2. Do not declare final rollout closure without rerunning them.

---

## Task 1 — Shared Workflow Substrate

### Reasoning
`src/providers/workflows.ts` currently mixes workflow entrypoints, compile-time decisions, execution loops, and deterministic postprocessing. A safe migration starts with additive substrate contracts and resume-safe envelopes, not with behavior changes.

### What to do
Add the shared workflow plan, checkpoint, trace, and resume contracts, then thread them through the existing workflow entrypoints without changing behavior.

### How
1. Create `src/providers/workflow-contracts.ts` with additive workflow substrate types only.
2. Extend the runtime-owned suspended-intent payload contract in `src/providers/types.ts` so it can carry a `WorkflowResumeEnvelope` explicitly rather than implicitly.
3. Add a small helper near `withWorkflowResumeIntent(...)` that wraps current workflow input into that envelope.
4. Update `runShoppingWorkflow(...)`, `runResearchWorkflow(...)`, and `runProductVideoWorkflow(...)` so they can unwrap a resume envelope while preserving current raw-input entry behavior during the migration.
5. Update `src/providers/index.ts` resume routing to pass the new envelope through unchanged.
6. Add producer/router serialization tests that pin resume compatibility and payload shape.

### Files impacted
- `src/providers/workflow-contracts.ts` (new file)
- `src/providers/types.ts`
- `src/providers/workflows.ts`
- `src/providers/index.ts`
- `tests/providers-workflow-contracts.test.ts` (new file)

### End goal
The repo has a shared workflow substrate and resume envelope without any workflow behavior change.

### Acceptance criteria
- [ ] `workflow.research`, `workflow.shopping`, and `workflow.product_video` still resume through `src/providers/index.ts`
- [ ] No new `SuspendedIntentKind` values are introduced
- [ ] The suspended-intent payload contract explicitly carries workflow resume envelopes through `src/providers/types.ts`
- [ ] Workflow entrypoints still accept existing wrapper payloads
- [ ] Contract tests pass
- [ ] No change in current workflow outputs

---

## Task 2 — Shopping Compile/Execute/Postprocess Split

### Reasoning
Shopping is the highest-variance workflow seam. Before changing tactics, the current monolith must be decomposed so compile, execute, and postprocess responsibilities are explicit and testable.

### What to do
Split the current shopping workflow into internal compile, execute, and postprocess stages without changing behavior.

### How
1. Extract shopping compile-stage logic:
   - provider selection
   - degraded-provider exclusion
   - legal review gate
   - region diagnostics preparation
2. Extract the current `runtime.search(...)` fanout loop into a dedicated execution helper with unchanged semantics.
3. Extract deterministic postprocessing:
   - record filtering
   - offer extraction
   - ranking
   - meta shaping
   - artifact shaping
4. Add no-behavior-change seam tests.

### Files impacted
- `src/providers/workflows.ts`
- `src/providers/shopping-workflow.ts` (new file, recommended)
- `src/providers/shopping-postprocess.ts` (new file, recommended)
- `tests/providers-shopping-workflow.test.ts` (new file, recommended)
- `tests/providers-workflows-branches.test.ts`

### End goal
Shopping has clear internal stage ownership and is ready for bounded-executor replacement.

### Acceptance criteria
- [ ] Shopping legal review still runs through `validateShoppingLegalReviewChecklist(...)`
- [ ] Shopping region diagnostics still come from `getShoppingRegionSupportDiagnostics(...)`
- [ ] Shopping output shape is unchanged
- [ ] Direct-run shopping expectations stay green
- [ ] No runtime-policy or fallback behavior moved out of existing owners

---

## Task 3 — Shopping Bounded Executor

### Reasoning
The root issue from the first investigation is the static shopping tactic loop. This is the main autonomy change: only the variable tactic loop should move into a bounded executor.

### What to do
Replace the shopping static middle loop with a bounded compiler/executor shell that emits checkpoints and traces while preserving deterministic postprocessing.

### How
1. Add a shopping plan compiler that emits bounded `search` and selective `fetch` steps.
2. Add `src/providers/shopping-executor.ts` that consumes the plan and uses only approved primitives:
   - `runtime.search(...)`
   - `runtime.fetch(...)`
3. Emit `WorkflowTraceEntry` records at:
   - compile start/finish
   - step start/finish
   - tactical decisions
   - pre-suspend checkpoints
4. Update `runShoppingWorkflow(...)` so it becomes:
   - compile
   - execute
   - postprocess
   - render
   - artifact
5. Extend shopping resume handling so checkpointed execution can restore progress safely.
6. Add executor tests for determinism, checkpointing, and invariant-owned postprocessing.

### Files impacted
- `src/providers/workflows.ts`
- `src/providers/shopping-compiler.ts` (new file)
- `src/providers/shopping-executor.ts` (new file)
- `tests/providers-shopping-executor.test.ts` (new file)
- `tests/provider-direct-runs.test.ts`
- `tests/providers-workflows-branches.test.ts`

### End goal
Shopping tactical autonomy is bounded, replayable, and resume-safe, while deterministic policy and postprocessing remain untouched.

### Acceptance criteria
- [ ] Shopping still preserves legal-review and region-diagnostics invariants
- [ ] Shopping meta, alerts, failures, and artifact manifests remain stable
- [ ] Resume restores shopping progress from checkpoint state
- [ ] Direct-run shopping golden cases remain stable while governance verdict ownership is still pre-centralization
- [ ] No new CLI flags or workflow categories are introduced

---

## Task 4 — Research Bounded Executor

### Reasoning
Research is the next strongest hybrid target because source ordering, selective follow-up fetches, and follow-up stopping conditions are tactical, while sanitation, enrichment, dedupe, ranking, and rendering are deterministic.

### What to do
Move research tactical source-follow-up work into a bounded executor while preserving deterministic postprocessing.

### How
1. Extract research compile-stage logic:
   - source resolution
   - timebox preparation
   - exclusions
   - budget setup
2. Add `src/providers/research-executor.ts` for:
   - per-source `runtime.search(...)`
   - selective web follow-up `runtime.fetch(...)`
3. Keep sanitation, enrichment, dedupe, ranking, and rendering in existing deterministic owners.
4. Add research checkpoints and traces for source and follow-up progress.
5. Add tests for:
   - follow-up planning
   - sanitized-shell preservation
   - checkpoint resume
   - stable meta/artifact behavior

### Files impacted
- `src/providers/workflows.ts`
- `src/providers/research-compiler.ts` (new file)
- `src/providers/research-executor.ts` (new file)
- `tests/providers-research-executor.test.ts` (new file)
- `tests/providers-workflows-branches.test.ts`

### End goal
Research tactical variance is bounded and resumable, while deterministic postprocessing remains stable.

### Acceptance criteria
- [ ] Research timebox behavior is unchanged
- [ ] Research sanitation, enrichment, dedupe, ranking, and rendering stay outside executor ownership
- [ ] Research meta and artifact outputs remain stable
- [ ] Research resume works from checkpoints
- [ ] Research workflow wrappers remain thin and unchanged

---

## Task 5 — Product-Video Substrate Adoption

### Reasoning
`product_video` should share trace and checkpoint plumbing, but it should not become the next open-ended executor. Its flow is mostly linear after optional shopping-backed URL resolution.

### What to do
Move `product_video` onto the shared workflow substrate while preserving deterministic execution behavior.

### How
1. Add a deterministic product-video plan model with explicit stages:
   - input normalization
   - optional shopping-backed URL resolution
   - detail fetch
   - extract
   - artifact assembly
2. Thread trace and checkpoint emission through those stages.
3. Preserve shopping URL resolution as the only adaptive seam.
4. Add tests that pin stage-level behavior and fixture expectations.

### Files impacted
- `src/providers/workflows.ts`
- `src/providers/product-video-compiler.ts` (new file, recommended)
- `src/cli/commands/product-video.ts` (only if substrate threading forces a wrapper contract update)
- `src/tools/product_video_run.ts` (only if substrate threading forces a tool contract update)
- `tests/providers-product-video-workflow.test.ts` (new file, recommended)

### End goal
`product_video` uses the shared substrate for trace and checkpoint consistency without expanding its tactical scope.

### Acceptance criteria
- [ ] `product_video` still uses shopping only for URL resolution when needed
- [ ] Product-video asset structure remains stable
- [ ] Product-video does not gain a new tactical planner
- [ ] Product-video fixture expectations remain stable

---

## Task 6 — Governance-Script Centralization

### Reasoning
The reports show that scripts still own duplicated scenario classes, timeout buckets, and verdict logic. That duplication must be centralized after workflow-runner seams stabilize.

### What to do
Centralize scenario and verdict policy into shared script-side modules, then make direct-run, live-matrix, and audit lanes consume those shared owners.

### How
1. Add `scripts/shared/workflow-lane-scenarios.mjs` for shared scenario inventory and probe definitions.
2. Add `scripts/shared/workflow-lane-verdicts.mjs` for:
   - `ENV_LIMITED_CODES`
   - verdict classification
   - strict expected-timeout handling
3. Refactor `scripts/provider-direct-runs.mjs` to import the shared scenario and verdict modules.
4. Refactor `scripts/provider-live-matrix.mjs` to import the same shared modules.
5. Update `scripts/skill-runtime-scenarios.mjs` and `scripts/skill-runtime-audit.mjs` so they consume centralized lane outputs and do not re-own scenario policy.
6. Update the matrix JSON only where necessary to reflect the stable runner boundary.
7. Add parity tests proving the same evidence classifies the same way across direct, matrix, and audit lanes.

### Files impacted
- `scripts/shared/workflow-lane-scenarios.mjs` (new file)
- `scripts/shared/workflow-lane-verdicts.mjs` (new file)
- `scripts/provider-direct-runs.mjs`
- `scripts/provider-live-matrix.mjs`
- `scripts/skill-runtime-scenarios.mjs`
- `scripts/skill-runtime-audit.mjs`
- `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json`
- `tests/provider-direct-runs.test.ts`
- `tests/skill-runtime-scenarios.test.ts`
- `tests/skill-runtime-audit.test.ts`
- `tests/provider-live-matrix.test.ts` (new file, recommended)

### End goal
Governance scripts consume one shared source of scenario and verdict policy, eliminating drift between audit lanes.

### Acceptance criteria
- [ ] `provider-direct-runs` and `provider-live-matrix` import the same verdict logic
- [ ] No duplicated `ENV_LIMITED_CODES` or duplicated shopping timeout groups remain
- [ ] `scripts/skill-runtime-scenarios.mjs` remains the canonical lane-schema owner with an explicit passing parity check against `skill-runtime-pack-matrix.json`
- [ ] Audit lane derivation remains deterministic
- [ ] New parity tests prove shared classification behavior
- [ ] No production runtime policy is moved into scripts

---

## Task 7 — Gate Hardening And Rollout Control

### Reasoning
The implementation path needs explicit blocking gates, rollback triggers, and closure conditions. The repo should rely on phase gates and atomic reverts, not on runtime toggles.

### What to do
Freeze phase-level gating, rollout controls, and rollback criteria, then align workflow and governance docs to the final boundary.

### How
1. Keep one phase per atomic commit group.
2. Do not combine executor migration and governance centralization in the same commit.
3. Define rollback triggers per phase:
   - resume drift
   - legal/meta invariant drift
   - research postprocess leakage
   - product-video overreach
   - script verdict divergence
4. Align workflow and governance documentation after the code phases stabilize.
5. Require full repo gates before claiming final rollout readiness.

### Files impacted
- `docs/WORKFLOW_AUTONOMY_IMPLEMENTATION_SPEC.md`
- `skills/opendevbrowser-best-practices/SKILL.md`
- `skills/opendevbrowser-research/SKILL.md`
- `skills/opendevbrowser-product-presentation-asset/SKILL.md`
- `skills/opendevbrowser-best-practices/assets/templates/skill-runtime-pack-matrix.json`

### End goal
The rollout path is explicit, revertable, and verifiable without runtime flags.

### Acceptance criteria
- [ ] Every phase has blocking tests and rollback triggers
- [ ] The docs reflect the final category boundary clearly
- [ ] No runtime feature flag or compatibility toggle is introduced
- [ ] Final rollout requires full repo gates and explicit reruns of omitted branch suites

---

## File-by-file implementation sequence

1. `src/providers/workflow-contracts.ts` — shared workflow substrate
2. `src/providers/workflows.ts` — envelope support, then staged workflow extraction
3. `src/providers/index.ts` — authoritative resume routing updates
4. `src/providers/shopping-postprocess.ts` — deterministic shopping postprocess seam
5. `src/providers/shopping-compiler.ts` — shopping compile seam
6. `src/providers/shopping-executor.ts` — shopping tactical executor
7. `src/providers/research-compiler.ts` — research compile seam
8. `src/providers/research-executor.ts` — research tactical executor
9. `src/providers/product-video-compiler.ts` — deterministic stage model
10. `scripts/shared/workflow-lane-scenarios.mjs` — central scenario inventory
11. `scripts/shared/workflow-lane-verdicts.mjs` — central verdict inventory
12. `scripts/provider-direct-runs.mjs` — shared script-policy consumer
13. `scripts/provider-live-matrix.mjs` — shared script-policy consumer
14. `scripts/skill-runtime-scenarios.mjs` — canonical lane schema consumer
15. `scripts/skill-runtime-audit.mjs` — centralized audit consumer
16. workflow executor and governance parity tests
17. docs and skill-pack boundary alignment

---

## Dependencies to add

No new external dependency is currently required.

| Package | Version | Purpose |
|---------|---------|---------|
| none | n/a | The spec assumes internal module extraction only |

---

## Validation Sequence

Phase-local gates:
1. relevant new unit tests
2. relevant existing branch suites
3. relevant script-lane tests

Repo-wide gates before phase completion:
1. `npm run lint`
2. `npm run typecheck`
3. `npm run build`
4. `npm run extension:build`
5. `node scripts/docs-drift-check.mjs`
6. `git diff --check`
7. `npm run test`

Additional required closure gates:
1. Explicit rerun of `tests/providers-workflows-branches.test.ts`
2. Explicit rerun of `tests/providers-runtime-factory.test.ts`
3. `tests/skill-runtime-scenarios.test.ts` after any matrix or lane-schema change
4. Any workflow probe or matrix lane tests touched by governance centralization

Before final rollout closure:
1. Enumerate the exact blocking subset inside `tests/providers-workflows-branches.test.ts` for each implementation phase.
2. Enumerate the exact blocking subset inside `tests/providers-runtime-factory.test.ts` for each implementation phase.
3. Record those enumerations in this spec or a linked execution note before claiming final implementation completion.

---

## Rollout Controls

### Commit order
1. substrate contracts
2. shopping seam split
3. shopping executor
4. research executor
5. product-video substrate adoption
6. governance centralization
7. docs and final gates

### Rollback triggers
- Phase 1 rollback:
  - suspended-intent payload incompatibility
  - resume payload deserialization failure
  - output-shape drift after envelope threading
- Phase 2 rollback:
  - shopping output, meta, or artifact parity drift introduced by seam extraction before executor activation
  - legal-review or region-diagnostics ownership drift during compile/execute/postprocess splitting
- Phase 3 rollback:
  - shopping resume replays incorrectly
  - shopping legal or meta invariants regress
- Phase 4 rollback:
  - research sanitation, enrichment, or ranking drift into executor modules
- Phase 5 rollback:
  - `product_video` gains new tactical behavior
- Phase 6 rollback:
  - direct and matrix lanes classify the same evidence differently
  - audit pack/domain status changes without a matching intentional matrix update

### Rollback method
- Revert the owning phase commit set.
- Do not keep dormant shadow paths.
- Re-enter at the last passing phase gate.

---

## Implementation Readiness Checklist

- [ ] shared workflow substrate owner chosen
- [ ] `UNCONFIRMED` branch-suite gates enumerated
- [ ] shopping compile/execute/postprocess split accepted as phase 2
- [ ] shopping executor limited to approved primitives
- [ ] research executor boundary accepted
- [ ] `product_video` deterministic boundary accepted
- [ ] script-side shared scenario owner accepted
- [ ] script-side shared verdict owner accepted
- [ ] rollback triggers accepted
- [ ] repo-wide validation sequence accepted

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-29 | Initial implementation spec derived from the two workflow-autonomy investigations |
