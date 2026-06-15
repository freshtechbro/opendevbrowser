# Deal Hunting Workflows

## Runtime buying-brief workflow

1. Run `opendevbrowser shopping run` with explicit providers and a reproducible browser mode.
2. Open `deals.md` first and read the Buying Readiness Gate.
3. Treat `pass` as bounded buying guidance, `partial` as a constrained shortlist, and `fail` as no confident purchase recommendation.
4. Review the Recommendation, Best Candidate Offers, Market Baseline, Warnings and Constraints, and Evidence Appendix before advising the user.
5. Audit `offers.json`, `comparison.csv`, and `meta.json` before publishing a final buying decision.

## Raw artifact audit workflow

1. Use `offers.json` to inspect raw `offer_id`, `product_id`, `provider`, `url`, `title`, `price`, `shipping`, `availability`, `rating`, `reviews_count`, `deal_score`, and `attributes`.
2. Use `comparison.csv` for a compact tabular comparison of provider, title, total price inputs, deal score, availability, URL, currency, and total-status evidence.
3. Use `meta.json` to inspect selected providers, failures, alerts, primary constraints, and offer filter diagnostics.
4. Use `deals-context.json` for agent handoff only; its runtime keys are `query`, `highlights`, `offers`, and `meta`.

## Market baseline workflow

1. Read the Market Baseline section in `deals.md`.
2. Trust average, median, and lowest-total values only when the report says the baseline was computed from same-currency evidence.
3. Treat `market baseline unavailable` as the correct output when sample size or currency coverage is insufficient.
4. Do not claim market savings, price history, or verified discount quality unless explicit evidence is present in the report and raw artifacts.

## Anchor reliability workflow

1. Detect whether explicit anchor, list, original, or MSRP price evidence exists per offer.
2. Treat anchor/list discount as unavailable when the report says no explicit anchor/list price evidence was present.
3. Distinguish anchor/list discount from market baseline comparison.
4. Avoid former-price or sale-price claims unless the raw attributes support them.

## Freshness and availability workflow

1. Read freshness status in Best Candidate Offers and Evidence Appendix.
2. Treat observed fresh timestamps as stronger evidence than inferred, missing, or stale timestamps.
3. Treat unknown availability as a confidence limiter and out-of-stock as not promotable.
4. Keep constrained or excluded offers in raw evidence, but do not promote them as confident recommendations.

## Relevance and duplicate-pressure workflow

1. Review weak-relevance and suspicious-title warnings before naming a candidate.
2. Treat duplicate same-title or same-product groups as pressure against independent recommendations.
3. Use duplicate groups in the Evidence Appendix to explain why similar marketplace listings were constrained.
4. Preserve duplicate raw offers for audit while keeping recommendation language conservative.
