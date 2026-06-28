# Investigation: Inspiredesign Output Specificity, Motion Evidence, and Handoff Quality

## Summary
Investigation complete. The core evidence collection path was working: Pinterest harvest could persist first-party pin media, run media analysis, and reach product-ready authority. The breakage was downstream synthesis quality and propagation. Several generated artifacts diluted real Pinterest/media facts into generic creative-tool defaults, emitted one flat color-token map, and omitted media-analysis provenance from the meta prompt and handoff surfaces. The patch keeps readiness authority unchanged while making the design-facing outputs carry specific media provenance, dual light/dark token maps, and Canvas-safe reference-derived token cues.

## Symptoms
- Latest workflow bundles include the expected output files, but the user suspects sections may be generic instead of grounded in Pinterest/web inspiration.
- `motion-evidence.json` is often empty even when pin media includes a video.
- Current token strategy appears to expose one theme rather than separate dark and light mode token sets.
- Design contract and design-agent handoff may not carry enough run-specific implementation guidance.

## Background / Prior Research
- Prior product-ready bundle to inspect first: `.opendevbrowser/inspiredesign/2f2e7736-23e3-438f-a14b-c9b051b3a319`.
- Prior live harvest JSON: `.tmp/pinterest-search-shell-live-20260627T1335Z/harvest.json`.
- Fresh post-fix proof bundle: `.opendevbrowser/inspiredesign/1d879b58-6ea7-46cf-9c18-7fb818e6e8d2`.
- Fresh post-fix CLI JSON: `.tmp/inspiredesign-output-specificity-live-20260627T151726Z/harvest-output.json`.
- Verified architecture: Pinterest video capture and media analysis can persist first-party MP4 bytes and sampled motion facts while `motion-evidence.json` remains empty because that file is screencast authority, not video-content analysis.

## Pre-Fix Investigator Findings: Artifact Specificity

### Scope And Inputs

Audited bundle `.opendevbrowser/inspiredesign/2f2e7736-23e3-438f-a14b-c9b051b3a319` against returned harvest JSON `.tmp/pinterest-search-shell-live-20260627T1335Z/harvest.json` and all bundle artifacts listed in `bundle-manifest.json`. No source files were edited.

Harvest result consistency:
- `.tmp/pinterest-search-shell-live-20260627T1335Z/harvest.json` reports `data.ready=true`, `data.readiness="ready"`, `data.artifactAuthority="product_ready"`, `data.evidenceAuthority="pin_media_ready"`, `data.rankedReferenceCount=4`, `data.pinMediaReadyReferenceCount=4`, `data.motionReadyReferenceCount=0`, and `data.snapshotReadyReferenceCount=0`.
- `bundle-manifest.json` lists 22 files, including four saved pin-media files under `pin-media-evidence/`.

### Evidence Surfaces Are Mostly Run-Specific

- `pin-media-index.json` is the strongest authority surface. It contains four persisted first-party Pinterest artifacts: `pin-media-evidence/43ad51b68a34/video.mp4`, `pin-media-evidence/3766345473b8/main.jpg`, `pin-media-evidence/788f2cbbf84f/main.jpg`, and `pin-media-evidence/5cb3ef2aa99a/main.jpg`. Fields checked: `referenceId`, `url`, `path`, `sha256`, `bytes`, `width`, `height`, `contentType`, `kind`, `authority`, and `firstPartyProvenance`.
- The saved media files are present and match the index at a file-signature level. The MP4 is 1280x960, 16.6 seconds, 60 fps, 996 frames, and 5,320,411 bytes. The JPGs are 736x1335, 680x484, and 736x1308.
- `media-analysis.json` is specific to those saved artifacts. Example fields: `references[0].facts.metadata.durationSeconds=16.6`, `references[0].facts.motion.posture="subtle_motion"`, `references[1].facts.tone.darkCoverage=0.6694`, `references[2].facts.tone.darkCoverage=0.8735`, and palette facts such as `#202020` coverage. Its `nonGoals` correctly says exact text extraction and readiness authority are out of scope.
- `ranked-references.json` is evidence-backed and specific. It has four ranked refs, one rejected ref, `qualitySummary.topReferenceScore=82`, `topReferenceIntentMatched=true`, and rejected reference `6bcf08f7c12f` with diagnostic reasons `interface_chrome_shell` and `search_shell_without_media_signals`.
- `visual-evidence.json` is not a positive visual authority surface. All four entries have `visual.status="failed"` with short failure quote `Required visual evidence was not captured.`
- `screenshot-index.json` has `screenshots=[]` and `motion-evidence.json` has `motionEvidence=[]`. Any generated claim that implies screenshot or screencast proof is not supported by these two files.

### Generated Artifacts With Good Run-Specific Grounding

- `advanced-brief.md:4-18` grounds the opening synthesis in ranked references and media facts: per-reference layout percentages, dark coverage, palette values, OCR-free typography structure, and video-derived `subtle_motion`.
- `design.md:12-58` carries concrete per-reference observations: saved media paths, layout recipes, token notes, typography limitations, and the one video motion observation.
- `meta-prompt.md:13-52` is the most complete human-readable evidence bridge. It includes URL, score, confidence, selection reason, borrow, reject, visual strengths, and visual risks for each ranked reference.
- `meta-prompt.md:103-110` adds useful validation gates, including the requirement to read evidence files and cite `media-analysis.json` plus saved media paths for media-derived claims.
- `generation-plan.json` is substantially more specific than the Canvas request. Fields `targetOutcome.summary`, `contentStrategy.source`, `componentStrategy.mode`, `interactionMoments`, and `materialEffects` preserve the photography brief, ranked reference names, media-analysis facts, and token notes.

