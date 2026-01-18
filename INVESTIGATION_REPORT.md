# Investigation: Multi-Instance Relay Architecture

## Summary

The OpenDevBrowser architecture uses a **single-connection model at every layer**, preventing multiple OpenCode instances from sharing one extension. The solution requires either a **Hub Relay Model** (recommended) or **Extension Multi-Relay Model**.

---

## Current Architecture Deep Dive

### Layer 1: Protocol (protocol.ts)

```typescript
// CDP Messages - NO clientId field
RelayCommand { id, method: "forwardCDPCommand", params: { method, params?, sessionId? } }
RelayResponse { id, result?, error?, sessionId? }
RelayEvent { method: "forwardCDPEvent", params: { method, params?, sessionId? } }

// Extension Handshake - identifies TAB, not client
RelayHandshake { type: "handshake", payload: { tabId, url?, pairingToken? } }
RelayHandshakeAck { type: "handshakeAck", payload: { instanceId, relayPort } }
```

**Key insight**: `sessionId` is for CDP nested targets (iframes, workers), NOT for multi-client routing. No `clientId` infrastructure exists.

### Layer 2: Relay Server (relay-server.ts)

```typescript
// SINGLE connection slots
private extensionSocket: WebSocket | null = null;
private cdpSocket: WebSocket | null = null;

// New extension REPLACES old
if (this.extensionSocket) {
  this.extensionSocket.close(1000, "Replaced by a new extension client");
}
this.extensionSocket = socket;

// New CDP client REJECTED
if (this.cdpSocket) {
  socket.close(1008, "Only one CDP client supported");
  return;
}
```

**Constraint**: Relay accepts exactly ONE extension and ONE CDP client.

### Layer 3: Extension (CDPRouter.ts, ConnectionManager.ts)

```typescript
// SINGLE debuggee (tab)
private debuggee: chrome.debugger.Debuggee | null = null;

// SINGLE relay connection
private relay: RelayClient | null = null;
private relayPort: number = DEFAULT_DISCOVERY_PORT;  // single value
```

**Constraint**: Extension connects to ONE relay and attaches to ONE tab.

### Layer 4: Bootstrap (bootstrap.ts)

```typescript
// Each instance creates OWN relay
const relay = new RelayServer();
await ensureRelay(deps, config);

// On port conflict - just warn, no fallback
if (err.code === 'EADDRINUSE') {
  console.warn("Relay server port is already in use. Extension pairing will be unavailable.");
}
```

**Constraint**: No relay discovery, reuse, or client-mode fallback.

---

## What Happens Today

### Scenario: Two OpenCode Instances

```
Timeline:
─────────────────────────────────────────────────────────────────────
T0: Instance 1 starts
    → Creates RelayServer1 (instanceId: abc123)
    → Binds port 8787 ✓
    → Extension connects to RelayServer1 ✓

T1: Instance 2 starts
    → Creates RelayServer2 (instanceId: xyz789)
    → Tries port 8787 → EADDRINUSE ✗
    → Logs warning, relay NOT started
    → No extension connection possible

T2: Instance 2 runs opendevbrowser_launch
    → Checks deps.relay → null (no relay running)
    → Fetches http://127.0.0.1:8787/status → sees extension connected
    → Instance mismatch detected
    → Returns error: "extension connected to different relay instance"
─────────────────────────────────────────────────────────────────────
```

### Message Flow (Current - Single Client)

```
┌────────────────┐    ┌───────────────┐    ┌───────────────┐    ┌────────┐
│ OpenCode Tool  │───▶│ RelayServer   │───▶│ Extension     │───▶│ Chrome │
│ (CDP Client)   │    │ (ws://.../cdp)│    │ (CDPRouter)   │    │ Tab    │
└────────────────┘    └───────────────┘    └───────────────┘    └────────┘
        │                    │                    │                  │
        │   RelayCommand     │   RelayCommand     │ chrome.debugger  │
        │  {id, method,      │  {id, method,      │   .sendCommand   │
        │   sessionId?}      │   sessionId?}      │                  │
        │◀──────────────────▶│◀──────────────────▶│◀────────────────▶│
        │   RelayResponse    │   RelayResponse    │                  │
        │  {id, result}      │  {id, result}      │                  │
```

---

## Solution Options

