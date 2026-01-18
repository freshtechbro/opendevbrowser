# Relay Hub Daemon Plan

Establish a single hub daemon (single `/cdp` client) so multiple OpenCode plugin instances reliably share one extension/relay. This plan hardens discovery, binding, and handshake reliability while keeping the relay protocol unchanged.

---

## Overview

### Scope
- Use the existing daemon as the single owner of the relay + extension connection.
- All plugin instances route extension-based actions through the daemon (RPC).
- Maintain a strict single `/cdp` client to the relay; avoid protocol changes.

### Key decisions
- Hub daemon is per-user and the only `/cdp` client; other instances are clients over daemon RPC.
- Plugin auto-starts the hub if missing; otherwise it reuses the existing hub.
- Binding is explicit via a daemon-level handshake (lease/owner token), not relay protocol changes.
- Extension auto-pair flow is hardened with instanceId validation and relayPort self-heal.
- Binding lease policy: TTL 60s, renew every 20s, allow 2 missed renewals before release (with small jitter on renew).
- Preferred hub routing: a daemon proxy `Manager` interface (remote BrowserManager) rather than a separate tool layer.
- Binding identity strategy: per-client UUID persisted locally and sent with every daemon command; daemon returns a bindingId on bind and requires it for extension-based commands.
- ClientId storage: per-user cache file at `~/.cache/opendevbrowser/client.json` (auto-created with mode 0600).

---

## Task 1 — Hub discovery and reuse

### Reasoning
Multiple plugin instances currently attempt to start their own relay, leading to port contention and instanceId mismatch. A shared hub avoids competing relays and ensures a single, stable `/cdp` client.

### What to do
Implement hub discovery/reuse so plugin instances connect to an existing daemon (hub) instead of starting their own relay.

### How
1. Add a “hub mode” decision in `createOpenDevBrowserCore` or higher-level plugin bootstrap:
   - If daemon metadata exists and daemon `/status` is reachable, use a remote manager instead of starting a local relay.
   - If daemon is not available, start one (or keep current behavior, depending on config).
2. Extend daemon `/status` to return a hub instanceId and relay instanceId for diagnostics.
3. Update the plugin/tool wiring to route extension sessions via daemon when hub mode is active:
   - Implement a `RemoteManager` that mirrors `BrowserManager` methods and calls the daemon.
   - Keep tools unchanged; swap `manager` in deps based on hub mode.

### Files impacted
- `src/index.ts`
- `src/core/bootstrap.ts`
- `src/cli/daemon.ts`
- `src/cli/client.ts`
- `src/tools/deps.ts` (or new remote manager wiring)

### End goal
Plugin instances reliably locate and reuse a running hub daemon without starting competing relays.

### Acceptance criteria
- [ ] When a hub daemon exists, a new plugin instance does not attempt to bind the relay port.
- [ ] `/status` exposes hub + relay instance identifiers for diagnostics.
- [ ] Plugin tool calls route through the hub when available.

---

## Task 2 — Daemon handshake + binding/lease protocol

### Reasoning
Multiple clients need reliable access to a single extension/relay. An explicit daemon-level handshake with a binding lease prevents race conditions and ensures stable ownership until release.

### What to do
Add a daemon-level binding flow (`relay.bind` / `relay.release`) with a lease token and TTL.

### How
1. Implement new daemon commands:
   - `relay.bind`: accepts `{ clientId }`, returns `{ bindingId, hubInstanceId, relayInstanceId, expiresAt }`
   - `relay.renew`: accepts `{ clientId, bindingId }`, extends TTL
   - `relay.release`: accepts `{ clientId, bindingId }`, releases the binding
2. Persist and reuse `clientId`:
   - Generate once and store in `~/.cache/opendevbrowser/client.json`.
   - Load on startup and include with every daemon command.
2. Enforce binding for extension-based commands:
   - If a binding exists, only the binding owner can initiate or control extension sessions.
   - Other clients receive a “relay busy” error with diagnostic data.
3. Add a heartbeat/renew mechanism:
   - `relay.renew` extends TTL to keep the binding alive.
4. Ensure binding is cleared on daemon shutdown or session close.

### Files impacted
- `src/cli/daemon-commands.ts`
- `src/cli/daemon.ts`
- `src/core/types.ts` (if new manager interface types are required)
- `src/browser/browser-manager.ts` (if binding check hooks are needed)