### Generic Or Off-Brief Leakage

1. `advanced-brief.md` is mixed. Lines `31-47` inject prompt-format defaults instead of run-specific photography-studio context. Short examples: `creative software`, `builder platforms`, `AI-assisted creation products`, `canvas`, `editor`, `generate`, and `workspace`. Lines `55-65` continue the drift with `lab-white shell`, `inspector rails`, and `bright lab whites`. Lines `67-77` add app-shell rules such as `Collapse the inspector` and `prompt input`, which are not supported by the photography studio brief or the harvested Pinterest references.

2. `design.md` starts specific but degrades after the inspiration section. Lines `64-67` are tautological reference rules, for example `Source 3 Pin on Catalog: Pin on Catalog`. Lines `117-125` reuse creative-tool defaults, including `lab-white shell` and `layered canvas previews`. Lines `127-138` use stock bright tokens such as `#0B6BFF`, `#F97316`, `#F5F7FB`, and `#FFFFFF`, which conflict with evidence dominated by dark palettes such as `#202020` at 61 to 86 percent coverage in media facts. Lines `176-225` define generic Hero, Buttons, Cards, Feature sections, and Footer primitives with repeated `Establish the ... pattern` wording rather than photography, booking, gallery, or portfolio-specific implementation rules.

3. `implementation-plan.md` and `implementation-plan.json` repeat the same generic plan. `implementation-plan.md:6-17` and `implementation-plan.json.tokenStrategy.colors` use the same stock bright token set. `implementation-plan.md:33-38` and `implementation-plan.json.componentBuildPlan` contain generic primitives only. `implementation-plan.md:83-88` and `implementation-plan.json.responsiveChecklist` include off-brief app-shell instructions: `Collapse the inspector` and `prompt input`. The plan does include some evidence-derived motion and token notes at `implementation-plan.md:50-67`, but they are mixed with creative-tool motion grammar.

4. `design-contract.json` has correct top-level intent but substantial generic leakage. `intent.task` and `intent.brief` preserve the photography brief, but `intent.businessFocus` contains `creative software`, `builder platforms`, `design tooling`, and `AI-assisted creation products`. `intent.keywords` includes `canvas`, `editor`, `prototype`, `generate`, `workspace`, and `toolkit`. `colorSystem.paletteName="creative-tool-laboratory-default"` and `generationPlan.visualDirection.themeStrategy="single-theme"` are not grounded in the harvested evidence.

5. `design-contract.json.generationPlan` is a major specificity regression relative to `generation-plan.json`. The standalone `generation-plan.json` carries run-specific summaries and material effects, but `design-contract.json.generationPlan` replaces many nested values with the repeated generic sentence `Use reference-derived visual direction...`. Fields observed with this repeated value include `targetOutcome.summary`, `contentStrategy.source`, `componentStrategy.mode`, all six `interactionMoments[]`, all six `materialEffects[]`, `designVectors.directionLabel`, and many `designVectors` array entries.

6. `canvas-plan.request.json.generationPlan` has the same issue as `design-contract.json.generationPlan`. It repeats the generic sentence in 59 string fields, including `targetOutcome.summary`, `contentStrategy.source`, `componentStrategy.mode`, `interactionMoments[]`, `materialEffects[]`, and many `designVectors` entries. This makes the Canvas handoff less specific than the standalone `generation-plan.json` even though the bundle contains better evidence.

7. `design-agent-handoff.json` is operationally useful but not fully content-specific. Good fields: `artifactAuthority="product_ready"`, `evidenceAuthority="pin_media_ready"`, `productSuccess=true`, `artifactGuide`, and `nextStepGuidance`. Generic fields: `briefExpansion.format.id="creative-tool-laboratory"`, `briefExpansion.format.bestFor[]`, `briefExpansion.format.businessFocus[]`, `briefExpansion.format.surfaceTreatment`, `briefExpansion.format.shapeLanguage`, and `briefExpansion.format.responsiveCollapseRules[]`. `implementationContext.referencePatternBoard.references[].surfaceType="specimen-grade creative workspace"` is also off-brief for a photography studio landing page.

8. `design-agent-handoff.json.nextStepGuidance` has a readiness inconsistency. It marks `readiness="ready"`, but `artifactInputs` still lists `screenshot-index.json` as required, and `doNotProceedIf[]` contains `screenshot paths are missing when visual evidence was required`. In this bundle, `screenshot-index.json` is empty and `visual-evidence.json` failed for all four visual entries, while readiness is granted through `pin-media-index.json`.

9. `evidence.json` faithfully aggregates both the good evidence and the generic leakage. Good fields include `pinMediaIndex`, `rankedReferences`, `mediaAnalysis`, `artifactAuthority="product_ready"`, and `evidenceAuthority="pin_media_ready"`. Generic leakage is preserved in `advancedBrief`, `briefExpansion.format`, `referencePatternBoard.references[].surfaceType`, and motion/component fields such as `stage shell, inspector, prompt panels`.

### Artifact-By-Artifact Specificity Verdict

