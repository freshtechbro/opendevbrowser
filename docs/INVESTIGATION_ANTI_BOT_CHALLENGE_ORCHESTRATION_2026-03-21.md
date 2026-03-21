# Investigation: Global Challenge Mode and Provider Handshake

Status: active
Date: 2026-03-21

## Summary

OpenDevBrowser already has the core primitives needed for blocker-aware recovery: a canonical blocker envelope, session-scoped blocker FSM state, ordinary browser navigation and interaction surfaces, screenshots and snapshots, debug traces, and an agent handoff substrate. The missing capability is not blocker detection. The missing capability is one reusable global challenge mode that any session surface can enter, preserve, verify, and resume.

The second major gap is provider packaging. Shared concerns such as anti-bot policy, cookies, browser fallback, challenge escalation, and retry are still split between runtime defaults and provider-specific modules. That split is the main reason provider wiring feels brittle. The clean direction is a provider package plus runtime binder or handshake model: providers declare requirements and domain hints, while shared runtime owns transport, policy, challenge mode, and retry.

## Symptoms

- Blocker-aware paths report `auth_required`, `anti_bot_challenge`, `rate_limited`, and `env_limited`, but they still degrade, defer, or fail instead of switching into a shared solve mode.
- Browser fallback reaches real challenge or auth pages, but disposes the session before an agent can take over.
- Direct browser usage is broader than workflows: login screens, form filling, profile pickers, ordinary navigation, and skill-driven runs all use the same browser surfaces.
- Extension ops ordinary browser usage does not currently return the same blocker envelope that CLI and daemon surfaces expose.
- Provider-specific logic still decides too much about fallback mode order, browser assistance, and challenge behavior.

## Investigation Log

### Phase 1 - Trigger surfaces are broader than workflows
**Hypothesis:** anti-bot challenge mode must live below workflows because OpenDevBrowser exposes many non-workflow browser entry points.

**Findings:** the public tool surface already includes ordinary browser entry points such as `launch`, `connect`, `status`, `goto`, `wait`, `snapshot`, `click`, `type`, `scroll`, `screenshot`, and `annotate`, plus direct workflow entry points for research, shopping, and product-video. Daemon routes forward ordinary navigation and interaction calls through the same manager layer. Extension ops exposes `session.status` and related browser-use commands outside workflows as well.

**Evidence:**
- `src/tools/surface.ts:7-56`
- `src/cli/daemon-commands.ts:210-337`
- `src/browser/ops-browser-manager.ts:173-188`
- `src/cli/remote-manager.ts:78-80`
- `extension/src/ops/ops-runtime.ts:553-568`

**Conclusion:** confirmed. Challenge mode must be reusable across normal browser use, skills, workflows, and daemon or extension command paths.

### Phase 2 - Canonical blocker contract and state ownership already exist
**Hypothesis:** OpenDevBrowser already has a strong shared blocker contract and a canonical state owner that a global challenge mode can build on.

**Findings:** the public CLI docs define an additive blocker contract under `meta.blocker*`. `SessionStore` already owns blocker FSM state and resolution history. `BrowserManager.status()` reads from that store, and `BrowserManager.reconcileSessionBlocker()` classifies signals and persists them back into the same store.

**Evidence:**
- `docs/CLI.md:668-809`
- `src/browser/session-store.ts:52-239`
- `src/browser/browser-manager.ts:560-594`
- `src/browser/browser-manager.ts:2369-2430`

**Conclusion:** confirmed. The right architecture is to reuse the existing blocker envelope and state machine, not to invent a second public contract.

### Phase 3 - Extension ops still has a blocker-envelope parity gap
**Hypothesis:** the biggest cross-surface contract drift is on extension ops status and related ordinary browser responses.

**Findings:** managed or daemon-backed status already returns `meta.blockerState`, optional `meta.blocker`, and optional `meta.blockerResolution`. By contrast, `OpsBrowserManager.status()` simply proxies extension `session.status`, and extension `handleSessionStatus()` returns mode, target, URL, title, lease, and state, but no blocker metadata. Daemon helpers already prove how blocker enrichment can be layered onto thinner lower-level results.

