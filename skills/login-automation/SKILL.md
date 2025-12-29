---
name: login-automation
description: Best practices for automating login flows and authentication testing with OpenDevBrowser.
version: 1.0.0
---

# Login Automation Skill

## Credential Handling

Store credentials securely using environment variables or config files outside the repository.

Never hardcode credentials in test scripts or skill files.

Use `opendevbrowser_type` with `sensitive: true` (if available) for password fields.

## Form Detection Workflow

1. Take a snapshot to identify login form elements:
   ```
   opendevbrowser_snapshot
   ```

2. Look for common patterns:
   - Input fields with `type="email"`, `type="text"`, `name="username"`
   - Input fields with `type="password"`
   - Submit buttons with text containing "Sign in", "Log in", "Submit"

3. Use refs to target form elements reliably.

## Authentication Flow

1. Navigate to login page:
   ```
   opendevbrowser_goto url="https://example.com/login"
   ```

2. Wait for form to load:
   ```
   opendevbrowser_wait state="networkidle"
   ```

3. Take snapshot to get refs:
   ```
   opendevbrowser_snapshot
   ```

4. Enter username/email:
   ```
   opendevbrowser_type ref="[email-input-ref]" text="user@example.com"
   ```

5. Enter password:
   ```
   opendevbrowser_type ref="[password-input-ref]" text="password123"
   ```

6. Click submit:
   ```
   opendevbrowser_click ref="[submit-button-ref]"
   ```

7. Wait for navigation:
   ```
   opendevbrowser_wait state="networkidle"
   ```

## Error Handling

After login attempt, verify success:

1. Check URL changed to expected destination
2. Look for error messages in snapshot
3. Verify session cookies are set via network poll

Common failure patterns:
- "Invalid credentials" messages
- CAPTCHA challenges
- Multi-factor authentication prompts
- Rate limiting or lockout

## MFA Handling

For TOTP-based MFA:
1. Generate code using appropriate library
2. Wait for MFA input field to appear
3. Enter the code
4. Submit

For SMS/Email MFA:
- Requires manual intervention or test account bypass

## Session Persistence

Use persistent browser profiles to maintain sessions across runs:
```
opendevbrowser_launch profile="test-user" persistProfile=true
```
