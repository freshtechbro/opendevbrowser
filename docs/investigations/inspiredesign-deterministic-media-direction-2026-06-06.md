# Investigation: InspireDesign Deterministic Media Direction Extraction

## Summary
Metadata-only pin-media readiness is not sufficient for the product goal. The workflow can now save trusted Pinterest image, GIF, and video bytes, but the generated design artifacts still mostly use titles, excerpts, route templates, and generic authority wording. The fix should add a first-class `media-analysis.json` seam after trusted media finalization and before `buildInspiredesignPacket(...)`, then consume that analysis in the reference pattern board, design vectors, generation plan, design contract, Canvas plan request, `design.md`, `meta-prompt.md`, and design-agent handoff.

## Symptoms
- Trusted Pinterest media can be saved and indexed, but generated artifacts still lean on title, excerpt, route template, and generic authority language.
- Required artifacts need concrete design decisions: design contract, generation plan, Canvas plan, design vectors, `design.md`, meta-prompt, and design-agent handoff.
- Metadata alone cannot explain layout, color, visual hierarchy, typography-like text treatment, image density, or motion direction.
- Handoff-only guidance is insufficient because it leaves the generated bundle non-auditable as media-derived.

## Current Source Flow
```text
trusted pin media bytes
  -> finalizeInspiredesignPinMediaArtifacts(...)
  -> buildInspiredesignPacket(...)
  -> buildInspiredesignReferencePatternBoard(...)
  -> buildInspiredesignDesignVectors(...)
  -> generation plan, contract, canvas plan, design.md, meta-prompt, handoff
```

Key source seams:
- `src/providers/workflows.ts` finalizes motion, pin-media, and visual artifacts before packet construction.
- `src/inspiredesign/contract.ts` builds `referencePatternBoard`, `designVectors`, `generationPlan`, `canvasPlanRequest`, `designContract`, `designMarkdown`, `metaPromptMarkdown`, and evidence payload from the current references.
- `src/inspiredesign/reference-pattern-board.ts` currently extracts reference signals only from title, excerpt, capture title, snapshot text, clone preview, CSS preview, and DOM HTML.
- `src/inspiredesign/reference-pattern-board.ts` currently converts pin-media authority into generic strengths such as "Manifest-ready Pinterest pin media artifact is available for still-image direction."
- `src/inspiredesign/meta-prompt.ts` renders ranked references, borrow guidance, reject guidance, motion posture, accessibility constraints, and validation gates from design vectors and ranked reference entries.
- `src/inspiredesign/handoff.ts` correctly tells downstream agents that JSON evidence surfaces are metadata-only and media files must be inspected by path, but that is too late for generated contract artifacts.

## Successful Bundle Evidence
Ready bundle:

`artifacts/pinterest-photography-studio-harvest/live-validation-single-pin-2026-06-06/inspiredesign/80cd6bd2-cfa9-422d-85ef-0e333a348a1f`

Saved media:

`pin-media-evidence/aab0a8e0483b/main.jpg`

Pin-media index proves:
- `kind`: `image`
- `contentType`: `image/jpeg`
- dimensions: `800x1080`
- bytes: `49127`
- SHA-256: `b2a498dc6e73a6d32039669559bb1e5cf96c7461345887b50e88c7ecbab3667e`
- first-party media URL: `https://i.pinimg.com/1200x/1b/61/96/1b619604ca58ad863bc92a4c1911b916.jpg`
- authority: `design_evidence`
- evidence authority in ranked output: `pin_media_ready`

Generated artifact gap:
- `ranked-references.json` says the visual strength is only that a manifest-ready Pinterest pin media artifact exists.
- `design.md` says color and theme should be validated later, even though the image is already saved.
- `generation-plan.json` repeats "Photographer X - Webflow Ecommerce website template" and route defaults.
- `design-contract.json` chooses a "high-signal control room" and "lab-white shell" despite the saved pin being a black monochrome photography landing page.
- `meta-prompt.md` says to inspect media paths but does not contain extracted image observations.

## Practical Deterministic Analysis
I ran a local prototype against the saved JPEG and wrote the sample output to:

`/tmp/opendevbrowser-pin-media-analysis-sample.json`

Extracted facts:
- Dimensions: `800x1080`, aspect ratio `0.7407`.
- Global tone: mean luminance `23.41`, standard deviation `38.08`.
- Coverage: `85.65 percent` dark pixels, `0.88 percent` bright pixels.
- Palette: dominated by near-black and grayscale swatches, including `#080808`, `#141414`, `#252525`, `#0C0C0C`, `#030303`, `#414141`, and `#8E8E8E`.
- Edges: total edge density `0.0459`, balanced horizontal and vertical edge structure.
- Readable text proof from an optional OCR probe: detected nav and hero text such as `Photographer`, `Home`, `About`, `Store`, `I'm John Carter, a product photographer from San Francisco, CA`, `Browse my latest work`, `Apple TV Campaign`, and `iPhone 12 Pro Campaign`.
- OCR-free typography structure target: detect text-like regions, relative text scale, contrast, alignment, grouping, and repeated caption zones without claiming exact words.
- Derived design facts:
  - dark-dominant canvas with high negative-space ratio.
  - monochrome high-contrast treatment with sparse bright controls and text.
  - navigation row and hero headline-like text regions detected in the upper third.
  - lower portfolio or card section contains repeated caption-like regions.

This would have led to a materially different design direction:

```text
cinematic monochrome photography landing page
  -> split hero with left editorial copy and right portrait/media field
  -> sparse white CTAs on black background
  -> lower two-column portfolio card grid
  -> restrained motion: slow image reveal, CTA fade, card hover exposure shift
```

That is the kind of content that should populate the generated artifacts instead of "lab-white shell" defaults.

