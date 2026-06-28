# Investigation: Inspiredesign Harvest Readiness Regression

## Summary
Confirmed and fixed. The regression was not FFmpeg/media-analysis and not a single Pinterest outage. It was a set of readiness seams where Pinterest `search_shell` discovery could short-circuit before canonical pin extraction, guidance could become Canvas-ready without manifest-backed artifact authority, hard provider failures could over-block surviving authoritative references, and CLI text could expose bare `readiness=ready` even when product authority was diagnostic-only.

Live validation from the patched checkout reached product-ready output for both exact command paths:
- `inspiredesign harvest` against a Pinterest query for a premium digital photography studio produced `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `rankedReferenceCount=4`, `authoritativeReferenceCount=4`, and `pinMediaReadyReferenceCount=4`.
- `inspiredesign run` against accepted canonical Pinterest pin URLs produced `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `rankedReferenceCount=2`, `authoritativeReferenceCount=2`, and `pinMediaReadyReferenceCount=2`.

## Symptoms
- Pinterest query harvest for a digital photography studio completed with `success: true` but `readiness: "blocked"`, `productSuccess: false`, `artifactAuthority: "diagnostic_only"`, and `reasonCode: "pinterest_browser_native_recovery"`.
- Managed web harvest found weak or blocked references and returned `needs_recovery` or `blocked`.
- Explicit web harvest captured two snapshot-ready photography references and wrote screenshots, but still returned `readiness: "blocked"`, `productSuccess: false`, and diagnostic-only authority because the provider lane hit an anti-bot/challenge state.
- Direct `inspiredesign run` on the two accepted references returned `nextStepGuidance.readiness: "ready"` with a Canvas handoff, but `productSuccess: false`, `artifactAuthority: "diagnostic_only"`, and `evidenceAuthority: "diagnostic_only"`.
- Generated `design.md`/`implementation-plan.md` in the direct run begin with a diagnostic-only warning even when the command message says `readiness=ready`.

## Background / Prior Research
- Memory indicates a verified canonical Pinterest video-pin bundle previously reached `productSuccess=true`, `artifactAuthority=product_ready`, and `evidenceAuthority=pin_media_ready` while `mediaAnalysisBacked=true`.
- Memory indicates `media-analysis.json` is intentionally a design-fact artifact only. Product readiness should be decided by saved authority surfaces such as `pin-media-index.json`, `motion-evidence.json`, screenshot evidence, and product-readiness fields.
- Prior local investigation `docs/investigations/ffmpeg-inspiredesign-landing-qa-2026-06-27.md` concluded FFmpeg/FFprobe availability and media-analysis resolver behavior were correct, and that earlier `needs_recovery`/`blocked` outputs were caused by capture/provider limitations rather than missing binaries.
- Git archaeology explore agent `5900E922-7FEA-40B9-9E2B-43CF66E5593B` found the strongest behavior change history:
  - `7206949 fix: enforce Pinterest harvest artifact readiness` introduced stricter product success gating in `src/inspiredesign/product-readiness.ts` and final demotion logic in `src/providers/workflows.ts`.
  - `6429fd9 feat(inspiredesign): add Pinterest pin-media authority` made Pinterest readiness artifact-first through trusted first-party pin-media bytes.
  - `1681546 feat: add inspiredesign media readiness authority` separated media-analysis design facts from readiness authority.
  - `28b3362 fix: harden pinterest harvest readiness closeout` and `0435146 fix: close pinterest harvest readiness gaps` tightened Pinterest discovery and readiness gap handling.
  - The agent's most important code lead is the final workflow gate around `src/providers/workflows.ts:6586-6597`, where final result fields are forced to diagnostic-only if either rendered response or computed product readiness does not confirm product success.
- Previous run artifacts from this session:
  - Pinterest query bundle: `.opendevbrowser/inspiredesign/5228c460-53bf-4ad4-b92c-743d5fd5c402`
  - Explicit web harvest bundle: `.opendevbrowser/inspiredesign/53ac958c-f20c-422b-8686-a9a98d5497b1`
  - Direct reference run bundle: `.opendevbrowser/inspiredesign/ba583ac2-fc10-4925-9a8c-ccdfb535408c`

## Investigator Findings
<!-- Pair investigator appends findings here. -->


### Pair Investigator Findings - 2026-06-27

