# Multi-Tab Session Mapping Plan

**Status:** Implemented (2026-01-19)

Implement full multi-tab session mapping in extension relay mode so Playwright `connectOverCDP` can create and manage pages via `context.newPage()` with CDP-like Target lifecycle behavior.

---

## Overview

### Scope
- Extension relay mode only (Chrome extension + relay server).
- CDP client: Playwright `connectOverCDP`.
- Implement Target lifecycle mapping: create/close/activate, auto-attach per tab, per-session routing.

### Key decisions
- Keep relay protocol unchanged; implement Target lifecycle and session mapping in `extension/src/services/CDPRouter.ts`.
- Flat sessions only (Chrome 125+ baseline). Use `chrome.debugger` DebuggerSession `sessionId`; do not use `Target.sendMessageToTarget`.
- Discovery list limited to top-level tabs; auto-attach related targets recursively without surfacing workers/OOPIF in target lists.
- Track per-tab session/target mappings with `targetId -> sessionId` and `sessionId -> { tabId, targetId, kind }`.
- Define a single "primary tab" for relay handshake/reporting; refresh on activation or close.
- Add a small helper module to keep CDPRouter under 500 LOC.

---

## Task 1 — Introduce a tab/session mapping helper with root vs child modeling

### Reasoning
Multi-tab requires stable mapping between `tabId`, `targetId`, `sessionId`, and target info. With flat sessions, we also need to map child `sessionId`s for direct DebuggerSession routing.

### What to do
Create a helper module that owns the map structures and exposes operations for create/attach/detach/lookups, including session kind.

### How
1. Add a new file `extension/src/services/TargetSessionMap.ts` with:
   - Types for `TargetRecord` and `SessionRecord`.
   - `SessionRecord.kind: "root" | "child"` and `SessionRecord.targetId`.
   - `SessionRecord.sessionId` (flat session id from `Target.attachToTarget` or `Target.attachedToTarget`).
   - Optional `SessionRecord.debuggerSession` for `{ tabId, sessionId }` routing.
   - Maps:
     - `tabId -> TargetRecord`
     - `sessionId -> SessionRecord`
     - `targetId -> sessionId`
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
- [x] No `any` or `@ts-ignore`.
- [x] Root vs child session kind is tracked.

---

## Task 2 — Expand TabManager to support lifecycle operations

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

## Task 3 — Implement multi-tab Target lifecycle + session routing in CDPRouter

### Reasoning
Playwright expects CDP Target lifecycle support and per-session routing; current CDPRouter only supports a single root session and assumes a single attached tab. With flat sessions (Chrome 125+), child targets must be routed via DebuggerSession `sessionId`.

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

## Task 4 — Define primary tab semantics + handshake refresh

### Reasoning
The relay handshake currently represents a single tab. With multi-tab, we need a consistent "primary" tab for status and for reconnection without disconnecting all tabs.

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

## Task 5 — Listener lifecycle and dedupe for multi-attach

### Reasoning
Multiple debuggees can cause duplicate event listeners or premature listener removal.

### What to do
Ensure chrome.debugger listeners are registered once and removed only when all debuggees are detached.

### How
1. Track listener registration state (e.g., a boolean or attach count).
2. Add listeners on first attach; remove only after last detach.
3. Route events by `debuggee.tabId` and ignore events for unknown tabs.

### Files impacted
- `extension/src/services/CDPRouter.ts`

### End goal
No duplicated events or missing events due to listener churn.

### Acceptance criteria
- [x] Multi-tab attach does not register duplicate listeners.
- [x] Detaching one tab does not drop events for other tabs.

---

## Task 6 — Update ConnectionManager teardown for multi-tab cleanup

### Reasoning
Disconnect should detach all debuggees and clear mappings, not just the original active tab.

### What to do
Extend CDPRouter to detach all known debuggees on disconnect and update ConnectionManager to call the new API.

### How
1. Add `detachAll()` to CDPRouter to detach all tracked tabs and clear session mappings.
2. Update `ConnectionManager.disconnect()` to call `cdp.detachAll()` instead of `cdp.detach()` when connected.

### Files impacted
- `extension/src/services/CDPRouter.ts`
- `extension/src/services/ConnectionManager.ts`

### End goal
Disconnect cleans up all attached tabs safely.

### Acceptance criteria
- [x] Disconnect detaches all attached debuggees.
- [x] No orphaned session mappings remain after disconnect.

---

## Task 7 — Tests and chrome mock extensions

### Reasoning
Multi-tab behavior needs regression coverage to ensure Playwright compatibility and prevent routing regressions.

### What to do
Expand chrome mocks and add tests for flat-session routing, recursive auto-attach, and primary tab semantics.

### How
1. Extend `tests/extension-chrome-mock.ts` to support:
   - `tabs.create`, `tabs.remove`, `tabs.update`
   - Multi-tab storage and lookup
2. Add tests in `tests/extension-cdp-router.test.ts`:
   - `Target.createTarget` returns targetId and emits attach event
   - Flat session routing for root vs child (`sessionId` routing)
   - `Target.closeTarget` emits detach/destroy
   - `Target.activateTarget` updates primary tab and triggers handshake refresh
   - Listener dedupe when attaching multiple tabs

### Files impacted
- `tests/extension-chrome-mock.ts`
- `tests/extension-cdp-router.test.ts`

### End goal
Automated coverage for flat-session Target lifecycle and routing behaviors.

### Acceptance criteria
- [x] Tests pass for create/close/activate flows.
- [x] Flat-session routing validated for root + child.
- [x] Recursive auto-attach validated for child sessions.
- [x] Primary tab changes do not drop other sessions.

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

1. `extension/src/services/TargetSessionMap.ts` — Task 1 (new file)
2. `extension/src/services/TabManager.ts` — Task 2
3. `extension/src/services/CDPRouter.ts` — Tasks 3, 5, 6
4. `extension/src/services/ConnectionManager.ts` — Tasks 4, 6
5. `tests/extension-chrome-mock.ts` — Task 7
6. `tests/extension-cdp-router.test.ts` — Task 7

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| None | N/A | Use existing APIs |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.2 | 2026-01-19 | Flat sessions only (Chrome 125+), top-level discovery, and safeguards |
| 1.1 | 2026-01-19 | Added root/child session modeling, primary tab semantics, and auto-attach propagation |
| 1.0 | 2026-01-19 | Initial multi-tab session mapping plan |
