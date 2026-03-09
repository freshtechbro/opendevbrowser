# Design Canvas Research

Status: second pass  
Date: 2026-03-09

Note: the canonical first-pass research file was later located at `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/DESIGN_CANVAS_RESEARCH.md`. This worktree copy is a synchronized second-pass synthesis based on current repo evidence plus current external research.

## Goal

Research how to add a live design canvas to OpenDevBrowser so an agent can design directly in the browser, see feedback in real time, and support multiple concurrent prototypes across tabs/pages.

The canvas should support:

- live agent-driven design changes
- low-fidelity wireframes and high-fidelity prototypes
- multi-tab or multi-page parallel prototype work
- immediate feedback on render errors, network issues, and runtime issues
- a future path to persisted design artifacts inside the repo

## What OpenDevBrowser Already Has

OpenDevBrowser already has most of the transport and runtime pieces needed for a first version.

### Existing control and transport surfaces

- [`/ops` is already the high-level extension control plane](docs/ARCHITECTURE.md). It supports typed `ops_request`, `ops_response`, `ops_event`, `ops_chunk`, `ops_ping`, and `ops_pong` envelopes in [`src/relay/protocol.ts`](src/relay/protocol.ts).
- The relay already supports multiple `/ops` clients, but only one `/annotation` client and one `/cdp` client at a time in [`src/relay/relay-server.ts`](src/relay/relay-server.ts).
- Legacy `/cdp` is intentionally lower-level and more constrained than `/ops`; it is not the preferred future surface for new product capabilities.

### Existing live-in-page UI path

- The closest reusable pattern is the annotation system: [`extension/src/annotate-content.ts`](extension/src/annotate-content.ts), [`src/browser/annotation-manager.ts`](src/browser/annotation-manager.ts), and [`docs/ANNOTATE.md`](docs/ANNOTATE.md).
- That path already injects visible UI into real pages, captures context, and returns structured payloads through the relay.
- This makes annotation-style injection the best starting point for a visible design overlay or canvas shell.

### Existing multitab and concurrency controls

- OpenDevBrowser already models concurrency by target/tab, not just by session.
- The extension ops runtime treats navigation, interaction, DOM, export, and screenshot commands as target-scoped in [`extension/src/ops/ops-runtime.ts`](extension/src/ops/ops-runtime.ts).
- The current default governor caps are already explicit in [`src/config.ts`](src/config.ts): `extensionOpsHeaded` defaults to `6`, while legacy extension CDP stays at `1`.
- Tab and target identity are already modeled in [`extension/src/services/TargetSessionMap.ts`](extension/src/services/TargetSessionMap.ts) and [`src/browser/target-manager.ts`](src/browser/target-manager.ts).

### Existing real-time feedback channels

- Console, network, and exception feedback already exist through [`src/devtools/console-tracker.ts`](src/devtools/console-tracker.ts), [`src/devtools/network-tracker.ts`](src/devtools/network-tracker.ts), [`src/devtools/exception-tracker.ts`](src/devtools/exception-tracker.ts), and the debug-trace surfaces documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- This means a design canvas does not need a separate feedback system from scratch. It can reuse current runtime telemetry.

### Existing export/code-generation-adjacent paths

- Page and component capture already exist through clone/export flows in [`src/export/`](src/export/) and CLI/tool surfaces such as `clone-page` and `clone-component`.
- That creates a natural future loop:
  - live page or design canvas
  - structured capture/export
  - generated code artifact
  - re-apply or compare

### DRY implementation principle

The first version should extend what OpenDevBrowser already has instead of creating parallel subsystems.

Reuse first:

- `/canvas` as the dedicated design surface, implemented on shared `/ops`-style internals
- annotation-style injection for the visible in-page shell
- target/session identity for prototype ownership
- existing governor and backpressure rules for multitab limits
- debug-trace, console, network, screenshot, and exception surfaces for live feedback
- export/clone/react-emitter flows for high-fi design-to-code integration

Create new primitives only where the repo is genuinely missing one:

- canonical persisted design document schema
- any design-specific renderer/compiler adapters needed for preview tabs

### Critical repo constraints surfaced by the audit

The current repo supports the direction above, but the details are stricter than the first draft implied.

- Reusing `/ops` internals means reusing lease ownership and reconnect semantics, not just copying envelope shapes. Requests are ownership-checked today.
- Annotation reuse is only a fit for visible overlay UI. The current annotation relay is single-client and request/response oriented, so it should not become the long-lived document-sync backbone.
- Overlay mode is transport-sensitive: extension sessions use the relay annotation path, while managed sessions use the direct annotation path. A portable overlay implementation has to support both.
- Current `/ops` diagnostics are session-scoped and strongest for console, network, perf, and screenshots. They are not yet a target-filtered design feedback stream.
- The extension path is headed-only and rejects restricted URLs. Any `/canvas` capability that depends on extension internals inherits those constraints.
- Large scene diffs or asset payloads must use the existing chunked payload model rather than the annotation payload path.

## External Patterns Worth Studying

### PencilDev

Pencil is the closest current reference for the product direction described here.

Key takeaways from current Pencil docs:

- Pencil positions itself as an infinite canvas inside the developer workflow, not as a separate handoff tool.
- Pencil uses `.pen` files as a persisted design format, and the docs describe them as JSON-based and git-friendly.
- Pencil explicitly promotes design-and-code co-location, including branching, mergeability, and text diffs.
- Pencil also treats variables as a design-token bridge and syncs them with CSS variables and Tailwind config.

Implication for OpenDevBrowser:

- The strongest Pencil-like idea is not just “canvas in browser”; it is “persisted design document in the repo, plus live editing, plus code sync.”
- That argues for a canonical design document format early, even if the first runtime editor is simple.

