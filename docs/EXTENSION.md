# OpenDevBrowser Extension

Optional Chrome extension that enables relay mode (attach to existing logged-in tabs).

Status: active  
Last updated: 2026-04-12

Quick file-level overview: `<public-repo-root>/extension/README.md`

## What it does

- Connects to the local relay server (`ws://127.0.0.1:<port>/extension`).
- Uses the Chrome Debugger API to forward CDP commands across attached tabs/targets (with a primary tab used for handshake/status).
- Allows OpenDevBrowser to control tabs without launching a new browser.
- Lets extension-backed sessions participate in manager-owned browser replay capture through the existing screenshot primitive; there is no separate extension screencast relay family.
- Supports multi-tab CDP routing with flat sessions (Chrome 125+).
- Exposes top-level tabs and auto-attached child targets (workers/OOPIF) through `Target.getTargets`.
- Hosts the dedicated design-canvas runtime used by `/canvas` for design-tab and overlay operations.
- Preserves additive canvas session-summary metadata such as `availableInventoryCount`, `catalogKitIds`, `availableStarterCount`, and the currently applied starter so the design tab stays in sync with starter and kit availability without introducing a second starter execution path in the extension.
- Routes popup/canvas/in-page annotation `Send` actions through `/annotation` `store_agent_payload` so the active chat can receive repo-local shared inbox entries when scope is safe.
- Launch defaults to extension relay when available; managed/CDPConnect require explicit user choice.
- Extension mode is headed-only; extension-intent headless launch/connect is rejected with `unsupported_mode`.
- Desktop observation is not an extension feature; the shipped desktop commands and tools stay daemon/core-owned, public, and observe-only.
- Generated help surfaces the exact lookup labels `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`; the extension participates in relay-backed browser work, not the public read-only desktop plane.
- When hub mode is enabled, the hub daemon is the sole relay owner and enforces FIFO leases (no local relay fallback).

## Installation

Requires Node.js `>=18` and the npm package (`npx opendevbrowser` recommended; `npm install -g opendevbrowser` optional).

1. Run the CLI once with `--full` so the extension assets are extracted:
   ```bash
   npx opendevbrowser --full
   ```
2. Load the extension unpacked from:
   - `~/.config/opencode/opendevbrowser/extension`
   - Fallback: `~/.cache/opencode/node_modules/opendevbrowser/extension`
   - Pre-release local package onboarding: `<WORKDIR>/node_modules/opendevbrowser/extension`
3. Open the extension popup to configure relay settings.

For full first-run pre-release onboarding flow (local package install, isolated daemon, extension connect, first task), use:
- `<public-repo-root>/docs/FIRST_RUN_ONBOARDING.md`

## Popup settings

- **Relay port**: Port of the local relay server (default `8787`).
- **Auto-connect**: Reconnect on browser start (default on).
- **Auto-pair**: Fetch pairing token automatically from the plugin (default on).
- **Native fallback (experimental)**: Allow native messaging fallback when relay is unavailable (default off).
- **Require pairing token**: Require token for relay pairing (recommended).
- **Pairing token**: Manual token entry when auto-pair is off.

## Default settings

| Setting | Default |
|---------|---------|
| Relay port | `8787` |
| Auto-connect | `true` |
| Auto-pair | `true` |
| Native fallback (experimental) | `false` |
| Require pairing token | `true` |
| Pairing token | `null` (fetched on connect) |

## Auto-connect behavior

Auto-connect is enabled by default. The extension attempts to connect on browser startup, install, and when the toggle is enabled in the UI. Auto-connect respects the current relay port, pairing settings, and auto-pair toggle.
Native fallback is only attempted when the experimental native toggle is enabled.
The toolbar action uses the OpenDevBrowser icon set from `extension/icons/` (synced from `assets/extension-icons/` during `npm run extension:build`) and a badge dot indicator (green = connected, red = disconnected).

## Auto-pair flow

When auto-pair is enabled:

1. The extension calls the local discovery endpoint (`/config`) to learn the relay port and pairing requirement.
2. If pairing is required, it fetches the token from `/pair`.
3. The extension connects to the relay with the pairing token.

`/config` and `/pair` reject explicit non-extension origins. Chrome extension requests may omit the `Origin` header, so the relay also accepts missing-Origin requests. CLI/tools may call `/config` and `/pair` to auto-fetch relay settings and tokens.

Relay ops endpoint: `ws://127.0.0.1:<relayPort>/ops`. The CLI/tool `connect` command accepts base relay WS URLs
(for example `ws://127.0.0.1:<relayPort>`) and normalizes them to `/ops`.
Relay canvas endpoint: `ws://127.0.0.1:<relayPort>/canvas` for live design-canvas preview and overlay commands.
Relay annotation endpoint: `ws://127.0.0.1:<relayPort>/annotation` for interactive annotate capture plus one-off `store_agent_payload` and `fetch_stored` requests.
Legacy relay `/cdp` is still available but must be explicitly opted in (CLI: `--extension-legacy`).
Legacy `/cdp` is mutually exclusive with an active `/ops` lease on the extension target. If the CLI returns `cdp_attach_blocked`, disconnect the `/ops` session first, then retry the legacy path.
When pairing is enabled, `/ops`, `/canvas`, `/annotation`, and `/cdp` require a relay token (`?token=<relayToken>`). Tools and the CLI auto-fetch `/config` and `/pair`
to obtain the token before connecting, so users should not manually pass or share tokenized URLs.

Readiness checks:

```bash
npx opendevbrowser status --daemon --output-format json
npx opendevbrowser --help
node scripts/chrome-store-compliance-check.mjs
```

