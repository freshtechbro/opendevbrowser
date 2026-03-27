# Investigation: Workflow Defects on 2026-03-25

## Summary
Three workflow defects remain directly confirmed in the current checkout: shopping ranks accessory noise ahead of direct-product intent, research returns search/login/JS-shell rows as final results, and product-presentation-asset accepts a 404 page as a valid product target. The earlier login/form launch timeout is not currently reproducible: the same probe now passes 3/3, so that issue should be treated as historical evidence plus `UNCONFIRMED` latent risk, not as a current hard failure.

## Symptoms
- Shopping succeeds for `macbook air m4 32gb` but returns cases, protectors, sleeves, and repair parts ahead of actual MacBook offers.
- Research succeeds for `coffee shop website design inspiration` but returns DuckDuckGo HTML/search redirects, Reddit login/search shells, and Bluesky JavaScript-required shells as final records.
- Product-presentation-asset succeeds for `https://www.shoott.com/headshots` even though the fetched page is an obvious 404.
- Historical fixture evidence shows `launch --no-extension --headless --start-url <fixture>/login` timing out after 30000ms, but current repro runs now pass.

## Investigation Log

### Phase 1 - Workflow and test contract map
**Hypothesis:** the defects live mainly in workflow orchestration and test contracts, not in broad provider-runtime behavior.

**Findings:** the code and tests concentrate the relevant behavior in `src/providers/workflows.ts`, `src/providers/index.ts`, `src/browser/browser-manager.ts`, `src/cli/commands/session/launch.ts`, and `tests/providers-workflows-branches.test.ts`.

**Evidence:**
- `src/providers/workflows.ts:986-997` computes shopping `deal_score` almost entirely from price, availability, rating, and recency.
- `src/providers/workflows.ts:1128-1138` sorts `best_deal` only by `deal_score` and total price.
- `src/providers/workflows.ts:1516-1530` sends merged research records straight into timebox, enrich, dedupe, and rank with no sanitizer.
- `src/providers/workflows.ts:1834-1849` proceeds into product fetch/artifact generation once a `productUrl` exists.
- `tests/providers-workflows-branches.test.ts:3240-3287` and `tests/providers-workflows-branches.test.ts:3868-3897` intentionally allow `product_url: "not-a-url"` in product-video tests.

**Conclusion:** confirmed. The smallest safe seams are still workflow-local and test-local.

### Phase 2 - Shopping live-task quality
**Hypothesis:** shopping quality failure is a ranking policy issue, not primarily a provider extraction bug.

**Findings:** the live artifact for `macbook air m4 32gb` is dominated by cheap accessories at the top, while actual MacBook entries appear later or with zero price. Workflow ranking favors cheap totals and never scores direct-product intent.

**Evidence:**
- `artifacts/feature-audit-20260325/shopping-macbook-air-m4-32gb.json:39` top result is a laptop case.
- `artifacts/feature-audit-20260325/shopping-macbook-air-m4-32gb.json:105` second result is another case.
- `artifacts/feature-audit-20260325/shopping-macbook-air-m4-32gb.json:171` third result is a screen protector.
- `artifacts/feature-audit-20260325/shopping-macbook-air-m4-32gb.json:564` a real MacBook Air listing appears later and with price `0`.
- `artifacts/feature-audit-20260325/shopping-macbook-air-m4-32gb.json:627` another real MacBook-class listing appears later and with price `0`.
- `src/providers/workflows.ts:986-997` and `src/providers/workflows.ts:1128-1138` show why cheap accessories outrank true-intent offers.
- `src/providers/workflows.ts:1660-1672` shows zero-price offers are only excluded after extraction and only from the ranked output, not from earlier scoring logic.
- `src/providers/shopping/index.ts:985-993` candidate scoring still rewards brand/price/rating/reviews/availability and has no query-intent term.

**Conclusion:** confirmed. Fix shopping in `src/providers/workflows.ts` by adding direct-product intent scoring and accessory demotion for non-accessory queries.

