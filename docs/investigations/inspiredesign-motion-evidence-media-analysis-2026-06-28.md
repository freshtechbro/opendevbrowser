# Investigation: Inspiredesign Motion Evidence and Media Analysis

## Summary

The live harvest is product-ready through manifest-backed Pinterest pin-media authority, not viewport screenshots or browser replay. Empty `motion-evidence.json` means no browser screencast replay was captured; sampled video or GIF media facts, when present, live separately in non-authoritative `media-analysis.json`.

## Symptoms

- The latest digital fashion studio harvest completed product-ready with `artifactAuthority=product_ready` and `evidenceAuthority=pin_media_ready`.
- `visual-evidence.json` records `required_visual_evidence_missing` for all 5 references.
- `screenshot-index.json` is empty.
- `motion-evidence.json` is empty.
- `media-analysis.json` exists and contains media-derived facts, including `motion_sampled` for video references.

## Background / Prior Research

- 2026-06-28 read-only runtime/source lane verified live bundle `.opendevbrowser/inspiredesign/931f4b2d-c77d-4018-9b89-5ce303bc0065` and current source.
- `visual-evidence.json` records five failed viewport entries with `required_visual_evidence_missing` because the Pinterest-first flow captured authoritative pin media, did not run primary viewport screenshot for these `unknown_pin`/pin-media references, and finalization synthesizes missing required visual metadata unless stronger motion or pin-media design evidence exists. Evidence: `.opendevbrowser/inspiredesign/931f4b2d-c77d-4018-9b89-5ce303bc0065/visual-evidence.json:1-74`, `src/providers/workflows.ts:2668-2720`, `src/providers/workflows.ts:6290-6372`, `src/providers/workflows.ts:3344-3383`.
- `screenshot-index.json` is empty because `buildScreenshotIndex()` only includes captured visual records with `path`, `sha256`, and `bytes`; this bundle has only failed visual records and no screenshot artifact files. Evidence: `.opendevbrowser/inspiredesign/931f4b2d-c77d-4018-9b89-5ce303bc0065/screenshot-index.json:1-3`, `src/inspiredesign/contract.ts:3106-3139`.
- `motion-evidence.json` is empty because screencast evidence is produced only when `motionFirst` is true for `video_pin`; current references were accepted through first-party pin-media capture and no `capture.motion` entries exist. Evidence: `.opendevbrowser/inspiredesign/931f4b2d-c77d-4018-9b89-5ce303bc0065/motion-evidence.json:1-3`, `src/providers/workflows.ts:2689-2695`, `src/providers/workflows.ts:6330-6367`, `src/inspiredesign/contract.ts:3141-3150`.
- Videos/GIFs are analyzed in the media-analysis lane from trusted finalized pin-media files, not from browser screencast replay. The workflow builds trusted inputs after pin-media finalization, resolves optional FFmpeg/FFprobe, and calls `analyzeInspiredesignMediaArtifacts()`; the analyzer accepts only `authority === "design_evidence"` and `scheduledForBundle`, probes metadata, decodes bounded frames via FFmpeg, and adds `motion_sampled` only for GIF/video with sampled motion frames. Evidence: `src/providers/workflows.ts:6409-6440`, `src/inspiredesign/media-analysis/analyzer.ts:39-81`, `src/inspiredesign/media-analysis/analyzer.ts:158-194`, `src/inspiredesign/media-analysis/ffmpeg.ts:46-63`, `src/inspiredesign/media-analysis/ffmpeg.ts:93-126`, `src/inspiredesign/media-analysis/types.ts:1-15`.
- In the live bundle, `pin-media-index.json` has five manifest-backed `design_evidence` entries, including two MP4 videos and three images; `media-analysis.json` analyzed all five saved media paths and marks the two videos with `motion_sampled`. Evidence: `.opendevbrowser/inspiredesign/931f4b2d-c77d-4018-9b89-5ce303bc0065/pin-media-index.json:1-80`, `.opendevbrowser/inspiredesign/931f4b2d-c77d-4018-9b89-5ce303bc0065/media-analysis.json:13-37`.
- `media-analysis.json` can claim bounded design facts from saved trusted media: metadata, quantized palette, pixel tone, heuristic layout, OCR-free typography/text-region structure, and sampled motion for decoded video/GIF frames. It cannot claim product readiness, evidence authority, exact readable text, exact fonts, OCR/OpenCV/model-vision findings, browser canvas pixels, or screencast replay authority. Evidence: `src/inspiredesign/media-analysis/AGENTS.md:7-47`, `src/inspiredesign/media-analysis/types.ts:17-28`, `src/inspiredesign/handoff.ts:166-172`, `.opendevbrowser/inspiredesign/931f4b2d-c77d-4018-9b89-5ce303bc0065/media-analysis.json:4-12`.

