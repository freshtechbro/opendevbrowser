# Investigation: Shopping Workflow Output Quality

## Summary
The shopping workflow produces useful raw offer evidence, but weak buying guidance because the final artifact layer renders ranked offers directly instead of compiling a deterministic buying brief. The strongest future path is to preserve the current raw artifacts for auditability and add a shopping-specific synthesis/gating layer at the renderer seam, analogous to the recent deterministic research-report work.

## Symptoms
- The reviewed shopping bundle produces usable raw offers, but weak buying guidance.
- Duplicate eBay listings appear in the recommendation set.
- Relevance for "ergonomic" is questionable in some offers.
- Availability is unknown or not verified strongly enough for financial decision support.
- One Best Buy offer title appears to have been extracted as rating text instead of the product title.
- The workflow may surface stale, closed, or expired offers.
- The current artifact set (`deals.md`, `comparison.csv`, `offers.json`) may not provide a clear primary decision-ready buying report.

## Background / Prior Research
- Recent internal pattern: PR #83 (`0c3498603f8b6658709401a9edcaaacbe7c29f8b`, feature commit `7cfebb6092a491cd9e7a779b4c8f386e013492a0`) improved research output by adding a deterministic report compiler at the renderer seam, preserving raw artifacts, and introducing evidence gates plus fixture tests. The reusable shopping pattern is not to rewrite collection first, but to add a focused shopping report/gate seam analogous to `src/providers/research-report/`.
- Research PR #83 kept raw artifacts as audit evidence while making `report.md` the primary decision-ready output. The closest shopping analogue is to keep `offers.json`, `comparison.csv`, `meta.json`, and `deals-context.json`, while making `deals.md` a real buying briefing rather than a raw ranked list.
- Research PR #83 made diagnostics affect output readiness. Shopping should similarly avoid confident deal language when availability, freshness, price confidence, seller trust, and duplicate collapse are weak.
- External product pattern: Klarna's May 20, 2026 Shopping Search announcement frames AI shopping around real-time product discovery with up-to-date prices, availability, offers from multiple merchants, relevance-based organic results, and labeled sponsored placements: [Klarna Shopping Search in ChatGPT](https://investors.klarna.com/News--Events/news/news-details/2026/Klarna-launches-AI-powered-Shopping-Search-app-in-ChatGPT/default.aspx).
- External product pattern: Klarna's 2024 assistant announcement emphasizes personalized recommendations, product/category comparisons, pros and cons, reviews, stock, delivery, cashback, price history, and accurate pricing/availability: [Klarna assistant features](https://www.klarna.com/international/press/shopping-made-smarter-klarna-adds-more-ai-features-to-its-assistant-powered-by-openai/).
- External product pattern: price-history tools such as Keepa and CamelCamelCamel make historical price context central to whether a price is a deal, not just a displayed sale price: [Keepa](https://keepa.com/) and [CamelCamelCamel](https://camelcamelcamel.com/).
- External product pattern: Amazon's shopping assistant now surfaces 30, 90, and 365 day price history so shoppers can decide whether a current price is actually good: [Amazon price history](https://www.aboutamazon.com/news/retail/how-to-check-amazon-price-history).
- External product pattern: Capital One Shopping describes automated coupon testing, price comparisons, shipping-cost checks, price-drop notifications, rewards, and third-party site notices as part of the shopping assistant surface: [Capital One Shopping](https://www.capitalone.com/learn-grow/money-management/capital-one-shopping/).
- External data-quality baseline: Google Merchant Center treats product title accuracy, price, availability, landing-page/checkout match, shipping, and returns as core commerce data. Merchant listing structured data highlights price, availability, shipping, and return information as shopper-facing facts: [Merchant Center product data](https://support.google.com/merchants/answer/7052112) and [Google merchant listing structured data](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing).
- External trust baseline: FTC endorsement guidance says material relationships that would affect how consumers evaluate an endorsement should be clearly disclosed. FTC deceptive pricing guidance says former-price and comparison-price claims need bona fide factual support: [FTC endorsement guidance](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking) and [16 CFR Part 233](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-233).

## Investigator Findings

### Source-code trace, 2026-06-15

#### Finding 1 - Runtime path hypothesis is confirmed
**Evidence:**
- CLI parsing enters daemon RPC in `src/cli/commands/shopping.ts:264-285`, and the daemon command dispatches `shopping.run` into `runShoppingWorkflow()` in `src/cli/daemon-commands.ts:876-894`.
- The OpenCode tool path resolves the provider runtime, imports `runShoppingWorkflow()`, and forwards shopping args plus the resolved output dir in `src/tools/shopping_run.ts:33-53`.
- `runShoppingWorkflow()` builds the resume envelope, resolves the artifact root, compiles the shopping execution plan, executes it, postprocesses the runs, calls `renderShopping()`, and writes the artifact bundle in `src/providers/workflows.ts:5667-5877`.

**Conclusion:** Confirmed. The path is CLI/tool to workflow to compiler/executor to `postprocessShoppingWorkflow()` to `renderShopping()` to artifact bundle.

#### Finding 2 - `renderShopping()` is a raw-ranked-list renderer, not a decision-ready buying report
**Evidence:**
- `ShoppingOffer` exposes basic offer fields only: id, product id, provider, URL, title, price timestamp, shipping, availability, rating, reviews, score, and attributes in `src/providers/renderer.ts:111-130`. There is no first-class seller trust, market baseline, duplicate group, warning, recommendation, or gate status field.
- `compactShoppingLines()` returns at most ten strings of `title - total (provider, deal=score)` in `src/providers/renderer.ts:772-786`.
- `renderShopping()` uses those lines as both the markdown body and context highlights, then emits only `deals.md`, `offers.json`, `comparison.csv`, `meta.json`, and `deals-context.json` in `src/providers/renderer.ts:788-824`.
- `comparison.csv` contains provider, title, price, shipping, deal score, availability, and URL only in `src/providers/renderer.ts:755-768`.

**Conclusion:** Confirmed. `deals.md` is currently a compact sorted offer list plus metadata, not a buying brief with a recommendation, confidence, exclusions, warnings, or a do-not-buy gate.

#### Finding 3 - Postprocess scoring and filtering allow weak offers to survive
**Evidence:**
- `filterShoppingOffers()` filters only non-positive price, region-currency mismatch, and budget overage in `src/providers/shopping-postprocess.ts:491-501`. It does not filter unknown or out-of-stock availability, stale or missing freshness, weak relevance, suspicious titles, missing seller trust, or duplicate product groups.
- Unknown and out-of-stock availability are merely score inputs: `availabilityRank()` assigns `unknown` 0.45 and `out_of_stock` 0.1 in `src/providers/shopping-postprocess.ts:333-344`, then `computeDealScore()` weights availability at 20 percent and recency at 10 percent in `src/providers/shopping-postprocess.ts:347-354`.
- Missing price timestamps are treated as current because `extractShoppingOffer()` falls back to `now.toISOString()` when nested `retrieved_at` is missing in `src/providers/shopping-postprocess.ts:377-379`.
- Duplicate collapse keys exact canonical URL plus lowercase title in `dedupeOffers()` in `src/providers/shopping-postprocess.ts:504-513`, so same-title or same-product marketplace listings with different URLs survive as separate offers.
- `rankOffers()` only uses query relevance for `best_deal`; `lowest_price`, `highest_rating`, and `fastest_shipping` ignore query relevance in `src/providers/shopping-postprocess.ts:516-548`. Even `best_deal` ranks weak matches after stronger matches instead of rejecting them in `src/providers/shopping-postprocess.ts:535-548`.
- There is no seller-trust input in the runtime offer type in `src/providers/renderer.ts:111-130`. The eBay provider profile says the extraction focus includes seller and condition in `src/providers/shopping/index.ts:224-229`, but `extractEbaySearchCandidates()` parses title, price, rating, reviews, image, and availability, not seller trust or condition, in `src/providers/shopping/index.ts:1535-1571`.

**Conclusion:** Confirmed with nuance. Postprocess behaves like a permissive normalization and ranking pass. It produces useful raw offers, but it does not enforce buying-quality gates.

#### Finding 4 - Suspicious-title handling exists in provider extraction, but there is no final runtime gate
**Evidence:**
- The provider layer has some title guardrails: `isRatingOnlyTitle()` is defined in `src/providers/shopping/index.ts:1143-1145`, generic result-card extraction rejects rating-only titles in `src/providers/shopping/index.ts:1656-1670`, and Best Buy regressions cover rating-only anchors in `tests/providers-shopping-branches.test.ts:140-207`.
- Those protections are incomplete as a runtime contract. `resolveCardProductAnchor()` rejects short, generic, and price-only titles but does not call `isRatingOnlyTitle()` in `src/providers/shopping/index.ts:977-1004`.
- `extractShoppingOffer()` accepts the nested offer title or record title without suspicious-title validation in `src/providers/shopping-postprocess.ts:381-386`, while `isLikelyOfferRecord()` only rejects URL-like or provider-domain mismatched search records in `src/providers/shopping-postprocess.ts:550-576`.

**Conclusion:** Partly refuted for the provider layer and confirmed for final output quality. Current extraction has targeted protections, but the artifact renderer has no last-mile title-quality gate, so bad titles can still reach `deals.md` if they pass provider extraction or arrive through a mocked/custom/runtime record.

#### Finding 5 - Product-detail follow-through is mainly recovery or product-video work, not normal search-card validation
**Evidence:**
- `deriveShoppingFetchSteps()` only considers fetch recovery after a completed search step, then exits early when the search result has failures, any likely offer record, or shopping issue hints in `src/providers/shopping-compiler.ts:254-281`.
- `executeShoppingWorkflowPlan()` runs search steps first, derives selective fetch recovery only after that, then runs those fetch steps in `src/providers/shopping-executor.ts:242-253`.
- Executor tests prove the recovery lane is for search-index output with product links, not already extracted cards: `tests/providers-shopping-executor.test.ts:110-154` derives a fetch step from a completed zero-offer search-index record, and `tests/providers-shopping-executor.test.ts:433-599` reuses a checkpointed search-index result and merges the recovery fetch result.
- Product-video has the richer product-detail path: it fetches the resolved product URL in `src/providers/workflows.ts:6457-6520`, optionally refreshes weak metadata, then extracts product offer fields in `src/providers/workflows.ts:6557-6561`.

**Conclusion:** Confirmed. Normal shopping search-card offers are not automatically followed to PDPs for availability, seller, title, price freshness, or trust validation.

#### Finding 6 - Skill/runtime contract drift is real
**Evidence:**
- The shopping skill promises two-layer provider discount plus market baseline checks in `skills/opendevbrowser-shopping/SKILL.md:42-48`, market average and median math in `skills/opendevbrowser-shopping/SKILL.md:58-61`, confidence warnings for sample size, anchor coverage, and freshness in `skills/opendevbrowser-shopping/SKILL.md:102-106`, and strong-deal rules that avoid unavailable stock or hidden constraints in `skills/opendevbrowser-shopping/SKILL.md:108-116`.
- The bundled workflow artifact guide expects market averages, true savings, confidence tier, warnings, anchor reliability, and freshness flags in `skills/opendevbrowser-shopping/artifacts/deal-hunting-workflows.md:5-37`.
- The bundled market-analysis script computes anchor savings, market gaps, stale or missing price flags, confidence scores, and warnings in `skills/opendevbrowser-shopping/scripts/analyze-market.sh:68-140`, `skills/opendevbrowser-shopping/scripts/analyze-market.sh:178-236`, and renders confidence and warning lines in `skills/opendevbrowser-shopping/scripts/analyze-market.sh:267-300`.
- The runtime `deals-context.json` payload is only query, highlights, offers, and meta in `src/providers/renderer.ts:809-814`, while the skill template includes a `market.currency_summaries` slot in `skills/opendevbrowser-shopping/assets/templates/deals-context.json:1-9`.
- Public CLI docs are more conservative than the skill: they document shopping flags and tell users to inspect `meta.primaryConstraintSummary` and `meta.offerFilterDiagnostics` when no final offers exist in `docs/CLI.md:482-520`; they do not claim a runtime market baseline report.

**Conclusion:** Confirmed. The strongest drift is between the bundled shopping skill assets and the runtime shopping artifacts. The skill has analysis semantics that the runtime does not call or render.

#### Finding 7 - Research-report gives the closest deterministic shopping seam
**Evidence:**
- Research now has a separate report package exported from `src/providers/research-report/index.ts:1-11`.
- `buildResearchBriefing()` turns accepted records and metadata into a gate, passages, themes, claims, final answer, limitations, recommendations, and accepted-destination overlap notes in `src/providers/research-report/synthesis.ts:23-52`.
- `evaluateEvidenceGate()` computes pass, partial, or fail from accepted record count, independent domains, usable content, rejected-candidate pressure, blocking diagnostics, workflow alerts, and anti-bot failures in `src/providers/research-report/gate.ts:73-187`.
- `renderResearchBriefingMarkdown()` renders evidence gate status, final answer, claim map, theme synthesis, agreement or disagreement, confidence, limitations, recommendations, and evidence appendix in `src/providers/research-report/render.ts:260-318`.
- `renderResearch()` wires that report into artifacts as `report.md` while preserving raw `summary.md`, `records.json`, `context.json`, and `meta.json` in `src/providers/renderer.ts:661-702`.
- Tests assert report artifact presence and report sections in `tests/providers-workflow-primitives.test.ts:173-183`, direct compiler artifact defaults in `tests/providers-research-report.test.ts:1450-1469`, and live-quality regressions in `tests/providers-research-report-quality.test.ts:1-260`.

**Conclusion:** Confirmed. The analogous shopping seam should be a deterministic shopping-report compiler used by `renderShopping()` or by a new `buildShoppingReport()` helper, not a rewrite of provider collection first.

### Minimal scoped future implementation path
1. Add a `src/providers/shopping-report/` package analogous to `research-report` with small modules for `types`, `rules`, `gate`, `synthesis`, and `render`.
2. Feed it the existing `offers`, `query`, and `meta` from `renderShopping()`, preserving raw `offers.json`, `comparison.csv`, and `meta.json`.
3. Compute a deterministic buying gate with explicit criteria: duplicate pressure, query relevance, availability confidence, price freshness, price trust, seller or marketplace trust availability, region authority, sample size, and diagnostic alerts.
4. Render `deals.md` as the primary buying brief, or add `buying-report.md` while keeping `deals.md` backward-compatible if compatibility is required by maintainers.
5. Add focused tests before implementation: duplicate same-title different-URL group, unknown and out-of-stock availability warning, stale or missing retrieved_at warning, weak relevance warning, suspicious title rejection or warning, no seller-trust warning, skill market baseline fields, and artifact section assertions.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Shopping output quality is limited by a gap between raw offer extraction and deterministic buying guidance, similar to the pre-fix research workflow gap before PR #83 added a primary decision-ready report.
**Findings:** Confirmed at the artifact layer. The sample bundle has concrete offers, prices, providers, and URLs, but the primary markdown is only a ranked raw list. It repeats exact-title eBay rows, ranks non-ergonomic titles above some ergonomic titles, marks every selected offer as `availability: "unknown"`, and includes one Best Buy row whose title is review/rating accessibility text.
**Evidence:** `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/deals.md:3` and `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/deals.md:4` are the only clearly ergonomic title hits. `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/deals.md:5` through `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/deals.md:10` are generic wireless optical mouse listings. `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/deals.md:11` shows the Best Buy title extraction failure. `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/comparison.csv:4` and `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/comparison.csv:5` are duplicate exact-title eBay rows with unknown availability, while `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/comparison.csv:6` through `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/comparison.csv:8` are another near-duplicate group. `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/deals-context.json:2` records the query, `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/deals-context.json:24` records capture time on the first offer, and `.opendevbrowser/shopping/26dbb1b8-b0b8-498f-ad47-b7b0e4a1bbb1/deals-context.json:31` records unknown availability.
**Conclusion:** The output is useful as raw offer evidence but not yet decision-ready buying guidance. The report needs to investigate both extraction quality and the missing synthesis/gating layer.

## What Works
- The workflow has a coherent end-to-end execution path from CLI/tool entrypoints to workflow execution, postprocess, renderer, and artifact bundle.
- Raw offer capture is real enough to be useful: offers have provider IDs, URLs, prices, price timestamps, shipping placeholders, availability fields, ratings/reviews when parsed, deal scores, and provider diagnostics.
- Existing filters handle zero prices, budget overage, region-currency mismatch, direct-match ranking pressure, accessory penalties, and some provider-specific bad-title cases.
- The current artifact set is useful for audit: `offers.json` carries raw structured offers, `comparison.csv` is machine-readable, `meta.json` preserves diagnostics, and `deals-context.json` links the user query to highlights and offers.

## What Does Not Work
- The primary markdown artifact is not decision-ready. It is a raw ranked list with metadata, not a buying report.
- Duplicate product pressure is not controlled well enough for marketplace listings with different URLs.
- Unknown availability is treated as a scoring input instead of a confidence limiter for purchase advice.
- Missing freshness evidence can be normalized into a current timestamp, so stale or unverified prices are not clearly separated from freshly checked prices.
- Query relevance is only a ranking input for `best_deal`; it is not an explicit gate or user-facing explanation.
- Seller trust, return policy, warranty, condition, marketplace seller identity, and shipping certainty are not first-class buying guidance fields.
- The shopping skill promises market-baseline and confidence analysis that the runtime shopping artifacts do not currently render.

## Output Artifact Decision
Keep the multi-file bundle. The current files serve different jobs and should not be collapsed into one artifact. The gap is not too many files; the gap is that there is no primary decision-ready buying report. The safest contract is to preserve `offers.json`, `comparison.csv`, `meta.json`, and `deals-context.json` as evidence while making `deals.md` the shopping equivalent of research `report.md`, or adding `buying-report.md` if maintainers need `deals.md` to remain backward-compatible.

## Root Cause
The primary root cause is the absence of a shopping synthesis and readiness-gating layer between postprocess and markdown rendering.

`runShoppingWorkflow()` already follows a coherent architecture: compile, execute provider searches, postprocess offers, render artifacts, and create the bundle in `src/providers/workflows.ts:5667-5877`. The provider and postprocess layers therefore are not empty. They capture offer URLs, prices, timestamps, provider IDs, availability when available, ratings, diagnostics, and raw metadata.

The problem is that `renderShopping()` turns postprocessed offers directly into `deals.md` through `compactShoppingLines()` in `src/providers/renderer.ts:772-824`. That function emits at most ten lines shaped as `title - total (provider, deal=score)`. It does not produce a recommendation, confidence tier, duplicate group explanation, stale-price warning, availability warning, relevance assessment, merchant trust note, market baseline, limitation section, or next-step checklist.

Postprocess behaves like permissive normalization and ranking, not buying-quality validation. `filterShoppingOffers()` filters only non-positive price, region-currency mismatch, and budget overage in `src/providers/shopping-postprocess.ts:491-501`. `computeDealScore()` still gives `unknown` availability a score of `0.45` and weighs availability as only 20 percent of the total score in `src/providers/shopping-postprocess.ts:333-354`. Missing `retrieved_at` falls back to `now.toISOString()` in `src/providers/shopping-postprocess.ts:377-379`, so missing freshness evidence can appear fresh unless a later report layer flags it. `dedupeOffers()` keys on canonical URL plus lowercase title in `src/providers/shopping-postprocess.ts:504-513`, which explains why same-title marketplace listings with different URLs can survive.

The provider layer has some guardrails, so the critique should be precise. Title extraction is not wholly unguarded: `isRatingOnlyTitle()` exists in `src/providers/shopping/index.ts:1143-1145`, generic card extraction rejects rating-only titles in `src/providers/shopping/index.ts:1664-1669`, and Best Buy branch tests cover rating-only anchors in `tests/providers-shopping-branches.test.ts:140-207`. The remaining issue is that there is no final report-level suspicious-title gate before an offer reaches `deals.md`.

Product-detail follow-through also exists, but mainly as recovery. `deriveShoppingFetchSteps()` exits when search results already contain likely offer records in `src/providers/shopping-compiler.ts:268-280`, and `executeShoppingWorkflowPlan()` only runs those derived fetch steps after the search phase in `src/providers/shopping-executor.ts:243-253`. That means normal search-card offers can become final offers without PDP verification for stock, seller trust, shipping, title quality, or current price.

There is also a skill/runtime contract gap. The shopping skill asks for provider discount checks, market baseline checks, confidence warnings, stale-price controls, and decision-ready markdown/json output in `skills/opendevbrowser-shopping/SKILL.md:46-118`. The bundled market analyzer can compute anchor savings, market gaps, stale/missing price flags, confidence, and warning rows in `skills/opendevbrowser-shopping/scripts/analyze-market.sh:68-140`, `skills/opendevbrowser-shopping/scripts/analyze-market.sh:178-236`, and `skills/opendevbrowser-shopping/scripts/analyze-market.sh:267-300`. Runtime `deals.md` does not use those semantics today.

The closest proven internal pattern is research PR #83. `renderResearch()` now calls `buildResearchBriefing()` and `renderResearchBriefingMarkdown()` in `src/providers/renderer.ts:657-702`, while preserving raw artifacts. `src/providers/research-report/` implements evidence gates, final answers, limitations, recommendations, and diagnostics. Shopping needs that same class of deterministic report seam, with shopping-specific criteria.

## Recommendations
1. Preserve the current raw artifacts. Do not consolidate away `offers.json`, `comparison.csv`, `meta.json`, or `deals-context.json`; they are useful audit and debugging evidence. The better contract is a primary decision-ready markdown report plus raw evidence files.

2. Make `deals.md` the primary buying briefing, or add `buying-report.md` only if backward compatibility requires leaving `deals.md` as a raw list. The research workflow precedent favors preserving raw artifacts while improving the primary markdown artifact.

3. Add a deterministic `src/providers/shopping-report/` package in a future implementation branch. Keep it analogous to `src/providers/research-report/`, with narrow modules for report types, rules, gate evaluation, synthesis, and markdown rendering.

4. Gate confident buying guidance on shopping-specific evidence. Minimum inputs should include duplicate pressure, query-fit tier, availability confidence, price freshness, price trust, seller or marketplace trust availability, shipping/return visibility, region authority, sample size, and diagnostics.

5. Add product-group reasoning before final recommendation. Group exact-title or same-product marketplace listings across distinct URLs when material differences are not visible, and explain preserved variants only when condition, seller, bundle, shipping, warranty, return policy, color, size, or model differs.

6. Treat unknown availability as a confidence limiter. Unknown availability should not prevent raw offer output, but it should prevent labels such as `Strong buy` unless product-page or cart-page evidence verifies stock.

7. Treat missing or stale price timestamps as report warnings. The current fallback to `now` is useful for runtime normalization, but the report layer should distinguish observed timestamp, inferred timestamp, and missing freshness evidence.

8. Add suspicious-title and weak-relevance checks at the report layer. Do not rely only on provider extraction filters. If a title looks like rating text, a generic accessory, or a weak match for the requested constraints, the report should exclude it from confident recommendations or label it clearly.

9. Align the shopping skill with runtime behavior after implementation. Either wire the market-analysis/confidence concepts into runtime output or revise the skill to avoid promising output that the runtime does not generate.

10. Use external product-quality benchmarks as acceptance criteria. The future report should expose checked time, provider, merchant/seller, total cost, availability, expiration/freshness, price-history or market-baseline confidence, return/warranty notes when available, source URL, and affiliate/ad disclosure if applicable.

## Preventive Measures
- Add focused shopping-report tests before implementation. Cover report section order, pass/partial/fail gate status, raw artifact preservation, and no unsupported buying recommendation on fail.
- Add duplicate-pressure regressions for same-title and same-product marketplace listings with distinct URLs.
- Add availability regressions where `unknown` and `out_of_stock` offers can remain in raw evidence but cannot produce confident `best deal` language.
- Add freshness regressions for missing `retrieved_at`, stale `retrieved_at`, and inferred timestamps.
- Add relevance regressions where generic wireless mouse, accessory, or used-inventory results are partial or excluded for an ergonomic-mouse query unless the user asked for them.
- Add suspicious-title regressions at the report layer, including rating-only text that bypasses provider-specific guards.
- Add market-baseline and confidence tests only where enough same-currency offers exist. When there is not enough evidence, the report should say the market baseline is unavailable rather than inventing one.
- Update `docs/CLI.md` and `skills/opendevbrowser-shopping/` together with runtime changes so the public contract and skill contract match the actual artifacts.
- Keep live workflow validation as an acceptance gate. A future implementation should run a real shopping workflow, inspect `.opendevbrowser/shopping/<run-id>/deals.md`, and verify that the output is decision-ready rather than only transport-successful.
