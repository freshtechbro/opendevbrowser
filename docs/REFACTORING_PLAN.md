# OpenDevBrowser Unified Refactor Audit + Plan

This document merges the CLI research report and extension pinning research with a codebase audit. It is the single source of truth for the refactor scope, critique, and remaining implementation plan.

---

## Overview

### Scope and goals
- Deliver multi-distribution support: plugin, CLI automation, and extension relay UX improvements.
- Preserve existing installer behavior and OpenCode plugin compatibility.
- Keep security-first defaults (local-only CDP, token-based relay pairing, redacted output).
- Maintain test coverage >=95% with passing build/test runs.

### Current state (verified in codebase)
- Core bootstrap extracted under `src/core/` and used by plugin + CLI.
- CLI includes install/update/uninstall plus automation commands (`serve`, `run`, `launch`, nav, interact).
- Extension auto-connect and status badge implemented; auto-pair uses `/config` and `/pair`.
- Launch tool prefers relay when connected and returns relay warnings on fallback.
- Tests cover CLI output, daemon behavior, config JSONC errors, and extension auto-connect.

### Research summary (CLI)
- Default text output with optional JSON/stream-json for automation.
- Treat structured output as a versioned API (additive only).
- Avoid interactive prompts by default; support `--no-interactive` and `--quiet`.

### Research summary (extension pinning)
- Extension relay mode remains the preferred pinning mechanism when connected.
- Auto-connect and auto-pair are opt-in and must remain local-only.
- Discovery via `/config` rejects explicit non-extension origins; CLI should not call it.

### Audit and critique (codebase vs docs)

#### Alignments
- Core extraction and plugin wiring match plan (`src/core/*`, `src/index.ts`).
- CLI global flags and output formats align with docs (`src/cli/args.ts`).
- Daemon-based session persistence is implemented (`src/cli/daemon.ts`, `src/cli/commands/serve.ts`).
- Extension auto-connect and badge updates are implemented (`extension/src/background.ts`, `extension/src/popup.tsx`).
- Extension connect flow now validates active tab URLs and surfaces failure notes (restricted tabs, debugger attach failures).
- Relay origin validation and token handling align with security requirements (`src/relay/relay-server.ts`).

#### Gaps / risks
- `stream-json` only streams arrays; `run` emits a single JSON object (not per-step lines).
- External web research was blocked (Exa 402); recommendations rely on codebase + existing references.

#### Security-first recommendations
- Reject explicit non-extension origins for `/pair` and `/config`; allow missing `Origin` for extension fetches when Chrome omits it.
- Document `stream-json` semantics and avoid implying per-step streaming unless implemented.

### Recommended options (resolved open questions)
- CLI output: text default; add `--output-format json|stream-json` (additive schema only).
- Session persistence: daemon-managed sessions or single-shot `run`; no file-only sessionId.
- Installer compatibility: preserve existing flags; add subcommand aliases.
- Extension scope: relay-only v1; defer action queue/auto-mode until a new protocol is defined.

### Implementation status (2026-01-11)
- Tasks 1-4, 6-9 complete.
- Task 5 deferred (skill pack).

### Non-goals (deferred)
- Action queue UI and auto-mode execution.
- MCP orchestration or tool registration.
- Non-local relay endpoints.

---

## Task 1 — Extract shared core module

### Reasoning
CLI automation needs the same BrowserManager and ScriptRunner logic without plugin-specific dependencies.

### What to do
Create `src/core/` that exposes a reusable core bootstrap for plugin and CLI.

### How
1. Add `src/core/types.ts` for core dependencies and config types.
2. Add `src/core/bootstrap.ts` to initialize BrowserManager, ScriptRunner, SkillLoader, RelayServer.
3. Add `src/core/index.ts` that exports a factory function returning the core instance.
4. Refactor `src/index.ts` to call the core factory and wire plugin hooks.

### Files impacted
- `src/core/types.ts` (new file)
- `src/core/bootstrap.ts` (new file)
- `src/core/index.ts` (new file)
- `src/index.ts`

