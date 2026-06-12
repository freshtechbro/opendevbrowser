# Investigation: InspireDesign Media Analysis Seam

## Summary
Current Pinterest harvest can save trusted image, GIF, and video bytes, but design synthesis is still led by text, route templates, and generic media-readiness metadata. This investigation evaluates whether to add a reusable media-analysis seam before synthesis, where it should live, how much FFmpeg is needed, and how generated artifacts should consume the analysis.

## Symptoms
- Ready Pinterest pin-media bundles can be `pin_media_ready` while `ranked-references.json`, `design.md`, and `generation-plan.json` mostly repeat pin titles and template defaults.
- The current design agent handoff tells the next agent to inspect media paths, but the generated artifacts do not encode media-derived palette, layout, composition, subject, animation, or motion observations.
- Users expect InspireDesign output to be design-direction evidence, not merely a pointer to saved files.

## Background / Prior Research
- FFprobe is designed to gather multimedia stream information and print it in machine-readable form; it reports container and stream format/type details, and its output is intended to be parsed by tooling. Source: https://ffmpeg.org/ffprobe.html
- FFmpeg can extract images from video streams using `image2`, frame rate controls, `-frames:v`, `-t`, and `-ss`. This supports bounded video frame sampling when MP4 media needs visual analysis. Source: https://ffmpeg.org/ffmpeg.html
- Sharp provides fast header metadata without decoding compressed pixel data, including dimensions and animated-image fields such as pages, page height, and loop count. Source: https://sharp.pixelplumbing.com/api-input/
- Sharp `stats()` provides pixel-derived channel statistics, opacity, entropy, sharpness, and dominant sRGB color. Source: https://sharp.pixelplumbing.com/api-input/
- Browser canvas `drawImage()` can draw image and video sources into a canvas, but using this as the primary Node analysis path would add browser lifecycle, codec, CORS, and timing complexity. Source: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage
- `abi/screenshot-to-code` demonstrates the broader pattern of using screenshots, mockups, Figma designs, and screen recordings as AI inputs for frontend generation across HTML/CSS, React, Vue, Bootstrap, and Ionic stacks. Source: https://github.com/abi/screenshot-to-code
- Design2Code frames screenshot-to-frontend generation as a multimodal code-generation benchmark and notes failures around visual element recall and layout correctness. This supports keeping extracted media observations structured, confidence-scored, and auditable rather than directly jumping from image to code. Source: https://arxiv.org/abs/2403.03163
- OpenAI image-input docs state that vision-capable models can analyze images, including objects, shapes, colors, textures, and text, with limitations. This is the relevant capability if we need semantic design observations beyond deterministic metadata. Source: https://platform.openai.com/docs/guides/images-vision
- Explore-agent finding: for images/GIFs, Sharp is a practical first dependency if the project accepts native binaries; for MP4, prefer direct `child_process.spawn("ffprobe", args)` over `fluent-ffmpeg`, and only use FFmpeg frame extraction when video visual samples are needed.
- Explore-agent finding: comparable screenshot-to-code/design-system tools use a staged flow: capture media, extract deterministic facts, run a multimodal semantic pass, emit a structured design brief/IR, then generate implementation artifacts and compare output visually.

## Investigator Findings
<!-- Pair/context findings go here. -->

### 2026-06-06 Read-only investigation - Reusable media-analysis seam

#### Scope
- Verified the requested points against the current working tree without editing source files.
- Investigated the trust boundary, board ingress, generated artifact consumers, no-new-dependency viability, and exact implementation/test targets.

