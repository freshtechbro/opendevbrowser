# Investigation: Hardened Anti-Bot Challenge Orchestration

Status: active
Date: 2026-03-21

## Summary

The current repo already has the right low-level primitives for blocker-aware recovery: session-scoped blocker state, blocker classification, screenshots, snapshots, debug traces, normal browser interaction, provider anti-bot policy, and stronger ops-side lease recovery. The missing piece is not detection. The missing piece is one reusable challenge lifecycle that preserves the live session, exposes evidence, lets the agent operate normally on that preserved session, verifies clearance, and resumes the interrupted intent.

The other remaining problem is ownership split. Shared concerns such as challenge escalation, durable pressure, fallback ordering, and fallback cleanup are still spread across runtime defaults, daemon shims, workflows, and provider-specific code. That split is what makes the system brittle under pressure. The hardened direction is to keep blocker truth centralized in the browser layer, add one shared challenge coordinator beside it, make fallback a preserve-or-complete transport, make `ProviderRegistry` the sole durable challenge-pressure authority, and reduce providers to capability and hint packages instead of recovery owners. The destination should land as one connected cutover program guarded by compatibility gates, not as phased keep-now, near-term, and later architecture.

## Symptoms

- OpenDevBrowser reports `auth_required`, `anti_bot_challenge`, `rate_limited`, and `env_limited`, but it still tends to degrade, defer, or fail instead of switching into a reusable solve mode.
- The browser fallback path can reach a real login or challenge page, but it always disconnects that session before the agent can take over.
- The need is broader than workflows. Direct navigation, logins, form filling, profile selection, skills, daemon calls, and provider runs all use the same browser surfaces.
- Extension ops remains blocker-blind at the transport surface, so daemon and higher layers still compensate with enrichment shims.
- Workflow reporting has become stronger, but durable challenge pressure still lives too high in the stack.
- Provider modules still make runtime policy decisions such as fallback ordering and recovery behavior, which keeps provider wiring brittle.

## Investigation Log

### Phase 1 - The challenge problem is broader than workflows
**Hypothesis:** the reusable challenge solution must live below workflows because OpenDevBrowser already exposes many direct browser-use entry points.

**Findings:** the public tool and daemon surfaces already support direct browser entry points such as `launch`, `connect`, `status`, `goto`, `wait`, `snapshot`, `click`, `type`, `scroll`, `screenshot`, and workflow entry points such as `research`, `shopping`, and `product-video`. `remote-manager` also forwards `session.status` directly. This confirms the user request: challenge mode must be available whenever a challenge is detected, not only inside workflows.

**Evidence:**
- `src/tools/surface.ts:7-56`
- `src/cli/daemon-commands.ts:210-337`
- `src/cli/remote-manager.ts:78-80`

**Conclusion:** confirmed. The architecture must be reusable across direct browser use, skills, workflows, daemon RPC, and extension ops.

### Phase 2 - Blocker truth is already centralized and should stay centralized
**Hypothesis:** the repo already has a canonical blocker FSM and blocker envelope, so a hardened design should build on that instead of inventing a second blocker contract.

**Findings:** `SessionStore` owns blocker FSM state and resolution history. `BrowserManager.status()` reads that store and returns the canonical blocker envelope. `BrowserManager.reconcileSessionBlocker()` classifies blocker signals, writes them back into `SessionStore`, and optionally attaches blocker artifacts.

**Evidence:**
- `src/browser/session-store.ts:52-239`
- `src/browser/browser-manager.ts:560-594`
- `src/browser/browser-manager.ts:2368-2430`

**Conclusion:** confirmed. `SessionStore` should remain the sole blocker truth. Challenge orchestration must be additive and lifecycle-oriented, not a second blocker FSM.

### Phase 3 - Ops durability improved, but extension ops still lacks blocker parity
**Hypothesis:** the strongest existing durability seam is now `OpsBrowserManager`, while `ops-runtime` remains intentionally thin.

**Findings:** `OpsBrowserManager` now tracks ops sessions, leases, protocol sessions, tabs, URLs, and closed-session cleanup. It reconnects to the relay, waits for extension readiness, recovers unknown sessions, and preserves metadata when the ops client closes so the next command can reconnect to the same public session. By contrast, extension `handleSessionStatus()` still returns only mode, target, URL, title, lease, and state, and `handleGoto()` / `handleWait()` still return transport-level navigation results without blocker metadata.

