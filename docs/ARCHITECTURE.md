# OpenDevBrowser Architecture

This document describes the architecture of OpenDevBrowser across plugin, CLI, and extension distributions, with a security-first focus.
Status: active  
Last updated: 2026-02-25

---

## System overview

OpenDevBrowser provides four primary runtime entry points:

- **Plugin**: OpenCode runtime entry that exposes `opendevbrowser_*` tools.
- **CLI**: Installer + automation commands (daemon or single-shot `run`), plus guarded internal `rpc` passthrough for power users (unsafe, use with caution).
- **Extension**: Relay mode for attaching to existing logged-in tabs.
- **Website (private repo)**: Next.js website and generated docs viewer maintained in `opendevbrowser-website-deploy/frontend/`.
- **Hub daemon**: `opendevbrowser serve` process that owns the relay and enforces FIFO leases when hub mode is enabled.
- **Automation platform layer**: provider runtime, macro resolver, tiered fingerprint controls, and combined debug trace workflows shared across tool/CLI/daemon surfaces.

Current automation surface sizes:
- CLI commands: `55`
- Plugin tools: `48`
- `/ops` command names: `38`

The shared runtime core is in `src/core/` and wires `BrowserManager`, `AnnotationManager`, `ScriptRunner`, `SkillLoader`, and `RelayServer`.
Canonical inventory and channel contracts: `docs/SURFACE_REFERENCE.md`.
Frontend architecture and generation flow are documented in `docs/FRONTEND.md`.

The CLI installer attempts to set up daemon auto-start on first successful install
(macOS LaunchAgent, Windows Task Scheduler). Unsupported platforms are skipped and continue without auto-start.

---

## Component map

### Canonical ASCII map

```text
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
│  bootstrap.ts → wires managers, injects ToolDeps              │
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

### Data flow

```text
Tool Call → Zod Validation → Manager/Runner → CDP/Playwright → Response
                                   ↓
                            Snapshot (AX-tree → refs)
                                   ↓
                            Action (ref → backendNodeId → DOM)
```

### Detailed dependency map (Mermaid)

```mermaid
flowchart LR
  subgraph Distribution
    Plugin[OpenCode Plugin]
    CLI[CLI]
    Hub[Hub Daemon]
    Extension[Chrome Extension]
    Frontend[Private Website Repo]
  end

  subgraph Core
    CoreBootstrap[Core Bootstrap]
    BrowserManager[BrowserManager]
    TargetManager[TargetManager]
    ProviderRuntime[Provider Runtime]
    MacroRegistry[Macro Registry]
    Fingerprint[Fingerprint Tiers]
    AnnotationManager[AnnotationManager]
    ScriptRunner[ScriptRunner]
    Snapshotter[Snapshot Pipeline]
    Devtools[DevTools Trackers]
    Exporter[Export Pipeline]
    Relay[RelayServer]
  end

  Plugin --> CoreBootstrap
  CLI --> CoreBootstrap
  Hub --> CoreBootstrap
  Extension --> Relay
  Frontend --> CLI
  Frontend --> Docs[docs/* + CHANGELOG + skills/*/SKILL.md]

  CoreBootstrap --> BrowserManager
  BrowserManager --> TargetManager
  CoreBootstrap --> ProviderRuntime
  CoreBootstrap --> MacroRegistry
  BrowserManager --> Fingerprint
  CoreBootstrap --> AnnotationManager
  AnnotationManager --> BrowserManager
  AnnotationManager --> Relay
  CoreBootstrap --> ScriptRunner
  CoreBootstrap --> Snapshotter
  CoreBootstrap --> Devtools
  CoreBootstrap --> Exporter
  CoreBootstrap --> Relay
```

---

## Runtime flows

### 1) Plugin tool invocation

1. OpenCode calls a tool like `opendevbrowser_launch`.
2. Tool validates inputs with Zod and delegates to `BrowserManager`.
3. `BrowserManager` launches or connects to a Chrome instance.
4. Optional automation flows route through provider runtime (`search`/`fetch`/`crawl`/`post`) and macro resolution.
5. Tool returns structured response with session id, trace-aware diagnostics, and warnings.

### 2) CLI automation (daemon mode)

```mermaid
sequenceDiagram
  actor User
  participant CLI
  participant Daemon
  participant Core
  participant Relay
  participant Browser

  User->>CLI: opendevbrowser serve
  CLI->>Daemon: start local server (127.0.0.1) and relay
  Note over Daemon,Relay: Hub daemon owns relay + FIFO leases
  Daemon->>Core: create core runtime
  Core->>Relay: start relay server
  User->>CLI: opendevbrowser launch
  CLI->>Daemon: POST /command (Bearer token)
  Daemon->>Core: session.launch
  Core->>Browser: launch or connect
  Core-->>Daemon: session id
  Daemon-->>CLI: result
  User->>CLI: opendevbrowser rpc --unsafe-internal --name <command>
  CLI->>Daemon: POST /command (raw internal command name + params, bypasses stable CLI surface)
  Daemon-->>CLI: raw command result
