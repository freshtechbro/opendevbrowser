# Relay Config Discovery

Plan to add a fixed local discovery endpoint so the extension can auto-detect the relay port and pairing requirement.

---

## Overview

### Scope
- Add a discovery endpoint that exposes relay port and pairing-required flag.
- Update the extension Auto-Pair flow to fetch config, then fetch token from the relay port.
- Add tests for the new endpoint and behavior.
- Update README manual/auto-pair guidance.

### Key decisions
- Discovery endpoint returns relay port and pairing-required flag only (no token).
- Endpoint is localhost-only and restricted to chrome-extension origins.

---

## Task 1 — Add discovery endpoint to relay server

### Reasoning
The extension needs a stable place to learn the relay port without manual entry.

### What to do
Expose a `/config` endpoint on the relay server and start a fixed-port discovery server when needed.

### How
1. Add a discovery port constant (default 8787) and optional override for tests.
2. Implement `/config` handling on the relay server request handler.
3. Start a discovery-only HTTP server on the fixed port when relay runs on a different port.
4. Restrict access to chrome-extension origins; return `{ relayPort, pairingRequired }`.

### Files impacted
- `src/relay/relay-server.ts`

### End goal
Relay can return port and pairing-required info on a stable localhost endpoint.

### Acceptance criteria
- [ ] `/config` returns `{ relayPort, pairingRequired }` with extension origin
- [ ] Non-extension origins are rejected
- [ ] Discovery server starts when relay port differs from discovery port

---

## Task 2 — Update extension Auto-Pair to fetch config

### Reasoning
Auto-Pair currently assumes the relay port is already known; it must discover it.

### What to do
Fetch discovery config before fetching the token and update stored relay port.

### How
1. Add a discovery port constant to the extension settings.
2. Implement `fetchRelayConfig()` and validate payload.
3. In Auto-Pair flow, fetch config, update relay port, and fetch token from the discovered port.
4. Skip token fetch when `pairingRequired` is false.

### Files impacted
- `extension/src/relay-settings.ts`
- `extension/src/popup.tsx`

### End goal
Auto-Pair works without manual port entry.

### Acceptance criteria
- [ ] Auto-Pair updates relay port from discovery endpoint
- [ ] Token fetch uses discovered port
- [ ] No tokens are logged

---

## Task 3 — Add tests for discovery endpoint

### Reasoning
New behavior must be covered to maintain coverage targets and prevent regressions.

### What to do
Extend relay server tests to cover `/config` and discovery server behavior.

### How
1. Add tests for `/config` on relay port with extension origin.
2. Add tests for discovery server response using a dynamic discovery port.
3. Add tests for rejecting non-extension origins.

### Files impacted
- `tests/relay-server.test.ts`

### End goal
Discovery endpoint is tested and coverage preserved.

### Acceptance criteria
- [ ] Tests assert response shape and origin restriction
- [ ] Tests pass without port conflicts

---

## Task 4 — Update README manual/auto-pair guidance

### Reasoning
Documentation must match the new auto-discovery behavior and correct paths.

### What to do
Document discovery behavior and correct extension load paths.

### How
1. Update Auto-Pair section to describe discovery step.
2. Confirm manual setup paths and token guidance.

### Files impacted
- `README.md`

### End goal
README reflects accurate auto-pair behavior and install paths.

### Acceptance criteria
- [ ] Auto-Pair description matches implementation
- [ ] Manual setup paths are accurate

---

## File-by-file implementation sequence

1. `src/relay/relay-server.ts` — Task 1
2. `extension/src/relay-settings.ts` — Task 2
3. `extension/src/popup.tsx` — Task 2
4. `tests/relay-server.test.ts` — Task 3
5. `README.md` — Task 4

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| None | N/A | N/A |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-02 | Initial plan |
