# InspireDesign Media Analysis Seam: Plan

## Goal
Add a deterministic `media-analysis.json` seam that converts trusted saved Pinterest pin media into auditable design facts before InspireDesign packet synthesis. The first implementation uses zero new npm dependencies: FFprobe and FFmpeg for media metadata/frame decoding plus internal TypeScript analyzers for tone, palette, layout, OCR-free typography structure, and motion sampling.

Success means saved image, GIF, and video pin media can drive `ranked-references.json`, `design.md`, `generation-plan.json`, `design-contract.json`, `meta-prompt.md`, and `design-agent-handoff.json` without weakening `pin-media-index.json` readiness authority. `canvas-plan.request.json` receives only concise media-derived summaries through existing generation-plan and design-vector fields, never raw media analysis.

## Background
- The investigation at `docs/investigations/inspiredesign-deterministic-media-direction-2026-06-06.md` concludes that pin-media readiness proves saved bytes and provenance, but current synthesis still derives design direction mostly from text, route defaults, and generic pin-media readiness metadata.
- `src/providers/workflows.ts:3570` to `src/providers/workflows.ts:3683` is the trusted pin-media finalization seam. Bytes are read through trusted temp-path checks, inspected, persisted, verified, and only then scheduled as `design_evidence` artifacts.
- `src/providers/workflows.ts:5842` to `src/providers/workflows.ts:5847` finalizes motion, pin media, and visual artifacts before `buildInspiredesignPacket(...)`. This is the correct insertion point for media analysis because it has finalized media files but synthesis has not started.
- `src/providers/workflows.ts:5886` to `src/providers/workflows.ts:5937` computes the manifest-backed pin-media authority set after packet construction today. The implementation must introduce a pre-packet trusted analysis input without weakening the existing post-packet readiness gate.
- `src/inspiredesign/pinterest-pin-media-evidence.ts:815` to `src/inspiredesign/pinterest-pin-media-evidence.ts:992` contains the strict authority model: persisted evidence becomes `design_evidence` only after provenance, byte, content-type, dimension, and path checks, and `pin-media-index.json` only indexes complete design evidence.
- `src/inspiredesign/contract.ts:505` defines `BuildInspiredesignPacketInput` without media analysis. `src/inspiredesign/contract.ts:2235` to `src/inspiredesign/contract.ts:2417` builds the packet and returns evidence, ranked references, design vectors, generated docs, and artifact surfaces.
- `src/inspiredesign/reference-pattern-board.ts:439` derives reference signals from title, excerpt, capture title, snapshot text, clone previews, CSS previews, and DOM. `src/inspiredesign/reference-pattern-board.ts:983` to `src/inspiredesign/reference-pattern-board.ts:1005` currently treats pin media as a generic manifest-ready strength instead of extracted visual facts.
- `src/inspiredesign/reference-pattern-board.ts:1619` builds design vectors from ranked board entries and falls back to profile defaults. Media facts must enter before this point to change the generated design artifacts.
- `src/inspiredesign/handoff.ts:1` to `src/inspiredesign/handoff.ts:18` centralizes artifact filenames. Adding `media-analysis.json` requires a filename and guide entry because `INSPIREDESIGN_ARTIFACT_GUIDE` is keyed by the artifact file map.
- `src/inspiredesign/meta-prompt.ts:104` to `src/inspiredesign/meta-prompt.ts:108` tells downstream agents which evidence artifacts to read. It must cite `media-analysis.json` once the artifact exists.
- `src/providers/renderer.ts:1038` to `src/providers/renderer.ts:1253` accepts packet fields, builds context payloads, writes bundle files, and returns JSON/context/path modes. A packet-only `mediaAnalysis` field is insufficient unless renderer emission is added.
- Existing tests to extend include `tests/inspiredesign-visual-harvest.test.ts:457` to `tests/inspiredesign-visual-harvest.test.ts:485`, `tests/inspiredesign-product-readiness.test.ts:871` to `tests/inspiredesign-product-readiness.test.ts:1080`, `tests/providers-inspiredesign-contract.test.ts:360` to `tests/providers-inspiredesign-contract.test.ts:397`, `tests/providers-inspiredesign-contract.test.ts:3424` to `tests/providers-inspiredesign-contract.test.ts:3476`, and `tests/providers-inspiredesign-workflow.test.ts:1038` to `tests/providers-inspiredesign-workflow.test.ts:1077`.
- Prior plan `docs/plans/pinterest-pin-media-readiness-fix-2026-06-06.md` preserves authority invariants: canonical Pinterest source, trusted persisted bytes, artifact path binding, and `pin-media-index.json` as the authority gate.