### Phase 3 - Research live-task quality
**Hypothesis:** research quality failure is caused by a workflow-level sanitation gap after runtime aggregation.

**Findings:** the runtime intentionally emits search-index and fetch-shell records, and the research workflow currently forwards them directly to render/artifacts.

**Evidence:**
- `src/providers/index.ts:1865-1887` emits `web:search:index` records with URL-as-title fallback.
- `src/providers/index.ts:1922-1937` emits `community:search:index` records.
- `src/providers/index.ts:1945-1959` emits `community:fetch:url` records.
- `src/providers/index.ts:2098-2111` emits `social:search:index` records.
- `src/providers/index.ts:2124-2137` emits `social:fetch:url` records.
- `src/providers/workflows.ts:1516-1530` and `src/providers/workflows.ts:1544-1561` confirm no sanitizer exists between merge and final ranking.
- `artifacts/feature-audit-20260325/research-coffee-shop-design.json:44-45` first record is `https://html.duckduckgo.com/html`.
- `artifacts/feature-audit-20260325/research-coffee-shop-design.json:102-103` and `:159-160` are DuckDuckGo redirect URLs rendered as titles.
- `artifacts/feature-audit-20260325/research-coffee-shop-design.json:216-217` is a Reddit login page.
- `artifacts/feature-audit-20260325/research-coffee-shop-design.json:544` and `:698` are `Community search:` shell records.
- `artifacts/feature-audit-20260325/research-coffee-shop-design.json:913-985` are Bluesky JavaScript-required search shells.

**Conclusion:** confirmed. Fix research in `src/providers/workflows.ts`, not `src/providers/index.ts`, by adding a workflow-local sanitizer that drops search/login/JS-required shells before timebox/enrich/dedupe/rank.

### Phase 4 - Product-presentation false positive
**Hypothesis:** product-video lacks an explicit invalid-page guard before building assets.

**Findings:** a 404 page produced a successful product-assets bundle with copied error-page text and 14 images.

**Evidence:**
- `src/providers/workflows.ts:1834-1849` validates only that a product URL exists before fetching details.
- `src/providers/workflows.ts:1856-1861` rejects only when `!details.ok` or `details.records.length === 0`.
- `artifacts/feature-audit-20260325/product-presentation-photo-studio.json:40` recorded title `Shoott | 404`.
- `artifacts/feature-audit-20260325/product-presentation-photo-studio.json:49` recorded feature text `Error 404 We can’t seem to find the page you were looking for.`
- `artifacts/feature-audit-20260325/product-presentation-photo-studio.json:55` copied the 404 page body into `copy`.
- `artifacts/feature-audit-20260325/product-presentation-photo-studio.json:72` and `:119` show the bundle still wrote through at least 14 images.
- `tests/providers-workflows-branches.test.ts:3240-3287` and `tests/providers-workflows-branches.test.ts:3868-3897` preserve permissive invalid-URL behavior, so the test suite currently protects the bug.

**Conclusion:** confirmed. Fix product-video in `src/providers/workflows.ts` by rejecting invalid `http(s)` inputs and strong 404/not-found pages before metadata refresh and artifact generation.

### Phase 5 - Login/form launch timeout revalidation
**Hypothesis:** login-automation and form-testing are still broken due to launch-time `startUrl` waiting on `load` with a 30000ms ceiling.

**Findings:** the historical artifact still shows the timeout, but the current probe passes 3/3 with the same launch shape. The risky code path still exists, yet current live evidence no longer supports calling this a present break.

