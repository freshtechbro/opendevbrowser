# Part 2: Challenge Continuation, Assist, Verification, and Governed Challenge Access

Status: active research
Date: 2026-03-21
Scope: Part 2 architecture and product-direction document for anti-bot challenge handling beyond the current Part 1 plan

## Executive Summary

The original Part 2 request asked for two new modules:

1. autonomous solving of third-party anti-bot systems
2. CAPTCHA-solving services

That request was investigated against the current OpenDevBrowser architecture, the current Part 1 anti-bot docs, and current external ecosystem patterns. The updated result is:

- OpenDevBrowser can and should grow into a much stronger anti-bot challenge system.
- It should not promote those lanes into the core Part 2 architecture.
- It should not treat every challenge-handling lane as equally out of bounds.
- The correct Part 2 is a two-track model:
  - a core challenge continuation architecture
  - a separately governed optional challenge-access lane

This is still AI-native, powerful, and durable. It uses the agent where the agent is strongest:

- perception
- reasoning
- planning
- operator guidance
- verification
- pressure-aware routing

It avoids the three traps that would make the system brittle:

- creating a second blocker lifecycle outside the browser managers
- pushing provider-specific or hidden solver logic into runtime seams that should stay shared and explicit
- letting optional vendor or enterprise challenge adapters redefine the core ownership model

## What Changed From The Original Request

The original request is not adopted as written for two separate reasons, but the external market evidence does justify a narrower update.

### 1. Existing boundary conflict

Part 1 already defines the following as out of scope for the current core contract:

- hidden bypass paths
- autonomous solving of third-party anti-bot systems
- CAPTCHA-solving services
- challenge token harvesting
- provider-specific anti-bot evasion logic

Those constraints are already in:

- `docs/INVESTIGATION_ANTI_BOT_CHALLENGE_ORCHESTRATION_2026-03-21.md`
- `docs/ANTI_BOT_CHALLENGE_ORCHESTRATION_IMPLEMENTATION_PLAN.md`

### 2. Architecture conflict

Even if the legitimacy boundary were ignored, the current architecture is not shaped correctly for a third-party autonomous solver lane:

- `SessionStore` is blocker-only.
- `BrowserManager` and `OpsBrowserManager` are intended to remain the only lifecycle writers.
- browser fallback still disconnects sessions in `runtime-factory`.
- `ops-runtime` is still transport-thin.
- daemon still bridges blocker metadata parity.
- durable challenge pressure still lives too high in workflows.
- low-level pointer primitives are not yet part of the shared manager contract.

So a literal third-party solver module would either:

- create a second challenge lifecycle
- couple to transitional shim layers
- or deepen provider-local drift

That is the opposite of the hardening direction established in Part 1.

### 3. Market evidence changed the product conclusion, but not the core architecture conclusion

Current market evidence shows that browser infrastructure vendors now expose several distinct challenge-handling lanes:

- hybrid human-in-the-loop browser sessions
- persistent authenticated browser profiles
- sanctioned agent identity paths such as Cloudflare Signed Agents and Web Bot Auth
- managed stealth and CAPTCHA-handling infrastructure

That means the earlier all-or-nothing framing is too blunt. The right update is not to make solver lanes core. The right update is to recognize a separate governed lane for sanctioned or enterprise challenge adapters while keeping the core Part 2 ownership model intact.

## Current Repo Evidence

### Current Part 1 boundary

Part 1 explicitly keeps the following in scope:

- preserved sessions
- challenge-aware orchestration
- visual observation loops
- low-level pointer support
- manual completion on third-party sites
- owned-environment completion with vendor test keys

And explicitly keeps the following out of scope:

- hidden bypass paths
- autonomous solving of third-party anti-bot systems
- CAPTCHA-solving services
- challenge token harvesting
- provider-specific anti-bot evasion logic

### Current blocker and lifecycle ownership

`SessionStore` currently holds blocker state only:

- `clear`
- `active`
- `resolving`

and resolution status:

- `resolved`
- `unresolved`
- `deferred`

This is the correct shape for blocker truth. It is not the correct place to store solver progress, solver tokens, or autonomous challenge sub-state.

### Current fallback gap

`src/providers/runtime-factory.ts` already detects challenge-like pages, but browser fallback still disconnects the session in `finally`. That means the system can reach the blocked page but cannot preserve it for:

- iterative visual inspection
- human handoff
- verify-clearance loops
- suspended-intent resume