## Approach
Create a new `src/inspiredesign/media-analysis/` service that consumes only finalized, trusted `design_evidence` pin-media artifacts. The service should use FFprobe for stream/container metadata, FFmpeg for bounded raw RGB frame extraction, and pure TypeScript analyzers for deterministic facts.

The workflow must build a pre-packet media-analysis input from finalized references and `pinMediaCollation.files`. This pre-packet input is not the same as the later renderer `manifestBackedPinMediaIndex`, because that index is currently derived after packet construction. The input helper should accept only pin media that is both `design_evidence` and scheduled for the bundle, using artifact path/reference matching consistent with the existing post-packet authority gate.

The analyzer produces `media-analysis.json` as an audited synthesis input. It is not an authority gate and must not satisfy product readiness. `pin-media-index.json` remains the readiness and provenance authority.

The synthesis path should be:

```text
finalizeInspiredesignMotionArtifacts(...)
  -> finalizeInspiredesignPinMediaArtifacts(...)
  -> finalizeInspiredesignVisualArtifacts(...)
  -> analyzeInspiredesignMediaArtifacts(...)
  -> buildInspiredesignPacket({ references, mediaAnalysis })
  -> buildInspiredesignReferencePatternBoard(..., mediaAnalysis)
  -> buildInspiredesignDesignVectors(...)
  -> renderInspiredesign(...)
```

V1 claim levels:

| Claim level | Source | Allowed claims |
| --- | --- | --- |
| `metadata_only` | byte inspection plus FFprobe | kind, content type, dimensions, duration, fps, frame count, audio presence |
| `pixel_stats` | FFmpeg raw RGB plus TypeScript analyzer | luminance, dark/bright coverage, contrast posture, density |
| `palette_quantized` | FFmpeg raw RGB plus TypeScript quantizer | coarse swatches, coverage, token candidates |
| `layout_heuristic` | downsampled RGB grids | coarse zones, split/grid posture, whitespace, focal regions |
| `typography_structure` | text-region geometry from pixels | text-like regions, relative scale, contrast, alignment, grouping, repetition, role candidates |
| `text_region_layout` | normalized text-region summaries | public subtype/summary used by artifact consumers when exact text is unavailable |
| `motion_sampled` | FFprobe plus sampled FFmpeg RGB frames | cadence, frame deltas, stable/dynamic posture, representative frame facts |

Deferred capability:

```text
readable_text_extraction
```

Readable exact text extraction is out of scope for v1. The analyzer must not claim exact words such as headlines, nav labels, or CTA copy. Exact copy comes from the brief, Pinterest title/description, fetched metadata, or a later explicitly approved OCR/model layer.

Minimum ranked-reference fields that form the downstream contract:

- `visualStrengths`: measured palette, tone, layout, typography structure, and motion facts.
- `visualRisks`: missing readable text extraction, unavailable binary limitations, low confidence, and sampling limits.
- `layoutRecipe`: concise media-derived composition label.
- `contentHierarchy`: role candidates only, such as nav, headline, body, CTA, caption, or card label, without exact words.
- `componentFamilies`: hero, media panel, CTA cluster, portfolio grid/card, caption row, or motion loop candidates.
- `motionPosture`: sampled GIF/video facts or static-image adaptation guidance.
- `tokenNotes`: quantized palette and contrast posture.
- `patternsToBorrow` and `patternsToReject`: deterministic guidance derived from facts.

## Work Items

