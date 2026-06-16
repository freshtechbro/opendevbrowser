# Investigation: Product-Video Output Quality

## Summary
Investigation complete. Product-video artifacts are storage-complete but not presentation-ready because extracted marketplace strings are promoted directly into `copy.md`, `features.md`, `product.json`, `manifest.json`, and the response payload without a deterministic presentation compiler or readiness gate. The workflow also misses clean product specs already present in raw evidence, so the future fix needs positive evidence extraction as well as marketplace-noise rejection.

## Symptoms
- `product-video` bundle `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/` contains real extracted assets, but the user-facing text artifacts are not presentation-ready.
- `copy.md` contains marketplace UI/detail fragments such as quantity and condition text rather than a product story.
- `features.md` contains shipping and item-condition fragments rather than buyer-relevant product benefits.
- The workflow needs an output-quality pattern comparable to the recent research and shopping decision-ready output work.

## Background / Prior Research
- Current continuity records recent research and shopping output-quality work. The shopping effort preserved raw artifacts while adding a deterministic buyer-facing report/gate layer and live workflow validation. This investigation should evaluate whether product-video needs the same separation: raw extraction evidence plus a presentation-ready synthesis layer.

## Investigator Findings

### Finding 1 - The verified bad bundle is visually present but text-invalid
**Evidence:**
- The bundle lists captured visual assets: `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/manifest.json:21-25` references `images/image-01.webp` and `screenshots/screenshot-01.png`; local file inspection verified the image is WebP and the screenshot is a 756 x 469 PNG.
- The same bundle's final text artifacts are marketplace fragments: `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/copy.md:1` is quantity and condition chrome, and `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/features.md:1-2` is shipping and packaging-condition text.
- `product.json` stores those same strings as the canonical product payload at `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/product.json:6-10`, and `manifest.json` repeats them at `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/manifest.json:14-18`.
- The raw source record contains both the marketplace chrome that leaked into the artifacts and real product facts that did not get promoted cleanly: page/title chrome is visible at `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/raw/source-record.json:6-7`; the same long content line includes quantity, shipping, condition, seller feedback, and the real product facts `Type Vertical Mouse`, `Maximum DPI 1200`, `Connectivity Wireless`, and `Features Adjustable DPI, Ergonomic`.
**Conclusion:** This is not a missing-media or storage failure. The bundle is asset-complete enough to prove capture worked, but the user-facing copy and feature artifacts are semantically wrong.

### Finding 2 - Product-video writes raw or lightly extracted copy and features directly into final artifacts
**Evidence:**
- The product-video execution plan only has normalize, optional URL resolution, fetch detail, extract product data, and assemble artifacts. There is no synthesis, copywriting, evidence-mapping, or readiness-gate step in `PRODUCT_VIDEO_STEP_IDS` (`src/providers/product-video-compiler.ts:11-18`) or the built plan (`src/providers/product-video-compiler.ts:281-324`, `src/providers/product-video-compiler.ts:348-356`).
- `runProductVideoWorkflow()` fetches the product detail with `runtime.fetch({ url: productUrl }, ...)` (`src/providers/workflows.ts:6507-6522`), selects the first normalized record as `primary` (`src/providers/workflows.ts:6542`), derives features (`src/providers/workflows.ts:6578`), then resolves copy with `resolveProductCopy()` (`src/providers/workflows.ts:6624`).
- The derived fields are copied straight into `productPayload` (`src/providers/workflows.ts:6626-6637`) and `manifestPayload.product` (`src/providers/workflows.ts:6640-6653`).
- The final files are written directly from those fields: `copy.md` receives `copyText`, and `features.md` receives `featureList.map(...)` (`src/providers/workflows.ts:6656-6660`). The raw audit record is preserved separately at `raw/source-record.json` (`src/providers/workflows.ts:6661-6666`).
- The API response returns the same `manifestPayload` and `productPayload` without any copy-readiness status (`src/providers/workflows.ts:6719-6727`).
**Conclusion:** The first hypothesis is confirmed. Product-video has raw evidence preservation, but no presentation-ready synthesis or gate between extraction and final artifacts.