- Git archaeology found the initial visual harvest in `18b43cd909e4112ee6224c13b9e23fff3003c5aa` (`2026-05-19T00:18:44-05:00`, `feat: add inspiredesign visual harvest`): it added `src/inspiredesign/visual-evidence.ts`, `src/inspiredesign/visual-policy.ts`, workflow persistence for `visual-evidence.json` and `screenshot-index.json`, plus workflow/capture/contract tests. Companion docs commit `5cd3a3e85ba68759bc8a90c7610f6f5f9d17c24f` (`2026-05-19T00:18:53-05:00`) documented harvest artifacts and motion follow-through.
- Pinterest pin-media authority arrived in `6429fd92cf77a08b927a2ffbf88a2702281c0e6b` (`2026-06-05T15:03:19-05:00`, `feat(inspiredesign): add Pinterest pin-media authority`): it added `src/inspiredesign/pinterest-pin-media-evidence.ts`, BrowserManager capture support, product-readiness/ranking gates, renderer/workflow wiring, and tests. Docs commit `dcc19a5f68fa8e6aa2f8c2f5e5077db03caef3e3` (`2026-06-05T15:05:34-05:00`) recorded the readiness contract.
- Media analysis arrived in `1681546c0c073276234b155841536bd89d91805e` (`2026-06-07T12:04:45-05:00`, `feat: add inspiredesign media readiness authority`): it added `src/inspiredesign/media-analysis/` (`analyzer.ts`, `ffmpeg.ts`, `ffprobe.ts`, `pixel.ts`, `design-guidance.ts`, `persist.ts`, `types.ts`), changed `src/inspiredesign/motion-evidence.ts`, `src/inspiredesign/capture-mode.ts`, `src/providers/workflows.ts`, `src/providers/renderer.ts`, `src/inspiredesign/product-readiness.ts`, and documented media analysis as design facts, not readiness authority. Current source still calls `analyzeInspiredesignMediaArtifacts()` from `src/providers/workflows.ts:6427`, and the analyzer starts at `src/inspiredesign/media-analysis/analyzer.ts:39`.
- Pinterest readiness/capture fixes followed in `28b336204fc784b158316aac5063575edcca1cde` (`2026-06-12T12:15:34-05:00`) and `0435146aa0691ea695734202f29b0b6d81b3b3f0` (`2026-06-12T16:08:50-05:00`), touching `src/providers/browser-native-discovery.ts`, `src/providers/renderer.ts`, `src/providers/workflows.ts`, `src/browser/browser-manager.ts`, `src/inspiredesign/capture-mode.ts`, and `src/inspiredesign/capture.ts`. Current `src/inspiredesign/capture-mode.ts:55-73` forces Pinterest-only harvest and compatible Pinterest URL recovery to `captureMode=off`.
- Story Pin media capture was added in `89525d0adf312124bdf5d2d9bf65e130b73b6b09` (`2026-06-13T14:39:47-05:00`) by changing `src/browser/browser-manager.ts` and `tests/browser-manager.test.ts`.
- FFmpeg/FFprobe preflight and host capability reporting arrived in `00ab8d8f67f70646a15eb03b22fe80facdda390b` (`2026-06-21T17:30:11-05:00`), adding `src/inspiredesign/media-analysis/binaries.ts`, config/runtime/status-capability wiring, docs, and tests. It preserved `pin-media-index.json` and `motion-evidence.json` as authority surfaces while making missing binaries degrade only `media-analysis.json`.
- Common-path FFmpeg/FFprobe fallback arrived in `a978fb1d210a93de17fa8c1f7f378de246b206e7` (`2026-06-26T19:52:09-05:00`) with changes to `src/inspiredesign/media-analysis/binaries.ts`; explicit env/config paths remain diagnostic. Docs commit `99349a901d1cecda94edc87c7223074c01e89d10` (`2026-06-26T19:52:40-05:00`) recorded that recovery.
- Product authority hardening landed in `0375fc5ea52a2f42201b26442e0f96cf56e1fba1` (`2026-06-27T19:39:38-05:00`): canonical Pinterest product-ready output now requires manifest-backed `pin_media_ready`; snapshot and screencast motion are not substitutes. It touched `src/inspiredesign/product-readiness.ts`, `src/providers/renderer.ts`, `src/providers/workflows.ts`, `src/inspiredesign/contract.ts`, public surface/docs/skills, and tests. Docs commit `e117729b831cca412804375c076425817dd4c482` (`2026-06-27T19:39:57-05:00`) recorded the related investigations.

