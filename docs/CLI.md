# OpenDevBrowser CLI

Command-line interface for installing and managing the OpenDevBrowser plugin, plus automation commands for agents.
OpenDevBrowser exposes 41 `opendevbrowser_*` tools; see `README.md` for the full list.
Agent runs should start with `opendevbrowser_prompting_guide` (or `opendevbrowser-best-practices` quickstart via `opendevbrowser_skill_load`); use continuity guidance only for long-running handoff/compaction.
Tool-only commands `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, and `opendevbrowser_skill_load` run locally via the skill loader and do not require relay endpoints. In hub-enabled configurations, the plugin may still ensure the daemon is available.
CLI-only power command `rpc` intentionally has no tool equivalent; it is an internal daemon escape hatch behind an explicit safety flag and should be used with extreme caution.

Parity and skill-pack gates:

```bash
npm run test -- tests/parity-matrix.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```

## Installation

Requires Node.js `>=18`.

```bash
# Interactive installation (prompts for location)
npx opendevbrowser

# Non-interactive with flags
npx opendevbrowser --global   # Install to ~/.config/opencode/opencode.json
npx opendevbrowser --local    # Install to ./opencode.json

# Optional: persistent global CLI
npm install -g opendevbrowser
opendevbrowser --version
```

By default, the CLI installs bundled skills to `~/.config/opencode/skill`. Use `--skills-local` for project-local skills or `--no-skills` to skip skill installation. Use `--full` to always create `opendevbrowser.jsonc` and pre-extract extension assets.

### Skill discovery order (OpenCode-native)

OpenCode discovers skills in this order (first match wins):

1. Project-local: `./.opencode/skill`
2. Global: `~/.config/opencode/skill` (or `$OPENCODE_CONFIG_DIR/skill`)
3. Compatibility: `./.claude/skills`
4. Compatibility: `~/.claude/skills`
5. Extra paths from `skillPaths` (advanced)

---

## Output formats

Use `--output-format` to switch output formats for automation.

- `text` (default): human-friendly output
- `json`: single JSON object
- `stream-json`: emit one JSON object per line for arrays; otherwise emits a single JSON object

Use `--quiet` to suppress output. Use `--no-interactive` (alias of `--no-prompt`) to disable prompts.

---

## Exit codes

- `0`: success
- `1`: usage error (invalid args, missing flags)
- `2`: execution error (runtime/daemon failures)
- `10`: disconnected (daemon not running or unreachable)

Fatal errors are emitted even when `--quiet` is set. For JSON output, fatal errors are emitted as:

```json
{ "success": false, "error": "message", "exitCode": 2 }
```

---

## Argument validation

The CLI validates common flags early and returns a usage error (`exitCode: 1`) when inputs are invalid.

- Conflicting flags are rejected (examples: `--global` + `--local`, `--skills-global` + `--skills-local`).
- Numeric flags must be positive integers:
  - `--port`, `--cdp-port`
  - `--wait-timeout-ms`, `--timeout-ms`

---

## Commands

### Install (default)

```bash
# Interactive - prompts for global or local
npx opendevbrowser

# Global installation (user-wide)
npx opendevbrowser --global
npx opendevbrowser -g

# Local installation (current project)
npx opendevbrowser --local
npx opendevbrowser -l

# Skip prompts, use default (global)
npx opendevbrowser --no-prompt
npx opendevbrowser --no-interactive

# Full install (config + extension assets)
npx opendevbrowser --full

# Also create opendevbrowser.jsonc config file
npx opendevbrowser --global --with-config

# Full install (plugin + config + bundled skills)
npx opendevbrowser --global --with-config --skills-global

# Install skills locally (project scope)
npx opendevbrowser --skills-local

