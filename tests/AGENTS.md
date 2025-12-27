# Local AGENTS.md (tests/)

Applies to `tests/` and subdirectories. Extends root `AGENTS.md`.

## Testing Rules
- Use Vitest for unit/integration tests.
- Keep tests under `tests/` with `.test.ts` naming (per Vitest config).
- Keep coverage >=95% for `src/` (extension excluded from coverage thresholds).
- Prefer integration-style assertions over shallow/unit-only checks.
- Never weaken or delete tests to make them pass.

## Organization
- Keep test names descriptive and aligned to tool/action names.
- Extension tests should use existing Chrome mocks in `tests/`.