### tldraw

tldraw is the strongest reference if OpenDevBrowser wants a true infinite canvas with multiplayer and custom tools.

Key takeaways:

- tldraw has a mature SDK and a documented collaboration path via `@tldraw/sync`.
- Its multiplayer starter kit is built around WebSockets and persistent room/state infrastructure.
- It is designed for canvas-native editing, custom shapes, custom UI, and collaborative presence.

Implication for OpenDevBrowser:

- Best fit for low-fi to mid-fi canvas-first workflows.
- Strong candidate if the product wants agent-created wireframes, flows, notes, layout boards, and multi-user cursor/presence behavior.
- Less naturally DOM-native than a page builder, so a second representation or export layer would still be needed for high-fidelity page realization.

### GrapesJS

GrapesJS is the strongest reference if OpenDevBrowser wants a DOM-first visual builder.

Key takeaways:

- GrapesJS is explicitly an embeddable web builder framework.
- It uses a structured project model and supports loading/building HTML-like trees.
- GrapesJS documentation recommends persisting project data JSON rather than relying on generated HTML/CSS as the source of truth.
- It is good at drag/drop editing of page structure and styles, and it exposes update/load/project hooks.

Implication for OpenDevBrowser:

- Best fit for high-fidelity HTML/CSS editing and “edit the live page structure” workflows.
- Weaker fit for infinite-canvas exploration than tldraw.
- More risk around script execution, sandboxing, CSS bleed, and source-of-truth drift if raw HTML becomes the main document model.

### Excalidraw

Excalidraw is useful as a reference for lightweight scene modeling and agent-driven scene updates.

Key takeaways:

- It exposes `initialData`, `updateScene`, and JSON serialization utilities.
- It exposes a collaboration UI hook rather than forcing one backend.
- It is strong for wireframes, diagrams, and lightweight ideation.

Implication for OpenDevBrowser:

- Good reference for low-fi wireframing and simple JSON scene documents.
- Not the best base for pixel-perfect, code-synced front-end design by itself.

### Penpot

Penpot is useful as a standards-first model reference.

Key takeaways:

- Penpot explicitly positions itself around design/code collaboration and open standards.
- Penpot’s public materials emphasize SVG, CSS, HTML, and JSON, plus design tokens.
- Its data model separates files, pages, components, and shape trees.

Implication for OpenDevBrowser:

- Valuable reference for how to structure a long-lived design data model without locking into a pure canvas-only or HTML-only mindset.

### Yjs

Yjs is the strongest collaboration primitive reference if OpenDevBrowser wants shared document state rather than ad hoc message passing.

Key takeaways:

- `y-websocket` already supports document sync and awareness/presence.
- Yjs also supports cross-tab communication in the same browser.
- Awareness is explicitly separate from persisted document data.

Implication for OpenDevBrowser:

- Strong candidate for the collaboration/state-sync layer if the design document becomes multi-user or multi-agent.
- Especially useful if the same prototype can be opened in more than one tab, page, or viewer simultaneously.
- If the goal is the strongest long-term platform, Yjs is worth adopting from the start, but only at the document layer.
- Yjs should not replace `/canvas`, `/ops`, lease ownership, target routing, or preview-tab control.
- Clean integration means using upstream Yjs as a dependency behind an ODB-owned document-store seam, not forking or exposing Yjs internals as the product contract.
- Raw Yjs updates should stay private to that document-store layer; the public contract should remain ODB-native `/canvas` commands and patch batches.

## Additional Browser-Platform Grounding

The browser platform itself narrows the design.

### Local-first sync with a Yjs document layer

- `Yjs` should own the shared design document and merge semantics.
- `BroadcastChannel` should provide fast same-origin tab and worker fanout on one machine.
- `IndexedDB` should provide durable local storage for the working copy and offline recovery.
- For the favored long-term-platform path, these three belong together from the start.
- `y-indexeddb` or an equivalent adapter is the cleanest local persistence implementation detail, but it should sit behind an ODB-owned document-store boundary rather than becoming the public API.
- Awareness should stay optional and ephemeral in v1. It is useful later for presence, selection, or cursors, but it is not canonical document data.

### MV3 service worker constraints

- Extension service workers do not provide a durable in-memory source of truth. Global state can disappear on idle termination.
- Durable design state should therefore live in the document host and persisted storage, not in extension-service-worker globals.
- In practice, that means: document truth in the Yjs-backed design document plus IndexedDB, same-origin fanout through `BroadcastChannel`, small coordination metadata in `chrome.storage.local`, and relay/daemon state staying ephemeral.

### Dedicated design-tab host options

- An offscreen document is not a good primary canvas host because Chrome restricts it to limited extension use cases and only the `chrome.runtime` API.
- A side panel is useful for compact companion UI and it can remain open while navigating tabs, but this repo does not implement `sidePanel` today and a side panel is too constrained for the main infinite-canvas workspace.
- The most grounded v1 host for the dedicated editor is therefore an extension page tab or equivalent same-origin design tab, with overlay mode remaining the in-page high-fi surface.

## Document Format Options

The key design decision is to separate:

- transport format
- canonical persisted document format
- render/export format

These should not be forced to be the same thing.

### JSON

Best candidate for the canonical persisted design document.

Why:

- natural fit for scene graphs, page trees, layers, tokens, comments, constraints, and metadata
- works with current OpenDevBrowser typed envelopes
- easy to stream as patches or ops
- aligns with Pencil `.pen`, Excalidraw scene data, GrapesJS project data, and most CRDT/document models
- can cleanly embed a design-token subdocument aligned with current design-token standards work instead of inventing a token syntax from scratch

Best use:

- source of truth for canvas documents
- patch/stream payloads over `/canvas`
- persisted files in the repo

### TOML

Good for metadata, bad for primary scene data.

Why:

- readable and diffable
- good for tool config, page metadata, publish settings, token aliases, or workflow preferences
- poor fit for nested spatial trees, geometry, and rich scene edits

Best use:

- canvas/project metadata only

### Markdown

Good as a sidecar brief, not as the visual source of truth.

Why:

- excellent for design intent, acceptance criteria, annotations, rationale, prompts, and review notes
- poor fit for geometry, constraints, and visual hierarchy

Best use:

- design brief
- agent instructions
- review notes
- decision log attached to the design file

### HTML

Strong render/export target, weak primary source of truth.

Why:

- ideal for actual front-end rendering
- naturally maps to DOM/CSS and OpenDevBrowser’s runtime
- poor fit for safe diffing and semantic design editing unless wrapped in a structured model
- high risk if streamed directly into live pages without strong sandboxing and sanitization

Best use:

- preview output
- live prototype output
- export target
- import source for DOM-first builders

### Recommended hybrid

Recommended direction:

- canonical document: JSON
- optional sidecar brief/review: Markdown
- optional project/settings metadata: TOML or JSON
- runtime preview/export target: HTML/CSS

This gives OpenDevBrowser a clean split between:

- what the agent edits
- what the browser renders
- what git stores

## Communication and Bus Options

### Option 1: Add `/canvas` as the public design protocol on a shared `/ops` core

This is the strongest near-term option.

Why:

- keeps design traffic separate and debuggable at the product surface
- already multi-client
- already chunked
- already target-aware
- already typed
- can reuse the preferred extension-mode control plane internally without exposing `/ops` directly as the design API

Possible command families:

- `canvas.session.open`
- `canvas.document.load`
- `canvas.document.patch`
- `canvas.document.save`
- `canvas.overlay.mount`
- `canvas.overlay.unmount`
- `canvas.preview.render`
- `canvas.feedback.subscribe`

Canonical feedback event model for v1:

- `feedback.item` carrying target-attributed feedback categories such as `render`, `validation`, `console`, `network`, `performance`, `asset`, or `export`
- `feedback.heartbeat` for subscription liveness and cursor progression
- `feedback.complete` for terminal stream completion reasons such as session close, lease reclaim, or document unload

Selection changes are not a separate streamed event family in v1; selection resolution is returned directly by `canvas.overlay.select` and may optionally produce a normal `feedback.item` when it leads to validation or render feedback.

Assessment:

- recommended primary bus shape

### Handshake and agent preflight

The governance model only works if the agent can discover it from OpenDevBrowser at session start.
It is not enough to document requirements in markdown and hope the agent remembers them.

Recommended handshake flow:

1. the agent opens a canvas session
2. OpenDevBrowser returns a machine-readable handshake payload
3. the handshake tells the agent exactly what must be provided before mutation
4. the agent submits its `generationPlan`
5. OpenDevBrowser validates the plan and only then accepts design patches

Recommended handshake contents:

- canvas session id, browser session id, lease id, and document id
- schema version and policy version
- governance requirements split into `requiredBeforeMutation`, `requiredBeforeSave`, and `optionalInherited`
- governance block states such as `present`, `missing`, `inherited`, or `locked`
- required `generationPlan` fields
- supported variant dimensions and required state coverage
- current document defaults, existing tokens, themes, viewports, and component inventory when a document already exists
- approved libraries, icon policy, and adapter constraints
- runtime budgets and preview-cap rules, including reconnect grace
- warning and blocker classes that the agent may encounter
- whether patching is blocked until the plan is accepted

OpenDevBrowser-specific implication:

- the handshake must be part of the `/canvas` surface, not an out-of-band convention
- the browser should expose what it expects from the agent before the agent sends design instructions
- this is how intent, design language, content model, and similar requirements become visible to the agent in a deterministic way
- if a user resumes an existing design document, the handshake should also expose which governance blocks are already present and which are still missing

Recommended product stance:

- treat `canvas.session.open` as the handshake opener
- allow a refresh command such as `canvas.capabilities.get` or equivalent if the agent needs to re-read the current contract
- reject or warn on first mutation when the session has not yet supplied the required `generationPlan`

### Skill and artifact delivery for the handshake

The handshake is the canonical runtime contract, but the agent still needs a durable preparation surface before it calls `/canvas`.
That guidance should be delivered through two existing skills, not a third dedicated canvas skill.

Recommended split:

- keep OpenDevBrowser runtime guidance in the repo-packaged `skills/opendevbrowser-best-practices/`
- keep design semantics and planning semantics in the global Codex `design-agent` skill
- do not introduce a separate `design-canvas` skill in v1 planning, because it would duplicate both the runtime choreography and the design-governance meanings

Why this split works:

- the bundled OpenDevBrowser skill already owns command/channel guidance, packaged artifacts, workflow scripts, and robustness audits
- the global `design-agent` skill is the right place to teach what `intent`, `designLanguage`, `contentModel`, `layoutSystem`, and the `generationPlan` fields actually mean
- the runtime handshake remains authoritative, while the two skills help the agent prepare correctly before first mutation

Recommended future changes to the bundled repo skill pack:

- update `skills/opendevbrowser-best-practices/SKILL.md` with a `Canvas Governance Handshake` section and a `canvas.session.open -> canvas.plan.set -> canvas.document.patch` preflight loop
- extend `skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md` so it includes `/canvas`, the handshake payload shape, and the `plan_required` blocker path
- add a focused artifact such as `skills/opendevbrowser-best-practices/artifacts/canvas-governance-playbook.md` so the canvas flow is documented separately from provider/search workflows
- extend `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh` with canvas-specific router entries such as `canvas-preflight` and `canvas-feedback-eval`
- extend `skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh` so new canvas artifacts and templates are checked as part of skill validation
- extend `skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh` and `assets/templates/robustness-checklist.json` so canvas-specific issue coverage becomes machine-verifiable

