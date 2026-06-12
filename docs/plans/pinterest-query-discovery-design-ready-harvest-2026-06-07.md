# Pinterest Query Discovery Design-Ready Harvest: Implementation Plan

## Goal
Fix Pinterest query discovery so rendered Pinterest search results with valid `/pin/<id>/` links are promoted into canonical Inspired Design Harvest references, then prove the full workflow produces usable, design-ready output instead of diagnostics-only output.

Success is not a green process exit. Final live acceptance requires:

- `productSuccess=true`
- `artifactAuthority=product_ready`
- `nextStepGuidance.readiness=ready`
- `evidenceAuthority` of `pin_media_ready`, `snapshot_ready`, or `motion_ready`
- Non-empty artifact-backed ranked references
- Product-ready Canvas continuation only when existing readiness gates authorize it

## Current State

### Confirmed Failure
- The investigation at `docs/investigations/pinterest-query-discovery-pin-extraction-2026-06-07.md` confirms the bug is pre-extraction blocking.
- `src/providers/browser-native-discovery.ts:167-210` builds bad-state results with `records: []`.
- `src/providers/browser-native-discovery.ts:392-408` classifies Pinterest source pages and blocks on `search_shell` before `extractRecipeReferenceUrls(...)` can inspect valid links.
- `src/inspiredesign/pinterest-media-classification.ts:61-66` treats common Pinterest search UI text such as `Pin card`, `search results for`, `related searches`, and `when autocomplete results are available` as search-shell markers.
- `src/inspiredesign/pinterest-media-classification.ts:110-120` returns `search_shell` before media-grid checks.
- `tests/pinterest-guidance-recipe.test.ts:515-590` currently preserves the bad behavior by expecting zero records even when valid regional, relative, and HTML anchor pin links are present.