## Multi-Kind Media Validation Facts
Fresh rerun artifacts also prove the same seam can handle multiple media kinds:

- Image rerun: `live-media-rerun-2026-06-06/image/.../pin-media-evidence/450106e6361f/main.jpg`
- GIF rerun: `live-media-rerun-2026-06-06/gif-open-pin-retry/.../pin-media-evidence/c71710e16c25/main.gif`
- Video rerun: `live-media-rerun-2026-06-06/video-open-pin-retry/.../pin-media-evidence/d0b406f8dcdb/video.mp4`

FFprobe and byte checks found:
- GIF: GIF89a, `700x472`, `95` frames, `4.75s`, `20 fps`.
- Video: MP4, H.264 video plus AAC audio, `1280x960`, `996` frames, `16.6s`, `60 fps`.
- Video index path records `video.mp4`, `kind=video`, `contentType=video/mp4`, and `authority=design_evidence`.

I also ran a small normalized analyzer across the image, GIF, and video samples and wrote:

`/tmp/opendevbrowser-pin-media-multikind-analysis-sample.json`

Useful normalized outputs:
- Still image: one analyzed frame.
- GIF: frame count, sampled frame indexes, frame palettes, frame deltas.
- Video: sampled timestamps, frame palettes, frame deltas.
- Shared fields: dimensions, luminance, dark coverage, bright coverage, edge density, palette.

## Background / External Research
The tooling critique is based on these capability sources:

- FFprobe emits multimedia stream and container information in machine-readable formats, including JSON. Source: https://ffmpeg.org/ffprobe.html
- FFmpeg filters include `cropdetect`, `edgedetect`, `entropy`, `freezedetect`, `palettegen`, and `thumbnail`, which are useful for frame sampling and motion signals. FFmpeg also exposes an `ocr` filter in some builds, but readable text extraction is not recommended for v1. Source: https://www.ffmpeg.org/ffmpeg-filters.html
- FFmpeg raw muxers can emit raw frame bytes when the caller controls size and pixel format. Source: https://ffmpeg.org/ffmpeg-formats.html
- Sharp `metadata()` and `stats()` expose dimensions, channels, entropy, sharpness, opacity, and dominant color, but those overlap with FFmpeg plus internal analysis for v1. Source: https://sharp.pixelplumbing.com/api-input/
- Tesseract.js `worker.recognize` returns OCR data and can output formats such as text, blocks, hOCR, and TSV, but it is still an OCR layer rather than a general design analyzer. Source: https://github.com/naptha/tesseract.js/blob/master/docs/api.md
- Browser canvas `getImageData()` returns underlying pixel data from a canvas region, useful as an in-browser fallback when media is already rendered. Source: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData
- OpenCV.js supports contour, Canny, and Hough-line workflows for layout and geometry extraction. Sources: https://docs.opencv.org/3.4/d0/d43/tutorial_js_table_of_contents_contours.html and https://docs.opencv.org/3.4/d3/de6/tutorial_js_houghlines.html
- The Design Tokens Community Group format is a standardized JSON-oriented token exchange format with typed token values. Source: https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/

## Recommended Analyzer Layers
Implement deterministic analysis in claim levels so the system never overstates what was actually extracted.

1. `metadata_only`
   - Inputs: saved media file.
   - Tools: existing byte sniffing, FFprobe for image, GIF, and video.
   - Output: format, dimensions, content type, duration, frame count, fps, audio presence.

2. `pixel_stats`
   - Inputs: image or sampled frame.
   - Tools: FFmpeg raw RGB decode plus a small internal TypeScript pixel analyzer.
   - Output: luminance, dark/bright coverage, entropy or detail density, edge density, dominant colors.

3. `palette_quantized`
   - Inputs: image or sampled frames.
   - Tools: FFmpeg raw RGB decode plus a small deterministic TypeScript quantizer.
   - Output: palette swatches, coverage percentages, suggested semantic roles, contrast pairs.

4. `layout_heuristic`
   - Inputs: image or frame.
   - Tools: downsampled RGB grids, edge projections, row/column density, coarse connected regions, text-region geometry.
   - Output: split hero, section breaks, card grids, dense versus sparse regions, focal zones, normalized bounding boxes.

5. `typography_structure`
   - Inputs: image or sampled frame.
   - Tools: FFmpeg raw RGB decode plus internal text-region geometry and contrast heuristics.
   - Output: text-like regions, relative scale, contrast, alignment, grouping, repetition, and role candidates such as nav, hero headline, body, CTA, caption, or card label.

6. `motion_sampled`
   - Inputs: GIF/video frames.
   - Tools: FFprobe, FFmpeg raw RGB frame extraction, internal frame deltas, optional `freezedetect`.
   - Output: duration, frame count, cadence, stable versus dynamic regions, scene/frame deltas, loop posture.

7. `readable_text_extraction` optional later
   - Inputs: image or sampled frame crops.
   - Tools: optional native Tesseract CLI, Tesseract.js, or model vision.
   - Output: exact words, OCR confidence, and text boxes.
   - Constraint: not part of v1. Without this level, the analyzer must not claim exact copy strings.

8. `model_described` optional later
   - Inputs: media frames plus deterministic facts.
   - Tools: multimodal model.
   - Output: semantic naming and design interpretation.
   - Constraint: must be marked as model-assisted and backed by deterministic facts, not treated as deterministic truth.

