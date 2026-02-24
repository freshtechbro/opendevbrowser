# OpenDevBrowser CLI

Command-line interface for installing and managing the OpenDevBrowser plugin, plus automation commands for agents.
Status: active  
Last updated: 2026-02-24

OpenDevBrowser exposes 48 `opendevbrowser_*` tools; see `README.md` and `docs/SURFACE_REFERENCE.md` for the full inventories.
Agent runs should start with `opendevbrowser_prompting_guide` (or `opendevbrowser-best-practices` quickstart via `opendevbrowser_skill_load`); use continuity guidance only for long-running handoff/compaction.
Tool-only commands `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, and `opendevbrowser_skill_load` run locally via the skill loader and do not require relay endpoints. In hub-enabled configurations, the plugin may still ensure the daemon is available.
CLI-only power command `rpc` intentionally has no tool equivalent; it is an internal daemon escape hatch behind an explicit safety flag and should be used with extreme caution.

Dependency inventory: `docs/DEPENDENCIES.md`
First-run pre-release onboarding: `docs/FIRST_RUN_ONBOARDING.md`

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

### Pre-release local package onboarding (no npm publish)

```bash
cd /Users/bishopdotun/Documents/DevProjects/opendevbrowser
npm pack

WORKDIR=$(mktemp -d /tmp/opendevbrowser-first-run-XXXXXX)
cd "$WORKDIR"
npm init -y
npm install /Users/bishopdotun/Documents/DevProjects/opendevbrowser/opendevbrowser-0.0.15.tgz
npx --no-install opendevbrowser --help
```

Load extension unpacked from:
- `$WORKDIR/node_modules/opendevbrowser/extension`

For isolated daemon tests on machines that already run OpenDevBrowser, set:

```bash
export OPENCODE_CONFIG_DIR=/tmp/opendevbrowser-first-run-isolated/config
export OPENCODE_CACHE_DIR=/tmp/opendevbrowser-first-run-isolated/cache
```

By default (`--skills-global`), the CLI installs bundled skills to global OpenCode/Codex/ClaudeCode/AmpCLI locations (legacy `claude`/`amp` labels are still synchronized for compatibility). Use `--skills-local` for project-local locations or `--no-skills` to skip skill installation. Use `--full` to always create `opendevbrowser.jsonc` and pre-extract extension assets.

### Skill discovery order

The skill loader discovers skills in this order (first match wins):

1. Project-local: `./.opencode/skill`
2. Global: `~/.config/opencode/skill` (or `$OPENCODE_CONFIG_DIR/skill`)
3. Compatibility (project): `./.codex/skills`
4. Compatibility (global): `$CODEX_HOME/skills` (fallback `~/.codex/skills`)
5. Compatibility (project): `./.claude/skills`
6. Compatibility (global): `$CLAUDECODE_HOME/skills` or `$CLAUDE_HOME/skills` (fallback `~/.claude/skills`)
7. Compatibility (project): `./.amp/skills`
8. Compatibility (global): `$AMPCLI_HOME/skills` or `$AMP_CLI_HOME/skills` or `$AMP_HOME/skills` (fallback `~/.amp/skills`)
9. Extra paths from `skillPaths` (advanced)

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

## Surface inventory (source-accurate)

Canonical inventory document: `docs/SURFACE_REFERENCE.md`.

### CLI command surface

- Total commands: `55`.
- Categories: install/runtime management, session/connection, navigation, interaction, targets/pages, DOM inspection, export/diagnostics/macro/annotation, and internal power (`rpc`).

### Tool surface

- Total tools: `48` (`opendevbrowser_*`).
- Tool-only surface (no CLI equivalent): `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, `opendevbrowser_skill_load`.
- CLI-only surface (no tool equivalent): `artifacts`, `rpc`.

### Relay channel surface

- `/ops` (default extension channel): high-level command protocol; see `docs/SURFACE_REFERENCE.md` for all `38` command names.
- `/cdp` (legacy): low-level `forwardCDPCommand` relay path with explicit opt-in (`--extension-legacy`).

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

