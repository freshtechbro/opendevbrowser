---
name: opendevbrowser-research
description: Deterministic multi-source research workflow with strict timebox and artifact outputs.
version: 2.0.0
---

# Research Skill

Use this skill when you need benchmark-style research across `web|community|social|shopping` with strict timebox semantics and stable output modes.

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
opendevbrowser research run --topic "<topic>" --days 30 --mode context
opendevbrowser research run --topic "<topic>" --source-selection all --mode json
opendevbrowser research run --topic "<topic>" --sources web,shopping --mode md
```

## Notes

- `auto` resolves to `web|community|social` in v1.
- Use `--source-selection all` or `--sources shopping,...` to include shopping.
- Use `--mode path` with `scripts/write-artifacts.sh` when you need replayable handoff bundles.
