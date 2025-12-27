# Local AGENTS.md (src/export)

Applies to `src/export/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Responsibilities
- Export CSS and normalize styles for snapshots.
- Preserve `.opendevbrowser-root` scoping wrapper.

## Safety & Constraints
- Keep output deterministic; avoid leaking raw page data.
- Do not introduce DOM mutations during export.

## Testing
- Add/adjust Vitest coverage for CSS aggregation and scoping.
