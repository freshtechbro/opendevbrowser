# Investigation: Pinterest DOM main-media extraction lane

Date: 2026-05-27

Branch: `codex/pinterest-fashion-studio-harvest-eval`

## Summary

The proposal is valid, but it should be implemented as a new strict Pinterest pin-media authority lane, not as a replacement for screenshot or motion evidence. The new lane should produce `pin_media_ready` references only when the workflow extracts the main pin image or video poster from the live DOM, persists first-party `i.pinimg.com` bytes into the artifact bundle, verifies canonical pin provenance, filters Pinterest page noise, and reruns ranking, readiness, renderer, and Canvas gates against manifest-backed artifacts.

Screenshots and screencasts should remain authoritative lanes for verified viewport captures, non-Pinterest references, and true video motion evidence. The DOM media lane should become a third authority beside `snapshot_ready` and `motion_ready`.

## Symptoms

- Current Pinterest harvest runs can exit successfully while remaining `diagnostic_only`.
- Rejected references often include `interface_chrome_shell` because the captured screenshot represents the Pinterest shell rather than the underlying pin media.
- The workflow may discover valid pin URLs but still produce zero ranked references and no Canvas continuation.
- Live follow-up checks showed ref-scoped DOM extraction can expose direct `i.pinimg.com` media for the same rejected pin URLs.

## User Proposal To Investigate

Replace the screenshot extraction used in the Pinterest harvest workflow with a DOM main-media extraction lane that:

1. Persists the real main pin media.
2. Records source pin provenance.
3. Filters related pins, avatars, thumbnails, and ads.
4. Reruns product readiness against the extracted media instead of the page shell screenshot.

## Background / Prior Research

- Fresh recovery artifact: `/tmp/opendevbrowser-pinterest-photography-recovery-20260527-051501/inspiredesign/91d0e9ec-7bdf-409b-80ea-dd7884c29515`.
- Ref-scoped DOM extraction root: `/tmp/opendevbrowser-pinterest-ref-dom-extract-20260527-054855`.
- Direct media verification root: `/tmp/opendevbrowser-pinterest-dom-media-verify-20260527-055032`.
- Live probe evidence found main-media DOM signals such as `closeup-image-main-MainPinImage`, `StoryPinImageBlock-MainPinImage`, and video `poster`.
- Verified direct media included 5 downloadable `i.pinimg.com` candidates, including 1200x1069, 1200x2000, 736x1741, 600x1200, and one 736x552 video poster.
- Existing product-readiness policy intentionally requires artifact-authoritative evidence and does not currently treat extracted DOM media as product-ready by itself.

## Hypotheses

- H1: The current screenshot lane fails Pinterest because capture targets the rendered page shell, not the pin media object.
- H2: A DOM main-media lane can provide stronger evidence if it persists first-party media bytes and provenance rather than only recording URLs.
- H3: The lane must integrate before ranking and readiness so extracted media can become the evidence basis for accepted references.
- H4: Noise filtering must be selector and provenance based, not only size based, because Pinterest DOM contains related pins, avatars, ads, and thumbnails with valid image URLs.
- H5: Video pins need a separate posture: poster extraction can support still-image evidence, but motion evidence still requires screencast or video handling.

## Investigator Findings

### Conclusion

- The hypothesis is **proved with conditions**. A DOM main-media lane can make Pinterest Inspired Design harvest product-ready only if it persists first-party bytes, binds the artifact to the canonical source pin, filters Pinterest page noise, and feeds ranking, product readiness, renderer gating, and bundle manifests as artifact-authoritative evidence.
- The proposal should **not replace** the screenshot and motion lanes. The current code already treats screenshot and motion as strict authority lanes, and Canvas continuation depends on them being manifest-backed and source-matched. The correct shape is a third authority lane named `pin_media_ready` beside `snapshot_ready` and `motion_ready`.
- The user-proposed integration point in `src/providers/workflows.ts` is mostly correct: run per reference after fetch and Pinterest classification, before screenshot, motion, and deep capture. The lane still needs a focused browser-manager primitive and a new evidence module so workflow code remains orchestration, not extraction logic.

### Current Pinterest harvest trace

