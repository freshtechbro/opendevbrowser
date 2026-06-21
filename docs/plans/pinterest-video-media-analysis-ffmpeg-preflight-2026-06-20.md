# Pinterest Video Media Analysis FFmpeg Preflight: Plan

## Goal

Make FFmpeg and FFprobe expectations explicit for Inspiredesign media analysis without bloating the OpenDevBrowser package or changing product-readiness authority. The first implementation should add documented prerequisites, binary-path resolution, and capability preflight so users understand why video/GIF media-analysis output is weaker when host binaries are missing.

Success means new users see clear install and diagnostic guidance, configured or environment-provided binaries can be used deterministically, missing binaries remain non-fatal limitations, and `pin-media-index.json`, `motion-evidence.json`, and `media-analysis.json` keep their current authority separation.

## Scope And Non-goals

- Scope includes FFmpeg/FFprobe prerequisite docs, explicit binary resolver, preflight/capability output, analyzer wiring, public-surface and skill sync, tests, and a follow-on plan lane for richer deterministic motion facts.
- Do not add `ffmpeg-static`, `ffprobe-static`, `@ffmpeg-installer/*`, postinstall binary downloads, OpenCV, PySceneDetect, Python, OCR, Sharp, Tesseract, or model vision in the default path.
- Do not make missing FFmpeg or FFprobe fail Inspiredesign product readiness. Missing binaries should degrade `media-analysis.json`, not `pin-media-index.json` or `motion-evidence.json`.
- Do not let `media-analysis.json` satisfy product readiness, evidence authority, or pin-media readiness.
- Do not rework Pinterest capture in this plan. Browser capture already persists first-party MP4, GIF, poster, and image bytes when provenance checks pass.

## Background

- The validated investigation is `docs/investigations/pinterest-video-media-analysis-dependencies-2026-06-20.md`. It concludes the smallest safe next step is docs, preflight, and explicit binary-path resolution, not default static binary bundling.
- Pinterest media capture already gathers image, video, and video-poster candidates, derives first-party Pinterest MP4 URLs from HLS where possible, validates first-party hosts and bytes, and persists evidence before indexing design authority. Key seams are `src/browser/browser-manager.ts:541-570`, `src/browser/browser-manager.ts:669-787`, `src/browser/browser-manager.ts:2780-2965`, and `src/inspiredesign/pinterest-pin-media-evidence.ts:896-1072`.
- Trusted media reaches media analysis only after workflow finalization verifies persisted `design_evidence`, scheduled bundle files, bytes, hashes, and temp-root containment. The input seam is `src/providers/workflows.ts:3825-3868`, and the analyzer call is `src/providers/workflows.ts:6355-6365`.
- FFprobe currently defaults to literal `ffprobe`, reads JSON streams and format metadata, and returns limitations for timeouts, failures, and missing binaries at `src/inspiredesign/media-analysis/ffprobe.ts:26-47` and `src/inspiredesign/media-analysis/ffprobe.ts:183-188`.
- FFmpeg currently defaults to literal `ffmpeg`, extracts bounded scaled raw RGB frames, and returns limitations for timeouts, failures, and missing binaries at `src/inspiredesign/media-analysis/ffmpeg.ts:40-58`, `src/inspiredesign/media-analysis/ffmpeg.ts:88-104`, and `src/inspiredesign/media-analysis/ffmpeg.ts:166-171`.
- Existing hard bounds are 5 seconds per process, 8 MB process output, 160x160 decoded frames, 5 sampled frames, and 24 serialized references at `src/inspiredesign/media-analysis/types.ts:1-21`.
- Current motion facts are sampled frame count, frame indexes, adjacent frame deltas, average delta, cadence, posture, and frame tone summaries at `src/inspiredesign/media-analysis/types.ts:133-141` and `src/inspiredesign/media-analysis/pixel.ts:54-70`.
- Images and `video_poster` inputs do not produce motion facts. GIF and MP4 video inputs can produce sampled motion facts only when more than one decoded frame exists at `src/inspiredesign/media-analysis/analyzer.ts:134-177`.
- `status-capabilities` already reports host capability discovery and is the best preflight surface to extend. Current host shape lives at `src/automation/coordinator.ts:76-101`, and host output is built at `src/automation/coordinator.ts:401-428`.
- Public docs and skill guidance mention deterministic `media-analysis.json` and its non-authority semantics, but not FFmpeg/FFprobe installation, PATH, env, config, or preflight guidance. Current docs are `docs/CLI.md:597-612`, `docs/SURFACE_REFERENCE.md:560-568`, `src/public-surface/source.ts:839-847`, and `skills/opendevbrowser-best-practices/SKILL.md:159-165`.