`--help` now prints a complete, agent-oriented inventory:
- All CLI commands (55) grouped by function, each with one-line descriptions.
- All supported CLI flags, grouped by install/session/navigation/workflow usage.
- All `opendevbrowser_*` tools (48), each with one-line descriptions.
- Macro execute timeout guidance via `--timeout-ms` for slow `macro-resolve --execute` runs.
- Canonical inventory pointers: `docs/SURFACE_REFERENCE.md`, `src/tools/index.ts`, and this CLI guide.

Operational help parity check:

```bash
npx opendevbrowser --help
npx opendevbrowser help
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
`serve` now performs a stale-daemon preflight and terminates orphan `opendevbrowser serve` processes before starting (or before
returning "already running"), while preserving the active daemon on the requested port.

If you run onboarding tests alongside an existing daemon, isolate config/cache via `OPENCODE_CONFIG_DIR` and `OPENCODE_CACHE_DIR`
to avoid token/port collisions between sessions.

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

### Workflow wrappers

The workflow wrappers expose the finalized research/shopping/product-video surfaces from
`docs/RESEARCH_SHOPPING_PRODUCT_VIDEO_FINAL_SPEC.md`.

#### Research (`research run`)

```bash
npx opendevbrowser research run --topic "browser automation" --days 30 --mode compact
npx opendevbrowser research run --topic "market map" --from 2026-02-01 --to 2026-02-16 --source-selection all --mode json
npx opendevbrowser research run --topic "creator tools" --sources web,shopping --include-engagement --limit-per-source 5 --mode context
```

Flags:
- `--topic` (required)
- `--days`
- `--from`
- `--to`
- `--source-selection` (`auto|web|community|social|shopping|all`)
- `--sources` (comma-separated concrete sources)
- `--mode` (`compact|json|md|context|path`)
- `--include-engagement`
- `--limit-per-source`
- `--output-dir`
- `--ttl-hours`
- `--use-cookies` (`true|false`; bare flag means `true`)
- `--cookie-policy-override` (`off|auto|required`)
- `--cookie-policy` (alias of `--cookie-policy-override`)

#### Shopping (`shopping run`)

```bash
npx opendevbrowser shopping run --query "usb microphone" --mode compact
npx opendevbrowser shopping run --query "portable monitor" --providers shopping/amazon,shopping/newegg --sort lowest_price --mode md
npx opendevbrowser shopping run --query "desk chair" --budget 250 --region us --mode path
```

Flags:
- `--query` (required)
- `--providers` (comma-separated; defaults to all v1 adapters)
- `--budget`
- `--region`
- `--sort` (`best_deal|lowest_price|highest_rating|fastest_shipping`)
- `--mode` (`compact|json|md|context|path`)
- `--output-dir`
- `--ttl-hours`
- `--use-cookies` (`true|false`; bare flag means `true`)
- `--cookie-policy-override` (`off|auto|required`)
- `--cookie-policy` (alias of `--cookie-policy-override`)

#### Product presentation asset (`product-video run`)

```bash
npx opendevbrowser product-video run --product-url "https://example.com/p/1" --include-screenshots
npx opendevbrowser product-video run --product-name "Sample Product" --provider-hint shopping/amazon --output-dir /tmp/product-assets
```

Flags:
- `--product-url` (required unless `--product-name` is provided)
- `--product-name` (required unless `--product-url` is provided)
- `--provider-hint`
- `--include-screenshots` (`true|false`; bare flag means `true`)
- `--include-all-images` (`true|false`; bare flag means `true`)
- `--include-copy` (`true|false`; bare flag means `true`)
- `--output-dir`
- `--ttl-hours`
- `--use-cookies` (`true|false`; bare flag means `true`)
- `--cookie-policy-override` (`off|auto|required`)
- `--cookie-policy` (alias of `--cookie-policy-override`)

Wrapper behavior:
- Timebox semantics are strict (`--days` is mutually exclusive with `--from/--to`).
- Render modes for `research` and `shopping` are shared: `compact|json|md|context|path`.
- `product-video run` always returns a path-based local asset pack.
- Path-bearing modes persist artifacts under the configured output directory (or default tmp namespace) and include TTL metadata in manifest files.
- Workflow cookie policy defaults to `providers.cookiePolicy=auto` and source defaults to `providers.cookieSource` (`file`, `env`, or `inline`).
- Effective policy precedence is `--cookie-policy-override`/`--cookie-policy` > `--use-cookies` > config defaults.
- `auto` attempts injection when cookies are available and continues when cookies are missing/unusable.
- `required` fails fast with `reasonCode=auth_required` when cookie loading/injection/verification cannot establish a session.
- Cookie diagnostics are exposed in workflow metrics under `meta.metrics.cookie_diagnostics` and `meta.metrics.cookieDiagnostics`.

### Artifact lifecycle cleanup

Use the artifact cleanup command to remove expired bundles generated by workflow runs:

```bash
npx opendevbrowser artifacts cleanup --expired-only
npx opendevbrowser artifacts cleanup --expired-only --output-dir /tmp/opendevbrowser
```

Script helper:

```bash
./scripts/artifacts-cleanup.sh
./scripts/artifacts-cleanup.sh /tmp/opendevbrowser
```

Notes:
- `--expired-only` is required.
- Default cleanup root is `${TMPDIR:-/tmp}/opendevbrowser`.
- Output includes `removed` and `skipped` run paths.

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
- Headless is never the default.
- Extension headless is unsupported. `launch --headless` must be paired with `--no-extension`; extension-intent headless requests fail with `unsupported_mode`.
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

### Concurrency semantics

- Transport-level concurrency: `/ops` supports multi-client access and multiple sessions.
- Runtime scheduling uses `ExecutionKey = (sessionId, targetId)` with target-scoped queues.
- Same target stays FIFO; different targets in one session run in parallel up to `effectiveParallelCap`.
- `session-per-worker` remains the safest baseline for simple operational isolation, but in-session multi-target parallelism is supported on `/ops`, managed, and `cdpConnect`.
- Use explicit `--target-id` routing for concurrent flows; treat `target-use` as ergonomic fallback only.
- Use `/ops` as the default concurrent relay channel. Use `--extension-legacy` (`/cdp`) only for compatibility-specific paths.
- Legacy `/cdp` stays sequential (`effectiveParallelCap=1`) by design.
- For managed parallel launches with persisted profiles, use unique profile directories per session (or disable persistence) to avoid ProcessSingleton/SingletonLock collisions.
- Parity divergences are registry-bound in `docs/PARITY_DECLARED_DIVERGENCES.md`.

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
npx opendevbrowser status --transport native
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
- Supported across `managed`, default extension `/ops`, extension legacy `/cdp`, and direct `cdpConnect` sessions.

### Cookie list

```bash
npx opendevbrowser cookie-list \
  --session-id <session-id>