- CLI `inspiredesign harvest` validates `run|harvest`, requires `--brief`, rejects `--query` outside harvest, checks provider URL canonicality, and calls daemon action `inspiredesign.run` with `visualEvidence`, `captureMode`, browser, cookie, and challenge options in `src/cli/commands/inspiredesign.ts:300-352`. The CLI reads explicit readiness fields back out at `src/cli/commands/inspiredesign.ts:363-374`.
- Daemon and tool entries wire browser-backed capture callbacks into `runInspiredesignWorkflow`: `captureReference`, `captureVisualEvidence`, and `captureMotionEvidence` in `src/cli/daemon-commands.ts:917-931` and `src/tools/inspiredesign_run.ts:112-127`.
- Pinterest-only harvest discovery does not force deep diagnostics by default. `resolveInspiredesignHarvestCaptureMode` keeps requested mode or `off` for Pinterest-only provider discovery and Pinterest-only URLs unless the user requests `deep` in `src/inspiredesign/capture-mode.ts:44-53`.
- Provider discovery runs browser-native site recipe discovery for Pinterest and merges accepted URLs with explicit URLs in `src/providers/workflows.ts:2118-2239` and `src/providers/workflows.ts:5195-5215`.
- Per-reference execution fetches each URL, normalizes the result, builds the visual policy, classifies Pinterest, and chooses visual-first or motion-first primary capture in `src/providers/workflows.ts:5227-5288`.
- Deep diagnostics are secondary. `captureInspiredesignReference` returns primary evidence when capture mode is `off`, records policy blockers, or merges deep snapshot, clone, DOM, visual, and motion evidence when deep capture is available in `src/providers/workflows.ts:2752-2864`.
- Primary visual capture launches a temporary browser session, imports configured cookies, verifies required cookies, navigates, probes the viewport source, and screenshots the viewport in `src/inspiredesign/capture.ts:706-813` and `src/inspiredesign/capture.ts:596-641`.
- Current Pinterest page quality is page-level, not artifact-level. The visual probe uses snapshot text plus a bounded HTML clone to classify `pin_media`, `search_shell`, `chrome_only`, and login/challenge states in `src/inspiredesign/capture.ts:524-584`, backed by classification rules in `src/inspiredesign/pinterest-media-classification.ts:32-162`.
- Visual artifact finalization only trusts runtime screenshots with a matching planned temp path, reads bytes, hashes them, writes `visual-evidence/{referenceId}/viewport.png`, and persists metadata in `src/providers/workflows.ts:2434-2478` and `src/providers/workflows.ts:3088-3154`.
- Motion finalization already provides a strong model for the new lane: planned output directory, path containment, byte limits, returned review artifacts, hash and byte metadata, and diagnostic demotion on missing artifacts in `src/providers/workflows.ts:3200-3389`.
- Ranking and readiness currently treat only `snapshot_ready`, `motion_ready`, and non-Pinterest `ranked_reference` as design authority. Pinterest evidence authority is assigned in `src/inspiredesign/reference-pattern-board.ts:641-649`, scored in `src/inspiredesign/reference-pattern-board.ts:780-822`, and filtered for design references in `src/inspiredesign/reference-pattern-board.ts:1173-1188`.
- Product readiness requires manifest-backed artifacts. Workflow filters screenshot and motion artifacts through `persistedEvidenceArtifactPaths` before counting them in `src/providers/workflows.ts:5337-5357`, then builds readiness counts in `src/providers/workflows.ts:5358-5386`.
- Renderer Canvas continuation independently rechecks authority, active blockers, Pinterest evidence requirements, and every ranked reference in `src/providers/renderer.ts:235-263`. Non-ready outputs scrub Canvas continuation in `src/providers/renderer.ts:277-343` and remove product-ready-only artifacts in `src/providers/workflows.ts:5468-5479`.

### Best integration point

