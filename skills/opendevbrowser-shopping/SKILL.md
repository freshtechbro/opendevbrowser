---
name: opendevbrowser-shopping
description: Deterministic multi-provider shopping and deal-comparison workflow.
version: 2.1.0
---

# Shopping Skill

Use this skill for deterministic shopping runs, conservative deal comparison, and decision-ready review of generated shopping artifacts.

Reliable defaults:
- before daemon-backed `shopping run` workflows, run `opendevbrowser status --daemon --output-format json` and continue only when `data.fingerprintCurrent === true`
- start with explicit providers for reproducible reruns
- prefer `--browser-mode managed` unless relay-backed session state is required
- treat `--region` as advisory unless workflow output reports `meta.selection.region_authoritative=true`

## Pack Contents

- `artifacts/deal-hunting-workflows.md`
- `assets/templates/deals-context.json`
- `assets/templates/deals-table.md`
- `assets/templates/market-analysis.json`
- `assets/templates/deal-thresholds.json`
- `scripts/run-shopping.sh`
- `scripts/normalize-offers.sh`
- `scripts/render-deals.sh`
- `scripts/analyze-market.sh`
- `scripts/run-deal-hunt.sh`
- `scripts/validate-skill-assets.sh`
- Shared robustness matrix: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

## Fast Start

```bash
./skills/opendevbrowser-shopping/scripts/validate-skill-assets.sh
./skills/opendevbrowser-shopping/scripts/run-shopping.sh "wireless earbuds" context best_deal
./skills/opendevbrowser-shopping/scripts/run-deal-hunt.sh "wireless earbuds" "shopping/amazon,shopping/walmart"
```

## Supporting Surfaces

- Use browser replay (`screencast-start` / `screencast-stop`) when offer churn, price changes, or challenge timing needs temporal evidence.
- Use desktop observation only for read-only evidence around sibling desktop surfaces; provider collection stays browser-first.
- Use `--challenge-automation-mode off|browser|browser_with_helper` for bounded browser-scoped computer use on provider challenge branches; it is not desktop automation.

## Runtime Artifact Contract

Successful shopping bundles preserve separate user and audit surfaces:

- `deals.md`: primary deterministic buying brief with a Buying Readiness Gate, Recommendation, Best Candidate Offers, Market Baseline, Warnings and Constraints, Excluded or Constrained Offers, and Evidence Appendix.
- `offers.json`: raw structured offer evidence.
- `comparison.csv`: tabular provider, title, price, shipping, deal score, availability, and URL comparison, with appended currency and total-status audit fields.
- `meta.json`: workflow diagnostics, selected providers, alerts, failures, and filter diagnostics.
- `deals-context.json`: agent handoff context with `query`, report-derived `highlights`, raw `offers`, and `meta`.

`compact` and `context` modes summarize the report guidance. `json` mode still returns raw offers plus meta.

## Decision Model

Use the runtime buying brief as the source of truth for purchase guidance:

1. Read the Buying Readiness Gate.
- `pass`: evidence supports bounded buying guidance for the current shortlist.
- `partial`: offers are usable as a constrained shortlist, but evidence gaps limit confidence.
- `fail`: no confident purchase recommendation is allowed.

2. Review warnings before naming a candidate.
- Freshness warnings include stale, inferred, or missing price timestamps.
- Availability warnings include unknown or out-of-stock offers.
- Relevance warnings include weak query fit or suspicious titles.
- Duplicate warnings mean same-title or same-product offers appear across multiple URLs.
- Advisory region warnings mean requested regional comparison is not authoritative.

3. Check raw artifacts when decisions matter.
- Audit prices and URLs in `offers.json` and `comparison.csv`.
- Audit workflow failures, alerts, and filter constraints in `meta.json`.
- Do not claim seller trust, return policy, warranty, condition, shipping certainty, or price history unless the raw offer attributes and report text explicitly include them.

## Market Baseline And Savings

The runtime Market Baseline section is conservative:

- It computes average, median, and lowest total only from a deterministic same-currency sample.
- It reports `market baseline unavailable` when sample size or currency coverage is insufficient.
- It reports anchor/list discount only when explicit anchor, list, original, or MSRP evidence is present.
- It does not invent savings from a sale label, hidden list price, unrelated currency, or missing price-history source.

The helper script `scripts/analyze-market.sh` can be used for offline analysis of exported offers, but it is not automatically invoked by `opendevbrowser shopping run`. Treat script output as supplemental unless it is copied into the final evidence review with its inputs.

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Validate shopping workflows across `managed`, `extension`, and `cdpConnect` when browser-backed provider paths are exercised.
- Keep one session per worker for parallel offer collection and avoid session-level target contention.
- For browser-backed release proof and mode sweeps, follow the canonical direct-run evidence policy in `../opendevbrowser-best-practices/SKILL.md`.

## Robustness Coverage (Known-Issue Matrix)

Matrix source: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

- `ISSUE-06`: rate-limit/backoff handling while collecting offers
- `ISSUE-09`: dedupe and pagination drift controls in offer collection
- `ISSUE-10`: currency normalization and same-currency grouping
- `ISSUE-11`: weak or missing anchor price detection
- `ISSUE-12`: stale price and unsupported claim controls

## Canonical Workflow

1. Run shopping search across selected providers.
2. Open `deals.md` first and classify readiness as `pass`, `partial`, or `fail`.
3. Inspect warnings for freshness, availability, relevance, duplicate pressure, market baseline, workflow alerts, and advisory region limits.
4. Audit raw evidence in `offers.json`, `comparison.csv`, and `meta.json` before giving buying advice.
5. Use helper scripts only as optional offline analysis over exported raw artifacts.

```bash
opendevbrowser shopping run --query "<query>" --providers shopping/amazon,shopping/walmart --mode json --output-format json
opendevbrowser shopping run --query "wireless ergonomic mouse" --providers shopping/bestbuy,shopping/ebay --budget 150 --browser-mode managed --mode json --output-format json
opendevbrowser shopping run --query "27 inch 4k monitor" --providers shopping/bestbuy,shopping/ebay --budget 350 --sort lowest_price --browser-mode managed --mode json --output-format json
```

Diagnostics rules:
- inspect `meta.primaryConstraintSummary` before classifying a zero-offer run as a provider failure
- inspect `meta.offerFilterDiagnostics` to see whether zero price, budget, or region-currency filters removed candidate offers
- if `meta.alerts` includes `reasonCode=region_unenforced`, do not present the output as a trustworthy regional comparison

## Candidate Decision Rules

Use confident wording only when the report gate allows it:

- Do not override a `fail` gate with a buying recommendation.
- Treat `partial` as a constrained shortlist, not a final answer.
- Treat out-of-stock, weak-relevance, suspicious-title, stale-freshness, duplicate-pressure, and advisory-region warnings as constraints.
- Prefer candidates with observed fresh price evidence, usable title, strong query fit, available stock, and an available same-currency market baseline.
- State when market baseline, anchor/list discount, seller trust, returns, warranty, condition, or price history are unavailable.

## References

- FTC Guides Against Deceptive Pricing (16 CFR 233): https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-233
- NIST SP 1181 (unit pricing and value comparison): https://www.nist.gov/publications/unit-pricing-guide
- Schema.org Offer (price metadata): https://schema.org/Offer
