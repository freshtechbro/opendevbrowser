# Phase 3 rp-optimize Setup Plan

## Task 1 - Add benchmark instrumentation scaffold
Reasoning: Phase 3 needs repeatable baseline measurements without adding production overhead.
What to do: Add a secondary CLI/tools latency benchmark script and support fixtures.
How:
1. Create `scripts/cli-tools-latency-baseline.mjs` with option parsing, subcase execution, summary calculations, stability diagnostics, and scoreboard writing.
2. Create `tests/support/cli-tools-latency-bench-fixtures.ts` with shared fixture constants and deterministic latency helper functions for tests.
3. Keep all measurement code outside production paths. Use script-owned `.tmp/cli-tools-latency` bundles for process and fresh-process module subcases so measurements always reflect current source rather than possibly stale `dist/**` artifacts.
Files impacted: `scripts/cli-tools-latency-baseline.mjs` (new), `tests/support/cli-tools-latency-bench-fixtures.ts` (new).
Acceptance criteria:
- [x] Script supports `--samples`, `--warmup`, `--trials`, and `--out`.
- [x] Script reports primary, aggregate, group, and per-subcase medians/p95s.
- [x] Measurement instrumentation stays outside production paths; production source changes in this branch are limited to the lazy CLI dispatch optimization.

## Task 2 - Add focused benchmark tests
Reasoning: Optimization decisions depend on trustworthy measurement and scoreboard behavior.
What to do: Add a focused Vitest suite for statistics, scoreboard scaffold creation, row insertion, and deduping.
How:
1. Create `tests/cli-tools-latency-baseline.test.ts`.
2. Import exported helpers from the benchmark script.
3. Assert deterministic percentile behavior, scaffold content, baseline row formatting, and dedupe identity.
Files impacted: `tests/cli-tools-latency-baseline.test.ts` (new).
Acceptance criteria:
- [x] Focused benchmark tests pass.
- [x] Tests do not require running the full benchmark loop.

## Task 3 - Capture baseline and update local scoreboard
Reasoning: Phase 3 must produce the baseline row before candidate optimizations begin.
What to do: Build the project, run the benchmark command, and write `prompt-exports/optimize-cli-tools-runs.md`.
How:
1. Run `npm run build`.
2. Run `node scripts/cli-tools-latency-baseline.mjs --samples 40 --warmup 8 --trials 3 --out prompt-exports/optimize-cli-tools-runs.md`.
3. Record aggregate p95, subcase diagnostics, variance, environment notes, command, branch, and commit.
Files impacted: `prompt-exports/optimize-cli-tools-runs.md` (local ignored file).
Acceptance criteria:
- [x] Baseline row includes primary, aggregate, and all subcase p50/p95 diagnostics.
- [x] Variance and stability status are recorded.
- [x] Full planned sample count was used for the baseline run.

## Task 4 - Record worker continuity and final verification
Reasoning: This phase runs as a sub-agent and must leave a durable local handoff without touching `CONTINUITY.md`.
What to do: Append completed work, fixed issues, and learnings to `sub_continuity.md`, then report exact commands and exit codes.
How:
1. Append a concise Phase 3 setup entry to `sub_continuity.md`.
2. Run focused tests for the benchmark script/support.
3. Report touched files, commands, exit codes, baseline metrics, stability assessment, and concerns.
Files impacted: `sub_continuity.md` (local ignored file).
Acceptance criteria:
- [x] `sub_continuity.md` is created or appended.
- [x] `CONTINUITY.md` was reserved for the main orchestrator.
- [x] Closeout includes exact command outcomes and measurement concerns.
