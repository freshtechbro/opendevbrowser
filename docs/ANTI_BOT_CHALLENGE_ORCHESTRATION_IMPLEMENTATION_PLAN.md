# Anti-Bot Challenge Orchestration Implementation Plan

Implement the full anti-bot challenge orchestration destination as one connected program of work across browser, ops, daemon, provider runtime, workflows, provider modules, tools, docs, and tests.

This plan is based on direct repo verification plus current official ecosystem patterns from Playwright, Selenium, Stagehand, Cloudflare Turnstile, and Browser Use. It assumes a strict legitimacy boundary:

- In scope: preserved sessions, challenge-aware orchestration, visual observation loops, low-level pointer support, manual completion on third-party sites, and owned-environment completion with vendor test keys.
- Out of scope: hidden bypass paths, autonomous solving of third-party anti-bot systems, CAPTCHA-solving services, challenge token harvesting, or provider-specific anti-bot evasion logic.

---

## Overview

### Verified current state
- Blocker classification already exists in `src/providers/blocker.ts`.
- Blocker and manual-follow-up summarization already exist in `src/providers/constraint.ts`.
- Canonical blocker FSM truth already exists in `src/browser/session-store.ts`.
- Managed blocker surfacing already exists in `src/browser/browser-manager.ts`.
- Ops durability and reconnect already exist in `src/browser/ops-browser-manager.ts`.
- Preserved challenge sessions do not exist yet because `src/providers/runtime-factory.ts` always disconnects fallback sessions in `finally`.
- Durable anti-bot pressure still lives in `src/providers/workflows.ts`.
- `src/providers/registry.ts` and `src/providers/policy.ts` are still challenge-blind.
- Provider-local recovery ownership still exists in `src/providers/shopping/index.ts` and `src/providers/social/youtube-resolver.ts`.
- Public tool and manager surfaces stop at high-level actions such as `click`, `hover`, `press`, `type`, `scroll`, and `screenshot`. They do not yet expose low-level pointer down, move, up, or drag contracts.

### Root cause
- The repo already has the hard primitives for blocker detection, blocker truth, browser control, and ops durability.
- The missing pieces are contracts and ownership:
  - challenge lifecycle contract
  - preserved fallback disposition contract
  - manager-owned ops parity contract
  - runtime-owned resume and durable pressure contract

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

### Key decisions
- `SessionStore` remains the sole blocker FSM authority.
- A new browser-layer `GlobalChallengeCoordinator` owns challenge lifecycle only.
- `BrowserManager` and `OpsBrowserManager` remain the only writers of surfaced blocker and challenge state.
- `ops-runtime` stays transport-thin and does not become a second blocker engine.
- Shared runtime owns preserve-or-complete fallback transport, suspended-intent consumption, resume invocation after verification, and challenge-aware ordering. It does not claim or mutate lifecycle state directly.
- `ProviderRegistry` is the sole durable challenge-pressure authority. `policy.ts` and `AntiBotPolicyEngine` operate through that registry-backed state.
- `workflows.ts` keeps narration and rendering, not long-lived pressure truth.
- Providers keep extraction, shell detection, and domain hints, not recovery ownership.
- Direct browser continuation remains manual by default. Provider and workflow continuation may auto-resume only after verification.

### Unified execution posture
- This destination lands as one connected cutover program guarded by compatibility gates, not as phased keep-now, near-term, and later architecture.
- Task order is dependency order and cutover safety order only.
- Earlier "keep now", "near term", and "later" items are absorbed into Tasks 1-7 below.
- Compatibility gates stay in place during the same branch-level execution so the destination can land without breaking blocker truth, workflow outputs, CLI surfaces, or current `env_limited` semantics.

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

### Runtime flow

Tasks 1 through 6 land this runtime flow without relaxing the compatibility gates above.

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

---

## Task 1 - Freeze contracts and add additive lifecycle types

### Reasoning
The repo already has blocker truth. The destination needs additive lifecycle contracts without breaking shipped blocker fields, reason codes, or workflow keys.

### What to do
Define the lifecycle, fallback, and pointer contracts that every later change will use.

