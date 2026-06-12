# Investigation: Pinterest Media Analysis Design Synthesis

## Summary
Pinterest media readiness is complete enough for trusted image, GIF, and video bytes, but the design synthesis path only uses that evidence as readiness/provenance metadata plus generic copy. The smallest safe fix is to add a conservative media-summary seam from already verified metadata, then separately centralize generated Canvas theme validation so ready Canvas plans require both light and dark when product policy expects that.

## Symptoms
- Ready Pinterest bundles emit `design.md`, `design-contract.json`, `generation-plan.json`, and `canvas-plan.request.json`.
- Design synthesis uses trusted media artifacts plus pin/reference metadata and design-vector rules.
- Design synthesis does not yet perform deep image analysis, GIF frame analysis, or video frame analysis over persisted media bytes.
- Generated Canvas plan still lists required themes as light, so true light/dark enforcement is not encoded in the Canvas request.

## Background / Prior Research
- Current continuity says live canonical Pinterest image, GIF, and video bundles from the local checkout reached `productSuccess:true`, `artifactAuthority:product_ready`, `evidenceAuthority:pin_media_ready`, and `nextStepGuidance.readiness:ready`.
- Current continuity says media bytes were verified for JPEG, GIF89a, and H.264/AAC MP4 artifacts under `pin-media-evidence/<ref>/`.
- Memory confirms the Pinterest pin-media authority lane is intended as a third manifest-backed authority beside screenshot and motion, with persisted first-party bytes before readiness or ranking accepts Pinterest media.
- No external web research has been used in this investigation so far because the requested limitations are internal code-path questions.

## Investigator Findings
<!-- Pair investigator appends structured findings here. -->

### 2026-06-06 Pair Investigation - Pinterest media synthesis limits

#### Verified flow
- Artifact names are centralized in `INSPIREDESIGN_HANDOFF_FILES`: `design.md`, `design-contract.json`, `generation-plan.json`, `canvas-plan.request.json`, `pin-media-evidence.json`, and `pin-media-index.json` are declared in `src/inspiredesign/handoff.ts:1-17`.
- Primary Pinterest pin media is captured before deep diagnostics when `shouldCapturePinterestPinMedia(...)` is true: the workflow creates a temp root, calls `captureWorkflowPinMediaEvidence(...)`, merges it into `primaryCapture`, then builds the reference from that capture in `src/providers/workflows.ts:5769-5836`.
- The finalization order is motion, pin media, then visual, and `buildInspiredesignPacket(...)` receives the finalized references after byte-backed pin media collation in `src/providers/workflows.ts:5842-5853`.
- Temp pin media paths are workflow-owned and reference-scoped via `buildPinMediaTempCapturePath(...)` in `src/providers/workflows.ts:3478-3486`; trusted temp paths are checked against the expected path and temp root in `src/providers/workflows.ts:3454-3463`.
- Final pin media artifacts are byte-backed: the finalizer reads the trusted temp file, sniffs the bytes, derives the final artifact path, persists with the buffer, verifies bytes and hash, and only emits an artifact file when authority is `design_evidence` with no rejection reasons in `src/providers/workflows.ts:3570-3670`.
- Final artifact path shapes are `pin-media-evidence/<ref>/main.*`, `poster.*`, or `video.mp4`: constants and the path regex are in `src/inspiredesign/pinterest-pin-media-evidence.ts:149-159`, and `buildPinterestPinMediaEvidenceArtifactPath(...)` maps `image` to `main`, `video_poster` to `poster`, and `video` to `video` in `src/inspiredesign/pinterest-pin-media-evidence.ts:415-431`.
- Packet serialization persists the finalized pin media into `pinMediaEvidence` and derives `pinMediaIndex` from design-evidence entries in `src/inspiredesign/contract.ts:2185-2206`, then returns both in the packet in `src/inspiredesign/contract.ts:2398-2429`.
- Renderer always writes `pin-media-evidence.json` and `pin-media-index.json` as final artifacts, but writes `canvas-plan.request.json` only when `canContinueInCanvas` is true in `src/providers/renderer.ts:1207-1258`.

