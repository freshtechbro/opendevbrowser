# Design-Agent Canvas Contract Guidance Plan

## Goal
Strengthen the bundled `opendevbrowser-design-agent` Canvas path so agents can reliably move from design contract, to runtime-valid Canvas generation plan, to concrete Canvas document construction, to preview, feedback, save, and export without guessing.

Success means the skill becomes construction-strong, not only schema-strong: it teaches section-by-section contract construction, ships concrete Canvas plan and patch examples, routes agents through starters and inventory when appropriate, defines durable design-agent work products under project-local `.opendevbrowser/design-agent/<run-id>/`, keeps `.tmp` scratch-only, preserves Canvas document persistence under `.opendevbrowser/canvas/...`, and proves the workflow through validators, mutation tests, focused Canvas tests, real Canvas CLI workflow validation, adversarial review loops, atomic commits, PR checks, merge checks, merge, and final `main` verification.

## Decisions
- Keep implementation scoped to `skills/opendevbrowser-design-agent/**`, tests, and docs unless a reviewed blocker proves runtime TypeScript must change.
- Treat `src/canvas/types.ts`, `src/canvas/document-store.ts`, `src/browser/canvas-manager.ts`, and `src/canvas/repair-examples.ts` as reference contracts, not default edit targets.
- Make `skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json#generationPlan` extract to a runtime-valid `CanvasGenerationPlan`.
- Keep `skills/opendevbrowser-design-agent/assets/templates/canvas-generation-plan.design.v1.json` as the standalone runtime request template.
- Use the current Canvas constants and validator as the allowed-value authority: `CANVAS_SESSION_MODES`, `CANVAS_VISUAL_DIRECTION_PROFILES`, `CANVAS_THEME_STRATEGIES`, `CANVAS_NAVIGATION_MODELS`, `CANVAS_INTERACTION_STATES`, `CANVAS_PLAN_VIEWPORTS`, `CANVAS_PLAN_THEMES`, `CANVAS_MOTION_LEVELS`, `CANVAS_REDUCED_MOTION_POLICIES`, `CANVAS_KEYBOARD_NAVIGATION_MODES`, `CANVAS_BROWSER_VALIDATION_MODES`, and `CANVAS_VALIDATION_TARGET_BLOCK_ON_CODES` in `src/canvas/types.ts`; `validateGenerationPlan()` in `src/canvas/document-store.ts`.
- Make `canvas-patch.request.v1.json` a minimal executable smoke payload after placeholders are filled, not a full reference catalog. Put richer operation catalog guidance in docs.
- Keep Canvas document persistence under `.opendevbrowser/canvas/...`.
- Use `.opendevbrowser/design-agent/<run-id>/` only for durable design-agent planning, patch, evidence, and handoff work products.
- Use `.tmp/` only for disposable command params, extractor output, and scratch files.
- Keep `design-agent-handoff.json` as a recommended generated work-product filename only. Do not add a shipped `design-agent-handoff.v1.json` template in this plan unless implementation review proves docs are insufficient.
- Make `extract-canvas-plan.sh` support both full design-contract input and already wrapped `canvas.plan.set` request input with `generationPlan`, preserving supplied wrapper IDs when present.
- Treat starter and inventory usage as an advisory decision branch: inspect them before hand-authoring standard shells when relevant, but keep custom patch construction valid.
- Follow validator ownership split: the design-agent validator owns exact positive and stale-marker checks; shared Vitest owns representative mutation tests that prove stale guidance fails.

## Non-Goals
- Do not change Canvas runtime behavior unless a review loop proves a runtime defect.
- Do not replace `canvas.document.save` or `.opendevbrowser/canvas/...` persistence with design-agent work-product storage.
- Do not add feature flags, compatibility fallbacks, stubs, or hidden release paths.
- Do not commit `.tmp`, generated `.opendevbrowser/design-agent/<run-id>/`, generated Canvas documents, coverage, prompt exports, `CONTINUITY.md`, or `sub_continuity.md`.

