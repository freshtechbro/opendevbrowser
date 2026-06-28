# OpenDevBrowser Surface Reference

Source-accurate inventory for CLI commands, plugin tools, relay channel commands, flags, and modes.
Status: active  
Last updated: 2026-06-05

This reference is intentionally exhaustive and should stay synchronized with:
- `src/public-surface/source.ts`
- `scripts/generate-public-surface-manifest.mjs`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `src/cli/args.ts`
- `src/cli/help.ts`
- `src/tools/index.ts`
- `extension/src/ops/ops-runtime.ts`
- `extension/src/canvas/canvas-runtime.ts`
- `src/browser/canvas-manager.ts`
- `src/relay/protocol.ts`

Operational mirror:
- `npx opendevbrowser --help` (all commands with usage + primary flags, all grouped flags, all tools)
- `npx opendevbrowser help` (same inventory as `--help`)

First-contact note:
- Start with generated help and `docs/FIRST_RUN_ONBOARDING.md`; this page stays inventory-only.
- Generated help now leads with a `Find It Fast` block for `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use`; this page stays inventory-only.
- Installer lifecycle owns refresh and cleanup of the canonical bundled skill packs; this page stays inventory-only.

---

## CLI Command Inventory (77)

### Install and runtime management (10)
- `install` - Install the plugin.
- `update` - Repair OpenCode package caches and refresh managed skill packs.
- `uninstall` - Remove plugin from config.
- `help` - Show help.
- `version` - Show version.
- `serve` - Start or stop the local daemon.
- `daemon` - Install, uninstall, or inspect daemon auto-start.
- `native` - Install, uninstall, or inspect the native messaging host.
- `run` - Execute a JSON script in a single process.
- `artifacts` - Manage workflow artifact lifecycle.

### Session, connection, and workflow wrappers (11)
- `launch` - Launch a managed browser session via daemon.
- `connect` - Connect to an existing browser via daemon.
- `disconnect` - Disconnect a daemon session.
- `status` - Get daemon or session status.
- `status-capabilities` - Inspect runtime capability discovery for the host and an optional session.
- `cookie-import` - Import validated cookies into a session.
- `cookie-list` - List cookies for a session, optionally filtered by URL.
- `research` - Run research workflows.
- `shopping` - Run shopping workflows.
- `product-video` - Run product presentation asset workflows.
- `inspiredesign` - Run inspiredesign workflows and visual reference harvests.

### Navigation (5)
- `goto` - Navigate the current session to a URL.
- `wait` - Wait for load completion or a ref/state condition.
- `snapshot` - Capture a snapshot of the active page.
- `review` - Capture a first-class review payload for the active target.
- `review-desktop` - Capture desktop-assisted browser review with read-only desktop evidence and browser-owned verification.

### Interaction (14)
- `click` - Click an element by ref.
- `hover` - Hover an element by ref.
- `press` - Press a keyboard key.
- `check` - Check a checkbox by ref.
- `uncheck` - Uncheck a checkbox by ref.
- `type` - Type into an element by ref.
- `select` - Select values in a select by ref.
- `scroll` - Scroll the page or an element by ref.
- `scroll-into-view` - Scroll an element into view by ref.
- `upload` - Upload files to a file input or chooser by ref.
- `pointer-move` - Move the pointer to viewport coordinates.
- `pointer-down` - Press a mouse button at viewport coordinates.
- `pointer-up` - Release a mouse button at viewport coordinates.
- `pointer-drag` - Drag the pointer between two viewport coordinates.

### Targets and pages (7)
- `targets-list` - List page targets.
- `target-use` - Focus a target by id.
- `target-new` - Open a new target.
- `target-close` - Close a target by id.
- `page` - Open or focus a named page.
- `pages` - List named pages.
- `page-close` - Close a named page.

### DOM inspection (7)
- `dom-html` - Capture HTML for a ref.
- `dom-text` - Capture text for a ref.
- `dom-attr` - Capture an attribute value for a ref.
- `dom-value` - Capture an input value for a ref.
- `dom-visible` - Check visibility for a ref.
- `dom-enabled` - Check enabled state for a ref.
- `dom-checked` - Check checked state for a ref.

### Browser capture (3)
- `screenshot` - Capture a still browser image.
- `screencast-start` - Start a browser replay capture that samples the existing screenshot lane.
- `screencast-stop` - Stop a browser replay screencast capture.

Browser capture behavior:
- Omitted screenshot output saves `.opendevbrowser/screenshot/<uuid>/capture.png` and returns `path` plus `artifact_path`; explicit `--path` remains caller-controlled.
- Omitted screencast output saves replay files under `.opendevbrowser/screencast/<uuid>` and returns `artifact_path`; explicit `--output-dir` remains caller-controlled.

### Desktop observation (6)
- `desktop-status` - Inspect public read-only desktop observation availability.
- `desktop-windows` - List windows exposed by the public read-only desktop observation plane.
- `desktop-active-window` - Inspect the active window through the public read-only desktop observation plane.
- `desktop-capture-desktop` - Capture the current desktop surface through the public read-only desktop observation plane.
- `desktop-capture-window` - Capture a specific window through the public read-only desktop observation plane.
- `desktop-accessibility-snapshot` - Capture desktop accessibility state through the public read-only desktop observation plane.