#### What synthesis inspects today
- The context-builder assessment is correct: reference synthesis is text-led, not media-analysis-led. `getInspiredesignReferenceSignals(...)` only pulls title, excerpt, capture title, snapshot text, clone text/CSS preview, and DOM text in `src/inspiredesign/reference-pattern-board.ts:439-448`.
- `buildReferenceSynthesis(...)` turns those text signals into `Source N ...` lines and a summary in `src/inspiredesign/contract.ts:756-773`; it does not inspect `pinMedia.path`, bytes, frames, poster pixels, GIF animation, or video content.
- Pin media currently influences synthesis as an authority gate and generic evidence signal: `hasPinMediaReadyPinterestEvidence(...)` validates metadata, provenance, path, bytes, dimensions, content type, kind, and warnings in `src/inspiredesign/reference-pattern-board.ts:649-686`; `deriveCapturedVia(...)` adds `pin_media` and `pin_media_ready` in `src/inspiredesign/reference-pattern-board.ts:919-935`.
- The only design-facing visual strength generated from pin media is generic: `Manifest-ready Pinterest pin media artifact is available for still-image direction.` in `src/inspiredesign/reference-pattern-board.ts:983-995`. It does not distinguish palette, composition, subject matter, GIF timing, or video scene content.
- The existing byte layer is reusable for a minimal media-analysis summary: `inspectPinterestPinMediaBuffer(...)` recognizes PNG, GIF87a/GIF89a, JPEG, WebP, AVIF, and MP4 signatures and image dimensions in `src/inspiredesign/pinterest-pin-media-evidence.ts:226-376`; persistence derives hash, bytes, width, height, content type, path, and first-party provenance in `src/inspiredesign/pinterest-pin-media-evidence.ts:830-923`.
- Limitation: MP4 byte inspection only proves an MP4 brand and does not parse dimensions or timeline frames in `src/inspiredesign/pinterest-pin-media-evidence.ts:344-356`; video width and height can still come from runtime metadata during persistence in `src/inspiredesign/pinterest-pin-media-evidence.ts:844-853`.

#### Theme propagation
- `requiredThemes` is not set in the renderer. It is set in `buildGenerationPlan(...)`: `plan.visualDirection.themeStrategy` is copied from `format.route.themeStrategy`, then `validationTargets.requiredThemes` becomes `["light"]` for `single-theme` and `["light", "dark"]` otherwise in `src/inspiredesign/contract.ts:1275-1306`.
- `canvas-plan.request.json` receives the same `validationTargets` through `toCanvasGenerationPlan(...)`, which copies `plan.validationTargets`, and `buildCanvasPlanRequest(...)`, which embeds that generation plan in `src/inspiredesign/contract.ts:1544-1565`.
- The likely Pinterest photography path selects a single-theme route because the real `cinematic-product-story` template has positive `photography` signals and `themeStrategy: "single-theme"` in `skills/opendevbrowser-design-agent/assets/templates/inspiredesign-advanced-brief.v1.json:220-309`. Fashion and campaign-like Pinterest briefs can also land on single-theme routes such as `maison-campaign-world` in `skills/opendevbrowser-design-agent/assets/templates/inspiredesign-advanced-brief.v1.json:493-588`.
- Existing tests assert multi-theme routes produce `["light", "dark"]` in `tests/providers-inspiredesign-contract.test.ts:476-492`, and they assert selected route theme strategy is preserved when references are skipped in `tests/providers-inspiredesign-contract.test.ts:3290-3309`. I did not find an explicit test that a single-theme Canvas request intentionally remains `["light"]`.

#### Eliminated hypotheses
- Not a missing file-name mapping: handoff constants and renderer output include the expected Pinterest media and Canvas artifact names in `src/inspiredesign/handoff.ts:1-17` and `src/providers/renderer.ts:1245-1258`.
- Not a workflow ordering issue after packet construction: byte-backed pin media finalization happens before `buildInspiredesignPacket(...)` in `src/providers/workflows.ts:5842-5853`.
- Not deep media analysis hiding elsewhere in the packet builder: synthesis lines are built from `getInspiredesignReferenceSignals(...)` only in `src/inspiredesign/contract.ts:756-773`, and those signals exclude pin-media bytes and paths in `src/inspiredesign/reference-pattern-board.ts:439-448`.
- Not a renderer-side `requiredThemes` mutation: renderer only consumes `canvasPlanRequest`; the source of `["light"]` is the `single-theme` conditional in `src/inspiredesign/contract.ts:1303-1305`.