Scope: read-only source and test investigation. Source files were not modified. `CONTINUITY.md` was not modified.

#### Hypothesis 1 - Provider failures over-block explicit authoritative references: confirmed

Evidence:
- `src/guidance/context.ts:75-90` only suppresses hard provider failures when a user-supplied URL resolves to a site recipe and that same normalized URL appears in `quality.rankedReferenceUrls`.
- `src/guidance/context.ts:93-100` makes `discovery.hardFailureReasonCodes` or `primaryConstraint.reasonCode` hard failures win unless that narrow user-supplied site-recipe suppression applies.
- `src/guidance/context.ts:103-108` checks hard failure before allowing ranked evidence to avoid provider-unavailable status.
- `src/guidance/context.ts:130-140` returns `provider_unavailable` before `design_ready`.
- `src/providers/workflows.ts:4360-4381` gathers hard discovery/meta reason codes for guidance.
- `src/providers/workflows.ts:4460-4508` feeds hard reason codes and ranked URLs into guidance, but does not include artifact-backed authority counts.
- `tests/guidance-context.test.ts:236-347` locks the current narrow suppression behavior. In particular, `tests/guidance-context.test.ts:285-290` expects a hard provider failure to remain unavailable when the requested URL is `https://example.com/reference` but the ranked URL is a Pinterest pin, and `tests/guidance-context.test.ts:328-347` expects an `auth_required` primary constraint to over-block when there is no user-ranked URL context.

Recommended fix:
- Add artifact-backed authority counts to `InspiredesignGuidanceSource.quality` and `GuidanceContext.evidence`, at minimum `authoritativeReferenceCount`, plus snapshot, motion, and pin-media counts if needed for diagnostics.
- In `buildInspiredesignGuidanceSource()` after artifact finalization, pass the manifest-backed counts already computed in `runInspiredesignWorkflow()` from `countInspiredesignArtifactBackedEvidenceAuthorities()` and `isInspiredesignAuthoritativeRankedReference()`.
- Suppress hard provider failure guidance only when ranked evidence has artifact-backed authority and the hard failure does not apply to the surviving authoritative reference. Keep hard blockers active for zero authority, mismatched URL/provenance, unresolved login/challenge pages, or no ranked references.

Regression tests:
- Add `tests/guidance-context.test.ts` coverage where `hardFailureReasonCodes: ["auth_required"]`, ranked reference count is positive, and authoritative count is positive. Expect `providerUnavailable=false` and `reasonCode="design_ready"`.
- Add the negative case with the same hard failure and ranked references but `authoritativeReferenceCount: 0`. Expect `providerUnavailable=true` and `reasonCode="provider_unavailable"`.
- Add workflow coverage in `tests/providers-inspiredesign-workflow.test.ts` for explicit URL recovery where provider/discovery has a hard failure but manifest-backed screenshot or pin-media authority exists, and assert final product readiness is not demoted by provider failure alone.

#### Hypothesis 2 - `nextStepGuidance` readiness ignores artifact-backed authority counts and can say ready while `productSuccess` is false: confirmed

Evidence:
- `src/guidance/readiness.ts:53-65` classifies readiness from provider blockers, diagnostic reasons, reference counts, required capture failure, intent match, score, and confidence only. It has no product authority, artifact authority, snapshot, motion, or pin-media count inputs.
- `src/guidance/recipes/generic.ts:165-235` emits Canvas handoff when guidance readiness is `ready`, using ranked-reference and missing-screenshot blockers only.
- `src/providers/workflows.ts:6448-6456` builds `nextStepGuidance` before product readiness.
- `src/providers/workflows.ts:6462-6501` computes manifest-backed screenshot, motion, and pin-media authority counts after guidance.
- `src/providers/workflows.ts:6502-6524` computes `productReadiness` from `nextStepGuidance.readiness` plus artifact-backed authority counts.
- `src/providers/workflows.ts:6530-6535` explicitly handles the split by replacing followthrough with `PRODUCT_READINESS_BLOCKED_SUMMARY` when `productReadiness.productSuccess` is false but `nextStepGuidance.readiness === "ready"`.
- `src/inspiredesign/product-readiness.ts:1109-1176` requires ready guidance, ranked references, no active blocker, coherent counts, all ranked references having authority, at least one artifact-backed authority, and Pinterest authority when required.
- `tests/guidance-router.test.ts:39-51` treats high-scoring ranked references as Canvas-ready without artifact count inputs.
- `tests/cli-workflows.test.ts:826-866` preserves `ready: true` and `readiness: "ready"` while expecting `productSuccess: false`, `artifactAuthority: "diagnostic_only"`, and `evidenceAuthority: "diagnostic_only"`.

