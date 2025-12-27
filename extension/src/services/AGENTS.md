# Local AGENTS.md (extension/src/services)

Applies to `extension/src/services/`. Extends `extension/src/AGENTS.md` and root `AGENTS.md`.

## Responsibilities
- Manage CDP attach/detach and message forwarding.
- Normalize errors and route responses/events consistently.

## Safety & Constraints
- Handle detach/attach failures gracefully.
- Keep protocol message shapes consistent with `src/relay/` types.
- Avoid leaking tokens or tab content.

## Testing
- Add/adjust tests with Chrome debugger mocks where feasible.