Operational note:
- On macOS, this plane requires the local `swift` command for availability, window, and accessibility probes; missing `swift` surfaces `desktop_unsupported`.

### Design canvas (1)
- `canvas` - Execute a design-canvas command.

### Export, diagnostics, macro, annotation, power (13)
- `clone-page` - Clone the active page to React.
- `clone-component` - Clone a component by ref.
- `perf` - Capture performance metrics.
- `dialog` - Inspect or handle a JavaScript dialog.
- `console-poll` - Poll console events.
- `network-poll` - Poll network events.
- `debug-trace-snapshot` - Capture page, console, network, and exception diagnostics.
- `session-inspector` - Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action.
- `session-inspector-plan` - Inspect browser-scoped computer-use policy, eligibility, and safe suggested steps.
- `session-inspector-audit` - Capture a correlated audit bundle across desktop evidence, browser review, and policy state.
- `macro-resolve` - Resolve or execute a macro expression via provider actions.
- `annotate` - Request interactive annotations via direct or relay transport.
- `rpc` - Execute an internal daemon RPC command. CLI-only, internal power surface.

---

## Tool Inventory (70)

### Session and cookies (7)
- `opendevbrowser_launch` - Launch a managed browser session.
- `opendevbrowser_connect` - Connect to an existing browser session.
- `opendevbrowser_disconnect` - Disconnect a managed or connected session.
- `opendevbrowser_status` - Inspect session and relay status.
- `opendevbrowser_status_capabilities` - Inspect runtime capability discovery for the host and an optional session.
- `opendevbrowser_cookie_import` - Import validated cookies into a session.
- `opendevbrowser_cookie_list` - List cookies in a session with optional URL filters.

### Targets and pages (7)
- `opendevbrowser_targets_list` - List available page targets and tabs.
- `opendevbrowser_target_use` - Switch the active target by id.
- `opendevbrowser_target_new` - Create a new target or tab.
- `opendevbrowser_target_close` - Close a target or tab by id.
- `opendevbrowser_page` - Open or focus a named page.
- `opendevbrowser_list` - List named pages in the session.
- `opendevbrowser_close` - Close a named page.

### Navigation and interaction (20)
- `opendevbrowser_goto` - Navigate to a URL.
- `opendevbrowser_wait` - Wait for load, ref, or state conditions.
- `opendevbrowser_snapshot` - Capture AX-tree refs for actions.
- `opendevbrowser_review` - Capture a first-class review payload with status and actionables.
- `opendevbrowser_review_desktop` - Capture desktop-assisted browser review with read-only desktop evidence and browser-owned verification.
- `opendevbrowser_click` - Click an element by ref.
- `opendevbrowser_hover` - Hover an element by ref.
- `opendevbrowser_press` - Send a keyboard key.
- `opendevbrowser_check` - Check a checkbox or radio by ref.
- `opendevbrowser_uncheck` - Uncheck a checkbox or radio by ref.
- `opendevbrowser_type` - Type text into an input by ref.
- `opendevbrowser_select` - Set select values by ref.
- `opendevbrowser_scroll` - Scroll a page or element.
- `opendevbrowser_scroll_into_view` - Scroll a target element into view.
- `opendevbrowser_upload` - Upload files to a file input or chooser by ref.
- `opendevbrowser_pointer_move` - Move the pointer to viewport coordinates.
- `opendevbrowser_pointer_down` - Press a mouse button at viewport coordinates.
- `opendevbrowser_pointer_up` - Release a mouse button at viewport coordinates.
- `opendevbrowser_pointer_drag` - Drag the pointer between viewport coordinates.
- `opendevbrowser_run` - Execute multi-action automation scripts.

### DOM inspection (7)
- `opendevbrowser_dom_get_html` - Get HTML for a page or ref.
- `opendevbrowser_dom_get_text` - Get text for a page or ref.
- `opendevbrowser_get_attr` - Read a DOM attribute by ref.
- `opendevbrowser_get_value` - Read a form or control value by ref.
- `opendevbrowser_is_visible` - Check ref visibility.
- `opendevbrowser_is_enabled` - Check ref enabled state.
- `opendevbrowser_is_checked` - Check ref checked state.

### Browser capture (3)
- `opendevbrowser_screenshot` - Capture a page screenshot and persist omitted outputs under `.opendevbrowser/screenshot/<uuid>/capture.png`.
- `opendevbrowser_screencast_start` - Start a browser replay screencast capture and persist omitted outputs under `.opendevbrowser/screencast/<uuid>`.
- `opendevbrowser_screencast_stop` - Stop a browser replay screencast capture and return artifact metadata.