# Skip installing skills
npx opendevbrowser --no-skills
```

On first successful install, the CLI attempts to install daemon auto-start on supported platforms (macOS/Windows) so the relay is
available on login. You can remove it later with `npx opendevbrowser daemon uninstall`.

### Update

Clear the OpenCode cache to trigger reinstallation of the latest version.

```bash
npx opendevbrowser --update
npx opendevbrowser -u
```

This removes cached files from `~/.cache/opencode/node_modules/opendevbrowser/`. OpenCode will download the latest version on next run.

### Uninstall

Remove the plugin from configuration.

```bash
# Remove from global config
npx opendevbrowser --uninstall --global

# Remove from local config
npx opendevbrowser --uninstall --local

# Interactive - prompts which to remove if both exist
npx opendevbrowser --uninstall
```

### Help / Version

```bash
npx opendevbrowser --help
npx opendevbrowser -h

npx opendevbrowser --version
npx opendevbrowser -v
```

---

## Automation commands (daemon)

### Serve (daemon)

Start a local daemon to keep sessions alive between commands.

```bash
npx opendevbrowser serve
npx opendevbrowser serve --port 8788 --token my-token

# Stop the daemon
npx opendevbrowser serve --stop
```

The daemon listens on `127.0.0.1` and starts the relay the extension connects to. Metadata lives in
`~/.cache/opendevbrowser/daemon.json` (cache only);
`/status` is the source of truth. The daemon port/token are persisted in `opendevbrowser.jsonc` as `daemonPort`/`daemonToken`.

If `nativeExtensionId` is set in `opendevbrowser.jsonc`, `serve` will auto-install the native messaging host when it is missing.
If it is not set, `serve` attempts to auto-detect the extension ID from Chrome, Brave, or Chromium profiles; if detection fails it continues startup.

Relay HTTP endpoints (`/config`, `/status`, `/pair`) accept extension origins and loopback requests with no `Origin` (including
`Origin: null`) to support MV3 + PNA. Non-extension origins are rejected; preflights include
`Access-Control-Allow-Private-Network: true` when requested.

#### Manual recovery (if the daemon is down or stuck)

```bash
# Start the daemon manually
npx opendevbrowser serve

# Stop/kill an existing daemon before restarting
npx opendevbrowser serve --stop
```

### Daemon auto-start

Install or remove OS-level auto-start for the daemon. This uses a stable, absolute CLI entrypoint (no PATH reliance), and returns
machine-readable output with `--output-format json`.

```bash
npx opendevbrowser daemon install
npx opendevbrowser daemon uninstall
npx opendevbrowser daemon status
```

Behavior:
- macOS: LaunchAgent at `~/Library/LaunchAgents/com.opendevbrowser.daemon.plist` targeting an absolute CLI entrypoint.
- Windows: per-user Task Scheduler logon task targeting an absolute CLI entrypoint.
- `daemon status` reports `{ installed, running, status? }` and does not throw a usage error when missing.
- `daemon status` returns exit code `10` when the daemon is not running.

Exit codes align with the CLI:
- `0`: success
- `1`: usage error
- `2`: execution error (permissions, missing binary, OS service failure)
- `10`: disconnected/not running (status only)

#### Auto-start install + manual fallback

```bash
# Install auto-start (recommended)
npx opendevbrowser daemon install

# If auto-start fails, start manually
npx opendevbrowser serve

# Stop/kill before restarting
npx opendevbrowser serve --stop
```

### Native messaging host

Install the native messaging host for the extension to use as a fallback transport when the relay WebSocket is unavailable.

```bash
# Install native host (requires extension ID)
npx opendevbrowser native install <extension-id>

# Check native host status
npx opendevbrowser native status

# Remove native host
npx opendevbrowser native uninstall
```

Notes:
- Supported on macOS, Linux, and Windows.
- Windows install writes a registry entry under `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.opendevbrowser.native`.
- `native install` requires the extension ID (chrome://extensions → copy ID).
- Set `nativeExtensionId` in `opendevbrowser.jsonc` to allow `serve` to auto-install the native host when missing (preferred).
- `serve` also attempts auto-detection from Chrome, Brave, or Chromium profiles, but explicit config is more reliable.
- `native status` reports installed state + extension ID from the manifest.
- Use `--transport native` with `status` to check native host status without requiring the daemon.

### Run (single-shot script)

Run a JSON script without the daemon.

```bash
npx opendevbrowser run --script ./script.json --output-format json