- `advanced-brief.md`: mixed. Evidence-specific opening, then large creative-tool default block.
- `design.md`: mixed to weak. Reference analysis is specific; design governance, tokens, components, responsiveness, and duplicated implementation plan are generic.
- `implementation-plan.md` and `implementation-plan.json`: weak. Some evidence-derived notes exist, but the build plan, tokens, components, and responsive rules are generic and partly off-brief.
- `meta-prompt.md`: strongest human-readable artifact. Mostly specific, with accurate evidence limitations and validation gates.
- `generation-plan.json`: strongest structured design-plan artifact. Mostly specific and better than the Canvas request.
- `design-contract.json`: mixed. Top-level intent is correct, but nested generation plan, business focus, keywords, token palette, and surface language are generic.
- `canvas-plan.request.json`: weak for Canvas continuation. It loses much of `generation-plan.json` specificity through repeated generic placeholder text.
- `design-agent-handoff.json`: mixed. Good operational handoff and authority fields, but generic creative-tool brief expansion and screenshot readiness inconsistency.
- `evidence.json`: faithful aggregate, but includes upstream generic leakage.
- `ranked-references.json`: specific and evidence-backed.
- `media-analysis.json`: specific design-fact surface, correctly non-authoritative for readiness.
- `pin-media-evidence.json` and `pin-media-index.json`: specific and authority-bearing for pin media.
- `visual-evidence.json`, `screenshot-index.json`, and `motion-evidence.json`: specific diagnostics, but they are negative or empty authority surfaces.
- Saved pin-media files: specific, present, and aligned with `pin-media-index.json`.

### Conclusion

The harvested evidence is run-specific and strong enough to identify a cinematic photography or portfolio landing-page direction. The bundle is not uniformly generic. However, several downstream generated artifacts dilute that evidence with creative-tool prompt-format defaults, stock bright tokens, app-shell language, and repeated generic Canvas-plan text. The highest-risk issue for follow-through is the mismatch where `generation-plan.json` is specific, while `design-contract.json.generationPlan` and `canvas-plan.request.json.generationPlan` replace many fields with generic placeholder-like text. A design agent using the Canvas request directly would receive weaker guidance than the bundle actually contains.

## Pre-Fix Investigator Findings: Media And Motion
Completed read-only audit. Source edits were not made.

### Verdict
- Empty `motion-evidence.json` in the inspected Pinterest video bundle is expected screencast separation, not a bug. In the current architecture, `motion-evidence.json` is the screencast replay authority surface, while Pinterest MP4/GIF/image bytes are governed by `pin-media-index.json` and optional decoded design facts are governed by `media-analysis.json`.
- The inspected bundle does contain a real first-party Pinterest video artifact and sampled video motion facts. Product readiness is correctly `pin_media_ready`, not `motion_ready`, because no screencast replay evidence was captured.
- There are propagation gaps, but they are not in readiness authority. The missing pieces are mostly citation/detail propagation: several downstream artifacts receive the aggregate phrase `subtle_motion sampled from 8 frames at fast cadence`, but they do not carry the exact `media-analysis.json` claim level, media path, or source citation.

### Source Trace
- `src/inspiredesign/motion-evidence.ts:1-237` defines motion evidence as `kind: "screencast"`, sanitizes only replay/preview/replayHtml paths under `motion-evidence/<ref>/...`, and marks authority as `design_evidence` only for non-diagnostic captured screencast metadata. It has no path for pin-media video analysis facts.
- `src/providers/workflows.ts:2816-2838` calls `captureMotionEvidence()` only when the workflow has a motion capture callback and a motion temp directory, with output rooted under the motion temp directory. This is separate from pin-media capture at `src/providers/workflows.ts:2841-2878`.
- `src/providers/workflows.ts:6402-6404` finalizes motion, pin-media, and visual artifacts as separate lanes. `src/providers/workflows.ts:6455-6465` only treats a motion entry as authority when replay and preview paths are present in the final artifact manifest.
- `src/inspiredesign/product-readiness.ts:1104-1174` resolves final evidence authority from product-ready counts in this order: `motion_ready`, then `pin_media_ready`, then `snapshot_ready`, then `ranked_reference`. It does not read `media-analysis.json` as a readiness authority.
- `src/providers/renderer.ts:1229-1236` always writes `motion-evidence.json` from `motionEvidence` and writes `media-analysis.json` separately when present.
- `src/inspiredesign/media-analysis/analyzer.ts:39-60` analyzes only trusted scheduled persisted media inputs. `src/providers/workflows.ts:3831-3876` constructs those inputs only from captured `pinMedia` whose persisted path, bytes, hash, and scheduled artifact file all match.
- `src/inspiredesign/media-analysis/analyzer.ts:145-204` builds frame-derived `facts.motion` for GIF/video media and adds the `motion_sampled` claim level only when more than one decoded frame supports it.
- `src/inspiredesign/reference-pattern-board.ts:1438-1478` merges media-analysis design guidance into each ranked reference, including `motionPosture`, `mediaAnalysisBacked`, `mediaAnalysisSource`, and `mediaArtifactPath` when a measured media reference matches the pin-media evidence.
- `src/inspiredesign/reference-pattern-board.ts:1971-2010` aggregates reference-level media motion into `designVectors.motionPosture`. `src/inspiredesign/contract.ts:816-839`, `src/inspiredesign/contract.ts:2067-2091`, and `src/inspiredesign/meta-prompt.ts:80-108` then propagate that aggregate vector into `advanced-brief.md`, implementation-plan surfaces, and `meta-prompt.md`.
- `src/inspiredesign/contract.ts:2155-2284` is the strongest human-readable per-reference propagation point. It prints media path, media observations, and motion observations into `design.md` when trusted media-analysis is available.
- `src/inspiredesign/handoff.ts:120-171` tells downstream agents that `motion-evidence.json` is screencast replay authority, `pin-media-index.json` is pin-media readiness authority, and `media-analysis.json` is advisory design facts that must cite saved media paths.

### Latest Bundle Evidence
Inspected bundle: `.opendevbrowser/inspiredesign/2f2e7736-23e3-438f-a14b-c9b051b3a319`.

