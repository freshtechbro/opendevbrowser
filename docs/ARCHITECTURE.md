# OpenDevBrowser Architecture

This document describes the architecture of OpenDevBrowser across plugin, CLI, and extension distributions, with a security-first focus.

---

## System overview

OpenDevBrowser provides three entry points that share a single runtime core:

- **Plugin**: OpenCode runtime entry that exposes `opendevbrowser_*` tools.
- **CLI**: Installer + automation commands (daemon or single-shot `run`).
- **Extension**: Relay mode for attaching to existing logged-in tabs.

The shared runtime core is in `src/core/` and wires `BrowserManager`, `ScriptRunner`, `SkillLoader`, and `RelayServer`.

---

## Component map

```mermaid
flowchart LR
  subgraph Distribution
    Plugin[OpenCode Plugin]
    CLI[CLI]
    Extension[Chrome Extension]
  end

  subgraph Core
    CoreBootstrap[Core Bootstrap]
    BrowserManager[BrowserManager]
    TargetManager[TargetManager]
    ScriptRunner[ScriptRunner]
    Snapshotter[Snapshot Pipeline]
    Devtools[DevTools Trackers]
    Exporter[Export Pipeline]
    Relay[RelayServer]
  end

  Plugin --> CoreBootstrap
  CLI --> CoreBootstrap
  Extension --> Relay

  CoreBootstrap --> BrowserManager
  BrowserManager --> TargetManager
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
4. Tool returns structured response with session id and warnings.

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
  CLI->>Daemon: start local server (127.0.0.1)
  Daemon->>Core: create core runtime
  Core->>Relay: start relay server
  User->>CLI: opendevbrowser launch
  CLI->>Daemon: POST /command (Bearer token)
  Daemon->>Core: session.launch
  Core->>Browser: launch or connect
  Core-->>Daemon: session id
  Daemon-->>CLI: result
```

### 3) Extension relay mode

```mermaid
sequenceDiagram
  actor User
  participant Extension
  participant Relay
  participant Browser
  participant Tools

  User->>Extension: Enable auto-connect
  Extension->>Relay: GET /config (extension origin)
  Extension->>Relay: GET /pair (extension origin)
  Extension->>Relay: WS /extension
  Tools->>Relay: GET /config
  Tools->>Relay: GET /pair (when pairing required)
  Tools->>Relay: WS /cdp?token=...
  Relay->>Browser: forward CDP commands
  Browser-->>Relay: CDP events
  Relay-->>Tools: forward events
```

### Session modes

- `extension`: attach to an existing tab via the Chrome extension relay.
- `managed`: launch and manage a Chrome instance via Playwright (headed by default).
- `cdpConnect`: attach to an existing Chrome via CDP (`/json/version`).
- `connect` routing: local relay WS endpoints (for example `ws://127.0.0.1:<relayPort>` or `/cdp`) are normalized to `/cdp` and routed via the relay (`extension` mode).
- Launch defaults to `extension` when available; managed/CDPConnect require explicit user choice.

---

## Configuration and state

- **Plugin config**: `~/.config/opencode/opendevbrowser.jsonc` (optional).
- **Daemon metadata**: `~/.cache/opendevbrowser/daemon.json` (port, token, pid).
- **Extension storage**: `chrome.storage.local` (relay port, token, auto-connect).

Default extension values:
- `relayPort`: `8787`
- `autoConnect`: `true`
- `autoPair`: `true`
- `pairingEnabled`: `true`
- `pairingToken`: `null` (fetched via `/pair`)

---

## Security controls

- **Local-only CDP** by default; non-local requires opt-in config.
- **Relay binding**: `127.0.0.1` only, with token-based pairing.
- **CDP auth**: `/cdp` requires `?token=<relayToken>` when pairing is enabled.
- **Origin enforcement**: relay endpoints (`/config`, `/pair`) reject explicit non-extension origins; missing `Origin` is accepted.
- **Timing-safe compare**: pairing tokens checked with `crypto.timingSafeEqual`.
- **Output redaction**: DevTools output strips sensitive tokens by default.
- **Sanitized export**: export pipeline removes scripts, handlers, and unsafe URLs.

---

## Testing and verification

- **Unit/integration tests** via Vitest (`npm run test`), coverage >=95%.
- **Extension build** via `npm run extension:build`.
- **CLI build** via `npm run build`.

---

## Key directories

- `src/core/`: shared runtime bootstrap.
- `src/browser/`: `BrowserManager`, `TargetManager`, session lifecycle.
- `src/tools/`: tool definitions and response shaping.
- `src/relay/`: relay server and protocol types.
- `src/cli/`: CLI commands, daemon, and installers.
- `extension/`: Chrome extension UI and background logic.
- `docs/`: plans, architecture, and operational guidance.
