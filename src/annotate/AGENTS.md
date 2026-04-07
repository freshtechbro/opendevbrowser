# src/annotate/ — Agent Guidelines

Extends `src/AGENTS.md`.

**Scope:** Annotation transport coordination, direct annotation execution, and repo-local agent inbox store

## Overview

Owns the annotation pipeline from capture to delivery. Handles direct CDP-based annotation (injecting scripts into pages), relay-based annotation dispatch, and the repo-local agent inbox for persistent annotation storage. Integrates with extension relay for cross-context annotation delivery.

## Structure

```
src/annotate/
├── agent-inbox.ts          # Main AgentInbox API - enqueue, consume, acknowledge
├── agent-inbox-store.ts    # JSONL persistence, scope management, deduplication
├── direct-annotator.ts     # CDP-based annotation injection and capture
├── output.ts               # Annotation response formatting
└── timeout-messages.ts     # User-friendly timeout error messages
```

## Key Classes

### AgentInbox
- **Purpose:** Chat-scoped annotation queue with persistence
- **Limits:** 20 items max, 256KB max payload per scope
- **Retention:** 200 entries, 7-day TTL
- **Deduplication:** 60-second window for identical payloads

```typescript
const inbox = new AgentInbox(worktree);
inbox.registerScope(chatScopeKey, { agent, model });
inbox.enqueue({ payload, source, label });
const entries = inbox.consumeScope(chatScopeKey);
```

### DirectAnnotator
- **Purpose:** Inject annotation UI into pages via CDP
- **Assets:** `annotate-content.js`, `annotate-content.css` from extension build
- **Timeout:** Default 120s
- **Modes:** Screenshot capture (full|viewport|none)

```typescript
const result = await directAnnotate(manager, {
  sessionId, targetId, screenshotMode: "viewport"
});
```

### AgentInboxStore
- **Purpose:** JSONL-backed persistence with atomic writes
- **Location:** `.opendevbrowser/annotate/agent-inbox.jsonl`
- **Scopes:** `.opendevbrowser/annotate/agent-scopes.json`
- **Features:** Hash-based dedup, TTL cleanup, scope expiry (10min)

## Patterns

### Annotation Flow
1. User triggers annotation (extension popup or canvas)
2. **Direct path:** CDP injection → user draws → payload captured → stored in inbox
3. **Relay path:** Extension captures → relay dispatch → inbox store
4. Agent consumes scope → system block injected → acknowledged

### System Block Format
```
[opendevbrowser-agent-inbox]
External annotation payloads were explicitly sent to this chat session...
{ items: [...] }
[opendevbrowser-agent-inbox]
```

## Required sync points

When public annotation capture, relay delivery, or stored-payload behavior changes:
- `docs/ANNOTATE.md`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/privacy.md`

## Limits

| Resource | Limit |
|----------|-------|
| Items per scope | 20 |
| Payload bytes per scope | 256KB |
| Total retention | 200 entries |
| Entry TTL | 7 days |
| Deduplication window | 60 seconds |
| Scope TTL | 10 minutes |

## Anti-Patterns

| Never | Why |
|-------|-----|
| Store screenshots in JSONL | Asset refs only; screenshots stored separately |
| Skip hash deduplication | Creates duplicate entries |
| Bypass scope registration | Entries need chat scope for routing |

## Dependencies

- `playwright-core` - Page injection
- `../utils/fs.ts` - Atomic writes
- `../relay/protocol.ts` - Types
- `../extension-extractor.ts` - Asset paths

## Testing

- Mock `Page` for direct annotator tests
- Use temp directories for inbox store tests
- Test deduplication, TTL cleanup, scope expiry
