# OPS_FIRST_ARCHITECTURE_PLAN_SPEC

Specification and phased implementation plan for an Ops-first architecture where `/ops` is the primary public automation contract, with protocol adapters behind it (`CDP` first, optional `BiDi` where feasible), while retaining a constrained `/cdp` compatibility escape hatch.

---

## Overview

### Scope and intent
- Keep `/ops` as the single preferred public control surface for CLI/tools/agents (already default for extension relay flows).
- Treat low-level browser protocols as internal execution details behind adapters.
- Preserve current extension-mode reliability and security posture.
- Maintain backward compatibility for existing advanced `/cdp` users during migration.

### Key decisions
- `/ops` contract is authoritative; protocol-specific behavior must not leak into the public contract by default.
- Keep `/cdp` as explicit legacy/admin path until measurable parity targets are met.
- Implement an adapter boundary to allow `CDP` now and `BiDi` incrementally where it is production-safe.
- Stall policy decision (Option 1) is fixed: use a dedicated build-safe shared contract module (`packages/ops-contracts`) with single import alias ownership for extension + core runtimes.
- Defer hard deprecation of `/cdp` until capability and reliability scorecards are green.

### Non-goals
- No immediate removal of `/cdp`.
- No claim of full CDP parity through BiDi in initial phases.
- No rewrite of extension transport stack in a single release.

### Operational guardrails (required)
- Kill switch: configuration and CLI-level override must force legacy `/cdp` routing for new sessions without code rollback.
- Version gating: `/ops` must enforce strict minimum versions with deterministic failures and no silent downgrade; `/cdp` may remain available only via explicit legacy-routing opt-in, within the defined compatibility window, and with full relay security checks.
- Fallback policy: `/ops` execution may use internal adapter fallback (for example `BiDiAdapter` -> `CDPAdapter`) only within `/ops`; it must never auto-reroute to `/cdp` unless explicitly opted in by operator intent.
- Lease enforcement: `/ops` requests without valid ownership context must fail deterministically (`not_owner`-class errors).
- Lease enforcement parity: `/cdp` requests must enforce per-session ownership/lease checks and fail deterministically with `not_owner`-class errors (`relay_cdp_not_owner`) when ownership is missing or mismatched.
- Input safeguards: payload limits, rate limits, and timeout caps are mandatory for both `/ops` and `/cdp`; `/cdp` limits must be equal to or stricter than `/ops`, and must be enforced at the relay edge.
- Relay perimeter parity: `/ops` must enforce auth/origin checks that are the same as or stricter than `/cdp` at the relay edge.
- Origin policy: `null` origin is always rejected for both `/ops` and `/cdp`; extension-origin allowlist remains required.
- Pairing and loopback policy: loopback source alone is never sufficient for `/cdp`; deterministic auth behavior is required in both pairing modes.
  - Pairing enabled: missing/invalid pairing token is rejected for both `/ops` and `/cdp`.
  - Pairing disabled: `/cdp` still requires relay auth token plus successful legacy lease handshake; unauthenticated loopback fails with `relay_auth_required`.
- Legacy `/cdp` route-policy gates: relay config `allowRawCDP=true` is mandatory for any `/cdp` session, and `allowNonLocalCdp=true` is additionally mandatory for non-loopback clients, regardless of CLI routing flags.
- Authorization context isolation: `/ops` lease/ownership context cannot authorize `/cdp`; `/cdp` authorization cannot satisfy `/ops` lease checks.
- Correlation policy: every CLI-dispatched request must carry a `requestId`; every session-bound request must also carry a `sessionId`; both identifiers must be propagated through relay, `/ops`, and adapter logs/errors. `requestId`/`sessionId` are trace-only and must never be used as metric labels.

---

## Enforcement ownership map (authoritative)

- CLI/client preflight:
  - Enforce minimum supported client-version requirements before request dispatch.
  - Validate operator-selected routing controls and fail early on invalid combinations.
  - Generate `requestId`, attach session identifier context for session-bound commands, validate rollout allowlist identifier format, and reject invalid rollout controls before dispatch.
  - Emit only `cli_*` deterministic errors for preflight failures.
- Relay handshake/request gate:
  - Enforce origin allowlist, deterministic `null`-origin rejection, pairing-token checks, unauthenticated loopback rejection, endpoint route policy, relay config gates (`allowRawCDP`, `allowNonLocalCdp`), and `/ops` + `/cdp` payload/rate/timeout limits.
  - Enforce `/cdp` per-session ownership/lease map checks at relay edge and reject non-owner access with deterministic `relay_cdp_not_owner`.
  - Enforce relay/extension compatibility checks at handshake time.
  - Resolve deterministic rollout identity + bucket for `--ops-routing=auto` and record route decision observability fields.
  - Emit only `relay_*` deterministic errors for relay-edge rejections.
- Ops runtime/adapter execution:
  - Enforce `/ops` lease ownership, command-level schema validation, and per-session capability checks.
  - Propagate inbound `requestId`/`sessionId` through adapter execution and fault translation.
  - Translate backend/adapter faults to stable `ops_*` or `adapter_*` errors.
  - Emit only runtime-layer deterministic errors after relay acceptance.
- Deterministic error-source rule:
  - The first rejecting layer is the source of truth for `error.code`; downstream layers must not rewrite it.
  - Errors must include `errorSource` with one of: `cli`, `relay`, `ops`, `adapter`, must include `requestId`, and must include `sessionId` when command scope is session-bound.

---

## Task 1 — Define the authoritative `/ops` capability contract

### Reasoning
Without a strict capability contract, `/ops` can drift into an ad hoc mirror of `/cdp`, which reintroduces protocol leakage and unstable client behavior.

### What to do
Define and freeze `/ops` capability taxonomy, request/response semantics, and deterministic error model independent of the backing protocol, with canonical contract definitions/versioning owned by `packages/ops-contracts`.

### How
1. Catalog current `/ops` commands and map them into capability groups (session, targets, navigation, interaction, DOM, export, diagnostics).
2. Define normative semantics per capability: inputs, outputs, idempotency, timeout model, ownership/lease behavior.
3. Define protocol-neutral error classes with stable codes and retryability semantics.
4. Mark capabilities as `core` (must work across adapters) vs `extended` (adapter-conditional).
5. Document capability/version negotiation rules for forward compatibility.
6. Define `/ops` contract types once in `packages/ops-contracts` and require relay + extension schema surfaces to consume those exports, with tests that fail on drift or duplicate definitions.

### Files impacted
- `src/relay/protocol.ts`
- `extension/src/types.ts`
- `extension/src/ops/ops-runtime.ts`
- `src/browser/ops-browser-manager.ts`
- `src/browser/ops-client.ts`
- `packages/ops-contracts/src/index.ts`
- `packages/ops-contracts/src/version.ts` (new file)
- `docs/CLI.md`
- `docs/OPS_FIRST_ARCHITECTURE_PLAN_SPEC.md`

### End goal
`/ops` is a stable product contract that clients can trust without knowing or depending on CDP details.

### Acceptance criteria
- [ ] Every `/ops` command has a single protocol-neutral contract definition in `packages/ops-contracts` that is consumed by both relay and extension schema surfaces.
- [ ] `packages/ops-contracts/src/version.ts` defines `OPS_CONTRACT_VERSION` and `OPS_MIN_COMPAT_VERSION`, and these values are surfaced by relay/CLI status + version-gating paths.
- [ ] Error codes are documented and deterministic for all commands, with contract tests asserting stable codes for invalid inputs.
- [ ] Capability classification (`core`/`extended`) is documented and testable.
- [ ] Contract docs in `docs/CLI.md` are synchronized with protocol types.

---

## Task 2 — Introduce protocol adapter boundary

### Reasoning
An explicit adapter boundary is required to avoid coupling ops semantics directly to CDP call patterns and to enable future BiDi adoption without public API breakage.

### What to do
Create internal adapter boundaries and route ops command execution through protocol/domain interfaces rather than direct CDP calls, with the same contract usable by extension-mode and managed-mode runtimes.

### How
1. Implement the chosen dedicated shared-contract module at `packages/ops-contracts/` with `src/protocol-adapter.ts`, `src/dom-bridge-contract.ts`, `src/version.ts`, and `src/index.ts`; this package is the only source of truth for adapter contracts and contract versions across runtime boundaries.
2. Enforce import alias strategy: extension and core runtime must import contracts only from `@opendevbrowser/ops-contracts`; direct relative imports between `src/` and `extension/src/` for contract types are prohibited and blocked via deterministic lint/test guards.
3. Define module resolution, dependency wiring, and build ownership explicitly:
   - `packages/ops-contracts/package.json` must expose `main`, `types`, and `exports` from `dist/*` so runtime and extension builds resolve one canonical contract package.
   - Root `package.json` must declare `@opendevbrowser/ops-contracts` as a workspace/file dependency (`file:packages/ops-contracts` or workspace equivalent), not as duplicated local source copies.
   - `packages/ops-contracts/tsconfig.json` owns contract compile/declaration emit to `packages/ops-contracts/dist`.
   - Root runtime build (`npm run build`) and extension build (`npm run extension:build`) both depend on `npm run build:ops-contracts`.
   - Root and extension tsconfig path resolution must target the dedicated package output/exports, not duplicated local copies.
   - Extension build output (`extension/dist/**`) must not contain unresolved bare `@opendevbrowser/ops-contracts` specifiers; emitted bundle/runtime artifacts must resolve contract imports without workspace-only path assumptions.