#### Minimal code-change options
1. Add a conservative media-summary helper beside `pinterest-pin-media-evidence.ts` persistence that emits only byte and metadata facts already proven safe: kind, content type, dimensions, aspect ratio, artifact role (`main`, `poster`, `video`), animated GIF presence by content type, and MP4 presence. Thread that summary into `referencePatternBoard.references[].visualStrengths`, `patternsToBorrow`, or a new `mediaAnalysis` field. Risk: still metadata-only, so wording must avoid claiming scene, palette, subject, or motion content. Tests: add image, GIF, video, and poster cases in `tests/inspiredesign-visual-harvest.test.ts` and packet propagation checks in `tests/providers-inspiredesign-contract.test.ts`.
2. Add bounded byte-derived enrichments without dependencies: GIF frame marker count, image aspect bucket and orientation, and explicit `video_content_unanalyzed` for MP4. Risk: format parsers can become fragile and should not decode full media. Tests: extend `tests/inspiredesign-pinterest-pin-media-evidence.test.ts` with GIF single-frame versus multi-frame bytes, portrait/landscape image bytes, and MP4 no-frame-analysis behavior.
3. If Canvas must always enforce light and dark output, change `buildGenerationPlan(...)` to set `validationTargets.requiredThemes = ["light", "dark"]` for Canvas validation regardless of route `single-theme`, or introduce a separate `requiredCanvasThemes` policy while preserving `visualDirection.themeStrategy`. Risk: broad behavior change for all single-theme formats and fixtures. Tests: add a single-theme packet regression asserting both `generationPlan.validationTargets.requiredThemes` and `canvasPlanRequest.generationPlan.validationTargets.requiredThemes` are `["light", "dark"]`, update affected snapshots or expectations, and run `validateGenerationPlan(...)` coverage.
4. Narrower theme option: update only Pinterest-likely public-story templates such as `cinematic-product-story` and `maison-campaign-world` to `light-dark-parity` or `multi-theme-system`. Risk: format selection and downstream route expectations change, but impact is smaller than a global generator rule. Tests: exercise `expandInspiredesignBrief(...)` with photography and fashion-studio briefs, then assert both generated and Canvas plan themes include light and dark.

#### Recommendation
- Start with option 1 for media synthesis because it reuses verified metadata, avoids new decoders, and closes the current `pin_media_ready` to design-summary gap without overclaiming visual content.
- For themes, prefer option 3 only if Canvas readiness policy truly requires light and dark for every generated surface. If not, document that `single-theme` intentionally means light-only validation and use option 4 for Pinterest-specific parity needs.

## Investigation Log

### Phase 1 - Initial Triage
**Hypothesis:** The browser and evidence layer can now produce trusted media bytes, but the design synthesis pipeline only forwards media authority metadata and does not analyze image pixels or GIF/video frames.
**Findings:** Confirmed. Trusted bytes are finalized before packet construction, but synthesis reads text/reference signals and only generic pin-media readiness metadata.
**Evidence:** `src/providers/workflows.ts:3566-3645`, `src/providers/workflows.ts:5842-5853`, `src/inspiredesign/reference-pattern-board.ts:439-448`, `src/inspiredesign/reference-pattern-board.ts:983-995`.
**Conclusion:** Confirmed.

### Phase 1 - Canvas Theme Triage
**Hypothesis:** Canvas required themes are set by a default or hardcoded generation-plan/theme serialization path rather than by media readiness.
**Findings:** Confirmed. `buildGenerationPlan(...)` maps `single-theme` to `["light"]`; `toCanvasGenerationPlan(...)` and `buildCanvasPlanRequest(...)` carry that value into `canvas-plan.request.json`.
**Evidence:** `src/inspiredesign/contract.ts:1275-1306`, `src/inspiredesign/contract.ts:1544-1565`, `src/providers/renderer.ts:1207-1258`.
**Conclusion:** Confirmed.

### Phase 2 - RepoPrompt Context Builder
**Hypothesis:** The lowest-risk fix can be found by tracing finalization, packet construction, reference synthesis, and Canvas serialization.
**Findings:** Context builder selected `workflows.ts`, `contract.ts`, `reference-pattern-board.ts`, `pinterest-pin-media-evidence.ts`, `renderer.ts`, design templates, and focused tests. It identified the same two independent seams: media synthesis and theme propagation.
**Evidence:** Selected files and generated analysis in RepoPrompt chat `pinterest-synthesis-3D9148`.
**Conclusion:** Confirmed.