npx opendevbrowser cookie-list \
  --session-id <session-id> \
  --url https://example.com \
  --url https://shop.example.com \
  --request-id req-cookie-list-001
```

Notes:
- `--url` is optional and repeatable; each value is normalized and deduplicated.
- Supports `managed`, default extension `/ops`, extension legacy `/cdp`, and direct `cdpConnect` sessions.

### Macro resolve

```bash
npx opendevbrowser macro-resolve --expression '@web.search("openai")'
npx opendevbrowser macro-resolve --expression '@social.post("x", "ship it")' --default-provider social/x --include-catalog
npx opendevbrowser macro-resolve --expression '@web.search("opendevbrowser")' --execute --output-format json
npx opendevbrowser macro-resolve --expression '@media.search("youtube transcript parity", "youtube", 5)' --execute --timeout-ms 120000 --output-format json
```

Notes:
- Default mode is resolve-only (returns the resolved action/provenance payload).
- `--execute` runs the resolved provider action and returns additive execution metadata (`meta.tier.selected`, `meta.tier.reasonCode`, `meta.provenance.provider`, `meta.provenance.retrievalPath`, `meta.provenance.retrievedAt`).
- `--timeout-ms` sets client-side daemon transport timeout for slow `--execute` runs.
- `opendevbrowser --help` includes this timeout flag in the global flag inventory.

### Blocker contract (v2)

Compatibility rule (v2):
- Blocker fields are additive-only and live under `meta.blocker` (or `execution.meta.blocker` for `macro-resolve --execute`).
- Existing success/error fields and codes remain unchanged.
- Consumers should treat missing blocker fields as backward-compatible `no blocker metadata`.

Canonical placement:
- `goto`: `data.meta.blockerState` + optional `data.meta.blocker`.
- `wait`: `data.meta.blockerState` + optional `data.meta.blocker`.
- `debug-trace-snapshot`: `data.meta.blockerState` + optional `data.meta.blocker` + optional `data.meta.blockerArtifacts`.
- `macro-resolve --execute`: `data.execution.meta.ok` + optional `data.execution.meta.blocker`.
- `status`: `data.meta.blockerState` + optional `data.meta.blockerResolution` (`resolved | unresolved | deferred`).

Canonical examples:

```json
{
  "command": "goto",
  "success": true,
  "data": {
    "finalUrl": "https://example.com",
    "status": 200,
    "timingMs": 412,
    "meta": {
      "blockerState": "clear"
    }
  }
}
```

```json
{
  "command": "goto",
  "success": true,
  "data": {
    "finalUrl": "https://x.com/i/flow/login",
    "status": 200,
    "timingMs": 588,
    "meta": {
      "blockerState": "active",
      "blocker": {
        "schemaVersion": "1.0",
        "type": "auth_required",
        "source": "navigation",
        "confidence": 0.97,
        "retryable": false
      }
    }
  }
}
```

```json
{
  "command": "wait",
  "success": true,
  "data": {
    "timingMs": 221,
    "meta": {
      "blockerState": "clear"
    }
  }
}
```

```json
{
  "command": "status",
  "success": true,
  "data": {
    "mode": "managed",
    "activeTargetId": "target-1",
    "url": "https://x.com/i/flow/login",
    "title": "Log in to X / X",
    "meta": {
      "blockerState": "active",
      "blockerResolution": {
        "status": "unresolved",
        "reason": "verification_timeout",
        "updatedAt": "2026-02-15T14:18:28.000Z"
      }
    }
  }
}
```

```json
{
  "command": "wait",
  "success": true,
  "data": {
    "timingMs": 1470,
    "meta": {
      "blockerState": "active",
      "blocker": {
        "schemaVersion": "1.0",
        "type": "anti_bot_challenge",
        "source": "navigation",
        "confidence": 0.96,
        "retryable": false
      }
    }
  }
}
```

```json
{
  "command": "debug-trace-snapshot",
  "success": true,
  "data": {
    "requestId": "req-debug-001",
    "meta": {
      "blockerState": "clear"
    }
  }
}
```

```json
{
  "command": "debug-trace-snapshot",
  "success": true,
  "data": {
    "requestId": "req-debug-002",
    "meta": {
      "blockerState": "active",
      "blocker": {
        "schemaVersion": "1.0",
        "type": "anti_bot_challenge",
        "source": "network",
        "confidence": 0.96,
        "retryable": false
      },
      "blockerArtifacts": {
        "schemaVersion": "1.0",
        "hosts": ["www.recaptcha.net", "challenges.cloudflare.com"]
      }
    }
  }
}
```

```json
{
  "command": "macro-resolve --execute",
  "success": true,
  "data": {
    "runtime": "macros",
    "execution": {
      "meta": {
        "ok": true,
        "partial": false
      }
    }
  }
}
```

```json
{
  "command": "macro-resolve --execute",
  "success": true,
  "data": {
    "runtime": "macros",
    "execution": {
      "meta": {
        "ok": false,
        "partial": true,
        "blocker": {
          "schemaVersion": "1.0",
          "type": "env_limited",
          "source": "macro_execution",
          "confidence": 0.9,
          "retryable": true
        }
      }
    }
  }
}
```

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
npx opendevbrowser screenshot --session-id <session-id> --path ./capture.png --timeout-ms 60000
```

