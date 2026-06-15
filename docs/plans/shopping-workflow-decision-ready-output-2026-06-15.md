# Shopping Workflow Decision-Ready Output: Implementation Plan

## Goal
Implement a deterministic shopping buying-report layer that turns `deals.md` into a decision-ready buying brief while preserving the existing raw shopping artifacts: `offers.json`, `comparison.csv`, `meta.json`, and `deals-context.json`.

The implementation must follow the proven research-report seam from PR #83: compile a pure deterministic briefing at render time, preserve collection and postprocess behavior unless a direct report-output defect requires a small fix, and validate quality with focused fixture regressions plus at least one live shopping workflow run.

## Primary Decision
Use `deals.md` as the primary buying brief.

Rationale:
- The investigation found no compatibility evidence requiring `deals.md` to remain a raw compact list.
- The research workflow improved the primary markdown artifact while preserving raw evidence artifacts.
- `offers.json`, `comparison.csv`, `meta.json`, and `deals-context.json` remain the audit and machine-readable surfaces.
- Add `buying-report.md` only if implementation discovers a concrete compatibility blocker that depends on legacy compact `deals.md` content.

## Renderer Compatibility Decision
Preserve response shapes, but change buyer-facing summaries to be report-derived:
- `mode: "md"` returns the exact buying brief body written to `deals.md`.
- `mode: "compact"` keeps `{ mode, summary, meta }`, but `summary` becomes a short deterministic buying-brief summary: gate status, primary recommendation state, top candidate when allowed, and the most important constraint. It must not remain a raw top-ten ranked list if that would contradict the gate.
- `mode: "json"` keeps `{ mode, offers, meta }` unchanged so machine consumers still receive raw offer evidence.
- `mode: "context"` keeps `query`, `highlights`, `offers`, and `meta`; `highlights` should become report-derived guidance lines instead of raw ranked-list lines. Add extra report summary fields only if tests and docs lock the shape.
- `mode: "path"` keeps `{ mode: "path", meta }` unchanged while the bundle contains the new `deals.md`.

## Non-Goals
- Do not rewrite provider collection.
- Do not make normal search-card offers automatically product-detail-page validated in this plan.
- Do not invent seller trust, condition, return, warranty, or price-history facts when current offer attributes do not contain them.
- Do not remove or rename raw artifacts.
- Do not add LLM, network, filesystem, randomness, or direct clock access inside the report compiler.

