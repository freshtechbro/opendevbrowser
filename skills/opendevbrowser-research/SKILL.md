---
name: opendevbrowser-research
description: Skill-guided, evidence-gated research workflow for provider-constrained public source gathering and auditable artifact review.
version: 2.1.0
---

# Research Skill

Load this skill before research tasks. Use it to plan source families, gather provider-constrained evidence, review artifacts, and publish only claims that survive the evidence gate.

`opendevbrowser research run` is a low-level, best-effort primitive. It can collect and render provider results, but the skill owns source planning, blocker review, confidence, limitations, and final synthesis.

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
./skills/opendevbrowser-research/scripts/run-research.sh "browser automation" 30 context "web,community"
./skills/opendevbrowser-research/scripts/render-output.sh "browser automation" compact
```

## Supporting Surfaces

- Use browser replay (`screencast-start` / `screencast-stop`) when claim review needs temporal UI evidence or parity proof from browser-backed runs.
- Use desktop observation only for read-only external-window or native-dialog evidence that materially affects the research artifact chain.
- Use `--challenge-automation-mode off|browser|browser_with_helper` for bounded browser-scoped computer use in research workflows; it is not a desktop agent.

## Core Rules

- Define timebox first (`--days` or `--from/--to`).
- Choose explicit source families before invoking the CLI primitive: `web`, `community`, `social`, `shopping`, or a deliberate combination such as `web,community`.
- Treat `auto` as a source-family selector, not a reliability guarantee.
- Persist artifacts and return reproducible paths.
- Mark unsupported claims as tentative or exclude them from the final answer.
- Honor bounded retries and backoff windows under 429 pressure.

## Evidence Gate

Review artifacts before publishing claims. A successful command exit or rendered report is not enough.

Preserved artifact files:

- `summary.md`
- `report.md`
- `records.json`
- `context.json`
- `meta.json`
- `bundle-manifest.json`

Required review:

1. Read `records.json` for fetched source records, timestamps, providers, extraction quality, and blockers.
2. Read `context.json` for source ledger, evidence gaps, unsupported claims, staleness checks, and search-engine provenance when used.
3. Read `meta.json` for provider limits, warnings, no-evidence failures, cookie diagnostics, challenge/auth/token failures, and artifact generation details.
4. When gated providers such as Reddit block evidence, rerun only with user-authorized recovery: `--browser-mode extension` for an existing signed-in relay session, `--use-cookies` only when legitimate cookies are available, and `--challenge-automation-mode browser_with_helper` for browser-scoped assistance.
5. Use `report.md` and `summary.md` only after confirming claims map back to accepted evidence.
6. Do not use shell-only, stale-only, login-only, not-found-only, or zero-source-evidence runs to support final claims.

## Search Engine Discovery Lane

This lane is optional, skill-guided, provider-constrained, and discovery-only. It can improve breadth, but it is not a reliable default and does not replace `opendevbrowser research run` or the evidence gate.

1. Choose up to five engines based on topic and availability. Candidate set: Google, Bing, Brave, DuckDuckGo or Yahoo for overlap checks, Yandex for regional or index diversity, Baidu for China-specific topics, and Kagi only when the user has account access.
2. Record engine choice rationale, query variants, region and language assumptions, auth or cookie needs, and blockers.
3. Collect up to 10 result URLs per selected engine. Preserve engine, query, rank, URL, title if available, and retrieval notes.
4. Dedupe canonical URLs, then select the strongest 5 to 10 destination pages for extraction.
5. Extract destination pages through OpenDevBrowser browsing primitives when useful, including DOM interaction, screenshots, cookies, and authenticated browsing when the user has legitimate access.
6. Do not violate robots restrictions, login walls, consent gates, CAPTCHAs, rate limits, anti-bot controls, or access controls. Stand down and record limitations instead.
7. Keep SERPs discovery-only. SERP snippets, result pages, shells, and blocked pages cannot be final evidence.
8. Final claims must cite destination pages or other fetched evidence that survived review.

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
2. Choose explicit source families and document why they fit the topic.
3. Optionally run the search-engine discovery lane to find destination candidates.
4. Run `opendevbrowser research run` as a low-level best-effort primitive.
5. Review `records.json`, `context.json`, and `meta.json` before trusting `report.md`.
6. If `meta.json` shows auth, token, challenge, or cookie-gated providers, make the next run skill-first: use the existing signed-in browser session when authorized, cookies only when legitimate cookies are available, and browser-scoped challenge assistance only for that browser session.
7. Return final claims only when they are supported by accepted evidence.

## Commands

```bash
opendevbrowser research run --topic "<topic>" --days 30 --sources web,community --mode context
opendevbrowser research run --topic "<topic>" --sources web --mode json
opendevbrowser research run --topic "<topic>" --sources web,shopping --mode md
```

## Notes

- `auto` and `all` are selector values in the current source-family contract, not promises of reliable coverage.
- Use `--source-selection shopping` or explicit `--sources ...shopping...` to include shopping only when commercial intent is explicit.
- Use `--mode path` with `scripts/write-artifacts.sh` when you need replayable handoff bundles.
- For browser-backed release proof and mode sweeps, follow the canonical direct-run evidence policy in `../opendevbrowser-best-practices/SKILL.md`.
