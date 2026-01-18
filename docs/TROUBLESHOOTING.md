# Troubleshooting

## Hub daemon status

If the extension or tools fail to connect, confirm the hub daemon is running:

- Start the daemon: `npx opendevbrowser serve`
- Stop the daemon: `npx opendevbrowser serve --stop`

The daemon `/status` response includes:
- `hub.instanceId` – hub daemon identifier
- `relay.instanceId` – relay server identifier
- `binding` – current binding owner + expiry

## Relay binding busy

When multiple plugin instances run, only one client can hold the relay binding at a time.

Symptoms:
- Errors starting with `RELAY_BUSY` or `RELAY_BINDING_REQUIRED`

Fixes:
- Wait for the current binding to expire (default TTL 60s)
- Ensure the other client releases the relay by closing its extension session
- Restart the daemon if a binding is stuck: `npx opendevbrowser serve --stop` then `npx opendevbrowser serve`

## Extension instance mismatch

If the extension pairs with a different relay instance, it will refuse to auto-pair and reconnect.

Fixes:
- Open the extension popup and click **Connect** to refresh pairing
- Ensure the daemon and extension are both using the same relay port
- If needed, restart the daemon and reconnect the extension