## Approach

Implement the dependency experience before deepening motion analysis. The first implementation branch is Tasks 1 to 6: config/env contract, resolver, `status-capabilities` preflight, analyzer wiring, docs/help/skill sync, and regression tests. Task 7 is a separate follow-on lane for richer motion facts and should not block the preflight branch.

Recommended resolution precedence is environment override, config value, then PATH. Environment variables are best for CI and one-off validation, config is the durable operator default, and PATH preserves current behavior. Use names that are explicit and grep-friendly, for example `OPENDEVBROWSER_FFMPEG_PATH` and `OPENDEVBROWSER_FFPROBE_PATH`, plus config keys under `inspiredesign.mediaAnalysis`.

Explicit env/config paths are intentional overrides. If an explicit override is missing, non-executable, times out, or returns invalid version output, report that source as unavailable and do not silently fall back to PATH. Missing PATH defaults remain non-fatal limitations. `status-capabilities` may include resolved local paths for diagnostics, but artifact outputs should keep media-analysis limitations instead of host path claims unless a later privacy review chooses otherwise.

Richer motion facts should be a second lane after preflight is visible. Extend the current `src/inspiredesign/media-analysis` seam with timestamp-aware sampling, bounded FFmpeg scene or representative-frame signals, coarse regional deltas, and confidence-bounded design guidance. Keep those facts deterministic and non-authoritative.

## Work Items

## Task 1 - Add Config And Environment Contract

Reasoning: Users need a stable way to point OpenDevBrowser at installed FFmpeg/FFprobe binaries without modifying PATH, especially in CI, managed shells, and app launch contexts.

What to do: Add optional config keys and documented env vars for FFmpeg/FFprobe paths.

How:
1. Add a narrow top-level config block to `src/config.ts`: `inspiredesign.mediaAnalysis.ffmpegPath` and `inspiredesign.mediaAnalysis.ffprobePath`.
2. Keep paths optional. Default config should preserve current PATH behavior.
3. Add config types and schema defaults near the other top-level config groups, and add commented examples in `buildDefaultConfigJsonc()` only if that file normally documents optional paths there.
4. Reserve env vars in the resolver contract: `OPENDEVBROWSER_FFMPEG_PATH` and `OPENDEVBROWSER_FFPROBE_PATH`.
5. Validate configured paths enough to reject non-string and blank values.
6. Let the resolver report missing or non-executable configured paths as capability limitations, not config-load failures, because media analysis is optional.
7. Add config tests for defaults, valid paths, blank paths, env precedence, and explicit bad paths.

Files impacted:
- `src/config.ts`
- `tests/config.test.ts`
- `src/inspiredesign/media-analysis/types.ts`

End goal: Binary-path configuration is explicit before runtime or docs surfaces rely on it.

Acceptance criteria:
- [ ] Omitted config keeps current PATH defaults.
- [ ] Env names and config keys are documented in source constants or exported types.
- [ ] Config values are used when env values are absent.
- [ ] Blank or wrong-type config values are rejected consistently with existing config policy.
- [ ] Explicit bad paths are allowed through config load and diagnosed by capability preflight.

Dependencies: None.

Size: Medium.

## Task 2 - Add A Media-analysis Binary Resolver

Reasoning: Current adapters accept `binaryPath` for tests but users cannot configure or diagnose FFmpeg/FFprobe paths. A resolver gives implementation, preflight, docs, and tests one shared contract.

What to do: Add a small resolver module for FFmpeg and FFprobe availability, path source, version, and limitation state.

How:
1. Create `src/inspiredesign/media-analysis/binaries.ts`.
2. Define typed results for each tool: `tool`, `available`, `source`, `requestedPath`, `resolvedPath`, `version`, `limitation`, and `capabilityTier`.
3. Support sources in this order: env override, config path, PATH default.
4. Use bounded `child_process.spawn` version probes with short timeouts and output limits. Do not shell out through `sh -c`.
5. Treat missing PATH binaries as unavailable limitations, not thrown errors.
6. Treat missing configured or env paths as unavailable with explicit source and path context. Do not silently fall back from an explicit bad path.
7. Parse a stable version summary from the first version line while keeping raw output bounded.
8. Export the resolver through `src/inspiredesign/media-analysis/index.ts`.
9. Keep adapter-level `binaryPath` options in `ffmpeg.ts` and `ffprobe.ts` for hermetic tests.