**Evidence:**
- `src/browser/browser-manager.ts:560-594`
- `src/browser/ops-browser-manager.ts:173-188`
- `extension/src/ops/ops-runtime.ts:553-568`
- `src/cli/daemon-commands.ts:1001-1095`

**Conclusion:** confirmed. Global challenge mode needs one cross-surface blocker envelope, and extension ops is the main parity gap to close.

### Phase 4 - Browser fallback reaches the blocked page but tears it down
**Hypothesis:** the current browser fallback path is the closest existing seam for challenge orchestration.

**Findings:** runtime fallback already detects auth and challenge pages, launches or attaches a browser session, injects cookies, navigates, waits, captures HTML, and reads session status. But it always disconnects the session in `finally`, even after reaching a challenge or auth wall.

**Evidence:**
- `src/providers/runtime-factory.ts:240-287`
- `src/providers/runtime-factory.ts:289-489`

**Conclusion:** confirmed. The current fallback path can reach the blocked page, but it cannot preserve that page for iterative agent-assisted clearance.

### Phase 5 - Provider runtime already owns shared policy and transport wiring
**Hypothesis:** shared runtime, not provider modules, is already the natural place to own anti-bot policy, cookies, and fallback transport.

**Findings:** runtime config wiring already centralizes blocker threshold, anti-bot policy, transcript settings, and provider cookie policy/source. Runtime execution already performs anti-bot preflight and injects `browserFallbackPort` into `ProviderContext`. Provider selection and registry state remain intentionally generic.

**Evidence:**
- `src/providers/runtime-factory.ts:497-560`
- `src/providers/index.ts:1011-1059`
- `src/providers/policy.ts:27-55`
- `src/providers/registry.ts:16-149`
- `src/config.ts:173-181`
- `src/config.ts:309-365`
- `src/config.ts:557-565`

**Conclusion:** confirmed. The shared runtime layer already has the right responsibilities to own challenge-mode entry and provider binding.

### Phase 6 - Provider packaging is mixed and brittle today
**Hypothesis:** provider-specific brittleness comes from mixed ownership of shared concerns rather than from one missing anti-bot branch.

**Findings:** default runtime assembly still wraps web, community, and social providers through source-specific default wrappers and registers shopping separately. Social platform providers expose capabilities and profile factories, but their health still reduces to “configured vs not configured.” Shopping still decides its own fallback preference order and browser-assistance recovery inside the provider module itself.

**Evidence:**
- `src/providers/index.ts:1599-1852`
- `src/providers/social/platform.ts:75-122`
- `src/providers/social/platform.ts:265-490`
- `src/providers/social/index.ts:50-88`
- `src/providers/shopping/index.ts:335-408`
- `src/providers/shopping/index.ts:444-523`
- `src/providers/shopping/index.ts:1340-1364`

**Conclusion:** confirmed. Provider-specific logic is still mixed with transport and recovery policy, which is why the wiring is brittle.

### Phase 7 - Workflows consume challenge pressure; they do not own resolution
**Hypothesis:** workflows should remain consumers of shared challenge health rather than becoming the anti-bot owner.

**Findings:** workflow code records provider signals, computes `reasonCodeDistribution`, `antiBotPressure`, and auto-excluded provider sets, and reports those metrics for research, shopping, and product-video flows. It does not preserve sessions or run any shared challenge loop.

**Evidence:**
- `src/providers/workflows.ts:1226-1302`
- `src/providers/workflows.ts:1352-1444`
- `src/providers/workflows.ts:1668-1700`
- `docs/TROUBLESHOOTING.md:169-205`

**Conclusion:** confirmed. Workflows should consume shared challenge state and health, not define it.

### Phase 8 - Current external patterns support this direction
**Hypothesis:** the broader browser automation ecosystem separates low-level pointer and screenshot primitives from higher-level observation and action loops, and mature systems preserve authenticated sessions rather than hardcoding provider hacks.

