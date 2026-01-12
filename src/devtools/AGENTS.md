# Local AGENTS.md (src/devtools)

Applies to `src/devtools/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- Trackers attach to pages and emit redacted console/network events for tooling.
- Redaction defaults to safe output; config toggles allow full URLs/console when opted in.
- Enhanced token detection: 16+ char threshold with API key prefix patterns (sk_, pk_, api_, key_).
- URL path segment redaction removes token-like patterns from paths.

## Responsibilities
- Track console events and expose sequence-based polling.
- Keep attachment/detachment safe for page lifecycle changes.
- Redact sensitive tokens with improved detection (lowered threshold, common prefixes).
- Redact token-like path segments from network URLs.

## Safety & Constraints
- Maintain monotonic sequence IDs and bounded buffers.
- Avoid logging sensitive page content.
- Token redaction uses 2+ character categories for 16+ char strings.
- API key prefixes (sk_, pk_, api_, key_, token_, secret_, bearer_) always trigger redaction.
- Path segments are redacted if they match token patterns (preserves UUIDs and numeric IDs).

## Testing
- Add/adjust Vitest coverage for polling and buffer bounds.

## Documentation Sync
- Update `docs/REFACTORING_PLAN.md` if devtools redaction rules change.

## Folder Structure
```
src/devtools/
```
