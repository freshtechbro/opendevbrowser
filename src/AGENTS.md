# src/ — Agent Guidelines

Extends root `AGENTS.md`. Nearest file takes precedence.

## Architecture

```
src/
├── index.ts              # Plugin entry, exports OpenDevBrowserPlugin
├── config.ts             # Zod schema, loadConfig()
├── core/
│   └── bootstrap.ts      # createOpenDevBrowserCore() → ToolDeps
├── annotate/             # Annotation transports + output shaping
├── browser/
│   ├── browser-manager.ts   # Playwright lifecycle, session state
│   ├── ops-browser-manager.ts # Extension ops sessions (/ops relay)
│   └── target-manager.ts    # Tab management, active tracking
├── tools/                # 48 tool definitions (see tools/AGENTS.md)
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
| `annotate/` | Direct/relay annotation transport + output formatting |
| `browser/` | BrowserManager, OpsBrowserManager, TargetManager, AnnotationManager, CDP lifecycle. See `browser/AGENTS.md` |
| `cache/` | Chrome executable resolution |
| `cli/` | CLI commands, installers, daemon autostart + hub tooling. See `cli/AGENTS.md` |
| `cli/` (hub) | Daemon lifecycle, FIFO lease queue, relay status refresh |
| `core/` | Bootstrap, runtime wiring |
| `devtools/` | Console/network trackers, redaction |
| `export/` | DOM capture, React emitter, sanitization |
| `relay/` | Extension relay server, protocol types. See `relay/AGENTS.md` |
| `skills/` | SkillLoader, topic filtering. See `../skills/AGENTS.md` |
| `snapshot/` | AX-tree snapshots, ref management. See `snapshot/AGENTS.md` |
| `tools/` | 48 tool definitions (thin wrappers). See `tools/AGENTS.md` |
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
- `AnnotationManager`: Direct/relay annotation orchestration

## Dependency Injection

```
bootstrap.ts
  ├── Creates: BrowserManager, AnnotationManager, ScriptRunner, SkillLoader, RelayServer
  └── Returns: ToolDeps interface
        ├── manager
        ├── annotationManager
        ├── runner
        ├── skills
        ├── config
        ├── relay? / getExtensionPath? / ensureHub?
```

Tools receive `ToolDeps` and delegate logic:

```typescript
export function createLaunchTool(deps: ToolDeps): ToolDefinition {
  return {
    name: 'opendevbrowser_launch',
    execute: async (params) => {
      const session = await deps.manager.launch(params);
      return { success: true, ...session };
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

## Connection Flags (Reference)

- Use root `AGENTS.md` for authoritative flag semantics.
- `--no-extension` forces managed mode; `--extension-only` fails if extension is not ready; `--extension-legacy` opts into relay `/cdp`; `--wait-for-extension` waits for handshake.

## Anti-Patterns

- Hardcoded relay endpoints → use config
- `===` for tokens → use `timingSafeEqual()`
- Log secrets → redact all sensitive data
- Empty catch blocks → always handle errors

## Testing

Add/update tests in `tests/` for behavior changes. Coverage ≥97%.