- `pin-media-index.json:2-9` includes four authoritative entries; the first is `pin-media-evidence/43ad51b68a34/video.mp4`, `kind: "video"`, `contentType: "video/mp4"`, `bytes: 5320411`, `authority: "design_evidence"`, `pinterestPageQuality: "pin_media"`.
- The actual MP4 exists in the bundle as `pin-media-evidence/43ad51b68a34/video.mp4` with 5,320,411 bytes.
- `motion-evidence.json:2` is `{ "motionEvidence": [] }`. There are no `motion-evidence/<ref>/replay.json` or `preview.png` files in the bundle, so no screencast authority exists.
- `media-analysis.json:16`, `media-analysis.json:36`, and `media-analysis.json:314-415` prove the MP4 was analyzed as `pin-media-evidence/43ad51b68a34/video.mp4` with `claimLevels` including `motion_sampled`, `sampledFrameCount: 8`, `averageFrameDelta: 0.0969`, `cadence: "fast"`, `posture: "subtle_motion"`, and design guidance `subtle_motion sampled from 8 frames at fast cadence.`
- `ranked-references.json:117-192` ranks the video pin as `evidenceAuthority: "pin_media_ready"`, includes `capturedVia` with `pin_media_ready`, carries `motionPosture` with `subtle_motion sampled from 8 frames at fast cadence.`, and cites `mediaAnalysisSource.mediaPath` plus `mediaArtifactPath` for the MP4.
- `ranked-references.json:408-409` marks the bundle `evidenceAuthority: "pin_media_ready"` and `productSuccess: true`. This matches the current readiness authority model.
- `.tmp/pinterest-search-shell-live-20260627T1335Z/harvest.json` mirrors the same behavior under `data`: `readiness: "ready"`, `productSuccess: true`, `artifactAuthority: "product_ready"`, `evidenceAuthority: "pin_media_ready"`, `motionReadyReferenceCount: 0`, `pinMediaReadyReferenceCount: 4`, `motionEvidence: []`, and four `pinMediaIndex` entries.

### Propagation Into Downstream Artifacts
- `design.md` has the best propagation. It includes the MP4 media path at `design.md:15`, the sampled motion statement at `design.md:20`, aggregate motion posture at `design.md:85`, and implementation motion guidance at `design.md:316`.
- `advanced-brief.md` receives only aggregate design-vector motion posture at `advanced-brief.md:14`. It does not include the media path, claim level, sampled frame count object, or `mediaAnalysisSource` citation.
- `implementation-plan.md` receives only the aggregate sampled motion line at `implementation-plan.md:53`. `implementation-plan.json:139` also contains the aggregate statement, but not the media path or `motion_sampled` claim-level citation.
- Before the patch, `meta-prompt.md` included aggregate motion posture and validation gates requiring all evidence files and media-analysis citations before implementation, but its ranked-reference text omitted per-reference `motionPosture`, `mediaAnalysisSource`, and `mediaArtifactPath` even though those fields existed in `ranked-references.json`.
- `design-contract.json:464` carries the aggregate sampled motion posture and `design-contract.json:539-540` carries `pin_media_ready` and `productSuccess: true`, but it does not carry the MP4 path, `motion_sampled` claim level, or media-analysis source citation.
- `generation-plan.json` carries the richest structured propagation after ranked references: `generation-plan.json:4`, `generation-plan.json:15`, and `generation-plan.json:18` mention media-analysis-derived facts; `generation-plan.json:321` carries the sampled motion posture for the video reference; `generation-plan.json:352-359` carries the MP4 `mediaPath` and `mediaArtifactPath`.
- `design-agent-handoff.json` has the correct artifact guidance and implementation context. `design-agent-handoff.json:182-258` documents the authority split across `motion-evidence.json`, `pin-media-evidence.json`, `pin-media-index.json`, and `media-analysis.json`; `design-agent-handoff.json:915-953` carries the sampled motion posture and MP4 media source in the reference pattern board; `design-agent-handoff.json:1340` explicitly tells downstream agents to read evidence files and use `media-analysis.json` for media-derived design facts without treating it as readiness proof.
- `evidence.json:416-432` is the machine-readable citation surface for `media-analysis.json` and preserves `motion_sampled` for the MP4. It also preserves `motionEvidence: []` and `pinMediaIndex` count 4.

### Pre-Fix Missing Propagation Points
These are output-quality gaps if downstream artifacts are expected to be self-contained. They are not readiness bugs.

1. `advanced-brief.md` lacks per-reference media-analysis provenance. The source seam is `src/inspiredesign/contract.ts:816-839`, which renders only `board.references.map(... layoutRecipe ...)` plus aggregate `vectors.motionPosture`. It should include `mediaAnalysisSource` or at least `mediaArtifactPath` plus claim-level summary for each media-backed reference if the advanced brief is expected to be audit-ready.
2. `meta-prompt.md` ranked-reference entries omit motion and media-analysis source detail. The source seam is `src/inspiredesign/meta-prompt.ts:16-34`, where `formatRankedReferences()` emits borrow, reject, visual strengths, and visual risks but not `motionPosture`, `mediaAnalysisSource`, or `mediaArtifactPath`.
3. `implementation-plan.md` and `implementation-plan.json` inherit only aggregate `designVectors.motionPosture` through `src/inspiredesign/contract.ts:2067-2091`. If implementation tasks must cite the actual sampled MP4 fact, add a reference evidence note sourced from `rankedReferences[].mediaAnalysisSource` or `evidence.mediaAnalysis.analyzedReferences`.
4. `design-contract.json` gets the aggregate motion posture through `generationPlan`, but not media-analysis provenance. The source seam is `src/inspiredesign/contract.ts:1978-1986` and the blocks it builds from `plan`; add citation-bearing provenance only if the design contract is intended to carry audit references, otherwise keep that in `evidence.json`, `ranked-references.json`, and handoff.
5. Markdown outputs use the human phrase `subtle_motion sampled from 8 frames at fast cadence` but do not expose the explicit `motion_sampled` claim level. The claim level is only in `media-analysis.json` and `evidence.json`. If claim-level traceability is required in human artifacts, render a concise line such as `media-analysis claim: motion_sampled from <mediaPath>`.