# Or pipe JSON
cat ./script.json | npx opendevbrowser run --output-format stream-json

# Optional launch flags for run
npx opendevbrowser run --script ./script.json --headless --profile default --start-url https://example.com
npx opendevbrowser run --script ./script.json --chrome-path "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --flag "--disable-gpu"
```

Supported `run` launch flags:
- `--headless`
- `--profile`
- `--persist-profile`
- `--chrome-path`
- `--start-url`
- `--flag` (repeatable)

Script format:

```json
[
  { "action": "goto", "args": { "url": "https://example.com" } },
  { "action": "snapshot" },
  { "action": "click", "args": { "ref": "r1" } }
]
```

---

## Session commands (daemon required)

### Launch

```bash
npx opendevbrowser launch --profile default --start-url https://example.com

# Extension relay controls
npx opendevbrowser launch --extension-only
npx opendevbrowser launch --no-extension
npx opendevbrowser launch --extension-legacy
npx opendevbrowser launch --wait-for-extension --wait-timeout-ms 30000
```

Flags:
- `--headless`
- `--profile`
- `--start-url`
- `--chrome-path`
- `--persist-profile`
- `--flag` (repeatable)
- `--no-extension`
- `--extension-only`
- `--extension-legacy`
- `--wait-for-extension`
- `--wait-timeout-ms`

Default behavior:
- Extension relay (`extension` mode) is the default when available, using the `/ops` WebSocket.
- If the extension is not connected, launch fails with guidance and exact commands for the explicit alternatives.
- Headless is never the default; it is only used when explicitly requested.
- When hub mode is enabled, there is no local relay fallback. If the hub is unavailable, commands fail with guidance.
- Extension relay requires Chrome 125+ (flat CDP sessions).

Interactive vs non-interactive:
- Interactive CLI (TTY): you will be prompted to connect the extension, then explicitly choose Managed or CDPConnect if you want to proceed.
- Non-interactive (agents/CI): the command fails fast and prints the exact commands to run for Managed or CDPConnect.

### Connection flags & status semantics

| Flag / Status | Meaning | Notes |
|---|---|---|
| `--no-extension` | Force managed mode | Bypasses relay and extension entirely. |
| `--extension-only` | Require extension mode | Fails if extension is not connected/handshaken. |
| `--extension-legacy` | Use legacy extension relay | Routes through relay `/cdp` instead of `/ops`. |
| `--wait-for-extension` | Wait for extension handshake | Only applies to extension mode; waits up to `--wait-timeout-ms`. |
| `--wait-timeout-ms` | Max wait for extension | Defaults to 30s. |
| `extensionConnected` | Extension websocket connected | `false` means popup isn’t connected to relay. |
| `extensionHandshakeComplete` | Extension handshake done | `false` means reconnect/repair from popup. |
| `opsConnected` | Active `/ops` client attached | `false` means no ops client is connected. |
| `cdpConnected` | Active `/cdp` client attached | Expected `false` until a legacy `/cdp` session connects. |
| `pairingRequired` | Relay token required | When `true`, both `/ops` and `/cdp` require a token (auto-fetched). |

### Connect

```bash
npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/...
npx opendevbrowser connect --host 127.0.0.1 --cdp-port 9222
```

This command starts a `cdpConnect` session (attach to an existing Chrome with remote debugging enabled).
If the `--ws-endpoint` points at the local relay (for example `ws://127.0.0.1:8787` or `ws://127.0.0.1:8787/ops`),
the CLI will normalize to `/ops` and route through the extension relay (`extension` mode).
Use `--extension-legacy` if you need the legacy `/cdp` relay path.
When routing through the relay, the CLI automatically fetches relay config and the pairing token (if required) and authenticates
the `/ops` or `/cdp` connection. Direct relay websocket connections without a token are rejected when pairing is enabled.

