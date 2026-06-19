# Design Workflows

This file turns the design-agent skill into repeatable execution paths.

## Shared Storage Rules

- Durable design-agent work products live under `.opendevbrowser/design-agent/<run-id>/`.
- `.tmp/` is scratch-only for command params, extractor output, and transient response captures.
- Canvas document persistence belongs to `canvas.document.save` under `.opendevbrowser/canvas/...`.
- Canvas export belongs to `canvas.document.export`; record the export path in the run log.
- Use `artifacts/design-agent-work-products.md` for per-file purpose, expectedContents, howToUse, mustNot, and Canvas mapping.

## Workflow A - Contract-First Frontend Delivery

Use when the task starts from a PRD, issue, or user request.

1. Fill `assets/templates/design-brief.v1.md`.
2. Translate the brief into `assets/templates/design-contract.v1.json`.
3. Check `artifacts/opendevbrowser-ui-example-map.md` for nearby repo patterns worth reusing.
4. If a nearby shipped surface exists, review `artifacts/existing-surface-adaptation.md` before changing shells or component anatomy.
5. Pick the dominant screen family from `artifacts/component-pattern-index.md`.
6. Declare shell and route ownership with `artifacts/app-shell-and-state-wiring.md`.
7. Declare state ownership using `artifacts/state-ownership-matrix.md`.
8. Declare navigation and deep-link ownership in the contract before route-changing controls are wired.
9. Declare async and search ownership with `artifacts/async-search-state-ownership.md`.
10. Declare theme and token ownership with `artifacts/theming-and-token-ownership.md`.
11. Declare loading, empty, error, and transient feedback behavior with `artifacts/loading-and-feedback-surfaces.md`.
12. If the surface is scan-heavy or pane-heavy, declare the performance posture with `artifacts/performance-audit-playbook.md` before implementation.
13. If motion depends on scroll or pinned stages, add `artifacts/scroll-reveal-surface-planning.md` to the contract inputs.
14. Confirm the contract answers audience, task, message hierarchy, route ownership, async ownership, layout, theme, type, motion, responsive rules, accessibility, and validation.
15. Review `artifacts/frontend-evaluation-rubric.md` and `artifacts/implementation-anti-patterns.md`.
16. Implement the smallest coherent slice that satisfies the contract.
17. Validate in an isolated fixture first, then in a real browser before declaring the work complete.

## Workflow B - Screenshot Or Existing-Page Audit

Use when a screenshot, mock, or live page is the starting point.

1. Identify hierarchy, grid, spacing, type, color, contrast, token system, interaction states, and accessibility.
2. Convert observations into the shared design contract.
3. Map the screen to one dominant family from `artifacts/component-pattern-index.md`.
4. If the repo already ships a related shell or surface, review `artifacts/existing-surface-adaptation.md`.
5. Flag unknown mobile behavior, unknown route behavior, missing states, layout-shifting placeholders, unstable identity, token drift, and inaccessible focus treatment.
6. Cross-check async, theme, feedback, and scroll guidance when those lanes matter.
7. Check `artifacts/implementation-anti-patterns.md` for ownership or pattern drift traps.
8. Record the audit in `assets/templates/design-audit-report.v1.md`.
9. Implement changes only after the contract reflects the intended end state.

## Workflow C - `/canvas` Contract-Governed Iteration

Use when the work should flow through the OpenDevBrowser design canvas.

### Cold-Start Flow

