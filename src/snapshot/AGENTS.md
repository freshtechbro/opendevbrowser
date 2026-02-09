# Snapshot Module

**Scope:** AX-tree snapshots, ref management, accessibility tree processing

## Overview

Converts Chrome's Accessibility (AX) tree into actionable snapshots with stable refs. Enables script-first UX: snapshot → refs → actions.

## Structure

```
src/snapshot/
├── snapshotter.ts    # Main orchestrator - CDP session, snapshot building
├── refs.ts           # RefStore - ref registry per target
└── ops-snapshot.ts   # AX-tree processing, selector generation
```

## Key Classes

### Snapshotter
- **CDP session:** Per-page CDP session for DOM/AX queries
- **Snapshot modes:** `outline` (structure), `actionables` (interactive only)
- **Pagination:** Cursor-based for large pages (`maxChars`, `nextCursor`)
- **Timing:** Tracks snapshot generation time

### RefStore
- **Per-target registry:** `Map<targetId, Map<ref, RefEntry>>`
- **Ref format:** `r1`, `r2`, `r3` (stable index-based refs per snapshot)
- **Snapshot tracking:** UUID per snapshot for cache validation
- **Resolution:** `resolve(targetId, ref) → RefEntry | null`

### RefEntry
```typescript
type RefEntry = {
  ref: string;           // Stable reference ID
  selector: string;      // CSS selector for element
  backendNodeId: number; // CDP backend node ID
  frameId?: string;      // Frame context
  role?: string;         // ARIA role
  name?: string;         // Accessible name
}
```

## Snapshot Flow

1. **Capture:** CDP `Accessibility.getFullAXTree`
2. **Process:** Resolve selectors via `DOM.resolveNode`/`Runtime.callFunctionOn`, then build entries with refs and metadata
3. **Store:** Register in RefStore per target
4. **Format:** Generate outline or actionables text
5. **Return:** Snapshot with refs, truncated flag, timing

## Action Mapping

Refs enable actions without re-snapshot:
- `click(ref)` → resolve → backendNodeId → CDP click
- `type(ref, text)` → resolve → element → fill
- `hover(ref)` → resolve → element → hover

## Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `outline` | Full page structure | Navigation, exploration |
| `actionables` | Interactive elements only | Form filling, clicking |

## Dependencies

- `playwright-core` - CDP session management
- Chrome DevTools Protocol - AX tree queries

## Anti-Patterns

- Never store refs across snapshots (validate with snapshotId)
- Never bypass RefStore for element resolution
- Never assume ref stability across page navigations
