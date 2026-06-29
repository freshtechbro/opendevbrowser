# Inspiredesign Media Motion Analysis: Plan

## Goal

Improve Inspiredesign saved-media motion insight for trusted Pinterest MP4 and GIF assets without changing readiness authority. The implementation should keep `pin-media-index.json` as Pinterest readiness and provenance authority, keep `motion-evidence.json` as browser replay evidence, and enrich `media-analysis.json` with deterministic, bounded saved-media motion facts.

## Background

The completed investigation at `docs/investigations/inspiredesign-motion-evidence-media-analysis-2026-06-28.md` found that empty `motion-evidence.json` means no browser screencast replay was captured, not that saved videos were unanalyzed. The live bundle still produced `media-analysis.json` with two MP4 `motion_sampled` references.

Current source seams:

- `src/providers/workflows.ts:3831` builds trusted media-analysis inputs only from finalized manifest-backed pin media with matching bytes and hashes.
- `src/providers/workflows.ts:6400` runs media analysis after motion, pin media, and visual artifact finalization.
- `src/inspiredesign/media-analysis/analyzer.ts:39` filters to trusted inputs and coordinates FFprobe plus FFmpeg frame extraction.
- `src/inspiredesign/media-analysis/types.ts:173` defines the current `InspiredesignMediaMotionFacts` shape.
- `src/inspiredesign/media-analysis/pixel.ts:54` builds current sampled motion facts from decoded frames.
- `src/inspiredesign/media-analysis/design-guidance.ts:163` turns motion facts into human-readable design guidance.
- `src/inspiredesign/motion-evidence.ts:3` defines motion evidence as screencast replay evidence.
- `src/inspiredesign/media-analysis/types.ts:17` records non-goals: no OCR, OpenCV, model vision, browser canvas extraction, or readiness authority.

Prior work already established the guardrails:

- `docs/plans/pinterest-video-media-analysis-ffmpeg-preflight-2026-06-20.md` keeps FFmpeg and FFprobe as optional host tools and avoids bundled static binaries or heavy dependencies.
- `docs/investigations/pinterest-video-media-analysis-dependencies-2026-06-20.md` recommends timestamp-distributed sampling, representative scene signals, coarse regional deltas, and deterministic motion-design guidance.
- Git history shows the progression from visual evidence to pin-media authority to post-finalization media analysis, then later FFmpeg/FFprobe preflight and product authority hardening.

External FFmpeg research found suitable no-new-npm-dependency primitives:

- `ffprobe -show_format`, `-show_streams`, `-show_frames`, `-show_entries`, and `-of json` for structured metadata.
- FFmpeg `select` scene expressions or `scdet` for scene-change signals.
- FFmpeg `signalstats`, `freezedetect`, and bounded metadata output for deterministic frame-difference and freeze facts.
- FFmpeg `cropdetect` as advisory layout evidence, not semantic proof.

## Approach

Use the existing media-analysis pipeline. Add an additive `motionSignature` under `InspiredesignMediaMotionFacts`, derived from bounded decoded RGB frames and one bounded FFmpeg `scdet` scene-score pass. Propagate the richer facts through current media-analysis guidance and handoff wording, but never into `motion-evidence.json`, `pin-media-index.json`, product-readiness fields, or Canvas readiness gates.

The first implementation should stay deterministic and dependency-free. Do not add OpenCV, PySceneDetect, OCR, model vision, Sharp decoding, browser canvas extraction, static FFmpeg packages, or new readiness authority. If browser interaction choreography becomes a product requirement, plan it separately under the browser replay capture lane.

## Work Items

## Task 1 - Add deterministic motion signature types

Reasoning: A typed additive schema prevents ad hoc motion facts and keeps downstream consumers bounded.

What to do: Extend media-analysis types with serializable saved-media motion signature facts.

