# Audit: Google OAuth Session Invalidation Investigation

Audit target: `docs/investigations/google-oauth-session-invalidation-2026-06-22.md`

## Summary

Verdict: WARN.

The core investigation is valid: OpenDevBrowser source evidence does not show a deliberate local Google logout path, and it does show managed/CDP cookie transplant, heuristic profile selection, additive cookie import, and popup target risks. The report should be narrowed in several places so it does not present plausible external causes as proven facts.

## Validated Findings

| Finding | Audit verdict | Notes |
| --- | --- | --- |
| Managed launch imports system cookies before OpenDevBrowser start-url navigation | PASS with wording fix | Supported by `src/browser/browser-manager.ts:1655-1722` and `tests/browser-manager.test.ts:847-892`. Say "before OpenDevBrowser navigates to `startUrl`," not absolute "before first navigation." |
| CDP connect imports system cookies | PASS | Supported by `src/browser/browser-manager.ts:1788-1795`, `src/browser/browser-manager.ts:6109-6229`, and `tests/browser-manager.test.ts:1252-1302`. |
| Source profile selection is heuristic | WARN | Supported by `src/cache/chrome-user-data.ts:19-153`; "wrong Google account" is plausible but not directly proven. Use "unintended, stale, or different profile." |
| System bootstrap copies/imports cookies only | PASS | Supported by `src/browser/system-chrome-cookies.ts:26-35`, `src/browser/system-chrome-cookies.ts:299-369`, and `src/browser/browser-manager.ts:4552-4645`. |
| Provider cookie injection can layer on top | PASS | Supported by `src/providers/runtime-policy.ts:12-17`, `src/providers/cookie-source.ts:32-75`, and `src/providers/runtime-factory.ts:1216-1254`. |
| Extension `/ops` is live-profile path with better popup tracking | PASS with scope | Supported by docs and `/ops` runtime. Scope this to extension `/ops` session paths. |
| OAuth popup asymmetry | PASS | Managed/CDP require explicit target discovery/switching; `/ops` has opener ownership and promotion logic. |
| No explicit destructive logout path found | PASS | Code search found no destructive cookie/storage clearing APIs in `src`, `extension/src`, or `tests`; cleanup is temp-profile/staging-only. |

## Required Corrections

- Do not state true Google-wide session invalidation as proven. The code proves local cookie transplant and session incoherence risk; Google-side revocation remains plausible but unverified.
- Treat DBSC and App-Bound Encryption as external reasonableness signals, not the proven mechanism for this user.
- Replace "no-cookie research run" with "provider-cookie-disabled research run." In managed mode, `--cookie-policy-override off` does not disable automatic system Chrome cookie bootstrap.
- Narrow OAuth policy language to embedded user-agents under developer control and use Google Account Help for software-automation sign-in blocking.
- Keep App-Bound Encryption Windows-specific and DBSC conditional on supported Chrome/platform/site combinations.

## Recommendation Audit

| Recommendation | Decision | Audit |
| --- | --- | --- |
| Default to extension `/ops` for user-owned Google OAuth | ACCEPT | Best existing path. Keep scoped to user-owned Google OAuth and first-party Google services. |
| Do not treat managed/CDP cookies as Google login proof | ACCEPT | Strongly supported and should be kept. |
| Add auth-sensitive preflight diagnostics | REVISE | Make it narrow provenance diagnostics, not a broad new auth framework. |
| No silent extension-to-managed fallback for Google OAuth | ACCEPT WITH SCOPE | Apply only when Google OAuth or first-party Google account access is explicit. |
| Add popup guidance or watcher | REVISE | Start with guided target listing/switching; defer watcher until a reproducer proves need. |
| Disable bootstrap or select source profile per run | REVISE AND SPLIT | Disable control first; profile selection later if diagnostics prove wrong-profile selection. |
| Use test auth seams, OAuth test accounts, or dedicated profiles | ACCEPT | Low-bloat and legitimate. |
| Avoid explicit cookie import for live Google OAuth unless intentional | ACCEPT | Use as warning/guidance, not a global hard block. |

## Minimal Path

The smallest coherent path that likely addresses the user's issue without bloat:

1. Require extension `/ops` for user-owned Google OAuth and first-party Google account access.
2. Fail closed when extension is unavailable or not handshaken for those flows.
3. Add narrow provenance diagnostics: requested mode, actual mode, extension readiness, selected source profile if bootstrap ran, bootstrap enabled, provider-cookie source, explicit cookie import presence, and active target URL.
4. Document target recovery after OAuth popup launch: list targets, find `accounts.google.com` or consent/account chooser targets, and switch explicitly.
5. Defer profile picker and broad popup watcher until a focused reproducer proves they are needed.

## Residual Risks

- No live Google auth reproduction was performed in this audit. The validation is source-backed and external-policy-backed, not a live account/session repro.
- The exact affected user profile, account state, and session scope remain unconfirmed. The audit validates likely failure paths, not the specific user's browser-profile identity at failure time.
- Google-side server risk response or revocation is not proven by repo evidence. Treat it as plausible external behavior, not the established local root cause.

## Audit Evidence

- Code matrix: `.omo/ulw-loop/evidence/google-oauth-report-audit-code-matrix.md`
- Recommendation and external-source matrix: `.omo/ulw-loop/evidence/google-oauth-report-audit-recommendations.md`
- Scope/no-implementation evidence: `.omo/ulw-loop/evidence/google-oauth-report-audit-scope.txt`
- Sub-agent lanes used: OMO explorer code audit, OMO scope-guardian recommendation audit, OMO librarian external-source audit, RepoPrompt pair audit.