**Evidence:**
- `src/browser/ops-browser-manager.ts:52-64`
- `src/browser/ops-browser-manager.ts:173-188`
- `src/browser/ops-browser-manager.ts:710-800`
- `src/browser/ops-browser-manager.ts:813-843`
- `extension/src/ops/ops-runtime.ts:553-568`
- `extension/src/ops/ops-runtime.ts:812-901`

**Conclusion:** confirmed. `OpsBrowserManager` is now the right ownership seam for durable remote challenge handling. `ops-runtime` should remain thin and should not become a second blocker engine.

### Phase 4 - Daemon still bridges a parity gap instead of forwarding one canonical shape
**Hypothesis:** daemon still compensates for missing lower-level blocker metadata instead of simply forwarding a canonical manager-level contract.

**Findings:** daemon wraps `nav.goto` and `nav.wait` with `attachBlockerMetaForNavigation(...)`, and it enriches trace responses through `attachBlockerMetaForTrace(...)`. These helpers reclassify blockers from status and network data when lower layers do not already supply `meta.blockerState`.

**Evidence:**
- `src/cli/daemon-commands.ts:215-255`
- `src/cli/daemon-commands.ts:1001-1095`

**Conclusion:** confirmed. Daemon should remain a transport bridge and compatibility shim, not the long-term owner of blocker interpretation.

### Phase 5 - Provider fallback reaches the blocked page but tears it down
**Hypothesis:** the closest existing seam for global challenge orchestration is the browser fallback path, but it is not yet preserving resolvable blocked sessions.

**Findings:** runtime fallback already detects login pages and anti-bot challenge pages from live HTML, launches or attaches a session, imports cookies when configured, navigates, waits, captures HTML, and inspects status. But if it reaches an auth or challenge page, it returns a failure and then unconditionally disconnects the session in `finally`.

**Evidence:**
- `src/providers/runtime-factory.ts:240-287`
- `src/providers/runtime-factory.ts:289-489`

**Conclusion:** confirmed. This is the highest-value behavior gap to close. The system can already reach the page. It just does not preserve the page for iterative solve, verify, and resume.

### Phase 6 - Shared runtime and anti-bot policy already own most of the right concerns
**Hypothesis:** shared runtime, not provider modules, is the right place to own anti-bot preflight, cookie policy, browser fallback transport, and escalation.

**Findings:** runtime execution already runs anti-bot preflight and injects `browserFallbackPort` into `ProviderContext`. Runtime config wiring already centralizes blocker threshold, prompt guard, anti-bot policy, transcript strategy, cookie policy, and fallback port. `AntiBotPolicyEngine` already owns cooldowns, retry budgeting, and escalation intent by provider and operation scope.

**Evidence:**
- `src/providers/index.ts:1018-1059`
- `src/providers/runtime-factory.ts:497-565`
- `src/providers/shared/anti-bot-policy.ts:62-190`

**Conclusion:** confirmed. The hardened design should push more challenge ownership into shared runtime and policy, not back down into provider modules.

### Phase 7 - Workflow pressure reporting is now stronger, but it still sits too high
**Hypothesis:** workflows should remain consumers and narrators of challenge pressure, not long-term owners of it.

**Findings:** workflow code now tracks provider signals, staged warning and degraded transitions, auto-exclusion candidates, `antiBotPressure`, and `primary_constraint_summary`. Research and shopping flows both consume those summaries and exclusions. This is useful, but it is still a reporting layer rather than the correct home for durable challenge state.

**Evidence:**
- `src/providers/workflows.ts:91-320`
- `src/providers/workflows.ts:322-335`
- `src/providers/workflows.ts:1299-1411`
- `src/providers/workflows.ts:1423-1435`
- `src/providers/constraint.ts:84-160`
- `src/providers/constraint.ts:252-267`

**Conclusion:** confirmed. Workflows should keep summary, narration, and run-local exclusion. Durable pressure should move lower into registry and policy.

### Phase 8 - Provider packaging is still mixed and brittle
**Hypothesis:** the remaining brittleness comes from provider modules still owning behavior that should belong to shared runtime and policy.

**Findings:** registry and policy remain generic and challenge-blind. Shopping still chooses browser fallback ordering locally and converts fallback outcomes back into provider errors. Social providers remain mostly capability and configuration wrappers, and their health still mostly reflects transport configuration. This mix means provider behavior is still partly encoded in provider-local code rather than through one shared provider binder or handshake.

