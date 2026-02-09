# Browser Module

**Scope:** Browser lifecycle, session management, target tracking, script execution

## Overview

Owns Playwright browser instances, session state, and target (page/tab) management. Central coordination point between CDP, extension relay, and managed sessions.

## Structure

```
src/browser/
├── browser-manager.ts      # Main orchestrator (45KB) - launch, connect, lifecycle
├── target-manager.ts       # Page/tab registry, named targets
├── script-runner.ts        # Multi-step script execution
├── annotation-manager.ts   # Annotation transport coordination
├── ops-browser-manager.ts  # Ops-mode browser management
├── ops-client.ts           # Ops protocol client
├── session-store.ts        # Session metadata persistence
└── manager-types.ts        # Shared type definitions
```

## Key Classes

### BrowserManager
- **Launch modes:** `extension` (relay), `managed` (Playwright), `cdpConnect` (existing)
- **Session composition:** Browser + Context + TargetManager + RefStore + Snapshotter + Trackers
- **Profile management:** Persistent or ephemeral Chrome profiles
- **Chrome resolution:** System Chrome → Chrome for Testing download

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

## Dependencies

- `playwright-core` - Browser automation
- `async-mutex` - Session-level locking
- `../relay/*` - Extension relay coordination
- `../snapshot/*` - RefStore, Snapshotter
- `../devtools/*` - ConsoleTracker, NetworkTracker
- `../export/*` - DOM capture, CSS extraction

## Anti-Patterns

- Never bypass `TargetManager` for page access
- Never store raw `Page` references outside session context
- Never skip mutex acquisition for session mutations