4. Implement `CDPAdapter` first with explicit runtime ownership: `extension/src/ops/cdp-adapter.ts` for extension mode and `src/browser/managed-cdp-adapter.ts` for managed mode.
5. Implement managed-mode DOM/action boundary in `src/browser/managed-dom-bridge.ts`, and wire adapter lifecycle/selection ownership in `src/browser/browser-manager.ts` (managed mode) and `extension/src/ops/ops-runtime.ts` (extension mode).
6. Refactor ops runtime orchestration to depend on adapter interfaces rather than direct CDP calls.
7. Keep adapter-specific metadata internal; avoid surfacing protocol internals in `/ops` responses.
8. Add adapter health and capability flags for runtime diagnostics and a shared conformance suite that runs against extension-mode and managed-mode adapter implementations.
9. Preserve existing snapshot and DOM execution semantics while moving orchestration to adapter boundaries.
10. Add failure containment controls with deterministic per-session circuit-breaker semantics: trip after `5` adapter faults in a rolling `60s` window per session, disable that session's adapter path for `120s`, transition to `half_open` with a single probe, and reset to `closed` after `10` consecutive successful ops (or session restart).
11. Prohibit automatic global adapter disable; global disable is allowed only via explicit operator action (`OPENDEVBROWSER_OPS_KILL_SWITCH=1` or `ops.killSwitch=true`).
12. Expose required adapter-disable diagnostics fields: `adapterCircuitState` (`closed|open|half_open`), `adapterDisableReason`, `adapterFaultCountWindow`, `adapterCooldownUntil`, and `adapterScope` (`session|operator_global`).

Adapter-health reporting and aggregation contract (required):
- Transport and ownership:
  - Extension mode must emit adapter-health envelopes over the authenticated relay `/ops` control channel.
  - Managed mode must emit the same envelopes into relay-owned in-process aggregation, normalized to the same schema before persistence.
- Envelope schema (`ops.adapter.health.v1`):
  - `type`: fixed `ops.adapter.health.v1`
  - `event`: `snapshot|fault|transition`
  - `emittedAt`: RFC3339 UTC timestamp
  - `sessionId`: required
  - `requestId`: required for request-scoped `fault|transition`; optional for periodic `snapshot`
  - `adapter`: `cdp|bidi`
  - `route`: fixed `ops`
  - `circuitState`: `closed|open|half_open`
  - `faultCountWindow`: integer
  - `windowSeconds`: integer (default `60`)
  - `cooldownUntil`: RFC3339 UTC timestamp or `null`
  - `disableReason`: `fault_threshold|operator_global|manual_reset|session_restart|unknown`
  - `scope`: `session|operator_global`
  - `consecutiveSuccesses`: integer
  - `sessionEpoch`: string-encoded uint64; increments when an emitter restarts or rebinds to an existing `sessionId`
  - `seq`: string-encoded uint64; monotonic within (`sessionId`, `sessionEpoch`) and reset to `"0"` on epoch increment
- Cadence and failure semantics:
  - Emit `snapshot` at least every `10s`, and emit `transition` immediately on each circuit-state change.
  - Emit `fault` before translating adapter failures into client-visible `ops_*`/`adapter_*` errors.
  - Delivery is at-least-once; relay deduplicates by (`sessionId`, `sessionEpoch`, `seq`, `event`) and retains highest-seen (`sessionEpoch`, `seq`) tuple.
  - If no `snapshot` arrives for `>=30s`, relay marks `adapterHealthStale=true`, preserves last known circuit state, and sets `adapterHealthLastSeenAt`.
  - On emitter restart/reconnect for an existing `sessionId`, the emitter must increment `sessionEpoch`; relay must accept only the newest epoch and drop older-epoch replays.
- Source of truth and persistence:
  - Relay/hub `AdapterHealthStore` is authoritative for status and metrics; extension/runtime producers are non-authoritative emitters.
  - Relay persists accepted envelopes to `artifacts/ops-health/YYYYMMDD/adapter-health.jsonl` and replays journal state on relay restart.
  - Per-session circuit state is retained until session close plus `15m` retention; status and metrics must serve persisted last-known state even when adapter execution is degraded/unavailable.
- Retention, permissions, and cleanup policy (required):
  - `artifacts/ops-health/YYYYMMDD/` directories must be mode `0700`; persisted journal files must be mode `0600`.
  - `adapter-health.jsonl` must rotate at `64MiB` max segment size (`adapter-health-0001.jsonl`, `adapter-health-0002.jsonl`, ...).
  - Retention window is `30d` for rotated adapter-health journals; cleanup/prune runs at least every `24h` and once on relay startup.
  - Disk-usage alert is mandatory when `artifacts/ops-health` exceeds `2GiB` or underlying volume usage exceeds `80%`; emit `ops_artifacts_disk_usage_bytes{artifact_set="ops-health"}` and `ops_artifacts_volume_usage_ratio{artifact_set="ops-health"}` and trigger alert after `15m` sustained breach.

### Files impacted
- `extension/src/ops/ops-runtime.ts`
- `extension/src/ops/cdp-adapter.ts` (new file)
- `extension/src/ops/dom-bridge.ts`
- `extension/src/ops/snapshot-builder.ts`
- `extension/src/ops/snapshot-shared.ts`
- `extension/src/services/CDPRouter.ts`
- `extension/src/services/TargetSessionMap.ts`
- `src/browser/browser-manager.ts`
- `src/browser/managed-cdp-adapter.ts` (new file)
- `src/browser/managed-dom-bridge.ts` (new file)
- `packages/ops-contracts/src/protocol-adapter.ts` (new file)
- `packages/ops-contracts/src/dom-bridge-contract.ts` (new file)
- `packages/ops-contracts/src/version.ts` (new file)
- `packages/ops-contracts/src/index.ts` (new file)
- `packages/ops-contracts/package.json` (new file)
- `packages/ops-contracts/tsconfig.json` (new file)
- `package.json`
- `tsconfig.json`
- `extension/tsconfig.json`
- `eslint.config.js`
- `tests/contracts-import-boundary.test.ts` (new file)
- `src/relay/protocol.ts`

### End goal
Ops runtime becomes protocol-agnostic at orchestration level, with CDP encapsulated behind adapter implementation.

### Acceptance criteria
- [ ] `npm run build:ops-contracts` produces `packages/ops-contracts/dist/index.js`, `packages/ops-contracts/dist/index.d.ts`, `packages/ops-contracts/dist/version.js`, and `packages/ops-contracts/dist/version.d.ts`, and both `npm run build` and `npm run extension:build` succeed without contract-path overrides.
- [ ] Root dependency wiring resolves one package identity (`@opendevbrowser/ops-contracts` via workspace/file dependency), and extension output check (`rg -n "@opendevbrowser/ops-contracts" extension/dist`) returns `0` unresolved bare-specifier hits.
- [ ] Import-boundary lint rule check (`npm run lint -- --max-warnings=0`) enforces `no-restricted-imports` against cross-root relative contract imports.
- [ ] Import-boundary regression test (`npm run test -- tests/contracts-import-boundary.test.ts -t "contracts imports resolve only via @opendevbrowser/ops-contracts"`) passes deterministically.
- [ ] Extension non-regression check (`npm run test -- tests/extension-relay-client.test.ts tests/extension-connection-manager.test.ts tests/remote-relay.test.ts`) passes after adapter-boundary refactor.
- [ ] Managed-mode isolation check (`npm run test -- tests/ops-browser-manager.test.ts -t "adapter faults stay session-scoped"`) passes with `0` cross-session failures.
- [ ] Adapter conformance check (`npm run test -- tests/ops-browser-manager.test.ts -t "cdp adapter conformance"`) passes for extension-mode and managed-mode adapters.
- [ ] Circuit-breaker check (`npm run test -- tests/ops-browser-manager.test.ts -t "adapter circuit breaker thresholds"`) asserts `5` faults/`60s`, `120s` cooldown, `half_open` probe, and reset after `10` successful ops.
- [ ] Status diagnostics check (`npm run test -- tests/remote-relay.test.ts -t "adapter diagnostics fields"`) confirms `adapterCircuitState`, `adapterDisableReason`, `adapterFaultCountWindow`, `adapterCooldownUntil`, and `adapterScope`.
- [ ] Global-disable guard check (`npm run test -- tests/relay-server.test.ts -t "operator global disable requires explicit action"`) passes and rejects automatic global disable transitions.
- [ ] Adapter-health contract test (`npm run test -- tests/relay-server.test.ts -t "adapter health envelope v1 is validated and deduplicated"`) passes for extension-mode and managed-mode emitters.
- [ ] Relay source-of-truth degradation test (`npm run test -- tests/remote-relay.test.ts -t "status and metrics use relay AdapterHealthStore during adapter degradation"`) passes and asserts `adapterHealthStale` + last-known circuit fields are present.
- [ ] Persistence replay test (`npm run test -- tests/relay-server.test.ts -t "adapter health journal replay restores per-session circuit state"`) passes across relay restart simulation.
- [ ] Adapter-health retention test (`npm run test -- tests/relay-server.test.ts -t "adapter health journal retention permissions and disk guardrails"`) passes and verifies `0700/0600` modes, `64MiB` rotation, `30d` retention with daily prune, and disk-usage alert thresholds.