## Investigator Findings

### Verified conclusions

1. **Hypothesis 1 is partly confirmed, with an important nuance.** Pinterest-only harvest inputs do force deep capture off, and the workflow prioritizes first-party pin-media capture. `resolveInspiredesignHarvestCaptureMode()` returns `"off"` for Pinterest-only provider discovery or Pinterest-only URL recovery, and also for direct canonical Pinterest pin runs unless `requested === "deep"`. Evidence: `src/inspiredesign/capture-mode.ts:66-83`, especially `src/inspiredesign/capture-mode.ts:74-78`; the workflow re-resolves capture mode after discovery at `src/providers/workflows.ts:6248-6281`. Current tests lock this: `tests/providers-inspiredesign-workflow.test.ts:6509-6523` expects Pinterest-only harvest inputs with requested `"deep"` to resolve to `"off"`.

2. **Hypothesis 1 is not a blanket rule that screenshots or screencasts can never exist.** The same workflow still has primary visual and primary motion lanes before deep reference capture: it computes `pinMediaFirst`, `visualFirst`, and `motionFirst` at `src/providers/workflows.ts:6329-6331`, then captures pin media, visual, and motion independently at `src/providers/workflows.ts:6337-6370`. The hard distinction is that `captureMode === "off"` short-circuits later deep diagnostics in `captureInspiredesignReference()` while preserving primary evidence if present. Evidence: `src/providers/workflows.ts:3024-3041`. Therefore, source disproves a categorical claim that captureMode off alone forbids screenshots or screencasts.