### Phase 3 - Pair Investigation
**Hypothesis:** A pair investigator can verify line-backed flows and eliminate alternate causes.
**Findings:** Confirmed byte-backed media finalization precedes `buildInspiredesignPacket(...)`; confirmed synthesis does not inspect media bytes, pixels, GIF frames, or video frames; confirmed light-only Canvas plans originate from the `single-theme` conditional.
**Evidence:** See `## Investigator Findings` above.
**Conclusion:** Confirmed.

### Phase 4 - Oracle Synthesis
**Hypothesis:** The smallest correct fix should separate safe metadata-backed synthesis from deeper frame analysis.
**Findings:** Confirmed. The immediate fix should add media geometry/provenance summaries based on verified persisted metadata. True deep image/GIF/video analysis should be a later bounded analyzer at the trusted byte finalization seam.
**Evidence:** Oracle synthesis over the curated RepoPrompt selection, chat `pinterest-synthesis-3D9148`.
**Conclusion:** Confirmed.

## Root Cause
- Media root cause: Pinterest media evidence is finalized correctly, but `reference-pattern-board.ts` treats ready pin media mostly as an authority and readiness signal. `getInspiredesignReferenceSignals(...)` pulls title, excerpt, snapshot, clone, CSS preview, and DOM text, while the pin-media visual strength is a generic availability sentence. No current synthesis path analyzes pixels, palette, subject matter, GIF frame timing, video frames, or scene content.
- Theme root cause: `buildGenerationPlan(...)` copies `format.route.themeStrategy`, then maps `single-theme` to `["light"]`. `canvas-plan.request.json` receives that unchanged, so Pinterest briefs that select single-theme routes emit light-only Canvas validation targets.

## Recommendations
1. Add a conservative media-summary helper in `src/inspiredesign/reference-pattern-board.ts` that reads only ready, persisted Pinterest pin media evidence and emits safe facts into `visualStrengths` and `patternsToBorrow`: kind, content type, width, height, orientation, aspect ratio, artifact role/path, byte count, first-party provenance, GIF presence by `image/gif`, and MP4 presence by `video/mp4`.
2. Avoid claiming deep scene/frame analysis in that first fix. Wording should explicitly stay at geometry/provenance level, for example: trusted Pinterest GIF artifact is byte-verified as `image/gif`, `700x472`, landscape, aspect `1.48:1`; use this as geometry evidence only.
3. If true deep analysis is required, add it as a follow-up module near `src/inspiredesign/pinterest-pin-media-evidence.ts`, for example `pinterest-pin-media-analysis.ts`, and call it from `finalizeInspiredesignReferencePinMedia(...)` while trusted bytes are already loaded. Start with bounded still-image analysis, then GIF frame-count/animation presence, then video poster or frame sampling only with reliable runtime support.
4. For theme enforcement, prefer a central `contract.ts` policy that keeps `visualDirection.themeStrategy` unchanged but sets generated Canvas `validationTargets.requiredThemes` to `["light", "dark"]`. This fixes generation-plan, design-contract, and Canvas request propagation in one place.
5. If product policy intentionally preserves light-only single-theme runs outside Pinterest, use a narrower template route change for Pinterest-likely formats such as photography/cinematic/fashion campaign routes, but treat that as a weaker and more brittle fix because route selection is heuristic.
6. Add regressions in `tests/providers-inspiredesign-contract.test.ts` for single-theme plans producing light/dark Canvas validation, design-contract parity, and pin-media media-summary propagation into design vectors and Canvas request.
7. Add bundle-level propagation assertions in `tests/providers-inspiredesign-workflow.test.ts` for ready Pinterest media summaries appearing in `evidence.json`, `generation-plan.json`, and `canvas-plan.request.json`.
8. Add evidence-helper tests in `tests/inspiredesign-pinterest-pin-media-evidence.test.ts` only if media-summary or analysis helpers live in the evidence module or a new adjacent analysis module.

## Preventive Measures
- Keep readiness and synthesis claims separate: `pin_media_ready` proves byte-backed media authority, not visual understanding.
- Require generated copy and design vectors to state when evidence is geometry/provenance-only versus pixel/frame-analyzed.
- Add tests that fail if ready pin-media references only produce the old generic "artifact is available" visual strength.
- Add tests that fail if a Canvas-ready inspiredesign packet emits `validationTargets.requiredThemes` as light-only when product policy requires light and dark.
- Keep any future decoder/frame analyzer bounded, deterministic, and attached to the trusted byte finalization seam so untrusted artifact rereads do not become a new authority path.