---

## Task 3 — Define compatibility posture for `/cdp` legacy path

### Reasoning
Immediate removal of `/cdp` is high-risk for power users and internal workflows that depend on raw protocol access.

### What to do
Codify `/cdp` as an explicit compatibility lane with stricter policy and clear migration guidance.

### How
1. Keep `/cdp` behind explicit opt-in (explicit `/cdp` endpoint and any configured CLI legacy flag) and admin-aware policy.
2. Scope `/cdp` to advanced/escape-hatch scenarios; discourage default usage in docs and CLI hints.
3. Ensure `/cdp` and `/ops` status semantics are additive and non-conflicting.
4. Publish migration guidance from representative `/cdp` workflows to `/ops` equivalents.
5. Define deprecation gates based on parity scorecard targets (coverage, reliability, support burden).

### Compatibility and version-skew rules
- `/ops` minimum compatible CLI/relay/extension version gating is route-scoped to `/ops` (explicit `--ops-routing=ops` or `--ops-routing=auto` resolved to `/ops`); unsupported combinations must fail with explicit machine-readable errors.
- `/cdp` legacy routing is allowed only through explicit operator opt-in (`--ops-routing=legacy-cdp`, `--force-legacy-cdp`, or explicit rollout controls under `--ops-routing=auto`) and only after relay-edge auth/origin/pairing checks pass.
- Relay config gates are authoritative for legacy `/cdp` regardless of CLI flags: `allowRawCDP=true` is mandatory for all legacy `/cdp`, and non-loopback legacy `/cdp` additionally requires `allowNonLocalCdp=true`.
- Deterministic loopback auth behavior applies when pairing is disabled: loopback clients must still present relay auth and complete legacy lease handshake; missing auth fails with `relay_auth_required`.
- Explicit legacy `/cdp` routing within the `N/N-1` window must remain available even when one or more components are `< /ops min`; status/handshake diagnostics must set `opsRouteBlockedReason=version_unsupported` and `opsRolloutDecisionReason` with deterministic legacy-selection reason (`explicit_mode|allowlist|percent`).
- `/cdp` safeguard parity is mandatory at relay edge with equal-or-stricter limits than `/ops`: `/ops` cap `payload<=256KiB`, `rate<=60 req/min/session` (burst `10`), `timeout<=30s`; `/cdp` cap `payload<=128KiB`, `rate<=30 req/min/session` (burst `5`), `timeout<=20s`.
- `/cdp` ownership/lease enforcement is mandatory per session; missing or mismatched ownership fails deterministically with `relay_cdp_not_owner` (`errorSource=relay`).
- Compatibility window policy:
  - `/ops`: each component must be in `N` or `N-1` and also satisfy `/ops` minimum contract version requirements.
  - `/cdp` legacy lane: each component must be in `N` or `N-1`; anything older or newer fails deterministically with `relay_legacy_window_exceeded`.
- The runtime must not silently downgrade from `/ops` to `/cdp` without explicit user/operator opt-in.
- Internal adapter fallback (`BiDiAdapter` -> `CDPAdapter`) is allowed only inside `/ops` execution and must not switch endpoint routing to `/cdp`.
- `/cdp` route fallback requires explicit operator routing opt-in; otherwise runtime must fail deterministically with `relay_legacy_cdp_opt_in_required`.
- Status endpoint availability is mandatory even when `/ops` adapter execution is degraded/unhealthy: status must be served from relay/hub control-plane state and must still include rollback/routing fields plus adapter health summary.
- Status output must include active transport path, negotiated capability/version details, compatibility-window evaluation, and legacy-lane constraints when applicable.

### Legacy `/cdp` ownership acquisition and deprecation timeline (required)
- Ownership/lease acquisition path (deterministic):
  - Step 1: client explicitly selects legacy routing (`--ops-routing=legacy-cdp` or deterministic `auto` selection) and passes relay auth/origin/pairing checks plus `allowRawCDP`/`allowNonLocalCdp` config gates.
  - Step 2: client opens a new legacy `/cdp` session handshake and receives `cdpLeaseId`, `leaseOwnerId`, `leaseExpiresAt`, and `legacyLeaseMode` (`explicit|transitional`).
  - Step 3: each `/cdp` command must carry `sessionId` and `cdpLeaseId`; relay validates lease ownership and rejects mismatches with `relay_cdp_not_owner`.
  - Step 4: lease TTL is `15m`; renewals are explicit; expired leases fail with `relay_cdp_lease_expired` and require a new legacy session handshake.
- Transitional binding and deprecation timeline:
  - `N`: transitional binding is allowed only for already-authenticated legacy clients that predate lease fields; every transitional request emits deprecation warning metadata.
  - `N+1`: transitional binding defaults to disabled; temporary override requires explicit relay config `allowLegacyCdpTransitionalBinding=true`.
  - `N+2`: transitional binding is removed; all `/cdp` requests must use handshake-issued explicit leases.
  - `N+3`: `/cdp` disable-by-default decision is evaluated against Task 4 hardened scorecard and support-burden gates.

### Versioning semantics (required)
- Version format is strict SemVer `major.minor.patch[-prerelease][+build]` for CLI, relay/hub, extension, and `/ops` contract versions; invalid SemVer fails with deterministic `*_version_invalid`.
- Comparison rules:
  - Use SemVer precedence on `major`, `minor`, `patch`, and `prerelease`.
  - Ignore build metadata (`+...`) for compatibility decisions.
  - Prerelease versions are lower precedence than stable versions.
- `N`/`N-1` operational definition:
  - `N` is the relay/hub binary stable train (`relayVersion` -> `major.minor`).
  - `N-1` is the previous minor in the same major (`major`, `minor-1`); when `minor=0`, `N-1` is not defined and only `N` is accepted for legacy-window checks.
  - Patch version may vary inside allowed `N`/`N-1` trains.
  - Prerelease components are rejected by default with `relay_prerelease_unsupported`; prerelease interoperability is allowed only when all components match the exact same prerelease tag and `ops.allowPrereleaseInterop=true`.
- Authoritative version sources and surfaces:
  - Binary/component version source: build-time package version surfaced as `relayVersion`, `cliVersion`, `extensionVersion`.
  - `/ops` contract source: `packages/ops-contracts/src/version.ts` exports `OPS_CONTRACT_VERSION` and `OPS_MIN_COMPAT_VERSION`.
  - Relay status/handshake must surface: `versionScheme` (`semver`), `compatibilityWindowN`, `compatibilityWindowNMinus1`, `opsContractVersion`, and `opsMinContractVersion`.
  - CLI preflight/handshake must evaluate these surfaced values deterministically by selected route: reject `/ops` route attempts with `cli_version_unsupported`/`relay_ops_version_unsupported`; allow explicit legacy `/cdp` route within `N/N-1`; reject out-of-window legacy attempts with `relay_legacy_window_exceeded`.

### Status schema compatibility policy (required)
- Status payload evolution is strictly additive for fields consumed by CLI/tools; existing field names, types, and semantics are immutable within a major schema version.
- Status payloads must include `statusSchemaVersion` (SemVer-like `major.minor`) so older CLI parsers can apply compatibility rules explicitly.
- Older (`N-1`) CLI parsers must ignore unknown additive fields without failure; removals/renames require a schema-major increment and compatibility release note.

### Config and flag backward-compatibility policy (required)
- Config schema and migration:
  - Introduce explicit `configSchemaVersion` (integer) in config metadata.
  - New keys must be additive and namespaced under `ops.*`; removal/rename requires migrator entries for `N -> N+1` and downgrade notes for `N+1 -> N`.
- Unknown keys and missing keys:
  - Unknown config keys must be ignored with warning (`config_unknown_key_ignored`) by default to keep downgrade-safe startup.
  - `--strict-config` (or `ops.strictConfig=true`) upgrades unknown-key warnings to deterministic startup failure.
  - Missing keys must resolve to deterministic defaults: `ops.routingMode=ops`, `ops.rolloutPercent=100`, `ops.rolloutAllowlist=[]`, `ops.activeSessionPolicy=continue`, `ops.allowPrereleaseInterop=false`.
- Downgrade-safe behavior:
  - Older binaries must not crash on newer `ops.*` keys and must not silently reinterpret unsupported values.
  - If downgrade cannot safely interpret effective `/ops` routing controls, runtime must force `legacy-cdp`, set `configDowngradeFallback=true`, and surface `configDowngradeReason` in status.
  - Binaries must not rewrite config by default during downgrade runs; unknown keys must be preserved on disk.
