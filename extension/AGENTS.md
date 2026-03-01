# extension/ — Agent Guidelines

Chrome extension for relay mode. Extends root `AGENTS.md`.

## Architecture

```
extension/
├── src/
│   ├── background.ts    # Connection orchestration, message routing, annotation bridge
│   ├── annotate-content.ts # In-page annotation UI + capture
│   ├── annotate-content.css # Annotation UI styles
│   ├── popup.tsx        # Settings UI (port, token, auto-connect)
│   ├── ops/             # Ops runtime, session store, snapshot/dom bridges
│   └── services/        # Relay/CDP attach, message forwarding
│       ├── ConnectionManager.ts  # Relay lifecycle + primary tab tracking
│       ├── RelayClient.ts         # WS handshake, health, message framing
│       ├── CDPRouter.ts           # Flat-session routing + Target lifecycle
│       ├── TargetSessionMap.ts    # Root/child session mapping
│       ├── TabManager.ts          # Tab discovery + active tracking
│       ├── NativePortManager.ts   # Native host bridge (optional)
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
- **Multi-client CDP**: `CDPRouter` multiplexes commands/events for multiple `/cdp` clients via `TargetSessionMap`.
- **Annotation relay**: `/annotation` channel forwards annotation commands/events to `background.ts`.
- **Ops relay**: `/ops` channel routes high-level ops commands through `OpsRuntime`.

## Connection Flow

1. Extension checks `http://127.0.0.1:8787/config`
2. Fetches token from `/pair` if auto-pair enabled
3. Connects to `ws://127.0.0.1:<port>/extension`
4. Badge shows dot status (`green` connected, `red` disconnected)
5. Ops relay (when requested by CLI/tools) connects to `ws://127.0.0.1:<port>/ops`
6. Annotation relay (when requested) connects to `ws://127.0.0.1:<port>/annotation`

## Status Fields (Relay /status)

- `extensionConnected`: Extension WebSocket connected to relay.
- `extensionHandshakeComplete`: Handshake finished (preferred readiness signal).
- `opsConnected`: Active `/ops` client connected (false until an ops session connects).
- `cdpConnected`: Active `/cdp` client connected (false until a tool/CLI attaches).
- `annotationConnected`: Annotation channel connected to relay.
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
node scripts/chrome-store-compliance-check.mjs  # Verify store/compliance invariants
```

## Testing

Extension tests use Chrome mocks in `tests/`. Build before validating changes.
