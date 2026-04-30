# Design Canvas Technical Spec

Status: active  
Last updated: 2026-03-27

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

Canonical inventory lives in `docs/SURFACE_REFERENCE.md`. High-level families:

- `canvas.session.*` — open, attach, inspect, close
- `canvas.document.*` — load, import, patch, save, export
- `canvas.history.*` — undo, redo
- `canvas.inventory.*` — list, insert
- `canvas.starter.*` — list, apply
- `canvas.tab.*` — open, close, sync extension-hosted design tabs
- `canvas.overlay.*` — mount, unmount, select, sync
- `canvas.preview.*` — render, refresh
- `canvas.feedback.*` — poll, subscribe, consume feedback
- `canvas.code.*` — bind, unbind, pull, push, status, resolve

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
3. `canvas.plan.set`
4. If the plan is accepted, follow the returned guidance into `canvas.document.patch`
5. `canvas.preview.render`
6. `canvas.feedback.poll`
7. `canvas.document.save` or `canvas.document.export`

Canvas guidance is centrally constructed with shared next-step advisory builders, but the public Canvas response stays Canvas-shaped:
`guidance.recommendedNextCommands`, `guidance.reason`, and blocker `requiredNextCommands`.

`canvas.plan.get` and `canvas.capabilities.get` remain useful when an invalid plan response needs to be re-read after failure or attach, but they are not required after a successful `canvas.plan.set`.

## Plan-state semantics

- Missing plan:
  - `planStatus: "missing"`
  - `preflightState: "handshake_read"`
  - next step is `canvas.plan.set`
- Invalid plan:
  - `planStatus: "invalid"`
  - `preflightState: "plan_invalid"`
  - handshake and capabilities calls expose `generationPlanIssues`
  - `canvas.plan.set` fails with `generation_plan_invalid` and returns `details.missingFields` plus `details.issues`
  - `canvas.feedback.poll` synthesizes the same preflight blocker until the plan is fixed
- Accepted plan:
  - `planStatus: "accepted"`
  - `preflightState: "plan_accepted"`
  - mutation guidance moves to patch -> preview -> feedback -> save/export

## Projection boundary

- `canvas_html` is the default preview/export contract and compatibility fallback.
- `bound_app_runtime` is opt-in only and requires the binding plus target app instrumentation to satisfy preflight.
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
