# OpenDevBrowser Extension

Optional Chrome extension that enables relay mode (attach to existing logged-in tabs).

## What it does

- Connects to the local relay server (`ws://127.0.0.1:<port>/extension`).
- Uses the Chrome Debugger API to forward CDP commands for the active tab.
- Allows OpenDevBrowser to control tabs without launching a new browser.

## Installation

1. Run the CLI once with `--full` so the extension assets are extracted:
   ```bash
   npx opendevbrowser --full
   ```
2. Load the extension unpacked from:
   - `~/.config/opencode/opendevbrowser/extension`
   - Fallback: `~/.cache/opencode/node_modules/opendevbrowser/extension`
3. Open the extension popup to configure relay settings.

## Popup settings

- **Relay port**: Port of the local relay server (default `8787`).
- **Auto-connect**: Reconnect on browser start (default on).
- **Auto-pair**: Fetch pairing token automatically from the plugin (default on).
- **Require pairing token**: Require token for relay pairing (recommended).
- **Pairing token**: Manual token entry when auto-pair is off.

## Default settings

| Setting | Default |
|---------|---------|
| Relay port | `8787` |
| Auto-connect | `true` |
| Auto-pair | `true` |
| Require pairing token | `true` |
| Pairing token | `null` (fetched on connect) |

## Auto-connect behavior

Auto-connect is enabled by default. The extension attempts to connect on browser startup, install, and when the toggle is enabled in the UI. Auto-connect respects the current relay port, pairing settings, and auto-pair toggle.

## Auto-pair flow

When auto-pair is enabled:

1. The extension calls the local discovery endpoint (`/config`) to learn the relay port and pairing requirement.
2. If pairing is required, it fetches the token from `/pair`.
3. The extension connects to the relay with the pairing token.

`/config` and `/pair` are restricted to `chrome-extension://` origins. The CLI should not call `/config` or `/pair`.

## Security notes

- Relay connections are local-only by default.
- Pairing tokens are stored in `chrome.storage.local` and never sent to third parties.
- The extension does not log page content or tokens.
- Non-local relay endpoints are not supported unless explicitly configured in the plugin.

## Troubleshooting

- **Extension not connecting**: Confirm the relay is running (`opendevbrowser serve`) and the port matches the popup.
- **Auto-pair failing**: Ensure the plugin is running and the relay server is available on the configured port.
- **Pairing token required**: Enable "Require pairing token" and provide the value from your `opendevbrowser.jsonc`.
