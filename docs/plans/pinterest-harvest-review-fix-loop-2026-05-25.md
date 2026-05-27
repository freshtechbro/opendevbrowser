# Pinterest Harvest Review Fix Loop Plan - 2026-05-25

## Scope
Fix the confirmed adversarial review issues for the current Pinterest inspiredesign harvest visual-first diff, then run focused tests, full quality gates, real Pinterest workflows, and repeat adversarial review until no P0/P1/P2 issues remain.

## Constraints
- Do not reintroduce out-of-band visual analysis code, flags, schemas, docs, tests, or public paths.
- Keep operational success separate from product readiness.
- Pinterest product-ready evidence must be artifact-based: canonical pin URL plus validated persisted screenshot or motion evidence, source URL provenance, first-party pin media page quality, no login, challenge, search, or chrome blockers, and ranked references pointing to persisted evidence.
- Diagnostic-only runs may succeed operationally but must not be product-ready.
- Canvas continuation must not be emitted for diagnostic or zero-reference harvests.
- Sub-agents must not edit `CONTINUITY.md`; append outcomes to `sub_continuity.md` only.

## Task 1 - Close explicit readiness and count authority gaps
Reasoning: Readiness must fail closed and cannot trust caller-supplied counts as evidence.
What to do: Recompute product-ready authority from artifact-backed ranked references and reject malformed or incoherent explicit counts.
How:
1. Make `readFiniteCount` or a new helper accept only non-negative integers.
2. Treat complete explicit counts as reporting data, not proof, unless ranked references and artifacts validate through existing authority checks.
3. Require coherent bounded counts and fail closed on over-counts, fractional counts, missing records, or diagnostic-only evidence.
4. Add regressions for count-only explicit success, over-counts, fractional counts, and ranked-reference artifact validation.
Files impacted: `src/inspiredesign/product-readiness.ts`, `tests/inspiredesign-product-readiness.test.ts`.
Acceptance criteria:
- [x] Counts alone cannot produce `artifactAuthority: "product_ready"`.
- [x] Incoherent, over-counted, or fractional explicit counts produce diagnostic-only readiness.
- [x] Focused readiness tests pass.

## Task 2 - Harden Pinterest blockers and source classification
Reasoning: Login, challenge, search, and chrome shells must outrank media or URL-shape hints.
What to do: Centralize blocker markers and make source extraction fail closed before URL-count branching.
How:
1. Add missing blockers such as `sign in`, `search results for`, and `related searches` to central classification.
2. Ensure hard blockers outrank media-grid, structural media, textual video, and canonical pin shape.
3. Make capture page-quality use the same hard blocker semantics without requiring multiple chrome markers for a blocker.
4. Apply Pinterest blocker extraction before the zero-URL branch in browser-native discovery.
5. Add regressions for mixed shell pages, zero-extraction blocker pages, and URL-text video false positives.
Files impacted: `src/inspiredesign/pinterest-media-classification.ts`, `src/inspiredesign/capture.ts`, `src/providers/browser-native-discovery.ts`, `tests/pinterest-guidance-recipe.test.ts`, `tests/providers-inspiredesign-capture.test.ts`, related provider tests.
Acceptance criteria:
- [x] Blocker pages cannot classify as `pin_media` or product candidates.
- [x] Search/chrome/login blockers fail closed before source extraction results are trusted.
- [x] URL query text cannot force `video_pin` without positive page evidence.

## Task 3 - Tighten motion evidence provenance and finalization
Reasoning: Motion readiness must be based on persisted visual artifacts with stable provenance and no diagnostic markers.
What to do: Require stable source provenance, block diagnostic reasons, normalize controls-only warnings, and bind finalized replay/preview files to runtime output paths.
How:
1. Block motion authority when diagnostic reasons are non-empty.
2. Require `sourceUrl`, `startedSourceUrl`, and `endedSourceUrl` to normalize and match for motion authority.
3. Normalize `controls-only`, `controls only`, and `controls_only` warnings as diagnostic.
4. Bind workflow-finalized replay and preview files to runtime motion paths, not any file with the right suffix.
5. Add focused regressions for each case.
Files impacted: `src/inspiredesign/product-readiness.ts`, `src/inspiredesign/motion-evidence.ts`, `src/providers/workflows.ts`, `tests/providers-inspiredesign-capture.test.ts`, `tests/providers-inspiredesign-workflow.test.ts`, `tests/providers-inspiredesign-contract.test.ts`, readiness tests as needed.
Acceptance criteria:
- [x] Diagnostic motion and controls-only variants never satisfy readiness.
- [x] Motion authority requires stable source provenance.
- [x] Finalized motion artifacts must correspond to runtime temp paths.