## Background
- Current design-agent entrypoints already require contract-first work and Canvas governance: `skills/opendevbrowser-design-agent/SKILL.md:83`, `skills/opendevbrowser-design-agent/SKILL.md:115`, `skills/opendevbrowser-design-agent/SKILL.md:187`.
- The full contract template exists at `skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json:1`; its `generationPlan` starts at `:174` and appears to miss nested fields required by runtime Canvas validation.
- The standalone Canvas plan template is closer to runtime shape: `skills/opendevbrowser-design-agent/assets/templates/canvas-generation-plan.design.v1.json:1`.
- The extractor checks only top-level plan keys and emits `{ requestId, canvasSessionId, leaseId, documentId, generationPlan }`: `skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh:20`, `skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh:48`.
- The design-agent validator checks required files, JSON parseability, workflow markers, and top-level extracted plan keys, but not nested runtime plan validity or a concrete patch params template: `skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh:14`, `skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh:184`, `skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh:214`, `skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh:251`.
- The `canvas-contract` router prints scratch paths without setup: `skills/opendevbrowser-design-agent/scripts/design-workflow.sh:100` references `./tmp/design-contract.json`, `./tmp/canvas-plan.json`, and `./tmp/canvas-patch.json`; `skills/opendevbrowser-design-agent/SKILL.md:273` also references `./tmp/design-contract.json`.
- Canvas governance command order and repair behavior are documented in `skills/opendevbrowser-best-practices/artifacts/canvas-governance-playbook.md:7`, `skills/opendevbrowser-best-practices/artifacts/canvas-governance-playbook.md:21`, and `skills/opendevbrowser-best-practices/artifacts/canvas-governance-playbook.md:72`.
- Runtime Canvas already supports the required workflow: public commands are listed at `src/browser/canvas-manager.ts:129`; CLI attaches `repoRoot: process.cwd()` when absent at `src/cli/commands/canvas.ts:255`; `canvas.plan.set` validates and persists accepted plans at `src/browser/canvas-manager.ts:556` and `src/browser/canvas-manager.ts:568`; `canvas.document.patch` gates mutation at `src/browser/canvas-manager.ts:811`.
- Canvas plan allowed values are exported in `src/canvas/types.ts:99`, `src/canvas/types.ts:113`, `src/canvas/types.ts:117`, `src/canvas/types.ts:121`, `src/canvas/types.ts:136`, `src/canvas/types.ts:140`, `src/canvas/types.ts:144`, `src/canvas/types.ts:148`, `src/canvas/types.ts:152`, and `src/canvas/types.ts:156`.
- Runtime nested plan validation lives in `validateGenerationPlan()` at `src/canvas/document-store.ts:1510`, including profile, theme, navigation, interaction state, motion, viewport, keyboard, validation-target, and latency checks.
- `CanvasPatch` supports page, node, variant, token, governance, asset, binding, prototype, inventory, and starter operations: `src/canvas/types.ts:812`.
- Runtime starters and inventory are available and should reduce manual node authoring: `src/browser/canvas-manager.ts:1393`, `src/browser/canvas-manager.ts:1435`, `src/browser/canvas-manager.ts:1280`, and `src/browser/canvas-manager.ts:1332`.
- Preview, feedback, save, and export are present at `src/browser/canvas-manager.ts:1820`, `src/browser/canvas-manager.ts:2101`, `src/browser/canvas-manager.ts:1203`, and `src/browser/canvas-manager.ts:1231`.
- Strong patch examples exist mostly in tests: governance bootstrap at `tests/canvas-manager.test.ts:69`, `node.insert` and `node.update` at `tests/canvas-manager.test.ts:392`, additive page/node patches at `tests/canvas-document-store.test.ts:2206`, and inventory setup/insertion at `tests/canvas-inventory.test.ts:138`.
- Inspiredesign has the strongest existing guide model: artifact filenames at `src/inspiredesign/handoff.ts:1`, guide entry shape at `src/inspiredesign/handoff.ts:21`, artifact guide at `src/inspiredesign/handoff.ts:82`, contract section guide at `src/inspiredesign/handoff.ts:193`, and followthrough inclusion at `src/inspiredesign/contract.ts:1950`.
- Prior output-storage investigation distinguishes artifact bundles under `.opendevbrowser/<workflow>/<run-id>/` from Canvas repo-native persistence under `.opendevbrowser/canvas/...`: `docs/investigations/output-storage-architecture-2026-06-13.md:11`, `docs/investigations/output-storage-architecture-2026-06-13.md:41`.
- Previous design-agent audit work flagged the temporary setup issue that led to this plan.
- Closeout conventions are captured directly in this plan's validation and delivery tasks: review-fix-rerun loops, local gates, atomic commits, PR checks, PR review, merge checks, merge, and final `main` verification.

## Task 1 - Guard Scope and Baseline
Reasoning: The known weakness is skill guidance and validation drift. Runtime Canvas already exposes the plan, patch, starter, inventory, preview, feedback, save, and export surfaces the skill needs.
What to do: Establish a clean implementation boundary before editing.
How:
1. Run `git status --short` and inspect current untracked planning/review files before touching implementation files.
2. Confirm runtime files are reference contracts only.
3. Confirm generated artifacts and continuity files remain ignored and unstaged.
4. Re-read the plan and current `skills/opendevbrowser-design-agent` assets before editing.
Files impacted: no implementation files; reference only `src/canvas/types.ts`, `src/canvas/document-store.ts`, `src/browser/canvas-manager.ts`, `src/canvas/repair-examples.ts`.
Dependencies: none.
End goal: the implementation starts from a constrained, reviewable scope.
Acceptance criteria:
- Runtime TypeScript edit targets are explicitly out of scope unless a reviewed blocker appears.
- Current working tree changes are understood and unrelated untracked files are not overwritten.
- `.tmp`, generated `.opendevbrowser/*`, `prompt-exports/`, `CONTINUITY.md`, and `sub_continuity.md` are not staged.
Validation: `git status --short`; targeted file reads.
Commit milestone: none.