- Mixed-version flag precedence and unsupported flags:
  - Existing precedence order remains authoritative across mixed versions.
  - Unsupported CLI flags must fail fast with `cli_flag_unsupported`; they must never be ignored.
  - If a higher-precedence source selects a mode unsupported by negotiated remote capabilities, preflight/handshake must fail deterministically instead of falling back silently.

### Routing controls, rollback runbook, and version compatibility matrix
- Named controls:
  - `OPENDEVBROWSER_OPS_KILL_SWITCH=1` (emergency hard override)
  - CLI `--ops-routing=ops|legacy-cdp|auto` (explicit route mode)
  - CLI `--force-legacy-cdp` (alias for `--ops-routing=legacy-cdp`)
  - CLI `--ops-rollout-percent=0..100` (deterministic ramp when `--ops-routing=auto`)
  - CLI `--ops-rollout-allowlist=<id1,id2,...>` (deterministic legacy routing allowlist when `--ops-routing=auto`)
  - Config `ops.killSwitch` and `ops.routingMode`
  - Config `ops.rolloutPercent` and `ops.rolloutAllowlist`
  - CLI `--ops-active-session-policy=continue|drain|terminate` (active `/ops` session incident handling)
  - Config `ops.activeSessionPolicy` (`continue|drain|terminate`)
- Precedence (highest to lowest): `OPENDEVBROWSER_OPS_KILL_SWITCH` → CLI route flags (`--ops-routing`, `--force-legacy-cdp`) → CLI rollout controls (`--ops-rollout-percent`, `--ops-rollout-allowlist`) → config `ops.killSwitch` → config `ops.routingMode` → config rollout controls (`ops.rolloutPercent`, `ops.rolloutAllowlist`) → default `ops`.
- `--ops-routing=auto` deterministic selection (required):
  - Resolve canonical rollout identity in priority order: authenticated CLI session identity → authenticated pairing identity → extension installation identity → lease owner identity; if no identity exists, fail with `relay_rollout_identity_missing`.
  - Canonical identity format: `<namespace>:<value>` where `namespace` is one of `cli|pairing|extension|lease`; normalize to lowercase and validate against `^(cli|pairing|extension|lease):[a-z0-9][a-z0-9._:-]{2,127}$`.
  - Allowlist entries for `--ops-rollout-allowlist` and `ops.rolloutAllowlist` must use the same canonical identity format; invalid entries fail preflight with `cli_rollout_allowlist_invalid`.
  - Record allowlist source as `cli|config|default` and validation outcome as `valid|invalid|not_set` in status diagnostics.
  - Compute `opsRolloutHashInput = "ops-rollout-v1:" + opsRolloutIdentity`; then compute `opsRolloutBucket = uint32be(sha256(opsRolloutHashInput)[0..3]) % 100`.
  - Route decision:
    - If kill switch or explicit legacy mode is set, route legacy.
    - Else if canonical identity is in allowlist, route legacy with decision reason `allowlist`.
    - Else if `opsRolloutBucket < opsRolloutPercent`, route `/ops` with decision reason `percent`.
    - Else route legacy with decision reason `percent`.
  - Sessions selected for legacy route use `/cdp` only if compatibility-window and relay security checks pass; otherwise fail with `relay_legacy_route_unavailable`.
  - `/ops` preflight/handshake/capability rejection must fail deterministically and must not switch that session to `/cdp` unless it was explicitly selected for legacy routing by the deterministic selection above.
- Rollback execution behavior:
  - New sessions switch immediately to effective routing mode after control change.
  - In-flight sessions are not live-migrated between `/ops` and `/cdp`.
  - Active `/ops` sessions follow `ops.activeSessionPolicy`:
    - `continue`: existing sessions remain active until disconnect.
    - `drain`: reject new commands with `relay_ops_draining`; allow current in-flight command completion, then close session.
    - `terminate`: immediately close active sessions and fail pending/in-flight requests with `relay_ops_terminated`.
  - Operator rollback validation is mandatory before promotion/unset.
- Rollback verification checklist (`status` diagnostics must expose these fields):
  - `effectiveRoutingMode`
  - `opsKillSwitchSource` (`env|cli|config|default`)
  - `opsRolloutPercent`
  - `opsRolloutAllowlistSize`
  - `opsRolloutAllowlistSource` (`cli|config|default`)
  - `opsRolloutAllowlistValidation` (`valid|invalid|not_set`)
  - `opsRolloutIdentityNamespace` (`cli|pairing|extension|lease`)
  - `opsRolloutIdentitySource` (`cli|pairing|extension|lease`)
  - `opsRolloutIdentityHash` (first 12 hex chars of `sha256(identity)`)
  - `opsRolloutBucket` (`0..99`)
  - `opsRolloutDecision` (`ops|legacy-cdp`)
  - `opsRolloutDecisionReason` (`explicit_mode|kill_switch|allowlist|percent|legacy_unavailable`)
  - `opsRouteBlockedReason` (`version_unsupported|capability_mismatch|null`)
  - `activeOpsSessions`
  - `activeCdpSessions`
  - `opsActiveSessionPolicy` (`continue|drain|terminate`)
  - `opsDrainState` (`inactive|draining|terminating`)
  - `opsSessionsDrainedCount`
  - `opsSessionsTerminatedCount`
  - `unsupportedVersionCount`
  - `versionScheme` (`semver`)
  - `statusSchemaVersion` (`major.minor`)
  - `compatibilityWindowN`
  - `compatibilityWindowNMinus1`
  - `opsContractVersion`
  - `opsMinContractVersion`
  - `configDowngradeFallback` (boolean)
  - `configDowngradeReason` (string or `null`)
  - `lastRoutingChangeAt`

Rollback validation procedure (required):
1. `TS="$(date -u +%Y%m%dT%H%M%SZ)"; ARTIFACT_DIR="artifacts/ops-gates/${TS}"; mkdir -p "$ARTIFACT_DIR"`
2. `opendevbrowser status --output json > "$ARTIFACT_DIR/rollback-status-before.json"`
3. `jq -e '.activeCdpSessions|type=="number"' "$ARTIFACT_DIR/rollback-status-before.json"`
4. `node scripts/ops/smoke-legacy-cdp.mjs --routing legacy-cdp --method Browser.getVersion --output "$ARTIFACT_DIR/legacy-cdp-smoke.json"`
5. `jq -e '.result=="pass" and .route=="legacy-cdp" and .command.method=="Browser.getVersion" and .command.success==true' "$ARTIFACT_DIR/legacy-cdp-smoke.json"`
6. `jq -e '.status.activeCdpSessionsDuring >= (.status.activeCdpSessionsBefore + 1)' "$ARTIFACT_DIR/legacy-cdp-smoke.json"`
7. `jq -e '.cleanup.success==true and .status.activeCdpSessionsAfter == .status.activeCdpSessionsBefore' "$ARTIFACT_DIR/legacy-cdp-smoke.json"`
8. `opendevbrowser status --output json > "$ARTIFACT_DIR/rollback-status.json"`
9. `jq -e '.effectiveRoutingMode=="legacy-cdp"' "$ARTIFACT_DIR/rollback-status.json"`
10. `jq -e '.opsKillSwitchSource|test("^(env|cli|config)$")' "$ARTIFACT_DIR/rollback-status.json"`
11. `jq -e '.opsActiveSessionPolicy|test("^(continue|drain|terminate)$")' "$ARTIFACT_DIR/rollback-status.json"`
12. `jq -e '.opsDrainState|test("^(inactive|draining|terminating)$")' "$ARTIFACT_DIR/rollback-status.json"`
13. `jq -e 'has("lastRoutingChangeAt") and has("activeOpsSessions") and has("activeCdpSessions") and has("opsRolloutPercent") and has("opsRolloutAllowlistSize") and has("opsRolloutAllowlistSource") and has("opsRolloutAllowlistValidation") and has("opsRolloutIdentityNamespace") and has("opsRolloutIdentitySource") and has("opsRolloutIdentityHash") and has("opsRolloutBucket") and has("opsRolloutDecision") and has("opsRolloutDecisionReason") and has("opsRouteBlockedReason") and has("versionScheme") and has("statusSchemaVersion") and has("compatibilityWindowN") and has("compatibilityWindowNMinus1") and has("opsContractVersion") and has("opsMinContractVersion") and has("configDowngradeFallback") and has("configDowngradeReason")' "$ARTIFACT_DIR/rollback-status.json"`
14. `jq '{effectiveRoutingMode,opsKillSwitchSource,opsActiveSessionPolicy,opsDrainState,activeOpsSessions,activeCdpSessions,opsSessionsDrainedCount,opsSessionsTerminatedCount,opsRolloutPercent,opsRolloutAllowlistSize,opsRolloutAllowlistSource,opsRolloutAllowlistValidation,opsRolloutIdentityNamespace,opsRolloutIdentitySource,opsRolloutIdentityHash,opsRolloutBucket,opsRolloutDecision,opsRolloutDecisionReason,opsRouteBlockedReason,versionScheme,statusSchemaVersion,compatibilityWindowN,compatibilityWindowNMinus1,opsContractVersion,opsMinContractVersion,configDowngradeFallback,configDowngradeReason,lastRoutingChangeAt}' "$ARTIFACT_DIR/rollback-status.json" > "$ARTIFACT_DIR/rollback-assertions.json"`

