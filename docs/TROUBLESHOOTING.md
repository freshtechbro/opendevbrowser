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
- `cdpConnected` – any `/cdp` client attached (expected **false** until you launch/connect)
- `pairingRequired` – relay token required for `/cdp`

If `cdpConnected` stays `false` after `launch`/`connect`, restart the daemon and reconnect the extension.

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

## Chrome version too old

Extension relay requires **Chrome 125+** for flat CDP sessions. Upgrade Chrome if you see errors about unsupported flat sessions.

## Hub-only mode

When hub mode is enabled, the plugin will not fall back to a local relay. If the hub daemon cannot be reached:
- Start it: `npx opendevbrowser serve`
- Verify `/status` with the configured `daemonPort`/`daemonToken`
