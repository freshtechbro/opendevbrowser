# src/desktop/ — Agent Guidelines

Read-only desktop observation runtime. Extends `src/AGENTS.md`.

## Architecture

```
src/desktop/
├── index.ts       # Public re-exports
├── types.ts       # DesktopCapability, DesktopRuntimeLike, DesktopResult<T>, DesktopFailureCode
├── runtime.ts     # createDesktopRuntime(), platform dispatch, screencapture/ax collection
├── audit.ts       # writeDesktopAuditRecord(), DesktopAuditRecord, DesktopAuditEnvelope
└── errors.ts      # DesktopRuntimeError, isDesktopRuntimeError()
```

## Key Types

| Type | Purpose |
|------|---------|
| `DesktopRuntimeLike` | Interface: status, listWindows, activeWindow, captureDesktop, captureWindow, accessibilitySnapshot |
| `DesktopResult<T>` | Discriminated union: `{ ok: true, value, audit }` or `{ ok: false, code, message, audit }` |
| `DesktopFailureCode` | `"desktop_unsupported"`, `"desktop_permission_denied"`, `"desktop_query_failed"`, etc. |
| `DesktopCapability` | `"observe.windows"`, `"observe.screen"`, `"observe.window"`, `"observe.accessibility"` |

## Module Boundaries

- **runtime.ts** owns all platform dispatch (macOS screencapture, AppleScript). No direct tool imports.
- **audit.ts** writes JSON audit records to `config.desktop.auditArtifactsDir` (default `.opendevbrowser/desktop-runtime`). Uses `writeFileAtomic`.
- **types.ts** is pure type exports. No runtime logic.
- **errors.ts** is `DesktopRuntimeError` (typed error class) plus type guard.

## Config Surface

Config lives in `src/config.ts` under `desktop.*`:

```typescript
{
  desktop: {
    permissionLevel: "observe",       // "off" disables entirely
    commandTimeoutMs: 10000,
    auditArtifactsDir: ".opendevbrowser/desktop-runtime",
    accessibilityMaxDepth: 2,
    accessibilityMaxChildren: 25
  }
}
```

## Security Constraints

- **Observation-only**. No desktop agent, no `/ops` or `/cdp` control plane.
- `permissionLevel: "off"` disables all desktop tools.
- Audit records are written for every call (ok or failed).
- screencapture commands run via `execFile` with bounded timeout.
- No secrets, tokens, or browser-control paths exposed.

## Anti-Patterns

| Never | Do Instead |
|-------|------------|
| Add write/control capabilities | This module is read-only by contract |
| Skip audit record on success | Every call writes audit |
| Use `exec` or shell interpolation | Use `execFile` with explicit args only |
| Share `DesktopRuntimeLike` with browser managers | Desktop runtime stays browser-independent |

## Testing

- Coverage ≥97%. Mock `execFileImpl` and `statImpl` via `DesktopRuntimeDependencies`.
- Test both `ok` and `failed` `DesktopResult` branches.
- Test audit directory creation and atomic write behavior.