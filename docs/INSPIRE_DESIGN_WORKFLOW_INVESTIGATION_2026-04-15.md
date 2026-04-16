# Investigation: Inspire Design Workflow

Status: active research
Date: 2026-04-15
Scope: investigation only, no source-code changes

## Summary

OpenDevBrowser already has most of the infrastructure needed for an Inspire-style design workflow. It can capture live references from websites and DOM elements, annotate screenshots, clone page or component structure, store a rich design-governance model in `/canvas`, and render HTML or TSX previews from canonical canvas documents. The main gap is not low-level capture or design-governance richness. The main gap is a first-class, generic inspiration-ingest and canonicalization workflow that accepts non-Figma sources and turns them into a reusable contract artifact such as `design.md` and, optionally, seeded canvas preview state.

## Symptoms

- The proposed feature needs to ingest one or more inspiration sources such as websites, DOM elements, screenshots, images, or files.
- The desired output is a reusable design contract, `design.md` by default and optionally JSON, plus an optional HTML prototype.
- The repo already ships Canvas, DOM inspection, clone/export, annotation, and design-agent workflow assets, but it is unclear whether those pieces already form a first-class end-to-end product surface.

## Investigation Log

### Phase 1 - Design governance and contract model

Hypothesis: the repo does not yet have a strong enough design-governance model to serve as the output contract for an Inspire feature.

Findings:

- `/canvas` already defines a rich typed generation plan and a broader design-governance document model.
- The design-agent skill pack already ships a contract-first workflow, a research-harvest workflow, a design contract template, and a reference pattern board template.
- The canvas core validates generation-plan sections such as visual direction, layout, component strategy, motion, responsive posture, accessibility posture, and validation targets.

Evidence:

- `src/canvas/types.ts:349-357` defines `CanvasGenerationPlan` with `targetOutcome`, `visualDirection`, `layoutStrategy`, `contentStrategy`, `componentStrategy`, `motionPosture`, `responsivePosture`, `accessibilityPosture`, and `validationTargets`.
- `src/canvas/types.ts:763-791` defines `CanvasDesignGovernance` and `CanvasDocument`, including governance blocks for `intent`, `generationPlan`, `designLanguage`, `contentModel`, `layoutSystem`, `typographySystem`, `colorSystem`, `surfaceSystem`, `iconSystem`, `motionSystem`, `responsiveSystem`, `accessibilityPolicy`, `libraryPolicy`, and `runtimeBudgets`.
- `src/canvas/document-store.ts:1446-1609` validates the required generation-plan sections and rejects missing or invalid plan fields.
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:1-66` documents the canonical canvas document model, required governance blocks, public command families, and preview loop.
- `skills/opendevbrowser-design-agent/SKILL.md:110-171` defines the contract-first and research-harvest workflow expectations and explicitly points to the contract and pattern-board templates.
- `skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json:1-226` already captures design language, content model, typography, motion, responsiveness, accessibility, and generation plan as a reusable contract artifact.
- `skills/opendevbrowser-design-agent/assets/templates/reference-pattern-board.v1.json:1-31` already captures multi-reference inputs, component families, motion posture, token notes, and synthesis deltas.
- `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md:1-81` already describes turning live product references into a deterministic pattern board before implementation.

Conclusion:

The hypothesis is eliminated. OpenDevBrowser does not need a new design-contract model from scratch. A future Inspire feature should map into the existing design-contract and canvas-governance model.

### Phase 2 - Website, DOM, screenshot, and component capture

Hypothesis: the repo lacks the raw capture primitives needed to inspect websites, DOM elements, screenshots, and component-level references.

Findings:

- The snapshot lane is explicitly AX-tree based and resolves semantic refs back to DOM selectors.
- Public tools already exist to capture snapshots, fetch an element's `outerHTML`, clone a page, and clone a selected element subtree.
- Annotation already supports screenshot-backed, structured capture with markdown summaries and stored payload retrieval.

Evidence:

- `docs/ARCHITECTURE.md:136-140` defines the runtime data flow as `Snapshot (AX-tree -> refs)` followed by `Action (ref -> backendNodeId -> DOM)`.
- `src/snapshot/ops-snapshot.ts:1-177` builds snapshot entries from the browser accessibility tree, assigns semantic refs, and resolves selectors back to DOM nodes.
- `src/tools/snapshot.ts:1-36` exposes a public `snapshot` tool that captures the current page and returns refs.
- `src/tools/dom_get_html.ts:1-35` exposes a public `dom_get_html` tool that returns `outerHTML` for a referenced element.
- `src/tools/clone_page.ts:1-24` exposes `clone_page` as a React component and CSS export for the active page.
- `src/tools/clone_component.ts:1-25` exposes `clone_component` as a React component and CSS export for a selected element subtree.
- `src/browser/browser-manager.ts:1767-1962` implements `domGetHtml`, `clonePage`, `clonePageHtmlWithOptions`, and `cloneComponent` on the live browser surface.
- `src/tools/annotate.ts:1-76` exposes interactive annotation across direct and relay transports.
- `docs/ANNOTATE.md:6-8` states that annotation returns a markdown summary plus structured data and screenshots.
- `docs/ANNOTATE.md:127-149` documents screenshot modes and output fields for `message`, `details`, and `screenshots`.
- `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md:16-37` already recommends `snapshot`, `screenshot`, and `debug-trace-snapshot` when collecting external design references.

Conclusion:

The hypothesis is eliminated for website, DOM, screenshot, and component capture. OpenDevBrowser already has a strong capture plane for inspiration gathering. The only unresolved input area is arbitrary local files and non-page image ingestion, which are not established as first-class runtime lanes in the selected evidence.

### Phase 3 - Canonical import, preview, and export boundary

Hypothesis: the existing `canvas.document.import` path is already generic enough to serve as the canonical bridge from arbitrary inspiration sources into canvas state.

Findings:

- The type surface looks generic at first glance, but the implemented import path is explicitly Figma-shaped.
- `CanvasManager` immediately normalizes import requests through `normalizeFigmaImportRequest(...)`.
- The Figma URL parser requires a Figma `sourceUrl` or `fileKey`, and provenance is stamped with `figma.file` or `figma.nodes` plus the `figma-rest-v1` dialect.
- Once a canonical `CanvasDocument` exists, HTML preview and TSX export are already first-class and strong.

Evidence:

- `src/canvas/types.ts:587-640` defines `CanvasDocumentImportRequest`, `CanvasImportSource`, `CanvasImportProvenance`, and `CanvasDocumentImportResult`.
- `src/browser/canvas-manager.ts:694-813` implements `importDocument(...)` and immediately routes requests through `normalizeFigmaImportRequest(readCanvasDocumentImportRequest(params))` before calling `FigmaClient` and `mapFigmaImportToCanvas(...)`.
- `src/integrations/figma/url.ts:1-67` requires a Figma `sourceUrl` or `fileKey` and rejects unsupported hostnames and URL shapes.
- `src/browser/canvas-manager.ts:4469-4514` builds provenance with `kind: "figma.file" | "figma.nodes"` and `sourceDialect: "figma-rest-v1"`.
- `docs/SURFACE_REFERENCE.md:349-412` documents `canvas.document.import` as importing Figma file URLs, node URLs, or raw file-key inputs.
- `src/canvas/export.ts:1179-1235` implements `renderCanvasDocumentHtml(...)` and `renderCanvasDocumentComponent(...)` for canonical HTML and TSX output.
- `src/browser/canvas-manager.ts:3115-3128` builds preview HTML by calling `renderCanvasDocumentHtml(...)` with the selected prototype and optional `sourceUrl`.
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:41-66` documents `canvas.preview.render`, `canvas.document.export`, and the patch -> preview -> feedback -> save/export loop.