### How
1. Expand `BrowserFallbackRequest` in `src/providers/types.ts` with:
   - `ownerSurface`
   - `ownerLeaseId`
   - `resumeMode`
   - `suspendedIntent`
2. Expand `BrowserFallbackResponse` with:
   - `disposition`
   - `challenge`
   - preserved session reference fields
3. Add shared lifecycle types such as:
   - `ResumeMode`
   - `SuspendedIntentKind`
   - `SessionChallengeSummary`
4. Extend `src/browser/manager-types.ts` with additive challenge envelope types.
5. Add low-level pointer method types:
   - `pointerMove`
   - `pointerDown`
   - `pointerUp`
   - `drag`

### Files impacted
- `src/providers/types.ts`
- `src/browser/manager-types.ts`

### End goal
All later work builds on one additive contract set without changing blocker truth.

### Acceptance criteria
- [ ] Existing blocker fields remain unchanged.
- [ ] No lifecycle value is encoded as a new `ProviderReasonCode`.
- [ ] Fallback types support preserve, lease, suspended intent, and explicit disposition.
- [ ] Pointer primitive types exist additively in manager contracts.

---

## Task 2 - Add browser-layer challenge lifecycle coordination

### Reasoning
Current blocker detection exists, but no component owns preserve, claim, verify, resume, expiry, or release.

### What to do
Create a browser-layer `GlobalChallengeCoordinator` and wire it into managed browser flows.

### How
1. Create `src/browser/global-challenge-coordinator.ts`.
2. Keep blocker classification out of the new coordinator.
3. Claim or refresh lifecycle when blocker state becomes active for `auth_required` or `anti_bot_challenge`.
4. Resolve, defer, or release lifecycle only after canonical verifier outcomes from `BrowserManager`.
5. Surface additive `meta.challenge` from:
   - `status`
   - `goto`
   - `waitForLoad`
   - `waitForRef`
   - `debugTraceSnapshot`
6. Keep lifecycle writes manager-owned:
   - `BrowserManager` and `OpsBrowserManager` claim, refresh, resolve, defer, expire, and release.
   - `runtime-factory` and provider runtime only consume returned lifecycle state.
7. Keep `SessionStore` blocker-only. If a helper is needed, keep it minimal and read-oriented.

### Files impacted
- `src/browser/global-challenge-coordinator.ts` (new file)
- `src/browser/browser-manager.ts`
- `src/browser/session-store.ts`

### End goal
Managed mode can expose and track preserved challenge lifecycle without altering blocker FSM semantics.

### Acceptance criteria
- [ ] `SessionStore` remains blocker-only.
- [ ] Managed `status/goto/wait/debugTraceSnapshot` expose additive `meta.challenge`.
- [ ] `auth_required` and `anti_bot_challenge` can be claimed, refreshed, resolved, deferred, expired, and released.
- [ ] Existing blocker tests still pass unchanged.

---

## Task 3 - Add ops parity and low-level pointer support

### Reasoning
Ops durability exists, but blocker and challenge parity is still thin and low-level pointer support is missing for hold, drag, and opaque overlay flows.

### What to do
Make `OpsBrowserManager` return the same blocker and challenge envelope as managed mode and add low-level pointer primitives across manager, ops, daemon, and tools.

### How
1. Extend `OpsBrowserManager` to enrich raw ops transport responses into the same additive envelope used by `BrowserManager`.
2. Keep `ops-runtime` raw and evidence-oriented. Do not add blocker policy there.
3. Add raw ops commands for:
   - `pointer.move`
   - `pointer.down`
   - `pointer.up`
   - `pointer.drag`
4. Add matching manager methods and a shared manager-shaped `debugTraceSnapshot` contract with `meta.blocker`, `meta.challenge`, and exception-channel parity.
5. Make `OpsBrowserManager` the sole owner for preserved challenge rebind and release on:
   - reconnect and protocol-session remap
   - disconnect
   - `ops_session_closed`
   - `ops_session_expired`
   - `ops_tab_closed`