Recommended fix:
- Make guidance readiness artifact-aware for Inspiredesign reference-required runs. Either pass artifact-backed authority counts into `GuidanceContext.evidence` before routing, or re-route/update `nextStepGuidance` after `productReadiness` is computed.
- Preferred minimal architecture: pass counts into guidance and add a new reason code such as `product_authority_missing` or reuse `diagnostic_only` when `rankedReferenceCount > 0` but `authoritativeReferenceCount === 0`.
- Keep brief-only runs with `referenceEvidenceRequired=false` ready without reference authority.

Regression tests:
- Add `tests/guidance-readiness.test.ts` case with strong score/confidence but `referenceEvidenceRequired=true`, `rankedReferenceCount=1`, and `authoritativeReferenceCount=0`. Expect not ready.
- Add `tests/guidance-router.test.ts` case asserting no Canvas handoff commands when artifact-backed authority is absent even if score/confidence pass.
- Add `tests/providers-inspiredesign-workflow.test.ts` case where ranked references exist but manifest-backed artifact counts are zero. Assert `nextStepGuidance.readiness` is not `ready` and `canvas-plan.request.json` is not emitted.

#### Hypothesis 3 - Pinterest search-shell non-hard failures short-circuit before valid rendered pin links are extracted: confirmed

Evidence:
- `src/providers/browser-native-discovery.ts:151-156` defines hard failures as `auth_required`, `challenge_detected`, `policy_blocked`, `rate_limited`, and `token_required`.
- `src/providers/browser-native-discovery.ts:495-498` correctly returns immediately for hard failures.
- `src/providers/browser-native-discovery.ts:515-526` returns `buildFailurePassthroughResult()` whenever the Pinterest source is `search_shell` and `fetched.failures.length > 0`, before extraction runs.
- `src/providers/browser-native-discovery.ts:527-533` performs canonical URL extraction only after that early return.
- `src/providers/browser-native-discovery.ts:327-346` can validate rendered canonical pin links from `links` and HTML hrefs.
- `tests/pinterest-guidance-recipe.test.ts:558-605`, `608-659`, `662-700`, and `1078-1131` prove search-shell records can yield canonical pins when no failure is present.
- `tests/pinterest-guidance-recipe.test.ts:1439-1474` explicitly locks the bad behavior: non-hard `env_limited` search-shell failure with a visible canonical pin returns no records.

Recommended fix:
- Keep the hard-failure early return at `src/providers/browser-native-discovery.ts:495-498`.
- Move the `search_shell && fetched.failures.length > 0` non-hard failure passthrough to after `acceptedUrls` extraction.
- If extraction finds canonical rendered pins with search-result context, return records and do not let non-hard provider context failures block them. Preserve the non-hard failure in diagnostics only if the output contract needs observability.
- If extraction finds no accepted URLs, preserve the existing failure passthrough or bad-state result.

Regression tests:
- Change `tests/pinterest-guidance-recipe.test.ts:1439-1474` to expect extracted canonical pin records for non-hard `env_limited` search-shell failure with rendered pin evidence.
- Add or retain a hard-failure case proving `auth_required`, `challenge_detected`, `policy_blocked`, `rate_limited`, and `token_required` still short-circuit before extraction.
- Add workflow coverage in `tests/providers-inspiredesign-workflow.test.ts` where browser-native discovery returns search-shell records, non-hard failure, and rendered pins. Assert accepted URLs include the canonical pins and the workflow does not return `pinterest_browser_native_recovery` solely because of the non-hard failure.

#### Hypothesis 4 - CLI/user-facing readiness message can imply readiness despite diagnostic-only authority: confirmed

