# tests/ — Agent Guidelines

Testing conventions. Extends root `AGENTS.md`.

## Framework

- **Vitest** for unit/integration tests
- Coverage thresholds: ≥97% lines/functions/branches/statements
- Config: `vitest.config.ts`

Align integration coverage with runtime flows in `docs/ARCHITECTURE.md`.

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

Covers `src/**/*.ts` with explicit exclusions from `vitest.config.ts` (including `src/cli/**`, `src/index.ts`, `src/relay/protocol.ts`, `src/tools/deps.ts`, `src/extension-extractor.ts`, `src/skills/types.ts`, `src/tools/skill_list.ts`, `src/tools/skill_load.ts`, and `extension/**`).

## Focus areas (current architecture)

- Hub daemon queueing + metadata recovery (`tests/daemon-*.test.ts`)
- Extension relay flat-session routing (`tests/extension-*.test.ts`)

## Documentation Sync

Update `docs/CLI.md` when CLI output or exit codes change.

## CLI Smoke Tests

Use `node scripts/cli-smoke-test.mjs` for managed-mode coverage; document extension/CDP-connect runs in `docs/CLI.md`.

## Performance Gate

Run `npm run test -- tests/providers-performance-gate.test.ts` to enforce deterministic provider SLO baselines from `docs/benchmarks/provider-fixtures.md`.