**Evidence:**
- Historical failure: `artifacts/feature-audit-20260325/login-form-simple-fixture.json:9` records `Request timed out after 30000ms`.
- Probe launch shape: `scripts/login-fixture-live-probe.mjs:346-352` still runs `launch --no-extension --headless --start-url ${baseUrl}/login --no-interactive`.
- Current success canary: `/tmp/odb-login-fixture-probe-current.json:19-20` and `:75` show `workflow.launch` passed and overall `ok: true`.
- Repeat success canaries: `/tmp/odb-login-fixture-repeat-1.json:19-20` and `:75`; `/tmp/odb-login-fixture-repeat-2.json:19-20` and `:75`.
- Residual-risk code path: `src/browser/browser-manager.ts:480-482` still uses `goto(..., "load", 30000, ...)`.
- Test contract still encodes that behavior: `tests/browser-manager.test.ts:613-614` expects `waitUntil: "load"`.
- CLI timeout layering is still minimal: `src/cli/commands/session/launch.ts:133-137` and `tests/cli-launch.test.ts:48-51` only derive timeout from `waitTimeoutMs`.

**Conclusion:** eliminated as a current hard-failure hypothesis. Reclassify as "no longer current" with `UNCONFIRMED` latent risk. Do not patch launch/bootstrap code unless a fresh repro or failing automated canary reappears.

## Root Cause
The three confirmed defects are all workflow-policy gaps:

1. Shopping ranks by generic price-weighted `deal_score` and total price, with no direct-product intent model and no accessory demotion for non-accessory queries. That lets cheap accessories dominate direct-product searches.
2. Research preserves runtime-emitted search and shell records because `runResearchWorkflow` never sanitizes merged records before ranking/rendering them.
3. Product-presentation-asset trusts any non-empty fetch result and lacks an invalid-page gate, so obvious 404/not-found pages are treated as valid products.

The login/form timeout does not meet the current bar for a confirmed product defect. The source still has a brittle bootstrap wait policy, but current runtime evidence shows the main probe passing consistently.

## Eliminated Hypotheses
- Broad provider-runtime rewrites are not required for shopping or research. Evidence points to workflow-local policy gaps, not a need to change `src/providers/index.ts` output contracts.
- Product false positives are not caused by metadata refresh alone. The invalid page is already accepted before refresh logic matters.
- Login/form should not currently be treated as "broken." Historical evidence exists, but current repro is green 3/3.

## Recommendations
1. Patch `src/providers/workflows.ts` for shopping only:
   - add intent scoring for direct-product queries,
   - demote accessory-like offers when the query itself is not accessory-oriented,
   - keep provider extraction unchanged.
2. Patch `src/providers/workflows.ts` for research only:
   - add a sanitizer immediately after `mergedRecords`,
   - hard-drop `community:search:index` and `social:search:index`,
   - conditionally drop `web:search:index`, `community:fetch:url`, and `social:fetch:url` only when URL/path/title/body indicate search, login, JS-required, or not-found shells,
   - record `sanitized_records` and `sanitized_reason_distribution` in `meta.metrics`.
3. Patch `src/providers/workflows.ts` for product-presentation-asset only:
   - reject non-`http(s)` `product_url` values,
   - reject strong invalid-page signals such as status `404`/`410` or clear not-found text before metadata refresh and file writes.
4. Patch tests in `tests/providers-workflows-branches.test.ts` and `tests/providers-artifacts-workflows.test.ts`:
   - add a shopping regression where a real product must outrank a cheaper accessory,
   - add a research sanitation regression using search/login/JS-required shells,
   - add product-video rejections for invalid URL and 404 page inputs,
   - replace unrelated `product_url: "not-a-url"` fixtures with valid URLs.
5. Do not patch `src/browser/browser-manager.ts` or `src/cli/commands/session/launch.ts` yet. Keep `scripts/login-fixture-live-probe.mjs` as the canary and reopen that seam only if the timeout reappears.

## Preventive Measures
- Add workflow-level regression tests that use realistic shell/search outputs rather than synthetic happy-path records only.
- Track sanitizer activity in workflow metrics so shell suppression is auditable instead of silent.
- Keep `scripts/login-fixture-live-probe.mjs` in the focused verification set for workflow investigations touching launch/session behavior.
- Avoid permissive invalid-URL fixtures in product-video tests; they mask real bad-target validation gaps.