## Task 2 - Align Design Contract Generation Plan
Reasoning: The documented extractor path starts from the full design contract. If its embedded `generationPlan` is not runtime-valid, agents can follow the skill exactly and still fail at `canvas.plan.set`.
What to do: Expand `skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json#generationPlan` to match runtime-required nested Canvas fields.
How:
1. Use runtime constants in `src/canvas/types.ts` as the only allowed-value source for enum-like fields.
2. Add or align `visualDirection.themeStrategy` using `CANVAS_THEME_STRATEGIES`.
3. Ensure `visualDirection.profile` uses `CANVAS_VISUAL_DIRECTION_PROFILES`.
4. Add `layoutStrategy.navigationModel` using `CANVAS_NAVIGATION_MODELS`.
5. Add `componentStrategy.interactionStates` using `CANVAS_INTERACTION_STATES`.
6. Add `motionPosture.reducedMotion` using `CANVAS_REDUCED_MOTION_POLICIES` and keep advanced motion cues advisory-only.
7. Ensure `responsivePosture.primaryViewport` and `responsivePosture.requiredViewports` use `CANVAS_PLAN_VIEWPORTS`, and that `requiredViewports` includes `primaryViewport`.
8. Replace or supplement `accessibilityPosture.keyboardParity` with `accessibilityPosture.keyboardNavigation` using `CANVAS_KEYBOARD_NAVIGATION_MODES`.
9. Add `validationTargets.requiredThemes`, `validationTargets.browserValidation`, and `validationTargets.maxInteractionLatencyMs` using `CANVAS_PLAN_THEMES`, `CANVAS_BROWSER_VALIDATION_MODES`, and positive-number validation.
10. Keep non-runtime richer contract blocks outside the mutation-safe `generationPlan` unless Canvas validation permits them.
Files impacted: `skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json`; reference only `src/canvas/types.ts`, `src/canvas/document-store.ts`.
Dependencies: Task 1.
End goal: extracting the full contract yields a Canvas-accepted plan shape.
Acceptance criteria:
- Extracted plan includes the nested runtime-required fields.
- Values stay inside current Canvas constants and pass `validateGenerationPlan()`.
- Existing design intent remains represented.
- No runtime TypeScript changes are needed.
Validation:
- `./skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json`
- Focused template validation test from Task 11.
Commit milestone: `fix: align design-agent canvas generation plans`.

## Task 3 - Align Standalone Canvas Plan Template
Reasoning: The standalone Canvas plan template should teach the same runtime shape as the extracted full contract, otherwise agents see two competing examples.
What to do: Align `canvas-generation-plan.design.v1.json` with the full contract semantics while preserving its request-wrapper role.
How:
1. Compare every required nested field against the updated full contract.
2. Preserve wrapper fields `requestId`, `canvasSessionId`, `leaseId`, `documentId`, and `generationPlan`.
3. Ensure `requiredThemes`, viewport, browser validation, and latency examples match the skill’s design rules.
4. Keep all enum-like values valid.
5. Keep the template directly usable as `canvas.plan.set --params-file` after IDs are filled.
Files impacted: `skills/opendevbrowser-design-agent/assets/templates/canvas-generation-plan.design.v1.json`.
Dependencies: Task 2.
End goal: standalone and extracted Canvas plan examples are consistent.
Acceptance criteria:
- Both plan templates contain the same required Canvas field families.
- Both templates pass runtime-compatible validation.
- The standalone template remains a complete request payload.
Validation:
- Parse JSON.
- Run design-agent validator after Task 10.
- Run template validation tests from Task 11.
Commit milestone: included in `fix: align design-agent canvas generation plans`.

## Task 4 - Harden Canvas Plan Extraction
Reasoning: `extract-canvas-plan.sh` currently catches missing top-level fields but not missing nested fields that runtime validation will reject.
What to do: Extend extractor validation so stale templates fail before CLI submission.
How:
1. Support two input shapes: a full design contract object with `generationPlan`, and a wrapped `canvas.plan.set` request object with `requestId`, `canvasSessionId`, `leaseId`, `documentId`, and `generationPlan`.
2. Preserve supplied wrapper IDs when the input is already wrapped; otherwise emit the existing wrapper shape for full-contract extraction.
3. Add a local nested field requirement map for the current Canvas plan shape.
4. Check each required nested path exists.
5. Check required string fields are non-empty.
6. Check arrays such as `interactionStates`, `requiredViewports`, `blockOn`, and `requiredThemes` are non-empty.
7. Check enum-like values against the same allowed values as `src/canvas/types.ts`, or directly delegate nested validation to a runtime-compatible Node helper if that stays docs/script-only.
8. Check `maxInteractionLatencyMs` is a positive number.
9. Check `requiredViewports` includes `primaryViewport`.
10. Emit precise path-specific errors to stderr.
11. Preserve output shape as a `canvas.plan.set` request wrapper.
Files impacted: `skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh`.
Dependencies: Tasks 2 and 3.
End goal: extractor output cannot silently become runtime-invalid for known nested requirements.
Acceptance criteria:
- Valid full contract extracts successfully.
- Valid standalone wrapped request template extracts successfully if used as input.
- Extractor rejects an unwrapped bare generation plan unless the implementation deliberately supports it and tests that behavior.
- Missing `visualDirection.themeStrategy` fails.
- Missing `validationTargets.maxInteractionLatencyMs` fails.
- Missing `primaryViewport` inside `requiredViewports` fails.
- Existing output shape remains unchanged.
Validation:
- Positive extractor runs.
- Negative mutation tests from Task 12.
Commit milestone: `fix: validate design-agent canvas extraction`.