### Relay binding queue

Hub binding is exclusive only for binding/legacy paths (for example `/cdp` and commands that require a binding). Additional clients are queued FIFO and wait up to 30s by default.
If you see `RELAY_WAIT_TIMEOUT`, retry after the current binding expires or stop the other bound client.

Relay behavior note: extension uses a single extension websocket, while the relay can serve multiple `/ops` clients. Disconnecting the extension or restarting the relay drops active sessions, including annotation flows. Reconnect via the popup (or restart the daemon) before retrying.

### Disconnect

```bash
npx opendevbrowser disconnect --session-id <session-id>
npx opendevbrowser disconnect --session-id <session-id> --close-browser
```

### Status

```bash
npx opendevbrowser status               # daemon status (default)
npx opendevbrowser status --daemon      # daemon status (explicit)
npx opendevbrowser status --session-id <session-id>
```

### Cookie import

```bash
npx opendevbrowser cookie-import \
  --session-id <session-id> \
  --cookies '[{"name":"session","value":"abc123","url":"https://example.com"}]'

npx opendevbrowser cookie-import \
  --session-id <session-id> \
  --cookies-file ./cookies.json \
  --strict=false \
  --request-id req-cookie-001
```

Notes:
- Provide exactly one cookies source: `--cookies` or `--cookies-file`.
- `--strict` defaults to `true`.

### Macro resolve

```bash
npx opendevbrowser macro-resolve --expression '@web.search("openai")'
npx opendevbrowser macro-resolve --expression '@social.post("x", "ship it")' --default-provider social/x --include-catalog
npx opendevbrowser macro-resolve --expression '@web.search("opendevbrowser")' --execute --output-format json
```

Notes:
- Default mode is resolve-only (returns the resolved action/provenance payload).
- `--execute` runs the resolved provider action and returns additive execution metadata (`meta.tier.selected`, `meta.tier.reasonCode`, `meta.provenance.provider`, `meta.provenance.retrievalPath`, `meta.provenance.retrievedAt`).

### RPC (power-user, internal)

Execute any daemon command directly. This bypasses the stable CLI command surface, is intentionally unsafe/internal, and requires `--unsafe-internal`.

```bash
# Minimal call (empty params object)
npx opendevbrowser rpc --unsafe-internal --name relay.status --output-format json

# With inline JSON params
npx opendevbrowser rpc --unsafe-internal --name nav.goto \
  --params '{"sessionId":"<session-id>","url":"https://example.com","waitUntil":"load","timeoutMs":30000}' \
  --timeout-ms 45000 --output-format json

# With params from file
npx opendevbrowser rpc --unsafe-internal --name session.status --params-file ./rpc-params.json --output-format json
```

Notes:
- Params must be a JSON object.
- Use `--output-format json` for machine-readable responses.
- `rpc` is CLI-only by design and is not part of the stable tool parity surface.
- `rpc` command names/params are internal and may change without compatibility guarantees.
- A bad `rpc` call can close sessions, navigate logged-in tabs, or trigger unintended side effects.
- Prefer stable commands (`goto`, `snapshot`, `click`, `type`, and related tool equivalents) whenever possible.
- Use `rpc` only when necessary, validate params carefully, and test in a disposable session first.

---

## Navigation commands (daemon required)

### Goto

```bash
npx opendevbrowser goto --session-id <session-id> --url https://example.com
npx opendevbrowser goto --session-id <session-id> --url https://example.com --wait-until load --timeout-ms 30000
```

### Wait

```bash
npx opendevbrowser wait --session-id <session-id> --until load
npx opendevbrowser wait --session-id <session-id> --ref r12 --state visible --timeout-ms 15000
```

### Snapshot

