# Product-Video Output Quality Fix: Implementation Plan

## Goal
Implement an evidence-bounded product-video presentation layer so `copy.md`, `features.md`, `product.json`, `manifest.json`, and returned payloads are presentation-ready or explicitly readiness-gated, while preserving raw product evidence and existing workflow artifact storage.

The implementation must add deterministic quality gates, focused regression tests, real workflow validation, atomic commits, scoped review loops, PR review loops, and merge-only-after-green-checks criteria.

## Primary Decision
Use `src/providers/product-video-presentation/` as the new pure compiler/gate seam and integrate it inside `runProductVideoWorkflow()` during artifact assembly.

Rationale:
- The root defect is not missing provider evidence. The bad bundle preserves raw evidence and even contains clean specs.
- The defect is promotion of raw marketplace text into final presentation artifacts.
- Product-video does not have renderer modes like research and shopping, so forcing it through `renderer.ts` would add compatibility churn without solving the specific seam.
- A pure module keeps presentation logic out of `workflows.ts` and follows the proven research/shopping quality pattern without over-coupling product-video to their renderer path.

## Output Contract
Preserve existing artifact names:
- `manifest.json`
- `product.json`
- `pricing.json`
- `copy.md`
- `features.md`
- `raw/source-record.json`
- image and screenshot files when present

Add one machine-readable artifact:
- `presentation-readiness.json`

Add readiness fields additively:
- `meta.presentationReadiness`
- `meta.productVideoReadiness`
- `manifest.readiness.presentation`
- `manifest.readiness.productVideo`
- `product.presentationReadiness`

Stable readiness object shape:

```ts
type ProductVideoReadinessStatus = "pass" | "partial" | "fail";

interface ProductVideoReadinessSummary {
  status: ProductVideoReadinessStatus;
  warnings: string[];
  reasonCodes: ProductVideoPresentationReasonCode[];
  criteria: Array<{
    label: string;
    observed: string;
    threshold: string;
    passed: boolean;
  }>;
}
```

Initial reason-code namespace:
- `marketplace_chrome_rejected`
- `positive_spec_promoted`
- `insufficient_clean_feature_evidence`
- `copy_omitted_by_request`
- `missing_visual_assets`
- `unsupported_claim_rejected`
- `selected_record_changed`
- `copy_generation_blocked`

Readiness statuses:
- `pass`: clean evidence supports presentation copy, benefit bullets, and no blocking marketplace-chrome leakage.
- `partial`: useful evidence exists but copy was omitted, too few benefits were found, visuals are missing, or non-blocking warnings constrain production use.
- `fail`: no clean product benefit evidence can be promoted, or final copy/features would rely on marketplace chrome.

`include_copy=false` decision:
- Preserve opt-out intent by not generating creative copy.
- Keep `copy.md` readiness-note-only, not silently empty.
- Set `presentationReadiness.status` to `partial` when feature evidence exists.
- Add reason code `copy_omitted_by_request`.
- Do not mark the pack as final presentation-ready until copy is generated or supplied.

Record/evidence identity:
- `raw/source-record.json` must represent the normalized record used for `productPayload` and presentation synthesis.
- If record selection chooses a record other than `details.records[0]`, add `selected_record_changed` and record `selectedRecordId`, `originalPrimaryRecordId`, and candidate summaries in `presentation-readiness.json`.
- Do not add a full `raw/source-records.json` artifact in the first implementation unless a test proves single selected raw evidence is insufficient.
- `presentation-readiness.json` should carry candidate summaries and rejected-candidate reasons, not full raw page text.

## Architecture Critique
The current architecture correctly preserves raw evidence but conflates extraction with publishable presentation writing. `runProductVideoWorkflow()` selects a primary record, derives raw-ish features and copy, and writes them directly to user-facing artifacts. That shortcut makes string filters such as `sanitizeFeatureList()` the de facto quality gate, which is not enough for product-presentation output.

The right fix is raw/presentation separation. Provider collection and raw records should continue to preserve page evidence, including noisy marketplace text. The presentation compiler should read that evidence, reject marketplace chrome, promote clean specs into conservative benefits, emit readiness metadata, and abstain when evidence is insufficient.