## Background
- Required investigation basis: `docs/investigations/shopping-workflow-output-quality-2026-06-15.md`. It found useful raw offer extraction but weak buying guidance because `deals.md` is a raw ranked list, not a deterministic buying report.
- Current renderer seam: `renderShopping()` is the direct handoff from `ShoppingOffer[]` plus workflow meta to persisted shopping artifacts. It writes `deals.md`, `offers.json`, `comparison.csv`, `meta.json`, and `deals-context.json` in `src/providers/renderer.ts:788-824`.
- Current markdown shape: `compactShoppingLines()` emits up to ten `title - total (provider, deal=score)` rows in `src/providers/renderer.ts:772-786`. `comparison.csv` exposes only provider, title, price, shipping, deal score, availability, and URL in `src/providers/renderer.ts:756-768`.
- Workflow artifact path: `runShoppingWorkflow()` compiles and executes the shopping plan, postprocesses provider runs, calls `renderShopping()`, and persists `rendered.files` through `createArtifactBundle({ namespace: "shopping" })` in `src/providers/workflows.ts:5667-5877`.
- Entry points: CLI dispatches `shopping.run` through daemon RPC in `src/cli/commands/shopping.ts:244-279`; daemon routes `shopping.run` to `runShoppingWorkflow()` in `src/cli/daemon-commands.ts:876-894`; OpenCode tool `shopping_run` resolves runtime and forwards output settings in `src/tools/shopping_run.ts:33-53`.
- Existing offer facts: provider extraction writes `attributes.shopping_offer` with provider, product id, title, URL, price, price source, price trust, shipping placeholder, availability, rating, reviews, capture timestamp, brand/image metadata, extraction quality, and canonical URL in `src/providers/shopping/index.ts:1748-1808`.
- Extraction paths: search-card records are tagged `shopping:search:result-card` in `src/providers/shopping/index.ts:1907-1936`; fallback/index rows use `shopping:search:url` or `shopping:search:index` in `src/providers/shopping/index.ts:1940-1964`; product-detail fetch rows use `shopping:fetch:url` in `src/providers/shopping/index.ts:2000-2037`.
- Fetch-recovery constraint: `deriveShoppingFetchSteps()` only adds PDP fetches when a completed search has no failures, no likely offer records, no shopping issue hints, and provider-owned candidate links; recovery is capped to two URLs in `src/providers/shopping-compiler.ts:254-299`.
- Postprocess seam: `postprocessShoppingWorkflow()` returns records, failures, offers, excluded counts, and `offerFilterDiagnostics` in `src/providers/shopping-postprocess.ts:799-869`.
- Current filtering is permissive: `filterShoppingOffers()` rejects only non-positive price, region-currency mismatch, and budget overage in `src/providers/shopping-postprocess.ts:491-501`.
- Current scoring is not a readiness gate: unknown availability gets a `0.45` availability rank, out-of-stock gets `0.1`, and availability is only 20 percent of `computeDealScore()` in `src/providers/shopping-postprocess.ts:333-354`.
- Freshness caveat: missing nested `retrieved_at` falls back to `now.toISOString()` in `src/providers/shopping-postprocess.ts:377-379`, so missing freshness evidence must be distinguished by the report layer.
- Duplicate caveat: `dedupeOffers()` keys exact canonical URL plus lowercase title in `src/providers/shopping-postprocess.ts:504-513`, allowing same-product marketplace listings with different URLs to survive.
- Relevance caveat: `rankOffers()` uses query intent only for `best_deal`; other sort modes ignore query relevance in `src/providers/shopping-postprocess.ts:516-548`.
- Title-quality caveat: provider-layer rating-only title guardrails exist in `src/providers/shopping/index.ts:1143-1145` and `src/providers/shopping/index.ts:1656-1670`, and Best Buy branch tests cover rating-only anchors in `tests/providers-shopping-branches.test.ts:140-207`. There is no final report-level suspicious-title gate.
- Research prior art: PR #83 (`0c3498603f8b6658709401a9edcaaacbe7c29f8b`, feature commit `7cfebb6092a491cd9e7a779b4c8f386e013492a0`) added an evidence-gated deterministic research report at the renderer seam while preserving raw artifacts.
- Research implementation pattern: `renderResearch()` calls `buildResearchBriefing()` and `renderResearchBriefingMarkdown()` in `src/providers/renderer.ts:657-702`; `src/providers/research-report/synthesis.ts:23-52` composes meta view, gate, passages, themes, claims, final answer, limitations, and recommendations.
- Research gate pattern: `evaluateEvidenceGate()` applies pass, partial, and fail criteria over accepted evidence, independence, diagnostics, alerts, challenge state, and anti-bot pressure in `src/providers/research-report/gate.ts:73-187`.
- Research render pattern: `renderResearchBriefingMarkdown()` renders evidence gate status, final answer, claim map, theme synthesis, confidence, limitations, recommendations, and evidence appendix in `src/providers/research-report/render.ts:260-318`.
- Research test pattern: `tests/providers-workflow-primitives.test.ts:173-189` locks report artifacts and sections; `tests/providers-research-report.test.ts:1450-1467` locks report artifact names; `tests/providers-research-report-quality.test.ts` covers output-quality regressions.
- Shopping test seams already cover extraction and filtering basics: availability/rating/review parsing in `tests/providers-shopping.test.ts:152-206`, structured metadata price trust in `tests/providers-shopping.test.ts:375-401`, search-card parsing in `tests/providers-shopping.test.ts:1508-1532`, filter diagnostics in `tests/providers-shopping-workflow.test.ts:255-365`, and fetch recovery in `tests/providers-shopping-executor.test.ts:116-155`.
- Skill/runtime drift: `skills/opendevbrowser-shopping/SKILL.md:46-118` expects provider discount checks, market baselines, confidence warnings, stale-price controls, and strong-deal rules; runtime `deals.md` does not currently render those semantics.
- Skill asset drift: `skills/opendevbrowser-shopping/scripts/analyze-market.sh:68-140`, `skills/opendevbrowser-shopping/scripts/analyze-market.sh:178-236`, and `skills/opendevbrowser-shopping/scripts/analyze-market.sh:267-300` compute anchor savings, market gaps, stale/missing price flags, confidence, and warning rows that are not wired into runtime shopping artifacts.
- Public docs are more conservative than the skill: `docs/CLI.md:482-520` documents shopping workflow usage and diagnostics inspection rather than claiming a market-baseline report.
- External product-quality benchmarks from the investigation emphasize checked time, availability, multi-merchant offers, price history, merchant trust, shipping/returns, disclosure, and non-misleading price comparisons. Key references are listed under References.