- Add a focused browser-manager primitive, for example `capturePinterestPinMedia(sessionId, { path, targetId, timeoutMs })`, rather than exposing a generic DOM evaluation surface. `BrowserManagerLike` currently exposes targeted primitives such as `screenshot`, DOM getters, `clonePageHtmlWithOptions`, and screencast methods in `src/browser/manager-types.ts:183-294`, while screenshots are concrete browser-manager operations in `src/browser/browser-manager.ts:2008-2074`.
- Add `capturePinterestPinMedia` to `BrowserManagerLike`, then wire it through `src/cli/daemon-commands.ts:917-931` and `src/tools/inspiredesign_run.ts:112-127` as a new workflow callback, for example `capturePinMediaEvidence`.
- In `src/providers/workflows.ts`, call the new callback in the per-reference loop after `const classification = classifyPinterestReference(url, result)` and before `visualFirst` and `motionFirst` capture at `src/providers/workflows.ts:5252-5279`.
- Keep persistence, hash, path validation, media dimensions, content type, authority classification, and index entry construction in a new module `src/inspiredesign/pinterest-pin-media-evidence.ts`. This mirrors `visual-evidence.ts` path and metadata sanitization at `src/inspiredesign/visual-evidence.ts:55-217` and `motion-evidence.ts` authority/persistence behavior at `src/inspiredesign/motion-evidence.ts:75-216`.
- Do not put the extractor inside `pinterest-media-classification.ts`. That file should stay as page and candidate classification, with canonical pin detection in `src/inspiredesign/pinterest-media-classification.ts:90-103` and page-quality rules in `src/inspiredesign/pinterest-media-classification.ts:110-162`.
- Do not put byte persistence in `capture.ts`. That file should own browser session setup and raw capture calls. Workflow finalization already owns converting runtime temp artifacts into bundle files in `src/providers/workflows.ts:3088-3154` and `src/providers/workflows.ts:3200-3389`.

### Evidence model needed

Add an evidence model shaped like the visual and motion models, but distinct from both:

- Runtime metadata: `status`, `kind` (`image` or `video_poster`), `capturedAt`, `referenceId`, `url`, `sourceUrl`, `startedSourceUrl`, `endedSourceUrl` if the primitive navigates, `mediaUrl`, `candidateSelector`, `candidateRole`, `candidateAlt`, `width`, `height`, `contentType`, `tempPath`, `warnings`, `failure`, `rejectionReasons`, and `firstPartyProvenance`.
- Persisted metadata: `status`, `kind`, `authority`, `capturedAt`, `referenceId`, `url`, `sourceUrl`, `mediaUrl`, `path`, `sha256`, `bytes`, `width`, `height`, `contentType`, `candidateSelector`, `candidateRole`, `warnings`, `failure`, `rejectionReasons`, and `firstPartyProvenance`.
- Indexes: write artifacts under `pin-media-evidence/{referenceId}/main.ext` for image pins and `pin-media-evidence/{referenceId}/poster.ext` for video posters, plus `pin-media-evidence.json` and `pin-media-index.json`.
- Authority should require all of these: canonical Pinterest pin URL, source URL match, page quality compatible with a pin page, `mediaUrl` first-party `https://i.pinimg.com/...`, bytes persisted, dimensions and bytes above thresholds, sha256 and path valid, no blocking warnings, and the artifact path present in the manifest-backed pin media index.
- Video poster evidence may count as `pin_media_ready` still-image authority. It must not count as `motion_ready`, because motion authority currently requires screencast metadata, frame count, source stability, pin-media page quality, and replay plus preview artifacts in `src/inspiredesign/product-readiness.ts:270-306`.

### Noise filtering and rejection reasons

- The lane should run for canonical Pinterest pin URLs, including current `unknown_pin` candidates, because `unknown_pin` now blocks product candidacy with `pin_media_type_unproven` in `src/inspiredesign/pinterest-media-classification.ts:122-124` and product candidates are currently only `image_pin` or `video_pin` in `src/inspiredesign/pinterest-media-classification.ts:170-181`.
- It should not run for boards, idea pages, source pages, search shells, login/challenge pages, or invalid pages. Those are classified in `src/inspiredesign/pinterest-media-classification.ts:145-162`, and source blockers are exposed by `shouldBlockPinterestSourceExtraction` in `src/inspiredesign/pinterest-media-classification.ts:199-203`.
- Positive DOM signals should prefer main pin media selectors already observed by probes, such as `closeup-image-main-MainPinImage`, `StoryPinImageBlock-MainPinImage`, and video `poster` on the pin media node.
- Reject related pins and search shells by ancestry and selectors, not size alone. Existing chrome and search markers include search results, related searches, autocomplete, pin card, profile, updates, messages, and settings in `src/inspiredesign/pinterest-media-classification.ts:45-51` and `src/inspiredesign/reference-pattern-board.ts:153-169`.
- Reject avatars and profile decorations through candidate selector or role, small dimensions, circular/profile ancestry, and non-main pin containers.
- Reject ads and promoted units through candidate selector or ancestry markers, blocked warning markers, and source mismatch.
- Reject thumbnails and grid/list media using low dimensions, `pin_grid_media` page quality, grid/list/card ancestry, and not being inside the current canonical pin media root.
- Reuse warning and diagnostic patterns rather than inventing a weak path. Current blockers already include blank, empty, tiny, small media, login, challenge, captcha, search shell, interface chrome, chrome only, and controls only in `src/inspiredesign/product-readiness.ts:74-87` and `src/inspiredesign/reference-pattern-board.ts:151-164`.

