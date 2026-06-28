# Investigation: Pinterest Search Shell Readiness

## Summary
Pinterest `search_shell` classification was not the real product-readiness failure by itself. The break was that non-hard `search_shell` pages were previously treated as terminal before rendered canonical `/pin/<id>/` links could become pin-media evidence; the current dirty worktree fixes that and a live harvest now reaches product-ready authority while still reporting `sourcePageQuality: "search_shell"` as diagnostic provenance.

## Symptoms
- Pinterest query harvest can complete operationally but produce `diagnostic_only`, `needs_recovery`, or blocked output instead of product-ready/design-ready results.
- Pinterest search surfaces can be classified as `search_shell`, and that classification may prevent canonical `/pin/<id>/` extraction or authority promotion.
- The product must not treat wrapper `success: true` as success unless PinMedia Ready, Design Ready, Product Success, Artifact Authority, and Evidence Authority are satisfied.
- User also referenced Abacus readiness impact. `UNCONFIRMED`: whether this is a separate command path or a naming reference for the harvest/authority workflow.

## Background / Prior Research
- Memory and the current ledger record prior work on Inspiredesign readiness semantics: transport success is separate from `productSuccess`, `artifactAuthority`, and `evidenceAuthority`.
- Memory records prior Pinterest closeout lessons: canonical `/pin/<id>/` promotion must be record-local, and `media-analysis.json` is advisory design facts only, not readiness authority.
- Current worktree is dirty with readiness-related source and test changes from earlier work. This investigation must distinguish already-fixed behavior from remaining defects before applying more edits.

## Investigator Findings

### 2026-06-27 Read-only dirty-worktree verification

#### Scope and worktree state
- Status: PASS for the five requested investigation areas.
- Source was not modified by the pair investigator. The follow-up cleanup removed one unused `readiness` local in `src/cli/commands/inspiredesign.ts`.
- Dirty worktree at investigation start: 13 modified source/test files and 4 untracked docs. Relevant modified files were `src/providers/browser-native-discovery.ts`, `src/providers/workflows.ts`, `src/guidance/context.ts`, `src/guidance/readiness.ts`, `src/guidance/recipes/generic.ts`, `src/guidance/types.ts`, `src/cli/commands/inspiredesign.ts`, and focused tests.

#### 1. Browser-native discovery hard vs non-hard `search_shell` handling
- Finding: Fixed. Non-hard Pinterest `search_shell` no longer short-circuits before canonical pin extraction. Hard failures and harder Pinterest page states still block.
- Evidence:
  - `src/providers/browser-native-discovery.ts:193-195` finds hard provider reason codes before generic first-failure reasons.
  - `src/providers/browser-native-discovery.ts:495-499` still returns a hard failure result before page-quality extraction when `findHardFailure(fetched.failures)` matches.
  - `src/providers/browser-native-discovery.ts:500-504` still performs pre-extraction bad-state blocking. For authenticated browser flows, `search-shell` is deferred by the `pre_extraction` mode.
  - `src/providers/browser-native-discovery.ts:316-319` defines `isStrictPinterestSourceBlock()` as `shouldBlockPinterestSourceExtraction(classification)` except when `sourcePageQuality === "search_shell"`.
  - `src/providers/browser-native-discovery.ts:507-523` applies the strict page-quality blocker only after classifying source pages, so `login_challenge` and `chrome_only` still block while `search_shell` proceeds.
  - `src/providers/browser-native-discovery.ts:525-528` extracts recipe reference URLs before any non-hard `search_shell` passthrough.
  - `src/providers/browser-native-discovery.ts:530-552` preserves `search_shell` failure passthrough or diagnostic bad-state only when `acceptedUrls.length === 0`.
  - `src/providers/browser-native-discovery.ts:337-354` requires search-result context and rendered pin link evidence for `search_shell` records.
  - `src/providers/browser-native-discovery.ts:356-365` accepts only canonical Pinterest pin URLs, rejects strict blocks, and routes `search_shell` through the rendered-evidence guard.
- Test evidence:
  - `tests/pinterest-guidance-recipe.test.ts:560-606` proves rendered `search_shell` links extract two canonical pins and return `reason: "reference_urls_extracted"`.
  - `tests/pinterest-guidance-recipe.test.ts:608-669` proves HTML anchors are accepted only when canonical and rendered, while edit/activity/settings pin paths and non-Pinterest URLs are excluded.
  - `tests/pinterest-guidance-recipe.test.ts:1085-1131` proves search pages with Pinterest chrome text but actual search-result DOM still extract canonical pins.
  - `tests/pinterest-guidance-recipe.test.ts:1179-1206` proves zero-URL `search_shell` pages remain diagnostic.
