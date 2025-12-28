# Implementation Blueprint (v1)

## Progress (Synced)
- [x] Scaffold project files (package.json, tsconfig, src layout) and baseline config defaults.
- [x] Implement cache/chrome locator/downloader utilities and config validation.
- [x] Implement browser management (sessions, targets), snapshotter/refs, and script runner.
- [x] Implement tool handlers (launch/connect/etc, actions, dom extract, run, prompting guide).
- [x] Implement devtools trackers and export pipeline stubs; update docs/plan files with progress.
- [x] Wire lint/test scripts and baseline test tooling.
- [x] Implement tests with >=95% coverage and ensure passing.
- [x] Scaffold optional extension Phase 1 folder.
- [x] Add README usage examples and config snippets.
- [x] Implement relay server + extension bridge (Mode C) with auto-switch and forwarding.
- [x] Add relay handshake/forwarding tests and fallback behavior.
- [x] Add optional relay pairing token and extension reconnect/tab tracking updates.
- [x] Implement named page helpers (opendevbrowser_page/opendevbrowser_list/opendevbrowser_close) and name-to-target mapping.
- [x] Implement export tools (opendevbrowser_clone_page/opendevbrowser_clone_component) using export pipeline.
- [x] Implement lightweight perf metrics + screenshot tool (keep full tracing as non-goal).
- [x] Add extension unit tests (attach/detach, tab selection, reconnect).
- [x] Align build tooling in docs vs code (tsc build).

## Repo Layout
```
dev-browser-plugin/
  package.json
  tsconfig.json
  docs/
    PLAN.md
    opendevbrowser-plan.md
    IMPLEMENTATION_BLUEPRINT.md
  src/
    index.ts
    config.ts
    skills/
      skill-loader.ts
    cache/
      paths.ts
      chrome-locator.ts
      downloader.ts
    browser/
      browser-manager.ts
      session-store.ts
      target-manager.ts
      script-runner.ts
    snapshot/
      snapshotter.ts
      refs.ts
    devtools/
      console-tracker.ts
      network-tracker.ts
    relay/
      relay-server.ts
      protocol.ts
    tools/
      launch.ts
      connect.ts
      disconnect.ts
      status.ts
      targets_list.ts
      target_use.ts
      target_new.ts
      target_close.ts
      goto.ts
      wait.ts
      snapshot.ts
      click.ts
      type.ts
      select.ts
      scroll.ts
      dom_get_html.ts
      dom_get_text.ts
      run.ts
      prompting_guide.ts
      console_poll.ts
      network_poll.ts
    export/
      dom-capture.ts
      css-extract.ts
      react-emitter.ts
  skills/
    opendevbrowser-best-practices/
      SKILL.md
  extension/
    package.json
    manifest.json
    src/
      background.ts
      popup.tsx
      services/
        ConnectionManager.ts
        RelayClient.ts
        TabManager.ts
        CDPRouter.ts
      types.ts
```

## Outstanding Items (Resolved)
- Named pages: add name-to-target mapping and helper tools.
- Export tools: wire export pipeline to clone tools.
- DevTools additions: perf metrics + screenshot tool.
- Extension unit tests for attach/detach, tab selection, reconnect.
- Build tooling reconciliation (document tsc or add tsup/bun build).

## Core Plugin Entry (src/index.ts)
- Exports a single OpenCode plugin function.
- Registers `opendevbrowser_*` tools using OpenCode `tool()` helper.
- Instantiates singletons:
  - BrowserManager (Mode A/B/C orchestration)
  - RelayServer (optional Mode C)
  - ConsoleTracker / NetworkTracker (ring buffers for polling)
  - SkillLoader (loads best-practice prompting guides on demand)
  - Clone/export tools + perf/screenshot tools.