Recommended future canvas-specific templates in the bundled repo skill pack:

- `assets/templates/canvas-handshake-example.json`
- `assets/templates/canvas-generation-plan.v1.json`
- `assets/templates/canvas-feedback-eval.json`
- `assets/templates/canvas-blocker-checklist.json`

Recommended future canvas-specific robustness issues:

- `CANVAS-01`: handshake missing or unread before mutation
- `CANVAS-02`: required governance block missing
- `CANVAS-03`: required `generationPlan` field missing or malformed
- `CANVAS-04`: unsupported library or icon-policy violation
- `CANVAS-05`: unsupported target or overlay mount failure
- `CANVAS-06`: runtime budget exceeded or preview downgrade ignored
- `CANVAS-07`: feedback lacks target attribution or validation payloads

Recommended future changes to the global Codex `design-agent` skill:

- teach the meaning of every required governance block exposed by the handshake
- teach the meaning of every required `generationPlan` field:
  - `targetOutcome`
  - `visualDirection`
  - `layoutStrategy`
  - `contentStrategy`
  - `componentStrategy`
  - `motionPosture`
  - `responsivePosture`
  - `accessibilityPosture`
  - `validationTargets`
- include a minimal planning skeleton that the agent can fill before first mutation
- explicitly teach that the agent should reconcile with `documentContext` instead of overwriting an existing governance model blindly

### Option 2: Reuse `/annotation` patterns for visible overlay UI only

This is useful, but should not be the main sync protocol.

Why:

- current annotation path already knows how to inject UI and collect structured user/page context
- but the relay currently allows only one annotation client, which makes it a bad long-lived multi-canvas backbone

Assessment:

- good for overlay shell and in-page interaction
- not recommended as canonical transport

### Option 3: Use `/cdp` for low-level DOM/CSS mutation

This should stay secondary.

Why:

- raw power
- easy to mutate CSS, DOM, overlay, or styles directly
- but it is legacy, single-client, and currently blocked when an ops-owned target is active

Assessment:

- useful implementation substrate
- not recommended as the product surface

### Option 4: Add an internal extension-side bus

Examples:

- `chrome.runtime` messaging
- long-lived ports
- offscreen document messaging
- same-origin `BroadcastChannel`

Why:

- useful inside the extension for keeping service worker, offscreen document, popup, and injected UIs in sync
- useful if a dedicated design editor page is added
- strongest chosen path here is a Yjs-backed document with `BroadcastChannel` for same-origin fanout, `IndexedDB` for durable local state, and `chrome.storage.local` only for small extension coordination metadata

Assessment:

- good internal wiring option
- not sufficient by itself for agent-to-browser product transport

### Option 5: Daemon event stream

OpenDevBrowser’s daemon currently exposes request/response HTTP for commands.

A future event stream could be added through:

- WebSocket
- SSE
- long-poll

Assessment:

- possibly useful later for non-extension viewers or external observers
- not required if `/ops` remains the live extension transport

## Architecture Directions

### Direction A: Overlay-first live page designer

Model:

- agent sends design commands
- daemon routes through `/canvas` on shared `/ops` internals
- extension injects a visible design overlay into the current live page
- overlay renders handles, frame boundaries, guides, tokens, comments, and preview controls
- page DOM/CSS are mutated or previewed live

Pros:

- closest to current OpenDevBrowser strengths
- easiest path to “design directly in the browser in real time”
- best for editing actual product pages with instant runtime feedback

Cons:

- harder to build a clean canonical document model if it starts as direct DOM mutation only
- needs strong rollback, transaction boundaries, and drift handling

Best for:

- high-fidelity page editing
- code-adjacent prototype refinement

### Direction B: Dedicated infinite-canvas editor plus live preview tabs

Model:

- one tab hosts the design canvas/editor
- other tabs host live preview or alternate prototype branches
- the agent edits a scene document, not the page directly
- preview tabs render from the scene or from generated HTML/CSS

Pros:

- clean separation of editor and preview
- natural fit for multi-tab experiments
- better for lo-fi to mid-fi ideation, flows, and alternate concepts

Cons:

- requires a renderer or compiler from design scene to live prototype
- less direct than editing the actual DOM first

Best for:

- wireframes
- variant exploration
- collaborative review boards

### Direction C: DOM-first builder in sandboxed iframe

Model:

- current page or exported page snapshot is loaded into a sandboxed builder surface
- agent and user edit a structured HTML/CSS representation
- output is reapplied to preview/live page

Pros:

- best for high-fidelity HTML/CSS manipulation
- maps closely to final implementation

Cons:

- hardest security surface
- sandbox and script execution policy become critical
- imported pages can be messy and non-deterministic

Best for:

- page-builder and landing-page style editing

### Direction D: Repo-native design document first

Model:

- introduce a canonical repo design document early
- live editors and previews are just views over that document

Pros:

- strongest long-term architecture
- best git behavior
- best agent reproducibility

Cons:

- requires front-loading schema design and migration planning

Best for:

- durable feature platform, not just a quick demo

## Recommended Direction

Recommended near-term path:

1. Introduce `/canvas` as the dedicated live-design surface.
2. Implement `/canvas` as a thin layer over shared request envelopes, routing, ownership, and backpressure primitives already proven in `/ops`.
3. Reuse annotation-style injection for the visible in-page UI shell, but treat annotation as an overlay transport only, not document sync.
4. Host the dedicated editor in an extension page tab or same-origin design tab, not in the service worker, offscreen document, or side panel.
5. Introduce a Yjs-backed JSON design document from the start, scoped to the document layer only.
6. Use `BroadcastChannel` plus `IndexedDB` around that Yjs document for same-machine local coherence and durability.
7. Treat the product as two views over one repo-native design document:
   - infinite canvas editor
   - live page preview/editor
8. Treat HTML/CSS as render output, not the only persisted model.
9. Reuse the existing target-scoped governor for multi-tab prototype caps.
10. Define explicit preview policies for live-tab caps, inactive-tab downgrade, thumbnail vs full render, and reconnect/lease reclaim.

Recommended product split:

- public design surface: `/canvas`
- shared transport/runtime core: reuse `/ops` envelope, routing, lease ownership, chunking, target ownership, and diagnostic patterns
- shared document layer: Yjs over the canonical JSON design document
- internal document-store seam: apply `/canvas` patch batches inside Yjs transactions, then project canonical JSON back to the editor, preview, and repo-save paths
- visible editor views:
  - infinite canvas editor in the design tab
  - live page preview/editor through preview tabs and overlay mode
- persisted document: JSON
- local same-machine fanout: `BroadcastChannel`
- local durable working store: `IndexedDB`
- optional sidecar intent/review: Markdown
- preview/runtime output: HTML/CSS

## Multi-Tab and Multi-Page Model

Recommended model:

- one design document per canvas workspace
- one document may contain multiple pages and multiple prototype routes
- one preview tab renders one prototype route at a time
- optional room id can be added later if collaborative sync is introduced

Map this onto current runtime concepts:

- session id: overall browser session
- target id/tab id: one runtime preview target
- document id: one persisted design artifact or workspace
- prototype id: one previewable route/state definition inside a document
- lease/client id: transport ownership

This matches current OpenDevBrowser structure well and lets the existing governor remain the capacity control:

- same target: FIFO
- different targets: parallel up to the configured cap

Implementation-closure items now fixed in the technical spec:

- the canonical identity model now separates `canvasSessionId`, browser `sessionId`, `documentId`, `pageId`, `prototypeId`, `targetId`, and `leaseId`
- the handshake now distinguishes `requiredBeforeMutation`, `requiredBeforeSave`, and `optionalInherited` governance tiers
- the exact `generationPlan` object shape and the session preflight state machine are specified
- the request/response contracts for `canvas.session.open`, `canvas.plan.set`, `canvas.document.patch`, `canvas.preview.render`, and `canvas.feedback.poll` are specified
- the repo-save contract now fixes the default artifact path and deterministic serializer rules
- the preview-state ladder and reconnect grace are fixed in the implementation-facing runtime policy

## Immediate Feedback Model

The agent should not only receive “render success/failure.” It should receive structured runtime feedback for correction loops.

Recommended feedback bundle:

- render status
- console errors and warnings
- network failures
- runtime exceptions where available, with a note that current `/ops` reuse is stronger for console/network/screenshot than exception streaming
- screenshot or thumbnail after render
- selected element/frame metadata
- design validation warnings:
  - overflow
  - missing token mapping
  - inaccessible contrast
  - broken asset reference
  - responsive breakpoint drift

OpenDevBrowser already has most of this telemetry. The missing step is bundling it as a design-focused feedback contract.
It also needs target attribution added for multi-tab isolation because current `/ops` diagnostics are primarily session-scoped.

## Important Considerations Not To Skip

### 1. Persistence and merge strategy

If the design state is worth keeping, it needs:

- schema versioning
- migration rules
- stable ids
- deterministic serialization
- merge behavior
- a split between local working persistence (`IndexedDB`) and repo persistence (saved JSON artifact)

### 2. Undo/redo and transaction boundaries

Direct live DOM edits without explicit transactions will become hard to reason about.

### 3. Security

If HTML is rendered or imported dynamically:

- use sandboxed iframes where possible
- treat raw HTML injection as hostile by default
- respect MV3 extension CSP constraints
- strongly consider Trusted Types or sanitization for any HTML sink path

### 4. Asset pipeline

The asset path cannot be implicit. It needs a contract.

Recommended asset classes:

- `repo`
  Stable repo-relative assets already present in the workspace such as `assets/` files or app-local images.
- `remote`
  External URLs used for working preview, subject to CORS, network, and determinism limits.
- `page-derived`
  Assets discovered from the current live page during high-fi editing.
- `generated`
  Agent-created assets, screenshots, thumbnails, or transformed outputs.
- `transient`
  Working-only assets that exist for one session and should not silently become repo truth.

Recommended asset model:

- keep only metadata and references in the design document
- keep large binaries outside Yjs in a blob cache or local persistence layer
- assign canonical asset ids with provenance, source type, mime type, size, and last-known resolution metadata
- separate working-preview references from repo-save references
- inline only very small text-like assets such as sanitized SVG or tiny icon payloads; everything else should be blob-backed

Specific requirements:

- images should support intrinsic metadata plus responsive variants such as `srcset`, `sizes`, and preview-priority hints
- SVG should be sanitized and treated as potentially hostile input, especially if imported from pages or remote URLs
- fonts should store family, weight, style, source, and display strategy; if no project rule exists, live preview should default to a non-blocking font-display strategy
- icons should support both file assets and component-library icon identifiers
- remote assets can be acceptable for working preview, but repo-save should preserve explicit provenance and flag unresolved or non-deterministic dependencies
- repo assets should resolve by stable workspace-relative paths rather than transient browser URLs
- non-critical media should support lazy-loading behavior in preview so multipage design sessions do not eagerly decode everything at once

OpenDevBrowser-specific implication:

- the agent should request asset imports or placements through `/canvas`
- the browser should remain responsible for probing asset load success, CORS failures, broken references, and runtime rendering behavior
- large image or asset transfers must stay on chunked transport paths, not annotation payloads

### 5. Design tokens and component libraries

The most durable value comes from making tokens and components first-class, not post-processing details.

Recommended contract:

- keep the canonical token document ODB-native but structurally compatible with current Design Tokens Community Group format ideas such as typed values, aliases, and component-level tokens
- prefer semantic tokens over raw literals in mutations and exports
- sync outward to CSS custom properties first, then adapt to framework-specific layers such as Tailwind theme variables
- treat component inventories as part of the document contract, not an afterthought

Recommended token sync layers:

- canonical token graph in the ODB document
- CSS variable projection for live preview and exported code
- Tailwind adapter that maps canonical tokens into theme variables or project-specific theme configuration
- component-library adapter that binds token names to component props, slot classes, and CSS variable expectations

Current-source grounding:

- Tailwind’s current docs emphasize theme variables and named breakpoints, which makes CSS-variable-first token projection the most stable bridge
- shadcn’s current docs center `components.json`, aliases, and CSS-variable-driven theming, which fits an adapter model better than a canonical schema dependency

Recommended component inventory fields:

- source kind such as `repo`, `shadcn`, `exported`, `canvas-local`
- import path and export name when known
- expected props and slot names when known
- token slots or CSS variable dependencies
- binding confidence and warnings when inferred from live DOM/export flows

OpenDevBrowser-specific implication:

- current export and React-emitter paths already provide a fallback HTML-and-CSS route
- the new design system should add token and component mapping on top of those paths, not replace them outright
- if component mapping is missing, export should still succeed but emit explicit warnings

### 5.5 Icon system policy

The icon layer should not be treated as one interchangeable pool. The research converges on a layered stack.

Recommended role split:

- `primary`
  `3dicons` should be the main visual-richness source for high-impact product surfaces such as hero areas, feature highlights, concept boards, onboarding moments, and premium prototype scenes.
- `secondary`
  `Tabler` should be the utility icon system for dense product UI such as toolbars, navigation, buttons, forms, states, and routine interface chrome.
- `secondary-alt`
  `Microsoft Fluent UI System Icons` is a valid alternative utility layer if the product intentionally wants a softer Fluent-like system aesthetic, but it should not replace `3dicons` or the decorative layer.
- `decorative`
  `@lobehub/fluent-emoji-3d` should be used for personality, celebration, empty states, communication moments, and playful accents.

Recommended exclusions:

- `lucide-react` should not be a preferred default in this stack because it overlaps too heavily with the Tabler role while adding a React-specific package surface and a less favorable fit for a repo-native, layered icon policy.

Why this split is stronger than choosing one library:

- `3dicons` is strong on visual richness but not ideal for every tiny product control
- `Tabler` is strong on utility clarity but not on premium visual richness
- `@lobehub/fluent-emoji-3d` adds warmth and color, but it is not a full product UI icon system
- `Microsoft Fluent UI System Icons` is a useful utility alternative, not a richer replacement for the whole stack

OpenDevBrowser-specific implication:

- icon references in the design document should carry both a role and a source
- the preview/editor should default to the approved role stack instead of letting every prototype mix unrelated icon families freely
- icon swaps should be treated like component or asset changes, with validation warnings when a prototype uses a non-approved family without explicit override
- tiny utility icons can stay component-identified, while richer 3D or emoji-style assets should stay file-backed or asset-backed

### 6. Responsive states

The document model cannot stop at one static frame.

Required variant dimensions:

- viewport or breakpoint variants
- theme variants such as light, dark, or brand themes
- interaction states such as default, hover, focus, active, disabled
- content states such as empty, loading, success, error

Recommended model:

- store base design intent once
- layer variant patches on top instead of duplicating whole pages for every breakpoint or theme
- keep viewport profiles explicit so preview tabs can map to named breakpoints
- keep theme and interaction variants explicit so agents can request targeted edits such as “dark mode mobile hover state”

OpenDevBrowser-specific implication:

- preview targets should be attributable to a named viewport and theme profile
- responsive drift should be part of the validation feedback contract
- breakpoints should stay framework-independent in the document, even if adapters later emit Tailwind-specific breakpoint variables
- theme profiles should be explicit enough to drive light, dark, and brand variants without requiring duplicated pages

### 6.5 Agent design principles

Real-time design only stays coherent if agents follow explicit design rules.

Recommended principles:

- tokens before literals
- components before raw DOM clones when a reliable component inventory exists
- schema-safe patch batches before raw HTML or CSS edits
- low-fi structure first, high-fi DOM binding only when needed
- one design intent per patch batch so undo, replay, and feedback remain legible
- every mutation loop should return both design warnings and runtime evidence before the next mutation
- preserve accessibility, hierarchy, and responsive intent as first-class constraints, not optional polish
- treat performance cost as a design constraint, especially for fonts, hero media, multiple live previews, and rich overlays

### 6.6 Deterministic design-governance inventory

If OpenDevBrowser wants agents to produce beautiful UI consistently, design quality cannot stay implicit in prompts or hidden in renderer defaults.
The product needs one explicit inventory of the design decisions an agent must either declare, inherit, or validate.

Recommended three-layer model:

- document-level governance
  persisted JSON fields that describe design intent, visual policy, content policy, and runtime limits
- agent operating guidance
  mutation-time rules that tell the agent how to use the document coherently
- validation and release gates
  warnings and blockers that detect drift between declared design intent and rendered behavior

Recommended persisted governance categories:

- `intent`
  goal, audience, primary task, emotional target, trust posture, and success criteria
