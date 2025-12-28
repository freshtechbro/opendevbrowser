# Local AGENTS.md (src/export)

Applies to `src/export/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- DOM capture runs in page context and sanitizes via DOM parsing by default.
- Inline subtree computed styles with node caps; surface warnings; `allowUnsafeExport` bypasses sanitization with warning.

## Responsibilities
- Export CSS and normalize styles for snapshots.
- Preserve `.opendevbrowser-root` scoping wrapper.

## Safety & Constraints
- Keep output deterministic; avoid leaking raw page data.
- Do not introduce DOM mutations during export.

## Testing
- Add/adjust Vitest coverage for CSS aggregation and scoping.

## Folder Structure
```
src/export/
```
