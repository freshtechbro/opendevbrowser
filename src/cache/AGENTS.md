# Local AGENTS.md (src/cache)

Applies to `src/cache/`. Extends `src/AGENTS.md` and root `AGENTS.md`.

## Local Architecture
- Resolves Chrome executable paths with config overrides; cached for BrowserManager startup.

## Responsibilities
- Locate Chrome executables and cache resolved paths.
- Keep platform detection deterministic and minimal.

## Safety & Constraints
- Prefer local filesystem checks; avoid network calls.
- Preserve fallback order and overrides from config.

## Testing
- Add/adjust Vitest coverage for platform paths and overrides.

## Documentation Sync
- Update `docs/REFACTORING_PLAN.md` if cache path or Chrome resolution behavior changes.

## Folder Structure
```
src/cache/
```
