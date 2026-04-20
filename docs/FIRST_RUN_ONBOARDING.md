# First-Run Onboarding (Local Artifact Validation)

Status: active  
Last updated: 2026-04-20

This guide is the shipping checklist for validating OpenDevBrowser as a new user from a local package artifact. Use `docs/RELEASE_RUNBOOK.md` for the separate published npm registry-consumer proof lane.

## What this validates

1. Install command from a local package artifact.
2. Help-led onboarding path from generated help to the `Find It Fast` lookup terms and best-practices quick-start guidance.
3. Managed-skill lifecycle proof for first-time install, reinstall, update, and uninstall cleanup.
4. Daemon start/stop command.
5. Extension load path + connection checks.
6. First task execution command chain.
7. Multi-tab + cookie-injection auth mechanism checks.

## 0) Preconditions

- Node.js `>=18`
- Chrome 125+
- Repository available locally
- If you plan to validate desktop observation, use macOS with the local `swift` command available via Xcode or another Swift toolchain

## 1) Build a local install artifact

```bash
cd <public-repo-root>
npm pack
# -> opendevbrowser-0.0.22.tgz
```

## 2) Simulate a brand-new isolated user workspace

```bash
WORKROOT=$(mktemp -d /tmp/opendevbrowser-first-run-XXXXXX)
WORKDIR="$WORKROOT/workdir"
export HOME="$WORKROOT/home"
export OPENCODE_CONFIG_DIR="$WORKROOT/opencode-config"
export OPENCODE_CACHE_DIR="$WORKROOT/opencode-cache"
export CODEX_HOME="$WORKROOT/codex-home"
export CLAUDECODE_HOME="$WORKROOT/claude-home"
export AMP_CLI_HOME="$WORKROOT/amp-home"
mkdir -p "$WORKDIR" "$HOME" "$OPENCODE_CONFIG_DIR" "$OPENCODE_CACHE_DIR" "$CODEX_HOME" "$CLAUDECODE_HOME" "$AMP_CLI_HOME"
cd "$WORKDIR"
npm init -y
npm install <public-repo-root>/opendevbrowser-0.0.22.tgz
npx --no-install opendevbrowser version --output-format json
```

Expected:
- package is installed under `./node_modules/opendevbrowser`
- CLI command inventory is available via both `npx --no-install opendevbrowser --help` and `npx --no-install opendevbrowser help`
- packaged postinstall skill sync already populates isolated managed skill targets for:
  - `$OPENCODE_CONFIG_DIR/skill`
  - `$CODEX_HOME/skills`
  - `$CLAUDECODE_HOME/skills`
  - `$AMP_CLI_HOME/skills`
- each populated global skill directory contains `.opendevbrowser-managed-skills.json` plus one `.opendevbrowser-managed-skill.json` sentinel per bundled canonical pack

## 2b) Validate the help-led quick-start path

```bash
npx --no-install opendevbrowser --help
npx --no-install opendevbrowser help
```

Expected:
- both commands print the same generated help output
- help opens with a `Find It Fast` block before `Agent Quick Start`
- the `Find It Fast` block includes the exact lookup terms `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`
- the block maps replay to `screencast-start` / `screencast-stop`
- the block maps desktop observation to the public `desktop-*` family
- the block maps browser-scoped computer use to `--challenge-automation-mode` on `research run`, `shopping run`, `product-video run`, `inspiredesign run`, and `macro-resolve --execute`
- the block includes a concrete browser-scoped entry command such as `npx opendevbrowser research run --topic "account recovery flow" --source-selection auto --challenge-automation-mode browser --mode json --output-format json`
- help then opens the `Agent Quick Start` block
- the block explicitly points agents to `opendevbrowser_prompting_guide`
- the block explicitly points agents to `opendevbrowser_skill_load opendevbrowser-best-practices "quick start"`
- the block explicitly points agents to `opendevbrowser_skill_load opendevbrowser-best-practices "validated capability lanes"`
- the block explicitly points agents to `opendevbrowser_skill_list` for alternate local workflow lanes
- the block points to `docs/FIRST_RUN_ONBOARDING.md` for proof and `skills/opendevbrowser-best-practices/SKILL.md` as the canonical bundled runbook