## Approach
Create a new pure `src/providers/shopping-report/` package analogous in boundary to `src/providers/research-report/`, without requiring the exact same internal file split. It should read existing `ShoppingOffer[]`, query, and workflow meta through a typed adapter, then produce a deterministic `ShoppingBriefing` with gate status, recommendation language, best candidate assessments, market baseline, warnings, exclusions, limitations, and evidence appendix.

Wire the package only at the renderer seam first: `renderShopping()` should call `buildShoppingBriefing()` and `renderShoppingBriefingMarkdown()` to make `deals.md` the buying brief. Preserve raw file names and response semantics. Treat the postprocess layer as a source of normalized evidence, not as the place to render buyer-facing guidance.

The report should be conservative. It should surface available evidence, lower confidence when evidence is weak, and explicitly state when a fact is unavailable. Unknown availability, missing or stale freshness evidence, weak relevance, duplicate pressure, suspicious titles, advisory region enforcement, and insufficient market baseline should constrain recommendation language instead of being hidden in metadata.

Because `runShoppingWorkflow()` assembles `meta` as `Record<string, unknown>`, the report package must define a minimal typed view over meta and attributes. Missing fields must become explicit `missing`, `unavailable`, or `inferred` states instead of silently defaulting into trusted evidence.

## Deterministic Report Contract
`deals.md` must render deterministic sections in this order:
- `# Shopping Buying Brief`
- `## Buying Readiness Gate`
- `## Recommendation`
- `## Best Candidate Offers`
- `## Market Baseline`
- `## Warnings and Constraints`
- `## Excluded or Constrained Offers`
- `## Evidence Appendix`

Gate statuses:
- `pass`: enough evidence for bounded recommendation language.
- `partial`: offers are usable, but confidence is constrained.
- `fail`: no confident recommendation is allowed.

Required report behaviors:
- Preserve raw offers in `offers.json`.
- Preserve current `comparison.csv` name and basic purpose.
- Preserve raw diagnostics in `meta.json`.
- Preserve `deals-context.json`, optionally adding deterministic report summary fields if tests and docs are updated.
- Never use confident language such as `Strong buy`, `best deal`, or `recommended` when gate status is `fail`.
- Treat unknown and out-of-stock availability as confidence limiters.
- Treat missing, inferred, or stale freshness evidence as warnings.
- Treat duplicate same-title or same-product pressure as a warning or grouping constraint.
- Treat weak query relevance as a warning or exclusion from confident recommendations.
- Treat suspicious rating-only or non-product titles as exclusion or severe warning.
- Treat seller trust, returns, warranty, and condition as limitations unless present in attributes.
- Compute market baseline only when deterministic same-currency sample criteria are met.
- State `market baseline unavailable` when sample size or anchor evidence is insufficient.

## Report Input Contract
The implementation should create a narrow report input view before evaluating gates:
- `ShoppingReportInput`: query, offers, typed meta view, artifact file names, and explicit current-time or freshness threshold inputs if needed.
- `ShoppingReportOfferEvidence`: normalized offer facts plus provenance for each fact. It should distinguish first-class `ShoppingOffer` fields from nested `attributes.shopping_offer` fields and from missing fields.
- `ShoppingReportMetaView`: selected providers, requested region, region authority, diagnostics, alerts, offer filter diagnostics, excluded counts, and primary constraint summary, all read defensively from `Record<string, unknown>`.

Freshness handling:
- Do not trust `ShoppingOffer.price.retrieved_at` alone as observed freshness, because `extractShoppingOffer()` can fill it with `now` when nested `retrieved_at` is missing.
- Prefer original nested provenance from `attributes.shopping_offer.retrieved_at`, capture timestamp, retrieval path, price source, or related attribute fields where present.
- If only the postprocess fallback timestamp exists, classify freshness as `inferred`, not verified.
- If no trustworthy timestamp exists, classify freshness as `missing`.

Savings and baseline handling:
- Compute market average, median, lowest total, and sample confidence only from same-currency offers.
- Compute anchor, list-price, or percent-savings claims only when an explicit anchor/list field exists in offer attributes.
- If there is no explicit anchor/list evidence, render baseline comparison without savings claims and state that anchor savings are unavailable.

