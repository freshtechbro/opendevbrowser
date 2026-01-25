# Multi-Client Extension Control - Implementation Plan

**Version:** 2.0
**Date:** 2026-01-19
**Status:** Ready for Implementation

## Overview

Replace single CDP client enforcement with concurrent multi-client support, enabling multiple AI agents or tools to share a single extension relay connection with event broadcasting.

### Current State
- **Single CDP client only** — Second connection rejected at line 96 of `relay-server.ts`
- **FIFO queue** in hub daemon — Exclusive lease model
- **Session routing** already supports multi-tab via `sessionId`
- **Protocol** has `sessionId`, lacks `clientId`

### Target State
- **Multiple concurrent CDP clients** — Server-assigned `clientId` for each
- **Response routing** — CDP responses routed to originating client
- **Event broadcasting** — CDP events broadcast to all connected clients
- **Optional observer mode** — Read-only clients for monitoring (future enhancement)

---

## Research Findings

### Chrome CDP Multi-Client Support

| Source | Finding |
|--------|---------|
| Chrome DevTools Protocol docs | Multi-client supported since **Chrome 63 (2017)** |
| crmux (sidorares/crmux) | JSON-RPC ID translation: local→remote ranges, events broadcast to all |
| chrome-remote-multiplex | **Obsolete** — Chrome native support makes it unnecessary |
| Chrome DevTools MCP (2025) | AI agents can connect to active browser sessions |

**Key Insight**: Chrome already supports multiple CDP clients natively. The single-client restriction is **our code's choice** at lines 94-98.

### crmux Implementation Pattern

