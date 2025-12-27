# Local AGENTS.md (src/browser)

Applies to `src/browser/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Responsibilities
- Manage Playwright session lifecycle and target routing in `BrowserManager`.
- Coordinate snapshots, refs, and user actions (click/type/select/scroll).

## Safety & Constraints
- Enforce localhost-only CDP endpoints and config-controlled overrides.
- Clean up temporary profiles; avoid persisting data unless configured.

## Testing
- Add/adjust Vitest coverage for lifecycle and action paths in `tests/`.