## Task 4 - Align renderer, CLI, docs, and public surface
Reasoning: Machine-readable outputs and public docs must describe the same workflow contract.
What to do: Add missing JSON response authority fields and resolve capture-mode behavior drift.
How:
1. Add top-level `evidenceAuthority` to JSON renderer responses.
2. Decide whether non-Pinterest explicit URLs should force deep capture or honor `--capture-mode off` based on current product behavior; prefer preserving implementation if existing tests depend on deep capture, but document it consistently.
3. Update `src/public-surface/source.ts`, generated manifest, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, and tests as needed.
4. Run public-surface/help/docs parity tests.
Files impacted: `src/providers/renderer.ts`, `src/inspiredesign/capture-mode.ts` or docs, `src/public-surface/source.ts`, `src/public-surface/generated-manifest.json`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, renderer and parity tests.
Acceptance criteria:
- [x] JSON output exposes `evidenceAuthority` consistently.
- [x] Capture-mode docs and generated public surface match implementation.
- [x] Public-surface parity tests pass.

## Task 5 - Validation, real Pinterest workflows, adversarial rereview, and landing
Reasoning: Static tests are necessary but not sufficient for Pinterest artifact authority.
What to do: Run focused tests, full quality gates, real Pinterest harvest workflows, collect screenshot/snapshot evidence, rerun adversarial review, fix new findings, then prepare atomic commits and PR landing.
How:
1. Run focused tests for changed areas.
2. Run `npm run typecheck`, `npm run lint`, `npm run build`, public-surface parity tests, and full `npm run test` with no concurrent coverage writers.
3. Preflight daemon with `npx opendevbrowser status --daemon --output-format json` and require current fingerprint before daemon-backed workflows.
4. Run real Pinterest image-pin and video-pin harvest workflows with artifacts under `/tmp` or ignored local artifacts, using extension/cookies when available and managed fallback only for non-authenticated checks.
5. Inspect generated `ranked-references.json`, `screenshot-index.json`, `motion-evidence.json`, `meta-prompt.md`, screenshots, snapshots, and readiness fields.
6. Rerun adversarial RepoPrompt Review. If findings remain, repeat fix/test/workflow/review.
7. When clean, create atomic conventional commits with `Co-authored-by: Codex <noreply@openai.com>` and land the PR.
Files impacted: source/tests/docs as needed, ignored local artifacts only for workflow evidence.
Acceptance criteria:
- [x] Focused and full test gates pass with branch coverage at or above the 97% threshold. Fresh final gates: `npm run test` passed with 283 files passed, 4778 tests passed, 1 skipped test file, 1 skipped test, and branch coverage `97`; `npm run typecheck`; `npm run lint`; `npm run build`; `node scripts/docs-drift-check.mjs`; broad prohibited-term sweep; `git diff --check`.
- [x] Real Pinterest workflows produce expected diagnostic or product-ready states with persisted artifacts and no out-of-band visual analysis paths. Fresh validation artifact root: `/tmp/opendevbrowser-pinterest-validation-20260527-tjNC0h`; isolated daemon preflight reported `fingerprintCurrent:true`; the Pinterest harvest exited `0`, stayed diagnostic-only with `productSuccess:false`, `artifactAuthority:diagnostic_only`, `evidenceAuthority:diagnostic_only`, emitted no `canvas-plan.request.json`, and had no prohibited media terms.
- [x] Final adversarial review reports no P0/P1/P2 issues. Latest targeted local adversarial review over readiness, workflow, renderer, help, public surface, and tests found no new P0/P1/P2 issue before final gates.
- [ ] Atomic commits are ready and PR landing proceeds only after clean gates.
