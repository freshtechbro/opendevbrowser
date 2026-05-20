# Design Canvas Technical Spec

Status: active  
Last updated: 2026-05-19

## Overview

OpenDevBrowser's design-canvas subsystem is the typed design surface for session-backed document editing, reusable inventory insertion, starter seeding, preview generation, overlay selection, and feedback collection. The public command entrypoints are `opendevbrowser_canvas` and `npx opendevbrowser canvas`.

## Runtime layers

| Layer | Source of truth | Responsibility |
|------|------------------|----------------|
| Tool/CLI surface | `src/tools/canvas.ts`, `src/cli/commands/canvas.ts` | Expose the public `canvas.*` command surface |
| Browser orchestration | `src/browser/canvas-manager.ts` | Session leases, command routing, document lifecycle, preview, overlay, feedback |
| Browser support | `src/browser/canvas-code-sync-manager.ts`, `src/browser/canvas-session-sync-manager.ts`, `src/browser/canvas-runtime-preview-bridge.ts` | Code sync, attach state, runtime-bound preview reconciliation |
| Document core | `src/canvas/document-store.ts`, `src/canvas/types.ts` | Typed document model, validation, patches, revisioning |
| Persistence + adapters | `src/canvas/repo-store.ts`, `src/canvas/framework-adapters/*`, `src/canvas/library-adapters/*`, `src/canvas/adapter-plugins/*` | Repo persistence, built-in adapter lanes, BYO plugins |
| Extension runtime | `extension/src/canvas/canvas-runtime.ts`, `extension/canvas.html` | Design-tab UI, overlay sync, extension-hosted canvas runtime |

## Canonical document model

`CanvasDocument` is defined in `src/canvas/types.ts` and persisted through `src/canvas/repo-store.ts`.

Required top-level areas:
- governance blocks (`intent`, `generationPlan`, `designLanguage`, `contentModel`, `layoutSystem`, `typographySystem`, `colorSystem`, `surfaceSystem`, `iconSystem`, `motionSystem`, `responsiveSystem`, `accessibilityPolicy`, `libraryPolicy`, `runtimeBudgets`)
- pages and nodes
- component inventory
- tokens
- assets
- bindings
- prototypes
- document metadata

## Advanced motion advisory boundary

Canvas design contracts may record shader-like, WebGL-style, Spline-style, or spatial motion ideas as advisory cues in `generationPlan.designVectors` and `motionSystem`. Those cues describe desired hierarchy, timing, depth, or transition intent only.

Advisory motion cues do not add runtime support, authorize new dependencies, or change the accepted `CanvasGenerationPlan` field set. `libraryPolicy.motion` and `libraryPolicy.threeD` stay empty unless a separate runtime implementation explicitly approves those lanes. Canvas mutation and save/export validation reject non-empty `libraryPolicy.motion` or `libraryPolicy.threeD` runtime authorizations. The default canvas projection must still be implementable with the currently approved primitives.

## Public canvas command families

Canonical inventory lives in `src/browser/canvas-manager.ts` (`PUBLIC_CANVAS_COMMANDS`) and is mirrored in `docs/SURFACE_REFERENCE.md`. Current public families:

- `canvas.session.*`: open, attach, status, close
- `canvas.document.*`: load, import, patch, save, export
- `canvas.history.*`: undo, redo
- `canvas.inventory.*`: list, insert
- `canvas.starter.*`: list, apply
- `canvas.tab.*`: public tab commands are open and close; extension `canvas.tab.sync` is an internal runtime capability, not a public command
- `canvas.overlay.*`: public overlay commands are mount, unmount, and select; extension `canvas.overlay.sync` is an internal runtime capability, not a public command
- `canvas.preview.*`: render, refresh
- `canvas.feedback.*`: poll, subscribe, next, unsubscribe
- `canvas.code.*`: bind, unbind, pull, push, status, resolve

## Operator loop

Use this runtime-backed sequence when an agent needs next-step guidance instead of inferring it from raw state:

1. `canvas.session.open`
2. Inspect the handshake:
   - `planStatus`
   - `preflightState`
   - `generationPlanRequirements.requiredBeforeMutation`
   - `generationPlanRequirements.allowedValues`
   - `generationPlanIssues`
   - `mutationPolicy.allowedBeforePlan`
   - `guidance.recommendedNextCommands`
   - `guidance.reason`
   - `guidance.nextStepGuidance` when present
   - `guidance.paramsExamples`, `guidance.fieldExamples`, `guidance.validationChecks`, and `guidance.doNotProceedIf` when a repair envelope is present
3. `canvas.plan.set`
4. If the plan is accepted, follow the returned guidance into `canvas.document.patch`
5. `canvas.preview.render`
6. `canvas.feedback.poll`
7. `canvas.document.save` or `canvas.document.export`

Canvas guidance is centrally constructed with shared next-step advisory builders, but the public Canvas response stays Canvas-shaped:
`guidance.recommendedNextCommands`, `guidance.reason`, and blocker `requiredNextCommands`. Repairable responses also expose typed `nextStepGuidance`, params examples, field examples, validation checks, and do-not-proceed blockers under `guidance`.

`canvas.plan.get` and `canvas.capabilities.get` remain useful when an invalid plan response needs to be re-read after failure or attach, but they are not required after a successful `canvas.plan.set`.