## Proposed `media-analysis.json` Shape
```json
{
  "version": 1,
  "generatedAt": "2026-06-06T00:00:00.000Z",
  "references": [
    {
      "referenceId": "aab0a8e0483b",
      "mediaPath": "pin-media-evidence/aab0a8e0483b/main.jpg",
      "sourceUrl": "https://www.pinterest.com/pin/944207878113675397/",
      "kind": "image",
      "authority": "design_evidence",
      "claimLevels": ["metadata_only", "pixel_stats", "palette_quantized", "layout_heuristic", "typography_structure"],
      "facts": {
        "dimensions": { "width": 800, "height": 1080, "aspectRatio": 0.7407 },
        "tone": { "darkCoverage": 0.8565, "brightCoverage": 0.0088, "meanLuminance": 23.41 },
        "palette": [
          { "hex": "#080808", "coverage": 0.4936, "roleHint": "background" },
          { "hex": "#8E8E8E", "coverage": 0.0473, "roleHint": "muted foreground" }
        ],
        "layout": {
          "composition": "split hero plus lower portfolio grid",
          "zones": [
            { "role": "hero_copy", "bboxNorm": [0.08, 0.18, 0.38, 0.22], "confidence": 0.75 },
            { "role": "hero_media", "bboxNorm": [0.50, 0.04, 0.45, 0.48], "confidence": 0.72 },
            { "role": "portfolio_grid", "bboxNorm": [0.09, 0.65, 0.82, 0.30], "confidence": 0.70 }
          ]
        },
        "typographyStructure": {
          "readableTextAvailable": false,
          "posture": "sparse, high-contrast, editorial, left-weighted",
          "regions": [
            { "role": "nav_row_candidate", "bboxNorm": [0.08, 0.02, 0.60, 0.04], "scale": "small", "contrast": "high", "confidence": 0.72 },
            { "role": "hero_headline_candidate", "bboxNorm": [0.08, 0.20, 0.34, 0.13], "scale": "large", "contrast": "high", "confidence": 0.76 },
            { "role": "support_copy_candidate", "bboxNorm": [0.08, 0.36, 0.30, 0.06], "scale": "small", "contrast": "muted", "confidence": 0.68 },
            { "role": "cta_cluster_candidate", "bboxNorm": [0.08, 0.47, 0.24, 0.05], "scale": "small", "contrast": "high", "confidence": 0.66 },
            { "role": "portfolio_caption_repetition", "bboxNorm": [0.10, 0.70, 0.78, 0.18], "scale": "small", "contrast": "high", "confidence": 0.70 }
          ]
        }
      },
      "designGuidance": {
        "patternsToBorrow": [
          "cinematic monochrome split hero",
          "sparse white-on-black editorial typography",
          "portfolio card grid with project captions",
          "pill CTAs with strong contrast"
        ],
        "patternsToReject": [
          "bright laboratory palette",
          "generic admin shell",
          "dense SaaS dashboard chrome"
        ],
        "motionGuidance": [
          "slow hero image reveal",
          "subtle CTA opacity and scale feedback",
          "portfolio cards reveal with staggered exposure shift"
        ]
      },
      "limitations": [
        "Readable text extraction was not performed, so exact copy strings are unavailable.",
        "Exact font family cannot be proven from pixels alone.",
        "Static image does not prove real hover states or animation."
      ]
    }
  ]
}
```

## Artifact Field Mapping
### `ranked-references.json`
Populate:
- `visualStrengths`: measured palette, layout, typography structure, and motion findings.
- `visualRisks`: analyzer limitations, missing readable text extraction, insufficient frame samples.
- `layoutRecipe`: media-derived layout label such as "cinematic monochrome split hero with lower portfolio grid."
- `contentHierarchy`: text-region-backed nav, hero, CTA, section heading, and card-label role candidates, without exact words.
- `componentFamilies`: detected hero, nav, CTA, portfolio card, media panel families.
- `motionPosture`: GIF/video frame cadence and inferred motion directions, or static-image motion suggestions marked as design adaptation.
- `tokenNotes`: quantized palette and contrast facts, not route defaults.
- `patternsToBorrow`: media-derived reusable patterns.
- `patternsToReject`: source-specific anti-copy and mismatch guardrails.

### `design vectors`
Populate:
- `directionLabel`: top media-derived layout and mood label.
- `compositionModel`: split hero, portfolio grid, focal zones, whitespace ratio, section cadence.
- `premiumPosture`: visual hierarchy, image treatment, density, negative-space facts.
- `motionPosture`: sampled GIF/video cadence, frame-delta rhythm, or still-image adaptation guidance.
- `typographyPosture`: detected text-region scale, contrast, alignment, grouping, density, and repetition, with readable words and font family marked unavailable.
- `imageryPosture`: image dominance, monochrome or color mood, focal region, crop and aspect posture.
- `interactionMoments`: CTAs and card hover candidates derived from visible controls, not generic app-shell defaults.
- `materialEffects`: measured depth, contrast, overlays, shadows, glass, borders, or absence of those features.

### `design-contract.json`
Populate:
- `designLanguage.direction`: media-derived direction, for example "cinematic monochrome photography editorial."
- `designLanguage.styleAxes`: contrast, density, depth, texture, motion from measured facts.
- `colorSystem`: palette swatches and semantic token candidates from quantized colors and contrast analysis.
- `layoutSystem`: section zones, grid/card detection, focal regions, normalized bounding boxes.
- `typographySystem`: OCR-free text hierarchy, text-region measurements, contrast posture, and uncertainty flags.
- `surfaceSystem`: black matte background, pill CTAs, image-card treatment, borders or no borders.
- `motionSystem`: GIF/video duration, cadence, frame deltas, freeze/scene detection, reduced-motion adaptation.
- `generationPlan`: copy the media-derived vectors into the same generation plan embedded in the contract.

### `generation-plan.json`
Populate:
- `targetOutcome.summary`: concise media-derived direction, not source title.
- `visualDirection.profile`: either choose a better existing profile from media facts or allow `media-derived` profile labels.
- `layoutStrategy`: section and component layout from detected zones.
- `contentStrategy`: text-region-backed content hierarchy plus brief-specific rewrite guidance. Exact words come from the user brief, title, description, or future readable-text extraction, not v1 pixel analysis.
- `componentStrategy`: hero/nav/CTA/card families inferred from media.
- `motionPosture`: sampled motion facts and static fallback.
- `designVectors`: complete media-derived vector object plus analyzer confidence.

