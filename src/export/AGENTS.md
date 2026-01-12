# Local AGENTS.md (src/export)

Applies to `src/export/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- DOM capture runs in page context and sanitizes via DOM parsing by default.
- Inline subtree computed styles with node caps; surface warnings; `allowUnsafeExport` bypasses sanitization with warning.
- SVG sanitization removes embedded scripts and foreignObject elements.
- CSS injection protection blocks dangerous patterns (url(), expression(), -moz-binding).

## Responsibilities
- Export CSS and normalize styles for snapshots.
- Preserve `.opendevbrowser-root` scoping wrapper.
- Sanitize SVG elements (remove scripts, foreignObject, event handlers).
- Sanitize inline styles (block url(), expression(), javascript:, -moz-binding, behavior:).

## Safety & Constraints
- Keep output deterministic; avoid leaking raw page data.
- Do not introduce DOM mutations during export.
- SVG elements have all `<script>` and `<foreignObject>` children removed.
- SVG event handlers (on*) are stripped from all descendant elements.
- Inline styles with dangerous CSS patterns are replaced with `/* blocked */`.

## Testing
- Add/adjust Vitest coverage for CSS aggregation and scoping.

## Documentation Sync
- Update `docs/REFACTORING_PLAN.md` if export safety behavior changes.

## Folder Structure
```
src/export/
```
