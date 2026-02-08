# Brokered Multi-Client /cdp Plan

Design spec and implementation plan for brokered multi-client `/cdp` connections with per-target leases and strict conflict rules. This is a planning document only; no implementation in this phase.

---

## Overview

### Scope
- Allow multiple concurrent `/cdp` websocket clients to connect to the relay.
- Maintain a single real CDP attachment inside the extension (`chrome.debugger`), brokered by the relay.
- Enforce per-target exclusive leases and strict conflict rules for global CDP domains.
- Preserve backward compatibility for existing single-client `/cdp` usage.

### Current baseline (known pre-implementation gaps)
- Current relay code is single-client for `/cdp` (one `cdpSocket`, second client rejected).
- Current relay forwards raw CDP IDs/events without broker ownership routing.
- Current protocol error/status typing is legacy (message-only errors, no broker client counts/admin id).
- This plan is the implementation specification to close those known gaps.

### Key decisions
- The relay is the broker: it virtualizes multiple `/cdp` clients while keeping the extension as the single debugger client.
- Per-target leases are enforced at the relay based on `Target.attachToTarget` and `sessionId` routing.
- Broker request-id virtualization is mandatory to prevent cross-client `id` collisions.
- Admin failover is deterministic via monotonic connection sequence (`connectedSequence`) and `clientId` tie-break.
- `Target.getTargets` for standard clients is visibility-scoped to avoid cross-client metadata leaks.
- Admin-change notifications must not be injected into the `/cdp` stream.

### Admin authorization model
- Admin-eligible client: a `/cdp` client that satisfies configured admin authorization checks.
- If `cdpAdminToken` is set in relay config, only clients presenting a valid admin credential are admin-eligible.
- Admin credential transport (explicit): `/cdp?...&adminToken=<value>` query param for local relay clients.
- Validation requirement: compare admin token with `timingSafeEqual` (same hardening as pairing token).
- Admin origin constraint: only loopback/no-origin `/cdp` clients may become admin-eligible; extension-origin `/cdp` connections are never admin-eligible.
- Logging requirement: never log `adminToken`; redact it in all security/diagnostic logs and error details.
- Auth precedence:
  - Pairing token (`token`) auth continues to gate `/cdp` connection acceptance when configured.
  - `adminToken` affects role only: invalid/missing `adminToken` downgrades to standard role; it does not reject an otherwise valid `/cdp` connection.
- If no admin authorization config is set, fallback is backward-compatible: oldest connected client is admin-eligible.
- If no eligible admin exists, global admin-only commands fail with explicit `not_admin_available` broker error.

### Conflict policy / allowlist (strict)
Rules apply in this order:
1. Session-bound (`sessionId` present): only session owner may call; otherwise error.
2. Target-scoped (`targetId` present, no `sessionId`): only target owner may call; otherwise error.
3. Global/sessionless (no `sessionId`, no `targetId`): admin-only unless explicitly allowlisted.

| Category | CDP methods | Admin | Standard | Notes |
|---|---|---|---|---|
| Admin-only global | `Target.setDiscoverTargets`, `Target.setAutoAttach`, `Target.setRemoteLocations` | Yes | No | Global mutation; prevent collisions. |
| Admin-only global (runtime/log) | `Runtime.enable`, `Runtime.disable`, `Log.enable`, `Log.disable` | Yes | No | Global side-effects. |
| Standard allowlisted (visibility-scoped) | `Target.getTargets` | Yes | Yes | Admin: all non-ops-owned targets. Standard: owned targets only. |
| Owner-only target-scoped | `Target.activateTarget`, `Target.closeTarget`, `Page.bringToFront` | Yes | Yes | Requires ownership of `targetId`. |
| Owner-only session-bound | All commands with `sessionId` | Yes | Yes | Requires session ownership. |

### Response/event visibility policy
- Session responses/events (`sessionId` present): owner only.
- Target-scoped sessionless events (`targetId`, no `sessionId`) when owned: owner only.
- Target-scoped sessionless events for unowned targets: admin only.
- True global events (no `sessionId`, no `targetId`): admin only.
- Standard clients never receive non-owned target-scoped events.

### Broker ID model (required)
- Incoming client requests are rewritten to broker IDs before forwarding to extension.
- Relay stores `brokerRequestId -> { clientId, originalRequestId, method, targetId?, sessionId?, createdAt }`.
- Extension responses are mapped back to the original requester and original request ID.
- No direct routing by raw request IDs across clients.