Alternatives rejected:
- Do not rewrite shopping/provider collection in this plan. Collection can improve later, but raw noisy text is still valid audit evidence.
- Do not rely on `sanitizeFeatureList()` as the final defense. It missed the observed shipping, condition, quantity, and seller fragments.
- Do not route product-video through `renderer.ts` in this plan. Product-video directly assembles an asset pack and does not expose renderer modes.
- Do not rename `copy.md` or `features.md`. Downstream product-presentation skill and helper scripts expect those names.
- Do not add LLM generation in this pass. External provider research supports schema, grounding, evals, and abstention, but this codebase already has deterministic compiler patterns that fit the task with less risk.

## Background
- Required investigation basis: `docs/investigations/product-video-output-quality-2026-06-15.md`. It found that product-video preserves raw evidence correctly, but promotes raw or lightly filtered marketplace strings into final artifacts without a deterministic presentation compiler or readiness gate.
- Verified bad bundle: `.opendevbrowser/product-video/25883d44-d063-4eb8-9efb-5b120c50d46f/`. `manifest.json:14-18`, `product.json:6-10`, `copy.md:1`, and `features.md:1-2` contain quantity, condition, shipping, and packaging fragments; `raw/source-record.json:7` contains clean facts such as `Type Vertical Mouse`, `Maximum DPI 1200`, `Connectivity Wireless`, and `Features Adjustable DPI, Ergonomic`.
- CLI entrypoint: `src/cli/commands/product-video.ts:210` dispatches `product.video.run`; daemon routes that command to `runProductVideoWorkflow()` in `src/cli/daemon-commands.ts:942`; the OpenCode tool path forwards through `src/tools/product_video_run.ts:71`.
- Execution plan: `src/providers/product-video-compiler.ts:11-18` defines normalize, optional URL resolution, fetch detail, extract product data, and assemble artifacts. It has no synthesis, claim-evidence, or readiness step today.
- Runtime seam: `runProductVideoWorkflow()` compiles the plan in `src/providers/workflows.ts:6301`, resolves artifact root in `src/providers/workflows.ts:6321`, optionally resolves product names through shopping in `src/providers/workflows.ts:6407-6433`, fetches product detail in `src/providers/workflows.ts:6507-6522`, and selects `details.records[0]` as primary in `src/providers/workflows.ts:6542`.
- Extraction seam: `deriveFeatureList()` prioritizes structured features, marketplace summary, about-item section, refreshed metadata, and raw content sentences in `src/providers/workflows.ts:5058-5086`; `resolveProductCopy()` can fall back to marketplace summary copy in `src/providers/workflows.ts:5188-5222`.
- eBay leakage seam: `extractMarketplaceSummaryCopy()` extracts text between `Condition:` and `Buy It Now` for eBay pages in `src/providers/workflows.ts:4936-4948`, which matches the bad bundle's quantity/condition leak.
- Metadata refresh is not copy-quality control: `needsProductMetadataRefresh()` checks URL, title, brand, and structured price in `src/providers/workflows.ts:5096-5103`, not whether `copy` or `features` are presentation-ready.
- Artifact assembly seam: `productPayload`, `manifestPayload`, `copy.md`, and `features.md` are written directly from `featureList` and `copyText` in `src/providers/workflows.ts:6623-6666`; raw source evidence is preserved at `raw/source-record.json`.
- Handoff seam: `buildProductVideoSuccessHandoff()` tells users to inspect `manifest.json`, copy, and features, then run the product-presentation helper in `src/providers/workflow-handoff.ts:398-415`, but it does not distinguish copy-ready from raw-extraction output.
- Skill contract seam: `skills/opendevbrowser-product-presentation-asset/SKILL.md:46-57` treats `copy.md` and `features.md` as expected pack artifacts; `skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh:28-35` reads `manifest.product.features` and `manifest.product.copy` directly and labels them as verified features/copy input.
- Test gap: `tests/providers-product-video-workflow.test.ts:86-91` defaults `include_copy` to false in helpers; `tests/providers-product-video-workflow.test.ts:98-171` covers plan shape; `tests/providers-product-video-workflow.test.ts:349-394` covers direct URL output shape; `tests/providers-product-video-workflow.test.ts:594-705` covers some invalid target and price gates, but not copy/feature quality.
- Artifact test gap: `tests/providers-artifacts-workflows.test.ts:1973-2048` uses clean fixture text and verifies artifact paths/raw redaction, but not marketplace-chrome rejection or positive spec promotion.
- Research prior art: `renderResearch()` writes deterministic `report.md` while preserving raw records/context/meta in `src/providers/renderer.ts:672-704`; `src/providers/research-report/gate.ts:73-187` evaluates evidence gate status; `src/providers/research-report/render.ts:291-318` renders deterministic report sections.
- Shopping prior art: `renderShopping()` writes deterministic `deals.md` while preserving raw offers/comparison/meta/context in `src/providers/renderer.ts:916-947`; `src/providers/shopping-report/gate.ts:79-207` gates recommendations; `src/providers/shopping-report/render.ts:218-228` renders fixed sections; `tests/providers-shopping-report.test.ts:143-161` asserts heading order.
- Validation prior art: `docs/plans/shopping-workflow-decision-ready-output-2026-06-15.md` requires focused tests, workflow primitive tests, broader provider/workflow tests, lint/typecheck/build/full tests, daemon `fingerprintCurrent === true` preflight, real workflow run, artifact inspection, scoped adversarial review, and fix/rerun loops.

