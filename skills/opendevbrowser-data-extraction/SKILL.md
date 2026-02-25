---
name: opendevbrowser-data-extraction
description: This skill should be used when the user asks to "extract data from a page", "scrape tables", "collect paginated results", "parse list/card content", or "export structured web data" with OpenDevBrowser.
version: 2.0.0
---

# Data Extraction Skill

Use this skill to extract structured, auditable datasets from dynamic pages with compliance-aware workflows.

## Pack Contents

- `artifacts/extraction-workflows.md`
- `assets/templates/extraction-schema.json`
- `assets/templates/pagination-state.json`
- `assets/templates/quality-gates.json`
- `assets/templates/compliance-checklist.md`
- `scripts/run-extraction-workflow.sh`
- `scripts/validate-skill-assets.sh`
- Shared robustness matrix: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

## Fast Start

```bash
./skills/opendevbrowser-data-extraction/scripts/validate-skill-assets.sh
./skills/opendevbrowser-data-extraction/scripts/run-extraction-workflow.sh list
./skills/opendevbrowser-data-extraction/scripts/run-extraction-workflow.sh pagination
./skills/opendevbrowser-data-extraction/scripts/run-extraction-workflow.sh infinite-scroll
```

## Core Rules

- Define schema before extraction.
- Track provenance for each record (`source_url`, `provider`, `captured_at`, `page`).
- Prefer embedded structured data (JSON-LD/microdata) where available.
- Stop on sustained anti-bot pressure (repeated 403/429/challenge loops).
- Honor `Retry-After` and preserve checkpoint state before retrying pagination.

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Run extraction acceptance on `managed`, `extension`, and `cdpConnect` before claiming mode parity.
- Keep one session per worker; avoid interleaving `target-use` streams inside a single session.

## Robustness Coverage (Known-Issue Matrix)

Matrix source: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

- `ISSUE-01`: stale refs after dynamic content updates
- `ISSUE-06`: 429/backoff and retry budgeting
- `ISSUE-08`: blocked/restricted origins and policy checks
- `ISSUE-09`: pagination drift, duplicate accumulation, terminal detection
- `ISSUE-10`: locale/currency parsing consistency

## Extraction Planning

1. Define required fields and null policy.
2. Snapshot and map refs to schema.
3. Choose pagination strategy.
4. Apply quality gates each page.

```text
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
```

## Structured Data First

Attempt extraction in this order:
1. JSON-LD product/article blocks
2. semantic table/list/card DOM
3. fallback text parsing

```text
opendevbrowser_dom_get_text sessionId="<session-id>" ref="<json-ld-ref>"
opendevbrowser_dom_get_html sessionId="<session-id>" ref="<table-ref>"
```

## Pagination Patterns

### Numbered/Next pagination

```text
opendevbrowser_click sessionId="<session-id>" ref="<next-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
```

### Infinite scroll

```text
opendevbrowser_scroll sessionId="<session-id>" dy=1000
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
```

### Load more

```text
opendevbrowser_click sessionId="<session-id>" ref="<load-more-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
```

## Quality Gates

Apply per page:
- dedupe by stable key (URL or canonical ID)
- null-rate check for required fields
- count delta check (new records must increase)
- consistency check for currency/units
- max consecutive challenge/429 loops before stop

Use `assets/templates/quality-gates.json`.

## Compliance and Safety

- Respect robots and site terms.
- Use pacing; do not flood endpoints.
- Treat robots as policy guidance, not auth.
- Stop or back off on repeated 429/403 and challenges.

## References

- RFC 9309 (robots protocol): https://www.rfc-editor.org/rfc/rfc9309
- Google robots docs: https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
- Schema.org Offer: https://schema.org/Offer
- Google Product structured data: https://developers.google.com/search/docs/appearance/structured-data/product-snippet
- Playwright best practices: https://playwright.dev/docs/best-practices
