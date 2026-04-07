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