Alert policy and incident-response ownership (required):

| Trigger | Severity | Owner | Channel | Window | Required first action |
|---------|----------|-------|---------|--------|-----------------------|
| Ops error rate `> 2.0%` for 2 consecutive hours | `SEV-2` | Runtime on-call | `#opendevbrowser-alerts` + PagerDuty `opendevbrowser-runtime` | `2h` | Set `OPENDEVBROWSER_OPS_KILL_SWITCH=1`, apply `--ops-active-session-policy=drain`, run rollback validation procedure. |
| Confirmed auth/lease bypass | `SEV-1` | Security on-call + release owner | `#security-incidents` + PagerDuty `opendevbrowser-security` | Immediate | Force `--ops-routing=legacy-cdp`, rotate relay credentials/tokens, preserve incident artifacts. |
| Ops p95 latency `> 2.0x` baseline for 4 consecutive hours | `SEV-2` | Release owner + runtime on-call | `#opendevbrowser-alerts` | `4h` | Reduce rollout to `0`, keep legacy routing until gate recovers, run rollback validation procedure. |
| `ops_artifacts_disk_usage_bytes{artifact_set="ops-health"} > 2147483648` OR `ops_artifacts_volume_usage_ratio{artifact_set="ops-health"} > 0.80` | `SEV-3` | Runtime on-call | `#opendevbrowser-alerts` | `15m` | Run immediate `ops-health` prune/rotation, verify disk recovers below threshold, and preserve prune report in rollback artifacts. |
| `ops_artifacts_disk_usage_bytes{artifact_set="ops-gates"} > 5368709120` OR `ops_artifacts_volume_usage_ratio{artifact_set="ops-gates"} > 0.80` | `SEV-3` | Release owner + runtime on-call | `#opendevbrowser-alerts` | `15m` | Run immediate gate-artifact prune (respecting `30d`/`500` retention policy), then rerun artifact validator and attach results. |

Incident response steps:
1. Runtime on-call acknowledges and applies first-action routing controls.
2. Release owner executes rollback validation commands and publishes artifact path `artifacts/ops-gates/YYYYMMDDTHHmmssZ/`.
3. Security on-call joins immediately for any auth/lease bypass and owns containment verification.
4. If rollback does not stabilize within 30 minutes, escalate to maintainers for coordinated release freeze.

Compatibility matrix (deterministic behavior):

| CLI | Relay | Extension | Effective route mode | Required behavior |
|-----|-------|-----------|----------------------|-------------------|
| `N` or `N-1` and `>= /ops min` | `N` or `N-1` and `>= /ops min` | `N` or `N-1` and `>= /ops min` | `ops` or `auto` selected `/ops` | Supported; `/ops` allowed per routing policy. |
| any prerelease component without explicit prerelease interop | any | any | any | Fail deterministically with `relay_prerelease_unsupported`; no lease granted. |
| `< /ops min` | any | any | `ops` or `auto` selected `/ops` | Fail at preflight/handshake with `cli_version_unsupported` or `relay_ops_version_unsupported`; no `/ops` lease granted. |
| `N` or `N-1` (one or more `< /ops min`) | `N` or `N-1` | `N` or `N-1` | `legacy-cdp` or `auto` selected legacy | Allow explicit `/cdp` only (opt-in path), after auth/origin/pairing/ownership checks; expose `opsRouteBlockedReason=version_unsupported` and `opsRolloutDecisionReason`. |
| any component `< N-1` or `> N` | any | any | `legacy-cdp` or `auto` selected legacy | Fail at handshake with `relay_legacy_window_exceeded`; no session lease granted. |
| any supported mix with capability mismatch | `N` or `N-1` | `N` or `N-1` | `ops` or `auto` selected `/ops` | Fail with deterministic `relay_capability_mismatch`; no silent downgrade. |
| `/ops` preflight/handshake rejected in `auto` without explicit legacy selection | `N` or `N-1` | `N` or `N-1` | `auto` | Fail with deterministic `relay_ops_version_unsupported`/`relay_capability_mismatch`; no implicit `/ops` -> `/cdp` route switch. |

Mandatory rollout order:
1. Upgrade relay/hub first (accepts both old/new clients within supported window).
2. Upgrade extension next.
3. Upgrade CLI/tools/agents last.
4. Keep at least one overlapping supported version (`N` or `N-1`) at every step.

Mandatory rollback order:
1. Roll back CLI/tools/agents first.
2. Roll back extension second.
3. Roll back relay/hub last.
4. Preserve `N/N-1` overlap until rollback completes; if overlap would be broken, force `legacy-cdp` before continuing.

### Files impacted
- `docs/CLI.md`
- `src/config.ts`
- `src/cli/args.ts`
- `src/cli/daemon-commands.ts`
- `src/relay/relay-server.ts`
- `src/relay/protocol.ts`
- `scripts/ops/smoke-legacy-cdp.mjs` (new file)

### End goal
`/cdp` remains available but intentionally constrained, while `/ops` is the primary interface for new integrations.

### Acceptance criteria
- [ ] `/cdp` is explicit opt-in in CLI/docs and not implied default behavior.
- [ ] Migration guide exists for common `/cdp` usage patterns.
- [ ] Status output distinguishes `/ops` and `/cdp` activity clearly.
- [ ] Policy constraints for `/cdp` are documented and enforced.
- [ ] Version mismatch behavior is deterministic and documented.
- [ ] Routing controls and precedence are documented and reflected in diagnostics.
- [ ] Rollback runbook defines deterministic behavior for new vs in-flight sessions.
- [ ] Drain/terminate policy for active `/ops` sessions is documented with deterministic error codes and status fields.
- [ ] `--ops-routing=auto` semantics are explicit and prohibit implicit `/ops` -> `/cdp` route switching.
- [ ] `--ops-routing=auto` deterministically computes identity, bucket, decision, and reason with canonical allowlist validation rules.
- [ ] Compatibility matrix and upgrade/rollback order are documented and test-gated.
- [ ] Rollback runbook includes exact validation commands, expected field assertions, and required artifact path `artifacts/ops-gates/YYYYMMDDTHHmmssZ/rollback-status.json`.
- [ ] Rollback runbook includes functional legacy `/cdp` smoke validation (new explicit session, `Browser.getVersion` success, `activeCdpSessions` increment, deterministic cleanup).
- [ ] Alert policy maps each rollback trigger to severity, owner, channel, and response window; incident-response ownership/escalation steps are explicit.
- [ ] Version-skew tests cover strict `/ops` gating plus constrained explicit `/cdp` opt-in behavior under mixed-version scenarios.
- [ ] Version-semantics tests (`npm run test -- tests/relay-server.test.ts -t "semver N/N-1 and ops min contract gating"`) pass, including prerelease rejection and `minor=0` `N-1` behavior.
- [ ] Route-scoped gating tests (`npm run test -- tests/relay-server.test.ts -t "ops min gating is route scoped and explicit legacy cdp remains available"`) pass and assert `opsRouteBlockedReason` + `opsRolloutDecisionReason`.
- [ ] `/cdp` ownership parity tests (`npm run test -- tests/relay-server.test.ts -t "/cdp ownership lease parity enforces relay_cdp_not_owner"`) pass for handshake and request execution paths.
- [ ] Legacy lease-acquisition tests (`npm run test -- tests/relay-server.test.ts -t "legacy cdp lease handshake and transitional binding timeline"`) pass for explicit lease mode, transitional `N` behavior, and `N+1`/`N+2` deprecation gates.
- [ ] Status-schema compatibility tests (`npm run test -- tests/remote-relay.test.ts -t "status schema additive compatibility for N-1 cli parser"`) pass and verify additive-field tolerance with `statusSchemaVersion`.
- [ ] Config-compatibility tests (`npm run test -- tests/config.test.ts -t "unknown keys, defaults, downgrade fallback"`) pass and assert `configDowngradeFallback` + `configDowngradeReason` status fields.
- [ ] Unsupported-flag tests (`npm run test -- tests/cli-args.test.ts -t "unsupported ops flags fail deterministically"`) pass with `cli_flag_unsupported`.
- [ ] Precedence tests verify kill switch, route flags, rollout controls, and config defaults with deterministic `effectiveRoutingMode`.
- [ ] Active-session policy tests assert exact `relay_ops_draining` and `relay_ops_terminated` codes plus required status counters.
- [ ] Safeguard parity test (`npm run test -- tests/relay-endpoints.test.ts -t "/cdp limits are stricter than /ops"`) passes and verifies relay-edge payload/rate/timeout enforcement.
- [ ] Status survivability test (`npm run test -- tests/relay-server.test.ts -t "status available when adapter fails"`) passes and asserts rollback fields remain present during forced adapter failure.