**Evidence:**
- `src/providers/registry.ts:16-149`
- `src/providers/policy.ts:27-55`
- `src/providers/shopping/index.ts:336-408`
- `src/providers/shopping/index.ts:445-540`
- `src/providers/social/platform.ts:75-122`
- `src/providers/social/platform.ts:265-487`
- `src/providers/social/index.ts:50-87`
- `src/providers/index.ts:1600-1865`

**Conclusion:** confirmed. Provider modules should shrink toward capabilities, hints, and extraction logic. Shared runtime should own transport, escalation, pressure, and retry.

### Phase 9 - External patterns still support preserved sessions plus normal controls
**Hypothesis:** mature browser automation systems separate low-level controls from higher-level observation and action loops, and they preserve authenticated sessions instead of relying on brittle provider hacks.

**Findings:** current official docs and source repos continue to show the same durable pattern:
- Playwright exposes mouse and screenshot primitives as low-level controls.
- Stagehand uses an explicit observe then act loop.
- Browser Use emphasizes real browser sessions and saved authentication state.
- Selenium keeps click, hold, drag, and other pointer operations in a dedicated actions layer.
- Challenge vendors recommend test keys for owned environments rather than bypassing production controls.

**Evidence:**
- Playwright mouse API: https://playwright.dev/docs/api/class-mouse
- Playwright screenshots: https://playwright.dev/docs/screenshots
- Stagehand observe docs: https://docs.stagehand.dev/basics/observe
- Browser Use auth docs: https://docs.browser-use.com/customize/browser/authentication
- Selenium Actions API: https://www.selenium.dev/documentation/webdriver/actions_api/
- Cloudflare Turnstile testing: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- Google reCAPTCHA FAQ and test keys: https://developers.google.com/recaptcha/docs/faq

**Conclusion:** confirmed. The right pattern is not challenge bypass. It is preserved sessions, normal browser controls, observation snapshots, verification, and test fixtures for owned environments.

## Verified Current Architecture

```text
Current Durable Core

SessionStore
  -> blocker FSM truth: clear | active | resolving
  -> resolution truth: resolved | unresolved | deferred

BrowserManager
  -> canonical blocker reconciliation
  -> managed-mode blocker envelope
  -> blocker artifact capture

OpsBrowserManager
  -> relay session/lease durability
  -> reconnect and unknown-session recovery
  -> still status-passthrough at the surface

Current Thin / Transitional Layers

ops-runtime
  -> transport-level session/nav/wait execution
  -> no blocker envelope

daemon-commands
  -> enriches blocker meta when lower layers omit it

runtime-factory
  -> can reach blocked pages
  -> still disconnects fallback sessions in finally

workflows
  -> summarize pressure and exclusions
  -> do not preserve or resume challenged sessions

providers
  -> still mix capabilities with some recovery policy
```

## Recommended Architecture

### Design rules

1. `SessionStore` remains the sole blocker FSM authority.
2. `BrowserManager` and `OpsBrowserManager` remain the only writers of surfaced blocker and challenge state.
3. Add one shared challenge lifecycle layer beside them. Do not add a second blocker FSM.
4. `GlobalChallengeCoordinator` is lifecycle-only and additive. It does not classify blockers.
5. Preserve live sessions for resolvable blockers such as `auth_required` and `anti_bot_challenge`.
6. Treat `env_limited` as deferred, not as a solve attempt.
7. Keep `ops-runtime` thin and daemon as a compatibility bridge until manager parity is proven.
8. Make `ProviderRegistry` the sole durable challenge-pressure authority.
9. Let workflows narrate and keep output keys stable. Let providers own hints and extraction, not recovery ownership.
10. Keep direct-browser continuation manual by default. Allow provider and workflow continuation to auto-resume only after verification.

### Legitimacy boundary

In scope:

- preserved sessions
- challenge-aware orchestration
- visual observation loops
- low-level pointer support
- manual completion on third-party sites
- owned-environment completion with vendor test keys

Out of scope:

- hidden bypass paths
- autonomous solving of third-party anti-bot systems
- CAPTCHA-solving services
- challenge token harvesting
- provider-specific anti-bot evasion logic

### Compatibility gates