```bash
npx opendevbrowser snapshot --session-id <session-id>
npx opendevbrowser snapshot --session-id <session-id> --max-chars 16000 --cursor <cursor>
```

---

## Interaction commands (daemon required)

### Click

```bash
npx opendevbrowser click --session-id <session-id> --ref r12
```

### Hover

```bash
npx opendevbrowser hover --session-id <session-id> --ref r12
```

### Press

```bash
npx opendevbrowser press --session-id <session-id> --key Enter
npx opendevbrowser press --session-id <session-id> --key Enter --ref r12
```

### Check / Uncheck

```bash
npx opendevbrowser check --session-id <session-id> --ref r12
npx opendevbrowser uncheck --session-id <session-id> --ref r12
```

### Type

```bash
npx opendevbrowser type --session-id <session-id> --ref r12 --text "hello"
npx opendevbrowser type --session-id <session-id> --ref r12 --text "hello" --clear --submit
```

### Select

```bash
npx opendevbrowser select --session-id <session-id> --ref r12 --values value1,value2
```

### Scroll

```bash
npx opendevbrowser scroll --session-id <session-id> --dy 500
npx opendevbrowser scroll --session-id <session-id> --ref r12 --dy 300
```

### Scroll into view

```bash
npx opendevbrowser scroll-into-view --session-id <session-id> --ref r12
```

---

## Annotation (direct + relay)

Annotations are available through both the CLI command and the `opendevbrowser_annotate` tool. The default transport (`auto`)
uses direct CDP when possible and falls back to relay in extension sessions. See `docs/ANNOTATE.md` for setup and details.

```bash
npx opendevbrowser annotate --session-id <session-id>

# Force direct annotate on a target
npx opendevbrowser annotate --session-id <session-id> --transport direct --target-id <target-id>

# Force relay annotate on a specific tab
npx opendevbrowser annotate --session-id <session-id> --transport relay --tab-id 123

# With URL + context + debug metadata
npx opendevbrowser annotate --session-id <session-id> --url https://example.com \
  --screenshot-mode visible --context "Review the hero layout" --timeout-ms 90000 --debug
```

---

## Target commands (daemon required)

### Targets list

```bash
npx opendevbrowser targets-list --session-id <session-id>
npx opendevbrowser targets-list --session-id <session-id> --include-urls
```

### Target use

```bash
npx opendevbrowser target-use --session-id <session-id> --target-id <target-id>
```

### Target new

```bash
npx opendevbrowser target-new --session-id <session-id> --url https://example.com
```

### Target close

```bash
npx opendevbrowser target-close --session-id <session-id> --target-id <target-id>
```

---

## Page commands (daemon required)

### Page open

```bash
npx opendevbrowser page --session-id <session-id> --name main
npx opendevbrowser page --session-id <session-id> --name main --url https://example.com
```

### Pages list

```bash
npx opendevbrowser pages --session-id <session-id>
```

### Page close

```bash
npx opendevbrowser page-close --session-id <session-id> --name main
```

---

## DOM commands (daemon required)

### DOM HTML

```bash
npx opendevbrowser dom-html --session-id <session-id> --ref r12 --max-chars 8000
```

### DOM Text

```bash
npx opendevbrowser dom-text --session-id <session-id> --ref r12 --max-chars 8000
```

### DOM Attribute

```bash
npx opendevbrowser dom-attr --session-id <session-id> --ref r12 --attr aria-label
```

### DOM Value

```bash
npx opendevbrowser dom-value --session-id <session-id> --ref r12
```

### DOM State Checks

```bash
npx opendevbrowser dom-visible --session-id <session-id> --ref r12
npx opendevbrowser dom-enabled --session-id <session-id> --ref r12
npx opendevbrowser dom-checked --session-id <session-id> --ref r12
```

---

## Export commands (daemon required)

### Clone page

```bash
npx opendevbrowser clone-page --session-id <session-id>
```

### Clone component

```bash
npx opendevbrowser clone-component --session-id <session-id> --ref r12
```

---

