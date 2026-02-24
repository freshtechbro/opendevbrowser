# extension/src/services/ — Agent Guidelines

CDP routing and tab management for extension relay. Extends `extension/AGENTS.md`.

## Overview

Flat-session CDP routing for Chrome 125+. Handles debugger attach/detach, target lifecycle, auto-attach, and multi-client CDP multiplexing.

## Structure

```
extension/src/services/
├── CDPRouter.ts           # Main orchestrator (658 lines) - flat-session routing
├── TargetSessionMap.ts    # Root/child session mapping
├── TabManager.ts          # Tab discovery, active tracking
├── ConnectionManager.ts   # Relay lifecycle, primary tab tracking
├── RelayClient.ts         # WebSocket handshake, health, framing
├── NativePortManager.ts   # Native host bridge (optional)
├── cdp-router-commands.ts # Target command helpers
└── url-restrictions.ts    # URL validation (chrome://, etc.)
```

## CDPRouter

**Chrome 125+ required** for flat sessions (DebuggerSession `sessionId` routing).

### Key Methods

| Method | Purpose |
|--------|---------|
| `attach(tabId)` | Attach debugger, validate flat sessions, register root |
| `detachAll()` | Detach all debuggers, cleanup state |
| `detachTab(tabId)` | Detach specific tab |
| `handleCommand(RelayCommand)` | Route CDP command to appropriate handler |
| `sendCommand(debuggee, method, params)` | Execute CDP command |

### CDP Commands Handled

| Command | Behavior |
|---------|----------|
| `Browser.getVersion` | Return mock version |
| `Target.setDiscoverTargets` | Enable/disable target discovery |
| `Target.getTargets` | List all targets |
| `Target.setAutoAttach` | Configure auto-attach with flatten |
| `Target.createTarget` | Create new tab |
| `Target.closeTarget` | Close tab |
| `Target.activateTarget` | Focus tab |
| `Target.attachToTarget` | Attach to child target |
| Others | Route via sessionId |

## TargetSessionMap

Tracks root and child sessions:

```typescript
type SessionRecord = {
  kind: "root" | "child";
  tabId: number;
  targetId: string;
  sessionId: string;
  rootSessionId: string;
  targetInfo: TargetInfo;
};
```

## Auto-Attach Flow

1. `Target.setAutoAttach({ autoAttach: true, flatten: true })`
2. `Target.attachedToTarget` event → register child session
3. Apply auto-attach to child session recursively
4. Track churn for session stability

## Session Churn Tracking

- **Churn window**: 5 seconds
- **Churn threshold**: 3 detach/attach cycles
- **Quarantine**: Track unknown sessions for recovery
- **Reapply**: Auto-retry auto-attach on churn

## Primary Tab Tracking

- `primaryTabId`: Current active tab for operations
- `lastActiveTabId`: Fallback for primary selection
- `onPrimaryTabChange` callback for notifications

## Stale Tab Recovery

When `attach()` fails with "No tab with given id":
1. Try active tab
2. Try first HTTP tab
3. Create new tab as fallback

## Anti-Patterns

| Never | Why |
|-------|-----|
| Use non-flat sessions | Chrome 125+ requirement |
| Skip flat session validation | Will fail on older Chrome |
| Ignore session churn | Unstable automation |
| Hardcode session IDs | Use TargetSessionMap |

## Dependencies

- `../types` - RelayCommand, RelayEvent, RelayResponse
- `../logging` - Error logging