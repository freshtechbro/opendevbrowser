# Investigation: Pinterest Video Media Analysis Dependencies

## Summary
OpenDevBrowser already captures Pinterest video pins as provenance-preserving first-party media when an actual Pinterest MP4 is available, and it falls back to poster or image evidence when video bytes are unavailable. Current media analysis can sample bounded GIF/MP4 frame deltas, but it is not true semantic motion-design understanding.

FFprobe and FFmpeg are optional host runtime tools, not bundled npm dependencies. This branch implements the smallest safe preflight step: documented prerequisites, explicit env/config/PATH binary-path resolution, and capability reporting, without default static binary bundling.

## Symptoms
- Pinterest/video support exists, but current video analysis is limited to deterministic sampled-frame facts.
- Before this branch, new users did not get clear FFmpeg/FFprobe install or prerequisite guidance.
- Before this branch, missing FFmpeg/FFprobe degraded analysis quality instead of failing readiness, but the degradation was not visible enough in docs or preflight output.

## Background / Prior Research
- FFprobe official docs support JSON `-show_format` and `-show_streams` metadata output: https://ffmpeg.org/ffprobe.html
- FFmpeg official docs and filters cover bounded extraction, `select` scene expressions, `thumbnail`, `blackframe`, `showinfo`, and frame metadata filters: https://ffmpeg.org/ffmpeg.html and https://ffmpeg.org/ffmpeg-filters.html
- OpenCV optical-flow docs show sparse and dense optical flow as richer apparent-motion techniques, but they imply heavier CV dependencies: https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html
- PySceneDetect detectors document content, adaptive, threshold, and histogram detectors that are useful models for future scene-change work: https://www.scenedetect.com/docs/latest/api/detectors.html
- Pinterest API v5 supports authorized content workflows and video Pin upload flows, not arbitrary public media-byte extraction from any Pin: https://developers.pinterest.com/docs/api/v5/, https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/, https://developers.pinterest.com/docs/api/v5/pins-get/
- Static npm binary packages such as `ffmpeg-static`, `ffprobe-static`, `@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`, and `ffmpeg-ffprobe-static` improve convenience but add package-size, platform, install, license, and stale-binary maintenance risk.

## Investigator Findings: Current Implementation Trace
- Browser capture discovers closeup/story image selectors, current closeup wrappers, `video`, `video[poster]`, and pin/closeup scoped videos, capped at 30 deduped candidates at `src/browser/browser-manager.ts:541-570`.
- Video candidates prefer first-party MP4 from `currentSrc`, `src`, or child `source`, derive first-party HLS `.m3u8` URLs to `720p/*.mp4`, then add a lower-scored `video_poster` fallback; image candidates use `currentSrc`, `src`, then the last `srcset` URL at `src/browser/browser-manager.ts:669-787`.
- Candidate acceptance requires first-party URL, visibility, minimum 160 px edges, source pin proof or canonical main media container, and no noisy ancestry without canonical proof at `src/browser/browser-manager.ts:417-472`.
- Fetch validation is first-party and byte-backed: allowed hosts are `i.pinimg.com`, `v.pinimg.com`, or `vN[-edge].pinimg.com`; redirects must remain first-party; bodies are bounded; files are written as new 0600 non-symlink outputs at `src/browser/browser-manager.ts:306-318`, `src/browser/browser-manager.ts:1038-1144`, and `src/browser/browser-manager.ts:2780-2965`.
- Videos require first-party final MP4 URL, compatible `video/mp4` or generic binary content type, and MP4 `ftyp`; images and posters require image-compatible content plus a recognized signature at `src/browser/browser-manager.ts:364-390`.
- Persisted evidence supports AVIF, GIF, JPEG, PNG, WebP, and MP4 content at `src/inspiredesign/pinterest-pin-media-evidence.ts:8-17`, with signature inspection at `src/inspiredesign/pinterest-pin-media-evidence.ts:448-456`.
- `pin-media-evidence.json` is an audit surface. It becomes `design_evidence` only when structural, provenance, quality, and byte rejection reasons are clean, and diagnostic entries redact path/hash/bytes/dimensions/type at `src/inspiredesign/pinterest-pin-media-evidence.ts:896-1040`.
- `pin-media-index.json` is the compact authority surface for `design_evidence` only, including source URL, first-party media URL, page quality, path, hash, bytes, dimensions, content type, kind, warnings, and provenance at `src/inspiredesign/pinterest-pin-media-evidence.ts:1044-1072` and `src/providers/renderer.ts:60-103`.
- Trusted media reaches `media-analysis` only after workflow finalization verifies temp path, bytes, artifact path, sha256, byte count, `design_evidence`, bundle scheduling, and a temp source copy inside the workflow temp root at `src/providers/workflows.ts:3650-3868`.
- `motion-evidence.json` is separate screencast/replay authority, not media-analysis. It records replay, preview, frames, diagnostics, and authority, and becomes `design_evidence` only when captured, non-diagnostic, and positive-frame at `src/inspiredesign/motion-evidence.ts:3-63` and `src/inspiredesign/motion-evidence.ts:190-236`.
- Product readiness is based on manifest-backed screenshot, motion, and pin-media authority counts, not raw evidence or `media-analysis.json`. Final evidence authority precedence is motion, then pin media, then snapshot at `src/providers/workflows.ts:6397-6455`, `src/inspiredesign/product-readiness.ts:106-110`, `src/inspiredesign/product-readiness.ts:836-887`, and `src/inspiredesign/product-readiness.ts:1101-1179`.
- Handoff guidance explicitly says to use `pin-media-index.json` as the `pin_media_ready` gate, not unindexed pin-media evidence, video posters, or `media-analysis.json` at `src/inspiredesign/handoff.ts:156-172`.