#### Finding 1 - Trusted media artifacts are finalized before packet synthesis
**Evidence:**
- The workflow captures primary pin media, screenshot, and motion evidence before deep capture can run, then builds each `InspiredesignReferenceEvidence` from the merged capture in `src/providers/workflows.ts:5743-5836`; `buildInspiredesignReference(...)` normalizes and merges runtime visual, motion, and pin-media metadata into `reference.capture` in `src/providers/workflows.ts:3252-3292`.
- Screenshot artifacts become finalized when `finalizeInspiredesignReferenceVisual(...)` reads the runtime temp path, rejects empty files, computes `sha256` and `bytes`, persists the visual evidence, and emits an `ArtifactFile` in `src/providers/workflows.ts:3348-3379`.
- Pin-media trust is stronger than path presence: `trustedPinMediaTempPath(...)` requires the exact workflow-owned temp path and trusted temp parent in `src/providers/workflows.ts:3449-3464`, while `readTrustedPinMediaRuntimeFile(...)` uses no-follow open, file identity checks before and after read, bounded reads, parent checks, and size limits in `src/providers/workflows.ts:3495-3549`.
- Final pin-media persistence reads trusted bytes, inspects content type and dimensions, derives the artifact path, persists from the buffer, verifies hash and byte count, and emits the file only when authority is `design_evidence` with no rejection reasons in `src/providers/workflows.ts:3608-3655`.
- Motion artifacts become finalized when `finalizeInspiredesignReferenceMotion(...)` collects expected output files, requires design-review replay and preview artifacts for captured non-diagnostic motion, hashes replay and preview buffers, and merges persisted motion evidence in `src/providers/workflows.ts:3950-4004`.
- The finalization order is motion, then pin media, then visual, and only `visualCollation.references` enter `buildInspiredesignPacket(...)` in `src/providers/workflows.ts:5842-5853`.

**Conclusion:** Confirmed. The correct reusable seam is after `finalizeInspiredesignMotionArtifacts(...)`, `finalizeInspiredesignPinMediaArtifacts(...)`, and `finalizeInspiredesignVisualArtifacts(...)`, and before `buildInspiredesignPacket(...)`. If a later analyzer needs trusted raw bytes, pin-media byte-level work must happen inside `finalizeInspiredesignReferencePinMedia(...)` while the verified buffer is still in scope, not by rereading persisted paths inside packet synthesis.

#### Finding 2 - References enter `buildInspiredesignReferencePatternBoard(...)` with finalized metadata, but board signals are not media-analysis-led
**Evidence:**
- `buildInspiredesignPacket(...)` trims input references and calls `buildInspiredesignReferencePatternBoard(referenceFingerprint(brief), selectedFormat, references, brief)` before computing ready reference ids and usable references in `src/inspiredesign/contract.ts:2227-2263`.
- `buildInspiredesignReferencePatternBoard(...)` filters with `hasInspiredesignUsableReferenceEvidence(...)`, maps each surviving reference through `deriveReferenceEntry(...)`, sorts entries, and builds rejected references in `src/inspiredesign/reference-pattern-board.ts:1466-1475`.
- Board item output fields include `capturedVia`, `evidenceAuthority`, `visualStrengths`, `visualRisks`, `layoutRecipe`, `contentHierarchy`, `motionPosture`, `tokenNotes`, and pattern lists, but no media path, hash, dimensions, source media URL, or typed media-analysis field in `src/inspiredesign/reference-pattern-board.ts:83-105`.
- `getInspiredesignReferenceSignals(...)` only reads text-like evidence: title, excerpt, capture title, snapshot content, clone component preview, clone CSS preview, and DOM HTML text in `src/inspiredesign/reference-pattern-board.ts:439-448`.
- Pinterest screenshot, motion, and pin-media evidence are used as authority gates: snapshot-ready proof checks source match, `pin_media` page quality, artifact path, hash, bytes, and warnings in `src/inspiredesign/reference-pattern-board.ts:548-569`; motion-ready proof checks design authority plus replay and preview artifact authority in `src/inspiredesign/reference-pattern-board.ts:595-625`; pin-media-ready proof checks first-party media URL, artifact path, hash, bytes, dimensions, content type, kind, provenance, and warnings in `src/inspiredesign/reference-pattern-board.ts:649-687`.
- Ranking and capture labels include `snapshot_ready`, `pin_media_ready`, and `motion_ready` in `src/inspiredesign/reference-pattern-board.ts:919-978`, but pin media contributes only the generic visual strength `Manifest-ready Pinterest pin media artifact is available for still-image direction.` in `src/inspiredesign/reference-pattern-board.ts:983-1006`.

