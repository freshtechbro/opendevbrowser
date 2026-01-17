# OpenDevBrowser CLI

Command-line interface for installing and managing the OpenDevBrowser plugin, plus automation commands for agents.

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

The daemon listens on `127.0.0.1` and requires a token. Metadata lives in `~/.cache/opendevbrowser/daemon.json`.

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

Interactive vs non-interactive:
- Interactive CLI (TTY): you will be prompted to connect the extension, then explicitly choose Managed or CDPConnect if you want to proceed.
- Non-interactive (agents/CI): the command fails fast and prints the exact commands to run for Managed or CDPConnect.

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

### Disconnect

```bash
npx opendevbrowser disconnect --session-id <session-id>
```

### Status

```bash
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
  }
}
```

The optional `skills.nudge` section controls the small one-time prompt hint that encourages early `skill(...)` usage on skill-relevant tasks. The optional `continuity` section controls the long-running task nudge and the ledger file path.
