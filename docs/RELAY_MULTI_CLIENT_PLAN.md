# Relay Hub + Multi-Tab Unified Plan

**Status:** Implemented (2026-01-19)

Unified plan for a seamless extension workflow: extension connects, CLI/tool works, multi-tab sessions are routed correctly, and the hub is the single source of truth. This merges the hub-only FIFO lease model with multi-tab CDP session mapping.

---

## Overview

### Scope
- Hub-only relay ownership (no local relay fallback when hub enabled).
- Single CDP client (held by hub daemon).
- FIFO queue + lease model for multi-client usage.
- Extension relay mode with multi-tab Target lifecycle support.
- Auto-heal discovery and stale-metadata recovery.

### Key decisions
- Single hub daemon is the sole relay owner and CDP client.
- FIFO lease model (no concurrent control) with defaults:
  - bind TTL: 60s
  - renew interval: 20s
  - grace: 2 missed renewals
  - wait max: 30s
  - ensureHub: 2 attempts / 2s total
- No local relay fallback when hub mode is enabled.
- daemon.json is cache; /status is source of truth.
- Flat sessions only (Chrome 125+ baseline). Use `chrome.debugger` DebuggerSession `sessionId`; do not use `Target.sendMessageToTarget`.
- Discovery list limited to top-level tabs; auto-attach related targets recursively without surfacing workers/OOPIF in target lists.
- Multi-tab session mapping uses explicit root vs child sessions and routes child sessions via flat `sessionId`.
- Primary tab is explicit and drives relay handshake/status; update on activation and close.

---

## Task 1 — Durable hub discovery config

### Reasoning
Without a stable port/token, daemon.json loss causes stale discovery and instance mismatch.

### What to do
Persist daemon port and token in config to enable discovery even if daemon.json is missing.

### How
1. Extend config schema to include daemonPort and daemonToken (generated once).
2. On startup, if missing, generate and persist with 0600 permissions.
3. Update docs to mention daemon port/token fields.

### Files impacted
- `src/config.ts`
- `src/cli/daemon.ts`
- `docs/EXTENSION.md`

### End goal
Clients can discover hub even if daemon.json is missing.

### Acceptance criteria
- [x] Config includes durable daemon port/token fields.
- [x] daemon.json deletion does not break discovery.

---

## Task 2 — ensureHub + dynamic rebinding

### Reasoning
RemoteRelay/RemoteManager are chosen once at init and can become stale if daemon restarts.

### What to do
Implement ensureHub() with bounded retries and rebind remote manager/relay per command when stale.

### How
1. Add ensureHub() helper with bounded retry/time budget (2 attempts/2s).
2. Use daemon.json -> ping; fallback to config port/token -> ping; then start hub.
3. If hub found, rebind RemoteManager/RemoteRelay and refresh status.
4. If hub enabled, never fallback to local relay.

### Files impacted
- `src/index.ts`
- `src/cli/daemon-client.ts`
- `src/cli/daemon-status.ts`

### End goal
All extension-mode commands recover from missing daemon.json or daemon restarts without restart.

### Acceptance criteria
- [x] ensureHub never loops indefinitely.
- [x] stale daemon.json is auto-healed.
- [x] hub-only path used when hub enabled.

---

## Task 3 — FIFO lease queue in hub daemon

### Reasoning
Multiple clients need deterministic access without port conflicts or race failures.

### What to do
Add FIFO queueing to binding/lease operations and enforce lease TTL/renew behavior.

### How
1. Extend daemon state with a FIFO queue (clientId, requestedAt, timeoutAt).
2. relay.bind grants immediately if free, else enqueues.
3. relay.wait returns when client reaches front or times out.
4. Cleanup: remove expired queue entries; release lease on missed renews.

### Files impacted
- `src/cli/daemon-state.ts`
- `src/cli/daemon-commands.ts`
- `tests/daemon-e2e.test.ts`

### End goal
Multi-client requests queue reliably with automatic cleanup.

### Acceptance criteria
- [x] FIFO ordering is preserved.
- [x] dead clients do not block queue.
- [x] leases expire on missed renewals.

---

## Task 4 — Stale cache reset + instanceId coherence

### Reasoning
RemoteRelay currently caches stale instanceIds and masks daemon failure.

### What to do
Reset cached relay status on refresh failure and ensure instanceId is always authoritative.

### How
1. In RemoteRelay.refresh(), on failure, set status to empty and clear cdpUrl.
2. In launch tool, on possible_mismatch, force ensureHub + refresh and retry once.
3. Add relay status fields to daemon.json on successful /status.

### Files impacted
- `src/cli/remote-relay.ts`
- `src/tools/launch.ts`
- `src/cli/daemon.ts`

### End goal
No stale instanceId comparisons; mismatches trigger auto-heal.

