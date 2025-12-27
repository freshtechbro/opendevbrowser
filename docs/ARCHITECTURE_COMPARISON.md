# Architecture Comparison (Planned vs Current)

## Sources
- docs/PLAN.md
- docs/opendevbrowser-plan.md
- docs/IMPLEMENTATION_BLUEPRINT.md

## Planned Architecture (from plan docs)
```mermaid
flowchart LR
  subgraph Host[OpenCode Host]
    User[User or Agent] --> Tools[opendevbrowser_* tools]
  end

  subgraph Plugin[OpenDevBrowser Plugin]
    Tools --> ToolHandlers[Tool handlers]
    ToolHandlers --> BrowserManager[BrowserManager]
    ToolHandlers --> ScriptRunner[ScriptRunner]
    ToolHandlers --> Snapshotter[Snapshotter + Ref Map]
    ToolHandlers --> DevTools[DevTools adapter]
    ToolHandlers --> ExportPipeline[Export pipeline]
    ToolHandlers --> SkillLoader[Skill loader]
    ToolHandlers --> CacheManager[Cache manager]
  end

  BrowserManager -->|Mode A/B| ChromeManaged[Chrome via Playwright CDP]
  BrowserManager -->|Mode C| Relay[Relay server]
  Relay --> Extension[Chrome extension]
  Extension --> ChromeTabs[Existing Chrome tabs via chrome.debugger]

  CacheManager --> ChromeDownload[Chrome for Testing download]
  ExportPipeline --> Output[TSX + CSS output]
```

## Planned Flowchart (script-first loop)
```mermaid
flowchart TD
  Start[Start] --> Launch[opendevbrowser_launch or connect]
  Launch --> Mode{Connection mode}
  Mode -->|Mode A| Managed[Managed Chrome]
  Mode -->|Mode B| Connect[Connect to user Chrome]
  Mode -->|Mode C| Relay[Relay + Extension]

  Managed --> Snapshot[opendevbrowser_snapshot]
  Connect --> Snapshot
  Relay --> Snapshot

  Snapshot --> Decide[Pick ref or run steps]
  Decide --> Action[click/type/select/scroll]
  Decide --> Run[opendevbrowser_run]
  Action --> Loop{More steps?}
  Run --> Loop
  Loop -->|Yes| Snapshot
  Loop -->|No| Optional[Optional export/perf/screenshot]
  Optional --> End[Done]
```

## Current Architecture (from codebase)
```mermaid
flowchart LR
  subgraph Plugin[OpenDevBrowser Plugin (src/)]
    Index[Index plugin entry] --> Config[ConfigStore + resolveConfig]
    Index --> Tools[tools/* createTools]
    Tools --> Manager[BrowserManager]
    Tools --> Runner[ScriptRunner]
    Tools --> RelayServer[RelayServer]
    Tools --> SkillLoader[SkillLoader]
    Tools --> Export[export/* pipeline]

    Manager --> SessionStore[SessionStore]
    Manager --> TargetManager[TargetManager]
    Manager --> RefStore[RefStore]
    Manager --> Snapshotter[Snapshotter]
    Manager --> ConsoleTracker[ConsoleTracker]
    Manager --> NetworkTracker[NetworkTracker]
    Manager --> Cache[cache/*]
    Cache --> ChromeLocator[chrome-locator]
    Cache --> Downloader[downloader]
  end

  Manager --> Playwright[playwright-core]
  Playwright --> Chrome[Chrome (managed or connected)]
  RelayServer --> Ext[extension/]
  Ext --> ConnectionManager[ConnectionManager]
  ConnectionManager --> TabManager[TabManager]
  ConnectionManager --> CDPRouter[CDPRouter -> chrome.debugger]
  ConnectionManager --> RelayClient[RelayClient -> relay]
  Export --> DomCapture[dom-capture]
  DomCapture --> CssExtract[css-extract]
  CssExtract --> ReactEmitter[react-emitter]
  SkillLoader --> SkillPack[skills/opendevbrowser-best-practices/SKILL.md]
```

## Status (Aligned to Plan)
- Snapshot source now uses Accessibility domain AX tree; DOM mutation for refs removed.
- Ref strategy now stores backendNodeId + frameId and invalidates on navigation.
- ScriptRunner includes retry/backoff helpers for transient action/wait failures.
- Extension relay port is configurable via popup storage; defaults to 8787.
- Prompting guide respects the `topic` argument via section filtering.
- CDP endpoint validation uses proper URL hostname parsing (not substring checks).
- Config now reads from plugin-owned file (`~/.config/opencode/opendevbrowser.jsonc`).
- DevTools output (network/console) redacts sensitive data by default.
- Export/clone pipeline sanitizes HTML (strips scripts, event handlers, dangerous URLs).
- Snapshot prefers stable selectors (data-testid, aria-label) and filters to main frame.

## Remaining Gaps
- None. All gaps from ARCHITECTURE_GAPS_REPORT.md have been remediated.

## Recommendations
- Keep plan docs and implementation in sync when new gaps arise.
- Review REMEDIATION_PLAN.md for implementation details of each fix.