- Do not rename or remove `meta.blocker`, `meta.blockerState`, or `meta.blockerResolution`.
- Do not repurpose `ProviderReasonCode` for lifecycle states.
- Do not change `BlockerSignalV1` semantics.
- Do not break current `env_limited` capture and manual-follow-up behavior.
- Do not change workflow output keys such as `anti_bot_pressure`, `alerts`, or `primary_constraint_summary`.
- Do not remove daemon blocker shims until manager-owned parity is proven by tests.
- Do not remove provider-local recovery ownership until shared runtime tests lock the replacement behavior first.
- Keep `BrowserFallbackResponse.ok` and `BrowserFallbackResponse.output` backward-compatible until every existing caller migrates to explicit `disposition`.
- Make `ProviderRegistry` the sole durable authority for challenge pressure, cooldown, degraded state, and last preserved outcome before removing workflow-owned pressure state.
- Keep daemon trace enrichment until managed and ops `debugTraceSnapshot` return the same manager-shaped `meta.blocker` and `meta.challenge` envelope.
- Keep challenge lifecycle writes in `BrowserManager` and `OpsBrowserManager`. `runtime-factory` may consume lifecycle state, but it must not register or mutate it directly.
- If low-level pointer primitives become public in this cutover, update CLI args and help inventory in the same program instead of leaving a surface mismatch.

### Target architecture

```text
Target anti-bot ownership model

caller surface
(direct browser, provider runtime, workflow, daemon)
                         |
                         v
+-----------------------------------------------------------+
| BrowserManager                OpsBrowserManager           |
| - reconcile blocker evidence  - wrap thin ops transport   |
| - write surfaced blocker      - own ops rebind/release    |
| - write surfaced challenge    - write surfaced challenge  |
+---------------------------+-------------------------------+
                            |
                            v
                   SessionStore
                   - blocker FSM only
                            |
                            v
              GlobalChallengeCoordinator
              - claim / preserve
              - verify-state tracking
              - defer / expire / release
              - resume handoff metadata
                            |
            +---------------+----------------+
            |                                |
            v                                v
      runtime-factory                  AntiBotPolicyEngine
      - preserve-or-complete           - cooldown / retry /
        fallback transport               escalation intent
      - consume lifecycle only         - registry-backed
      - invoke resume when allowed       durable state
            |                                |
            +---------------+----------------+
                            |
                            v
                ProviderRegistry + policy.ts
                - sole durable challenge pressure authority
                - cooldown / degraded state / selection order
                            |
                +-----------+-----------+
                |                       |
                v                       v
           workflows                providers
           - narrate only           - hints / extraction only
           - same output keys       - no recovery ownership

ops-runtime: thin transport under OpsBrowserManager
daemon-commands: compatibility bridge until manager parity is proven
```

### New ownership seam: `GlobalChallengeCoordinator`

Add one shared lifecycle coordinator in the core browser layer, for example:

- `src/browser/global-challenge-coordinator.ts` (new file)

This layer should **not** classify blockers. It should only orchestrate challenge lifecycle state:

- `challengeId`
- `sessionId`
- `targetId`
- `ownerSurface`
- `ownerLeaseId`
- `suspendedIntent`
- `preservedSession`
- `preserveUntil`
- `verifyUntil`
- artifact references
- outcome and resume state

Its responsibilities:

1. Claim a challenge when blocker state becomes `active` for `auth_required` or `anti_bot_challenge`.
2. Preserve the live session instead of letting fallback cleanup destroy it.
3. Bind challenge ownership to a lease-aware actor.
4. Publish additive challenge metadata on top of the existing blocker envelope.
5. Track verify and resume outcomes.
6. Release only on resolve, defer, expiry, or explicit abandon.

### Runtime handshake

```text
Staged runtime flow

[Request enters: direct browser call or provider fallback]
                         |
                         v
[BrowserManager or OpsBrowserManager executes nav/status/wait/trace]
                         |
                         v
[Manager reconciles blocker evidence into SessionStore]
                         |
           +-------------+--------------+
           |                            |
           | no blocker                 | blocker detected
           |                            |
           v                            v
     [Return normal]               [Classify blocker kind]
                                         |
                    +--------------------+--------------------+
                    |                                         |
                    | auth_required or                        | env_limited or
                    | anti_bot_challenge                      | non-resolvable blocker
                    |                                         |
                    v                                         v
     [GlobalChallengeCoordinator claims and preserves]   [No preserve]
                    |                                   [Return deferred or failed
                    v                                    with canonical constraint summary]
     [Return meta.blocker + meta.challenge
      and fallback disposition:
      completed | challenge_preserved | deferred | failed]
                    |
                    v
     [Owner uses normal controls on preserved session]
                    |
                    v
     [Manager re-verifies via status / wait / goto / trace]
                    |
          +---------+----------+------------------+
          |                    |                  |
          | clear              | active           | deferred
          |                    |                  |
          v                    v                  v
[Release challenge state   [Keep preserved   [Release preserved
 and hand off next step]    session parked]   state and report
                                              constraint]
          |
          +--> direct browser surface: same owner continues manually
          |
          +--> provider/workflow surface: runtime auto-resumes suspended intent
```