### Option A: Hub Relay Model (Recommended)

**Concept**: First instance starts "hub relay", subsequent instances connect as CDP clients to the hub.

```
┌─────────────────┐
│ OpenCode Inst 1 │────┐
│ (CDP Client 1)  │    │
└─────────────────┘    │
                       │    ┌──────────────┐     ┌───────────┐     ┌────────┐
┌─────────────────┐    ├───▶│  Hub Relay   │────▶│ Extension │────▶│ Chrome │
│ OpenCode Inst 2 │────┤    │ (port 8787)  │     │           │     │        │
│ (CDP Client 2)  │    │    └──────────────┘     └───────────┘     └────────┘
└─────────────────┘    │
                       │
┌─────────────────┐    │
│ OpenCode Inst N │────┘
│ (CDP Client N)  │
└─────────────────┘
```

**Required Changes**:

| Component | Change |
|-----------|--------|
| **protocol.ts** | Add `clientId` to CDP messages |
| **relay-server.ts** | Replace `cdpSocket` with `cdpClients: Map<string, WebSocket>` |
| **relay-server.ts** | Route responses by `clientId` |
| **bootstrap.ts** | Try discover → connect as client → else create hub |
| **browser-manager.ts** | Add `connectAsClient()` mode |

**Message Flow (Hub Model)**:

```
┌─────────────────┐
│ Instance 1      │
│ clientId: "A"   │───┐
└─────────────────┘   │    RelayCommand
                      │    {id, clientId:"A",    ┌───────────────┐
┌─────────────────┐   │     method, sessionId}   │   Extension   │
│ Instance 2      │───┼───▶ Hub Relay ──────────▶│   CDPRouter   │
│ clientId: "B"   │   │                          └───────────────┘
└─────────────────┘   │    RelayResponse
                      │    {id, clientId:"A",
┌─────────────────┐   │     result}
│ Instance N      │───┘    ◀──────────────────────────────────────
│ clientId: "N"   │
└─────────────────┘
```

### Option B: Extension Multi-Relay Model

**Concept**: Extension manages multiple relay connections, routes by relay.

```
┌─────────────────┐     ┌───────────────┐
│ OpenCode Inst 1 │────▶│ RelayServer 1 │────┐
│                 │     │ (port 8787)   │    │
└─────────────────┘     └───────────────┘    │    ┌───────────────┐
                                             ├───▶│   Extension   │
┌─────────────────┐     ┌───────────────┐    │    │ (multi-relay) │
│ OpenCode Inst 2 │────▶│ RelayServer 2 │────┘    └───────────────┘
│                 │     │ (port 8788)   │
└─────────────────┘     └───────────────┘
```

**Required Changes**:

| Component | Change |
|-----------|--------|
| **ConnectionManager.ts** | Replace `relay: RelayClient` with `relays: Map<string, RelayClient>` |
| **ConnectionManager.ts** | Add relay discovery and multi-connect logic |
| **CDPRouter.ts** | Route CDP responses to correct relay |
| **background.ts** | Periodic scan for new relays |
| **relay-server.ts** | Each relay uses different port (8787, 8788, ...) |

**Comparison**:

| Aspect | Hub Model | Multi-Relay Model |
|--------|-----------|-------------------|
| Extension changes | None (or minimal) | Significant |
| Relay changes | Significant | Minimal |
| Port management | Single port | Dynamic ports |
| Complexity | Lower | Higher |
| Message routing | In relay | In extension |
| Failure isolation | Hub = SPOF | Per-relay failure |

**Recommendation**: Hub Model - simpler, fewer extension changes, single point of truth.

---

## Implementation Plan: Hub Relay Model

### Phase 1: Protocol Changes

**File: src/relay/protocol.ts**

```typescript
// Add clientId to CDP messages
export interface RelayCommand {
  id: number;
  clientId?: string;  // NEW: identifies which OpenCode instance
  method: "forwardCDPCommand";
  params: { method: string; params?: unknown; sessionId?: string };
}

export interface RelayResponse {
  id: number;
  clientId?: string;  // NEW: route response to correct client
  result?: unknown;
  error?: { code: number; message: string };
  sessionId?: string;
}

// Add client registration message
export interface ClientRegister {
  type: "client_register";
  clientId: string;
}
```