**Conclusion:** Confirmed. References enter the board after trust finalization, but the board converts media into readiness and generic availability, not reusable media cues such as orientation, aspect ratio, artifact role, image versus GIF versus video posture, palette, subject, composition, or frame-level motion.

#### Finding 3 - Several generated artifacts can consume media cues, but today they consume metadata, paths, and handoff instructions
**Evidence:**
- The packet model already has natural output surfaces for media cues: `visualEvidence`, `screenshotIndex`, `motionEvidence`, `pinMediaEvidence`, `pinMediaIndex`, `rankedReferences`, `referencePatternBoard`, `metaPromptMarkdown`, `designMarkdown`, `generationPlan`, `designContract`, and `followthrough` are packet fields in `src/inspiredesign/contract.ts:386-406`.
- `evidence.json` is the broadest consumer because `buildEvidencePayload(...)` includes references, the reference pattern board, ranked references, design vectors, target analysis, visual evidence, screenshot index, motion evidence, pin-media evidence, and pin-media index in `src/inspiredesign/contract.ts:2106-2133`.
- The metadata-specific payload builders serialize screenshot, motion, and pin-media evidence and indexes from normalized references in `src/inspiredesign/contract.ts:2137-2205`, and the packet returns those arrays plus `rankedReferences`, `referencePatternBoard`, `metaPromptMarkdown`, and `evidence` in `src/inspiredesign/contract.ts:2396-2429`.
- `generation-plan.json` can consume media cues through `synthesis.summary`, `referencePatternBoard`, and `designVectors`: `InspiredesignGenerationPlan` includes board, vectors, target analysis, interaction moments, and material effects in `src/inspiredesign/contract.ts:345-353`, while `buildGenerationPlan(...)` uses `synthesis.summary` and vector summaries in target, content, and component strategy text in `src/inspiredesign/contract.ts:1266-1313`.
- `canvas-plan.request.json` receives only the Canvas-safe subset, including target outcome, visual direction, layout, content, component, motion, responsive, accessibility, validation targets, interaction moments, material effects, and design vectors in `src/inspiredesign/contract.ts:1538-1565`.
- `design.md` can consume media cues through inspiration analysis, synthesis lines, reference pattern board patterns, and design vectors in `src/inspiredesign/contract.ts:2300-2389`.
- `meta-prompt.md` consumes ranked reference strengths and risks in `src/inspiredesign/meta-prompt.ts:16-35`, but its validation gates still instruct downstream agents to read metadata files and confirm artifact paths before visual or motion claims in `src/inspiredesign/meta-prompt.ts:94-108`.
- The handoff guide explicitly calls visual, screenshot, motion, and pin-media artifacts metadata-only and tells the next agent to open PNG, replay, preview, or media files by path in `src/inspiredesign/handoff.ts:74-79` and `src/inspiredesign/handoff.ts:136-165`.
- The renderer writes all of these generated artifact files, including `design.md`, `design-contract.json`, `design-agent-handoff.json`, `generation-plan.json`, `evidence.json`, `visual-evidence.json`, `screenshot-index.json`, `motion-evidence.json`, `pin-media-evidence.json`, `pin-media-index.json`, `ranked-references.json`, and `meta-prompt.md` in `src/providers/renderer.ts:1225-1259`.

**Conclusion:** Confirmed. Handoff-only guidance is insufficient because the generated artifacts currently tell a future agent where to inspect media, while `ranked-references.json`, `design.md`, `generation-plan.json`, `design-contract.json`, `canvas-plan.request.json`, and `meta-prompt.md` do not receive structured media-derived cues beyond metadata, authority labels, and generic availability text.