### Ranking, readiness, renderer, and Canvas changes

- Extend `InspiredesignEvidenceAuthority` from `"snapshot_ready" | "motion_ready" | "ranked_reference" | "diagnostic_only"` to include `"pin_media_ready"` in `src/inspiredesign/product-readiness.ts:9-10` and renderer authority types in `src/providers/renderer.ts:28-43`.
- Extend `InspiredesignCaptureEvidence` with `pinMedia` in `src/inspiredesign/contract.ts:108-125`, normalize it beside visual and motion in `src/inspiredesign/contract.ts:259-271`, and add JSON/index types beside `InspiredesignVisualEvidenceJson`, `InspiredesignScreenshotIndexEntry`, and `InspiredesignMotionEvidenceJson` in `src/inspiredesign/contract.ts:346-373`.
- Extend `ReferenceInput.capture` in `src/inspiredesign/reference-pattern-board.ts:20-45`, then add `hasPinMediaReadyPinterestEvidence` beside `hasSnapshotReadyPinterestVisualEvidence` and `hasMotionReadyPinterestEvidence` at `src/inspiredesign/reference-pattern-board.ts:520-580`.
- Make `hasAuthoritativePinterestMediaEvidence` include `pin_media_ready` in `src/inspiredesign/reference-pattern-board.ts:582-586`, let first-party proof use it in `src/inspiredesign/reference-pattern-board.ts:588-617`, and make `evidenceAuthorityForReference` prefer `pin_media_ready` before screenshot or motion in `src/inspiredesign/reference-pattern-board.ts:641-649`.
- Add `pin_media_ready` to `deriveCapturedVia`, score boosts, visual strengths, visual risks, and selection reason near `src/inspiredesign/reference-pattern-board.ts:780-867`.
- Product readiness needs a new artifact input collection, e.g. `pinMedia?: readonly InspiredesignPinMediaAuthorityInput[]`, beside screenshots and motions in `src/inspiredesign/product-readiness.ts:34-56`. It should mirror `hasScreenshotArtifactForReference` at `src/inspiredesign/product-readiness.ts:225-247`, using canonical source matching at `src/inspiredesign/product-readiness.ts:162-169`.
- Readiness counts need either a new `pinMediaReadyReferenceCount` or an intentional inclusion in `authoritativeReferenceCount` without weakening coherency. The cleaner contract is to add `pinMediaReadyReferenceCount` beside `snapshotReadyReferenceCount` and `motionReadyReferenceCount`, then update coherency checks in `src/inspiredesign/product-readiness.ts:398-442` and product success logic in `src/inspiredesign/product-readiness.ts:746-798`.
- Workflow must collect `pinMediaCollation.files`, include them in `persistedEvidenceArtifactPaths`, derive a manifest-backed pin media index, and pass it to `isInspiredesignAuthoritativeRankedReference` at `src/providers/workflows.ts:5337-5357`.
- Renderer `canContinueInspiredesignInCanvas` must pass pin media artifacts into `isInspiredesignAuthoritativeRankedReference` and treat `pin_media_ready` as visual authority at `src/providers/renderer.ts:235-263`. `missingRequiredVisualReferenceCount` also needs to treat `pin_media_ready` as satisfying required visual evidence in `src/providers/renderer.ts:265-273`.
- Handoff guidance and meta prompt should mention `pin-media-evidence.json` and `pin-media-index.json` next to the current `visual-evidence.json`, `screenshot-index.json`, `motion-evidence.json`, and `ranked-references.json` references in `src/inspiredesign/handoff.ts:1-15` and `src/inspiredesign/meta-prompt.ts:103-107`.

### Proposed shape check