6. Add public tool wrappers only after manager and ops parity tests are green.
7. If pointer primitives are public in this cutover, add matching CLI args and help inventory in the same task.
8. Keep daemon blocker and trace shims as a fallback only until manager-owned parity is proven.

### Files impacted
- `src/browser/manager-types.ts`
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- `extension/src/ops/ops-runtime.ts`
- `extension/src/ops/ops-session-store.ts`
- `src/cli/daemon-commands.ts`
- `src/cli/args.ts`
- `src/cli/help.ts`
- `src/tools/index.ts`
- `src/tools/surface.ts`

### End goal
Managed and ops surfaces have one parity contract and can support small observation-first interaction loops.

### Acceptance criteria
- [ ] Managed and ops surfaces return the same blocker and challenge envelope shape.
- [ ] Managed and ops `debugTraceSnapshot` return the same manager-shaped blocker and challenge envelope.
- [ ] `OpsBrowserManager` rebinds preserved challenges on reconnect and releases them on close, expiry, and tab close.
- [ ] Daemon can forward manager-shaped parity without reclassifying in the common path.
- [ ] Pointer primitives exist across manager and ops surfaces.
- [ ] If pointer primitives are public, CLI args and help inventory expose the same surface.
- [ ] Existing high-level actions remain backward-compatible.

---

## Task 4 - Convert fallback into preserve-or-complete transport

### Reasoning
Current fallback can reach auth and challenge pages but always destroys the session in `finally`.

### What to do
Preserve auth and challenge sessions and return explicit fallback dispositions.

### How
1. Use the expanded fallback request and response types from Task 1.
2. Keep a dual contract during cutover:
   - add `disposition` and challenge fields
   - preserve legacy `ok` and `output` until all provider-local callers migrate
   - centralize `disposition -> legacy shape` translation in shared runtime instead of repeating it in providers
3. In `src/providers/runtime-factory.ts`, stop unconditional disconnect when disposition is `challenge_preserved`.
4. Disconnect only on:
   - `completed`
   - `deferred`
   - `failed`
5. Keep lifecycle ownership manager-side:
   - runtime consumes returned `meta.challenge`
   - runtime never claims or mutates lifecycle directly
6. Keep `env_limited` capture and manual-follow-up semantics intact.
7. In shared runtime, distinguish:
   - completed normal fallback
   - preserved challenge fallback
   - deferred env-limited fallback
   - failed fallback

### Files impacted
- `src/providers/types.ts`
- `src/providers/runtime-factory.ts`
- `src/providers/index.ts`

### End goal
Fallback can either complete normally, preserve a blocked session, defer, or fail explicitly.

### Acceptance criteria
- [ ] Auth and challenge fallback can preserve sessions.
- [ ] `env_limited` capture and manual-follow-up still work.
- [ ] Preserved sessions are not disconnected in `finally`.
- [ ] Fallback responses include explicit disposition.
- [ ] Legacy `ok/output` callers remain correct until the provider migration is complete.

---

## Task 5 - Move durable anti-bot pressure and resume ownership below workflows

### Reasoning
Pressure, degraded-state truth, and exclusion logic currently live too high in `workflows.ts`.

### What to do
Move durable pressure into a `ProviderRegistry`-backed registry, policy, and runtime model, and let workflows consume it.

### How
1. Add challenge pressure state to `ProviderRegistry`, including:
   - active challenge count
   - unresolved challenge age
   - recent challenge ratio
   - recent rate-limit ratio
   - cooldown state
   - last preserved outcome
2. Make `ProviderRegistry` the sole durable authority for challenge pressure, cooldown, degraded state, exclusion truth, and last preserved outcome.
3. Update `selectProviders()` in `src/providers/policy.ts` to rank by pressure-aware rules before plain health and source ordering.
4. Make `AntiBotPolicyEngine` read and write through registry-backed state instead of holding parallel durable cooldown truth.
5. Make provider runtime tier routing and escalation read registry-backed pressure instead of computing a parallel authority.
6. Move long-lived signal windows and exclusion truth out of `workflows.ts`.
7. Keep workflow output keys and summaries stable.
8. Add resume ownership rules:
   - direct browser: `manual`
   - provider/workflow: `auto`