## Task 1 - Lock V1 Boundaries and Runtime Constants
Reasoning: The build must stay small and avoid dependency creep while preserving the authority model.
What to do: Lock the v1 contract before coding starts.
How:
1. Verify `package.json` stays unchanged.
2. Treat FFprobe and FFmpeg as optional runtime binaries with capability detection, not npm dependencies.
3. Document non-goals in implementation notes and tests.
4. Keep `media-analysis.json` separate from readiness authority.
5. Define named constants for external-process timeouts, max decoded frame dimensions, max sampled frames, and max serialized analysis entries. The plan does not prescribe values; implementation must choose bounded values and test them.
Files impacted: `package.json`, `docs/plans/inspiredesign-media-analysis-seam-2026-06-06.md`.
Acceptance criteria:
- [ ] No new npm dependency or devDependency is added.
- [ ] V1 non-goals include Sharp, Tesseract.js, native Tesseract, OpenCV.js, browser canvas, model vision, and readable exact text extraction.
- [ ] The plan and tests state that `media-analysis.json` cannot satisfy readiness.
- [ ] External binary calls have named bounds and timeout policy.

## Task 2 - Add Media Analysis Schema
Reasoning: Claim levels and fact types must prevent overclaiming and keep exact text extraction out of v1.
What to do: Add typed JSON shapes for `media-analysis.json`.
How:
1. Create `src/inspiredesign/media-analysis/types.ts`.
2. Define `InspiredesignMediaAnalysis` and `InspiredesignMediaAnalysisReference`.
3. Include reference ID, media path, source URL, kind, content type, bytes, hash, dimensions, authority, claim levels, facts, design guidance, confidence, and limitations.
4. Define fact types for dimensions, tone, palette, layout heuristic, typography structure, and motion sampling.
5. Include `readableTextAvailable: false` under typography structure.
6. Include `text_region_layout` summaries as OCR-free geometry facts, not exact readable text.
7. Do not include exact text strings or OCR output fields.
Files impacted: `src/inspiredesign/media-analysis/types.ts` (new).
Acceptance criteria:
- [ ] The schema supports image, GIF, and video media.
- [ ] The schema serializes directly to `media-analysis.json`.
- [ ] The schema has no exact text content field.
- [ ] `typography_structure` and `text_region_layout` are represented without raw frame bytes.
- [ ] Claim levels distinguish measured facts from limitations.

## Task 3 - Add FFprobe and FFmpeg Adapters
Reasoning: Metadata and sampled frames need a deterministic source that works across JPEG, GIF, and MP4 without new npm packages.
What to do: Add bounded process adapters for FFprobe and FFmpeg.
How:
1. Create `src/inspiredesign/media-analysis/ffprobe.ts`.
2. Create `src/inspiredesign/media-analysis/ffmpeg.ts`.
3. Run FFprobe with JSON output and parse streams, format, width, height, duration, frame count, fps, codecs, and audio presence.
4. Run FFmpeg to emit bounded `rgb24` raw frames scaled to a named analysis size.
5. Return structured limitations when binaries are missing, fail, time out, or output unsupported media.
6. Never serialize raw frame bytes.
Files impacted: `src/inspiredesign/media-analysis/ffprobe.ts` (new), `src/inspiredesign/media-analysis/ffmpeg.ts` (new).
Acceptance criteria:
- [ ] Missing FFprobe or FFmpeg records limitations rather than fake facts.
- [ ] Still images produce one bounded frame when FFmpeg is available.
- [ ] GIF/video samples are bounded by frame count, dimensions, and runtime.
- [ ] No raw frame bytes appear in `media-analysis.json`.

## Task 4 - Add Internal Pixel, Palette, Layout, and Typography Analyzers
Reasoning: The product value comes from measured visual facts, not media metadata alone.
What to do: Add pure TypeScript analyzers over normalized RGB frames.
How:
1. Create `src/inspiredesign/media-analysis/pixel.ts`.
2. Create `src/inspiredesign/media-analysis/typography-structure.ts`.
3. Compute tone, coverage, contrast, density, coarse palette, and sampled-frame delta facts.
4. Detect coarse layout posture from bounded downsampled frame data.
5. Detect OCR-free typography structure and `text_region_layout` summaries: text-like regions, relative scale, contrast, alignment, grouping, repetition, and role candidates.
6. Leave exact heuristics and thresholds to the implementation, but keep outputs bounded, deterministic, and testable.
7. Always mark exact readable text unavailable.
Files impacted: `src/inspiredesign/media-analysis/pixel.ts` (new), `src/inspiredesign/media-analysis/typography-structure.ts` (new).
Acceptance criteria:
- [ ] The analyzers are deterministic and accept only RGB bytes plus dimensions.
- [ ] Palette output includes hex swatches and coverage.
- [ ] Typography structure includes role candidates but no exact words.
- [ ] Static images do not claim real animation, only adaptation guidance.
- [ ] Implementation does not hard-code unbounded thresholds or magic values; named constants explain analysis limits.