## Investigator Findings: FFmpeg Dependency Trace
- `package.json:68-80` and `package-lock.json:12-23` contain no FFmpeg or FFprobe runtime dependency. Repo grep found no `ffmpeg-static`, `ffprobe-static`, `fluent-ffmpeg`, or `@ffmpeg` entries in package manifests.
- `package.json:66` runs `node scripts/postinstall-sync-skills.mjs`; `scripts/postinstall-sync-skills.mjs:8-37` delegates package skill/autostart installer behavior only. No postinstall FFmpeg download or install exists.
- FFprobe defaults to literal `ffprobe`, supports only injected `binaryPath` plus timeout options, and invokes `-v error -print_format json -show_streams -show_format` at `src/inspiredesign/media-analysis/ffprobe.ts:26-47`.
- FFmpeg defaults to literal `ffmpeg`, supports only injected `binaryPath` plus sizing/frame/time options, and invokes bounded raw RGB extraction at `src/inspiredesign/media-analysis/ffmpeg.ts:40-58` and `src/inspiredesign/media-analysis/ffmpeg.ts:90-106`.
- Bounds are explicit: 5 second process timeout, 8 MB output cap, 160x160 decode size, 5 sampled frames, and 24 serialized references at `src/inspiredesign/media-analysis/types.ts:2-7`; wrapper output and parsing are bounded at `src/inspiredesign/media-analysis/ffmpeg.ts:120-164` and `src/inspiredesign/media-analysis/ffprobe.ts:50-96`.
- Missing binaries degrade to limitations, not fatal workflow errors: `ENOENT` maps to `ffmpeg binary was not found.` or `ffprobe binary was not found.` at `src/inspiredesign/media-analysis/ffmpeg.ts:166-171` and `src/inspiredesign/media-analysis/ffprobe.ts:183-188`.
- Analyzer inputs are limited to `authority === "design_evidence"` and `scheduledForBundle`; GIF/video motion facts require more than one sampled frame at `src/inspiredesign/media-analysis/analyzer.ts:52-56` and `src/inspiredesign/media-analysis/analyzer.ts:162-181`.
- Tests cover FFprobe parsing/failure/timeout, FFmpeg failure/timeout/output caps, missing binary degradation without fake facts, spawn-error cleanup, and budget exhaustion at `tests/inspiredesign-media-analysis.test.ts:112-176`, `tests/inspiredesign-media-analysis.test.ts:223-267`, `tests/inspiredesign-media-analysis.test.ts:304-337`, `tests/inspiredesign-media-analysis.test.ts:852-871`, `tests/inspiredesign-media-analysis.test.ts:927-984`, and `tests/inspiredesign-media-analysis.test.ts:986-1023`.
- Pre-implementation docs and skill guidance described `media-analysis.json` capabilities and non-goals but did not mention installing FFmpeg/FFprobe, PATH requirements, env vars, or config keys at the then-current `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `src/public-surface/source.ts`, and `skills/opendevbrowser-best-practices/SKILL.md` sections.

## Investigator Findings: Motion Analysis Reality
- Current code does analyze motion in a limited way for GIF/MP4: FFmpeg extracts bounded first decoded RGB frames, and pixel analysis computes sampled deltas, cadence, posture, and frame tone summaries at `src/inspiredesign/media-analysis/ffmpeg.ts:64-88`, `src/inspiredesign/media-analysis/pixel.ts:54-70`, and `src/inspiredesign/media-analysis/analyzer.ts:134-143`.
- Images and `video_poster` media are still evidence only; motion facts are suppressed for those kinds at `src/inspiredesign/media-analysis/analyzer.ts:134-143`.
- The v1 non-goals explicitly exclude exact readable text extraction, OCR, model vision, OpenCV, Sharp, Tesseract, browser canvas analysis, and readiness authority from media analysis at `src/inspiredesign/media-analysis/types.ts:12-21`.
- Missing true motion-design insight includes scene segmentation, optical flow, object tracking, timestamp-aware event taxonomy, interaction/choreography semantics, semantic video description, OCR, and model vision.

## Validated Incoming Report Corrections
- The incoming research is substantively accurate, but some line anchors were stale. Current `readPinterestPinMediaCandidatesInPage()` starts at `src/browser/browser-manager.ts:541`; lines `669-787` cover only URL derivation and candidate construction.
- `derivePinterestMp4UrlFromHls()` is currently at `src/browser/browser-manager.ts:680-699`, not the older line anchor in the incoming report.
- `fetchPinterestPinMediaBytes()` is currently at `src/browser/browser-manager.ts:2903-2932`.
- `isLikelyMp4Bytes()` is currently at `src/browser/browser-manager.ts:347-350`.
- Analyzer motion suppression for `image` and `video_poster` is currently at `src/inspiredesign/media-analysis/analyzer.ts:134-143`; claim-level `motion_sampled` emission starts at `src/inspiredesign/media-analysis/analyzer.ts:157-177`.
- Pre-implementation baseline: code supported injected `binaryPath` only through adapter options and tests. There was no user-facing config, env resolver, CLI preflight, or docs surface for FFmpeg/FFprobe paths, so binary-path resolution was treated as proposed work before this implementation branch.

## Implementation Roadmap For Better Motion Facts

### Phase 0 - Document And Preflight Dependencies
Add user-facing FFmpeg/FFprobe prerequisite guidance before deepening analysis. The preflight should report availability, resolved path, version, source (`config`, `env`, or PATH), and capability tier. Missing binaries should remain a media-analysis limitation, not a readiness failure and not readiness proof.

Implementation sync targets if this moves beyond the investigation report:
- `docs/CLI.md` near the `media-analysis.json` section.
- `docs/SURFACE_REFERENCE.md` Inspiredesign media-analysis notes.
- `src/public-surface/source.ts`, followed by generated manifest regeneration.
- `skills/opendevbrowser-best-practices/SKILL.md` Inspiredesign guidance.
- Focused docs/help tests for prerequisite wording and degradation behavior.

### Phase 1 - Timestamp-Distributed Sampling
Replace first-N-frame-only sampling for GIF/video with bounded timestamp-distributed sampling using FFprobe duration/fps metadata. Keep the existing frame cap and decode-size cap from `src/inspiredesign/media-analysis/types.ts:2-7`. This improves coverage across a clip without changing authority surfaces or adding dependencies.

### Phase 2 - FFmpeg Scene And Representative-Frame Signals
Add a second bounded FFmpeg pass for deterministic scene-change and representative-frame signals. Useful primitives from FFmpeg include `select` scene expressions, `showinfo` metadata, `thumbnail`, `blackframe`, and the `metadata` filter. Store these as heuristic design facts only, with limitations that make thresholds and confidence explicit.

Recommended output shape:
- `sceneSegments`: bounded timestamps, scores, and optional representative frame indexes.
- `sceneChangeSummary`: count, strongest score, average score, and whether transitions look static, subtle, cut-like, or fade-like.
- `representativeFrames`: sampled frame indexes or timestamps used for tone/palette/layout summaries.

### Phase 3 - Coarse Regional Motion Deltas
Extend the existing 3x3 layout grid approach in `src/inspiredesign/media-analysis/pixel.ts` into coarse regional delta summaries between sampled frames. This should be framed as regional delta distribution, not optical flow, motion vectors, object tracking, or semantic actor movement.

Useful facts:
- highest-motion cells
- background-vs-foreground delta concentration
- peak and average regional deltas
- layout, palette, and tone shifts over time

### Phase 4 - Deterministic Motion-Design Guidance
Extend `src/inspiredesign/media-analysis/design-guidance.ts` with small, confidence-bounded design facts rather than full semantic claims.

Recommended event taxonomy:
- `static_hold`
- `fade_or_exposure_shift`
- `cut_or_scene_change`
- `subtle_loop`
- `dynamic_motion`

Recommended guidance fields:
- motion intensity
- cadence
- dominant changed regions
- suggested duration range
- reduced-motion adaptation note
- confidence and limitations

These fields should remain downstream design guidance only. They must not change `product-readiness.ts`, renderer authority, `pin-media-index.json`, or `motion-evidence.json` semantics.

### What Not To Add By Default
- Do not bundle `ffmpeg-static`, `ffprobe-static`, or installer packages in the default CLI bundle.
- Do not run FFmpeg downloads from package postinstall.
- Do not add OpenCV, PySceneDetect, Python, or vision-model analysis to the default pipeline.
- Do not call scene-score or regional-delta facts semantic understanding.
- Do not allow `media-analysis.json` to satisfy product readiness.

## Root Cause
The implementation intentionally keeps media analysis as a lean, deterministic, optional design-facts pipeline behind host FFmpeg/FFprobe binaries. That preserves package simplicity and readiness authority. This branch closes the prerequisite-visibility gap with docs, env/config/PATH resolution, and preflight capability reporting; the remaining product gap is that current frame-delta analysis is still too shallow to extract rich motion-design insights.

## Recommendations
1. Completed in this branch: document FFmpeg and FFprobe as recommended optional system prerequisites for the media-analysis pipeline.
2. Completed in this branch: add preflight/capability reporting before relying on video/GIF analysis, including found/missing state, resolved path, version, source (`config`, `env`, or PATH), and resulting capability tier.
3. Completed in this branch: add explicit binary path resolution in the media-analysis seam with env override, then config path, then PATH. Keep adapter-level injection for tests.
4. Do not add static FFmpeg/FFprobe npm packages to the default CLI bundle now. The current architecture is lean, postinstall is intentionally narrow, and default bundling adds size, platform, license, install, and maintenance risk.
5. If first-run convenience later becomes mandatory, use an opt-in managed cache lane rather than package postinstall: config/env path, then PATH, then optional cached download with visible version/preflight evidence.
6. Preserve authority boundaries: `pin-media-index.json` remains pin-media readiness authority, `motion-evidence.json` remains screencast motion authority, and `media-analysis.json` remains non-authoritative design facts.
7. For the smallest motion-analysis improvement, extend the existing `src/inspiredesign/media-analysis` seam with timestamp-aware sampling, FFmpeg scene-score/keyframe sampling, peak/average frame deltas, palette/tone/layout shifts over time, and a small event taxonomy such as `static_hold`, `fade_or_exposure_shift`, `cut_or_scene_change`, `subtle_loop`, and `dynamic_motion`.
8. Keep optical flow and OpenCV-style analysis as a future opt-in advanced adapter, not a default dependency.
9. Treat PySceneDetect as an algorithmic reference only; reimplement any needed scene concepts deterministically in TypeScript or through bounded FFmpeg metadata, not as a Python dependency.

## Preventive Measures
- Add docs/help/skill sync whenever dependency expectations for artifact generation change.
- Keep preflight diagnostics separate from readiness authority, so missing binaries cannot mark a run ready or fail a pin-media-ready run by themselves.
- Add tests for any new binary resolver path, missing configured binary, version parse failure, and degraded capability messages.
- Add regression tests for any new motion fact so `media-analysis.json` cannot invent scene, timing, or motion claims when FFmpeg frames are missing.
- Inspect real artifact bundles before making artifact-specific claims about `motion-evidence.json`, `pin-media-index.json`, `pin-media-evidence.json`, `media-analysis.json`, or saved media files.