Notes:
- `--timeout-ms` sets client-side daemon timeout for screenshot capture.

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
| `--transport` | | Transport selector (`relay` or `native`) for transport-aware commands |
| `--daemon` | | Daemon status selector for `status` |
| `--skills-global` | | Install skills to global OpenCode/Codex/ClaudeCode/AmpCLI directories (legacy `claude`/`amp` aliases also synced) |
| `--skills-local` | | Install skills to project-local OpenCode/Codex/ClaudeCode/AmpCLI directories (legacy `claude`/`amp` aliases also synced) |
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
| `--daemon` | `status` | Force daemon status mode (mutually exclusive with `--session-id`) |
| `--no-extension` | `launch` | Force managed mode (ignore extension) |
| `--extension-only` | `launch` | Fail if extension not connected |
| `--extension-legacy` | `launch`, `connect` | Use legacy extension relay (`/cdp`) |
| `--wait-for-extension` | `launch` | Wait for extension handshake |
| `--wait-timeout-ms` | `launch` | Max wait for extension handshake |
| `--cookies` | `cookie-import` | Inline JSON array of cookie objects |
| `--cookies-file` | `cookie-import` | Path to JSON file containing cookie objects |
| `--strict` | `cookie-import` | Reject on invalid cookie entries (`true`/`false`) |
| `--request-id` | `cookie-import`, `cookie-list`, `debug-trace-snapshot` | Optional request correlation id |
| `--expression` | `macro-resolve` | Macro expression to resolve |
| `--default-provider` | `macro-resolve` | Provider fallback for shorthand macros |
| `--include-catalog` | `macro-resolve` | Include macro catalog in response |
| `--execute` | `macro-resolve` | Execute the resolved provider action and include additive `meta.*` fields |
| `--timeout-ms` | `macro-resolve` | Client-side daemon call timeout in ms |
| `--use-cookies` | `research run`, `shopping run`, `product-video run` | Enable/disable provider cookie injection for the run (`true|false`; bare flag means `true`) |
| `--cookie-policy-override` | `research run`, `shopping run`, `product-video run` | Per-run provider cookie policy override (`off|auto|required`) |
| `--cookie-policy` | `research run`, `shopping run`, `product-video run` | Alias of `--cookie-policy-override` |

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
| `--url` | `goto`, `page`, `target-new`, `cookie-list` | URL to navigate/open or filter cookie listing |
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
| `--timeout-ms` | `screenshot` | Client-side daemon call timeout in ms |
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
- Emits explicit extension readiness preflight diagnostics (`infra.extension.ready`) before extension-mode cases.
- Classifies upstream reachability failures (for example social/community dependencies) as `env_limited`.
- Classifies unattended annotation timeouts as `expected_timeout`.
- Captures mode-specific blocker evidence (`goto`/`wait` + `debug-trace-snapshot`) for managed, extension, and cdpConnect comparisons.
- Emits a JSON summary with per-step status for reproducible CI/manual verification.