### Finding 3 - Product-video extraction helpers can promote marketplace chrome and miss clean specs
**Evidence:**
- The eBay-specific marketplace summary extractor returns the text between `Condition: ...` and `Buy It Now` (`src/providers/workflows.ts:4936-4948`). In the bad raw record, that region contains the quantity fragment that became `copy.md:1`.
- `deriveFeatureList()` first trusts structured `record.attributes.features`; if absent, it uses marketplace summary features, then an `About this item` section, then refreshed metadata, then sentence-splits trimmed raw page content (`src/providers/workflows.ts:5058-5086`). None of these branches require benefit semantics or evidence pairing.
- That ordering is a concrete quality defect: refreshed metadata features are only considered after marketplace summary features and `About this item` extraction (`src/providers/workflows.ts:5058-5081`), so noisy listing text can preempt cleaner structured product facts.
- `extractProductFeatureSection()` searches generic markers like `about this item`, `key item features`, and `about this product` (`src/providers/workflows.ts:1459-1464`), scores candidate sections by labeled features, sentence features, and length (`src/providers/workflows.ts:4876-4908`), and `extractAboutItemFeatures()` returns either labeled matches or sentence-split sanitized lines (`src/providers/workflows.ts:4926-4933`). This can favor long marketplace sections that contain condition or shipping text before actual specs.
- The shared sanitizer is useful but shallow: `normalizeFeatureEntry()` filters length, missing letters, a noise regex, price tokens, and a few question phrases (`src/providers/shopping-postprocess.ts:143-150`), then `sanitizeFeatureList()` deduplicates and caps at 12 (`src/providers/shopping-postprocess.ts:153-164`). Its noise regex covers some UI chrome such as `main content`, `about this item`, `buying options`, and `shipper / seller` (`src/providers/shopping-postprocess.ts:29`), but it does not reject the bad bundle's `May not ship to Canada...` or packaging-condition sentence.
- `resolveProductCopy()` returns preferred description when it does not match marketplace-copy regexes, else marketplace summary copy, else the first two features, else feature-section copy, else trimmed raw content (`src/providers/workflows.ts:5188-5222`). This is extraction and fallback selection, not presentation synthesis.
- The bad raw record also contains clean product facts on the same long content line, including `Type Vertical Mouse`, `Maximum DPI 1200`, `Connectivity Wireless`, and `Features Adjustable DPI, Ergonomic` (`.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/raw/source-record.json:7`). Those facts did not become benefit-led final bullets.
**Conclusion:** The second hypothesis is confirmed with a qualifier. The code has some anti-chrome filters, but they are string filters inside extraction helpers, not a product-benefit classifier or presentation gate. The verified eBay bundle shows two failures: marketplace chrome is not rejected, and clean spec-like facts are not promoted into presentation benefits.

### Finding 4 - Metadata refresh and first-record selection are not copy-quality controls
**Evidence:**
- `runProductVideoWorkflow()` uses the first normalized detail record as `primary` (`src/providers/workflows.ts:6542`). That is not proven to be the cause of the verified bad bundle, but it is a quality risk when a provider returns multiple records with mixed usefulness.
- `needsProductMetadataRefresh()` only checks whether the URL is HTTP(S), title is missing or URL-like, brand is missing or `unknown`, or structured shopping price is absent (`src/providers/workflows.ts:5097-5103`). It does not evaluate whether existing `copy` or `features` are product-benefit quality.
- Because refresh is not copy-quality driven, a record can have acceptable title, brand, and price while still producing bad presentation text through `deriveFeatureList()` and `resolveProductCopy()`.
**Conclusion:** Product-video has some metadata validity checks, but they do not gate presentation readiness. Future fixes should evaluate record quality and presentation evidence at the artifact assembly seam rather than relying on metadata refresh alone.

