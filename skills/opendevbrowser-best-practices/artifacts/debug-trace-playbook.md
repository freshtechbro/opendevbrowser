# Debug Trace Playbook

## Purpose

Run a repeatable debug pass and capture enough evidence to diagnose regressions quickly.

## Minimum Trace Bundle

- `requestId` and `sessionId`
- snapshot output before and after key actions
- console stream (`opendevbrowser_console_poll`)
- network stream (`opendevbrowser_network_poll`)
- screenshot evidence (`opendevbrowser_screenshot`)

## Workflow

1. Launch/connect and record `sessionId`.
2. Reproduce issue with the smallest action sequence.
3. Capture snapshot + console + network + screenshot at failure point.
4. Normalize findings by `requestId` and timestamp.
5. Re-run once in another mode (`managed` vs `extension` vs `cdpConnect`) to detect mode-specific drift.

## Command Skeleton

```text
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
opendevbrowser_console_poll sessionId="<session-id>" max=100
opendevbrowser_network_poll sessionId="<session-id>" max=100
opendevbrowser_screenshot sessionId="<session-id>"
```

## Triage Rules

- If refs fail: re-snapshot and retry one time.
- If repeated 403/429: pause and apply cooldown/retry policy.
- If failure reproduces in only one mode: mark as parity defect and gate release.
