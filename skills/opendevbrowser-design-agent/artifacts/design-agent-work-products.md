# Design-Agent Work Products

Design-agent work products preserve planning, evidence, and handoff context for a single run. They do not replace Canvas document persistence.

## Storage Policy

- Durable design-agent files live under `.opendevbrowser/design-agent/<run-id>/`.
- `.tmp/` is disposable scratch for command params, extracted request JSON, and short-lived shell output only.
- Canvas documents are persisted by `canvas.document.save` under `.opendevbrowser/canvas/...`.
- Canvas exports are produced by `canvas.document.export`; keep export paths separate from planning notes.
- Do not commit generated `.opendevbrowser/design-agent/<run-id>/`, `.opendevbrowser/canvas/...`, `.tmp/`, or local evidence bundles unless a maintainer explicitly asks.

## Recommended Run Layout

```text
.opendevbrowser/design-agent/<run-id>/
  design-contract.json
  canvas-plan.request.json
  canvas-patch.request.json
  canvas-starter-inventory-notes.json
  canvas-workflow-log.md
  design-agent-handoff.json
  validation-evidence.md
```

## Work Product Guide

### `design-contract.json`

- purpose: the durable full contract for the run.
- expectedContents: filled `intent`, `designLanguage`, `contentModel`, `navigationModel`, `asyncModel`, `layoutSystem`, `typographySystem`, `motionSystem`, `performanceModel`, `responsiveSystem`, `accessibilityPolicy`, and runtime-safe `generationPlan`.
- howToUse: copy from `assets/templates/design-contract.v1.json`, fill from the brief and evidence, then extract the Canvas plan from this file.
- mustNot: do not use it as a scratch params file, and do not add unsupported Canvas runtime fields inside `generationPlan`.
- Canvas mapping: `generationPlan` is submitted through `canvas.plan.set`; the richer contract sections guide patch construction and implementation decisions.

### `canvas-plan.request.json`

- purpose: durable copy of the accepted or candidate `canvas.plan.set` request.
- expectedContents: `requestId`, `canvasSessionId`, `leaseId`, `documentId`, and `generationPlan`.
- howToUse: generate from `design-contract.json` into `.tmp/canvas-plan.request.json`, fill IDs from `canvas.session.open`, submit with `canvas.plan.set`, then copy the accepted version back into the run directory.
- mustNot: do not keep stale IDs after opening a new session, and do not treat accepted plan status as permission to ignore later preflight blockers.
- Canvas mapping: plan acceptance is the mutation gate before `canvas.document.patch`, starter, or inventory mutation.

### `canvas-patch.request.json`

- purpose: durable copy of the patch request used to construct or update the Canvas document.
- expectedContents: `canvasSessionId`, `leaseId`, latest numeric `baseRevision`, and a coherent `patches` array.
- howToUse: copy `assets/templates/canvas-patch.request.v1.json` to `.tmp/canvas-patch.request.json`, fill accepted session, lease, revision, page, and node placeholders, run `canvas.document.patch`, then copy the exact submitted request into the run directory.
- mustNot: do not use old `baseRevision`, unsupported operation names, or mismatched page and node IDs.
- Canvas mapping: patches create pages, nodes, tokens, governance metadata, prototype links, starter output adjustments, and inventory insertions.

### `canvas-starter-inventory-notes.json`

- purpose: record advisory starter and inventory decisions.
- expectedContents: starter candidates reviewed, chosen or rejected starter IDs, inventory items reviewed, inserted item IDs, placement targets, and rejection reasons.
- howToUse: fill after `canvas.starter.list` and `canvas.inventory.list`; update after `canvas.starter.apply`, `canvas.inventory.insert`, or inventory promotion.
- mustNot: do not force a starter when the design contract calls for a bespoke layout.
- Canvas mapping: starter and inventory decisions inform whether construction begins from an existing shell, reusable inventory item, or hand-authored patch.

### `canvas-workflow-log.md`

- purpose: human-readable command and outcome log.
- expectedContents: command order, response file paths, plan status, accepted lease, base revision changes, preview target IDs, feedback blockers, save path, and export path.
- howToUse: append short entries after each Canvas command whose output changes the next step.
- mustNot: do not paste secrets, cookies, or full page data.
- Canvas mapping: the log tracks the preview, feedback, save, and export loop.

### `design-agent-handoff.json`

- purpose: generated run summary for another agent or future session.
- expectedContents: contract path, accepted plan path, latest patch path, starter and inventory notes path, validation evidence path, saved Canvas document path, export path, open blockers, and next recommended command.
- howToUse: create this file from actual run evidence when handing off work.
- mustNot: do not treat this as a shipped template contract, and do not invent paths that were not generated.
- Canvas mapping: handoff points to Canvas state and work products; it is not a Canvas document.

### `validation-evidence.md`

- purpose: concise proof that the result matched the contract.
- expectedContents: preview results, feedback results, screenshots or references when available, accessibility checks, responsive checks, and unresolved risks.
- howToUse: update after `canvas.preview.render`, `canvas.feedback.poll`, `canvas.preview.refresh`, browser validation, save, and export.
- mustNot: do not mark missing evidence as pass.
- Canvas mapping: validation evidence proves the saved or exported Canvas document is ready for the requested use.

## Scratch Files

Use `.tmp/` for files that can be safely regenerated:

- `.tmp/canvas-plan.request.json`
- `.tmp/canvas-patch.request.json`
- `.tmp/canvas-session.open.json`
- `.tmp/canvas-plan.set.json`
- `.tmp/canvas-document.patch.json`
- `.tmp/canvas-preview.render.json`
- `.tmp/canvas-feedback.poll.json`
- `.tmp/canvas-document.save.json`
- `.tmp/canvas-document.export.json`

Copy only the finalized, useful subset into `.opendevbrowser/design-agent/<run-id>/` after the command succeeds.
