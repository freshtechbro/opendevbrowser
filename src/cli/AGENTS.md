# CLI Module

**Scope:** Commands, daemon management, installers, hub-mode proxying

## Overview

CLI layer implementing script-first UX with 20+ commands across 10 categories. Supports local execution and hub-mode daemon proxying. Includes autostart installers for macOS (LaunchAgent) and Windows (Task Scheduler).

## Structure

```
src/cli/
├── commands/               # 20+ command implementations
│   ├── annotate.ts         # Annotation commands
│   ├── daemon.ts           # Daemon lifecycle
│   ├── devtools/           # Console/network commands
│   ├── dom/                # DOM capture/export
│   ├── export/             # Page export commands
│   ├── interact/           # 9 interaction commands (click, type, etc.)
│   ├── nav/                # Navigation commands
│   ├── pages/              # Page management
│   ├── registry.ts         # Command registration
│   ├── run.ts              # Script execution
│   ├── serve.ts            # Relay server commands
│   ├── session/            # Session management
│   ├── status.ts           # Status commands
│   ├── targets/            # Target management
│   ├── types.ts            # Command types
│   ├── uninstall.ts        # Uninstall command
│   └── update.ts           # Update command
├── installers/             # Installation scripts
│   ├── global.ts           # Global npm install
│   ├── local.ts            # Local project install
│   └── skills.ts           # Skill pack installer
├── utils/                  # CLI utilities
│   ├── config.ts           # Config loading
│   ├── http.ts             # HTTP helpers
│   ├── parse.ts            # Argument parsing
│   └── skills.ts           # Skill utilities
├── daemon.ts               # Hub daemon implementation
├── daemon-autostart.ts     # LaunchAgent/Task Scheduler
├── daemon-commands.ts      # HTTP command handlers
├── daemon-client.ts        # Daemon HTTP client
├── daemon-status.ts        # Hub status + metadata recovery
├── remote-manager.ts       # Tool call proxy for hub
├── remote-relay.ts         # Relay status cache
├── commands/native.ts      # Native messaging command handlers
├── output.ts               # JSON/text output formatting
└── index.ts                # CLI entry point
```

## Command Categories

| Category | Commands | Purpose |
|----------|----------|---------|
| `nav` | goto, wait, snapshot | Navigation + page readiness |
| `interact` | click, type, press, hover, check, select, scroll, etc. | Element interaction |
| `dom` | dom-html, dom-text, dom-attr, dom-value, dom-visible, dom-enabled, dom-checked | DOM operations |
| `session` | launch, connect, disconnect, status | Session management |
| `targets` | targets-list, target-use, target-new, target-close | Target (tab) management |
| `devtools` | console-poll, network-poll, perf, screenshot | DevTools integration |
| `annotate` | annotate | Visual annotations |
| `export` | clone-page, clone-component | Page/component export |
| `pages` | page, pages, page-close | Named page management |
| `daemon` | serve, daemon (install/uninstall/status) | Daemon lifecycle |

## Key Components

### Command System
- **Registry:** `registry.ts` - Command registration by category
- **Types:** `CommandDefinition` with `run()` returning `CommandResult`
- **Output:** `writeOutput()` for consistent JSON/text formatting
- **Errors:** `createUsageError()` for CLI argument errors

### Daemon Mode
- **Server:** `daemon.ts` - HTTP server for tool execution
- **Client:** `daemon-client.ts` - HTTP client for CLI → daemon
- **Proxy:** `remote-manager.ts` - Proxies tool calls through daemon
- **Autostart:** `daemon-autostart.ts` - LaunchAgent/Task Scheduler
- **Status:** `daemon-status.ts` - Hub status with metadata recovery

### Hub Mode
- **Check:** `isHubEnabled()` from `../utils/hub-enabled`
- **Routing:** Tools use `RemoteManager` when hub enabled
- **Queueing:** FIFO lease queue in daemon
- **No fallback:** No local relay when hub enabled

## Conventions

- **Commands:** Return `CommandResult` with structured data
- **Output:** Always use `writeOutput()` (never `console.log`)
- **Hub-aware:** Check `isHubEnabled()` before local operations
- **Thin handlers:** Delegate to managers in `src/browser/`
- **JSON pipes:** Ensure valid JSON for piping

## Anti-Patterns

- **Direct console.log:** Breaks JSON pipes
- **Local-only logic:** Must work via hub/daemon too
- **Heavy handlers:** Keep CLI thin, delegate to core
- **Synchronous file ops:** Use async/await

## Dependencies

- `../browser/*` - Session, target management
- `../relay/*` - Relay server control
- `../tools/*` - Tool definitions (for hub proxying)
- `../utils/hub-enabled` - Hub mode detection