## Devtools commands (daemon required)

### Performance metrics

```bash
npx opendevbrowser perf --session-id <session-id>
```

### Screenshot

```bash
npx opendevbrowser screenshot --session-id <session-id>
npx opendevbrowser screenshot --session-id <session-id> --path ./capture.png
```

### Console poll

```bash
npx opendevbrowser console-poll --session-id <session-id> --since-seq 0 --max 50
```

### Network poll

```bash
npx opendevbrowser network-poll --session-id <session-id> --since-seq 0 --max 50
```

### Debug trace snapshot

```bash
npx opendevbrowser debug-trace-snapshot --session-id <session-id>
npx opendevbrowser debug-trace-snapshot \
  --session-id <session-id> \
  --since-console-seq 100 \
  --since-network-seq 80 \
  --since-exception-seq 10 \
  --max 200 \
  --request-id req-debug-001
```

---

## Flags reference

### Global flags

| Flag | Short | Description |
|------|-------|-------------|
| `--global` | `-g` | Install to `~/.config/opencode/opencode.json` |
| `--local` | `-l` | Install to `./opencode.json` |
| `--update` | `-u` | Clear cache to trigger reinstall |
| `--uninstall` | | Remove plugin from config |
| `--with-config` | | Also create `opendevbrowser.jsonc` |
| `--full` | `-f` | Create config and pre-extract extension assets |
| `--no-prompt` | | Skip prompts, use defaults |
| `--no-interactive` | | Alias of `--no-prompt` |
| `--quiet` | | Suppress output |
| `--output-format` | | `text`, `json`, or `stream-json` |
| `--skills-global` | | Install skills to `~/.config/opencode/skill` (default) |
| `--skills-local` | | Install skills to `./.opencode/skill` |
| `--no-skills` | | Skip installing bundled skills |
| `--help` | `-h` | Show usage information |
| `--version` | `-v` | Show version number |

### Serve flags

| Flag | Description |
|------|-------------|
| `--port` | Override daemon port |
| `--token` | Override daemon token |
| `--stop` | Stop the daemon |

### Command-specific flags

**Session + connection**

| Flag | Used by | Description |
|------|---------|-------------|
| `--session-id` | most daemon commands | Active session id from `launch`/`connect` |
| `--close-browser` | `disconnect` | Close managed browser on disconnect |
| `--ws-endpoint` | `connect` | Remote debugging websocket URL |
| `--host` | `connect` | Host for CDP connection (`--cdp-port` required) |
| `--cdp-port` | `connect` | CDP port for host-based connect |
| `--no-extension` | `launch` | Force managed mode (ignore extension) |
| `--extension-only` | `launch` | Fail if extension not connected |
| `--extension-legacy` | `launch`, `connect` | Use legacy extension relay (`/cdp`) |
| `--wait-for-extension` | `launch` | Wait for extension handshake |
| `--wait-timeout-ms` | `launch` | Max wait for extension handshake |
| `--cookies` | `cookie-import` | Inline JSON array of cookie objects |
| `--cookies-file` | `cookie-import` | Path to JSON file containing cookie objects |
| `--strict` | `cookie-import` | Reject on invalid cookie entries (`true`/`false`) |
| `--request-id` | `cookie-import`, `debug-trace-snapshot` | Optional request correlation id |
| `--expression` | `macro-resolve` | Macro expression to resolve |
| `--default-provider` | `macro-resolve` | Provider fallback for shorthand macros |
| `--include-catalog` | `macro-resolve` | Include macro catalog in response |
| `--execute` | `macro-resolve` | Execute the resolved provider action and include additive `meta.*` fields |

**Browser launch (launch/run)**

| Flag | Used by | Description |
|------|---------|-------------|
| `--headless` | `launch`, `run` | Run managed Chrome headless |
| `--profile` | `launch`, `run` | Profile directory name |
| `--persist-profile` | `launch`, `run` | Keep profile directory after run |
| `--chrome-path` | `launch`, `run` | Explicit Chrome executable path |
| `--start-url` | `launch`, `run` | Initial URL for the session |
| `--flag` | `launch`, `run` | Additional Chrome flag (repeatable) |
| `--script` | `run` | JSON script path |