---

## Task 4 — Establish parity scorecard and rollout gates

### Reasoning
Architecture decisions need objective release gates; otherwise migration timing becomes subjective and risky.

### What to do
Define measurable parity and quality gates that determine rollout phases and any future `/cdp` deprecation decisions.

### How
1. Create scorecard dimensions: capability coverage, correctness, latency, stability, operator support incidents.
2. Set thresholds per phase (pilot, default, hardened, deprecation-candidate).
3. Add telemetry fields and logs needed to compute scorecard metrics.
4. Add release checklist tied to scorecard status.
5. Keep rollback criteria explicit and automatable.
6. Add deterministic recomputation script `scripts/ops/recompute-scorecard.mjs` and document the exact command used to recompute gate outcomes from status diagnostics.
7. Add telemetry-emission verification (fixture/snapshot or explicit assertions) that required labels are present for each scorecard metric family.

### Go/no-go gates (objective)
- Pilot gate:
  - Ops error rate `<= 1.0%` over 7 days.
  - Ops p95 latency `<= 1.5x` CDP baseline.
  - No P0/P1 incidents attributable to ops path over 7 days.
- Default gate:
  - Ops error rate `<= 0.3%` over 14 days.
  - Ops p95 latency `<= 1.2x` CDP baseline.
  - Crash-free session rate `>= 99.5%`.
- Hardened gate:
  - Ops error rate `<= 0.1%` over 30 days.
  - Ops p95 latency `<= 1.1x` CDP baseline.
  - No P0/P1 incidents attributable to ops path over 30 days.
- Rollback triggers:
  - Ops error rate `> 2.0%` for 2 consecutive hours.
  - Confirmed auth/lease bypass.
  - Ops p95 latency `> 2.0x` baseline for 4 consecutive hours.

### Required telemetry schema for scorecard computation

| Metric name | Type and unit | Required labels | Windows and baseline source |
|-------------|---------------|-----------------|-----------------------------|
| `ops_requests_total` | Counter (requests) | `command`, `route`, `adapter`, `mode`, `outcome`, `error_code` | Aggregate over `2h`, `7d`, `14d`, `30d` windows for error-rate gates. |
| `ops_request_latency_ms` | Histogram (milliseconds) | `command`, `route`, `adapter`, `mode` | p95 over `2h`, `7d`, `14d`, `30d`; compared to `cdp_baseline_latency_ms_p95`. |
| `ops_sessions_total` | Counter (sessions) | `route`, `adapter`, `mode`, `outcome` | Crash-free session rate over `14d` and `30d`. |
| `ops_incidents_total` | Counter (incidents) | `severity`, `route`, `source` | P0/P1 incident gates over `7d`, `14d`, `30d`. |
| `cdp_baseline_latency_ms_p95` | Gauge (milliseconds) | `command`, `mode`, `baseline_ref` | Baseline source is frozen trailing `30d` `/cdp` production metrics at phase start. |
| `ops_artifacts_disk_usage_bytes` | Gauge (bytes) | `artifact_set`, `path` | Alert when `artifact_set=ops-health` exceeds `2147483648` bytes or `artifact_set=ops-gates` exceeds `5368709120` bytes for `15m`. |
| `ops_artifacts_volume_usage_ratio` | Gauge (ratio) | `artifact_set`, `mount` | Alert when value exceeds `0.80` for `15m` for either `ops-health` or `ops-gates`. |

### Telemetry export surface ownership (required)
- Export surface: `GET /metrics` on relay/hub control plane.
- Emitting component ownership:
  - `src/relay/relay-server.ts` emits and serves route-level metrics for `/ops` and `/cdp`.
  - `extension/src/ops/ops-runtime.ts` and managed runtime adapter paths emit adapter health/failure events to relay aggregation.
- Format and cadence:
  - Wire format is OpenMetrics text (`text/plain; version=0.0.4` compatible).
  - Counters/histograms update per request; gauges/health snapshots refresh at least every `10s`.
  - Recommended scrape cadence is `15s`.
- Failure-path requirement: adapter failure must not suppress export; `/metrics` must still include request/error/latency families with failure outcomes populated.
- Cardinality guardrail: `requestId` and `sessionId` are mandatory in logs/errors (for session-bound commands) but must never be included in metric labels.

Required status/health scorecard surface (auditable go/no-go):
- `scorecard.window` (`2h|7d|14d|30d`)
- `scorecard.phase` (`pilot|default|hardened|deprecation-candidate`)
- `scorecard.opsErrorRatePct` (percentage)
- `scorecard.opsP95LatencyMs` (milliseconds)
- `scorecard.cdpBaselineP95LatencyMs` (milliseconds)
- `scorecard.latencyRatio` (unitless)
- `scorecard.crashFreeSessionRatePct` (percentage)
- `scorecard.p0p1IncidentCount` (count)
- `scorecard.baselineRef` (string identifier)
- `scorecard.generatedAt` (timestamp)
- `scorecard.gateDecision` (`pass|fail`)

### Files impacted
- `docs/OPS_FIRST_ARCHITECTURE_PLAN_SPEC.md`
- `docs/CLI.md`
- `src/relay/protocol.ts`
- `src/relay/relay-server.ts`
- `src/cli/commands/status.ts`
- `scripts/ops/recompute-scorecard.mjs` (new file)

### End goal
Rollout decisions are evidence-based, reversible, and auditable.

### Acceptance criteria
- [ ] Scorecard definition is documented with target thresholds.
- [ ] Status/health surfaces include fields required for scorecard inputs.
- [ ] Rollout and rollback criteria are documented and testable.
- [ ] Status diagnostics include `scorecard.phase` with allowed values `pilot|default|hardened|deprecation-candidate`.
- [ ] Deterministic phase check command (`opendevbrowser status --output json | jq -e '.scorecard.phase|test("^(pilot|default|hardened|deprecation-candidate)$")'`) exits `0`.
- [ ] Scorecard metrics, labels, windows, and baseline source are explicitly specified.
- [ ] Go/no-go decision can be recomputed from diagnostics without external assumptions.
- [ ] `node scripts/ops/recompute-scorecard.mjs --window 14d --input artifacts/ops-gates/20260208T000000Z/scorecard-summary.json` deterministically reproduces `scorecard.latencyRatio` and `scorecard.gateDecision`.
- [ ] Telemetry tests validate required label emission for `ops_requests_total`, `ops_request_latency_ms`, `ops_sessions_total`, `ops_incidents_total`, and `cdp_baseline_latency_ms_p95`.
- [ ] Metrics surface test (`npm run test -- tests/relay-endpoints.test.ts -t "metrics endpoint emits ops and cdp families"`) passes for normal operation and confirms OpenMetrics-compatible output.
- [ ] Adapter-failure metrics test (`npm run test -- tests/relay-server.test.ts -t "metrics remain available during adapter failure"`) passes and asserts non-empty failure outcome series in exported metrics.

---

## Task 5 — Testing strategy for ops-first architecture

### Reasoning
The architecture shift changes failure modes; test coverage must validate both API stability and adapter-level correctness.

### What to do
Implement a layered test matrix that validates ops contract, adapter behavior, compatibility paths, and regressions.

### How
1. Add contract tests for `/ops` commands independent of protocol backend assumptions.
2. Add adapter-conformance tests for `CDPAdapter` behavior under success and failure paths.
3. Add compatibility tests for `/cdp` escape-hatch behavior, relay-edge safeguard parity vs `/ops` limits, and status interoperability, including constrained mixed-version opt-in cases.
4. Add deterministic fault-injection tests (timeouts, detach races, stale sessions, reconnects).
5. Add 4-8 hour soak tests covering reconnect loops, long-running sessions, and tab churn before default-gate promotion, with pass thresholds: `>= 10,000` ops requests, ops error rate `<= 0.3%`, reconnect success rate `>= 99.5%`, and `0` relay/runtime crashes.
6. Add fault-injection pass/fail thresholds: deterministic expected error code match in `100%` of injected scenarios, no global process crash, and no cross-session lease contamination.
7. Add CI schema-drift gates that fail on relay/extension ops schema mismatch and CI error-code fixture tests for `cli_*`, `relay_*`, `ops_*`, `adapter_*` sources.
8. Add diagnostics contract tests validating scorecard field presence, type, and unit semantics, plus routing-control observability fields (`effectiveRoutingMode`, rollout fields, active-session policy fields).
9. Keep coverage at or above current threshold and prevent flaky diagnostics assertions.
10. Add routing-control tests for precedence (env kill switch, CLI route flags, rollout controls, config defaults), version-skew matrix expectations, and deterministic no-implicit-fallback behavior.
11. Add telemetry-emission tests asserting required scorecard metric labels via fixture/snapshot or explicit telemetry assertions in normal and adapter-failure paths.
12. Add cross-layer correlation tests asserting `requestId`/`sessionId` propagation from CLI -> relay -> `/ops` -> adapter logs/errors, and assert `requestId`/`sessionId` are excluded from telemetry label sets.
13. Add `/cdp` ownership/lease parity tests that assert deterministic `relay_cdp_not_owner` failures for non-owner session access.

