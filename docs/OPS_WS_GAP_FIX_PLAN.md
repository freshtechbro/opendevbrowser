# Ops WS Gap Fix Plan

This plan closes the remaining gaps from `docs/EXTENSION_OPS_WS_SPEC_PLAN.md` and adds reliability + test coverage to validate ops parity.

---

## Overview

### Scope
- Per-session leases + TTL cleanup for ops sessions
- Ops reliability (backoff, heartbeat miss policy, version mismatch)
- Snapshot parity extraction and MAX_SNAPSHOT_BYTES enforcement
- Screenshot fallback + warning propagation
- Ops parity smoke tests, annotation/ops coexistence, integration + E2E coverage

### Key decisions
- Keep tools unchanged; fix gaps in ops runtime, ops client, and daemon binding model.
- Introduce per-session lease IDs tied to opsSessionId and enforce ownership at the daemon + extension layers.
- Add ops protocol handling for version mismatch and snapshot size caps.

---

## Task 1 — Confirm tool-only commands remain local

### Reasoning
Tool-only commands must stay local and not depend on ops/relay for correctness.

### What to do
Verify and document that `prompting_guide`, `skill_list`, and `skill_load` execute locally via SkillLoader.

### How
1. Confirm implementations use `deps.skills` and do not call BrowserManager or relay.
2. Add a short note in docs (CLI or architecture) clarifying tool-only behavior.

### Files impacted
- `src/tools/prompting_guide.ts`
- `src/tools/skill_list.ts`
- `src/tools/skill_load.ts`
- `docs/CLI.md` (optional note)

### End goal
Tool-only commands are explicitly documented as local-only and unaffected by ops mode.

### Acceptance criteria
- [ ] Tool-only commands do not call BrowserManager or relay.
- [ ] Documentation clarifies local-only behavior.

---

## Task 2 — Per-session leases + multi-user concurrency

### Reasoning
The spec requires per-session leases instead of a single global relay binding, enabling concurrent sessions safely.

### What to do
Replace global binding with per-session lease IDs and enforce ownership across daemon + extension.

### How
1. Add a per-session lease store keyed by `opsSessionId` in daemon state (replace/augment global binding).
2. Extend daemon commands to request/renew/release leases per ops session (add new daemon actions if needed).
3. Add lease ID to ops session response payloads and propagate through the daemon session store.
4. Enforce lease ownership on ops requests (daemon and extension checks).
5. Add optional read-only sharing for non-owners (snapshot/dom/is_* only).

### Files impacted
- `src/cli/daemon-state.ts`
- `src/cli/daemon-commands.ts`
- `src/cli/daemon-client.ts`
- `src/browser/session-store.ts`
- `extension/src/ops/ops-session-store.ts`
- `extension/src/ops/ops-runtime.ts`

### End goal
Multiple ops sessions can coexist and are owned via per-session lease IDs.

### Acceptance criteria
- [ ] Leases are per session and independent across clients.
- [ ] Ownership violations return `not_owner` errors.
- [ ] Read-only sharing is enforced and limited to safe commands.

---

## Task 3 — Session TTL + reclaim on disconnect

### Reasoning
Spec requires sessions to enter `closing` and be reclaimable within a short TTL instead of immediate deletion.

### What to do
Add session lifecycle state and TTL-based cleanup in the extension ops runtime.

### How
1. Add session state/expiry fields in `OpsSessionStore` (e.g., `state`, `expiresAt`, `closingReason`).
2. On `ops_client_disconnected`, mark sessions as `closing` with a TTL timer instead of immediate cleanup.
3. Allow reclaim by the same clientId within TTL (e.g., a `session.reclaim` ops command or implicit on reconnect).
4. Ensure cleanup runs when TTL expires or on explicit disconnect.

### Files impacted
- `extension/src/ops/ops-session-store.ts`
- `extension/src/ops/ops-runtime.ts`

### End goal
Sessions survive brief disconnects and are cleaned up after TTL.

### Acceptance criteria
- [ ] Session enters `closing` on client disconnect.
- [ ] Session can be reclaimed by same clientId within TTL.
- [ ] Session is cleaned up after TTL expires.

---

## Task 4 — Ops reliability (backoff, heartbeat, version mismatch)

### Reasoning
Ops must match annotation stability: backoff reconnect, heartbeat miss policy, and explicit version mismatch handling.

### What to do
Implement backoff/retry and heartbeat miss policy in OpsClient, and version validation in OpsRuntime.

### How
1. Add exponential backoff + jitter to OpsClient reconnects on socket close/errors.
2. Track consecutive missed pongs; disconnect only after 2 missed intervals.
3. Validate `ops_hello.version`; respond with `not_supported` when mismatched (include supported versions).
4. Update OpsClient to surface a clear error for version mismatch.

### Files impacted
- `src/browser/ops-client.ts`
- `extension/src/ops/ops-runtime.ts`
- `src/relay/protocol.ts`
- `extension/src/types.ts`

### End goal
Ops has robust reconnect and protocol negotiation behavior.

### Acceptance criteria
- [ ] OpsClient backs off and retries on disconnect.
- [ ] Two consecutive missed pongs trigger reconnect.
- [ ] Version mismatch yields `not_supported` error.

