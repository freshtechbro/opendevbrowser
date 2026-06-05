# Pinterest Harvest Visual-First Implementation: Plan

## Goal

Implement the fixes recommended by `docs/investigations/pinterest-harvest-snapshot-first-consolidated-2026-05-22.md`: make Pinterest `inspiredesign harvest` visual-screenshot-first for image pins, screencast-first for video pins, and evidence-gated for product success, while keeping deep capture as optional diagnostics or enrichment.

## Background

- The current CLI still dispatches `inspiredesign harvest` through daemon method `inspiredesign.run`; harvest defaults include `maxReferences: 5`, `visualEvidence: "required"`, and `mode: "path"` (`src/cli/commands/inspiredesign.ts:290-353`, `tests/cli-workflows.test.ts:537-577`).
- Top-level CLI/tool success is operational. CLI returns `success: true` after the daemon call resolves, while readiness is nested in `meta.nextStepGuidance.readiness` and only appended to the human message (`src/cli/commands/inspiredesign.ts:51-65`, `src/cli/commands/inspiredesign.ts:331-353`, `src/tools/inspiredesign_run.ts:84-111`).
- Pinterest is modeled as a site recipe, not a broad social provider. `social/pinterest` routes through browser-native discovery, normalizes concrete pin/idea/board URLs, and uses authenticated browser state when needed (`src/guidance/recipes/pinterest.ts:1-183`, `src/providers/browser-native-discovery.ts:43-50`, `src/providers/browser-native-discovery.ts:267-386`).
- URL-backed harvest currently forces deep capture: `resolveInspiredesignCaptureMode()` returns `"deep"` for any non-empty URL list, and `runInspiredesignWorkflow()` re-resolves capture mode after merging discovered Pinterest URLs (`src/inspiredesign/capture-mode.ts:1-12`, `src/providers/workflows.ts:4371-4388`). Docs currently state that any `--url` forces deep capture for DOM/layout evidence (`docs/CLI.md:552-584`).
- Deep capture launches a fresh headless, no-extension browser session, imports configured provider cookies, then captures text/actionable snapshot, clone, DOM, and visual screenshot before disconnecting (`src/inspiredesign/capture.ts:91-99`, `src/inspiredesign/capture.ts:260-487`, `src/inspiredesign/capture.ts:501-550`).
- Current `snapshot()` is text/actionable evidence, not a PNG screenshot. Visual screenshot capture is separate and uses `manager.screenshot(..., { path, fullPage: false })` (`src/inspiredesign/capture.ts:260-299`, `src/inspiredesign/capture.ts:389-431`).
- Visual evidence is metadata-only. Runtime screenshots are sanitized into artifact-relative paths, hashes, byte counts, viewport metadata, warnings, and failures; `screenshot-index.json` only indexes captured screenshots with path, hash, and bytes (`src/inspiredesign/visual-evidence.ts:16-39`, `src/inspiredesign/visual-evidence.ts:56-83`, `src/inspiredesign/contract.ts:2095-2126`).
- Ranking is not screenshot-pixel-first today. Reference signals come from title, excerpt, text snapshot, clone, CSS, and DOM; visual evidence contributes only when usable capture evidence or narrow Pinterest visual metadata exists (`src/inspiredesign/reference-pattern-board.ts:369-379`, `src/inspiredesign/reference-pattern-board.ts:434-446`, `src/inspiredesign/reference-pattern-board.ts:580-599`).
- Screencast primitives exist separately from harvest: `screencast-start` and `screencast-stop` route to `page.screencast.start` and `page.screencast.stop`, and the browser manager exposes screencast lifecycle APIs. The inspiredesign/provider harvest paths do not currently call them (`src/cli/commands/devtools/screencast-start.ts:36-50`, `src/cli/commands/devtools/screencast-stop.ts:24-35`, `src/cli/daemon-commands.ts:611-624`, `docs/CLI.md:1368-1398`).
- Visual finalization and artifact persistence are established. Existing tests cover visual metadata, required/auto visual mode behavior, path mismatch, zero-byte screenshots, policy blockers, finalization failures, transport timeouts, and artifact files (`tests/providers-inspiredesign-capture.test.ts:152-452`, `tests/providers-inspiredesign-workflow.test.ts:700-1179`).
- Existing Pinterest tests already cover canonical URL validation, auth/challenge behavior, search-shell handling, authenticated URL extraction, mixed-provider order, diagnostic-only harvest, and Canvas blocking (`tests/pinterest-guidance-recipe.test.ts:40-533`, `tests/providers-inspiredesign-workflow.test.ts:1411-1934`, `tests/providers-inspiredesign-workflow.test.ts:2190-2320`).
- Readiness routing is evidence-gated. Zero ranked references, diagnostic-only reasons, failed required screenshots, auth blockers, weak scores, and intent mismatch prevent `ready` (`tests/guidance-readiness.test.ts:38-169`, `src/guidance/context.ts:105-139`, `src/guidance/readiness.ts:45`, `src/guidance/recipes/generic.ts:436-711`).
- Renderer already blocks Canvas continuation when `nextStepGuidance.readiness !== "ready"`, but still writes substantial diagnostic artifacts including `design.md`, `design-contract.json`, `generation-plan.json`, `visual-evidence.json`, `screenshot-index.json`, `ranked-references.json`, and handoff files (`src/providers/renderer.ts:192-285`, `src/providers/renderer.ts:825-940`).
- Prior related plan: `docs/plans/inspiredesign-harvest-recovery-and-browser-output-artifacts-2026-05-21.md` kept readiness gates and `interface_chrome_shell` rejection intact while improving recovery, guidance, readiness visibility, diagnostics, and browser artifacts.

