# OpenDevBrowser

[![npm version](https://img.shields.io/npm/v/opendevbrowser.svg?style=flat-square)](https://registry.npmjs.org/opendevbrowser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![OpenCode Tool Calls](https://img.shields.io/badge/OpenCode-Tool_Calls-green.svg?style=flat-square)](https://opencode.ai)
[![CLI](https://img.shields.io/badge/Interface-CLI-orange.svg?style=flat-square)](docs/CLI.md)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg?style=flat-square)](docs/EXTENSION.md)
[![Test Coverage](https://img.shields.io/badge/coverage-97%25-brightgreen.svg?style=flat-square)](https://registry.npmjs.org/opendevbrowser)

> **Script-first browser automation for AI agents.** Snapshot → Refs → Actions.

OpenDevBrowser is an agent-agnostic browser automation runtime for CLI workflows, [OpenCode](https://opencode.ai) tool calls, and Chrome extension relay sessions. It supports managed launches, direct CDP attach, and extension-backed Ops sessions.

The current public surface includes [77 CLI commands and 70 `opendevbrowser_*` tools](docs/SURFACE_REFERENCE.md); see [docs/CLI.md](docs/CLI.md) for the operational command guide.
Generated help is the canonical first-contact discovery surface: `npx opendevbrowser --help` and `npx opendevbrowser help` now lead with a `Find It Fast` block that uses the exact lookup terms `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`.
Shipped builds include Browser replay through `screencast-start` or `screencast-stop` and a separate public read-only desktop observation plane through the `desktop-*` family; those lanes stay explicit, browser-scoped where applicable, and make it clear this is not a desktop agent.

<p align="center">
  <img src="assets/hero-image.png" alt="OpenDevBrowser hero image showing AI-assisted annotation and browser automation workflow" width="920" />
  <br />
  <em>AI-assisted annotation and browser automation workflow</em>
</p>

## Table of Contents

|  |  |  |  |
|---|---|---|---|
| [Use It Your Way](#use-it-your-way) | [Why OpenDevBrowser?](#why-opendevbrowser) | [Installation](#installation) | [Quick Start](#quick-start) |
| [Challenge Handling Boundary](#challenge-handling-boundary) | [Features](#features) | [Tool Reference](#tool-reference) | [Bundled Skills](#bundled-skills) |
| [Browser Modes](#browser-modes) | [Relay Channels](#relay-channels) | [Breaking Changes (latest)](#breaking-changes-latest) | [Chrome Extension (Optional)](#chrome-extension-optional) |
| [Configuration](#configuration) | [CLI Commands](#cli-commands) | [Security](#security) | [Updating](#updating) |
| [Architecture](#architecture) | [Development](#development) | [Privacy](#privacy) | [License](#license) |

## Use It Your Way

| Interface | OpenCode Required | Best For |
|-----------|-------------------|----------|
| **CLI (`npx opendevbrowser ...`)** | No | Any agent/workflow that can run shell commands |
| **Chrome Extension + Relay** | No | Reusing existing logged-in tabs without launching a new browser |
| **OpenCode Tool Calls** | Yes | Native tool-calling inside OpenCode (`opendevbrowser_*`) |
| **Frontend Website (private repo)** | No | Product website and generated docs routes |

The public repo owns the automation runtime and canonical docs; see [docs/SURFACE_REFERENCE.md](docs/SURFACE_REFERENCE.md) for the full surface inventory.

## Why OpenDevBrowser?

- **Script-first automation model**: snapshot → refs → actions, built around accessibility-tree capture instead of brittle selector-first workflows.
- **Stable interaction primitives**: refs resolve through `backendNodeId`, and low-level pointer commands remain available when normal DOM actions are not enough.
- **Flexible session control**: run managed sessions, attach through direct CDP, or reuse logged-in tabs through the extension relay and `/ops`.
- **Design and review workflows**: use Inspiredesign harvest, design canvas, shared annotation inbox, and repo-backed code-sync flows without leaving the runtime surface. Pinterest broad-query readiness is driven by byte-backed first-party `pin-media-index.json` authority; `media-analysis.json` is advisory and `motion-evidence.json` is browser replay authority.
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

### Local Package Validation

Use this flow to validate first-run onboarding from a source tarball without relying on the published registry package.

```bash
cd <public-repo-root>
npm pack

WORKDIR=$(mktemp -d /tmp/opendevbrowser-first-run-XXXXXX)
ISOLATED_ROOT=$(mktemp -d /tmp/opendevbrowser-first-run-isolated-XXXXXX)
export HOME="$ISOLATED_ROOT/home"
export OPENCODE_CONFIG_DIR="$ISOLATED_ROOT/opencode-config"
export OPENCODE_CACHE_DIR="$ISOLATED_ROOT/opencode-cache"
export CODEX_HOME="$ISOLATED_ROOT/codex-home"
export CLAUDECODE_HOME="$ISOLATED_ROOT/claudecode-home"
export AMP_CLI_HOME="$ISOLATED_ROOT/ampcli-home"
cd "$WORKDIR"
npm init -y
npm install <public-repo-root>/opendevbrowser-0.0.37.tgz
npx --no-install opendevbrowser --help
npx --no-install opendevbrowser help
```

Published npm consumer proof is tracked separately in [docs/RELEASE_RUNBOOK.md](docs/RELEASE_RUNBOOK.md) through `scripts/registry-consumer-smoke.mjs`.

Set `OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1` before `npm install` only if you need a packaging smoke test that exits the legacy package lifecycle shim before built postinstall code imports. Set `OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION=1` when you only want to skip install-time daemon auto-start reconciliation.

See [docs/FIRST_RUN_ONBOARDING.md](docs/FIRST_RUN_ONBOARDING.md) for the full onboarding checklist, [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) for runtime inventory, and [docs/SURFACE_REFERENCE.md](docs/SURFACE_REFERENCE.md) for the live CLI and tool surface.

CLI/plugin installs still reconcile daemon auto-start on supported platforms after successful install so the relay is available on login. Raw npm global package postinstall also best-effort reconciles auto-start when npm lifecycle context clearly indicates a global install. Local, ambiguous, conflicting, or non-npm package-manager contexts skip package postinstall auto-start without failing package installation.

Package postinstall auto-start targets the packaged CLI entrypoint `dist/cli/index.js`, not the lifecycle shim at `scripts/postinstall-sync-skills.mjs`. `src/cli/daemon-autostart.ts` owns platform safety and refuses to persist `_npx`, `/tmp`, `/private/tmp`, or onboarding workspace paths before writing LaunchAgent or Task Scheduler state. Package postinstall warnings are non-fatal; repair with `opendevbrowser daemon install`, inspect with `opendevbrowser daemon status`, or remove with `opendevbrowser daemon uninstall`.

Bundled skills sync to **OpenCode, Codex, ClaudeCode, and AmpCLI** targets during install. `npx opendevbrowser` manages global or project-local targets according to the selected skills mode, and package installation (`npm install -g`, local tarball install, or equivalent) best-effort syncs the canonical bundled packs into the managed global targets during package `postinstall`. See [docs/CLI.md](docs/CLI.md) for exact target paths.

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

### OpenCode Tool-Call Installation

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

# Preflight daemon-backed workflows
npx opendevbrowser status --daemon --output-format json
# Proceed only when data.fingerprintCurrent === true

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
before startup while preserving the active daemon on the requested port. For daemon-backed workflows, run
`npx opendevbrowser status --daemon --output-format json` first and require `data.fingerprintCurrent === true` before issuing
launch, connect, canvas, provider, or release-harness commands.

If protected stop or reuse fails with `daemon_fingerprint_mismatch`, the running daemon was started by a different OpenDevBrowser
build than the current CLI. Use the matching binary for the running daemon, restart it from the current install, or isolate shared
environments with `OPENCODE_CONFIG_DIR`, `OPENCODE_CACHE_DIR`, and unique daemon or relay ports before retrying.

If you are running from a temporary onboarding workspace, rerun `opendevbrowser daemon install` from a stable install location
before expecting auto-start to survive login. macOS auto-start also writes `WorkingDirectory=~/.cache/opendevbrowser`
so launchd does not start the daemon from `/`.

For single-shot scripts:

```bash
npx opendevbrowser run --script ./script.json --output-format json
```

Use `--output-format json|stream-json` for automation-friendly output.

### Help-Led Discovery

Start every surface check from generated help when you need the current public lanes. The terminal help now uses these exact phrases so agents can search by intent instead of guessing command names:

- `screencast / browser replay`: `screencast-start`, `screencast-stop`
- `desktop observation`: `desktop-status`, `desktop-windows`, `desktop-active-window`, `desktop-capture-desktop`, `desktop-capture-window`, `desktop-accessibility-snapshot`
- `computer use / browser-scoped computer use`: `--challenge-automation-mode off|browser|browser_with_helper` on `research run`, `shopping run`, `product-video run`, `inspiredesign run`, and `macro-resolve --execute`; start with `npx opendevbrowser research run --topic "account recovery flow" --sources web,community --challenge-automation-mode browser --mode json --output-format json` when you need the first entry point, and use `review` plus `session-inspector` as the quickest proof surfaces while the optional helper stays browser-scoped rather than becoming a desktop agent

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


## Features

### Browser and Session Control
- **Managed, CDP, and extension sessions** - Launch fresh browser sessions, attach to existing Chrome CDP endpoints, or reuse logged-in tabs through the extension relay and `/ops`.
- **Target-aware tab management** - List, open, focus, switch, and close targets or named pages while preserving target-scoped FIFO execution for same-tab work.
- **Session diagnostics and cookies** - Inspect status, capabilities, relay health, cookies, blocker state, and suggested next actions before running long workflows.
- **Persistent profiles when appropriate** - Reuse browser state intentionally through configured profiles, system Chrome cookie import, extension tabs, or explicit provider cookie policy.

### Ref-Based Page Interaction and DOM Inspection
- **Snapshot to refs to actions** - Capture accessibility-tree snapshots, review actionables, then click, type, select, upload, scroll, press, hover, check, or drag by stable refs.
- **Backend-node resolution** - Refs resolve through browser-owned node identity so agents can avoid brittle selector-first automation when the page changes.
- **DOM and state inspection** - Read HTML, text, attributes, input values, visibility, enabled state, and checked state for precise automation decisions.
- **Pointer and keyboard escape hatches** - Use viewport pointer commands and key presses when a page needs lower-level browser interaction.

### Diagnostics, Screenshots, and Browser Replay
- **Console and network polling** - Capture console messages, exceptions, request metadata, status codes, and page performance without leaving the runtime.
- **Debug trace snapshots** - Combine page, console, network, exception, blocker, and session context into one diagnostic bundle.
- **Screenshots** - Capture visible, full-page, or ref-targeted PNG evidence to files or automation-friendly JSON payloads.
- **Screencast / browser replay** - Use `screencast-start` and `screencast-stop` for browser replay artifacts; these artifacts are separate from annotation storage.

### Public Read-Only Desktop Observation and Browser-Scoped Helper Boundary
- **Desktop observation** - The `desktop-*` family exposes public read-only macOS observation for window inventory, active-window context, screenshots, and accessibility snapshots.
- **No desktop agent** - Desktop observation does not widen `/ops`, does not control the desktop, and does not turn OpenDevBrowser into a desktop agent.
- **Browser-scoped computer use** - Challenge automation modes stay browser-scoped: `off`, `browser`, or `browser_with_helper` on provider workflows and executable macros.
- **Human-authority boundaries** - Secret entry, CAPTCHA solving, token harvesting, and unsandboxed third-party anti-bot bypasses remain out of scope.

### Provider Workflows, Macros, and Artifact Bundles
- **Deterministic workflow lanes** - Run research, shopping, product-video, and Inspiredesign workflows with JSON, Markdown, compact, path, or context output modes.
- **Artifact-first handoff** - Successful artifact-bearing workflows return `artifact_path`; omitted routine workflow output roots write under `.opendevbrowser/<namespace>/<runId>`.
- **Provider policy and recovery** - Provider registry, challenge orchestration, cookie policy, and fallback ordering preserve blocker truth and recovery hints.
- **Macros** - Resolve or execute macro expressions into provider actions with provenance and blocked-run truth preserved in execution reports.

### Inspiredesign and Pinterest Readiness Authority
- **Pinterest-ready design research** - Inspiredesign harvest can rank references, persist evidence, and produce design handoff artifacts from browser-backed runs.
- **Pin-media-first authority** - Pinterest readiness is product-ready only when `pin-media-index.json` contains byte-backed first-party media evidence for accepted canonical pins.
- **Advisory media analysis** - `media-analysis.json` supplies optional FFmpeg or FFprobe cues but never replaces pin-media authority.
- **Motion authority stays separate** - `motion-evidence.json` is browser replay authority; missing screenshots or motion evidence can be non-blocking only when pin-media authority is complete.

### Design Canvas, Workspace, and Code Sync
- **Typed Canvas commands** - Use `/canvas` or `opendevbrowser_canvas` for design-canvas sessions, imports, reusable inventory, starters, previews, feedback, overlays, and handoff.
- **Workspace orchestration** - Canvas coordinates refs-only parent workflows while child sessions own documents, leases, bound sources, previews, and feedback loops.
- **Framework adapter code sync** - Built-in lanes include React TSX v2, static HTML, custom elements, Vue SFC, and Svelte SFC bindings with repo-local manifests.
- **Projection boundaries** - `canvas_html` remains the default preview and export contract unless a binding opts into `bound_app_runtime` after runtime bridge preflight.

### Annotation V2 Compact Handoff and Shared Inbox
- **Interactive annotation** - Capture annotations through direct CDP or relay transport without coupling annotation storage to screenshots or browser replay.
- **Compact payloads** - Annotation V2 stores `schemaVersion: 2`, screenshot-free compact handoff metadata, redaction metadata, selector bundles, and canvas identity when available.
- **Shared inbox retrieval** - Stored annotation retrieval resolves the repo-local shared inbox first, then falls back to extension-local storage when needed.
- **Review-friendly outputs** - Delivered and stored annotation outcomes make it clear whether a teammate received the payload or must pull it later.

### Skill Packs and Install Targets
- **Canonical bundled packs** - Install and update the 10 OpenDevBrowser-specific `opendevbrowser-*` skill packs for browser automation, design, motion, continuity, login, forms, extraction, research, shopping, and product presentation.
- **Multi-agent target sync** - Managed installs sync skills across OpenCode, Codex, ClaudeCode, and AmpCLI global or project-local targets.
- **Local onboarding helpers** - `opendevbrowser_prompting_guide`, `opendevbrowser_skill_list`, and `opendevbrowser_skill_load` work without a browser session, relay, or daemon bootstrap.
- **Ownership-safe lifecycle** - Update and uninstall act only on CLI-managed canonical packs or matching legacy aliases, leaving unrelated user skill directories untouched.

### Security, Challenge, and Reliability Guardrails
- **Secure defaults** - Remote CDP is blocked by default, raw CDP is disabled by default, unsafe export is disabled by default, and relay tokens use timing-safe comparison.
- **Origin and pairing controls** - Extension, `/ops`, `/canvas`, `/cdp`, `/annotation`, config, status, and pairing endpoints enforce loopback, origin, token, and rate-limit protections.
- **Sanitized outputs** - Exports strip scripts, event handlers, and dangerous CSS, while diagnostics redact tokens, API keys, credentials, and sensitive paths.
- **Reliability gates** - Daemon fingerprint preflight, release audits, docs drift checks, strict TypeScript, and 97 percent coverage guard against stale runtime or documentation claims.

---

## Tool Reference

OpenDevBrowser provides **70 tools** organized by category:
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
| `opendevbrowser_status_capabilities` | Inspect runtime capability discovery for the host and an optional session |
| `opendevbrowser_cookie_import` | Import validated cookies into the current session |
| `opendevbrowser_cookie_list` | List session cookies with optional URL filters |
| `opendevbrowser_session_inspector` | Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action |
| `opendevbrowser_session_inspector_plan` | Inspect browser-scoped computer-use policy, eligibility, and safe suggested steps |
| `opendevbrowser_session_inspector_audit` | Capture a correlated audit bundle across desktop evidence, browser review, and policy state |

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
| `opendevbrowser_review_desktop` | Capture desktop-assisted browser review with read-only desktop evidence and browser-owned verification |
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
| `opendevbrowser_screencast_start` | Start a browser replay screencast capture |
| `opendevbrowser_screencast_stop` | Stop a browser replay screencast capture and return artifact metadata |
| `opendevbrowser_dialog` | Inspect or handle a JavaScript dialog |
| `opendevbrowser_perf` | Get page performance metrics |
| `opendevbrowser_prompting_guide` | Get best-practice prompting guidance |

### Desktop Observation
| Tool | Description |
|------|-------------|
| `opendevbrowser_desktop_status` | Inspect public read-only desktop observation availability |
| `opendevbrowser_desktop_windows` | List windows exposed by the public read-only desktop observation plane |
| `opendevbrowser_desktop_active_window` | Inspect the active window through the public read-only desktop observation plane |
| `opendevbrowser_desktop_capture_desktop` | Capture the current desktop surface through the public read-only desktop observation plane |
| `opendevbrowser_desktop_capture_window` | Capture a specific window through the public read-only desktop observation plane |
| `opendevbrowser_desktop_accessibility_snapshot` | Capture desktop accessibility state through the public read-only desktop observation plane |

Desktop observation currently ships as a public read-only macOS surface. Availability, window inventory, and accessibility snapshots rely on the local `swift` command, while screenshot capture uses the built-in `screencapture` utility. If `desktop-status` reports `desktop_unsupported` on macOS, install Xcode or a Swift toolchain and retry.

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

OpenDevBrowser includes **10 OpenDevBrowser-specific skill packs**. Install, update, and uninstall own the managed skill lifecycle across OpenCode, Codex, ClaudeCode, and AmpCLI targets:

| Skill | Purpose |
|-------|---------|
| `opendevbrowser-best-practices` | Core prompting patterns and workflow guidance |
| `opendevbrowser-design-agent` | Contract-first, research-backed frontend and `/canvas` design execution |
| `opendevbrowser-motion-design` | Contract-first motion language, pattern selection, reduced-motion, performance, and temporal proof |
| `opendevbrowser-continuity-ledger` | Long-running task state management |
| `opendevbrowser-login-automation` | Authentication flow patterns |
| `opendevbrowser-form-testing` | Form validation and submission workflows |
| `opendevbrowser-data-extraction` | Structured data scraping patterns |
| `opendevbrowser-research` | Deterministic multi-source research workflows |
| `opendevbrowser-shopping` | Deterministic multi-provider deal comparison workflows |
| `opendevbrowser-product-presentation-asset` | Product screenshot/copy asset collection for presentation pipelines |

Installer note:
- `--skills-global` and `--skills-local` sync the 10 canonical `opendevbrowser-*` packs into managed global or project-local agent directories.
- Managed installs write a target-level ownership marker, so later update and uninstall only act on CLI-managed skill targets or older config installs that already contain canonical packs.
- Reinstall and update refresh drifted managed copies and leave matching packs unchanged.
- Uninstall removes managed canonical packs, retires repo-owned legacy alias directories that match shipped content, and leaves unrelated directories untouched.

Skills are discovered from (priority order):
1. `.opencode/skill/` (project)
2. `~/.config/opencode/skill/` (global)
3. `.codex/skills/` (project compatibility)
4. `$CODEX_HOME/skills` (global compatibility; fallback `~/.codex/skills`)
5. `.claude/skills/` (ClaudeCode project compatibility)
6. `$CLAUDECODE_HOME/skills` (ClaudeCode global compatibility; fallback `~/.claude/skills`)
7. `.amp/skills/` (AmpCLI project compatibility)
8. `$AMP_CLI_HOME/skills` (AmpCLI global compatibility; fallback `~/.amp/skills`)
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

1. Extension checks the discovery endpoint at `http://127.0.0.1:8787/config` by default.
2. It learns the relay port and whether pairing is required.
3. If pairing is required and Auto-pair is on, it fetches the token from `http://127.0.0.1:<relayPort>/pair`.
4. It connects to `ws://127.0.0.1:<relayPort>/extension` using the extension origin.

`/config` and `/pair` accept loopback requests with no `Origin` (including `Origin: null`) to support MV3 + PNA; non-extension origins are still rejected, and preflights include `Access-Control-Allow-Private-Network: true`.

### Troubleshooting: Extension Won't Connect

- Ensure the active tab is a normal `http(s)` page (not `chrome://` or extension pages).
- Confirm `relayPort` and `relayToken` in `~/.config/opencode/opendevbrowser.jsonc` match the popup (Auto-pair should fetch the token).
- If `relayPort` is `0`, the relay is off.
- For isolated daemon runs with a custom relay port, set `discoveryPort` to the same isolated value; keep `discoveryPort` at `8787` for normal extension discovery.
- `relayToken: false` disables relay/hub behavior entirely.
- `relayToken: ""` (empty string) keeps relay enabled but disables pairing requirements.
- Install auto-start with `opendevbrowser daemon install` from a stable install location so the relay is available on login.
- Clear extension local data and retry if the token/port seem stuck.
- If another process owns the relay or discovery port, change the relevant config port or stop it; `opencode` listening is expected.

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
  // On macOS, availability, window, and accessibility probes require the local swift command.
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
  "discoveryPort": 8787,
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
See [docs/SURFACE_REFERENCE.md](docs/SURFACE_REFERENCE.md) for the source-accurate inventory matrix (77 CLI commands, 70 tools, `/ops`, `/canvas`, and `/cdp` channel contracts).

### CLI Category Matrix (core command groups)

| Category | Commands |
|---------|----------|
| Install/runtime | `install`, `update`, `uninstall`, `help`, `version`, `serve`, `daemon`, `native`, `run` |
| Session/connection | `launch`, `connect`, `disconnect`, `status`, `status-capabilities`, `cookie-import`, `cookie-list` |
| Navigation | `goto`, `wait`, `snapshot`, `review`, `review-desktop` |
| Interaction | `click`, `hover`, `press`, `check`, `uncheck`, `type`, `select`, `scroll`, `scroll-into-view`, `upload`, `pointer-move`, `pointer-down`, `pointer-up`, `pointer-drag` |
| Targets/pages | `targets-list`, `target-use`, `target-new`, `target-close`, `page`, `pages`, `page-close` |
| DOM | `dom-html`, `dom-text`, `dom-attr`, `dom-value`, `dom-visible`, `dom-enabled`, `dom-checked` |
| Browser capture | `screenshot`, `screencast-start`, `screencast-stop` |
| Desktop observation | `desktop-status`, `desktop-windows`, `desktop-active-window`, `desktop-capture-desktop`, `desktop-capture-window`, `desktop-accessibility-snapshot` |
| Design canvas | `canvas` |
| Export/diagnostics/macro/annotation/power | `clone-page`, `clone-component`, `perf`, `dialog`, `console-poll`, `network-poll`, `debug-trace-snapshot`, `session-inspector`, `session-inspector-plan`, `session-inspector-audit`, `macro-resolve`, `annotate`, `rpc` |

### Install/Management

| Command | Description |
|---------|-------------|
| `npx opendevbrowser` | Interactive install |
| `npx opendevbrowser --global` | Install to global config |
| `npx opendevbrowser --local` | Install to project config |
| `npx opendevbrowser --with-config` | Also create opendevbrowser.jsonc |
| `npx opendevbrowser --full` | Full install (config + extension assets) |
| `npm install -g opendevbrowser` | Install persistent global CLI; npm global postinstall best-effort reconciles daemon auto-start |
| `npx opendevbrowser --update` | Repair OpenCode package caches and plugin pins |
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
| `npx opendevbrowser status-capabilities --session-id <id>` | Inspect host and session capability discovery before a workflow run |
| `npx opendevbrowser session-inspector --session-id <id>` | Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action |
| `npx opendevbrowser session-inspector-plan --session-id <id>` | Inspect browser-scoped computer-use policy, eligibility, and safe suggested steps |
| `npx opendevbrowser session-inspector-audit --session-id <id>` | Capture a correlated audit bundle across desktop evidence, browser review, and policy state |
| `npx opendevbrowser goto` | Navigate to URL |
| `npx opendevbrowser wait` | Wait for load or element |
| `npx opendevbrowser snapshot` | Capture snapshot with refs |
| `npx opendevbrowser review-desktop --session-id <id> --reason "<context>"` | Capture desktop-assisted browser review with read-only desktop evidence |
| `npx opendevbrowser click` | Click element by ref |
| `npx opendevbrowser type` | Type into element by ref |
| `npx opendevbrowser select` | Select dropdown option by ref |
| `npx opendevbrowser scroll` | Scroll page or element |
| `npx opendevbrowser run` | Run a JSON script |
| `npx opendevbrowser canvas --command canvas.session.open --params '{...}'` | Start or continue a design-canvas workflow through the daemon |
| `npx opendevbrowser macro-resolve --expression '@media.search("youtube transcript parity", "youtube", 5)' --execute --timeout-ms 120000` | Execute macro plans with extended timeout for slow runs |

Workflow cookie controls (`research run`, `shopping run`, `product-video run`, `inspiredesign run`):
- Defaults come from `providers.cookiePolicy` (`off|auto|required`) and `providers.cookieSource` (`file|env|inline`).
- Per-run overrides: `--use-cookies`, `--cookie-policy-override` (alias `--cookie-policy`).
- `auto` is non-blocking when cookies are unavailable; `required` fails fast with `reasonCode=auth_required`.

Workflow challenge controls (`research run`, `shopping run`, `product-video run`, `inspiredesign run`):
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
# Repair OpenCode's cached packages, manifest pin, and lockfile, then restart OpenCode
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
│ OpenCode Tools   │       CLI        │    Hub Daemon    │    Chrome Extension       │
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
├── src/              # Runtime implementation
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
│   ├── tools/        # 70 opendevbrowser_* tool definitions
│   └── utils/        # Shared utilities
├── extension/        # Chrome extension (relay client)
├── scripts/          # Operational scripts (build/sync/smoke)
├── skills/           # Bundled skill directories (10 canonical OpenDevBrowser packs)
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
   - `./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh`
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
