# OpenDevBrowser Daemon Auto-Start + Extension Auto-Retry (Merged Spec + Plan)

This document consolidates `docs/OPENCODE_DAEMON_AUTOSTART_SPEC.md` and the daemon-related notes in `docs/TOOL_CLI_PARITY_SPEC.md` into a single aligned specification and implementation plan.

---

## Overview

### Goals
- Ensure the relay daemon is available without OpenCode running by auto-starting `opendevbrowser serve` on login (macOS + Windows).
- Make the extension auto-pair resilient via retry/backoff until `/config` + `/pair` are reachable.
- Keep CLI contracts consistent with existing conventions (`--output-format`, exit codes).

### Scope
- New CLI-only `daemon` subcommands for install/uninstall/status.
- OS-level autostart (LaunchAgent on macOS, Task Scheduler on Windows).
- Extension retry/backoff behavior (MV3-safe scheduling).
- Docs and parity alignment.

### Out of scope (this phase)
- Native messaging host.
- Linux systemd user service (optional follow-up).

### Success criteria
- After boot/login, relay is reachable on configured relay port (default `127.0.0.1:8787`).
- Extension auto-pairs within ~60 seconds without opening the popup.
- Users can uninstall/disable auto-start cleanly.

---

## Key decisions
- Keep `daemon install|uninstall|status` as CLI-only commands (no tool equivalents).
- Use `--output-format` (not `--json`) to align with existing CLI output conventions.
- Require absolute CLI entrypoints in OS service configs to avoid PATH issues at login.
- Prefer `chrome.alarms` for reliable MV3 scheduling; allow a `setTimeout` fallback if avoiding new permissions.

---

## CLI Contract (Spec)

### Command tree
```
opendevbrowser daemon install
opendevbrowser daemon uninstall
opendevbrowser daemon status
```

### Global flags
- `--output-format` (`text`, `json`, `stream-json`)
- `--quiet`
- `--no-interactive` / `--no-prompt`

### Exit codes (align with CLI conventions)
- `0` success
- `1` usage error
- `2` execution error (permissions, missing binary, OS service failure)
- `10` disconnected/not running (status only)

### `daemon install`
- macOS: write `~/Library/LaunchAgents/com.opendevbrowser.daemon.plist` targeting a stable, absolute CLI entrypoint.
- Windows: create a per-user Task Scheduler logon task targeting a stable, absolute CLI entrypoint.
- Entry point should resolve to the package bin (`opendevbrowser` -> `dist/cli/index.js`) via `process.execPath` + absolute JS path, or a small wrapper script with an absolute Node path.
- Return success + path/task name + resolved command.

### `daemon uninstall`
- macOS: unload/remove LaunchAgent; stop running daemon if active.
- Windows: delete scheduled task; stop running daemon if active.

### `daemon status`
- Report if auto-start is installed.
- Report if daemon is running (via daemon `/status`) without throwing a usage error when missing.
- Suggested JSON: `{ installed: boolean, running: boolean, status?: <daemon status payload> }`.

---

## Extension Auto-Retry (Spec)

### Current behavior
- Auto-connect attempts once at startup and on certain storage events.
- If relay is down, it stops with "Start the daemon" note.

### New behavior
- If relay config fetch fails, schedule retry with exponential backoff (e.g., 5s, 10s, 20s… max 60s).
- Prefer `chrome.alarms` for reliable MV3 scheduling; add `alarms` permission and update mocks/tests.
- If avoiding new permissions, use `setTimeout` backoff in the background worker with a note about MV3 suspension risk.
- Stop retry after successful connection or if the user disables auto-connect.

---

# Implementation Plan

---

## Task 1 — Add daemon subcommands to CLI surface

### Reasoning
Daemon autostart must be exposed as CLI-only commands aligned with existing output and exit-code conventions.

### What to do
Add `daemon install|uninstall|status` to CLI parsing, registration, and output flow using `--output-format`.

### How
1. Extend `src/cli/args.ts` to accept `daemon` command and its subcommands (and validate flags).
2. Register the new command in `src/cli/index.ts` and route to a new handler.
3. Implement `src/cli/commands/daemon.ts` that dispatches to install/uninstall/status handlers and returns structured output.

### Files impacted
- `src/cli/args.ts`
- `src/cli/index.ts`
- `src/cli/commands/daemon.ts` (new)

### End goal
CLI accepts the `daemon` subcommands and produces consistent output formats and exit codes.

### Acceptance criteria
- [x] `opendevbrowser daemon install` routes to the new handler.
- [x] `opendevbrowser daemon uninstall` routes to the new handler.
- [x] `opendevbrowser daemon status` routes to the new handler.
- [x] `--output-format json` produces structured output.