## Task 5 - Add Section-by-Section Construction Guidance
Reasoning: The current contract playbook explains fields, but not enough about how each section should be constructed or whether it belongs in Canvas governance, generation plan, or implementation-only context.
What to do: Add Inspiredesign-style section guidance to `design-contract-playbook.md`.
How:
1. For every top-level contract section, document `purpose`, `expectedContents`, `howToUse`, `mustNot`, and `Canvas mapping`.
2. Mark Canvas governance-relevant blocks clearly.
3. Mark `navigationModel`, `asyncModel`, and `performanceModel` as implementation context unless represented through Canvas-safe fields.
4. Explain that `generationPlan` is the mutation gate, not a generic notes bucket.
5. Explain that `designVectors` are advisory metadata and do not authorize unsupported runtime libraries.
6. Add short valid and invalid examples for the sections agents most often misuse.
Files impacted: `skills/opendevbrowser-design-agent/artifacts/design-contract-playbook.md`; reference only `src/inspiredesign/handoff.ts`, `src/inspiredesign/contract.ts`.
Dependencies: Task 2.
End goal: a cold-start agent can construct every design-contract section without guessing.
Acceptance criteria:
- Every top-level contract section has construction guidance.
- The guide separates Canvas governance from implementation-only context.
- The guide warns against patching omitted implementation context into Canvas governance.
- The guide preserves runtime library boundaries.
Validation:
- Design-agent validator checks section-guide markers after Task 10.
- Adversarial review checks the guidance against Canvas schema and Inspiredesign prior art.
Commit milestone: `docs: add design-agent canvas construction guidance`.

## Task 6 - Define Durable Design-Agent Work Products
Reasoning: Agents need durable planning and handoff artifacts across sessions, but those artifacts must not be confused with Canvas document persistence.
What to do: Add guidance for `.opendevbrowser/design-agent/<run-id>/` work products and `.tmp` scratch policy.
How:
1. Document `.opendevbrowser/design-agent/<run-id>/` as the durable design-agent workspace.
2. Define recommended generated files: `design-contract.json`, `canvas-plan.request.json`, `canvas-patch.request.json`, `canvas-starter-inventory-notes.json`, `canvas-workflow-log.md`, `design-agent-handoff.json`, and `validation-evidence.md`.
3. For each file, document `purpose`, `expectedContents`, `howToUse`, and `mustNot`.
4. State `.tmp/` is disposable scratch for command params and extractor output.
5. State Canvas documents are saved through `canvas.document.save` under `.opendevbrowser/canvas/...`.
6. Do not ship `design-agent-handoff.v1.json` in this plan; keep `design-agent-handoff.json` as a generated run file described by the work-product guide.
7. Do not add a runtime helper unless the review loop proves script-only setup is brittle.
Files impacted: `skills/opendevbrowser-design-agent/SKILL.md`, `skills/opendevbrowser-design-agent/artifacts/design-workflows.md`; possible new `skills/opendevbrowser-design-agent/artifacts/design-agent-work-products.md`.
Dependencies: Task 5.
End goal: storage guidance aligns with the project-local `.opendevbrowser` contract without drifting from Canvas persistence.
Acceptance criteria:
- Durable design-agent work products are under `.opendevbrowser/design-agent/<run-id>/`.
- `.tmp/` is scratch-only.
- `.opendevbrowser/canvas/...` remains the Canvas document/export lane.
- No guidance suggests replacing `canvas.document.save`.
Validation:
- Design-agent validator checks storage-policy markers after Task 10.
- Review verifies no conflict with `src/canvas/repo-store.ts`.
Commit milestone: included in `docs: add design-agent canvas construction guidance`.

## Task 7 - Add Concrete Canvas Patch Template and Guidance
Reasoning: The skill currently points to a `canvas-patch` file without shipping a template or teaching page, section, node, token, prototype, governance, starter, and inventory construction patterns.
What to do: Add a minimal executable `canvas.document.patch` params template and richer explanatory guidance.
How:
1. Add `skills/opendevbrowser-design-agent/assets/templates/canvas-patch.request.v1.json`.
2. Include `canvasSessionId`, `leaseId`, `baseRevision`, and `patches`.
3. Make the template a coherent smoke payload that can run after placeholders are filled, not a multi-operation catalog.
4. Include the smallest representative mutation set needed to prove governance and document construction, such as `governance.update`, one page mutation, one node insertion, and one token or node update when the IDs can be made coherent.
5. Put prototype, inventory, starter, variant, and richer operation examples in adjacent docs unless they are required for the minimal smoke payload.
6. Add adjacent docs explaining where `baseRevision` comes from and why the latest response must be used.
7. Add adjacent docs covering prototype/navigation targets, token usage, starter reuse, inventory insertion, and inventory promotion without forcing all of them into the JSON template.
8. Add guidance to read `guidance.recommendedNextCommands` after every successful command.
Files impacted: new `skills/opendevbrowser-design-agent/assets/templates/canvas-patch.request.v1.json`; `skills/opendevbrowser-design-agent/artifacts/design-workflows.md`; `skills/opendevbrowser-design-agent/artifacts/design-contract-playbook.md`.
Dependencies: Tasks 5 and 6.
End goal: agents have a copyable patch params model for Canvas document construction plus separate catalog guidance for richer operations.
Acceptance criteria:
- Patch template parses as JSON.
- Patch template includes accepted-plan, lease, and revision prerequisites.
- Patch template is a minimal executable smoke payload after placeholders are filled.
- Patch guidance covers prototype/navigation target, token usage, starter use, inventory insertion, and inventory promotion.
- Patch guidance avoids unsupported Canvas operation names.
Validation:
- Design-agent validator parses and checks patch template after Task 10.
- Focused tests from Task 11 or Task 13 verify operation names remain supported.
Commit milestone: `docs: add concrete canvas patch guidance`.

