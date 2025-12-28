# Local AGENTS.md (extension/)

Applies to `extension/` and subdirectories. Extends root `AGENTS.md`.

## Architecture
- Extension connects only to local relay; do not add non-local endpoints.
- Relay URL/port must be configurable (no hardcoded relay URL).
- Keep `background.ts` focused on connection orchestration and message routing.
- Keep `popup.tsx` focused on UI + user-configurable settings (pairing token, relay settings).
- CDP attach/detach and message forwarding live under `extension/src/services/`.

## TypeScript
- Prefer `import type` for Chrome and message types.
- Keep message schemas aligned with the relay protocol (no local drift).

## Testing
- Extension tests live in `tests/` and use Chrome mocks.
- Build with `npm run extension:build` when validating extension changes.

## Safety
- Do not log tokens or tab content.

## Folder Structure
```
extension/
|-- dist/
`-- src/
```
