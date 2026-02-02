# Extension Ops WebSocket (Full Parity, Internal CDP, No Relay /cdp) — Spec + Plan

This document proposes **Option B (approved)**: a new high‑level operations WebSocket (`/ops`) to control extension mode **without using relay `/cdp`**. The goal is **full CLI/tool parity** with multi‑user, multi‑session reliability, while keeping `/annotation` stable and independent. This is a **spec + implementation plan only** — no code changes yet.

---

## Overview

### Goals
- Provide a **reliable extension‑mode channel** that does **not rely on relay `/cdp`**.
- Achieve **full parity** with the 41 tools and CLI commands.
- Support **multi‑user, multi‑session** concurrency in extension mode.
- Preserve existing managed/CDP modes and current tool outputs.
- Keep `/annotation` independent and unaffected.
- Make **ops the default** for extension mode with an explicit legacy opt‑in.

### Non‑goals
- Removing CDP usage **inside the extension** (we explicitly allow it).
- Changing tool outputs or ref semantics.
- Replacing annotation with ops or sharing its transport.

### Key decisions
- Add a new relay WS endpoint: **`/ops`**.
- CLI/daemon **never** connect to relay `/cdp` in ops mode.
- Extension uses **internal CDP** via `chrome.debugger` for parity‑critical features.
- `/annotation` stays a fully separate channel and code path.
- **Ops is the default** for extension mode; legacy extension mode is **opt‑in**.

---

## Stability Principles (Annotation‑style)

To match annotation stability, `/ops` must follow the same reliability discipline:
- **Dedicated socket**: `/ops` is independent from `/annotation` and `/cdp`.
- **Request/response map**: every command has a requestId + timeout.
- **Backoff + retry**: reconnect with exponential backoff on relay disconnect.
- **Heartbeat**: client/extension ping on interval; missing pong triggers reconnect.
- **Idempotent commands** where feasible (e.g., snapshot, status).
- **Clear errors** for restricted URLs, debugger attach conflicts, and timeouts.
- **Payload caps**: define max message size and chunking for large payloads.

Annotation compatibility guarantee:
- No shared socket, no shared protocol types, no shared request map, no shared state.
- `/annotation` continues to route and function even if `/ops` is unhealthy.

---

## CDP Usage Boundary (Critical)

- **Allowed**: extension uses `chrome.debugger` internally to implement parity‑critical tools.
- **Forbidden**: CLI/daemon uses relay `/cdp` in ops mode.
- **Coexistence policy**:
  - `/ops` owns debugger attachments for tabs it controls.
  - If a tab is already debug‑attached (DevTools open or another debugger), ops returns `cdp_attach_failed` with a clear message.
  - `/cdp` may still exist for other workflows, but must not attach to ops‑owned tabs.

This isolates CLI from relay `/cdp` contention while retaining parity.

Enforcement details:
- Relay tracks `opsOwnedTabIds` per extension connection; `/cdp` attach to an owned tab returns a structured `cdp_attach_blocked` error.
- OpsRuntime releases ownership on session close, tab close, or extension disconnect.

---

## Architecture (Revised)

```
CLI/Daemon
  └─ OpsBrowserManager (new) ── /ops WS ── RelayServer ── Extension OpsRuntime
                                                    ├─ CDP Adapter (chrome.debugger)
                                                    └─ Content Script Bridge
```

### Core components
1) **OpsBrowserManager (daemon)**
- Implements `BrowserManagerLike` by forwarding to `/ops`.
- Keeps tool code unchanged; tool parity is preserved.

2) **OpsRuntime (extension)**
- Executes all BrowserManagerLike methods for a session.
- Uses **CDP Adapter** (via `chrome.debugger`) for snapshot/refs, input, perf, network, console, screenshot.
- Uses **content scripts** for DOM queries and extraction.

3) **OpsSessionStore (extension)**
- `opsSessionId → { tabId, targetId, ownerClientId, refStore, queues, capabilities }`.
- Per‑session command queue and concurrency limits.

4) **Relay /ops**
- Dedicated WS endpoint with client multiplexing.
- Routes ops messages to the extension and back to the correct client.

---

## Implementation Notes (DRY + Injection)