## Approach

Implement this as an additive contract and workflow refactor, not a replacement of the existing `inspiredesign harvest` surface. Preserve operational `success:true` and tool `ok:true`, but add product-readiness fields that make diagnostic runs unambiguous. Then split Pinterest harvest into a visual-first media lane that runs before optional deep diagnostics: image pins capture screenshot evidence first, video pins capture screencast evidence first, and DOM/clone deep capture becomes enrichment rather than the primary readiness path.

The key architectural change is that screenshot or screencast artifact metadata must be validated as product evidence before a reference becomes design-ready. Ranking can accept Pinterest references from snapshot-ready screenshots or motion-ready screencasts without requiring DOM/clone evidence, while still rejecting Pinterest chrome, search shell, login/challenge UI, controls-only video captures, and small centered media that does not satisfy the brief.

The implementation should preserve the existing Canvas gate: Canvas continuation remains unavailable unless `nextStepGuidance.readiness === "ready"` and ranked Pinterest references have snapshot-ready or motion-ready evidence. Non-ready bundles should still be useful diagnostics, but they must be clearly marked as diagnostic-only and non-authoritative.

Recommended decisions for the first implementation:

- Preserve operational `success` and add product fields: `ready`, `readiness`, `harvestReadiness`, `productSuccess`, `artifactAuthority`, and `rankedReferenceCount`.
- Scope first-pass Pinterest media support to canonical image and video pin pages. Boards and idea pages should remain diagnostic unless the classifier extracts concrete image or video media from them.
- Run visual or motion capture through a shared workflow capture coordinator that can use the same browser-native extension/ops session when available. Do not route primary Pinterest evidence through the current fresh headless no-extension deep-capture lane.
- Use `motion-evidence.json` as the canonical motion artifact, with compatibility summaries referenced from `evidence.json` and ready guidance.
- Treat snapshot-ready and motion-ready artifact validation as the workflow-owned contract produced after capture and before ranking. Do not add external analysis inputs to the public readiness path.

## Work Items

### PH-001 - Add Product Readiness Fields

**Goal:** Add machine-readable product readiness without changing operational success semantics.

**Done when:** CLI and tool responses expose `ready`, `readiness`, `harvestReadiness`, `productSuccess`, `artifactAuthority`, and `rankedReferenceCount`; empty ranked references produce `productSuccess:false`; existing `success:true` and `ok:true` still mean the command/workflow completed.

**Key files:** `src/cli/commands/inspiredesign.ts:51-65`, `src/cli/commands/inspiredesign.ts:331-353`, `src/tools/inspiredesign_run.ts:84-111`, `src/providers/workflows.ts:4448-4529`, `tests/cli-workflows.test.ts:724-734`, `tests/providers-inspiredesign-workflow.test.ts:2190-2339`.

**Dependencies:** None.

**Size:** S.

### PH-002 - Define Pinterest Media Classification

**Goal:** Introduce a first-class classification model for Pinterest candidates before capture strategy is selected.

**Done when:** References can be classified as `image_pin`, `video_pin`, `board`, `idea_page`, `source_page`, `shell`, `login_challenge`, or `invalid`; classification includes confidence, reasons, and source-page quality; invalid/shell/login/challenge candidates cannot enter ready ranking; boards and idea pages remain diagnostic unless concrete image or video media is extracted.