```

`rpc` is intentionally CLI-only and internal. It can invoke unstable daemon command paths and should be treated as a last-resort power-user interface.

### 3) Extension relay mode

```mermaid
sequenceDiagram
  actor User
  participant Extension
  participant Hub
  participant Relay
  participant Browser
  participant Tools

  User->>Extension: Enable auto-connect
  Extension->>Relay: GET /config (extension origin or loopback no-Origin)
  Extension->>Relay: GET /pair (extension origin or loopback no-Origin)
  Extension->>Relay: WS /extension
  Tools->>Relay: GET /config (loopback)
  Tools->>Relay: GET /pair (when pairing required, loopback)
  Tools->>Hub: acquire binding/lease when required
  Tools->>Relay: WS /ops?token=...
  Tools->>Relay: WS /annotation?token=... (annotate relay)
  Relay->>Extension: forward ops envelopes
  Extension->>Browser: execute CDP/debugger commands
  Browser-->>Extension: CDP events/results
  Extension-->>Relay: relay events/results
  Relay-->>Tools: forward events/results
```

### 4) Website docs/content generation (private repo)

```mermaid
sequenceDiagram
  participant Sources as docs/* + CHANGELOG + skills/*/SKILL.md
  participant Generator as private frontend/scripts/generate-docs.mjs
  participant Content as private frontend/src/content/*
  participant Next as private frontend/src/app/docs/*

  Sources->>Generator: markdown and metadata inputs
  Generator->>Content: pages.json + docs-manifest.json + metrics.json + roadmap.json
  Next->>Content: render docs gateway and reference routes
```

### Session modes

- `extension`: attach to an existing tab via the Chrome extension relay.
- `managed`: launch and manage a Chrome instance via Playwright (headed by default).
- `cdpConnect`: attach to an existing Chrome via CDP (`/json/version`).
- `connect` routing: local relay WS endpoints (for example `ws://127.0.0.1:<relayPort>` or `/ops`) are normalized to `/ops` and routed via the relay (`extension` mode). Legacy `/cdp` requires `--extension-legacy`.
- Launch defaults to `extension` when available; managed/CDPConnect require explicit user choice.
- Extension relay requires **Chrome 125+** and uses flat-session routing with DebuggerSession `sessionId`.
- Hub mode supports multi-client access. `/ops` accepts multiple clients, while FIFO binding/lease coordination applies to legacy `/cdp` and protected extension-session command paths.

### Relay channel contracts

- `/ops` is the default high-level extension channel with explicit commands (`session.*`, `targets.*`, `page.*`, `nav.*`, `interact.*`, `dom.*`, `export.*`, `devtools.*`).
- `/ops` envelopes: `ops_hello`, `ops_request`, `ops_response`, `ops_error`, `ops_event`, `ops_chunk`, `ops_ping`, `ops_pong`.
- `/cdp` is legacy and forwards raw CDP commands via `forwardCDPCommand` envelopes (`id`, `method`, `params`, optional `sessionId`) and relays events/responses back.
- `/annotation` remains a dedicated channel for annotation command/event/response flow.
- Full command names and payload examples are documented in `docs/SURFACE_REFERENCE.md`.

### Multi-tab concurrency contract

- Canonical spec: `docs/MULTITAB_PARALLEL_OPERATIONS_SPEC.md`.
- Execution key: `ExecutionKey = (sessionId, targetId)`.
- Command taxonomy:
  - `TargetScoped`: `goto`, `wait`, `snapshot`, interaction commands, DOM commands, `page.screenshot`, export/devtools target-bound commands.
  - `SessionStructural`: connect/disconnect, target/page create/close/select/list.
- Scheduler guarantees:
  - Same target: strict FIFO.
  - Different targets in one session: parallel up to governor `effectiveParallelCap`.
- Governor policy source of truth: `src/config.ts` (`parallelism` block), passed to extension `/ops` at `session.connect`.
- Legacy `/cdp` remains compatibility-only (`effectiveParallelCap=1`).
- Extension headless is unsupported by contract; headless extension launch/connect intent fails with `unsupported_mode`.
- Declared intentional mismatches are registry-bound in `docs/PARITY_DECLARED_DIVERGENCES.md`; undeclared parity mismatches fail gates.

### Automation platform surfaces

- Provider runtime supports source policy routing (`auto|web|community|social|shopping|all`) with per-provider timeouts, retries, circuit-breaker state, and partial-success envelopes.
- Workflow wrappers expose finalized skill-aligned entrypoints:
  - `research.run` / `opendevbrowser_research_run` / `opendevbrowser research run`
  - `shopping.run` / `opendevbrowser_shopping_run` / `opendevbrowser shopping run`
  - `product.video.run` / `opendevbrowser_product_video_run` / `opendevbrowser product-video run`
- Workflow runtime primitives are layered as:
  - `timebox` (strict `days|from|to` resolution)
  - `orchestrator` (source/provider fanout + partial-failure accumulation)
  - `enrichment` (engagement/recency/date-confidence)
  - `renderer` (`compact|json|md|context|path`)
  - `artifact writer` (owner-only paths, TTL metadata, cleanup support)
- Macro engine resolves `@macro(...)` expressions into provider operations (`src/macros/*`) and is exposed through tool/CLI/daemon (`macro_resolve`, `macro-resolve`, `macro.resolve`) with resolve-only and execute modes.
- Execute-mode macro responses keep existing shapes and add metadata fields: `meta.tier.selected`, `meta.tier.reasonCode`, `meta.provenance.provider`, `meta.provenance.retrievalPath`, and `meta.provenance.retrievedAt`.
- Diagnostics include console/network/exception trackers and a combined debug bundle endpoint (`debug_trace_snapshot`, `debug-trace-snapshot`, `devtools.debugTraceSnapshot`).
- Legal/compliance gating for scrape-first adapters is enforced with per-provider review checklists (review date, allowed surfaces, prohibited flows, reviewer, expiry, signed-off status) and blocks expired/invalid enablement.
- Session coherence includes cookie import validation and tiered fingerprint controls:
  - Provider cookie policy defaults are configurable via `providers.cookiePolicy` (`off|auto|required`) and `providers.cookieSource` (`file|env|inline`).
  - Workflow wrappers expose per-run overrides: `useCookies` and `cookiePolicyOverride`.
  - Effective policy is deterministic: override > `useCookies` > config default.
  - `required` policy can fail fast with `reasonCode=auth_required` when cookie load/import/verification cannot establish authenticated state.
  - Workflow metrics include cookie diagnostics at `meta.metrics.cookie_diagnostics` and `meta.metrics.cookieDiagnostics`.
  - Tier 1: coherence checks/warnings (default on)
  - Tier 2: runtime hardening + rotation policy (default on, continuous signals)
  - Tier 3: adaptive canary/fallback track (default on, continuous signals)
- Structured JSON logging/audit provides request correlation (`requestId`) and redaction-safe audit entries for write paths.

---

## Configuration and state

- **Plugin config**: `~/.config/opencode/opendevbrowser.jsonc` (optional).
- **Daemon metadata**: `~/.cache/opendevbrowser/daemon.json` (port, token, pid).
- **Daemon status**: `/status` is the source of truth; cached metadata may be stale.
- **Daemon config**: `daemonPort`/`daemonToken` persisted in `opendevbrowser.jsonc` for hub discovery.
- **Extension storage**: `chrome.storage.local` (relay port, token, auto-connect).
- **Frontend generated content (private repo)**: `opendevbrowser-website-deploy/frontend/src/content/*` (generated docs/metrics/roadmap JSON).

Default extension values:
- `relayPort`: `8787`
- `autoConnect`: `true`
- `autoPair`: `true`
- `pairingEnabled`: `true`
- `pairingToken`: `null` (fetched via `/pair`)
- Background auto-retry/backoff uses `chrome.alarms` for extension auto-connect retries (`/config` + `/pair`) when the relay is unreachable.

---

## Security controls

- **Local-only CDP** by default; non-local requires opt-in config.
- **Relay binding**: `127.0.0.1` only, with token-based pairing.
- **Ops auth**: `/ops` requires `?token=<relayToken>` when pairing is enabled.
- **CDP auth**: `/cdp` requires `?token=<relayToken>` when pairing is enabled (legacy).
- **Annotation auth**: `/annotation` requires `?token=<relayToken>` when pairing is enabled.
- **Origin enforcement**: `/extension` requires `chrome-extension://` origin; `/config`, `/status`, `/pair` allow extension origins and loopback no-Origin (including `Origin: null`), and reject explicit non-extension origins.
- **PNA/CORS**: preflights include `Access-Control-Allow-Private-Network: true` when requested.
- **HTTP rate limiting**: `/config`, `/status`, `/pair` are rate-limited per IP.
- **Timing-safe compare**: pairing tokens checked with `crypto.timingSafeEqual`.
- **Output redaction**: DevTools output strips sensitive tokens by default.
- **Sanitized export**: export pipeline removes scripts, handlers, and unsafe URLs.

---

## Extension relay routing (flat sessions)

Extension relay mode uses **flat CDP sessions (Chrome 125+)**. The extension CDP router:

- Lists top-level tabs and child targets for discovery.
- Auto-attaches child targets recursively (workers/OOPIF) and surfaces them in `Target.getTargets` and `Target.getTargetInfo`.
- Routes all commands and events by DebuggerSession `sessionId` (no `Target.sendMessageToTarget`).
- Maintains root vs child mappings in `TargetSessionMap` to route each `sessionId` to the correct `tabId`.
- Tracks a primary tab for relay handshake/diagnostics without disconnecting other tabs.
- Annotation relay uses a dedicated `/annotation` websocket and `annotationCommand`/`annotationResponse` messages.

When hub mode is enabled, the hub daemon is the **sole relay owner** and enforces a FIFO lease queue for multi-client safety. There is no local relay fallback in hub mode.

---

## Testing and verification

- **Unit/integration tests** via Vitest (`npm run test`), coverage >=97%.
- **Extension build** via `npm run extension:build`.
- **CLI build** via `npm run build`.
- **Private website checks** via `npm run lint --prefix frontend && npm run typecheck --prefix frontend && npm run build --prefix frontend` in `opendevbrowser-website-deploy`.
- **CLI inventory/help parity check** via `npx opendevbrowser --help` and `npx opendevbrowser help`.
- **Parity gate** via `tests/parity-matrix.test.ts` (CLI/tool/runtime surface checks + mode coverage).
- **Provider performance gate** via `tests/providers-performance-gate.test.ts` (deterministic fixture SLO checks).
- **Release checklist** in `docs/RELEASE_PARITY_CHECKLIST.md`.
- **Benchmark fixture manifest** in `docs/benchmarks/provider-fixtures.md`.
- **First-run onboarding checklist** in `docs/FIRST_RUN_ONBOARDING.md`.

## Skill artifacts and operational gates

`opendevbrowser-best-practices` includes codified operational artifacts under
`skills/opendevbrowser-best-practices/artifacts/`:

- `provider-workflows.md`
- `parity-gates.md`
- `debug-trace-playbook.md`
- `fingerprint-tiers.md`
- `macro-workflows.md`
- `command-channel-reference.md`

Template assets for parity and channel checks live under
`skills/opendevbrowser-best-practices/assets/templates/`.

Skill install/discovery sync covers `opencode`, `codex`, `claudecode`, and `ampcli`
ecosystems (with legacy `claude`/`amp` aliases preserved), and path discovery is documented
in `README.md` and `docs/CLI.md`.

Validation script:

```bash
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```

---

## Key directories

- `src/core/`: shared runtime bootstrap.
- `src/browser/`: `BrowserManager`, `TargetManager`, session lifecycle.
- `src/browser/fingerprint/`: Tier 1/2/3 fingerprint policy + adaptive controls.
- `src/providers/`: provider contracts, registry, runtime policy, and first-party adapters.
- `src/providers/workflows.ts`: research/shopping/product-video orchestrators and compliance/alert gates.
- `src/providers/timebox.ts`: strict timebox resolver and filtering primitives.
- `src/providers/{renderer.ts,artifacts.ts,enrichment.ts}`: render modes, artifact lifecycle, and enrichment scores.
- `src/macros/`: macro parser/registry and pack definitions.
- `src/devtools/`: console/network/exception trackers and debug bundle channels.
- `src/tools/`: tool definitions and response shaping.
- `src/relay/`: relay server and protocol types.
- `src/cli/`: CLI commands, daemon, and installers.
- `src/cli/commands/artifacts.ts`: artifact lifecycle cleanup (`artifacts cleanup --expired-only`).
- `extension/`: Chrome extension UI and background logic.
- `opendevbrowser-website-deploy/frontend/`: private website app and generated content pipeline.
- `docs/`: plans, architecture, and operational guidance.
