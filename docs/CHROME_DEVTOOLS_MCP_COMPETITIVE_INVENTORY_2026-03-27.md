# Chrome DevTools MCP Competitive Inventory

Status: active
Reviewed: 2026-04-05
Chrome public surface baseline: official `chrome-devtools-mcp` README, tool reference, CLI docs, blog, and npm listing reviewed on 2026-03-27  
Historical release-window audit used for provenance: `0.11.0` (2025-12-03) through `0.20.3` (2026-03-20)  
OpenDevBrowser baseline: `src/public-surface/source.ts` re-audited on 2026-04-05 via `node scripts/docs-drift-check.mjs` with 64 CLI commands, 57 tools, 59 `/ops` commands, and 35 `/canvas` commands

## Purpose

This document now serves two jobs:

1. Preserve the competitive inventory between Chrome DevTools MCP and OpenDevBrowser.
2. Turn the highest-value gaps into an additive implementation spec that fits OpenDevBrowser's current stack.

This is not a replacement plan. It is a selective borrowing plan.

## Primary sources

- Chrome DevTools MCP repository: [github.com/ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- Chrome DevTools MCP tool reference: [github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
- Chrome DevTools MCP CLI docs: [github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md)
- Chrome blog on debugging an existing browser session: [developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)
- npm package listing: [npmjs.com/package/chrome-devtools-mcp](https://www.npmjs.com/package/chrome-devtools-mcp)
- OpenDevBrowser source-of-truth: [docs/SURFACE_REFERENCE.md](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/SURFACE_REFERENCE.md), [docs/CLI.md](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CLI.md), [src/public-surface/source.ts](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/public-surface/source.ts), [src/browser/manager-types.ts](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/manager-types.ts)

## Bottom line

- Recommended replacements: none.
- The best Chrome-derived lift is still additive, not architectural.
- The best lift is concentrated in:
  - deeper performance and trace workflows,
  - public emulation,
  - richer diagnostics,
  - memory tooling,
  - upload and dialog handling,
  - screenshot ergonomics,
  - screencast and replay artifacts.
- OpenDevBrowser should keep its current strengths intact:
  - extension-backed live logged-in tabs,
  - explicit `extension`, `managed`, and `cdpConnect` session modes,
  - `targetId`-centric routing and named pages,
  - ref-driven action loops and `review`,
  - the broader CLI and workflow surface.

## Current OpenDevBrowser seam map

These existing seams matter because they determine what should be enriched versus what must be added as a new public lane.

| Current lane | Verified public surface | Current owner seam | What that means |
| --- | --- | --- | --- |
| `perf` | `opendevbrowser_perf`, `perf` CLI, `/ops devtools.perf` | `BrowserManager.perfMetrics`, `OpsBrowserManager.perfMetrics`, `ops-runtime handlePerf` | This is already a real public lane and should absorb tracing and audit work. |
| `console-poll` | `opendevbrowser_console_poll`, `console-poll` CLI, `/ops devtools.consolePoll` | console tracker plus manager polling seams | Richer console drill-down belongs here or in `debug-trace-snapshot`, not in a new sibling lane. |
| `network-poll` | `opendevbrowser_network_poll`, `network-poll` CLI, `/ops devtools.networkPoll` | network tracker plus manager polling seams | Request and response drill-down should deepen this lane rather than create a parallel export lane. |
| `debug-trace-snapshot` | `opendevbrowser_debug_trace_snapshot`, `debug-trace-snapshot` CLI | `BrowserManager.debugTraceSnapshot`; `OpsBrowserManager.debugTraceSnapshot` assembles extension-mode output | Combined diagnostics already exist and should stay manager-owned. |
| `screenshot` | `opendevbrowser_screenshot`, `screenshot` CLI, `/ops page.screenshot` | `BrowserManager.screenshot`, `OpsBrowserManager.screenshot`, `ops-runtime handleScreenshot` | Full-page and element capture should extend this existing lane. |

## 1. Prioritized additive inventory

This table answers the main product question: what Chrome has that OpenDevBrowser does not, or does not yet do deeply enough, and which gaps deserve implementation effort.

`Class` distinguishes between:

- `enrich existing lane`: keep the current public command/tool and deepen it
- `new public lane`: add a new top-level lane because no real public equivalent exists today

| Value rank | Candidate | Chrome has | ODB today | Class | Additive verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Perf trace and audit lane | Trace capture, insight analysis, Lighthouse-style audit depth, and richer perf artifacts | Only thinner public perf and debug surfaces | enrich existing lane | Strong add candidate |
| 2 | Public emulation | Viewport, device shape, UA, CPU, network, geolocation, color scheme | No equivalent public surface | new public lane | Strong add candidate |
| 3 | Richer diagnostics | Deeper console and network drill-down, preserved history, request and response body access, stronger error context | Useful but shallower diagnostics | enrich existing lane | Strong add candidate |
| 4 | Memory heap snapshots | Heap or memory snapshot workflows | No public heap snapshot surface | new public lane | Good add candidate |
| 5 | File upload | First-class file input handling | No first-class public equivalent found | new public lane | Worth adding |
| 6 | Dialog handling | Explicit modal, alert, confirm, and prompt handling | No first-class public equivalent found | new public lane | Worth adding |
| 7 | Screenshot ergonomics | Full-page capture, element-only capture, better output controls | Current screenshot surface is narrower | enrich existing lane | Worth adding |
| 8 | Screencast and replay artifacts | Experimental recording and replay-style artifacts | No public recording or replay lane found | new public lane | Worth adding after the higher-lift debug lanes |
| 9 | Bounded script eval and init-script injection | Public eval and init-script style hooks | Only internal helper usage, no public lane | new public lane | Only after the higher-value diagnostic and QA gaps land |

### Why these nine are the right shortlist

- They map to real Chrome value, not Chrome packaging noise.
- They either deepen verified ODB seams or fill a truly missing public lane.
- They are relevant to OpenDevBrowser's actual workflow mix: QA/debug, browser investigation, reproducible repro, and form-style automation.
- They avoid duplicating what ODB already does better, such as live-tab extension control, target routing, and session modes.

## 2. Shared features where Chrome is not better enough to justify replacement

| Capability | Chrome DevTools MCP | OpenDevBrowser | Replacement verdict | Rationale |
| --- | --- | --- | --- | --- |
| Connect to an existing Chrome instance | `--browser-url`, websocket attach, auto-connect style flows | `connect`, `cdpConnect`, extension-backed live-tab attach, and `launch` modes across `extension`, `managed`, and `cdpConnect` | Do not replace | ODB already has broader connection modes and a better logged-in-tab story. |
| Persistent CLI and daemon shape | Experimental Chrome CLI proves the pattern matters | ODB already ships a materially broader CLI with workflows and daemon/native management | Do not replace | Chrome validates the category; it does not outclass ODB here. |
| Multi-page routing | Chrome page routing | ODB `targetId` plus named pages | Do not replace | ODB already has the stronger explicit target model. |
| Snapshot-driven automation | Chrome snapshot plus action tools | ODB snapshot, review, ref-based actions, DOM probes, pointer surfaces | Do not replace | ODB has the richer agent-facing abstraction. |
| Baseline debugging and screenshot tools | Console, network, screenshot, eval, perf | Console, network, screenshot, perf, debug trace | Do not replace | The right move is enrichment, not surface replacement. |

## 3. Chrome features that are real but not worth copying now

| Capability | Why not now |
| --- | --- |
| `--slim` mode | ODB already has a richer CLI and tool surface. Copying Chrome's packaging posture would not close a product gap. |
| Chrome's experimental CLI shape itself | Useful as market validation, not as a migration target. |
| Background page open ergonomics | Nice convenience, but lower value than the current debug and QA gaps. |
| Per-server browser-context isolation as a competitive headline | ODB already has strong session-level and extension-backed separation. |
| Chrome-specific onboarding helpers | Distribution detail, not a product capability gap. |

## 4. Product priority versus implementation sequence

The product value rank above is not the same as the safest implementation order.

OpenDevBrowser should implement in two phases:

### Phase A - enrich existing public lanes first

These are the lowest-risk changes because the public lane already exists in tools, CLI, daemon routing, manager types, and at least partial `/ops` parity.

| Wave | Candidate | Reason to go in Phase A |
| --- | --- | --- |
| A1 | Perf trace and audit lane | Highest-value additive win and the cleanest place to establish artifact and option conventions. |
| A2 | Richer diagnostics | Current trackers and combined diagnostics already exist; deepening them early prevents ownership drift later. |
| A3 | Screenshot ergonomics | Existing public lane already exists and can absorb richer options without opening a new subsystem. |

### Phase B - add truly new public lanes

These should come after Phase A sets the public-shape and parity rules.

| Wave | Candidate | Why this order |
| --- | --- | --- |
| B1 | Public emulation | Highest-value new lane with strong QA and repro leverage and relatively clean target-scoped semantics. |
| B2 | Memory heap snapshots | High-value debug lane, but more artifact-heavy than emulation. |
| B3 | File upload | Simpler and more deterministic than dialog handling. |
| B4 | Dialog handling | Event-driven and timing-sensitive; should follow upload, not be bundled into a vague interaction bucket. |
| B5 | Screencast and replay artifacts | Useful, but lower leverage than perf, emulation, diagnostics, and memory. |
| B6 | Bounded eval and init-script | Highest misuse risk and the easiest way to accidentally create a bypass lane. |

## 5. Ownership matrix

This is the core implementation rule set. It keeps new work aligned with the current ODB architecture instead of letting Chrome-inspired features create a second public system.

| Candidate | Public contract owner | Daemon owner | Managed runtime owner | `/ops` owner | Data/schema owner | Docs/tests owner |
| --- | --- | --- | --- | --- | --- | --- |
| Perf trace and audit lane | existing `perf` tool and CLI surface | `src/cli/daemon-commands.ts` pass-through only | `BrowserManager.perfMetrics` and nearby perf seam | `OpsBrowserManager.perfMetrics` plus `ops-runtime` perf handlers for primitive capture | new trace and audit artifact types should live with browser/devtools runtime types, not in CLI/tool code | `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/ARCHITECTURE.md`, perf tests |
| Richer diagnostics | existing `console-poll`, `network-poll`, and `debug-trace-snapshot` public surfaces | pass-through only | console, network, exception trackers plus `BrowserManager.debugTraceSnapshot` | `OpsBrowserManager` assembles the combined result; `ops-runtime` exposes primitive poll and fetch commands only | tracker schemas remain owned by the tracker layer; combined artifact shape remains manager-owned | docs plus diagnostics and parity tests |
| Screenshot ergonomics | existing `screenshot` tool and CLI surface | pass-through only | `BrowserManager.screenshot` | `OpsBrowserManager.screenshot` plus `ops-runtime` screenshot primitive | screenshot option and result shape should be owned at manager level | docs plus screenshot tool and CLI tests |
| Public emulation | new public tool and CLI lane in the devtools group | new daemon route only, no extra policy logic | new manager method in `BrowserManagerLike` and managed implementation in `BrowserManager` | `OpsBrowserManager` plus new `ops-runtime` handlers | shared option schema should live in browser-layer types | docs plus new CLI/tool/manager/ops parity tests |
| Memory heap snapshots | new public tool and CLI lane in the devtools group | new daemon route only | new manager method in `BrowserManager` | `OpsBrowserManager` plus new `ops-runtime` handler if extension parity is supported | snapshot artifact schema belongs to browser/devtools layer | docs plus artifact and parity tests |
| File upload | new public interaction lane | new daemon route only | manager-owned interaction implementation | `OpsBrowserManager` plus `/ops` handler if extension parity is supported | upload request and result types belong to browser-layer types | docs plus form-style interaction tests |
| Dialog handling | new public interaction lane | new daemon route only | manager-owned dialog state and action logic | `OpsBrowserManager` plus `/ops` handler if extension parity is supported | dialog event and response types belong to browser-layer types | docs plus modal/dialog tests |
| Screencast and replay artifacts | new public devtools or artifact lane | new daemon route only | manager-owned recording lifecycle and artifact return | `OpsBrowserManager` plus `/ops` handler if extension parity is supported | recording manifest and artifact schema belong to browser/devtools layer | docs plus artifact and parity tests |
| Bounded eval and init-script | new public power lane with strict limits | new daemon route only | manager-owned bounded implementation | `OpsBrowserManager` plus `/ops` only if parity is deliberate and safe | request shape, allowlist, and result shape belong to browser-layer types | docs plus security and parity tests |

## 6. Canonical ownership rules

These rules should be treated as implementation constraints, not suggestions.

### 6.1 One user intent, one public lane

If a user intent already maps to a public lane, extend that lane instead of creating a sibling lane.

Examples:

- trace and audit belong in `perf`
- richer cross-channel debugging belongs in `debug-trace-snapshot`
- better capture options belong in `screenshot`

### 6.2 `BrowserManagerLike` is the public behavior contract

Tools, CLI commands, daemon commands, and `/ops` runtime should not invent alternative public behavior contracts.

The manager layer stays canonical.

### 6.3 Combined diagnostics stay manager-owned

This rule is important enough to state explicitly:

- managed mode assembles combined diagnostics in `BrowserManager`
- extension mode assembles combined diagnostics in `OpsBrowserManager`
- `/ops` runtime exposes primitives only
- daemon, CLI, and tool layers stay transport adapters

This preserves the current good seam instead of moving logic into transport layers.

### 6.4 `/ops` runtime is not a second product API

`extension/src/ops/ops-runtime.ts` may implement primitives and routing, but it should not become a parallel product surface with behavior that bypasses manager normalization.

### 6.5 Adapters stay thin

These layers should only validate, map arguments, and return results:

- `src/tools/*`
- `src/cli/commands/*`
- `src/cli/daemon-commands.ts`

They should not accumulate feature logic, artifact shaping, or special-case fallback semantics that diverge from manager behavior.

### 6.6 No `/cdp`-only public expansion

Do not ship a new public capability only through legacy `/cdp` or raw command escape hatches while the main ODB surfaces stay behind.

If parity is intentionally delayed, document it as temporary and explicit.

### 6.7 Do not promote internal helper seams directly

Internal `page.evaluate`, `Runtime.evaluate`, or `addInitScript` usage in canvas and annotate helpers must not be exposed publicly by copy-paste promotion.

Any public eval or init-script lane must go through full manager-contract design first.

### 6.8 No feature flags and no backward-compat shims

These additions should land cleanly or not ship. OpenDevBrowser does not need rollout flags, duplicate legacy contracts, or compatibility shims for these lanes.

## 7. Publication gates

A candidate is not complete until all of the following are true:

1. Public contract exists in the right lane and uses the right name.
2. `BrowserManagerLike` exposes the capability.
3. Managed runtime is implemented.
4. Extension parity is implemented through `OpsBrowserManager` and `/ops`, or a temporary parity gap is explicitly documented.
5. CLI args and help are updated.
6. Tool surface and daemon routing are updated.
7. Public docs are updated together:
   - `docs/CLI.md`
   - `docs/SURFACE_REFERENCE.md`
   - `docs/ARCHITECTURE.md`
   - `README.md`
   - relevant `AGENTS.md` files if ownership or workflow guidance changes
8. Tests land in the owning seam:
   - tool or CLI adapter tests,
   - daemon route tests,
   - manager tests,
   - `/ops` runtime tests,
   - parity tests where applicable
9. Repo gates pass:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
   - `npm run test`

## 8. Recommended implementation decisions

### 8.1 Keep upload and dialog separate

Do not merge them into one generic interaction bucket.

- upload is ref- or input-oriented and deterministic
- dialog handling is event-driven and timing-sensitive

They can share a broader interaction phase, but they should remain separate public commands, separate manager methods, separate daemon routes, separate `/ops` handlers, and separate tests.

### 8.2 Keep screencast in the priority set

Screencast and replay artifacts are not top-tier compared with tracing, emulation, memory, or richer diagnostics, but they are still worth adding to OpenDevBrowser's additive roadmap.

Good fit:

- demo capture
- issue reproduction handoff
- replayable review artifacts

Not good enough to outrank:

- perf trace and audit
- emulation
- richer diagnostics
- memory snapshots

### 8.3 Treat screenshot ergonomics as a real lane, not a footnote

This is smaller than the top debug lanes, but still useful and already sits on a verified public seam. It belongs in the plan.

## 9. Non-goals

- Replacing the ODB CLI with a Chrome-shaped CLI
- Replacing `targetId` routing with Chrome `pageId` semantics
- Replacing extension-backed existing-session reuse with Chrome auto-connect ergonomics
- Creating a second Chrome-style debugging subsystem beside ODB's current manager and `/ops` architecture
- Publishing new lanes behind feature flags or compatibility shims

## 10. Final recommendation

Recommended replacements: none.

Recommended additive work, in product-priority order:

1. perf trace and audit lane
2. public emulation
3. richer diagnostics
4. memory heap snapshots
5. file upload
6. dialog handling
7. screenshot ergonomics
8. screencast and replay artifacts
9. bounded eval and init-script

Recommended implementation order:

1. A1 - perf trace and audit
2. A2 - richer diagnostics
3. A3 - screenshot ergonomics
4. B1 - public emulation
5. B2 - memory heap snapshots
6. B3 - file upload
7. B4 - dialog handling
8. B5 - screencast and replay artifacts
9. B6 - bounded eval and init-script

The important distinction is simple:

- product priority says what brings the most lift
- implementation order says what fits OpenDevBrowser's current seams with the least duplication and the least architectural drift