### End goal
Plugin and CLI can share a single core initialization path without plugin-only dependencies.

### Acceptance criteria
- [x] Core module has no `@opencode-ai/plugin` imports.
- [x] Plugin behavior remains unchanged after refactor.
- [x] Existing tests pass at 95%+ coverage.

---

## Task 2 — CLI command framework with installer compatibility

### Reasoning
The CLI must expose automation commands without breaking existing install/update/uninstall flows.

### What to do
Add a command registry and output formatting while preserving current flags.

### How
1. Implement a command registry (`src/cli/commands/registry.ts`) and command interface types.
2. Add `--output-format text|json|stream-json`, `--quiet`, `--no-interactive` global flags.
3. Keep existing installer flags as default behavior; add `install`, `update`, `uninstall` subcommand aliases.
4. Document exit codes and structured output behavior in `docs/CLI.md`.

### Files impacted
- `src/cli/commands/registry.ts` (new file)
- `src/cli/commands/types.ts` (new file)
- `src/cli/output.ts` (new file)
- `src/cli/args.ts`
- `src/cli/index.ts`
- `docs/CLI.md`

### End goal
CLI supports automation commands and structured output without breaking current installer workflows.

### Acceptance criteria
- [x] `npx opendevbrowser --help` shows installer and automation commands.
- [x] `--output-format json` returns structured JSON with errors and metadata.
- [x] Installer flags remain functional and backward compatible.

---

## Task 3 — CLI automation + daemon-backed session persistence

### Reasoning
Session persistence across CLI invocations requires a daemon; file-only session IDs are not viable.

### What to do
Add automation commands with a local daemon for persistent sessions and a batch `run` mode.

### How
1. Implement `opendevbrowser serve` to start a local daemon that owns BrowserManager and RelayServer.
2. Expose a local-only control API for CLI commands to call into the daemon.
3. Add `opendevbrowser run` to execute a JSON script in one process without requiring a daemon.
4. Add session, navigation, and interaction commands that require a daemon; return a clear error if none is running.
5. Persist minimal daemon metadata (port, token, pid) under `~/.cache/opendevbrowser/`.
6. Load global config for daemon defaults (relayPort, relayToken, security flags) and keep local-only binding.

### Files impacted
- `src/cli/daemon.ts` (new file)
- `src/cli/client.ts` (new file)
- `src/cli/commands/serve.ts` (new file)
- `src/cli/commands/run.ts` (new file)
- `src/cli/commands/session/*.ts` (new files)
- `src/cli/commands/nav/*.ts` (new files)
- `src/cli/commands/interact/*.ts` (new files)

### End goal
Agents can run single-shot scripts via `run` or use `serve` for persistent sessions and the extension relay.

### Acceptance criteria
- [x] Daemon binds to `127.0.0.1` and requires a token.
- [x] `run` executes multi-step scripts with JSON output.
- [x] Session commands error clearly when no daemon is running.

---

## Task 4 — Extension pinning UX and relay-first controls

### Reasoning
Extension relay mode already provides pinning, but connection and user guidance are manual and unclear.

### What to do
Add opt-in auto-connect, status indicators, and CLI flags to control relay usage.

### How
1. Add `autoConnect` setting (default false) stored in `chrome.storage.local`.
2. In `extension/src/background.ts`, add `onStartup` and `onInstalled` handlers to auto-connect when enabled.
3. Add connection status badge updates in background using `ConnectionManager.onStatus` with `chrome.action`.
4. Update popup UI in `extension/popup.html` and `extension/src/popup.tsx` to expose auto-connect toggle.
5. Add `--extension-only`, `--no-extension`, and `--wait-for-extension` options to CLI launch and plugin tool; return structured errors for JSON output.
6. Implement optional wait logic with timeout only when explicitly requested.
7. When relay is unavailable, emit a warning and fall back to launch unless `--extension-only` is set.

### Files impacted
- `extension/src/background.ts`
- `extension/src/services/ConnectionManager.ts`
- `extension/src/relay-settings.ts`
- `extension/popup.html`
- `extension/src/popup.tsx`
- `src/tools/launch.ts`
- `src/cli/commands/session/launch.ts`

