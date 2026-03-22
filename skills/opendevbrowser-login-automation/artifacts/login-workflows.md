# Login Workflows

## Password-only workflow

1. Preflight snapshot
2. Type identifier/password
3. Submit
4. Validate URL + auth-only ref + network status, or accept invalid-credential rejection from the network log when UI error copy is absent
5. Re-snapshot before any follow-up action

## MFA workflow

1. Run password-only steps
2. Wait for MFA field
3. Submit second factor
4. Validate session issuance

## SSO popup/new-tab workflow

1. Trigger SSO action from login page
2. Detect target/page change
3. Continue auth on active SSO target
4. Validate return to original app shell
5. Rebind refs from fresh snapshot

## Challenge checkpoint workflow

1. Detect challenge state
2. Record checkpoint with timestamp and trigger
3. If the environment exposes a deterministic slider/test gate, complete it with low-level pointer controls and re-snapshot
4. Otherwise pause automated actions for manual completion
5. Resume after challenge completion from fresh snapshot
6. If challenge repeats twice, stop and escalate as anti-bot pressure

## Lockout recovery workflow

1. Detect lockout or throttling banner
2. Stop retry loop
3. Record cooldown window/account status and `Retry-After` if present
4. Resume with different account or after wait window