#### Finding 4 - A no-new-dependency first implementation is enough only for conservative metadata and header facts
**Evidence:**
- Persisted pin-media evidence already carries the safe facts needed for a first pass: kind, authority, canonical source and media URLs, artifact path, sha256, bytes, width, height, content type, candidate metadata, warnings, rejection reasons, and first-party provenance in `src/inspiredesign/pinterest-pin-media-evidence.ts:52-87`.
- Existing artifact path helpers distinguish `main`, `poster`, and `video` roles in `src/inspiredesign/pinterest-pin-media-evidence.ts:410-431`.
- The existing byte inspector recognizes PNG, GIF87a/GIF89a, JPEG, WebP, AVIF, and MP4 signatures and image dimensions where available in `src/inspiredesign/pinterest-pin-media-evidence.ts:220-384`; MP4 detection only proves a supported MP4 brand and does not parse dimensions, scenes, timing, or frames in `src/inspiredesign/pinterest-pin-media-evidence.ts:366-377`.
- `InspiredesignCaptureEvidence` currently has slots for `visual`, `motion`, and `pinMedia`, but no media-analysis slot in `src/inspiredesign/contract.ts:120-139`; `normalizeInspiredesignCaptureEvidence(...)` persists those three surfaces but drops any future analysis unless the type and normalizer are extended in `src/inspiredesign/contract.ts:272-291`.
- Current synthesis remains text-led through `buildReferenceSynthesis(...)`, which calls `getInspiredesignReferenceSignals(...)` and joins text signals into source lines in `src/inspiredesign/contract.ts:756-773`.

**Conclusion:** Confirmed with limits. A no-new-dependency first implementation is enough for a reusable, auditable `metadata_only` or `byte_header` seam: artifact role, content type, media kind, bytes, dimensions, orientation, aspect ratio, first-party provenance, GIF or MP4 presence, screenshot availability, and motion replay or preview availability. It is not enough for palette extraction, subject detection, composition analysis, GIF frame timing, video scene analysis, or motion style. Those require a later dependency-backed or model-backed analyzer and should be labeled separately, for example `pixel_analysis` or `frame_analysis`.

#### Finding 5 - Recommended implementation files and tests
**Recommended source files:**
1. Add `src/inspiredesign/media-analysis.ts` with narrow types such as `InspiredesignMediaAnalysis`, `InspiredesignMediaAnalysisSource`, `InspiredesignMediaAnalysisClaimLevel`, `InspiredesignMediaGeometry`, and pure helpers that derive conservative facts from finalized visual, motion, and persisted pin-media metadata. Keep it independent of Pinterest-specific capture so Sharp, FFprobe, FFmpeg, or vision adapters can be added later without changing packet orchestration.
2. Update `src/providers/workflows.ts` at the seam between finalization and packet build in `src/providers/workflows.ts:5842-5853` to attach metadata-only analysis to finalized references before `buildInspiredesignPacket(...)`. If using trusted bytes for a future phase, add the byte-backed call inside `finalizeInspiredesignReferencePinMedia(...)` around `src/providers/workflows.ts:3608-3655` while the verified buffer is available.
3. Update `src/inspiredesign/contract.ts` to add an optional media-analysis field to `InspiredesignCaptureEvidence` or a packet-level `mediaAnalysis` payload, preserve it through `normalizeInspiredesignCaptureEvidence(...)`, expose it in `evidence.json`, and thread safe summaries into `generationPlan`, `designMarkdown`, and followthrough context through the existing packet assembly in `src/inspiredesign/contract.ts:2106-2133` and `src/inspiredesign/contract.ts:2227-2429`.
4. Update `src/inspiredesign/reference-pattern-board.ts` so ready media can produce concrete, bounded strengths and borrow patterns instead of only the generic pin-media availability sentence at `src/inspiredesign/reference-pattern-board.ts:983-1006`. Do not let diagnostic media or unindexed pin-media evidence influence creative direction.
5. Update `src/inspiredesign/handoff.ts` and `src/inspiredesign/meta-prompt.ts` only after the analysis payload exists, so artifact guidance distinguishes `metadata_only`, `byte_header`, and any future `pixel_analysis` or `frame_analysis` claims. If a new `media-analysis.json` artifact is introduced, also update `INSPIREDESIGN_HANDOFF_FILES` in `src/inspiredesign/handoff.ts:1-17` and renderer emission in `src/providers/renderer.ts:1225-1259`.

