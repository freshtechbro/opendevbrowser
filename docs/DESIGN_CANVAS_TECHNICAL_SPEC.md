# Design Canvas Technical Specification

Status: proposed  
Date: 2026-03-09

Related documents:
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/DESIGN_CANVAS_RESEARCH.md`
- `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/DESIGN_CANVAS_RESEARCH.md`

## Overview

This specification defines the first supported architecture for a live design canvas in OpenDevBrowser.

The feature must let an agent:

- create low-fi wireframes and high-fi live page edits
- work across multiple prototype tabs and pages
- see runtime feedback quickly enough to correct designs in the same loop
- persist design state as a repo-native artifact instead of leaving the result trapped in browser memory

This spec chooses a DRY architecture:

- `/canvas` is a separate product surface
- `/canvas` reuses shared `/ops` transport/runtime primitives
- overlay mode and dedicated design-tab mode both ship in v1
- the user workflow stays single-user and local-first in v1
- Yjs is included from the start, but only as the shared document layer

Why Yjs is still justified in a single-user v1:

- the same design document can be open in the design tab, overlay renderer, and preview targets at the same time
- local refresh, crash recovery, and reconnect-safe convergence matter before multi-user collaboration exists
- Yjs solves shared document convergence, while `/canvas` and `/ops` continue to own browser control, leases, and routing

## Non-Goals

This spec does not include:

- multi-user collaboration in v1
- a GrapesJS, tldraw, or Excalidraw model as the canonical saved format
- offscreen-document or side-panel-first hosting
- feature flags or backward-compatibility shims

## Source Constraints

The current repo already determines several hard constraints:

- `/ops` is the current high-level extension control plane and already provides typed request, response, event, ping, pong, and chunk envelopes.
- `/ops` ownership is lease-based. Any reused canvas transport must preserve session ownership and reconnect semantics.
- `/annotation` is valuable for visible overlay reuse, but it is single-client and request/response oriented. It is not the main document-sync channel.
- current `/ops` diagnostics are strongest for console, network, perf, and screenshots. A target-filtered design feedback layer still needs to be added.
- extension-backed flows are headed-only and reject restricted targets.
- the target-scoped governor already serializes work per target and only parallelizes across targets up to the configured cap.

Primary repo anchors:

- `src/relay/protocol.ts`
- `src/relay/relay-server.ts`
- `src/browser/ops-browser-manager.ts`
- `src/browser/annotation-manager.ts`
- `extension/src/ops/ops-runtime.ts`
- `extension/src/services/TargetSessionMap.ts`
- `src/export/react-emitter.ts`
- `src/export/css-extract.ts`

## Product Decisions

- Scope: support both low-fi wireframes and high-fi live page editing in v1.
- Public surface: introduce `/canvas` separately.
- Internal architecture: reuse `/ops` helpers and contracts wherever possible.
- Persisted format: use a custom OpenDevBrowser JSON document.
- Editor surfaces: support both overlay mode and dedicated design-tab mode.
- Data model: adopt Yjs from the start, but only at the document layer.
- User workflow: single-user on one machine in v1.
- Code integration: keep export, clone, and React/component generation tightly coupled.

## Architecture

## Public Surface

`/canvas` is the dedicated design surface. It is a relay-facing contract, not a second unrelated runtime stack.

`/canvas` must reuse shared core concerns already proven in `/ops`:

- request envelope validation
- lease ownership
- target routing
- chunked payload transport
- backpressure handling
- error envelopes
- daemon and hub binding behavior

The distinction is intentional:

- `/ops` remains the general browser-control surface
- `/canvas` becomes the design-specific surface with design-specific commands and feedback

## Capability and Governance Handshake

The agent must not be expected to infer the design contract from documentation alone.
OpenDevBrowser must expose the contract it expects before the first mutation.

Handshake opener:

- `canvas.session.open` opens the session and returns the handshake payload

Refresh path:

- `canvas.capabilities.get` returns the current handshake again if the agent needs to refresh requirements after document or policy changes

Required handshake payload:

```json
{
  "canvasSessionId": "canvas_session_01",
  "browserSessionId": "browser_session_01",
  "leaseId": "lease_01",
  "schemaVersion": "1.0.0",
  "policyVersion": "2026-03-09",
  "documentId": "dc_01...",
  "preflightState": "handshake_read",
  "governanceRequirements": {
    "requiredBeforeMutation": [
      "intent",
      "generationPlan",
      "designLanguage",
      "contentModel",
      "layoutSystem",
      "typographySystem",
      "motionSystem",
      "responsiveSystem",
      "accessibilityPolicy"
    ],
    "requiredBeforeSave": [
      "intent",
      "generationPlan",
      "designLanguage",
      "contentModel",
      "layoutSystem",
      "typographySystem",
      "colorSystem",
      "surfaceSystem",
      "iconSystem",
      "motionSystem",
      "responsiveSystem",
      "accessibilityPolicy",
      "libraryPolicy",
      "runtimeBudgets"
    ],
    "optionalInherited": [
      "colorSystem",
      "surfaceSystem",
      "iconSystem",
      "libraryPolicy",
      "runtimeBudgets"
    ]
  },
  "generationPlanRequirements": {
    "requiredBeforeMutation": [
      "targetOutcome",
      "visualDirection",
      "layoutStrategy",
      "contentStrategy",
      "componentStrategy",
      "motionPosture",
      "responsivePosture",
      "accessibilityPosture",
      "validationTargets"
    ]
  },
  "supportedVariantDimensions": ["viewport", "theme", "interaction", "content"],
  "allowedLibraries": {
    "icons": ["3dicons", "tabler", "microsoft-fluent-ui-system-icons", "@lobehub/fluent-emoji-3d"],
    "components": [],
    "motion": [],
    "threeD": []
  },
  "governanceBlockStates": {
    "intent": { "status": "missing", "source": "document", "editable": true },
    "generationPlan": { "status": "missing", "source": "document", "editable": true },
    "designLanguage": { "status": "missing", "source": "document", "editable": true },
    "contentModel": { "status": "missing", "source": "document", "editable": true },
    "layoutSystem": { "status": "missing", "source": "document", "editable": true },
    "typographySystem": { "status": "missing", "source": "document", "editable": true },
    "colorSystem": { "status": "inherited", "source": "project-default", "editable": true },
    "surfaceSystem": { "status": "inherited", "source": "project-default", "editable": true },
    "iconSystem": { "status": "inherited", "source": "project-default", "editable": true },
    "motionSystem": { "status": "missing", "source": "document", "editable": true },
    "responsiveSystem": { "status": "missing", "source": "document", "editable": true },
    "accessibilityPolicy": { "status": "missing", "source": "document", "editable": true },
    "libraryPolicy": { "status": "inherited", "source": "project-default", "editable": true },
    "runtimeBudgets": { "status": "inherited", "source": "project-default", "editable": true }
  },
  "runtimeBudgets": {
    "defaultLivePreviewLimit": 2,
    "maxPinnedFullPreviewExtra": 1,
    "reconnectGraceMs": 20000,
    "overflowRenderMode": "thumbnail_only"
  },
  "warningClasses": ["missing-generation-plan", "missing-intent", "runtime-budget-exceeded"],
  "mutationPolicy": {
    "planRequiredBeforePatch": true,
    "allowedBeforePlan": [
      "canvas.capabilities.get",
      "canvas.plan.get",
      "canvas.plan.set",
      "canvas.document.load",
      "canvas.session.status"
    ]
  },
  "documentContext": {
    "status": "existing",
    "existingGovernanceBlocks": ["colorSystem", "surfaceSystem", "iconSystem"],
    "missingGovernanceBlocks": [
      "intent",
      "generationPlan",
      "designLanguage",
      "contentModel",
      "layoutSystem",
      "typographySystem",
      "motionSystem",
      "responsiveSystem",
      "accessibilityPolicy"
    ],
    "tokensPresent": true,
    "themesPresent": true,
    "viewportsPresent": true,
    "componentInventoryPresent": true
  }
}
```

Required rules:

- every `canvas.session.open` response must include the handshake payload
- handshake fields must be machine-readable and stable enough for agent automation
- `canvasSessionId` is the runtime identity for `/canvas`; it must not be overloaded with the existing OpenDevBrowser browser `sessionId`
- `browserSessionId` is the OpenDevBrowser browser-session identity used for live target control; it may be `null` only for document-only canvas work
- `leaseId` is the runtime ownership token for the canvas session and must be echoed on commands that can mutate document state or live targets
- if a document already exists, the handshake must expose which governance blocks are already present and which remain missing
- the handshake must classify governance blocks as `requiredBeforeMutation`, `requiredBeforeSave`, or `optionalInherited`
- `governanceBlockStates` statuses are limited to `present`, `missing`, `inherited`, or `locked`
- if project adapters or library policies are already known, the handshake must expose them
- the handshake must explicitly state whether patching is blocked until `generationPlan` is accepted
- the handshake is the canonical way OpenDevBrowser tells the agent what to prepare before it sends design instructions
- docs may explain the contract, but the live handshake is what governs runtime behavior

## Session and Identity Contract

The implementation must keep runtime, document, and target identities separate.

- `canvasSessionId`: runtime identity for one `/canvas` session; one agent/client owns it at a time through `leaseId`
- `browserSessionId`: existing OpenDevBrowser browser-session identity used to reach live tabs and targets
- `documentId`: stable persisted workspace identity; one document may contain many pages and many prototype routes
- `pageId`: stable page or frame-root identity inside a document
- `prototypeId`: stable preview definition that points to one page plus default variant selectors and target preferences
- `targetId`: runtime browser target identity used by overlay and preview commands
- `leaseId`: runtime ownership token that gates reconnect, mutation, overlay, and preview actions

Required cardinality and ownership rules:

- one `documentId` may contain multiple `pageId` and `prototypeId` records
- one `canvasSessionId` works on one active `documentId` at a time
- one `prototypeId` may drive zero or more runtime preview `targetId` values, but only one may be the focused preview target
- `canvasSessionId` plus `leaseId` must gate `canvas.plan.set`, `canvas.document.patch`, `canvas.overlay.*`, and `canvas.preview.*`
- reconnect grace defaults to `20000` ms to match current `/ops` session reclaim timing in the extension runtime
- if a reconnect occurs during the grace window with the same `leaseId`, the session may reclaim ownership; otherwise the runtime must emit an explicit lease-reclaim blocker instead of silently rebinding

## Skill Delivery Contract

The runtime handshake is authoritative, but the product must also teach the contract through the existing skill surfaces the agent already uses.

V1 planning decision:

- do not introduce a separate `design-canvas` skill
- deliver the runtime side through the repo-packaged `skills/opendevbrowser-best-practices/`
- deliver the design-semantics side through the global Codex `design-agent` skill

Responsibility split:

- bundled `opendevbrowser-best-practices` skill
  - teaches `/canvas` session order, command flow, blocker handling, and runtime evaluation
  - is packaged and distributed with OpenDevBrowser
- global `design-agent` skill
  - teaches the meaning of governance blocks and required `generationPlan` fields
  - teaches the planning skeleton the agent should prepare before first mutation

The runtime handshake stays canonical in all cases.
Skills are preparation aids, not a replacement for `canvas.session.open`.

Required future changes to the bundled repo skill pack:

- update `skills/opendevbrowser-best-practices/SKILL.md` with a dedicated `Canvas Governance Handshake` section
- extend `skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md` so it documents `/canvas`, the handshake payload, and `plan_required`
- add `skills/opendevbrowser-best-practices/artifacts/canvas-governance-playbook.md`
- extend `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh` with at least:
  - `canvas-preflight`
  - `canvas-feedback-eval`
- extend `skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh` so canvas artifacts and templates are required
- extend `skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh` and `skills/opendevbrowser-best-practices/assets/templates/robustness-checklist.json` so canvas coverage is machine-verifiable

Required future templates in the bundled repo skill pack:

- `skills/opendevbrowser-best-practices/assets/templates/canvas-handshake-example.json`
- `skills/opendevbrowser-best-practices/assets/templates/canvas-generation-plan.v1.json`
- `skills/opendevbrowser-best-practices/assets/templates/canvas-feedback-eval.json`
- `skills/opendevbrowser-best-practices/assets/templates/canvas-blocker-checklist.json`

Required future changes to the global `design-agent` skill:

- teach the semantics of each handshake-governed block:
  - `intent`
  - `generationPlan`
  - `designLanguage`
  - `contentModel`
  - `layoutSystem`
  - `typographySystem`
  - `motionSystem`
  - `responsiveSystem`
  - `accessibilityPolicy`
- teach the required `generationPlan` fields and their meanings:
  - `targetOutcome`
  - `visualDirection`
  - `layoutStrategy`
  - `contentStrategy`
  - `componentStrategy`
  - `motionPosture`
  - `responsivePosture`
  - `accessibilityPosture`
  - `validationTargets`
- provide a minimal planning skeleton the agent can fill before first mutation
- teach reconciliation with `documentContext` so existing governance is extended rather than overwritten blindly

## Runtime Topology

The v1 topology has three cooperating surfaces:

1. Design tab
   The dedicated workspace for low-fi layout, multipage structure, token editing, and prototype management.

2. Overlay renderer
   The in-page surface used for high-fi live page editing, selection, guides, and visual patch preview.

3. Preview targets
   Real browser tabs that render prototype output and surface runtime feedback.

High-level flow:

1. Agent sends `/canvas` commands.
2. Shared core resolves ownership, target routing, and chunk handling.
3. Design-tab state updates the canonical document.
4. Overlay or preview targets render the relevant projection of that document.
5. Feedback flows back as design-focused diagnostics.

## Host Strategy

### Dedicated design tab

The primary v1 design-tab host should be an extension page tab or equivalent same-origin design tab.

Why:

- it is large enough for an actual workspace
- it fits the current extension-centered architecture
- it avoids using the popup as a long-lived editor
- it avoids offscreen-document limitations
- it avoids the width and UX constraints of a side panel

Side panel is a future adjunct, not the main canvas host.

Offscreen documents are explicitly not the main editor host.

### Overlay mode

Overlay mode reuses annotation-style injection patterns for visible in-page controls, but it does not reuse annotation as the main state bus.

Overlay mode must support both current runtime paths:

- extension relay annotation path
- managed/direct annotation path

This is required if the feature is expected to span extension and non-extension workflows.

## Mode Matrix

### Extension mode

Primary v1 path.

- best support for overlay editing
- direct fit for existing relay architecture
- design tab can be extension-hosted

### Managed mode

Supported, but secondary.

- overlay needs the direct annotation path
- dedicated design tab may require a non-extension host path later if parity is required

### Legacy CDP mode

Not a primary canvas path.

- useful as a low-level fallback substrate
- not a product surface for design workflows

## State and Persistence

## Canonical Document

The source of truth is a custom OpenDevBrowser JSON document.

This document must support both:

- lo-fi scene constructs
- hi-fi page bindings and export metadata

HTML and CSS are outputs, not the primary saved form.

Markdown can exist as a sidecar for brief, review notes, and rationale.

TOML may be used only for compact metadata if needed, not for main scene state.

## Local Working State

V1 uses a layered local-first state model:

- `Yjs` as the shared design-document engine
- `BroadcastChannel` for same-origin design-tab fanout
- `IndexedDB` for durable local working copies and offline recovery
- `chrome.storage.local` for small extension coordination metadata only

Important limit:

`BroadcastChannel` only helps same-origin contexts. Overlay state on arbitrary target origins still syncs through `/canvas`, not through `BroadcastChannel` directly.

Important boundary:

Yjs owns document state and merge behavior. It does not own:

- `/canvas` command routing
- `/ops` transport behavior
- lease ownership
- target routing
- preview-tab lifecycle

## Local-State Overhead Budget

V1 must keep local collaboration machinery cheaper than live preview work.

Required rules:

- binary assets, screenshots, thumbnails, and exported bundles never live inside Yjs
- awareness or presence stays disabled by default in v1
- `BroadcastChannel` notifications should be batched or debounced rather than emitting one browser event per tiny mutation
- working-state autosave to `IndexedDB` should be debounced for mutation bursts and forced on explicit save, blur, or session shutdown
- transient blobs should be cleaned on session close, with an orphan sweep on next startup
- repo save cadence is deliberate and versioned; working-state autosave cadence is frequent and local-only

## Yjs Integration Strategy

Use upstream Yjs as a library dependency. Do not fork, vendor, or expose Yjs internals as the product contract.

Recommended boundary:

- ODB owns the canonical JSON schema and the public `/canvas` protocol
- an internal `CanvasDocumentStore` owns the live `Y.Doc`
- `/canvas` patch batches are translated into Yjs transactions inside that store
- the store projects Yjs state back into canonical JSON for render, save, export, and replay

Recommended `CanvasDocumentStore` responsibilities:

- create and load one `Y.Doc` per design document
- bind stable top-level collections for pages, nodes, tokens, assets, component inventory, variants, bindings, prototypes, and metadata
- persist local working state through `IndexedDB`
- fan out same-origin updates through `BroadcastChannel`
- emit ODB-native snapshots, revisions, and change events to the rest of the product

Recommended Yjs shape:

- root metadata: `Y.Map`
- `pagesById`: `Y.Map`
- `pageOrder`: `Y.Array`
- `nodesById`: `Y.Map`
- `componentsById`: `Y.Map`
- `componentInventory`: `Y.Map`
- `tokens`: `Y.Map`
- `assetsById`: `Y.Map`
- `viewports`: `Y.Map`
- `themes`: `Y.Map`
- `bindings`: `Y.Map`
- `prototypes`: `Y.Map`

Awareness stays separate from the saved document:

- it is optional in v1
- it can later power cursor, selection, or liveness state
- it is not persisted as canonical repo data
- it is not required to ship the first single-user release

## Repo Persistence

There are two persistence layers:

1. Local working persistence
   Fast, mutable, session-oriented state in `IndexedDB`

2. Repo persistence
   Durable exported document saved as a JSON artifact in the repo

This split is required because MV3 service workers are not durable document hosts and because repo saves should be deliberate, versioned events.

Recommended document-state layering:

1. Repo-native JSON document shape
2. Yjs document model for live shared state
3. `BroadcastChannel` for same-machine fanout
4. `IndexedDB` for durable local persistence

Repo-save contract:

- default repo artifact path is `.opendevbrowser/canvas/<documentId>.canvas.json` unless `canvas.document.save` receives an explicit `repoPath`
- repo artifacts are UTF-8 JSON with stable two-space indentation and deterministic key ordering
- ids are stable and opaque; they must not be regenerated during save/export
- schema migrations are keyed by `schemaVersion` and applied before validation or export
- save responses must include `repoPath`, `documentRevision`, `schemaVersion`, and any migration warnings

## Document Schema Direction

The document should be ODB-native and versioned.

Recommended top-level shape:

```json
{
  "schemaVersion": "1.0.0",
  "documentId": "dc_01...",
  "title": "Marketing Homepage Exploration",
  "createdAt": "2026-03-09T00:00:00.000Z",
  "updatedAt": "2026-03-09T00:00:00.000Z",
  "designGovernance": {},
  "pages": [],
  "components": [],
  "componentInventory": [],
  "tokens": {},
  "assets": [],
  "viewports": [],
  "themes": [],
  "bindings": [],
  "prototypes": [],
  "meta": {}
}
```

Recommended document sections:

- `designGovernance`
  The required design-governance block that stores declared design intent, art direction, content/layout policy, accessibility expectations, library policy, and runtime budgets.

- `pages`
  Multipage or multiflow workspace units.

- `components`
  Reusable blocks, including exported or imported component references.

- `componentInventory`
  Known repo or library components, import metadata, and token-binding hints.

- `tokens`
  Color, spacing, type, radius, shadow, motion, and semantic token maps.

- `assets`
  Images, SVG, icon references, font references, and repo asset metadata.

- `viewports`
  Named breakpoint or container profiles used by preview targets.

- `themes`
  Named theme modes such as light, dark, or brand-specific variants.

- `bindings`
  High-fi live-page attachment metadata such as selector hints, ref lineage, component linkage, or export anchors.

- `prototypes`
  Preview routing, breakpoint setup, and page-to-target relationships.

- `meta`
  Title, author, notes, migration markers, save provenance, and workflow flags.

## Design Governance Model

V1 should encode deterministic design quality through three coordinated layers:

- persisted document governance in `designGovernance`
- agent operating rules for mutation-time behavior
- validation and feedback gates that compare rendered output against declared policy

Required `designGovernance` shape:

```json
{
  "intent": {},
  "generationPlan": {},
  "designLanguage": {},
  "contentModel": {},
  "layoutSystem": {},
  "typographySystem": {},
  "colorSystem": {},
  "surfaceSystem": {},
  "iconSystem": {},
  "motionSystem": {},
  "responsiveSystem": {},
  "accessibilityPolicy": {},
  "libraryPolicy": {},
  "runtimeBudgets": {}
}
```

Required rules:

- every design document must declare the governance block, even when some values inherit from project defaults
- every design session must declare `generationPlan` before the first design mutation batch is accepted
- `designLanguage` should store both a named direction profile and explicit style axes
- `contentModel` should define message hierarchy and required content states such as loading, empty, success, and error
- `layoutSystem`, `typographySystem`, `colorSystem`, and `surfaceSystem` must exist so agents do not infer visual structure from ad hoc node styling
- `responsiveSystem` defines policy, while concrete viewport/theme/state variants still live in `viewports`, `themes`, and targeted node or component patches
- `accessibilityPolicy` must define reduced-motion, contrast, focus, and semantic expectations
- `libraryPolicy` is the allowlist and adapter policy for component, icon, motion, and 3D libraries
- `runtimeBudgets` are declarative limits consumed by preview scheduling, telemetry downgrade, and validation
- missing governance blocks are validation warnings at minimum and repo-save blockers when required fields are absent

Recommended governance semantics:

- `intent`
  Goal, audience, primary user task, emotional target, trust posture, and success criteria.
- `generationPlan`
  The agent-declared plan for how it will reach the target outcome, including chosen visual direction, layout/content strategy, component and library strategy, motion posture, responsive posture, accessibility posture, and validation targets.
- `designLanguage`
  Named direction profile plus explicit style axes such as editorial vs product-led, minimal vs expressive, flat vs layered, and 2D vs 3D-forward.
- `contentModel`
  Information architecture, message hierarchy, copy voice, CTA strategy, and required empty/loading/error content.
- `layoutSystem`
  Grid, container, spacing rhythm, alignment, density, and focal-path rules.
- `typographySystem`
  Type families, fallback stacks, scale, weights, line-height, measure, localization coverage, and loading strategy.
- `colorSystem`
  Palette roles, semantic colors, theme mapping, and contrast expectations.
- `surfaceSystem`
  Shape, radius, border, elevation, translucency, and texture rules.
- `iconSystem`
  Approved icon families, role split, decorative-vs-semantic usage, and recolor behavior.
- `motionSystem`
  Timing, easing, choreography, micro-interaction rules, reduced-motion policy, and 3D/parallax/smooth-scroll limits.
- `responsiveSystem`
  Breakpoint philosophy, viewport classes, theme/state coverage expectations, touch vs pointer assumptions, large-text behavior, and localization/RTL adaptation.
- `accessibilityPolicy`
  WCAG-aligned expectations for contrast, focus visibility, keyboard flow, semantic structure, and screen-reader parity.
- `libraryPolicy`
  Approved libraries, adapters, deprecations, and mixing rules.
- `runtimeBudgets`
  Live preview caps, asset/media weight policy, telemetry downgrade thresholds, and memory constraints.

Recommended `generationPlan` shape:

```json
{
  "targetOutcome": {
    "mode": "high-fi-live-edit",
    "summary": "Refine the marketing homepage hero and CTA path",
    "successSignals": ["cta-visible", "contrast-pass", "mobile-hero-stacks"]
  },
  "visualDirection": {
    "profile": "cinematic-minimal",
    "styleAxes": {
      "editorialVsProductLed": 0.25,
      "minimalVsExpressive": 0.4,
      "flatVsLayered": 0.7,
      "twoDVsThreeDForward": 0.35
    },
    "iconRole": "secondary"
  },
  "layoutStrategy": {
    "approach": "hero-led-grid",
    "primaryStructure": ["hero", "social-proof", "features", "cta"],
    "bindingMode": "component-first"
  },
  "contentStrategy": {
    "source": "document-context",
    "density": "medium",
    "requiredStates": ["default", "loading", "empty", "error"]
  },
  "componentStrategy": {
    "mode": "reuse-first",
    "approvedLibraries": ["shadcn", "tabler"],
    "fallback": "export-html-css"
  },
  "motionPosture": {
    "level": "subtle",
    "allow3D": false,
    "allowParallax": false,
    "allowCustomSmoothScroll": false
  },
  "responsivePosture": {
    "primaryViewport": "desktop",
    "requiredViewports": ["desktop", "tablet", "mobile"],
    "requiredThemes": ["light"],
    "requiredInteractions": ["default", "hover", "focus", "active", "disabled"]
  },
  "accessibilityPosture": {
    "target": "WCAG_2_2_AA",
    "reducedMotion": "required",
    "keyboardParity": true
  },
  "validationTargets": {
    "blockOn": ["missing-generation-plan", "contrast-failure"],
    "warnOn": ["responsive-mismatch", "runtime-budget-exceeded"]
  }
}
```

Required `generationPlan` rules:

- every required field must be present before mutation; empty objects are invalid
- `targetOutcome.mode` is one of `low-fi-wireframe`, `high-fi-live-edit`, or `dual-track`
- `visualDirection.profile` is the compact prompting handle; `styleAxes` is the validator-facing breakdown
- `componentStrategy.mode` is one of `reuse-first`, `canvas-local-first`, or `dom-binding-first`
- `motionPosture` explicitly governs whether 3D, parallax, and custom smooth scrolling are permitted
- `validationTargets.blockOn` and `validationTargets.warnOn` must use machine-readable warning or blocker codes
- `canvas.plan.set` transitions the session from `handshake_read`, `plan_accepted`, or `patching_enabled` to `plan_submitted`; mutation stays blocked until the runtime marks the plan `accepted`

## Node Types

The schema must support both scene-native and DOM-adjacent nodes.

Required v1 node families:

- `frame`
- `group`
- `text`
- `shape`
- `note`
- `connector`
- `wire-block`
- `component-instance`
- `dom-binding`

Principle:

- lo-fi nodes should not require DOM bindings
- hi-fi nodes may carry DOM bindings and export metadata

Recommended persisted entity shapes:

```json
{
  "page": {
    "id": "page_home",
    "name": "Home",
    "rootNodeId": "node_root_home",
    "path": "/",
    "meta": {}
  },
  "node": {
    "id": "node_root_home",
    "kind": "frame",
    "name": "Home Root",
    "pageId": "page_home",
    "parentId": null,
    "childIds": ["node_hero"],
    "rect": { "x": 0, "y": 0, "width": 1440, "height": 1800 },
    "props": {},
    "variantPatches": [],
    "bindingIds": [],
    "meta": {}
  },
  "binding": {
    "id": "binding_cta",
    "nodeId": "node_cta",
    "kind": "component",
    "selectorHint": "[data-cta='primary']",
    "componentId": "component_button_primary",
    "confidence": "high",
    "meta": {}
  },
  "prototype": {
    "id": "proto_home_default",
    "pageId": "page_home",
    "route": "/",
    "defaultViewport": "desktop",
    "defaultTheme": "light",
    "preferredTargetId": null,
    "meta": {}
  },
  "component": {
    "id": "component_button_primary",
    "name": "Primary Button",
    "rootNodeId": "node_component_button_root",
    "sourceKind": "shadcn",
    "meta": {}
  },
  "viewport": {
    "id": "viewport_mobile",
    "name": "mobile",
    "width": 390,
    "height": 844,
    "meta": {}
  },
  "theme": {
    "id": "theme_light",
    "name": "light",
    "tokenMode": "light",
    "meta": {}
  }
}
```

Required entity rules:

- every persisted record must carry a stable id with a type prefix such as `dc_`, `page_`, `node_`, `binding_`, `proto_`, or `asset_`
- `pages`, `components`, `assets`, `bindings`, and `prototypes` are JSON arrays in the repo artifact, but implementations may index them internally by id
- `viewports` and `themes` are JSON arrays of named records and are referenced by id from prototypes and variant selectors
- `childIds` ordering is canonical and must be preserved during serialization
- `bindingIds` must reference records in `bindings`; direct inline bindings are not part of the canonical repo shape
- `prototype.route` is the preview/export routing handle; `pageId` remains the design-space handle

## Token Model

The token section should borrow from current design-token standards work instead of inventing a new token syntax.

Minimum token groups:

- color
- spacing
- typography
- radius
- border
- shadow
- motion
- z-index

Recommended token object shape:

```json
{
  "$type": "color",
  "$value": "#101010",
  "$description": "Primary surface text",
  "$extensions": {
    "odb": {
      "modes": {
        "light": "#101010",
        "dark": "#f5f5f5"
      }
    }
  }
}
```

Rules:

- the ODB document stays canonical
- token objects should stay structurally compatible with current design-token format direction such as typed values, aliases, and extensions
- semantic tokens should be preferred over raw literal values in patch batches
- theme or state-specific token modes should live with the token definition instead of being scattered through ad hoc CSS
- governance blocks such as `colorSystem`, `typographySystem`, and `motionSystem` must define the token families agents are allowed to mutate so token edits stay policy-aware

## Asset Pipeline Contract

Assets are first-class document entities.

Recommended asset source types:

- `repo`
- `remote`
- `page-derived`
- `generated`
- `transient`

Recommended asset record:

```json
{
  "id": "asset_hero_01",
  "sourceType": "repo",
  "kind": "image",
  "repoPath": "apps/site/public/hero.png",
  "url": null,
  "mime": "image/png",
  "width": 1440,
  "height": 900,
  "hash": "sha256:...",
  "status": "ready",
  "variants": [],
  "meta": {}
}
```

Required rules:

- store asset metadata in the canonical document
- store large binaries, thumbnails, screenshots, and derived blobs outside Yjs
- use chunked transport for large asset payloads
- distinguish working-preview references from repo-save references
- preserve provenance for remote, generated, and page-derived assets
- if an asset cannot be resolved or loaded, emit a validation warning rather than silently dropping it
- raw `/ops` payload ceilings are transport limits, not asset-design budgets
- inline only small text-like assets in document patches; binary assets should move through blob-backed paths
- use a conservative default inline ceiling of 128 KB per text-like asset record such as a sanitized SVG or tiny icon payload

Asset-type rules:

- images should support responsive candidates such as `srcset`, `sizes`, and preview priority hints
- SVG should be sanitized before reuse and treated as hostile input by default
- fonts should record family, style, weight, source, and display strategy
- icons should support both file-backed assets and component-library icon identifiers
- remote assets may remain remote during working preview, but repo save must preserve explicit provenance and unresolved-asset warnings
- oversized preview assets should downscale for thumbnails and background previews rather than forcing every target into full-resolution rendering
- the governing defaults for imagery, illustration, video, and provenance should live in `designGovernance.iconSystem`, `designGovernance.contentModel`, and `designGovernance.runtimeBudgets`, not only in per-asset metadata

Representation rules:

- asset records must use one of these `sourceType` values: `repo`, `remote`, `page-derived`, `generated`, or `transient`
- `repoPath` is only valid for `repo`
- `url` is only valid for `remote`
- `page-derived` and `generated` records must include provenance in `meta`
- repo save must never silently convert a `remote`, `generated`, or `transient` asset into a `repo` asset without an explicit save step

## Icon System Contract

V1 should ship with a layered icon policy instead of a single undifferentiated icon pool.

Canonical role split:

- `primary`
  `3dicons` is the primary visual-richness source for premium hero moments, feature highlights, onboarding, concept boards, and other high-impact prototype surfaces.
- `secondary`
  `Tabler` is the default utility icon system for navigation, controls, buttons, forms, states, and dense product UI.
- `secondary-alt`
  `Microsoft Fluent UI System Icons` is an approved alternative utility layer when the product deliberately wants a Fluent-like system aesthetic.
- `decorative`
  `@lobehub/fluent-emoji-3d` is the decorative accent layer for empty states, celebration, communication, and playful personality moments.

Non-default role:

- `lucide-react` is not part of the canonical stack. It overlaps with the Tabler utility role and adds a React-specific package surface without improving the visual-richness-first direction.

Why this role split is required:

- no single library in the current shortlist serves premium visual richness, dense utility UI, and colorful decorative accents equally well
- `3dicons` is visually rich but not suitable for every small control
- `Tabler` is operationally strong and easy to recolor, but it is a utility layer, not the visual-primary language
- `@lobehub/fluent-emoji-3d` adds color and warmth, but it is not a complete product icon system
- `Microsoft Fluent UI System Icons` is a utility alternative, not a richer replacement for the whole stack

Icon records should preserve both source and intended role.

Recommended icon reference shape:

```json
{
  "kind": "icon",
  "role": "secondary",
  "sourceLibrary": "tabler",
  "identifier": "arrow-left",
  "assetId": null,
  "componentRef": "@tabler/icons-react/IconArrowLeft",
  "meta": {}
}
```

Required rules:

- every icon reference should declare a role such as `primary`, `secondary`, `secondary-alt`, or `decorative`
- `3dicons` and `@lobehub/fluent-emoji-3d` should usually resolve through asset-backed references rather than utility-component assumptions
- `Tabler` and `Microsoft Fluent UI System Icons` may resolve through component identifiers or inline/file-backed SVG references
- validation should warn when a prototype mixes non-approved icon families without an explicit override
- export should preserve icon source metadata so generated code or saved design artifacts do not lose provenance
- inline or component-rendered utility icons should preserve `currentColor` behavior where supported so theme and state changes can recolor them predictably
- the approved role split and mixing rules should be stored in `designGovernance.iconSystem`

Representation rules:

- exactly one of `assetId`, `componentRef`, or inline-svg metadata may be the canonical render source for an icon reference
- `componentRef` is only valid for approved utility libraries such as `tabler` or `microsoft-fluent-ui-system-icons`
- asset-backed icon references must resolve through the asset pipeline and obey the asset provenance rules

Default operating policy:

- use `3dicons` for visual richness
- use `Tabler` for utility clarity
- use `@lobehub/fluent-emoji-3d` for personality
- use `Microsoft Fluent UI System Icons` only when a Fluent-like system look is intentional
- do not add `lucide-react` to the default stack

## Token and Component Contract

Tokens and components must stay connected.

Recommended component inventory record:

```json
{
  "id": "component_button_primary",
  "sourceKind": "shadcn",
  "importPath": "@/components/ui/button",
  "exportName": "Button",
  "iconLibrary": "tabler",
  "slots": ["root", "icon", "label"],
  "tokenBindings": {
    "background": "color.primary",
    "foreground": "color.primaryForeground",
    "radius": "radius.md"
  },
  "meta": {}
}
```

Required rules:

- component inventories are part of the document contract, not only export metadata
- token bindings should be explicit where known and warning-backed where inferred
- exported HTML/CSS remains the fallback path when a stable component mapping is unavailable
- design changes should prefer component instances and token updates before raw style mutations when a component inventory exists
- component records that render icons should preserve their chosen icon-library metadata rather than relying on implicit project defaults
- `libraryPolicy` should declare which component, icon, motion, and 3D libraries are allowed for a given document so generation and export stay deterministic

Framework adapters:

- CSS custom properties are the primary runtime bridge
- Tailwind should be treated as an adapter over canonical tokens, preferably via theme variables
- shadcn integration should treat `components.json`, CSS variable mode, aliases, and icon-library metadata as adapter inputs when present
- none of these adapters become the canonical saved document

## Responsive and Variant Model

V1 must support more than one static state.

Required variant dimensions:

- `viewport`
- `theme`
- `interaction`
- `content`

Recommended model:

- base node data stores default intent
- variant-specific deltas are stored as targeted patches
- named viewport and theme profiles live at the document root
- interaction and content states can live at component or node level
- the global policy for breakpoints, density, pointer mode, large-text behavior, and localization adaptation should live in `designGovernance.responsiveSystem`

Example variant selector:

```json
{
  "viewport": "mobile",
  "theme": "dark",
  "interaction": "hover",
  "content": "default"
}
```

Required `variantPatches` shape:

```json
{
  "selector": {
    "viewport": "mobile",
    "theme": "dark",
    "interaction": "hover",
    "content": "default"
  },
  "changes": {
    "props.layout.direction": "column",
    "props.spacing.gap": "{spacing.4}"
  }
}
```

V1-required state sets:

- viewports: at least desktop, tablet, mobile
- themes: at least light and dark when the project supports them
- interactions: default, hover, focus, active, disabled
- content: default, loading, empty, error

Variant rules:

- `variantPatches` live on the node or component-instance record they modify; they are not stored as anonymous top-level fragments
- selector precedence is `viewport` -> `theme` -> `interaction` -> `content`
- missing selector dimensions inherit from the base record
- unsupported selector dimensions must be rejected during validation rather than ignored silently
- `changes` keys use the same restricted property-path grammar defined for patch batches in the patch model section

## Agent Design Principles

Agents operating on the canvas should follow explicit design rules:

- read and honor `designGovernance` before mutating the document
- declare and store `generationPlan` before the first mutation so the end goal and intended generation strategy are explicit
- tokens before literals
- components before raw DOM clones when a reliable inventory exists
- schema-safe patch batches before raw HTML or CSS edits
- one design intent per patch batch
- low-fi nodes stay export-neutral until they are intentionally promoted to high-fi bindings
- every mutation loop should return design warnings and runtime evidence before the next mutation
- responsive, accessibility, and performance constraints are part of the design contract, not optional polish
- never treat typography, spacing rhythm, color roles, hierarchy, or state coverage as implicit
- do not introduce 3D, parallax, autoplay video, or custom smooth scrolling unless `motionSystem`, `contentModel`, and `runtimeBudgets` explicitly permit them

## Design Governance Validation

Validation must compare rendered behavior against declared governance, not only against structural schema rules.

Minimum warning classes:

- `missing-generation-plan`
- `missing-intent`
- `missing-design-language`
- `missing-content-model`
- `missing-typography-system`
- `missing-color-role`
- `missing-surface-policy`
- `missing-state-coverage`
- `missing-reduced-motion-policy`
- `missing-responsive-policy`
- `contrast-failure`
- `hierarchy-weak`
- `asset-provenance-missing`
- `font-policy-missing`
- `icon-policy-violation`
- `library-policy-violation`
- `runtime-budget-exceeded`

Required rules:

- repo save should block when required governance blocks are absent
- the first mutation batch in a session should be rejected or converted into a preflight warning when `generationPlan` is absent
- preview feedback may stay warning-based for partial governance gaps, but it must never silently ignore them
- reduced-motion and contrast failures are high-severity warnings even when the preview otherwise renders successfully
- runtime-budget warnings should trigger downgrade recommendations for preview targets, media, fonts, or telemetry
- export should preserve governance-derived warnings so design-to-code output does not discard policy drift
- validator classes should be stable and machine-readable so agents can iterate deterministically on fixes

Canvas skill-pack verification should also cover at least these issue classes:

- `CANVAS-01`: handshake missing or unread before mutation
- `CANVAS-02`: required governance block missing
- `CANVAS-03`: required `generationPlan` field missing or malformed
- `CANVAS-04`: library or icon-policy violation
- `CANVAS-05`: unsupported target or overlay mount failure
- `CANVAS-06`: runtime budget exceeded or preview downgrade ignored
- `CANVAS-07`: feedback missing target attribution or validation metadata

Recommended warning and blocker envelopes:

```json
{
  "warning": {
    "code": "responsive-mismatch",
    "severity": "warning",
    "documentId": "dc_01...",
    "pageId": "page_home",
    "targetId": "target_01",
    "message": "Mobile variant overflows at 390px width.",
    "details": {},
    "evidenceRefs": ["thumb_01"]
  },
  "blocker": {
    "code": "plan_required",
    "blockingCommand": "canvas.document.patch",
    "requiredNextCommands": ["canvas.plan.set"],
    "documentId": "dc_01...",
    "targetId": "target_01",
    "message": "generationPlan must be accepted before mutation.",
    "details": { "auditId": "CANVAS-01" }
  }
}
```

Envelope rules:

- warnings are non-blocking and use severities `info`, `warning`, or `error`
- blockers are command-scoped and must always specify `blockingCommand` plus at least one `requiredNextCommands` value
- `CANVAS-01` through `CANVAS-07` are audit/evaluation identifiers and should appear in `details.auditId`, not replace the runtime `code`

Core v1 blocker codes:

- `plan_required`
- `revision_conflict`
- `unsupported_target`
- `lease_reclaim_required`
- `policy_violation`

## Patch Model

V1 should use domain-specific patch batches carried over `/canvas`, with Yjs managing shared document convergence underneath.

Do not make raw HTML the patch language.
Do not expose raw Yjs update bytes as the `/canvas` API.

Recommended patch shape:

```json
{
  "documentId": "dc_01...",
  "baseRevision": 42,
  "patches": [
    { "op": "node.insert", "pageId": "page_home", "parentId": "node_root_home", "node": { "id": "node_hero", "kind": "frame" } },
    { "op": "node.update", "nodeId": "frame_hero", "variant": { "viewport": "mobile" }, "changes": { "props.layout.direction": "column" } },
    { "op": "token.set", "path": "colorSystem.surface.default", "value": "#ffffff" },
    { "op": "binding.set", "nodeId": "component_cta", "binding": { "id": "binding_cta", "kind": "component" } },
    { "op": "asset.attach", "nodeId": "hero_image", "assetId": "asset_hero_01" }
  ]
}
```

Why:

- it is easier to validate than arbitrary DOM diffs
- stable ids make merges and replay more deterministic
- it matches the need for both scene nodes and hi-fi bindings

Mutation path:

`/canvas` patch batch -> Yjs transaction -> updated canonical JSON projection -> render/export/save

`baseRevision` is the sender's last-known JSON projection revision. It is used for diagnostics, optimistic UI, replay, and save/export checkpoints. It is not the CRDT conflict-resolution mechanism.

Required v1 operation registry:

- `page.create`
- `page.update`
- `node.insert`
- `node.update`
- `node.remove`
- `variant.patch`
- `token.set`
- `asset.attach`
- `binding.set`
- `prototype.upsert`

Minimum per-operation shapes:

- `page.create`
  ```json
  { "op": "page.create", "page": { "id": "page_home", "rootNodeId": "node_root_home" } }
  ```
- `page.update`
  ```json
  { "op": "page.update", "pageId": "page_home", "changes": { "name": "Home" } }
  ```
- `node.insert`
  ```json
  { "op": "node.insert", "pageId": "page_home", "parentId": "node_root_home", "node": { "id": "node_hero", "kind": "frame" } }
  ```
- `node.update`
  ```json
  { "op": "node.update", "nodeId": "node_hero", "changes": { "props.layout.direction": "column" } }
  ```
- `node.remove`
  ```json
  { "op": "node.remove", "nodeId": "node_hero" }
  ```
- `variant.patch`
  ```json
  { "op": "variant.patch", "nodeId": "node_hero", "selector": { "viewport": "mobile" }, "changes": { "props.layout.direction": "column" } }
  ```
- `token.set`
  ```json
  { "op": "token.set", "path": "colorSystem.surface.default", "value": "#ffffff" }
  ```
- `asset.attach`
  ```json
  { "op": "asset.attach", "nodeId": "node_hero_image", "assetId": "asset_hero_01" }
  ```
- `binding.set`
  ```json
  { "op": "binding.set", "nodeId": "node_cta", "binding": { "id": "binding_cta", "kind": "component" } }
  ```
- `prototype.upsert`
  ```json
  { "op": "prototype.upsert", "prototype": { "id": "proto_home_default", "pageId": "page_home", "route": "/" } }
  ```

Patch-processing rules:

- patch batches are atomic; partial success is not allowed
- every accepted batch returns `transactionId`, `appliedRevision`, `warnings`, and any `evidenceRefs`
- `baseRevision` mismatch must return a structured `revision_conflict` blocker with the latest available revision
- mutation validation order is: ownership -> plan/preflight -> schema -> governance policy -> target/runtime eligibility -> apply transaction
- `node.insert.parentId` always points to a `nodeId`; page roots are handled by `page.create` or by `node.insert` with `parentId: null` plus an explicit `pageId`
- `changes` objects use a restricted dotted property-path grammar:
  - segments are separated by `.`
  - every segment must match `^[A-Za-z][A-Za-z0-9_]*$`
  - array indexing, wildcards, slashes, escape sequences, and empty segments are invalid
  - canonical writable keys in the saved document must not themselves contain `.`
  - duplicate or overlapping keys in one batch such as `props.layout` and `props.layout.direction` are invalid
- Allowed writable roots by operation:
  - `page.update`: `name`, `description`, `rootNodeId`, `prototypeIds`, `metadata.*`
  - `node.update`: `name`, `props.*`, `style.*`, `tokenRefs.*`, `bindingRefs.*`, `metadata.*`
  - `variant.patch`: `props.*`, `style.*`, `tokenRefs.*`, `bindingRefs.*`, `metadata.*`
  - `token.set`: exactly one canonical token path whose first segment is one of `colorSystem`, `typographySystem`, `layoutSystem`, `surfaceSystem`, `motionSystem`, or `iconSystem`
  - operations must reject writes outside their allowed roots with `policy_violation`
- `token.set.path` resolves by prefixing the path with `designGovernance.` at persistence time
  - example: `colorSystem.surface.default` writes `designGovernance.colorSystem.surface.default`
  - shorthand roots such as `color.surface.default` are invalid

## `/canvas` Command Surface

Required v1 command families:

- `canvas.session.open`
- `canvas.session.close`
- `canvas.session.status`
- `canvas.capabilities.get`
- `canvas.plan.set`
- `canvas.plan.get`
- `canvas.document.load`
- `canvas.document.patch`
- `canvas.document.save`
- `canvas.document.export`
- `canvas.tab.open`
- `canvas.tab.close`
- `canvas.overlay.mount`
- `canvas.overlay.unmount`
- `canvas.overlay.select`
- `canvas.preview.render`
- `canvas.preview.refresh`
- `canvas.feedback.poll`
- `canvas.feedback.subscribe`

Command-shape rules:

- commands must remain additive and typed
- commands must carry `requestId`, canvas session identity, and ownership context
- commands that touch live targets must remain target-scoped
- large payloads must reuse chunking
- `canvas.session.open` must return the current handshake payload
- `canvas.document.patch` must be able to return a structured `plan_required` blocker when required handshake or plan steps are incomplete

Minimum v1 command contracts:

- `canvas.session.open`
  Request:
  ```json
  {
    "requestId": "req_01",
    "browserSessionId": "browser_session_01",
    "documentId": null,
    "repoPath": null,
    "mode": "dual-track"
  }
  ```
  Success response: handshake payload plus `canvasSessionId`, `leaseId`, and current `preflightState`.

- `canvas.capabilities.get`
  Request must include `canvasSessionId` and may include `documentId` when the caller wants the currently loaded document context echoed back.
  Success response must return the same canonical handshake payload shape as `canvas.session.open`, refreshed for the current session and document revision.

- `canvas.plan.set`
  Request:
  ```json
  {
    "requestId": "req_02",
    "canvasSessionId": "canvas_session_01",
    "leaseId": "lease_01",
    "documentId": "dc_01...",
    "generationPlan": {
      "targetOutcome": { "mode": "high-fi-live-edit", "summary": "Refine hero and CTA" },
      "visualDirection": { "profile": "cinematic-minimal", "styleAxes": {} },
      "layoutStrategy": { "approach": "hero-led-grid" },
      "contentStrategy": { "source": "document-context" },
      "componentStrategy": { "mode": "reuse-first" },
      "motionPosture": { "level": "subtle", "allow3D": false, "allowParallax": false, "allowCustomSmoothScroll": false },
      "responsivePosture": { "primaryViewport": "desktop", "requiredViewports": ["desktop", "tablet", "mobile"] },
      "accessibilityPosture": { "target": "WCAG_2_2_AA", "reducedMotion": "required", "keyboardParity": true },
      "validationTargets": { "blockOn": ["contrast-failure"], "warnOn": ["responsive-mismatch"] }
    }
  }
  ```
  Success response:
  ```json
  {
    "planStatus": "accepted",
    "documentRevision": 1,
    "preflightState": "plan_accepted",
    "warnings": []
  }
  ```

- `canvas.plan.get`
  Request must include `canvasSessionId`, `leaseId`, and `documentId`.
  Success response must include the stored `generationPlan`, `planStatus`, `documentRevision`, and current `preflightState`.

- `canvas.document.load`
  Request must provide exactly one of `documentId` or `repoPath`.
  Success response must include `documentId`, `documentRevision`, the canonical JSON projection, and refreshed handshake metadata for the loaded document.

- `canvas.document.patch`
  Request:
  ```json
  {
    "requestId": "req_03",
    "canvasSessionId": "canvas_session_01",
    "leaseId": "lease_01",
    "documentId": "dc_01...",
    "baseRevision": 1,
    "patches": []
  }
  ```
  Success response:
  ```json
  {
    "transactionId": "txn_01",
    "appliedRevision": 2,
    "warnings": [],
    "evidenceRefs": []
  }
  ```

- `canvas.document.save`
  Request must include `canvasSessionId`, `leaseId`, `documentId`, and optional `repoPath`.
  Success response must include `repoPath`, `documentRevision`, `schemaVersion`, and migration or validation warnings.

- `canvas.preview.render`
  Request:
  ```json
  {
    "requestId": "req_04",
    "canvasSessionId": "canvas_session_01",
    "leaseId": "lease_01",
    "documentId": "dc_01...",
    "prototypeId": "proto_home_default",
    "targetId": "target_01"
  }
  ```
  Success response includes render status, `targetId`, `prototypeId`, `previewState`, and `documentRevision`.

- `canvas.preview.refresh`
  Request must include `canvasSessionId`, `leaseId`, `targetId`, and `refreshMode`.
  `refreshMode` must be one of `full` or `thumbnail`.
  Success response must include `targetId`, `previewState`, `renderStatus`, `documentRevision`, and any retained `degradeReason`.

- `canvas.overlay.mount`
  Request must include `canvasSessionId`, `leaseId`, `documentId`, `prototypeId`, and `targetId`.
  Success response must include `mountId`, `targetId`, `previewState`, and overlay capability flags such as selection and guides support.

- `canvas.overlay.unmount`
  Request must include `canvasSessionId`, `leaseId`, `mountId`, and `targetId`.
  Success response must include `ok: true`, `mountId`, and the resulting `previewState`.

- `canvas.overlay.select`
  Request must include `canvasSessionId`, `leaseId`, `mountId`, `targetId`, and one of `nodeId` or a selection hint.
  Success response must include the resolved selection metadata and `targetId`.

- `canvas.document.export`
  Request must include `canvasSessionId`, `leaseId`, `documentId`, and `exportTarget`.
  `exportTarget` must be one of `design_document`, `react_component`, or `html_bundle`.
  Success response must include `exportTarget`, `documentRevision`, exported artifact references, and export warnings.
  Per-target requirements:
  - `design_document` returns the canonical serialized JSON artifact plus the resolved save path
  - `react_component` returns emitted component artifact refs, export metadata, and any downgraded bindings
  - `html_bundle` returns emitted HTML/CSS artifact refs and any unsupported-runtime warnings

- `canvas.tab.open` and `canvas.tab.close`
  `tab.open` must include `canvasSessionId`, `leaseId`, `prototypeId`, and `previewMode`.
  `previewMode` must be one of `focused`, `pinned`, or `background`.
  `tab.close` must include `canvasSessionId`, `leaseId`, and `targetId`.
  Responses must always include the resulting `targetId` set and preview-state changes.

- `canvas.feedback.subscribe`
  Request must include `canvasSessionId`, optional `targetIds`, optional `categories`, and `afterCursor`.
  `categories` may include `render`, `console`, `network`, `validation`, `performance`, `asset`, or `export`.
  Streamed events must use one of three event types:
  - `feedback.item`: wraps the canonical feedback item shape
  - `feedback.heartbeat`: `{ "eventType": "feedback.heartbeat", "cursor": "...", "ts": "...", "activeTargetIds": ["target_01"] }`
  - `feedback.complete`: `{ "eventType": "feedback.complete", "cursor": "...", "ts": "...", "reason": "session_closed|lease_revoked|subscription_replaced|document_unloaded" }`

- `canvas.session.status` and `canvas.session.close`
  `session.status` must return `canvasSessionId`, `browserSessionId`, `documentId`, `leaseId`, current `preflightState`, and active target summary.
  `session.close` must return `ok: true` and whether any preview targets or overlay mounts were released.

- `canvas.feedback.poll`
  Request:
  ```json
  {
    "requestId": "req_05",
    "canvasSessionId": "canvas_session_01",
    "documentId": "dc_01...",
    "targetId": "target_01",
    "afterCursor": null
  }
  ```
  Success response includes ordered feedback items, `nextCursor`, and retention metadata.

Preflight state machine:

- `opened`
- `handshake_read`
- `plan_submitted`
- `plan_accepted`
- `patching_enabled`

State-machine rules:

- `canvas.session.open` allocates the session in `opened`, but the successful open response must expose `preflightState: "handshake_read"` because the handshake payload is included in that response
- `canvas.capabilities.get` keeps the session in `handshake_read` unless a later state has already been reached
- `canvas.plan.set` moves the session to `plan_submitted`
- the runtime marks `plan_accepted` only after required fields and governance preconditions pass
- the first accepted mutation batch after `plan_accepted` moves the session to `patching_enabled`
- mutation commands may run only in `plan_accepted` or `patching_enabled`
- once accepted, `generationPlan` edits must create a new document revision, reset the session to `plan_submitted`, and block further mutations until the revised plan is accepted; silent in-place mutation of an accepted plan is not allowed

## Feedback Contract

The agent-facing feedback contract must be design-specific and structured.

Minimum feedback fields:

- render status
- affected `documentId`
- affected `pageId`
- affected `targetId`
- console events
- network failures
- perf summary
- screenshot or thumbnail reference
- validation warnings
- export warnings
- selection metadata

Recommended feedback item shape:

```json
{
  "id": "fb_01",
  "cursor": "fb_01",
  "severity": "warning",
  "class": "responsive-mismatch",
  "documentId": "dc_01...",
  "pageId": "page_home",
  "prototypeId": "proto_home_default",
  "targetId": "target_01",
  "documentRevision": 2,
  "message": "Hero overflows at mobile width.",
  "evidenceRefs": ["thumb_01"],
  "details": {}
}
```

Validation warnings should include at least:

- missing generation plan
- missing governance block
- missing typography or hierarchy definition
- overflow
- token missing
- contrast failure
- broken asset reference
- font fallback or font load failure
- font policy missing
- missing state coverage
- reduced-motion violation
- unresolved component binding
- library policy violation
- responsive mismatch
- runtime budget exceeded
- unsupported target

Important repo gap:

Current diagnostics are mostly session-scoped. V1 canvas work must add target attribution or filtering so feedback can be isolated per prototype tab.

Preflight blocker rule:

- if the agent has not yet supplied an accepted `generationPlan`, feedback should include a structured preflight blocker instead of pretending the design loop is ready

Polling and subscription rules:

- `canvas.feedback.poll` returns a bounded ordered batch plus `nextCursor`
- `canvas.feedback.subscribe` streams the same feedback item shape as events
- feedback items must dedupe by `id`
- feedback retention is target-scoped; focused and pinned previews keep fuller buffers than background or degraded previews

## Two Views

The favored long-term platform is one document with two first-class views in v1:

1. Infinite canvas editor
   Best for wireframes, structure, multipage planning, notes, flows, and token editing.

2. Live page preview/editor
   Best for real-page verification, high-fidelity refinement, and runtime debugging.

Both views read from the same underlying design document.

## Export and Code Integration

High-fi design-to-code integration reuses current export paths instead of introducing a new generator stack.

Reused capabilities:

- DOM capture
- CSS extraction
- React emitter
- clone-page and clone-component flows

Design implication:

- high-fi overlay edits should preserve enough DOM lineage to make export trustworthy
- low-fi nodes that do not map to DOM must still export meaningful placeholders or remain explicitly non-exportable
- token projection should feed CSS variables first, then framework adapters such as Tailwind
- component-library mapping should prefer stable imports and slot bindings when available, with fallback export warnings when not

## Security and Runtime Safety

The design canvas must treat rendered HTML and imported page state as hostile by default.

Required rules:

- sandbox imported HTML where possible
- sanitize HTML sinks
- preserve MV3 CSP constraints
- reject restricted browser targets
- preserve local-only relay assumptions and token/origin checks

Canvas-specific safety rules:

- annotation transport is not the asset-stream path
- large scene and image payloads must use chunking
- preview iframes must isolate script execution when rendering imported or generated HTML

## Performance and Concurrency

Canvas work inherits current target-scoped scheduling rules:

- same target: FIFO
- different targets: parallel up to governor limits

The feature must define:

- max live preview targets
- inactive tab downgrade behavior
- thumbnail vs full render policy
- save cadence for local persistence
- reconnect and lease-reclaim behavior for long-lived sessions
- asset and thumbnail eviction behavior
- memory ownership for blobs versus document state
- telemetry downgrade behavior under pressure

Recommended starting rules:

- keep only a small number of preview tabs fully live at once
- start with 2 fully live preview tabs by default and only allow a 3rd pinned full preview when governor health remains strong
- downgrade inactive previews to lighter refresh or thumbnail mode
- reserve full renders for focused or pinned previews
- surface reconnect and lease-reclaim as explicit user-visible states
- keep screenshots, thumbnails, and large asset binaries out of Yjs and out of the canonical JSON document
- store binary preview artifacts in a local blob cache with eviction
- degrade or pause telemetry and live rerender frequency for background, frozen, or discarded tabs
- prefer lazy loading for non-critical media and explicit font loading strategy in live previews

Normative default runtime policy:

- `defaultLivePreviewLimit = 2`
- `maxPinnedFullPreviewExtra = 1`
- `reconnectGraceMs = 20000`
- `overflowRenderMode = thumbnail_only`
- `backgroundTelemetryMode = sampled`

Preview-state ladder:

1. `focused`
   Full interactive render, full console and network retention, full overlay tooling.
2. `pinned`
   Full interactive render, full telemetry, lower refresh priority than the focused tab.
3. `background`
   Lighter refresh cadence, sampled telemetry, thumbnail refresh allowed.
4. `degraded`
   Thumbnail-only plus explicit manual refresh; no continuous full telemetry.

State rules:

- `focused`, `pinned`, `background`, and `degraded` are the only valid preview states in v1
- `degraded` is entered when preview-count, memory, or queue-pressure policy is exceeded
- `degradeReason` is one of `overflow`, `memory_pressure`, `queue_pressure`, `frozen`, or `discarded`
- `lease_reclaim_required` and `unsupported_target` are runtime blocker states, not preview states

Telemetry retention rules:

- focused and pinned previews keep full bounded console and network buffers
- background previews keep sampled or reduced telemetry only
- overflow, frozen, or discarded previews do not keep continuous full telemetry until resumed

## Dependency Strategy

V1 should not lock the product to one external scene/editor dependency.

Recommended dependency posture:

- Yjs is part of the chosen document-state architecture
- prefer upstream packages rather than vendoring internals
- no mandatory tldraw, GrapesJS, or Excalidraw dependency in the canonical core
- allow future adapters if they accelerate one surface without owning the saved document model

Reference roles:

- tldraw: future low-fi canvas adapter reference
- GrapesJS: DOM-builder reference and strong evidence for JSON project persistence
- Excalidraw: lightweight scene-model reference
- Yjs: document sync and merge layer from day one, with future multi-user sync as the later upside
- `y-indexeddb`: preferred local persistence adapter candidate behind the document-store seam
- `y-websocket`: future remote provider option, not part of the local-first v1 requirement

License note:

- current package metadata reports `yjs@13.6.29` as MIT and `y-indexeddb@9.0.12` as MIT
- normal dependency review is still required before adoption

## Delivery Sequence

### Phase 1

Define and validate the shared `/canvas` and `/ops` core boundary.

End state:

- shared lease, routing, chunking, and error helpers identified
- `/canvas` command namespace defined
- handshake payload and preflight-blocker taxonomy are fixed
- skill-delivery split is fixed: bundled OpenDevBrowser runtime skill plus global design-agent skill

### Phase 2

Define the canonical JSON document, Yjs document model, and local persistence model.

End state:

- schema draft exists
- Yjs document scope is fixed and constrained to the document layer
- local `IndexedDB` persistence and same-origin `BroadcastChannel` model are specified
- asset, token, component, and variant contracts are specified
- required governance-block semantics and required `generationPlan` fields are fixed

### Phase 3

Update the packaged skill and artifact surfaces so the handshake and evaluation flow are teachable before runtime work ships.

End state:

- `skills/opendevbrowser-best-practices/SKILL.md` includes canvas preflight and evaluation guidance
- `artifacts/command-channel-reference.md` documents `/canvas`
- `artifacts/canvas-governance-playbook.md` exists
- workflow router, asset validation, and robustness audit scripts include canvas entries
- canvas templates for handshake, generation plan, blockers, and feedback evaluation exist

### Phase 4

Ship overlay mode for live-page high-fi editing.

End state:

- annotation-style overlay reused correctly
- design feedback contract can target a real page

### Phase 5

Ship the dedicated design-tab workspace.

End state:

- low-fi multipage workspace exists
- design tab can drive preview targets

### Phase 6

Tighten export and diagnostics parity.

End state:

- target-filtered design feedback
- export/clone flow connected to design state

## Acceptance Requirements

- `/canvas` is separate at the product surface and DRY over shared `/ops` internals.
- Both overlay mode and dedicated design-tab mode are represented in the architecture.
- The infinite canvas editor and the live page preview/editor are both first-class views over one document.
- The canonical persisted format is ODB-native JSON.
- `canvas.session.open` exposes a machine-readable handshake so the agent can see required governance fields, required plan fields, library constraints, state dimensions, and mutation-policy requirements before sending instructions.
- The handshake distinguishes `canvasSessionId`, browser `sessionId`, `documentId`, `prototypeId`, `targetId`, and `leaseId` rather than overloading one session identifier.
- Governance requirements are split into `requiredBeforeMutation`, `requiredBeforeSave`, and `optionalInherited`.
- The runtime handshake is supplemented by two existing skill surfaces, not a third canvas skill: the repo-packaged `skills/opendevbrowser-best-practices/` for runtime flow and the global `design-agent` skill for design semantics.
- The packaged `skills/opendevbrowser-best-practices/` plan includes `/canvas` updates to `SKILL.md`, `artifacts/command-channel-reference.md`, workflow-router scripts, robustness-audit scripts, and canvas-specific templates.
- The global `design-agent` plan includes handshake-field semantics, governance-block meanings, required `generationPlan` field meanings, and a minimal planning skeleton.
- Assets, tokens, component inventories, viewports, and themes are explicit parts of the document model.
- V1 state sync uses Yjs at the document layer with `BroadcastChannel` and `IndexedDB` for same-machine operation.
- Yjs does not replace `/canvas`, `/ops`, leases, or preview-target lifecycle management.
- Large binaries, thumbnails, and screenshots are kept out of Yjs and handled by separate local blob storage.
- Responsive variants, interaction states, and theme states are modeled explicitly instead of duplicating static pages.
- Every canvas document declares a `designGovernance` block with at least `intent`, `designLanguage`, `contentModel`, `layoutSystem`, `typographySystem`, `colorSystem`, `surfaceSystem`, `iconSystem`, `motionSystem`, `responsiveSystem`, `accessibilityPolicy`, `libraryPolicy`, and `runtimeBudgets`.
- Every canvas session declares a `generationPlan` before first mutation so the target outcome and the intended generation strategy are explicit.
- The `generationPlan` object shape and session preflight state machine are fixed enough to implement without guesswork.
- `designLanguage` stores both a named direction profile and explicit style axes so prompting can stay compact while validation stays deterministic.
- CSS variables, Tailwind adapters, and component-library adapters are downstream projections, not the canonical design state.
- Agent design principles are defined so real-time mutation stays token-aware, component-aware, and feedback-driven.
- Validation warnings include governance drift classes such as missing policy blocks, hierarchy weakness, reduced-motion violations, library-policy violations, and runtime-budget overflow.
- Core `/canvas` commands have request/response contracts for session open, plan set, document patch, preview render, and feedback poll.
- Patch batches are atomic and return a revisioned result or a structured blocker.
- Skill-pack evaluation covers canvas-specific issue classes such as missing handshake preflight, missing governance blocks, malformed plans, policy violations, unsupported targets, budget overflow, and missing target-attributed feedback.
- Repo save has a deterministic default artifact path and serializer contract.
- Preview runtime policy fixes the default live-preview cap, reconnect grace window, and degraded-state rules.
- The canonical icon policy defines `3dicons` as primary, `Tabler` as secondary, `@lobehub/fluent-emoji-3d` as decorative, and `Microsoft Fluent UI System Icons` as a secondary alternative.
- Export and React/component flows remain part of the design architecture, not a separate future project.

## References

Repo references:

- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/src/relay/protocol.ts`
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/src/relay/relay-server.ts`
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/src/browser/ops-browser-manager.ts`
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/src/browser/annotation-manager.ts`
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/src/export/dom-capture.ts`
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/src/export/css-extract.ts`
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/src/export/react-emitter.ts`
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/extension/src/ops/ops-runtime.ts`
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/extension/manifest.json`
- `/Users/bishopdotun/.codex/worktrees/9eb5/opendevbrowser/docs/ASSET_INVENTORY.md`

