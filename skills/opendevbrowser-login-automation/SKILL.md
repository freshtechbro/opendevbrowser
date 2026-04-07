---
name: opendevbrowser-login-automation
description: This skill should be used when the user asks to "automate login", "test authentication", "sign in programmatically", "validate login errors", or "verify session persistence" with OpenDevBrowser.
version: 2.0.0
---

# Login Automation Skill

Use this skill for deterministic auth testing that handles MFA and anti-bot checkpoints without unsafe bypass patterns.

## Pack Contents

- `artifacts/login-workflows.md`
- `assets/templates/login-scenario-matrix.json`
- `assets/templates/challenge-checkpoint.md`
- `assets/templates/auth-signals.json`
- `scripts/run-login-workflow.sh`
- `scripts/record-auth-signals.sh`
- `scripts/validate-skill-assets.sh`
- Shared robustness matrix: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

## Fast Start

1. Validate pack integrity.

```bash
./skills/opendevbrowser-login-automation/scripts/validate-skill-assets.sh
```

2. Print a ready workflow.

```bash
./skills/opendevbrowser-login-automation/scripts/run-login-workflow.sh password
./skills/opendevbrowser-login-automation/scripts/run-login-workflow.sh mfa
./skills/opendevbrowser-login-automation/scripts/run-login-workflow.sh challenge-checkpoint
```

## Core Rules

- Use snapshot refs, not ad-hoc selectors.
- Run one decision loop at a time: snapshot -> action -> snapshot.
- Use low-level pointer controls when a deterministic test gate or slider challenge requires gesture input, then re-snapshot before resuming auth steps.
- Never store credentials in skill files, logs, screenshots, or committed fixtures.
- Treat anti-bot challenges as checkpoints (manual solve or approved test keys), not bypass targets.
- Keep a bounded retry budget (max 2 automated retries) and honor `Retry-After` when present.

## Session Reuse by Mode

- `extension` reuses the attached live tab or profile state; it does not run system cookie bootstrap.
- `managed` attempts readable system Chrome-family cookie bootstrap before first navigation.
- `cdpConnect` attempts readable system Chrome-family cookie bootstrap before first navigation.
- `cookie-import` is the explicit add or override lane after session creation, not the automatic bootstrap path.
- Canonical direct-run release evidence policy lives in `../opendevbrowser-best-practices/SKILL.md`.

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Validate login paths across `managed`, `extension`, and `cdpConnect` before parity sign-off.
- Treat extension headless attempts as expected `unsupported_mode`; do not force unsupported auth runs.

## Robustness Coverage (Known-Issue Matrix)

Matrix source: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

- `ISSUE-01`: stale refs / DOM churn
- `ISSUE-02`: challenge or SSO iframe boundaries
- `ISSUE-03`: popup/new-tab SSO redirects
- `ISSUE-04`: MFA/session step-up branching
- `ISSUE-05`: anti-bot challenge loops
- `ISSUE-06`: 429/backoff discipline
- `ISSUE-07`: extension readiness on resume

## Challenge-Aware Flow

1. Preflight: goto login page, wait, snapshot actionables.
2. Enter identifier and password.
3. Submit once.
4. Branch by observed state:
   - authenticated shell appears -> success validation
   - MFA prompt appears -> continue MFA branch
   - popup/new-tab SSO appears -> switch target and continue auth branch
   - deterministic slider or pointer gate appears -> complete pointer workflow, then re-snapshot
   - anti-bot challenge appears -> checkpoint branch
   - invalid credentials or lockout message -> failure branch

```text
opendevbrowser_goto sessionId="<session-id>" url="https://example.com/login"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_type sessionId="<session-id>" ref="<identifier-ref>" text="<resolved-identifier>"
opendevbrowser_type sessionId="<session-id>" ref="<password-ref>" text="<resolved-password>"
opendevbrowser_click sessionId="<session-id>" ref="<submit-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
```

## Anti-Bot Checkpoint Pattern

Use this when CAPTCHA/turnstile/challenge pages appear.

1. Detect challenge UI from snapshot refs or page text.
2. Pause automation and mark checkpoint in run log.
3. If the environment exposes a deterministic test slider or pointer gate, use low-level pointer commands and re-snapshot before continuing.
4. Otherwise complete the challenge manually (or with provider-approved test key in non-production).
5. Resume from a fresh snapshot and continue auth validation.

Signals to monitor:
- challenge iframe/widget visible
- error copy like "verify you are human"
- repeated 403/429 responses on auth endpoints
- repeated challenge pages after resume (loop condition)

Challenge loop guardrail:
- After 2 challenge checkpoints without success, stop automation and escalate.
- If `Retry-After` is available, wait at least that duration before any retry.

## MFA Pattern

1. Submit primary credentials.
2. Wait for OTP/passkey/TOTP ref visibility.
3. Enter second factor.
4. Submit and validate authenticated state.

```text
opendevbrowser_wait sessionId="<session-id>" ref="<mfa-input-ref>" state="visible"
opendevbrowser_type sessionId="<session-id>" ref="<mfa-input-ref>" text="<resolved-otp>"
opendevbrowser_click sessionId="<session-id>" ref="<mfa-submit-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
```

## Validation Signals

Validate at least two independent signals:

- URL/route transition to authenticated area.
- Auth-only element visible (`opendevbrowser_is_visible`).
- Auth request success from `opendevbrowser_network_poll`.
- Invalid-credential rejection from `opendevbrowser_network_poll` is acceptable failure proof when UI copy is suppressed or delayed.

```text
opendevbrowser_network_poll sessionId="<session-id>" max=50
```

## Session Persistence and Reauth

Use persistent profiles for remember-me checks:

```text
opendevbrowser_launch profile="auth-test" persistProfile=true noExtension=true
```

Close and relaunch, then confirm one of:
- still authenticated without credential prompt
- intentionally forced reauth policy was applied

## Failure Modes

- Invalid credentials: prefer explicit field/banner errors, but accept network rejection evidence when UI copy is absent.
- Rate limit/lockout: stop retries, apply cooldown, rotate test account.
- Challenge loop: escalate as anti-bot pressure issue.
- MFA unavailable for test account: mark incomplete test prerequisite.

## References

Use these sources when tuning login automation behavior:
- Playwright auth guide: https://playwright.dev/docs/auth
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- NIST SP 800-63B (Digital Identity): https://pages.nist.gov/800-63-4/sp800-63b.html
- Cloudflare Turnstile testing keys: https://developers.cloudflare.com/turnstile/tutorials/testing/
- reCAPTCHA v2 testing keys: https://developers.google.com/recaptcha/docs/faq
- hCaptcha test keys: https://docs.hcaptcha.com/