### Confirmed Working Path
- Explicit-pin harvest for `https://www.pinterest.com/pin/1055599900892243/` produced `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, and `readiness=ready`.
- Successful bundle: `.tmp/pinterest-visible-pin-extension-20260607133628/inspiredesign/c8809cbc-3f8c-4f54-84ca-52538b754fd6`.
- Saved media: `pin-media-evidence/5f9625f5e934/poster.jpg`, first-party `i.pinimg.com`, canonical pin provenance, and visually usable design reference.
- This proves product readiness works after a concrete canonical pin enters the capture and finalization path.

## External Research Used

The external research supports a rendered-link extraction approach before soft source-page blocking:

- Google Search Central documents crawlable links as anchor elements with `href`, including relative links such as `/products/category/shoes`. This supports treating rendered `/pin/<id>/` anchors as valid discovery inputs when present.
- Google's JavaScript SEO guidance describes extracting links before rendering and then parsing rendered HTML for links after JavaScript execution. This matches Pinterest's rendered search grid behavior.
- MDN documents `new URL(url, base)` for resolving relative URLs against a base URL, which supports canonicalizing relative Pinterest paths.
- MDN documents `HTMLAnchorElement.href` as the absolute URL resolved from a valid relative or absolute `href`.
- Playwright documents locators as re-querying the current DOM and supports `locator.evaluateAll(...)` for inspecting rendered DOM state, which is appropriate for dynamic Pinterest grids.

External sources:

- Google crawlable links: https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- Google JavaScript SEO basics: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- MDN URL constructor: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
- MDN anchor `href`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement/href
- Playwright locators: https://playwright.dev/docs/locators

## Approach

Keep hard blockers hard, but stop treating `search_shell` as a pre-extraction hard blocker when canonical Pinterest `/pin/<id>/` result links are present on a Pinterest search URL. Query discovery should promote canonical pin candidates only. Product readiness must remain exclusively downstream and artifact-backed.

The narrow implementation shape is:

1. Preserve required-auth and provider hard-failure returns before extraction.
2. Preserve login and challenge page blockers before extraction.
3. Run `extractRecipeReferenceUrls(...)` before returning `search_shell` diagnostics.
4. If extraction returns valid canonical URLs, emit normal discovery records with diagnostic metadata only.
5. If extraction returns zero valid URLs, keep the existing diagnostic-only bad-state result.
6. Let the existing workflow capture, finalization, `pin-media-index.json`, product-readiness, and renderer gates decide product success.
7. Keep `chrome_only` blocked unless a future focused test proves the source is a Pinterest search result grid and the extracted URL is a canonical pin result anchor.

## Dependency Map

- `src/providers/browser-native-discovery.ts` depends on recipe extraction and Pinterest classification.
- `src/guidance/recipes/pinterest.ts` already supports relative and regional Pinterest URL normalization and should remain unchanged unless focused tests prove a narrow defect.
- `src/providers/workflows.ts` consumes discovery records as `acceptedUrls`, merges them into workflow input, captures pin media, finalizes artifacts, and builds the packet.
- `src/inspiredesign/product-readiness.ts` and `src/providers/renderer.ts` remain readiness authorities and should not be relaxed.
- Tests must be updated in the same sequence as production changes: unit extraction tests first, workflow regression second, live harvest last.

## File-by-File Sequence

1. Update `tests/pinterest-guidance-recipe.test.ts` to express the desired behavior and preserve hard negative cases.
2. Update `src/providers/browser-native-discovery.ts` to reorder only the Pinterest source-page soft-block flow.
3. Run the focused Pinterest recipe tests and adjust the implementation until the tests pass.
4. Add a workflow-level regression in `tests/providers-inspiredesign-workflow.test.ts`.
5. Run focused workflow tests and fix only the seams proven by failures.
6. Run full quality gates.
7. Run a live authenticated query harvest and inspect artifact readiness.

## Version History

- 2026-06-07 v1: Initial deep plan created from live workflow evidence, investigation report, external research, and RepoPrompt context_builder synthesis.
- 2026-06-07 v2: Tasks 1 through 7 implemented and verified by focused recipe tests, targeted lint, and typecheck. Remaining work starts at workflow-level regressions.
- 2026-06-07 v3: Tasks 8 and 9 implemented and verified by focused workflow tests, targeted lint, and typecheck. Remaining work starts at full quality gates, adversarial review, and live workflow proof.

## Task 1 - Invert Search-Shell Extraction Regressions
Reasoning: Existing tests encode the current bug by expecting zero records despite valid Pinterest pin links.

What to do: Replace the bad expectations with canonical extraction expectations.

How:

1. Update the test currently named around blocking search-shell extraction when media-grid signals are missing.
2. Rename it to describe extracting canonical pins from rendered search-shell links.
3. Assert records include `https://uk.pinterest.com/pin/11188699075430754/` and `https://www.pinterest.com/pin/27654985208435505/`.
4. Update the test currently named around blocking even when media-grid signals are present.
5. Assert canonical URLs are extracted from `attributes.links` and `attributes.html`.
6. Assert non-Pinterest links remain rejected by omission.
7. Assert `result.failures` is empty for successful extraction.

Files impacted: `tests/pinterest-guidance-recipe.test.ts`.

End goal: The unit suite expresses that visible rendered Pinterest pin links are valid discovery candidates even when the source page has search-shell UI text.

Acceptance criteria:

- Relative `/pin/<id>/` links canonicalize to `https://www.pinterest.com/pin/<id>/`.
- Regional Pinterest hosts such as `uk.pinterest.com` remain accepted.
- HTML anchor grid links are extracted.
- Invalid non-Pinterest links are not promoted.

## Task 2 - Add Zero-URL Search-Shell Negative Test
Reasoning: Search-shell pages without valid Pinterest URLs must remain diagnostic and must not become false positives.

What to do: Add a test proving zero extractable URLs still returns the existing bad state.

How:

1. Create a fetched record with `Pin card` or `When autocomplete results are available`.
2. Include no valid canonical `/pin/<id>/` URL.
3. Run `runBrowserNativeDiscovery(...)`.
4. Assert `records` is `[]`.
5. Assert the failure reason is `env_limited`.
6. Assert diagnostics include `badStateId: "search-shell"` and `sourcePageQuality: "search_shell"`.