**Recommended tests:**
1. Add `tests/inspiredesign-media-analysis.test.ts` for pure analyzer coverage: image portrait and landscape, GIF metadata, video MP4 marked `video_content_unanalyzed`, video poster role, screenshot metadata-only, motion replay and preview metadata-only, diagnostic or non-design-authority media excluded, and missing dimensions producing limited claims rather than false visual claims.
2. Update `tests/inspiredesign-visual-harvest.test.ts` around the existing pin-media board cases in `tests/inspiredesign-visual-harvest.test.ts:450-569`, `tests/inspiredesign-visual-harvest.test.ts:628-752`, and `tests/inspiredesign-visual-harvest.test.ts:870-989` to assert board strengths and patterns include concrete metadata cues and that diagnostic pin media does not emit those cues.
3. Update `tests/providers-inspiredesign-contract.test.ts` near `tests/providers-inspiredesign-contract.test.ts:612-761` and the reference propagation tests in `tests/providers-inspiredesign-contract.test.ts:488-612` to assert `buildInspiredesignPacket(...)` preserves media analysis in `evidence`, ranked references or pattern board, `design.md`, `generation-plan.json`, and handoff context. Also assert Canvas-safe fields do not receive handoff-only analysis unless intentionally allowed by the Canvas schema.
4. Update `tests/providers-inspiredesign-workflow.test.ts` around the real workflow tests in `tests/providers-inspiredesign-workflow.test.ts:974-1172` to assert finalized image and MP4 pin media produce analysis after finalization and before packet artifacts are written. MP4 should be present but explicitly marked as header or metadata only, not frame-analyzed.
5. Update `tests/inspiredesign-pinterest-pin-media-evidence.test.ts` only if byte/header helpers are moved or shared with the new module. Existing fixtures for JPEG, PNG, GIF, MP4, WebP, and AVIF bytes live in `tests/inspiredesign-pinterest-pin-media-evidence.test.ts:23-152`, and existing byte verification coverage is in `tests/inspiredesign-pinterest-pin-media-evidence.test.ts:236-254`.
6. Do not change `tests/inspiredesign-product-readiness.test.ts` unless readiness semantics change. If adding analysis without changing authority, keep product-readiness assertions such as manifest-backed pin media in `tests/inspiredesign-product-readiness.test.ts:860-949` green and unchanged.

**Conclusion:** Recommended implementation should be metadata-first, typed, and reusable. It should make media cues available to generated artifacts before handoff, while explicitly preventing metadata-only analysis from claiming palette, subject, composition, GIF timing, or video motion semantics.

## Investigation Log

### Phase 1 - Initial Triage
**Hypothesis:** A new analysis seam is needed because handoff-only guidance proves media availability but does not make generated artifacts media-driven.
**Findings:** Confirmed. Handoff-only guidance is useful for downstream inspection, but generated artifacts still lack structured media-derived cues.
**Evidence:** Existing prior investigation `docs/investigations/pinterest-media-analysis-design-synthesis-2026-06-06.md`; pair findings above.
**Conclusion:** Confirmed.

### Phase 2 - External Research
**Hypothesis:** Existing tooling can extract enough media facts to improve synthesis without building custom ML.
**Findings:** Confirmed with limits. Sharp and FFprobe/FFmpeg are useful later, but the first implementation can be dependency-free by using trusted metadata and existing byte-header inspection.
**Evidence:** External references listed in `## Background / Prior Research`.
**Conclusion:** Confirmed for a metadata-first seam; eliminated for palette, subject, and frame-level claims.

