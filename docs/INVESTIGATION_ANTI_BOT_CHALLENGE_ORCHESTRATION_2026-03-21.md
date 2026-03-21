# Investigation: Anti-Bot Challenge Orchestration

Status: active
Date: 2026-03-21

## Summary

OpenDevBrowser already has most of the primitives needed for challenge-aware recovery: blocker classification, blocker state tracking, screenshots, snapshots, ref-based interactions, debug traces, and an agent handoff channel. The missing piece is a reusable coordinator that preserves a live blocked session, lets an agent inspect and act, verifies clearance, and then retries the original provider or workflow step.

The smallest clean architecture change is a runtime-level `ChallengeResolverPort` invoked from the existing browser fallback path. The main capability gap for visually complex challenge UIs is not blocker detection; it is the lack of a first-class coordinate mouse surface. Existing interactions are selector/ref driven.

## Symptoms

- Provider runtime and workflows surface blocker metadata, but they currently degrade, report, or retry rather than solve.
- Browser fallback opens a real browser session but disconnects it before an agent can take over.
- Managed and extension control already support screenshots, snapshots, and ref-based actions, but not public coordinate mouse move/down/up/click.
- Live harnesses preserve blocker and `env_limited` classification as reporting output, not as an orchestration trigger.

## Investigation Log

### Phase 1 - Blocker Contract
**Hypothesis:** blocker classification already exists and is strong enough to drive a generic challenge workflow.

**Findings:** `BlockerSignalV1` already carries normalized blocker data and action hints. The classifier distinguishes `auth_required`, `anti_bot_challenge`, `rate_limited`, `restricted_target`, and `env_limited`.

**Evidence:**
- `src/providers/types.ts:112-122` defines `BlockerSignalV1` with `type`, `reasonCode`, `evidence`, and `actionHints`.
- `src/providers/blocker.ts:239-245` returns `auth_required`.
- `src/providers/blocker.ts:268-273` returns `anti_bot_challenge`.
- `src/providers/blocker.ts:317-323` returns `env_limited`.
- `tests/providers-blocker.test.ts:35-157` locks classifier behavior for auth walls, challenge pages, restricted targets, and environment-limited conditions.

**Conclusion:** confirmed. The blocker envelope is already reusable contract data, not an ad hoc status string.

### Phase 2 - Anti-Bot Policy And Runtime Escalation
**Hypothesis:** provider runtime already knows when escalation is warranted, but does not invoke a solver.

**Findings:** the anti-bot policy engine emits `escalationIntent`, but runtime only attaches blocker metadata to failures. No solver path is called.

**Evidence:**
- `src/providers/shared/anti-bot-policy.ts:111-130` emits `escalationIntent` during cooldown preflight.
- `src/providers/shared/anti-bot-policy.ts:173-190` emits `escalationIntent` during postflight failure handling.
- `src/providers/index.ts:1176-1217` calls `postflight`, builds `meta`, detects a blocker, and returns normalized failure.
- `src/providers/index.ts:1511-1553` uses `classifyBlockerSignal()` inside `detectRuntimeBlocker()`.
- `tests/providers-anti-bot-policy.test.ts:48-88` verifies escalation hints and cooldown handling.

**Conclusion:** confirmed. Runtime has an escalation signal, but no reusable solve path.

### Phase 3 - Browser Fallback And Session Ownership
**Hypothesis:** browser fallback is the closest existing seam for a generic challenge resolver.

**Findings:** browser fallback already launches or connects a real browser session, injects cookies, navigates, waits, captures HTML, and detects fallback blockers. It always disconnects the session in `finally`, so the blocked page is not preserved for takeover.

**Evidence:**
- `src/providers/runtime-factory.ts:289-492` implements `createBrowserFallbackPort().resolve()`.
- `src/providers/runtime-factory.ts:357-431` handles cookie injection and required-cookie failures.
- `src/providers/runtime-factory.ts:438-468` performs `goto`, settle wait, HTML capture, and blocker detection.
- `src/providers/runtime-factory.ts:485-489` disconnects the session unconditionally in `finally`.
- `src/providers/index.ts:421-470` only uses fallback as document recovery; it throws the original error if `fallback.ok` is false.

