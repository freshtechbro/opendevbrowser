# Annotate

Status: active  
Last updated: 2026-03-20

OpenDevBrowser can capture interactive annotations either directly via CDP/Playwright or through the extension relay, and
return a markdown summary plus structured data and screenshots. This is exposed through both the `annotate` CLI command
and the `opendevbrowser_annotate` tool.

## Requirements

**Direct (`transport=direct` or `auto` with a CDP session):**
- A managed or CDPConnect session (Playwright page available).
- Built annotation assets (`npm run extension:build` for `extension/dist/annotate-content.js`).

**Relay (`transport=relay`):**
- Relay daemon running (`npx opendevbrowser serve` or auto-started daemon).
- Chrome extension connected (popup shows **Connected**).
- Session must be in **extension** mode (relay).

Mode boundary:
- Extension-intent headless launch/connect is unsupported (`unsupported_mode`); use managed or cdpConnect for headless annotate runs.

## CLI Usage

```bash
# Auto (default): direct when possible, relay fallback in extension sessions
npx opendevbrowser annotate --session-id <session-id>

# Force direct annotate on a target
npx opendevbrowser annotate --session-id <session-id> --transport direct --target-id <target-id>

# Force relay annotate on a specific tab
npx opendevbrowser annotate --session-id <session-id> --transport relay --tab-id 123

# With URL + context + debug metadata
npx opendevbrowser annotate --session-id <session-id> --url https://example.com \
  --screenshot-mode visible --context "Review the hero layout" --timeout-ms 90000 --debug

# Return the last stored annotation payload
npx opendevbrowser annotate --session-id <session-id> --stored

# Prefer the in-memory stored payload with screenshots when still available
npx opendevbrowser annotate --session-id <session-id> --stored --include-screenshots
```

CLI output:
- Text mode prints the markdown summary directly.
- JSON/stream-json returns `{ success, message, data }`, where `data.details` is the redacted payload and `data.screenshots` lists local file paths.

For first-run pre-release onboarding and extension connection steps, see:
- `<public-repo-root>/docs/FIRST_RUN_ONBOARDING.md`

## Extension UI

You can start annotations directly from the extension popup:

1. Open the OpenDevBrowser extension popup.
2. In **Annotation**, add an optional request/context.
3. Click **Annotate**. The popup first targets the opener window's active http(s) tab directly. If the focused surface is `canvas.html`, another extension page, or a restricted tab, the background falls back to the last real annotatable web tab it stored, including recovery after an MV3 service-worker restart.
4. Switch to the target tab and select elements.
5. Use the in-page annotation UI:
    - the main panel can `Copy`, `Send`, `Cancel`, or `Submit`
    - each selected note card can `Copy` or `Send` that individual item
6. Back in the popup, use:
   - `Copy payload` / `Send payload` for the combined stored annotation payload
   - `Copy item` / `Send item` for an individual stored annotation item

If the extension service worker restarts, screenshots may be omitted from the copied payload; the popup will note when screenshots were dropped.
If the popup reports `Annotation UI did not load in the page. Reload the tab and retry.`, reload the target page once, then retry from the popup after focusing the intended web tab. The popup now prefers the opener tab id explicitly before it falls back to the stored last annotatable web tab.

Send behavior:
- Popup, canvas, and in-page `Send` actions dispatch `annotation:sendPayload` to the extension background.
- The extension background posts `store_agent_payload` through the existing `/annotation` relay lane.
- The relay handles that command locally, enqueues the sanitized payload into the shared `AgentInbox`, and returns a typed receipt.
- When a single active chat scope is registered for the current worktree, the UI reports `Delivered to agent`.
- When scope is missing or ambiguous, or when relay enqueue fails, the UI degrades to `Stored only; fetch with annotate --stored` and keeps the payload available for explicit retrieval.

## Tool Usage

Required:
- `sessionId`