### Acceptance criteria
- [x] Cached relay status is cleared on refresh failure.
- [x] launch retries once after ensureHub.
- [x] instanceId mismatch no longer persists.

---

## Task 5 — Extension auto-heal and relay port persistence

### Reasoning
Extension must keep connecting to the hub relay without manual intervention.

### What to do
Persist relayPort from handshake ack and auto-reconnect with backoff.

### How
1. Store relayPort from handshake ack in extension storage.
2. On reconnect, always use stored port; if mismatch, re-pair.
3. Add diagnostics to surface instanceId mismatches in popup.

### Files impacted
- `extension/src/background.ts`
- `extension/src/services/ConnectionManager.ts`
- `extension/src/services/RelayClient.ts`

### End goal
Extension stays connected to hub relay and self-heals after restarts.

### Acceptance criteria
- [x] Extension reconnects after hub restart.
- [x] Relay port persists across reloads.

---

## Task 6 — Introduce TargetSessionMap with root vs child modeling

### Reasoning
Multi-tab requires stable mapping between `tabId`, `targetId`, `sessionId`, and target info. With flat sessions, we also need to map child `sessionId`s to DebuggerSession identifiers to route commands directly.

### What to do
Create a helper module that owns the map structures and exposes operations for create/attach/detach/lookups, including session kind.

### How
1. Add a new file `extension/src/services/TargetSessionMap.ts` with:
   - Types for `TargetRecord` and `SessionRecord`.
   - `SessionRecord.kind: "root" | "child"` and `SessionRecord.targetId`.
   - `SessionRecord.sessionId` (flat session id from `Target.attachToTarget` or `Target.attachedToTarget`).
   - Optional `SessionRecord.debuggerSession` for `{ tabId, sessionId }` routing.
   - Maps: `tabId -> TargetRecord`, `sessionId -> SessionRecord`, `targetId -> sessionId`.
2. Provide methods:
   - `registerRootTab(tabId, targetInfo, sessionId)`
   - `registerChildSession(tabId, targetInfo, sessionId)`
   - `getBySessionId`, `getByTargetId`, `getByTabId`
   - `removeByTabId`, `removeByTargetId`, `removeBySessionId`
   - `listTargetInfos`
3. Ensure all methods are safe and return `null` on missing entries.

### Files impacted
- `extension/src/services/TargetSessionMap.ts` (new file)

### End goal
Single source of truth for root and child session relationships used by CDPRouter (flat-session routing).

### Acceptance criteria
- [x] Helper exports minimal, typed API for mapping.
- [x] Root vs child session kind is tracked.

---

## Task 7 — Expand TabManager to support lifecycle operations

### Reasoning
Multi-tab mapping requires creating, closing, and activating tabs from CDP Target commands.

### What to do
Add `createTab`, `closeTab`, and `activateTab` helpers to `TabManager`.

### How
1. Add `createTab(url?: string, active?: boolean): Promise<chrome.tabs.Tab>` using `chrome.tabs.create`.
2. Add `closeTab(tabId: number): Promise<void>` using `chrome.tabs.remove`.
3. Add `activateTab(tabId: number): Promise<chrome.tabs.Tab | null>` using `chrome.tabs.update({ active: true })`.
4. Keep existing `getTab`/`getActiveTab` methods unchanged.

### Files impacted
- `extension/src/services/TabManager.ts`

### End goal
TabManager can execute Target lifecycle operations needed by Playwright.

### Acceptance criteria
- [x] `createTab` returns the created tab record.
- [x] `closeTab` resolves even if the tab is already closed.
- [x] `activateTab` returns the updated tab (or null if not found).

---

## Task 8 — Multi-tab Target lifecycle + session routing in CDPRouter

### Reasoning
Playwright expects CDP Target lifecycle support and per-session routing; current CDPRouter only supports a single root session and assumes a single attached tab. With flat sessions (Chrome 125+), child targets must be routed via DebuggerSession `sessionId` rather than `Target.sendMessageToTarget`.

### What to do
Replace single-root session handling with per-tab session mapping and implement Target lifecycle commands with explicit root/child routing.

### How
1. Replace `debuggee` with `debuggees: Map<number, chrome.debugger.Debuggee>`.
2. Track `autoAttach` settings (`autoAttach`, `flatten`, `waitForDebuggerOnStart`) and `discoverTargets` state.
3. On initial attach:
   - Register the active tab as a root session in `TargetSessionMap`.
   - If `autoAttach` is enabled, emit `Target.attachedToTarget` for the root session.