### Finding 5 - Product-video tests assert workflow shape and artifact existence, not presentation-copy quality
**Evidence:**
- The core product-video workflow test helper defaults `include_copy` to `false` (`tests/providers-product-video-workflow.test.ts:86-91`), so many workflow tests cannot exercise `copy.md` quality at all.
- Plan tests assert fixed stage sequences and artifact flags (`tests/providers-product-video-workflow.test.ts:98-171`), not output text semantics.
- The direct URL workflow test asserts fetch-only behavior, top-level response keys, handoff text, raw asset path, and empty images/screenshots (`tests/providers-product-video-workflow.test.ts:349-394`). It does not read `copy.md`, `features.md`, or assert benefit-style sections.
- The Best Buy/Amazon tests gate metadata and invalid product targets, including title/brand/price cleanup (`tests/providers-product-video-workflow.test.ts:580-590`), Best Buy error shells (`tests/providers-product-video-workflow.test.ts:594-624`), and unreliable Amazon prices (`tests/providers-product-video-workflow.test.ts:628-705`). Those are useful validity gates, but they do not cover copy or feature quality.
- Artifact coverage uses a clean fixture with content `Feature one. Feature two. Feature three.` (`tests/providers-artifacts-workflows.test.ts:1973-1978`) and checks artifact path, manifest source URL, and raw-source redaction (`tests/providers-artifacts-workflows.test.ts:2008-2048`). It does not assert that `copy.md` or `features.md` reject marketplace chrome.
**Conclusion:** The third hypothesis is confirmed. Current tests would pass even if user-facing product-video text is shipping, condition, seller, or quantity chrome.

### Finding 6 - Research and shopping already have the better output-quality pattern product-video lacks
**Evidence:**
- Research rendering builds a deterministic report layer and keeps raw records separate: `renderResearch()` writes `summary.md`, `report.md`, `records.json`, `context.json`, and `meta.json` (`src/providers/renderer.ts:670-703`). Its markdown report has explicit evidence gate, final answer, claim map, theme synthesis, confidence, limitations, recommendations, and evidence appendix sections (`src/providers/research-report/render.ts:291-318`). Tests assert those sections and rejected-candidate triage (`tests/providers-workflow-primitives.test.ts:210-288`).
- Shopping rendering builds a deterministic buying brief from raw offers: `renderShopping()` calls `buildShoppingBriefing()` and writes `deals.md`, `offers.json`, `comparison.csv`, `meta.json`, and `deals-context.json` (`src/providers/renderer.ts:918-944`).
- Shopping has an explicit readiness gate. `statusForFacts()` returns `fail`, `partial`, or `pass` from concrete evidence facts such as usable offers, duplicate groups, availability, freshness, price trust, currency mismatches, baselines, alerts, failures, and region authority (`src/providers/shopping-report/gate.ts:88-115`).
- Shopping markdown is structured around `# Shopping Buying Brief`, readiness gate, recommendation, best candidates, market baseline, warnings/constraints, constrained offers, and evidence appendix (`src/providers/shopping-report/render.ts:24-39`, `src/providers/shopping-report/render.ts:205-228`). Tests assert file shape, mode parity, context payload keys, readiness wording, and that partial output does not expose `recommended` labels (`tests/providers-workflow-primitives.test.ts:495-629`).
- `docs/CLI.md` documents shopping's deterministic `deals.md` contract, raw audit separation, readiness statuses, warnings, and unavailable fact treatment (`docs/CLI.md:507-519`). The adjacent product-video section only lists command flags (`docs/CLI.md:521-543`).
**Conclusion:** The fourth hypothesis is confirmed. Product-video should reuse the report/gate pattern: raw evidence remains available, while user-facing artifacts come from a deterministic compiler with a readiness status.