### Phase 2: Multi-Client Relay Server

**File: src/relay/relay-server.ts**

```typescript
// Change from:
private cdpSocket: WebSocket | null = null;

// To:
private cdpClients: Map<string, WebSocket> = new Map();

// CDP connection handler:
this.wss.on("connection", (socket, req) => {
  if (path.startsWith("/cdp")) {
    // Generate or receive clientId
    const clientId = generateClientId();
    this.cdpClients.set(clientId, socket);
    
    // Send registration ack
    socket.send(JSON.stringify({ type: "registered", clientId }));
    
    socket.on("close", () => this.cdpClients.delete(clientId));
  }
});

// Route responses by clientId:
private routeResponse(response: RelayResponse) {
  const client = this.cdpClients.get(response.clientId);
  if (client) {
    client.send(JSON.stringify(response));
  }
}
```

### Phase 3: Relay Discovery + Client Mode

**File: src/core/bootstrap.ts**

```typescript
async function ensureRelay(deps: ToolDeps, config: Config): Promise<void> {
  // 1. Try to discover existing hub relay
  const existingHub = await discoverHubRelay(config.relayPort);
  
  if (existingHub) {
    // 2. Connect as client to existing hub
    deps.relay = null;  // Not running own relay
    deps.hubEndpoint = existingHub;  // Store for tool use
    console.log(`Connected to hub relay at ${existingHub}`);
    return;
  }
  
  // 3. No existing hub - become the hub
  deps.relay = new RelayServer({ isHub: true });
  await deps.relay.start(config.relayPort);
  console.log(`Started hub relay on port ${config.relayPort}`);
}

async function discoverHubRelay(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`);
    const status = await response.json();
    if (status.running && status.isHub) {
      return `ws://127.0.0.1:${status.port}/cdp`;
    }
  } catch {
    // No relay running
  }
  return null;
}
```

### Phase 4: Tool Updates

**File: src/tools/launch.ts**

Update diagnostics and connection logic to:
1. Check if connected as client to hub
2. Use hub endpoint if available
3. Report client mode in status

### Phase 5: Tests

| Test | Description |
|------|-------------|
| `multi-client.test.ts` | Two CDP clients connect, both receive responses |
| `client-disconnect.test.ts` | One client leaves, other continues |
| `hub-discovery.test.ts` | New instance discovers existing hub |
| `hub-takeover.test.ts` | Hub dies, new instance becomes hub |

---

## Open Questions

1. **Hub Election**: When hub (first instance) closes, should another client take over?
   - Option A: Promote existing client to hub (complex)
   - Option B: All clients disconnect, next instance becomes hub (simpler)
   - **Recommendation**: Option B for simplicity

2. **Client Identification**: Use config-based ID or generate per-session?
   - **Recommendation**: Generate per-session (`randomUUID()`)

3. **Tab Sharing**: Can multiple clients share same Chrome tab?
   - Current: One client per session
   - Future: Could add tab routing by sessionId
   - **Recommendation**: Defer - one tab per extension for now

4. **Discovery Protocol**: How do new instances find the hub?
   - Option A: Well-known port (current: 8787)
   - Option B: Discovery file (`~/.opendevbrowser/relay.json`)
   - **Recommendation**: Option A first, add B for robustness

---

## Files Impacted

| File | Phase | Changes |
|------|-------|---------|
| `src/relay/protocol.ts` | 1 | Add `clientId` to messages |
| `src/relay/relay-server.ts` | 2 | Multi-client support |
| `src/core/bootstrap.ts` | 3 | Discovery + client mode |
| `src/browser/browser-manager.ts` | 3 | Connect to hub |
| `src/tools/launch.ts` | 4 | Client mode diagnostics |
| `tests/multi-client.test.ts` | 5 | New test file |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing single-client usage | clientId is optional, backward compatible |
| Hub becomes SPOF | Graceful degradation - clients can retry |
| Message ordering | WebSocket preserves order per connection |
| Token/auth for hub clients | Reuse existing pairingToken mechanism |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-17 | Initial investigation (incorrect - focused on mismatch) |
| 2.0 | 2026-01-17 | Corrected analysis - multi-instance architecture |
| 3.0 | 2026-01-17 | Deep dive - protocol/routing analysis, Hub Model design |