- **Reuse existing CDP plumbing**: `CDPAdapter` should wrap existing `CDPRouter` + `TargetSessionMap` logic to avoid divergent attach/session handling.
- **Content script injection**: use `chrome.scripting.executeScript` with `host_permissions` for `dom_*` and extraction commands; return `restricted_url` for unsupported schemes and record injection failures as `execution_failed`.
- **Script lifecycle**: ensure idempotent injection, and re‑inject on navigation or SW restart if the content script is missing.

## Tool Parity Matrix (All 41 tools)

**Lifecycle / Targets**
- `launch`, `connect`, `disconnect`, `status`
- `targets_list`, `target_use`, `target_new`, `target_close`
- `page`, `list`, `close`

**Navigation / Wait**
- `goto`, `wait`

**Snapshot / Interactions**
- `snapshot`, `click`, `hover`, `press`, `check`, `uncheck`, `type`, `select`, `scroll`, `scroll_into_view`

**DOM Queries**
- `dom_get_html`, `dom_get_text`, `get_attr`, `get_value`, `is_visible`, `is_enabled`, `is_checked`

**Devtools / Telemetry**
- `console_poll`, `network_poll`, `perf`

**Capture / Export**
- `screenshot`, `clone_page`, `clone_component`

**Other**
- `run`, `annotate`, `prompting_guide`, `skill_list`, `skill_load`

### Execution mapping
- **OpsRuntime + CDP Adapter**: snapshot/refs, click/hover/press/type/scroll, perf, console/network polling, full‑page screenshot.
- **Content Script Bridge**: DOM queries + targeted HTML/text extraction.
- **Daemon post‑processing**: clone page/component via existing export pipeline (extension provides DOM/CSS payloads).
- **Annotation**: remains `/annotation` channel.
- **Tool‑only** (`prompting_guide`, `skill_list`, `skill_load`): remain local.

---

## CLI Mode Semantics (Ops Activation)

- Ops mode is the **default** for extension sessions (`launch`/`connect`).
- Legacy extension mode is **opt‑in** via `--extension-legacy` (relay `/cdp` path).
- `--extension-only` remains valid and defaults to ops; `--headless` remains managed mode only.
- `run` defaults to managed mode; ops usage requires an extension session (default) or explicit `--extension-ops` if a flag is required for clarity.
- No automatic fallback: if ops cannot attach, return a clear error suggesting `--extension-legacy`.
- Document flag precedence and error messages for incompatible flags.

---

## Session Model & Routing

### Session identifiers
- `clientId`: unique per `/ops` WebSocket connection.
- `opsSessionId`: unique per browser session, returned by `launch/connect`.
- `tabId`/`targetId`: internal mapping in extension.

### Ownership & concurrency
- **Exclusive by default**: a session has a single owner (`ownerClientId`).
- **Read‑only sharing (optional)**: allow `snapshot`, `dom_*`, `is_*` for additional clients with `shareMode=read`.
- **Per‑session queue**: serialize write operations (`goto`, click/type/scroll, navigation).
- **Per‑tab lock**: prevent conflicting commands to the same tab from multiple sessions.

### Multi‑user support
- Replace daemon **global binding** with **per‑session leases** in ops mode:
  - `bindingId` becomes `sessionLeaseId` tied to `opsSessionId`.
  - Multiple ops sessions can coexist; relay routes by `opsSessionId`.

### Lifecycle & recovery (required)
- **Session states**: `initializing → active → closing → closed`.
- **Session expiry**: if the owning `/ops` client disconnects, session enters `closing` and is released after a short TTL unless re‑owned by the same client.
- **Tab close**: if the tab closes, session becomes `invalid_session` and cleanup runs (detach + ref store purge).
- **Extension restart**: ops sessions are not persisted across MV3 worker restarts; daemon must treat reconnect as fresh and re‑launch or re‑attach explicitly.

---

## Snapshot / Ref Parity

Goal: **return the same snapshot shape and ref semantics** as managed mode.

### Strategy
- Reuse snapshot schema (`snapshot` tool output + `RefStore` behavior).
- Implement **extension snapshot builder** that uses CDP (via `chrome.debugger`) to obtain the AX tree and DOM data.
- Store refs per ops session; keep ref resolution rules identical.

Size limits:
- Snapshot + DOM payloads are capped; if exceeded, return `not_supported` with `payload_too_large` detail and suggest narrowing scope.

---

## Screenshot Parity