Files impacted:
- New file: `src/inspiredesign/media-analysis/binaries.ts`
- `src/inspiredesign/media-analysis/index.ts`
- `src/inspiredesign/media-analysis/types.ts`
- `tests/inspiredesign-media-analysis.test.ts`

End goal: Media analysis has a production-safe, testable way to determine whether FFmpeg and FFprobe are usable before analysis runs.

Acceptance criteria:
- [ ] Resolver reports available FFmpeg and FFprobe when fake executable fixtures return valid version output.
- [ ] Env values override config values.
- [ ] Resolver reports missing PATH binaries as limitations without throwing.
- [ ] Resolver reports explicit env/config path failures without pretending PATH succeeded.
- [ ] Version probing has timeout and output bounds.
- [ ] Tests do not depend on host FFmpeg or FFprobe availability.
- [ ] No static binary package dependency is added.

Dependencies: Task 1.

Size: Medium.

## Task 3 - Surface Media-analysis Capability In Preflight

Reasoning: Missing binaries currently appear only as artifact limitations. Users need to know before a run why media-analysis output may be metadata-only or frame-empty.

What to do: Add FFmpeg/FFprobe capability status to the existing runtime capability discovery surface.

How:
1. Extend `RuntimeCapabilityDiscovery["host"]` in `src/automation/coordinator.ts` with a `mediaAnalysis` block.
2. Include FFmpeg and FFprobe tool states, capability tier, and a concise limitation summary.
3. Propagate config into the automation coordinator path. `createAutomationCoordinator()` currently receives challenge, desktop, helper, and snapshot settings but not config, so update `src/core/runtime-assemblies.ts:44-51` and the coordinator args type before adding host media-analysis output.
4. Use the resolver from Task 2, with a tight timeout suitable for `status-capabilities`.
5. Keep `status --daemon` focused on daemon freshness. Do not add media-analysis details to daemon status in this branch.
6. Preserve session-scoped behavior for challenge plans. Media-analysis capability should be host-level and available without a browser session.
7. Ensure daemon and CLI routing still go through `core.automationCoordinator.statusCapabilities`, as currently shown at `src/cli/daemon-commands.ts:1295-1303`.
8. Update CLI and tool tests that forward or assert `status-capabilities` output.

Files impacted:
- `src/automation/coordinator.ts`
- `src/core/runtime-assemblies.ts`
- `src/cli/commands/status-capabilities.ts`
- `src/tools/status_capabilities.ts`
- `tests/cli-review-surfaces.test.ts`
- `tests/operator-tools.test.ts`
- `tests/inspiredesign-media-analysis.test.ts`

End goal: `npx opendevbrowser status-capabilities --output-format json` can show whether media-analysis can decode/probe saved media on this host.

Acceptance criteria:
- [ ] Host capability output includes media-analysis state without requiring `--session-id`.
- [ ] Missing FFmpeg and FFprobe are visible as capability limitations.
- [ ] Available fake binaries report versions and sources in tests.
- [ ] Preflight failure does not mark product readiness failed or ready.
- [ ] Existing desktop, replay, browser-scoped computer-use, and first-class surface capability output remains intact.

Dependencies: Tasks 1 and 2.

Size: Medium.

## Task 4 - Wire Resolved Binaries Into The Analyzer

Reasoning: Preflight is only useful if the workflow uses the same binary-resolution contract during actual media analysis.

What to do: Pass resolved FFmpeg and FFprobe paths into `analyzeInspiredesignMediaArtifacts` through the existing analyzer seam.

How:
1. Extend `InspiredesignMediaAnalyzerOptions` in `src/inspiredesign/media-analysis/analyzer.ts` with resolved binary options or resolver-backed runners.
2. Keep existing `ffprobe` and `ffmpeg` runner injection for tests.
3. In `src/providers/workflows.ts`, resolve binaries before calling `analyzeInspiredesignMediaArtifacts`.
4. Do not reuse stale `status-capabilities` results during a workflow. Resolve at workflow runtime so env/config changes and process PATH are current.
5. Do not add a second version probe on every analyzed reference. Resolve once per workflow run, then pass binary paths or resolver-backed runners into the analyzer.
6. Preserve `remainingTimeoutMs()` behavior when probing and decoding.
7. Preserve temp-root containment and cleanup in `buildTrustedInspiredesignMediaAnalysisInputs()` and `cleanupPinMediaAnalysisTempDirs()`.
8. Include resolver limitations in `media-analysis.json` only as design-fact limitations or diagnostics. Do not promote them into readiness authority.