1. Create `.tmp/` for scratch command params and response captures.
2. Create `.opendevbrowser/design-agent/<run-id>/` for durable work products.
3. Copy `assets/templates/design-contract.v1.json` to `.opendevbrowser/design-agent/<run-id>/design-contract.json`.
4. Fill the full contract before extracting the Canvas request. Use `artifacts/design-contract-playbook.md` for section guidance.
5. Open a Canvas session with `canvas.session.open` and capture the response in `.tmp/canvas-session.open.json`.
6. Extract the plan request into `.tmp/canvas-plan.request.json` by passing the filled contract and `.tmp/canvas-session.open.json` to `scripts/extract-canvas-plan.sh`.
7. Read handshake fields before continuing: `planStatus`, `preflightState`, `generationPlanRequirements.allowedValues`, `generationPlanIssues`, `guidance.recommendedNextCommands`, `guidance.nextStepGuidance`, `guidance.paramsExamples`, field examples, validation checks, and do-not-proceed blockers.
8. Treat `preflightState="handshake_read"` as the normal first-step checkpoint before `canvas.plan.set`.
9. Submit `canvas.plan.set --params-file .tmp/canvas-plan.request.json`.
10. If the plan reaches `plan_accepted`, copy the accepted params or response summary into `.opendevbrowser/design-agent/<run-id>/canvas-plan.request.json` and record the accepted lease.
11. If the plan is `plan_invalid` or fails with `generation_plan_invalid`, repair `.tmp/canvas-plan.request.json` from `guidance.paramsExamples`, typed repair details, and `generationPlanIssues` before any mutation.
12. Use `canvas.plan.get` only when diagnostics are still needed after reading the repair examples.
13. Copy `assets/templates/canvas-patch.request.v1.json` to `.tmp/canvas-patch.request.json`.
14. Fill the patch request with `canvasSessionId`, `leaseId`, latest numeric `baseRevision`, target page IDs, node IDs, and token IDs from accepted Canvas responses.
15. Optionally inspect `canvas.starter.list` before hand-authoring common dashboard, auth, marketing, settings, or docs shells. Starter use is advisory, not mandatory for bespoke layouts.
16. If a starter matches the contract, use `canvas.starter.apply`, then inspect or align any starter-seeded plan before continuing.
17. Call `canvas.inventory.list` after plan acceptance when reusable sections or components could reduce manual patching.
18. Use `canvas.inventory.insert` only when the inventory item fits the accepted plan, lease, page, parent, and placement.
19. Submit `canvas.document.patch --params-file .tmp/canvas-patch.request.json`.
20. Copy the exact submitted patch into `.opendevbrowser/design-agent/<run-id>/canvas-patch.request.json` after it succeeds.
21. Render preview with `canvas.preview.render`.
22. Poll feedback with `canvas.feedback.poll`; if a preflight blocker appears, return to plan repair before continuing.
23. Refresh preview when needed with `canvas.preview.refresh`.
24. Before save, patch every `requiredBeforeSave` governance block reported by the handshake or policy warnings. The shipped patch template is a minimal mutation smoke payload, not a complete design-ready document.
25. Save with `canvas.document.save`; saved Canvas documents belong under `.opendevbrowser/canvas/...`.
26. Export with `canvas.document.export` and record the export path in the workflow log.
27. Update `.opendevbrowser/design-agent/<run-id>/validation-evidence.md` and `design-agent-handoff.json` from actual evidence.

### Patch Construction Rules

- Read `guidance.recommendedNextCommands` after every successful Canvas command.
- Use the latest response revision as a numeric `baseRevision`; stale revisions must be refreshed before patching.
- Keep the shipped patch template minimal and executable after placeholders are filled.
- Put richer prototype, starter, inventory, variant, and token examples in docs and notes rather than bloating the JSON template.
- Use prototype targets only when navigation ownership is defined in the contract.
- Use tokens for reusable values instead of repeated raw color, spacing, radius, shadow, type, or motion values.
- Promote custom nodes into inventory only after preview and feedback prove they are reusable.

### Canonical Command Order

Use `--output-format json` whenever returned IDs, statuses, guidance, or follow-up fields are read from Canvas command output.