### Phase 3 - RepoPrompt Context Builder
**Hypothesis:** The correct source seam is after artifact finalization and before packet synthesis.
**Findings:** Confirmed. The selected source shows motion, pin media, and visual evidence are finalized before `buildInspiredesignPacket(...)`, and packet artifacts already have places to consume structured cues.
**Evidence:** `src/providers/workflows.ts:5842-5853`, `src/inspiredesign/contract.ts:2227-2429`, `src/inspiredesign/reference-pattern-board.ts:1466-1475`.
**Conclusion:** Confirmed.

## Root Cause
The root cause is a missing synthesis input layer. Pinterest pin-media extraction now proves bytes, provenance, hash, dimensions, content type, artifact path, and authority, but `buildInspiredesignReferencePatternBoard(...)` and `buildReferenceSynthesis(...)` still consume mostly text signals, route defaults, and generic readiness labels. The workflow therefore knows media exists, but does not convert that media evidence into design-facing cues before generating `design.md`, `generation-plan.json`, `design-contract.json`, `canvas-plan.request.json`, `ranked-references.json`, or `meta-prompt.md`.

The handoff guidance is not wrong, but it is too late in the flow. It asks a downstream agent to inspect files after the harvest has already generated its main artifacts. That makes the outputs non-auditable as media-derived design direction.

## Recommendations
1. Add a provider-agnostic `src/inspiredesign/media-analysis.ts` module that produces a typed `media-analysis.json` payload from finalized visual, motion, and pin-media evidence.
2. Run the analyzer in `src/providers/workflows.ts` after `finalizeInspiredesignMotionArtifacts(...)`, `finalizeInspiredesignPinMediaArtifacts(...)`, and `finalizeInspiredesignVisualArtifacts(...)`, but before `buildInspiredesignPacket(...)`.
3. Keep Pinterest trust and byte validation in `src/inspiredesign/pinterest-pin-media-evidence.ts`. The new analyzer should consume only already-finalized trusted evidence and should not re-decide authority.
4. Start dependency-free. The first claim levels should be `metadata_only` and `byte_header`, using facts already present: source, authority, path, artifact role, kind, content type, width, height, aspect ratio, orientation, bytes, hash, warnings, and provenance.
5. Emit `media-analysis.json` and thread safe summaries into `evidence.json`, `ranked-references.json`, `generation-plan.json`, `design-contract.json`, `canvas-plan.request.json` through existing `designVectors`, `design.md`, `meta-prompt.md`, and `design-agent-handoff.json`.
6. Explicitly mark limitations in every media-analysis entry. For example, an MP4 entry can prove a persisted video container, but not duration, frame rate, scene, subject, or motion style.
7. Add Sharp later only for palette, dominant color, alpha, entropy, sharpness, or pixel statistics. Add FFprobe later only for MP4 duration, codec, frame rate, and stream metadata. Add FFmpeg later only for bounded video frame extraction. Add a multimodal model later only for semantic visual interpretation.

## Preventive Measures
- Keep readiness and design synthesis separate in code and artifacts. `pin_media_ready` proves authority; `media-analysis.json` should prove what design-facing facts were actually derived.
- Require generated copy to include claim levels such as `metadata_only`, `byte_header`, future `pixel_analysis`, or future `frame_analysis`.
- Add regression tests that fail if trusted pin media only produces the old generic media-available wording.
- Add regression tests that fail if diagnostic, unindexed, remote-only, or non-manifest-backed media influences design direction.
- Avoid adding native dependencies until a specific claim requires them and tests prove the claim level.
- Keep Canvas payloads distilled and schema-safe. Raw analysis should live in `media-analysis.json`; Canvas should receive only summarized `designVectors`.