### Recommended Interpretation
- Do not backfill `motion-evidence.json` from `media-analysis.json`; that would collapse screencast authority into media fact extraction and would contradict the current contracts.
- Keep readiness as-is for this case: `pin_media_ready` with `motionReadyReferenceCount: 0` and `pinMediaReadyReferenceCount: 4` is correct.
- If fixing anything, fix propagation and citation quality in `advanced-brief.md`, `meta-prompt.md`, `implementation-plan.*`, and optionally `design-contract.json`, using `ranked-references.json` / `evidence.json` media-analysis citations as the source of truth.

## Pre-Fix Investigator Findings: Tokens And Handoff

### Scope And Evidence
- Read this report first, then traced only token and handoff paths. No source or test files were edited.
- Primary code paths: `src/inspiredesign/contract.ts`, `src/inspiredesign/reference-pattern-board.ts`, `src/inspiredesign/media-analysis/design-guidance.ts`, `src/inspiredesign/meta-prompt.ts`, `src/inspiredesign/handoff.ts`, `src/canvas/types.ts`.
- Artifact checked: `.opendevbrowser/inspiredesign/2f2e7736-23e3-438f-a14b-c9b051b3a319`.
- Focused tests inspected: `tests/providers-inspiredesign-contract.test.ts` and `tests/providers-inspiredesign-workflow.test.ts`.

### Token Strategy And Theme Findings
- `themeStrategy` originates in the selected prompt format route and is copied into the plan at `src/inspiredesign/contract.ts:1582-1584`.
- `requiredThemes` is derived only from that route value at `src/inspiredesign/contract.ts:1605-1608`: `single-theme` becomes `["light"]`; every other strategy becomes `["light", "dark"]`.
- The inspected pre-fix artifact is single-theme: `generation-plan.json.visualDirection.themeStrategy` is `single-theme`, and `validationTargets.requiredThemes` is `["light"]`.
- The base templates default to dual theme validation: `skills/opendevbrowser-design-agent/assets/templates/canvas-generation-plan.design.v1.json` and `skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json` both use `light-dark-parity` with `["light", "dark"]`. Inspiredesign overwrites that with the selected format route.
- Actual emitted tokens are single-set even when validation asks for dual themes:
  - `InspiredesignTokenStrategy` is a flat shape at `src/inspiredesign/contract.ts:327-337`.
  - `buildTokenStrategy()` copies one flat `PROFILE_CONFIG[profile].colors` map into `implementationPlan.tokenStrategy.colors` at `src/inspiredesign/contract.ts:2000-2039`.
  - `buildColorSystemBlock()` copies the same flat profile color map into `design-contract.json.colorSystem.tokens` at `src/inspiredesign/contract.ts:1716-1732`.
  - `buildImplementationPlan()` writes that flat token strategy at `src/inspiredesign/contract.ts:2060-2129`.
- Palette derivation is advisory, not authoritative token generation:
  - `src/inspiredesign/media-analysis/design-guidance.ts:120-126` converts quantized swatches into string `tokenNotes`.
  - `src/inspiredesign/reference-pattern-board.ts:1899-1902` maps those notes into `designVectors.materialEffects`.
  - `src/inspiredesign/contract.ts:1731` stores them as `mediaDerivedTokenNotes`, but the actual `tokens` still come from `PROFILE_CONFIG`.
- Concrete mismatch in the inspected bundle: media facts say dark-dominant swatches such as `#202020` should lead, and rejected patterns warn against a bright lab palette, while `design-contract.json.colorSystem.tokens` still emits the bright `product-story` profile colors.

### Artifact Shape Findings
- `generation-plan.json` includes full Inspiredesign reasoning fields outside the Canvas request subset: `referencePatternBoard`, `designVectors`, `targetAnalysis`, `interactionMoments`, and `materialEffects` are added at `src/inspiredesign/contract.ts:1609-1616`.
- `canvas-plan.request.json` is scrubbed through `toCanvasGenerationPlan()` at `src/inspiredesign/contract.ts:1873-1889`; it keeps Canvas plan fields plus `interactionMoments`, `materialEffects`, and scrubbed `designVectors`, but not `referencePatternBoard` or `targetAnalysis`.
- `design-contract.json` is a narrowed `CanvasDesignGovernance` at `src/inspiredesign/contract.ts:1978-1996`. It includes the generation plan, color system, motion system, accessibility policy, library policy, and runtime budgets, but omits navigation, async, and performance template blocks.
- `design-agent-handoff.json` is the `followthrough` object from `buildFollowthrough()` at `src/inspiredesign/contract.ts:1939-1976`. It carries artifact guides, skill commands, contract scope, and implementation-only context including navigation, async, performance, reference pattern board, design vectors, and target analysis. It does not carry `tokenStrategy` directly.

