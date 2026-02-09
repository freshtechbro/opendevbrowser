# OpenDevBrowser - Agent Guidelines

**Generated:** 2026-02-01 | **Commit:** 2869775 | **Branch:** main

## Overview

OpenCode plugin providing AI agents with browser automation via Chrome DevTools Protocol. Script-first UX: snapshot → refs → actions.

### Install Quick Reference

- Runtime: Node.js `>=18`.
- Recommended installer: `npx opendevbrowser`
- Optional persistent CLI: `npm install -g opendevbrowser`

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Distribution Layer                         │
├──────────────────┬──────────────────┬──────────────────┬──────────────────────────┤
│  OpenCode Plugin │       CLI        │    Hub Daemon    │    Chrome Extension       │
│  (src/index.ts)  │ (src/cli/index)  │ (opendevbrowser  │   (extension/src/)        │
│                  │                  │      serve)     │                           │
└────────┬─────────┴────────┬─────────┴─────────┬────────┴──────────────┬────────────┘
         │                  │                  │                       │
         ▼                  ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Core Runtime (src/core/)                      │
│  bootstrap.ts → wires managers, injects ToolDeps                 │
└────────┬────────────────────────────────────────────────────────┘
         │
    ┌────┴────┬─────────────┬──────────────┬──────────────┬──────────────┐
    ▼         ▼             ▼              ▼              ▼              ▼
┌────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│Browser │ │Script  │ │Snapshot  │ │ Annotation │ │  Relay     │ │  Skills    │
│Manager │ │Runner  │ │Pipeline  │ │  Manager   │ │  Server    │ │  Loader    │
└───┬────┘ └────────┘ └──────────┘ └────────────┘ └─────┬──────┘ └────────────┘
    │                                                  │
    ▼                                                  ▼
┌────────┐                                        ┌────────────┐
│Target  │                                        │ Extension  │
│Manager │                                        │ (WS relay) │
└────────┘                                        └────────────┘
```

### Data Flow

```
Tool Call → Zod Validation → Manager/Runner → CDP/Playwright → Response
                                   ↓
                            Snapshot (AX-tree → refs)
                                   ↓
                            Action (ref → backendNodeId → DOM)
```

### System Workflow (Happy Path)

1. `launch` (extension or managed) → sessionId
2. `snapshot` → refs
3. Action tools (`click`, `type`, `press`, `hover`, `check`, etc.) → repeat snapshot
4. `disconnect` on completion

### Session Modes

| Mode | Entry | Use Case |
|------|-------|----------|
| `extension` | `opendevbrowser_launch` (default) | Attach to logged-in tabs via relay |
| `managed` | `--no-extension` | Fresh Playwright-controlled Chrome |
| `cdpConnect` | `opendevbrowser_connect` | Attach to existing `--remote-debugging-port` |

Extension relay requires **Chrome 125+** and uses flat CDP sessions with DebuggerSession `sessionId` routing. Annotation relay uses a dedicated `/annotation` websocket channel. When hub mode is enabled, the hub daemon is the sole relay owner and enforces FIFO leases (no local relay fallback).

### Connection Flags & Status Semantics

- `--no-extension`: Force managed mode (ignores relay). `--headless` also implies managed mode.
- `--extension-only`: Fail unless extension is connected/handshaken.
- `--wait-for-extension`: Polls for extension handshake up to `--wait-timeout-ms` (min 3s).
- `extensionConnected`: Extension WebSocket is connected to relay.
- `extensionHandshakeComplete`: Extension handshake finished (preferred readiness signal).
- `cdpConnected`: At least one active `/cdp` client; false is normal until a tool/CLI connects.
- `pairingRequired`: Relay requires pairing token; extension auto-pair should handle this.

## Structure

```
.
├── src/              # Plugin implementation
│   ├── browser/      # BrowserManager, TargetManager, CDP lifecycle
│   ├── cache/        # Chrome executable resolution
│   ├── cli/          # CLI commands, daemon, installers
│   ├── core/         # Bootstrap, runtime wiring, ToolDeps
│   ├── devtools/     # Console/network trackers with redaction
│   ├── export/       # DOM capture, React emitter, CSS extraction
│   ├── relay/        # Extension relay server, protocol types
│   ├── skills/       # SkillLoader for skill pack discovery
│   ├── snapshot/     # AX-tree snapshots, ref management
│   ├── tools/        # 41 opendevbrowser_* tool definitions
│   ├── annotate/     # Annotation transports + output shaping
│   └── utils/        # Shared utilities
├── extension/        # Chrome extension (relay client)
├── skills/           # Bundled skill packs (5 total)
├── tests/            # Vitest tests (97% coverage required)
└── docs/             # Architecture, plans, CLI docs
```

## Where to Look

| Task | Location | Notes |
|------|----------|-------|
| Add/modify tool | `src/tools/` | Keep thin; delegate to managers |
| Tool registry | `src/tools/index.ts` | Source of truth for tool list/count |
| Browser lifecycle | `src/browser/browser-manager.ts` | Owns Playwright, targets, cleanup |
| Snapshot/refs | `src/snapshot/` | AX-tree, RefStore, outline/actionables |
| Extension relay | `src/relay/` | Protocol types, WebSocket security |
| Hub/relay status | `src/cli/daemon-status.ts`, `src/cli/remote-relay.ts` | Daemon status + relay cache |
| Hub enablement | `src/utils/hub-enabled.ts` | Hub-only gating + config checks |
| Extension routing | `extension/src/services/TargetSessionMap.ts` | Root/child session routing |
| CLI commands | `src/cli/commands/` | Registry-based, daemon mode |
| Add skill pack | `skills/*/SKILL.md` | Follow naming conventions |
| Config schema | `src/config.ts` | Zod schema, defaults |
| DI wiring | `src/core/bootstrap.ts` | Creates ToolDeps, wires managers |

## Commands

```bash
npm run build          # tsup → dist/
npm run dev            # tsup --watch
npm run lint           # eslint "{src,tests}/**/*.ts"
npm run test           # vitest run --coverage (97% threshold)
npm run extension:build   # tsc extension
npm run extension:sync    # Sync version from package.json
npm run version:check     # Verify version alignment
```

**Single test:** `npm run test -- tests/foo.test.ts` or `npm run test -- -t "test name"`

## Conventions

### Naming
- Files/folders: `kebab-case`
- Variables/functions: `camelCase`
- Classes/types: `PascalCase`
- Tools: `opendevbrowser_*` prefix required

### TypeScript
- Strict mode, `noUncheckedIndexedAccess` enabled
- Use `import type` for type-only imports
- Validate inputs with Zod at boundaries
- Never use `any`, `@ts-ignore`, `@ts-expect-error`

### Code Organization
- Tools: thin wrappers (validation + response shaping)
- Managers: own lifecycle and state
- Keep module boundaries clear

## Anti-Patterns

| Never | Why |
|-------|-----|
| `any` type | Use `unknown` + narrow with validation |
| Hardcoded relay endpoints | Use config `relayPort`/`relayToken` |
| `===` for token comparison | Use `crypto.timingSafeEqual()` |
| Log secrets/tokens | Redact all sensitive data |
| Empty catch blocks | Always handle or rethrow with context |
| Weaken tests to pass | Fix the code, not the test |

## Security

### Defaults (all false for safety)
- `allowRawCDP`: Direct CDP access
- `allowNonLocalCdp`: Remote CDP endpoints
- `allowUnsafeExport`: Skip HTML sanitization

### Required Protections
- CDP endpoints: localhost only (127.0.0.1, ::1, localhost)
- Hostname normalization: lowercase before validation
- Relay auth: timing-safe token comparison
- Rate limiting: 5 handshakes/min/IP
- Origin validation: `/extension` requires `chrome-extension://`; `/cdp`, `/ops`, and `/annotation` accept extension origin or loopback requests without `Origin`
- Export sanitization: strip scripts, handlers, dangerous CSS