**Navigation + waiting**

| Flag | Used by | Description |
|------|---------|-------------|
| `--url` | `goto`, `page`, `target-new` | URL to navigate/open |
| `--wait-until` | `goto` | Load state (`load`, `domcontentloaded`, etc.) |
| `--timeout-ms` | `goto`, `wait` | Timeout in ms |
| `--ref` | `wait` | Element ref to wait for |
| `--state` | `wait` | Element state (e.g. `visible`) |
| `--until` | `wait` | Page load state |
| `--mode` | `snapshot` | Snapshot mode (`outline` or `actionables`) |
| `--max-chars` | `snapshot`, `dom-*` | Max characters returned |
| `--cursor` | `snapshot` | Snapshot pagination cursor |

**Annotation**

| Flag | Used by | Description |
|------|---------|-------------|
| `--transport` | `annotate` | `auto` (default), `direct`, or `relay` |
| `--target-id` | `annotate` | Target id for direct annotate |
| `--tab-id` | `annotate` | Chrome tab id for relay annotate |
| `--screenshot-mode` | `annotate` | `visible` (default), `full`, or `none` |
| `--context` | `annotate` | Optional context text pre-filled in the UI |
| `--debug` | `annotate` | Include debug metadata in the payload |
| `--timeout-ms` | `annotate` | Annotation timeout in ms |

**RPC (internal)**

| Flag | Used by | Description |
|------|---------|-------------|
| `--unsafe-internal` | `rpc` | Required opt-in acknowledging unsafe/internal RPC execution (power-user only) |
| `--name` | `rpc` | Daemon command name (for example `relay.status`) |
| `--params` | `rpc` | Inline JSON object command params |
| `--params-file` | `rpc` | Path to JSON object params file |
| `--timeout-ms` | `rpc` | Client-side daemon call timeout in ms |

**Interaction**

| Flag | Used by | Description |
|------|---------|-------------|
| `--ref` | element commands | Element ref from `snapshot` |
| `--text` | `type` | Text to type |
| `--clear` | `type` | Clear input before typing |
| `--submit` | `type` | Submit after typing |
| `--values` | `select` | Comma-separated values |
| `--dy` | `scroll` | Scroll delta on Y axis |
| `--key` | `press` | Keyboard key name (e.g. `Enter`) |

**Targets + pages**

| Flag | Used by | Description |
|------|---------|-------------|
| `--target-id` | `target-use`, `target-close` | Target id from `targets-list` |
| `--include-urls` | `targets-list` | Include URLs in target list output |
| `--name` | `page`, `page-close` | Named page identifier |

**Devtools**

| Flag | Used by | Description |
|------|---------|-------------|
| `--attr` | `dom-attr` | Attribute name to read |
| `--path` | `screenshot` | Output file path |
| `--since-seq` | `console-poll`, `network-poll` | Start sequence number |
| `--since-console-seq` | `debug-trace-snapshot` | Resume cursor for console channel |
| `--since-network-seq` | `debug-trace-snapshot` | Resume cursor for network channel |
| `--since-exception-seq` | `debug-trace-snapshot` | Resume cursor for exception channel |
| `--max` | `console-poll`, `network-poll`, `debug-trace-snapshot` | Max events to return per channel |

---

## CLI smoke test

Run the automated CLI coverage script (managed mode):

```bash
npm run build
node scripts/cli-smoke-test.mjs
```

The script uses temporary config/cache directories and exercises all CLI commands, including the new interaction and DOM state checks.
Validate extension mode separately with `launch` + `disconnect` while the extension is connected.

## Live regression matrix

Run the full real-world matrix (managed + extension `/ops` + extension-legacy `/cdp` + `cdpConnect` + macro/research + annotate probes):

