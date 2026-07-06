# tests/ - Agent Guidelines

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

- **Never weaken tests** to make them pass - fix the code
- **Never delete tests** without understanding why they fail
- **Add regression tests** for every bug fix
- **Keep mocks hermetic** (no real Chrome/network)
- **Keep Inspiredesign media-analysis dependency tests hermetic** by using fake FFmpeg/FFprobe executables, injected env/config paths, and synthetic media bytes. Do not require host FFmpeg/FFprobe for unit tests, and assert missing binaries degrade `media-analysis.json` only.
- **Keep AGENTS sync tests focused** for Inspiredesign media-analysis guidance: lock only the optional host FFmpeg/FFprobe contract, env/config/PATH/common absolute directory resolution for implicit `PATH`-source ENOENT misses, invalid env/config diagnostics that do not fall back, `status-capabilities.host.mediaAnalysis` as diagnostic/preflight only, no bundled or default-downloaded static binaries, missing binaries degrading `media-analysis.json` only, and authority separation among `pin-media-index.json`, `motion-evidence.json`, and `media-analysis.json`.
- **Keep package postinstall tests hermetic** by injecting npm lifecycle env, package roots, `dist/cli/index.js` paths, and autostart dependencies instead of writing real LaunchAgent or Task Scheduler state
- **Keep skill-sync tests target-complete** across OpenCode, Codex-through-Agents, ClaudeCode, AmpCLI, and Agents global/project-local roots, including target markers, per-pack sentinels, managed legacy Codex duplicate cleanup, partial-marker repair, and unmanaged markerless preservation
- **Keep workflow output guidance tests focused** on preventing routine `/tmp/...` or custom `artifacts/...` workflow roots while preserving explicit cleanup, debug, release, screenshot, screencast, and other evidence exceptions

## Coverage Scope

Covers `src/**/*.ts` with explicit exclusions from `vitest.config.ts` (including `src/cli/**`, `src/index.ts`, `src/relay/protocol.ts`, `src/tools/deps.ts`, `src/extension-extractor.ts`, `src/skills/types.ts`, `src/tools/skill_list.ts`, `src/tools/skill_load.ts`, and `extension/**`).

## Focus areas (current architecture)

- Hub daemon queueing + metadata recovery (`tests/daemon-*.test.ts`)
- Extension relay flat-session routing (`tests/extension-*.test.ts`)

## Documentation Sync

Update `docs/CLI.md` when CLI output or exit codes change.
Update README, `docs/CLI.md`, `docs/FIRST_RUN_ONBOARDING.md`, `docs/ARCHITECTURE.md`, and relevant AGENTS files when install, package postinstall, or daemon auto-start behavior changes.
Update release docs/runbooks when release-gate script behavior changes (`docs/RELEASE_RUNBOOK.md`, `docs/EXTENSION_RELEASE_RUNBOOK.md`, and the current version-scoped release evidence doc such as `docs/RELEASE_0.0.37_EVIDENCE.md`).

## CLI Smoke Tests

Use `node scripts/cli-smoke-test.mjs` for managed-mode coverage; document extension/CDP-connect runs in `docs/CLI.md`.

## Performance Gate

Run `npm run test -- tests/providers-performance-gate.test.ts` to enforce deterministic provider SLO baselines from `docs/benchmarks/provider-fixtures.md`.

## Release Audit Tests

Keep release audit test coverage green for:
- `tests/audit-zombie-files.test.ts`
- `tests/docs-drift-check.test.ts`
- `tests/chrome-store-compliance-check.test.ts`
- `tests/provider-live-scenarios.test.ts`
- `tests/provider-direct-runs.test.ts`
- `tests/live-regression-direct.test.ts`
- `tests/canvas-live-workflow-script.test.ts`
- `tests/annotate-live-probe-script.test.ts`