### End goal
Users can keep relay pinning as the default mode while controlling fallback behavior and connection UX.

### Acceptance criteria
- [x] Auto-connect is stored in extension settings and enabled by default.
- [x] Badge reflects connected/disconnected states.
- [x] CLI/launch flags control relay usage without breaking defaults.
- [x] Auto-connect and auto-pair default on for seamless onboarding.

---

## Task 5 — Consolidated skill pack (Deferred)

### Reasoning
Agents need a single, portable skill that documents tools and CLI usage.

### What to do
Create `skills/opendevbrowser/SKILL.md` as a comprehensive guide, linking existing best-practices content.

### How
1. Create the new skill and include all tool definitions with examples.
2. Add CLI command usage and output format guidance.
3. Add a distribution decision tree (plugin vs CLI vs extension).

### Files impacted
- `skills/opendevbrowser/SKILL.md` (new file)

### End goal
A single skill doc enables agents to use OpenDevBrowser across environments.

### Acceptance criteria
- [ ] Covers all plugin tools and CLI commands.
- [ ] Includes topic-filtered sections for best practices.
- [ ] Explains relay pinning and extension requirements.

---

## Task 6 — Tests for CLI and extension changes

### Reasoning
New CLI behavior and extension auto-connect need regression coverage.

### What to do
Add tests for CLI parsing/output and extension auto-connect behavior.

### How
1. Add CLI tests for argument parsing, output formats, and exit codes.
2. Add extension tests using `tests/extension-chrome-mock.ts` for auto-connect and badge updates.
3. Maintain coverage at 95%+.

### Files impacted
- `tests/cli-output.test.ts` (new file)
- `tests/extension-background.test.ts` (new file)
- `tests/core-bootstrap.test.ts` (new file)
- `tests/config-jsonc-errors.test.ts` (new file)
- `tests/config-jsonc-empty.test.ts` (new file)
- `tests/tools.test.ts`

### End goal
Automation changes are covered by tests and do not reduce coverage.

### Acceptance criteria
- [x] CLI tests validate JSON and text outputs.
- [x] Extension auto-connect and badge behavior covered.
- [x] Coverage remains at or above 95%.

---

## Task 7 — Documentation updates

### Reasoning
New CLI and extension behaviors require user-facing documentation.

### What to do
Update README and CLI/extension docs to reflect the new behavior and security constraints.

### How
1. Update `docs/CLI.md` with commands, output formats, and daemon usage.
2. Update `docs/EXTENSION.md` with relay pinning, auto-connect, and pairing rules.
3. Update README with quick-start instructions and security notes.

### Files impacted
- `docs/CLI.md`
- `docs/EXTENSION.md`
- `README.md`

### End goal
Docs are aligned with the new CLI, extension behavior, and security-first defaults.

### Acceptance criteria
- [x] README includes CLI automation quick start and extension pinning notes.
- [x] CLI docs explain daemon vs run usage.
- [x] Extension docs explain auto-connect and pairing behavior.

---

## Task 8 — Standardize CLI exit codes and error output

### Reasoning
Automation requires consistent exit codes and JSON error payloads when `--output-format` is json/stream-json. Current CLI exits with code 1 for most errors and prints text errors.

### What to do
Implement consistent exit codes and JSON-formatted error outputs across CLI commands, including disconnected and daemon errors.

### How
1. Define exit code constants (0 success, 1 usage, 2 execution, 10 disconnected).
2. Update `src/cli/index.ts` to format thrown errors according to `--output-format` and to use consistent exit codes.
3. Update command handlers to return explicit `exitCode` for known error cases (daemon not running, extension-only failure).
4. Update `docs/CLI.md` with an exit code table and JSON error examples.
5. Add tests for exit code resolution and JSON error payloads.

### Files impacted
- `src/cli/errors.ts` (new file)
- `src/cli/index.ts`
- `src/cli/args.ts`
- `src/cli/client.ts`
- `src/cli/commands/serve.ts`
- `src/cli/commands/session/*.ts`
- `docs/CLI.md`
- `tests/cli-errors.test.ts` (new file)

