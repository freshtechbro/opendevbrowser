# Local AGENTS.md (src/devtools)

Applies to `src/devtools/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- Trackers attach to pages and emit redacted console/network events for tooling.
- Redaction defaults to safe output; config toggles allow full URLs/console when opted in.

## Responsibilities
- Track console events and expose sequence-based polling.
- Keep attachment/detachment safe for page lifecycle changes.

## Safety & Constraints
- Maintain monotonic sequence IDs and bounded buffers.
- Avoid logging sensitive page content.

## Testing
- Add/adjust Vitest coverage for polling and buffer bounds.

## Folder Structure
```
src/devtools/
```