## Task 5 - Add Design Guidance Mapper and Analyzer Orchestrator
Reasoning: Raw facts need concise synthesis-ready guidance, and workflow code needs one small entry point.
What to do: Convert measured facts into bounded design guidance.
How:
1. Create `src/inspiredesign/media-analysis/design-guidance.ts`.
2. Create `src/inspiredesign/media-analysis/analyzer.ts`.
3. Create `src/inspiredesign/media-analysis/persist.ts`.
4. Create `src/inspiredesign/media-analysis/index.ts`.
5. Analyze only finalized trusted media with `authority: "design_evidence"` and artifact files scheduled for the bundle.
6. Key results by `referenceId`.
7. Produce patterns to borrow, patterns to reject, token candidates, layout recipe, typography posture, imagery posture, motion guidance, and limitations from deterministic facts.
8. Build the `media-analysis.json` artifact file with bounded JSON only.
Files impacted: `src/inspiredesign/media-analysis/design-guidance.ts` (new), `src/inspiredesign/media-analysis/analyzer.ts` (new), `src/inspiredesign/media-analysis/persist.ts` (new), `src/inspiredesign/media-analysis/index.ts` (new).
Acceptance criteria:
- [ ] Diagnostic or unindexed media cannot contribute design guidance.
- [ ] Analyzer output is stable JSON.
- [ ] Guidance does not include raw frames, exact text, or remote-only URLs as authority.
- [ ] The public import surface is available through `src/inspiredesign/media-analysis/index.ts`.
- [ ] A limitations-only result may be emitted for trusted media when FFprobe/FFmpeg is unavailable, but it must not invent pixel, palette, typography, or motion claims.

## Task 6 - Insert Workflow Seam
Reasoning: Media facts must exist before packet construction, otherwise generated artifacts cannot be media-derived.
What to do: Run analysis after finalization and before `buildInspiredesignPacket(...)`.
How:
1. In `src/providers/workflows.ts`, locate the finalization order around `src/providers/workflows.ts:5842` to `src/providers/workflows.ts:5847`.
2. Insert `analyzeInspiredesignMediaArtifacts(...)` after finalization of motion, pin media, and visual artifacts, and before packet construction.
3. Add a helper that builds trusted analysis inputs from finalized references plus `pinMediaCollation.files`, requiring `design_evidence`, matching reference ID, and artifact path scheduled for the bundle.
4. Pass only those trusted inputs to `analyzeInspiredesignMediaArtifacts(...)`.
5. Add the generated `media-analysis.json` artifact file to the workflow artifact list.
6. Pass `mediaAnalysis` into `buildInspiredesignPacket(...)`.
7. Preserve the later manifest-backed `pinMediaIndex` filtering and readiness count logic.
Files impacted: `src/providers/workflows.ts`.
Acceptance criteria:
- [ ] Analysis runs only after trusted pin-media finalization.
- [ ] Analysis runs before `buildInspiredesignPacket(...)`.
- [ ] Existing manifest-backed `pinMediaIndex` filtering remains unchanged.
- [ ] Failed analysis degrades to limitations without blocking existing product-ready pin-media authority.
- [ ] Diagnostic, unindexed, or unscheduled media artifacts cannot become analysis inputs.