### End goal
Only one client controls extension relay at a time, with explicit ownership and predictable handoff.

### Acceptance criteria
- [ ] A second client cannot steal the relay while a binding is active.
- [ ] Binding expires or is released cleanly on shutdown or client disconnect.
- [ ] Daemon reports binding owner in `/status`.

---

## Task 3 — Reliable relay discovery + wait strategy (timeouts/backoff)

### Reasoning
Short waits and single-port polling lead to flaky outcomes. Centralizing wait logic in the hub ensures consistent, debounced readiness checks.

### What to do
Create a shared, robust wait strategy in the daemon for extension readiness and relay reachability.

### How
1. Create a helper that waits for `extensionHandshakeComplete` (not just `extensionConnected`) with:
   - Exponential backoff (min 250ms, max 2s)
   - Max timeout (configurable; enforce sensible minimum, e.g. 3000ms)
2. Use observed `/status` (HTTP) if local relay status is absent.
3. Ensure wait logic is used by all extension-based commands (launch/connect).

### Files impacted
- `src/cli/daemon-commands.ts`
- `src/tools/launch.ts` (if tools still need local fallback)
- `src/relay/relay-server.ts` (optional: include handshakeComplete in status)

### End goal
Extension readiness is detected consistently with fewer false negatives.

### Acceptance criteria
- [ ] `waitTimeoutMs` < 3000 is clamped or clearly warned.
- [ ] `extensionHandshakeComplete` is the primary readiness signal.
- [ ] Readiness check tolerates brief relay restarts without failure.

---

## Task 4 — Extension auto-pair hardening + reconnect reliability

### Reasoning
The extension can pair against a different relay instance or stop reconnecting after brief outages, causing mismatches and long-term disconnects.

### What to do
Validate instanceId when pairing and improve reconnect resilience.

### How
1. In extension auto-pair flow:
   - Parse `instanceId` from `/config` and `/pair`.
   - Reject pairing if instanceIds differ.
2. After handshake ack:
   - Persist `relayPort` from `handshakeAck.payload.relayPort` into storage.
3. Increase reconnect robustness:
   - Raise reconnect attempt cap or convert to periodic retry while autoConnect is enabled.

### Files impacted
- `extension/src/background.ts`
- `extension/src/services/ConnectionManager.ts`
- `extension/src/services/RelayClient.ts` (optional: richer close diagnostics)

### End goal
Extension reconnects reliably to the correct relay instance and self-heals stale config.

### Acceptance criteria
- [ ] Extension refuses to pair when `/config` and `/pair` instanceIds differ.
- [ ] Extension persists relayPort from handshake ack.
- [ ] Extension reconnects beyond brief outages without manual intervention.

---

## Task 5 — Diagnostics and troubleshooting updates

### Reasoning
Clear diagnostics are critical for multi-instance reliability and supportability.

### What to do
Expose hub/relay identity in status and document common mismatch scenarios.

### How
1. Add hub + relay instanceId to daemon `/status`.
2. Include binding owner and expiry in diagnostics.
3. Document mismatch resolution steps.

### Files impacted
- `src/cli/daemon.ts`
- `docs/TROUBLESHOOTING.md` (or new doc)

### End goal
Users can see which relay and hub they are connected to, and resolve mismatches quickly.

### Acceptance criteria
- [ ] `/status` surfaces hub + relay instance identifiers.
- [ ] Troubleshooting doc covers multi-instance mismatch scenarios.

---

## File-by-file implementation sequence

1. `src/cli/daemon.ts` — Add hub identity + binding state in `/status`.
2. `src/cli/daemon-commands.ts` — Add `relay.bind`/`relay.release`/`relay.renew` and enforce ownership.
3. `src/core/bootstrap.ts` / `src/index.ts` — Hub discovery/reuse and routing policy.
4. `src/tools/launch.ts` — Use hub wait strategy or rely on daemon for extension sessions.
5. `extension/src/background.ts` — InstanceId validation in auto-pair.
6. `extension/src/services/ConnectionManager.ts` — Persist relayPort from handshake ack; improve reconnect.
7. `docs/TROUBLESHOOTING.md` — Add multi-instance guidance.

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| (none) |  |  |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-17 | Initial hub-daemon plan |
| 1.1 | 2026-01-17 | Added preferred routing + binding identity strategy |
