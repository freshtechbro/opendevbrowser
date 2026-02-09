# Troubleshooting

## Hub daemon status

If the extension or tools fail to connect, confirm the hub daemon is running:

- Start the daemon: `npx opendevbrowser serve`
- Stop the daemon: `npx opendevbrowser serve --stop`

The daemon `/status` response includes:
- `hub.instanceId` – hub daemon identifier
- `relay.instanceId` – relay server identifier
- `binding` – current binding owner + expiry
The daemon port/token are persisted in `opendevbrowser.jsonc` as `daemonPort`/`daemonToken` to recover from stale cache metadata.

### Relay status quick read

`npx opendevbrowser status --daemon` includes a legend for:
- `extensionConnected` – popup websocket connected
- `extensionHandshakeComplete` – extension handshake finished
- `opsConnected` – any `/ops` client attached (expected **false** until an extension relay session is active)
- `cdpConnected` – any `/cdp` client attached (legacy path, expected **false** unless `--extension-legacy` is used)
- `pairingRequired` – relay token required for `/ops` and `/cdp`

If `opsConnected` stays `false` after extension-mode `launch`/`connect`, restart the daemon and reconnect the extension.
`cdpConnected` remaining `false` is normal for default `/ops` sessions.

## Verify OpenCode is loading local plugin updates

When validating local fixes in OpenCode, verify both plugin registration and resolved local path:

- Check OpenCode config:
  - `cat ~/.config/opencode/opencode.json`
- Confirm runtime-loaded plugin paths:
  - `opencode debug config`
- Confirm OpenDevBrowser is loaded from your intended local path (for example a repo symlink) and not a stale cache copy.

If OpenCode is still resolving an old cached install:
- Clear plugin cache: `rm -rf ~/.cache/opencode/node_modules/opendevbrowser`
- Restart OpenCode and re-run `opencode debug config`.

## Relay binding busy

When multiple plugin instances run, only one client can hold the relay binding at a time.

Symptoms:
- Errors starting with `RELAY_BINDING_REQUIRED` or `RELAY_WAIT_TIMEOUT`

Fixes:
- Wait for the current binding to expire (default TTL 60s)
- Ensure the other client releases the relay by closing its extension session
- Restart the daemon if a binding is stuck: `npx opendevbrowser serve --stop` then `npx opendevbrowser serve`
- If queued, retry after the wait timeout (default 30s)

## Extension instance mismatch

If the extension pairs with a different relay instance, it will refuse to auto-pair and reconnect.

Fixes:
- Open the extension popup and click **Connect** to refresh pairing
- Ensure the daemon and extension are both using the same relay port
- If needed, restart the daemon and reconnect the extension

If the daemon logs `handshake_failed` with `invalid_token`, the extension is using a stale pairing token:
- Click **Connect** in the extension popup (auto-pair fetches the current token)
- Verify `relayPort` matches the daemon’s relay port

## OpenCode `run --command` reports `command3.agent`

If prompt-driven background runs fail with errors that mention `command3.agent`, force explicit shell command routing:

- Preferred: `opencode run --command shell "echo hello"`
- Also valid: `opencode run --command "echo hello"` (single quoted command string)
- Avoid split forms that can be parsed as agent command selectors.

After upgrading/replacing `opencode`, re-run a quick probe in JSON mode to confirm `command3.agent` is no longer present in stderr/log output.

## Extension-only quick verification flow

Use this sequence to validate extension-only mode end-to-end:

1. Start daemon: `npx opendevbrowser serve`
2. Confirm relay health: `npx opendevbrowser status --daemon --output-format json`
3. Launch extension session: `npx opendevbrowser launch --extension-only --wait-for-extension`
4. Run a simple command (`status`, `snapshot`, or `targets-list`) and then disconnect.

For broad regression checks, run:
- `node /tmp/odb_ext_test_matrix.mjs`
- `node /tmp/odb_rerun_low_churn.mjs`

## Chrome version too old

Extension relay requires **Chrome 125+** for flat CDP sessions. Upgrade Chrome if you see errors about unsupported flat sessions.

## Hub-only mode

When hub mode is enabled, the plugin will not fall back to a local relay. If the hub daemon cannot be reached:
- Start it: `npx opendevbrowser serve`
- Verify `/status` with the configured `daemonPort`/`daemonToken`