### `canvas-plan.request.json`
Populate only Canvas-allowed fields:
- `targetOutcome`, `visualDirection`, `layoutStrategy`, `contentStrategy`, `componentStrategy`, `motionPosture`, `responsivePosture`, `accessibilityPosture`, `validationTargets`.
- Raw `mediaAnalysis` must never enter `canvas-plan.request.json`.
- Use only concise summaries through the existing Canvas-allowed fields above, not raw media paths, source or media URLs, text-region boxes, readable-text outputs, or frame arrays.

### `design.md`
Populate:
- Inspiration Analysis: observed palette, OCR-free typography structure, layout zones, image composition, media kind.
- Unified Design Direction: direction label, what to borrow, what to avoid, confidence.
- Design Vectors: measured composition, typography, imagery, color, interaction, motion.
- Governance: exact tokens and rules derived from media, plus uncertainty notes.

### `meta-prompt.md`
Populate:
- Ranked References: include media-derived visual strengths and limitations.
- Borrow Guidance: use extracted layout, palette, hierarchy, and motion.
- Reject Guidance: prohibit route-default drift and source copying.
- Motion Posture: separate sampled GIF/video facts from still-image adaptation suggestions.
- Validation Gates: require every media-derived claim to cite `media-analysis.json` and a saved media path.

### `design-agent-handoff.json`
Populate:
- Add `media-analysis.json` to `INSPIREDESIGN_HANDOFF_FILES`.
- Explain that `media-analysis.json` is the authoritative media-derived design-fact surface.
- Keep `pin-media-index.json` as authority gate, but make `media-analysis.json` the design extraction surface.
- Include confidence and limitation rules so downstream agents know which claims are measured, inferred, or model-assisted.

## Implementation Recommendation
Add a DRY media-analysis service that can be used by Pinterest harvest and future InspireDesign runs.

Proposed modules:
- `src/inspiredesign/media-analysis/types.ts`: schema and claim-level types.
- `src/inspiredesign/media-analysis/analyzer.ts`: pure orchestration over saved media entries.
- `src/inspiredesign/media-analysis/image.ts`: still image and sampled frame analysis.
- `src/inspiredesign/media-analysis/video.ts`: FFprobe and frame extraction adapter for GIF/video.
- `src/inspiredesign/media-analysis/typography-structure.ts`: OCR-free text-region and hierarchy analyzer.
- Deferred non-v1 optional probe: `src/inspiredesign/media-analysis/readable-text.ts` for OCR or model-assisted exact text extraction only if later approved.
- `src/inspiredesign/media-analysis/design-guidance.ts`: deterministic rules that convert facts into artifact-ready guidance.
- `src/inspiredesign/media-analysis/persist.ts`: writes `media-analysis.json` and sample frame assets if needed.

Placement:

```text
finalizeInspiredesignPinMediaArtifacts(...)
  -> analyzeInspiredesignMediaArtifacts(...)
  -> buildInspiredesignPacket({ references, mediaAnalysis })
  -> reference-pattern-board consumes mediaAnalysis by referenceId
```

The analyzer should not live inside `reference-pattern-board.ts`. The board should consume a structured `mediaAnalysis` input and turn it into ranked reference patterns. That keeps extraction, interpretation, and synthesis separate.

## Dependency Recommendation
Start with zero new npm dependencies if the runtime has native FFprobe and FFmpeg available:

1. Use FFprobe for metadata across still images, GIFs, and videos.
2. Use FFmpeg for frame extraction, scaling, raw RGB decoding, palette artifacts, signal filters, and motion frame sampling.
3. Use a small internal TypeScript pixel analyzer over FFmpeg-normalized RGB bytes for luminance, dark or bright coverage, coarse palette bins, density, and frame deltas.
4. Use OCR-free `typography_structure` heuristics for visual text hierarchy: text-like regions, relative scale, contrast, alignment, grouping, and role candidates.
5. Defer native Tesseract, Tesseract.js, browser canvas, OpenCV.js, Sharp, and model vision as non-v1 probes until product evidence shows the smaller stack cannot meet quality targets.

This changes the preferred v1 stack from "add several media dependencies" to:

```text
ffprobe + ffmpeg + internal TypeScript analyzer
```

Deferred optional capability:

```text
readable text extraction with native tesseract, Tesseract.js, or model vision
```

Do not add Tesseract.js for v1. It is still an OCR wrapper, not a general layout or pixel-analysis tool, and the product need is hierarchy/posture rather than exact words. Do not add OpenCV.js for v1. It is powerful for contour, Canny, Hough, morphology, and segmentation work, but those are heavier than the first product need. Do not use browser canvas as the core analyzer because the trusted media bytes already exist on disk and canvas introduces browser coupling and cross-origin taint risks. Add Sharp later only if the product requires a packaged cross-platform Node decoder and faster image statistics without relying on system FFmpeg.

Readable text content and visual text hierarchy must remain separate:

1. Readable text content means exact words such as `Photographer`, `Browse my latest work`, or nav labels. That requires OCR or model vision and is not part of v1.
2. Text hierarchy or typography structure means where text appears, how large it is, how it is grouped, how much contrast it has, and what role it likely plays. That can be extracted without OCR from pixels.

For v1, replace `ocr_candidate` with `typography_structure` or `text_region_layout`. The analyzer can safely report:

```text
Top navigation row detected.
Large editorial hero text block in upper-left region.
Smaller support-copy block below headline.
Compact high-contrast CTA region near hero copy.
Lower repeated caption regions suggest portfolio/project cards.
Typography posture: sparse, high-contrast, editorial, left-weighted.
```

