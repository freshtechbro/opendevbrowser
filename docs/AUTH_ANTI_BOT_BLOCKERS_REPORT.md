# Auth and Anti-Bot Blocker Investigation Report

Date: 2026-02-15  
Scope: live validation of OpenDevBrowser mode behavior, research/macro execute surfaces, and blocker handling for Reddit/X plus generalized anti-bot/auth flows.

## Executive Summary

OpenDevBrowser now exposes blocker handling as a first-class additive contract across browser/runtime/tool/CLI/daemon surfaces.  
In live runs, Reddit and X blockers are reproducible and mode-dependent:

- Reddit:
  - managed headless: HTTP 403 for search
  - managed headed: HTTP 200 for search
  - cdpConnect headless: challenge page (`Reddit - Prove your humanity`) with reCAPTCHA signals
- X:
  - all validated modes redirect search flows to login (`/i/flow/login?...`) with `Log in to X / X` title
- Macro execute surfaces carry structured blocker metadata in `execution.meta.blocker` for blocked/unavailable paths.

Current focus is operational validation quality (especially extension-connected preflight readiness), not core blocker-contract implementation.

## Reproducible Live Validation

### Matrix run

Command:

```bash
node scripts/live-regression-matrix.mjs
```

Observed on 2026-02-15:

- `pass: 21`
- `env_limited: 1`
- `expected_timeout: 2`
- `fail: 0`

Key matrix observations:

- `infra.extension.ready`: `pass` with extension connected and handshake complete.
- `mode.extension_ops`: `pass` with blocker metadata assertions exercised.
- `mode.extension_legacy_cdp`: `env_limited` in this run due relay `/cdp` auto-attach/tab-id mismatch (`No tab with given id`), with explicit operator guidance.
- Managed and cdpConnect mode blocker evidence remained available and contract-compliant.
- `mode.managed`: blocker evidence captured (`goto`, `wait`, and `debug-trace-snapshot`) with `blockerState=clear`
- `mode.cdp_connect`: blocker evidence captured (`goto`, `wait`, and `debug-trace-snapshot`) with `blockerState=clear`

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

## Implementation Status (Code-Level)

Blocker handling is implemented end-to-end as a first-class additive contract:

- Classifier and precedence are centralized in `src/providers/blocker.ts` (auth/challenge/rate-limit/upstream/restricted/env-limited/unknown).
- Runtime failures carry blocker metadata additively via `meta.blocker` (`src/providers/index.ts`).
- Browser navigation/verification surfaces emit blocker state and optional artifacts (`src/browser/browser-manager.ts`, `src/tools/debug_trace_snapshot.ts`).
- Macro execute-mode carries blocker metadata in `execution.meta.blocker` (`src/macros/execute.ts`, `src/tools/macro_resolve.ts`, `src/cli/daemon-commands.ts`).
- Resolver state transitions now emit explicit unresolved/deferred outcomes when verification cannot complete (`src/browser/session-store.ts`, `src/browser/browser-manager.ts`).
- Cross-surface parity is covered by dedicated tests (`tests/providers-blocker.test.ts`, `tests/session-store.test.ts`, `tests/parity-matrix.test.ts`, `tests/macro-resolve.test.ts`, `tests/daemon-commands.integration.test.ts`).

## Remaining Operational Limits

1. Extension-connected validation is environment-dependent; legacy `/cdp` checks can still classify `env_limited` when relay tab/session state drifts.
2. Annotation probes are intentionally `expected_timeout` unless manual annotation interaction is completed during the run.
3. Live matrix evidence should always be interpreted with preflight context (`infra.extension.ready`) before judging extension-mode regressions.

## Quality Gate Evidence (2026-02-15)

Command outcomes:

- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm run build` ✅
- `npm run test` ✅ (`85` files, `1106` tests)
- Coverage: branch `97.01%` (meets required `>=97%`)
- `node scripts/live-regression-matrix.mjs` ✅ (`pass: 21`, `env_limited: 1`, `expected_timeout: 2`, `fail: 0`)

Blocker evidence deltas captured in the latest pass:

- Added explicit extension preflight diagnostics (`infra.extension.ready`) with actionable setup hints.
- Added mode-specific blocker evidence capture for managed, extension, and cdpConnect paths (`goto`/`wait`/`debug-trace-snapshot`).
- Added blocker metadata assertions and non-blocker parity guards in runtime/tool/daemon/CLI tests.
- Added explicit unresolved/deferred resolver outcomes for verification failures/timeouts and exposed resolution metadata on status surfaces.

## Canonical Blocker Contract (v2)

Compatibility rule:

- Blocker metadata is additive-only in v2.
- Placement is fixed to `meta.blocker` (or `execution.meta.blocker` for `macro-resolve --execute`).
- Existing fields/codes remain unchanged when blocker metadata is absent.

Canonical placement by surface:

- `goto`: `data.meta.blockerState` + optional `data.meta.blocker`
- `wait`: `data.meta.blockerState` + optional `data.meta.blocker`
- `debug-trace-snapshot`: `data.meta.blockerState` + optional `data.meta.blocker` + optional `data.meta.blockerArtifacts`
- `macro-resolve --execute`: `data.execution.meta.ok` + optional `data.execution.meta.blocker`
- `status`: `data.meta.blockerState` + optional `data.meta.blockerResolution` (`resolved | unresolved | deferred`)

Canonical examples:

```json
{
  "command": "goto",
  "data": {
    "meta": { "blockerState": "clear" }
  }
}
```

```json
{
  "command": "goto",
  "data": {
    "meta": {
      "blockerState": "active",
      "blocker": { "type": "auth_required", "source": "navigation" }
    }
  }
}
```

```json
{
  "command": "wait",
  "data": {
    "meta": {
      "blockerState": "active",
      "blocker": { "type": "anti_bot_challenge", "source": "navigation" }
    }
  }
}
```

```json
{
  "command": "debug-trace-snapshot",
  "data": {
    "meta": {
      "blockerState": "active",
      "blocker": { "type": "anti_bot_challenge", "source": "network" },
      "blockerArtifacts": { "hosts": ["www.recaptcha.net"] }
    }
  }
}
```

```json
{
  "command": "macro-resolve --execute",
  "data": {
    "execution": {
      "meta": {
        "ok": false,
        "blocker": { "type": "env_limited", "source": "macro_execution" }
      }
    }
  }
}
```

```json
{
  "command": "status",
  "data": {
    "meta": {
      "blockerState": "active",
      "blockerResolution": {
        "status": "deferred",
        "reason": "env_limited"
      }
    }
  }
}
```

## Implemented Deliverables

1. First-class blocker schema and classifier
   - Implemented `BlockerSignalV1` with deterministic precedence and confidence thresholds.
   - Sources: `navigation | network | runtime_fetch | macro_execution`.
2. Artifact bundle emission
   - Added bounded/sanitized `blockerArtifacts` (network/console/exception + host summary).
   - Prompt-guard + redaction enforced before serialization.
3. Cross-surface additive placement
   - `goto` / `wait` / `debug-trace-snapshot`: `data.meta.blockerState` + optional `data.meta.blocker`.
   - `macro-resolve --execute`: `data.execution.meta.blocker`.
   - Daemon fallback enrichers preserve the same additive semantics.
4. Resolver reliability updates
   - Session blocker FSM supports explicit resolver outcomes when verification cannot complete:
     - `unresolved` (`verification_timeout` / `verifier_failed`)
     - `deferred` (`env_limited`)
   - Status surfaces expose `meta.blockerResolution` for operator triage.
5. Taxonomy coverage
   - Auth/login redirect, anti-bot challenge, upstream blocked assets, and environment limits are mapped consistently.

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

## Rollout Sequence and Contingency (v2)

Rollout sequence (owners):

1. Dev validation (Owner: runtime maintainer)
   - Run `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test`.
   - Confirm blocker contract parity tests pass.
2. Pre-release live run (Owner: release engineer)
   - Run `node scripts/live-regression-matrix.mjs`.
   - Confirm no `fail` results and review `infra.extension.ready` diagnostics.
3. Release decision (Owner: maintainer)
   - Approve when quality gate is green and env-limited outcomes are documented as environment issues (not product defects).

Rollback triggers (testable):

- Contract drift: blocker placement changes outside `meta.blocker` / `execution.meta.blocker`.
- Parity regression: tool/CLI/daemon responses disagree for equivalent execute-mode failures.
- Unexpected blocker inflation: baseline matrix scenario moves from `clear` to repeated active blockers without upstream/environment changes.

Operator triage checklist (`resolved | unresolved | deferred`):

1. Capture evidence (`goto`, `wait`, `debug-trace-snapshot`, `macro-resolve --execute`) and classify blocker type.
2. Attempt deterministic recovery (manual login/challenge completion, then resume same session).
3. Re-run verifier action and compare blocker delta:
   - `resolved`: blocker clears and target action succeeds.
   - `unresolved`: blocker remains active after documented recovery steps.
   - `deferred`: blocked by environment/setup limits (for example extension disconnected).
4. Record outcome with request/session id, blocker type, and next action owner.