Evidence:
- `src/cli/commands/inspiredesign.ts:52-66` reads top-level or meta `nextStepGuidance.readiness` and returns that string.
- `src/cli/commands/inspiredesign.ts:69-72` appends `readiness=<value>` to the completion message whenever readiness exists.
- `src/cli/commands/inspiredesign.ts:363-376` always returns `success: true`, spreads resolved product-readiness fields, and uses that message.
- `src/cli/utils/workflow-message.ts:85-103` only selects the product-ready message when `productSuccess=true`, `artifactAuthority=product_ready`, evidence authority is snapshot, motion, or pin-media ready, and ready guidance matches.
- `src/cli/utils/workflow-message.ts:257-280` otherwise returns generic completion/provider-follow-up/followthrough messages, after which `runInspiredesignCommand()` can still append `readiness=ready`.
- `tests/cli-workflows.test.ts:813-817` expects diagnostic authority while the message contains the raw readiness value.
- `tests/cli-workflows.test.ts:917-938` expects `nextStepGuidance.readiness="ready"` with claimed product authority but no artifact evidence to return `ready: true`, `readiness: "ready"`, `productSuccess: false`, and diagnostic-only authorities.

Recommended fix:
- Do not append bare `readiness=ready` for Inspiredesign when user-facing `productSuccess` is false.
- Prefer a precise suffix such as `guidanceReadiness=ready productSuccess=false artifactAuthority=diagnostic_only evidenceAuthority=diagnostic_only`.
- In `resolveInspiredesignUserFacingProductReadinessFields()`, consider making `ready` mean product-ready for user-facing output. Preserve the raw guidance value as `readiness` or rename the external label to `guidanceReadiness` if compatibility allows.

Regression tests:
- Update `tests/cli-workflows.test.ts:767-817` and `917-938` so diagnostic-only ready guidance does not produce an ambiguous bare `readiness=ready` message.
- Add assertion that diagnostic cases include `productSuccess=false` and `artifactAuthority=diagnostic_only` in the message or a clearly named field.
- Add positive CLI test proving true product-ready output still says product-ready and can include `readiness=ready` if desired.

#### Hypothesis 5 - `media-analysis.json` is not the root authority: confirmed, no code fix recommended

Evidence:
- `src/inspiredesign/product-readiness.ts:22-38` defines product authority fields and counts without any media-analysis field.
- `src/inspiredesign/product-readiness.ts:1109-1176` derives product success from ready guidance, ranked references, active blockers, coherent artifact counts, all-ranked authority, artifact-backed evidence, and required Pinterest authority. It does not read media analysis.
- `src/providers/workflows.ts:6398-6428` runs media analysis after pin-media, motion, and visual finalization, catches failures into `mediaAnalysisFailure`, and continues.
- `src/providers/workflows.ts:6462-6502` computes authority from manifest-backed screenshot, motion, and pin-media indexes, then calls product-readiness code. `mediaAnalysis` is not part of those counts.
- `src/providers/renderer.ts:1036-1124` receives `mediaAnalysis` but computes authority fields from meta/product readiness and artifact indexes.
- `src/providers/renderer.ts:1201-1236` includes `mediaAnalysis` in context/files when present, but does not stamp it with authority fields.
- `tests/providers-inspiredesign-workflow.test.ts:1180-1189` asserts media-analysis references can exist while `media-analysis.json` has no `artifactAuthority`, `evidenceAuthority`, `productSuccess`, or `diagnosticWarning`.
- `tests/providers-inspiredesign-workflow.test.ts:1217-1313` asserts passing resolved media-analysis binaries into analyzer options does not change authority.
- `docs/CLI.md:597-602` and `docs/SURFACE_REFERENCE.md:571-575` explicitly state `media-analysis.json` is design facts only and never satisfies product readiness.

Recommended fix:
- No media-analysis authority fix is needed. Keep media analysis downstream of trusted saved media and product authority driven by `pin-media-index.json`, `motion-evidence.json`, screenshot indexes, and product-readiness counts.

Regression tests:
- Keep existing media-analysis non-authority tests.
- If fixing hypotheses 1 or 2, add a negative test proving a populated `media-analysis.json` without matching manifest-backed pin-media or screenshot/motion authority still leaves `productSuccess=false`.

#### Recommended fix order

1. Fix Pinterest search-shell non-hard failure extraction first. It is isolated and already has a failing/locked regression in `tests/pinterest-guidance-recipe.test.ts:1439-1474`.
2. Make Inspiredesign guidance artifact-authority aware before or during final routing, so Canvas-ready guidance cannot diverge from product-readiness authority.
3. Update provider hard-failure suppression to respect artifact-backed authoritative references, not only user-supplied site-recipe URL matches.
4. Update CLI message/readiness labels so transport success and guidance readiness cannot be mistaken for product-ready artifacts.
5. Leave media-analysis authority unchanged.