The analyzer must not report:

```text
The headline says "I'm John Carter..."
The CTA says "Browse my latest work"
The nav contains Home/About/Store
```

Exact copy can come from the user brief, Pinterest title or description, fetched metadata, or a later optional readable-text extraction layer.

## Minimal Tooling Investigation
The earlier stack recommendation should be treated as a future capability ladder, not the smallest sound implementation. Local validation and external docs show that FFmpeg and FFprobe cover much more than motion sampling.

Current repo dependency inventory:
- `package.json` has no Sharp, Canvas, PNG/JPEG/GIF decoder, Tesseract.js, OpenCV.js, or wasm FFmpeg dependency.
- Installed local binaries found in this environment: `/usr/local/bin/ffmpeg`, `/usr/local/bin/ffprobe`, and `/usr/local/bin/tesseract`.
- ImageMagick was not present.

External capability facts:
- FFprobe output is designed to be machine-readable and can expose format and stream sections as JSON. Source: https://ffmpeg.org/ffprobe.html
- FFmpeg filters include `cropdetect`, `edgedetect`, `entropy`, `freezedetect`, `palettegen`, `select`, `signalstats`, and `thumbnail`. Source: https://www.ffmpeg.org/ffmpeg-filters.html
- FFmpeg raw muxers can write raw video frames when the caller controls size and pixel format. Source: https://ffmpeg.org/ffmpeg-formats.html
- Sharp provides convenient Node metadata and pixel statistics, including dominant color, entropy, and sharpness. Source: https://sharp.pixelplumbing.com/api-input
- Tesseract CLI can output TSV with word confidence and bounding boxes, but this is OCR evidence, not general design analysis. Source: https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html
- Tesseract.js `worker.recognize` is also OCR-centered. It can return text and optional structured outputs, but it does not replace pixel statistics or layout geometry. Source: https://github.com/naptha/tesseract.js/blob/master/docs/api.md
- Browser canvas `getImageData()` exposes pixel data only after media is rendered into a canvas and may throw security errors for cross-origin pixels. Source: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData
- OpenCV contour and Hough-line docs confirm it is appropriate for heavier geometry extraction, not for the first bounded media-direction seam. Sources: https://docs.opencv.org/4.x/d5/daa/tutorial_js_contours_begin.html and https://docs.opencv.org/4.x/d9/db0/tutorial_hough_lines.html

Local proof on the saved Pinterest JPEG:
- FFprobe read the file as `mjpeg`, `800x1080`, `pix_fmt=yuvj420p`, `49127` bytes.
- FFmpeg `signalstats` reported `YAVG=23.4027`, matching the prior internal luminance prototype closely.
- FFmpeg decoded the JPEG to `rgb24` raw bytes after scaling to `96x130`.
- A tiny Node calculation over those bytes produced `meanLuminance=23.41`, `darkCoverage=0.8713`, `brightCoverage=0.0044`, and a near-black grayscale palette led by `#080808`, `#181818`, `#282828`, and `#383838`.
- FFmpeg `palettegen` successfully emitted a `16x16` PPM palette stream, which means a future analyzer can parse a palette artifact without adding a PNG library.
- Native Tesseract emitted TSV boxes and text for the same image, including useful labels such as `Photographer`, `Home`, `About`, and `Store`, but also noisy low-confidence tokens. This confirms readable text extraction is possible, but it should be deferred because the v1 product need is visual hierarchy and typography posture rather than exact copy strings.

Local proof on saved Pinterest GIF and video:
- FFprobe read the GIF as `700x472`, `95` frames, `4.75s`, `20 fps`.
- FFprobe read the video as MP4 with H.264 video, AAC audio, `1280x960`, `996` frames, `16.6s`, `60 fps`.
- FFmpeg decoded sampled GIF and MP4 frames to raw `rgb24` bytes.
- A tiny Node calculation over three sampled frames produced per-frame luminance, dark coverage, and frame-delta values. This is enough for `motion_sampled` v1 facts such as stable loop, bright transition, dark-dominant motion, and high or low frame-change posture.

Recommended claim coverage with the minimal stack:

| Claim level | Minimal v1 tool | Notes |
| --- | --- | --- |
| `metadata_only` | existing byte sniffing plus FFprobe | dimensions, kind, duration, frame count, fps, stream facts |
| `byte_header` | existing trusted byte inspection | keep this tied to pin-media authority, not design synthesis |
| `pixel_stats` | FFmpeg raw RGB plus internal TypeScript analyzer | luminance, dark or bright coverage, contrast posture, density |
| `palette_quantized` | FFmpeg raw RGB plus internal TypeScript quantizer | coarse bins are sufficient for token candidates and mood |
| `layout_heuristic` | internal TypeScript over downsampled RGB grids | row and column density, coarse zones, negative space, split or grid posture |
| `typography_structure` | internal TypeScript over downsampled RGB grids | text-like regions, relative scale, contrast, alignment, grouping, repetition, role candidates |
| `motion_sampled` | FFprobe plus FFmpeg sampled raw RGB frames | frame deltas, cadence, stable or dynamic regions, representative frame facts |
| `readable_text_extraction` | defer | exact words require OCR or model vision and are not needed for v1 design direction |
| `model_described` | defer | not deterministic and not needed for v1 |

Decision:
- Recommend zero new npm dependencies for the first implementation.
- Require capability detection for `ffprobe` and `ffmpeg`; if absent, emit only `metadata_only` and `byte_header` facts and explicitly state that pixel or motion-derived claims were unavailable.
- Do not include native Tesseract in v1. Use OCR-free typography structure for hierarchy and mark exact words unavailable.
- Keep the internal analyzer bounded and deterministic. It should not try to prove exact font family, exact interaction behavior, real hover states, or semantic object labels.
- Reconsider Sharp only if install reliability or CI needs a packaged decoder instead of external binaries. If that happens, Sharp would be the one dependency to add, not Sharp plus OpenCV plus Tesseract.js.

