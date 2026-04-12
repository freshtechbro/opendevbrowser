---
name: opendevbrowser-research
description: Deterministic multi-source research workflow with strict timebox and artifact outputs.
version: 2.1.0
---

# Research Skill

Use this skill when you need benchmark-style research across public `web|community|social` sources by default, with explicit shopping opt-in only for commercial comparison tasks.

## Pack Contents

- `artifacts/research-workflows.md`
- `assets/templates/compact.md`
- `assets/templates/context.json`
- `assets/templates/report.md`
- `scripts/run-research.sh`
- `scripts/render-output.sh`
- `scripts/write-artifacts.sh`
- `scripts/validate-skill-assets.sh`
- Shared robustness matrix: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

## Fast Start

```bash
./skills/opendevbrowser-research/scripts/validate-skill-assets.sh
./skills/opendevbrowser-research/scripts/run-research.sh "browser automation" 30 context
./skills/opendevbrowser-research/scripts/render-output.sh "browser automation" compact
```

## Supporting Surfaces

- Use browser replay (`screencast-start` / `screencast-stop`) when claim review needs temporal UI evidence or parity proof from browser-backed runs.
- Use desktop observation only for read-only external-window or native-dialog evidence that materially affects the research artifact chain.
- Use `--challenge-automation-mode off|browser|browser_with_helper` for bounded browser-scoped computer use in research workflows; it is not a desktop agent.

## Core Rules

- Define timebox first (`--days` or `--from/--to`).
- Prefer explicit sources for high-stakes claims.
- Persist artifacts and return reproducible paths.
- Mark unsupported claims as tentative; do not overstate certainty.
- Honor bounded retries and backoff windows under 429 pressure.

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Run research acceptance in `managed`, `extension`, and `cdpConnect` where browser-backed evidence capture is used.
- Keep provider query orchestration mode-agnostic; isolate browser interaction per session worker.

## Robustness Coverage (Known-Issue Matrix)

Matrix source: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

- `ISSUE-06`: upstream throttling and retry discipline
- `ISSUE-09`: pagination/result drift across sources
- `ISSUE-10`: locale/currency normalization consistency
- `ISSUE-12`: stale evidence and claim traceability

## Workflow

1. Resolve timebox (`days` or `from/to`).
2. Choose sources (`auto|web|community|social|shopping|all`).
3. Run `opendevbrowser research run`.
4. Return requested mode output and artifact path.

## Commands

```bash
opendevbrowser research run --topic "<topic>" --days 30 --source-selection auto --mode context
opendevbrowser research run --topic "<topic>" --source-selection auto --mode json
opendevbrowser research run --topic "<topic>" --sources web,shopping --mode md
```

## Notes

- `auto` is the recommended default for topical research.
- In the current contract, both `auto` and `all` resolve to `web|community|social`.
- Use `--source-selection shopping` or explicit `--sources ...shopping...` to include shopping only when commercial intent is explicit.
- Use `--mode path` with `scripts/write-artifacts.sh` when you need replayable handoff bundles.
- For browser-backed release proof and mode sweeps, follow the canonical direct-run evidence policy in `../opendevbrowser-best-practices/SKILL.md`.