## External Research
External provider guidance supports one design principle: final user-facing output should be typed, grounded in evidence, evaluated by explicit criteria, and allowed to abstain. OpenAI Structured Outputs and Evals support strict readiness/claim schemas and regression graders; AWS contextual grounding, Azure RAG evaluators, LangSmith, and Ragas support claim support, relevance, completeness, and stage-level evaluation; Google Merchant Center product data rules support excluding non-product shipping, seller, checkout, quantity, and condition boilerplate from product descriptions.

Sources:
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Evals: https://developers.openai.com/api/docs/guides/evals
- AWS Bedrock contextual grounding: https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html
- Microsoft Azure RAG evaluators: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/rag-evaluators
- LangSmith RAG evaluation: https://docs.langchain.com/langsmith/evaluate-rag-tutorial
- Ragas faithfulness metric: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/
- Google Merchant Center description attribute: https://support.google.com/merchants/answer/6324468?hl=en
- Google Merchant Center title attribute: https://support.google.com/merchants/answer/6324461?hl=en

## Approach
Create a pure `src/providers/product-video-presentation/` package with typed input, candidate collection, marketplace-noise rejection, positive spec promotion, readiness gate, copy/features renderers, and a public `buildProductVideoPresentation()` function.

Wire the package only at product-video artifact assembly. Existing helpers such as `deriveFeatureList()` and `resolveProductCopy()` may remain as extraction candidates or legacy utility seams, but they must not be the final source of user-facing copy/features.

Preserve raw evidence. Add `presentation-readiness.json` as the machine-readable audit artifact. Keep `copy.md` and `features.md` as the user-facing artifacts, but render them from evidence-bounded output or explicit readiness notes.

Keep the implementation deterministic. Do not add an LLM dependency, network calls, filesystem access, randomness, or direct clock access inside the presentation compiler. Pass any runtime facts in through typed inputs.

## Test Inventory Before Coverage Runs
Inventory these branches before running broad coverage:
- Noisy eBay marketplace chrome rejection: quantity, condition, shipping, seller feedback, checkout, `Buy It Now`, item-condition packaging, and returns text are rejected from final presentation artifacts.
- Positive spec promotion: `Type Vertical Mouse`, `Maximum DPI 1200`, `Connectivity Wireless`, and `Features Adjustable DPI, Ergonomic` become conservative benefit bullets.
- Readiness pass: clean title, usable price, copy enabled, at least 3 promoted benefits, and no blocking warnings produce pass.
- Readiness partial: clean evidence exists but copy is omitted, visuals are missing, or too few benefits are found.
- Readiness fail: only marketplace chrome exists and no clean specs are promotable.
- Raw evidence preservation: `raw/source-record.json` remains present and keeps noisy source text with existing redaction.
- Response/manifest/product metadata: readiness appears additively and existing response keys stay stable.
- Handoff/helper behavior: failed or partial packs are not described as verified creative input.