## Root Cause
Pin-media readiness and design synthesis are currently separate. The system proves that saved media bytes are authoritative, but the synthesis layer does not read or analyze those bytes. It only receives generic media authority metadata plus text-like signals. Therefore the generated artifacts can be product-ready while still being creatively generic or wrong for the actual image.

Secondary blocker: the workflow currently computes the final manifest-backed pin-media authority set after packet construction. A future analyzer needs a pre-packet trusted input derived from finalized pin-media references plus `pinMediaCollation.files`, otherwise packet artifacts could consume analysis for media that renderer later excludes from product-ready authority.

Implementation blocker: do not implement the analyzer until the schema defines claim levels and allowed deterministic fact types. Without explicit claim levels, palette, typography structure, motion, and composition facts can be overclaimed or inconsistently mapped into contract defaults.

## Recommendations
1. Add `media-analysis.json` as a first-class artifact.
2. Run media analysis after trusted artifact finalization and before packet construction.
3. Pass media analysis into `buildInspiredesignReferencePatternBoard(...)`.
4. Convert media facts into ranked reference fields before building design vectors.
5. Thread media-derived vectors through `design.md`, `generation-plan.json`, `design-contract.json`, `canvas-plan.request.json`, `meta-prompt.md`, and `design-agent-handoff.json`.
6. Keep raw facts auditable and keep inferred design guidance labeled with confidence.
7. Treat image, GIF, and video as one normalized media-analysis pipeline with kind-specific extractors.
8. Keep `pin-media-index.json` as the authority gate and treat `media-analysis.json` only as an audited synthesis input.
9. Keep raw analysis out of `canvas-plan.request.json`; pass only concise, schema-safe summaries through existing Canvas fields.

## Preventive Measures
- Add regression tests proving a saved monochrome Pinterest JPEG produces media-derived palette, layout, and OCR-free typography-structure guidance in `ranked-references.json` and `design.md`.
- Add GIF tests proving frame count, sampled frames, palette deltas, and motion facts populate `media-analysis.json`.
- Add video tests proving MP4 bytes produce FFprobe metadata, sampled frame analysis, and motion guidance while retaining `pin_media_ready`.
- Add contract tests proving route defaults cannot override high-confidence media-derived direction.
- Add renderer tests proving `media-analysis.json` is emitted into the bundle and listed in `bundle-manifest.json`.
- Add handoff tests proving downstream guidance tells the agent to use `media-analysis.json` before raw pin-media metadata.
- Add negative readiness tests proving `media-analysis.json` alone cannot make diagnostic or unindexed Pinterest media product-ready.

## Investigator Findings

### Scope
- This investigation was read-only for source code. The only requested file update is this appended report section.
- No `src/` or `tests/` file currently defines or consumes a `media-analysis.json` or `mediaAnalysis` source surface. The current source surfaces are still pin-media metadata, manifest indexes, ranked references, design vectors, plans, markdown, and handoff guidance.

### Finding 1 - packet synthesis is text and profile driven today

Evidence:
- `src/inspiredesign/contract.ts:120-139` defines capture evidence as title, snapshot text, DOM HTML, clone previews, visual evidence metadata, motion evidence metadata, and pin-media metadata. There is no structured media analysis input in the capture model.
- `src/inspiredesign/contract.ts:505-512` defines `BuildInspiredesignPacketInput` with only `brief`, `briefExpansion`, `urls`, `references`, `includePrototypeGuidance`, and `referenceEvidenceRequired`. There is no packet input for analyzed media facts.
- `src/inspiredesign/reference-pattern-board.ts:439-449` builds reference signals exclusively from title, excerpt, capture title, snapshot text, clone component preview, CSS preview, and DOM HTML.
- `src/inspiredesign/reference-pattern-board.ts:983-1005` treats pin-media readiness as a generic strength, currently `Manifest-ready Pinterest pin media artifact is available for still-image direction.` It does not derive palette, layout, typography structure, crop, tone, motion cadence, or composition facts from the saved media file.
- `src/inspiredesign/reference-pattern-board.ts:1162-1199` derives `layoutRecipe`, `contentHierarchy`, `motionPosture`, `tokenNotes`, `patternsToBorrow`, and `patternsToReject` from text signals, generic patterns, and `InspiredesignBriefFormat` defaults.
- `src/inspiredesign/reference-pattern-board.ts:1619-1664` derives design vectors from ranked board entries plus format defaults. It falls back to `format.archetype`, `format.layoutArchetype`, `format.surfaceTreatment`, `format.paletteIntent`, `format.motionGrammar`, and other route/profile defaults.
- `src/inspiredesign/contract.ts:1275-1308` builds `generation-plan.json` from the selected format, reference synthesis, and design vectors. `visualDirection.profile`, theme, layout approach, component strategy, and validation targets are still driven by route/profile fields plus board summaries.
- `src/inspiredesign/contract.ts:1340-1429` and `src/inspiredesign/contract.ts:1654-1674` build `design-contract.json` color, typography, surface, and design language from `PROFILE_CONFIG`, the selected profile, and format defaults. The contract copies motion posture only after it has already been reduced to design vectors.
- `src/inspiredesign/contract.ts:1819-1869` renders `design.md` reference prose from fetched text, capture status, and `getInspiredesignReferenceSignals(...)`. The color line still says to validate captured color before cloning brand treatment rather than reporting extracted media color facts.
- `src/inspiredesign/meta-prompt.ts:50-112` renders the meta prompt from ranked references and design vectors. Its validation gates mention `pin-media-evidence.json` and `pin-media-index.json`, but not `media-analysis.json`.
- `tests/inspiredesign-visual-harvest.test.ts:1014-1083` proves text and structural evidence can drive ranked references and evidence-first design vectors without media analysis.
- `tests/inspiredesign-visual-harvest.test.ts:1097-1247` proves intent matching is token and text based: broad style terms do not satisfy the brief, related photo vocabulary can satisfy the brief, and generic format tokens do not override source brief tokens.