### Broker error model (required)
- Extend relay error payload to support machine-readable broker errors while preserving compatibility:
  - current-compatible shape: `error: { message: string }`
  - broker shape (additive): `error: { code?: string, message: string, details?: Record<string, unknown> }`
- Required broker codes: `not_admin`, `not_admin_available`, `not_owner`, `target_locked`, `attach_timeout`, `attach_conflict`, `internal_cleanup_failed`.

### Broker observability channel (required)
- Broker warnings/errors that are not direct replies to a client request must be published out-of-band via relay status/health payloads (for example, additive `brokerWarnings` array with bounded retention).
- Do not emit these as non-CDP events on `/cdp`.
- Warning payload schema:
  - `{ code: string; message: string; at: number; details?: Record<string, unknown> }`
  - Retention cap: 50 entries (drop oldest first).

### Target/session extraction map (required)
Use a method-level extraction table so routing does not depend on ad-hoc payload parsing:

| Event/Command | `sessionId` source | `targetId` source | Notes |
|---|---|---|---|
| `Target.attachToTarget` response | `result.sessionId` | from original request `params.targetId` | Assign lease on success. |
| `Target.attachedToTarget` event | `params.sessionId` | `params.targetInfo.targetId` | Auto-attach path; ownership assignment required. |
| `Target.detachedFromTarget` event | `params.sessionId` | derived from `sessionId -> targetId` map | Always clear ownership. |
| `Target.targetCreated`/`Target.targetInfoChanged` | n/a | `params.targetInfo.targetId` | Sessionless target-scoped events. |
| `Target.targetDestroyed` | n/a | `params.targetId` | Clear ownership/locks when applicable. |

Routing fallback requirement:
- Deny-by-default for unknown/unclassified events.
- If an event does not match a known extractor, route to admin only with debug log; never broadcast to standard clients.

### Broker-internal CDP command path (required)
- Broker must support internal CDP commands for cleanup flows (for example, broker-triggered `Target.detachFromTarget`).
- Internal commands must use broker-internal request IDs and a dedicated pending map separate from client-originated requests.
- Internal command responses/events must never be forwarded to `/cdp` clients unless explicitly mapped to an existing client request.
- Required for late-attach timeout cleanup and disconnect cleanup invariants.

### Broker timing constants (required)
- `CDP_ATTACH_LOCK_TIMEOUT_MS` default: `5000`
- `CDP_DETACH_CLEANUP_TIMEOUT_MS` default: `1500`
- These constants should be configurable for tests but stable by default for deterministic behavior.
- Test configurability mechanism: `RelayServerOptions` supports optional overrides (`cdpAttachLockTimeoutMs`, `cdpDetachCleanupTimeoutMs`).

---

## Task 0 — Baseline security hardening prerequisite

### Reasoning
Multi-client brokering should not expand attack surface inherited from permissive local-origin behavior.

### What to do
Harden relay HTTP/WS origin handling before broker rollout.

### How
1. Treat `Origin: null` as a real origin and block it for `/pair`, `/config`, and `/status` unless explicitly extension-origin.
2. Remove `Access-Control-Allow-Origin: null` behavior.
3. Keep loopback-only fallback for requests without origin, but do not treat `null` as equivalent to missing origin.
4. Keep pairing-token checks unchanged; ensure hardening is backward-compatible for valid local and extension clients.
5. Add/adjust tests for blocked null-origin HTTP and WS behavior.

### Files impacted
- `src/relay/relay-server.ts`
- `tests/relay-server.test.ts`

### End goal
Relay starts from a hardened origin/auth baseline before multi-client broker complexity is added.

### Acceptance criteria
- [ ] Null-origin requests cannot read pairing/config/status endpoints.
- [ ] Null-origin WS upgrades are rejected.
- [ ] Existing valid loopback/no-origin and extension-origin flows remain functional.

---

## Task 1 — Broker data structures and request-id virtualization

### Reasoning
Current relay behavior is single-client (`cdpSocket`) and assumes raw request IDs are unique. Multi-client support requires explicit client identity and brokered request identity.

### What to do
Introduce broker structures to track `/cdp` clients, leases, and request ownership with collision-safe broker IDs.