Minimum expected new tests:
- 8 focused presentation compiler tests.
- 4 workflow integration tests.
- 2 artifact persistence tests.
- 2 handoff/helper tests.
- 1 skill/template/schema assertion if the existing skill validator can cover it.

## Work Items

## Task 1 - Lock The Presentation Contract
Reasoning: The safest first change is to make the desired contract executable before implementation, including negative and positive output-quality expectations.
What to do: Add failing tests for final artifact semantics, readiness metadata, and raw evidence preservation.
How:
1. Add `tests/providers-product-video-presentation.test.ts` with pass, partial, fail, noisy eBay, and positive spec-promotion fixtures.
2. Extend `tests/providers-product-video-workflow.test.ts` with a direct URL runtime fixture that includes noisy marketplace text and clean specs.
3. Extend `tests/providers-artifacts-workflows.test.ts` to assert `presentation-readiness.json` exists and raw redaction remains unchanged.
4. Preserve top-level response key assertions while adding nested readiness assertions.
Files impacted: `tests/providers-product-video-presentation.test.ts` (new), `tests/providers-product-video-workflow.test.ts`, `tests/providers-artifacts-workflows.test.ts`.
Dependencies: None.
Acceptance criteria:
- Current code fails the new presentation compiler tests.
- Current code fails the noisy eBay workflow artifact test.
- Tests assert both absence of marketplace chrome and presence of promoted clean specs.
- Tests assert `raw/source-record.json` preserves original noisy evidence.

## Task 2 - Add The Pure Presentation Compiler
Reasoning: `workflows.ts` should not become a dumping ground for presentation logic; product-video needs a focused deterministic compiler analogous to the research/shopping quality packages.
What to do: Add `src/providers/product-video-presentation/` with typed input, rules, gate, renderers, and public builder.
How:
1. Add a public `buildProductVideoPresentation()` API plus public readiness and evidence types.
2. Implement normalization, marketplace-noise classifiers, supported spec labels, labeled spec extraction, candidate collection, and benefit promotion.
3. Implement `evaluateProductVideoPresentationReadiness()` and `evaluateProductVideoReadiness()`.
4. Implement deterministic renderers for `copy.md`, `features.md`, and readiness notes.
5. Use a small internal file split, likely `index.ts`, `types.ts`, `rules.ts`, `gate.ts`, and `render.ts`, but let implementation adjust the split if the public API, purity, and tests remain stable.
Files impacted: `src/providers/product-video-presentation/**` (new).
Dependencies: Task 1.
Acceptance criteria:
- Compiler functions are pure: no I/O, no network, no randomness, no direct clock reads.
- Marketplace chrome returns explicit rejected-candidate reasons.
- Clean specs become conservative benefits with evidence references.
- Unsupported claims are omitted and represented in warnings or rejected candidates.
- Focused compiler tests pass.

## Task 3 - Wire Presentation Output Into Product-Video Workflow
Reasoning: The root defect is the final artifact assembly shortcut, so integration belongs where `featureList` and `copyText` currently become user-facing files.
What to do: Replace direct raw/lightly filtered final copy/features with presentation compiler output while keeping raw extraction as candidate input.
How:
1. Import `buildProductVideoPresentation()` in `src/providers/workflows.ts`.
2. Build presentation input from the primary record, resolved title, brand, price, product URL, image/screenshot paths, include flags, legacy derived feature candidates, refreshed metadata, and raw content.
3. Use presentation output for `productPayload.features`, `productPayload.copy`, `manifestPayload.product.features`, `manifestPayload.product.copy`, `copy.md`, and `features.md`.
4. Add readiness metadata to `productPayload`, `manifestPayload.readiness`, `meta`, and the top-level response through existing payload objects.
5. Add `presentation-readiness.json` to the bundle with warnings, reason codes, criteria, promoted claims, rejected candidates, and evidence summary.
6. Add compact trace fields such as promoted feature count, rejected candidate count, and readiness status without including full raw text.
7. Update provider/tool response types if TypeScript requires the additive readiness fields to be represented beyond inferred object types.
Files impacted: `src/providers/workflows.ts`, optionally `src/providers/types.ts` or tool/provider response typing surfaces if compile errors expose typed contracts.
Dependencies: Task 2.
Acceptance criteria:
- Existing artifact names remain present.
- `presentation-readiness.json` is additive.
- `copy.md` and `features.md` are rendered by the presentation compiler.
- `product.json`, `manifest.json`, response payload, and `meta` expose readiness consistently.
- Workflow tests and artifact tests pass.

