# Architecture Synthesis: Annotation, Canvas, and Inspired Design

## Context and scope

This synthesis is plan-only. It reads the audit bundle at `.omo/ulw-research/20260629-154309-canvas-annotation-audit`, current architecture docs, and focused read-only probes for annotation, canvas, and Inspired Design. The architecture goal is not to bolt on three features. It is to protect existing tools while adding an agent-safe handoff layer for annotation, a workspace layer over existing canvas sessions, and stricter evidence semantics for Inspired Design.

Primary source contracts checked: `docs/ANNOTATE.md`, `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md`, `docs/CANVAS_BIDIRECTIONAL_CODE_SYNC_TECHNICAL_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/investigations/inspiredesign-motion-evidence-media-analysis-2026-06-28.md`, and `docs/plans/inspiredesign-media-motion-analysis-2026-06-28.md`.

## Dependency graph and sequencing

1. **Annotation contract before behavior.** Add `schemaVersion: 2`, compact handoff types, selector bundle shape, and identity confidence fields in the shared protocol surface before changing copy, send, or inbox injection. The current risk is duplicated protocol ownership between `src/relay/protocol.ts` and `extension/src/types.ts`.
2. **Redaction before compact output.** Extract one reusable sanitizer from the current output and inbox behavior, then use it for compact copy, relay send, inbox persistence, and system injection. Do not introduce a compact format that can leak what the full payload already strips.
3. **Compact builder before UI wiring.** Centralize `annotation.compact` in the extension annotation payload layer so popup, in-page annotator, and canvas do not diverge. Only after that should default Copy and Send switch to compact agent-facing handoff while explicit raw retrieval remains available.
4. **Canvas isolation before 4x2 UI.** Add workspace identity, child routing, and conflict guards first: `workspaceId`, `childId`, `canvasSessionId`, `documentId`, repo path, lease, BroadcastChannel/cache keys, and code-sync binding paths. A 4x2 grid before isolation would make cross-child mutation likely.
5. **Canvas workspace over child sessions.** Implement `CanvasWorkspace` as refs-only orchestration above existing single-document `CanvasManager` sessions. Do not redesign one `CanvasSession` to contain 8 documents first, because that would disturb revision streams, history, lease scope, feedback, code sync, and extension singleton state.
6. **Preview budget before eight live panes.** Add workspace-level preview scheduling with focused, pinned live, background live, thumbnail, and paused states before rendering eight panes in the extension.
7. **Inspired Design authority semantics before motion enrichment.** Preserve `pin-media-index.json` as Pinterest readiness/provenance authority, `motion-evidence.json` as browser replay authority, and `media-analysis.json` as non-authoritative saved-media design facts. Add saved-media motion signatures only after tests prove readiness fields are unchanged.
8. **Strict harvest proof after preflight hardening.** The audit's strict Inspired Design run was blocked by duplicate port startup failure. Any implementation plan must require fresh daemon preflight with `fingerprintCurrent === true`, unique config/cache roots, unique ports/tokens, and direct artifact inspection.

## Top under-specified seams

- **Compact payload budget:** exact byte budget, truncation priority, required fields, per-field max lengths, and fallback text are not yet specified.
- **Selector bundle:** direct CDP can know backend node/frame facts that extension-only capture may not. The plan must define which locators are required per transport and how confidence is expressed.
- **Component identity:** stable sources should be explicit `data-component*`, test ids, canvas binding metadata, custom elements, then weak DOM fallback. React/Vue/Svelte private internals should remain debug-only unless explicitly opted in and redacted.
- **Annotation placement:** audit identifies fixed right-side notes and dropped click coordinates. The plan needs a pure placement function with anchor-first collision scoring, viewport clamp, panel avoidance, resize re-clamp, and mobile side-panel fallback.
- **Canvas workspace persistence:** workspace manifest must be refs-only. It must never duplicate child documents or delete children on workspace close.
- **Workspace command names:** additive `canvas.workspace.*` commands are plausible, but final names must be synced with public-surface source, generated manifests, CLI docs, and command inventory tests.
- **Inspired Design strict harvest:** on-brief visual evidence remains unresolved. A CLI `success: true` or exit code `0` is not enough when readiness is diagnostic-only.

## Contradictions to avoid

- Do not claim annotation delivery when receipt state is `stored_only`, `no_active_scope`, or `ambiguous_scope`.
- Do not persist screenshot bytes in the shared inbox. Asset refs are acceptable; base64 is not.
- Do not make compact copy the only recovery path. Raw/full payload access must be explicit and bounded.
- Do not call framework-private runtime metadata stable component identity.
- Do not implement 8 documents inside one existing canvas session as a shortcut.
- Do not claim `bound_app_runtime` parity when the safe preview/export contract is still `canvas_html`.
- Do not let `media-analysis.json` pass or fail product readiness. It is design facts only.
- Do not treat empty `motion-evidence.json` as no saved-video motion analysis. It means no browser screencast replay evidence.

## Best-class UX guardrails

Annotation should behave like an actionable handoff, not a dump: visible target label, concise note, URL/title, viewport, rect, ordered locator bundle, component path when stable, evidence refs, redaction metadata, and clear delivered vs stored-only feedback. Placement should feel anchored to the selected element, keyboard accessible, collision-aware, and never cover the target without a connector or fallback panel.

Canvas 4x2 should be an agent workspace, not a visual grid alone. It needs coordinator controls, active full-control pane, worker panes with role labels, visible child routing, per-child status/revision/lease/preview state, activity log, review/checkpoint lane, and deterministic degraded states. One focused live preview by default is a product guardrail, not a limitation.

Inspired Design UX must show authority plainly: product-ready vs diagnostic-only, pin-media-ready vs snapshot/motion-ready, saved-media sampled motion vs browser replay. Handoff language must not imply optical flow, object tracking, hover/scroll choreography, or semantic video understanding from bounded FFmpeg frame sampling.

## Review loops and acceptance gates

Run each lane as review, fix, real workflow proof, review again. For annotation, prove compact payload byte reduction, no screenshot base64, redaction before disk/injection, delivered/stored-only/ambiguous/no-scope/relay-failure/MV3 restart paths, and identity top-1/top-3 fixtures. For canvas, prove child A patch/undo/save cannot change child B, conflicts are detected for same doc/repo path/code-sync binding, eight panes open without uncontrolled live-preview fanout, workspace close preserves children, and all existing single-canvas commands remain green. For Inspired Design, inspect artifacts directly: `evidence.json`, `ranked-references.json`, `pin-media-index.json`, `motion-evidence.json`, `media-analysis.json`, `bundle-manifest.json`, hashes, bytes, readiness fields, and top-reference relevance.

Do not accept self-reported success. Completion requires focused tests, docs/public-surface drift checks, generated manifest sync when surfaces change, lint, typecheck, build, full tests, and coverage gates with zero warnings. Diagnostic-only Inspired Design bundles fail acceptance even when commands exit successfully.
