---
name: OpenDevBrowser Best Practices
description: This skill should be used when the user asks to "write a browser script", "generate opendevbrowser steps", "use snapshot refs", "automate navigation", "extract DOM elements", or requests best-practice prompting for OpenDevBrowser. Provides script-first guidance, snapshot/ref workflow, and token-efficient patterns.
version: 0.1.0
---

# OpenDevBrowser Best Practices

Use this guide to generate fast, reliable, script-first workflows without bloating tools or output.

## Core Workflow (Snapshot -> Refs -> Actions)

Prefer the snapshot/ref loop as the primary interaction model:

1. Navigate or focus the target page.
2. Capture a snapshot to obtain stable refs.
3. Act on refs (click, type, select, scroll).
4. Re-snapshot after navigation or large DOM changes.

Use refs instead of raw selectors whenever possible.

## Script-First Execution

Batch related actions in a single run to reduce round-trips:

- Use `opendevbrowser_run` for multi-step actions.
- Keep steps small and deterministic.
- End each run with a state check (snapshot or targeted extraction).

Match the arguments used in the single-action tools.

## Waiting and Stability

Stabilize the page before acting:

- Use `opendevbrowser_wait` after navigation and before interacting with newly rendered UI.
- Prefer `networkidle` or `load` when the UI is fully dynamic.
- Wait for a ref state when targeting specific elements.

## Token-Efficient Extraction

Keep outputs small and scoped:

- Use `opendevbrowser_dom_get_text` or `opendevbrowser_dom_get_html` only on specific refs.
- Avoid dumping full page HTML.
- Use snapshot cursor paging when content is large.

## Debug Signals (Lightweight)

Use polling tools only when needed:

- Use `opendevbrowser_console_poll` to check for runtime errors.
- Use `opendevbrowser_network_poll` to confirm API calls and statuses.

## Example Patterns

### Login Flow (Batch)

1. `goto` login URL.
2. `wait` for page load.
3. `snapshot` to get refs.
4. `type` email/password refs.
5. `click` submit ref.
6. `wait` for navigation.
7. `snapshot` to confirm state.

### Targeted Extraction

1. `snapshot` to get ref for the desired element.
2. `dom_get_text` on that ref.

## Mode Guidance

- Use Mode A (managed) by default for zero-config operation.
- Use Mode C (extension) only when existing logged-in tabs are required.

## Safe Defaults

- Keep CDP local-only by default.
- Redact secrets in snapshot output.
- Avoid raw CDP unless explicitly enabled.