- Correct: `pin_media_ready` should be a new evidence authority beside screenshot and motion authority.
- Correct: `src/providers/workflows.ts` per-reference loop after fetch and classification is the best orchestration seam.
- Correct: run for canonical Pinterest pin URLs including `unknown_pin`, because the DOM lane can prove the media kind that current URL/text classification cannot prove.
- Correct: do not run for boards, search pages, source pages, login/challenge states, shells, or invalid Pinterest pages.
- Correct: use a focused browser-manager primitive rather than exposing generic DOM evaluation.
- Correct: persist under `pin-media-evidence/{referenceId}/main|poster.ext`, plus JSON and index files.
- Correct: place hashing, sanitization, path validation, dimensions, content type, and authority classification in a new `src/inspiredesign/pinterest-pin-media-evidence.ts` module.
- Correct: authoritative only when source URL, first-party media URL, persisted bytes, dimensions, hash, path, warnings, and manifest-backed index all agree.
- Correct: ranking, readiness, and renderer should consume `pin_media_ready` independently from screenshot evidence.
- Correct: video poster gives still-image authority only and must not satisfy motion authority.
- Missing: update `InspiredesignProductReadinessFields` with a new count or an explicit count derivation rule. Without this, `productSuccess` can remain false even when `pin_media_ready` artifacts are present because counts must be coherent in `src/inspiredesign/product-readiness.ts:398-442`.
- Missing: update `readExplicitInspiredesignProductReadinessFields` so CLI top-level responses can validate explicit daemon fields with the new authority, otherwise the CLI path in `src/cli/commands/inspiredesign.ts:363-374` will demote the result.
- Missing: update renderer artifact filtering so product-ready-only Canvas artifacts are emitted when the new lane passes. Renderer currently computes authority only from screenshots and motion in `src/providers/renderer.ts:208-229`.
- Over-specified: adding dimensions and content type is valuable, but extracting those in the browser primitive may not be enough. The persistence module should verify bytes independently after writing, because visual and motion lanes already derive authority from persisted bytes, not only runtime claims.
- Over-specified: the primitive should return one selected candidate plus rejected candidate summaries, not a full DOM dump. Full dumps would increase artifact size and leak page details without improving authority.

### Exact tests to add or change

- Add `tests/inspiredesign-pinterest-pin-media-evidence.test.ts` for the new module: sanitizes reference IDs, validates `pin-media-evidence/{referenceId}/main|poster.ext`, hashes bytes, records dimensions and content type, rejects unsafe paths, rejects invalid sha256, rejects missing bytes, rejects non-`i.pinimg.com` media URLs, and classifies authority as diagnostic when warnings or rejection reasons exist.
- Add browser primitive tests, likely in the browser-manager test area, for `capturePinterestPinMedia`: extracts `closeup-image-main-MainPinImage`, extracts video poster as `video_poster`, rejects related pins, avatars, ads, thumbnails, and shell/search candidates, and writes only to the requested path.
- Add `tests/providers-inspiredesign-capture.test.ts` cases near the existing Pinterest visual probe tests at `tests/providers-inspiredesign-capture.test.ts:820-1030`: verifies primary pin-media capture uses canonical pin source, records `pin_media_ready` only for first-party persisted media, and records diagnostic reasons without promotion on source mismatch or page quality blockers.
- Add `tests/providers-inspiredesign-workflow.test.ts` cases near primary visual and motion artifact tests at `tests/providers-inspiredesign-workflow.test.ts:501-579` and `tests/providers-inspiredesign-workflow.test.ts:1380-1739`: verifies a Pinterest image pin with pin media artifact ranks, emits `pin-media-evidence.json` and `pin-media-index.json`, includes bundle manifest paths, and permits Canvas artifacts only after renderer authority passes.
- Extend `tests/inspiredesign-product-readiness.test.ts` around authority tests at `tests/inspiredesign-product-readiness.test.ts:31-260` and `tests/inspiredesign-product-readiness.test.ts:520-859`: accepts `pin_media_ready` only with canonical pin, source match, first-party media URL, valid path/hash/bytes/dimensions, no blockers, and manifest-backed artifact input; rejects URL-only, wrong source, board URL, login/challenge quality, blocking warnings, bad hash, low bytes, and low dimensions.
- Extend `tests/inspiredesign-visual-harvest.test.ts`: Pinterest pin media artifact is usable creative evidence, `capturedVia` includes `pin_media_ready`, reference board ranks it, design board keeps it, and missing screenshot count does not block a pin-media-ready still image.
- Extend `tests/providers-inspiredesign-contract.test.ts`: normalizes and serializes `pinMedia`, emits index entries, keeps diagnostic failures in rejected/captured-but-rejected metadata, and keeps `video_poster` out of motion authority.
- Extend `tests/pinterest-guidance-recipe.test.ts`: recovery guidance should direct users to recover authenticated pin media evidence for canonical pins while still blocking search shells, login walls, and unrelated providers.

