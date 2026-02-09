---
name: login-automation
description: This skill should be used when the user asks to "automate login", "test authentication", "sign in programmatically", "validate login errors", or "verify session persistence" with OpenDevBrowser.
version: 1.1.0
---

# Login Automation Skill

Use this guide for deterministic login flows and authentication checks.

## Secure Credential Handling

Handle credentials outside skill files and source code:

- Resolve credentials from environment variables or a secret manager in the orchestration layer.
- Pass resolved values at runtime only.
- Avoid logging secrets in transcripts, fixtures, or screenshots.

## Preflight Checklist

Before typing credentials:

1. Launch or connect to the intended session mode.
2. Navigate to the login URL.
3. Wait for page readiness.
4. Capture a fresh snapshot and identify refs.

```text
opendevbrowser_goto sessionId="<session-id>" url="https://example.com/login"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
```

## Canonical Login Flow

Execute login in a strict order:

1. Type identifier into email/username ref.
2. Type password into password ref.
3. Click submit.
4. Wait for navigation or authenticated UI state.
5. Re-snapshot for post-login verification.

```text
opendevbrowser_type sessionId="<session-id>" ref="<identifier-ref>" text="<resolved-identifier>"
opendevbrowser_type sessionId="<session-id>" ref="<password-ref>" text="<resolved-password>"
opendevbrowser_click sessionId="<session-id>" ref="<submit-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
```

## Success Validation

Validate more than one signal:

- URL or route changed to expected authenticated location.
- Authenticated-only UI ref becomes visible.
- Login request in `opendevbrowser_network_poll` returns expected status.

```text
opendevbrowser_network_poll sessionId="<session-id>" max=50
```

Use `opendevbrowser_is_visible` or `opendevbrowser_get_attr` for deterministic assertions.

## Error and Recovery Handling

Handle common blockers explicitly:

- Invalid credentials: assert error banner text near form.
- CAPTCHA/challenge: classify as manual checkpoint.
- MFA prompt: continue with second-factor workflow if test account supports it.
- Lockout/rate limit: stop retries and rotate test account or cooldown window.

After any failure, re-snapshot before retrying to avoid stale refs.

## MFA Flow Pattern

For MFA-capable test flows:

1. Submit primary credentials.
2. Wait for MFA input ref.
3. Enter OTP/ref-based code.
4. Submit and validate authenticated state.

```text
opendevbrowser_wait sessionId="<session-id>" ref="<mfa-input-ref>" state="visible"
opendevbrowser_type sessionId="<session-id>" ref="<mfa-input-ref>" text="<resolved-otp>"
opendevbrowser_click sessionId="<session-id>" ref="<mfa-submit-ref>"
```

## Session Persistence Checks

Use persistent profiles when verifying remembered sessions:

```text
opendevbrowser_launch profile="auth-test" persistProfile=true noExtension=true
```

Then reopen and verify whether re-authentication is required.

## Batch Script Pattern

Use `opendevbrowser_run` for compact, repeatable flows:

```text
opendevbrowser_run sessionId="<session-id>" steps=[{"action":"goto","args":{"url":"https://example.com/login"}},{"action":"wait","args":{"until":"networkidle"}},{"action":"snapshot","args":{"format":"actionables"}},{"action":"type","args":{"ref":"<identifier-ref>","text":"<resolved-identifier>"}},{"action":"type","args":{"ref":"<password-ref>","text":"<resolved-password>"}},{"action":"click","args":{"ref":"<submit-ref>"}},{"action":"wait","args":{"until":"networkidle"}},{"action":"snapshot","args":{"format":"outline"}}]
```