Optional terminal proof:

```bash
npx --no-install opendevbrowser --help | grep -E "screencast / browser replay|desktop observation|computer use / browser-scoped computer use|screencast-start|desktop-status|challenge-automation-mode"
```

## 2c) Validate the currently reliable workflow lanes

These are the most repeatable capability checks from the April 6 validation pass.

```bash
npx --no-install opendevbrowser research run --topic "Chrome extension debugging workflows" --days 30 --source-selection auto --mode json --output-format json
npx --no-install opendevbrowser shopping run --query "wireless ergonomic mouse" --providers shopping/bestbuy,shopping/ebay --budget 150 --browser-mode managed --mode json --output-format json
npx --no-install opendevbrowser shopping run --query "27 inch 4k monitor" --providers shopping/bestbuy,shopping/ebay --budget 350 --sort lowest_price --browser-mode managed --mode json --output-format json
```

Use the bundled best-practices runbook for the full current lane set, including the public-first YouTube transcript probe:

```bash
opendevbrowser_skill_load opendevbrowser-best-practices "validated capability lanes"
```

Region note:
- treat `--region` as advisory unless workflow output reports `meta.selection.region_authoritative=true`

## 3) Write isolated config/cache defaults

The temp workspace above already isolates managed-skill targets and the extension extraction home. Add an explicit config file before the first daemon or extension checks:

```bash
mkdir -p "$OPENCODE_CONFIG_DIR" "$OPENCODE_CACHE_DIR"
```

This keeps config, cache, daemon state, extension assets, and managed-skill lifecycle proof contained to the temp home while you validate local-package behavior.

Minimal isolated config:

```jsonc
{
  "relayPort": 9877,
  "relayToken": "relay-test-token-9877",
  "daemonPort": 9878,
  "daemonToken": "daemon-test-token-9878",
  "headless": true,
  "persistProfile": false
}
```

Write it to:
- `$OPENCODE_CONFIG_DIR/opendevbrowser.jsonc`

## 3b) First-time global install simulation

Run the installer path exactly as first-time users do (global + full + no prompt):

```bash
cd "$WORKDIR"
npx --no-install opendevbrowser --global --full --no-prompt
```

Expected:
- global OpenCode config is created/updated under `$OPENCODE_CONFIG_DIR`
- bundled skills sync runs without errors
- if packaged postinstall already populated the managed skill targets, the command may honestly report `unchanged` counts instead of reinstalling the same packs
- extension assets are extracted to `~/.config/opencode/opendevbrowser/extension`
- extracted assets now include `manifest.json`, `popup.html`, `canvas.html`, `dist/`, and `icons/`
- `OPENCODE_CONFIG_DIR` isolates config lookup only; it does not relocate the extracted extension asset directory
- because this guide uses a temp `WORKDIR`, install-time daemon auto-start reconciliation may warn instead of persisting a background entry
- if persistent login auto-start is desired after onboarding, rerun `opendevbrowser daemon install` from a stable install location outside the temp workspace

## 3c) Stable auto-start follow-up

The onboarding workspace proves first-run package behavior, not long-lived daemon auto-start. Do **not** treat `$WORKDIR` as the
final login-start location.

When you want to validate daemon auto-start, rerun from the intended persistent install location:

```bash
# Global install
opendevbrowser daemon install --output-format json
opendevbrowser daemon status --output-format json

# Or, from a persistent local package install
npx --no-install opendevbrowser daemon install --output-format json
npx --no-install opendevbrowser daemon status --output-format json
```

Expected from a stable install location:
- `autostart.health="healthy"`
- `autostart.needsRepair=false`
- `command` points at the intended persistent CLI path

## 4) Start daemon

