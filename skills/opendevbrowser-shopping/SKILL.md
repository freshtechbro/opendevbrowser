---
name: opendevbrowser-shopping
description: Deterministic multi-provider shopping and deal-comparison workflow.
version: 2.0.0
---

# Shopping Skill

Use this skill for robust deal hunting across providers with market-baseline validation and savings analysis.

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

## Deal-Hunting Model

Use a two-layer check for each offer:

1. Provider discount check
- Compare listed total to provider anchor price (MSRP/list/original) when available.
- Capture absolute savings and percentage savings.

2. Market baseline check
- Compare listed total against cross-provider market average and median.
- Flag offers that are truly cheaper than market, not just marked "on sale".

## Parallel Multitab Alignment

- Apply shared concurrency policy from `../opendevbrowser-best-practices/SKILL.md` ("Parallel Operations").
- Validate shopping workflows across `managed`, `extension`, and `cdpConnect` when browser-backed provider paths are exercised.
- Keep one session per worker for parallel offer collection and avoid session-level target contention.

## Savings Math

Per offer:
- `total_price = item_price + shipping`
- `anchor_savings_abs = max(anchor_price - total_price, 0)`
- `anchor_savings_pct = anchor_savings_abs / anchor_price * 100`

Per market group (same currency):
- `market_avg = average(total_price)`
- `market_median = median(total_price)`
- `market_savings_abs = market_avg - offer_total`
- `market_savings_pct = market_savings_abs / market_avg * 100`

This captures both:
- high-percentage discounts (for example 50% off)
- high-absolute savings (for example $500 saved)

## Robustness Coverage (Known-Issue Matrix)

Matrix source: `../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md`

- `ISSUE-06`: rate-limit/backoff handling while collecting offers
- `ISSUE-09`: dedupe and pagination drift controls in offer collection
- `ISSUE-10`: currency normalization and same-currency grouping
- `ISSUE-11`: weak/missing anchor price detection
- `ISSUE-12`: stale price and unsupported claim controls

## Canonical Workflow

1. Run shopping search across selected providers.
2. Normalize offers into stable records.
3. Compute market analysis with `analyze-market.sh`.
4. Render markdown/json summary for user decision.

```bash
opendevbrowser shopping run --query "<query>" --providers shopping/amazon,shopping/walmart --mode json --output-format json
```

## Classification Heuristics

Default tags from analysis script:
- `high_percent` when anchor discount percent exceeds threshold.
- `high_absolute` when anchor discount absolute exceeds threshold.
- `high_value` when both are true.
- `market_beating` when offer is materially below market average.

Threshold defaults are in `assets/templates/deal-thresholds.json`.

Confidence model:
- score combines sample size, anchor coverage, and freshness coverage.
- warnings call out low-sample, missing-anchor, and stale/missing timestamp risk.

## Good Deal Decision Rules

Mark as strong only when at least one is true:
- anchor discount is material and market gap is positive
- market price is materially below average/median even without anchor

Avoid false positives:
- anchor discount exists but market total is not competitive
- low total due to unavailable stock or hidden constraints

## References

- FTC Guides Against Deceptive Pricing (16 CFR 233): https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-233
- NIST SP 1181 (unit pricing and value comparison): https://www.nist.gov/publications/unit-pricing-guide
- Schema.org Offer (price metadata): https://schema.org/Offer