## Investigation Log

### Phase 0 - Workspace Verification
**Hypothesis:** RepoPrompt CLI must be bound to the loaded `opendevbrowser` workspace before investigation.
**Findings:** `rpce-cli -e 'windows'` showed window `1` with workspace `opendevbrowser`; `rpce-cli -w 1 -e 'tree --type roots'` showed `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`.
**Evidence:** RepoPrompt CLI command output in current Codex turn.
**Conclusion:** Confirmed.

### Phase 1 - Initial Repro Artifact Review
**Hypothesis:** The current issue is visible in saved CLI outputs before deeper tracing.
**Findings:** Prior run output shows transport success but diagnostic product authority. Pinterest query harvest blocked on browser-native recovery. Explicit web harvest captured two snapshot-ready references but still blocked because the provider lane reported unavailable. Direct run reported Canvas-ready guidance while product authority stayed diagnostic-only.
**Evidence:** `.tmp/inspiredesign-digital-photography-20260627-062535/cli-output.json`; `.tmp/inspiredesign-digital-photography-explicit-query-20260627-063016/cli-output.json`; `.tmp/inspiredesign-digital-photography-direct-20260627-063125/cli-output.json`.
**Conclusion:** Confirmed. The investigation must separate guidance readiness, product success, provider/capture readiness, and artifact authority.

### Phase 2 - RepoPrompt Builder
**Hypothesis:** Broad code context should identify whether the behavior is expected strictness or a readiness seam regression.
**Findings:** Builder selected workflow, renderer, product-readiness, reference-board, guidance, browser-native discovery, CLI message, and focused tests. Its synthesis: strict product authority is correct, but guidance/provider recovery still operate on older ranked-reference semantics. Likely fix areas:
- `src/guidance/context.ts`: provider failures over-block explicit references that have authoritative artifact-backed evidence.
- `src/providers/workflows.ts` and `src/guidance/readiness.ts`: guidance can become ready without artifact-backed authority counts, while product readiness later demotes to diagnostic-only.
- `src/providers/browser-native-discovery.ts`: Pinterest search-shell non-hard failures can short-circuit before valid rendered pin links are extracted.
- `src/inspiredesign/product-readiness.ts` and `src/cli/utils/workflow-message.ts`: user-facing readiness/message should not imply useful design-ready output when product authority is diagnostic-only.
**Evidence:** RepoPrompt builder chat `harvest-readiness-C59BEF`.
**Conclusion:** Confirmed. Pair investigator should verify these proposed seams with exact file lines and recommend minimal fixes.

### Phase 3 - Source Fixes Implemented
**Hypothesis:** The pair-investigator findings can be fixed with narrow changes without making `media-analysis.json` authoritative.
**Findings:** Implemented the validated seam fixes:
- `src/providers/browser-native-discovery.ts`: preserved hard Pinterest failures, but moved non-hard `search_shell` failure passthrough after canonical pin extraction.
- `src/guidance/types.ts`, `src/guidance/context.ts`, `src/guidance/readiness.ts`, and `src/guidance/recipes/generic.ts`: threaded authoritative reference counts into guidance and added `artifact_authority_missing` recovery behavior.
- `src/providers/workflows.ts`: computes manifest-backed screenshot, motion, and pin-media authority counts before routing next-step guidance, then passes those counts into guidance.
- `src/cli/commands/inspiredesign.ts`: product-diagnostic cases no longer emit only a bare `readiness=ready`; they include `guidanceReadiness`, `productSuccess`, `artifactAuthority`, and `evidenceAuthority`.
**Evidence:** Current source diff and focused tests listed in the verification section below.
**Conclusion:** Confirmed. The fix keeps product authority tied to manifest-backed screenshot, motion, or pin-media evidence and leaves media analysis advisory.

