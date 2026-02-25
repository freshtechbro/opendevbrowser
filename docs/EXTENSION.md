# OpenDevBrowser Extension

Optional Chrome extension that enables relay mode (attach to existing logged-in tabs).

Status: active  
Last updated: 2026-02-24

Quick file-level overview: `<public-repo-root>/extension/README.md`

## What it does

- Connects to the local relay server (`ws://127.0.0.1:<port>/extension`).
- Uses the Chrome Debugger API to forward CDP commands across attached tabs/targets (with a primary tab used for handshake/status).
- Allows OpenDevBrowser to control tabs without launching a new browser.
- Supports multi-tab CDP routing with flat sessions (Chrome 125+).
- Exposes top-level tabs and auto-attached child targets (workers/OOPIF) through `Target.getTargets`.
- Launch defaults to extension relay when available; managed/CDPConnect require explicit user choice.
- Extension mode is headed-only; extension-intent headless launch/connect is rejected with `unsupported_mode`.
- When hub mode is enabled, the hub daemon is the sole relay owner and enforces FIFO leases (no local relay fallback).

## Installation

Requires Node.js `>=18` and the npm package (`npx opendevbrowser` recommended; `npm install -g opendevbrowser` optional).

1. Run the CLI once with `--full` so the extension assets are extracted:
   ```bash
   npx opendevbrowser --full
   ```
2. Load the extension unpacked from:
   - `~/.config/opencode/opendevbrowser/extension`
   - Fallback: `~/.cache/opencode/node_modules/opendevbrowser/extension`
   - Pre-release local package onboarding: `<WORKDIR>/node_modules/opendevbrowser/extension`
3. Open the extension popup to configure relay settings.

For full first-run pre-release onboarding flow (local package install, isolated daemon, extension connect, first task), use:
- `<public-repo-root>/docs/FIRST_RUN_ONBOARDING.md`

## Popup settings

- **Relay port**: Port of the local relay server (default `8787`).
- **Auto-connect**: Reconnect on browser start (default on).
- **Auto-pair**: Fetch pairing token automatically from the plugin (default on).
- **Native fallback (experimental)**: Allow native messaging fallback when relay is unavailable (default off).
- **Require pairing token**: Require token for relay pairing (recommended).
- **Pairing token**: Manual token entry when auto-pair is off.

## Default settings

| Setting | Default |
|---------|---------|
| Relay port | `8787` |
| Auto-connect | `true` |
| Auto-pair | `true` |
| Native fallback (experimental) | `false` |
| Require pairing token | `true` |
| Pairing token | `null` (fetched on connect) |

## Auto-connect behavior

Auto-connect is enabled by default. The extension attempts to connect on browser startup, install, and when the toggle is enabled in the UI. Auto-connect respects the current relay port, pairing settings, and auto-pair toggle.
Native fallback is only attempted when the experimental native toggle is enabled.
The toolbar action uses the OpenDevBrowser icon set from `extension/icons/` (synced from `assets/extension-icons/` during `npm run extension:build`) and a badge dot indicator (green = connected, red = disconnected).

## Auto-pair flow

When auto-pair is enabled:

1. The extension calls the local discovery endpoint (`/config`) to learn the relay port and pairing requirement.
2. If pairing is required, it fetches the token from `/pair`.
3. The extension connects to the relay with the pairing token.

`/config` and `/pair` reject explicit non-extension origins. Chrome extension requests may omit the `Origin` header, so the relay also accepts missing-Origin requests. CLI/tools may call `/config` and `/pair` to auto-fetch relay settings and tokens.

Relay ops endpoint: `ws://127.0.0.1:<relayPort>/ops`. The CLI/tool `connect` command accepts base relay WS URLs
(for example `ws://127.0.0.1:<relayPort>`) and normalizes them to `/ops`.
Legacy relay `/cdp` is still available but must be explicitly opted in (CLI: `--extension-legacy`).
When pairing is enabled, both `/ops` and `/cdp` require a relay token (`?token=<relayToken>`). Tools and the CLI auto-fetch `/config` and `/pair`
to obtain the token before connecting, so users should not manually pass or share tokenized URLs.

Readiness checks:

```bash
npx opendevbrowser status --daemon --output-format json
npx opendevbrowser --help
```

Expected extension-ready daemon fields:
- `extensionConnected=true`
- `extensionHandshakeComplete=true`

## Chrome version requirement

Extension relay uses flat CDP sessions and requires **Chrome 125+**. Older versions will fail fast with a clear error.

## Multi-tab + primary tab behavior

- Target discovery (`Target.getTargets`) includes top-level tabs and child targets.
- Child targets are auto-attached recursively for session-aware routing.
- A single **primary tab** is used for relay handshake/status; switching tabs updates the handshake without disconnecting others.

## Security notes

- Relay connections are local-only by default.
- Pairing tokens are stored in `chrome.storage.local` and never sent to third parties.
- The extension does not log page content or tokens.
- Non-local relay endpoints are not supported unless explicitly configured in the plugin.

## Troubleshooting

- **Extension not connecting**: Confirm the relay is running (`opendevbrowser serve`) and the port matches the popup.
- **Auto-pair failing**: Ensure the plugin is running and the relay server is available on the configured port.
- **Pairing token required**: Enable "Require pairing token" and provide the value from your `opendevbrowser.jsonc`.
- **No active tab / restricted tab**: The popup cannot attach to `chrome://`, `chrome-extension://`, or Chrome Web Store pages. Focus a normal http(s) tab before connecting.
- **Debugger attach failed**: Close DevTools on the target tab (or any other debugger) and retry.
- **Chrome too old**: Extension relay requires Chrome 125+ for flat sessions.
- **Headless extension launch/connect fails**: expected. Extension mode is headed-only; use `launch --no-extension --headless` for managed headless sessions.
- **Launch fails due to missing extension**: The CLI/tool will print exact commands for Managed or CDPConnect fallbacks when the extension is not connected.
- **Popup shows Connected but launch says not connected**: Check the popup note for the relay port/instance (it now includes the relay identity) and ensure it matches the daemon relay port.