**Conclusion:** confirmed. This is the best first call site for a challenge resolver, but it is not yet session preserving.

### Phase 4 - Browser Control And Verification Primitives
**Hypothesis:** BrowserManager already exposes the primitives needed for an agent loop.

**Findings:** BrowserManager already exposes blocker-aware status, navigation verification, snapshots, screenshots, ref-based interactions, and debug traces. It also persists blocker state transitions through `clear`, `active`, and `resolving`.

**Evidence:**
- `src/browser/browser-manager.ts:560-590` exposes blocker-aware `status()`.
- `src/browser/browser-manager.ts:952-961` and `1107-1115` reconcile blockers during `goto()`.
- `src/browser/browser-manager.ts:1152-1161` and `1193-1201` reconcile blockers during `waitForLoad()` and `waitForRef()`.
- `src/browser/browser-manager.ts:1210-1316` exposes `snapshot`, `click`, `hover`, `press`, `type`, `select`, `scroll`, and `scrollIntoView`.
- `src/browser/browser-manager.ts:1534-1562` exposes screenshot capture with CDP fallback.
- `src/browser/browser-manager.ts:1613-1679` exposes `debugTraceSnapshot()` with blocker artifacts.
- `src/browser/browser-manager.ts:2348-2399` routes blocker detection through `reconcileSessionBlocker()`.
- `src/browser/session-store.ts:105-191` manages blocker transitions and verifier outcomes.
- `src/browser/session-store.ts:193-223` marks environment-limited verification failures as `deferred`.
- `tests/browser-manager.test.ts:5325-5418` verifies active-to-clear FSM transitions and blocker artifacts.
- `tests/browser-manager.test.ts:5419-5473` verifies unresolved versus deferred verifier outcomes.

**Conclusion:** confirmed. The low-level perception/action/verification pieces already exist.

### Phase 5 - Mouse Surface Gap
**Hypothesis:** OpenDevBrowser may already have true mouse control, but it is hidden behind CDP or extension paths.

**Findings:** public surfaces are still selector/ref centered. There is no first-class coordinate mouse API in BrowserManager, tools, or daemon commands. The extension DOM bridge internally synthesizes centered pointer and mouse events, but only for selector-resolved elements.

**Evidence:**
- `src/tools/index.ts:89-126` exposes `snapshot`, `click`, `hover`, `press`, `type`, `scroll`, `debug_trace_snapshot`, `screenshot`, and workflow tools, but no coordinate mouse tool.
- `src/browser/browser-manager.ts:1227-1316` exposes locator-driven click/hover/type and wheel scroll only.
- Repo search returned only one direct `page.mouse.*` use: `src/browser/browser-manager.ts:1315` (`page.mouse.wheel`).
- `src/browser/ops-browser-manager.ts:442-453` forwards only `interact.scroll` and `interact.scrollIntoView` beyond the existing selector-based interaction set.
- `extension/src/ops/ops-runtime.ts:357-381` lists only `interact.click|hover|press|check|uncheck|type|select|scroll|scrollIntoView`.
- `extension/src/ops/ops-runtime.ts:948-1079` resolves selectors and drives those ref-based interactions.
- `extension/src/ops/dom-bridge.ts:468-530` synthesizes pointer and mouse events at the center of a selector's bounding rect, not arbitrary coordinates.

**Conclusion:** confirmed. The public interaction model is not yet sufficient for non-ref challenge UI such as canvas sliders, hold-to-verify controls, or opaque overlays.

### Phase 6 - Agent Handoff Channel
**Hypothesis:** the repo already has a reusable channel to send screenshot-bearing context to an agent.

**Findings:** annotation and agent inbox flows already support direct or relay capture, screenshot-bearing payloads, and queue-backed delivery into a chat scope.

**Evidence:**
- `src/browser/annotation-manager.ts:65-179` chooses direct versus relay annotation capture and supports screenshot modes.
- `src/annotate/agent-inbox.ts:36-79` enqueues payloads and exposes scope-based consume/peek operations.
- `src/cli/daemon-commands.ts:103-156` exposes `annotate` and `agent.inbox.*` command routing.
- `src/relay/protocol.ts:450-529` defines annotation payload geometry and screenshot-linked item metadata.

