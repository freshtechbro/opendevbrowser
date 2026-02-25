# Deal Hunting Workflows

## Baseline deal workflow

1. Query providers
2. Normalize offers
3. Compute market averages/medians
4. Rank by true savings
5. Attach confidence tier and warnings per currency group

## Cross-provider verification workflow

1. Start from discounted listing
2. Query same product across alternate providers
3. Compare totals in same currency
4. Report verified savings and confidence

## High-value prioritization workflow

1. Compute percent discount
2. Compute absolute savings
3. Tag high-value if both thresholds pass
4. Present top-ranked offers first

## Anchor reliability workflow

1. Detect whether anchor/list price exists per offer
2. Compute anchor coverage by currency group
3. Distinguish anchor-only discounts from market-beating discounts
4. Warn when anchor evidence is weak

## Freshness workflow

1. Capture offer retrieval timestamp when available
2. Compute price age hours
3. Flag stale or missing timestamps
4. Lower confidence tier when freshness coverage is low
