# Annotate

Status: active  
Last updated: 2026-02-24

OpenDevBrowser can capture interactive annotations either directly via CDP/Playwright or through the extension relay, and
return a markdown summary plus structured data and screenshots. This is exposed via the `opendevbrowser_annotate` tool.

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
3. Click **Annotate**, then switch to the target tab and select elements.
4. Submit from the in-page annotation UI.
5. Back in the popup, click **Copy payload** to copy the full annotation JSON (DOM info included).

If the extension service worker restarts, screenshots may be omitted from the copied payload; the popup will note when screenshots were dropped.

## Tool Usage

Required:
- `sessionId`

Optional:
- `transport` (`auto` | `direct` | `relay`, default: `auto`)
- `targetId` (direct mode target id from `targets-list`)
- `tabId` (relay mode Chrome tab id)
- `url` (open a URL before annotating)
- `screenshotMode` (`visible` | `full` | `none`, default: `visible`)
- `debug` (include extra metadata)
- `context` (pre-fill the annotation context)
- `timeoutMs` (defaults to 120000)

Example (OpenCode tool call):

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

## Redaction

Sensitive attributes, notes, and text are automatically redacted (tokens, secrets, passwords, long random strings).
Use `details` for inspection; avoid shipping raw output without review.

## Troubleshooting

- **Relay behavior**: the extension websocket is singular, but the relay can serve multiple `/ops` clients. Disconnecting the extension or restarting the relay drops active annotation sessions. If annotations stall, reconnect in the popup (or restart the daemon) before retrying.
- **Restricted URL**: `chrome://` and Chrome Web Store pages cannot be annotated. Use a normal `http(s)` URL.
- **Relay unavailable**: start the daemon and confirm the popup shows **Connected**.
- **Injection failed**: reload the tab and retry; ensure the extension has `<all_urls>` host permissions.
- **Capture failed**: switch to `visible` or `none` for very long pages or heavy canvas content.
- **Direct assets missing**: run `npm run extension:build` to generate `extension/dist/annotate-content.js`.
