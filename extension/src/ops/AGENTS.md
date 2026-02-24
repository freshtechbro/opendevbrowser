# extension/src/ops/ — Agent Guidelines

Ops runtime for extension relay. Extends `extension/AGENTS.md`.

## Overview

High-level ops protocol implementation for browser automation via extension relay. Handles session lifecycle, navigation, interaction, DOM operations, and DevTools integration.

## Structure

```
extension/src/ops/
├── ops-runtime.ts        # Main orchestrator (1264+ lines) - command handling
├── ops-session-store.ts  # Session state, ref store, console/network events
├── snapshot-builder.ts   # AX-tree snapshot construction
├── snapshot-shared.ts    # Shared snapshot utilities
├── dom-bridge.ts         # DOM operations via CDP
└── redaction.ts          # URL/console text redaction
```

## OpsRuntime Commands

| Category | Commands |
|----------|----------|
| Session | `session.launch`, `session.connect`, `session.disconnect`, `session.status` |
| Storage | `storage.setCookies`, `storage.getCookies` |
| Targets | `targets.list`, `targets.use`, `targets.new`, `targets.close` |
| Pages | `page.open`, `page.list`, `page.close` |
| Navigation | `nav.goto`, `nav.wait`, `nav.snapshot` |
| Interaction | `interact.click`, `interact.hover`, `interact.press`, `interact.check`, `interact.uncheck`, `interact.type`, `interact.select`, `interact.scroll`, `interact.scrollIntoView` |
| DOM | `dom.getHtml`, `dom.getText`, `dom.getAttr`, `dom.getValue`, `dom.isVisible`, `dom.isEnabled`, `dom.isChecked` |
| Export | `export.clonePage`, `export.cloneComponent` |
| DevTools | `devtools.perf`, `devtools.consolePoll`, `devtools.networkPoll`, `page.screenshot` |

## Session Lifecycle

1. **Launch**: Create/attach tab, enable CDP domains, create session with lease
2. **Active**: Handle commands, track console/network events
3. **Disconnect**: Schedule cleanup, detach CDP
4. **Expired**: TTL-based cleanup (20s for closing sessions)

## Constants

| Constant | Value |
|----------|-------|
| `MAX_CONSOLE_EVENTS` | 200 |
| `MAX_NETWORK_EVENTS` | 300 |
| `SESSION_TTL_MS` | 20,000 |
| `SCREENSHOT_TIMEOUT_MS` | 8,000 |
| `TAB_CLOSE_TIMEOUT_MS` | 5,000 |

## Chunked Responses

Large payloads (>MAX_OPS_PAYLOAD_BYTES) are chunked:
1. Send `OpsResponse` with `chunked: true`, `payloadId`, `totalChunks`
2. Send `OpsChunk` messages for each chunk

## Redaction

- `redactConsoleText()`: Redacts sensitive patterns in console output
- `redactUrl()`: Redacts sensitive URL parameters

## Anti-Patterns

| Never | Why |
|-------|-----|
| Skip session validation | Security: lease ownership |
| Ignore restricted URLs | Chrome internal pages blocked |
| Store refs across snapshots | Refs are snapshot-specific |
| Block on async operations | Use promise chaining |

## Dependencies

- `../services/CDPRouter` - CDP command routing
- `../services/TabManager` - Tab discovery
- `../services/url-restrictions` - URL validation
- `../types` - Ops protocol types