Conclusion:

The hypothesis is eliminated. OpenDevBrowser already has a strong preview and export plane, but the only clearly first-class import path into canonical canvas state is Figma-specific.

### Phase 4 - What Inspire already is versus what is missing

Hypothesis: an Inspire feature would require a brand-new subsystem across capture, governance, and preview.

Findings:

- That is not what the evidence shows.
- The repo already supports a manual or semi-structured Inspire workflow today: capture live references, inspect DOM or annotate screenshots, record findings in a reference pattern board, translate the synthesis into a design contract, extract a generation plan, then render or export through `/canvas`.
- The missing seam is a runtime-owned, generic canonicalization pipeline for non-Figma inspiration sources.

Evidence:

- `skills/opendevbrowser-design-agent/SKILL.md:149-171` defines `research-harvest` and `screenshot-audit` modes that already translate external references into the same contract fields used by `/canvas`.
- `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md:1-81` explicitly instructs operators to capture `3` to `5` live references, record borrow and reject decisions, and translate them into contract deltas.
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md:41-66` documents the canonical operator loop after a contract or generation plan exists.
- `docs/SURFACE_REFERENCE.md:299-300` exposes `export.clonePage` and `export.cloneComponent` as separate prototype-adjacent lanes.
- `docs/SURFACE_REFERENCE.md:402-412` shows the other prototype-adjacent lane through canonical `/canvas` import and preview.

Conclusion:

The hypothesis is eliminated. The missing work is not foundational runtime invention. The missing work is productization and orchestration: a single public seam that turns heterogeneous inspiration inputs into canonical design-contract and preview outputs.

## Root Cause

The current architecture is split into three mature planes:

- A capture plane: `snapshot`, AX-tree refs, DOM extraction, page and component cloning, screenshots, and annotation.
- A contract plane: `CanvasDesignGovernance`, `CanvasGenerationPlan`, the design-agent contract template, and the reference pattern board.
- A preview/export plane: canonical canvas HTML and TSX rendering plus live preview through `canvas.preview.render`.

The bridge between those planes is not yet a first-class generic runtime feature. For non-Figma sources, the transformation from raw inspiration into canonical design state still appears to happen through skill workflows, templates, and agent reasoning rather than through a dedicated typed import boundary. The implemented runtime import path is first-class only for Figma.

## Recommendations

1. Add a generic inspiration input schema with explicit source kinds such as `website`, `dom_ref`, `annotation_payload`, `screenshot`, `image`, and `file`, along with provenance, confidence, and extraction metadata.
2. Add a first-class public Inspire surface, CLI or tool, that owns the capture -> synthesis -> contract flow instead of leaving that orchestration in skill docs and ad hoc agent behavior.
3. Keep `CanvasDesignGovernance` and the existing design-contract template as the canonical contract target instead of creating a parallel design-governance model.
4. Introduce a non-Figma canonicalization path into `CanvasDocument`, or a closely related intermediate model, so generic inspiration sources can seed `/canvas` without pretending to be Figma.
5. Make `design.md` the default human-readable contract artifact, with optional JSON output for machine handoff and explicit provenance links back to captured references.
6. Keep prototype generation split by intent: `clone_page` and `clone_component` remain useful for non-canonical exploratory exports, while `/canvas` remains the canonical preview and export path after contract synthesis.
7. Clarify support boundaries for arbitrary local files and non-page images before documenting them as supported inspiration inputs.

## Preventive Measures

- Do not overload the current Figma import request shape to represent generic website or image inspiration.
- Keep provenance explicit from reference capture through contract synthesis so borrowed and rejected patterns remain auditable.
- Keep `/canvas` as the canonical governance and preview surface; use clone exports as reference or bootstrap helpers, not as the source of truth.
- Treat research-harvest, screenshot-audit, and canvas-contract as the compatibility bridge while the first-class Inspire surface does not yet exist.