3. **For the live bundle, however, there is no screenshot or screencast evidence.** `.opendevbrowser/inspiredesign/931f4b2d-c77d-4018-9b89-5ce303bc0065/evidence.json` shows deep diagnostics were skipped before primary media capture for each reference and `motion` is null, while `pinMedia` is captured. Example line evidence: `evidence.json:146-154`, `evidence.json:209-217`, `evidence.json:271-279`, `evidence.json:334-342`, and `evidence.json:397-405` record skipped deep diagnostics; `evidence.json:114-125` and `evidence.json:239-250` record captured MP4 pin-media paths. `visual-evidence.json:1-74` records five failed viewport placeholders with `required_visual_evidence_missing`, and `screenshot-index.json:1-3` plus `motion-evidence.json:1-3` are empty indexes. The final authority fields still pass through pin media: `evidence.json:2016-2019` has `ready=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, and `productSuccess=true`.

4. **The root cause of the apparent contradiction is authority separation, not missing video analysis.** Required visual placeholders can remain in `visual-evidence.json` when viewport screenshots were not captured, but product readiness can still come from manifest-backed pin-media. Source confirms `hasWorkflowPrimaryPinMediaDesignEvidence()` builds a `pin_media_ready` authority check from persisted pin media and a pin-media index entry at `src/providers/workflows.ts:2962-2978`. Required visual failure logic exempts primary motion or pin-media design evidence at `src/providers/workflows.ts:3013-3020` and final visual artifact collation avoids failing the reference when primary motion or primary pin-media design evidence exists at `src/providers/workflows.ts:3368-3383`. The live `pin-media-index.json:1-137` contains five `authority: "design_evidence"` entries; two are MP4s at `pin-media-index.json:4-28` and `pin-media-index.json:57-81`, and the manifest lists those files at `bundle-manifest.json:24-28`.

5. **Hypothesis 2 is confirmed.** `motion-evidence.json` is browser replay evidence only. The motion evidence type has `InspiredesignMotionEvidenceKind = "screencast"` at `src/inspiredesign/motion-evidence.ts:3-4`; persisted motion evidence is replay, replay HTML, preview, frame count, warnings, diagnostics, and authority at `src/inspiredesign/motion-evidence.ts:43-61`. The handoff contract describes `motion-evidence.json` as the canonical screencast replay index at `src/inspiredesign/handoff.ts:149-155`. The renderer writes it separately as `{ motionEvidence }` at `src/providers/renderer.ts:1272-1275`.

6. **Hypothesis 3 is confirmed.** `media-analysis.json` analyzes trusted saved media after pin-media finalization. The workflow finalizes motion, then pin media, then visual artifacts, then builds media-analysis inputs from `pinMediaCollation.files` at `src/providers/workflows.ts:6402-6427`. `buildTrustedInspiredesignMediaAnalysisInputs()` accepts only captured pin media whose persisted authority is `design_evidence`, whose path is scheduled in the bundle, and whose bytes/hash match the scheduled artifact before writing a temporary source file and marking the input `scheduledForBundle: true`; evidence: `src/providers/workflows.ts:3831-3877`. The analyzer then filters to trusted inputs only at `src/inspiredesign/media-analysis/analyzer.ts:56-60`, runs FFprobe and FFmpeg frame extraction at `src/inspiredesign/media-analysis/analyzer.ts:70-81`, and adds `motion_sampled` only for GIF/video media with more than one sampled frame at `src/inspiredesign/media-analysis/analyzer.ts:174-185`.

7. **The live bundle proves video motion facts can exist while `motion-evidence.json` is empty.** `motion-evidence.json:1-3` has no screencast entries. At the same time, `media-analysis.json:13-37` describes `pin-media-evidence/738b8a0ee22e/video.mp4` as a trusted video with `motion_sampled`, and `media-analysis.json:313-336` gives eight sampled frames, frame deltas, average frame delta, cadence, and posture. The second video has the same pattern at `media-analysis.json:847-868` and `media-analysis.json:1145-1168`. Local byte/hash verification matched `pin-media-index.json`: `pin-media-evidence/738b8a0ee22e/video.mp4` is 415053 bytes with SHA-256 `5871c077777407de32580596f8cc0de9c99afa412bc04466eba9022fd8e76ef3`; `pin-media-evidence/313fee2aba7b/video.mp4` is 1041005 bytes with SHA-256 `cd8b345095f88ce6626a5078c32c6932f232bb4ceadf4017712644ba54173f41`.

8. **Hypothesis 4 is confirmed.** Current media analysis is bounded frame sampling and heuristic design facts, not optical flow or semantic choreography. `ffmpeg.ts` decodes at most `INSPIREDESIGN_MEDIA_ANALYSIS_MAX_SAMPLED_FRAMES` bounded RGB frames through `fps=...`, scale, pad, and rawvideo output; evidence: `src/inspiredesign/media-analysis/ffmpeg.ts:46-63`, `src/inspiredesign/media-analysis/ffmpeg.ts:93-126`, and constants in `src/inspiredesign/media-analysis/types.ts:1-15`. `pixel.ts` computes luminance, edge density, quantized palette, heuristic layout zones, and frame-to-frame RGB deltas; motion facts are sampled frame indexes, frame deltas, average delta, cadence, posture, and tone summaries. Evidence: `src/inspiredesign/media-analysis/pixel.ts:50-70`, `src/inspiredesign/media-analysis/pixel.ts:217-220`, and `src/inspiredesign/media-analysis/pixel.ts:319-333`. There is no vector field, object tracking, shot or scene boundary detection, semantic action labeling, UI choreography inference, or merge with browser replay artifacts.

9. **The code and docs intentionally keep media-analysis non-authoritative.** `INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS` includes no Sharp decoding, OCR, OpenCV, browser canvas extraction, model vision, exact readable text, and product readiness authority at `src/inspiredesign/media-analysis/types.ts:17-25`. The media-analysis AGENTS guide says the package reads trusted persisted media, emits bounded design facts, and never decides readiness at `src/inspiredesign/media-analysis/AGENTS.md:7-47`. The handoff guide says `media-analysis.json` must not be treated as artifact or evidence authority at `src/inspiredesign/handoff.ts:166-172`. Tests lock this at `tests/inspiredesign-media-analysis.test.ts:1419-1433`, `tests/providers-inspiredesign-workflow.test.ts:1268-1290`, and `tests/public-surface-manifest.test.ts:119-137`.

10. **Product-readiness authority now requires Pinterest pin media for canonical Pinterest pins.** `readPinterestEvidenceRequired()` infers Pinterest evidence is required from ranked Pinterest references at `src/inspiredesign/product-readiness.ts:1060-1068`. `buildInspiredesignProductReadinessFields()` then requires `pinMediaReadyReferenceCount === pinterestCount` whenever Pinterest evidence is required at `src/inspiredesign/product-readiness.ts:1133-1161`. Renderer fallback uses `hasPinterestPinMediaReadyAuthority()` for Pinterest pin references instead of snapshot or motion fallback at `src/providers/renderer.ts:365-411`. Tests prove generic non-Pinterest motion replay can still pass as `motion_ready`, but Pinterest readiness with pin-media proof is counted as `pin_media_ready`: `tests/inspiredesign-product-readiness.test.ts:1040-1138`. Tests also reject snapshot-only Pinterest envelopes when pin media is required at `tests/inspiredesign-product-readiness.test.ts:2559-2597`.

### Git history verification

- `18b43cd909e4112ee6224c13b9e23fff3003c5aa` on 2026-05-19, `feat: add inspiredesign visual harvest`, added visual evidence, screenshot index, reference ranking, and workflow persistence across `src/inspiredesign/*`, `src/providers/workflows.ts`, renderer, and tests.
- `6429fd92cf77a08b927a2ffbf88a2702281c0e6b` on 2026-06-05, `feat(inspiredesign): add Pinterest pin-media authority`, added first-party pin-media evidence, pin-media index, BrowserManager capture support, readiness gates, and tests.
- `1681546c0c073276234b155841536bd89d91805e` on 2026-06-07, `feat: add inspiredesign media readiness authority`, added `src/inspiredesign/media-analysis/`, changed `motion-evidence.ts`, `capture-mode.ts`, workflow, renderer, product readiness, and tests. Current analyzer lines are still mostly blamed to this commit at `src/inspiredesign/media-analysis/analyzer.ts:39-81`.
- `0435146aa0691ea695734202f29b0b6d81b3b3f0` on 2026-06-12, `fix: close pinterest harvest readiness gaps`, touched `src/inspiredesign/capture-mode.ts` and related capture tests. Current Pinterest capture-mode lines `55-57` still blame to this commit, while lines `70-73` blame to `1681546c`.
- `89525d0adf312124bdf5d2d9bf65e130b73b6b09` on 2026-06-13, `fix(browser): capture Pinterest story pin media`, changed BrowserManager and browser-manager tests.
- `00ab8d8f67f70646a15eb03b22fe80facdda390b` on 2026-06-21, `feat: add media analysis binary preflight`, added FFmpeg/FFprobe binary preflight, status capability visibility, docs, and tests while preserving the authority split.
- `a978fb1d210a93de17fa8c1f7f378de246b206e7` on 2026-06-26, `fix: resolve media tools from common paths`, added common-path FFmpeg/FFprobe fallback for implicit PATH misses.
- `0375fc5ea52a2f42201b26442e0f96cf56e1fba1` on 2026-06-27, `fix: harden inspiredesign product authority`, made canonical Pinterest product-ready output require manifest-backed `pin_media_ready`; snapshot and screencast motion are not substitutes.

### Capability gaps

- Media-analysis v1 reports sampled frame deltas and posture, but not optical flow, object trajectories, camera movement, scene cuts, gesture semantics, UI animation choreography, cause-effect interaction states, or browser replay timing.
- `motion-evidence.json` and `media-analysis.json` do not currently reconcile each other. A saved pin video can yield `motion_sampled` facts without any browser replay evidence, and a browser replay can yield `motion_ready` without saved-media FFmpeg facts.
- The UX gap is naming and operator expectation: an empty `motion-evidence.json` sounds like no motion was observed, but in the current contract it only means no authoritative browser screencast replay was captured. Video facts may still exist in `media-analysis.json`.

### Root cause statement

The live bundle is product-ready because Pinterest harvest used manifest-backed first-party pin-media authority, not viewport screenshots or browser replay. `visual-evidence.json` and `screenshot-index.json` reflect missing viewport screenshot artifacts; `motion-evidence.json` reflects missing browser screencast replay artifacts. `media-analysis.json` separately analyzed the saved MP4/JPEG pin-media files and produced bounded design facts, including sampled video motion facts for the two MP4s. This is expected under the current architecture, but the artifact naming creates a capability perception gap.

## Investigation Log

### Phase 0 - Workspace Verification
**Hypothesis:** RepoPrompt CLI must target the loaded `opendevbrowser` workspace before investigation.
**Findings:** `rpce-cli -e 'windows'` reported window `1` for `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`; `rpce-cli -w 1 -e 'tree --type roots'` confirmed the same root.
**Evidence:** Window `1`, root `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`.
**Conclusion:** Confirmed.

### Phase 1 - Initial Symptoms and Hypotheses
**Hypothesis:** The missing screenshot and motion-evidence artifacts may be expected behavior for Pinterest pin-media harvest, while video motion facts may live in `media-analysis.json`.
**Findings:** Live bundle path is `.opendevbrowser/inspiredesign/931f4b2d-c77d-4018-9b89-5ce303bc0065`; current artifact inspection showed top-level `ready=true`, `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, zero screenshot records, zero browser motion replay records, and two video references with `motion_sampled` media-analysis facts.
**Evidence:** `evidence.json`, `screenshot-index.json`, `motion-evidence.json`, `pin-media-index.json`, `media-analysis.json`.
**Conclusion:** Confirmed.

## Root Cause

The apparent contradiction comes from separate evidence lanes with separate authority semantics:

1. `visual-evidence.json` contains required visual placeholder/failure metadata because required viewport visual evidence was requested but no finalized viewport screenshot artifact existed for the five references. Those records do not prove the references failed product readiness.

2. `screenshot-index.json` is empty because it indexes only finalized screenshot records with artifact `path`, `sha256`, and `bytes`. Failed, skipped, or placeholder visual records remain in `visual-evidence.json` and are intentionally excluded from the screenshot index.

3. `motion-evidence.json` is empty because it is the browser screencast replay lane. It does not represent all possible motion insight, and it does not index saved Pinterest MP4 or GIF frame analysis.

4. `media-analysis.json` is the saved-media analysis lane. It runs after trusted Pinterest pin-media finalization, accepts only manifest-backed design-evidence media, resolves FFprobe and FFmpeg, probes metadata, samples bounded frames, and emits design facts such as palette, tone, layout posture, OCR-free typography structure, and sampled motion deltas for video/GIF media.

The implementation therefore did process the saved videos in the live bundle, but only as bounded sampled-media facts. It did not capture authoritative browser replay motion, and it does not currently perform semantic motion understanding such as optical flow, object tracking, shot detection, interaction choreography, hover/scroll timing, or gesture/action labeling.

## Recommendations

1. Keep the authority surfaces separate in product and documentation language:

`pin-media-index.json` is Pinterest readiness and provenance authority. `media-analysis.json` is bounded design-fact input only. `motion-evidence.json` is browser screencast replay evidence only. `screenshot-index.json` is finalized viewport screenshot artifacts only.

2. Improve user-facing reporting when `media-analysis.json` has `motion_sampled` entries but `motion-evidence.json` is empty. The report should state that saved video/GIF media was sampled, but no browser replay was captured.

3. Extend the existing FFmpeg adapter before adding heavier dependencies. The lowest-risk next step is distributed sampling plus scene-style signals from FFmpeg filters, then normalized cadence and cut/transition summaries. Only consider OpenCV or optical-flow style dependencies after the bounded FFmpeg path stops being enough.

4. If downstream consumers need cinematic or interaction-level motion insights, add a new explicit analysis surface rather than overloading `motion-evidence.json`. A good target is a `media-motion-analysis` section derived from trusted saved media, with fields for sampling windows, scene changes, motion magnitude over time, transition rhythm, and limitations.

5. If browser choreography is required, run or add a capture path that actually records replay/screencast evidence for the reference. `--visual-evidence required` alone cannot produce screenshots if the flow only finalizes pin media, and saved-media analysis cannot prove browser interaction timing.

## Preventive Measures

1. Rename or document `motion-evidence.json` consistently as browser replay motion evidence in CLI help, docs, and skill guidance.

2. Add validation messaging that `required_visual_evidence_missing` can coexist with `productSuccess=true` when `pin_media_ready` authority is present.

3. Add a handoff/report note whenever `media-analysis.json` contains `motion_sampled` while `motion-evidence.json` is empty.

4. Keep tests asserting that canonical Pinterest product readiness depends on manifest-backed `pin_media_ready`, not screenshot or screencast substitutes.

5. Add regression coverage for a trusted saved MP4 where `media-analysis.json` contains sampled motion facts and `motion-evidence.json` remains empty, so future readers do not mistake the separation for a regression.