### How
1. Replace single `cdpSocket` with `cdpClients: Map<clientId, ClientState>` in `src/relay/relay-server.ts`.
2. Assign each `/cdp` connection:
   - `clientId`
   - `connectedSequence` (strictly monotonic)
   - metadata (`connectedAt`, `lastSeen`, `role`, `adminEligible`, `ownedTargets`, `ownedSessions`).
3. Add ownership maps:
   - `sessionId -> clientId`
   - `sessionId -> targetId`
   - `targetId -> clientId`
   - `targetId -> pendingClientId` (attach lock with timeout).
4. Add pending request map for all forwarded commands:
   - `brokerRequestId -> { clientId, originalRequestId, method, targetId?, sessionId?, createdAt }`.
5. Add broker request ID generator (monotonic counter or UUID) and rewrite outgoing request IDs.
6. Ensure ops-owned targets remain blocked for all `/cdp` clients.
   - Ops-owned `targetId` mapping is `tab-<tabId>` (consistent with current relay behavior).
7. Reuse existing `src/relay/relay-types.ts` (already present) for relay-like typing changes; do not create a duplicate type file.

### Files impacted
- `src/relay/relay-server.ts`
- `src/relay/protocol.ts` (optional: broker errors/constants)
- `src/relay/relay-types.ts` (existing file)

### End goal
Relay can host multiple `/cdp` clients with explicit ownership and collision-safe request routing.

### Acceptance criteria
- [ ] Multiple `/cdp` websocket clients can connect simultaneously.
- [ ] Relay tracks per-client ownership of sessions and targets.
- [ ] All forwarded requests use broker request IDs.
- [ ] No response routing depends on raw cross-client request IDs.
- [ ] Connection ordering is deterministic via `connectedSequence`.
- [ ] No behavior regression for single-client usage (explicit invariants in Task 5).

---

## Task 2 — Lease enforcement, admin authorization, and deterministic failover

### Reasoning
Without strict lease checks, explicit admin authorization boundaries, and deterministic failover, concurrent clients produce nondeterministic or unsafe CDP behavior.

### What to do
Enforce ownership checks, strict allowlist rules, admin authorization, and deterministic admin failover.

### How
1. Define client roles:
   - Admin client: lowest `connectedSequence` among admin-eligible connected clients.
   - Standard client: session/target owner operations only.
2. Enforce inbound command policy:
   - `sessionId` present: owner-only.
   - `Target.attachToTarget`: allow only when target is unowned and unlocked; lock until success/failure/timeout.
   - `Target.detachFromTarget`: owner-only.
   - `Target.closeTarget`: owner-only.
   - Global commands: admin-only unless explicit allowlist.
   - Keep existing `cdpAllowlist` check before broker checks.
   - Parse and validate optional `adminToken` on `/cdp` upgrade; set `adminEligible` per connection.
   - Redact admin credentials in logs/error details.
3. Enforce `Target.getTargets` visibility filtering per policy (admin full non-ops-owned; standard owned-only by default).
4. Deterministic failover:
   - On admin disconnect, elect next eligible client by `connectedSequence`, then `clientId`.
   - If no eligible client exists, admin is `null` and admin-only commands return `not_admin_available`.
5. Admin-change signaling:
   - Do not emit non-CDP broker events on `/cdp`.
   - Surface admin change through additive relay status fields (`cdpAdminClientId`) and existing status/health endpoints.
   - Surface asynchronous broker warnings through additive status/health warnings payload.

### Files impacted
- `src/relay/relay-server.ts`
- `src/relay/protocol.ts` (broker error payload typing and status typing)
- `src/config.ts` (add `cdpAdminToken` config surface)
- `docs/CLI.md` (document admin token usage)

### End goal
Per-target/session leases and global conflict policy are enforced deterministically with explicit privilege boundaries.

### Acceptance criteria
- [ ] Non-owners cannot execute session-bound commands.
- [ ] A target is attachable by one client at a time (including in-flight lock).
- [ ] Global commands are restricted to admin except explicit allowlist.
- [ ] Admin role assignment and failover are deterministic and authorization-aware.
- [ ] No custom broker messages are injected into `/cdp` event stream.
- [ ] Admin eligibility is enforceable via configured `cdpAdminToken` and validated on connection.

---

## Task 3 — Deterministic response routing, auto-attach ownership, and timeout race handling

### Reasoning
Multi-client correctness depends on deterministic response routing for both session and non-session commands, including `Target.setAutoAttach` side effects and timeout races.