- Remaining fix: none for canonical `/pin/<id>/` extraction. The rendered-link requirement is an intentional false-positive guard.

#### 2. Manifest-backed authority counts and guidance readiness
- Finding: Fixed. Guidance is now artifact-authority aware before routing readiness, and readiness cannot stay Canvas-ready when ranked references lack manifest-backed screenshot, motion, or pin-media authority.
- Evidence:
  - `src/providers/workflows.ts:6448-6454` builds the persisted evidence artifact path set from visual, motion, and pin-media collation files.
  - `src/providers/workflows.ts:6455-6468` filters screenshot, motion, and pin-media indexes to manifest-backed artifacts only.
  - `src/providers/workflows.ts:6482-6490` computes per-authority counts from manifest-backed artifacts.
  - `src/providers/workflows.ts:6491-6501` computes total and Pinterest-specific authoritative ranked-reference counts.
  - `src/providers/workflows.ts:6502-6514` passes `authoritativeReferenceCount`, `snapshotReadyReferenceCount`, `motionReadyReferenceCount`, and `pinMediaReadyReferenceCount` into guidance before `routeNextStepGuidance()` runs.
  - `src/guidance/context.ts:4-18` adds the authority count fields to `InspiredesignGuidanceQualitySource`.
  - `src/guidance/context.ts:140-144` detects missing artifact-backed authority when authority count is lower than ranked-reference count.
  - `src/guidance/context.ts:153` emits `artifact_authority_missing` before `design_ready`.
  - `src/guidance/context.ts:197-211` propagates authority counts into `GuidanceContext.evidence`.
  - `src/guidance/readiness.ts:42-47` detects missing artifact-backed authority from guidance evidence.
  - `src/guidance/readiness.ts:68-78` classifies `artifact_authority_missing` and partial authority as `needs_recovery`, not `ready`.
  - `src/guidance/recipes/generic.ts:681-693` adds a dedicated `inspiredesign.artifact_authority_missing` recovery recipe and tells the user to persist authoritative screenshot, motion, or pin-media evidence before Canvas.
- Test evidence:
  - `tests/providers-inspiredesign-workflow.test.ts:4634-4749` proves a query-discovered Pinterest pin with persisted first-party pin media reaches `productSuccess: true`, `artifactAuthority: "product_ready"`, `evidenceAuthority: "pin_media_ready"`, and guidance `reasonCode: "design_ready"`.
  - `tests/providers-inspiredesign-workflow.test.ts:5205-5278` proves invalid pin-media bytes leave `pin-media-index.json` empty and keep output diagnostic.
  - `tests/providers-inspiredesign-workflow.test.ts:5357-5363` and `tests/providers-inspiredesign-workflow.test.ts:5624-5630` prove mixed provider lanes without complete authority return `artifact_authority_missing` and do not emit Canvas handoff commands.
  - `tests/guidance-router.test.ts:67-83` proves missing artifact authority does not emit `canvas-session-open` or `canvas-plan-set`.
- Remaining fix: none found for manifest-backed authority counts or guidance readiness.

#### 3. Provider failure suppression with surviving authority
- Finding: Fixed for authoritative ranked references. Hard provider failures no longer globally over-block when artifact-backed ranked authority survives, but hard failures remain active when no requested Pinterest URL or artifact-backed ranked reference survives.
- Evidence:
  - `src/providers/workflows.ts:4338-4340` detects any surviving fetched or captured reference.
  - `src/providers/workflows.ts:4382-4390` suppresses discovery failures from primary-constraint selection when references survive, while leaving non-discovery failures available.
  - `src/providers/workflows.ts:4485-4488` still surfaces hard reason codes into guidance diagnostics.
  - `src/guidance/context.ts:53-59` defines hard provider failures as `auth_required`, `challenge_detected`, `policy_blocked`, `rate_limited`, and `token_required`.
  - `src/guidance/context.ts:97-112` suppresses hard provider failure signalling when the accepted user-supplied site-recipe URL survives as ranked evidence or when `authoritativeReferenceCount > 0`.
  - `src/guidance/context.ts:114-119` keeps provider unavailable true only for remaining hard signals, empty accepted evidence with failures, discovery failure without accepted URLs, or unresolved auth primary constraints.