## File-by-File Implementation Sequence
1. Add focused failing tests for the artifact and renderer-mode contract.
2. Add failing fixture tests for each known investigation failure before implementing the corresponding rule: duplicate pressure, weak relevance, suspicious title, unknown/out-of-stock availability, missing/inferred/stale freshness, and insufficient market baseline.
3. Add `src/providers/shopping-report/` as a pure compiler package with a typed input adapter.
4. Implement gate, duplicate, relevance, freshness, availability, and market-baseline synthesis against those failing fixtures.
5. Wire `renderShopping()` to produce the buying brief in `deals.md` while preserving raw artifacts and response shapes.
6. Update workflow primitive tests and cross-surface shopping quality tests.
7. Update docs and shopping skill assets after runtime behavior exists.
8. Run focused tests, full gates, and live workflow validation.

## Work Items

### Task 1 - Lock Artifact Contract And Markdown Target
Reasoning: The safest implementation starts by proving raw artifact names stay stable while the primary markdown contract changes.
Goal: Add failing tests that define the desired `deals.md` buying brief without changing raw artifact names.
What to do: Test the target report sections, response modes, and file names.
How:
1. Add a new shopping-report test file for section order and gate-language expectations.
2. Extend workflow primitive tests to assert shopping still emits `deals.md`, `offers.json`, `comparison.csv`, `meta.json`, and `deals-context.json`.
3. Assert `renderShopping({ mode: "md" })` returns the same buying brief body persisted to `deals.md`.
4. Assert `compact.summary`, `context.highlights`, `json.offers`, and `path` response behavior follow the Renderer Compatibility Decision.
Files impacted: `tests/providers-shopping-report.test.ts` (new), `tests/providers-workflow-primitives.test.ts`.
Dependencies: None.
Size: Small.
Done when: Tests fail for current raw-list output and express the target deterministic markdown contract.
Acceptance criteria:
- `deals.md` section order is asserted.
- Raw artifact names are asserted unchanged.
- `md`, `context`, `json`, `compact`, and `path` response semantics are explicitly covered or intentionally preserved through existing tests.

### Task 2 - Create Pure Shopping Report Package
Reasoning: Research output quality improved by adding a focused deterministic report package instead of expanding provider collection or bloating the renderer.
Goal: Add a pure `src/providers/shopping-report/` package analogous to `src/providers/research-report/`.
What to do: Define report types, named rules, gate, synthesis, and markdown rendering behind a pure package boundary.
How:
1. Add `index.ts` plus the smallest internal module split needed for types, rules, gate, synthesis, and rendering.
2. Export `buildShoppingBriefing()` and `renderShoppingBriefingMarkdown()`.
3. Keep all functions pure: no I/O, no network, no randomness, and no direct clock access.
4. Pass any current timestamp or freshness threshold as input or named rules.
Files impacted: `src/providers/shopping-report/index.ts` (new), `src/providers/shopping-report/types.ts` (new), `src/providers/shopping-report/rules.ts` (new), `src/providers/shopping-report/gate.ts` (new), `src/providers/shopping-report/synthesis.ts` (new), `src/providers/shopping-report/render.ts` (new).
Dependencies: Task 1.
Size: Medium.
Done when: The package compiles with exported builder/render functions and initial no-op or minimal report behavior that satisfies type boundaries.
Acceptance criteria:
- No report module performs boundary I/O.
- Types include gate status, confidence label, offer assessment, market baseline, warning, limitation, and full briefing.
- Tests can import the package directly.

### Task 3 - Add Deterministic Offer And Meta Readers
Reasoning: Most useful facts already exist, but they are spread across `ShoppingOffer`, nested attributes, and workflow meta.
Goal: Build defensive adapters from `ShoppingOffer[]` and `meta` into a stable report view model.
What to do: Extract available facts without inventing missing seller or price-history data.
How:
1. Read title, URL, provider, product id, total price, currency, shipping, availability, rating, reviews, deal score, and attributes from `ShoppingOffer`.
2. Read retrieval path, price source, price trust, original retrieved timestamp, capture timestamp, brand, image metadata, extraction quality, and canonical URL from `attributes.shopping_offer` and sibling attributes when present.
3. Read diagnostics, alerts, filter counts, selected providers, requested region, and region authority through a typed `ShoppingReportMetaView` created from `Record<string, unknown>`.
4. Classify missing, fallback-only, and malformed fields as explicit limitations and warning candidates.
5. Prove the adapter treats postprocess-filled timestamps as inferred unless original nested provenance confirms freshness.
Files impacted: `src/providers/shopping-report/types.ts`, `src/providers/shopping-report/rules.ts`, `src/providers/shopping-report/synthesis.ts`, `tests/providers-shopping-report.test.ts`.
Dependencies: Task 2.
Size: Medium.
Done when: Tests prove the report reader distinguishes observed, inferred, and missing evidence.
Acceptance criteria:
- Missing values become limitations, not fabricated facts.
- Region advisory state is surfaced from meta when present.
- Price source/trust is available to gate and render logic.

