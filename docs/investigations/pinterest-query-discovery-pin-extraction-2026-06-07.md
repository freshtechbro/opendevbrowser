# Investigation: Pinterest Query Discovery Pin Extraction

## Summary
Pinterest query discovery blocks extraction before the Pinterest recipe can inspect valid rendered `/pin/<id>/` links. Explicit canonical pin harvest works because it bypasses query discovery and enters the downstream pin-media capture loop directly.

## Symptoms
- Extension-mode explicit-pin harvest for `https://www.pinterest.com/pin/1055599900892243/` returned `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, and emitted `canvas-plan.request.json`.
- Extension-mode query harvest after preparing a normal Pinterest tab rendered a populated Pinterest search grid, but the workflow returned `productSuccess=false`, `artifactAuthority=diagnostic_only`, `evidenceAuthority=diagnostic_only`, and `search_shell_without_media_signals`.
- CLI review on the same live page exposed visible `pin page` links and `dom-attr` returned relative hrefs such as `/pin/1055599900892243/`, `/pin/1337074889402576/`, `/pin/718605684338312932/`, and `/pin/1125968743376891/`.

## Background / Prior Research
- Prior memory warns that `opendevbrowser inspiredesign harvest` can exit successfully while the bundle is still not design-ready; readiness must be judged from artifact authority, ranked references, and evidence files.
- Prior memory states this workflow family expects browser-native logged-in Pinterest navigation and query-backed discovery, not scraper-first behavior.
- Current live artifact evidence:
  - Failed query bundle after browser prep: `.tmp/pinterest-query-extension-prepared-20260607133515/inspiredesign/b02afa5c-8979-445d-b66f-09b900202927`.
  - Successful explicit-pin bundle: `.tmp/pinterest-visible-pin-extension-20260607133628/inspiredesign/c8809cbc-3f8c-4f54-84ca-52538b754fd6`.
  - Search page screenshot: `.opendevbrowser/screenshot/1b8c7310-58e8-4f5a-b943-12f872f965a9/capture.png`.

## Investigator Findings
<!-- Pair investigator appends structured findings here. -->

### 2026-06-07 Root-cause trace

Root cause: Pinterest query discovery classifies the fetched search page as a blocking search shell before the Pinterest recipe extractor is allowed to inspect record links, content, or HTML for canonical pin URLs.

Evidence:
- `src/providers/workflows.ts:2195-2214` routes site-recipe discovery for `social/pinterest` into `runBrowserNativeDiscovery(...)`, passing `runtime.fetch(...)` records from the browser-backed search page.
- `src/providers/browser-native-discovery.ts:382-390` fetches the search page and still allows early bad-state returns before recipe extraction.
- `src/providers/browser-native-discovery.ts:392-407` then classifies the Pinterest source page and returns `buildBadStateResult(...)` whenever `shouldBlockPinterestSourceExtraction(...)` is true.
- `src/providers/browser-native-discovery.ts:408` is the first line that calls `extractRecipeReferenceUrls(...)`, so the `search_shell_without_media_signals` return at `src/providers/browser-native-discovery.ts:395-407` runs before the extraction seam.
- `src/providers/browser-native-discovery.ts:167-210` shows `buildBadStateResult(...)` always returns `records: []`, which explains why downstream `acceptedUrls` is empty.
- `src/providers/workflows.ts:2277-2289` converts `siteResult.records` into `acceptedUrls`; empty browser-native records therefore become empty discovery accepted URLs.

Why the branch triggers:
- `src/inspiredesign/pinterest-media-classification.ts:61-66` defines search-shell markers including `search results for`, `related searches`, `when autocomplete results are available`, and `pin card`.
- `src/inspiredesign/pinterest-media-classification.ts:110-114` returns `search_shell` before checking media-grid quality when any search-shell marker is present.
- `src/inspiredesign/pinterest-media-classification.ts:185-196` makes `classifyPinterestSourcePage(...)` select a `search_shell` classification ahead of `chrome_only`, `pin_grid_media`, or the first non-blocking classification.
- `src/inspiredesign/pinterest-media-classification.ts:198-202` makes `search_shell`, `chrome_only`, and `login_challenge` hard blockers for source extraction.

### Eliminated hypotheses

- URL normalization is not the primary cause. `normalizePinterestReferenceUrl(...)` accepts relative paths by converting leading `/...` values to `https://www.pinterest.com...`, accepts `www`, bare, and two-letter regional Pinterest hosts, and canonicalizes accepted references by stripping search and hash parameters. See `src/guidance/recipes/pinterest.ts:96-132`.
- Recipe extraction is not the primary cause. `extractPinterestReferenceUrls(...)` reads `candidate.url`, `candidate.links`, `candidate.content`, and `candidate.html`, then filters through the same normalizer. See `src/guidance/recipes/pinterest.ts:138-156` and recipe wiring at `src/guidance/recipes/pinterest.ts:186-188`.
- Tests already prove relative and regional pin links can normalize. `tests/pinterest-guidance-branches.test.ts:24-25` expects `/pin/61572719900827789/` to become `https://www.pinterest.com/pin/61572719900827789/`; `tests/pinterest-guidance-branches.test.ts:38-53` proves the recipe extractor accepts a relative pin and `https://uk.pinterest.com/pin/...`; `tests/guidance-site-recipe-validation.test.ts:24-35` accepts canonical variants including `http://www.pinterest.com/pin/...` and `https://uk.pinterest.com/pin/...`.
- Product readiness is not the primary cause. The readiness path can accept canonical Pinterest pins once they reach capture: `src/inspiredesign/product-readiness.ts:171-178` recognizes canonical Pinterest pin references through `isCanonicalPinterestPinUrl(...)` and `normalizePinterestReferenceUrl(...)`; `src/providers/workflows.ts:5886-5902` merges requested URLs and discovery URLs into `workflowInput.urls`; `src/providers/workflows.ts:5937-5957` classifies each URL and runs `captureWorkflowPinMediaEvidence(...)` when `shouldCapturePinterestPinMedia(...)` is true.
- The live explicit-pin bundle confirms the downstream path works. `.tmp/pinterest-visible-pin-extension-20260607133628/inspiredesign/c8809cbc-3f8c-4f54-84ca-52538b754fd6/evidence.json:102-130` records captured first-party Pinterest pin media for `https://www.pinterest.com/pin/1055599900892243`; the same file at `:623-625` reports `artifactAuthority: "product_ready"`, `evidenceAuthority: "pin_media_ready"`, and `productSuccess: true`; `pin-media-evidence.json:7-35` records persisted bytes, dimensions, hash, first-party `i.pinimg.com` provenance, and canonical source match.