## Task 8 - Add Starter and Inventory Decision Guidance
Reasoning: Runtime starters and inventory are first-class construction paths that can reduce manual patch burden, but design-agent guidance does not currently route agents through them.
What to do: Teach when to use `canvas.starter.*` and `canvas.inventory.*` versus hand-authored patches.
How:
1. Add guidance to inspect `canvas.starter.list` before hand-authoring standard dashboard, auth, marketing, settings, or docs shells when the requested design resembles a starter.
2. Add guidance for `canvas.starter.apply`, including that it may seed a generation plan when none is accepted.
3. Require agents to inspect or align any starter-seeded plan with the design contract.
4. Add guidance to call `canvas.inventory.list` after plan acceptance.
5. Add guidance for `canvas.inventory.insert`, including accepted-plan, lease, page, parent, placement, and optional `baseRevision`.
6. Explain when to promote custom nodes into inventory.
7. Warn not to use a starter that does not satisfy the design contract.
Files impacted: `skills/opendevbrowser-design-agent/SKILL.md`, `skills/opendevbrowser-design-agent/artifacts/design-workflows.md`, `skills/opendevbrowser-design-agent/artifacts/design-contract-playbook.md`.
Dependencies: Task 7.
End goal: the skill teaches starter and inventory decision branches without hiding custom patch construction.
Acceptance criteria:
- Guidance includes `canvas.starter.list`, `canvas.starter.apply`, `canvas.inventory.list`, and `canvas.inventory.insert`.
- Guidance states prerequisites and revision behavior.
- Guidance rejects mismatched starters.
- Guidance keeps custom patching available and does not make starter use mandatory for bespoke layouts.
Validation:
- Design-agent validator checks starter and inventory markers after Task 10.
- Focused `tests/canvas-inventory.test.ts` remains green.
Commit milestone: included in `docs: add concrete canvas patch guidance`.

## Task 9 - Update Canvas Workflow Router
Reasoning: `design-workflow.sh canvas-contract` should print a cold-start-safe sequence, not missing scratch paths.
What to do: Update `design-workflow.sh canvas-contract` to print durable setup, scratch setup, extraction, plan submission, construction paths, preview, feedback, save, and export.
How:
1. Replace stale `./tmp` references with `.tmp`.
2. Print `mkdir -p .tmp`.
3. Print a run-id setup step for `.opendevbrowser/design-agent/<run-id>`.
4. Print a copy step from the design contract template into the durable run directory.
5. Print a fill-contract instruction before extraction.
6. Print extraction from durable `design-contract.json` to `.tmp/canvas-plan.request.json`.
7. Show `canvas.session.open` before plan submission.
8. Show optional extractor use with session JSON if IDs should be filled automatically.
9. Show `canvas.plan.set --params-file .tmp/canvas-plan.request.json`.
10. Show how to copy `assets/templates/canvas-patch.request.v1.json` into `.tmp/canvas-patch.request.json` and fill accepted lease, session, revision, page, and node placeholders.
11. Show optional `canvas.starter.list` and `canvas.starter.apply`.
12. Show optional `canvas.inventory.list` and `canvas.inventory.insert`.
13. Show `canvas.document.patch --params-file .tmp/canvas-patch.request.json`.
14. Keep `canvas.preview.render`, `canvas.feedback.poll`, `canvas.document.save`, and `canvas.document.export` after mutation.
Files impacted: `skills/opendevbrowser-design-agent/scripts/design-workflow.sh`, `skills/opendevbrowser-design-agent/SKILL.md`, `skills/opendevbrowser-design-agent/artifacts/design-workflows.md`.
Dependencies: Tasks 4, 6, 7, and 8.
End goal: the printed workflow can be followed without missing files, missing directories, or storage ambiguity.
Acceptance criteria:
- Router output includes `.tmp` setup.
- Router output includes `.opendevbrowser/design-agent/<run-id>` setup.
- Router output includes fill-contract step before extraction.
- Router output includes a copy/fill step from the patch template to `.tmp/canvas-patch.request.json`.
- Router output includes starter and inventory guidance.
- Router output includes preview, feedback, save, and export loop.
Validation:
- `./skills/opendevbrowser-design-agent/scripts/design-workflow.sh canvas-contract`
- Design-agent validator output-marker checks after Task 10.
Commit milestone: `fix: harden design-agent canvas workflow`.