Optional:
- `transport` (`auto` | `direct` | `relay`, default: `auto`)
- `stored` (fetch the latest payload explicitly sent from popup/canvas surfaces)
- `includeScreenshots` (when used with `stored`, prefer screenshots if they are still available in memory)
- `targetId` (direct mode target id from `targets-list`)
- `tabId` (relay mode Chrome tab id)
- `url` (open a URL before annotating)
- `screenshotMode` (`visible` | `full` | `none`, default: `visible`)
- `debug` (include extra metadata)
- `context` (pre-fill the annotation context)
- `timeoutMs` (defaults to 120000)

Stored payload example (OpenCode tool call):

```json
{
  "tool": "opendevbrowser_annotate",
  "args": {
    "sessionId": "session-123",
    "stored": true,
    "includeScreenshots": true
  }
}
```

Direct/relay capture example:

```json
{
  "tool": "opendevbrowser_annotate",
  "args": {
    "sessionId": "session-123",
    "transport": "auto",
    "url": "https://example.com",
    "screenshotMode": "visible",
    "debug": false,
    "context": "Review the hero layout",
    "timeoutMs": 90000
  }
}
```

## Screenshot Modes

- `visible`: captures the current viewport once and crops per selected element.
- `full`: stitches the full page (up to ~12 viewports). Use for long pages.
- `none`: no screenshots (metadata only).

## Output

The tool returns:

- `message`: markdown summary with per-annotation notes
- `details`: structured annotation payload (redacted)
- `screenshots`: array of `{ id, path }` with local temp file paths

Screenshots are written to the system temp directory (example: `/tmp/opendevbrowser-annotate-*.png`).

Stored payload retrieval notes:
- `--stored` / `stored: true` checks the shared repo-local agent inbox first, then falls back to the extension-local stored payload if no shared entry exists.
- Shared inbox items are written under `.opendevbrowser/annotate/agent-inbox.jsonl` and `.opendevbrowser/annotate/agent-scopes.json`.
- Shared inbox persistence always strips screenshots and forces `screenshotMode: "none"`; screenshot refs stay in extension-local memory/storage only.
- `--include-screenshots` / `includeScreenshots: true` only changes the extension-local fallback path; it prefers the in-memory payload when screenshots are still available and otherwise falls back to the sanitized stored payload without screenshots.
- Shared inbox retention is bounded to `200` entries total, `50` unread entries, `7` days TTL, and duplicate suppression on the same `(payloadHash, source, label)` within `60` seconds.

## Redaction

Sensitive attributes, notes, and text are automatically redacted (tokens, secrets, passwords, long random strings).
Use `details` for inspection; avoid shipping raw output without review.

## Troubleshooting

- **Relay behavior**: the extension websocket is singular, but the relay can serve multiple `/ops` clients. Disconnecting the extension or restarting the relay drops active annotation sessions. If annotations stall, reconnect in the popup (or restart the daemon) before retrying.
- **Send reports stored-only**: no safe chat scope was available (`no_active_scope`, `ambiguous_scope`) or relay enqueue failed. Fetch the payload explicitly with `annotate --stored`; if more than one chat is open against the same worktree, keep one target chat active and retry the send action.
- **Restricted URL**: `chrome://` and Chrome Web Store pages cannot be annotated. Use a normal `http(s)` URL.
- **Release gate behavior**: direct annotation probes should be recorded with their stored-payload fallback artifact; restricted-URL failures remain explicit boundary evidence, not silent passes. The canonical direct-run release evidence policy lives in `skills/opendevbrowser-best-practices/SKILL.md`.
- **Relay unavailable**: start the daemon and confirm the popup shows **Connected**.
- **Injection failed**: reload the tab and retry; ensure the extension has `<all_urls>` host permissions.
- **Capture failed**: switch to `visible` or `none` for very long pages or heavy canvas content.
- **Direct assets missing**: run `npm run extension:build` to generate `extension/dist/annotate-content.js`.
