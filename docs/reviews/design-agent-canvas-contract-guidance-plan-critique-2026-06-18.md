# Design-Agent Canvas Contract Guidance Plan Critique

## Context/Scope

Reviewed only `docs/plans/design-agent-canvas-contract-guidance-2026-06-18.md` against the original context-builder export at `prompt-exports/oracle-plan-2026-06-18-161832-canvas-plan-guidance-6f0d.md`. No implementation review or broad exploration was performed.

## Findings

1. **Top under-specified seams**
   - **Runtime plan value authority:** Task 2 names required nested fields, but leaves actual allowed values and source-of-truth lookup implicit (`docs/plans/design-agent-canvas-contract-guidance-2026-06-18.md:64-78`). The export was slightly clearer about using runtime enum constants, for example `CANVAS_VISUAL_DIRECTION_PROFILES` (`prompt-exports/oracle-plan-2026-06-18-161832-canvas-plan-guidance-6f0d.md:223-235`). Implementers may guess values for `profile`, `reducedMotion`, `browserValidation`, and latency.
   - **Patch template shape:** Task 7 says to add one concrete patch template with governance, page, node, prototype, token, and optional inventory operations (`docs/plans/design-agent-canvas-contract-guidance-2026-06-18.md:185-194`). It does not say whether this should be a single executable minimal smoke payload or a reference catalog. That choice changes validator checks and the real CLI smoke.
   - **Durable handoff artifact:** Task 6 lists `design-agent-handoff.json` and possible new handoff template/artifact files, while the open question defers the template decision (`docs/plans/design-agent-canvas-contract-guidance-2026-06-18.md:162-168`, `:556-558`). This affects Task 10 validator scope and should be decided before editing docs.

2. **Specificity balance**
   - Potential over-specification: Task 8 requires `canvas.starter.list` before hand-authoring standard shells (`docs/plans/design-agent-canvas-contract-guidance-2026-06-18.md:213-219`). Better as a decision branch unless product policy mandates starter-first.
   - Dropped useful framing: the export required each work item to include `Size` and `Done when` (`prompt-exports/oracle-plan-2026-06-18-161832-canvas-plan-guidance-6f0d.md:4-6`). The final plan uses compact tasks, which is consistent with repo plan style, but losing `Size` makes optional artifacts harder to sequence.

3. **Contradictions or missing dependencies**
   - Task 7 makes `canvas-patch.request.v1.json` a new required file, Task 9 references `.tmp/canvas-patch.request.json`, but no step copies or derives the asset template into the scratch params file (`docs/plans/design-agent-canvas-contract-guidance-2026-06-18.md:185`, `:248`).
   - Task 10 says to parse the patch template “if added,” but Task 7 and Task 9 treat patch guidance as required (`docs/plans/design-agent-canvas-contract-guidance-2026-06-18.md:274-276`). Make it required or explicitly optional.
   - Task 4 expects the extractor to accept the standalone generation plan as input (`docs/plans/design-agent-canvas-contract-guidance-2026-06-18.md:124-125`), but the plan does not specify whether extractor input is full contract, wrapped request, or both.

4. **Risk of over-planning**
   - Tasks 15 through 18 plus the verification matrix and PR sequence duplicate closeout mechanics and could be compressed into one “Validation and delivery” checklist (`docs/plans/design-agent-canvas-contract-guidance-2026-06-18.md:391-545`). Keep the implementation tasks prominent.

5. **Questions that change implementation order**
   - Is the patch template a minimal executable smoke payload or a multi-operation reference catalog?
   - Should `design-agent-handoff.v1.json` be added now, or deferred until work-product docs prove insufficient?
   - Should `extract-canvas-plan.sh` support both full contracts and standalone wrapped requests?
   - Is starter-first guidance mandatory, or only an advisory branch before custom patching?
