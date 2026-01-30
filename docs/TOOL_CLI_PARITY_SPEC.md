# Tool/CLI Parity Spec

This spec maps `opendevbrowser_*` tools to CLI commands, documents CLI test evidence, and summarizes plugin-mode parity and extension-mode failure gates.

---

## Overview

- Tools (`src/tools/*`) and CLI commands (`src/cli/commands/*`) share the same core managers; parity is intended for browser actions. (`docs/ARCHITECTURE.md`)
- CLI uses the daemon (`opendevbrowser serve`) for most commands; `run` is a single-process runner. (`src/cli/index.ts`, `src/cli/commands/run.ts`)
- Plugin runs in-process by default; with hub enabled it binds a daemon and uses `RemoteManager`/`RemoteRelay`. (`src/index.ts`)

## Tool ↔ CLI Mapping

| Tool | CLI Command | Notes |
| --- | --- | --- |
| `opendevbrowser_launch` | `launch` | Tool does readiness checks + relay fallback; CLI `launch` prompts interactively when extension fails. (`src/tools/launch.ts`, `src/cli/commands/session/launch.ts`) |
| `opendevbrowser_connect` | `connect` | Tool uses `RemoteManager.connect` or `connectRelay` in hub mode; CLI uses daemon `session.connect`. |
| `opendevbrowser_disconnect` | `disconnect` | Same semantics; daemon requires binding for extension sessions. |
| `opendevbrowser_status` | `status` | CLI can show daemon status or session status; tool returns session status only. |
| `opendevbrowser_targets_list` | `targets-list` | 1:1 daemon call (`targets.list`). |
| `opendevbrowser_target_use` | `target-use` | 1:1 daemon call (`targets.use`). |
| `opendevbrowser_target_new` | `target-new` | 1:1 daemon call (`targets.new`). |
| `opendevbrowser_target_close` | `target-close` | 1:1 daemon call (`targets.close`). |
| `opendevbrowser_page` | `page` | 1:1 daemon call (`page.open`). |
| `opendevbrowser_list` | `pages` | 1:1 daemon call (`page.list`). |
| `opendevbrowser_close` | `page-close` | 1:1 daemon call (`page.close`). |
| `opendevbrowser_goto` | `goto` | 1:1 daemon call (`nav.goto`). |
| `opendevbrowser_wait` | `wait` | 1:1 daemon call (`nav.wait`). |
| `opendevbrowser_snapshot` | `snapshot` | 1:1 daemon call (`nav.snapshot`). |
| `opendevbrowser_click` | `click` | 1:1 daemon call (`interact.click`). |
| `opendevbrowser_hover` | `hover` | 1:1 daemon call (`interact.hover`). |
| `opendevbrowser_press` | `press` | 1:1 daemon call (`interact.press`). |
| `opendevbrowser_check` | `check` | 1:1 daemon call (`interact.check`). |
| `opendevbrowser_uncheck` | `uncheck` | 1:1 daemon call (`interact.uncheck`). |
| `opendevbrowser_type` | `type` | 1:1 daemon call (`interact.type`). |
| `opendevbrowser_select` | `select` | 1:1 daemon call (`interact.select`). |
| `opendevbrowser_scroll` | `scroll` | 1:1 daemon call (`interact.scroll`). |
| `opendevbrowser_scroll_into_view` | `scroll-into-view` | 1:1 daemon call (`interact.scrollIntoView`). |
| `opendevbrowser_dom_get_html` | `dom-html` | 1:1 daemon call (`dom.getHtml`). |
| `opendevbrowser_dom_get_text` | `dom-text` | 1:1 daemon call (`dom.getText`). |
| `opendevbrowser_get_attr` | `dom-attr` | CLI uses `--attr` arg mapped to `dom.getAttr` name. |
| `opendevbrowser_get_value` | `dom-value` | 1:1 daemon call (`dom.getValue`). |
| `opendevbrowser_is_visible` | `dom-visible` | 1:1 daemon call (`dom.isVisible`). |
| `opendevbrowser_is_enabled` | `dom-enabled` | 1:1 daemon call (`dom.isEnabled`). |
| `opendevbrowser_is_checked` | `dom-checked` | 1:1 daemon call (`dom.isChecked`). |
| `opendevbrowser_run` | `run` | CLI `run` is **single-process** (no daemon). Tool `run` uses `ScriptRunner` on an existing session. Semantics differ. |
| `opendevbrowser_console_poll` | `console-poll` | 1:1 daemon call (`devtools.consolePoll`). |
| `opendevbrowser_network_poll` | `network-poll` | 1:1 daemon call (`devtools.networkPoll`). |
| `opendevbrowser_clone_page` | `clone-page` | 1:1 daemon call (`export.clonePage`). |
| `opendevbrowser_clone_component` | `clone-component` | 1:1 daemon call (`export.cloneComponent`). |
| `opendevbrowser_perf` | `perf` | 1:1 daemon call (`devtools.perf`). |
| `opendevbrowser_screenshot` | `screenshot` | 1:1 daemon call (`page.screenshot`). |
| `opendevbrowser_prompting_guide` | — | Tool-only (loads best practices via SkillLoader). |
| `opendevbrowser_skill_list` | — | Tool-only (compat wrapper for skills). |
| `opendevbrowser_skill_load` | — | Tool-only (compat wrapper for skills). |