How:
1. Add `InspiredesignMediaMotionSignature`.
2. Add `InspiredesignMediaMotionRegionDelta`.
3. Add optional `motionSignature` to `InspiredesignMediaMotionFacts`.
4. Keep existing `cadence`, `posture`, `frameDeltas`, and `frameToneSummaries` unchanged.
5. Define motion families such as `static_hold`, `subtle_loop`, `fade_or_exposure_shift`, `cut_or_scene_change`, and `dynamic_motion`.
6. Include required signature fields for `version`, `sampleBasis`, `motionFamily`, `peakFrameDelta`, `averageFrameDelta`, `deltaVariance`, `toneShift`, `dominantChangedRegions`, and `confidence`.
7. Include optional scene fields under one nested `sceneSummary`, with detector name, event count, strongest score, bounded timestamps, and limitations.
8. Define confidence as a 0 to 1 advisory score derived from frame count, frame delta stability, and scene-score availability. It is not readiness confidence.

Files impacted: `src/inspiredesign/media-analysis/types.ts`, `src/inspiredesign/media-analysis/index.ts`.

Acceptance criteria:
- [ ] Existing serialized `media-analysis.json` objects remain valid.
- [ ] New fields are additive and optional.
- [ ] Schema boundaries distinguish frame-derived facts from FFmpeg scene-score facts.
- [ ] No readiness, evidence authority, product success, or browser replay fields are added.

## Task 2 - Build motion signatures from sampled frames

Reasoning: Existing decoded RGB frames are already bounded, trusted, and deterministic, so they are the safest source for richer motion facts.

What to do: Add a pure `motionSignature` builder in the pixel-analysis layer.

How:
1. Compute peak frame delta, average delta, and delta variance from existing adjacent frame deltas.
2. Compute first-to-last tone shift from existing frame tone summaries.
3. Divide each sampled frame into a small fixed grid, preferably `3x3`, and compute regional deltas across adjacent frame pairs.
4. Sort dominant changed regions by average delta, peak delta, row, and column for stable output.
5. Classify the motion family with named threshold constants in `pixel.ts`, not inline numbers.
6. Emit `motionSignature` only when GIF or video analysis has more than one decoded frame.

Files impacted: `src/inspiredesign/media-analysis/pixel.ts`.

Acceptance criteria:
- [ ] Same input frames always produce byte-identical JSON facts.
- [ ] Images and `video_poster` inputs still produce no motion facts.
- [ ] Single-frame GIF/video inputs do not claim `motion_sampled` or `motionSignature`.
- [ ] No extra dependency or unbounded process work is introduced.

## Task 3 - Add bounded FFmpeg scene-score signals

Reasoning: Global frame deltas miss cuts and scene-like transitions. FFmpeg can expose bounded scene scores deterministically without adding packages.

What to do: Add one optional bounded `scdet` metadata pass, then fold scene-score facts into `motionSignature.sceneSummary`.

How:
1. Add a helper that uses existing no-shell `child_process.spawn` patterns from `ffmpeg.ts` and `ffprobe.ts`.
2. Use FFmpeg `scdet` plus metadata output as the required v1 contract.
3. Parse only `lavfi.scd.score` and `lavfi.scd.time` style facts into a small internal result.
4. Bound timeout, stdout, stderr, sampled media duration, and returned event count.
5. Attach the strongest scene score, bounded timestamps, and limitations to `motionSignature.sceneSummary`.
6. Treat missing filter support, parse failures, and process failures as media-analysis limitations, not workflow failures.
7. Defer `freezedetect`, `signalstats`, `cropdetect`, optical flow, and model-based semantics to future work.

Files impacted: `src/inspiredesign/media-analysis/ffmpeg.ts`, `src/inspiredesign/media-analysis/ffprobe.ts`, `src/inspiredesign/media-analysis/analyzer.ts`, `src/inspiredesign/media-analysis/types.ts`.