4. Handle CDP commands:
   - `Target.createTarget` → `TabManager.createTab`, `chrome.debugger.attach`, register mapping, emit `Target.targetCreated` + `Target.attachedToTarget`, return `targetId`.
   - `Target.closeTarget` → `chrome.debugger.detach`, `TabManager.closeTab`, emit `Target.targetDestroyed` + `Target.detachedFromTarget`, return success.
   - `Target.activateTarget` → `TabManager.activateTab`, update primary tab tracking.
   - `Target.setDiscoverTargets` → store flag and optionally emit `Target.targetCreated` for tracked tabs when enabled.
   - `Target.getTargets`/`Target.getTargetInfo` → return tracked root targets only (tabs only).
   - `Target.attachToTarget` → call `chrome.debugger.sendCommand` with `flatten: true`, record returned `sessionId`, register child session mapping.
5. Propagate auto-attach per debuggee (flat sessions):
   - When `Target.setAutoAttach` is called for the root, store options with `flatten: true`.
   - Apply `Target.setAutoAttach` to each attached debuggee via `chrome.debugger.sendCommand`.
   - When a `Target.attachedToTarget` event arrives for a child session, call `Target.setAutoAttach` recursively on the child DebuggerSession (auto-attach is not recursive).
6. Route session commands (flat sessions):
   - If `sessionId` maps to a root session, send command via `chrome.debugger.sendCommand({ tabId }, ...)`.
   - If `sessionId` maps to a child session, send command via `chrome.debugger.sendCommand({ tabId, sessionId }, ...)`.
   - If `sessionId` is unknown, respond with a routed error and avoid silent drops.
7. Forward events:
   - Use `chrome.debugger.onEvent`’s `source.sessionId` to tag events for child sessions.
   - Do not rely on `Target.receivedMessageFromTarget` (deprecated in flat sessions).
8. On `chrome.debugger.onDetach`, remove mappings and emit `Target.detachedFromTarget`/`Target.targetDestroyed` as needed.

### Files impacted
- `extension/src/services/CDPRouter.ts`
- `extension/src/services/TargetSessionMap.ts` (new file)
- `extension/src/services/TabManager.ts`

### End goal
CDPRouter behaves like a CDP relay across multiple tabs with flat-session routing (Chrome 125+).

### Acceptance criteria
- [x] `Target.createTarget` creates a tab, returns `targetId`, and emits attach events.
- [x] `Target.closeTarget` closes tab and emits detach/destroy events.
- [x] Root sessions route directly; child sessions route via DebuggerSession `sessionId`.
- [x] Events from each tab are tagged with the correct `sessionId` (from `source.sessionId`).

---

## Task 9 — Primary tab semantics + handshake refresh

### Reasoning
The relay handshake currently represents a single tab. With multi-tab, we need a consistent primary tab for status and for reconnection without disconnecting all tabs.

### What to do
Track a primary tab and refresh relay handshake on Target activation or primary close.

### How
1. Add `primaryTabId` tracking in CDPRouter or ConnectionManager.
2. On `Target.activateTarget`, update primary tab and emit a callback or event.
3. On primary tab close/detach, select a fallback (last active or current active tab) and refresh the handshake.
4. Update ConnectionManager to send an updated handshake when primary changes.

### Files impacted
- `extension/src/services/CDPRouter.ts`
- `extension/src/services/ConnectionManager.ts`

### End goal
Primary tab identity is stable and reflected in relay status/handshake without dropping other tabs.

### Acceptance criteria
- [x] Primary tab switches on `Target.activateTarget`.
- [x] Handshake is refreshed when the primary tab changes.
- [x] Closing the primary tab does not disconnect other attached tabs.

---

## Task 10 — Listener lifecycle + multi-tab cleanup

### Reasoning
Multiple debuggees can cause duplicate event listeners or premature listener removal. Disconnect should detach all debuggees.

### What to do
Ensure chrome.debugger listeners are registered once and removed only when all debuggees are detached, and add detachAll.

### How
1. Track listener registration state (e.g., a boolean or attach count).
2. Add listeners on first attach; remove only after last detach.
3. Route events by `debuggee.tabId` and ignore events for unknown tabs.
4. Add `detachAll()` to CDPRouter to detach all tracked tabs and clear mappings.
5. Update `ConnectionManager.disconnect()` to call `cdp.detachAll()` instead of `cdp.detach()` when connected.

### Files impacted
- `extension/src/services/CDPRouter.ts`
- `extension/src/services/ConnectionManager.ts`

### End goal
No duplicated events, and disconnect cleans up all attached tabs safely.

### Acceptance criteria
- [x] Multi-tab attach does not register duplicate listeners.
- [x] Detaching one tab does not drop events for other tabs.
- [x] Disconnect detaches all attached debuggees.

---

## Task 11 — Docs + tests

### Reasoning
We need coverage for hub discovery/queueing and multi-tab routing to prevent regressions and document the hub-only flow.

### What to do
Expand tests and documentation for hub-only queueing and multi-tab routing/primary tab behavior.