Files impacted:
- `src/inspiredesign/media-analysis/analyzer.ts`
- `src/inspiredesign/media-analysis/ffmpeg.ts`
- `src/inspiredesign/media-analysis/ffprobe.ts`
- `src/providers/workflows.ts`
- `tests/inspiredesign-media-analysis.test.ts`
- `tests/providers-inspiredesign-workflow.test.ts`

End goal: Configured or env-provided binaries are used by real Inspiredesign media analysis while current missing-binary degradation remains safe.

Acceptance criteria:
- [ ] Workflow tests prove configured or env fake binaries are passed to the analyzer path.
- [ ] Missing binaries still produce limitations such as `ffmpeg binary was not found.` and `ffprobe binary was not found.`
- [ ] Missing binaries do not create fake tone, palette, typography, or motion facts.
- [ ] Trusted-input gates remain `authority === "design_evidence"` and `scheduledForBundle`.
- [ ] `media-analysis.json` remains non-authoritative.

Dependencies: Tasks 1 to 3.

Size: Medium.

## Task 5 - Sync Docs, Public Surface, And Skill Guidance

Reasoning: The main user-facing bug is not just missing capability, but lack of guidance. Docs must teach that FFmpeg/FFprobe improve media-analysis quality while remaining optional host tools.

What to do: Update public docs, generated help metadata, troubleshooting, and best-practices skill guidance after source support exists.

How:
1. Update `docs/CLI.md` near the Inspiredesign `media-analysis.json` section to document recommended FFmpeg and FFprobe installation, PATH behavior, env/config overrides, and degraded output semantics.
2. Update `docs/CLI.md` status-capabilities section to show where media-analysis capability appears.
3. Update `docs/SURFACE_REFERENCE.md` Inspiredesign and status-capabilities notes.
4. Update `src/public-surface/source.ts` for status-capabilities and Inspiredesign notes, then regenerate generated manifests with `node scripts/generate-public-surface-manifest.mjs`.
5. Update `skills/opendevbrowser-best-practices/SKILL.md` to recommend checking `status-capabilities` and installing FFmpeg/FFprobe for richer media-analysis facts.
6. Update `docs/DEPENDENCIES.md` to list FFmpeg and FFprobe as optional host tools, not npm dependencies.
7. Update `docs/TROUBLESHOOTING.md` with missing-binary symptoms and remediation if that file exists in this checkout.
8. Do not document static package bundling, postinstall downloads, OpenCV, or vision-model dependencies as default options.

Files impacted:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `skills/opendevbrowser-best-practices/SKILL.md`
- `docs/DEPENDENCIES.md`
- `docs/TROUBLESHOOTING.md`

End goal: Users and agents can discover the dependency requirements before running Pinterest/video Inspiredesign work.

Acceptance criteria:
- [ ] Docs say FFmpeg and FFprobe are recommended optional host prerequisites for richer media-analysis output.
- [ ] Docs explain missing binaries degrade `media-analysis.json` instead of failing pin-media readiness.
- [ ] Docs explain env/config/PATH resolution in the same order implemented by source.
- [ ] Public-surface generated manifests are regenerated from `src/public-surface/source.ts`.
- [ ] Skill guidance remains aligned with docs and does not imply media-analysis authority.

Dependencies: Tasks 1 to 4.

Size: Medium.

## Task 6 - Add Docs And Public-surface Regression Tests

Reasoning: This repo relies on docs, generated help, and bundled skills as user-facing contract surfaces. Dependency wording will drift unless tested.

What to do: Add focused tests that lock prerequisite wording, generated metadata sync, and missing-binary degradation semantics.

How:
1. Extend `tests/public-surface-manifest.test.ts` to assert Inspiredesign and status-capabilities notes include media-analysis prerequisite and non-authority wording.
2. Extend `tests/cli-help-parity.test.ts` to ensure generated help renders the status-capabilities and Inspiredesign prerequisite notes when those notes become public help.
3. Add a focused docs guidance test, following `tests/workflow-output-guidance.test.ts` style, to verify `docs/CLI.md`, `docs/DEPENDENCIES.md`, `docs/TROUBLESHOOTING.md`, and `skills/opendevbrowser-best-practices/SKILL.md` mention FFmpeg/FFprobe and do not mention default static binary bundling.
4. Keep tests scoped to relevant sections so unrelated historical docs do not produce false positives.
5. Add negative assertions that prevent docs from claiming media-analysis can satisfy product readiness.