```bash
mkdir -p .tmp
RUN_ID="${RUN_ID:-design-$(date -u +%Y%m%dT%H%M%SZ)}"
DESIGN_RUN_DIR=".opendevbrowser/design-agent/$RUN_ID"
mkdir -p "$DESIGN_RUN_DIR"
cp skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json "$DESIGN_RUN_DIR/design-contract.json"
# Fill "$DESIGN_RUN_DIR/design-contract.json" before opening the session and extracting.
npx opendevbrowser canvas --command canvas.session.open --params '{"requestId":"req_open_01","browserSessionId":"<browser-session-id>","documentId":null,"repoPath":null,"mode":"dual-track"}' --output-format json | tee .tmp/canvas-session.open.json
./skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh "$DESIGN_RUN_DIR/design-contract.json" .tmp/canvas-session.open.json > .tmp/canvas-plan.request.json
# Treat preflightState=handshake_read as the normal first-step checkpoint before canvas.plan.set.
npx opendevbrowser canvas --command canvas.plan.set --params-file .tmp/canvas-plan.request.json --output-format json | tee .tmp/canvas-plan.set.json
# If canvas.plan.set succeeds with planStatus=accepted or preflightState=plan_accepted, copy the accepted request to the durable run directory.
# If canvas.plan.set returns generation_plan_invalid or plan_invalid, repair .tmp/canvas-plan.request.json from guidance.paramsExamples and generationPlanIssues before retrying.
# Optional diagnostics after generation_plan_invalid:
# npx opendevbrowser canvas --command canvas.plan.get --params '{"requestId":"req_plan_get_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>"}' --output-format json
cp .tmp/canvas-plan.request.json "$DESIGN_RUN_DIR/canvas-plan.request.json"
cp skills/opendevbrowser-design-agent/assets/templates/canvas-patch.request.v1.json .tmp/canvas-patch.request.json
# Fill .tmp/canvas-patch.request.json with accepted session, lease, numeric baseRevision, page, node, and token placeholders.
# Optional advisory starter path:
npx opendevbrowser canvas --command canvas.starter.list --params '{"requestId":"req_starter_list_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>"}' --output-format json
# npx opendevbrowser canvas --command canvas.starter.apply --params '{"requestId":"req_starter_apply_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","starterId":"<starter-id>","documentId":"<document-id>"}' --output-format json
# Optional advisory inventory path:
npx opendevbrowser canvas --command canvas.inventory.list --params '{"requestId":"req_inventory_list_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>"}' --output-format json
# npx opendevbrowser canvas --command canvas.inventory.insert --params '{"requestId":"req_inventory_insert_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>","itemId":"<inventory-item-id>","pageId":"<page-id>","parentId":"<parent-node-id>","placement":"append","baseRevision":0}' --output-format json
npx opendevbrowser canvas --command canvas.document.patch --params-file .tmp/canvas-patch.request.json --output-format json | tee .tmp/canvas-document.patch.json
cp .tmp/canvas-patch.request.json "$DESIGN_RUN_DIR/canvas-patch.request.json"
npx opendevbrowser canvas --command canvas.preview.render --params '{"requestId":"req_preview_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","targetId":"<target-id>","prototypeId":"<prototype-id>"}' --output-format json | tee .tmp/canvas-preview.render.json
npx opendevbrowser canvas --command canvas.feedback.poll --params '{"requestId":"req_feedback_01","canvasSessionId":"<canvas-session-id>","documentId":"<document-id>","targetId":"<target-id>","afterCursor":null}' --output-format json | tee .tmp/canvas-feedback.poll.json
# Patch all requiredBeforeSave governance blocks before save; the minimal patch template only proves mutation shape.
npx opendevbrowser canvas --command canvas.document.save --params '{"requestId":"req_save_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>","repoPath":null}' --output-format json | tee .tmp/canvas-document.save.json
npx opendevbrowser canvas --command canvas.document.export --params '{"requestId":"req_export_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>","exportTarget":"html_bundle"}' --output-format json | tee .tmp/canvas-document.export.json
```

## Workflow D - Real-Surface Validation

Use when design quality must be demonstrated, not inferred.

1. Validate the final or intermediate UI in a real browser session.
2. Validate the same state matrix in an isolated preview or fixture when the component family is still moving.
3. Confirm the preview installs deterministic data and the same theme or token dependencies the real surface expects.
4. If the interaction is scroll-driven, confirm the live surface still matches `artifacts/scroll-reveal-surface-planning.md`.
5. Capture snapshots, screenshots, and debug traces when behavior or styling is dynamic.
6. Confirm responsive layouts, focus visibility, keyboard reachability, expected states, search or filter transitions, and no console or network regressions.
7. If parity matters, repeat across supported surfaces before sign-off.

## Workflow E - Performance Audit

Use when the screen is visually correct but interaction quality is poor.

1. Describe the slow interaction, viewport, and data size.
2. Capture a baseline with the framework profiler or browser performance tooling.
3. Use `artifacts/performance-audit-playbook.md` to classify the problem.
4. If scroll progression is part of the issue, verify the single progress owner with `artifacts/scroll-reveal-surface-planning.md`.
5. Record evidence and fixes in `assets/templates/design-audit-report.v1.md`.
6. Re-measure before declaring the issue fixed.

Recommended command sequence:

```bash
npx opendevbrowser launch --no-extension --start-url https://example.com
npx opendevbrowser snapshot --session-id <session-id>
npx opendevbrowser screenshot --session-id <session-id>
npx opendevbrowser debug-trace-snapshot --session-id <session-id>
```

## Workflow F - Ship Audit

Use after implementation and before final sign-off.

1. Re-read the design contract.
2. Compare the shipped output against the contract and the rubric.
3. Re-check shell and route ownership against `artifacts/app-shell-and-state-wiring.md`.
4. Re-check whether the work extended the nearest shipped surface appropriately with `artifacts/existing-surface-adaptation.md`.
5. Re-check state and overlay ownership against `artifacts/state-ownership-matrix.md`.
6. Re-check async, theme, feedback, scroll, release, and anti-pattern artifacts.
7. Re-run the relevant skill validators.
8. Update README, CLI docs, architecture docs, AGENTS, and skill docs if user-visible behavior changed.
9. Record blockers explicitly; do not convert uncertainty into a pass.