## Task 7 - Add Packet Field and Evidence Surface
Reasoning: `mediaAnalysis` must be a first-class packet input/output so every artifact path can consume or emit it.
What to do: Extend packet types and evidence payloads.
How:
1. In `src/inspiredesign/contract.ts`, import media analysis types.
2. Add optional `mediaAnalysis` to `BuildInspiredesignPacketInput`.
3. Add required `mediaAnalysis` to `InspiredesignPacket`, defaulting to an empty analysis object when absent.
4. Add a compact reference or digest to `evidence.json`, or cite `media-analysis.json` from evidence without duplicating the full payload.
5. Pass `mediaAnalysis` into `buildInspiredesignReferencePatternBoard(...)`.
Files impacted: `src/inspiredesign/contract.ts`.
Acceptance criteria:
- [ ] Packet construction works with and without media analysis.
- [ ] Packet output includes `mediaAnalysis`.
- [ ] Evidence output remains audit-friendly and avoids redundant raw payload duplication.
- [ ] Existing pin-media evidence and index outputs remain unchanged.

## Task 8 - Feed Media Facts Into Ranked References and Design Vectors
Reasoning: This is the synthesis seam that changes design direction from generic to media-derived.
What to do: Make `reference-pattern-board.ts` consume media analysis by reference ID.
How:
1. Add an optional media-analysis parameter to `buildInspiredesignReferencePatternBoard(...)`.
2. Build a lookup by `referenceId`.
3. In ranked entry synthesis, replace generic manifest-ready pin-media wording with measured facts when analysis exists.
4. Populate the minimum downstream board contract: `visualStrengths`, `visualRisks`, `layoutRecipe`, `contentHierarchy`, `componentFamilies`, `motionPosture`, `tokenNotes`, `patternsToBorrow`, and `patternsToReject`.
5. Update `buildInspiredesignDesignVectors(...)` so direction label, composition model, premium posture, typography posture, imagery posture, motion posture, interaction moments, and material effects can use media-derived ranked fields.
6. Keep existing authority checks intact. Media analysis must not promote diagnostic references.
Files impacted: `src/inspiredesign/reference-pattern-board.ts`, `src/inspiredesign/contract.ts`.
Acceptance criteria:
- [ ] Ranked references include palette, tone, layout, typography structure, and motion facts when available.
- [ ] Design vectors change from route-default-only guidance to media-derived direction when high-confidence facts exist.
- [ ] Missing or diagnostic media analysis contributes nothing.
- [ ] Exact words are never claimed by v1 media analysis.
- [ ] Downstream builders depend on the board contract fields, not raw media-analysis internals.

## Task 9 - Update Generated Artifacts Without Canvas Leakage
Reasoning: The generated files must use media-derived guidance, but Canvas must receive only schema-safe summaries.
What to do: Thread media-derived summaries through contract builders and markdown rendering.
How:
1. Update `buildGenerationPlan(...)` inputs/logic so target outcome, visual direction, layout strategy, content strategy, component strategy, motion posture, and design vectors can summarize media facts.
2. Update design-contract builders for design language, color system, layout system, typography system, surface system, and motion system.
3. Update `renderReferenceMarkdown(...)` and design markdown output to list media observations and limitations.
4. Preserve `toCanvasGenerationPlan(...)` as the Canvas-safe boundary.
5. Do not add raw `mediaAnalysis` to `canvas-plan.request.json`.
6. Allow only concise media-derived strings through existing generation-plan fields and `designVectors`.
7. If the overall output is diagnostic-only, the Canvas request remains omitted or diagnostic-only according to existing readiness behavior; media summaries do not override Canvas gating.
Files impacted: `src/inspiredesign/contract.ts`.
Acceptance criteria:
- [ ] `design.md`, `generation-plan.json`, and `design-contract.json` include media-derived summaries.
- [ ] `canvas-plan.request.json` has no top-level `mediaAnalysis`.
- [ ] Raw boxes, frame arrays, and exact text fields are absent from Canvas payloads.
- [ ] Typography sections say exact readable text was not extracted.
- [ ] Diagnostic-only output does not become Canvas-ready because media analysis exists.