This is the most important technical gap to close before any stronger Part 2 lane is even possible.

### Current ops parity gap

`OpsBrowserManager` already owns relay/session durability. But `extension/src/ops/ops-runtime.ts` still returns thin transport payloads for `session.status`, `nav.goto`, and `nav.wait`. Daemon then synthesizes blocker metadata as a compatibility bridge.

That means the correct path is still:

- keep `ops-runtime` thin
- enrich in `OpsBrowserManager`
- retire daemon shims only after manager-shaped parity is proven

It does not mean adding solver logic to daemon or `ops-runtime`.

### Current durable pressure gap

`ProviderRegistry` still tracks:

- health
- failures
- circuit-open state
- last error

`workflows.ts` still tracks:

- `anti_bot_pressure`
- alerts
- auto-exclusions
- `primary_constraint_summary`

So durable challenge pressure is still too high in the stack. Part 2 should move that pressure into central registry-backed state before adding anything more ambitious.

## External Research

The external ecosystem is consistent. Mature browser automation systems do not all solve the same problem, but they point in the same architectural direction.

### Browser control primitives

Playwright and Selenium both expose low-level pointer controls such as:

- move
- down
- up
- wheel
- drag

That is relevant because real-world challenge flows often require:

- click and hold
- drag
- hover-sensitive interaction
- precise pointer movement

This supports adding low-level pointer primitives into OpenDevBrowser manager contracts.

### Observe-then-act planning

Stagehand’s `observe()` model is useful because it separates:

- page perception
- action planning
- action execution

That pattern maps well to challenge handling. The agent should first identify what is on screen and what kind of challenge or interstitial is present before deciding whether the correct next step is:

- human handoff
- owned-test adapter
- normal action continuation
- deferral

### Persistent sessions and authenticated contexts

Browser Use, Browserbase, and Playwright all emphasize persistent sessions and authenticated state reuse. This is relevant because reliable challenge handling is usually less about “solving” and more about:

- keeping the same session alive
- preserving authentication and cookies
- avoiding needless re-entry into challenge flows

### Human-in-the-loop hybrid automation

Browserless documents hybrid automation where automation and manual intervention can coexist in the same session. That is a strong Part 2 pattern for OpenDevBrowser:

- preserve the live session
- share the session safely with an operator
- let the operator complete credentials, 2FA, or challenge interaction
- return control to the agent

This is a much more durable and legitimate architecture than hidden third-party solving.

### Vendor-supported testing lanes

Challenge vendors consistently support site-owner testing patterns:

- Cloudflare Turnstile provides dummy test keys for automated testing.
- Google reCAPTCHA documents site-owner key management and controlled integration patterns.
- hCaptcha documents site-owner integration and configuration patterns.

This supports a bounded Part 2 lane for:

- owned environments
- fixtures
- test keys
- deterministic challenge validation

### Adversary-model signal

Arkose Labs documentation treats solver farms as part of the adversary model and risk landscape. That is important context. It means a production integration strategy built around third-party solver services is not a stable or principled foundation for OpenDevBrowser.

## Ecosystem Readout

### What similar products do well

The strongest patterns in the market are:

- persistent browser sessions
- observe-then-act planning
- low-level pointer control
- hybrid automation with human takeover
- stealth and session durability
- owned-environment test harnesses

### What exists but should not become our core direction

There is also a market category of products and services that advertise:

- automatic CAPTCHA completion
- anti-bot challenge solving
- external solver APIs

That category exists, but it is not the right product direction for OpenDevBrowser core architecture. It would create a brittle arms race if it became the product center.

## Updated Part 2 Decision

OpenDevBrowser should adopt a split decision:

- keep solver and CAPTCHA-service lanes out of the core Part 2 architecture
- add a separately governed optional lane for sanctioned or enterprise challenge access

In practice, that means:

- core Part 2 remains challenge continuation, assist, verification, and resume
- optional challenge-access lanes are opt-in, audited, and separately governed
- no optional lane is allowed to replace canonical blocker truth or manager-owned lifecycle control

## Recommended Part 2 Direction

Part 2 should be framed as:

**Challenge Continuation, Assist, Verification, and Governed Challenge Access**

Not:

**Third-Party Anti-Bot Solving**

### Design goals

- preserve challenged sessions instead of tearing them down
- keep blocker truth centralized
- add AI-native observation and assist
- support manual completion on third-party sites
- support automated completion in owned environments using vendor-approved test keys
- support sanctioned or enterprise challenge-access adapters through a separate governance layer
- centralize challenge pressure and routing decisions
- reduce provider-local recovery logic