### How
1. Update docs to describe hub-only flow and default timeouts.
2. Document queue behavior and typical wait messages.
3. Update extension docs to describe primary tab semantics.
4. Document Chrome 125+ flat-session requirement and top-level discovery scope.
5. Extend `tests/extension-chrome-mock.ts` for multi-tab.
6. Add tests in `tests/extension-cdp-router.test.ts` for flat-session routing, recursive auto-attach, and primary tab.
7. Add a negative test for the Chrome 125+ flat-session gate (unsupported flatten).
8. Add hub tests for ensureHub, FIFO ordering, and lease expiry.

### Files impacted
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/CLI.md`
- `tests/extension-chrome-mock.ts`
- `tests/extension-cdp-router.test.ts`
- `tests/daemon-e2e.test.ts`
- `tests/daemon-commands.integration.test.ts`

### End goal
Docs reflect hub-only + multi-tab behavior and tests prevent regressions.

### Acceptance criteria
- [x] Docs cover hub-only flow, queue behavior, and primary tab semantics.
- [x] Docs note Chrome 125+ flat-session requirement and top-level discovery scope.
- [x] Tests cover daemon.json loss recovery, FIFO queue ordering, and lease expiry.
- [x] Tests cover flat-session routing, primary tab switch, and listener dedupe.

---

## Safeguards for flat-session routing (Playwright compatibility)

### Safeguard 1 — Chrome 125+ capability gate
**Acceptance criteria (code-level)**
- [x] On initial attach, the router attempts `Target.setAutoAttach({ flatten: true })` and fails fast with a clear error if unsupported.
- [x] A user-facing error message indicates Chrome 125+ is required for extension-mode CDP routing.

### Safeguard 2 — Recursive auto-attach
**Acceptance criteria (code-level)**
- [x] When `Target.attachedToTarget` fires, `Target.setAutoAttach` is re-issued on the child DebuggerSession.
- [x] Deeply nested OOPIF/worker targets still attach and emit events with child `sessionId`.

### Safeguard 3 — Session-aware routing
**Acceptance criteria (code-level)**
- [x] Commands with `sessionId` route via `chrome.debugger.sendCommand({ tabId, sessionId }, ...)`.
- [x] Events are forwarded using `source.sessionId` (no `Target.receivedMessageFromTarget` parsing).

### Safeguard 4 — Top-level discovery only
**Acceptance criteria (code-level)**
- [x] `Target.getTargets` returns only tab targets.
- [x] Child targets are still reachable via `Target.attachedToTarget` events.

### Safeguard 5 — Compatibility error handling
**Acceptance criteria (code-level)**
- [x] If a client calls `Target.sendMessageToTarget`, return a clear error (or optional shim).
- [x] Unknown `sessionId` results in a routed error response (no silent drop).

## Test checklist
- [x] Connect over CDP (Playwright-like) and list existing tabs.
- [x] `Target.createTarget` yields `targetId` + `Target.attachedToTarget` with a flat `sessionId`.
- [x] Send a command with child `sessionId` and observe response.
- [x] Validate recursive auto-attach by observing events from nested OOPIF/worker targets.
- [x] Switch primary tab and verify handshake refresh does not detach other tabs.

---

## File-by-file implementation sequence

1. `src/config.ts` — Task 1
2. `src/cli/daemon.ts` — Tasks 1, 4
3. `src/cli/daemon-client.ts` — Task 2
4. `src/index.ts` — Task 2
5. `src/cli/daemon-state.ts` — Task 3
6. `src/cli/daemon-commands.ts` — Tasks 3, 11
7. `src/cli/remote-relay.ts` — Task 4
8. `src/tools/launch.ts` — Task 4
9. `extension/src/services/TargetSessionMap.ts` — Task 6 (new file)
10. `extension/src/services/TabManager.ts` — Task 7
11. `extension/src/services/CDPRouter.ts` — Tasks 8, 9, 10
12. `extension/src/services/ConnectionManager.ts` — Tasks 9, 10
13. `extension/src/background.ts` — Task 5
14. `docs/EXTENSION.md` — Task 11
15. `docs/TROUBLESHOOTING.md` — Task 11
16. `docs/CLI.md` — Task 11
17. `tests/extension-chrome-mock.ts` — Task 11
18. `tests/extension-cdp-router.test.ts` — Task 11
19. `tests/daemon-e2e.test.ts` — Task 11
20. `tests/daemon-commands.integration.test.ts` — Task 11

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| None | N/A | Use existing APIs |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.3 | 2026-01-19 | Added flat-session safeguards and test checklist |
| 1.2 | 2026-01-19 | Flat sessions only (Chrome 125+), top-level discovery only |
| 1.1 | 2026-01-19 | Unified hub FIFO lease plan with multi-tab session mapping |
| 1.0 | 2026-01-19 | Initial hub-only multi-client plan |