Conclusion:
- Packet synthesis is evidence-first only after source evidence has been reduced to text/profile-derived board fields. Saved Pinterest bytes can authorize a reference, but their concrete visual facts do not yet affect `ranked-references.json`, design vectors, `design.md`, `generation-plan.json`, `design-contract.json`, `canvas-plan.request.json`, `meta-prompt.md`, or `design-agent-handoff.json`.

### Finding 2 - manifest-backed pin-media authority is strict, but computed too late to feed media analysis

Evidence:
- `src/providers/workflows.ts:2788-2824` captures pin media into a planned temporary file and returns runtime metadata. This capture step receives URL, reference ID, temp path, browser/cookie options, and Pinterest page quality. It does not analyze media bytes.
- `src/providers/workflows.ts:3573-3660` finalizes each captured pin media item by reading trusted temp bytes, inspecting the byte signature, choosing an artifact path, persisting byte-backed evidence, verifying SHA-256 and byte count, and returning a finalized reference plus optional artifact file.
- `src/providers/workflows.ts:3672-3682` collates finalized pin-media references and files.
- `src/providers/workflows.ts:5819-5853` orders finalization as motion, pin media, visual, then calls `buildInspiredesignPacket(...)` with only the finalized references. This is the correct future insertion seam: after `finalizeInspiredesignPinMediaArtifacts(...)` has trusted byte-backed media and before `buildInspiredesignPacket(...)` reduces references into design artifacts.
- `src/inspiredesign/pinterest-pin-media-evidence.ts:815-925` classifies persisted pin media as `design_evidence` only after structural, provenance, quality, byte-inspection, content-type, dimension, and artifact-extension validation. JSON-round-tripped or forged persisted records lose trusted authority without byte inspection.
- `src/inspiredesign/pinterest-pin-media-evidence.ts:965-991` emits compact `pin-media-index.json` entries only for `design_evidence` records with source URL, media URL, page quality, path, hash, bytes, dimensions, content type, kind, and provenance.
- `src/inspiredesign/contract.ts:2185-2206` builds `pinMediaEvidence` and `pinMediaIndex` from references inside packet construction, after the reference-pattern board and design vectors have already been computed in `src/inspiredesign/contract.ts:2246-2260`.
- `src/providers/workflows.ts:5846-5885` creates the packet first, then builds `persistedEvidenceArtifactPaths` from finalized artifact files.
- `src/providers/workflows.ts:5886-5937` filters `packet.pinMediaIndex` to `manifestBackedPinMediaIndex`, computes artifact-backed authority counts, and builds product-readiness fields. This verifies final authority after packet synthesis, so it cannot currently inform media-derived design facts during board or vector construction.
- `src/inspiredesign/product-readiness.ts:730-750` treats a ranked reference as authoritative for `pin_media_ready` only when `hasPinMediaArtifactForReference(...)` passes against provided pin-media artifacts.
- `src/inspiredesign/product-readiness.ts:947-956` reads pin-media authority only from `pinMediaIndex` locations in the response/meta shape.
- `src/inspiredesign/product-readiness.ts:1035-1102` requires coherent counts, artifact-backed authority, and all required Pinterest references to be authoritative before reporting `product_ready` and final `pin_media_ready` evidence authority.
- `tests/inspiredesign-product-readiness.test.ts:871-1080` proves product readiness derives pin-media authority from manifest-backed `pinMediaIndex`, and remote `pinMediaEvidence` alone is insufficient.
- `tests/inspiredesign-pinterest-pin-media-evidence.test.ts:681-711` proves forged or JSON-round-tripped design evidence is demoted without trusted byte inspection.
- `tests/providers-inspiredesign-workflow.test.ts:1038-1077` proves the workflow writes `pin-media-evidence.json`, `pin-media-index.json`, and the media file, and embeds matching pin-media evidence in `evidence.json`.
- `tests/providers-inspiredesign-workflow.test.ts:2048-2078` proves `pin-media-index.json` can contain design evidence and `ranked-references.json` records `evidenceAuthority: "pin_media_ready"`, but the ranked reference still contains authority metadata rather than extracted media facts.

Conclusion:
- The authority gate is strong and should remain the trust gate. The design-analysis seam must not replace `pin-media-index.json`; it should consume only the finalized, trusted media entries that can become manifest-backed index entries. The current authoritative index is computed and filtered after packet synthesis, so a new `media-analysis.json` needs to be created from finalized pin-media artifacts before reference pattern board construction.

### Finding 3 - exact source seams that need `media-analysis.json`