- Primary: CDP `Page.captureScreenshot` via `chrome.debugger`.
- Fallback: `chrome.tabs.captureVisibleTab` (visible area only) with explicit warning in result (`warning: "visible_only_fallback"`).

---

## Network / Console / Perf Parity

- Primary: CDP domains (Network/Runtime/Performance) via `chrome.debugger`.
- Fallback: `webRequest` as partial telemetry only if explicitly enabled.

---

## Error Codes (Ops)

- `ops_unavailable`
- `invalid_request`
- `invalid_session`
- `not_owner`
- `restricted_url`
- `timeout`
- `not_supported`
- `execution_failed`
- `cdp_attach_failed`
- `cdp_session_lost`
- `cdp_attach_blocked`

Each error response includes `{ code, message, retryable, details? }` and maps to tool‑level errors consistently (idempotent ops are retryable by default).

---

## Security & Auth

- `/ops` reuses relay auth: pairing token + relay token.
- Origin checks mirror `/annotation` policy.
- Each ops session has an **owner clientId**, enforced by the extension.
- Rate limit per client (same policy as relay handshake throttles).
- Validate payload schema and cap message size to prevent abuse.

---

## Ops Protocol & Lifecycle (Addendum)

### Envelope
- `type`: string discriminator (e.g., `ops_request`, `ops_response`, `ops_event`, `ops_error`).
- `requestId`: required for request/response correlation.
- `clientId`: set by relay per connection; included on responses.
- `opsSessionId`: set after `launch/connect`, required for session‑scoped operations.
- `version`: protocol version string, negotiated in handshake.

### Handshake
- Client sends `ops_hello` with supported `version`, `capabilities`, and `maxPayloadBytes`.
- Extension replies `ops_hello_ack` with chosen `version`, `capabilities`, and `maxPayloadBytes`.
- If version mismatch, return `not_supported` with supported versions.

### Payload limits & chunking
- Define `MAX_OPS_PAYLOAD_BYTES` and `MAX_SNAPSHOT_BYTES`.
- For large data (snapshots, DOM/CSS, screenshots), use `ops_chunk` messages with `chunkIndex/totalChunks` and `payloadId`.

### Heartbeat
- Client sends `ops_ping` every N seconds; extension replies `ops_pong`.
- Missing 2 consecutive pongs triggers disconnect + reconnect.

### Lifecycle events
- `ops_session_created`, `ops_session_closed`, `ops_tab_closed`, `ops_session_expired`.
- `ops_session_expired` maps to `invalid_session` on subsequent requests.

### Error shape
- `code`, `message`, `retryable`, `details` (optional).

---

## Rollout & Migration

### Default behavior
- Extension mode defaults to ops immediately for reliability.
- Legacy extension mode remains available via `--extension-legacy`.

### Migration steps
1. Update CLI help/docs to reflect ops default and legacy opt‑in.
2. Add explicit error guidance when ops fails (suggest `--extension-legacy`).
3. Validate parity via ops‑mode smoke tests before release.
4. Announce default change and provide fallback instructions.

### Deprecation (legacy mode)
- Legacy extension mode remains supported short‑term for fallback.
- Reassess deprecation after ops stability benchmarks are met.

---

# Implementation Plan

---

## Task 1 — Define ops protocol + lifecycle model

### Reasoning
We need an explicit protocol for tool‑level operations and multi‑session routing.

### What to do
Add `/ops` message types, error codes, lifecycle events, and payload limits.

### How
1. Extend `src/relay/protocol.ts` with ops message definitions and errors.
2. Mirror types in `extension/src/types.ts`.
3. Define a shared ops error code list, versioned envelope, and max payload constants.
4. Add handshake + heartbeat message types.

### Files impacted
- `src/relay/protocol.ts`
- `extension/src/types.ts`
- `src/relay/relay-types.ts`

### End goal
Ops protocol types compile and are shared across relay/extension.

### Acceptance criteria
- [ ] Ops message types are versioned and exported.
- [ ] Error codes are consistent across relay + extension.
- [ ] Handshake + heartbeat types are defined with payload caps.

---

## Task 2 — Add `/ops` relay endpoint with multi‑client routing

### Reasoning
/ops must be independent from `/cdp` and allow concurrent clients.

### What to do
Implement `/ops` WS in RelayServer with client multiplexing.