- `generation plan`
  the agent-declared strategy for reaching the end state, including chosen visual direction, layout/content approach, component/icon/library choices, motion posture, responsive posture, accessibility posture, and validation targets
- `design language`
  a named direction plus explicit style axes such as editorial vs product-led, minimal vs expressive, flat vs layered, and 2D vs 3D-forward
- `content model`
  information architecture, message hierarchy, copy voice, CTA strategy, and empty/loading/error content expectations
- `layout system`
  grid, container rules, spacing rhythm, alignment discipline, focal path, and density policy
- `typography system`
  type families, fallback stacks, scale, weights, line-height, measure, localization coverage, and loading strategy
- `color and surface system`
  palette roles, semantic colors, contrast expectations, shape, radius, border, elevation, translucency, and texture
- `icon and imagery policy`
  approved icon families, illustration style, photography/imagery rules, motion-imagery and video policy, and provenance expectations
- `motion system`
  timing, easing, choreography, micro-interaction rules, reduced-motion policy, and limits for 3D, parallax, and smooth scrolling
- `responsive and adaptive policy`
  viewport model, theme model, interaction/content state coverage, touch vs pointer assumptions, large-text behavior, and RTL/localization adaptation
- `library policy`
  approved component, icon, motion, and 3D libraries plus adapter ownership and deprecation rules
- `runtime budgets`
  preview-tab caps, media/font weight expectations, telemetry and memory guardrails, and live-vs-degraded rendering policy

Recommended agent-only guidance categories:

- generation plan before first mutation
- tokens before literals
- components before raw clones
- no implicit typography, spacing, color-role, or state coverage assumptions
- one design intent per patch batch
- no 3D, parallax, autoplay video, or custom smooth scrolling without explicit policy and reduced-motion fallback
- content clarity, accessibility, and runtime cost are co-equal with visual polish

Recommended validation-gate categories:

- missing governance block
- missing viewport, theme, or interaction-state coverage
- weak hierarchy or insufficient type contrast
- contrast failures
- reduced-motion policy violations
- responsive drift
- unresolved asset, font, icon, or provenance data
- unapproved library usage
- runtime-budget overflow

Recommended document-model implication:

- the research note should describe the full governance inventory and why each category matters
- the technical spec should encode that same inventory as required schema blocks, runtime rules, and warning classes
- `/canvas` should stay thin; it should reference the governance model rather than trying to smuggle design policy into every command separately
- the cleanest stored representation is both a named design-direction profile and explicit style axes so prompting stays compact while validation stays deterministic
- agents should begin with the end goal in mind by declaring how they intend to generate the output before they start mutating the canvas; this preflight guidance is part of the deterministic contract, not optional narration

### 7. Restricted pages and origin boundaries

Some Chrome pages and origins cannot be instrumented normally. The canvas architecture must account for unsupported targets and degraded modes.

### 8. Performance and memory pressure

A live canvas plus preview tabs plus telemetry will create pressure quickly. Reusing the existing governor is necessary, but not sufficient. The product should also define:

- max simultaneous live preview tabs
- inactive tab downgrade behavior
- thumbnail vs full render rules
- reconnect and lease-reclaim behavior for long-lived canvas sessions

Recommended starting posture:

- keep a small number of fully live preview tabs active at once
- v1 should start with 2 fully live preview tabs by default and allow a 3rd only when pinned and the governor remains healthy
- downgrade inactive previews to lighter refresh or thumbnail mode
- reserve full renders for focused or pinned previews
- make reconnect and lease reclaim explicit user-visible states, not hidden runtime behavior
- keep binary assets, screenshots, and thumbnails out of Yjs; store only metadata and references in the shared document
- use local blob caching and eviction for generated thumbnails or screenshots
- pause or degrade telemetry frequency for inactive previews
- use lazy-loading and responsive-image behavior for non-critical media where possible
- avoid turning every preview tab into a full-fidelity live runtime if the user only needs thumbnails or breakpoint checks
- keep canvas preview caps stricter than the raw `/ops` extension governor ceiling; the canvas is a heavier product surface than plain tab automation

Recommended degradation ladder:

1. focused tab: full interactive render and full telemetry
2. pinned tab: full render with lower priority
3. background tab: lighter refresh cadence and sampled telemetry
4. overflow, frozen, or discarded tab: thumbnail-only until resumed

Recommended local-state overhead rules:

- assets and blobs never live in Yjs
- awareness stays off by default in v1
- autosave to IndexedDB is frequent and local, while repo save stays explicit and versioned
- BroadcastChannel fanout should be batched so tiny mutation bursts do not become chatty local traffic

Recommended icon-stack policy for v1:

- `3dicons` as the primary visual-richness layer
- `Tabler` as the default utility layer
- `@lobehub/fluent-emoji-3d` as the decorative accent layer
- `Microsoft Fluent UI System Icons` as an approved utility alternative when a Fluent-like system look is wanted
- no default `lucide-react` adoption in the canonical stack

## Recommendation Summary

OpenDevBrowser should implement one chosen platform, not keep multiple competing recommendation tracks live:

- build a JSON-document, repo-native design system with two views:
  - infinite canvas editor
  - live page preview/editor

The chosen direction is hybrid:

- repo-native OpenDevBrowser JSON design document
- separate `/canvas` surface built on shared `/ops`-style internals
- both overlay mode and dedicated design-tab mode in v1
- strongest long-term platform path: two views over one document
- Yjs from the start at the document layer only
- `BroadcastChannel` plus `IndexedDB` for same-machine sync and durability
- upstream `yjs` and `y-indexeddb` behind an ODB-owned document-store seam; no vendoring, no public Yjs wire format
- first-class assets, tokens, component inventories, and responsive/theme variants in the document model
- tight reuse of existing export and React/component flows
- deterministic agent preparation delivered through two existing skills: the repo-packaged `opendevbrowser-best-practices` skill for runtime flow and the global `design-agent` skill for governance semantics
- the command namespace is `canvas.*`; the earlier `design.*` examples are superseded