### Non-goals

- no hidden bypass path
- no autonomous third-party challenge solving as a core default
- no CAPTCHA-solving service integration as a core default
- no token harvesting or token injection lane
- no provider-specific anti-bot evasion packs
- no ungated vendor-managed challenge adapters in the default runtime path

## Recommended Modules

### 1. `GlobalChallengeCoordinator`

**Role**

- claim challenge ownership
- preserve challenge state
- record verification windows
- release or defer preserved sessions
- hand back resume metadata

**Correct seam**

- browser layer
- called only through `BrowserManager` and `OpsBrowserManager`

**Hard guardrail**

- lifecycle only
- not a solver engine

### 2. `PreservedFallbackTransport`

**Role**

- convert fallback from complete-or-disconnect into explicit outcomes:
  - `completed`
  - `challenge_preserved`
  - `deferred`
  - `failed`

**Correct seam**

- `src/providers/types.ts`
- `src/providers/runtime-factory.ts`
- `src/providers/index.ts`

**Hard guardrail**

- never silently completes third-party challenges

### 3. `ChallengeAssistPipeline`

**Role**

- collect screenshots, snapshots, trace, blocker metadata, and page state
- classify the challenge shell or interstitial
- generate the next best action plan
- decide whether the path is:
  - normal continuation
  - human assist
  - owned-environment adapter
  - deferral

**Correct seam**

- manager-shaped `meta.blocker` plus additive `meta.challenge`
- screenshot, snapshot, and trace tooling

**Hard guardrail**

- on third-party sites, this module assists and verifies
- it does not secretly bypass

### 4. `HumanAssistBridge`

**Role**

- expose a safe handoff path for:
  - manual login
  - 2FA
  - CAPTCHA completion
  - challenge interaction

**Correct seam**

- preserved session owned by `GlobalChallengeCoordinator`
- bridged through `OpsBrowserManager` / relay durable session ownership

**Hard guardrail**

- manual on third-party sites
- no external solver handoff

### 5. `OwnedEnvironmentChallengeAdapter`

**Role**

- handle vendor-approved test-key flows in environments we control
- support deterministic fixtures and CI

**Correct seam**

- separate adapter interface
- explicit allowlist of owned domains and test environments

**Hard guardrail**

- never enabled for arbitrary third-party production sites

### 6. `ChallengePressureStore`

**Role**

- move durable challenge pressure into central provider state
- drive:
  - cooldown
  - degraded state
  - selection order
  - preserved outcome memory

**Correct seam**

- `src/providers/registry.ts`
- `src/providers/policy.ts`
- `src/providers/shared/anti-bot-policy.ts`

**Hard guardrail**

- `workflows.ts` narrates
- workflows do not own durable pressure truth

### 7. `GovernedChallengeAdapterGateway`

**Role**

- expose a separate opt-in lane for:
  - live operator assist
  - sanctioned signed-agent paths
  - owned-environment test-key adapters
  - enterprise-approved managed challenge vendors
- keep adapter policy, entitlement, domain allowlists, and audit rules in one place

**Correct seam**

- above the core challenge modules
- consumes preserved sessions, evidence bundles, and canonical blocker state
- never becomes the blocker source of truth

**Hard guardrail**

- disabled by default
- explicitly allowlisted
- auditable
- never the default provider-routing path

## Target Architecture

```text
Part 2 recommended architecture

caller surface
(direct browser, provider runtime, workflow, daemon)
                         |
                         v
               BrowserManager / OpsBrowserManager
                         |
                         v
                   SessionStore
                   blocker FSM only
                         |
                         v
              GlobalChallengeCoordinator
      claim -> preserve -> verify -> defer/release
                         |
        +----------------+-------------------+
        |                                    |
        v                                    v
 PreservedFallbackTransport          ChallengePressureStore
 completed | preserved |             registry-backed cooldown,
 deferred | failed                     degraded state, routing
        |
        v
               ChallengeAssistPipeline
    screenshot + snapshot + trace + blocker + page state
                         |
        +----------------+-------------------+
        |                                    |
        v                                    v
             HumanAssistBridge      OwnedEnvironmentChallengeAdapter
             third-party manual     owned domains + test keys only
                        \            /
                         \          /
                          v        v
                GovernedChallengeAdapterGateway
          signed-agent + enterprise-approved adapters
                         |
                         v
                  Verification Gate
                         |
                         v
                 Resume Suspended Intent
```