### State, Cause-Effect, Motion, WebGL, GSAP, And Accessibility Findings
- `stateAndInteractionPlan` is assembled in `buildImplementationPlan()` at `src/inspiredesign/contract.ts:2088-2109`. It mixes `format.motionGrammar`, design-vector motion, interactions, materials, advanced advisories, and generic reduced-motion/loading lines.
- Cause-effect advisory is absent. Searches across `src/inspiredesign/` found no `cause-effect`, `causeEffect`, `causality`, `causal`, `consequence`, `ripple`, or similar construct. The closest surface is the fixed `stateMatrix` bucket at `src/inspiredesign/contract.ts:1440` and generic risk text around `src/inspiredesign/contract.ts:2113-2122`.
- Some interaction and material guidance is evidence-gated already:
  - cursor effects depend on reference text cues at `src/inspiredesign/reference-pattern-board.ts:1847-1866`.
  - parallax and glass/translucency depend on reference evidence text at `src/inspiredesign/reference-pattern-board.ts:1904-1928`.
  - media-derived motion, interaction, and material values are collected from media-backed references at `src/inspiredesign/reference-pattern-board.ts:1877-1902`.
- Advanced WebGL, shader, and Spline advisories are generic. `ADVANCED_MOTION_FIELDS` is a fixed constant at `src/inspiredesign/reference-pattern-board.ts:220-226` and is always copied into `advancedMotionAdvisory` at `src/inspiredesign/reference-pattern-board.ts:2018`.
- There is no GSAP advisory in `src/inspiredesign/`; no source hit indicates GSAP-specific output today.
- `libraryPolicy.motion` and `libraryPolicy.threeD` remain empty at `src/inspiredesign/contract.ts:1812-1818`, which is correct, but the generic advisory text can still over-suggest advanced effects without evidence.
- Accessibility is mostly generic:
  - target evidence bucket is a fixed sentence at `src/inspiredesign/contract.ts:1443`.
  - `buildAccessibilityBlock()` only clones the template and adds fixed reduced-motion text at `src/inspiredesign/contract.ts:1804-1809`.
  - `implementationPlan.accessibilityChecklist` is three fixed strings at `src/inspiredesign/contract.ts:2099-2103`.
  - `meta-prompt.ts:92-98` emits a hard-coded `Accessibility Constraints` section independent of evidence or contract details.

### Tests And Coverage Gaps
- `tests/providers-inspiredesign-contract.test.ts:560-789` checks `light-dark-parity` theme strategy in one packet and multi-theme required themes, but does not assert `light-dark-parity` produces `["light", "dark"]` in the first case.
- `tests/providers-inspiredesign-contract.test.ts:4000-4017` checks `single-theme` for a blocked reference packet but does not assert `requiredThemes` is `["light"]`.
- No inspected test asserts dual light and dark token sets because the source has no dual token shape.
- Existing tests assert current generic advanced advisory behavior:
  - `tests/providers-inspiredesign-contract.test.ts:1900-2039` expects `shader-style`, `WebGL-style`, `Spline-style`, and runtime-boundary strings in design vectors, canvas request vectors, and contract motion system.
  - `tests/providers-inspiredesign-workflow.test.ts:620-898` expects the same strings in generated artifact files.
- `tests/providers-inspiredesign-workflow.test.ts:4280-4359` asserts target-analysis accessibility contains `keyboard`, but that only locks the current constant accessibility bucket.
- No inspected test varies motion, WebGL, GSAP, accessibility, or state evidence to prove advisories change when evidence is absent or present.

### Pre-Fix Smallest Source Fixes Proposed
1. Add a dual-theme token type without broad workflow changes.
   - Extend `InspiredesignTokenStrategy` with `colorModes: { light: Record<string,string>; dark: Record<string,string> }` or replace `colors` with `colors: { light: ..., dark: ... }` if breaking shape is acceptable.
   - Keep current flat `colors` only as a generated alias to the primary mode if compatibility is required. If no compatibility path is allowed, update all consumers in the same patch.
2. Centralize palette derivation in `contract.ts`.
   - Add a small helper near `buildColorSystemBlock()` / `buildTokenStrategy()` that derives semantic light and dark roles from trusted media-backed `designVectors.materialEffects` or `referencePatternBoard.references[].tokenNotes`, then falls back to `PROFILE_CONFIG[profile].colors` when no measured palette exists.
   - Use the helper in both `buildColorSystemBlock()` and `buildTokenStrategy()` so `design-contract.json` and `implementation-plan.json` cannot diverge.
3. Make theme validation independent from route defaults when media evidence proves both light and dark posture.
   - Keep `format.route.themeStrategy` as the route default, but if trusted media evidence contains both dark-dominant and bright-dominant signals, promote the generated plan to `light-dark-parity` and set `requiredThemes` to `["light", "dark"]`.
4. Evidence-gate advanced advisories.
   - Replace `advancedMotionAdvisory: [...ADVANCED_MOTION_FIELDS]` with a helper that always emits runtime-boundary and performance-policy text, but only emits shader/WebGL/Spline-style lines when design/reference evidence includes matching cues.
   - Do not add GSAP unless there is explicit evidence for timeline choreography. If added later, keep it advisory and do not authorize a dependency.
5. Add a cause-effect line using existing data.
   - Pass `targetAnalysis` into `buildImplementationPlan()` or derive a concise state-causality line before calling it. Use `targetAnalysis.evidenceBuckets.stateMatrix` plus interaction moments to state which user action affects which surface and which fallback preserves task completion.
6. Thread accessibility evidence once.
   - Derive `targetAnalysis.evidenceBuckets.accessibility` from interaction/motion evidence and required themes, then reuse it in `implementationPlan.accessibilityChecklist` and optionally in the meta-prompt accessibility section.