Files impacted:
- `tests/public-surface-manifest.test.ts`
- `tests/cli-help-parity.test.ts`
- New file: `tests/media-analysis-dependency-guidance.test.ts`

End goal: Future docs/help/skill changes cannot hide prerequisite guidance or blur authority boundaries.

Acceptance criteria:
- [ ] Tests fail if generated public surface omits media-analysis prerequisite guidance.
- [ ] Tests fail if docs or skills claim default static FFmpeg bundling.
- [ ] Tests fail if docs or skills claim `media-analysis.json` satisfies readiness.
- [ ] Tests preserve existing workflow output guidance checks and evidence-lane exceptions.

Dependencies: Task 5.

Size: Medium.

## Task 7 - Future Lane: Improve Sampling And Motion Facts

Reasoning: Current MP4/GIF motion analysis is real but shallow. It decodes bounded first frames and computes scalar frame deltas, which is insufficient for motion-design insight but should not be fixed before dependency visibility lands.

What to do: After Tasks 1 to 6 ship and prove useful, extend the existing media-analysis seam with richer deterministic motion facts and no new default dependencies. This task is not part of the first preflight branch.

How:
1. Change GIF/video frame extraction to timestamp-distributed sampling using FFprobe duration/fps metadata while preserving the 5-frame cap, 160x160 decode cap, process timeout, and output cap.
2. Consider one bounded FFmpeg metadata pass for scene-change or representative-frame signals using official FFmpeg filters such as `select`, `showinfo`, `thumbnail`, `blackframe`, or `metadata`.
3. Store scene and representative-frame facts as heuristic facts with thresholds, timestamps, confidence, and limitations. Do not call them semantic understanding.
4. Extend `pixel.ts` with coarse 3x3 regional frame deltas, reusing the existing grid concepts at `src/inspiredesign/media-analysis/pixel.ts:28-35` and `src/inspiredesign/media-analysis/pixel.ts:118-157`.
5. Extend `types.ts` with versioned motion facts such as peak delta, average delta, dominant changed regions, scene-change summary, and representative frame timestamps.
6. Extend `design-guidance.ts` with a small event taxonomy: `static_hold`, `fade_or_exposure_shift`, `cut_or_scene_change`, `subtle_loop`, and `dynamic_motion`.
7. Add reduced-motion guidance and confidence/limitation text for every new motion-design fact.
8. Keep OpenCV optical flow, object tracking, OCR, and model vision as future opt-in advanced adapters only.

Files impacted:
- `src/inspiredesign/media-analysis/types.ts`
- `src/inspiredesign/media-analysis/ffmpeg.ts`
- `src/inspiredesign/media-analysis/analyzer.ts`
- `src/inspiredesign/media-analysis/pixel.ts`
- `src/inspiredesign/media-analysis/design-guidance.ts`
- `src/inspiredesign/reference-pattern-board.ts` if summary fields need mapping
- `tests/inspiredesign-media-analysis.test.ts`
- `tests/zz-inspiredesign-media-analysis-coverage.test.ts` if branch coverage needs focused additions
- `tests/providers-inspiredesign-workflow.test.ts` for workflow-level authority preservation

End goal: `media-analysis.json` can express deterministic motion-design facts that are useful to designers without becoming semantic video understanding or readiness authority.

Acceptance criteria:
- [ ] GIF/video sampling is distributed across duration when metadata supports it.
- [ ] Image and `video_poster` inputs still decode one frame and produce no real motion facts.
- [ ] New scene/regional facts are absent when frames or FFmpeg metadata are unavailable.
- [ ] New guidance includes limitations and reduced-motion adaptation.
- [ ] No new default dependency is added.
- [ ] Product readiness and final evidence authority behavior are unchanged.

Dependencies: Tasks 1 to 6 and explicit approval to include motion-fact enrichment in a separate implementation branch.

Size: Large.

## Task 8 - Validate Focused Behavior And Full Gates

Reasoning: This work spans config, child-process adapters, workflow analysis, status capabilities, docs, generated metadata, skills, and tests.

What to do: Run focused validation first, then full repository gates.

How:
1. Run media-analysis tests:
   ```bash
   npm run test -- tests/inspiredesign-media-analysis.test.ts
   ```
