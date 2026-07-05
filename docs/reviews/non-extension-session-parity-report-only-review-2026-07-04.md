# Non-extension Session Parity Report-only Review

Date: 2026-07-04
Scope: Current working tree on `codex/non-extension-session-parity` compared against merge-base `076d6b5f240da0bf834d927804cd70b9b2c85daa`, plus the named non-extension parity source, tests, plan, and investigation docs.

## Verdict

CLEAR after follow-up fixes.

The initial report-only pass found three security-sensitive redaction issues in the CDP profile registry and daemon/session output paths. The current tree contains fixes and regression coverage for all three.

## Resolved findings

### 1. Public profile summaries exposed internal launch tokens

Status: fixed.

`SessionProfileSummary` now omits `launchTokenId`, and `summarize()` builds public lease output explicitly. Regression coverage asserts serialized summaries do not contain `launchTokenId` while internal registry and lock records can still retain it for ownership validation.

### 2. The profile registry persisted full CDP WebSocket endpoints

Status: fixed.

The registry now persists safe endpoint metadata only, using host and port. Attach and stop paths obtain the current WebSocket endpoint from the live local CDP endpoint in memory after validating registry, lease, process ownership, and launch-token proof.

### 3. Daemon `session.connect` could return a raw profile-backed `wsEndpoint`

Status: fixed.

The daemon connect path sanitizes manager connect results before returning public RPC output. CLI and daemon tests cover profile-backed connect responses without a top-level public `wsEndpoint`.

## Methodology

- Reviewed current source around `src/browser/session-profile-registry.ts`, `src/browser/browser-manager.ts`, `src/cli/daemon-commands.ts`, and session/profile tests.
- Verified the earlier stop-ship findings no longer match current source.
- No implementation, staging, commit, or continuity changes were made by the original report-only review. This follow-up report updates the review record to match the fixed tree.

## Residual risks and gates

- No real owned/test Pinterest credential run is included in this report. Do not claim live Pinterest product-ready proof without approved test credentials.
- Final closeout still requires focused tests, full quality gates, docs drift, skill validation, and review rerun evidence before PR.