## Resolved Product Decisions

- Scope: support both low-fi wireframes and high-fi live page editing in v1.
- Persisted format: use a custom OpenDevBrowser JSON schema that borrows good ideas from scene-model tools without cloning any single external format.
- Editor surfaces: support both injected overlay mode and dedicated design-tab mode; let users choose based on whether they want to work against the live page or on a clean canvas.
- Collaboration/data model: adopt Yjs from the start, but scope it to the design-document layer while keeping the user workflow single-user on one machine in v1.
- Yjs rationale in v1: even for one user, the design tab, overlay, and preview targets need one convergent working document with local recovery across refreshes, crashes, and reconnects.
- Integration: keep design-to-code flows tightly integrated with the existing export, clone, and React/component generation paths.
- Document model: treat assets, component inventories, viewports, and themes as first-class schema sections instead of burying them in HTML or CSS blobs.
- Runtime architecture: expose `/canvas` separately, but keep it DRY by reusing shared `/ops`-style envelopes, target ownership, backpressure, diagnostics, and daemon routing primitives underneath.
- Local state strategy: use Yjs plus `BroadcastChannel` for cross-tab sync and `IndexedDB` for durable local document storage in v1.
- Dedicated editor host: prefer an extension page tab or equivalent same-origin design tab; do not use offscreen documents as the main editor host.
- Skill delivery: do not create a dedicated canvas skill in v1 planning; instead, update the repo-packaged `skills/opendevbrowser-best-practices/` and the global Codex `design-agent` skill with a clean runtime-vs-design responsibility split.
- Identity model: one document can contain multiple pages and prototype routes; preview tabs attach to a prototype within that document instead of using one separate document per tab.

## Sources

### OpenDevBrowser repo

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/SURFACE_REFERENCE.md`](docs/SURFACE_REFERENCE.md)
- [`docs/ANNOTATE.md`](docs/ANNOTATE.md)
- [`docs/ASSET_INVENTORY.md`](docs/ASSET_INVENTORY.md)
- [`src/relay/relay-server.ts`](src/relay/relay-server.ts)
- [`src/relay/protocol.ts`](src/relay/protocol.ts)
- [`src/config.ts`](src/config.ts)
- [`src/browser/ops-browser-manager.ts`](src/browser/ops-browser-manager.ts)
- [`src/export/dom-capture.ts`](src/export/dom-capture.ts)
- [`src/export/css-extract.ts`](src/export/css-extract.ts)
- [`src/export/react-emitter.ts`](src/export/react-emitter.ts)
- [`extension/src/ops/ops-runtime.ts`](extension/src/ops/ops-runtime.ts)
- [`extension/src/services/TargetSessionMap.ts`](extension/src/services/TargetSessionMap.ts)
- [`extension/src/annotate-content.ts`](extension/src/annotate-content.ts)

### External

- [Pencil homepage](https://www.pencil.dev/)
- [Pencil docs: `.pen` files](https://docs.pencil.dev/core-concepts/pen-files)
- [Pencil docs: Design as Code](https://docs.pencil.dev/core-concepts/design-as-code)
- [Pencil docs: Variables](https://docs.pencil.dev/core-concepts/variables)
- [Pencil docs: Design ↔ Code](https://docs.pencil.dev/design-and-code/design-to-code)
- [tldraw docs: Collaboration](https://tldraw.dev/docs/collaboration)
- [tldraw docs: Multiplayer starter kit](https://tldraw.dev/starter-kits/multiplayer)
- [GrapesJS docs](https://grapesjs.com/docs/)
- [GrapesJS editor API](https://grapesjs.com/docs/api/editor.html)
- [Yjs docs: Awareness](https://docs.yjs.dev/api/about-awareness)
- [Yjs docs: y-websocket](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket)
- [Yjs docs: offline editing and y-indexeddb](https://docs.yjs.dev/getting-started/allowing-offline-editing)
- [Chrome docs: `chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Chrome docs: message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome docs: service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome docs: `chrome.sidePanel`](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome docs: `chrome.offscreen`](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome docs: extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [MDN: BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [MDN: IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [MDN: Responsive images](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images)
- [MDN: Lazy loading](https://developer.mozilla.org/en-US/docs/Web/Performance/Lazy_loading)
- [MDN: `font-display`](https://developer.mozilla.org/en-US/docs/Web/CSS/%40font-face/font-display)
- [Tailwind docs: Theme variables](https://tailwindcss.com/docs/theme)
- [Tailwind docs: Breakpoints](https://tailwindcss.com/docs/breakpoints)
- [shadcn docs: Theming](https://ui.shadcn.com/docs/theming)
- [shadcn docs: `components.json`](https://ui.shadcn.com/docs/components-json)
- [Design Tokens Community Group format draft](https://www.designtokens.org/tr/drafts/format/)
- [MDN: Broadcast Channel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
- [MDN: CSP guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- [MDN: Trusted Types API](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API)
- [MDN: iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/sandbox)
- [Penpot repository](https://github.com/penpot/penpot)
- [Penpot technical guide: data model](https://help.penpot.app/technical-guide/developer/data-model/)
- [Excalidraw docs: API overview](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api)
- [Excalidraw docs: `initialData`](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/initialdata)
- [Excalidraw docs: `excalidrawAPI`](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)
- [Excalidraw docs: export utilities](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export)