### Desktop observation (6)
- `opendevbrowser_desktop_status` - Inspect public read-only desktop observation availability.
- `opendevbrowser_desktop_windows` - List windows exposed by the public read-only desktop observation plane.
- `opendevbrowser_desktop_active_window` - Inspect the active window through the public read-only desktop observation plane.
- `opendevbrowser_desktop_capture_desktop` - Capture the current desktop surface through the public read-only desktop observation plane.
- `opendevbrowser_desktop_capture_window` - Capture a specific window through the public read-only desktop observation plane.
- `opendevbrowser_desktop_accessibility_snapshot` - Capture desktop accessibility state through the public read-only desktop observation plane.

### Diagnostics and export (11)
- `opendevbrowser_console_poll` - Poll redacted console events.
- `opendevbrowser_network_poll` - Poll redacted network events.
- `opendevbrowser_debug_trace_snapshot` - Capture page, console, and network diagnostics.
- `opendevbrowser_session_inspector` - Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action.
- `opendevbrowser_session_inspector_plan` - Inspect browser-scoped computer-use policy, eligibility, and safe suggested steps.
- `opendevbrowser_session_inspector_audit` - Capture a correlated audit bundle across desktop evidence, browser review, and policy state.
- `opendevbrowser_perf` - Collect browser performance metrics.
- `opendevbrowser_dialog` - Inspect or handle a JavaScript dialog.
- `opendevbrowser_clone_page` - Export the active page into React code.
- `opendevbrowser_clone_component` - Export a component by ref into React code.
- `opendevbrowser_annotate` - Capture interactive annotations.

### Design canvas (1)
- `opendevbrowser_canvas` - Execute a typed design-canvas command surface call.

### Macro, workflow, and skill surfaces (8)
- `opendevbrowser_macro_resolve` - Resolve or execute provider macro expressions.
- `opendevbrowser_research_run` - Run the research workflow directly.
- `opendevbrowser_shopping_run` - Run the shopping workflow directly.
- `opendevbrowser_product_video_run` - Run the product-video asset workflow directly.
- `opendevbrowser_inspiredesign_run` - Run the inspiredesign workflow directly, including provider-scoped URL recovery, harvest query discovery, screenshot and screencast evidence for non-Pinterest capture lanes, and required manifest-backed pin-media authority for canonical Pinterest pins.
- `opendevbrowser_prompting_guide` - Return best-practice prompting guidance and the bundled quick start. Tool-only.
- `opendevbrowser_skill_list` - List available bundled and discovered skill packs. Tool-only.
- `opendevbrowser_skill_load` - Load a specific skill pack locally without browser work. Tool-only.

Workflow output note: omitted direct workflow tool output roots resolve through `deps.workspaceRoot` to `.opendevbrowser/<namespace>/<runId>` when wired by `src/index.ts`; direct daemon RPC uses `core.workspaceRoot/.opendevbrowser`. Explicit output roots are preserved as caller intent.

---

## Relay Channel Inventory

### `/ops` command names (59)

`/ops` is the high-level relay protocol used by default extension sessions.

#### Target lifecycle events (4)
- `Target.targetCreated`
- `Target.attachedToTarget`
- `Target.targetDestroyed`
- `Target.detachedFromTarget`

#### Session (4)
- `session.launch`
- `session.connect`
- `session.disconnect`
- `session.status`

#### Storage (2)
- `storage.setCookies`
- `storage.getCookies`

#### Targets (5)
- `targets.list`
- `targets.use`
- `targets.registerCanvas`
- `targets.new`
- `targets.close`

#### Pages (5)
- `page.open`
- `page.list`
- `page.close`
- `page.screenshot`
- `page.dialog`

#### Page lifecycle events (3)
- `Page.javascriptDialogOpening`
- `Page.javascriptDialogClosed`
- `Page.fileChooserOpened`

#### Navigation (4)
- `nav.goto`
- `nav.wait`
- `nav.snapshot`
- `nav.review`

#### Interaction (10)
- `interact.click`
- `interact.hover`
- `interact.press`
- `interact.check`
- `interact.uncheck`
- `interact.type`
- `interact.select`
- `interact.scroll`
- `interact.scrollIntoView`
- `interact.upload`

#### Pointer (4)
- `pointer.move`
- `pointer.down`
- `pointer.up`
- `pointer.drag`

#### DOM (8)
- `dom.getHtml`
- `dom.getText`
- `dom.getAttr`
- `dom.getValue`
- `dom.isVisible`
- `dom.isEnabled`
- `dom.isChecked`
- `dom.refPoint`

#### Overlay and runtime preview (5)
- `canvas.overlay.mount`
- `canvas.overlay.unmount`
- `canvas.overlay.select`
- `canvas.overlay.sync`
- `canvas.applyRuntimePreviewBridge`

#### Export (2)
- `export.clonePage`
- `export.cloneComponent`

#### DevTools (3)
- `devtools.perf`
- `devtools.consolePoll`
- `devtools.networkPoll`

Envelope contract:
- request: `ops_request` (`requestId`, `opsSessionId`, `leaseId`, `command`, `payload`)
- success: `ops_response`
- error: `ops_error`
- stream/event: `ops_event`, `ops_chunk`
- liveness: `ops_ping`, `ops_pong`

## Blocker and challenge surface