### Task 4 - Implement Readiness Gate
Reasoning: Ranked offers are not buying guidance unless confidence is constrained by evidence quality.
Goal: Make confident buying guidance conditional on shopping-specific evidence.
What to do: Implement pass, partial, and fail gate evaluation.
How:
1. Evaluate offer count, duplicate pressure, query relevance, availability, freshness, price trust, region authority, diagnostics, and market-baseline sufficiency.
2. Treat fail as no confident recommendation.
3. Treat partial as bounded candidate language.
4. Treat pass as bounded recommendation language only when criteria are met.
Files impacted: `src/providers/shopping-report/gate.ts`, `src/providers/shopping-report/rules.ts`, `src/providers/shopping-report/types.ts`, `tests/providers-shopping-report.test.ts`.
Dependencies: Task 3.
Size: Medium.
Done when: Direct package tests cover all three gate statuses and language constraints.
Acceptance criteria:
- Fail gate prevents confident recommendation language.
- Partial gate explains constraints.
- Pass gate remains conservative and source-backed.

### Task 5 - Add Duplicate Pressure And Offer Grouping
Reasoning: Marketplace duplicates should not look like independent recommendations.
Goal: Detect and render duplicate pressure from same-title or same-product listings.
What to do: Group or warn on duplicate-like offers.
How:
1. Group exact normalized title matches across different URLs.
2. Group shared `product_id` across different URLs.
3. Preserve variants only when attributes show material differences.
4. Lower gate status when duplicate pressure dominates the shortlist.
Files impacted: `src/providers/shopping-report/synthesis.ts`, `src/providers/shopping-report/rules.ts`, `src/providers/shopping-report/render.ts`, `tests/providers-shopping-report.test.ts`.
Dependencies: Task 4.
Size: Medium.
Done when: Duplicate same-title/different-URL fixtures no longer produce multiple independent recommendations.
Acceptance criteria:
- Duplicate groups render in warnings or constrained offers.
- Duplicate pressure can lower readiness.
- Raw duplicated offers remain present in `offers.json`.

### Task 6 - Add Relevance And Suspicious-Title Assessment
Reasoning: The provider layer has some title guardrails, but final buying output still needs a last-mile safety gate.
Goal: Keep weak matches and bad titles out of confident recommendation language.
What to do: Score query fit and title quality inside the report layer.
How:
1. Add deterministic query relevance rules using existing query and offer title/URL evidence.
2. Flag rating-only, price-only, URL-like, and generic non-product titles.
3. Constrain or exclude weak matches from the recommendation section.
4. Cover a rating-text offer that reaches the report layer.
Files impacted: `src/providers/shopping-report/rules.ts`, `src/providers/shopping-report/synthesis.ts`, `src/providers/shopping-report/render.ts`, `tests/providers-shopping-report.test.ts`, optionally `tests/providers-shopping-branches.test.ts` for companion coverage.
Dependencies: Task 4.
Size: Medium.
Done when: Weak relevance and suspicious-title fixtures are visibly constrained and cannot become confident recommendations.
Acceptance criteria:
- Generic wireless mouse results are partial or constrained for an ergonomic-mouse query.
- Rating-only title text is excluded or rendered as a severe warning.
- Existing provider title-guard tests still pass.