### Files impacted
- `src/providers/shared/anti-bot-policy.ts`
- `src/providers/registry.ts`
- `src/providers/policy.ts`
- `src/providers/index.ts`
- `src/providers/workflows.ts`

### End goal
Durable pressure is modeled below workflows and workflows become narrators, not long-lived policy owners.

### Acceptance criteria
- [ ] Registry stores durable challenge pressure state.
- [ ] Registry is the only durable pressure authority used by policy, runtime routing, and workflows.
- [ ] Policy selection is challenge-aware.
- [ ] Shared runtime can resume preserved provider and workflow intents.
- [ ] Workflow output keys remain unchanged.
- [ ] Existing `anti_bot_pressure`, `alerts`, and `primary_constraint_summary` outputs still render correctly.

---

## Task 6 - Remove provider-local recovery ownership

### Reasoning
Provider-local fallback ordering and escalation make the system brittle and block a single reusable orchestration model.

### What to do
Move recovery ownership into shared runtime while keeping provider-local shell detection and extraction logic.

### How
1. Convert shopping fallback ordering into runtime-owned policy.
2. Convert YouTube browser escalation into runtime-owned policy.
3. Add provider hint surfaces for:
   - preferred fallback modes
   - high-friction target hint
   - challenge-prone hint
   - settle and capture timing hint
4. Keep providers responsible for:
   - extraction
   - shell detection
   - transcript parsing
   - legal metadata
5. Update tests before removing provider-local ordering ownership.

### Files impacted
- `src/providers/shopping/index.ts`
- `src/providers/social/youtube-resolver.ts`
- `src/providers/social/youtube.ts`
- `src/providers/social/platform.ts`
- `src/providers/index.ts`

### End goal
Providers act as extraction and hint packages, not challenge, retry, or recovery owners.

### Acceptance criteria
- [ ] Shopping no longer owns fallback ordering.
- [ ] YouTube no longer owns direct browser escalation policy.
- [ ] Shared runtime owns recovery ordering and preserve/resume decisions.
- [ ] Provider tests assert hints and extraction behavior, not recovery ownership.

---

## Task 7 - Lock docs, fixtures, and test coverage to the new destination

### Reasoning
The cutover is too cross-cutting to ship safely without parity docs and deterministic legitimate fixtures.

### What to do
Update architecture docs, add owned-environment fixtures, and move tests to the new seams.

### How
1. Add managed, ops, and daemon parity tests for blocker and challenge envelopes.
2. Add preserved-session tests for `auth_required` and `anti_bot_challenge`.
3. Add owned challenge fixtures using first-party test keys only.
4. Add reconnect and teardown tests proving preserved challenges rebind and release correctly in ops mode.
5. Add trace parity tests proving managed, ops, and daemon trace responses carry the same blocker and challenge envelope.
6. If pointer primitives are public, lock CLI help and inventory parity in tests.
7. Update docs so the new ownership model, legitimacy boundary, and public surfaces are explicit.
8. Keep docs concise and source-backed.

### Files impacted
- `docs/ANTI_BOT_CHALLENGE_ORCHESTRATION_IMPLEMENTATION_PLAN.md` (new file)
- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `tests/browser-manager.test.ts`
- `tests/ops-browser-manager.test.ts`
- `tests/daemon-commands.integration.test.ts`
- `tests/providers-runtime-factory.test.ts`
- `tests/providers-shopping.test.ts`
- `tests/providers-workflows-branches.test.ts`
- `tests/providers-anti-bot-policy.test.ts`
- `tests/cli-help-parity.test.ts`

### End goal
The destination is testable, documented, and safe to execute immediately.

### Acceptance criteria
- [ ] Preserved-session challenge tests exist.
- [ ] Managed, ops, and daemon parity tests exist.
- [ ] Ops reconnect and teardown tests lock challenge rebind and release behavior.
- [ ] Trace parity tests lock daemon shim retirement gates.
- [ ] Shopping ordering tests are moved to runtime ownership.
- [ ] Owned-environment challenge fixtures use vendor test keys only.
- [ ] If pointer primitives are public, CLI help and inventory tests lock the surface.
- [ ] Docs reflect the new ownership model and legitimacy boundary.