### Phase 4 - Isolated Daemon Preflight
**Hypothesis:** Runtime proof must not use the stale default daemon.
**Findings:** Default daemon status reported `fingerprintCurrent=false` with `reason=daemon_fingerprint_mismatch`. An isolated daemon from `node dist/cli/index.js` was started with `OPENCODE_CONFIG_DIR=.tmp/inspiredesign-live-20260627T123847Z/opencode-config`, `OPENCODE_CACHE_DIR=.tmp/inspiredesign-live-20260627T123847Z/opencode-cache`, daemon port `57990`, and relay port `57989`. Its status reported `fingerprintCurrent=true`.
**Evidence:** `node dist/cli/index.js status --daemon --output-format json`; isolated status reported `Daemon fingerprint: current`. `status-capabilities` reported `host.mediaAnalysis.available=true`, FFmpeg `7.1.1`, and FFprobe `7.1.1`.
**Conclusion:** Confirmed. Live validation used the current checkout build and full media-analysis host capability.

### Phase 5 - Live Pinterest Query Harvest
**Hypothesis:** The patched harvest command can recover canonical Pinterest pins from a search shell and reach product-ready authority.
**Command:**
```bash
OPENCODE_CONFIG_DIR="$PWD/.tmp/inspiredesign-live-20260627T123847Z/opencode-config" \
OPENCODE_CACHE_DIR="$PWD/.tmp/inspiredesign-live-20260627T123847Z/opencode-cache" \
node dist/cli/index.js inspiredesign harvest \
  --brief "Premium digital photography studio landing page with cinematic gallery, booking funnel, and editorial portfolio system" \
  --query "Pinterest premium digital photography studio landing page cinematic parallax portfolio" \
  --provider social/pinterest \
  --max-references 5 \
  --visual-evidence required \
  --browser-mode managed \
  --use-cookies \
  --challenge-automation-mode browser_with_helper \
  --mode json \
  --timeout-ms 300000 \
  --output-format json
```
**Findings:** The workflow completed with product-ready artifacts. The saved output reported `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `readiness=ready`, `harvestReadiness=ready`, `rankedReferenceCount=4`, `authoritativeReferenceCount=4`, and `pinMediaReadyReferenceCount=4`.
**Evidence:** Bundle path `.opendevbrowser/inspiredesign/b21408ef-2e14-4907-b1b4-926c78ffba3c`. `meta.discovery.browserNativeDiagnostics.sourcePageQuality` was `search_shell`, `reason` was `reference_urls_extracted`, `extractedUrlCount=5`, and `discovery.failures=[]`. `pin-media-index.json` contained four persisted first-party Pinterest media entries. `ranked-references.json` marked all four ranked references as `evidenceAuthority=pin_media_ready` and `mediaAnalysisBacked=true`. `media-analysis.json` had four references and no product authority fields.
**Conclusion:** Confirmed. The patched extraction path is no longer locked into `pinterest_browser_native_recovery` for this real query harvest.

### Phase 6 - Live Direct Inspiredesign Run
**Hypothesis:** The direct `inspiredesign run` path no longer reports guidance-ready while product authority stays diagnostic-only when canonical Pinterest references have persisted pin media.
**Command:**
```bash
OPENCODE_CONFIG_DIR="$PWD/.tmp/inspiredesign-live-20260627T123847Z/opencode-config" \
OPENCODE_CACHE_DIR="$PWD/.tmp/inspiredesign-live-20260627T123847Z/opencode-cache" \
node dist/cli/index.js inspiredesign run \
  --brief "Premium digital photography studio landing page with cinematic gallery, booking funnel, and editorial portfolio system" \
  --url "https://www.pinterest.com/pin/48484133484227697/" \
  --url "https://www.pinterest.com/pin/119838040089635142/" \
  --browser-mode managed \
  --use-cookies \
  --challenge-automation-mode browser_with_helper \
  --mode json \
  --timeout-ms 300000 \
  --output-format json
```
**Findings:** The direct run also completed with product-ready artifacts: `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `readiness=ready`, `rankedReferenceCount=2`, `authoritativeReferenceCount=2`, and `pinMediaReadyReferenceCount=2`.
**Evidence:** Bundle path `.opendevbrowser/inspiredesign/cfd4bf3d-469a-4359-beac-b4299a07ad63`. `pin-media-index.json` contained two persisted first-party Pinterest media entries. `ranked-references.json` marked both ranked references as `evidenceAuthority=pin_media_ready` and `mediaAnalysisBacked=true`. `media-analysis.json` had two references and no product authority fields.
**Conclusion:** Confirmed. The previous direct-run mismatch is fixed for canonical Pinterest references with artifact-backed authority.