**Key files:** New `src/inspiredesign/pinterest-media-classification.ts`, `src/guidance/recipes/pinterest.ts:1-183`, `src/providers/browser-native-discovery.ts:319-386`, `src/providers/workflows.ts:2030-2178`, `tests/pinterest-guidance-recipe.test.ts:40-533`.

**Dependencies:** PH-001.

**Size:** M.

### PH-003 - Gate Pinterest Source-Page Quality During Discovery

**Goal:** Prevent search-shell or chrome-only pages from producing accepted URLs unless they expose real pin/grid/media signals.

**Done when:** Search-shell extraction without visual-grid or pin-content signals returns a bad-state diagnostic; accepted Pinterest URLs carry source-page quality metadata; existing canonical explicit URL recovery remains supported.

**Key files:** `src/providers/browser-native-discovery.ts:319-386`, `src/guidance/recipes/pinterest.ts:144-183`, `src/inspiredesign/reference-discovery.ts:92-110`, `tests/pinterest-guidance-recipe.test.ts:278-326`, `tests/providers-inspiredesign-workflow.test.ts:1658-1758`.

**Dependencies:** PH-002.

**Size:** M.

### PH-004 - Split Capture Strategy From Capture Mode

**Goal:** Stop treating Pinterest URL-backed harvest as DOM/clone deep capture by default, while preserving `--capture-mode off|deep` compatibility.

**Done when:** Pinterest harvest resolves an internal primary strategy such as `visual_first`, `motion_first`, or `visual_first_with_deep_diagnostics`; discovered Pinterest URLs no longer re-force DOM/clone deep capture as primary readiness; explicit `--capture-mode deep` still enables optional diagnostics/enrichment.

**Key files:** `src/inspiredesign/capture-mode.ts:1-12`, `src/providers/workflows.ts:4371-4388`, `src/cli/commands/inspiredesign.ts:326-340`, `docs/CLI.md:552-584`, `tests/cli-workflows.test.ts:537-577`.

**Dependencies:** PH-002, PH-003.

**Size:** M.

### PH-005 - Add Screenshot-First Image Capture Lane

**Goal:** Capture visual screenshot evidence for image pins before optional deep diagnostics.

**Done when:** Image pins capture viewport or targeted-media PNG evidence through the workflow capture coordinator before DOM/clone attempts; the coordinator uses the active browser-native extension/ops session when available; deep capture transport timeout cannot skip required visual evidence; screenshots still finalize through existing visual evidence artifact logic.

**Key files:** `src/providers/workflows.ts:2200-2499`, `src/inspiredesign/capture.ts:389-487`, `src/inspiredesign/visual-evidence.ts:16-83`, `src/browser/browser-manager.ts:2008-2099`, `src/browser/ops-browser-manager.ts:895-949`, `tests/providers-inspiredesign-capture.test.ts:152-452`, `tests/providers-inspiredesign-workflow.test.ts:700-1179`.

**Dependencies:** PH-004.

**Size:** L.

### PH-006 - Define Motion Evidence Persistence

**Goal:** Add a motion evidence artifact contract without breaking existing visual evidence consumers.

**Done when:** The workflow has a persisted motion evidence schema for replay metadata, preview metadata, frame count, warnings, and failure fields; `motion-evidence.json` is the canonical motion artifact; `evidence.json` can reference motion evidence; existing `visual-evidence.json` and `screenshot-index.json` schemas remain compatible.

**Key files:** New `src/inspiredesign/motion-evidence.ts`, `src/inspiredesign/contract.ts:2020-2342`, `src/providers/renderer.ts:825-940`, `src/providers/workflows.ts:4448-4529`, `tests/providers-inspiredesign-contract.test.ts:1210-1395`, `tests/providers-inspiredesign-workflow.test.ts:700-1179`.

**Dependencies:** PH-004.

**Size:** M.

### PH-007 - Add Screencast-First Video Capture Lane

**Goal:** Use existing browser replay primitives for Pinterest video pins.

**Done when:** Video pins start/stop screencast capture through the workflow capture coordinator; replay, frames, preview, and manifest metadata are handed to the motion evidence persistence layer; controls-only or zero-frame captures are diagnostic, not ranked design evidence.

**Key files:** `src/providers/workflows.ts:2200-2499`, `src/browser/screencast-recorder.ts`, `src/browser/browser-manager.ts:2008-2099`, `src/browser/ops-browser-manager.ts:895-949`, `src/cli/commands/devtools/screencast-start.ts:36-50`, `src/cli/commands/devtools/screencast-stop.ts:24-35`, `src/cli/daemon-commands.ts:611-624`.

**Dependencies:** PH-004, PH-005, PH-006.

**Size:** L.