### Execution and gate model
- PR CI (blocking): run `npm run lint`, `npm run build`, `npm run test`, and deterministic schema/error suites via `npm run test -- tests/relay-server.test.ts tests/remote-relay.test.ts tests/extension-relay-client.test.ts`.
- Nightly gate (blocking for default/hardened promotion): run `node scripts/test/run-ops-soak.mjs --duration-hours 4` and `node scripts/test/run-ops-fault-injection.mjs`.
- Release-candidate manual gate (release owner): rerun nightly suites against the candidate build and verify scorecard thresholds before promotion.
- Required artifacts (timestamped directory `artifacts/ops-gates/YYYYMMDDTHHmmssZ/`):
  - `ci-summary.json`
  - `soak-summary.json`
  - `fault-injection-summary.json`
  - `scorecard-summary.json`
- Retention, permissions, and cleanup policy (required):
  - `artifacts/ops-gates/YYYYMMDDTHHmmssZ/` directories must be mode `0700`; gate artifact files must be mode `0600`.
  - Retain gate artifact directories for `30d` with maximum `500` timestamp directories; prune oldest-first beyond either limit.
  - Cleanup cadence is at least once every `24h` (recommended `02:00 UTC`) and must run before release-candidate manual gate.
  - Disk-usage alert is mandatory when `artifacts/ops-gates` exceeds `5GiB` or underlying volume usage exceeds `80%`; emit `ops_artifacts_disk_usage_bytes{artifact_set="ops-gates"}` and `ops_artifacts_volume_usage_ratio{artifact_set="ops-gates"}` and trigger alert after `15m` sustained breach.
- Workflow configuration mapping (required):
  - `.github/workflows/ci.yml` (blocking PR workflow) must run `npm run lint`, `npm run build`, `npm run test`, and targeted schema/error suites.
  - `.github/workflows/ops-nightly-gates.yml` (scheduled workflow) must run soak/fault suites and `node scripts/ops/validate-gate-artifacts.mjs`.
  - `.github/workflows/ops-release-gate.yml` (manual release workflow) must rerun gate suites and artifact validation before promotion.
  - All workflow jobs above must fail the run on any non-zero exit, including validator schema/shape (`2`) and threshold (`3`) exits.
- Artifact schema requirements (deterministic):
  - All four artifacts must validate against JSON Schemas under `docs/schemas/ops-gates/`.
  - Required schema files:
    - `docs/schemas/ops-gates/ci-summary.schema.json`
    - `docs/schemas/ops-gates/soak-summary.schema.json`
    - `docs/schemas/ops-gates/fault-injection-summary.schema.json`
    - `docs/schemas/ops-gates/scorecard-summary.schema.json`
  - Required common top-level fields in every artifact: `schemaVersion`, `cycleId`, `generatedAt`, `gate`, `result`, `inputs`, `thresholds`, `metrics`, `failures`.
  - `result` must be `pass|fail`; a gate is passed only when schema validation succeeds and `result=="pass"`.
- Deterministic validation command (required):
  - `node scripts/ops/validate-gate-artifacts.mjs --dir "$ARTIFACT_DIR" --schema-dir docs/schemas/ops-gates --cycle-id CYCLE-05`
  - Exit behavior: `0` only when all artifacts exist, are schema-valid, and thresholds pass; any missing file/schema mismatch/threshold miss must exit non-zero and block promotion (`2` for schema/shape failures, `3` for threshold failures).
- Gate ownership: release owner and on-call reviewer sign off only when all thresholds pass; any failed gate triggers rollback criteria from Task 4.

### Files impacted
- `tests/relay-server.test.ts`
- `tests/remote-relay.test.ts`
- `tests/extension-connection-manager.test.ts`
- `tests/extension-relay-client.test.ts`
- `tests/tools.test.ts`
- `tests/ops-browser-manager.test.ts`
- `tests/cli-args.test.ts`
- `tests/daemon-commands.integration.test.ts`
- `tests/relay-endpoints.test.ts`
- `scripts/test/run-ops-soak.mjs` (new file)
- `scripts/test/run-ops-fault-injection.mjs` (new file)
- `scripts/ops/validate-gate-artifacts.mjs` (new file)
- `.github/workflows/ci.yml` (new file)
- `.github/workflows/ops-nightly-gates.yml` (new file)
- `.github/workflows/ops-release-gate.yml` (new file)
- `docs/schemas/ops-gates/ci-summary.schema.json` (new file)
- `docs/schemas/ops-gates/soak-summary.schema.json` (new file)
- `docs/schemas/ops-gates/fault-injection-summary.schema.json` (new file)
- `docs/schemas/ops-gates/scorecard-summary.schema.json` (new file)

### End goal
Ops-first architecture is validated by tests that directly encode contract guarantees and migration safety.

### Acceptance criteria
- [ ] Contract tests cover all `core` `/ops` capabilities.
- [ ] Adapter tests validate error translation and lease/ownership invariants.
- [ ] Compatibility tests confirm `/cdp` behavior remains stable when enabled.
- [ ] Test coverage remains >=97% and all tests pass.
- [ ] Soak and fault-injection gates have objective thresholds and deterministic pass/fail outputs.
- [ ] CI fails on schema drift and unstable error-code fixtures.
- [ ] Diagnostics tests validate scorecard fields, types, and units.
- [ ] Relay-edge security tests assert deterministic `null`-origin rejection, unauthenticated loopback rejection, pairing-token enforcement, and `/ops` vs `/cdp` authorization-context isolation.
- [ ] Execution model defines blocking CI, nightly soak/fault gates, manual release gate, exact commands, artifact locations, and gating owners.
- [ ] Workflow config files (`.github/workflows/ci.yml`, `.github/workflows/ops-nightly-gates.yml`, `.github/workflows/ops-release-gate.yml`) run the documented blocking commands and fail deterministically on validator schema/threshold exits.
- [ ] Control-plane tests assert precedence ordering and deterministic status fields for kill switch, routing mode, rollout percent, allowlist size/source/validation, identity namespace/source, and rollout decision metadata.
- [ ] Version-skew tests cover `/ops` strict gating, constrained explicit legacy `/cdp` path, and `relay_legacy_window_exceeded` rejection behavior.
- [ ] `/cdp` ownership-parity tests assert deterministic `relay_cdp_not_owner` failures for non-owner access at relay handshake/request execution.
- [ ] Active-session policy tests assert exact `relay_ops_draining`/`relay_ops_terminated` codes and status counters `opsSessionsDrainedCount`/`opsSessionsTerminatedCount`.
- [ ] Telemetry tests assert required scorecard metric label emission with reproducible fixture/snapshot evidence.
- [ ] Adapter-failure status tests assert rollback fields remain present (`effectiveRoutingMode`, `opsKillSwitchSource`, `opsRolloutPercent`, `opsRolloutAllowlistSize`, `lastRoutingChangeAt`) when adapter execution is unavailable.
- [ ] Correlation tests assert every session-bound error/log event includes `requestId` and `sessionId` across CLI/relay/ops/adapter paths and verify telemetry fixtures do not include `requestId`/`sessionId` labels.
- [ ] Artifact-validator command (`node scripts/ops/validate-gate-artifacts.mjs --dir artifacts/ops-gates/20260208T000000Z --schema-dir docs/schemas/ops-gates --cycle-id CYCLE-05`) exits `0` on valid pass artifacts and exits non-zero on schema or threshold failure.
- [ ] Artifact retention/permissions checks assert `0700` directories, `0600` files, `30d` + `500`-directory retention policy, daily prune cadence, and disk-usage alert thresholds for `artifacts/ops-gates`.

---

## Task 6 — Optional BiDi adapter pilot (incremental, not blocking)

### Reasoning
BiDi can improve long-term portability, but current ecosystem maturity does not justify blocking core delivery on full BiDi parity.

### What to do
Prototype a `BiDiAdapter` for a bounded subset of `core` capabilities in managed-mode flows and evaluate production viability.

### How
1. Identify pilot capability subset (navigation, element interaction primitives, basic DOM read paths).
2. Implement adapter skeleton for managed-mode contexts first (where feasible), independent of extension `/ops` runtime.
3. Add capability detection and internal adapter fallback (`BiDiAdapter` -> `CDPAdapter`) for unsupported operations within `/ops` execution only; never reroute an active `/ops` session to `/cdp`.
4. If an operation would require `/cdp` route fallback, return `relay_legacy_cdp_opt_in_required` when legacy routing is not opted in, or `ops_new_legacy_session_required` when opt-in exists and a new `/cdp` session is required.
5. Measure reliability and performance against scorecard thresholds.
6. Publish explicit `supported/unsupported` capability matrix for BiDi pilot.

### Files impacted
- `src/browser/browser-manager.ts`
- `src/browser/target-manager.ts`
- `src/relay/protocol.ts`
- `docs/OPS_FIRST_ARCHITECTURE_PLAN_SPEC.md`
- `docs/CLI.md`