## Runtime Flow

```text
[Request enters]
      |
      v
[Manager executes goto/status/wait/trace]
      |
      v
[Blocker reconciled into SessionStore]
      |
      +--> no blocker ----------------------------> [Return normal]
      |
      +--> blocker detected
              |
              v
      [GlobalChallengeCoordinator claims/preserves]
              |
              v
      [ChallengeAssistPipeline builds evidence bundle]
              |
      +-------+-----------------------------+
      |                                     |
      | third-party site                    | owned environment
      |                                     |
      v                                     v
[HumanAssistBridge]               [OwnedEnvironmentChallengeAdapter]
      |                                     |
      +------------------+------------------+
                         |
                         v
      [GovernedChallengeAdapterGateway if explicitly allowed]
                         |
                         v
                  [Verification Gate]
                         |
                         +--> clear -----> [Resume suspended intent]
                         |
                         +--> active ----> [Keep preserved / await assist]
                         |
                         +--> deferred --> [Return canonical constraint summary]
```

## Exact Integration Seams

### Browser layer

Keep:

- `SessionStore` blocker-only
- manager-owned lifecycle writes

Add:

- additive `meta.challenge`
- preserved challenge/session ownership

Do not add:

- a second solver FSM
- token state in `SessionStore`

### Ops path

Keep:

- `ops-runtime` transport-thin
- `OpsBrowserManager` as the place that enriches responses

Add:

- parity for `meta.challenge`
- preserved-session rebind/release ownership

Do not add:

- solver logic to `ops-runtime`

### Daemon

Keep:

- compatibility bridge behavior until manager parity is proven

Do not make daemon:

- the long-term challenge owner
- the place where solving decisions happen

### Provider runtime

Keep:

- anti-bot preflight/postflight
- fallback routing

Add:

- explicit preserve-or-complete disposition
- suspended intent and resume mode

Do not make runtime:

- a hidden solver dispatcher

### Provider registry and policy

Keep:

- shared policy ownership

Add:

- durable challenge pressure
- preserved outcome memory
- routing impact from challenge pressure
- policy hooks for governed optional adapters

Do not keep:

- workflow-owned durable pressure

### Providers

Keep:

- extraction logic
- provider hints
- shell detection hints where needed

Reduce:

- provider-local fallback ordering
- provider-local anti-bot strategy trees

## Optional Governed Lane

These lanes should not become the OpenDevBrowser core contract, but they are now important enough to define as a separate governed lane.

### 1. Human-in-the-loop challenge continuation

**Verdict:** allowed and strongly recommended

**Why**

- aligns with preserved-session architecture
- matches Browserless-style hybrid automation patterns
- keeps the agent and operator in the same canonical session lifecycle

### 2. Signed-agent and recognized-agent paths

**Verdict:** allowed when the target ecosystem supports them

**Why**

- uses explicit bot or agent identity instead of hidden bypass
- fits Cloudflare Signed Agents and Web Bot Auth style programs
- is structurally cleaner than pretending the agent is a normal anonymous browser

### 3. Owned-environment challenge adapters

**Verdict:** allowed

**Why**

- matches vendor-approved test-key and fixture flows
- deterministic and CI-friendly
- does not require hidden bypass behavior

### 4. Enterprise-approved managed challenge adapters

**Verdict:** allowed only as a separate governed lane

**Why**

- the market now clearly offers managed browser infrastructure with stealth and challenge-handling features
- some enterprise customers may want those capabilities
- this lane must stay opt-in and non-core so it does not distort the blocker/session ownership model

## Still Rejected For Core

These lanes were investigated and should still be rejected as the OpenDevBrowser core contract.

### 1. Autonomous third-party anti-bot solver as the default Part 2 architecture

**Verdict:** rejected for core

**Why**

- conflicts with Part 1 legitimacy boundary
- would create a second challenge control path
- would couple to fragile visual and network heuristics
- would deepen the arms race with anti-bot vendors

### 2. CAPTCHA-solving service adapter as a default runtime dependency

**Verdict:** rejected for core

**Why**

- it should not be the default product story
- it creates privacy, compliance, and dependency risk
- it would encourage hidden bypass behavior if not heavily governed
- if it exists at all, it belongs only inside the governed optional lane

### 3. Token brokerage / hidden challenge injection