- Managed and `/ops`-backed manager responses preserve the shipped blocker fields `meta.blocker`, `meta.blockerState`, and `meta.blockerResolution`.
- `meta.challenge` is additive and may appear on manager-shaped `status`, `goto`, `wait`, and `debugTraceSnapshot` responses after blocker reconciliation.
- `meta.challengeOrchestration` is additive and may appear on manager-shaped `status`, `goto`, `wait`, and `waitForRef` responses after bounded challenge orchestration runs.
- `meta.challengeOrchestration` and fallback `details.challengeOrchestration` can include `mode`, `source`, `standDownReason`, and `helperEligibility`.
- Workflow and daemon surfaces expose the same override field name: `challengeAutomationMode`.
- Accepted override values are `off`, `browser`, and `browser_with_helper`.
- Effective precedence is `run > session > config`.
- Shipped config defaults resolve to helper-capable posture: `mode=browser_with_helper` and `optionalComputerUseBridge.enabled=true`.
- The optional helper bridge stays browser-scoped and is not a desktop agent.
- Separate `desktop.*` config gates the shipped public read-only desktop observation CLI and tool plane, while browser review remains the surfaced truth for challenge automation. No public desktop agent or desktop `/ops` family exists.
- Provider browser fallback uses explicit transport `disposition` values: `completed`, `challenge_preserved`, `deferred`, and `failed`, and may include `details.challengeOrchestration` when the shared challenge plane ran during fallback.
- `ProviderRegistry` is the only durable anti-bot pressure authority. Workflow outputs keep their existing keys while reading registry-backed pressure instead of provider-local durable state.

## Legitimacy boundary

- In scope: preserved sessions, low-level pointer control, visual observation loops, bounded auth-navigation and session-reuse attempts, reclaimable human yield packets, and owned-environment fixtures that use vendor test keys only.
- Out of scope: hidden bypasses, CAPTCHA-solving services, challenge token harvesting, or autonomous unsandboxed solving of third-party anti-bot systems.

### `/canvas` command names (35)

`/canvas` is the typed design-canvas relay protocol used by `opendevbrowser_canvas` and the `canvas` CLI command. Canonical document mutations execute in core; extension runtime support is used for the extension-hosted `canvas.html` infinite-canvas editor, converged design-tab state sync, and overlay commands.

#### Session and governance (7)
- `canvas.session.open`
- `canvas.session.attach`
- `canvas.session.status`
- `canvas.session.close`
- `canvas.capabilities.get`
- `canvas.plan.set`
- `canvas.plan.get`

#### Document and history (7)
- `canvas.document.load`
- `canvas.document.import`
- `canvas.document.patch`
- `canvas.history.undo`
- `canvas.history.redo`
- `canvas.document.save`
- `canvas.document.export`

#### Inventory (2)
- `canvas.inventory.list`
- `canvas.inventory.insert`

#### Starters (2)
- `canvas.starter.list`
- `canvas.starter.apply`

#### Live targets and overlay (5)
- `canvas.tab.open`
- `canvas.tab.close`
- `canvas.overlay.mount`
- `canvas.overlay.unmount`
- `canvas.overlay.select`

#### Preview and feedback (6)
- `canvas.preview.render`
- `canvas.preview.refresh`
- `canvas.feedback.poll`
- `canvas.feedback.subscribe`
- `canvas.feedback.next`
- `canvas.feedback.unsubscribe`

#### Code sync (6)
- `canvas.code.bind`
- `canvas.code.unbind`
- `canvas.code.pull`
- `canvas.code.push`
- `canvas.code.status`
- `canvas.code.resolve`

Extension runtime subset (internal relay helpers, not public agent commands):
- `canvas.tab.sync`
- `canvas.overlay.sync`