## Task 10 - Harden Design-Agent Validator
Reasoning: The validator must catch stale guidance before agents discover the failure at runtime.
What to do: Extend `validate-skill-assets.sh` to check nested plan validity, patch template shape, storage policy, workflow output, and stale markers.
How:
1. Parse `design-contract.v1.json`.
2. Validate its `generationPlan` required nested paths.
3. Parse `canvas-generation-plan.design.v1.json`.
4. Validate its nested `generationPlan`.
5. Run `extract-canvas-plan.sh` on the full contract.
6. Validate extracted wrapper keys and nested plan paths.
7. Parse required `canvas-patch.request.v1.json`.
8. Check patch template includes `canvasSessionId`, `leaseId`, `baseRevision`, `patches`, and the minimal executable smoke operation set chosen in Task 7.
9. Check `design-workflow.sh canvas-contract` output includes `.tmp`, `.opendevbrowser/design-agent/<run-id>`, `canvas.session.open`, `canvas.plan.set`, `canvas.document.patch`, `canvas.starter.list`, `canvas.inventory.list`, `canvas.preview.render`, `canvas.feedback.poll`, `canvas.document.save`, and `canvas.document.export`.
10. Check router output includes the patch-template copy/fill step.
11. Reject stale `./tmp/design-contract.json` guidance unless it appears only inside an explicit stale-example test fixture.
12. Check docs state `.tmp` scratch-only and `.opendevbrowser/canvas` Canvas persistence.
Files impacted: `skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh`; likely related edits to templates/docs/scripts above.
Dependencies: Tasks 2 through 9.
End goal: broad marker validation becomes contract-aware enough to block the known drift classes.
Acceptance criteria:
- Validator passes on updated assets.
- Validator fails when `visualDirection.themeStrategy` is removed.
- Validator fails when `.tmp` setup is removed.
- Validator fails when durable design-agent output guidance is removed.
- Validator fails when concrete patch guidance is removed.
- Validator fails when starter or inventory guidance is removed.
Validation:
- `./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh`
- All bundled skill validators in Task 15.
Commit milestone: `test: harden design-agent canvas validation`.

## Task 11 - Add Runtime-Compatible Template Tests
Reasoning: Shell validation can drift from runtime validation, so focused Vitest coverage should call runtime validation for bundled templates.
What to do: Add tests that parse the design-agent plan templates and validate them with `validateGenerationPlan()`.
How:
1. Read `skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json`.
2. Pass `generationPlan` to `validateGenerationPlan()`.
3. Read `skills/opendevbrowser-design-agent/assets/templates/canvas-generation-plan.design.v1.json`.
4. Pass its `generationPlan` to `validateGenerationPlan()`.
5. Assert the required patch template contains `patches` and only supported representative operation names.
6. Assert the patch template is a minimal smoke payload rather than an all-operation catalog.
7. Keep these tests focused on template/runtime compatibility, not full Canvas internals.
Files impacted: `tests/skill-workflow-packs.test.ts` or a focused new test file under `tests/`; reference only `src/canvas/document-store.ts`.
Dependencies: Tasks 2, 3, and 10.
End goal: template compatibility is locked against runtime validation.
Acceptance criteria:
- Full contract `generationPlan` passes `validateGenerationPlan()`.
- Standalone Canvas plan template passes `validateGenerationPlan()`.
- Tests fail if required nested runtime fields are removed.
Validation:
- `npm run test -- tests/skill-workflow-packs.test.ts` if colocated there.
- Targeted focused test command if a new test file is created.
Commit milestone: included in `test: harden design-agent canvas validation`.

## Task 12 - Add Shared Mutation Tests
Reasoning: Per-pack validators own exact checks; shared Vitest mutation tests prove representative stale drift fails.
What to do: Add design-agent mutation cases to `tests/skill-workflow-packs.test.ts`.
How:
1. Add a mutation that removes `themeStrategy` from `design-contract.v1.json`.
2. Add a mutation that removes a required nested validation target such as `maxInteractionLatencyMs`.
3. Add a mutation that removes `.tmp` setup from `design-workflow.sh`.
4. Add a mutation that removes durable `.opendevbrowser/design-agent/<run-id>` guidance.
5. Add a mutation that removes `canvas.document.patch` or the patch template marker.
6. Add a mutation that removes `canvas.starter.list` or `canvas.inventory.list`.
7. Assert each mutation fails with a specific validator error.
Files impacted: `tests/skill-workflow-packs.test.ts`, `skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh`.
Dependencies: Task 10.
End goal: known drift classes cannot silently pass in CI.
Acceptance criteria:
- Mutation tests use the existing `runSkillValidatorWithMutation` pattern.
- Tests are representative, not exhaustive duplicates of validator internals.
- Error expectations are specific enough to diagnose the drift.
Validation:
- `npm run test -- tests/skill-workflow-packs.test.ts`
Commit milestone: included in `test: harden design-agent canvas validation`.

## Task 13 - Run Focused Canvas Runtime Tests
Reasoning: The skill guidance depends on existing runtime behavior for plan, patch, starter, inventory, preview, feedback, save, and export.
What to do: Run focused Canvas tests and add tests only if the new guidance exposes an uncovered runtime-supported path.
How:
1. Run Canvas manager tests.
2. Run Canvas document-store tests.
3. Run Canvas inventory tests.
4. Run Canvas CLI tests.
5. Add tests only when the documented guidance relies on a runtime-supported path not already covered.
6. Do not change runtime behavior to fit skill docs.
Files impacted: usually none; possible focused additions to `tests/canvas-manager.test.ts`, `tests/canvas-document-store.test.ts`, `tests/canvas-inventory.test.ts`, or `tests/cli-canvas.test.ts` only if justified.
Dependencies: Tasks 7 through 12.
End goal: documented design-agent Canvas workflow remains aligned with runtime behavior.
Acceptance criteria:
- Plan acceptance tests pass.
- Patch workflow tests pass.
- Starter and inventory tests pass.
- CLI Canvas command tests pass.
- Any new test has a direct guidance-to-runtime reason.
Validation:
- `npm run test -- tests/canvas-manager.test.ts tests/canvas-document-store.test.ts tests/canvas-inventory.test.ts tests/cli-canvas.test.ts`
Commit milestone: no separate commit unless tests are added; if tests are added, use `test: cover design-agent canvas workflow paths`.

