# Auth and Anti-Bot Blocker Investigation Report

Date: 2026-02-14  
Scope: live validation of OpenDevBrowser mode behavior, research/macro execute surfaces, and blocker handling for Reddit/X plus generalized anti-bot/auth flows.

## Executive Summary

OpenDevBrowser currently detects and exposes meaningful challenge signals, but blocker handling is still mostly implicit and fragmented across channels (navigation status, trace channels, macro error codes).  
In live runs, Reddit and X blockers are reproducible and mode-dependent:

- Reddit:
  - managed headless: HTTP 403 for search
  - managed headed: HTTP 200 for search
  - cdpConnect headless: challenge page (`Reddit - Prove your humanity`) with reCAPTCHA signals
- X:
  - all validated modes redirect search flows to login (`/i/flow/login?...`) with `Log in to X / X` title
- Macro execute for Reddit/X community/social routes still returns structured `unavailable` failures when upstream static assets are blocked (`redditstatic`, `abs.twimg.com`), even though default runtime transports are wired.

Core recommendation: add a first-class blocker contract and resolver orchestration pipeline, rather than hardcoding site-specific heuristics in tool code.

## Reproducible Live Validation

### Matrix run

Command:

```bash
node scripts/live-regression-matrix.mjs
```

Observed on 2026-02-14:

- `pass: 15`
- `env_limited: 7`
- `expected_timeout: 1`
- `fail: 0`

Key matrix observations:

- `mode.extension_ops`: `env_limited` (extension not connected)
- `mode.extension_legacy_cdp`: `env_limited` (extension not connected)
- `macro.community.search.keyword`: `env_limited`, detail `Retrieval failed for https://www.redditstatic.com`
- `macro.media.search.reddit`: `env_limited`, detail `Retrieval failed for https://www.redditstatic.com`
- `macro.media.search.x`: `env_limited`, detail `Retrieval failed for https://abs.twimg.com`
- `macro.media.trend.x`: `env_limited`, detail `Retrieval failed for https://abs.twimg.com`

### Focused Reddit/X probes

Managed headless (`launch --no-extension --headless`):

- Reddit search:
  - final URL: `https://www.reddit.com/search/?q=opendevbrowser`
  - status: `403`
- X search:
  - final URL: `https://x.com/i/flow/login?...`
  - status: `200`
  - title via trace: `Log in to X / X`

Managed headed (`launch --no-extension`):

- Reddit search:
  - final URL: `https://www.reddit.com/search/?q=opendevbrowser`
  - status: `200`
  - title via trace: `opendevbrowser - Reddit Search!`
- X search:
  - final URL: `https://x.com/i/flow/login?...`
  - status: `200`
  - title via trace: `Log in to X / X`

cdpConnect (headless Chrome with `--remote-debugging-port`):

- Reddit search:
  - final URL: `https://www.reddit.com/search/?q=opendevbrowser`
  - status: `200`
  - title: `Reddit - Prove your humanity`
  - recaptcha signals in network trace: present
- X search:
  - final URL: `https://x.com/i/flow/login?...`
  - status: `200`
  - title: `Log in to X / X`

## Current Handling (Code-Level)

Existing building blocks are solid but not unified into an explicit blocker workflow:

- Challenge pattern defaults exist in config (`src/config.ts:299`).
- Tier2 challenge detection exists (status + URL pattern) (`src/browser/fingerprint/tier2-runtime.ts:70`).
- Canary labels high-friction targets from URL/status (`src/browser/browser-manager.ts:1404`).
- Trace tooling already exposes page + console + network + exceptions (`src/tools/debug_trace_snapshot.ts:31`).
- Runtime fetch taxonomy maps 401/403 to `auth`, 429 to `rate_limited`, 5xx to `upstream`, other 4xx to `unavailable` (`src/providers/index.ts:252`).
- Adaptive runtime shaping pushes crawl `fetchConcurrency` filters for web crawl calls (`src/providers/index.ts:1104`, `src/providers/web/index.ts:225`).

## Gap Analysis

1. Blockers are detectable but not promoted to a first-class cross-surface object.
2. `macro-resolve --execute` returns structured failures, but blockers are not differentiated enough for guided recovery actions.
3. Auth redirects (X login flow) are observable, but no explicit auth challenge state is surfaced with next-step affordances.
4. Reddit challenge states are observable in trace/title/network, but no standardized “challenge artifact bundle” is emitted.
5. Extension mode reliability can be environment-limited; this currently blocks assisted interactive resolution in those environments.

## What Needs To Be Done

### 1) Introduce a first-class blocker model

Add a shared `BlockerSignal` schema emitted by browser/runtime layers:

- `type`: `auth_required | anti_bot_challenge | rate_limited | upstream_block | restricted_target | unknown`
- `confidence`: `0..1`
- `source`: `navigation | network | console | runtime_fetch | macro_execution`
- `evidence`: URL/title/status/error code + matched patterns + key network hosts
- `actionHints`: ordered suggestions for resolver flow

Primary implementation touchpoints:

- `src/browser/browser-manager.ts`
- `src/providers/index.ts`
- `src/tools/debug_trace_snapshot.ts`
- `src/tools/macro_resolve.ts`
- `src/cli/daemon-commands.ts`

### 2) Emit blocker artifact bundles

When blocker confidence crosses threshold, produce a standardized bundle:

- active URL/title/status
- screenshot path (if available)
- compact trace excerpt (network/console/exception)
- suggested mode fallback (`managed-headed`, `extension`, `cdpConnect`)

This gives the agent enough context to reason without hardcoding domain-specific behavior.

### 3) Expose blocker state on CLI/tool/daemon surfaces

Add additive fields to avoid breaking compatibility:

- `goto` result: optional `blocker`
- `wait` result: optional `blocker`
- `macro-resolve --execute`: `execution.meta.blocker` when detected
- daemon RPC payloads: same schema

### 4) Add interactive blocker resolution loop

Provide explicit “pause for human, then resume” primitives:

- pause session with blocker payload
- user resolves challenge/login in browser
- resume from same session/context/cookies
- verify unblock with re-check action

### 5) Improve taxonomy mapping for real-world auth/challenge

Keep existing error taxonomy, but enrich with blocker classification:

- 401/403 + login redirect patterns => `auth_required`
- 200 + challenge-title/URL + recaptcha requests => `anti_bot_challenge`
- asset host fetch failures (`redditstatic`, `abs.twimg.com`) => `upstream_block` or `unavailable` with blocker hints

## Reddit-Specific Recommendations

Observed issues:

- headless path can receive 403
- cdpConnect headless can land on “Prove your humanity” despite HTTP 200
- community/social macro retrieval can fail on `redditstatic`

Recommended handling:

1. Detect Reddit challenge via combined indicators:
   - title contains `prove your humanity`
   - URL/status challenge patterns
   - network hits to recaptcha/captcha challenge hosts
2. Emit blocker bundle immediately with high confidence.
3. Auto-suggest fallback:
   - first: managed headed mode with existing profile
   - second: extension mode (if connected)
4. Support interactive challenge completion:
   - keep session alive
   - capture post-resolution verification (`goto` + `debug-trace-snapshot`)
5. For macro retrieval failures on static hosts, return actionable blocker hints:
   - “asset host blocked/unreachable”
   - “try browser-assisted fetch path”
   - “retry in headed mode / with authenticated session”

## X Login Redirect Recommendations

Observed issue:

- search URL redirects to `/i/flow/login?...` in all validated modes

Recommended handling:

1. Treat redirect to `/i/flow/login` as `auth_required` blocker, not generic `unavailable`.
2. Emit explicit auth blocker with resolver hints:
   - “login required for target operation”
   - “continue in interactive session, then resume macro”
3. Persist and reuse authenticated session state where policy allows.
4. Add post-login verifier:
   - retry target URL
   - assert redirect cleared and target content accessible

## Proposed “Agent Browser Blocker Resolver” Skill

Goal: provide a generalized, non-hardcoded strategy for blockers.

Skill workflow:

1. Ingest `BlockerSignal` + artifact bundle.
2. Classify blocker type and confidence.
3. Choose strategy from policy-safe playbook:
   - manual challenge solve
   - auth/login completion
   - mode switch
   - timed retry/backoff
4. Generate operator instructions for interactive steps when needed.
5. Re-validate unblock via deterministic checks.
6. Return structured resolution outcome:
   - `resolved | unresolved | deferred`
   - evidence delta before/after
   - next action recommendation

Key property:

- no per-site hardcoded imperative logic in core runtime; site behaviors are interpreted via generic evidence + policy.

## Test and Regression Plan

1. Unit tests for blocker classification and confidence scoring.
2. Contract tests for additive `blocker` fields on tool/CLI/daemon responses.
3. Integration tests for `macro-resolve --execute` with blocker metadata on failed/blocked paths.
4. Live matrix extension:
   - add blocker assertions per mode
   - retain pass/env-limited/fail classification
5. Keep quality gate unchanged:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run build`
   - `npm run test` (branch coverage `>=97%`)

## Implementation Priority

P0:

- shared blocker schema + cross-surface payload plumbing
- Reddit/X blocker detection enrichment
- resolver skill scaffold + documented workflow

P1:

- artifact bundle generation improvements
- resume orchestration helpers and verifier endpoints

P2:

- expanded live matrix scenarios for authenticated profiles and extension-connected runs