Files impacted: `tests/pinterest-guidance-recipe.test.ts`.

End goal: Search-shell pages without valid Pinterest references still fail diagnostically instead of producing false harvest candidates.

Acceptance criteria:

- Zero-URL search-shell pages remain blocked.
- Existing `search_shell_without_media_signals` diagnostics remain visible.

## Task 3 - Add Login and Challenge Embedded-Link Negative Tests
Reasoning: Login walls and challenges can contain stale or decorative links that must not become harvest references.

What to do: Add tests for login and challenge records that contain embedded `/pin/<id>/` links.

How:

1. Add a login test with content such as `Log in to continue` plus `<a href="/pin/61572719900827789/">`.
2. Assert zero records and `auth_required`.
3. Add a challenge test with content such as `captcha verification challenge` plus the same embedded pin.
4. Assert zero records and `challenge_detected`.
5. Assert diagnostics identify the matching bad-state path.

Files impacted: `tests/pinterest-guidance-recipe.test.ts`.

End goal: Auth and challenge surfaces cannot be bypassed by stale or decorative embedded Pinterest links.

Acceptance criteria:

- Login pages never promote embedded pins.
- Challenge pages never promote embedded pins.

## Task 4 - Preserve Upstream Hard-Failure Tests
Reasoning: Provider failures must not be bypassed by embedded stale links.

What to do: Keep existing hard-failure expectations strict.

How:

1. Keep the test for upstream challenge failures with embedded Pinterest URLs.
2. Keep the test for upstream auth, token, policy, and rate-limit failures before extracting stale Pinterest URLs.
3. Ensure hard failures still return `records: []`.
4. Do not call extraction before hard-failure returns.

Files impacted:

- `tests/pinterest-guidance-recipe.test.ts`
- `src/providers/browser-native-discovery.ts`

End goal: Upstream provider hard failures remain strict and continue to return no records.

Acceptance criteria:

- `auth_required`, `challenge_detected`, `policy_blocked`, `rate_limited`, and `token_required` failures return zero records.
- Embedded `/pin/<id>/` links in failed fetch records are ignored.

## Task 5 - Reorder Pinterest Search-Shell Extraction
Reasoning: `search_shell` is currently treated as a hard blocker before recipe extraction, which causes visible rendered pin links to be dropped.

What to do: Move recipe URL extraction ahead of non-auth Pinterest search-shell blocking while preserving true hard blockers and keeping `chrome_only` blocked for this fix.

How:

1. In `runBrowserNativeDiscovery(...)`, keep required-browser auth checks unchanged.
2. Keep `findHardFailure(fetched.failures)` before extraction.
3. Keep recipe bad states for login and challenge before extraction.
4. Compute `pinterestSourceClassification` after hard blockers.
5. Return early before extraction only when the classification or recipe bad state represents login or challenge.
6. Run `extractRecipeReferenceUrls(...)` before returning a `search_shell` bad-state result.
7. Filter the soft-block bypass to canonical `/pin/<id>/` URLs from the Pinterest search result context.
8. If at least one canonical pin URL exists, build recipe reference records.
9. If no canonical pin URL exists and classification is `search_shell`, preserve the existing bad-state return.
10. Keep `chrome_only` blocked unless a future failing test proves a search-grid page is being misclassified as chrome-only and the extracted link is a canonical pin result anchor.

Files impacted: `src/providers/browser-native-discovery.ts`.

End goal: Pinterest query discovery promotes valid extracted pin URLs while preserving diagnostics when no valid URLs exist.

Acceptance criteria:

- Search-shell records with valid canonical `/pin/<id>/` result links return canonical discovery records.
- Board, idea, profile, account, and chrome-only links do not unblock query discovery.
- Search-shell records with zero canonical pin URLs still return `env_limited`.

## Task 6 - Keep Discovery Non-Authoritative
Reasoning: Discovery should identify candidate URLs only. Product readiness must still be granted by artifact-backed capture and finalization.

