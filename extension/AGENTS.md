# extension/ — Agent Guidelines

Chrome extension for relay mode. Extends root `AGENTS.md`.

## Architecture

```
extension/
├── src/
│   ├── background.ts    # Connection orchestration, message routing
│   ├── popup.tsx        # Settings UI (port, token, auto-connect)
│   └── services/        # CDP attach/detach, message forwarding
│       ├── CDPRouter.ts          # Flat-session routing + Target lifecycle
│       ├── TargetSessionMap.ts   # Root/child session mapping
│       └── cdp-router-commands.ts # Target command helpers
├── manifest.json
└── popup.html
```

Reference relay flow and security controls in `docs/ARCHITECTURE.md` when changing connection behavior.

## Key Behaviors

- **Local relay only**: Never add non-local endpoints
- **Auto-connect**: Enabled by default, attempts on install/startup
- **Auto-pair**: Fetches token from `/pair` endpoint
- **Configurable**: `relayPort`/`relayToken` from popup settings
- **Flat sessions**: Chrome 125+ only; route CDP by DebuggerSession `sessionId`
- **Top-level discovery**: List tabs only; auto-attach child targets recursively
- **Primary tab**: Handshake/diagnostics track a primary tab without detaching others

## Connection Flow

1. Extension checks `http://127.0.0.1:8787/config`
2. Fetches token from `/pair` if auto-pair enabled
3. Connects to `ws://127.0.0.1:<port>/extension`
4. Badge shows ON/OFF status

## Status Fields (Relay /status)

- `extensionConnected`: Extension WebSocket connected to relay.
- `extensionHandshakeComplete`: Handshake finished (preferred readiness signal).
- `cdpConnected`: Active `/cdp` client connected (false until a tool/CLI attaches).
- `pairingRequired`: Relay requires pairing token (auto-pair should satisfy).

## Constraints

| Never | Why |
|-------|-----|
| Hardcode relay URL | Use config from popup |
| Log tokens/tab content | Security requirement |
| Non-local endpoints | Localhost only |

## Build

```bash
npm run extension:build    # tsc -p extension/tsconfig.json
npm run extension:sync     # Sync version from package.json
npm run extension:pack     # Create .zip for release
```

## Testing

Extension tests use Chrome mocks in `tests/`. Build before validating changes.