**Findings:** current official docs and GitHub repos show a consistent pattern:
- Playwright exposes low-level mouse and screenshot primitives, and its official MCP tools now include coordinate mouse move, click, drag, and screenshot capabilities.
- Stagehand uses an explicit `observe()` then `act()` model, including replayable action plans.
- Browser Use leans on real browser profiles, exported storage state, and vision-oriented agent settings instead of provider-specific scrape hacks.
- Selenium’s Actions API remains the standard for click, drag-and-drop, and other pointer flows.
- Challenge vendors themselves recommend test keys for owned environments rather than bypassing production controls.

**Evidence:**
- Playwright docs: https://playwright.dev/docs/api/class-mouse
- Playwright docs: https://playwright.dev/docs/screenshots
- Playwright GitHub MCP capabilities and mouse tools:
  - https://github.com/microsoft/playwright/blob/main/tests/mcp/capabilities.spec.ts
  - https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/backend/mouse.ts
  - https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/backend/screenshot.ts
- Stagehand docs: https://docs.stagehand.dev/basics/observe
- Stagehand GitHub examples:
  - https://github.com/browserbase/stagehand/blob/main/packages/core/examples/actionable_observe_example.ts
  - https://github.com/browserbase/stagehand/blob/main/packages/core/examples/form_filling_sensible.ts
- Browser Use docs:
  - https://docs.browser-use.com/customize/browser/authentication
  - https://docs.browser-use.com/open-source/customize/agent/all-parameters
- Browser Use GitHub examples:
  - https://github.com/browser-use/browser-use/blob/main/examples/browser/real_browser.py
  - https://github.com/browser-use/browser-use/blob/main/examples/browser/save_cookies.py
- Selenium docs: https://www.selenium.dev/documentation/webdriver/actions_api/
- Selenium GitHub actions tests:
  - https://github.com/SeleniumHQ/selenium/blob/trunk/java/test/org/openqa/selenium/interactions/DragAndDropTest.java
  - https://github.com/SeleniumHQ/selenium/blob/trunk/dotnet/test/common/Interactions/BasicMouseInterfaceTests.cs
- Cloudflare Turnstile testing: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- Google reCAPTCHA FAQ and test keys: https://developers.google.com/recaptcha/docs/faq

**Conclusion:** confirmed. The durable pattern is: keep sessions alive, expose screenshots and pointer primitives, run an observe or inspect then act loop above them, and use vendor-approved test fixtures in owned environments.

## Root Cause

The main problem is orchestration, not detection.

OpenDevBrowser already knows when it has hit `auth_required`, `anti_bot_challenge`, `rate_limited`, and `env_limited` conditions. It already exposes screenshots, snapshots, debug traces, and blocker state. But no shared component owns the full lifecycle required for unexpected challenge handling:

1. detect the blocker from any surface,
2. preserve the live blocked session,
3. switch the session into challenge mode,
4. capture screenshot, snapshot, debug trace, and current target context,
5. hand that context to the agent,
6. let the agent act iteratively through ordinary browser controls,
7. verify clearance through the existing blocker FSM,
8. resume the interrupted navigation, form fill, login, profile selection, workflow, or provider step.

Because that shared coordinator does not exist yet, challenge behavior leaks into:

- browser fallback cleanup, which always tears down the session,
- daemon-only enrichment helpers,
- extension ops contract drift,
- workflow-level degraded and exclusion logic,
- provider-specific fallback preferences and browser-assistance heuristics.

The provider side has a second root cause: shared transport and recovery concerns are still partly encoded inside provider modules. That mixes responsibilities and produces brittle provider-specific hacks.

## Recommendations

1. Add one reusable `GlobalChallengeCoordinator` in the core browser layer, backed by a shared challenge or blocker state store.
   - Put the coordinator near `BrowserManager` and `OpsBrowserManager`, not inside provider runtime and not inside extension `ops-runtime`.
   - Keep `SessionStore` focused on canonical blocker state and managed session ownership.
   - Files: `src/browser/session-store.ts`, `src/browser/browser-manager.ts`, `src/browser/ops-browser-manager.ts`, plus a new file such as `src/browser/global-challenge-coordinator.ts`.