---

## Task 2 — Implement OS auto-start installers

### Reasoning
Autostart relies on OS-level service configuration that must be created/removed reliably.

### What to do
Add macOS LaunchAgent and Windows Task Scheduler installers with absolute entrypoints and safe teardown.

### How
1. Add helper functions in `src/cli/daemon.ts` (or a new module) to:
   - Build an absolute CLI entrypoint.
   - Create/update LaunchAgent plist on macOS and bootstrap it with launchctl.
   - Create/delete a Task Scheduler logon task on Windows.
2. Ensure uninstall removes services and stops a running daemon if present.
3. Return clear success/error messages and structured data.

### Files impacted
- `src/cli/daemon.ts`
- `src/cli/commands/daemon.ts`

### End goal
OS-level autostart can be installed and removed without manual steps, using absolute paths.

### Acceptance criteria
- [x] LaunchAgent is created and bootstrapped on macOS using an absolute entrypoint.
- [x] Task Scheduler task is created on Windows using an absolute entrypoint.
- [x] Uninstall removes services and stops the running daemon.

---

## Task 3 — Implement daemon status semantics

### Reasoning
`daemon status` should be safe and informative, even when the daemon is not running.

### What to do
Implement `daemon status` to report `{ installed, running, status? }` and avoid usage errors when missing.

### How
1. Check OS-level install state (plist/task presence).
2. Attempt daemon `/status` using stored metadata or config.
3. Return JSON shape and a concise text summary.

### Files impacted
- `src/cli/commands/daemon.ts`
- `src/cli/daemon-status.ts` (if extended)

### End goal
`daemon status` reports install + runtime state without failing on absence.

### Acceptance criteria
- [x] Missing daemon returns `running=false` without usage error.
- [x] JSON output includes `installed`, `running`, and optional `status`.

---

## Task 4 — Add MV3 retry/backoff scheduling

### Reasoning
The extension must re-attempt pairing when the daemon starts after Chrome, but MV3 service workers can be suspended.

### What to do
Add retry/backoff scheduling in the background worker; prefer `chrome.alarms` with manifest permission and test updates.

### How
1. Add `alarms` permission to `extension/manifest.json` if using alarms.
2. Implement retry scheduling in `extension/src/background.ts` with exponential backoff and reset on success.
3. Update extension tests/mocks to cover alarms or fallback scheduling.

### Files impacted
- `extension/manifest.json`
- `extension/src/background.ts`
- `tests/extension-connection-manager.test.ts`
- extension chrome mocks

### End goal
Extension retries auto-pair until the relay is reachable within bounded backoff.

### Acceptance criteria
- [x] Retry scheduling triggers after config fetch failures.
- [x] Successful connection cancels retries.
- [x] Tests cover retry scheduling path.

---

## Task 5 — Docs and parity alignment

### Reasoning
Documentation must reflect the new CLI commands and autostart behavior.

### What to do
Update CLI docs, parity spec notes, and add cross-references.

### How
1. Update `docs/CLI.md` with the planned `daemon` subcommands and exit codes.
2. Update `docs/TOOL_CLI_PARITY_SPEC.md` to reference this plan for daemon commands.
3. Add a deprecation note to `docs/OPENCODE_DAEMON_AUTOSTART_SPEC.md` if keeping it for history.

### Files impacted
- `docs/CLI.md`
- `docs/TOOL_CLI_PARITY_SPEC.md`
- `docs/OPENCODE_DAEMON_AUTOSTART_SPEC.md`

### End goal
Docs are aligned and point to this merged spec/plan as the source of truth.

### Acceptance criteria
- [x] CLI docs list `daemon` subcommands with correct output format notes.
- [x] Parity spec references this merged document for daemon commands.
- [x] Deprecated doc is clearly marked (if retained).

---

## File-by-file implementation sequence

1. `src/cli/args.ts` — Task 1
2. `src/cli/index.ts` — Task 1
3. `src/cli/commands/daemon.ts` — Tasks 1, 2, 3 (new file)
4. `src/cli/daemon.ts` — Task 2
5. `extension/manifest.json` — Task 4
6. `extension/src/background.ts` — Task 4
7. `tests/extension-connection-manager.test.ts` — Task 4
8. `docs/CLI.md` — Task 5
9. `docs/TOOL_CLI_PARITY_SPEC.md` — Task 5
10. `docs/OPENCODE_DAEMON_AUTOSTART_SPEC.md` — Task 5 (deprecate note)

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| (none) | | |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-26 | Initial merged spec + plan |