- Test evidence:
  - `tests/guidance-context.test.ts:236-299` proves Pinterest hard failures are suppressed only when the same requested Pinterest URL survives as ranked evidence, not for unrelated ranked URLs.
  - `tests/guidance-context.test.ts:350-388` proves `authoritativeReferenceCount: 1` and `snapshotReadyReferenceCount: 1` suppress hard provider failure and return `design_ready`, while setting authority back to `0` re-enables provider unavailability.
  - `tests/guidance-context.test.ts:520-543` proves hard failures remain active when no requested Pinterest URL survives as ranked evidence.
  - `tests/providers-inspiredesign-workflow.test.ts:5488-5552` proves mixed Pinterest auth failure blocks Canvas continuation when the failed lane has no authoritative surviving reference.
  - `tests/providers-inspiredesign-workflow.test.ts:6122-6173` proves explicit references can keep Pinterest browser-native auth failures diagnostic, without claiming product success when no ranked authority survives.
- Remaining fix: none for current authoritative-reference over-blocking. A future cleanup could tighten the captured-but-not-ranked lane, but that is defensive, not a current failure.

#### 4. CLI product vs guidance readiness messaging
- Finding: Fixed. CLI output no longer emits only a bare `readiness=ready` when user-facing product readiness is false.
- Evidence:
  - `src/cli/commands/inspiredesign.ts:69-77` reads authority fields from the top-level result or from `meta`.
  - `src/cli/commands/inspiredesign.ts:79-91` emits `guidanceReadiness=<value> productSuccess=false artifactAuthority=<value> evidenceAuthority=<value>` when authority exists and `productSuccess === false`; only non-false product-success cases keep the bare `readiness=<value>` suffix.
  - `src/cli/commands/inspiredesign.ts:386-394` resolves user-facing product-readiness fields and merges them over raw daemon data before building the message.
  - `src/cli/commands/inspiredesign.ts:397-400` returns the same resolved product fields at the command response top level.
  - `src/inspiredesign/product-readiness.ts:1153-1161` requires ready guidance, coherent counts, no active blockers, all ranked references having authority, at least one artifact-ready reference, and required Pinterest authority before `productSuccess` is true.
- Test evidence:
  - `tests/cli-workflows.test.ts:767-823` proves legacy diagnostic cases and ready-guidance-without-authority cases include the explicit diagnostic suffix and do not contain bare ` readiness=<value>`.
  - `tests/cli-workflows.test.ts:826-872` proves daemon-provided diagnostic product authority is trusted over legacy derivation and still prints explicit diagnostic authority.
  - `tests/cli-workflows.test.ts:874-918` proves true product-ready authority can still emit `readiness=ready`.
  - `tests/cli-workflows.test.ts:921-949` proves self-reported daemon product readiness is downgraded to diagnostic when artifact evidence is absent, and the message stays explicit.
- Remaining fix: no functional messaging fix remains. Non-functional cleanup complete: the unused local in `src/cli/commands/inspiredesign.ts` was removed.

#### 5. Abacus and PayMedia code-path check
- Finding: No actual `Abacus` or `PayMedia` code path exists in this repo. The only current matches are this investigation document's symptom text.
- Evidence:
  - Repo-wide search for `Abacus`, `abacus`, `PayMedia`, and `paymedia` found only `docs/investigations/pinterest-search-shell-readiness-2026-06-27.md:9-10`.
  - Actual code-level readiness terms are defined in `src/inspiredesign/product-readiness.ts:22-23` as `product_ready`, `diagnostic_only`, `snapshot_ready`, `motion_ready`, `pin_media_ready`, `ranked_reference`, and `diagnostic_only`.
  - The user-facing product readiness fields are defined in `src/inspiredesign/product-readiness.ts:25-38`, including `productSuccess`, `artifactAuthority`, `evidenceAuthority`, and `pinMediaReadyReferenceCount`.
- Conclusion: Treat `Abacus` and `PayMedia` as external or user terminology, not repo code paths. The repo path is Inspiredesign product readiness with PinMedia authority.

#### Validation completed
- Focused tests:
  - `npm run test -- tests/pinterest-guidance-recipe.test.ts` passed with 58 tests.
  - `npm run test -- tests/guidance-context.test.ts tests/guidance-readiness.test.ts tests/guidance-router.test.ts tests/cli-workflows.test.ts` passed with 97 tests.
  - `npm run test -- tests/providers-inspiredesign-workflow.test.ts` passed with 144 tests.