Expected extension-ready daemon fields:
- `extensionConnected=true`
- `extensionHandshakeComplete=true`
- `canvasConnected=false` unless a design-canvas session is actively using relay preview/overlay flows

## Chrome version requirement

Extension relay uses flat CDP sessions and requires **Chrome 125+**. Older versions will fail fast with a clear error.

## Multi-tab + primary tab behavior

- Target discovery (`Target.getTargets`) includes top-level tabs and child targets.
- Child targets are auto-attached recursively for session-aware routing.
- A single **primary tab** is used for relay handshake/status; switching tabs updates the handshake without disconnecting others.
- Design-canvas flows can open dedicated extension-hosted design tabs (`canvas.html`) and mount overlays on existing tabs through the `/canvas` runtime.
- The extension design tab is a same-origin infinite-canvas editor: it persists full `CanvasPageState` snapshots in `IndexedDB`, fans out same-origin convergence over `BroadcastChannel`, sends editor-originated patch requests back through `/canvas`, keeps arbitrary page overlays in sync through the same runtime, and now exposes page selection, hierarchical layers, a property inspector, lease-aware undo/redo controls, keyboard shortcuts, extension-stage region annotation, and a dedicated token panel for collection or mode creation, token value or alias editing, selected-node binding, and token usage inspection.
- Extension-hosted design tabs must register their synthetic target through `targets.registerCanvas` before `/ops` `targets.use` can activate that surface.

## Annotation send behavior

- Popup `Annotate` resolves against the opener window's active http(s) tab first. If the focused surface is `canvas.html`, another extension page, or a restricted tab, the background falls back to the last annotatable web tab it stored instead of trying to inject into the extension page itself, so popup annotate can recover after an MV3 service-worker restart.
- Popup, canvas, and in-page annotation `Send` actions dispatch `annotation:sendPayload` to the background, and the background then posts `/annotation` `store_agent_payload`.
- The relay handles `store_agent_payload` locally and returns a shared-inbox receipt sourced from `AgentInbox`.
- Successful scoped delivery reports `Delivered to agent`.
- When delivery cannot be scoped safely or the relay path fails, the extension stores the sanitized payload locally and reports `Stored only; fetch with annotate --stored`.
- Shared inbox persistence strips screenshots; `annotate --stored --include-screenshots` only affects the extension-local fallback copy when it is still available in memory.

## Security notes

- Relay connections are local-only by default.
- Pairing tokens are stored in `chrome.storage.local` and never sent to third parties.
- The extension does not log page content or tokens.
- Non-local relay endpoints are not supported unless explicitly configured in the plugin.

## Troubleshooting

- **Extension not connecting**: Confirm the relay is running (`opendevbrowser serve`) and the port matches the popup.
- **Temp-profile unpacked extension automation does nothing**: Google Chrome stable may ignore startup flags like `--disable-extensions-except` and `--load-extension`. For isolated automation harnesses, prefer Chromium or Chrome for Testing, or use the already-installed unpacked extension in your real Chrome profile.
- **Auto-pair failing**: Ensure the plugin is running and the relay server is available on the configured port.
- **Pairing token required**: Enable "Require pairing token" and provide the value from your `opendevbrowser.jsonc`.
- **No active tab / restricted tab**: The popup cannot attach to `chrome://`, `chrome-extension://`, or Chrome Web Store pages. Focus a normal http(s) tab before connecting.
- **Popup annotate says `Annotation UI did not load in the page`**: The popup could not confirm the page-side annotation bridge after injection. The popup now sends its opener-tab id directly and otherwise restores the last stored annotatable web tab, but you should still focus the intended http(s) tab once, reload that page, and retry. If you just rebuilt the unpacked extension, reload it in Chrome before retesting so the new background and content-script bundles are active.
- **Canvas design-tab overlay fails with `restricted_url` on `chrome-extension://.../canvas.html`**: Chrome is still running stale unpacked-extension runtime code. Rebuild if needed, then reload the unpacked extension in Chrome before retrying `canvas.overlay.mount` or related design-tab commands; reconnect the extension after reload so the fresh background bundle owns the relay again.
- **Debugger attach failed**: Close DevTools on the target tab (or any other debugger) and retry.
- **Chrome too old**: Extension relay requires Chrome 125+ for flat sessions.
- **Headless extension launch/connect fails**: expected. Extension mode is headed-only; use `launch --no-extension --headless` for managed headless sessions.
- **Launch fails due to missing extension**: The CLI/tool will print exact commands for Managed or CDPConnect fallbacks when the extension is not connected.
- **Popup shows Connected but launch says not connected**: Check the popup note for the relay port/instance (it now includes the relay identity) and ensure it matches the daemon relay port.
- **Canvas code sync shows `unsupported`**: Run `npx opendevbrowser canvas --command canvas.code.status --params '{"canvasSessionId":"<canvas-session-id>","bindingId":"<binding-id>"}' --output-format json` and inspect `frameworkAdapterId`, `declaredCapabilities`, `grantedCapabilities`, `capabilityDenials`, and `reasonCode`. Built-in lanes currently cover React TSX v2, static HTML, custom elements, Vue SFC, and Svelte SFC; legacy `tsx-react-v1` bindings migrate to `builtin:react-tsx-v2` on load.
- **Local adapter plugin will not load**: Repo-local BYO plugins only load from local `package.json`, `.opendevbrowser/canvas/adapters.json`, or explicit config declarations. Out-of-worktree package declarations are rejected with `trust_denied`, and malformed manifests or broken entrypoints surface deterministic plugin load failures.
- **Annotation send says stored only**: no safe chat scope was available for the current worktree or relay enqueue failed. Use `annotate --stored` to fetch the payload explicitly, or keep one target chat active and retry the send.
