# Local AGENTS.md (src/relay)

Applies to `src/relay/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- Defines relay protocol types shared by plugin runtime and extension.
- Relay connections remain local and honor configurable `relayPort`/`relayToken`.
- RelayServer implements security hardening: timing-safe token comparison, Origin validation, rate limiting, CDP allowlist, and security event logging.

## Responsibilities
- Define relay protocol types and message shapes.
- Keep handshake metadata stable across versions.
- Enforce authentication security (timing-safe comparison, rate limiting).
- Validate WebSocket Origin headers to prevent CSWSH attacks.
- Log security events without exposing sensitive data.

## Safety & Constraints
- Avoid breaking changes to protocol types without coordinated updates.
- Do not hardcode relay endpoints; use config.
- Use `crypto.timingSafeEqual()` for all token comparisons (never `===`).
- Validate Origin header on WebSocket upgrade (allow only `chrome-extension://` origins).
- Rate limit handshake attempts (5 per minute per IP by default).
- Optional CDP command allowlist restricts which commands can be forwarded.

## Testing
- Add/adjust Vitest coverage for protocol typing utilities.

## Folder Structure
```
src/relay/
```
