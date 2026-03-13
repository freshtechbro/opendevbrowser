# src/canvas/ — Agent Guidelines

Design-canvas document store, repo persistence, export, and TSX-first code-sync helpers. Extends `src/AGENTS.md`.

## Overview

Owns the canonical design-canvas document model, governance validation, repo-native persistence, and reusable code-sync primitives. Internal document revisions are Yjs-backed, while persisted artifacts stay JSON/manifest files under `.opendevbrowser/canvas/`.

## Structure

```text
src/canvas/
├── types.ts                 # Canvas types, schemas, constants
├── document-store.ts        # CanvasDocumentStore, validation, revisioned patch application
├── repo-store.ts            # Repo-native JSON + manifest persistence helpers
├── export.ts                # HTML/component export + parity artifacts
└── code-sync/
    ├── apply-tsx.ts         # Canvas graph -> TSX writer
    ├── graph.ts             # Shared graph normalization helpers
    ├── hash.ts              # Stable hashing for drift detection
    ├── import.ts            # TSX graph -> canvas patch import
    ├── manifest.ts          # Manifest parsing/normalization
    ├── tsx-adapter.ts       # `tsx-react-v1` import/export adapter
    ├── types.ts             # Binding metadata, status, manifests, parity projections
    └── write.ts             # Atomic source write + manifest finalization
```

## CanvasDocument

Top-level document structure:

```typescript
type CanvasDocument = {
  schemaVersion: "1.0.0";
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  designGovernance: Record<GovernanceBlockKey, object>;
  pages: CanvasPage[];
  components: object[];
  componentInventory: object[];
  tokens: Record<string, unknown>;
  assets: CanvasAsset[];
  viewports: object[];
  themes: object[];
  bindings: CanvasBinding[];
  prototypes: CanvasPrototype[];
  meta: Record<string, unknown>;
};
```

## Governance Blocks

Required before save:

| Block | Required | Purpose |
|-------|----------|---------|
| `intent` | Yes | Design goals |
| `generationPlan` | Yes | Generation strategy |
| `designLanguage` | Yes | Visual direction |
| `contentModel` | Yes | Content structure |
| `layoutSystem` | Yes | Layout rules and spacing |
| `typographySystem` | Yes | Font hierarchy |
| `colorSystem` | Yes | Color roles |
| `surfaceSystem` | Yes | Material/surface rules |
| `iconSystem` | Yes | Icon roles and policy |
| `motionSystem` | Yes | Motion posture and reduced-motion rules |
| `responsiveSystem` | Yes | Breakpoints and responsive behavior |
| `accessibilityPolicy` | Yes | A11y rules |
| `libraryPolicy` | Yes | Approved libraries and icon sets |
| `runtimeBudgets` | Yes | Preview/runtime ceilings |

## CanvasDocumentStore

Yjs-backed document store with normalized JSON projection:

```typescript
const store = new CanvasDocumentStore(document?);
store.setGenerationPlan(plan);             // Validate and set plan
store.applyPatches(revision, patches);     // Apply mutations, increment revision
store.loadDocument(doc);                   // Load existing
const doc = store.getDocument();           // Get current projection
const revision = store.getRevision();      // Get Yjs-backed revision counter
```

Patch operations include `page.create`, `page.update`, `node.insert`, `node.update`, `node.remove`, `variant.patch`, `token.set`, `asset.attach`, `binding.set`, and `prototype.upsert`.

## Validation

`evaluateCanvasWarnings()` and save validation cover:
- Missing governance blocks
- Invalid generation-plan fields
- Incomplete typography hierarchy
- Missing font/reduced-motion policies
- Broken asset references
- Library/icon policy violations
- Unresolved component bindings
- Runtime budget, responsive, and export warnings

## Code Sync

- Binding metadata is normalized through `normalizeCodeSyncBindingMetadata()` in `code-sync/types.ts`.
- TSX-first bind/import/export uses the `tsx-react-v1` adapter plus graph/hash/manifest helpers in `code-sync/`.
- `src/browser/canvas-manager.ts` owns the public `canvas.session.attach` and `canvas.code.*` command surface; `src/canvas/` remains the reusable storage/transform layer.
- `canvas_html` is the default preview/export contract. `bound_app_runtime` is an opt-in reconciliation path that still requires app-side instrumentation and runtime-bridge preflight.

## Persistence

- Canonical document path: `.opendevbrowser/canvas/<documentId>.canvas.json` unless an explicit `repoPath` is supplied
- Code-sync manifests: `.opendevbrowser/canvas/code-sync/<documentId>/<bindingId>.json`
- Repo helpers only: use `repo-store.ts` to resolve/load/save both document JSON and manifests
- Schema versioning: `CANVAS_SCHEMA_VERSION` for migrations

## Anti-Patterns

| Never | Why |
|-------|-----|
| Skip generation plan validation | Invalid document state |
| Modify document directly | Use patches for consistency |
| Ignore validation warnings | Broken exports, missing assets |
| Write code-sync manifests outside `repo-store.ts` | Breaks document-scoped persistence guarantees |
| Assume `bound_app_runtime` always works | Runtime preview still requires explicit instrumentation; `canvas_html` is the safe fallback |

## Dependencies

- `yjs` - CRDT document sync
- `crypto` - UUID generation
- `../browser/canvas-manager.ts` - CanvasManager orchestration
- `../browser/canvas-code-sync-manager.ts` - Bind/pull/push/watch orchestration on top of these helpers

## Testing

Document store and code-sync helpers are mostly pure: pass mock documents/source text, verify patches, manifests, and hashes apply correctly without browser state.