What to do: Avoid adding readiness fields or evidence authority to discovery records.

How:

1. Leave `buildRecipeReferenceRecord(...)` confidence and attributes as discovery metadata only.
2. Do not set `productSuccess`, `artifactAuthority`, `evidenceAuthority`, `authority`, or `readiness` in discovery records.
3. Keep `pinterestMediaClassification` and `pinterestSourcePageQuality` as diagnostics only.
4. Do not modify product-readiness or renderer gates unless a focused regression proves an unrelated defect.

Files impacted: `src/providers/browser-native-discovery.ts`.

End goal: Discovery remains a URL candidate step and cannot independently create product-ready output.

Acceptance criteria:

- Discovery output contains canonical URLs but no readiness authority.
- Product-ready output remains possible only after workflow capture and renderer readiness checks.

## Task 7 - Avoid URL Normalization Changes Unless Proven Necessary
Reasoning: The investigation shows URL normalization already supports relative and regional Pinterest references.

What to do: Leave Pinterest URL normalization and extraction logic unchanged unless a focused failing regression proves a narrow defect.

How:

1. Do not broaden allowed hosts.
2. Do not accept non-numeric pin IDs.
3. Do not accept spoofed hosts, non-http URLs, assets hosts, or reserved paths.
4. Keep existing normalization tests intact.

Files impacted:

- `src/guidance/recipes/pinterest.ts`
- `tests/pinterest-guidance-recipe.test.ts`

End goal: The fix stays in discovery ordering and does not broaden the Pinterest URL trust boundary.

Acceptance criteria:

- Existing spoof, reserved path, non-http, and dedupe tests remain green.
- No fallback URL normalization logic is introduced.

## Task 8 - Add Workflow-Level Query Discovery Regression
Reasoning: Unit extraction success is insufficient. The workflow must prove discovered URLs enter the existing capture and finalization path.

What to do: Add a workflow test proving query discovery accepted URLs are merged into workflow input and captured as pin-media evidence.

How:

1. In `tests/providers-inspiredesign-workflow.test.ts`, configure the test runtime fetch to return a Pinterest search record when the URL contains `/search/pins/`.
2. Put rendered pin links in `attributes.links` or `attributes.html`.
3. Return a Pinterest pin record with existing valid pin image attributes when the runtime fetches the discovered canonical pin.
4. Run `runInspiredesignWorkflow(...)` with `providers: ["social/pinterest"]`, a brief, a query, empty explicit URLs, harvest enabled, extension mode, cookies required, and visual evidence required.
5. Provide a valid `capturePinMediaEvidence` test hook that writes valid pin-media bytes using existing helper patterns.
6. Assert search fetch happens before pin fetch.
7. Assert discovery accepted URLs include the canonical pin URL.
8. Assert the discovered pin appears in final evidence and selected URLs.
9. Assert `pin-media-index.json` contains an authoritative entry.
10. Assert `productSuccess` becomes true only after artifact-backed capture exists.
11. Assert `artifactAuthority=product_ready`, `nextStepGuidance.readiness=ready`, and ranked references contain artifact-backed canonical pin references.

Files impacted: `tests/providers-inspiredesign-workflow.test.ts`.

End goal: The workflow proves query-discovered pins enter the existing artifact-backed product-ready path.

Acceptance criteria:

- Query-discovered pin URLs are merged into workflow URLs.
- Pin-media capture runs for the discovered pin.
- Discovery alone does not grant readiness.
- Product readiness comes from artifact-backed pin-media finalization.
- Final workflow metadata is product-ready only after authoritative artifacts exist.

## Task 9 - Add Workflow Negative Regression for Discovery-Only No Readiness
Reasoning: A discovered URL without valid capture artifacts must remain diagnostic-only.

What to do: Add or extend a workflow test where query discovery succeeds but pin-media capture fails validation.

How:

1. Reuse the query discovery setup from Task 8.
2. Return invalid pin-media bytes, invalid metadata, or omit required artifact fields in the capture hook.
3. Assert `pin-media-index.json` is empty.
4. Assert `productSuccess` is false.
5. Assert `artifactAuthority` is `diagnostic_only`.
6. Assert `canvas-plan.request.json` is not emitted.

Files impacted: `tests/providers-inspiredesign-workflow.test.ts`.

End goal: A successful discovery step without valid downstream artifacts remains diagnostic-only.

Acceptance criteria:

- Discovery accepted URLs alone never produce product-ready output.
- `pin-media-index.json` remains the pin-media readiness authority.
- Canvas continuation remains product-ready-only.

## Task 10 - Run Focused Automated Checks
Reasoning: The change is narrow but touches discovery and workflow readiness behavior.

What to do: Run focused tests before broad validation.

How:

1. Run `npm run test -- tests/pinterest-guidance-recipe.test.ts`.
2. Run `npm run test -- tests/providers-inspiredesign-workflow.test.ts`.
3. Run targeted lint on changed source and test files.
4. Run `npm run typecheck`.
5. Fix failures without weakening hard blockers or authority assertions.

Files impacted: none unless checks expose issues.

End goal: Focused automated checks prove the local behavior change before broader validation.

Acceptance criteria:

- Focused Pinterest recipe tests pass.
- Focused workflow tests pass.
- Targeted lint passes.
- Typecheck passes.

## Task 11 - Run Full Quality Gates
Reasoning: The implementation must be commit-ready, not just locally plausible.

What to do: Run the repository's full quality commands.

How:

1. Inspect `package.json` scripts before selecting commands.
2. Run formatter or format check if present.
3. Run full lint.
4. Run full typecheck.
5. Run full build.
6. Run full test suite.
7. Run coverage, including the repo's coverage wrapper if required.
8. Fix zero-warning and zero-error failures.

Files impacted: none unless checks expose issues.

End goal: The implementation is commit-ready under the repo's normal quality gates.

Acceptance criteria:

- Formatter or format check passes.
- Lint passes with zero warnings.
- Typecheck passes.
- Build passes.
- Full tests pass.
- Coverage passes repository thresholds.

## Task 12 - Run Live Authenticated Pinterest Query Harvest
Reasoning: The final compulsory acceptance criterion is a real query-based Pinterest harvest that produces usable design-ready output.

What to do: Run an authenticated extension-mode Pinterest query harvest and inspect artifacts.

How:

1. Confirm the daemon fingerprint is current before the daemon-backed run.
2. Use extension mode with a signed-in Pinterest browser session.
3. Run a query harvest using the repaired discovery path, for example:

```bash
node dist/cli/index.js inspiredesign harvest \
  --brief "Design a cinematic photography studio landing page with editorial image direction, confident typography, and conversion-ready service storytelling." \
  --provider social/pinterest \
  --query "cinematic photography studio landing page inspiration" \
  --browser-mode extension \
  --use-cookies \
  --cookie-policy required \
  --visual-evidence required \
  --mode json \
  --output-format json \
  --output-dir .tmp/pinterest-query-live-<timestamp>
```

4. Capture the final artifact bundle path.
5. Inspect `evidence.json`.
6. Inspect `ranked-references.json`.
7. Inspect `pin-media-index.json`.
8. Inspect `media-analysis.json`.
9. Inspect `canvas-plan.request.json`.
10. Visually inspect at least one saved media artifact when `pin_media_ready` is the evidence authority.

Files impacted: runtime artifact directory only.

End goal: A real query-based Pinterest harvest produces product-ready, design-usable output.

Acceptance criteria:

