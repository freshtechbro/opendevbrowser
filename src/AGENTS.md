# src/ — Agent Guidelines

Extends root `AGENTS.md`. Nearest file takes precedence.

## Architecture

```
src/
├── index.ts              # Plugin entry, exports OpenDevBrowserPlugin
├── config.ts             # Zod schema, loadConfig()
├── core/
│   └── bootstrap.ts      # createOpenDevBrowserCore() → ToolDeps
├── browser/
│   ├── browser-manager.ts   # Playwright lifecycle, session state
│   └── target-manager.ts    # Tab management, active tracking
├── tools/                # 30 tool definitions (see tools/AGENTS.md)
├── snapshot/             # AX-tree capture, RefStore
├── relay/                # WebSocket relay server
├── devtools/             # Console/network with redaction
├── export/               # DOM capture, React emitter
├── cli/                  # Commands, daemon, installers
│   ├── daemon-status.ts  # Hub /status lookup + metadata recovery
│   └── remote-relay.ts   # Relay status + instanceId cache
├── skills/               # SkillLoader, discovery
├── cache/                # Chrome path resolution
└── utils/                # Shared utilities
    └── hub-enabled.ts    # Hub-only config gating
```

## Module Boundaries

| Module | Responsibility |
|--------|----------------|
| `browser/` | BrowserManager, TargetManager, CDP lifecycle |
| `cache/` | Chrome executable resolution |
| `cli/` | CLI commands, installers, templates |
| `cli/` (hub) | Daemon lifecycle, FIFO lease queue, relay status refresh |
| `core/` | Bootstrap, runtime wiring |
| `devtools/` | Console/network trackers, redaction |
| `export/` | DOM capture, React emitter, sanitization |
| `relay/` | Extension relay server, protocol types |
| `skills/` | SkillLoader, topic filtering |
| `snapshot/` | AX-tree snapshots, ref management |
| `tools/` | 30 tool definitions (thin wrappers) |
| `utils/` | Shared utilities |

## Manager Pattern

```typescript
// Managers own lifecycle and state
class BrowserManager {
  private sessions: Map<string, Session>;
  
  async launch(opts): Promise<Session> { ... }
  async disconnect(sessionId): Promise<void> { ... }
  async cleanup(): Promise<void> { ... }  // Called on shutdown
}
```

**Key managers:**
- `BrowserManager`: Playwright session, launch/connect/disconnect
- `TargetManager`: Tab lifecycle, naming, active tracking
- `ScriptRunner`: Action execution with retry/backoff

## Dependency Injection

```
bootstrap.ts
  ├── Creates: BrowserManager, ScriptRunner, SkillLoader, RelayServer
  └── Returns: ToolDeps interface
        ├── browserManager
        ├── scriptRunner
        ├── skillLoader
        ├── snapshotter
        └── config
```

Tools receive `ToolDeps` and delegate logic:

```typescript
export function createLaunchTool(deps: ToolDeps): ToolDefinition {
  return {
    name: 'opendevbrowser_launch',
    handler: async (params) => {
      const session = await deps.browserManager.launch(params);
      return { success: true, sessionId: session.id };
    }
  };
}
```

Reference architecture flows in `docs/ARCHITECTURE.md` and keep module boundaries aligned with the core/runtime diagram.

## Patterns

### Tools (src/tools/)
- Validate inputs with Zod schemas
- Delegate logic to managers/services
- Return structured `{ success, data }` or `{ error }` objects
- Never use `any`; narrow `unknown` with validation

### Managers (src/browser/, src/core/)
- Own lifecycle and state
- BrowserManager: Playwright session, targets, cleanup
- ScriptRunner: action execution with retry/backoff

### Security (src/relay/, src/browser/)
- `crypto.timingSafeEqual()` for token comparison
- Hostname normalization before CDP validation
- Origin validation on WebSocket upgrade
- Rate limiting: 5 handshakes/min/IP

## Config Flow

```
src/config.ts (Zod schema)
  → src/core/bootstrap.ts (loads + validates)
    → managers receive typed config
```

Config toggles: `devtools.showFullUrls`, `snapshot.maxNodes`, `security.allowUnsafeExport`

## Hub-only relay semantics

When hub mode is enabled, the daemon is the sole relay owner and tools are bound through `RemoteManager`/`RemoteRelay`. There is no local relay fallback; ensureHub handles bounded retries and status refresh.

## Anti-Patterns

- Hardcoded relay endpoints → use config
- `===` for tokens → use `timingSafeEqual()`
- Log secrets → redact all sensitive data
- Empty catch blocks → always handle errors

## Testing

Add/update tests in `tests/` for behavior changes. Coverage ≥95%.