### What to do
Route all responses/events by ownership maps, define strict behavior for late attach responses, and explicitly model auto-attach ownership assignment.

### How
1. On every forwarded request:
   - Store pending request ownership with broker ID.
2. On extension responses:
   - Resolve by broker request ID.
   - Restore original request ID before returning to requester.
   - Remove pending mapping after terminal response.
3. `Target.attachToTarget` success:
   - Bind returned `sessionId` to requesting client.
   - Bind `targetId` lease to requesting client.
   - Clear attach lock.
4. Auto-attach ownership (`Target.attachedToTarget`):
   - Parse using extraction map (`sessionId`, `targetId`).
   - If target has an active attach lock, auto-attach loses precedence: immediately best-effort detach auto-attached session and keep lock owner unchanged.
   - Assign ownership to current admin if target is unowned.
   - If target is already owned by another client, immediately issue best-effort `Target.detachFromTarget` for the newly attached session and emit broker warning/error to admin.
5. Attach timeout race (mandatory behavior):
   - If lock times out first, return timeout error to requester.
   - If success arrives late after timeout, immediately issue best-effort `Target.detachFromTarget` for orphan session and do not assign ownership.
6. Sessionless allowlisted response routing:
   - Route via pending request ownership map (for example `Target.getTargets`), never by broadcast.
7. Event routing:
   - `sessionId` events -> session owner.
   - owned `targetId` sessionless events -> target owner.
   - unowned `targetId` sessionless events -> admin only.
   - true global events -> admin only.
   - unknown/unclassified events -> admin only with debug log, never broadcast.
8. Teardown cleanup:
   - On `Target.targetDestroyed` and `Target.detachedFromTarget`, clear related target/session ownership and pending locks.

### Files impacted
- `src/relay/relay-server.ts`
- `src/relay/protocol.ts` (optional broker timeout/error details)

### End goal
Each client receives only the responses/events it owns; auto-attach and timeout races do not leak orphan sessions.

### Acceptance criteria
- [ ] No cross-client response leakage when clients reuse same request IDs.
- [ ] Sessionless allowlisted responses are returned only to requesting client.
- [ ] Late attach successes after timeout are detached and not leased.
- [ ] Auto-attach sessions get deterministic ownership or deterministic detach.
- [ ] Global events only go to admin.
- [ ] Leases clear on teardown events.

---

## Task 4 — Disconnect cleanup and lease lifecycle guarantees

### Reasoning
Disconnect paths are a major source of stale lease/session state if cleanup behavior is optional.

### What to do
Define mandatory cleanup guarantees for disconnect and lease lifecycle.

### How
1. On client disconnect:
   - Remove client from `cdpClients`.
   - Release owned target/session maps.
   - Clear attach locks owned by client.
   - Resolve/reject pending requests owned by client.
2. Session cleanup policy:
   - Attempt best-effort `Target.detachFromTarget` for each owned session with bounded timeout.
   - Regardless of extension detach result, force local lease/session cleanup after timeout.
3. Admin cleanup/failover:
   - If disconnected client is admin, elect replacement immediately with deterministic eligibility rule.
4. Extension disconnect:
   - Close all `/cdp` clients with consistent close code/reason (`1011`, `Extension disconnected`) for extension-loss path.
   - Clear all broker maps (`cdpClients`, leases, pending requests, locks).

### Files impacted
- `src/relay/relay-server.ts`
- `tests/relay-server.test.ts`

### End goal
Disconnects leave no stale ownership state and failover happens deterministically.

### Acceptance criteria
- [ ] Disconnect always clears leases and locks for that client.
- [ ] Best-effort detach is attempted for owned sessions with bounded timeout.
- [ ] Broker state is fully reset when extension disconnects.
- [ ] Admin failover occurs immediately and deterministically.
- [ ] Extension-disconnect path preserves close semantics expected by current tests.

---

## Task 5 — Status/diagnostics compatibility and tests

### Reasoning
Broker rollout needs observability and test migration without breaking existing status consumers or CDP protocol expectations.

### What to do
Expose additive broker status fields and add tests for multi-client behavior, compatibility, and migration from single-client assumptions.

### How
1. Keep existing status fields and semantics stable:
   - `cdpConnected` remains boolean (`cdpClients.size > 0`).
2. Additive status fields:
   - `cdpClients` (number)
   - `cdpAdminClientId` (string | null)
   - `brokerWarnings` (array, optional, bounded retention)