### Recommended implementation sequence

1. Add `src/inspiredesign/pinterest-pin-media-evidence.ts` with types, sanitizers, path builders, hash helpers, authority classifier, and index entry builder.
2. Add the focused browser-manager primitive and manager type declarations.
3. Add `pinMedia` to capture evidence, normalization, workflow options, and daemon/tool callback wiring.
4. Call the new lane in `runInspiredesignWorkflow` after Pinterest classification and before visual/motion/deep capture.
5. Finalize pin media artifacts before packet building, include files in bundle creation, and pass manifest-backed pin media artifacts into ranking and readiness.
6. Extend reference board, product readiness, renderer, handoff, and meta prompt to understand `pin_media_ready` without weakening diagnostic-only gates.
7. Add the tests listed above, then run the focused Inspired Design, capture, readiness, contract, and Pinterest guidance test files before broader checks.

### Eliminated alternatives

- Replacing the screenshot lane is rejected. Existing screenshot authority is intentionally strict and still useful for non-Pinterest pages and verified Pinterest viewport captures.
- Putting extraction and byte persistence in `pinterest-media-classification.ts` is rejected. That module should keep classifying page and URL candidates, not own browser extraction or artifact persistence.
- Treating DOM-discovered media URLs as product-ready without persisted bytes is rejected. Current product readiness intentionally derives authority from persisted, hashed, manifest-backed artifacts.
- Letting video poster evidence satisfy `motion_ready` is rejected. Motion authority requires screencast evidence, stable source provenance, frame count, and replay plus preview artifacts.
- Allowing boards or search results to promote through the new lane is rejected. Boards and shells are not canonical pin media sources and already have classification blockers.


## Oracle Synthesis

Oracle validated the pair findings. The correct implementation path is:

- Add `pin_media_ready` as a third evidence authority in `src/inspiredesign/product-readiness.ts`, `src/inspiredesign/reference-pattern-board.ts`, and `src/providers/renderer.ts`.
- Integrate the capture in `src/providers/workflows.ts` after fetch and `classifyPinterestReference(url, result)`, before primary screenshot, motion, and deep diagnostic capture.
- Add a focused browser-manager primitive such as `capturePinterestPinMedia(sessionId, { path, targetId, timeoutMs })` instead of a generic DOM evaluation surface.
- Add `src/inspiredesign/pinterest-pin-media-evidence.ts` to own path building, sanitization, persisted byte verification, hashing, dimensions, content-type verification, authority classification, and index construction.
- Persist physical media files under `pin-media-evidence/{referenceId}/main.ext` or `pin-media-evidence/{referenceId}/poster.ext`, then write `pin-media-evidence.json` and `pin-media-index.json`.
- Feed the manifest-backed pin media index into reference ranking, product readiness, renderer authority checks, and Canvas continuation gating.
- Treat video poster media as still-image `pin_media_ready` only. If a video pin also has valid screencast evidence, reporting must preserve `motion_ready` as the motion authority.

Oracle found no major disagreement with the pair. The main added warning is that readiness count coherence is high risk: valid pin-media artifacts can still be demoted unless explicit readiness fields, CLI parsing, renderer authority filtering, and manifest-backed counts all understand `pin_media_ready`.

## Recommended Path

Proceed with implementation as a strict first-party artifact authority lane.

### Implementation sequence