### End goal
BiDi readiness is evaluated with real data while production reliability continues on CDP-backed ops execution.

### Acceptance criteria
- [ ] BiDi conformance subset test (`npm run test -- tests/ops-browser-manager.test.ts -t "bidi pilot core subset"`) passes and covers at least `navigation`, `interaction`, and `dom-read` commands.
- [ ] BiDi fallback/error test (`npm run test -- tests/ops-browser-manager.test.ts -t "bidi unsupported deterministic fallback"`) asserts `100%` of unsupported operations either use internal `/ops` adapter fallback or return `relay_legacy_cdp_opt_in_required`/`ops_new_legacy_session_required`, with `0` implicit `/ops` -> `/cdp` reroutes.
- [ ] Pilot scorecard recomputation check (`node scripts/ops/recompute-scorecard.mjs --window 7d --input artifacts/ops-gates/20260208T000000Z/scorecard-summary.json`) exits `0`.
- [ ] Pilot scorecard schema assertion (`jq -e '.scorecard | has("opsP95LatencyMs") and has("cdpBaselineP95LatencyMs") and has("latencyRatio") and has("gateDecision")' artifacts/ops-gates/20260208T000000Z/scorecard-summary.json`) exits `0`.
- [ ] Extension non-regression check (`npm run test -- tests/extension-relay-client.test.ts tests/extension-connection-manager.test.ts`) passes with extension-mode remaining CDP-backed in this phase.

---

## Task 7 — Documentation and decision governance

### Reasoning
Architecture transitions fail when maintainers and users lack clear operating guidance and decision checkpoints.

### What to do
Ship clear governance documentation for protocol strategy, migration expectations, and operator playbooks.

### How
1. Publish architecture rationale and tradeoff summary in docs.
2. Add protocol strategy section in CLI docs (default path, legacy path, pilot path).
3. Define incident-response guidance for adapter fallback and protocol-specific failures.
4. Add change-management checklist for introducing new `/ops` capabilities.
5. Keep versioned history of strategic decisions and milestone outcomes.
6. Tie incident escalation triggers directly to rollback criteria in Task 4.

### Files impacted
- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `docs/TROUBLESHOOTING.md`
- `docs/OPS_FIRST_ARCHITECTURE_PLAN_SPEC.md`

### End goal
The ops-first architecture is operationally understandable and maintainable across releases.

### Acceptance criteria
- [ ] Docs clearly state defaults, fallbacks, and migration posture.
- [ ] Troubleshooting includes protocol adapter failure handling.
- [ ] Governance checklist exists for future capability additions.
- [ ] Version history captures major strategy decisions.

---

## File-by-file implementation sequence

1. `src/relay/protocol.ts` — Tasks 1, 2, 4 (contract + diagnostics schema)
2. `extension/src/types.ts` — Task 1 (extension-side ops schema sync)
3. `packages/ops-contracts/src/protocol-adapter.ts` — Task 2 (dedicated shared protocol contract module)
4. `packages/ops-contracts/src/dom-bridge-contract.ts` — Task 2 (dedicated shared DOM/action contract module)
5. `packages/ops-contracts/src/index.ts` — Task 2 (shared package export surface)
6. `packages/ops-contracts/tsconfig.json` — Task 2 (shared module build ownership)
7. `package.json` — Task 2 (add `build:ops-contracts` and build dependency ordering)
8. `tsconfig.json` — Task 2 (root alias resolution for shared contracts)
9. `extension/tsconfig.json` — Task 2 (extension alias resolution for shared contracts)
10. `extension/src/ops/ops-runtime.ts` — Tasks 1, 2 (orchestration refactor)
11. `extension/src/ops/cdp-adapter.ts` — Task 2 (new adapter implementation)
12. `extension/src/ops/dom-bridge.ts` — Task 2 (domain boundary hardening)
13. `src/browser/ops-browser-manager.ts` — Task 1 (ops contract caller alignment)
14. `src/browser/ops-client.ts` — Tasks 1, 4 (capability/status negotiation)
15. `src/relay/relay-server.ts` — Tasks 3, 4 (compatibility + status surfaces)
16. `src/cli/args.ts` — Task 3 (legacy path posture)
17. `src/cli/daemon-commands.ts` — Task 3 (routing semantics)
18. `tests/ops-browser-manager.test.ts` — Task 5 (ops contract assertions)
19. `tests/relay-server.test.ts` — Task 5 (status/interoperability/faults)
20. `tests/remote-relay.test.ts` — Task 5 (status consumer compatibility)
21. `docs/CLI.md` — Tasks 1, 3, 4, 7 (contract + migration guidance)
22. `docs/ARCHITECTURE.md` — Task 7 (strategy rationale)
23. `docs/TROUBLESHOOTING.md` — Task 7 (operator playbooks)
24. `src/browser/browser-manager.ts` — Task 6 (managed-mode BiDi pilot integration)
25. `src/browser/target-manager.ts` — Task 6 (managed-mode BiDi pilot target behavior)

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| (none required initially) | — | Reuse existing infrastructure first; evaluate BiDi library additions only during Task 6 pilot. |

---

## Version history

| Version | Date | Cycle | Changes |
|---------|------|-------|---------|
| 1.0 | 2026-02-08 | — | Initial Ops-first architecture plan spec with phased execution, compatibility lane, and BiDi pilot posture. |
| 1.1 | 2026-02-08 | — | Incorporated independent audit corrections: schema-sync files, adapter boundary scope (Protocol + DomBridge), objective rollout gates, version-skew rules, soak-test requirement, and managed-mode BiDi scoping. |
| 1.2 | 2026-02-08 | CYCLE-01 | Applied required fixes for relay-edge `/ops` vs `/cdp` security parity, enforcement ownership map, kill-switch/legacy routing rollback controls, version-skew matrix + rollout order, adapter failure containment, scorecard telemetry schema, and objective verification gates. |
| 1.3 | 2026-02-08 | CYCLE-02 | Applied required fixes for internal-only BiDi fallback vs `/cdp` guardrails, active-session drain/terminate rollback controls, relay error-namespace consistency, explicit managed-mode adapter ownership/files, Task 5 execution-and-gate runbook, deterministic `--ops-routing=auto` semantics, and tighter Task 2/4 measurable checks. |
| 1.4 | 2026-02-08 | CYCLE-03 | Applied required fixes for neutral shared adapter contract paths, route-specific `/ops` vs `/cdp` version gating with N/N-1 legacy window, deterministic per-session adapter circuit-breaker/state fields, concrete rollback+alert+incident runbook, rollout ramp controls, explicit Task 3/5 control-plane verification, and telemetry label-emission checks. |
| 1.5 | 2026-02-08 | CYCLE-04 | Applied required fixes for dedicated shared contracts module ownership (`packages/ops-contracts`) with alias/build rules, `/cdp` relay-edge safeguard parity limits, deterministic `auto` rollout identity+bucketing and allowlist validation/observability, status survivability during adapter failures, concrete `/metrics` export ownership/cadence with failure-path checks, objective Task 2/6 command-based acceptance criteria, and end-to-end `requestId` propagation constraints. |
| 1.6 | 2026-02-08 | CYCLE-04-PATCH-01 | Clarified Option-1 shared-contract strategy as fixed, added deterministic rollout hash key and explicit allowlist source/validation status fields, tightened rollback/status assertions, required `requestId`+`sessionId` cross-layer correlation with metrics-label exclusions, and made Task 6 pilot scorecard checks fully command-asserted. |
| 1.7 | 2026-02-08 | CYCLE-05 | Applied required fixes for adapter-health relay contract/state persistence and degraded-status sourcing, explicit SemVer N/N-1 + `/ops` minimum version semantics and surfaced sources, config/flag backward-compat + downgrade policy with deterministic failures, and gate artifact JSON-schema validation with non-zero exit behavior. |
| 1.8 | 2026-02-08 | CYCLE-06 | Applied required fixes for single-source contract ownership in `packages/ops-contracts` (including explicit `src/version.ts` planning/build outputs), explicit `/cdp` ownership/lease enforcement + tests, route-scoped `/ops` min gating with explicit legacy `/cdp` reason fields, additive status-schema compatibility policy/tests, objective `scorecard.phase` diagnostics checks, and retention/permissions/cleanup/disk-alert policies for `ops-health` + `ops-gates` artifacts. |
| 1.9 | 2026-02-08 | CYCLE-07-TERMINAL | Applied required fixes for explicit `@opendevbrowser/ops-contracts` module-resolution/dependency/bundle-output strategy, relay-scoped legacy opt-in error namespace, deterministic `/cdp` pairing-disabled loopback auth plus `allowRawCDP`/`allowNonLocalCdp` gates, concrete legacy lease-acquisition timeline, rollback legacy `/cdp` functional smoke validation, CI workflow-to-gate mapping with blocking failure semantics, adapter-health `sessionEpoch`+string-`seq` semantics, explicit artifacts disk-usage metrics/alerts, and deterministic lint/test import-boundary enforcement. |