### Stage snippets

- Detect: manager executes navigation, status, wait, or trace work and reconciles blocker evidence into `SessionStore`.
- Preserve: `GlobalChallengeCoordinator` records `challengeId`, `ownerSurface`, `ownerLeaseId`, `suspendedIntent`, `preserveUntil`, and `verifyUntil`.
- Surface: manager returns `meta.blocker` plus additive `meta.challenge`; fallback returns explicit `disposition` while legacy `ok` and `output` stay valid during cutover.
- Act: the caller uses normal controls on the preserved session: `snapshot`, `screenshot`, `click`, `type`, `press`, `scroll`, and planned low-level pointer primitives once they ship.
- Verify: manager re-runs blocker reconciliation through `status`, `wait`, `goto`, or `debugTraceSnapshot`.
- Continue: direct browser owners continue manually; provider and workflow runtime may auto-resume suspended intent after verification; deferred and failed flows keep canonical constraint summaries.

#### Step 1 - Detect

- Direct browser commands (`goto`, `wait`, `status`, `snapshot`, `trace`) or provider fallback activity produce evidence.
- `BrowserManager` or `OpsBrowserManager` reconciles that evidence into `SessionStore`.
- If the blocker is `auth_required` or `anti_bot_challenge`, the flow becomes challenge-eligible.

#### Step 2 - Preserve

- The live session is preserved.
- Current target, URL, profile/cookie context, and lease are retained.
- `GlobalChallengeCoordinator` records ownership and lifecycle metadata such as `challengeId`, `ownerSurface`, `ownerLeaseId`, `preserveUntil`, and `verifyUntil`.
- A `suspendedIntent` is stored:
  - direct nav
  - login continuation
  - form submission
  - profile selection
  - provider search/fetch/crawl step
  - workflow sub-run

#### Step 3 - Claim

The caller receives the existing blocker envelope plus additive challenge metadata. Keep the public blocker contract. Add challenge lifecycle metadata next to it. The fallback lane also returns an explicit `disposition` such as `completed`, `challenge_preserved`, `deferred`, or `failed` while legacy `ok` and `output` remain valid during cutover.

Conceptual shape:

```json
{
  "meta": {
    "blockerState": "active",
    "blocker": {
      "type": "anti_bot_challenge"
    },
    "challenge": {
      "challengeId": "chg_123",
      "ownerSurface": "provider_fallback",
      "ownerLeaseId": "lease_123",
      "preservedSession": true,
      "resumeAllowed": true,
      "suspendedIntentKind": "shopping.search"
    }
  }
}
```

#### Step 4 - Solve

No special hidden bypass path is needed. The agent uses ordinary browser controls on the preserved session:

- `snapshot`
- `screenshot`
- `click`
- `type`
- `press`
- `scroll`
- `wait`
- `debug_trace_snapshot`

This satisfies the user requirement that the capability be reusable for unexpected challenges during normal browsing, provider requests, skills, or workflows.

#### Step 5 - Verify

Verification goes back through the same manager-owned blocker path:

- run `status`, `wait`, `goto`, or trace-based recheck
- manager marks `resolving`
- manager reconciles the new signal
- `SessionStore` ends in `clear`, `active`, or `deferred`

#### Step 6 - Resume or defer

- If resolved on a direct browser surface: the same owner continues manually on the preserved session.
- If resolved on a provider or workflow surface: shared runtime may auto-resume the suspended intent from the preserved session.
- If still active: keep the challenge session parked until timeout or explicit release.
- If deferred or truly `env_limited`: release with a clear constraint summary.

### Operating postures

#### 1. Solve in place

Use for:

- direct navigation
- login
- form completion
- profile selection
- skill-driven browser use

Behavior:

