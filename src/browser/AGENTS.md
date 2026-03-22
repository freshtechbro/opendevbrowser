# src/browser/ — Agent Guidelines

**Scope:** Browser lifecycle, session management, target tracking, script execution, `/canvas` orchestration, preview sync

## Overview

Owns Playwright browser instances, session state, target (page/tab) management, and the browser-facing half of canvas session/preview/code-sync orchestration. Central coordination point between CDP, extension relay, managed sessions, `/ops`, and `/canvas`.

## Structure

```
src/browser/
├── annotation-manager.ts         # Annotation transport coordination + shared inbox stored retrieval
├── browser-manager.ts            # Main orchestrator - launch, connect, lifecycle
├── canvas-client.ts              # /canvas relay client
├── canvas-code-sync-manager.ts   # Framework-adapter-backed code sync status/pull/push/watch
├── canvas-manager.ts             # /canvas commands, preview sync, overlay orchestration
├── canvas-runtime-preview-bridge.ts # Opt-in bound-app runtime reconciliation
├── canvas-session-sync-manager.ts # Lease-holder / observer attach state
├── manager-types.ts              # Shared type definitions
├── ops-browser-manager.ts        # Ops-mode browser management
├── ops-client.ts                 # Ops protocol client
├── parallelism-governor.ts       # Session parallelism caps + backpressure
├── script-runner.ts              # Multi-step script execution
├── session-store.ts              # Session metadata persistence
└── target-manager.ts             # Page/tab registry, named targets
```

## Key Classes

### BrowserManager
- **Launch modes:** `extension` (relay), `managed` (Playwright), `cdpConnect` (existing)
- **Session composition:** Browser + Context + TargetManager + RefStore + Snapshotter + Trackers
- **Profile management:** Persistent or ephemeral Chrome profiles
- **Chrome resolution:** System Chrome → Chrome for Testing download
- **Session cookie bootstrap:** managed and `cdpConnect` sessions import readable cookies from the discovered system Chrome-family profile before navigation; extension mode reuses the attached tab's existing cookies

### TargetManager
- UUID-based target registry
- Named target support (pages)
- Active target tracking
- Target info resolution (title, URL)

### ScriptRunner
- Multi-step action sequences
- Error handling with `stopOnError` option
- Timing metrics
- Step-by-step execution via `executeStep()`

### CanvasManager
- `/canvas` command router for session open/attach/status/close, document load/import/patch/save/export, history undo/redo, inventory list/insert, starter list/apply, preview render/refresh, tab open/close, overlay state, feedback polling, and public feedback pull-stream commands
- Owns session leases and design-tab target state
- Derives the design-tab session summary from normalized canvas documents, including additive framework/plugin/import/capability metadata plus built-in kit and starter availability metadata when present
- Merges document-backed inventory with the built-in catalog for `canvas.inventory.list` and `canvas.inventory.insert`, and composes `canvas.starter.apply` from the same document-backed inventory/token paths instead of a second starter store
- Delegates framework-adapter-backed bind/pull/push/resolve work to `CanvasCodeSyncManager`

### CanvasCodeSyncManager
- Loads and saves document-scoped manifests through `src/canvas/repo-store.ts`
- Watches bound source files and computes drift/conflict state
- Supports `canvas.code.bind`, `unbind`, `pull`, `push`, `status`, and `resolve` across built-in React/HTML/custom-elements/Vue/Svelte lanes plus repo-local BYO adapter plugins

### AnnotationManager
- Owns direct-vs-relay annotate routing
- Resolves `annotate --stored` through the shared repo-local agent inbox first and the extension-local fallback second
- Keeps relay-only requirements explicit for extension-backed stored fetches

## Session Modes

| Mode | Entry | Use Case |
|------|-------|----------|
| `extension` | `launch()` default | Attach to logged-in tabs via relay |
| `managed` | `--no-extension` | Fresh Playwright-controlled Chrome |
| `cdpConnect` | `connect()` | Attach to existing `--remote-debugging-port` |

## Security

- **Localhost-only CDP:** Endpoints validated to 127.0.0.1, ::1, localhost
- **Profile isolation:** Each session gets isolated profile directory
- **Cleanup:** Automatic profile cleanup unless `persistProfile: true`
- **Canvas preview boundary:** `canvas_html` remains the default projection; `bound_app_runtime` is opt-in and must fall back when instrumentation/root selectors are missing

## Dependencies

- `playwright-core` - Browser automation
- `async-mutex` - Session-level locking
- `../relay/*` - Extension relay coordination
- `../canvas/*` - Document store, export, repo persistence, code-sync primitives
- `../snapshot/*` - RefStore, Snapshotter
- `../devtools/*` - ConsoleTracker, NetworkTracker
- `../export/*` - DOM capture, CSS extraction

## Anti-Patterns

- Never bypass `TargetManager` for page access
- Never store raw `Page` references outside session context
- Never skip mutex acquisition for session mutations
- Never claim runtime-bound parity unless the binding explicitly opts into `bound_app_runtime` and preflight succeeds; projected `canvas_html` is the compatibility fallback