### CLI-Only Commands (No Tool Equivalent)

- `serve`, `status --daemon`, `update`, `install`, `uninstall`, `version`, `help`.
- `daemon install`, `daemon uninstall`, `daemon status` (see `docs/OPENCODE_DAEMON_AUTOSTART_PLAN.md`).
  - Uses `--output-format` (not `--json`) for machine output.
  - `daemon status` returns `{ installed, running, status? }` and does not error when the daemon is missing.

## CLI Test Evidence

- **Managed headless test matrix**: 34/34 tool-equivalent CLI commands passed using unique profile (`--profile cli-test-<timestamp>`).
- **Log**: `/tmp/opendevbrowser-cli-test.log`
- **Script**: `/tmp/opendevbrowser-cli-test.sh`
- **Note**: A prior run failed due to `ProcessSingleton` profile lock; resolved by supplying a unique `--profile`.

## Plugin-Mode Parity Analysis

### Entry Points

- **CLI**: Most commands go through daemon RPC (`callDaemon`). (`src/cli/daemon-client.ts`, `src/cli/daemon-commands.ts`)
- **Plugin (in-process)**: `createOpenDevBrowserCore` managers run in-process with a local relay. (`src/index.ts`)
- **Plugin (hub enabled)**: `RemoteManager`/`RemoteRelay` proxy to daemon; relay binding is enforced. (`src/index.ts`, `src/cli/remote-manager.ts`, `src/cli/daemon-client.ts`)

### Implications

- Core automation behavior should match when both flows call `BrowserManager` methods.
- **Parity gaps** are primarily **surface-level**:
  - CLI has installer/daemon management commands not exposed as tools.
  - Tool has `prompting_guide`, `skill_list`, `skill_load` not exposed via CLI.
  - CLI `run` is single-process; tool `run` uses existing session + runner.

## Extension-Mode Failure Gates (Detectable Symptoms)

These gates explain `ext=true handshake=true cdp=false` and similar failures.

| Gate | Symptom | Detection Signal | Files |
| --- | --- | --- | --- |
| Origin blocked | /config or /pair requests rejected for non-extension/non-loopback origins | HTTP 403 + `[security] origin_blocked` | `src/relay/relay-server.ts` |
| Token invalid/missing | CDP upgrade rejected | HTTP 401 + `[security] cdp_unauthorized` + `cdp upgrade unauthorized` | `src/relay/relay-server.ts` |
| Rate limit | Upgrade rejected | HTTP 429 + `[security] rate_limited` | `src/relay/relay-server.ts` |
| Only one CDP client | Connection immediately closed | WS close 1008 “Only one CDP client supported.” | `src/relay/relay-server.ts` |
| Extension disconnected | CDP requests fail | CDP error “Extension not connected to relay” | `src/relay/relay-server.ts` |
| Flat sessions required | CDP error on auto-attach | “Chrome 125+ required for flat sessions” | `extension/src/services/cdp-router-commands.ts` |
| Unknown sessionId | CDP error | “Unknown sessionId: …” | `extension/src/services/cdp-router-commands.ts` |
| No attached tab | CDP error | “No tab attached” | `extension/src/services/CDPRouter.ts` |
| Target.sendMessageToTarget unsupported | CDP error | “Target.sendMessageToTarget is not supported” | `extension/src/services/CDPRouter.ts` |

## Recommended Follow-up

1. Capture a failing OpenCode tool-call run with relay debug logs enabled, then map to the single gate above.
2. Relay debug logs removed; rely on error messages and status output for diagnosis.
3. Optionally run extension-mode CLI tests after the failure gate is identified.

---

## References (Code)

- Tools list: `src/tools/index.ts`
- CLI command registry: `src/cli/index.ts`
- Launch logic: `src/tools/launch.ts`, `src/cli/commands/session/launch.ts`, `src/cli/daemon-commands.ts`
- Plugin entry: `src/index.ts`
- Relay + CDP compatibility: `src/relay/relay-server.ts`, `extension/src/services/CDPRouter.ts`, `extension/src/services/cdp-router-commands.ts`