- preserve the same session
- keep the same target
- same actor solves the challenge
- verify and continue

#### 2. Park and resume

Use for:

- provider fallback
- research sub-runs
- shopping providers
- product-video asset collection

Behavior:

- preserve the blocked provider session
- park that lane
- let the workflow continue with other providers when policy allows
- auto-resume the parked lane only after manager-owned verification clears the blocker

#### 3. Deferred

Use for:

- render-required but inaccessible contexts
- genuinely unavailable environments
- explicit operator deferral

Behavior:

- no solve attempt
- no false success
- record deferred outcome
- surface the constraint clearly

### Hardening layers

#### Thick contract

One blocker contract everywhere:

- `SessionStore` truth
- `BrowserManager` / `OpsBrowserManager` as writers
- additive `meta.challenge` lifecycle payload

#### Lease-backed ownership

Use existing `OpsBrowserManager` durability as the template:

- preserve `leaseId`
- reconnect to the same public session
- recover from relay loss
- avoid silently degrading to a fresh tab

#### Session preservation

For resolvable blockers:

- never auto-disconnect in fallback `finally`
- keep the exact blocked page alive
- retain cookies, target, and session identity

#### Centralized retry and cooldown

Keep `AntiBotPolicyEngine` as the retry and cooldown brain, but make it operate through registry-backed durable state:

- no provider-local challenge retry loops
- no blind retries while a challenge is actively owned
- no workflow-owned long-lived cooldown truth
- no parallel durable challenge-pressure authority outside `ProviderRegistry`

#### Durable pressure below workflows

Extend registry and policy to carry challenge-aware pressure facts such as:

- active challenge count
- unresolved challenge age
- last preserve outcome
- recent anti-bot ratio
- recent rate-limit ratio
- cooldown state

Then:

- `ProviderRegistry` stores the sole durable pressure truth
- `policy.ts`, shared runtime, and `AntiBotPolicyEngine` read or update that registry-backed state
- workflows read and report it without becoming a second authority

#### Observability timeline

Every challenge should produce one timeline keyed by `challengeId`:

- detected
- preserved
- claimed
- artifact capture
- verify attempts
- resolved / unresolved / deferred
- resumed / abandoned

### Anti-brittleness boundaries

#### `SessionStore` is blocker truth only

Do not move provider pressure, lease ownership, or workflow state into it.

#### Managers are the only blocker writers

`BrowserManager` and `OpsBrowserManager` should remain the only authoritative writers of surfaced blocker and challenge state.

#### `ops-runtime` stays thin

It should continue to execute transport-level browser actions. Blocker reconciliation should stay above it.

#### Daemon is a bridge, not the interpreter

`daemon-commands` can keep enrichment shims for compatibility, but long term it should forward a fully manager-shaped contract.

#### Runtime owns preserve-or-complete transport and resume invocation

Provider runtime should decide when to use preserve-or-complete fallback transport, consume manager-owned lifecycle state, and invoke resume when verification clears the blocker. It should not claim or mutate lifecycle state directly.

#### Registry and policy own durable pressure

`ProviderRegistry` should be the sole durable authority for anti-bot degradation, cooldown, and preserved-outcome pressure. Workflow logic should not remain the long-lived authority for anti-bot degradation.

#### Providers become packages, not recovery owners

Providers should declare:

- capabilities
- domain and shell hints
- legal metadata
- session requirements
- extraction behavior

Providers should stop owning:

- fallback ordering
- challenge lifecycle
- global retry ownership
- long-lived degraded-state policy

### Supporting capability lane: richer manual control

OpenDevBrowser already exposes screenshots plus normal ref-based interactions:

- `snapshot`
- `screenshot`
- `click`
- `hover`
- `press`
- `type`
- `scroll`

Evidence:
- `src/tools/surface.ts:19-29`
- `src/tools/surface.ts:53-56`

To better support real-world hold, drag, or opaque overlay challenges, add coordinate-level pointer primitives as a supporting capability, not as the owner of challenge mode. This should sit under the same preserved-session lifecycle and be exposed consistently through:

- `BrowserManager`
- `OpsBrowserManager`
- daemon surface
- extension ops transport

This addresses the user requirement for mouse control and iterative snapshot-guided operation without turning challenge handling into provider-specific hacks. It is a planned destination capability, not a current-state claim.

## Root Cause

The main failure is orchestration and ownership split, not raw detection.