```bash
npm run build
node scripts/live-regression-matrix.mjs
```

Behavior:
- Exits non-zero only for product regressions.
- Classifies upstream reachability failures (for example social/community dependencies) as `env_limited`.
- Classifies unattended annotation timeouts as `expected_timeout`.
- Emits a JSON summary with per-step status for reproducible CI/manual verification.

Run parity and skill-asset gates as part of release checks:

```bash
npm run test -- tests/parity-matrix.test.ts
npm run test -- tests/providers-performance-gate.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```

Release gate source of truth: `docs/RELEASE_PARITY_CHECKLIST.md`.
Benchmark fixture manifest: `docs/benchmarks/provider-fixtures.md`.

### Latest validation (Pending refresh — 2026-02-13)

- Full validation evidence will be refreshed after the final full test run.
- Pending refresh command set: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test`, `node scripts/cli-smoke-test.mjs`.
- Prior dated pass-count snapshots were intentionally removed to avoid stale release signals.

---

## Extension-only manual test (no OpenCode plugin)

Use this to validate the Chrome extension + relay without starting OpenCode.

1. Ensure the daemon is running: `npx opendevbrowser serve` (manual). `npx opendevbrowser daemon install` configures auto-start for future logins but does not start it immediately.
2. Build and load the extension: `npm run extension:build`, then Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
3. Open a normal `http(s)` tab (not `chrome://` or extension pages).
4. Open the extension popup, confirm Auto-connect + Auto-pair are ON, click Connect.
5. Verify the popup shows **Connected** and `npx opendevbrowser status --daemon` reports `extensionConnected: true` and `extensionHandshakeComplete: true`.
6. Optional session check: `npx opendevbrowser launch --extension-only --wait-for-extension`, then `npx opendevbrowser disconnect --session-id <id>`.
7. Optional annotation check (OpenCode): call `opendevbrowser_annotate` and confirm screenshots are written to a temp folder.

If it fails, run `npx opendevbrowser serve --stop` then `npx opendevbrowser serve`, and confirm site access includes `http://127.0.0.1/*` and `http://localhost/*` in the extension settings.

## Configuration files

### OpenCode config

The CLI modifies `opencode.json` to register the plugin:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opendevbrowser"]
}
```

**Locations:**
- Global: `~/.config/opencode/opencode.json`
- Local: `./opencode.json`

### Plugin config (optional)

When using `--with-config`, a `opendevbrowser.jsonc` is created with documented defaults:

```jsonc
{
  "headless": false,
  "profile": "default",
  "persistProfile": true,
  "snapshot": { "maxChars": 16000, "maxNodes": 1000 },
  "export": { "maxNodes": 1000, "inlineStyles": true },
  "devtools": { "showFullUrls": false, "showFullConsole": false },
  "security": {
    "allowRawCDP": false,
    "allowNonLocalCdp": false,
    "allowUnsafeExport": false
  },
  "skillPaths": [],
  "skills": {
    "nudge": {
      "enabled": true,
      "keywords": ["quick start", "getting started", "launch", "connect", "setup"],
      "maxAgeMs": 60000
    }
  },
  "continuity": {
    "enabled": true,
    "filePath": "opendevbrowser_continuity.md",
    "nudge": {
      "enabled": true,
      "keywords": ["plan", "multi-step", "long-running", "refactor", "migration", "rollout", "continue"],
      "maxAgeMs": 60000
    }
  },
  "daemonPort": 8788,
  "daemonToken": "auto-generated-on-first-run",
  "flags": [],
  "checkForUpdates": false
}
```

The optional `skills.nudge` section controls the small one-time prompt hint that encourages early `skill(...)` usage on skill-relevant tasks. The optional `continuity` section controls the long-running task nudge and the ledger file path.
Fingerprint runtime defaults are Tier 1/2/3 enabled, with Tier 2 and Tier 3 driven by continuous signals (debug trace remains readout/reporting).