---

## Task 5 — Snapshot parity extraction + MAX_SNAPSHOT_BYTES

### Reasoning
Snapshot outputs must match managed mode; spec also calls for a snapshot size cap.

### What to do
Extract shared snapshot shaping logic and enforce `MAX_SNAPSHOT_BYTES`.

### How
1. Extract shared snapshot formatting and ref logic into a module in `src/snapshot/`.
2. Reuse the shared logic in extension snapshot builder.
3. Add `MAX_SNAPSHOT_BYTES` to protocol/types and enforce size limits in ops responses.
4. Add tests verifying parity for outline/actionables formatting.

### Files impacted
- `src/snapshot/*`
- `extension/src/ops/snapshot-builder.ts`
- `extension/src/ops/ops-runtime.ts`
- `src/relay/protocol.ts`
- `extension/src/types.ts`
- `tests/snapshotter.test.ts`

### End goal
Snapshots in ops mode match managed mode and enforce size caps.

### Acceptance criteria
- [ ] Snapshot schema and lines match managed mode.
- [ ] Oversized snapshots return structured errors.
- [ ] `MAX_SNAPSHOT_BYTES` is enforced and documented.

---

## Task 6 — Screenshot fallback + warning propagation

### Reasoning
Spec requires a fallback when CDP capture fails, with explicit warnings.

### What to do
Add `captureVisibleTab` fallback and propagate warnings to tool output.

### How
1. In OpsRuntime, attempt CDP screenshot; on failure fallback to `chrome.tabs.captureVisibleTab`.
2. Add a warning field in the ops response payload (e.g., `warning: "visible_only_fallback"`).
3. Update OpsBrowserManager + screenshot tool response shaping to surface warnings.
4. Add tests to verify fallback and warning propagation.

### Files impacted
- `extension/src/ops/ops-runtime.ts`
- `src/browser/ops-browser-manager.ts`
- `src/tools/screenshot.ts`
- `tests/ops-browser-manager.test.ts`
- `tests/tools.test.ts`

### End goal
Ops screenshot matches managed output and reports fallback warnings.

### Acceptance criteria
- [ ] Fallback captures visible viewport when CDP capture fails.
- [ ] Warning field is surfaced to tool users.
- [ ] Tests cover fallback path.

---

## Task 7 — Ops parity smoke tests + annotation coexistence

### Reasoning
We need concrete proof of parity and that `/annotation` is unaffected by `/ops`.

### What to do
Add ops parity smoke tests and an annotation/ops coexistence regression test.

### How
1. Add relay tests for concurrent `/ops` + `/annotation` usage.
2. Add ops-mode tool parity smoke tests that exercise a subset of critical tools.
3. Add extension unit tests for OpsRuntime routing + session errors.
4. Add integration/E2E tests that launch an ops session and run a multi-step tool sequence.

### Files impacted
- `tests/relay-server.test.ts`
- `tests/ops-client.test.ts`
- `tests/ops-browser-manager.test.ts`
- `tests/ops-parity-smoke.test.ts` (new)
- `tests/ops-annotation-coexistence.test.ts` (new)
- `tests/extension-ops-runtime.test.ts` (new)

### End goal
Parity and coexistence are validated via tests.

### Acceptance criteria
- [ ] Ops parity smoke tests pass.
- [ ] `/annotation` remains functional with `/ops` connected.
- [ ] Ops runtime unit tests cover ownership + error cases.

---

## Task 8 — Integration and E2E coverage

### Reasoning
Ops mode must be verified end-to-end with real command sequences.

### What to do
Add integration and E2E tests across CLI/tool workflows in ops mode.

### How
1. Add daemon integration tests that connect to `/ops` and run `launch`, `snapshot`, `click`, `screenshot`.
2. Add E2E tests that use ops-mode sessions and ensure expected outputs.
3. Document any required environment assumptions for extension/relay tests.

### Files impacted
- `tests/daemon-commands.integration.test.ts`
- `tests/daemon-e2e.test.ts`
- `docs/CLI.md` (test/usage notes)

### End goal
Ops mode is validated in integration/E2E tests with high confidence.

### Acceptance criteria
- [ ] Integration tests cover ops-mode flows.
- [ ] E2E tests pass and document requirements.
- [ ] No regression in non-ops modes.

---

## File-by-file implementation sequence

1. `src/relay/protocol.ts`, `extension/src/types.ts` — protocol constants + version handling
2. `src/browser/ops-client.ts` — reliability/backoff/heartbeat
3. `src/cli/daemon-state.ts`, `src/cli/daemon-commands.ts` — per-session leases
4. `extension/src/ops/ops-session-store.ts`, `extension/src/ops/ops-runtime.ts` — TTL + ownership
5. `src/snapshot/*`, `extension/src/ops/snapshot-builder.ts` — shared snapshot logic
6. `extension/src/ops/ops-runtime.ts`, `src/browser/ops-browser-manager.ts` — screenshot fallback + warnings
7. `tests/*` — ops unit/integration/E2E + annotation coexistence
8. `docs/*` — document final behavior

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| (none) |  |  |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-02 | Initial plan for ops WS gap fixes |