## Root Cause
Root cause was readiness drift across four seams:

1. Pinterest discovery short-circuiting: non-hard `search_shell` failures were returned before canonical `/pin/<id>/` links could be extracted from rendered search results. That made recoverable Pinterest search pages look like terminal provider failures.
2. Guidance authority blindness: `nextStepGuidance` only knew ranked-reference counts, scores, confidence, and blockers. It did not know whether each ranked reference had manifest-backed screenshot, motion, or pin-media authority, so it could produce Canvas-ready guidance while product readiness correctly demoted output to diagnostic-only.
3. Provider failure precedence: hard provider failure reason codes could globally over-block output even when surviving ranked references had artifact-backed authority.
4. Ambiguous CLI status text: top-level transport success and guidance readiness were too easy to confuse with product-ready artifacts because the CLI appended raw `readiness=ready` even for some product-diagnostic cases.

Eliminated hypotheses:
- FFmpeg/FFprobe availability was not the root cause. Isolated `status-capabilities` reported full media-analysis capability.
- `media-analysis.json` was not missing from the product gate. It is intentionally advisory and the live product-ready bundles still relied on `pin-media-index.json` and ranked reference authority, not media-analysis authority fields.

## Recommendations
Implemented:
1. Keep hard Pinterest blockers strict, but allow non-hard search-shell pages to extract canonical rendered pins before falling back to diagnostics.
2. Make Inspiredesign guidance artifact-aware by passing manifest-backed authority counts into guidance before Canvas handoff decisions.
3. Allow authoritative surviving references to overcome global provider failure diagnostics when the artifact evidence is manifest-backed and reference-scoped.
4. Keep CLI output explicit about `guidanceReadiness`, `productSuccess`, `artifactAuthority`, and `evidenceAuthority` whenever guidance readiness and product readiness diverge. Top-level `ready` now means product-ready only; use `guidanceReady` and `guidanceReadiness` for next-step guidance state.

Operational rule:
- Before trusting any daemon-backed workflow result, run `status --daemon --output-format json` and require `data.fingerprintCurrent === true`.
- Before continuing to Canvas or implementation, inspect `productSuccess`, `artifactAuthority`, `evidenceAuthority`, `ranked-references.json`, `pin-media-index.json`, and `media-analysis.json`.
- Treat `media-analysis.json` as design facts only. It can enrich direction, but it must not satisfy product readiness.
- Local proof paths under `.tmp/` and `.opendevbrowser/` are ignored artifacts, not committed fixtures. This report preserves the committed proof summary: the validated harvest reached `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `rankedReferenceCount=4`, `authoritativeReferenceCount=4`, and `pinMediaReadyReferenceCount=4`; the validated direct run reached the same authorities with two pin-media-ready references.

## Verification
- Focused tests passed: `npm run test -- tests/pinterest-guidance-recipe.test.ts tests/guidance-readiness.test.ts tests/guidance-router.test.ts tests/guidance-context.test.ts tests/cli-workflows.test.ts tests/providers-inspiredesign-workflow.test.ts`.
- Coverage-targeted follow-up passed: `npm run test -- tests/pinterest-guidance-recipe.test.ts tests/guidance-context.test.ts tests/guidance-readiness.test.ts`.
- Targeted ESLint passed for the modified source and focused test files.
- `npm run typecheck` passed.
- `npm run build` passed.
- Full `npm run test` passed: 294 test files passed, 1 skipped; 5463 tests passed, 1 skipped.
- Global branch coverage passed the gate: 25178 / 25956 covered branches, 97.0026%, deficit 0.
- Debug cleanup completed: isolated daemon PID 67749 was stopped, `.debug-journal.md` was removed, its `.git/info/exclude` entry was removed, and `.tmp/inspiredesign-live-20260627T123847Z` was trashed.

## Preventive Measures
- Keep regression tests for search-shell extraction, artifact-authority-aware guidance, provider failure suppression, workflow readiness, and CLI message semantics.
- Add live proof to closeout whenever the issue is provider/runtime-sensitive. Passing tests alone would not have proven the Pinterest recovery path.
- Keep authority terms separated in user-facing messages: transport success, guidance readiness, product success, artifact authority, and evidence authority are different layers.
- Do not use the default daemon for release or regression proof when it reports `daemon_fingerprint_mismatch`; isolate config/cache and ports or restart the matching daemon first.