### Task 7 - Add Freshness And Availability Warnings
Reasoning: Users make financial decisions from this output, so unknown stock and stale or inferred price evidence must be visible.
Goal: Make stale, missing, inferred, unknown, and out-of-stock evidence visible to buyers.
What to do: Add deterministic freshness and availability assessment.
How:
1. Distinguish observed retrieved timestamps from missing/inferred timestamps.
2. Add a named freshness threshold.
3. Warn on stale timestamps.
4. Prevent strong recommendation language on unknown or out-of-stock availability.
5. Preserve raw constrained offers.
6. Add a regression where `price.retrieved_at` is present only because postprocess filled it from `now`, and require the report to label that freshness as inferred.
Files impacted: `src/providers/shopping-report/rules.ts`, `src/providers/shopping-report/gate.ts`, `src/providers/shopping-report/render.ts`, `tests/providers-shopping-report.test.ts`.
Dependencies: Task 4.
Size: Medium.
Done when: Missing, inferred, stale, unknown, and out-of-stock cases produce deterministic warnings.
Acceptance criteria:
- Unknown availability can remain in raw evidence but lowers confidence.
- Out-of-stock offers cannot be recommended.
- Missing freshness is not treated as verified current evidence.

### Task 8 - Add Deterministic Market Baseline
Reasoning: The shopping skill promises market-baseline analysis, but runtime must not manufacture savings when evidence is thin.
Goal: Align runtime output with skill expectations using evidence-gated market math.
What to do: Compute same-currency market baseline only when deterministic sample criteria are met.
How:
1. Group offers by currency.
2. Compute average, median, sample count, lowest total, and baseline confidence.
3. Compute anchor/list price savings only when explicit anchor/list fields exist in attributes.
4. Warn on low sample size or missing anchor coverage.
5. Render `market baseline unavailable` when criteria are not met.
Files impacted: `src/providers/shopping-report/synthesis.ts`, `src/providers/shopping-report/rules.ts`, `src/providers/shopping-report/render.ts`, `tests/providers-shopping-report.test.ts`, `skills/opendevbrowser-shopping/scripts/analyze-market.sh` for alignment review only.
Dependencies: Task 3, Task 4.
Size: Medium.
Done when: Market baseline output is deterministic, conservative, and explicitly unavailable when evidence is insufficient.
Acceptance criteria:
- Same-currency average and median are tested.
- Low sample size and missing anchor coverage produce warnings.
- Savings language is not rendered when unsupported.

### Task 9 - Wire `deals.md` To The Buying Brief
Reasoning: The product problem is at the final artifact layer, and `deals.md` should become the primary user-facing decision artifact.
Goal: Replace compact ranked markdown with the deterministic buying brief while preserving raw artifacts.
What to do: Integrate the report compiler into `renderShopping()`.
How:
1. Import `buildShoppingBriefing()` and `renderShoppingBriefingMarkdown()`.
2. Build the briefing from query, offers, and meta.
3. Use the rendered markdown as `deals.md`.
4. Keep `offers.json`, `comparison.csv`, `meta.json`, and `deals-context.json` names unchanged.
5. Preserve existing response modes and transport semantics.
Files impacted: `src/providers/renderer.ts`, `src/providers/shopping-report/index.ts`, `tests/providers-workflow-primitives.test.ts`.
Dependencies: Tasks 2 through 8.
Size: Medium.
Done when: Runtime renderer emits the buying brief and existing raw artifacts still persist.
Acceptance criteria:
- `mode: "md"` returns the same body as `deals.md`.
- `compact`, `json`, `context`, and `path` modes keep existing transport behavior.
- Raw artifact file names remain unchanged.

### Task 10 - Update `deals-context.json` Only If Needed
Reasoning: Context payloads are useful to agents, but unnecessary shape churn increases compatibility risk.
Goal: Keep context useful while avoiding raw artifact drift.
What to do: Preserve existing context keys and add only deterministic report summary fields if needed.
How:
1. Keep `query`, `highlights`, `offers`, and `meta`.
2. If adding report summary fields, document and test them.
3. Align the skill template after runtime behavior is known.
Files impacted: `src/providers/renderer.ts`, `skills/opendevbrowser-shopping/assets/templates/deals-context.json`, `tests/providers-workflow-primitives.test.ts`.
Dependencies: Task 9.
Size: Small.
Done when: Context shape is either unchanged or explicitly tested and documented.
Acceptance criteria:
- Existing context consumers still have query, highlights, offers, and meta.
- Any new fields are deterministic and documented.