## Task 4 - Harden Record Selection And Metadata Inputs Without Rewriting Providers
Reasoning: First-record selection and metadata refresh are secondary risks. They should feed better evidence to the compiler without changing the provider collection model.
What to do: Add minimal record-quality selection and candidate-precedence improvements if tests show mixed records or clean metadata can be missed.
How:
1. Introduce a small pure helper near product-video workflow code or inside the presentation module to score candidate records by product title, price, image, clean specs, and low chrome pressure.
2. Keep `details.records[0]` behavior only when no better candidate is available.
3. Ensure `raw/source-record.json` represents the selected presentation source record.
4. When a non-primary record is selected, record `selected_record_changed`, selected/original record IDs, and candidate summaries in `presentation-readiness.json`.
5. Treat refreshed metadata as high-priority candidate evidence, not a fallback after marketplace summary.
6. Do not change shopping provider fetch/search collection in this task.
Files impacted: `src/providers/workflows.ts`, optionally `src/providers/product-video-presentation/rules.ts`, `tests/providers-product-video-workflow.test.ts`.
Dependencies: Task 3.
Acceptance criteria:
- Existing single-record workflows behave the same except for cleaned presentation output.
- Multi-record fixtures prefer the record with cleaner product evidence.
- Raw source identity is deterministic and documented.
- Refreshed metadata can outrank marketplace summary text for presentation candidates.
- No provider collection rewrite is included.

## Task 5 - Align Handoff, Helper, Skills, And Docs
Reasoning: Runtime readiness metadata only helps if user-facing guidance stops treating every generated copy/features file as production-ready.
What to do: Update product-video handoff, helper script, product-presentation skill assets, and CLI docs to match the new contract.
How:
1. Add optional readiness inputs to `ProductVideoHandoffInput` and pass statuses/reason codes from `runProductVideoWorkflow()`.
2. Update `buildProductVideoSuccessHandoff()` to tell users to inspect readiness before briefing production.
3. Update `render-video-brief.sh` to read `manifest.readiness`.
4. For `pass`, the helper may generate the normal production brief.
5. For `partial`, the helper should generate a gated brief with warnings and reason codes.
6. For `fail`, the helper should stop production use by exiting nonzero after printing or writing a warning-only diagnostic. It must not label copy/features as verified production input.
7. Update `skills/opendevbrowser-product-presentation-asset/SKILL.md` to describe raw evidence, presentation readiness, product-video readiness, and production-use rules.
8. Update templates in `skills/opendevbrowser-product-presentation-asset/assets/templates/` to include readiness-gated expectations and claim-evidence mapping.
9. Update `docs/CLI.md` product-video section and diagnostics section to describe `presentationReadiness`, `productVideoReadiness`, `presentation-readiness.json`, and raw evidence preservation.
Files impacted: `src/providers/workflow-handoff.ts`, `src/providers/workflows.ts`, `skills/opendevbrowser-product-presentation-asset/SKILL.md`, `skills/opendevbrowser-product-presentation-asset/scripts/render-video-brief.sh`, `skills/opendevbrowser-product-presentation-asset/assets/templates/**`, `docs/CLI.md`.
Dependencies: Tasks 3 and 4.
Acceptance criteria:
- Handoff wording is readiness-aware.
- Helper output includes readiness, warnings, reason codes, and avoids overclaiming.
- Skill/docs no longer imply all `copy.md` and `features.md` are automatically verified production input.
- Docs remain concise and match actual runtime fields.