### Current tests preserve the bad behavior

- `tests/pinterest-guidance-recipe.test.ts:111-119` classifies a Pinterest search page containing `Pin card` and `When autocomplete results are available` as `search_shell` with `search_shell_without_media_signals`.
- `tests/pinterest-guidance-recipe.test.ts:120-129` keeps that classification even when the HTML contains an image-like `<picture>`.
- `tests/pinterest-guidance-recipe.test.ts:130-140` keeps a pin-like URL blocked as `search_shell` when search-result text is present.
- `tests/pinterest-guidance-recipe.test.ts:515-550` expects browser-native discovery to return zero records even when `links` contains `https://uk.pinterest.com/pin/11188699075430754/` and `/pin/27654985208435505/`.
- `tests/pinterest-guidance-recipe.test.ts:553-589` is the strongest encoded regression gap: it is named `blocks search-shell link extraction even when media-grid signals are present`, includes regional and relative pin links plus an HTML grid link at `tests/pinterest-guidance-recipe.test.ts:570-575`, and still expects `result.records` to equal `[]` at `tests/pinterest-guidance-recipe.test.ts:582-589`.

### Live bundle corroboration

- Failed query bundle `.tmp/pinterest-query-extension-prepared-20260607133515/inspiredesign/b02afa5c-8979-445d-b66f-09b900202927/evidence.json:79-81` has `urls: []`, `referenceCount: 0`, and `references: []`.
- The same failed bundle at `evidence.json:238-244` has empty screenshot, motion, pin-media, and pin-media-index arrays plus `artifactAuthority: "diagnostic_only"`, `evidenceAuthority: "diagnostic_only"`, and `productSuccess: false`.
- `ranked-references.json:3-15` in the failed bundle records zero ranked, rejected, attempted, or failed references, which matches `runBrowserNativeDiscovery(...)` returning no records rather than later product readiness rejecting a canonical pin.
- Successful explicit-pin bundle `.tmp/pinterest-visible-pin-extension-20260607133628/inspiredesign/c8809cbc-3f8c-4f54-84ca-52538b754fd6/evidence.json:102-130` proves the canonical pin media capture path can persist first-party bytes after a concrete pin URL enters the reference loop.

