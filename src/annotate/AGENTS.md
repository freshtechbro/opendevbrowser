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
- **Purpose:** Chat-scoped annotation queue with repo-local persistence for explicit Send actions
- **Limits:** 20 injected items max, 256KB max serialized system block per scope
- **Retention:** 200 entries total, 50 unread entries, 7-day TTL
- **Scope TTL:** 10 minutes for active chat scope registrations
- **Deduplication:** 60-second window for identical payload, source, and label

```typescript
const inbox = new AgentInbox(worktree);
inbox.registerScope(chatScopeKey, { agent, model });
inbox.enqueue({ payload, source, label });
const entries = inbox.consumeScope(chatScopeKey);
```

### DirectAnnotator
- **Purpose:** Inject annotation UI into pages via CDP and return the captured payload to the caller
- **Assets:** `annotate-content.js`, `annotate-content.css` from extension build
- **Timeout:** Default 120s
- **Modes:** Screenshot capture (`visible`|`full`|`none`)

```typescript
const { assets } = resolveDirectAnnotateAssets();
if (!assets) throw new Error("Direct annotate assets unavailable.");

const result = await runDirectAnnotate(manager, assets, {
  sessionId, targetId, screenshotMode: "visible"
});
```

### AgentInboxStore
- **Purpose:** JSONL-backed persistence with atomic writes
- **Location:** `.opendevbrowser/annotate/agent-inbox.jsonl`
- **Scopes:** `.opendevbrowser/annotate/agent-scopes.json`
- **Features:** Hash-based dedup, TTL cleanup, scope expiry (10min)

## Patterns

### Annotation Flow
1. User triggers annotation from the CLI/tool, extension popup, in-page UI, or canvas surface.
2. **Direct capture path:** CDP/Playwright injection lets the user select elements and returns the payload to the requesting CLI/tool call.
3. **Relay capture path:** `/annotation` forwards `start` and `cancel` commands to the extension and returns annotation events/responses.
4. **Send path:** popup, canvas, and in-page `Send` actions dispatch `annotation:sendPayload` to extension background, which posts `store_agent_payload` on `/annotation`.
5. **Shared inbox path:** core bootstrap handles `store_agent_payload` locally with `AgentInbox.enqueue(...)`; one active scope becomes `delivered`, zero or multiple active scopes become `stored_only` with `no_active_scope` or `ambiguous_scope`.
6. Agent consumes the matching scope through the system block and acknowledges consumed receipts.

### Annotation V2 Compact Handoff

- Explicit Send defaults to compact Annotation V2 payloads with `schemaVersion: 2`; screenshot-free metadata, stable element identity, anchor, selector, and note summaries must remain enough for follow-up without storing full screenshots.
- Compact handoff must use the shared annotation redaction path before relay, inbox persistence, or system-block injection. Do not add one-off redaction logic in browser, relay, extension, or CLI response code.
- System injection is a compact summary boundary only: include bounded, redacted fields needed for agent action, and keep screenshots, raw DOM dumps, unrestricted selector bags, and oversized user text out of the injected block.
- Stored payload behavior remains explicit-user-send only; compact defaults do not make passive annotation capture eligible for inbox persistence.

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
| Store screenshots in JSONL | Shared persistence strips screenshots and keeps only screenshot asset metadata |
| Skip hash deduplication | Creates duplicate entries |
| Treat stored-only receipts as delivery | Stored-only means explicit `annotate --stored` retrieval is required |
| Bypass scope registration | Entries need one active chat scope for delivered routing |

## Dependencies

- `playwright-core` - Page injection
- `../utils/fs.ts` - Atomic writes
- `../relay/protocol.ts` - Types
- `../extension-extractor.ts` - Asset paths

## Testing

- Mock `Page` for direct annotator tests
- Use temp directories for inbox store tests
- Test deduplication, TTL cleanup, scope expiry