Behavior notes:
- `canvas.session.open` creates a session and lease; `canvas.session.attach` joins an existing session as an `observer` or reclaims the write lease with `attachMode=lease_reclaim`.
- Canvas guidance is centrally constructed with shared next-step advisory builders while preserving Canvas-native fields: `guidance.recommendedNextCommands`, `guidance.reason`, and blocker `requiredNextCommands`.
- Repairable Canvas responses can also include typed `guidance.nextStepGuidance`, `guidance.paramsExamples`, `guidance.fieldExamples`, `guidance.validationChecks`, and `guidance.doNotProceedIf` so agents can copy a valid repair shape instead of guessing.
- `canvas.session.open` returns the first authoritative operator handshake. `canvas.capabilities.get` re-reads that handshake only after a `canvasSessionId` exists; both include `generationPlanRequirements.allowedValues`, `generationPlanIssues`, `warningClasses`, `mutationPolicy.allowedBeforePlan`, `guidance.recommendedNextCommands`, and repair examples when a plan is missing or invalid.
- `canvas.plan.set` is the mutation gate. On success it returns accepted state plus next-step guidance; on failure it throws `generation_plan_invalid` with `details.missingFields`, `details.issues`, `details.guidance.paramsExamples`, `details.guidance.fieldExamples`, `details.guidance.validationChecks`, and `details.guidance.doNotProceedIf`. `canvas.plan.get` remains useful for diagnostics after that failure or after attach, but it is not required on the success path.
- `canvas.document.patch` supports governance completion through `governance.update` patch batches in addition to scene/node operations.
- `canvas.document.patch` also supports reusable inventory mutations through `inventory.promote`, `inventory.update`, and `inventory.remove`.
- `canvas.document.import` imports Figma file URLs, node URLs, or raw file-key inputs through the same lease-governed session flow. It caches image/SVG receipts under `.opendevbrowser/canvas/assets/figma/<fileKey>/`, records provenance in `document.meta.imports[]`, and treats `variables/local` failures as typed degraded paths instead of opaque fatal errors.
- `canvas.history.undo` and `canvas.history.redo` are lease-governed mutations. They return `history_empty` before the first accepted-plan mutation, preserve selection and viewport preimages, and emit `history_invalidated` when external revision drift makes the recorded stack stale.
- Extension design-tab history clicks emit the internal `canvas_event` type `canvas_history_requested`; the actual mutation still runs through public `canvas.history.undo` or `canvas.history.redo` and should not be treated as a separate `/canvas` command.
- Accepted `canvas.document.patch` batches now auto-refresh every active preview target so browser verification stays in the same edit loop as the design tab.
- `canvas.inventory.list` is read-only and returns the merged reusable inventory surface: the current document-backed inventory plus the shipped built-in kit catalog entries. `canvas.inventory.insert` expands either inventory template into new stage nodes under the requested or inferred parent.
- `canvas.starter.list` exposes the eight shipped built-in starters. `canvas.starter.apply` seeds a generation plan when missing, merges kit token collections into `document.tokens`, installs required kit entries into `document.componentInventory`, and inserts starter shell content onto the active page. Unsupported framework or adapter requests degrade to semantic shell nodes with typed feedback instead of failing the entire mutation. Starter payloads now prefer `libraryAdapterId` for the resolved built-in kit adapter; legacy `adapterId` remains as a backward-compatible alias and should not be confused with code-sync `frameworkAdapterId`.
- `canvas.document.save` and `canvas.document.export` can fail with `policy_violation` when `requiredBeforeSave` governance blocks are still missing.
- Extension-hosted design tabs persist full same-origin editor state in `IndexedDB`, rebroadcast converged state over `BroadcastChannel`, forward editor-originated patch requests through `canvas_event` payloads, and expose pages, layers, properties, history controls, and extension-stage region annotation.
- `canvas.tab.open` is the public command; internal `canvas.tab.sync` keeps extension-hosted design tabs on the same core-rendered HTML materialization path after public mutations.
- `canvas.code.*` manages framework-adapter-backed bindings with repo-local manifests under `.opendevbrowser/canvas/code-sync/<documentId>/<bindingId>.json`. Built-in lanes currently ship for `builtin:react-tsx-v2`, `builtin:html-static-v1`, `builtin:custom-elements-v1`, `builtin:vue-sfc-v1`, and `builtin:svelte-sfc-v1`; legacy `tsx-react-v1` bindings migrate on load to `builtin:react-tsx-v2`, and repo-local BYO adapter plugins load only from workspace metadata, repo manifests, or explicit local config declarations.
- `canvas.preview.render` and `canvas.preview.refresh` default to projected `canvas_html`, but bindings that opt into `projection=bound_app_runtime` attempt in-place runtime reconciliation before falling back to canonical HTML projection.
- `canvas.feedback.poll` remains the snapshot query for cursor-based audits. Before the plan is accepted it synthesizes a `preflight-blocker` item for `plan_required` or `generation_plan_invalid`, so agents can reuse the same loop for missing and invalid plan states. `canvas.feedback.subscribe` returns `subscriptionId`, `cursor`, `heartbeatMs`, `expiresAt`, `initialItems`, and `activeTargetIds`; `canvas.feedback.next` returns exactly one `feedback.item`, `feedback.heartbeat`, or `feedback.complete` event; `canvas.feedback.unsubscribe` ends the public pull stream. The CLI `stream-json` bridge now uses the same public `subscribe -> next -> unsubscribe` contract, and tool callers can do the same through repeated `opendevbrowser_canvas` calls.
- `canvas.session.status` and `canvas.code.status` surface attached clients, active lease holder, watch state, drift/conflict state, projection mode, fallback reasons, parity artifacts, available starter count, and the currently applied starter metadata.

Envelope contract:
- request: `canvas_request` (`requestId`, `canvasSessionId`, `leaseId`, `command`, `payload`)
- success: `canvas_response`
- error: `canvas_error`
- stream/event: `canvas_event`, `canvas_chunk`
- liveness: `canvas_ping`, `canvas_pong`

Canvas event types:
- `canvas_session_created`
- `canvas_session_closed` (`payload.leaseId` required)
- `canvas_session_expired` (`payload.leaseId` required)
- `canvas_target_closed`
- `canvas_document_snapshot`
- `canvas_document_update`
- `canvas_presence`
- `canvas_lease_changed`
- `canvas_feedback_item`
- `canvas_patch_requested`
- `canvas_history_requested`
- `canvas_code_sync_started`
- `canvas_code_sync_applied`
- `canvas_code_sync_conflict`
- `canvas_code_sync_failed`
- `canvas_client_disconnected`