## Provider live matrix harness

Run the provider-depth live harness promoted from the `/tmp` validation script:

```bash
npm run build
node scripts/provider-live-matrix.mjs --out /tmp/odb-provider-live-matrix.json
```

CI-safe smoke mode (reduced cases, deterministic gating checks, no long workflow probes by default):

```bash
npm run build
node scripts/provider-live-matrix.mjs --smoke --out /tmp/odb-provider-live-matrix-smoke.json
```

Key checks included in full mode:
- Social issue probes: search/fetch coverage across platforms plus extension `/ops` timeout/retry behavior on YouTube/Instagram.
- Shopping issue probes: cross-provider query coverage with explicit timeout budget support.
- Browser issue probes: real-world navigation on YouTube/Instagram/Facebook across `managed`, `extension`, and `cdpConnect` with blocker metadata.
- Research-first defaults: auth-gated provider scenarios (`facebook`, `linkedin`, `shopping/costco`, `shopping/macys`), high-friction provider scenarios (`shopping/bestbuy`), and social post probes are skipped unless explicitly enabled.

Key options:
- `--use-global-env` reuse existing OPENCODE config/cache instead of isolated temp dirs.
- `--skip-live-regression`, `--skip-browser-probes`, `--skip-workflows` for focused diagnostics.
- `--include-live-regression`, `--include-browser-probes`, `--include-workflows` to re-enable those probes in `--smoke`.
- `--include-auth-gated` enables auth-dependent provider scenarios (deferred by default).
- `--include-high-friction` enables high-friction providers (deferred by default).
- `--include-social-posts` enables social post scenarios (deferred by default).

Run parity and skill-asset gates as part of release checks:

```bash
npm run test -- tests/parity-matrix.test.ts
npm run test -- tests/providers-performance-gate.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```

Release gate source of truth: `docs/RELEASE_PARITY_CHECKLIST.md`.
Benchmark fixture manifest: `docs/benchmarks/provider-fixtures.md`.

### Latest validation (2026-02-15)

- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm run build` ✅
- `npm run test` ✅
- `node scripts/live-regression-matrix.mjs` ✅ (`pass: 21`, `env_limited: 1`, `expected_timeout: 2`, `fail: 0`)
- Current `env_limited` outcomes are setup/environment-related:
  - `mode.extension_legacy_cdp` (relay `/cdp` tab/session drift: `No tab with given id`)
- Current `expected_timeout` outcomes are interaction-related:
  - `feature.annotate.relay`
  - `feature.annotate.direct`
- Operator rollout, rollback triggers, and triage checklist are documented in `docs/TROUBLESHOOTING.md`.

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
  "providers": {
    "antiBotPolicy": {
      "enabled": true,
      "cooldownMs": 30000,
      "maxChallengeRetries": 1,
      "allowBrowserEscalation": true
      // "proxyHint": "residential_pool_a",
      // "sessionHint": "warm_profile"
    },
    "transcript": {
      "modeDefault": "auto",
      "strategyOrder": ["youtubei", "native_caption_parse", "ytdlp_audio_asr", "apify"],
      "enableYtdlp": false,
      "enableAsr": false,
      "enableYtdlpAudioAsr": true,
      "enableApify": true,
      "apifyActorId": "streamers/youtube-scraper",
      "enableBrowserFallback": true,
      "ytdlpTimeoutMs": 10000
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
Provider runtime anti-bot/transcript controls default to an exhaustive YouTube fallback chain:
- Transcript mode semantics: `auto | web | no-auto | yt-dlp | apify`.
- Request filter precedence is `filters.youtube_mode > providers.transcript.modeDefault > auto`.
- No CLI mode flag is introduced in this phase; mode is configured in `providers.transcript.modeDefault` or per-request `youtube_mode` filter.
- Auto mode fallback chain is `youtubei -> native_caption_parse -> ytdlp_audio_asr -> apify`, with browser-assisted fallback attempted last when browser escalation is available.
- `yt-dlp` audio transcription requires `providers.transcript.enableYtdlpAudioAsr=true`.
- Apify requires `providers.transcript.enableApify=true`, a valid `APIFY_TOKEN`, and legal checklist approval for `apify`.
- Browser-assisted fallback requires `providers.transcript.enableBrowserFallback=true` and `providers.antiBotPolicy.allowBrowserEscalation=true`.

Provider workflow and execution outputs now include normalized transcript/anti-bot telemetry:
- Failure reason codes: `meta.metrics.reason_code_distribution` (legacy), `meta.metrics.reasonCodeDistribution` (camelCase alias), and `reasonCode` on provider failures.
- Transcript fallback diagnostics: `meta.metrics.transcript_strategy_failures` (legacy) and `meta.metrics.transcriptStrategyFailures` (camelCase alias).
- Strategy-detail diagnostics: `meta.metrics.transcript_strategy_detail_failures`/`meta.metrics.transcriptStrategyDetailFailures` and `meta.metrics.transcript_strategy_detail_distribution`/`meta.metrics.transcriptStrategyDetailDistribution`.
- Durability/pressure dimensions: `meta.metrics.transcriptDurability` and `meta.metrics.antiBotPressure` (snake_case aliases are also emitted).
- YouTube fetch metadata: `transcript_strategy` (legacy bucket), `transcript_strategy_detail` (exact strategy), `attempt_chain`, and failure `reasonCode` when transcript retrieval is unavailable.

Provider reliability criteria (resolver/browser fallback):
- `npm run test -- tests/providers-performance-gate.test.ts` must pass.
- Latest observation window must satisfy `meta.metrics.transcriptDurability.attempted >= 10` and `meta.metrics.transcriptDurability.success_rate >= 0.85`.
- Latest observation window must satisfy `meta.metrics.antiBotPressure.anti_bot_failure_ratio <= 0.15`.
- Trigger remediation immediately if either condition fails in two consecutive windows.