### PH-008 - Add Visual And Motion Analysis Contract

**Goal:** Require actual analysis before screenshot or screencast artifacts can rank as design-ready evidence.

**Done when:** Screenshot metadata alone cannot make a Pinterest reference ready unless it points to a persisted canonical pin viewport screenshot that is not blank, tiny, login, challenge, search-shell, or chrome-only; motion metadata alone cannot make a video pin ready unless it points to motion-ready screencast evidence; tests cover both ready and diagnostic outcomes without external analysis inputs.

**Key files:** `src/inspiredesign/reference-pattern-board.ts:369-599`, `src/inspiredesign/contract.ts:2020-2342`, `src/providers/workflows.ts:2200-2499`, `tests/providers-inspiredesign-contract.test.ts:1210-1395`.

**Dependencies:** PH-005, PH-006, PH-007.

**Size:** L.

### PH-009 - Update Ranking For Analyzed Visual And Motion Evidence

**Goal:** Make analyzed screenshot and screencast evidence first-class ranking inputs for Pinterest.

**Done when:** Image pins can rank from snapshot-ready screenshots without DOM/clone evidence; video pins can rank from motion-ready screencasts; Pinterest chrome, search shell, login/challenge, small media, and controls-only captures remain rejected.

**Key files:** `src/inspiredesign/reference-pattern-board.ts:369-599`, `src/inspiredesign/reference-pattern-board.ts:849-906`, `src/inspiredesign/contract.ts:2020-2342`, `tests/providers-inspiredesign-contract.test.ts:1210-1395`.

**Dependencies:** PH-008.

**Size:** L.

### PH-010 - Add All-Attempt Quality Counters

**Goal:** Align high-level quality metrics with all attempted references, not only ranked references.

**Done when:** `ranked-references.json` reports attempted reference count, all-attempt failed capture count, all-attempt missing screenshot count, all-attempt visual failure count, and all-attempt motion failure count; existing ranked-only counters are either preserved with clear names or supplemented; guidance uses all-attempt required evidence failures.

**Key files:** `src/inspiredesign/reference-pattern-board.ts:870-890`, `src/providers/workflows.ts:2860-2999`, `src/guidance/context.ts:105-139`, `src/guidance/readiness.ts:45`, `tests/providers-inspiredesign-contract.test.ts:1210-1395`, `tests/providers-inspiredesign-workflow.test.ts:994-1179`.

**Dependencies:** PH-006, PH-007, PH-009.

**Size:** M.

### PH-011 - Preserve Recovery Provenance

**Goal:** Prevent recovery guidance from blindly retrying weak or rejected Pinterest URLs.

**Done when:** Guidance distinguishes user-supplied, discovered, shell-derived, rejected, weak, capture-failed, and ready URLs; recovery suggests replacement discovery unless explicit recapture is appropriate; canonical explicit URL recovery remains supported.

**Key files:** `src/inspiredesign/reference-discovery.ts:92-110`, `src/providers/workflows.ts:2030-2178`, `src/guidance/context.ts:105-139`, `src/guidance/recipes/generic.ts:436-711`, `tests/providers-inspiredesign-workflow.test.ts:2190-2339`.

**Dependencies:** PH-003, PH-010.

**Size:** M.

### PH-012 - Mark Diagnostic Artifact Authority

**Goal:** Make non-ready bundles unambiguously diagnostic-only and non-authoritative.

**Done when:** Responses include `artifactAuthority`; `design-agent-handoff.json`, `evidence.json`, `ranked-references.json`, and context payloads include authority metadata; markdown artifacts start with a diagnostic-only warning when not ready; Canvas plan request remains omitted when not ready.

**Key files:** `src/providers/renderer.ts:192-285`, `src/providers/renderer.ts:825-940`, `src/inspiredesign/contract.ts:2020-2342`, `src/providers/workflows.ts:4448-4529`, `tests/providers-inspiredesign-workflow.test.ts:2190-2339`.

**Dependencies:** PH-001, PH-010.

**Size:** M.

### PH-013 - Tighten Canvas Ready-Reference Gate

**Goal:** Ensure Canvas continuation only uses ready references backed by snapshot-ready or motion-ready evidence.

**Done when:** Canvas remains blocked unless readiness is `ready`; `canvas-plan.request.json` is emitted only when ready; Pinterest ready references require snapshot-ready or motion-ready evidence; diagnostic references are excluded from Canvas plan context.

**Key files:** `src/providers/renderer.ts:192-285`, `src/providers/renderer.ts:825-940`, `src/inspiredesign/contract.ts:2020-2342`, `src/inspiredesign/reference-pattern-board.ts:900-990`, `src/guidance/recipes/generic.ts:580-711`, `tests/providers-inspiredesign-workflow.test.ts:2190-2339`.

