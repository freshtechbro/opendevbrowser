# Audit Fix Plan

Remediation plan for security, reliability, CLI hardening, and coverage uplift based on the January 2026 audit.

---

## Overview

### Scope
- Relay security hardening (HTTP endpoints, Origin policy, token validation, rate limiting)
- Extension reliability (popup messaging, tab lifecycle, CDP routing, connect dedupe)
- CLI and daemon robustness (timeouts, argument validation, conflict handling)
- Test coverage uplift to meet >97% branch target
- Minor config API cleanup

### Key decisions
- Allow loopback no-Origin requests for `/config`, `/status`, `/pair` to support MV3 extension fetch contexts that omit Origin; still reject non-extension origins.
- Introduce path-specific Origin enforcement for WebSocket upgrades.
- Add targeted tests for uncovered branches instead of broad test rewrites.

---

## Task 1 — Relay HTTP Security Hardening

### Reasoning
Relay HTTP endpoints must remain reachable by the MV3 extension while respecting browser PNA/CORS requirements and avoiding cross-origin leakage.

### What to do
Allow extension origins and loopback no-Origin requests (including `Origin: null`) for `/config`, `/status`, and `/pair`, while rejecting non-extension origins and supporting PNA preflights.

### How
1. Permit extension origins and loopback no-Origin requests for `/config`, `/status`, `/pair`.
2. Update preflight handlers to allow `Authorization` and `Access-Control-Allow-Private-Network`.
3. Update relay client fetches to include `Authorization` when available (optional, not required for loopback).
4. Ensure error responses are explicit (403/429) and logged without leaking secrets.

### Files impacted
- `src/relay/relay-server.ts`
- `src/browser/browser-manager.ts`

### End goal
Relay HTTP endpoints respond to trusted extension origins or loopback requests, with explicit CORS/PNA behavior and clear errors.

### Acceptance criteria
- [x] Non-extension origins are rejected for `/config`, `/status`, `/pair`.
- [x] Loopback requests with no Origin (including `Origin: null`) succeed.
- [x] Preflights include `Access-Control-Allow-Private-Network` when requested.

---

## Task 2 — Relay WebSocket Origin Enforcement and Token Validation

### Reasoning
WebSocket upgrade checks are permissive for missing/`null` Origin and do not validate pairing token types robustly, risking unauthorized access or DoS.

### What to do
Enforce path-specific Origin rules and harden token validation.

### How
1. For `/extension` upgrades: require `chrome-extension://` origin and optionally allowlist extension IDs.
2. For `/cdp` upgrades: allow no-Origin only if token is valid and remote address is loopback.
3. Reject `origin === "null"` for `/extension`.
4. Validate pairing token type before calling `Buffer.from`.

### Files impacted
- `src/relay/relay-server.ts`

### End goal
Relay WebSocket upgrades enforce correct origins and handle malformed tokens safely.

### Acceptance criteria
- [x] `/extension` rejects missing/`null` Origin.
- [x] `/cdp` requires valid token when pairing is enabled.
- [x] Invalid token types do not throw and result in auth failure.

---

## Task 3 — Relay HTTP Rate Limiting

### Reasoning
HTTP endpoints are not rate limited while WS upgrades are, which enables local DoS via `/pair`/`/config`/`/status`.

### What to do
Add simple IP-based rate limiting for relay HTTP endpoints.

### How
1. Reuse or extend the existing handshake attempts map to track HTTP request counts.
2. Apply rate limiting to `/pair`, `/config`, and `/status`.
3. Return 429 with minimal body and log a security event.

### Files impacted
- `src/relay/relay-server.ts`

### End goal
HTTP endpoints are protected against abuse.

### Acceptance criteria
- [x] Repeated requests beyond threshold return 429.
- [x] Rate limit resets after the configured window.

---

## Task 4 — Extension Reliability: Popup and Tab Lifecycle

### Reasoning
Popup messaging ignores `lastError` and tab lifecycle commands may fail silently, causing inconsistent UI state and stuck sessions.

### What to do
Improve popup error handling and surface tab errors in CDP routing.

### How
1. Add `lastError` handling in popup sendMessage and guard response handling.
2. In `TabManager`, reject on `lastError` for close/activate calls.
3. Wrap `handleCloseTarget` and `handleActivateTarget` in try/catch and respond with errors.

### Files impacted
- `extension/src/popup.tsx`
- `extension/src/services/TabManager.ts`
- `extension/src/services/cdp-router-commands.ts`

### End goal
Popup and tab lifecycle operations fail gracefully with correct error propagation.

### Acceptance criteria
- [x] Popup does not crash when background is unavailable.
- [x] CDP close/activate responses return error on failure.

---

## Task 5 — Extension Reliability: Target Creation and Target Lists

### Reasoning
`Target.createTarget` can leak tabs on attach failure and `Target.getTargets`/`Target.getTargetInfo` omit child targets, breaking expectations.

### What to do
Ensure target creation cleanup and include child targets in target listings.