**ID Translation Algorithm** ([source](https://github.com/sidorares/crmux)):
```javascript
// Local-to-remote ID mapping with bidirectional translation
var lastId = 0;
var localIdToRemote = { [local]: { client: ws, id: remote } };

// Client → Upstream: Replace local ID with remote ID
upstream.params.localId++;
var local = upstream.params.localId;
var remote = msgObj.id;
msgObj.id = local;
localIdToRemote[local] = { client: ws, id: remote };

// Upstream → Client: Restore original ID
var idMap = localIdToRemote[msgObj.id];
delete localIdToRemote[msgObj.id];
msgObj.id = idMap.id;
idMap.client.send(JSON.stringify(msgObj));
```

**Event Broadcast Pattern**:
```javascript
// Events (no ID field) broadcast to all clients
if (!msgObj.id) {
  clients.forEach(function(s) {
    s.send(message);
  });
}
```

### Industry WebSocket Patterns

| Pattern | Source | Usage |
|---------|--------|-------|
| `Map<string, WebSocket>` | soketi, rxdb, insomnia, medplum | Standard client tracking |
| `wss.clients.forEach()` | Vite, Farm, webpack-dev-server | Broadcast to all |
| `pendingRequests = new Map()` | VS Code, Next.js MCP, Vite | Request→response correlation |

### JSON-RPC Multiplexing Patterns

**ID Scoping Strategies**:
| Strategy | Description | Use Case |
|----------|-------------|----------|
| Per-Client Scoping | ID uniqueness per connection | MCP servers, VS Code LSP |
| Hierarchical IDs | `sessionId_requestId` composite | Session isolation |
| Client-Generated UUIDs | Random IDs from clients | Collision-free |

**MCP Pattern** (from TypeScript SDK):
```typescript
// Per-client request/response tracking
const responseCallbacks = new Map<string, ResponseCallback>();
const pendingRequests = new Map<RequestId, { resolve, reject, method }>();

function completeRequest(requestId: string, result: any): void {
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pending.resolve(result);
    pendingRequests.delete(requestId);
  }
}
```

### Dev Server Broadcast Patterns (Vite, Farm, webpack-dev-server)

All three major dev servers use identical broadcast-all pattern:

**Vite/Farm Pattern**:
```typescript
send(payload: HotPayload) {
  const stringified = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {  // Connection OPEN
      client.send(stringified);
    }
  });
}
```

**Key Finding**: None implement selective messaging — simple broadcast-all is the standard.

### Codebase Map Patterns (Consistency Guide)

From analysis of 10 existing Maps in OpenDevBrowser:

| Pattern | Example |
|---------|---------|
| Add | `this.map.set(key, value)` |
| Get | `const value = map.get(key); if (!value) throw Error(...)` |
| Remove | `this.map.delete(key)` |
| Iterate | `Array.from(map.values())` or `for (const [k, v] of map)` |
| Cleanup | Multiple `.delete()` calls or `.clear()` for bulk |

**Recommendation**: Follow `session-store.ts` pattern for `cdpClients`.

---

## Key Decisions

1. **Protocol extension**: Add optional `clientId` field (server-assigned, never client-supplied)
2. **Backward compatible**: Clients without `clientId` still work (server assigns internally)
3. **Event broadcasting**: All CDP events broadcast to all connected clients (industry standard)
4. **Response routing**: Responses routed only to the client that sent the command via `pendingCommands` Map
5. **Command ID scoping**: Per-client command ID tracking using `pendingCommands: Map<id, clientId>`
6. **No controller/observer in v1**: Simple concurrent model first; roles added later if needed
7. **No ID translation needed**: Unlike crmux, we route at relay level, not rewrite IDs

---

## Task 1 — Extend Protocol Types

### Reasoning
The protocol needs `clientId` to identify which client sent a command and should receive its response. Server-assigned to prevent spoofing.

### What to do
Add optional `clientId` field to `RelayCommand`, `RelayEvent`, and `RelayResponse` types.

### How
1. Open `src/relay/protocol.ts`
2. Add `clientId?: string;` to `RelayCommand` type
3. Add `clientId?: string;` to `RelayEvent` type
4. Add `clientId?: string;` to `RelayResponse` type
5. Add new `ClientInfo` type for internal tracking

### Files impacted
- `src/relay/protocol.ts`

### Code Changes

```typescript
// src/relay/protocol.ts

export type RelayCommand = {
  id: string | number;
  method: "forwardCDPCommand";
  params: {
    method: string;
    params?: unknown;
    sessionId?: string;
  };
  clientId?: string;  // ADD: Server-assigned client identifier
};

export type RelayEvent = {
  method: "forwardCDPEvent";
  params: {
    method: string;
    params?: unknown;
    sessionId?: string;
  };
  clientId?: string;  // ADD: Included in broadcasts for client filtering
};

export type RelayResponse = {
  id: string | number;
  result?: unknown;
  error?: { message: string };
  sessionId?: string;
  clientId?: string;  // ADD: Echoed back to identify response recipient
};

// ADD: New type for internal client tracking
export type CdpClientInfo = {
  clientId: string;
  connectedAt: number;
  lastActivity: number;
  commandCount: number;
};
```

### End goal
Protocol types support `clientId` for multi-client routing.

### Acceptance criteria
- [ ] `RelayCommand` has optional `clientId` field
- [ ] `RelayEvent` has optional `clientId` field
- [ ] `RelayResponse` has optional `clientId` field
- [ ] `CdpClientInfo` type exported
- [ ] TypeScript compiles without errors

---

## Task 2 — Add CDP Client Map and Remove Single-Client Enforcement

### Reasoning
The current single `cdpSocket` variable and rejection logic must be replaced with a `Map<clientId, WebSocket>` to support multiple clients.

### What to do
Replace `private cdpSocket: WebSocket | null` with a client map and remove the single-client rejection code.

### How
1. Open `src/relay/relay-server.ts`
2. Add new type `CdpClient` for socket + metadata
3. Replace `cdpSocket` with `cdpClients: Map<string, CdpClient>`
4. Remove rejection logic at lines 95-98
5. Add `generateClientId()` helper
6. Update `cdpWss.on("connection")` to:
   - Generate unique `clientId`
   - Store in `cdpClients` map
   - Track connection metadata
7. Update socket close handler to remove from map

### Files impacted
- `src/relay/relay-server.ts`

### Code Changes

```typescript
// src/relay/relay-server.ts

// ADD after line 17 (after ExtensionInfo type):
type CdpClient = {
  socket: WebSocket;
  clientId: string;
  connectedAt: number;
  lastActivity: number;
  commandCount: number;
};

// CHANGE line 48:
// FROM:
private cdpSocket: WebSocket | null = null;
// TO:
private cdpClients = new Map<string, CdpClient>();
private clientIdCounter = 0;

// ADD helper method after line 57:
private generateClientId(): string {
  return `client_${++this.clientIdCounter}_${Date.now().toString(36)}`;
}

// REPLACE cdpWss connection handler (lines 94-108):
this.cdpWss.on("connection", (socket: WebSocket) => {
  const clientId = this.generateClientId();
  const client: CdpClient = {
    socket,
    clientId,
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    commandCount: 0
  };
  this.cdpClients.set(clientId, client);
  
  // Send clientId to the connected client
  this.sendJson(socket, { type: "connected", clientId });
  
  socket.on("message", (data: WebSocket.RawData) => {
    client.lastActivity = Date.now();
    client.commandCount++;
    this.handleCdpMessage(data, clientId);
  });
  
  socket.on("close", () => {
    this.cdpClients.delete(clientId);
  });
});
```

### End goal
Multiple CDP clients can connect simultaneously, each tracked by unique `clientId`.

### Acceptance criteria
- [ ] `cdpClients` Map replaces `cdpSocket`
- [ ] No rejection of second CDP client
- [ ] Each client receives unique `clientId` on connect
- [ ] Client removed from map on disconnect
- [ ] TypeScript compiles without errors

---

## Task 3 — Update RelayStatus for Multi-Client

### Reasoning
The `status()` method and `RelayStatus` type report single-client state. Update to reflect multi-client reality.

### What to do
Update `RelayStatus` type and `status()` method to report client count and client list.

### How
1. Update `RelayStatus` type to add `cdpClientCount` and `cdpClients` array
2. Update `status()` method to populate new fields
3. Keep `cdpConnected` as boolean for backward compatibility (true if any client connected)

### Files impacted
- `src/relay/relay-server.ts`

### Code Changes

```typescript
// src/relay/relay-server.ts

// UPDATE RelayStatus type (lines 20-31):
export type RelayStatus = {
  running: boolean;
  url?: string;
  port?: number;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;  // Keep for backward compat: true if any client connected
  cdpClientCount: number; // ADD: Number of connected CDP clients
  cdpClients: Array<{     // ADD: Connected client details
    clientId: string;
    connectedAt: number;
    lastActivity: number;
    commandCount: number;
  }>;
  pairingRequired: boolean;
  instanceId: string;
  extension?: ExtensionInfo;
  epoch: number;
};

// UPDATE status() method (lines 260-273):
status(): RelayStatus {
  const clients = Array.from(this.cdpClients.values()).map(c => ({
    clientId: c.clientId,
    connectedAt: c.connectedAt,
    lastActivity: c.lastActivity,
    commandCount: c.commandCount
  }));
  
  return {
    running: this.running,
    url: this.baseUrl || undefined,
    port: this.port ?? undefined,
    extensionConnected: Boolean(this.extensionSocket),
    extensionHandshakeComplete: this.extensionHandshakeComplete,
    cdpConnected: this.cdpClients.size > 0,
    cdpClientCount: this.cdpClients.size,
    cdpClients: clients,
    pairingRequired: Boolean(this.pairingToken),
    instanceId: this.instanceId,
    extension: this.extensionInfo ?? undefined,
    epoch: this.epoch
  };
}
```

### End goal
Status endpoint reports multi-client state accurately.

### Acceptance criteria
- [ ] `RelayStatus.cdpClientCount` reports connected client count
- [ ] `RelayStatus.cdpClients` array contains client details
- [ ] `cdpConnected` is `true` when at least one client connected
- [ ] HTTP `/status` endpoint reflects new fields
- [ ] TypeScript compiles without errors

---

## Task 4 — Update CDP Message Handling for Multi-Client

### Reasoning
CDP commands must be routed from specific clients, and responses must be returned only to the originating client.

### What to do
Update `handleCdpMessage()` to accept `clientId` parameter and route responses correctly.

### How
1. Add `clientId` parameter to `handleCdpMessage()`
2. Include `clientId` in relay commands to extension
3. Store pending command→client mapping for response routing
4. Update response handler to route by `clientId`

### Files impacted
- `src/relay/relay-server.ts`

### Code Changes

```typescript
// src/relay/relay-server.ts

// ADD after cdpClients declaration:
private pendingCommands = new Map<string | number, string>(); // commandId → clientId

// UPDATE handleCdpMessage signature (line 480):
// FROM:
private handleCdpMessage(data: WebSocket.RawData): void {
// TO:
private handleCdpMessage(data: WebSocket.RawData, clientId: string): void {

// UPDATE handleCdpMessage body:
private handleCdpMessage(data: WebSocket.RawData, clientId: string): void {
  const message = parseJson(data);
  if (!isRecord(message)) {
    return;
  }

  const id = message.id;
  const method = message.method;
  if ((typeof id !== "string" && typeof id !== "number") || typeof method !== "string") {
    return;
  }

  const client = this.cdpClients.get(clientId);
  if (!client) {
    return; // Client disconnected
  }

  if (!this.extensionSocket) {
    this.sendJson(client.socket, {
      id,
      error: { message: "Extension not connected to relay" },
      clientId
    } satisfies RelayResponse);
    return;
  }

  if (!this.isCommandAllowed(method)) {
    this.logSecurityEvent("command_blocked", { method, clientId });
    this.sendJson(client.socket, {
      id,
      error: { message: `CDP command '${method}' not in allowlist` },
      clientId
    } satisfies RelayResponse);
    return;
  }

  // Track which client sent this command
  this.pendingCommands.set(id, clientId);

  const relayCommand: RelayCommand = {
    id,
    method: "forwardCDPCommand",
    params: {
      method,
      params: message.params,
      sessionId: typeof message.sessionId === "string" ? message.sessionId : undefined
    },
    clientId // Include for extension-side tracking (optional)
  };

  this.sendJson(this.extensionSocket, relayCommand);
}
```

### End goal
CDP commands tracked by client, responses routed to originating client only.

### Acceptance criteria
- [ ] `handleCdpMessage` accepts `clientId` parameter
- [ ] `pendingCommands` map tracks command→client relationship
- [ ] Error responses sent only to originating client
- [ ] TypeScript compiles without errors

---

## Task 5 — Update Extension Message Handling for Response Routing and Event Broadcasting

### Reasoning
Extension responses must be routed to the specific client that sent the command. Events must be broadcast to all connected clients.

### What to do
Update `handleExtensionMessage()` to:
1. Route responses to the originating client using `pendingCommands` map
2. Broadcast events to all connected CDP clients

### How
1. Add `broadcastToClients()` helper method
2. Update response routing to look up client from `pendingCommands`
3. Update event handling to broadcast to all clients

### Files impacted
- `src/relay/relay-server.ts`

### Code Changes

```typescript
// src/relay/relay-server.ts

// ADD helper method after sendJson():
private broadcastToClients(payload: unknown): void {
  for (const client of this.cdpClients.values()) {
    this.sendJson(client.socket, payload);
  }
}

// UPDATE handleExtensionMessage (lines 522-585):
private handleExtensionMessage(data: WebSocket.RawData): void {
  const message = parseJson(data);
  if (!isRecord(message)) {
    return;
  }

  // Handshake handling (unchanged)
  if (isHandshake(message)) {
    if (!this.isPairingTokenValid(message)) {
      this.logSecurityEvent("handshake_failed", { reason: "invalid_token", tabId: message.payload.tabId });
      this.extensionInfo = null;
      this.extensionSocket?.close(1008, "Invalid pairing token");
      return;
    }
    if (this.extensionSocket) {
      this.extensionHandshakeComplete = true;
    }
    this.extensionInfo = {
      tabId: message.payload.tabId,
      url: message.payload.url,
      title: message.payload.title,
      groupId: message.payload.groupId
    };
    if (this.extensionSocket && this.port !== null) {
      const ack: RelayHandshakeAck = {
        type: "handshakeAck",
        payload: {
          instanceId: this.instanceId,
          relayPort: this.port,
          pairingRequired: Boolean(this.pairingToken),
          epoch: this.epoch
        }
      };
      this.sendJson(this.extensionSocket, ack);
    }
    return;
  }

  // Event handling: BROADCAST to all clients
  if (message.method === "forwardCDPEvent" && isRecord(message.params)) {
    const params = message.params as RelayEvent["params"];
    const event: Record<string, unknown> = {
      method: params.method,
      params: params.params ?? {}
    };
    if (params.sessionId) {
      event.sessionId = params.sessionId;
    }
    // CHANGED: Broadcast to all clients instead of single socket
    this.broadcastToClients(event);
    return;
  }

  // Response handling: ROUTE to originating client only
  if (typeof message.id === "string" || typeof message.id === "number") {
    const clientId = this.pendingCommands.get(message.id);
    this.pendingCommands.delete(message.id);
    
    const response: Record<string, unknown> = { id: message.id };
    if (typeof message.result !== "undefined") {
      response.result = message.result;
    }
    if (message.error) {
      response.error = message.error;
    }
    if (typeof message.sessionId === "string") {
      response.sessionId = message.sessionId;
    }
    if (clientId) {
      response.clientId = clientId;
    }
    
    // Route to specific client, or broadcast if clientId unknown (fallback)
    if (clientId) {
      const client = this.cdpClients.get(clientId);
      if (client) {
        this.sendJson(client.socket, response);
      }
    } else {
      // Fallback: broadcast response (shouldn't happen normally)
      this.broadcastToClients(response);
    }
  }
}
```

### End goal
Responses routed to originating client; events broadcast to all clients.

### Acceptance criteria
- [ ] `broadcastToClients()` method sends to all connected CDP clients
- [ ] CDP events broadcast to all clients
- [ ] CDP responses routed only to originating client via `pendingCommands` lookup
- [ ] `clientId` included in responses for client-side filtering
- [ ] TypeScript compiles without errors

---

## Task 6 — Update stop() and Cleanup

### Reasoning
The `stop()` method must close all CDP clients, not just one.

### What to do
Update `stop()` to iterate over `cdpClients` map and close all sockets.

### How
1. Update `stop()` to close all CDP client sockets
2. Clear `cdpClients` map
3. Clear `pendingCommands` map

### Files impacted
- `src/relay/relay-server.ts`

### Code Changes

```typescript
// src/relay/relay-server.ts

// UPDATE stop() method (lines 233-258):
stop(): void {
  this.running = false;
  this.baseUrl = null;
  this.port = null;
  this.extensionInfo = null;
  this.extensionHandshakeComplete = false;
  this.stopDiscoveryServer();

  if (this.extensionSocket) {
    this.extensionSocket.close(1000, "Relay stopped");
    this.extensionSocket = null;
  }

  // CHANGED: Close all CDP clients
  for (const client of this.cdpClients.values()) {
    client.socket.close(1000, "Relay stopped");
  }
  this.cdpClients.clear();
  this.pendingCommands.clear();

  this.extensionWss?.close();
  this.cdpWss?.close();
  this.server?.close();

  this.extensionWss = null;
  this.cdpWss = null;
  this.server = null;
}
```

### End goal
Clean shutdown closes all CDP client connections.

### Acceptance criteria
- [ ] `stop()` closes all CDP client sockets
- [ ] `cdpClients` map cleared on stop
- [ ] `pendingCommands` map cleared on stop
- [ ] No memory leaks from dangling references

---

## Task 7 — Update Extension Disconnect Handler

### Reasoning
When the extension disconnects, all CDP clients should be notified and disconnected.

### What to do
Update extension socket close handler to notify and close all CDP clients.

### How
1. Update extension socket close handler (lines 82-91)
2. Send error message to each CDP client before closing
3. Clear maps

### Files impacted
- `src/relay/relay-server.ts`

### Code Changes

```typescript
// src/relay/relay-server.ts

// UPDATE extension socket close handler (lines 82-91):
socket.on("close", () => {
  if (this.extensionSocket === socket) {
    this.extensionSocket = null;
    this.extensionInfo = null;
    this.extensionHandshakeComplete = false;
  }
  
  // CHANGED: Notify and close all CDP clients
  for (const client of this.cdpClients.values()) {
    this.sendJson(client.socket, {
      error: { message: "Extension disconnected from relay" }
    });
    client.socket.close(1011, "Extension disconnected");
  }
  this.cdpClients.clear();
  this.pendingCommands.clear();
});
```

### End goal
Extension disconnect gracefully terminates all CDP client connections with notification.

### Acceptance criteria
- [ ] All CDP clients receive error notification on extension disconnect
- [ ] All CDP client sockets closed with code 1011
- [ ] Maps cleared after disconnect

---

## Task 8 — Add Configuration Options

### Reasoning
Multi-client behavior should be configurable: max clients, enable/disable, etc.

### What to do
Add config options for multi-client behavior.

### How
1. Add `relay` section to config schema
2. Add `maxCdpClients` option (default: 10)
3. Add `multiClient` boolean (default: true for new installs)
4. Apply limits in relay server

### Files impacted
- `src/config.ts`
- `src/relay/relay-server.ts`

### Code Changes

```typescript
// src/config.ts

// ADD new schema after securitySchema (around line 104):
const relaySchema = z.object({
  maxCdpClients: z.number().int().min(1).max(100).default(10),
  multiClient: z.boolean().default(true)
}).default({});

// UPDATE configSchema (add after line 176):
relay: relaySchema.default({}),

// UPDATE OpenDevBrowserConfig type (add after line 71):
relay: {
  maxCdpClients: number;
  multiClient: boolean;
};
```

```typescript
// src/relay/relay-server.ts

// ADD to RelayServerOptions type:
type RelayServerOptions = {
  discoveryPort?: number;
  maxCdpClients?: number;
  multiClient?: boolean;
};

// ADD to constructor:
private readonly maxCdpClients: number;
private readonly multiClientEnabled: boolean;

constructor(options: RelayServerOptions = {}) {
  this.configuredDiscoveryPort = options.discoveryPort ?? DEFAULT_DISCOVERY_PORT;
  this.maxCdpClients = options.maxCdpClients ?? 10;
  this.multiClientEnabled = options.multiClient ?? true;
}

// ADD to cdpWss connection handler (at start):
if (!this.multiClientEnabled && this.cdpClients.size > 0) {
  socket.close(1008, "Only one CDP client supported (multiClient disabled)");
  return;
}
if (this.cdpClients.size >= this.maxCdpClients) {
  socket.close(1008, `Maximum CDP clients (${this.maxCdpClients}) reached`);
  return;
}
```

### End goal
Multi-client behavior is configurable via config file.

### Acceptance criteria
- [ ] `relay.maxCdpClients` config option works
- [ ] `relay.multiClient` can disable multi-client mode
- [ ] Connections rejected when limit reached with clear error
- [ ] Backward compatible: existing configs work without changes

---

## Task 9 — Update Tests

### Reasoning
All behavior changes require test coverage.

### What to do
Add comprehensive tests for multi-client behavior.

### How
1. Create `tests/relay-multi-client.test.ts`
2. Test multiple client connections
3. Test response routing
4. Test event broadcasting
5. Test client limits
6. Test cleanup on disconnect

### Files impacted
- `tests/relay-multi-client.test.ts` (new file)
- `tests/relay-server.test.ts` (update existing tests)

### Test Cases

```typescript
// tests/relay-multi-client.test.ts

describe("RelayServer multi-client", () => {
  it("accepts multiple CDP client connections", async () => { ... });
  it("assigns unique clientId to each client", async () => { ... });
  it("routes responses to originating client only", async () => { ... });
  it("broadcasts events to all connected clients", async () => { ... });
  it("removes client from map on disconnect", async () => { ... });
  it("rejects connections when maxCdpClients reached", async () => { ... });
  it("rejects second client when multiClient disabled", async () => { ... });
  it("notifies all clients when extension disconnects", async () => { ... });
  it("status() reports correct client count", async () => { ... });
  it("cleans up pendingCommands on client disconnect", async () => { ... });
});
```

### End goal
Full test coverage for multi-client functionality.

### Acceptance criteria
- [ ] All multi-client tests pass
- [ ] Coverage ≥95% maintained
- [ ] No regressions in existing tests

---

## Task 10 — Update Documentation

### Reasoning
Users and contributors need to understand the new multi-client capabilities.

### What to do
Update documentation to reflect multi-client support.

### How
1. Update `docs/ARCHITECTURE.md` with multi-client diagram
2. Update `README.md` feature list
3. Update `docs/CLI.md` with new status fields
4. Add migration notes for existing users

### Files impacted
- `docs/ARCHITECTURE.md`
- `README.md`
- `docs/CLI.md`
- `AGENTS.md`

### End goal
Documentation accurately reflects multi-client capabilities.

### Acceptance criteria
- [ ] Architecture docs show multi-client data flow
- [ ] README mentions multi-client support
- [ ] CLI docs show new status fields
- [ ] Migration notes for config changes

---

## File-by-File Implementation Sequence

1. `src/relay/protocol.ts` — Task 1 (add clientId types)
2. `src/config.ts` — Task 8 (add relay config schema)
3. `src/relay/relay-server.ts` — Tasks 2, 3, 4, 5, 6, 7, 8 (core changes)
4. `tests/relay-multi-client.test.ts` — Task 9 (new test file)
5. `tests/relay-server.test.ts` — Task 9 (update existing)
6. `docs/ARCHITECTURE.md` — Task 10
7. `README.md` — Task 10
8. `docs/CLI.md` — Task 10
9. `AGENTS.md` — Task 10

---

## Dependencies to Add

None required. Implementation uses existing WebSocket and Map primitives.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Command ID collisions between clients | Use `pendingCommands` map with compound key if needed |
| Memory leak from pending commands | Clean up on client disconnect; add TTL for stale entries |
| Race conditions | Single-threaded Node.js; Map operations are atomic |
| Backward compatibility | `multiClient: true` default; old clients work without changes |
| Extension protocol changes | `clientId` is optional; extension can ignore it |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-19 | Initial plan based on research and Oracle recommendations |