OpenDevBrowser already knows how to classify blockers, summarize constraints, capture screenshots and traces, and drive normal browser interaction. But no shared component currently owns the full lifecycle needed when an unexpected challenge appears anywhere in the system:

1. detect the blocker,
2. preserve the exact blocked session,
3. claim challenge ownership,
4. expose artifacts and context,
5. operate on that preserved session,
6. verify clearance through the canonical blocker path,
7. resume the interrupted intent.

Because that lifecycle is missing, challenge behavior leaks into:

- provider fallback cleanup,
- daemon enrichment,
- extension parity gaps,
- workflow pressure logic,
- provider-local recovery code.

That leakage is what makes the system brittle under load.

## Recommendations

1. Add `GlobalChallengeCoordinator` in the browser layer and keep it strictly lifecycle-oriented.
   - Files:
     - `src/browser/global-challenge-coordinator.ts` (new)
     - `src/browser/browser-manager.ts`
     - `src/browser/ops-browser-manager.ts`
     - `src/browser/session-store.ts`

2. Preserve fallback sessions for `auth_required` and `anti_bot_challenge` instead of disconnecting them in `finally`.
   - Files:
     - `src/providers/runtime-factory.ts`
   - Keep `BrowserFallbackResponse.ok` and `BrowserFallbackResponse.output` backward-compatible until all callers migrate to explicit `disposition`.

3. Make `OpsBrowserManager` enrich or reconcile ops session blocker state into the same public blocker envelope returned by `BrowserManager`, and keep ops-side challenge rebind and release ownership there.
   - Files:
     - `src/browser/ops-browser-manager.ts`
     - `extension/src/ops/ops-runtime.ts`
     - `src/cli/daemon-commands.ts`

4. Add additive `meta.challenge` lifecycle data to the existing blocker envelope rather than inventing a second public blocker contract.
   - Files:
     - `src/browser/browser-manager.ts`
     - `src/browser/ops-browser-manager.ts`
     - `src/cli/daemon-commands.ts`
     - `docs/CLI.md`

5. Move durable anti-bot pressure below workflows into `ProviderRegistry` and policy.
   - Files:
     - `src/providers/registry.ts`
     - `src/providers/policy.ts`
     - `src/providers/shared/anti-bot-policy.ts`
     - `src/providers/workflows.ts`

6. Recast `providers/index.ts` plus runtime factory as the shared provider binder or handshake layer.
   - Runtime should own:
     - anti-bot preflight
     - preserve-or-complete fallback transport
     - cookie policy
     - transport and retry policy
     - suspended-intent consumption and resume invocation after verification
   - Providers should own:
     - capabilities
     - hints
     - extraction behavior
   - Files:
     - `src/providers/index.ts`
     - `src/providers/runtime-factory.ts`
     - `src/providers/shopping/index.ts`
     - `src/providers/social/platform.ts`
     - `src/providers/social/index.ts`

7. Add coordinate pointer actions as a supporting capability for hold, drag, and opaque overlay interactions.
   - Files:
     - `src/browser/browser-manager.ts`
     - `src/browser/ops-browser-manager.ts`
     - `extension/src/ops/ops-runtime.ts`
     - `src/cli/daemon-commands.ts`
     - `src/tools/`
   - If these become public CLI surfaces in the same cutover, update CLI args and help inventory in the same program.

8. Add challenge timeline and resume telemetry keyed by `challengeId`.
   - Files:
     - `src/browser/global-challenge-coordinator.ts` (new)
     - `src/browser/browser-manager.ts`
     - `src/browser/ops-browser-manager.ts`
     - `src/providers/index.ts`
     - `src/providers/workflows.ts`

## Preventive Measures

- Add contract tests that lock blocker and challenge envelope parity across managed, daemon, remote-manager, and ops surfaces.
- Add integration tests for preserved-session challenge mode: detect, preserve, act, verify, resume.
- Add provider runtime tests that prove challenged fallback sessions are preserved while `env_limited` sessions are deferred.
- Add registry and policy tests that prove durable challenge pressure affects provider selection below workflows.
- Add owned-environment fixtures using Turnstile or reCAPTCHA test keys so challenge-mode behavior can be exercised without depending on production anti-bot systems.
- Keep providers small by routing escalation, retry, and fallback ownership through one runtime binder path instead of per-provider hacks.
- Track challenge timelines and unresolved-age metrics so pressure handling remains visible under load instead of failing silently.