### Task 11 - Add Shopping Report Quality Regressions
Reasoning: The investigation identified concrete output failures that should not regress.
Goal: Complete the regression matrix after the individual rule tests have failed first and been implemented in Tasks 4 through 8.
What to do: Add cross-rule and renderer-level tests for duplicate, availability, freshness, relevance, title, baseline, and gate behavior.
How:
1. Keep single-rule failing fixtures near the task that implements the rule.
2. Add integrated fixtures combining duplicate pressure with unknown availability and weak relevance.
3. Add renderer-level assertions that constrained offers are still present in raw artifacts but not promoted as confident recommendations.
4. Assert no confident recommendation on fail.
5. Assert raw artifact names unchanged.
Files impacted: `tests/providers-shopping-report.test.ts`, `tests/providers-workflow-primitives.test.ts`, `tests/providers-shopping-workflow.test.ts`.
Dependencies: Tasks 4 through 10.
Size: Large.
Done when: Tests cover every failure class from the investigation and pass deterministically without waiting until after renderer wiring to discover rule gaps.
Acceptance criteria:
- Duplicate pressure is rendered or grouped.
- Unknown/out-of-stock availability constrains recommendation language.
- Missing/stale/inferred freshness is visible.
- Weak relevance and suspicious titles cannot produce confident recommendations.
- Insufficient market baseline renders as unavailable.

### Task 12 - Update CLI Documentation
Reasoning: Public docs must match the new runtime contract and avoid overpromising unavailable facts.
Goal: Align CLI docs with decision-ready `deals.md` behavior.
What to do: Update shopping workflow docs after runtime behavior and tests are in place.
How:
1. Document `deals.md` as the deterministic buying brief.
2. Keep raw artifact audit guidance.
3. Explain pass, partial, and fail readiness statuses.
4. Explain advisory region enforcement and known limitations.
5. Avoid promises for seller trust, returns, warranty, or price history when not available.
Files impacted: `docs/CLI.md`.
Dependencies: Task 9, Task 11.
Size: Small.
Done when: CLI docs describe the actual artifact contract and limitations.
Acceptance criteria:
- No stale claim that shopping only emits a raw list.
- No unsupported claim that seller trust or price history is always available.

### Task 13 - Align Shopping Skill Assets
Reasoning: The shopping skill currently promises market and confidence semantics that runtime does not render.
Goal: Remove skill/runtime drift after runtime behavior exists.
What to do: Update skill instructions and templates to match the runtime buying brief and raw artifact model.
How:
1. Describe `deals.md` as the primary buying brief.
2. Describe raw artifacts as audit surfaces.
3. Align market baseline language with deterministic runtime criteria.
4. Align strong-deal rules with readiness gate behavior.
5. Update `deals-context.json` template if the runtime context shape changed.
Files impacted: `skills/opendevbrowser-shopping/SKILL.md`, `skills/opendevbrowser-shopping/assets/templates/deals-context.json`, `skills/opendevbrowser-shopping/artifacts/deal-hunting-workflows.md`.
Dependencies: Task 10, Task 12.
Size: Medium.
Done when: Skill guidance and runtime artifacts describe the same product behavior.
Acceptance criteria:
- Skill no longer promises unwired output.
- Market baseline unavailable cases are documented.
- Strong-deal language matches gate rules.

### Task 14 - Run Focused And Full Quality Gates
Reasoning: The implementation touches output contracts, tests, docs, and skills, so it needs both focused and full verification.
Goal: Prove the implementation is safe before live workflow validation.
What to do: Run targeted tests first, then full repo gates.
How:
1. Run focused shopping-report tests.
2. Run renderer/workflow primitive tests.
3. Run existing shopping provider/workflow/executor tests.
4. Run lint, typecheck, build, and full test suite.
Files impacted: Source and tests touched by Tasks 1 through 13.
Dependencies: Task 11, Task 13.
Size: Medium.
Done when: All gates pass with zero errors and zero warnings.
Acceptance criteria:
- `npm run test -- tests/providers-shopping-report.test.ts` passes.
- `npm run test -- tests/providers-workflow-primitives.test.ts tests/providers-shopping-workflow.test.ts` passes.
- `npm run test -- tests/providers-shopping.test.ts tests/providers-shopping-branches.test.ts tests/providers-shopping-executor.test.ts` passes.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test` pass.

### Task 15 - Validate With A Live Shopping Workflow
Reasoning: The user-facing bar is product-ready output, not just successful transport or unit tests.
Goal: Confirm generated artifact quality in the real runtime path.
What to do: Run a real shopping workflow and inspect generated artifacts.
How:
1. Run `node dist/cli/index.js status --daemon --output-format json` before the run.
2. Require `data.fingerprintCurrent === true`; if false or missing, restart or isolate the daemon before running the workflow.
3. Run a managed shopping workflow for a query similar to the investigated sample.
4. Inspect `.opendevbrowser/shopping/<run-id>/deals.md`.
5. Inspect raw artifacts for unchanged names.
6. Confirm gate status and recommendation language match the evidence.
Files impacted: `.opendevbrowser/shopping/<run-id>/deals.md`, `.opendevbrowser/shopping/<run-id>/offers.json`, `.opendevbrowser/shopping/<run-id>/comparison.csv`, `.opendevbrowser/shopping/<run-id>/meta.json`, `.opendevbrowser/shopping/<run-id>/deals-context.json`.
Dependencies: Task 14.
Size: Medium.
Done when: A live bundle demonstrates decision-ready output and preserved raw artifacts.
Acceptance criteria:
- `deals.md` starts with `# Shopping Buying Brief`.
- `deals.md` includes Buying Readiness Gate, Recommendation, Market Baseline, Warnings and Constraints, and Evidence Appendix.
- Raw artifacts are present with unchanged names.
- Unknown availability, stale freshness, duplicate pressure, advisory region state, or weak relevance are surfaced when present.
- No fail-gate output contains confident buying recommendation language.