### How
1. Add `opsWss` and client registry in `RelayServer`.
2. Implement upgrade path with existing auth + origin checks.
3. Forward ops messages to extension and route responses back by `clientId`.
4. Block `/cdp` attach to ops‑owned tabs (`cdp_attach_blocked`).

### Files impacted
- `src/relay/relay-server.ts`
- `src/relay/protocol.ts`

### End goal
Relay proxies ops messages between CLI and extension without `/cdp`.

### Acceptance criteria
- [ ] Multiple `/ops` clients can connect simultaneously.
- [ ] Request/response routing is correct by `clientId` + `requestId`.
- [ ] `/cdp` attach is rejected for ops‑owned tabs.

---

## Task 3 — Extension OpsRuntime (full BrowserManagerLike)

### Reasoning
Extension must execute the full tool surface to guarantee parity.

### What to do
Implement OpsRuntime with session store, CDP adapter, and DOM bridge.

### How
1. Create `extension/src/ops/` with OpsRuntime, OpsSessionStore, CDPAdapter, DomBridge.
2. Implement BrowserManagerLike methods against the adapter/bridge.
3. Add per‑session command queue + ownership checks.
4. Add attach conflict handling (`cdp_attach_failed`, `restricted_url`).
5. Implement lifecycle + cleanup for tab close and session expiry.
6. Build CDPAdapter on top of existing `CDPRouter`/`TargetSessionMap` to avoid duplication.
7. Define content script injection + re‑injection strategy for `dom_*` commands.

### Files impacted
- `extension/src/background.ts`
- `extension/src/ops/ops-runtime.ts` (new)
- `extension/src/ops/ops-session-store.ts` (new)
- `extension/src/ops/cdp-adapter.ts` (new)
- `extension/src/ops/dom-bridge.ts` (new)
- `extension/src/types.ts`

### End goal
Extension can execute all BrowserManagerLike methods via ops.

### Acceptance criteria
- [ ] OpsRuntime can open sessions, navigate, snapshot, and interact.
- [ ] Ownership enforced per session.
- [ ] OpsRuntime returns tool‑compatible outputs.
- [ ] Session lifecycle events fire and cleanup runs on tab close.
- [ ] CDPAdapter reuses existing router/session mapping and dom bridge reinjects when needed.

---

## Task 4 — Snapshot/ref parity in extension

### Reasoning
Tool outputs depend on snapshot and ref semantics; parity must match managed mode.

### What to do
Implement extension snapshot builder that matches current snapshot output.

### How
1. Extract snapshot shaping logic into a shared module that can run in extension.
2. Use CDP (via `chrome.debugger`) to gather AX tree + DOM data.
3. Maintain per‑session `RefStore` identical to managed mode.
4. Enforce payload limits + chunked transfer for large snapshots.

### Files impacted
- `src/snapshot/` (shared logic extraction)
- `extension/src/ops/cdp-adapter.ts`
- `extension/src/ops/ops-runtime.ts`

### End goal
Snapshot tool returns identical schema and compatible refs.

### Acceptance criteria
- [ ] Snapshot output matches managed mode schema.
- [ ] Ref resolution is consistent across modes.
- [ ] Oversized payloads return a structured error.

---

## Task 5 — CLI/daemon routing with OpsBrowserManager (Ops default)

### Reasoning
Tool code should remain unchanged; only the manager implementation changes.

### What to do
Add an OpsBrowserManager that forwards tool calls to `/ops`.

### How
1. Add OpsBrowserManager in `src/browser/ops-browser-manager.ts`.
2. Extend session store to include `mode: "extension_ops"`.
3. Make ops the default for extension launch/connect; define `--extension-legacy` for opt‑in legacy mode and document interaction with `--extension-only` and `--headless`.
4. Wire `daemon-commands.ts` to use OpsBrowserManager for extension ops sessions.

### Files impacted
- `src/browser/ops-browser-manager.ts` (new)
- `src/browser/session-store.ts`
- `src/cli/daemon-commands.ts`
- `src/cli/commands/session/launch.ts`

### End goal
CLI tools operate unchanged while using ops for extension sessions.

### Acceptance criteria
- [ ] `launch`/`connect` in extension mode uses ops by default.
- [ ] `--extension-legacy` routes to legacy relay `/cdp` path.
- [ ] Existing tools work against ops session with no CLI syntax changes.
- [ ] Flag precedence is documented and tested.