**Dependencies:** PH-009, PH-012.

**Size:** M.

### PH-014 - Fold Metadata Into Existing Responses And Artifacts

**Goal:** Surface strategy, classification, analysis, and evidence outcomes as part of the response/artifact changes above, without creating a separate metadata subsystem.

**Done when:** `meta.selection` includes primary capture strategy; discovery diagnostics include classification and source quality counts; metrics include all-attempt visual and motion counters; artifact manifest includes visual and motion evidence files.

**Key files:** `src/providers/workflows.ts:2860-2999`, `src/providers/workflows.ts:4448-4529`, `src/inspiredesign/contract.ts:2020-2342`, `src/providers/renderer.ts:825-940`, `tests/providers-inspiredesign-workflow.test.ts:700-1179`.

**Dependencies:** PH-001, PH-002, PH-006, PH-008, PH-010, PH-012.

**Size:** S.

### PH-015 - Update Existing Tests For The New Contract

**Goal:** Convert existing Pinterest and visual-evidence expectations to the new analysis-gated behavior without weakening chrome/shell rejection.

**Done when:** Clean Pinterest screenshot tests include visual analysis when expecting ready; screenshot metadata without analysis is rejected; chrome-only tests remain rejected; missing screenshot assertions use all-attempt fields; URL recovery compatibility and Canvas blocking tests still pass.

**Key files:** `tests/providers-inspiredesign-contract.test.ts:1210-1395`, `tests/providers-inspiredesign-workflow.test.ts:700-1179`, `tests/providers-inspiredesign-workflow.test.ts:1400-1939`, `tests/providers-inspiredesign-workflow.test.ts:2190-2339`, `tests/pinterest-guidance-recipe.test.ts:40-533`.

**Dependencies:** PH-008, PH-009, PH-010, PH-011, PH-013.

**Size:** M.

### PH-016 - Add End-To-End Pinterest Product Flow Tests

**Goal:** Prove the intended Pinterest harvest product outcomes.

**Done when:** An image pin can become product-ready from screenshot plus visual analysis; a video pin can become product-ready from screencast plus motion analysis; deep capture timeout does not block primary visual/motion evidence; controls-only video remains diagnostic; source-page shell remains rejected; diagnostic runs expose `productSuccess:false`.

**Key files:** `tests/providers-inspiredesign-workflow.test.ts`, `tests/providers-inspiredesign-capture.test.ts`, `tests/providers-inspiredesign-contract.test.ts`, `tests/cli-workflows.test.ts`.

**Dependencies:** PH-001, PH-005, PH-007, PH-008, PH-009, PH-010, PH-012, PH-013.

**Size:** L.

### PH-017 - Update CLI And Surface Documentation

**Goal:** Document the new Pinterest behavior and compatibility rules.

**Done when:** Docs no longer say every Pinterest URL forces DOM/layout deep capture as primary readiness; docs explain operational success versus product success; docs cover `visual-evidence.json`, `motion-evidence.json`, diagnostic authority, recovery behavior, and Canvas readiness gate.

**Key files:** `docs/CLI.md:536-584`, `docs/CLI.md:1368-1398`, `docs/SURFACE_REFERENCE.md:550-560`, `docs/plans/pinterest-harvest-visual-first-implementation-plan-2026-05-23.md`.

**Dependencies:** PH-001 through PH-016.

**Size:** M.

## Final Acceptance Checklist

- Existing response fields remain available, including operational `success` and tool `ok`.
- New product-readiness fields are additive and documented.
- Existing `visual-evidence.json` and `screenshot-index.json` consumers remain compatible.
- `motion-evidence.json` is additive.
- Explicit Pinterest URL recovery still works.
- Intentional Pinterest ranking behavior changes are documented.
- Formatter, linter, typecheck, targeted inspiredesign tests, and relevant full test suites pass.

## Open Questions

- No external analysis producer is required for this implementation. Product readiness is decided from validated snapshot-ready and motion-ready artifact evidence.

## References

- `docs/investigations/pinterest-harvest-snapshot-first-consolidated-2026-05-22.md`
- `docs/investigations/inspiredesign-harvest-readiness-and-pinterest-evidence-quality-2026-05-22.md`
- `docs/investigations/pinterest-fashion-studio-harvest-canvas-evaluation-2026-05-22.md`
- `docs/plans/inspiredesign-harvest-recovery-and-browser-output-artifacts-2026-05-21.md`
