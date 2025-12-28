# Local AGENTS.md (src/)

Applies to `src/` and subdirectories. Extends root `AGENTS.md`.

## Architecture
- Keep module boundaries: `cache/`, `browser/`, `snapshot/`, `devtools/`, `export/`, `relay/`, `tools/`, `skills/`.
- Keep tools thin (arg validation + response shaping); place core logic in managers/services.
- Snapshot/ref work must align with Architecture Alignment rules in root `AGENTS.md`.
- Relay changes must preserve localhost-only and honor configurable relay port/token.
- Config toggles (devtools verbosity, snapshot limits, unsafe export) flow through managers into module behavior.

## TypeScript
- Prefer `import type` for type-only imports (common across src).
- Validate tool/config inputs with Zod schemas; keep runtime validation at boundaries.

## Testing
- Add/update Vitest tests in `tests/` for behavior changes.

## Safety
- Do not log secrets or captured page data.

## Folder Structure
```
src/
|-- browser/
|-- cache/
|-- devtools/
|-- export/
|-- relay/
|-- skills/
|-- snapshot/
`-- tools/
```