2. Run Inspiredesign workflow tests that cover media-analysis and pin-media authority:
   ```bash
   npm run test -- tests/providers-inspiredesign-workflow.test.ts -t "media analysis|pin media|Pinterest"
   ```
3. Run status-capabilities tests:
   ```bash
   npm run test -- tests/cli-review-surfaces.test.ts tests/operator-tools.test.ts
   ```
4. Run config, public surface, and docs guidance tests:
   ```bash
   npm run test -- tests/config.test.ts tests/public-surface-manifest.test.ts tests/cli-help-parity.test.ts tests/media-analysis-dependency-guidance.test.ts
   ```
5. Regenerate public surface after source changes:
   ```bash
   node scripts/generate-public-surface-manifest.mjs
   ```
6. Run docs drift:
   ```bash
   node scripts/docs-drift-check.mjs
   ```
7. Run targeted lint for changed TypeScript files through the repo package tool wrapper.
8. Run standard gates:
   ```bash
   npm run lint
   npm run typecheck
   npm run build
   npm run test
   ```

Files impacted:
- No additional source files beyond earlier tasks.
- Generated public-surface files must be expected outputs from Task 5.

End goal: The implementation is commit-ready with no hidden dependency on host FFmpeg/FFprobe in CI.

Acceptance criteria:
- [ ] Focused media-analysis, workflow, status-capabilities, public-surface, and docs tests pass.
- [ ] Generated manifests match source.
- [ ] Docs drift check passes.
- [ ] Standard lint, typecheck, build, and full test gates pass.
- [ ] Coverage remains at or above the repository threshold.
- [ ] No warnings, suppressions, fake facts, or host-binary-dependent tests are introduced.

Dependencies: Tasks 1 to 6 for the first branch. Add Task 7 tests only in the later motion-facts branch.

Size: Medium.

## Open Questions

- Should opt-in managed binary download be planned later? Recommended: defer to a separate future plan only if first-run friction remains unacceptable after docs, config/env/PATH resolution, and preflight ship.
- Should Task 7 be promoted into the same implementation project after Tasks 1 to 6 land? Recommended: no, ship dependency visibility first, then measure whether richer motion facts need a separate branch.

## References

- `docs/investigations/pinterest-video-media-analysis-dependencies-2026-06-20.md`
- `src/browser/browser-manager.ts:541-570`
- `src/browser/browser-manager.ts:669-787`
- `src/browser/browser-manager.ts:2780-2965`
- `src/inspiredesign/pinterest-pin-media-evidence.ts:896-1072`
- `src/providers/workflows.ts:3825-3868`
- `src/providers/workflows.ts:6355-6365`
- `src/inspiredesign/media-analysis/types.ts:1-21`
- `src/inspiredesign/media-analysis/types.ts:133-141`
- `src/inspiredesign/media-analysis/analyzer.ts:21-26`
- `src/inspiredesign/media-analysis/analyzer.ts:134-177`
- `src/inspiredesign/media-analysis/ffprobe.ts:26-47`
- `src/inspiredesign/media-analysis/ffprobe.ts:183-188`
- `src/inspiredesign/media-analysis/ffmpeg.ts:40-58`
- `src/inspiredesign/media-analysis/ffmpeg.ts:88-104`
- `src/inspiredesign/media-analysis/ffmpeg.ts:166-171`
- `src/inspiredesign/media-analysis/pixel.ts:54-70`
- `src/inspiredesign/media-analysis/design-guidance.ts:163-170`
- `src/automation/coordinator.ts:76-101`
- `src/automation/coordinator.ts:401-428`
- `src/core/runtime-assemblies.ts:44-51`
- `src/cli/daemon-commands.ts:1295-1303`
- `src/config.ts:265-294`
- `src/config.ts:626-640`
- `docs/CLI.md:597-612`
- `docs/CLI.md:811-820`
- `docs/SURFACE_REFERENCE.md:560-568`
- `src/public-surface/source.ts:238-242`
- `src/public-surface/source.ts:839-847`
- `src/public-surface/source.ts:911-916`
- `skills/opendevbrowser-best-practices/SKILL.md:159-165`
- FFprobe documentation: https://ffmpeg.org/ffprobe.html
- FFmpeg CLI documentation: https://ffmpeg.org/ffmpeg.html
- FFmpeg filters documentation: https://ffmpeg.org/ffmpeg-filters.html
- OpenCV optical flow tutorial, future opt-in reference only: https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html
- PySceneDetect detectors, algorithmic reference only: https://www.scenedetect.com/docs/latest/api/detectors.html