### Pre-Fix Smallest Test Fixes Proposed
- Add contract tests for theme validation:
  - `single-theme` route emits `requiredThemes: ["light"]`.
  - `light-dark-parity` route emits `requiredThemes: ["light", "dark"]`.
- Add a packet test with media-backed dark and bright palette facts that asserts:
  - `generationPlan.visualDirection.themeStrategy` is `light-dark-parity` when evidence proves dual posture.
  - `designContract.colorSystem.tokens` exposes `light` and `dark` semantic token sets.
  - `implementationPlan.tokenStrategy` exposes the same `light` and `dark` token sets.
- Update existing advisory assertions to split two cases:
  - no motion/WebGL-like evidence excludes shader/WebGL/Spline strings but keeps runtime boundary and no dependency authorization.
  - explicit evidence includes matching advisory strings while `libraryPolicy.motion` and `libraryPolicy.threeD` remain empty.
- Add one state/accessibility test that asserts the generated `stateAndInteractionPlan`, `targetAnalysis.evidenceBuckets.accessibility`, and meta-prompt accessibility constraints include evidence-derived lines instead of only fixed boilerplate.

## Investigation Log

### Phase 0 - Workspace And Branch
**Hypothesis:** The investigation must run on the active checkout and preserve existing dirty work.
**Findings:** Created branch `codex/inspiredesign-output-specificity-motion`; RepoPrompt window `1` has root `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`.
**Evidence:** `git switch -c codex/inspiredesign-output-specificity-motion`; `rpce-cli -w 1 -e 'tree --type roots'`.
**Conclusion:** Confirmed.

### Phase 1 - Latest Bundle And Fresh Harvest Repro
**Hypothesis:** The output specificity and motion symptoms are visible in current saved artifacts, not only stale screenshots.
**Findings:** The prior bundle and an initial isolated harvest both reached product-ready authority with persisted first-party Pinterest pin media. Both runs had a saved video and `media-analysis.json` with `motion_sampled` facts, while `motion-evidence.json` stayed empty. Before the patch, those runs also exposed a single-theme token strategy: `generation-plan.json` required only `light`, `design-contract.json` used `themeStrategy: "single-theme"`, and `implementation-plan.json` contained a single `tokenStrategy.colors` map.
**Evidence:** Prior bundle `.opendevbrowser/inspiredesign/2f2e7736-23e3-438f-a14b-c9b051b3a319`; fresh bundle `.opendevbrowser/inspiredesign/12a88b05-3f04-47ad-9b1a-529383ef8eed`. Fresh CLI output `.tmp/inspiredesign-output-specificity-live-20260627T143647Z/harvest-output.json` reported `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `nextStepGuidance.readiness=ready`, and `reasonCode=design_ready`. Fresh `pin-media-index.json` included `pin-media-evidence/43ad51b68a34/video.mp4`; fresh `media-analysis.json` reported `claimLevels` including `motion_sampled`, `durationSeconds=16.6`, `fps=60`, `frameCount=996`, `sampledFrameCount=8`, `cadence=fast`, and `posture=subtle_motion`; fresh `motion-evidence.json` was `{"motionEvidence":[]}`.
**Conclusion:** Confirmed as the pre-fix failure. The runtime could harvest and analyze video, but the human/handoff output contract did not expose that motion source strongly enough, and the theme/token output remained single-theme.

### Phase 2 - Patch Validation
**Hypothesis:** A scoped patch can preserve authority semantics while making downstream artifacts design-ready and evidence-grounded.
**Findings:** Post-fix harvest produced a product-ready bundle with dual tokens and media provenance in design-facing surfaces.
**Evidence:** `.tmp/inspiredesign-output-specificity-live-20260627T151726Z/harvest-output.json` reports `data.ready=true`, `data.readiness="ready"`, `data.harvestReadiness="ready"`, `data.productSuccess=true`, `data.artifactAuthority="product_ready"`, `data.evidenceAuthority="pin_media_ready"`, `data.rankedReferenceCount=4`, `data.authoritativeReferenceCount=4`, and `data.pinMediaReadyReferenceCount=4`. The saved artifact path is `.opendevbrowser/inspiredesign/1d879b58-6ea7-46cf-9c18-7fb818e6e8d2`.
**Artifact checks:** `design-contract.json.colorSystem.tokens.light` and `.dark` exist; `generation-plan.json.visualDirection.themeStrategy` is `light-dark-parity`; `generation-plan.json.validationTargets.requiredThemes` is `["light","dark"]`; `implementation-plan.json.tokenStrategy.colors.light` and `.dark` exist; `design-agent-handoff.json.implementationContext.tokenStrategy` and `.implementationPlan` exist; `media-analysis.json` has a video reference at `pin-media-evidence/43ad51b68a34/video.mp4` with `motion_sampled`; `meta-prompt.md` cites the saved video path and `motion_sampled`; `canvas-plan.request.json` strips raw media provenance and claim tokens while preserving sanitized lines such as `Reference-derived token note: #202020 as background.`
**Motion conclusion:** `motion-evidence.json` remains `{"motionEvidence":[]}` in the proof bundle. That is expected because it is screencast evidence authority. Pin-video content motion facts remain in `media-analysis.json` and are now propagated into design-facing artifacts without changing readiness authority.

