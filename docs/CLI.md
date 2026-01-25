# OpenDevBrowser CLI

Command-line interface for installing and managing the OpenDevBrowser plugin, plus automation commands for agents.
OpenDevBrowser exposes 40 `opendevbrowser_*` tools; see `README.md` for the full list.

## Installation

```bash
# Interactive installation (prompts for location)
npx opendevbrowser

# Non-interactive with flags
npx opendevbrowser --global   # Install to ~/.config/opencode/opencode.json
npx opendevbrowser --local    # Install to ./opencode.json
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

Errors are emitted even when `--quiet` is set. For JSON output, errors are emitted as:

```json
{ "success": false, "error": "message", "exitCode": 2 }
```

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

The daemon listens on `127.0.0.1` and requires a token. Metadata lives in `~/.cache/opendevbrowser/daemon.json` (cache only);
`/status` is the source of truth. The daemon port/token are persisted in `opendevbrowser.jsonc` as `daemonPort`/`daemonToken`.

### Run (single-shot script)

Run a JSON script without the daemon.

```bash
npx opendevbrowser run --script ./script.json --output-format json

# Or pipe JSON
cat ./script.json | npx opendevbrowser run --output-format stream-json
```

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
- `--wait-for-extension`
- `--wait-timeout-ms`

Default behavior:
- Extension relay (`extension` mode) is the default when available.
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
| `--wait-for-extension` | Wait for extension handshake | Only applies to extension mode; waits up to `--wait-timeout-ms`. |
| `--wait-timeout-ms` | Max wait for extension | Defaults to 30s. |
| `extensionConnected` | Extension websocket connected | `false` means popup isn’t connected to relay. |
| `extensionHandshakeComplete` | Extension handshake done | `false` means reconnect/repair from popup. |
| `cdpConnected` | Active `/cdp` client attached | Expected `false` until a session launches/connects. |
| `pairingRequired` | Relay token required | When `true`, `/cdp` requires a token (auto-fetched). |

### Connect

```bash
npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/...
npx opendevbrowser connect --host 127.0.0.1 --cdp-port 9222
```

This command starts a `cdpConnect` session (attach to an existing Chrome with remote debugging enabled).
If the `--ws-endpoint` points at the local relay (for example `ws://127.0.0.1:8787` or `ws://127.0.0.1:8787/cdp`),
the CLI will normalize to `/cdp` and route through the extension relay (`extension` mode).
When routing through the relay, the CLI automatically fetches relay config and the pairing token (if required) and authenticates
the `/cdp` connection. Direct `/cdp` connections without a token are rejected when pairing is enabled.

### Relay binding queue

Only one client can hold the hub relay binding at a time. Additional clients are queued FIFO and wait up to 30s by default.
If you see `RELAY_WAIT_TIMEOUT`, retry after the current binding expires or stop the other client.

### Disconnect

```bash
npx opendevbrowser disconnect --session-id <session-id>
```

### Status

```bash
npx opendevbrowser status               # daemon status (default)
npx opendevbrowser status --daemon      # daemon status (explicit)
npx opendevbrowser status --session-id <session-id>
```

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

## Target commands (daemon required)

### Targets list

```bash
npx opendevbrowser targets-list --session-id <session-id>
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

| Flag | Used by | Description |
|------|---------|-------------|
| `--session-id` | daemon commands | Active session id from `launch`/`connect` |
| `--ref` | element commands | Element ref from `snapshot` |
| `--key` | `press` | Keyboard key name (e.g. `Enter`, `ArrowDown`) |
| `--attr` | `dom-attr` | Attribute name to read |

---

## CLI smoke test

Run the automated CLI coverage script (managed mode):

```bash
npm run build
node scripts/cli-smoke-test.mjs
```

The script uses temporary config/cache directories and exercises all CLI commands, including the new interaction and DOM state checks.
Validate extension mode separately with `launch` + `disconnect` while the extension is connected.

### Latest validation (2026-01-19)

- Managed mode: PASS (`node scripts/cli-smoke-test.mjs`)
- CDP-connect: PASS (`connect --cdp-port 9222`, `status`, `disconnect`)
- Extension relay: BLOCKED (extension not connected to relay at test time; `launch --wait-for-extension` returned `extension_not_connected`)

---

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
      "keywords": ["login", "form", "extract"],
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
  "daemonToken": "auto-generated-on-first-run"
}
```

The optional `skills.nudge` section controls the small one-time prompt hint that encourages early `skill(...)` usage on skill-relevant tasks. The optional `continuity` section controls the long-running task nudge and the ledger file path.