---

## File-by-file implementation sequence

1. `src/providers/types.ts` - Tasks 1, 4
2. `src/browser/manager-types.ts` - Tasks 1, 3
3. `src/browser/global-challenge-coordinator.ts` - Task 2 (new file)
4. `src/browser/browser-manager.ts` - Tasks 2, 3
5. `src/browser/session-store.ts` - Task 2 helper-only if required
6. `src/browser/ops-browser-manager.ts` - Task 3
7. `extension/src/ops/ops-runtime.ts` - Task 3
8. `extension/src/ops/ops-session-store.ts` - Task 3 helper-only if required
9. `src/cli/daemon-commands.ts` - Task 3
10. `src/cli/args.ts` - Task 3 if pointer primitives are public
11. `src/cli/help.ts` - Task 3 if pointer primitives are public
12. `src/tools/index.ts` - Task 3
13. `src/tools/surface.ts` - Task 3
14. `src/providers/runtime-factory.ts` - Task 4
15. `src/providers/index.ts` - Tasks 4, 5, 6
16. `src/providers/shared/anti-bot-policy.ts` - Task 5
17. `src/providers/registry.ts` - Task 5
18. `src/providers/policy.ts` - Task 5
19. `src/providers/workflows.ts` - Task 5
20. `src/providers/shopping/index.ts` - Task 6
21. `src/providers/social/youtube-resolver.ts` - Task 6
22. `src/providers/social/youtube.ts` - Task 6
23. `src/providers/social/platform.ts` - Task 6
24. `tests/browser-manager.test.ts` - Task 7
25. `tests/ops-browser-manager.test.ts` - Task 7
26. `tests/daemon-commands.integration.test.ts` - Task 7
27. `tests/providers-runtime-factory.test.ts` - Task 7
28. `tests/providers-shopping.test.ts` - Task 7
29. `tests/providers-workflows-branches.test.ts` - Task 7
30. `tests/providers-anti-bot-policy.test.ts` - Task 7
31. `tests/cli-help-parity.test.ts` - Task 7 if pointer primitives are public
32. `docs/ARCHITECTURE.md` - Task 7
33. `docs/CLI.md` - Task 7
34. `docs/SURFACE_REFERENCE.md` - Task 7

---

## Dependencies to add

| Package | Version | Purpose |
|---------|---------|---------|
| none by default | n/a | Use the existing browser, ops, daemon, and provider stack first |
| optional only if proven necessary later | TBD | Add only after verifying the current stack cannot support a required contract cleanly |

---

## Dependencies and task mapping

| Task | Depends on | Enables |
|------|------------|---------|
| Task 1 | none | Tasks 2-7 |
| Task 2 | Task 1 | Tasks 3-5 |
| Task 3 | Tasks 1-2 | Task 4 parity, Task 7 public surfaces |
| Task 4 | Tasks 1-3 | Tasks 5-6 |
| Task 5 | Tasks 1-4 | Task 6 and final workflow cutover |
| Task 6 | Tasks 4-5 | Final destination behavior |
| Task 7 | Tasks 1-6 | Release-ready cutover |

---

## External reference patterns

- Playwright low-level mouse and input actions support viewport-based pointer move, down, up, and action sequencing, plus auth-state reuse with saved browser state.
- Selenium Actions API models pointer chains such as click-and-hold, drag-and-drop, pause, and pointer down/up at a low level.
- Stagehand documents observe-then-act loops and screenshot-guided decision making with small atomic actions.
- Cloudflare Turnstile documents dedicated test keys for automated testing and warns that automated browsers are detected as bots.
- Browser Use documents long-lived browser sessions with live monitoring and reuse across tasks.

These references validate the feasibility of low-level primitives, preserved sessions, and observation-first loops. They do not justify autonomous bypass of third-party production challenges.

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-21 | Initial full connected implementation program |
| 1.1 | 2026-03-21 | Added cutover gates for fallback compatibility, ops rebind and release, single pressure authority, trace parity, and CLI surface ownership |
