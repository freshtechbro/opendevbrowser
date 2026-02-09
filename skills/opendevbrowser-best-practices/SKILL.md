---
name: opendevbrowser-best-practices
description: This skill should be used when the user asks to "automate a browser flow", "write an OpenDevBrowser script", "use snapshot refs", "extract page content", or "debug browser automation".
version: 1.1.0
---

# OpenDevBrowser Best Practices

Use this guide to produce reliable, script-first automation with minimal retries and predictable output.

## Setup Prerequisites

- Runtime: Node.js `>=18`.
- Recommended installer: `npx opendevbrowser`
- Optional persistent CLI: `npm install -g opendevbrowser`
- For extension assets/local extension loading: `npx opendevbrowser --full`

## Core Operating Model

Follow the loop strictly:

1. Establish or attach a session.
2. Capture `opendevbrowser_snapshot`.
3. Select refs from that snapshot.
4. Execute one or more actions using refs.
5. Re-snapshot after navigation or major DOM change.

Prefer refs over raw selectors. Refs are more stable across dynamic UI changes.

## Session Strategy

Choose mode deliberately:

- Use managed mode for deterministic, isolated runs.
- Use extension mode when existing logged-in tabs or profile state are required.
- Use CDP connect mode only when attaching to a pre-launched browser is required.

Example launch patterns:

```text
opendevbrowser_launch noExtension=true
opendevbrowser_launch waitForExtension=true
opendevbrowser_connect wsEndpoint="ws://127.0.0.1:9222/devtools/browser/<id>"
```

## Snapshot Discipline

Capture snapshots in the format needed by the current task:

- Use `format="outline"` for broad page state.
- Use `format="actionables"` for interaction planning.
- Use `maxChars` and `cursor` to page large pages instead of requesting oversized snapshots.

```text
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
```

## Action Sequencing

Stabilize before interacting:

- After `goto` or click-driven navigation, run `opendevbrowser_wait`.
- Wait on `until="networkidle"` for API-heavy pages.
- Wait on `ref` + `state` for specific element readiness.

```text
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_wait sessionId="<session-id>" ref="<target-ref>" state="visible"
```

For multi-step interactions, batch deterministic steps with `opendevbrowser_run`.

```text
opendevbrowser_run sessionId="<session-id>" steps=[{"action":"goto","args":{"url":"https://example.com"}},{"action":"wait","args":{"until":"networkidle"}},{"action":"snapshot","args":{"format":"actionables"}}]
```

## Extraction and Output Control

Keep output scoped and cheap:

- Extract only the needed node text with `opendevbrowser_dom_get_text`.
- Use `opendevbrowser_dom_get_html` only for small targeted fragments.
- Use `opendevbrowser_get_attr` and `opendevbrowser_get_value` for structured field data.

```text
opendevbrowser_dom_get_text sessionId="<session-id>" ref="<content-ref>"
opendevbrowser_get_attr sessionId="<session-id>" ref="<input-ref>" name="aria-invalid"
```

## Lightweight Diagnostics

Inspect runtime behavior only when required:

- Use `opendevbrowser_console_poll` to detect script/runtime errors.
- Use `opendevbrowser_network_poll` to verify request outcomes.
- Use `opendevbrowser_screenshot` for visual debugging artifacts.

```text
opendevbrowser_console_poll sessionId="<session-id>"
opendevbrowser_network_poll sessionId="<session-id>" max=50
```

## Failure Recovery Order

When a step fails, recover in this order:

1. Re-snapshot to refresh refs.
2. Re-wait for load or element state.
3. Retry action once with fresh refs.
4. Change mode (managed vs extension) only if failure is mode-specific.

Avoid blind repeated retries against stale refs.

## Security and Safety Defaults

- Keep CDP and relay endpoints local-only by default.
- Do not place secrets in scripts, skill files, or logs.
- Prefer minimal extraction over full-page dumps when handling sensitive pages.

## Ready-to-Use Flow Template

```text
opendevbrowser_launch noExtension=true
opendevbrowser_goto sessionId="<session-id>" url="https://example.com"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
# interact with refs
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
```