External references:

- [Pencil `.pen` files](https://docs.pencil.dev/core-concepts/pen-files)
- [Pencil design as code](https://docs.pencil.dev/core-concepts/design-as-code)
- [Pencil variables](https://docs.pencil.dev/core-concepts/variables)
- [tldraw collaboration](https://tldraw.dev/docs/collaboration)
- [tldraw multiplayer starter kit](https://tldraw.dev/starter-kits/multiplayer)
- [GrapesJS storage](https://grapesjs.com/docs/modules/Storage.html)
- [GrapesJS editor API](https://grapesjs.com/docs/api/editor.html)
- [Excalidraw initial data](https://docs.excalidraw.com/docs/%40excalidraw/excalidraw/api/props/initialdata)
- [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome side panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [MDN BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [MDN IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [MDN Responsive Images](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images)
- [MDN Lazy Loading](https://developer.mozilla.org/en-US/docs/Web/Performance/Lazy_loading)
- [MDN font-display](https://developer.mozilla.org/en-US/docs/Web/CSS/%40font-face/font-display)
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- [Material Web theming](https://material-web.dev/theming/material-theming/)
- [Material Web typography](https://material-web.dev/theming/typography/)
- [Fluent 2 Motion](https://fluent2.microsoft.design/motion)
- [Design Tokens Format Module](https://www.designtokens.org/TR/2025.10/format/)
- [Yjs y-websocket](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket)
- [Yjs offline editing](https://docs.yjs.dev/getting-started/allowing-offline-editing)
- [Tailwind Theme Variables](https://tailwindcss.com/docs/theme)
- [Tailwind Responsive Design](https://tailwindcss.com/docs/breakpoints)
- [shadcn Theming](https://ui.shadcn.com/docs/theming)
- [shadcn components.json](https://ui.shadcn.com/docs/components-json)
- [Design Tokens format draft](https://www.designtokens.org/TR/drafts/format/)
