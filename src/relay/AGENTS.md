# Local AGENTS.md (src/relay)

Applies to `src/relay/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- Defines relay protocol types shared by plugin runtime and extension.
- Relay connections remain local and honor configurable `relayPort`/`relayToken`.

## Responsibilities
- Define relay protocol types and message shapes.
- Keep handshake metadata stable across versions.

## Safety & Constraints
- Avoid breaking changes to protocol types without coordinated updates.
- Do not hardcode relay endpoints; use config.

## Testing
- Add/adjust Vitest coverage for protocol typing utilities.

## Folder Structure
```
src/relay/
```