### Recommended fix seams

- Narrow seam: change `src/providers/browser-native-discovery.ts:392-408` so Pinterest source-page classification does not return `buildBadStateResult(...)` before `extractRecipeReferenceUrls(...)` runs when the fetched records contain recipe-approved canonical references.
- Preserve hard blockers: keep hard provider failures at `src/providers/browser-native-discovery.ts:382-386`, required-auth checks at `src/providers/browser-native-discovery.ts:319-348`, and login or challenge bad states as blocking even if a page contains decorative or stale links.
- Suggested shape: compute `extractedUrls` before applying the `search_shell` or `chrome_only` source-page block. If extracted URL count is greater than zero and the source quality is `search_shell` or `chrome_only`, build reference records and carry the source-page quality or diagnostic blockers as metadata. If extracted URL count is zero, retain the existing bad-state result.
- Avoid broadening readiness: do not mark extracted pins product-ready during discovery. They should only become product-ready after the existing explicit capture path persists screenshot, motion, or pin-media evidence.
- Keep `login_challenge` stricter than `search_shell`: a logged-out wall can include stale or marketing links and should continue to fail before promoting references.

### Regression tests to add or change in a future implementation turn

- Update or replace `tests/pinterest-guidance-recipe.test.ts:553-589` so a search-shell record with extractable `/pin/<id>/` and `https://uk.pinterest.com/pin/<id>/` links returns canonical records instead of `[]`.
- Add a companion test proving a search-shell record with no extractable Pinterest reference URLs still returns the existing `env_limited` bad state.
- Add a login or challenge test proving records with `Log in`, `captcha`, or `challenge` markers still block even when they contain `/pin/<id>/` links.
- Add a workflow-level test around `discoverInspiredesignReferences(...)` or `runInspiredesignWorkflow(...)` proving accepted discovery URLs are merged into `workflowInput.urls` and then enter the existing canonical capture loop without changing product-readiness authority rules.
- Keep the existing normalization tests in `tests/pinterest-guidance-branches.test.ts` and `tests/guidance-site-recipe-validation.test.ts`; they already cover relative and regional Pinterest URL acceptance and should not need production logic changes.


## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The query discovery path uses a different extraction/classification seam than CLI review/DOM attr, so rendered links are visible to review but not accepted by harvest discovery.
**Findings:** Confirmed. Query discovery blocks on Pinterest source-page quality before recipe extraction runs, while CLI review/DOM attr and the recipe normalizer can see or accept the links.
**Evidence:** Live workflow bundles and screenshot listed above.
**Conclusion:** Confirmed.