**Conclusion:** confirmed. The handoff substrate exists and should be reused instead of creating a parallel agent transport.

### Phase 7 - Workflow Behavior
**Hypothesis:** workflows already treat anti-bot and environment-limited outcomes as first-class signals, but only for reporting and exclusion.

**Findings:** workflows aggregate `reasonCodeDistribution`, `antiBotPressure`, degraded-provider state, and failures. They do not attempt challenge resolution themselves.

**Evidence:**
- `src/providers/workflows.ts:1237-1284` records `reasonCodeDistribution` and `antiBotPressure` for research.
- `src/providers/workflows.ts:1336-1444` excludes degraded shopping providers and records the same metrics for shopping.
- `src/providers/workflows.ts:1654-1684` records failure distributions for product-video asset generation.

**Conclusion:** confirmed. Workflows are consumers of blocker outcomes, not the right place to own solve logic.

### Phase 8 - Harness Classification
**Hypothesis:** live scripts preserve blocker information, but only as release-truth output.

**Findings:** direct-run scripts keep blocker type, blocker reason, and provider shell data. `env_limited` is treated as a reporting bucket, with explicit tests preventing ordinary timeouts from being silently downgraded.

**Evidence:**
- `scripts/live-direct-utils.mjs:15-24` defines environment-limited reason-code buckets.
- `scripts/live-direct-utils.mjs:215-244` classifies zero-record runs as `env_limited` only for explicit blocker families.
- `scripts/provider-direct-runs.mjs:122-137` extracts blocker metadata from workflow output.
- `scripts/provider-direct-runs.mjs:294-344` preserves blocker type, blocker reason, and provider shell in evaluated steps.
- `tests/provider-direct-runs.test.ts:83-133` locks timeout-versus-env-limited behavior.

**Conclusion:** confirmed. Harnesses are truthing layers, not solver layers.

## External Research

### What other tools do

- Playwright exposes real coordinate mouse primitives (`mouse.move`, `mouse.down`, `mouse.up`, `mouse.click`) and screenshots as foundational browser-control APIs, not as anti-bot logic by itself.
  - Source: https://playwright.dev/docs/api/class-mouse
  - Source: https://playwright.dev/docs/screenshots
- Stagehand's official model is `observe()` first, then `act()` on the resulting action plan. That is conceptually similar to the solve loop OpenDevBrowser is missing.
  - Source: https://docs.stagehand.dev/basics/observe
- Browser Use exposes screenshot and vision-oriented agent settings plus auth/profile features. That is closer to "inspect visually, then act" than traditional test frameworks.
  - Source: https://docs.browser-use.com/customize/agent-settings
  - Source: https://docs.browser-use.com/cloud/authentication

### What challenge vendors recommend

- Cloudflare Turnstile explicitly documents test sitekeys, including a key that forces an interactive challenge. That is the correct pattern for owned environments.
  - Source: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- Google reCAPTCHA documents test keys for v2, again pointing toward controlled test bypass in owned environments rather than trying to defeat production challenge systems.
  - Source: https://developers.google.com/recaptcha/docs/faq

### External conclusion

The external pattern is consistent:

- mature browser frameworks expose low-level primitives such as screenshots and coordinate mouse control;
- agentic frameworks add an observe/vision/act loop above those primitives;
- challenge vendors recommend test keys or test-mode bypasses in owned environments.

OpenDevBrowser already has most of the middle and upper layers. The missing lower-layer gap is coordinate mouse control, and the missing system-layer gap is a reusable coordinator.

## Root Cause

The architectural gap is not blocker detection. The repo already detects auth walls, anti-bot challenges, and environment-limited states, and it already exposes screenshots, snapshots, debug traces, and ref-based actions.

The real gap is that there is no component that owns this sequence:

1. preserve the live blocked session,
2. capture context for an agent,
3. let the agent act iteratively,
4. verify blocker clearance,
5. retry the original provider or workflow step.