## Task 6 - Focused Validation And Branch Coverage Closure
Reasoning: Product-video quality work adds many branches; branch coverage must be checked before running broad suites repeatedly.
What to do: Run focused tests first, compute branch deficit, add missing branch tests, then run broader gates.
How:
1. Run `npm run test -- tests/providers-product-video-presentation.test.ts`.
2. Run `npm run test -- tests/providers-product-video-workflow.test.ts tests/providers-artifacts-workflows.test.ts`.
3. Run targeted lint for changed source/tests/docs scripts using `node scripts/run-package-tool.mjs eslint ...` where applicable.
4. Run `npm run typecheck`.
5. Parse `coverage/lcov.info` or the focused coverage output to identify branch deficits for new files before running full coverage repeatedly.
6. Add missing branch tests until new presentation compiler branches satisfy the repo threshold.
Files impacted: tests only if branch gaps remain.
Dependencies: Tasks 1 through 5.
Acceptance criteria:
- Focused product-video tests pass.
- Targeted lint passes.
- Typecheck passes.
- Branch coverage deficit is known and closed before full-suite reruns.

## Task 7 - Full Gates And Live Workflow Validation
Reasoning: Passing unit tests is not enough; the user explicitly requires real workflow output that is presentation-ready, not merely transport-successful.
What to do: Run full quality gates, start or attach to a current daemon, execute real product-video workflows, and inspect generated artifacts.
How:
1. Run `npm run lint`.
2. Run `npm run typecheck`.
3. Run `npm run build`.
4. Run `npm run extension:build`.
5. Run `npm run test`.
6. Run `npm run test:release-gate` if available in the current package scripts.
7. Run `node dist/cli/index.js status --daemon --output-format json` and continue only when `data.fingerprintCurrent === true`.
8. If daemon is missing or stale, start or isolate a current daemon and rerun preflight.
9. Run a noisy marketplace route such as product-name search with eBay provider hint.
10. Run a direct product URL route when a stable product URL is available.
11. Inspect `.opendevbrowser/product-video/<run-id>/copy.md`, `features.md`, `manifest.json`, `product.json`, `pricing.json`, `presentation-readiness.json`, and `raw/source-record.json`.
Files impacted: generated `.opendevbrowser/**` artifacts only.
Dependencies: Task 6.
Acceptance criteria:
- All full gates pass with zero errors and zero warnings.
- Live bundle has no marketplace chrome in `copy.md` or `features.md`.
- Clean specs are promoted when present.
- Readiness metadata matches inspected artifact quality.
- Raw source evidence remains preserved.
- Product-video is not marked ready when only diagnostic or chrome evidence is available.

## Task 8 - Deep Review Loop
Reasoning: The fix touches a high-risk workflow boundary and user-facing claims, so review must be adversarial and artifact-backed.
What to do: Run a scoped deep review, fix all legitimate findings, and rerun impacted tests and workflows until clean.
How:
1. Review `src/providers/product-video-presentation/**`, `src/providers/workflows.ts`, `src/providers/workflow-handoff.ts`, touched tests, `docs/CLI.md`, product-presentation skill files, and at least one generated live artifact bundle.
2. Ask reviewers to check unsupported claims, marketplace leakage, readiness mismatch, raw artifact regression, helper overclaiming, and excessive logic in `workflows.ts`.
3. Fix valid findings.
4. Rerun focused tests for touched areas.
5. Rerun live workflow validation if output behavior changes.
6. Rerun full gates before PR.
Files impacted: only files required by review findings.
Dependencies: Task 7.
Acceptance criteria:
- No unresolved P0/P1/P2 review findings remain.
- Every fix has matching focused test coverage.
- Live workflow artifact remains presentation-ready or correctly readiness-gated.