## Plan-state semantics

- Missing plan:
  - `planStatus: "missing"`
  - `preflightState: "handshake_read"`
  - next step is `canvas.plan.set`
  - repair guidance includes a valid params-file shape with `canvasSessionId`, `leaseId`, and `generationPlan`
- Invalid plan:
  - `planStatus: "invalid"`
  - `preflightState: "plan_invalid"`
  - handshake and capabilities calls expose `generationPlanIssues`
  - `canvas.plan.set` fails with `generation_plan_invalid` and returns `details.missingFields` plus `details.issues`
  - repair guidance includes `guidance.paramsExamples`, issue-specific `guidance.fieldExamples`, `guidance.validationChecks`, and `guidance.doNotProceedIf`
  - `canvas.feedback.poll` synthesizes the same preflight blocker until the plan is fixed
- Accepted plan:
  - `planStatus: "accepted"`
  - `preflightState: "plan_accepted"`
  - mutation guidance moves to patch -> preview -> feedback -> save/export
  - save/export can still be blocked by missing governance, so follow `governance.update` field examples before treating the document as complete

## Repair examples

When `canvas.plan.set` returns `generation_plan_invalid`, do not continue to patch, preview, or save. Read `guidance.nextStepGuidance.readiness`, then copy the closest `guidance.paramsExamples[]` entry into a params file and retry:

```bash
npx opendevbrowser canvas --command canvas.plan.set --params-file ./canvas-plan.repaired.json --output-format json
```

A minimal repair params file must keep these identifiers from `canvas.session.open` and include every required generation-plan block:

```json
{
  "canvasSessionId": "<canvas-session-id>",
  "leaseId": "<lease-id>",
  "generationPlan": {
    "targetOutcome": {
      "mode": "high-fi-live-edit",
      "summary": "Produce an evidence-backed, responsive landing page iteration."
    },
    "visualDirection": { "profile": "cinematic-minimal", "themeStrategy": "single-theme" },
    "layoutStrategy": {
      "approach": "hero-led composition with clear content sections",
      "navigationModel": "global-header"
    },
    "contentStrategy": {
      "source": "design brief, harvested references, and current project content"
    },
    "componentStrategy": {
      "mode": "reuse existing components before creating new primitives",
      "interactionStates": ["default", "hover", "focus", "disabled"]
    },
    "motionPosture": { "level": "subtle", "reducedMotion": "respect-user-preference" },
    "responsivePosture": {
      "primaryViewport": "desktop",
      "requiredViewports": ["desktop", "tablet", "mobile"]
    },
    "accessibilityPosture": { "target": "WCAG_2_2_AA", "keyboardNavigation": "full" },
    "validationTargets": {
      "blockOn": ["contrast-failure", "missing-intent", "missing-design-language"],
      "requiredThemes": ["light"],
      "browserValidation": "required",
      "maxInteractionLatencyMs": 150
    },
    "interactionMoments": ["primary CTA hover", "keyboard focus ring", "mobile navigation open"],
    "materialEffects": ["soft depth on primary surfaces"],
    "designVectors": {
      "density": "editorial",
      "imagery": "dominant first-viewport visual plane"
    }
  }
}
```

When save/export reports missing governance, patch the named blocks before saving:

```bash
npx opendevbrowser canvas --command canvas.document.patch \
  --params '{"canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","baseRevision":1,"patches":[{"op":"governance.update","block":"intent","changes":{"summary":"Evidence-backed landing page direction","audience":"Primary buyer","successCriteria":["Ready references are reflected in hero hierarchy"]}}]}' \
  --output-format json
```

## Projection boundary

- `canvas_html` is the default preview/export contract and compatibility fallback.
- `bound_app_runtime` is opt-in only and requires the binding plus target app instrumentation to satisfy preflight.
- If runtime bridge preflight fails, the manager falls back to core-generated `canvas_html` projection.
- Docs and AGENTS must not over-claim `bound_app_runtime` parity when the safe fallback is still `canvas_html`.

## Inventory and starter model

- Built-in kits live in `src/canvas/kits/catalog.ts`.
- Built-in starters live in `src/canvas/starters/catalog.ts`.
- Starters compose the existing document inventory and token paths instead of maintaining a separate starter store.
- Document-promoted items and built-in catalog entries both flow through `canvas.inventory.*`.

## Persistence contracts

- Document JSON: `.opendevbrowser/canvas/<documentId>.canvas.json`
- Code-sync manifests: `.opendevbrowser/canvas/code-sync/<documentId>/<bindingId>.json`
- CanvasManager persists caller `repoRoot` so daemon-backed runs resolve relative paths against the caller repository, not the daemon cwd.

## Sync obligations

When the design-canvas surface changes, update these in the same patch:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/CANVAS_BIDIRECTIONAL_CODE_SYNC_TECHNICAL_SPEC.md`
- `docs/CANVAS_ADAPTER_PLUGIN_CONTRACT.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `AGENTS.md`, `src/browser/AGENTS.md`, `src/canvas/AGENTS.md`, `src/tools/AGENTS.md`, and `extension/AGENTS.md`

## Validation hooks

- `scripts/canvas-competitive-validation.mjs`
- `scripts/canvas-live-workflow.mjs`
- `tests/canvas-*.test.ts`
- `tests/canvas-live-workflow-script.test.ts`