Acceptance criteria:
- [ ] Missing, unsupported, or failing `scdet` degrades to limitations in `media-analysis.json`.
- [ ] Scene-score facts never affect readiness authority.
- [ ] No shell interpolation, new npm dependency, or unbounded process output is introduced.
- [ ] Existing FFmpeg/FFprobe binary resolution behavior remains unchanged.

## Task 4 - Enrich design guidance from motion signatures

Reasoning: The new facts must help design synthesis without overstating semantic video understanding.

What to do: Update design guidance language for sampled saved-media motion.

How:
1. Mention motion family and scene-score cues in `motionPosture` when present.
2. Add dominant changed regions to visual strengths when confidence is sufficient.
3. Add reduced-motion adaptation wording for dynamic, cut-like, or exposure-shift signatures.
4. Phrase all guidance as saved-media sampled motion, not browser replay, hover behavior, object tracking, or interaction choreography.
5. Preserve existing confidence and guidance-entry caps.

Files impacted: `src/inspiredesign/media-analysis/design-guidance.ts`.

Acceptance criteria:
- [ ] Guidance never claims browser replay, hover behavior, garment tracking, object tracking, or interaction timing.
- [ ] Guidance remains limitation-only when decoded frames or metadata are unavailable.
- [ ] Existing downstream consumers continue reading the same guidance fields.

## Task 5 - Add an advisory for sampled media motion without browser replay

Reasoning: Operators currently misread empty `motion-evidence.json` as no saved-video motion analysis.

What to do: Add one canonical advisory summary when `media-analysis.json` contains sampled motion and `motion-evidence.json` has no authoritative browser replay.

How:
1. After media analysis and motion finalization are available, detect media-analysis references with `claimLevels` containing `motion_sampled`.
2. Detect browser replay presence only from finalized motion evidence entries with `authority: "design_evidence"` and `kind: "screencast"`.
3. If sampled saved-media motion exists and browser replay count is zero, compute `evidence.json.mediaAnalysis.savedMediaMotionNotice` in workflow code as the canonical owner.
4. Include notice kind, count, media paths, and a concise message that saved GIF/video media was sampled but no browser replay was captured.
5. Let renderer and handoff surfaces render the workflow notice when useful, but do not recompute it independently.
6. Do not copy the notice into `motion-evidence.json`, `pin-media-index.json`, `canvas-plan.request.json`, or product-readiness fields.

Files impacted: `src/providers/workflows.ts`, `src/providers/renderer.ts`, `src/inspiredesign/handoff.ts`.

Acceptance criteria:
- [ ] `motion-evidence.json` remains browser replay only.
- [ ] Notice appears only for sampled saved-media motion plus empty authoritative replay.
- [ ] Notice is absent when no sampled saved-media motion exists.
- [ ] Notice is absent or neutral when browser replay evidence exists.
- [ ] Notice ownership is workflow-level; renderer and handoff only consume it.
- [ ] Product readiness and authority outputs are unchanged.

## Task 6 - Update operator docs and skill guidance

Reasoning: Docs and skills are contract surfaces for agents and users.

What to do: Sync saved-media motion wording across public guidance.

How:
1. Update `src/inspiredesign/handoff.ts` artifact descriptions if Task 5 changes handoff wording.
2. Update `docs/CLI.md` Inspiredesign artifact notes.
3. Update `docs/SURFACE_REFERENCE.md` artifact and authority notes.
4. Update `docs/TROUBLESHOOTING.md` with the empty replay plus sampled saved-media case.
5. Update `docs/DEPENDENCIES.md` only if FFmpeg/FFprobe capability or status wording changes.
6. Update `skills/opendevbrowser-best-practices/SKILL.md`.
7. Update `src/public-surface/source.ts` and regenerate generated manifests if generated help wording changes.

