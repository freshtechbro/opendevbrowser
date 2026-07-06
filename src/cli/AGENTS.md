# CLI Module

**Scope:** Commands, daemon management, installers, hub-mode proxying

## Overview

CLI layer implementing script-first UX with 77 commands across install/runtime, session, navigation, interaction, targets/pages, DOM, design-canvas, export, diagnostics, provider workflows, macro, annotate, browser capture and replay, desktop observation, and power surfaces. Supports local execution and hub-mode daemon proxying. Includes autostart installers for macOS (LaunchAgent) and Windows (Task Scheduler).

## Structure

```
src/cli/
├── commands/               # Command implementations grouped by category
│   ├── annotate.ts         # Annotation commands
│   ├── artifacts.ts        # Artifact generation commands
│   ├── canvas.ts           # Design-canvas command wrapper
│   ├── daemon.ts           # Daemon lifecycle
│   ├── desktop/            # Desktop observation commands
│   ├── devtools/           # Console/network commands
│   ├── dom/                # DOM capture/export
│   ├── export/             # Page export commands
│   ├── interact/           # 10 interaction commands (click, type, upload, etc.)
│   ├── macro-resolve.ts    # Macro plan resolution
│   ├── native.ts           # Native messaging bridge
│   ├── nav/                # Navigation commands
│   ├── pages/              # Page management
│   ├── product-video.ts    # Product video workflow commands
│   ├── registry.ts         # Command registration
│   ├── research.ts         # Research workflow commands
│   ├── rpc.ts              # Power-user internal daemon RPC (unsafe)
│   ├── run.ts              # Script execution
│   ├── serve.ts            # Relay server commands
│   ├── session/            # Session, cookie, and inspector commands
│   ├── shopping.ts         # Shopping workflow commands
│   ├── status.ts           # Status commands
│   ├── targets/            # Target management
│   ├── types.ts            # Command types
│   ├── uninstall.ts        # Uninstall command
│   └── update.ts           # Update command
├── installers/             # Installation scripts
│   ├── global.ts           # Global npm install
│   ├── local.ts            # Local project install
│   ├── package-postinstall.ts # Best-effort package lifecycle orchestration
│   ├── postinstall-skill-sync.ts # Skill sync API plus stable package-postinstall re-exports
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
├── remote-desktop-runtime.ts # Daemon-backed DesktopRuntimeLike proxy for public desktop commands
├── remote-relay.ts         # Relay status cache
├── commands/native.ts      # Native messaging command handlers
├── output.ts               # JSON/text output formatting
└── index.ts                # CLI entry point
```

## Command Categories

| Category | Commands | Purpose |
|----------|----------|---------|
| `nav` | goto, wait, snapshot | Navigation + page readiness |
| `interact` | click, type, press, hover, check, select, scroll, upload, etc. | Element interaction |
| `dom` | dom-html, dom-text, dom-attr, dom-value, dom-visible, dom-enabled, dom-checked | DOM operations |
| `session` | launch, connect, disconnect, status, cookie-import, cookie-list, session-inspector, session-inspector-audit, session-inspector-plan | Session management and inspector reporting |
| `targets` | targets-list, target-use, target-new, target-close | Target (tab) management |
| `devtools` | console-poll, network-poll, debug-trace-snapshot, perf, screenshot, screencast-start, screencast-stop, dialog | DevTools integration |
| `desktop` | desktop-status, desktop-windows, desktop-active-window, desktop-capture-desktop, desktop-capture-window, desktop-accessibility-snapshot | Daemon-backed read-only desktop observation |
| `automation` | macro-resolve | Provider macro planning utilities |
| `canvas` | canvas | Design-canvas session/document/preview orchestration |
| `providers` | research, shopping, product-video, artifacts | Provider-backed workflow commands |
| `status` | status-capabilities | Host capability preflight, including optional Inspiredesign FFmpeg/FFprobe media-analysis availability |
| `annotate` | annotate | Visual annotations plus shared `--stored` retrieval |
| `power` | rpc | Internal daemon command passthrough (guarded, unsafe/power-user only) |
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
- **Remote desktop:** `remote-desktop-runtime.ts` - Proxies the daemon-owned `DesktopRuntimeLike` surface; desktop observation stays outside extension relay
- **Autostart:** `daemon-autostart.ts` - LaunchAgent/Task Scheduler platform safety owner; refuses transient `_npx`, `/tmp`, `/private/tmp`, and onboarding workspace entrypoints before writes
- **Package postinstall:** `installers/package-postinstall.ts` - best-effort raw npm global package autostart reconciliation; re-export through `installers/postinstall-skill-sync.ts` preserves the shipped built import path
- **Status:** `daemon-status.ts` - Hub status with metadata recovery
- **Capabilities:** `status-capabilities.host.mediaAnalysis` reports optional host FFmpeg/FFprobe availability as diagnostic/preflight visibility only, not daemon freshness or product-readiness proof. FFmpeg/FFprobe are not bundled static binaries or default downloads. Resolve binaries env, then config, then `PATH`; missing binaries degrade `media-analysis.json` only and cannot replace `pin-media-index.json` or `motion-evidence.json` authority.
- **Internal inbox hooks:** `daemon-commands.ts` exposes `agent.inbox.*` hub-only helpers that proxy the same core-local `AgentInbox` store used by plugin delivery

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
- **Help discoverability:** Generated help must keep the exact lookup labels `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use` easy to find without describing a desktop agent.
- **Package lifecycle:** Raw npm global package postinstall targets `dist/cli/index.js`, not `scripts/postinstall-sync-skills.mjs`; local, ambiguous, conflicting, or non-npm package-manager contexts skip autostart without failing install.
- **Skill targets:** Installer skill sync covers OpenCode, Codex-through-Agents, ClaudeCode, AmpCLI, and Agents (`~/.agents/skills` plus project `./.agents/skills`) targets; managed root-marker repairs may adopt stale markerless canonical packs, managed legacy Codex duplicates may be removed only with marker or sentinel ownership, and unmanaged markerless directories stay preserved. Keep CLI docs, README, onboarding, and SkillLoader discovery aligned.
- **Parity contract:** Keep CLI runtime commands aligned with tool/runtime parity gate in `tests/parity-matrix.test.ts` (`rpc` remains CLI-only by design)

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

## Release Gates

- Run `node scripts/cli-smoke-test.mjs` for managed CLI surface validation.
- Run `npm run test -- tests/parity-matrix.test.ts tests/providers-performance-gate.test.ts` before release.
- Run release audits before tagging:
  - `node scripts/audit-zombie-files.mjs`
  - `node scripts/docs-drift-check.mjs`
  - `node scripts/chrome-store-compliance-check.mjs`
- Run strict live release gates:
  - `node scripts/provider-direct-runs.mjs --release-gate`
  - `node scripts/live-regression-direct.mjs --release-gate`
- Follow `docs/RELEASE_RUNBOOK.md` and the current version-scoped release evidence doc for final sign-off. For package version `0.0.40`, use `docs/RELEASE_0.0.40_EVIDENCE.md`.
- Keep command/flag/channel inventories synchronized with `docs/CLI.md` and `docs/SURFACE_REFERENCE.md`.

## Layered AGENTS

- `src/cli/commands/AGENTS.md` - CLI command handler subdomains and thin-command rules
- `src/cli/commands/session/AGENTS.md` - Session, cookie, and inspector command handlers
- `src/cli/installers/AGENTS.md` - Installer and package lifecycle helpers