### How
1. Track created tab IDs and close/detach on error in `handleCreateTarget`.
2. Persist child target info in `TargetSessionMap` and include in list/get.
3. Adjust `CDPRouter` to use merged target list and child lookups.

### Files impacted
- `extension/src/services/cdp-router-commands.ts`
- `extension/src/services/TargetSessionMap.ts`
- `extension/src/services/CDPRouter.ts`

### End goal
Target management is consistent across root and child sessions.

### Acceptance criteria
- [x] Failed target creation does not leak tabs.
- [x] `Target.getTargets` includes child targets.
- [x] `Target.getTargetInfo` resolves child targets.

---

## Task 6 — Extension Reliability: Connect Dedupe and Handshake Validation

### Reasoning
Concurrent connects can race and malformed handshake acks are only handled via timeout, reducing diagnosability.

### What to do
Add in-flight connect dedupe and strict handshake validation.

### How
1. Add an in-flight `connectPromise` guard in `ConnectionManager`.
2. Add an in-flight `connectPromise` guard in `RelayClient`.
3. Validate handshake ack shape and reject immediately when invalid.

### Files impacted
- `extension/src/services/ConnectionManager.ts`
- `extension/src/services/RelayClient.ts`

### End goal
Connection attempts are serialized and handshake errors are explicit.

### Acceptance criteria
- [x] Concurrent `connect()` calls return the same promise.
- [x] Invalid ack fails fast with a clear error.

---

## Task 7 — CLI and Daemon Robustness

### Reasoning
CLI/daemon fetches can hang without timeouts; argument validation allows invalid values; conflicting flags are not rejected.

### What to do
Add timeouts and stronger validation for CLI commands and daemon calls.

### How
1. Add `AbortController` timeouts to daemon fetches (`status`, `command`, `stop`).
2. Validate `--port` and other numeric flags; reject `NaN` and out-of-range values.
3. Reject conflicting install/skills flags in `parseArgs`.
4. Tighten `optionalNumber` usage in daemon commands (invalid values should error, not default).

### Files impacted
- `src/cli/daemon-client.ts`
- `src/cli/daemon-status.ts`
- `src/cli/commands/serve.ts`
- `src/cli/args.ts`
- `src/cli/daemon-commands.ts`

### End goal
CLI/daemon calls fail fast with clear errors and predictable parsing.

### Acceptance criteria
- [x] CLI requests time out with helpful messages.
- [x] Invalid ports/flags are rejected with usage errors.
- [x] Conflicting flags produce a single error and exit.

---

## Task 8 — Coverage Uplift to >97% Branches

### Reasoning
Current branch coverage is ~96.37%, below the stated >97% requirement.

### What to do
Add targeted tests for uncovered branches and raise coverage thresholds.

### How
1. Identify branches listed in coverage output and add focused tests.
2. Raise coverage thresholds in `vitest.config.ts` to 97 for branches/lines/functions/statements.
3. Re-run `npm run test` and verify the threshold.

### Files impacted
- `tests/*.test.ts`
- `vitest.config.ts`

### End goal
Coverage meets or exceeds 97% across thresholds.

### Acceptance criteria
- [x] `npm run test` passes with thresholds set to 97.
- [x] Branch coverage >=97%.

---

## Task 9 — Config API Cleanup

### Reasoning
`resolveConfig` ignores its input, which is confusing and error-prone.

### What to do
Either implement input override or remove the unused parameter.

### How
1. Decide intended behavior (merge overrides vs. strict global).
2. Implement or remove parameter.
3. Update any call sites and tests accordingly.

### Files impacted
- `src/config.ts`
- `tests/config*.test.ts`

### End goal
Config API is explicit and non-deceptive.

### Acceptance criteria
- [x] `resolveConfig` behavior matches documentation.
- [x] Tests cover the intended behavior.

---

## File-by-file implementation sequence
1. `src/relay/relay-server.ts` — Tasks 1–3
2. `src/browser/browser-manager.ts` — Task 1 (auth headers)
3. `extension/src/popup.tsx` — Task 4
4. `extension/src/services/TabManager.ts` — Task 4
5. `extension/src/services/cdp-router-commands.ts` — Tasks 4–5
6. `extension/src/services/TargetSessionMap.ts` — Task 5
7. `extension/src/services/CDPRouter.ts` — Task 5
8. `extension/src/services/RelayClient.ts` — Task 6
9. `extension/src/services/ConnectionManager.ts` — Task 6
10. `src/cli/daemon-client.ts` — Task 7
11. `src/cli/daemon-status.ts` — Task 7
12. `src/cli/commands/serve.ts` — Task 7
13. `src/cli/args.ts` — Task 7
14. `src/cli/daemon-commands.ts` — Task 7
15. `tests/*.test.ts` — Task 8
16. `vitest.config.ts` — Task 8
17. `src/config.ts` — Task 9

---

## Dependencies to add
| Package | Version | Purpose |
|---------|---------|---------|
| None | N/A | No new dependencies expected |

---

## Version history
| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-29 | Initial remediation plan |
