# OpenDevBrowser - Agent Guidelines

**Generated:** 2026-01-13 | **Commit:** 7756dee | **Branch:** main

## Overview

OpenCode plugin providing AI agents with browser automation via Chrome DevTools Protocol. Script-first UX: snapshot → refs → actions.

## Structure

```
.
├── src/              # Plugin implementation (tools, managers, services)
│   ├── browser/      # BrowserManager, TargetManager, CDP lifecycle
│   ├── cache/        # Chrome executable resolution
│   ├── cli/          # CLI commands and installers
│   ├── core/         # Bootstrap, runtime wiring
│   ├── devtools/     # Console/network trackers with redaction
│   ├── export/       # DOM capture, React emitter, CSS extraction
│   ├── relay/        # Extension relay protocol and server
│   ├── skills/       # SkillLoader for skill pack discovery
│   ├── snapshot/     # AX-tree snapshots, ref management
│   ├── tools/        # 30+ opendevbrowser_* tool definitions
│   └── utils/        # Shared utilities
├── extension/        # Chrome extension (relay client)
├── skills/           # Bundled skill packs (5 total)
├── tests/            # Vitest tests (95% coverage required)
└── docs/             # Architecture, plans, CLI docs
```

## Where to Look

| Task | Location | Notes |
|------|----------|-------|
| Add/modify tool | `src/tools/` | Keep thin; delegate to managers |
| Browser lifecycle | `src/browser/browser-manager.ts` | Owns Playwright, targets, cleanup |
| Snapshot/refs | `src/snapshot/` | AX-tree, ref mapping |
| Extension relay | `src/relay/` | Protocol types, server security |
| CLI commands | `src/cli/commands/` | Grouped by category |
| Add skill pack | `skills/*/SKILL.md` | Follow naming conventions |
| Config schema | `src/config.ts` | Zod schema, defaults |

## Commands

```bash
npm run build          # tsup → dist/
npm run dev            # tsup --watch
npm run lint           # eslint "{src,tests}/**/*.ts"
npm run test           # vitest run --coverage (95% threshold)
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
- Managers: core logic (BrowserManager, ScriptRunner)
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
- Origin validation: chrome-extension:// only for WebSocket
- Export sanitization: strip scripts, handlers, dangerous CSS

### File Permissions
- Config files: mode 0600
- Atomic writes: prevent corruption

## Plugin Architecture

```
Entry: src/index.ts
  └── Exports: { tool, chat.message, experimental.chat.system.transform }

Bootstrap: src/core/bootstrap.ts
  └── Wires: BrowserManager, ScriptRunner, SkillLoader, RelayServer

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
    // ... 30+ tools
  };
}
```

## Testing

- Framework: Vitest
- Coverage: ≥95% lines/functions/branches/statements
- Location: `tests/*.test.ts`
- Mocking: Use existing Chrome/Playwright mocks
- Never weaken tests; fix root cause

## Documentation

- Source of truth: `docs/`
- Architecture: `docs/ARCHITECTURE.md`
- CLI reference: `docs/CLI.md`
- Refactor plans: `docs/REFACTORING_PLAN.md`
- Keep docs in sync with implementation

## Layered AGENTS.md

Subdirectory guides override this root file:
- `src/AGENTS.md` — module boundaries, manager patterns
- `extension/AGENTS.md` — Chrome extension specifics
- `tests/AGENTS.md` — testing conventions
- `skills/AGENTS.md` — skill pack format

The nearest AGENTS.md to your working directory takes precedence.