### `/annotation` relay commands (internal)

`/annotation` is an internal relay lane used by annotate capture flows and extension send actions.

Commands:
- `start`
- `cancel`
- `fetch_stored`
- `store_agent_payload`

Behavior notes:
- `fetch_stored` resolves the shared repo-local agent inbox path first and the extension-local stored payload fallback second.
- Popup, canvas, and in-page `Send` actions dispatch `annotation:sendPayload` to the extension background, which posts `store_agent_payload` over `/annotation`.
- The relay handles `store_agent_payload` locally, enqueues the sanitized payload into the shared `AgentInbox`, and returns a typed receipt with `receiptId`, `deliveryState`, `storedFallback`, optional `reason`, optional `chatScopeKey`, plus `createdAt`, `itemCount`, `byteLength`, `source`, and `label`.
- Shared inbox persistence strips screenshots and keeps only asset refs plus the sanitized payload in `.opendevbrowser/annotate/agent-inbox.jsonl`.

Envelope contract:
- request: `AnnotationCommand` (`requestId`, `command`, optional `payload`/`source`/`label`/`options`)
- success: `AnnotationResponse` with either `payload` or `receipt`
- error: `AnnotationResponse` with `error`
- stream/event: `RelayAnnotationEvent`

### `/cdp` channel contract (legacy)

`/cdp` relays low-level CDP messages and is explicitly opt-in (`--extension-legacy`).

Request envelope:
```json
{
  "id": 1,
  "method": "Runtime.evaluate",
  "params": { "expression": "document.title" },
  "sessionId": "optional-flat-session-id"
}
```

Response envelope:
```json
{
  "id": 1,
  "result": { "result": { "type": "string", "value": "Example" } },
  "sessionId": "optional-flat-session-id"
}
```

Event envelope:
```json
{
  "method": "forwardCDPEvent",
  "params": {
    "method": "Runtime.consoleAPICalled",
    "params": { "type": "log" },
    "sessionId": "optional-flat-session-id"
  }
}
```

Auth and policy:
- `/ops`, `/canvas`, `/annotation`, and `/cdp` require `?token=<relayToken>` when pairing is enabled.
- `/ops` is multi-client by design.
- `/canvas` exposes typed design-session envelopes and reports relay usage via `canvasConnected`.
- `/cdp` is legacy and is typically subject to binding/lease coordination in hub mode.
- Runtime concurrency key is `ExecutionKey = (sessionId,targetId)`.
- Same target commands are FIFO; different targets in one session can run in parallel up to the governor cap.
- Legacy `/cdp` remains sequential (`effectiveParallelCap=1`) for compatibility.
- Extension headless is unsupported and returns `unsupported_mode` when extension-intent launch/connect is requested with headless.
- Intentional parity exceptions must be listed in `docs/PARITY_DECLARED_DIVERGENCES.md`.

### Command taxonomy (contract)

- `TargetScoped`:
  - `nav.*`, `interact.*`, `dom.*`, `export.*`, `devtools.*`, `page.screenshot`, `page.dialog`
- `SessionStructural`:
  - `session.*`, `targets.*`, `page.open`, `page.list`, `page.close`, storage commands

---

## Mode and Flag Matrix

### Session modes
- `extension` (default when relay is available): launch/connect through `/ops`.
- `managed`: `launch --no-extension` (or explicit managed launch flags).
- `extension-legacy`: `launch --extension-legacy` or `connect --extension-legacy` through `/cdp`.
- `cdpConnect`: direct `connect --ws-endpoint ...` or `connect --host ... --cdp-port ...`.
- User-owned Google OAuth: `launch --google-auth-intent user-owned --extension-only --wait-for-extension` or an `/ops` relay connect. This requires extension /ops and fails closed for managed, headless, legacy `/cdp`, and direct CDP.

### Key mode flags
- `--no-extension`
- `--extension-only`
- `--extension-legacy`
- `--wait-for-extension`
- `--wait-timeout-ms`
- `--google-auth-intent user-owned`
- `--disable-system-cookie-bootstrap`
- `--allow-google-cookie-bootstrap`

### Google OAuth continuity
- Managed and direct `cdpConnect` cookie bootstrap is best-effort and copies readable system Chrome-family cookies only. Copied cookies are not Google auth proof and can be disabled per run with `--disable-system-cookie-bootstrap`.
- Google-sensitive cookies are skipped by default during managed and direct `cdpConnect` bootstrap. Use `--allow-google-cookie-bootstrap` only for diagnostic runs that explicitly accept that risk.
- Launch/connect responses expose sanitized `diagnostics.authProvenance` for mode and cookie-bootstrap provenance. They must not expose private cookies, tokens, account identifiers, full profile paths, or account screenshots.
- If Google sign-in or account chooser actions open an OAuth popup, run `targets-list --include-urls`, then `target-use --target-id <target-id>` for the chosen target.
- For perceived logout or auth invalidation, prefer extension `/ops` with `--google-auth-intent user-owned`; do not use managed/CDP copied cookies as proof of Google login.