Files impacted: `src/inspiredesign/handoff.ts`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/TROUBLESHOOTING.md`, `docs/DEPENDENCIES.md`, `skills/opendevbrowser-best-practices/SKILL.md`, `src/public-surface/source.ts`, `src/public-surface/generated-manifest.ts`, `src/public-surface/generated-manifest.json`.

Acceptance criteria:
- [ ] Docs say `motionSignature` is saved-media analysis only.
- [ ] Docs say empty `motion-evidence.json` means no browser replay evidence.
- [ ] Docs preserve `pin-media-index.json` as Pinterest readiness and provenance authority.
- [ ] Docs do not claim bundled FFmpeg/FFprobe binaries or new dependency requirements.

## Task 7 - Add focused regression tests

Reasoning: The change adds new branches and authority-sensitive reporting.

What to do: Extend focused unit, workflow, and guidance tests before broad validation.

How:
1. Add media-analysis unit tests for each motion family.
2. Add regional delta ordering tests.
3. Add analyzer tests proving signatures serialize for GIF/video with multiple frames.
4. Add tests proving no signature or `motion_sampled` for images, posters, missing frames, missing binaries, or single-frame animated inputs.
5. Add workflow tests for sampled saved-media motion plus empty `motion-evidence.json`.
6. Add workflow tests proving browser replay evidence suppresses or neutralizes the empty-replay notice.
7. Extend docs guidance tests for synced wording.

Files impacted: `tests/inspiredesign-media-analysis.test.ts`, `tests/providers-inspiredesign-workflow.test.ts`, `tests/media-analysis-dependency-guidance.test.ts`.

Acceptance criteria:
- [ ] Every new classification branch has a deterministic test.
- [ ] Degraded binary behavior does not invent motion signatures.
- [ ] Workflow tests prove no readiness or authority changes.
- [ ] Docs tests fail if authority separation wording drifts.

## Task 8 - Validate generated surfaces and quality gates

Reasoning: This touches source, docs, generated public surface, and behavior tests.

What to do: Run focused checks, regenerate generated metadata if needed, then run full gates.

How:
1. Run `npm run test -- tests/inspiredesign-media-analysis.test.ts`.
2. Run `npm run test -- tests/providers-inspiredesign-workflow.test.ts -t "media analysis|motion-evidence|motion sampled"`.
3. Run `npm run test -- tests/media-analysis-dependency-guidance.test.ts`.
4. Regenerate public surface manifests if `src/public-surface/source.ts` changes.
5. Run docs drift checks if available.
6. Run `npm run lint`, `npm run typecheck`, `npm run build`, and full `npm run test`.
7. Recompute branch coverage from `coverage/lcov.info` if coverage gates are part of the implementation closeout.

Files impacted: no additional files beyond earlier tasks.

Acceptance criteria:
- [ ] Focused tests pass.
- [ ] Generated public-surface files match source.
- [ ] Lint, typecheck, build, and full tests pass.
- [ ] No new warnings, suppressions, dependencies, or authority changes are introduced.

## Out of Scope

- Browser interaction choreography, hover timing, scroll timing, or replay reconstruction.
- Writing saved-media facts into `motion-evidence.json`.
- Readiness changes in `product-readiness.ts`.
- New npm dependencies, OpenCV, PySceneDetect, OCR, model vision, Sharp decoding, browser canvas extraction, or bundled FFmpeg binaries.
- FFmpeg `freezedetect`, `signalstats`, `cropdetect`, optical flow, and model-based semantic motion labeling.

## Open Questions

None blocking. The recommended implementation path is saved-media motion enrichment first; browser replay choreography should remain a separate future plan if needed.

## References

- `docs/investigations/inspiredesign-motion-evidence-media-analysis-2026-06-28.md`
- `docs/investigations/pinterest-video-media-analysis-dependencies-2026-06-20.md`
- `docs/plans/pinterest-video-media-analysis-ffmpeg-preflight-2026-06-20.md`
- `docs/plans/ffmpeg-launchagent-path-fix-2026-06-26.md`
- FFmpeg filters documentation: https://ffmpeg.org/ffmpeg-filters.html
- FFprobe documentation: https://ffmpeg.org/ffprobe.html