## Root Cause
1. Downstream propagation was weaker than the evidence layer. `pin-media-index.json`, `ranked-references.json`, and `media-analysis.json` were specific, but `design-contract.json.generationPlan` and `canvas-plan.request.json.generationPlan` collapsed many fields into generic phrasing.
2. Token generation used a flat profile color map. Media-derived palette notes were retained only as advisory notes and did not drive a dual light/dark token strategy in `design-contract.json` or `implementation-plan.json`.
3. Media-analysis provenance did not reach the meta prompt strongly enough. The ranked references carried measured media facts, but design-facing prompt output omitted saved media paths and claim levels such as `motion_sampled`.
4. Canvas sanitization was both overbroad and underbroad. It could erase useful specific token cues while still lacking explicit guards for raw claim-level text such as `metadata_only`, `palette_quantized`, and `motion_sampled`.
5. The empty `motion-evidence.json` symptom was a terminology issue, not a capture failure. That file is reserved for screencast/replay motion authority; Pinterest video motion facts belong in `media-analysis.json`.

## Fixes Applied
- `src/inspiredesign/reference-pattern-board.ts` now carries media-analysis `claimLevels` with each media-backed ranked reference.
- `src/inspiredesign/meta-prompt.ts` now renders media kind, content type, media path, saved media artifact path, claim levels, and motion guidance for media-backed references.
- `src/inspiredesign/contract.ts` now emits explicit `light` and `dark` semantic color token maps in both `design-contract.json` and `implementation-plan.json`.
- `src/inspiredesign/contract.ts` now exposes `implementationContext.tokenStrategy` and `implementationContext.implementationPlan` in `design-agent-handoff.json`.
- `src/inspiredesign/contract.ts` now promotes route `single-theme` to `light-dark-parity` when trusted measured media token evidence exists.
- `src/inspiredesign/contract.ts` now preserves sanitized Canvas token notes while blocking raw provenance keys, media paths, source URLs, hashes, claim levels, limitations, facts, and common raw claim tokens.
- `tests/providers-inspiredesign-contract.test.ts` now covers dual token output, media-analysis provenance in the meta prompt, `motion_sampled` propagation for GIF/video-like media, and Canvas provenance scrubbing.

## Validation
- Evidence paths under `.tmp/` and `.opendevbrowser/` are local ignored proof artifacts, not committed fixtures. This report preserves the redacted authority summary needed for review: the proof run reached `ready=true`, `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, `rankedReferenceCount=4`, `authoritativeReferenceCount=4`, and `pinMediaReadyReferenceCount=4`.
- `npm run test -- tests/providers-inspiredesign-contract.test.ts -t "threads media-analysis summaries"` initially failed before the token fix, then passed after implementation.
- `npm run test -- tests/providers-inspiredesign-contract.test.ts -t "threads media-analysis summaries|trusts GIF media analysis"` passed.
- `npm run test -- tests/providers-inspiredesign-contract.test.ts tests/providers-inspiredesign-workflow.test.ts` passed with 234 tests.
- `node scripts/run-package-tool.mjs eslint src/inspiredesign/contract.ts src/inspiredesign/meta-prompt.ts src/inspiredesign/reference-pattern-board.ts tests/providers-inspiredesign-contract.test.ts` passed.
- `npm run typecheck` passed.
- `npm run build` passed.
- `git diff --check -- src/inspiredesign/contract.ts src/inspiredesign/meta-prompt.ts src/inspiredesign/reference-pattern-board.ts tests/providers-inspiredesign-contract.test.ts` passed.
- Fresh isolated harvest command:

```bash
node ./dist/cli/index.js inspiredesign harvest --brief "Premium digital photography studio landing page" --query "Pinterest premium digital photography studio landing page cinematic parallax portfolio" --provider social/pinterest --max-references 5 --visual-evidence required --browser-mode managed --use-cookies --cookie-policy auto --challenge-automation-mode browser_with_helper --mode json --timeout-ms 240000 --output-format json
```

- Fresh isolated harvest result: `.opendevbrowser/inspiredesign/1d879b58-6ea7-46cf-9c18-7fb818e6e8d2` reached `productSuccess=true`, `artifactAuthority=product_ready`, `evidenceAuthority=pin_media_ready`, and 4 pin-media-ready references.
- Isolated daemon cleanup check: ports `18788` and `18787` were no longer listening after the run.

## Residual Risks
- Managed Pinterest harvest still encountered one rejected `search_shell` reference, but the run remained product-ready through 4 authoritative pin-media references. The separate Pinterest search-shell readiness changes must be reviewed and landed independently.
- Shared daemon preflight still showed a fingerprint mismatch during this investigation. The live proof used an isolated current daemon, so the code path is validated, but the machine-level daemon state remains environmental.
- The patch makes generated token maps dual light/dark, but deeper creative-tool wording and advanced advisory gating are broader output-quality opportunities and should be handled separately from this scoped fix.

## Recommendations
- Keep `media-analysis.json` advisory and non-authoritative. Do not use it to set `productSuccess`, `artifactAuthority`, or `evidenceAuthority`.
- Keep `motion-evidence.json` reserved for screencast/replay authority. Do not backfill it from pin-video analysis.
- Treat successful Inspiredesign output as product-ready only when saved artifacts prove `productSuccess=true`, `artifactAuthority=product_ready`, and a non-diagnostic `evidenceAuthority` such as `pin_media_ready`.
- Treat top-level `ready` as product-ready only. When guidance is ready but product authority is false, use `guidanceReady` and `guidanceReadiness` for the guidance state and keep `ready=false`.
- Add a follow-up for remaining generic creative-tool language in prompt-format expansion, advanced WebGL/Spline advisories, and state/cause-effect/accessibility specificity.

## Preventive Measures
- Keep regression tests around Canvas scrub boundaries whenever media-analysis provenance fields change.
- Keep dual light/dark token assertions in both design contract and implementation plan outputs.
- For future live validation, always inspect the saved bundle, not only CLI transport success.
- Use isolated daemon roots when shared daemon `fingerprintCurrent=false`.
