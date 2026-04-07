# Canvas Bidirectional Code Sync Technical Spec

Status: active  
Last updated: 2026-03-27

## Overview

Canvas code sync keeps a canvas document and a bound source file aligned through typed framework adapters, repo-local manifests, drift detection, and explicit conflict resolution. The browser-facing orchestrator is `src/browser/canvas-code-sync-manager.ts`; the reusable transform and persistence layer lives in `src/canvas/code-sync/`.

## Core responsibilities

| Area | Source of truth | Responsibility |
|------|------------------|----------------|
| Browser orchestration | `src/browser/canvas-code-sync-manager.ts` | Bind/unbind/pull/push/status/resolve command handling |
| Session attach state | `src/browser/canvas-session-sync-manager.ts` | Active lease-holder and observer sync state |
| Manifest persistence | `src/canvas/repo-store.ts`, `src/canvas/code-sync/manifest.ts` | Persist and normalize binding manifests |
| Transform layer | `src/canvas/code-sync/apply-tsx.ts`, `import.ts`, `tsx-adapter.ts`, `graph.ts`, `write.ts` | Canvas→code and code→canvas transforms |
| Adapter selection | `src/canvas/framework-adapters/registry.ts`, `src/canvas/library-adapters/registry.ts`, `src/canvas/adapter-plugins/loader.ts` | Built-in and repo-local adapter resolution |

## Public command surface

Documented canonically in `docs/SURFACE_REFERENCE.md`:

- `canvas.code.bind`
- `canvas.code.unbind`
- `canvas.code.pull`
- `canvas.code.push`
- `canvas.code.status`
- `canvas.code.resolve`

## Built-in framework lanes

Current built-in framework adapters:
- `builtin:react-tsx-v2`
- `builtin:html-static-v1`
- `builtin:custom-elements-v1`
- `builtin:vue-sfc-v1`
- `builtin:svelte-sfc-v1`

Legacy `tsx-react-v1` bindings and manifests migrate on load to `builtin:react-tsx-v2`.

## Plugin model

- Repo-local BYO adapters load through `src/canvas/adapter-plugins/`.
- Discovery sources are workspace metadata, local manifests, and explicit local config declarations only.
- Capability overrides may narrow plugin capabilities; they do not widen trust or grant undeclared powers.
- Out-of-worktree package declarations are rejected with trust failures instead of being silently accepted.

## Binding metadata and drift

- Binding metadata is normalized through `normalizeCodeSyncBindingMetadata()` in `src/canvas/code-sync/types.ts`.
- Drift/conflict state is computed from source hashes, manifest data, and current document revision.
- `canvas.code.status` is the primary audit surface for `frameworkAdapterId`, granted capabilities, denials, and typed `reasonCode` values.

## Conflict model

Expected outcomes are explicit:
- clean bind/pull/push
- degraded bind when framework support is partial
- typed unsupported/plugin load failures
- conflict state that requires `canvas.code.resolve`

Do not hide drift or plugin failures behind silent fallbacks.

## Sync obligations

When code-sync behavior changes, update these together:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md`
- `docs/CANVAS_ADAPTER_PLUGIN_CONTRACT.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `src/canvas/AGENTS.md`, `src/browser/AGENTS.md`, `src/tools/AGENTS.md`, and `docs/AGENTS.md`

## Validation hooks

- `scripts/canvas-competitive-validation.mjs`
- `tests/canvas-code-sync-transform.test.ts`
- `tests/canvas-code-sync-manager.test.ts`
- `tests/canvas-live-workflow-script.test.ts`