### Phase 2 - Context Builder Synthesis
**Hypothesis:** The bug is in browser-native discovery ordering, not in readiness or pin-media capture.
**Findings:** RepoPrompt context_builder selected `src/providers/browser-native-discovery.ts`, `src/inspiredesign/pinterest-media-classification.ts`, `src/guidance/recipes/pinterest.ts`, `src/providers/workflows.ts`, and Pinterest discovery tests as the key files. It identified `runBrowserNativeDiscovery(...)` as the likely pre-extraction blocker and highlighted existing tests that assert valid pin links remain blocked under search-shell classification.
**Evidence:** `src/providers/browser-native-discovery.ts:392-408`; `tests/pinterest-guidance-recipe.test.ts:515-590`.
**Conclusion:** Confirmed.

### Phase 3 - Pair Investigator and Chat Synthesis
**Hypothesis:** `search_shell_without_media_signals` is applied too early and prevents `extractRecipeReferenceUrls(...)` from promoting valid links.
**Findings:** Confirmed by pair investigation and RepoPrompt chat. The pair traced the exact return branch, ruled out URL normalization, recipe extraction, product readiness, and pin-media capture, and verified current tests preserve the bad behavior.
**Evidence:** See `## Investigator Findings`.
**Conclusion:** Confirmed.

## Root Cause
`runBrowserNativeDiscovery(...)` applies Pinterest source-page blocking before extraction. When `classifyPinterestSourcePage(...)` sees common Pinterest search UI text such as `Pin card`, `when autocomplete results are available`, `search results for`, or `related searches`, it classifies the page as `search_shell`. `shouldBlockPinterestSourceExtraction(...)` then returns true, and `buildBadStateResult(...)` returns `records: []`.

The extractor is called only after this branch. Therefore valid links in `record.attributes.links`, `record.attributes.html`, `record.content`, or `record.url` never reach `extractRecipeReferenceUrls(...)`.

This explains the live behavior:
- Query harvest sees a rendered Pinterest grid but returns zero accepted URLs and stays diagnostic-only.
- CLI review can expose visible `pin page` links because it inspects the live page differently.
- Explicit canonical pin harvest succeeds because it bypasses query discovery and sends a concrete pin URL into the existing pin-media capture path.

The issue is not URL normalization. `normalizePinterestReferenceUrl(...)` accepts relative `/pin/<id>/` links and two-letter regional hosts such as `uk.pinterest.com`, and tests already cover those cases.

The issue is not product readiness. The successful explicit-pin bundle proves the downstream path can persist first-party `i.pinimg.com` media, produce media analysis, rank the reference, emit `canvas-plan.request.json`, and set `productSuccess=true`.

## Recommendations
1. Change only the Pinterest branch in `src/providers/browser-native-discovery.ts:392-408` so `search_shell` and `chrome_only` source-page classifications do not return before `extractRecipeReferenceUrls(...)` runs.
2. Preserve hard blockers for login, challenge, auth-required, policy-blocked, rate-limited, and token-required states. A login or challenge page with stale links should still return `records: []`.
3. If extraction finds valid recipe-approved Pinterest references, return canonical discovery records and carry source-page quality or diagnostic blockers as metadata only. Do not grant product readiness during discovery.
4. If extraction finds zero valid references, keep the existing `search_shell_without_media_signals` bad-state result.
5. Leave explicit canonical pin readiness authority unchanged. Extracted URLs should still have to pass the existing capture/finalization path before `pin_media_ready` or `product_ready` is granted.

## Preventive Measures
- Update `tests/pinterest-guidance-recipe.test.ts:553-589` so search-shell records with valid `/pin/<id>/` or `https://uk.pinterest.com/pin/<id>/` links return canonical discovery records instead of `[]`.
- Add a test for search-shell HTML extraction where `attributes.html` includes `<a href="/pin/<id>/">`.
- Keep or add a test proving a search-shell record with no extractable Pinterest links still returns the existing env-limited bad state.
- Add a login or challenge test proving `Log in`, `captcha`, or `challenge` markers still block even when the page contains `/pin/<id>/` links.
- Add a workflow-level regression proving accepted discovery URLs are merged into `workflowInput.urls` and then enter the existing canonical capture loop without changing product-readiness authority rules.
