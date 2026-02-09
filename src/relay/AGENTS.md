# Relay Module

**Scope:** WebSocket relay server, extension communication, security, rate limiting

## Overview

Local WebSocket relay enabling Chrome extension communication. Enforces strict security: timing-safe auth, rate limiting, localhost-only endpoints. Hub mode support for remote relay coordination.

## Structure

```
src/relay/
├── relay-server.ts      # Main server (44KB) - WebSocket management, security
├── relay-endpoints.ts   # URL resolution, endpoint validation
├── protocol.ts          # Message types, codecs
└── relay-types.ts       # Shared type definitions
```

## Key Classes

### RelayServer
- **Multi-channel WebSocket:** extension, cdp, annotation, ops
- **Security:** timingSafeEqual token comparison, rate limiting (5 handshakes/min/IP)
- **Rate limits:**
  - Handshake: 5 attempts per 60s window per IP
  - HTTP: 60 requests per 60s window per IP
  - Annotation payload: 12MB max
  - Annotation timeout: 120s
- **Discovery:** HTTP endpoint on port 8787 (default)

### Protocol Types
- `RelayHandshake` / `RelayHandshakeAck` - Extension pairing
- `RelayCommand` / `RelayResponse` - CDP proxy
- `OpsRequest` / `OpsResponse` - Ops protocol
- `AnnotationRequest` / `AnnotationResponse` - Visual annotations

## Endpoints

| Path | Purpose |
|------|---------|
| `/config` | Discovery, relay URL, token |
| `/pair` | Extension pairing (if required) |
| `/status` | Health, connection state |
| `/extension` | Extension WebSocket |
| `/cdp` | CDP proxy WebSocket |
| `/annotation` | Annotation WebSocket |
| `/ops` | Ops protocol WebSocket |

## Security

- **Token comparison:** `crypto.timingSafeEqual()` (never `===`)
- **Origin validation:** `/extension` requires `chrome-extension://`; `/cdp`, `/ops`, and `/annotation` accept extension origin or loopback requests without `Origin`
- **Hostname normalization:** lowercase before validation
- **Localhost enforcement:** 127.0.0.1, ::1, localhost only
- **Pairing:** Optional token-based pairing for first connect

## Status Fields

```typescript
type RelayStatus = {
  extensionConnected: boolean;        // WebSocket connected
  extensionHandshakeComplete: boolean; // Handshake finished
  cdpConnected: boolean;              // CDP client connected
  annotationConnected: boolean;       // Annotation client connected
  opsConnected: boolean;              // Ops client connected
  pairingRequired: boolean;           // Pairing token needed
}
```

## Hub Mode

When `hub.enabled: true` in config:
- Hub daemon is sole relay owner
- FIFO leases enforced
- No local relay fallback
- Remote relay cache via `RemoteRelay`

## Anti-Patterns

- Never hardcode relay endpoints (use config)
- Never log tokens or pairing secrets
- Never use `===` for token comparison
- Never allow non-local CDP endpoints without explicit config