**Verdict:** rejected

**Why**

- hidden bypass path
- wrong ownership seam
- not durable

### 4. Provider-specific anti-bot packs

**Verdict:** rejected

**Why**

- increases provider brittleness
- conflicts with Part 1 goal of shared runtime ownership

## Implementation Sequence For The Recommended Part 2

### Task 1

Preserve fallback sessions instead of always disconnecting them.

### Task 2

Add `GlobalChallengeCoordinator` and additive `meta.challenge` surfacing.

### Task 3

Add low-level pointer primitives and screenshot/trace parity across managed and ops paths.

### Task 4

Add `ChallengeAssistPipeline` for evidence bundling, challenge classification, and next-step planning.

### Task 5

Add `HumanAssistBridge` for safe third-party manual completion on preserved sessions.

### Task 6

Add `OwnedEnvironmentChallengeAdapter` for vendor-approved test-key fixtures and deterministic CI.

### Task 7

Add `GovernedChallengeAdapterGateway` and its allowlist, audit, and entitlement contract.

### Task 8

Move durable challenge pressure into `ProviderRegistry` and shared policy.

### Task 9

Remove provider-local fallback ownership from shopping and other provider-specific escalation paths.

## Acceptance Criteria

- No new lifecycle writer exists outside `BrowserManager` and `OpsBrowserManager`.
- `SessionStore` remains blocker-only.
- Fallback can return preserved challenge sessions instead of always disconnecting them.
- Third-party challenge handling remains manual or operator-assisted.
- Owned-environment challenge automation is explicitly bounded to allowlisted fixtures and vendor-approved test modes.
- Any sanctioned or enterprise challenge adapter lane is disabled by default, separately governed, and consumes canonical blocker/session truth rather than redefining it.
- Durable challenge pressure no longer lives primarily in `workflows.ts`.
- Providers no longer own bespoke anti-bot recovery trees.

## References

### Browser automation primitives and session models

- Playwright Mouse API: https://playwright.dev/docs/api/class-mouse
- Playwright Screenshots: https://playwright.dev/docs/screenshots
- Playwright Authentication: https://playwright.dev/docs/auth
- Selenium Actions API: https://selenium.dev/documentation/webdriver/actions_api
- Selenium Mouse Actions: https://selenium.dev/documentation/webdriver/actions_api/mouse

### Observe / plan / persistent context patterns

- Stagehand Observe: https://docs.stagehand.dev/basics/observe
- Stagehand Observe API: https://docs.stagehand.dev/v3/references/observe
- Browser Use Authentication: https://docs.browser-use.com/customize/browser/authentication
- Browser Use Sessions & Profiles: https://docs.browser-use.com/concepts/profile
- Browser Use Proxies & Stealth: https://docs.browser-use.com/cloud/guides/proxies-and-stealth
- Browserbase Stagehand: https://docs.browserbase.com/introduction/stagehand
- Browserbase Stealth Mode: https://docs.browserbase.com/features/stealth-mode
- Browserbase Advanced Stealth: https://docs.browserbase.com/guides/stealth-customization

### Human-in-the-loop patterns

- Browserless Hybrid Automation: https://docs.browserless.io/baas/hybrid-automation
- Browserless CAPTCHA Handling: https://docs.browserless.io/baas/bot-detection/captchas
- Browserless BrowserQL CAPTCHA Solving: https://docs.browserless.io/browserql/bot-detection/solving-captchas

### Challenge-vendor testing guidance

- Cloudflare Turnstile Testing: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- Cloudflare Turnstile E2E Test Keys: https://developers.cloudflare.com/turnstile/tutorials/excluding-turnstile-from-e2e-tests/
- Cloudflare Signed Agents: https://developers.cloudflare.com/bots/concepts/bot/signed-agents/
- Cloudflare Web Bot Auth: https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
- Google reCAPTCHA FAQ: https://developers.google.com/recaptcha/docs/faq
- hCaptcha Developer Guide: https://docs.hcaptcha.com/

### Adversary and risk context

- Arkose Labs Risk Score: https://developer.arkoselabs.com/docs/risk-score
- Arkose Labs Verify API Response Fields: https://developer.arkoselabs.com/docs/verify-api-v4-response-fields

### Solver-service market category

- Capsolver API: https://docs.capsolver.com/en/api/
- 2Captcha API v2: https://2captcha.com/api-docs
- Anti-Captcha API Docs: https://anti-captcha.com/apidoc