## Configuration (src/config.ts)
- Defaults: Mode A, localhost only, redaction enabled, maxChars/maxNodes, per-project cache.
- Reads plugin-owned file `~/.config/opencode/opendevbrowser.jsonc` (optional).
- OpenCode `opencode.json` only declares `plugin: ["opendevbrowser"]` (no custom keys).
- DevTools toggles: `devtools.showFullUrls`, `devtools.showFullConsole` (both default false).
- Export controls: `export.maxNodes` (default 1000), `export.inlineStyles` (default true); `security.allowUnsafeExport` bypasses sanitization.
- Optional `relayToken` to require extension pairing on the local relay.

## Browser Management
### BrowserManager
- Mode A: launches system Chrome via `playwright-core` with persistent context.
- Mode B: connects to user-provided CDP endpoint with safety checks.
- Mode C: uses relay endpoint when extension connects; auto-switches on handshake.
- Tracks `sessionId`, active target, named pages, CDP sessions.

### ChromeLocator
- OS-specific Chrome detection.
- If missing: triggers ChromeForTestingDownloader.

### Downloader
- Downloads Chrome for Testing into plugin cache on first use.
- Stores versioned binaries under cache.

## Script-First Execution
### ScriptRunner
- Executes `steps[]` in `opendevbrowser_run` (single tool call for speed).
- Each step maps to internal handlers (`goto`, `snapshot`, `click`, etc).
- Returns structured results with timing and error details.

## Snapshots and Refs
### Snapshotter
- Injects ARIA snapshot script (Dev Browser style).
- Produces outline + actionables with cursor paging.
- Stores ref map in page context; refs carry `{backendNodeId, frameId, targetId}`.

## DOM Extraction
- `dom_get_html`: `DOM.getOuterHTML` or `page.evaluate` on ref.
- `dom_get_text`: `innerText`/`textContent` on ref.

## DevTools Signals (MVP)
### ConsoleTracker
- Subscribes to `Runtime.consoleAPICalled` and stores events in a ring buffer.

### NetworkTracker
- Subscribes to `Network.requestWillBeSent` / `Network.responseReceived`.
- Stores events in a ring buffer.

## Export Pipeline (MVP-lite)
- `dom-capture`: serialize subtree + computed styles.
- `css-extract`: minimal CSS rules for captured nodes.
- `react-emitter`: output TSX + CSS.

## Extension + Relay (Mode C, staged)
### Relay Server
- Local WebSocket bridge with two endpoints:
  - `/extension` for the extension
  - `/cdp` for plugin CDP connection (connectOverCDP)
- Protocol (mirrors dev-browser relay):
  - Command: `{ id, method:"forwardCDPCommand", params:{method, params, sessionId} }`
  - Response: `{ id, result | error }`
  - Event: `{ method:"forwardCDPEvent", params:{method, params, sessionId} }`
- Optional pairing token in handshake payload for local auth.

### Extension
- Uses `chrome.debugger` to attach to selected tab.
- Maintains tab/target/session mapping via `TabManager`.
- Tracks tab updates/grouping and re-sends handshake updates to relay.
- Toggle UI in popup; sends handshake (with optional pairing token) to relay.

## Security Defaults
- Localhost only for CDP unless explicitly allowed.
- Secret redaction in snapshots.
- Raw CDP access disabled by default.

## Build and Packaging
- Dependencies: `playwright-core` + `@puppeteer/browsers` (optional Chrome for Testing download).
- Build to `dist/` via `tsc` (current).
- `package.json` `main` points to `dist/index.js`.

## Test Strategy
- Unit: config parsing, snapshot trimming, tool arg validation.
- Integration: managed mode navigation + snapshot + ref action.
- Extension: relay handshake + attach/detach/tab selection tests.
- Coverage: Vitest v4 with >=95% thresholds for `src/` (exclude extension from coverage thresholds).

## Skill Pack (Initial Deployment)
- Store best-practice prompting guidance in `skills/opendevbrowser-best-practices/SKILL.md`.
- Implement `SkillLoader` to read skills from disk at runtime.
- Expose `opendevbrowser_prompting_guide` tool to fetch guidance on demand.
