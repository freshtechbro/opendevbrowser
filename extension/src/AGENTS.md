# Local AGENTS.md (extension/src)

Applies to `extension/src/` and subdirectories. Extends `extension/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- `background.ts` orchestrates relay connections; `services/` handles CDP attach/detach and message forwarding.
- `popup.tsx` owns UI for pairing token and relay settings.

## Responsibilities
- Background script orchestrates connections and message routing.
- Popup UI handles user settings (pairing token, relay config).

## UI Settings
- Storage keys: `autoConnect`, `autoPair`, `pairingEnabled`, `pairingToken`, `relayPort`.
- Auto-connect and auto-pair default to on; keep defaults and docs in sync.

## Safety & Constraints
- Do not add non-local relay endpoints.
- Keep message schemas aligned with relay protocol.
- Do not log tokens or tab content.

## Testing
- Build with `npm run extension:build` after changes.
- Extension tests live under `tests/` with Chrome mocks.

## Documentation Sync
- Update `docs/EXTENSION.md` and `docs/REFACTORING_PLAN.md` when settings or UI behavior changes.

## Folder Structure
```
extension/src/
`-- services/
```