1. Add `src/inspiredesign/pinterest-pin-media-evidence.ts` with runtime and persisted types, safe artifact path builders, media URL validation, byte hashing, dimension and content-type checks, authority classification, and index entry construction.
2. Add the focused browser-manager primitive in `src/browser/manager-types.ts` and `src/browser/browser-manager.ts`. It should inspect live DOM properties such as `currentSrc`, `srcset`, `naturalWidth`, `naturalHeight`, `poster`, bounding rect, visibility, and ancestry, then write only the selected media bytes to the requested temp path.
3. Add primary pin-media capture wiring in `src/inspiredesign/capture.ts`, `src/cli/daemon-commands.ts`, and `src/tools/inspiredesign_run.ts`.
4. Call the lane in `src/providers/workflows.ts` after Pinterest classification and before screenshot, motion, or deep diagnostic capture. Run it only for canonical Pinterest pin pages, including `unknown_pin`, and never for boards, search pages, source pages, login/challenge pages, or shell URLs.
5. Finalize pin-media artifacts before packet building, include the files in bundle manifests, and pass only manifest-backed pin-media indexes into ranking, readiness, and renderer gates.
6. Extend `src/inspiredesign/contract.ts` with `capture.pinMedia`, `pinMediaEvidence`, and `pinMediaIndex`, then write the new JSON files and include them in `evidence.json`.
7. Extend `src/inspiredesign/reference-pattern-board.ts` so artifact-backed pin media counts as authoritative Pinterest media proof, suppresses shell-only diagnostics only when bytes and provenance validate, adds `capturedVia: ["pin_media", "pin_media_ready"]`, and returns `evidenceAuthority: "pin_media_ready"` for still-image pin media.
8. Extend `src/inspiredesign/product-readiness.ts` with `pinMediaReadyReferenceCount`, pin-media authority inputs, artifact checks, explicit readiness parsing, count coherence, and top-level evidence authority derivation.
9. Extend `src/providers/renderer.ts` so Canvas continuation accepts pin media authority only through the manifest-backed index and stays blocked for empty ranked references or diagnostic-only output.
10. Update `src/inspiredesign/handoff.ts`, `src/inspiredesign/meta-prompt.ts`, CLI/docs/public-surface references, and tests so the new artifact files are discoverable without weakening existing screenshot and motion contracts.

### Required authority gates

A pin-media artifact should be product-ready only when all of these hold:

- Reference URL is canonical Pinterest `/pin/{digits}/`.
- Browser source URL normalizes to the same canonical pin.
- Page quality is compatible with `pin_media`.
- Selected media URL is first-party `https://i.pinimg.com/...`.
- Persisted artifact path is under `pin-media-evidence/{referenceId}/`.
- Persisted bytes exist, hash as valid SHA-256, and pass minimum byte and dimension thresholds.
- Content type or byte sniffing confirms an allowed image type.
- Candidate comes from the main pin media container, not related grids, avatars, ads, comments, shopping modules, or recommendation rails.
- No blocking warnings or rejection reasons remain.
- The artifact path appears in the manifest-backed pin media index used by readiness and renderer checks.

Remote media URLs alone must never count as product-ready evidence.

### Test coverage

Add or extend tests for:

- Pin-media evidence hashing, path sanitization, hostile path rejection, content-type validation, and index generation.
- Browser primitive extraction for main pin image, story pin image, and video poster candidates.
- Rejection of avatars, thumbnails, related pins, ads, search shells, login pages, boards, source pages, and source URL mismatch.
- `unknown_pin` promotion only after persisted first-party pin media proof.
- Video poster satisfying still-image evidence but never motion authority.
- Product readiness rejecting URL-only evidence and any artifact not present in the manifest-backed pin media index.
- Renderer and Canvas continuation staying blocked for diagnostic-only output, empty ranked references, missing pin media index, or incoherent counts.

## Risks And Open Questions

- Exact minimum byte and dimension thresholds need named constants and regression coverage.
- Candidate scoring must be resilient to Pinterest DOM changes while remaining strict enough to reject related pins and ads.
- Byte validation should sniff persisted file contents instead of trusting runtime `contentType`.
- Canonical matching should compare normalized pin IDs, not raw URLs, to survive Pinterest URL decoration and redirects.
- Runtime path handling needs the same containment discipline as motion artifacts, including symlink and temp-path safety.
- If a reference has both `motion_ready` and `pin_media_ready`, the product output must preserve motion authority for motion guidance.
- Full DOM dumps should not be persisted. The primitive should return one selected candidate plus bounded rejected-candidate summaries.
- Public wording must avoid implying that DOM media URLs are enough. The product contract is persisted first-party media evidence with provenance and manifest authority.