### End goal
CLI automation has consistent exit codes and JSON error output aligned with `--output-format`.

### Acceptance criteria
- [x] Disconnected or daemon-missing cases return exit code 10.
- [x] Usage errors return exit code 1; execution errors return exit code 2.
- [x] JSON output includes error payloads for command-level failures and thrown errors.

---

## Task 9 — Clarify pairing endpoint policy (Origin handling)

### Reasoning
Chrome extension fetches can omit the `Origin` header, so `/pair` (and `/config`) must allow missing Origin while still rejecting explicit non-extension origins.

### What to do
Allow missing Origin for `/pair` and `/config`, but continue rejecting explicit non-extension origins, and document the policy.

### How
1. Update `src/relay/relay-server.ts` to allow missing Origin for `/pair` and `/config`, but reject explicit non-extension origins.
2. Update `docs/EXTENSION.md` and this plan with the missing-Origin allowance.
3. Add or update tests for `/pair` and `/config` origin handling.

### Files impacted
- `src/relay/relay-server.ts`
- `docs/EXTENSION.md`
- `tests/relay-server.test.ts`

### End goal
Pairing token access policy allows missing-Origin extension requests while still blocking explicit non-extension origins.

### Acceptance criteria
- [x] Policy choice documented in `docs/EXTENSION.md`.
- [x] `/pair` and `/config` reject explicit non-extension origins with 403.
- [x] `/pair` and `/config` allow missing Origin requests.
- [x] Tests cover the selected policy.

---

## File-by-file implementation sequence

1. `src/core/types.ts` — Task 1
2. `src/core/bootstrap.ts` — Task 1
3. `src/core/index.ts` — Task 1
4. `src/index.ts` — Task 1
5. `src/cli/errors.ts` — Task 8
6. `src/cli/commands/types.ts` — Tasks 2, 8
7. `src/cli/commands/registry.ts` — Task 2
8. `src/cli/output.ts` — Task 2
9. `src/cli/args.ts` — Tasks 2, 8
10. `src/cli/index.ts` — Tasks 2, 8
11. `src/cli/daemon.ts` — Task 3
12. `src/cli/client.ts` — Tasks 3, 8
13. `src/cli/commands/serve.ts` — Tasks 3, 8
14. `src/cli/commands/run.ts` — Tasks 3, 8
15. `src/cli/commands/session/*.ts` — Tasks 3, 8
16. `src/cli/commands/nav/*.ts` — Task 3
17. `src/cli/commands/interact/*.ts` — Task 3
18. `src/tools/launch.ts` — Task 4
19. `extension/src/relay-settings.ts` — Task 4
20. `extension/src/background.ts` — Task 4
21. `extension/src/services/ConnectionManager.ts` — Task 4
22. `extension/popup.html` — Task 4
23. `extension/src/popup.tsx` — Task 4
24. `skills/opendevbrowser/SKILL.md` — Task 5
25. `tests/cli/*.test.ts` — Tasks 6, 8
26. `tests/cli-errors.test.ts` — Task 8
27. `tests/extension-background.test.ts` — Task 6
28. `docs/CLI.md` — Tasks 2, 7, 8
29. `docs/EXTENSION.md` — Tasks 7, 9
30. `README.md` — Task 7

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| None | | Keep current dependency footprint |

---

## References
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Playwright CLI: https://playwright.dev/docs/test-cli
- Browserless session management: https://docs.browserless.io/baas/session-management/standard-sessions
- AI agent CLI patterns: https://www.infoq.com/articles/ai-agent-cli/
- Agent experience notes: https://nibzard.com/agent-experience/

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 2.2 | 2026-01-11 | Completed Tasks 8-9 (CLI exit codes, /pair policy) and updated audit |
| 2.1 | 2026-01-11 | Added audit/critique section and new tasks for CLI exit codes + pairing policy |
| 2.0 | 2026-01-11 | Merged CLI research and extension pinning research into refactoring plan |