### Transport flags
- Global transport flag: `--transport relay|native` (status and transport-aware flows).
- Annotation transport flag: `annotate --transport auto|direct|relay`.
- Canvas wrapper flags: `canvas --command <canvas.*> --params|--params-file [--timeout-ms]`.
- Macro execute timeout flag: `macro-resolve --timeout-ms <ms>` extends daemon-call timeout for slow execute runs.
- Workflow and macro execute browser options: `research run`, `shopping run`, `product-video run`, `inspiredesign run`, `inspiredesign harvest`, and `macro-resolve --execute` accept `--browser-mode auto|extension|managed`; `extension` reuses relay-backed browser state, while `managed` runs a deterministic managed browser.
- Workflow and macro execute cookie options: `research run`, `shopping run`, `product-video run`, `inspiredesign run`, `inspiredesign harvest`, and `macro-resolve --execute` accept `--use-cookies` and `--cookie-policy-override off|auto|required` (`--cookie-policy` alias) so provider macros can require observable cookie-backed browser sessions.
- Workflow and macro execute override flags: `research run`, `shopping run`, `product-video run`, `inspiredesign run`, `inspiredesign harvest`, and `macro-resolve --execute` accept `--challenge-automation-mode off|browser|browser_with_helper`, which maps to `challengeAutomationMode` with `run > session > config` precedence.
- Inspiredesign harvest flags: `--query`, repeatable `--provider`, `--max-references 1..10`, and `--visual-evidence off|auto|required`. Harvest requires `--query` or at least one `--url`, keeps the daemon method as `inspiredesign.run`, defaults to `mode=path`, `visualEvidence=required`, and `maxReferences=5`, and keeps explicit `--url` references before discovered references.
- Inspiredesign harvest supports browser-native site recipes for visually driven sites. `--provider social/pinterest` selects the Pinterest recipe and should be run with extension mode, cookies, and `--cookie-policy required` when logged-in search is required. Compatible Pinterest URL recovery can run as `--provider social/pinterest --url <pinterest-url>` without `--query`; use one canonical `/pin/{id}/` URL per harvest when validating design-ready pin media. Generic provider plus URL recovery without query remains rejected. Pinterest is not registered as a default full social provider.
- Extension-mode canonical Pinterest pin-media harvest opens the exact canonical pin in the extension before extracting persisted first-party bytes. This is the default product path for reliable image, GIF, and video pin media capture.
- Inspiredesign harvest primary capture is pin-media-first for Pinterest: proven image, GIF, and video pins require manifest-backed pin-media evidence for product-ready canonical pin-media harvests. Screenshot evidence and screencast evidence remain useful capture or motion lanes, but they are not substitutes for `evidenceAuthority=pin_media_ready`. Video posters remain still-image fallback cues, and DOM/clone/deep capture is disabled for Pinterest harvest. Remote DOM media URLs are not product-ready unless persisted first-party bytes appear in `pin-media-index.json`.
- Inspiredesign capture-mode resolution preserves the existing explicit-URL override: `inspiredesign run` forces `captureMode=deep` for any explicit `--url`, while `inspiredesign harvest` forces deep capture for non-Pinterest explicit `--url` references even when `--capture-mode off` is requested. Pinterest-only harvest discovery and compatible Pinterest URL recovery force `captureMode=off` even when `--capture-mode deep` is requested.
- Inspiredesign harvest artifacts: `visual-evidence.json`, `screenshot-index.json`, `motion-evidence.json`, `pin-media-evidence.json`, `pin-media-index.json`, `media-analysis.json`, `ranked-references.json`, and `meta-prompt.md` are emitted with screenshot PNGs under `visual-evidence/<referenceId>/viewport.png`, motion artifacts under `motion-evidence/<referenceId>/` when video evidence is captured, and Pinterest pin media under `pin-media-evidence/<referenceId>/main.*`, `pin-media-evidence/<referenceId>/video.mp4`, or `pin-media-evidence/<referenceId>/poster.*` when canonical pin media proof is captured. JSON remains bounded and artifact-relative with paths, hashes, byte counts, viewport or media facts when available, reference id and URL, warnings, limitations, and non-goals.
- `media-analysis.json` is the deterministic design-fact surface for trusted saved pin media. It may include dimensions, tone, quantized palette, layout posture, OCR-free typography structure, text-region layout, and sampled motion facts, but it is not the readiness authority and cannot replace `pin-media-index.json`.
- FFmpeg and FFprobe are recommended optional host tools for richer media-analysis metadata and sampled GIF or video facts. They are not bundled static binaries and are not downloaded by default.
- Media-analysis binaries resolve from `OPENDEVBROWSER_FFMPEG_PATH` and `OPENDEVBROWSER_FFPROBE_PATH`, then `inspiredesign.mediaAnalysis.ffmpegPath` and `inspiredesign.mediaAnalysis.ffprobePath`, then `ffmpeg` and `ffprobe` on `PATH`, then common absolute install directories for implicit `PATH`-source ENOENT misses only. Invalid env or config paths stay diagnostic and do not fall back. `status-capabilities` reports this host state under `host.mediaAnalysis`.
- Missing or invalid FFmpeg or FFprobe binaries degrade `media-analysis.json` only. They do not fail pin-media readiness, and `media-analysis.json` never satisfies product readiness.
- `media-analysis.json` does not provide readable text extraction, exact copy, font-family proof, OCR, model vision, Tesseract, OpenCV, Sharp, browser canvas analysis, new dependencies, or raw `mediaAnalysis` in `canvas-plan.request.json`; Canvas receives only concise media-derived summaries through existing plan/vector fields after readiness is already ready.
- `ranked-references.json.rejectedReferences` serializes captured-but-rejected diagnostics, including untrusted `interface_chrome_shell`, without promoting those captures into design-facing references.
- Inspiredesign visual policy boundaries: visual capture must not bypass `policy_blocked`, unresolved `auth_required`, `challenge_detected`, or `rate_limited`; blocked references surface diagnostics instead of browser screenshot fallback.
- Workflow response keys: artifact-bearing workflow success payloads use `artifact_path`; provider follow-up summaries use `meta.primaryConstraintSummary`; typed recovery and handoff payloads use `nextStepGuidance.readiness`, `reasonCode`, `primaryAction`, `paramsExamples`, `validationChecks`, `fallbackPolicy`, and `doNotProceedIf` when available. Inspiredesign harvest also reports product `ready`, `guidanceReady`, `guidanceReadiness`, `productSuccess`, `harvestReadiness`, `readiness`, `rankedReferenceCount`, `evidenceAuthority`, and `artifactAuthority` so wrapper success is not confused with design readiness. Product `ready` is true only when authority gates pass.
- `design-contract.json.colorSystem.tokens` and `implementation-plan.json.tokenStrategy.colors` use explicit `{ light, dark }` semantic token maps. `design-agent-handoff.json.implementationContext.tokenStrategy` carries the same dual-mode token strategy for implementation agents.
- Continue to Canvas only when top-level `ready=true`, `productSuccess=true`, `artifactAuthority=product_ready`, ranked references are non-empty, no matching `doNotProceedIf` blockers remain active, and manifest-backed authority evidence exists. For canonical Pinterest pin-media harvests, Canvas continuation requires `evidenceAuthority=pin_media_ready` and manifest-backed `pin-media-index.json`; `snapshot_ready` and `motion_ready` are not substitutes for pin-media readiness. For `needs_recovery`, `blocked`, or `diagnostic_only`, follow recovery-first guidance and do not treat emitted artifacts as design-ready.
- Pinterest product readiness is pin-media-first: canonical pin URLs become product-ready only when their first-party pin-media artifact is captured, persisted, present in its manifest-backed index, and free of blocking warnings. `pin-media-index.json` remains the only pin-media readiness and provenance authority for persisted first-party bytes. Screenshot and screencast artifacts can inform diagnostics or motion design, but they do not satisfy required Pinterest pin-media readiness. The exact `login_or_challenge_state` and strict byte-backed `interface_chrome_shell` diagnostics are non-blocking only for trusted first-party manifest-backed pin-media bytes; broader login, challenge, captcha, search-shell, promoted, ad, blank, tiny, or chrome-only blockers still demote readiness.
- Prefer omitted output roots for routine workflow bundles. Omitted outputs use `.opendevbrowser/<namespace>/<runId>` and include `bundle-manifest.json`. CLI invocations resolve omitted roots from cwd before daemon dispatch; direct daemon RPC uses `core.workspaceRoot/.opendevbrowser`; direct OpenCode workflow tools use `deps.workspaceRoot/.opendevbrowser`. If a wrapper must pass an explicit workflow root, prefer `.opendevbrowser`; explicit external output roots remain caller-controlled for intentional temp, release, debug, audit, screenshot, and screencast lanes.
- `artifacts cleanup --expired-only` without `--output-dir` targets the current working directory's `.opendevbrowser` root. Use `--output-dir /tmp/opendevbrowser` only when intentionally cleaning an explicit temp artifact root.
- Browser evidence omitted outputs use workspace-local artifact roots: screenshots write `.opendevbrowser/screenshot/<uuid>/capture.png` with `path` and `artifact_path`, and screencasts write `.opendevbrowser/screencast/<uuid>` with replay files. Explicit `--path` and `--output-dir` remain caller-controlled. Browser screenshot, screencast, Canvas, annotation, desktop audit, and release proof outputs are intentional non-bundle lanes, do not promise `bundle-manifest.json`, and are not targets for bundle manifest cleanup.
- Research and shopping guidance uses `meta.primaryConstraint.guidance.reason` plus `meta.primaryConstraint.guidance.recommendedNextCommands[]` when provider recovery steps are known. Migrated workflow paths can include `nextStepGuidance` alongside those compatibility fields.
- Failure tallies use `meta.metrics.reasonCodeDistribution` for research/shopping and `meta.reasonCodeDistribution` for product-video.

For complete argument and flag coverage by command, see `docs/CLI.md`.

---

## Verification Commands

```bash
npm run lint
npm run typecheck
npm run build
npm run test
npm run test -- tests/parity-matrix.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```