```bash
cd "$WORKDIR"
npx --no-install opendevbrowser serve --output-format json
```

In another shell (same `OPENCODE_*` env):

```bash
npx --no-install opendevbrowser status --daemon --output-format json
```

Expected for initial first-run state:
- daemon is running
- relay is running
- `extensionConnected=false` until popup connects

## 5) Extension load path and connect flow

Load unpacked extension from the installed package:

- `$WORKDIR/node_modules/opendevbrowser/extension`

Quick checks in Chrome popup:
- relay port matches config (`9877` in isolated example)
- auto-pair uses current relay token

Readiness check:

```bash
npx --no-install opendevbrowser status --daemon --output-format json
```

Ready state for extension workflows:
- `extensionConnected=true`
- `extensionHandshakeComplete=true`

## 6) First task command chain (managed mode)

```bash
SESSION_JSON=$(npx --no-install opendevbrowser launch --no-extension --headless --output-format json)
SESSION_ID=<session-id-from-output>
npx --no-install opendevbrowser goto --session-id "$SESSION_ID" --url https://example.com --wait-until load --timeout-ms 60000 --output-format json
npx --no-install opendevbrowser snapshot --session-id "$SESSION_ID" --output-format json
npx --no-install opendevbrowser disconnect --session-id "$SESSION_ID" --close-browser --output-format json
```

## 7) Cookie injection auth mechanism check

Mode/session reuse matrix before first navigation:

| Mode | Session reuse behavior | `cookie-import` role |
| --- | --- | --- |
| `extension` | Reuses the attached live tab or profile state. No system bootstrap runs in this mode. | Explicit add/override only after session creation. |
| `managed` | Attempts readable system Chrome-family cookie bootstrap before first navigation. | Explicit add/override only after session creation. |
| `cdpConnect` | Attempts readable system Chrome-family cookie bootstrap before first navigation. | Explicit add/override only after session creation. |

```bash
npx --no-install opendevbrowser cookie-import --session-id "$SESSION_ID" --cookies-file ./cookies.json --strict --output-format json
npx --no-install opendevbrowser cookie-list --session-id "$SESSION_ID" --url https://example.com --output-format json
```

This validates explicit cookie add/override behavior plus cookie enumeration. Automatic bootstrap for `managed` and `cdpConnect` happens earlier, before first navigation. Whether auth is accepted still depends on provider/session validity.

## 8) Multi-tab mode checks

Managed:
- `target-new` multiple social tabs
- `target-use` + `goto` + `snapshot` per target
- reuse baseline: attempts readable system Chrome-family cookie bootstrap before first navigation

CDPConnect:
- start Chrome with `--remote-debugging-port`
- `connect --cdp-port <port>`
- repeat `target-new`/`target-use`/`goto`/`debug-trace-snapshot`
- reuse baseline: attempts readable system Chrome-family cookie bootstrap before first navigation

Extension:
- `launch --extension-only --wait-for-extension`
- if disconnected, expected actionable error is returned with fallback commands
- reuse baseline: attached live tab/profile state is reused directly; `cookie-import` stays an explicit override lane

## 9) Shutdown and cleanup

```bash
npx --no-install opendevbrowser serve --stop --output-format json
```

Also verify no stale headless temp-profile workers remain:

```bash
ps ax -o pid=,ppid=,command= | awk '/\/opendevbrowser\/projects\// && /\/temp-profiles\// {print}'
```

## Verified run notes (2026-02-24)

Validated in this repo with local artifact install:
- local package install in isolated temp workspace: pass
- daemon start/status/stop in isolated config: pass
- managed launch/goto/snapshot/disconnect: pass
- cdpConnect multi-tab social probes + cookie import/list: pass
- provider matrix with browser probes disabled (extension disconnected): pass with one env-limited social timeout (`provider.social.x.search`)

Artifacts:
- `artifacts/provider-direct-runs-onboarding-smoke.json`
- `artifacts/provider-direct-runs-onboarding-full-noext.json`