## Task 10 - Emit and Explain `media-analysis.json`
Reasoning: Downstream agents need an artifact they can inspect and cite.
What to do: Add renderer, handoff, and meta-prompt support.
How:
1. In `src/inspiredesign/handoff.ts`, add `mediaAnalysis: "media-analysis.json"` to `INSPIREDESIGN_HANDOFF_FILES`.
2. Add an artifact guide entry explaining `pin-media-index.json` as the trust gate and `media-analysis.json` as the design-fact surface.
3. Update handoff guidance so agents inspect `media-analysis.json` before making media-derived claims.
4. In `src/inspiredesign/meta-prompt.ts`, add `media-analysis.json` to validation gates.
5. Require media-derived claims to cite `media-analysis.json` and saved media paths.
6. In `src/providers/renderer.ts`, add `mediaAnalysis` to render args, JSON/context responses, bundle files, and manifests.
7. Emit `media-analysis.json` whenever a packet is rendered, including limitations-only or empty analysis. Do not use it to compute `artifactAuthority`, `evidenceAuthority`, or Canvas readiness.
Files impacted: `src/inspiredesign/handoff.ts`, `src/inspiredesign/meta-prompt.ts`, `src/providers/renderer.ts`.
Acceptance criteria:
- [ ] `media-analysis.json` is emitted in all relevant output modes.
- [ ] `design-agent-handoff.json` lists and explains it.
- [ ] `meta-prompt.md` requires citations to it for media-derived claims.
- [ ] Renderer output still omits Canvas request when readiness is diagnostic-only.
- [ ] Renderer tests prove `media-analysis.json` is present but not counted as an authority artifact.

## Task 11 - Preserve Product Readiness Semantics
Reasoning: A useful design-fact artifact must not become a readiness bypass.
What to do: Ensure product readiness ignores media analysis.
How:
1. Review `src/inspiredesign/product-readiness.ts`.
2. Do not add media analysis to pin-media artifact readers or authoritative ranked-reference checks.
3. Add a negative test with populated media analysis and missing/invalid `pinMediaIndex`.
4. Assert the output remains diagnostic-only with zero authoritative pin-media count.
Files impacted: `src/inspiredesign/product-readiness.ts`, `tests/inspiredesign-product-readiness.test.ts`.
Acceptance criteria:
- [ ] Readiness remains driven by manifest-backed `pinMediaIndex`.
- [ ] `media-analysis.json` alone cannot produce `pin_media_ready`.
- [ ] Remote-only or diagnostic media remains blocked.

## Task 12 - Add Analyzer Unit Tests
Reasoning: Analyzer behavior should be testable without running the full workflow.
What to do: Add focused tests for schema, adapters, and deterministic facts.
How:
1. Create `tests/inspiredesign-media-analysis.test.ts`.
2. Use generated fixtures or stubbed FFprobe/FFmpeg adapter outputs where real binaries are unsuitable for unit tests.
3. Cover image tone, palette, layout, and typography structure.
4. Cover GIF/video metadata and sampled frame deltas.
5. Cover missing FFprobe/FFmpeg limitations.
6. Cover diagnostic media exclusion.
Files impacted: `tests/inspiredesign-media-analysis.test.ts` (new).
Acceptance criteria:
- [ ] Image tests prove tone, palette, layout, and typography structure.
- [ ] GIF and video tests prove motion sampling facts.
- [ ] Missing binary tests produce limitations without false facts.
- [ ] No test expects exact readable text from v1.

## Task 13 - Extend Contract, Renderer, Workflow, and Visual Harvest Tests
Reasoning: The seam must be proven end to end across synthesis and emitted artifacts.
What to do: Extend existing regression suites.
How:
1. Extend `tests/inspiredesign-visual-harvest.test.ts` around the current pin-media-ready case to assert media-derived ranked-reference fields.
2. Extend `tests/providers-inspiredesign-contract.test.ts` to assert packet `mediaAnalysis`, evidence citation, generation-plan/design-contract/design.md propagation, Canvas-safe omission of raw analysis, and renderer mode emission.
3. Extend `tests/providers-inspiredesign-workflow.test.ts` to assert `media-analysis.json` exists, references trusted saved media paths, appears in the manifest, and influences generated artifacts.
4. Extend `tests/inspiredesign-product-readiness.test.ts` with the negative readiness case from Task 11.
5. Keep existing pin-media authority tests in `tests/inspiredesign-pinterest-pin-media-evidence.test.ts` unchanged unless fixtures need helper updates.
Files impacted: `tests/inspiredesign-visual-harvest.test.ts`, `tests/providers-inspiredesign-contract.test.ts`, `tests/providers-inspiredesign-workflow.test.ts`, `tests/inspiredesign-product-readiness.test.ts`, possibly `tests/inspiredesign-pinterest-pin-media-evidence.test.ts`.
Acceptance criteria:
- [ ] Ranked references and design vectors show media-derived facts.
- [ ] Bundle output includes `media-analysis.json`.
- [ ] Canvas payload excludes raw analysis.
- [ ] Product readiness still requires `pin-media-index.json`.