3. Protocol compatibility typing:
   - keep additive status fields optional in wire types for backward compatibility.
   - keep broker error `code` optional so existing message-only consumers remain valid.
4. Replace outdated single-client test assumptions:
   - Replace test expecting second `/cdp` connection close (currently around `tests/relay-server.test.ts:1281`) with multi-client connection + deterministic role assignment assertions.
   - Keep a focused single-client regression test for legacy forwarding behavior.
5. Add tests for:
   - Multi-client connect, admin election, and deterministic failover.
   - Request ID collision scenario (two clients same raw `id`) with correct response routing.
   - In-flight attach lock conflicts and timeout behavior.
   - Late attach success after timeout triggers detach and no lease assignment.
   - Auto-attach ownership assignment and conflicting auto-attach detach path.
   - Session and target-scoped event routing visibility (including unowned target events routed to admin only).
   - Admin-only global commands and `Target.getTargets` visibility filtering.
   - Disconnect cleanup for leases/pending requests.
   - Ops-owned targets blocked for `/cdp` attach.
   - `/cdp` stream remains CDP-only (no custom broker events injected).
   - admin token gating for admin-eligible connections and `not_admin_available` path.
   - deny-by-default behavior for unknown/unclassified events.
   - asynchronous warning publication in status/health payloads (without `/cdp` injection).
6. Single-client invariants (explicit):
   - `forwardCDPCommand` passthrough still works for command/response/event flow.
   - Existing allowlist enforcement behavior remains unchanged.
   - Extension disconnect still yields consistent client close/error behavior.
7. Update consumer expectations:
   - `tests/remote-relay.test.ts` and any status parser tests treat new fields as additive.
8. Ensure coverage remains >=97%.

### Files impacted
- `src/relay/relay-server.ts`
- `src/relay/protocol.ts`
- `tests/relay-server.test.ts`
- `tests/remote-relay.test.ts`
- `docs/CLI.md` (status field docs)

### End goal
Brokered multi-client `/cdp` is observable, test-validated, and backward compatible.

### Acceptance criteria
- [ ] Relay status reports client count and admin client ID without breaking existing fields.
- [ ] Multi-client tests pass with deterministic ownership and routing.
- [ ] Compatibility tests for existing status consumers continue to pass.
- [ ] Single-client invariants remain green.
- [ ] Coverage remains >=97%.

---

## File-by-file implementation sequence

1. `src/relay/relay-server.ts` — Task 0 then Tasks 1-4 (hardening + broker core/routing/cleanup)
2. `src/relay/protocol.ts` — Tasks 2, 3, 5 (broker errors/status typing)
3. `tests/relay-server.test.ts` — Task 0 then Tasks 3-5 (hardening + routing/failover/lifecycle/migration)
4. `tests/remote-relay.test.ts` — Task 5 (status contract compatibility)
5. `docs/CLI.md` — Tasks 2, 5 (admin token and status fields documentation)

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| (none) | — | Leverage existing relay infrastructure |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-03 | Initial brokered `/cdp` multi-client plan |
| 1.1 | 2026-02-03 | Added conflict policy/allowlist, admin failover, discovery filtering, lease lifecycle details |
| 1.2 | 2026-02-07 | Resolved initial audit findings: request-id virtualization, deterministic non-session response routing, late-attach timeout handling, mandatory cleanup guarantees, additive status compatibility |
| 1.3 | 2026-02-07 | Patched independent-audit gaps: auto-attach ownership model, unowned target event routing, admin authorization boundary, non-CDP signaling guardrails, explicit test migration/invariants |
| 1.4 | 2026-02-07 | Patched cycle batch #1 findings: explicit admin token transport, typed broker errors, deny-by-default unknown event routing, broker-internal detach channel, attach-lock precedence, close-code/test compatibility |
| 1.5 | 2026-02-07 | Patched cycle batch #2 findings: added Task 0 baseline security hardening (null-origin handling), clarified known baseline gaps, and updated implementation sequence ordering |
| 1.6 | 2026-02-07 | Patched cycle batch #3 findings: fixed remaining ambiguities (unknown-event behavior, discovery scope), added admin token redaction/origin constraints, defined observability channel, timing constants, and ops target-id mapping |
| 1.7 | 2026-02-07 | Final hardening after 2:1 readiness consensus: added auth precedence rules, explicit broker warning schema/retention, and timeout override mechanism for deterministic testing |