2. Make every blocker-aware surface enter the same challenge mode.
   - Trigger surfaces should include direct `goto`, `wait`, `status`, `snapshot`, `screenshot`, login flows, form-filling flows, profile-selection flows, skill-driven runs, and workflow-driven runs.
   - Workflows and skills should call into a shared challenge-capable browser runtime rather than owning bespoke anti-bot logic.
   - Files: `src/tools/surface.ts`, `src/cli/daemon-commands.ts`, `src/browser/ops-browser-manager.ts`, `src/cli/remote-manager.ts`.

3. Harmonize extension ops with the canonical blocker envelope.
   - `session.status`, `nav.goto`, and `nav.wait` from extension ops should expose the same blocker metadata that CLI and daemon surfaces expose.
   - Reuse shared enrichment on the core side where lower layers cannot supply full blocker metadata.
   - Files: `extension/src/ops/ops-runtime.ts`, `src/browser/ops-browser-manager.ts`, `src/cli/daemon-commands.ts`, `docs/CLI.md`.

4. Preserve fallback sessions for resolvable blockers instead of always disconnecting them.
   - `anti_bot_challenge` and `auth_required` should preserve the live blocked session and hand it to the coordinator.
   - `env_limited` should remain a deferred outcome, not a solve attempt.
   - Files: `src/providers/runtime-factory.ts`, `src/browser/browser-manager.ts`.

5. Add first-class pointer primitives as a supporting capability, not as the owner of challenge mode.
   - Public surfaces currently support ref-based click, hover, type, and scroll, but not coordinate pointer move/down/up/click/drag.
   - Add coordinate pointer actions for cases such as hold-to-verify, drag sliders, canvas UIs, and opaque overlays.
   - Files: `src/browser/browser-manager.ts`, `src/browser/ops-browser-manager.ts`, `extension/src/ops/ops-runtime.ts`, `extension/src/ops/dom-bridge.ts`, `src/cli/daemon-commands.ts`, `src/tools/`.

6. Replace ad hoc provider wrapping with a provider package plus binder or handshake model.
   - Providers should declare capabilities, legal metadata, session requirements, resolvable blocker families, and domain-specific parsing or shell-detection hints.
   - Shared runtime should own anti-bot preflight/postflight, cookie policy and source binding, browser fallback transport, challenge-mode escalation, and retry after resolution.
   - Files: `src/providers/index.ts`, `src/providers/runtime-factory.ts`, `src/providers/policy.ts`, `src/providers/registry.ts`, `src/providers/social/platform.ts`, `src/providers/social/index.ts`, `src/providers/shopping/index.ts`.

7. Move durable challenge health out of workflows and into shared runtime or a shared registry-adjacent layer.
   - Workflows should still report `antiBotPressure`, `reasonCodeDistribution`, and exclusions, but they should consume shared challenge state rather than define it.
   - Files: `src/providers/workflows.ts`, `src/providers/registry.ts`, `src/providers/index.ts`.

8. Keep the safe boundary explicit.
   - Do not implement challenge-code inspection, token injection, or security bypass features aimed at defeating third-party anti-bot systems.
   - For owned environments, use vendor-approved test keys or challenge test modes.
   - For real environments, use agent-assisted clearance, session reuse, environment switching, or graceful deferral.

## Preventive Measures

- Add cross-surface contract tests so `BrowserManager`, daemon, remote manager, and extension ops all expose the same blocker envelope.
- Add integration tests for preserved-session challenge mode: detect blocker, enter resolving, take screenshot, act, verify, resume.
- Add parity tests for coordinate pointer actions across managed and extension ops modes.
- Add provider binder tests that prove providers declare requirements while shared runtime owns cookies, fallback, escalation, and retry.
- Add owned challenge fixtures using Turnstile or reCAPTCHA test keys so challenge-mode behavior can be tested without relying on real third-party production challenges.
- Keep `providers/index.ts` and provider modules small by moving shared recovery policy into one binder or handshake path and keeping provider modules focused on provider-specific extraction logic.
