# src/core/ — Agent Guidelines

Core bootstrap and dependency injection. Extends `src/AGENTS.md`.

## Overview

Wires the entire runtime. Creates managers, the sibling desktop runtime, the automation coordinator, initializes relay, provisions the repo-local `AgentInbox`, and returns `ToolDeps` for injection into tools.

## Structure

```
src/core/
├── bootstrap.ts   # createOpenDevBrowserCore() - main factory
└── types.ts       # CoreOptions, OpenDevBrowserCore interface
```

## Bootstrap Flow

```
createOpenDevBrowserCore(options)
  ├── loadGlobalConfig() / use provided config
  ├── Creates: BrowserManager, OpsBrowserManager, ScriptRunner
  ├── Creates: SkillLoader, RelayServer, AgentInbox, AnnotationManager, CanvasManager
  ├── Creates: DesktopRuntime, AutomationCoordinator
  ├── Creates: ProviderRuntime (with browser fallback port)
  └── Returns: OpenDevBrowserCore { manager, runner, skills, relay, desktopRuntime, automationCoordinator, observeDesktopAndVerify, ... }
```

## ToolDeps Interface

Core returns this to all tools:

| Field | Type | Purpose |
|-------|------|---------|
| `manager` | BrowserManagerLike | Session lifecycle |
| `runner` | ScriptRunner | Multi-step script execution |
| `skills` | SkillLoader | Skill pack discovery |
| `relay` | RelayServer | Extension relay |
| `agentInbox` | AgentInbox | Repo-local chat-scoped annotation delivery + stored retrieval |
| `annotationManager` | AnnotationManager | Annotation coordination |
| `canvasManager` | CanvasManagerLike | Design-canvas orchestration |
| `desktopRuntime` | DesktopRuntimeLike | Public read-only desktop observation runtime |
| `automationCoordinator` | AutomationCoordinatorLike | Cross-runtime desktop-observation-to-browser-verification composition |
| `providerRuntime` | object | Search/fetch/crawl/post |
| `ensureRelay` | function | Start relay on port |
| `cleanup` | function | Shutdown handler |

## Key Patterns

- **Factory pattern**: `createOpenDevBrowserCore()` is the single entry point
- **DI via ToolDeps**: All tools receive dependencies, don't create them
- **Lazy initialization**: Relay starts on-demand via `ensureRelay()`
- **Resource cleanup**: `cleanup()` stops relay and closes all sessions

## Relay Lifecycle

```typescript
const ensureRelay = async (port?: number) => {
  // Skips if relayToken === false (relay disabled)
  // Stops existing if port changed
  // Starts new RelayServer on requested port
  // Handles EADDRINUSE with warnings
};
```

## Anti-Patterns

| Never | Why |
|-------|-----|
| Create managers outside bootstrap | Breaks DI, makes testing hard |
| Skip `cleanup()` on shutdown | Resource leaks, dangling Chrome processes |
| Hardcode config paths | Use `loadGlobalConfig()` for consistency |

## Testing

Bootstrap returns interfaces, not concrete classes — mock easily for tests.
