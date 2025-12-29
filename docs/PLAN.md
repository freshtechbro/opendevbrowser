# Dev Browser Plugin Plan (v1)

## Goals
- Script-first browser control (fast, low overhead).
- Plugin-native implementation (no MCP orchestration).
- Zero manual install: plugin entry only; no user setup required.
- Optional Chrome extension to reuse existing logged-in tabs.
- Plugin fully functional without the extension.

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
- [x] Add default relay pairing token (opt-out) and extension reconnect/tab tracking updates.
- [x] Implement named page helpers (browser.page(name), browser.list, browser.close) and name-to-target mapping.
- [x] Implement export tools (browser.clonePage, browser.cloneComponent) using export pipeline.
- [x] Implement devtools perf metrics + screenshot tool.
- [x] Add extension unit tests (attach/detach, tab selection, reconnect).
- [x] Align build tooling in docs vs code (tsc build).

## Approved Decisions
- Default browser: system Chrome auto-detected; auto-fallback to Chrome for Testing download in plugin cache.
- Output format: plain React component (TSX) + CSS.
- Driver: playwright-core with CDP connection to system Chrome; no browser download by default.
- Profile storage: plugin cache, per-project isolation.

## Target UX
- Install plugin -> works immediately (managed mode).
- Scripts execute multi-step actions in one tool call.
- Structured ARIA/DOM snapshots with stable refs for element selection.
- Optional extension only if user wants to control existing Chrome tabs.

## Architecture Overview
- Plugin module (OpenCode JS/TS plugin): registers tools and manages lifecycle.
- BrowserManager: launch/connect to Chrome, manage persistent context and named pages.
- ScriptRunner: executes multi-step scripts; exposes helper utilities (waitForPageLoad, retries, selectors).
- Snapshotter: injects ARIA snapshot script; stores ref map for stable selection.
- DevTools adapter: CDP sessions for network, console, performance, screenshots.
- Export pipeline: DOM + computed styles capture -> React component + CSS.
- Cache manager: stores profiles, downloads, and artifacts under plugin cache.
- Skill pack: best-practice prompting guides loaded on demand (small, no tool bloat).
- Optional extension + relay:
  - Extension uses chrome.debugger to attach to existing tabs.
  - Local relay forwards CDP commands/events between plugin and extension (default pairing token, opt-out via config).

## Tool Surface (plugin-native)
- browser.start / browser.stop
- browser.page(name) / browser.list / browser.close
- browser.run({ name, script, args })
- browser.snapshot({ name, mode })
- browser.selectRef({ name, ref })
- browser.promptingGuide({ topic })
- browser.devtools.* (network, console, perf, screenshots)
- browser.clonePage / browser.cloneComponent

## Skill Pack (Initial Deployment)
- Bundle a small skill pack for best-practice prompting and script generation guidance.
- Store in `skills/opendevbrowser-best-practices/SKILL.md`.
- Load on demand via the prompting guide tool to avoid bloating other tools.

## Phased v1 Delivery

### Phase 0: Core plugin (no extension required) (Done)
- Managed mode using system Chrome (CDP via playwright-core).
- Persistent profiles and named pages.
- Script runner and snapshot/ref flow.
- DevTools helpers (network/console/perf).

### Phase 1: Extension scaffold (in repo) (Done)
- Extension project and build pipeline.
- Toggle UI + connection status.
- Plugin detects extension capability but remains managed by default.

### Phase 2: Extension MVP (Done)
- Relay server in plugin.
- Extension connects to relay and attaches to selected tab.
- Plugin auto-switches to extension mode on handshake.

### Phase 3: Extension reliability (Done)
- Reconnect handling, target tracking, tab grouping.
- Stability hardening; plugin fallback to managed mode if extension drops.

## Validation and Docs
- Smoke tests: managed mode navigation, snapshot selection, script execution.
- Extension tests: handshake, attach/detach, tab selection.
- Coverage: enforce >=95% across `src/` (extension excluded from coverage thresholds).
- Installation prompt: one-step plugin config; plugin-owned config file auto-created at `~/.config/opencode/opendevbrowser.jsonc`.
- Troubleshooting: browser detection, fallback download, profile cleanup.
