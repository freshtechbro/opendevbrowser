# Design Workflows

This file turns the design-agent skill into repeatable execution paths.

## Workflow A — Contract-First Frontend Delivery

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
11. Declare loading, empty/error, and transient feedback behavior with `artifacts/loading-and-feedback-surfaces.md`.
12. If the surface is scan-heavy or pane-heavy, declare the performance posture with `artifacts/performance-audit-playbook.md` before implementation.
13. If motion depends on scroll or pinned stages, add `artifacts/scroll-reveal-surface-planning.md` to the contract inputs.
14. Confirm the contract answers:
   - audience and task
   - primary and secondary message
   - route owner, deep-link policy, and invalid-route fallback
   - async trigger, query ownership, and restart policy
   - layout approach
   - list identity and heavy-surface strategy
   - theme and token source
   - type system
   - motion posture
   - responsive rules
   - accessibility target
   - loading, empty, error, and transient feedback plan
   - validation plan
15. Review `artifacts/frontend-evaluation-rubric.md` and `artifacts/implementation-anti-patterns.md`.
16. Implement the smallest coherent slice that satisfies the contract.
17. Validate in an isolated fixture first, then in a real browser before declaring the work complete.

## Workflow B — Screenshot Or Existing-Page Audit

Use when a screenshot, mock, or live page is the starting point.

1. Identify the visible structure:
   - information hierarchy
   - grid or container model
   - spacing rhythm
   - typography scale
   - color, contrast, and token system
   - interaction states
   - loading and transient feedback surfaces
2. Convert those observations into the shared design contract.
3. Map the screen to one dominant family from `artifacts/component-pattern-index.md`.
4. If the repo already ships a related shell or surface, review `artifacts/existing-surface-adaptation.md`.
5. Flag gaps explicitly:
   - unknown mobile behavior
   - unknown route, deep-link, or invalid-param fallback behavior
   - unknown query, filter, or sort ownership
   - missing empty/loading/error states
   - layout-shifting placeholders or spinner stacking
   - unstable row or card identity under filtering, sorting, or refresh
   - raw-value token drift across repeated components
   - inaccessible focus treatment
   - inconsistent spacing or type rules
6. If search, async work, theming, transient feedback, or scroll-driven motion matter to the task, cross-check:
   - `artifacts/async-search-state-ownership.md`
   - `artifacts/theming-and-token-ownership.md`
   - `artifacts/loading-and-feedback-surfaces.md`
   - `artifacts/scroll-reveal-surface-planning.md`
7. Check `artifacts/implementation-anti-patterns.md` for ownership or pattern drift traps.
8. Record the audit in `assets/templates/design-audit-report.v1.md`.
9. Implement changes only after the contract reflects the intended end state.

## Workflow C — `/canvas` Contract-Governed Iteration

Use when the work should flow through the OpenDevBrowser design canvas.

1. Open a canvas session.
2. Read the handshake and document context.
3. Fill the full design contract.
4. Extract the `generationPlan`.
5. Send `canvas.plan.set`.
6. Mutate with `canvas.document.patch`.
7. Poll feedback and refresh preview until the contract and runtime match.

Canonical command order:

```bash
npx opendevbrowser canvas --command canvas.session.open --params '{"requestId":"req_open_01","browserSessionId":"<browser-session-id>","documentId":null,"repoPath":null,"mode":"dual-track"}'
npx opendevbrowser canvas --command canvas.plan.set --params-file ./tmp/canvas-plan.json
npx opendevbrowser canvas --command canvas.document.patch --params-file ./tmp/canvas-patch.json
npx opendevbrowser canvas --command canvas.feedback.poll --params '{"requestId":"req_feedback_01","canvasSessionId":"<canvas-session-id>","documentId":"<document-id>","targetId":"<target-id>","afterCursor":null}'
npx opendevbrowser canvas --command canvas.preview.render --params '{"requestId":"req_preview_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","targetId":"<target-id>","projection":"canvas_html"}'
```

## Workflow D — Real-Surface Validation

Use when design quality must be demonstrated, not inferred.

1. Validate the final or intermediate UI in a real browser session.
2. Validate the same state matrix in an isolated preview or fixture when the component family is still moving.
3. Confirm the preview installs deterministic data and the same theme or token dependencies the real surface expects.
4. If the interaction is scroll-driven, confirm the live surface still matches `artifacts/scroll-reveal-surface-planning.md`.
5. Capture:
   - snapshots for structure
   - screenshots for visual output
   - debug traces when behavior or styling is dynamic
6. Confirm:
   - expected layout at mobile, tablet, and desktop widths
   - focus visibility and keyboard reachability
   - loading, error, success, and empty states where relevant
   - search, filter, or sort transitions do not surface stale or duplicated results
   - no console or network regressions caused by the UI change
7. If parity matters, repeat across supported surfaces before sign-off.

## Workflow E — Performance Audit

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

## Workflow F — Ship Audit

Use after implementation and before final sign-off.

1. Re-read the design contract.
2. Compare the shipped output against the contract and the rubric.
3. Re-check shell and route ownership against `artifacts/app-shell-and-state-wiring.md`.
4. Re-check whether the work extended the nearest shipped surface appropriately with `artifacts/existing-surface-adaptation.md`.
5. Re-check state and overlay ownership against `artifacts/state-ownership-matrix.md`.
6. Re-check:
   - `artifacts/async-search-state-ownership.md`
   - `artifacts/theming-and-token-ownership.md`
   - `artifacts/loading-and-feedback-surfaces.md`
   - `artifacts/scroll-reveal-surface-planning.md`
7. Re-scan `artifacts/implementation-anti-patterns.md` for any regressions introduced during polishing.
8. Re-run the relevant skill validators.
9. Update README, CLI docs, architecture docs, AGENTS, and skill docs if any user-visible behavior changed.
10. Record blockers explicitly; do not convert uncertainty into a pass.