Evidence and required seam changes for a future implementation:
- Workflow insertion: `src/providers/workflows.ts:5819-5853` is the required insertion point. Add analysis after `finalizeInspiredesignPinMediaArtifacts(...)` has returned trusted media artifacts and before `buildInspiredesignPacket(...)` is called. The analyzer should receive finalized trusted media entries and return a structured media-analysis object keyed by reference ID.
- Packet input and outputs: `src/inspiredesign/contract.ts:387-405` lists packet outputs and `src/inspiredesign/contract.ts:505-512` lists packet inputs. Add a media-analysis input and packet field so later renderer and handoff layers can emit it.
- Ranked reference synthesis: `src/inspiredesign/contract.ts:2246-2260` builds `referencePatternBoard` and `designVectors`. Pass media analysis through this path so `src/inspiredesign/reference-pattern-board.ts:1162-1199` can populate `visualStrengths`, `visualRisks`, `layoutRecipe`, `contentHierarchy`, `componentFamilies`, `motionPosture`, `tokenNotes`, `patternsToBorrow`, and `patternsToReject` from media-derived facts instead of generic readiness text.
- Design vectors: `src/inspiredesign/reference-pattern-board.ts:1619-1664` should use media-derived ranked reference fields for `directionLabel`, `compositionModel`, `premiumPosture`, `motionPosture`, `typographyPosture`, `imageryPosture`, `interactionMoments`, and `materialEffects`.
- Generation plan: `src/inspiredesign/contract.ts:1275-1308` should summarize media-derived direction in target outcome, visual direction, layout, content, component, motion posture, and embedded design vectors.
- Design contract: `src/inspiredesign/contract.ts:1340-1429` and `src/inspiredesign/contract.ts:1654-1674` should consume media-derived direction, palette, typography hierarchy, layout zones, surface treatment, and motion facts through the generation plan and design vectors.
- Canvas request: `src/inspiredesign/contract.ts:1544-1565` intentionally copies only the Canvas-safe generation-plan subset. Keep raw media analysis out of `canvas-plan.request.json` unless the Canvas schema accepts it, but thread concise media-derived summaries through the existing allowed fields and `designVectors`.
- Design markdown: `src/inspiredesign/contract.ts:1819-1869` and `src/inspiredesign/contract.ts:2303-2394` should report extracted media observations in Inspiration Analysis, Unified Design Direction, Design Vectors, and Governance instead of saying color/theme remains a later validation task.
- Evidence payload: `src/inspiredesign/contract.ts:2105-2134` embeds evidence, ranked references, design vectors, visual evidence, motion evidence, pin-media evidence, and pin-media index. Add media analysis here only if `evidence.json` should carry a copy or summary; otherwise cite `media-analysis.json` and keep one authoritative analysis artifact.
- Meta prompt: `src/inspiredesign/meta-prompt.ts:16-31` renders ranked reference borrow/reject/strength/risk fields, and `src/inspiredesign/meta-prompt.ts:103-108` defines validation gates. Add `media-analysis.json` to the gates and require media-derived claims to cite both media analysis and saved media paths.
- Handoff file registry and guide: `src/inspiredesign/handoff.ts:1-18` defines artifact filenames, `src/inspiredesign/handoff.ts:74-79` names the visual guidance surfaces, and `src/inspiredesign/handoff.ts:154-170` defines pin-media index and ranked-reference guidance. Add `media-analysis.json` to the file registry, guidance text, artifact guide, and downstream required artifact list.
- Required artifact list: `src/inspiredesign/contract.ts:1584-1608` currently requires evidence, visual evidence, screenshot index, motion evidence, pin-media evidence, pin-media index, ranked references, meta prompt, advanced brief, design markdown, generation plan, canvas plan request, design contract, and implementation plan. Add `media-analysis.json` to this list before ranked references or at least before meta prompt.
- Design-agent handoff: `src/inspiredesign/contract.ts:1616-1642` copies the artifact guide and required artifacts into the followthrough object, which becomes `design-agent-handoff.json`. Once the handoff constants and required artifacts include media analysis, the handoff can explain that `pin-media-index.json` is the trust gate and `media-analysis.json` is the design fact surface.
- Renderer arguments and context: `src/providers/renderer.ts:1033-1058` defines renderer inputs, `src/providers/renderer.ts:1199-1226` builds context payload, `src/providers/renderer.ts:1227-1253` writes bundle files, and `src/providers/renderer.ts:1280-1308` returns JSON response fields. Add `mediaAnalysis` to these places so `media-analysis.json` is emitted, included in context/JSON modes, and listed in the artifact manifest.

Conclusion:
- The future implementation should preserve the current trust boundary, then add a separate deterministic design-fact surface. The clean data flow is: finalized trusted pin-media artifacts to media analysis, media analysis to reference pattern board, board to design vectors, vectors to generated artifacts, renderer to `media-analysis.json`, and handoff/meta-prompt to usage guidance.

### Regression test seams to update
- `tests/inspiredesign-visual-harvest.test.ts:457-485` currently proves manifest-ready pin media ranks as `pin_media_ready`. Add a sibling test proving the same trusted media plus media analysis changes `visualStrengths`, `layoutRecipe`, token notes, and borrow/reject guidance.
- `tests/providers-inspiredesign-contract.test.ts:360-397` and `tests/providers-inspiredesign-contract.test.ts:1192-1309` assert the Canvas request contains only the allowed generation-plan subset and that design vectors flow into Canvas. Add assertions that media-derived summaries flow through allowed fields, while raw media analysis stays outside the Canvas payload.
- `tests/providers-inspiredesign-contract.test.ts:654-717` proves pin-media evidence and index serialization. Add assertions for a packet-level `mediaAnalysis` field and an `evidence.json` summary or citation, depending on the chosen artifact ownership.
- `tests/providers-inspiredesign-contract.test.ts:833-867` proves `meta-prompt.md` mentions pin-media evidence/index gates. Add `media-analysis.json` and saved media path citation requirements.
- `tests/providers-inspiredesign-workflow.test.ts:1038-1077` and `tests/providers-inspiredesign-workflow.test.ts:2048-2078` prove workflow artifact emission for image pin media and ranked `pin_media_ready`. Add workflow expectations that `media-analysis.json` is emitted, appears in the artifact manifest, and influences `ranked-references.json`, `design.md`, `generation-plan.json`, `design-contract.json`, `canvas-plan.request.json`, `meta-prompt.md`, and `design-agent-handoff.json`.
- `tests/inspiredesign-product-readiness.test.ts:871-1080` should continue proving `pinMediaIndex` is the authority gate. Add a negative test proving media analysis alone cannot make a Pinterest reference product-ready without manifest-backed `pinMediaIndex` authority.
