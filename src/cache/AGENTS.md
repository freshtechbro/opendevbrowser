# Local AGENTS.md (src/cache)

Applies to `src/cache/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Responsibilities
- Locate Chrome executables and cache resolved paths.
- Keep platform detection deterministic and minimal.

## Safety & Constraints
- Prefer local filesystem checks; avoid network calls.
- Preserve fallback order and overrides from config.

## Testing
- Add/adjust Vitest coverage for platform paths and overrides.
