# src/cli/ — Agent Guidelines

Extends `src/AGENTS.md`. Primary entry for CLI commands and daemon management.

## Overview
CLI layer implementing script-first UX, hub-mode daemon, daemon autostart, and installers.

## Structure
```
src/cli/
├── commands/             # Command categories (nav, dom, interact, etc.)
│   └── registry.ts       # Command registration system
├── installers/           # Global/Local/Skill installers
├── utils/                # CLI-specific parsing and config
├── daemon.ts             # Hub-mode daemon implementation
├── daemon-autostart.ts   # LaunchAgent/Task Scheduler install/remove/status
├── daemon-commands.ts    # HTTP command handlers for daemon mode
├── daemon-client.ts      # CLI client for daemon HTTP API
├── remote-manager.ts     # Proxy for daemon-bound tool calls
└── output.ts             # Unified JSON/Text output handler
```

## Where to Look
- **New Command:** Add to `commands/<category>/`, register in `registry.ts`.
- **Daemon Autostart:** `commands/daemon.ts` wires install/uninstall/status; impl in `daemon-autostart.ts`.
- **Output Logic:** Modify `output.ts` for formatting/streaming changes.
- **Daemon/Hub:** `daemon.ts` for server, `remote-manager.ts` for client-side proxying.
- **Args Parsing:** `args.ts` and `utils/parse.ts`.

## Conventions
- **Commands:** Use `CommandDefinition`. Handlers must return `CommandResult`.
- **Output:** Always use `writeOutput()` for consistent JSON/text formatting.
- **Hub Mode:** Tools check `isHubEnabled()` and use `RemoteManager` if true.
- **Errors:** Use `createUsageError()` for invalid CLI arguments.
- **Autostart:** `opendevbrowser daemon install|uninstall|status` must return structured output in all formats.

## Anti-Patterns
- **Direct console.log:** Use `writeOutput` for valid JSON output pipes.
- **Local-only logic:** Ensure commands work both locally and via hub/daemon.
- **Heavy Handlers:** Keep `run()` handlers thin; delegate to `src/core` or `src/browser`.
