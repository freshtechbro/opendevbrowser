# First-Run Onboarding (Pre-Release)

Status: active  
Last updated: 2026-02-24

This guide is the shipping checklist for validating OpenDevBrowser as a new user **before npm distribution is live**.

## What this validates

1. Install command from a local package artifact.
2. First-time global install path (`--global --full --no-prompt`).
3. Daemon start/stop command.
4. Extension load path + connection checks.
5. First task execution command chain.
6. Multi-tab + cookie-injection auth mechanism checks.

## 0) Preconditions

- Node.js `>=18`
- Chrome 125+
- Repository available locally

## 1) Build a local install artifact

```bash
cd <public-repo-root>
npm pack
# -> opendevbrowser-0.0.16.tgz
```

## 2) Simulate a brand-new user workspace

```bash
WORKDIR=$(mktemp -d /tmp/opendevbrowser-first-run-XXXXXX)
cd "$WORKDIR"
npm init -y
npm install <public-repo-root>/opendevbrowser-0.0.16.tgz
npx --no-install opendevbrowser version --output-format json
```

Expected:
- package is installed under `./node_modules/opendevbrowser`
- CLI command inventory is available via `npx --no-install opendevbrowser --help`

## 3) Isolate config/cache to avoid daemon collisions

For onboarding tests on machines that already run OpenDevBrowser, isolate runtime state:

```bash
export OPENCODE_CONFIG_DIR=/tmp/opendevbrowser-first-run-isolated/config
export OPENCODE_CACHE_DIR=/tmp/opendevbrowser-first-run-isolated/cache
mkdir -p "$OPENCODE_CONFIG_DIR" "$OPENCODE_CACHE_DIR"
```

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
- extension assets are available at `~/.config/opencode/opendevbrowser/extension` (or isolated equivalent when `OPENCODE_CONFIG_DIR` is set)

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

```bash
npx --no-install opendevbrowser cookie-import --session-id "$SESSION_ID" --cookies-file ./cookies.json --strict --output-format json
npx --no-install opendevbrowser cookie-list --session-id "$SESSION_ID" --url https://example.com --output-format json
```

This validates cookie import/list behavior. Whether auth is accepted depends on provider/session validity.

## 8) Multi-tab mode checks

Managed:
- `target-new` multiple social tabs
- `target-use` + `goto` + `snapshot` per target

CDPConnect:
- start Chrome with `--remote-debugging-port`
- `connect --cdp-port <port>`
- repeat `target-new`/`target-use`/`goto`/`debug-trace-snapshot`

Extension:
- `launch --extension-only --wait-for-extension`
- if disconnected, expected actionable error is returned with fallback commands

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
- `artifacts/provider-live-matrix-onboarding-smoke.json`
- `artifacts/provider-live-matrix-onboarding-full-noext.json`
