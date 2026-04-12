# OpenDevBrowser

[![npm version](https://img.shields.io/npm/v/opendevbrowser.svg?style=flat-square)](https://registry.npmjs.org/opendevbrowser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-green.svg?style=flat-square)](https://opencode.ai)
[![CLI](https://img.shields.io/badge/Interface-CLI-orange.svg?style=flat-square)](docs/CLI.md)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg?style=flat-square)](docs/EXTENSION.md)
[![Test Coverage](https://img.shields.io/badge/coverage-97%25-brightgreen.svg?style=flat-square)](https://registry.npmjs.org/opendevbrowser)

> **Script-first browser automation for AI agents.** Snapshot → Refs → Actions.

OpenDevBrowser is an agent-agnostic browser automation runtime for CLI workflows, [OpenCode](https://opencode.ai) tool calls, and Chrome extension relay sessions. It supports managed launches, direct CDP attach, and extension-backed Ops sessions.

The current public surface includes [72 CLI commands and 65 `opendevbrowser_*` tools](docs/SURFACE_REFERENCE.md); see [docs/CLI.md](docs/CLI.md) for the operational command guide.
Generated help is the canonical first-contact discovery surface: `npx opendevbrowser --help` and `npx opendevbrowser help` now lead with browser replay, public read-only desktop observation, and the browser-scoped computer-use lane exposed through `--challenge-automation-mode`.

<p align="center">
  <img src="assets/hero-image.png" alt="OpenDevBrowser hero image showing AI-assisted annotation and browser automation workflow" width="920" />
  <br />
  <em>AI-assisted annotation and browser automation workflow</em>
</p>

## Table of Contents

- [Use It Your Way](#use-it-your-way)
- [Why OpenDevBrowser?](#why-opendevbrowser)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Challenge Handling Boundary](#challenge-handling-boundary)
- [Recent Features](#recent-features)
- [Features](#features)
- [Tool Reference](#tool-reference)
- [Bundled Skills](#bundled-skills)
- [Browser Modes](#browser-modes)
- [Relay Channels](#relay-channels)
- [Breaking Changes (latest)](#breaking-changes-latest)
- [Chrome Extension (Optional)](#chrome-extension-optional)
- [Configuration](#configuration)
- [CLI Commands](#cli-commands)
- [Security](#security)
- [Updating](#updating)
- [Architecture](#architecture)
- [Development](#development)
- [Privacy](#privacy)
- [License](#license)

## Use It Your Way

| Interface | OpenCode Required | Best For |
|-----------|-------------------|----------|
| **CLI (`npx opendevbrowser ...`)** | No | Any agent/workflow that can run shell commands |
| **Chrome Extension + Relay** | No | Reusing existing logged-in tabs without launching a new browser |
| **OpenCode Plugin Tools** | Yes | Native tool-calling inside OpenCode (`opendevbrowser_*`) |
| **Frontend Website (private repo)** | No | Product website and generated docs routes |

The public repo owns the automation runtime and canonical docs; see [docs/SURFACE_REFERENCE.md](docs/SURFACE_REFERENCE.md) for the full surface inventory.

## Why OpenDevBrowser?

- **Script-first automation model**: snapshot → refs → actions, built around accessibility-tree capture instead of brittle selector-first workflows.
- **Stable interaction primitives**: refs resolve through `backendNodeId`, and low-level pointer commands remain available when normal DOM actions are not enough.
- **Flexible session control**: run managed sessions, attach through direct CDP, or reuse logged-in tabs through the extension relay and `/ops`.
- **Design and review workflows**: use the design canvas, shared annotation inbox, and repo-backed code-sync flows without leaving the runtime surface.
- **Diagnostics and bounded challenge handling**: start with `session-inspector`, then drop to console or network polling and unified debug traces when you need channel-level detail.
- **Production guardrails**: local-only CDP by default, timing-safe auth, sanitized exports, strict TypeScript, and branch coverage held at 97% or higher.

---

## Installation

Requires Node.js `>=18`.

### For Humans

```bash
# Interactive installer (recommended)
npx opendevbrowser

# Or specify location
npx opendevbrowser --global   # ~/.config/opencode/opencode.json
npx opendevbrowser --local    # ./opencode.json

# Full install (config + extension assets)
npx opendevbrowser --full

# Optional: persistent global CLI
npm install -g opendevbrowser
opendevbrowser --version
```

### Pre-release Local Package (No npm publish required)

Use this flow to validate first-run local package onboarding before npm publish.

```bash
cd <public-repo-root>
npm pack

WORKDIR=$(mktemp -d /tmp/opendevbrowser-first-run-XXXXXX)
cd "$WORKDIR"
npm init -y
npm install <public-repo-root>/opendevbrowser-0.0.17.tgz
npx --no-install opendevbrowser --help
npx --no-install opendevbrowser help
```

See [docs/FIRST_RUN_ONBOARDING.md](docs/FIRST_RUN_ONBOARDING.md) for the full onboarding checklist, [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) for runtime inventory, and [docs/SURFACE_REFERENCE.md](docs/SURFACE_REFERENCE.md) for the live CLI and tool surface.

Successful installs reconcile daemon auto-start on supported platforms so the relay is available on login. If the current CLI entrypoint lives under a transient temp-root path such as a first-run `/tmp` or `/private/tmp` workspace, OpenDevBrowser refuses to persist that path as auto-start. Rerun `opendevbrowser daemon install`, or `npx --no-install opendevbrowser daemon install` from a persistent local package install, from a stable install location if you want login auto-start; remove it later with `opendevbrowser daemon uninstall`.

Bundled skills sync to **OpenCode, Codex, ClaudeCode, and AmpCLI** targets during install. Use `--skills-global` for user-wide installs or `--skills-local` for project-local installs; see [docs/CLI.md](docs/CLI.md) for exact target paths.

### CLI + Extension (No OpenCode)

```bash
# Start relay/daemon runtime
npx opendevbrowser serve

# Launch using extension mode (requires extension popup connected)
npx opendevbrowser launch --extension-only --wait-for-extension

# Or force managed mode without extension
npx opendevbrowser launch --no-extension
```

Unpacked extension load path after local install:
- `<WORKDIR>/node_modules/opendevbrowser/extension`

### Frontend Website (Private Repo)

```bash
git clone https://github.com/freshtechbro/opendevbrowser-website-deploy.git
cd opendevbrowser-website-deploy/frontend
npm install
npm run dev
```

Website build/data pipeline lives in the private repo:
- `npm run sync:assets` copies mirrored assets into private `frontend/public/brand`.
- `npm run generate:docs` regenerates docs, metrics, and roadmap JSON consumed by `/docs`.

### Agent Installation (OpenCode)

Use OpenCode only when you want native `opendevbrowser_*` tool calls; the CLI and extension workflows work without it.

Recommended (CLI, installs plugin + config + bundled skills + extension assets):

```bash
npx opendevbrowser --full --global --no-prompt
```

Explicit flags (config + skills, no prompt):

```bash
npx opendevbrowser --global --with-config --skills-global --no-prompt
```

Manual fallback (edit OpenCode config):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opendevbrowser"]
}
```

Config location: `~/.config/opencode/opencode.json`

Restart OpenCode, then run `opendevbrowser_status` to verify the plugin is loaded (daemon status when hub is enabled).

---

## Quick Start

OpenDevBrowser uses the same automation model across plugin tools and CLI commands:

```
1. Launch a browser session
2. Navigate to a URL
3. Take a review to get target-aware actionables and refs
4. Interact using refs (click, type, select)
5. Re-review or re-snapshot after navigation
```

Shipping checklist for first-time users (local-package install, daemon, extension, first task, multi-tab auth/cookies):
- [`docs/FIRST_RUN_ONBOARDING.md`](docs/FIRST_RUN_ONBOARDING.md)

Parallel execution is target-scoped (`ExecutionKey = (sessionId,targetId)`): same target is FIFO, different targets can run concurrently up to the governor cap. `session-per-worker` remains the safest baseline for strict isolation. See [`docs/CLI.md`](docs/CLI.md) (Concurrency semantics) and [`skills/opendevbrowser-best-practices/artifacts/provider-workflows.md`](skills/opendevbrowser-best-practices/artifacts/provider-workflows.md) (Workflow E).

### Core Workflow (Plugin Tools)

| Step | Tool | Purpose |
|------|------|---------|
| 1 | `opendevbrowser_launch` | Launch a session (extension relay first; managed fallback is explicit) |
| 2 | `opendevbrowser_goto` | Navigate to URL |
| 3 | `opendevbrowser_review` | Inspect the active target and capture fresh actionables before acting |
| 4 | `opendevbrowser_click` / `opendevbrowser_type` | Interact with elements |
| 5 | `opendevbrowser_snapshot` | Re-capture refs after navigation or DOM changes |
| 6 | `opendevbrowser_disconnect` | Clean up session |

---

### CLI Automation Quick Start

Run a local daemon for persistent sessions, then drive automation via CLI commands:

```bash
# Start daemon
npx opendevbrowser serve

# Install auto-start (recommended for resilience)
opendevbrowser daemon install

# Stop/kill the daemon before restarting
npx opendevbrowser serve --stop

# Launch a session
npx opendevbrowser launch --start-url https://example.com

# Review the active target and capture fresh refs
npx opendevbrowser review --session-id <session-id>

# Interact by ref
npx opendevbrowser click --session-id <session-id> --ref r12
```

`opendevbrowser serve` includes stale-daemon preflight cleanup by default, so orphan daemon processes are terminated automatically
before startup while preserving the active daemon on the requested port.
If you are running from a temporary onboarding workspace, rerun `opendevbrowser daemon install` from a stable install location
before expecting auto-start to survive login.

For single-shot scripts:

```bash
npx opendevbrowser run --script ./script.json --output-format json
```

Use `--output-format json|stream-json` for automation-friendly output.

### Help-Led Discovery

Start every surface check from generated help when you need the current public lanes:

- Browser replay: `screencast-start`, `screencast-stop`
- Desktop observation: `desktop-status`, `desktop-windows`, `desktop-active-window`, `desktop-capture-desktop`, `desktop-capture-window`, `desktop-accessibility-snapshot`
- Browser-scoped computer use: `--challenge-automation-mode off|browser|browser_with_helper` governs bounded challenge handling for workflow and macro execute lanes; the optional helper remains browser-scoped and is not a desktop agent

## Challenge Handling Boundary

- `SessionStore` remains the blocker FSM source of truth. Managed and `/ops`-backed responses keep `meta.blocker`, `meta.blockerState`, and `meta.blockerResolution` stable and may append additive `meta.challenge` plus `meta.challengeOrchestration`.
- Direct browser, `/ops`, and provider fallback paths now share one bounded challenge orchestration plane. It can try auth navigation, legitimate session or cookie reuse, non-secret field fill, and bounded interaction exploration before yielding to a human.
- Workflow and manager callers can set `challengeAutomationMode` to `off`, `browser`, or `browser_with_helper`. Effective precedence is `run > session > config`, and hard gates still apply after resolution.
- The optional helper bridge is browser-scoped, not a desktop agent. `browser` forces it to stand down, and `browser_with_helper` only evaluates it after the existing helper hard gates pass.
- Shipped builds also expose a public read-only desktop observation plane under separate `desktop.*` config. It is enabled by default, does not widen `/ops` or `ChallengeRuntimeHandle`, and the internal composed path still routes desktop observation back through browser-owned review when challenge automation needs it.
- Browser fallback returns explicit transport `disposition` values: `completed`, `challenge_preserved`, `deferred`, or `failed`. When orchestration runs during fallback, decision evidence is recorded under `details.challengeOrchestration`.
- `ProviderRegistry` is the only durable anti-bot pressure authority. Shared runtime and policy own fallback ordering and resume policy; provider modules only contribute extraction logic and `recoveryHints()`.
- In scope: preserved sessions, normal browser controls, bounded interaction experimentation, human yield packets for secret or human-authority boundaries, and owned-environment fixtures that use vendor test keys only.
- Out of scope: hidden bypasses, CAPTCHA-solving services, token harvesting, or autonomous unsandboxed solving of third-party anti-bot systems.

---

## Recent Features

### v0.0.17 (Latest)

- **Design canvas runtime is now shipped end-to-end** across core, CLI, tool, relay, and extension surfaces, including `canvas.html`, overlay control, preview feedback, starter or inventory flows, Figma import, and repo-backed framework-adapter code sync.
- **Canvas token authoring and adapter-plugin validation are now first-class**: the extension token panel edits collections, modes, aliases, and bindings, while `scripts/canvas-competitive-validation.mjs` captures grouped evidence for adapters, token round-trip, inbox delivery, surface parity, and optional live Figma smoke.
- **Canvas surface governance and skill-pack coverage** now include current `/canvas` inventories, handshake/blocker templates, and feedback-evaluation artifacts.
- **Challenge automation override control is now first-class** across workflows and manager metadata via `challengeAutomationMode` (`off|browser|browser_with_helper`) with `run > session > config` precedence and a browser-scoped helper boundary.
- **Browser replay screencasts now ship as a manager-owned capture lane** with session-scoped `screencast-start`, `screencast-stop`, and replay artifacts rooted in the existing screenshot path (`replay.json`, `replay.html`, `frames/`, `preview.png`).
- **Desktop observation now ships as a public read-only CLI/tool plane** with separate `desktop.*` config, repo-local audit artifacts, and no public desktop agent or desktop `/ops` control plane.
- **Release packaging/docs were refreshed for v0.0.17**, including current tarball examples, extension version sync, release evidence, and public/private cutover guidance.

### v0.0.16

- **Release-gate hardening** with dedicated audit/compliance scripts (`audit-zombie-files`, `docs-drift-check`, `chrome-store-compliance-check`) and grouped release-gate tests.
- **Live direct-run release gates** across provider-by-provider and scenario-by-scenario scripts with explicit artifacts instead of broad matrix evidence.
- **CLI/runtime reliability fixes** including launch RPC timeout derivation from wait hints, bounded macro execute timeouts, and stale extension `/cdp` attach retry handling.
- **Version/distribution integrity checks** now enforce parity across `package.json`, `extension/manifest.json`, and `extension/package.json`.
- **Dependency and docs refresh** for v0.0.16 release readiness, onboarding parity, and public/private distribution operations.

### v0.0.15

- **Documentation and release readiness refresh** across README/CLI/extension guidance.
- **Extension mode stabilization** with stronger native host flow and recovery paths.
- **Ops/CDP hardening** for disconnect cleanup and extension routing reliability.
- **Coverage expansion** for browser/target/native workflows while preserving the 97% threshold.

### v0.0.14

- **Ops parity delivery** across daemon, relay, and extension runtime paths.
- **New automation surface**: expanded DOM query + interaction commands/tools.
- **Multi-client/session improvements** in core tracking and extension router behavior.
- **Security and reliability hardening** for relay + daemon connection handling.

See [CHANGELOG.md](CHANGELOG.md) for complete version history.

## Features

### Browser Control
- **Launch & Connect** - Start managed Chrome or connect to existing browsers
- **Multi-Tab Support** - Create, switch, and manage browser tabs
- **Profile Persistence** - Maintain login sessions across runs
- **Headless Mode** - Run without visible browser window

### Page Interaction
- **Snapshot** - Accessibility-tree based page capture (token-efficient)
- **Click** - Click elements by ref
- **Type** - Enter text into inputs
- **Select** - Choose dropdown options
- **Upload** - Send files to a file input or chooser by ref
- **Scroll** - Scroll page or elements
- **Wait** - Wait for selectors or navigation

### DevTools Integration
- **Console Capture** - Monitor console.log, errors, warnings
- **Network Tracking** - Request/response metadata (method, url, status)
- **Debug Trace Snapshot** - Combined page/console/network/exception diagnostics with blocker metadata
- **Screenshot** - Visible, ref-targeted, or full-page PNG capture (file or base64)
- **Dialog** - Inspect or handle JavaScript dialogs per target
- **Performance** - Page load metrics

### Session & Macro Utilities
- **Cookie Import** - Validate and import cookies into active sessions
- **Cookie List** - First-class cookie inspection with optional URL filters
- **Session Inspector** - Session-first diagnostics with relay health, trace proof, and a suggested next action
- **Macro Resolve/Execute** - Expand macro expressions into provider actions with optional execution

### Export & Clone
- **DOM Capture** - Extract sanitized HTML with inline styles
- **React Emitter** - Generate React component code from pages
- **CSS Extraction** - Pull computed styles

---

## Tool Reference

OpenDevBrowser provides **65 tools** organized by category:
Most runtime actions also have CLI command equivalents (see [docs/CLI.md](docs/CLI.md)).
Complete source-accurate inventory (tools + CLI + `/ops` + `/canvas` + `/cdp`): [docs/SURFACE_REFERENCE.md](docs/SURFACE_REFERENCE.md).
Terminal help now mirrors the generated public-surface manifest rooted at `src/public-surface/source.ts` and refreshed by `scripts/generate-public-surface-manifest.mjs`. `npx opendevbrowser --help` and `npx opendevbrowser help` both show every command with its usage and primary flags, every grouped CLI flag, and every bundled `opendevbrowser_*` tool with its CLI equivalent or tool-only scope.
See [docs/ASSET_INVENTORY.md](docs/ASSET_INVENTORY.md) for the brand and generated help/public-surface asset inventory used by packaging and website-sync flows.

### Session Management
| Tool | Description |
|------|-------------|
| `opendevbrowser_launch` | Launch a session (extension relay first; managed is explicit) |
| `opendevbrowser_connect` | Connect to existing Chrome CDP endpoint (or relay `/ops`; legacy `/cdp` via `--extension-legacy`) |
| `opendevbrowser_disconnect` | Disconnect browser session |
| `opendevbrowser_status` | Get session status and connection info (daemon status in hub mode) |
| `opendevbrowser_cookie_import` | Import validated cookies into the current session |
| `opendevbrowser_cookie_list` | List session cookies with optional URL filters |
| `opendevbrowser_session_inspector` | Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action |

### Tab/Target Management
| Tool | Description |
|------|-------------|
| `opendevbrowser_targets_list` | List all browser tabs/targets |
| `opendevbrowser_target_use` | Switch to a specific tab by targetId |
| `opendevbrowser_target_new` | Open new tab (optionally with URL) |
| `opendevbrowser_target_close` | Close a tab by targetId |

### Named Pages
| Tool | Description |
|------|-------------|
| `opendevbrowser_page` | Open or focus a named page (logical tab alias) |
| `opendevbrowser_list` | List all named pages in session |
| `opendevbrowser_close` | Close a named page |

### Navigation & Interaction
| Tool | Description |
|------|-------------|
| `opendevbrowser_goto` | Navigate to URL |
| `opendevbrowser_wait` | Wait for load state or element |
| `opendevbrowser_snapshot` | Capture page accessibility tree with refs |
| `opendevbrowser_review` | Capture target-aware actionables plus status context before acting |
| `opendevbrowser_click` | Click element by ref |
| `opendevbrowser_hover` | Hover element by ref |
| `opendevbrowser_press` | Press a keyboard key (optionally focusing a ref) |
| `opendevbrowser_check` | Check checkbox/toggle by ref |
| `opendevbrowser_uncheck` | Uncheck checkbox/toggle by ref |
| `opendevbrowser_type` | Type text into input by ref |
| `opendevbrowser_select` | Select dropdown option by ref |
| `opendevbrowser_scroll` | Scroll page or element |
| `opendevbrowser_scroll_into_view` | Scroll element into view by ref |
| `opendevbrowser_upload` | Upload files to a file input or chooser by ref |
| `opendevbrowser_pointer_move` | Move the pointer to viewport coordinates |
| `opendevbrowser_pointer_down` | Press a mouse button at viewport coordinates |
| `opendevbrowser_pointer_up` | Release a mouse button at viewport coordinates |
| `opendevbrowser_pointer_drag` | Drag between viewport coordinates |
| `opendevbrowser_run` | Execute multiple actions in sequence |

### DOM Inspection
| Tool | Description |
|------|-------------|
| `opendevbrowser_dom_get_html` | Get outerHTML of element by ref |
| `opendevbrowser_dom_get_text` | Get innerText of element by ref |
| `opendevbrowser_get_attr` | Get attribute value by ref |
| `opendevbrowser_get_value` | Get input value by ref |
| `opendevbrowser_is_visible` | Check if element is visible |
| `opendevbrowser_is_enabled` | Check if element is enabled |
| `opendevbrowser_is_checked` | Check if element is checked |

### DevTools & Analysis
| Tool | Description |
|------|-------------|
| `opendevbrowser_console_poll` | Poll console logs since sequence |
| `opendevbrowser_network_poll` | Poll network requests since sequence |
| `opendevbrowser_debug_trace_snapshot` | Capture a unified page + console + network + exception diagnostic bundle |
| `opendevbrowser_screenshot` | Capture page screenshot |
| `opendevbrowser_screencast_start` | Start a browser screencast replay capture |
| `opendevbrowser_screencast_stop` | Stop a browser screencast replay capture and return artifact metadata |
| `opendevbrowser_dialog` | Inspect or handle a JavaScript dialog |
| `opendevbrowser_perf` | Get page performance metrics |
| `opendevbrowser_prompting_guide` | Get best-practice prompting guidance |

### Desktop Observation
| Tool | Description |
|------|-------------|
| `opendevbrowser_desktop_status` | Inspect desktop observation availability and configured capabilities |
| `opendevbrowser_desktop_windows` | List observable desktop windows |
| `opendevbrowser_desktop_active_window` | Inspect the active desktop window |
| `opendevbrowser_desktop_capture_desktop` | Capture the current desktop surface |
| `opendevbrowser_desktop_capture_window` | Capture a specific desktop window |
| `opendevbrowser_desktop_accessibility_snapshot` | Capture desktop accessibility state |

### Macro Workflows
| Tool | Description |
|------|-------------|
| `opendevbrowser_macro_resolve` | Resolve macro expressions into provider action/provenance (optionally execute) |

### Annotation
| Tool | Description |
|------|-------------|
| `opendevbrowser_annotate` | Capture interactive annotations via direct (CDP) or relay transport |

### Design Canvas
| Tool | Description |
|------|-------------|
| `opendevbrowser_canvas` | Execute typed design-canvas session, attach, code-sync, preview, feedback, and overlay commands |

### Export & Cloning
| Tool | Description |
|------|-------------|
| `opendevbrowser_clone_page` | Export page as React component + CSS |
| `opendevbrowser_clone_component` | Export element subtree as React component |

### Skills
| Tool | Description |
|------|-------------|
| `opendevbrowser_skill_list` | List available skills before choosing a local workflow lane |
| `opendevbrowser_skill_load` | Load a skill by name and topic, especially the bundled quick start |

---

## Bundled Skills

OpenDevBrowser includes **9 OpenDevBrowser-specific skill packs**. Install, update, and uninstall own the managed skill lifecycle across OpenCode, Codex, ClaudeCode, and AmpCLI targets:

| Skill | Purpose |
|-------|---------|
| `opendevbrowser-best-practices` | Core prompting patterns and workflow guidance |
| `opendevbrowser-design-agent` | Contract-first, research-backed frontend and `/canvas` design execution |
| `opendevbrowser-continuity-ledger` | Long-running task state management |
| `opendevbrowser-login-automation` | Authentication flow patterns |
| `opendevbrowser-form-testing` | Form validation and submission workflows |
| `opendevbrowser-data-extraction` | Structured data scraping patterns |
| `opendevbrowser-research` | Deterministic multi-source research workflows |
| `opendevbrowser-shopping` | Deterministic multi-provider deal comparison workflows |
| `opendevbrowser-product-presentation-asset` | Product screenshot/copy asset collection for presentation pipelines |

Installer note:
- `--skills-global` and `--skills-local` sync the 9 canonical `opendevbrowser-*` packs into managed global or project-local agent directories.
- Reinstall and update refresh drifted managed copies and leave matching packs unchanged.
- Uninstall removes managed canonical packs and only prunes legacy `research` or `shopping` leftovers when those directories are empty and clearly obsolete.

Skills are discovered from (priority order):
1. `.opencode/skill/` (project)
2. `~/.config/opencode/skill/` (global)
3. `.codex/skills/` (project compatibility)
4. `$CODEX_HOME/skills` (global compatibility; fallback `~/.codex/skills`)
5. `.claude/skills/` (ClaudeCode project compatibility)
6. `$CLAUDECODE_HOME/skills` or `$CLAUDE_HOME/skills` (ClaudeCode global compatibility; fallback `~/.claude/skills`)
7. `.amp/skills/` (AmpCLI project compatibility)
8. `$AMPCLI_HOME/skills` or `$AMP_CLI_HOME/skills` or `$AMP_HOME/skills` (AmpCLI global compatibility; fallback `~/.amp/skills`)
9. Custom paths via `skillPaths` config
10. Bundled package fallback: packaged `skills/` directory after `skillPaths` when no installed copy matches

Load a skill: `opendevbrowser_skill_load` with `name` and optional `topic` filter.
`opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, and `opendevbrowser_skill_load` are local onboarding helpers, so they do not require a browser session, relay, or daemon bootstrap.

---

## Browser Modes

| Mode | Tool | Use Case |
|------|------|----------|
| **Managed** | `opendevbrowser_launch` | Fresh browser, full control, automatic cleanup |
| **CDP Connect** | `opendevbrowser_connect` | Attach to existing Chrome with `--remote-debugging-port` |
| **Extension Relay** | Chrome Extension | Attach to logged-in tabs via relay server |

Default behavior: `opendevbrowser_launch` prefers **Extension Relay** when available. Use `--no-extension` (and `--headless` if desired) for managed sessions.

Extension relay relies on **flat CDP sessions (Chrome 125+)** and uses DebuggerSession `sessionId` routing for multi-tab and child-target support. When hub mode is enabled, the hub daemon is the sole relay owner and there is **no local relay fallback**.

Relay ops endpoint: `ws://127.0.0.1:<relayPort>/ops`.
The connect command also accepts base relay WS URLs (`ws://127.0.0.1:<relayPort>` or `ws://localhost:<relayPort>`) and normalizes them to `/ops`.
Relay canvas endpoint: `ws://127.0.0.1:<relayPort>/canvas` for design-canvas editor, session attach/lease flow, code-sync, preview, public feedback pull streams, and overlay flows.
Legacy relay `/cdp` remains available with explicit opt-in (`--extension-legacy`).
When pairing is enabled, `/ops`, `/canvas`, and `/cdp` require a relay token (`?token=<relayToken>`). Tools and the CLI auto-fetch relay config and tokens.

## Relay Channels

| Channel | What It Does | When to Use It |
|---------|---------------|----------------|
| **`/ops` (default)** | High-level automation protocol with session ownership, event streaming, and multi-client handling | Preferred extension relay path for modern workflows |
| **`/canvas`** | Typed design-canvas protocol for session handshakes/attach, Figma document import, reusable inventory list/insert, built-in starter list/apply flows, framework-adapter-backed code sync, preview tabs, public feedback pull streams, and overlay selection | Use with `opendevbrowser_canvas` or `opendevbrowser canvas` during design-canvas workflows |
| **`/cdp` (legacy)** | Low-level CDP relay path with compatibility-focused behavior | Opt-in compatibility mode (`--extension-legacy`) |
| **Direct CDP connect** | Attach to Chrome started with `--remote-debugging-port` | Existing debug/browser setups without extension relay |

For full `/ops` and `/canvas` command names, `/cdp` envelope details, and mode/flag matrices, see [docs/SURFACE_REFERENCE.md](docs/SURFACE_REFERENCE.md).

---

## Breaking Changes (latest)

- `opendevbrowser_launch` now prefers the extension relay by default. Use `--no-extension` (and `--headless` if desired) for managed sessions.
- Relay `/ops` (default) and legacy `/cdp` both require a token when pairing is enabled; tools/CLI handle this automatically.

## Chrome Extension (Optional)

The extension enables **Extension Relay** mode - attach to existing logged-in browser tabs without launching a new browser.

**Requirements:** Chrome 125+ (flat CDP sessions). Older versions will fail fast with a clear error.

### Auto-Connect + Auto-Pair

The runtime (plugin or CLI daemon) and extension can automatically pair:

1. **Runtime side**: Starts a local relay server and config discovery endpoint
2. **Extension side**: Enable "Auto-Pair" toggle and click Connect
3. Extension fetches relay port from discovery, then fetches token from the relay server
4. Connection established with color indicator (green = connected)

**Auto-connect** and **Auto-pair** are enabled by default for a seamless setup. The extension badge shows a small status dot (green = connected, red = disconnected).
If the relay is unavailable, the background worker retries `/config` + `/pair` with exponential backoff (using `chrome.alarms`).

### Default Settings (Extension)

| Setting | Default |
|---------|---------|
| Relay port | `8787` |
| Auto-connect | `true` |
| Auto-pair | `true` |
| Require pairing token | `true` |
| Pairing token | `null` (fetched on connect) |

### Connection Flow (Extension Relay)

1. Extension checks the discovery endpoint at `http://127.0.0.1:8787/config`.
2. It learns the relay port and whether pairing is required.
3. If pairing is required and Auto-pair is on, it fetches the token from `http://127.0.0.1:<relayPort>/pair`.
4. It connects to `ws://127.0.0.1:<relayPort>/extension` using the extension origin.

`/config` and `/pair` accept loopback requests with no `Origin` (including `Origin: null`) to support MV3 + PNA; non-extension origins are still rejected, and preflights include `Access-Control-Allow-Private-Network: true`.

### Troubleshooting: Extension Won't Connect

- Ensure the active tab is a normal `http(s)` page (not `chrome://` or extension pages).
- Confirm `relayPort` and `relayToken` in `~/.config/opencode/opendevbrowser.jsonc` match the popup (Auto-pair should fetch the token).
- If `relayPort` is `0`, the relay is off.
- `relayToken: false` disables relay/hub behavior entirely.
- `relayToken: ""` (empty string) keeps relay enabled but disables pairing requirements.
- Install auto-start with `opendevbrowser daemon install` from a stable install location so the relay is available on login.
- Clear extension local data and retry if the token/port seem stuck.
- If another process owns the port, change `relayPort` or stop it; `opencode` listening is expected.

### Manual Setup

1. Ensure extension assets exist by running either:
   - `npx opendevbrowser --full` (installer path), or
   - `npm run extension:build` (repo/dev path)
2. Load unpacked from `~/.config/opencode/opendevbrowser/extension`
   (fallback: `~/.cache/opencode/node_modules/opendevbrowser/extension`).
3. Open extension popup
4. Enter the same relay port and token as the runtime config
   (if `relayToken` is missing, either add one to `opendevbrowser.jsonc` or use Auto-Pair).
5. Click Connect

### Where Extension Assets Live

Extension assets are bundled inside the NPM package and extracted on install/startup:

- Primary: `~/.config/opencode/opendevbrowser/extension`
- Fallback: `~/.cache/opencode/node_modules/opendevbrowser/extension`

Extraction is handled by `extractExtension()` (see `src/extension-extractor.ts`).

---

## Configuration

Optional config file: `~/.config/opencode/opendevbrowser.jsonc`

```jsonc
{
  // Browser settings
  "headless": false,
  "profile": "default",
  "persistProfile": true,
  "chromePath": "/path/to/chrome",  // Custom Chrome executable
  "flags": ["--disable-extensions"],  // Additional Chrome flags

  // Snapshot limits
  "snapshot": { "maxChars": 16000, "maxNodes": 1000 },

  // Export limits
  "export": { "maxNodes": 1000, "inlineStyles": true },

  // DevTools output
  "devtools": { "showFullUrls": false, "showFullConsole": false },

  // Security (all default false for safety)
  "security": {
    "allowRawCDP": false,
    "allowNonLocalCdp": false,
    "allowUnsafeExport": false
  },

  // Provider workflow cookie defaults (optional)
  "providers": {
    "cookiePolicy": "auto",
    "cookieSource": {
      "type": "file",
      "value": "~/.config/opencode/opendevbrowser.provider-cookies.json"
    },
    "challengeOrchestration": {
      "mode": "browser_with_helper",
      "optionalComputerUseBridge": {
        "enabled": true
      }
    }
  },

  // Public read-only sibling desktop observation runtime (enabled by default; set "off" to opt out)
  "desktop": {
    "permissionLevel": "observe",
    "commandTimeoutMs": 10000,
    "auditArtifactsDir": ".opendevbrowser/desktop-runtime",
    "accessibilityMaxDepth": 2,
    "accessibilityMaxChildren": 25
  },

  // Skills configuration
  "skills": {
    "nudge": {
      "enabled": true,
      "keywords": ["form", "login", "extract", "scrape"],
      "maxAgeMs": 60000
    }
  },
  "skillPaths": ["./custom-skills"],  // Additional skill directories

  // Continuity ledger
  "continuity": {
    "enabled": true,
    "filePath": "opendevbrowser_continuity.md",
    "nudge": {
      "enabled": true,
      "keywords": ["plan", "multi-step", "refactor", "migration"],
      "maxAgeMs": 60000
    }
  },

  // Extension relay
  "relayPort": 8787,
  "relayToken": "auto-generated-on-first-run",

  // Hub daemon (relay ownership + FIFO queue)
  "daemonPort": 8788,
  "daemonToken": "auto-generated-on-first-run",

  // Updates
  "checkForUpdates": false
}
```

All fields are optional. OpenDevBrowser works with sensible defaults.

---

## CLI Commands

The CLI is agent-agnostic and supports the full automation surface (session, navigation, interaction, DOM, browser capture and replay, desktop observation, targets, pages, export, devtools, annotate, and canvas).
All commands listed in the CLI reference are implemented and available in the current codebase.
See [docs/CLI.md](docs/CLI.md) for the full command and flag matrix.
See [docs/SURFACE_REFERENCE.md](docs/SURFACE_REFERENCE.md) for the source-accurate inventory matrix (72 CLI commands, 65 tools, `/ops`, `/canvas`, and `/cdp` channel contracts).

### CLI Category Matrix (core command groups)

| Category | Commands |
|---------|----------|
| Install/runtime | `install`, `update`, `uninstall`, `help`, `version`, `serve`, `daemon`, `native`, `run` |
| Session/connection | `launch`, `connect`, `disconnect`, `status`, `cookie-import`, `cookie-list` |
| Navigation | `goto`, `wait`, `snapshot` |
| Interaction | `click`, `hover`, `press`, `check`, `uncheck`, `type`, `select`, `scroll`, `scroll-into-view`, `upload`, `pointer-move`, `pointer-down`, `pointer-up`, `pointer-drag` |
| Targets/pages | `targets-list`, `target-use`, `target-new`, `target-close`, `page`, `pages`, `page-close` |
| DOM | `dom-html`, `dom-text`, `dom-attr`, `dom-value`, `dom-visible`, `dom-enabled`, `dom-checked` |
| Browser capture | `screenshot`, `screencast-start`, `screencast-stop` |
| Desktop observation | `desktop-status`, `desktop-windows`, `desktop-active-window`, `desktop-capture-desktop`, `desktop-capture-window`, `desktop-accessibility-snapshot` |
| Design canvas | `canvas` |
| Export/diagnostics/macro/annotation/power | `clone-page`, `clone-component`, `perf`, `dialog`, `console-poll`, `network-poll`, `debug-trace-snapshot`, `session-inspector`, `macro-resolve`, `annotate`, `rpc` |

### Install/Management

| Command | Description |
|---------|-------------|
| `npx opendevbrowser` | Interactive install |
| `npx opendevbrowser --global` | Install to global config |
| `npx opendevbrowser --local` | Install to project config |
| `npx opendevbrowser --with-config` | Also create opendevbrowser.jsonc |
| `npx opendevbrowser --full` | Full install (config + extension assets) |
| `npm install -g opendevbrowser` | Install persistent global CLI |
| `npx opendevbrowser --update` | Clear cache, trigger reinstall |
| `npx opendevbrowser --uninstall` | Remove from config |
| `npx opendevbrowser --version` | Show version |

### Common Automation Commands (Daemon-backed)

Start the daemon with `npx opendevbrowser serve`, then use:

| Command | Description |
|---------|-------------|
| `npx opendevbrowser launch` | Launch session (defaults to extension mode when available) |
| `npx opendevbrowser connect` | Connect via relay or direct CDP endpoint |
| `npx opendevbrowser disconnect` | Disconnect session |
| `npx opendevbrowser status` | Show session status |
| `npx opendevbrowser session-inspector --session-id <id>` | Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action |
| `npx opendevbrowser goto` | Navigate to URL |
| `npx opendevbrowser wait` | Wait for load or element |
| `npx opendevbrowser snapshot` | Capture snapshot with refs |
| `npx opendevbrowser click` | Click element by ref |
| `npx opendevbrowser type` | Type into element by ref |
| `npx opendevbrowser select` | Select dropdown option by ref |
| `npx opendevbrowser scroll` | Scroll page or element |
| `npx opendevbrowser run` | Run a JSON script |
| `npx opendevbrowser canvas --command canvas.session.open --params '{...}'` | Start or continue a design-canvas workflow through the daemon |
| `npx opendevbrowser macro-resolve --expression '@media.search("youtube transcript parity", "youtube", 5)' --execute --timeout-ms 120000` | Execute macro plans with extended timeout for slow runs |

Workflow cookie controls (`research run`, `shopping run`, `product-video run`):
- Defaults come from `providers.cookiePolicy` (`off|auto|required`) and `providers.cookieSource` (`file|env|inline`).
- Per-run overrides: `--use-cookies`, `--cookie-policy-override` (alias `--cookie-policy`).
- `auto` is non-blocking when cookies are unavailable; `required` fails fast with `reasonCode=auth_required`.

Workflow challenge controls (`research run`, `shopping run`, `product-video run`):
- Per-run override: `--challenge-automation-mode off|browser|browser_with_helper`, which maps to `challengeAutomationMode`.
- Effective precedence is `run > session > config`.
- `off` keeps detection and reporting active but stands down challenge actions.
- `browser` allows browser-native lanes only and keeps the helper bridge disabled.
- `browser_with_helper` keeps browser-native lanes first and evaluates the browser-scoped helper bridge second when hard gates pass.
- The helper bridge remains browser-scoped and is not a desktop agent.

---

## Security

OpenDevBrowser is **secure by default** with defense-in-depth protections:

| Protection | Details |
|------------|---------|
| **CDP Localhost-Only** | Remote endpoints blocked; hostname normalized to prevent bypass |
| **Timing-Safe Auth** | `crypto.timingSafeEqual()` for token comparison |
| **Origin Validation** | `/extension` requires `chrome-extension://` origin; `/ops`, `/canvas`, `/cdp`, `/annotation`, and `/config`/`/status`/`/pair` allow loopback no-Origin requests |
| **PNA Preflights** | HTTP preflights include `Access-Control-Allow-Private-Network: true` when requested |
| **Rate Limiting** | 5 handshake attempts/minute per IP, plus HTTP rate limiting for `/config`, `/status`, `/pair` |
| **Data Redaction** | Tokens, API keys, sensitive paths auto-redacted |
| **Export Sanitization** | Scripts, event handlers, dangerous CSS stripped |
| **Atomic Writes** | Config writes are atomic to prevent corruption |
| **Secure Defaults** | `allowRawCDP`, `allowNonLocalCdp`, `allowUnsafeExport` all `false` |

---

## Updating

```bash
# Option 1: Clear cache (recommended)
rm -rf ~/.cache/opencode/node_modules/opendevbrowser
# Then restart OpenCode

# Option 2: Use CLI
npx opendevbrowser --update
```

Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
Release checklist: [docs/DISTRIBUTION_PLAN.md](docs/DISTRIBUTION_PLAN.md)
Documentation index: [docs/README.md](docs/README.md)
Frontend docs: [docs/FRONTEND.md](docs/FRONTEND.md)
Dependency inventory: [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)
Local-only generated artifacts such as `prompt-exports/`, root `artifacts/`, `coverage/`, `CONTINUITY*.md`, and `sub_continuity.md` stay uncommitted; `.gitignore` is authoritative.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Distribution Layer                         │
├──────────────────┬──────────────────┬──────────────────┬──────────────────────────┤
│  OpenCode Plugin │       CLI        │    Hub Daemon    │    Chrome Extension       │
│  (src/index.ts)  │ (src/cli/index)  │ (opendevbrowser  │   (extension/src/)        │
│                  │                  │      serve)     │                           │
└────────┬─────────┴────────┬─────────┴─────────┬────────┴──────────────┬────────────┘
         │                  │                  │                       │
         ▼                  ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Core Runtime (src/core/)                    │
│  bootstrap.ts → wires managers, sibling desktop runtime,       │
│                   automation coordinator, injects ToolDeps     │
└────────┬────────────────────────────────────────────────────────┘
         │
    ┌────┴────┬─────────────┬──────────────┬──────────────┬──────────────┐
    ▼         ▼             ▼              ▼              ▼              ▼
┌────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│Browser │ │Script  │ │Snapshot  │ │ Annotation │ │  Relay     │ │  Skills    │
│Manager │ │Runner  │ │Pipeline  │ │  Manager   │ │  Server    │ │  Loader    │
└───┬────┘ └────────┘ └──────────┘ └────────────┘ └─────┬──────┘ └────────────┘
    │                                                  │
    ▼                                                  ▼
┌────────┐                                        ┌────────────┐
│Target  │                                        │ Extension  │
│Manager │                                        │ (WS relay) │
└────────┘                                        └────────────┘
```

The simplified map above omits the dedicated Challenge Coordinator, Desktop Runtime, and Automation Coordinator that now sit beside the browser managers; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full component map and ownership boundaries.

### Data Flow

```
Tool Call → Zod Validation → Manager/Runner → CDP/Playwright → Response
                                   ↓
                            Snapshot (AX-tree → refs)
                                   ↓
                            Action (ref → backendNodeId → DOM)
```

### System Workflow (Happy Path)

1. `launch` (extension or managed) -> `sessionId`
2. `snapshot` -> refs
3. Action commands (`click`, `type`, `press`, `hover`, `check`, etc.) -> repeat snapshot
4. `disconnect` on completion

### Repository Layout

```
.
├── src/              # Plugin implementation
│   ├── annotate/     # Annotation transports + output shaping
│   ├── automation/    # Automation helpers and coordinator
│   ├── browser/      # Browser sessions, target orchestration, canvas preview/code-sync
│   ├── cache/        # Chrome executable resolution
│   ├── canvas/       # Design-canvas document store, repo IO, code-sync, export helpers
│   ├── challenges/   # Bounded challenge orchestration plane, evidence, recovery lanes
│   ├── cli/          # CLI commands, daemon, installers
│   ├── core/         # Bootstrap, runtime wiring, ToolDeps
│   ├── desktop/      # Read-only desktop observation runtime
│   ├── devtools/     # Console/network trackers with redaction
│   ├── export/       # DOM capture, React emitter, CSS extraction
│   ├── integrations/ # External integration adapters (Figma import, etc.)
│   ├── macros/       # Macro parsing, resolution, provider-action expansion
│   ├── providers/    # Provider runtime, policy, workflows, browser fallback
│   ├── public-surface/ # Generated manifest source, CLI/tool metadata
│   ├── relay/        # Extension relay server, protocol types
│   ├── skills/       # SkillLoader for skill pack discovery
│   ├── snapshot/     # AX-tree snapshots, ref management
│   ├── tools/        # 65 opendevbrowser_* tool definitions
│   └── utils/        # Shared utilities
├── extension/        # Chrome extension (relay client)
├── scripts/          # Operational scripts (build/sync/smoke)
├── skills/           # Bundled skill directories (11 total; 9 canonical OpenDevBrowser packs + 2 shared compatibility packs)
├── tests/            # Vitest tests (97% coverage required)
└── docs/             # Architecture, CLI, extension, distribution plans
```

Extension relay uses flat CDP sessions (Chrome 125+) with DebuggerSession `sessionId` routing for multi-tab support. When hub mode is enabled, the hub daemon is the sole relay owner and enforces a FIFO lease queue for multi-client safety. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture reference.

---

## Development

```bash
npm install
npm run build      # Compile to dist/
npm run test       # Run tests with coverage (97% threshold)
npm run lint       # ESLint checks (strict TypeScript)
npm run extension:build  # Compile extension
npm run version:check    # Verify package/extension version alignment
npm run extension:pack   # Build extension zip for releases
```

### Packaging & Distribution (Public + Private)

Uniform versioning is required (source of truth: `package.json`):

1. Bump `package.json` version.
2. Run: `npm run extension:sync`
3. Run: `npm run version:check`
4. Run: `npm run test:release-gate`
5. Run: `npm run build`
6. Run: `npm run extension:build`
7. Run release audits:
   - `node scripts/audit-zombie-files.mjs`
   - `node scripts/docs-drift-check.mjs`
   - `node scripts/chrome-store-compliance-check.mjs`
   - `./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
8. Run strict live release gates:
   - `node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/vX.Y.Z/provider-direct-runs.json`
   - `node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/vX.Y.Z/live-regression-direct.json`
9. Run first-time global install dry run checklist from `docs/FIRST_RUN_ONBOARDING.md`.
10. Run: `npm run extension:pack` (outputs `./opendevbrowser-extension.zip`)
11. Run: `npm pack`
12. Tag `vX.Y.Z` and let `.github/workflows/release-public.yml` publish npm + GitHub release artifacts.
13. Dispatch website content sync to private repo through `.github/workflows/dispatch-private-sync.yml`.

Runbooks:
- `docs/DISTRIBUTION_PLAN.md`
- `docs/RELEASE_RUNBOOK.md`
- `docs/EXTENSION_RELEASE_RUNBOOK.md`
- `docs/CUTOVER_CHECKLIST.md`

---

## Privacy

See [Privacy Policy](docs/privacy.md) for data handling details.

---

## License

MIT