- Static checks:
  - `node scripts/run-package-tool.mjs eslint src/providers/browser-native-discovery.ts src/providers/workflows.ts src/guidance/context.ts src/guidance/readiness.ts src/guidance/recipes/generic.ts src/guidance/types.ts src/cli/commands/inspiredesign.ts tests/pinterest-guidance-recipe.test.ts tests/providers-inspiredesign-workflow.test.ts tests/guidance-context.test.ts tests/guidance-readiness.test.ts tests/guidance-router.test.ts tests/cli-workflows.test.ts` passed.
  - `npm run typecheck` passed.
  - `npm run build` passed.
- Full gate:
  - `npm run test` passed: 294 files passed, 1 skipped; 5463 tests passed, 1 skipped.
  - `coverage/lcov.info` branch coverage is `25178/25956 = 97.0026198181538%`; required branches `25178`, deficit `0`.
- Live proof:
  - Default daemon was not trusted because it reported `fingerprintCurrent=false`; validation used an isolated repo-built daemon.
  - Isolated status command with `OPENCODE_CONFIG_DIR=.tmp/pinterest-search-shell-live-20260627T1335Z/opencode-config` and `OPENCODE_CACHE_DIR=.tmp/pinterest-search-shell-live-20260627T1335Z/opencode-cache` returned `fingerprintCurrent=true` for PID `38852`.
  - Isolated `status-capabilities --output-format json` reported `host.mediaAnalysis.available=true`, `capabilityTier=full`, FFmpeg `7.1.1`, and FFprobe `7.1.1`.
  - Exact command:

```bash
OPENCODE_CONFIG_DIR="$PWD/.tmp/pinterest-search-shell-live-20260627T1335Z/opencode-config" \
OPENCODE_CACHE_DIR="$PWD/.tmp/pinterest-search-shell-live-20260627T1335Z/opencode-cache" \
node ./dist/cli/index.js inspiredesign harvest \
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
  --output-format json > .tmp/pinterest-search-shell-live-20260627T1335Z/harvest.json 2> .tmp/pinterest-search-shell-live-20260627T1335Z/harvest.stderr
```

  - Live output file `.tmp/pinterest-search-shell-live-20260627T1335Z/harvest.json` has `success=true`, `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `nextStepGuidance.readiness=ready`, `reasonCode=design_ready`, `rankedReferenceCount=4`, `authoritativeReferenceCount=4`, and `pinMediaReadyReferenceCount=4`.
  - The same live output has `discovery.browserNativeDiagnostics.sourcePageQuality=search_shell`, `reason=reference_urls_extracted`, and `extractedUrlCount=5`, proving `search_shell` remained diagnostic provenance instead of a terminal failure.
  - Live bundle `.opendevbrowser/inspiredesign/2f2e7736-23e3-438f-a14b-c9b051b3a319` contains `ranked-references.json`, `pin-media-index.json`, `media-analysis.json`, `canvas-plan.request.json`, and 22 manifest entries.
  - `pin-media-index.json` uses the `pinMediaIndex` key and contains 4 first-party entries with `authority: "design_evidence"`, including a saved MP4 at `pin-media-evidence/43ad51b68a34/video.mp4`.
  - `media-analysis.json` has 4 reference analyses and no `productSuccess`, `artifactAuthority`, `evidenceAuthority`, or `pinMediaReadyReferenceCount` fields, preserving the design-facts-only authority boundary.
  - `harvest.stderr` is empty.
  - Isolated daemon PID `38852` was stopped with `serve --stop --port 49387 --output-format json`.

#### Overall conclusion
- The current dirty worktree appears to fully fix the original readiness seams for Pinterest `search_shell` discovery and Inspiredesign product readiness.
- No additional functional source fix is indicated from this investigation.
- Remaining cleanup from the pair findings was completed by removing the unused `readiness` local in `src/cli/commands/inspiredesign.ts`.

## Investigation Log

### Phase 0 - Workspace Verification
**Hypothesis:** RepoPrompt must be bound to the opendevbrowser workspace before investigation.
**Findings:** `rpce-cli -e 'windows'` found window `1` for `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`; `rpce-cli -w 1 -e 'tree --type roots'` confirmed the repo root.
**Evidence:** RepoPrompt window `1`; root `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`.
**Conclusion:** Confirmed.

### Phase 1 - Initial Search Surface
**Hypothesis:** The suspected seam includes Pinterest page-quality classification, browser-native discovery, Inspiredesign readiness, and CLI output messaging.
**Findings:** Initial RepoPrompt searches found `search_shell` in `src/inspiredesign/pinterest-media-classification.ts`, `src/providers/browser-native-discovery.ts`, `src/providers/workflows.ts`, `src/inspiredesign/product-readiness.ts`, `src/inspiredesign/reference-pattern-board.ts`, and related tests. The earlier readiness report also names browser-native discovery pre-extraction blocking as a suspected/fixed seam.
**Evidence:** `rpce-cli -w 1 -e 'search "search_shell"'`.
**Conclusion:** Confirmed starting point, not yet final root cause.

## Root Cause
The defect was a readiness pipeline seam, not a single bad classification label. Pinterest search pages can legitimately classify as `search_shell` when they contain Pinterest interface chrome and weak page-level media signals; the bug was treating non-hard `search_shell` plus a non-hard provider failure as terminal before `extractRecipeReferenceUrls()` could extract rendered canonical `/pin/<id>/` links. That left the workflow with no canonical pin URLs, no first-party pin-media captures, no manifest-backed authority, and downstream `diagnostic_only` or `needs_recovery` outputs.

The fixed mechanism is:
- Hard failures still win first: `findHardFailure(fetched.failures)` returns before extraction in `src/providers/browser-native-discovery.ts:497-500`.
- Strict Pinterest blockers still win before extraction: `isStrictPinterestSourceBlock()` blocks page qualities except `search_shell` in `src/providers/browser-native-discovery.ts:316-319` and `src/providers/browser-native-discovery.ts:507-521`.
- Non-hard `search_shell` now reaches canonical URL extraction in `src/providers/browser-native-discovery.ts:523-528`.
- `search_shell` only remains terminal when no acceptable canonical pins are extracted in `src/providers/browser-native-discovery.ts:529-552`.
- Extracted `search_shell` pins must be canonical, record-local, and rendered in search-result context via `src/providers/browser-native-discovery.ts:334-365`.
- Product readiness now depends on manifest-backed authority counts computed before guidance routing in `src/providers/workflows.ts:6455-6515`, not on transport success or advisory media analysis.
- Guidance marks missing artifact authority as `needs_recovery` in `src/guidance/context.ts:140-157` and `src/guidance/readiness.ts:41-74`.
- CLI output distinguishes guidance readiness from product readiness through explicit authority fields in `src/cli/commands/inspiredesign.ts:69-97` and `src/cli/commands/inspiredesign.ts:387-400`.

## Recommendations
1. Keep the current fix path: preserve `search_shell` as a diagnostic label, but do not let non-hard `search_shell` prevent canonical rendered `/pin/<id>/` extraction.
2. Keep hard blockers strict: auth, challenge, policy, rate-limit, token, and chrome-only states must remain terminal unless a separate authoritative ranked reference survives.
3. Treat product readiness as authority-gated only: `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready|snapshot_ready|motion_ready`, complete authoritative counts, and saved artifact inspection.
4. Keep `media-analysis.json` advisory only. It may enrich design facts, but must never replace `pin-media-index.json`, `screenshot-index.json`, or `motion-evidence.json` as readiness authority.
5. Treat `Abacus` and `PayMedia` as external terminology for now. Repo-wide search found no in-repo command or gate by those names; the implemented repo authority surface is Inspiredesign product readiness with PinMedia authority.
6. Treat top-level `ready` as product-ready only. When guidance is ready but product authority is false, preserve that state under `guidanceReady` and `guidanceReadiness` while keeping `ready=false`.
7. Before commit/PR closeout, preserve the live proof summary in the report or rerun the isolated harvest if the ignored `.tmp` and `.opendevbrowser` artifacts are cleaned. The proof paths themselves are local ignored artifacts, not committed fixtures.

## Preventive Measures
- Keep the focused search-shell regressions in `tests/pinterest-guidance-recipe.test.ts:560-606`, `tests/pinterest-guidance-recipe.test.ts:1175-1206`, and `tests/pinterest-guidance-recipe.test.ts:1411-1483`.
- Keep product-readiness workflow regressions in `tests/providers-inspiredesign-workflow.test.ts:4634-4755`, `tests/providers-inspiredesign-workflow.test.ts:5205-5275`, `tests/providers-inspiredesign-workflow.test.ts:5358-5368`, and `tests/providers-inspiredesign-workflow.test.ts:5625-5629`.
- Keep CLI semantic-success regressions in `tests/cli-workflows.test.ts:767-949` so wrapper `success=true` cannot masquerade as product-ready output.
- For future live Pinterest debugging, always isolate stale daemons, require `fingerprintCurrent=true`, and inspect `ranked-references.json`, `pin-media-index.json`, `media-analysis.json`, and `bundle-manifest.json` before declaring design-ready output.
- Recompute branch coverage from `coverage/lcov.info` after full tests; passing tests alone is not enough for this repo.