## Task 9 - Atomic Commits
Reasoning: The user requires atomic commits, and this work naturally splits into plan, compiler, workflow integration, tests, docs, and validation evidence.
What to do: Commit scoped changes at milestones after relevant checks pass.
How:
1. Commit `docs: plan product-video presentation readiness` for this plan.
2. Commit `feat: add product-video presentation compiler` for the pure compiler and focused compiler tests.
3. Commit `feat: wire product-video readiness into workflow` for workflow integration and runtime metadata.
4. Commit `test: cover product-video presentation artifacts` for workflow/artifact regressions if not already paired with implementation.
5. Commit `docs: align product-video presentation contract` for CLI, handoff, helper, skill, and template updates.
6. Commit `chore: record product-video validation` only if validation notes are committed.
Files impacted: staged files per milestone.
Dependencies: Tasks 1 through 8.
Acceptance criteria:
- Each commit is scoped and conventional.
- Each commit message includes exactly one `Co-authored-by: Codex <noreply@openai.com>` trailer.
- No generated local artifacts are committed unless intentionally documented.

## Task 10 - PR Review Loop And Merge
Reasoning: The PR must prove the product outcome and avoid regressions before landing.
What to do: Open a PR, run PR checks and review loops, fix feedback, and merge only after all gates pass.
How:
1. Push the branch after atomic commits and local full gates.
2. Open PR with summary, risk notes, tests, live workflow artifact path, and readiness evidence.
3. Run PR checks and watch until complete.
4. Run a scoped PR review focused on diff correctness, output quality, contracts, docs, and tests.
5. Fix all valid PR review findings.
6. Rerun focused tests for touched areas and full gates when changes affect runtime behavior.
7. Merge only when CI is green, reviews are clear, no merge conflicts remain, and live validation evidence is attached.
Files impacted: PR metadata and any feedback-driven changes.
Dependencies: Task 9.
Acceptance criteria:
- PR checks pass.
- PR review loop has no unresolved actionable findings.
- Main branch merge completes cleanly.
- Final `main...origin/main` state is verified after merge.

## Live Workflow Acceptance Checklist
- `copy.md` contains presentation copy or an explicit readiness gate note.
- `features.md` contains only evidence-backed product benefits or an explicit readiness gate note.
- Neither `copy.md` nor `features.md` contains quantity, condition, shipping, seller feedback, checkout, packaging, returns, or `Buy It Now` chrome.
- Clean specs are promoted when present.
- `manifest.json` includes readiness metadata.
- `product.json` includes readiness metadata.
- `presentation-readiness.json` includes warnings, reason codes, criteria, promoted claims, and rejected candidate summaries.
- `raw/source-record.json` preserves noisy raw evidence with existing redaction behavior.
- `meta.presentationReadiness` and `meta.productVideoReadiness` match inspected artifacts.
- Visual readiness and presentation readiness are not conflated.

## Open Questions
- None blocking. The plan chooses `src/providers/product-video-presentation/`, preserves existing artifact names, makes `presentation-readiness.json` additive, and keeps provider collection out of scope.

## References
- Investigation: `docs/investigations/product-video-output-quality-2026-06-15.md`
- Prior plan: `docs/plans/research-workflow-deterministic-report-quality-2026-06-14.md`
- Prior plan: `docs/plans/shopping-workflow-decision-ready-output-2026-06-15.md`
- Plan critique precedent: `docs/reviews/shopping-workflow-decision-ready-output-plan-critique-2026-06-15.md`
- Plan critique for this plan: `docs/reviews/product-video-output-quality-plan-critique-2026-06-15.md`
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Evals: https://developers.openai.com/api/docs/guides/evals
- AWS Bedrock contextual grounding: https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-contextual-grounding-check.html
- Microsoft Azure RAG evaluators: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/rag-evaluators
- LangSmith RAG evaluation: https://docs.langchain.com/langsmith/evaluate-rag-tutorial
- Ragas faithfulness metric: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/
- Google Merchant Center description attribute: https://support.google.com/merchants/answer/6324468?hl=en
- Google Merchant Center title attribute: https://support.google.com/merchants/answer/6324461?hl=en

## Version History
- 2026-06-15: Initial deep plan based on product-video investigation, in-repo research/shopping precedents, RepoPrompt seam probes, context-builder draft, external provider research, and design critique follow-up.