## Task 14 - Update Docs and Skill Guidance
Reasoning: Agents need to know how to use the new artifact correctly.
What to do: Update documentation surfaces after implementation.
How:
1. Update relevant InspireDesign docs that describe generated artifacts.
2. Update `skills/opendevbrowser-best-practices/artifacts/provider-workflows.md` if Pinterest harvest guidance changes.
3. Update `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh` only if command output mentions artifact expectations.
4. Keep docs explicit that `media-analysis.json` is not readiness authority.
5. Mention OCR-free typography structure and deferred readable text extraction.
Files impacted: docs and skill files touched by the implementation's public behavior.
Acceptance criteria:
- [ ] Docs explain `media-analysis.json`.
- [ ] Docs preserve the canonical-pin harvest guidance and authority rules.
- [ ] No docs imply OCR or model vision is part of v1.

## Implementation Order
1. Task 1.
2. Tasks 2 to 5.
3. Task 12.
4. Task 6.
5. Tasks 7 to 10.
6. Tasks 8 and 9.
7. Tasks 11 and 13.
8. Task 14.

## File-by-File Implementation Sequence
1. `package.json`
2. `src/inspiredesign/media-analysis/types.ts` (new)
3. `src/inspiredesign/media-analysis/ffprobe.ts` (new)
4. `src/inspiredesign/media-analysis/ffmpeg.ts` (new)
5. `src/inspiredesign/media-analysis/pixel.ts` (new)
6. `src/inspiredesign/media-analysis/typography-structure.ts` (new)
7. `src/inspiredesign/media-analysis/design-guidance.ts` (new)
8. `src/inspiredesign/media-analysis/analyzer.ts` (new)
9. `src/inspiredesign/media-analysis/persist.ts` (new)
10. `src/inspiredesign/media-analysis/index.ts` (new)
11. `src/providers/workflows.ts`
12. `src/inspiredesign/contract.ts`
13. `src/inspiredesign/reference-pattern-board.ts`
14. `src/providers/renderer.ts`
15. `src/inspiredesign/handoff.ts`
16. `src/inspiredesign/meta-prompt.ts`
17. `src/inspiredesign/product-readiness.ts`
18. Tests listed in the test plan.
19. Docs and skill guidance listed in Task 14.

## Test Plan
Run focused tests as each seam lands:

```bash
npm run test -- tests/inspiredesign-media-analysis.test.ts
npm run test -- tests/inspiredesign-visual-harvest.test.ts
npm run test -- tests/providers-inspiredesign-contract.test.ts
npm run test -- tests/providers-inspiredesign-workflow.test.ts
npm run test -- tests/inspiredesign-product-readiness.test.ts
```

Run repo gates before claiming completion:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Non-Goals
- No readable exact text extraction in v1.
- No OCR, native Tesseract, Tesseract.js, OpenCV.js, Sharp, browser canvas, model vision, or wasm FFmpeg in v1.
- No new npm dependencies.
- No readiness shortcut through `media-analysis.json`.
- No raw frames, raw region arrays, or full analysis payloads in `canvas-plan.request.json`.
- No creative influence from diagnostic, remote-only, or unindexed media.

## Open Questions
None blocking. If implementation discovers that FFmpeg/FFprobe availability is unacceptable for distributed users, revisit a single dependency option such as Sharp in a separate plan. Do not add it opportunistically in this v1 work.

## Version History
- 2026-06-06: Initial plan based on deterministic media-direction investigation, RepoPrompt seam probes, and context-builder plan pass.