### Finding 7 - Product-presentation docs and skill templates rely on `copy.md` and `features.md` more than the runtime can guarantee
**Evidence:**
- The product-presentation skill says the expected output pack always includes `copy.md` and `features.md` (`skills/opendevbrowser-product-presentation-asset/SKILL.md:46-51`) and says metadata-first packs are valid if they captured canonical product data, copy, and pricing (`skills/opendevbrowser-product-presentation-asset/SKILL.md:57`).
- The same skill tells users to review generated copy/features (`skills/opendevbrowser-product-presentation-asset/SKILL.md:69-72`) and then build hooks and claims from `copy.md` plus `features.md` (`skills/opendevbrowser-product-presentation-asset/SKILL.md:83-86`).
- Templates imply presentation structure: `copy.md` expects headline, value proposition, and CTA (`skills/opendevbrowser-product-presentation-asset/assets/templates/copy.md:1-5`), `features.md` expects product feature bullets (`skills/opendevbrowser-product-presentation-asset/assets/templates/features.md:1-4`), and `video-assembly.md` instructs production to build from the top three verified benefits and verify price claims (`skills/opendevbrowser-product-presentation-asset/assets/templates/video-assembly.md:12-18`).
- The helper `render-video-brief.sh` reads `product.features` and `product.copy` directly from the manifest, slices them, and labels them `Verified Features` and `Copy Input` (`skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh:28-35`, `skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh:54-64`). It does not sanitize marketplace chrome or gate readiness.
- Product-video success handoff tells users to inspect `manifest.json` plus copy and features, then run the helper (`src/providers/workflow-handoff.ts:398-415`). It warns about visual-ready vs metadata-first, but not copy-ready vs raw-extraction quality.
**Conclusion:** Docs and skill surfaces do not create the bug, but they make the current runtime behavior risky by treating `copy.md` and `features.md` as creative inputs without a machine-readable copy-quality gate.

### Eliminated or qualified hypotheses
- **Eliminated: missing image/capture is the primary cause.** The bad bundle has a WebP product image and a PNG screenshot, and `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/manifest.json:21-25` references both.
- **Eliminated: raw evidence is missing.** The workflow writes `raw/source-record.json` (`src/providers/workflows.ts:6661-6666`), and the bad bundle includes it with the original eBay page text at `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/raw/source-record.json:7`.
- **Qualified: provider extraction is not the only bug.** The raw record is noisy and the helpers select the wrong fragments, but the more important root cause is that the workflow promotes extracted strings directly to final artifacts with no presentation compiler or readiness gate.
- **Qualified: product-video has some gates, but not this gate.** Existing code and tests reject some generic shells and unreliable prices (`tests/providers-product-video-workflow.test.ts:594-705`), but not presentation-copy failure.

### Root-cause opinion
Product-video currently conflates product data extraction with publishable product-presentation writing. Marketplace page text flows into `NormalizedRecord`, helper functions choose or split strings with shallow filters, and `runProductVideoWorkflow()` writes the chosen strings directly to `copy.md`, `features.md`, `product.json`, `manifest.json`, and the returned payload. Raw evidence is preserved correctly, but there is no typed `ProductVideoBriefing`, no claim-evidence map generated by runtime, no `pass|partial|fail` presentation readiness status, and no test fixture that simulates marketplace chrome leaking into output text.