## Task 14 - Run Real Canvas CLI Workflow Smoke
Reasoning: The user requires real workflow validation, not only static validators or unit tests.
What to do: Execute the documented Canvas workflow through the real CLI after implementation.
How:
1. Run `./skills/opendevbrowser-design-agent/scripts/design-workflow.sh canvas-contract` and use its printed sequence.
2. Create `.tmp`.
3. Create `.opendevbrowser/design-agent/<run-id>`.
4. Copy and fill `design-contract.json` into the durable run directory.
5. Extract `.tmp/canvas-plan.request.json`.
6. Open a Canvas session through CLI.
7. Submit `canvas.plan.set` with the params file.
8. Copy `canvas-patch.request.v1.json` to `.tmp/canvas-patch.request.json` and fill accepted lease, revision, page, and node placeholders.
9. Submit the minimal concrete `canvas.document.patch` params file.
10. Run preview when browser session prerequisites are available, otherwise document why a document-only path was used.
11. Poll feedback when target state permits.
12. Run `canvas.document.save`.
13. Confirm saved Canvas document path is under `.opendevbrowser/canvas/...`.
Files impacted: generated only `.tmp/*`, `.opendevbrowser/design-agent/<run-id>/*`, and `.opendevbrowser/canvas/*`.
Dependencies: Tasks 9 through 13.
End goal: the skill’s advertised workflow works through CLI.
Acceptance criteria:
- `canvas.session.open` succeeds.
- Extracted plan is accepted by `canvas.plan.set`.
- Patch command succeeds or reports a legitimate documented preflight issue.
- Save writes under `.opendevbrowser/canvas/...`.
- Generated local artifacts are not committed.
Validation:
- Record commands and outcomes in PR notes.
- If daemon/browser prerequisites block the smoke, document the exact blocker and run the closest focused CLI test suite.
Commit milestone: none; validation evidence only.

