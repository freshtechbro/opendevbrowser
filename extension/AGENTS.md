# extension/ — Agent Guidelines

Chrome extension for relay mode. Extends root `AGENTS.md`.

## Architecture

```
extension/
├── src/
│   ├── background.ts    # Connection orchestration, message routing, annotation bridge
│   ├── annotate-content.ts # In-page annotation UI + capture
│   ├── annotate-content.css # Annotation UI styles
│   ├── canvas/          # Canvas relay runtime, editor state model
│   ├── canvas-page.ts   # Canvas page bridge/content script
│   ├── logging.ts       # Extension logging helpers
│   ├── popup.tsx        # Settings UI (port, token, auto-connect)
│   ├── relay-settings.ts # Persisted relay configuration
│   ├── types.ts         # Relay, ops, canvas protocol types
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
- **Single-client relay `/cdp`**: the relay accepts one `/cdp` websocket at a time; inside that client, `CDPRouter` still multiplexes flat-session commands/events via `TargetSessionMap`.
- **Annotation relay**: `/annotation` channel forwards annotation commands/events to `background.ts`, including one-off `store_agent_payload` send requests and `fetch_stored` retrieval.
- **Ops relay**: `/ops` channel routes high-level ops commands through `OpsRuntime`.
- **Canvas relay**: `/canvas` channel routes design-tab state, overlay sync, and preview/selection updates through `CanvasRuntime`.
- **Canvas design runtime**: `extension/src/canvas/` owns extension-hosted design-tab state, patch application, overlay sync, viewport fit, and editor-side feedback handling.
- **Canvas payload shape**: design-tab runtime expects normalized canvas documents plus additive session-summary metadata such as `availableInventoryCount`, `catalogKitIds`, `availableStarterCount`, applied starter fields, framework or plugin capability summaries, and token state required for collection or mode authoring, alias editing, bindings, and usage inspection; keep extension-side parsing compatibility-first when core contract fields expand.
- **Preview boundary**: projected `canvas_html` remains the default compatibility path; `bound_app_runtime` only succeeds when the binding opts in and the target app exposes the required instrumentation.

## Connection Flow

1. Extension checks `http://127.0.0.1:8787/config`
2. Fetches token from `/pair` if auto-pair enabled
3. Connects to `ws://127.0.0.1:<port>/extension`
4. Badge shows dot status (`green` connected, `red` disconnected)
5. Ops relay (when requested by CLI/tools) connects to `ws://127.0.0.1:<port>/ops`
6. Canvas relay (when requested) connects to `ws://127.0.0.1:<port>/canvas`
7. Annotation relay (when requested) connects to `ws://127.0.0.1:<port>/annotation`

Annotation send rules:
- Popup, canvas, and in-page `Send` actions must try `store_agent_payload` first.
- If scoped delivery fails, keep the extension-local sanitized fallback path intact and report the stored-only receipt truthfully.

## Status Fields (Relay /status)

- `extensionConnected`: Extension WebSocket connected to relay.
- `extensionHandshakeComplete`: Handshake finished (preferred readiness signal).
- `opsConnected`: Active `/ops` client connected (false until an ops session connects).
- `canvasConnected`: Active `/canvas` client connected (false until a canvas session connects).
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

## Layered AGENTS

- `extension/src/canvas/AGENTS.md` — extension-hosted design-tab runtime
- `extension/src/ops/AGENTS.md` — ops runtime and ownership/backpressure
- `extension/src/services/AGENTS.md` — relay/CDP routing and session mapping