### Recommended implementation seams
1. **Add a deterministic product-video presentation compiler.** Create a small `src/providers/product-video-report/` or `src/providers/product-video-presentation/` seam with typed inputs from `NormalizedRecord`, `pricing`, image/screenshot paths, and raw candidate strings. It should output presentation copy, benefit bullets, claim-evidence rows, warnings, and `presentationReadiness: pass|partial|fail`.
2. **Keep raw extraction separate from user-facing artifacts.** Preserve `raw/source-record.json`, and consider preserving raw extraction fields in a separate audit JSON. Generate `copy.md`, `features.md`, and optional `presentation-brief.md` from the compiler only.
3. **Integrate at the current assembly seam.** Replace direct writes at `src/providers/workflows.ts:6624-6660` with compiler output, and add readiness metadata under the existing `meta` assembly area at `src/providers/workflows.ts:6688-6717`. This can run inside the existing `assemble_artifacts` stage without changing the checkpoint plan.
4. **Make the compiler evidence-bounded.** It should not invent benefits. If clean product facts are insufficient, it should emit partial or fail readiness with warnings rather than filling `copy.md` with marketplace text.
5. **Harden extraction as an input-quality layer, not the only defense.** Extend eBay/listing filters to down-rank or reject shipping, condition, quantity, seller, feedback, and checkout lines before candidate selection, but still require the compiler gate to catch misses.
6. **Add regression tests that fail on the current bundle class.** In `tests/providers-product-video-workflow.test.ts` or a focused product-video compiler test, use an eBay-like fixture containing quantity, condition, shipping, seller feedback, and actual product specs. Assert final `copy.md` has presentation sections or a fail/partial readiness warning, final `features.md` contains benefit-style product facts, forbidden marketplace fragments are absent, clean specs are promoted, and `raw/source-record.json` preserves the original noisy text.
7. **Evaluate record selection as a secondary hardening step.** If detail fetches can return multiple records, prefer records with product-title, price, image, and clean spec evidence over blind first-record selection.
8. **Align docs and skill wording.** Update `docs/CLI.md`, `workflow-handoff.ts`, and `skills/opendevbrowser-product-presentation-asset` after implementation so they distinguish raw metadata capture, copy readiness, visual readiness, and final publish readiness.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Product-video currently treats extracted product fields as final presentation copy instead of running a deterministic quality/synthesis layer.
**Findings:** Confirmed in product-video compiler, workflow assembly, extraction helpers, tests, docs, and the verified bad bundle.
**Evidence:** See Investigator Findings above.
**Conclusion:** Confirmed. Product-video needs a presentation-ready compiler/gate and copy-quality regression coverage.

## Root Cause
Product-video has an extraction-to-artifact shortcut. It preserves raw evidence correctly, but writes selected extracted strings directly into `copy.md`, `features.md`, `product.json`, `manifest.json`, and the response payload without a deterministic presentation compiler or readiness gate. The eBay helper and generic feature extraction filters are too shallow to prevent shipping, condition, quantity, and seller text from being treated as product benefits. At the same time, clean specs already present in raw evidence are not reliably promoted into benefit-led output, and metadata refresh does not evaluate copy or feature quality.

## Recommendations
- Add a product-video presentation compiler/gate modeled on the deterministic quality pattern in `research-report` and `shopping-report`.
- Preserve raw marketplace extraction separately, then generate presentation-ready `copy.md`, `features.md`, and optional `presentation-brief.md` from typed compiler output.
- Add `meta.presentationReadiness` or `meta.productVideoReadiness` with `pass|partial|fail`, warnings, and blocked-reason codes.
- Make the compiler evidence-bounded: promote verified product specs into benefits, but emit partial/fail readiness instead of inventing copy when clean evidence is insufficient.
- Harden extraction filters for marketplace chrome, but treat that as defense in depth rather than the final quality control.
- Update product-video tests, CLI docs, handoff guidance, and product-presentation skill wording after the runtime contract changes.

## Preventive Measures
- Add regression fixtures with eBay-style quantity, condition, shipping, seller feedback, checkout text, and actual product specs.
- Assert final creative artifacts do not contain marketplace chrome and either contain verified benefit copy or explicitly fail/partial with warnings.
- Assert positive extraction too: clean specs such as type, DPI, connectivity, and ergonomic or adjustable-DPI features should become evidence-backed benefits when present.
- Keep raw `raw/source-record.json` assertions so auditability remains intact.
- Add renderer/compiler tests equivalent to the shopping brief tests for section order, readiness statuses, response-mode parity, markdown safety, and fail-language constraints.
- Include product-video copy-readiness checks in future live workflow output validation.