### File Permissions
- Config files: mode 0600
- Atomic writes: prevent corruption

## Plugin Architecture

```
Entry: src/index.ts
  └── Exports: { tool, chat.message, experimental.chat.system.transform }

Bootstrap: src/core/bootstrap.ts
  └── Creates: BrowserManager, ScriptRunner, SkillLoader, RelayServer
  └── Returns: ToolDeps (injected into all tools)

Config: ~/.config/opencode/opendevbrowser.jsonc
  └── Schema: src/config.ts (Zod validation)
```

### Tool Registration Pattern
```typescript
// src/tools/index.ts
export function createTools(deps: ToolDeps): Record<string, ToolDefinition> {
  return {
    opendevbrowser_launch: createLaunchTool(deps),
    opendevbrowser_snapshot: createSnapshotTool(deps),
    // ... 41 tools
  };
}
```

## Testing

- Framework: Vitest
- Coverage: ≥97% lines/functions/branches/statements
- Location: `tests/*.test.ts`
- Mocking: Use existing Chrome/Playwright mocks
- Never weaken tests; fix root cause

### CLI Smoke Tests

- Managed mode: `node scripts/cli-smoke-test.mjs`
- Extension/CDP-connect: run `opendevbrowser launch` / `connect` with `--output json`, then `status` + `disconnect`.

## Documentation

- Source of truth: `docs/`
- Architecture: `docs/ARCHITECTURE.md`
- CLI reference: `docs/CLI.md`
- Additional design/plan docs: `docs/` (feature-specific; verify file paths exist before referencing)
- Keep docs in sync with implementation
- If tool list or outputs change, update `docs/CLI.md` and this file together.

## AGENTS.md Governance

- Root `AGENTS.md` changes require maintainer approval (MCAF governance).

## Layered AGENTS.md

Subdirectory guides override this root file:
- `src/AGENTS.md` — module boundaries, manager patterns
- `src/browser/AGENTS.md` — browser/session module specifics
- `src/cli/AGENTS.md` — CLI command and daemon conventions
- `src/relay/AGENTS.md` — relay protocol and security specifics
- `src/snapshot/AGENTS.md` — snapshot/ref pipeline specifics
- `src/tools/AGENTS.md` — tool development patterns
- `extension/AGENTS.md` — Chrome extension specifics
- `tests/AGENTS.md` — testing conventions
- `skills/AGENTS.md` — skill pack format

The nearest AGENTS.md to your working directory takes precedence.