Suggested commands:
```bash
node dist/cli/index.js status --daemon --output-format json
node dist/cli/index.js shopping run \
  --query "wireless ergonomic mouse" \
  --providers shopping/bestbuy,shopping/ebay \
  --budget 150 \
  --browser-mode managed \
  --mode path \
  --output-format json
```

## Acceptance Criteria
- `deals.md` is the primary decision-ready buying brief by default.
- `buying-report.md` is not added unless concrete compatibility evidence requires it.
- Raw artifact names remain unchanged.
- Markdown sections are deterministic and tested in order.
- Readiness gate supports pass, partial, and fail.
- Fail gate prevents confident recommendations.
- Duplicate pressure is detected and rendered.
- Unknown and out-of-stock availability warnings are rendered.
- Missing, stale, and inferred freshness warnings are rendered.
- Weak relevance warnings are rendered.
- Suspicious titles are warned or excluded.
- Insufficient market baseline renders as unavailable.
- Docs and shopping skill assets match runtime behavior.
- Live workflow validation inspects `.opendevbrowser/shopping/<run-id>/deals.md`.

## Open Questions
- None blocking.

## Implementation Order Assumptions
- Default to replacing `deals.md` content with the buying brief. Switch to `buying-report.md` only if implementation discovers a concrete downstream dependency on the legacy raw-list body.
- Default to keeping `deals-context.json` raw-compatible with `query`, `highlights`, `offers`, and `meta`. Add report summary fields only with tests and docs.
- Default to keeping market baseline in the first pass, but render `market baseline unavailable` whenever evidence criteria are not met. Do not block the initial implementation on external price-history integration.
- Default to report-derived `compact.summary` and `context.highlights` so agents receive the same readiness guidance as humans, while `json.offers` remains raw evidence.

## References
- `docs/investigations/shopping-workflow-output-quality-2026-06-15.md`
- `docs/plans/research-workflow-deterministic-report-quality-2026-06-14.md`
- `src/providers/research-report/`
- `src/providers/renderer.ts`
- `src/providers/shopping-postprocess.ts`
- `src/providers/shopping-compiler.ts`
- `src/providers/shopping-executor.ts`
- `src/providers/workflows.ts`
- `src/providers/shopping/index.ts`
- `tests/providers-workflow-primitives.test.ts`
- `tests/providers-shopping-workflow.test.ts`
- `tests/providers-shopping.test.ts`
- `tests/providers-shopping-branches.test.ts`
- `tests/providers-shopping-executor.test.ts`
- `skills/opendevbrowser-shopping/SKILL.md`
- `docs/CLI.md`
- [Klarna Shopping Search in ChatGPT](https://investors.klarna.com/News--Events/news/news-details/2026/Klarna-launches-AI-powered-Shopping-Search-app-in-ChatGPT/default.aspx)
- [Google merchant listing structured data](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)
- [FTC endorsement guidance](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)
- [FTC deceptive pricing guidance](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-233)
- [Amazon price history](https://www.aboutamazon.com/news/retail/how-to-check-amazon-price-history)
- [Keepa](https://keepa.com/)
- [CamelCamelCamel](https://camelcamelcamel.com/)
- [Capital One Shopping](https://www.capitalone.com/learn-grow/money-management/capital-one-shopping/)