The nearest existing seam, `createBrowserFallbackPort().resolve()`, already does most of the work required to get to a blocked page, but it disconnects the session before takeover is possible. At the same time, the public interaction surface lacks coordinate mouse actions, so some visually obvious challenge controls remain unreachable even if an agent can interpret the screenshot.

## Recommended Architecture

### 1. Add a runtime-level `ChallengeResolverPort`

Suggested shape:

```typescript
export interface ChallengeResolutionRequest {
  providerId: string;
  source: RuntimeFetchSource | string;
  operation: "search" | "fetch" | "crawl" | "post";
  sessionId: string;
  url: string;
  blocker: BlockerSignalV1;
  trace: TraceContext;
  details?: Record<string, unknown>;
}

export interface ChallengeResolutionResult {
  status: "resolved" | "unresolved" | "deferred";
  reason?: string;
  finalUrl?: string;
  html?: string;
}

export interface ChallengeResolverPort {
  resolve(request: ChallengeResolutionRequest): Promise<ChallengeResolutionResult>;
}
```

Recommended placement:
- contract in `src/providers/types.ts`
- implementation in a focused coordinator such as `src/browser/challenge-orchestrator.ts` or `src/core/challenge-resolution.ts`
- injection in `src/providers/runtime-factory.ts`

### 2. First caller: browser fallback

Change the fallback path so it does not always disconnect when the detected blocker is solvable.

Recommended behavior:
- `anti_bot_challenge` and possibly `auth_required`: preserve session and invoke the resolver.
- `env_limited`: do not attempt a solve loop; return `deferred`.

This keeps workflows unchanged while letting provider runtime recover underneath them.

### 3. Reuse existing agent handoff components

Do not add a parallel transport. Reuse:
- `BrowserManager` for snapshot, screenshot, debug trace, status, and interactions
- `AnnotationManager` for capture orchestration
- `AgentInbox` for queue-backed handoff

### 4. Add first-class coordinate mouse fallback

Add a narrow surface only:
- `mouse.move`
- `mouse.down`
- `mouse.up`
- `mouse.click`

Recommended implementation path:
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- `extension/src/ops/ops-runtime.ts`
- `extension/src/ops/dom-bridge.ts`
- `src/cli/daemon-commands.ts`
- `src/tools/` wrappers if tool exposure is desired

Design notes:
- use viewport-relative coordinates or normalized screenshot coordinates;
- include viewport size and device-pixel ratio in handoff payloads;
- prefer ref/selector actions when available, but allow coordinate fallback when they are not.

### 5. Keep verification grounded in the existing blocker FSM

The resolver should not invent a new state model. Reuse:
- `clear`
- `active`
- `resolving`
- resolution statuses `resolved`, `unresolved`, `deferred`

Existing `SessionStore` behavior is already suitable for iterative verification.

## Recommendations

1. Add a `ChallengeResolverPort` and invoke it from browser fallback before disconnect cleanup.
2. Keep workflows unchanged initially. Let recovered provider execution bubble success back up naturally.
3. Reuse annotation plus inbox for agent handoff instead of creating a new challenge-transport subsystem.
4. Add first-class coordinate mouse control as a narrow fallback for non-ref challenge UI.
5. Treat `env_limited` as deferred by default, not as a challenge to "beat".
6. For owned environments, use official challenge test keys rather than trying to automate around production challenge systems.
7. Do not implement challenge-code inspection or token injection features aimed at bypassing third-party security systems. The safe and durable path is agent-assisted clearance, environment switching, or graceful deferral.

## Preventive Measures

- Add contract tests for the new resolver seam so blocker metadata stays additive and consistent across runtime, daemon, tools, and harnesses.
- Add integration tests for fallback-session preservation and retry-after-resolution behavior.
- Add explicit tests that coordinate mouse APIs remain available in both managed and extension ops paths.
- Keep live harness classification strict: timeout remains `fail`; only explicit environment or challenge boundaries should become `env_limited`.
- Reuse vendor-provided test keys in owned environments so challenge behavior can be verified without training the system to attack third-party defenses.
