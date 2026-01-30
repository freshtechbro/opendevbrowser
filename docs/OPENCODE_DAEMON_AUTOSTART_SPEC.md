# OpenDevBrowser Daemon Auto-Start + Extension Auto-Retry Spec

NOTE: This spec is superseded by `docs/OPENCODE_DAEMON_AUTOSTART_PLAN.md`, which merges spec + implementation plan.
Implementation status: the plan is now implemented in code; keep this doc for historical reference.
Implementation notes: relay HTTP endpoints allow loopback no-Origin (including `Origin: null`) and include `Access-Control-Allow-Private-Network: true` on preflight when requested.

This document defines the cross-platform auto-start strategy for the opendevbrowser daemon and the extension auto-pair retry behavior, so the Chrome extension can connect without needing opencode to start.

---

## Overview

**Problem**: Extension auto-pair currently fails unless the relay daemon is already running. Users have to manually start opencode to load the plugin and start the daemon. This is wrong for standalone extension usage.

**Goal**: Make the extension auto-pair seamless on macOS + Windows by:
1) Auto-starting `opendevbrowser serve` at user login (using a stable, absolute CLI entrypoint, not PATH-only).
2) Adding background retry/backoff in the extension so it re-attempts `/config` + `/pair` until the relay is reachable.

**Success criteria**
- A fresh boot + login results in relay reachable at the configured relay port (default `127.0.0.1:8787`) without opening opencode.
- Extension auto-pairs within ~60 seconds without opening the popup.
- Users can uninstall/disable the auto-start daemon cleanly.

---

## Scope

### In-scope
- CLI commands to install/uninstall/status the daemon auto-start.
- macOS LaunchAgent install.
- Windows Task Scheduler install.
- Extension auto-retry/backoff when relay is unreachable.
- Documentation updates and parity spec alignment.

### Out-of-scope (for this phase)
- Native messaging host.
- Linux systemd user service (optional follow-up).

---

## Architecture summary

**Daemon/Relay**
- Relay server is started by `opendevbrowser serve`.
- Extension auto-pair requires relay reachable at `/config` then `/pair`.

**Extension**
- Background worker attempts auto-connect on startup, but currently does not retry if relay is down.

---

## CLI spec (new subcommands)

### Command tree
```
opendevbrowser daemon install   # install auto-start daemon
opendevbrowser daemon uninstall # remove auto-start daemon
opendevbrowser daemon status    # show install + running status
```

### Global flags
- `--output-format` (`text`, `json`, `stream-json`) — use existing CLI output format flag.
- `--quiet` — suppress non-essential output.
- `--no-interactive` / `--no-prompt` — skip prompts when applicable.

### `daemon install`
**Behavior**
- macOS: write `~/Library/LaunchAgents/com.opendevbrowser.daemon.plist` pointing to a stable CLI entrypoint (absolute path). Avoid relying on PATH in launchd.
- Windows: create a per-user Task Scheduler task on logon pointing to a stable CLI entrypoint (absolute path).
- The entrypoint should resolve to the package bin (`opendevbrowser` → `dist/cli/index.js`) via `process.execPath` + absolute JS path, or a small wrapper script with an absolute Node path.
- Return success + path/task name + resolved command.

**Exit codes (align with CLI conventions)**
- `0` success
- `1` usage error (invalid args)
- `2` execution error (permissions, missing binary, OS service failure)
- `10` disconnected/not running (status only)

### `daemon uninstall`
**Behavior**
- macOS: unload and remove LaunchAgent plist; stop running daemon if active.
- Windows: delete scheduled task; stop running daemon if active.

### `daemon status`
**Behavior**
- Report if auto-start is installed.
- Report if daemon is running (via daemon `/status`), without throwing a usage error when missing.
- Suggested JSON shape: `{ installed: boolean, running: boolean, status?: <daemon status payload> }`.

---

## Extension auto-retry spec

### Current behavior
- Auto-connect attempts once at startup and on certain storage events.
- If relay is down, it stops with “Start the daemon” note.

### New behavior
- If relay config fetch fails, schedule retry with exponential backoff (e.g., 5s, 10s, 20s… max 60s).
- Prefer `chrome.alarms` for reliable MV3 scheduling; add the `alarms` permission to `extension/manifest.json` and update mocks/tests accordingly.
- If we avoid new permissions, use a `setTimeout`-based backoff in the background worker, but note it may be less reliable due to MV3 service worker suspension.
- Once relay reachable and token acquired, auto-connect succeeds without popup.

**Exit from retry**
- Stop retry after successful connection.
- Stop retry if user explicitly disables auto-connect.

---

## Files impacted

- `src/cli/index.ts` — register new `daemon` subcommand.
- `src/cli/commands/daemon.ts` (new) — implement install/uninstall/status.
- `src/cli/daemon.ts` — helper to write/remove LaunchAgent / Task Scheduler scripts.
- `extension/src/background.ts` — add retry loop using `chrome.alarms` (or `setTimeout` fallback).
- `extension/manifest.json` — add `alarms` permission if using alarms.
- `tests/extension-connection-manager.test.ts` and chrome mocks — update for alarms/backup retry logic.
- `docs/CLI.md` — document new subcommands.
- `docs/TOOL_CLI_PARITY_SPEC.md` — add new CLI-only commands for daemon install/uninstall/status.

---

## Risks and mitigations

- **Multiple daemons**: guard by checking running status before starting a new instance.
- **Path resolution**: avoid PATH-only commands in OS services; use absolute entrypoints.
- **Token mismatch**: extension already clears pairing token on invalid pairing.
- **User control**: provide uninstall and status commands.

---

## Acceptance criteria

- [ ] `opendevbrowser daemon install` sets up auto-start on macOS/Windows.
- [ ] `opendevbrowser daemon uninstall` cleanly removes auto-start.
- [ ] `opendevbrowser daemon status` reports installed + running.
- [ ] Extension retries auto-pair until relay is reachable.
- [ ] If using `chrome.alarms`, the `alarms` permission is added and tests/mocks updated.
- [ ] Docs updated in `docs/CLI.md` and `docs/TOOL_CLI_PARITY_SPEC.md`.

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-26 | Initial spec |