---

## Task 6 — Export/screenshot parity pipeline

### Reasoning
Clone and screenshot tools require data capture + processing parity.

### What to do
Implement extension data capture and daemon‑side processing.

### How
1. Use CDP capture for full‑page screenshots when available.
2. Implement DOM/CSS capture in extension; send to daemon for existing export pipeline.
3. Keep screenshot, clone_page, clone_component outputs unchanged.
4. Define warning fields for fallback capture modes.

### Files impacted
- `extension/src/ops/cdp-adapter.ts`
- `extension/src/ops/dom-bridge.ts`
- `src/export/*` (if shared hooks needed)
- `src/browser/ops-browser-manager.ts`

### End goal
Clone and screenshot tools match managed mode output formats.

### Acceptance criteria
- [ ] `screenshot` returns identical result shape to managed mode.
- [ ] `clone_page`/`clone_component` outputs match existing format.
- [ ] Fallback warnings are exposed in a consistent field.

---

## Task 7 — Multi‑user session leases and concurrency

### Reasoning
Full parity requires multi‑user sessions without global hub binding.

### What to do
Replace global binding with per‑session leases in ops mode.

### How
1. Extend daemon binding model to allocate per‑session lease IDs.
2. Enforce lease ownership in daemon and in extension ops session store.
3. Add read‑only sharing option for non‑owners (snapshot/dom only).
4. Ensure lease cleanup on client disconnect and extension restart.

### Files impacted
- `src/cli/daemon-state.ts`
- `src/cli/daemon-commands.ts`
- `extension/src/ops/ops-session-store.ts`

### End goal
Multiple ops sessions can be active simultaneously, safely.

### Acceptance criteria
- [ ] Two different clients can use different sessions concurrently.
- [ ] Ownership conflicts produce `not_owner` errors.
- [ ] Leases are released on disconnect/expiry.

---

## Task 8 — Ops reliability + annotation compatibility tests

### Reasoning
New protocol and runtime must be tested without regressing annotation.

### What to do
Add relay, extension, and integration tests; update docs.

### How
1. Add relay tests for `/ops` routing/multiplexing.
2. Add extension unit tests for OpsRuntime session routing and error cases.
3. Add integration tests for ops mode tool parity (smoke).
4. Add a regression test that `/annotation` still works when `/ops` is connected.
5. Update docs: CLI, architecture, extension, AGENTS references.
6. Clarify coverage scope (extension tests excluded from coverage thresholds).
7. Add a migration note + fallback guidance in CLI docs.

### Files impacted
- `tests/relay-server.test.ts`
- `tests/*ops*` (new)
- `extension/tests/*` (new)
- `docs/CLI.md`
- `docs/ARCHITECTURE.md`
- `docs/EXTENSION.md`
- `docs/ANNOTATE.md`
- `src/AGENTS.md`, `src/tools/AGENTS.md`, `extension/AGENTS.md`

### End goal
Ops mode is documented and covered with tests, and annotation remains stable.

### Acceptance criteria
- [ ] All tests pass with >=97% coverage.
- [ ] `/annotation` still works with `/ops` connected.
- [ ] Docs reflect ops mode and tool parity.
- [ ] Test plan explicitly documents coverage scope and exclusions.
- [ ] CLI docs describe ops default and legacy opt‑in.

---

## File-by-file implementation sequence

1. `src/relay/protocol.ts` — Task 1
2. `src/relay/relay-server.ts` — Task 2
3. `extension/src/ops/*` — Tasks 3–4
4. `extension/src/background.ts` — Task 3
5. `src/browser/ops-browser-manager.ts` — Task 5
6. `src/cli/daemon-commands.ts` — Tasks 5, 7
7. `src/cli/daemon-state.ts` — Task 7
8. `src/snapshot/*` — Task 4
9. `src/export/*` — Task 6
10. `tests/*` + `extension/tests/*` — Task 8
11. `docs/*` + `AGENTS.md` updates — Task 8

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| (none) |  |  |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 2.1 | 2026-02-02 | Clarified internal CDP boundary, annotation compatibility, and reliability rules |
| 2.0 | 2026-02-02 | Full‑parity ops WS spec + plan (replaces limited v1) |
