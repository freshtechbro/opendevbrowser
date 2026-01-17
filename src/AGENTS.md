# src/ — Agent Guidelines

Extends root `AGENTS.md`. Nearest file takes precedence.

## Module Boundaries

| Module | Responsibility |
|--------|----------------|
| `browser/` | BrowserManager, TargetManager, CDP lifecycle |
| `cache/` | Chrome executable resolution |
| `cli/` | CLI commands, installers, templates |
| `core/` | Bootstrap, runtime wiring |
| `devtools/` | Console/network trackers, redaction |
| `export/` | DOM capture, React emitter, sanitization |
| `relay/` | Extension relay server, protocol types |
| `skills/` | SkillLoader, topic filtering |
| `snapshot/` | AX-tree snapshots, ref management |
| `tools/` | 30+ tool definitions (thin wrappers) |
| `utils/` | Shared utilities |

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

## Anti-Patterns

- Hardcoded relay endpoints → use config
- `===` for tokens → use `timingSafeEqual()`
- Log secrets → redact all sensitive data
- Empty catch blocks → always handle errors

## Testing

Add/update tests in `tests/` for behavior changes. Coverage ≥95%.
