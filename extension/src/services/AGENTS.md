# Local AGENTS.md (extension/src/services)

Applies to `extension/src/services/`. Extends `extension/src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- Bridges CDP attach/detach and forwards relay messages for background orchestration.
- WebSocket connections to relay include Chrome's automatic Origin header for CSWSH protection.

## Responsibilities
- Manage CDP attach/detach and message forwarding.
- Normalize errors and route responses/events consistently.

## Safety & Constraints
- Handle detach/attach failures gracefully.
- Keep protocol message shapes consistent with `src/relay/` types.
- Avoid leaking tokens or tab content.
- Chrome sends `Origin: chrome-extension://EXTENSION_ID` automatically; relay validates this.

## Documentation Sync
- Update `docs/EXTENSION.md` and `docs/REFACTORING_PLAN.md` if relay protocol behavior changes.

## Testing
- Add/adjust tests with Chrome debugger mocks where feasible.

## Folder Structure
```
extension/src/services/
```