## Task 15 - Documentation Drift and Full Local Gates
Reasoning: The change touches skill docs, scripts, templates, validators, and tests. All surfaces must agree before review or commit.
What to do: Run focused gates first, then global gates.
How:
1. Search design-agent docs for stale `./tmp`.
2. Search for stale `canvas-plan.json` and `canvas-patch.json` if names changed to request-style filenames.
3. Confirm `SKILL.md`, `design-workflows.md`, `design-contract-playbook.md`, and `design-workflow.sh` agree on command order.
4. Run design-agent validator.
5. Run all skill validators.
6. Run focused skill workflow tests.
7. Run focused Canvas tests.
8. Run docs drift.
9. Run `git diff --check`.
10. Run lint, typecheck, build, extension build, and full tests.
11. Before repeating full coverage runs, compute branch coverage deficit from `coverage/lcov.info` if present and add targeted tests first when deficit remains.
Files impacted: all changed files.
Dependencies: Tasks 10 through 14.
End goal: local validation is green before adversarial review and commits.
Acceptance criteria:
- Design-agent validator passes.
- All bundled skill validators pass.
- Focused mutation and Canvas tests pass.
- Docs drift passes.
- Lint, typecheck, build, extension build, and full tests pass.
- Coverage branch deficit is checked before expensive reruns.
Validation:
- `./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh`
- All bundled skill validators, as scripted in repo tests or explicit shell loop.
- `npm run test -- tests/skill-workflow-packs.test.ts`
- `npm run test -- tests/canvas-manager.test.ts tests/canvas-document-store.test.ts tests/canvas-inventory.test.ts tests/cli-canvas.test.ts`
- `node scripts/docs-drift-check.mjs`
- `git diff --check`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run extension:build`
- `npm run test`
Commit milestone: no separate commit; required before review and staging.

## Task 16 - Scoped Adversarial Review Loop
Reasoning: The highest risk is subtle mismatch between skill examples and runtime Canvas contracts. Review must be scoped but adversarial.
What to do: Run review, fix valid findings, rerun focused validation, and repeat until clean.
How:
1. Ask reviewers to focus on runtime-invalid plan claims.
2. Ask reviewers to compare full contract and standalone Canvas plan.
3. Ask reviewers to check stale scratch path usage.
4. Ask reviewers to check accidental replacement of Canvas persistence.
5. Ask reviewers to validate patch examples against `CanvasPatch`.
6. Ask reviewers to validate starter and inventory prerequisites.
7. Fix every valid finding.
8. Rerun changed validators and focused tests after each fix set.
9. Repeat until no valid findings remain.
10. Rerun full local gates after the final fix set.
Files impacted: changed design-agent assets, tests, docs, and this plan.
Dependencies: Task 15.
End goal: no unresolved valid review findings remain.
Acceptance criteria:
- Valid review findings are fixed.
- Rejected findings cite runtime or test evidence.
- Focused validation runs after each fix set.
- Full local gates rerun after final fixes.
Validation: review artifact under `docs/reviews/` or PR notes, plus rerun command evidence.
Commit milestone: fixes fold into the relevant atomic commits.

## Task 17 - Atomic Commits
Reasoning: The user requires atomic commits at milestones, not one large commit.
What to do: Commit in logical groups after focused validation for each group.
How:
1. Inspect `git status --short`.
2. Inspect staged diffs before every commit.
3. Commit plan update if maintainers want the plan included.
4. Commit template and extractor alignment.
5. Commit docs, templates, and workflow guidance.
6. Commit validator hardening and tests.
7. Keep generated local artifacts out of commits.
8. Include exactly one `Co-authored-by: Codex <noreply@openai.com>` trailer per commit.
Files impacted: git index.
Dependencies: Tasks 15 and 16.
End goal: clean, reviewable commit series.
Acceptance criteria:
- Each commit has one coherent purpose.
- Tests travel with related implementation where practical.
- No generated scratch, Canvas output, prompt export, or continuity artifact is committed.
Validation:
- `git status --short`
- `git diff --cached --check`
- `git log --oneline --decorate -n 10`
Commit milestones:
- `docs: plan design-agent canvas contract hardening`
- `fix: align design-agent canvas generation plans`
- `fix: validate design-agent canvas extraction`
- `docs: add design-agent canvas construction guidance`
- `fix: harden design-agent canvas workflow`
- `test: harden design-agent canvas validation`

## Task 18 - PR Checks, PR Review Loop, Merge, and Final Main Verification
Reasoning: The work is complete only after PR checks, review, merge checks, merge, and final main verification pass.
What to do: Execute final delivery sequence after local gates and atomic commits.
How:
1. Push the branch only after full local gates pass.
2. Open a PR with summary, decisions, non-goals, validation evidence, real workflow evidence, and generated artifact policy.
3. Wait for PR checks.
4. Run a scoped PR review.
5. Fix all valid findings.
6. Rerun focused validation after each fix set.
7. Rerun full local gates after final PR review fixes.
8. Confirm PR checks pass.
9. Confirm branch has no conflicts.
10. Merge only when clean.
11. Update local `main`.
12. Confirm merged commits are present.
13. Run final `main` verification.
Files impacted: PR metadata and merge target.
Dependencies: Task 17.
End goal: PR is merged and final `main` verification is clean.
Acceptance criteria:
- PR checks pass.
- PR review loop has no unresolved valid findings.
- Merge checks pass.
- Local `main` verification passes.
- No generated local artifacts are committed.
Validation:
- PR checks via `gh pr checks --watch` or repo-standard equivalent.
- Mergeability and conflict check.
- Final `main`: clean `git status --short`, design-agent validator, all skill validators, focused skill workflow tests, focused Canvas tests, docs drift.
Commit milestone: no new implementation commit unless PR feedback requires one.

## Verification Matrix
| Area | Gate | Method | Required Result |
|---|---|---|---|
| Full contract plan | Runtime shape | `validateGenerationPlan(design-contract.generationPlan)` | `ok: true` |
| Standalone plan | Runtime shape | `validateGenerationPlan(canvas-generation-plan.generationPlan)` | `ok: true` |
| Extractor | Positive | `extract-canvas-plan.sh design-contract.v1.json` | valid wrapper JSON |
| Extractor | Negative | mutation removes nested required field | validator fails |
| Patch template | Static shape | design-agent validator | lease, revision, patches, representative ops present |
| Workflow router | Static output | `design-workflow.sh canvas-contract` | ordered executable workflow |
| Scratch policy | Static marker | design-agent validator | `.tmp` scratch-only |
| Durable work products | Static marker | design-agent validator | `.opendevbrowser/design-agent/<run-id>` documented |
| Canvas persistence | Static marker and review | validator plus review | `.opendevbrowser/canvas/...` preserved |
| Starter guidance | Static marker | validator | starter list/apply present |
| Inventory guidance | Static marker | validator | inventory list/insert present |
| Mutation tests | Shared Vitest | `npm run test -- tests/skill-workflow-packs.test.ts` | stale guidance fails |
| Canvas runtime | Focused tests | Canvas manager/store/inventory/CLI tests | pass |
| Real CLI smoke | Manual local workflow | open, plan set, patch, save | plan accepted and saved under `.opendevbrowser/canvas/...` |
| Docs drift | Static docs check | `node scripts/docs-drift-check.mjs` | pass |
| Full quality | Repo gates | lint, typecheck, build, extension build, full test | pass |
| Review | Adversarial loop | review, fix, rerun | no unresolved valid findings |
| PR | CI and review | PR checks and review | pass |
| Merge | Main verification | focused final checks | pass |

## Implementation and PR Sequence
1. Plan commit if included in the implementation PR.
2. Template and extractor commit.
3. Contract construction, patch, starter, inventory, and storage guidance commit.
4. Workflow router commit.
5. Validator and test commit.
6. Focused local validation.
7. Real Canvas CLI workflow smoke.
8. Scoped adversarial review loop, with fixes folded into relevant commits.
9. Full local gates.
10. Push branch and create PR.
11. PR checks and PR review loop.
12. Merge only when checks and review are clean.
13. Final `main` verification.

## Open Questions
- Whether to add a runtime helper for `.opendevbrowser/design-agent/<run-id>` should remain deferred unless implementation review proves script-only guidance is brittle.

## Version History
- `2026-06-18`: Initial implementation-ready plan created from design-agent Canvas architecture review, seam-mapping agents, and context-builder draft.
- `2026-06-18`: Folded bounded plan critique: pinned runtime value authority, minimal patch-template shape, extractor input contract, handoff-template deferral, advisory starter guidance, and patch-template workflow setup.
