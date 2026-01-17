# tests/ — Agent Guidelines

Testing conventions. Extends root `AGENTS.md`.

## Framework

- **Vitest** for unit/integration tests
- Coverage thresholds: ≥95% lines/functions/branches/statements
- Config: `vitest.config.ts`

## Conventions

| Rule | Details |
|------|---------|
| Naming | `*.test.ts` files only |
| Location | All tests in `tests/` directory |
| Mocking | Use existing Chrome/Playwright mocks |
| Style | Integration-style assertions preferred |

## Running Tests

```bash
npm run test                        # All tests with coverage
npm run test -- tests/foo.test.ts   # Single file
npm run test -- -t "test name"      # Single test by name
```

## Critical Rules

- **Never weaken tests** to make them pass—fix the code
- **Never delete tests** without understanding why they fail
- **Add regression tests** for every bug fix
- **Keep mocks hermetic** (no real Chrome/network)

## Coverage Scope

Covers `src/**/*.ts` only. Extension excluded from thresholds.

## Documentation Sync

Update `docs/CLI.md` when CLI output or exit codes change.