- `productSuccess=true`.
- `artifactAuthority=product_ready`.
- `nextStepGuidance.readiness=ready`.
- `evidenceAuthority` is `pin_media_ready`, `snapshot_ready`, or `motion_ready`.
- `ranked-references.json` is non-empty.
- If evidence authority is `pin_media_ready`, `pin-media-index.json` is non-empty and authoritative.
- If evidence authority is `snapshot_ready`, `screenshot-index.json` is non-empty, screenshot files exist, the evidence is associated with canonical pin references, and visual inspection shows concrete design content rather than search chrome, login, or challenge surfaces.
- If evidence authority is `motion_ready`, motion evidence is non-empty, replay or preview files exist, the evidence is associated with canonical pin references, and visual inspection shows concrete design content rather than search chrome, login, or challenge surfaces.
- `media-analysis.json` exists when pin media exists.
- `canvas-plan.request.json` exists.
- Saved media exists and is design-usable.
- Ranked references and media-analysis guidance are relevant to the supplied brief, not only generic Pinterest content.
- Output is product-ready, not diagnostic-only.

## Task 13 - Verify Artifact Authority Invariants After Live Harvest
Reasoning: The fix must not accidentally make discovery metadata or media analysis a readiness shortcut.

What to do: Inspect final artifacts for authority consistency.

How:

1. Confirm ranked references are artifact-backed.
2. Confirm `pin-media-index.json` entries include path, hash, bytes, dimensions, content type, canonical source URL, and first-party provenance.
3. Confirm `media-analysis.json` is present as design guidance but is not the sole readiness authority.
4. Confirm `evidence.json` and response metadata agree on product fields.
5. Confirm diagnostic-only artifacts are not used for Canvas continuation.
6. Run a raw-field leak spot check on `canvas-plan.request.json` for raw `mediaAnalysis`, raw `pinMediaEvidence`, raw `pinMediaIndex`, raw media paths, and direct Pinterest media URLs.

Files impacted: runtime artifact directory only.

End goal: Artifact inspection proves the live success is backed by trusted artifacts, not discovery metadata or media-analysis alone.

Acceptance criteria:

- `pin-media-index.json` remains the pin-media readiness authority.
- `media-analysis.json` does not grant readiness by itself.
- `canvas-plan.request.json` is product-ready-only and does not leak raw authority payloads.

## Task 14 - Final Adversarial Review
Reasoning: The change sits at the boundary between discovery, auth blocking, and readiness authority, so it needs a final blocker-focused review.

What to do: Run a scoped adversarial review after implementation and focused checks.

How:

1. Review only the changed discovery and workflow test seams.
2. Check for hard-blocker bypasses.
3. Check for readiness shortcuts.
4. Check for URL-normalization broadening.
5. Check for diagnostic-only output being reported as product-ready.
6. Fix any blocker and rerun focused checks plus the live harvest if behavior changes.

Files impacted: changed implementation and test files only if issues are found.

End goal: Final review confirms the fix is narrow, safe, and does not create readiness or auth bypasses.

Acceptance criteria:

- No hard-blocker bypass remains.
- No product-readiness shortcut is introduced.
- No fallback provider or hidden partial rollout is introduced.
- The live query harvest remains product-ready after fixes.

## Risk Controls

- No fallback providers.
- No readiness shortcuts in discovery.
- No media-analysis authority shortcut.
- No weakening of trusted-byte, hash, dimension, content-type, canonical-source, or first-party provenance checks.
- No broad URL normalization changes.
- No acceptance of spoofed Pinterest hosts.
- No use of board, idea, profile, account, or chrome-only URLs to unblock this query-discovery fix.
- No bypass of login, challenge, auth-required, token-required, policy-blocked, or rate-limited states.
- No feature flag or hidden partial rollout.
- No renderer product-ready gate changes unless a focused failing test proves an unrelated defect.

## Final Success Definition

The implementation is complete only when all of the following are true:

- Rendered Pinterest search-grid `/pin/<id>/` links become canonical discovery URLs.
- Hard blockers still return zero records.
- Query-discovered URLs enter the existing pin-media capture and finalization path.
- Discovery records do not carry readiness authority.
- Focused and full automated checks pass.
- A real authenticated query-based Pinterest harvest produces product-ready artifacts with real artifact-backed evidence.
- The output is usable, design-ready, and contains actionable design guidance rather than diagnostics-only artifacts.
