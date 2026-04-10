# OpenDevBrowser Surface Reference

Source-accurate inventory for CLI commands, plugin tools, relay channel commands, flags, and modes.
Status: active  
Last updated: 2026-04-03

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
- `src/relay/protocol.ts`

Operational mirror:
- `npx opendevbrowser --help` (all commands with usage + primary flags, all grouped flags, all tools)
- `npx opendevbrowser help` (same inventory as `--help`)

First-contact note:
- Start with generated help and `docs/FIRST_RUN_ONBOARDING.md`; this page stays inventory-only.
- Installer lifecycle owns refresh and cleanup of the 9 canonical bundled skill packs; this page stays inventory-only.

---

## CLI Command Inventory (64)

### Install and runtime management (10)
- `install` - Install the plugin.
- `update` - Clear cached plugin to trigger reinstall.
- `uninstall` - Remove plugin from config.
- `help` - Show help.
- `version` - Show version.
- `serve` - Start or stop the local daemon.
- `daemon` - Install, uninstall, or inspect daemon auto-start.
- `native` - Install, uninstall, or inspect the native messaging host.
- `run` - Execute a JSON script in a single process.
- `artifacts` - Manage workflow artifact lifecycle.

### Session, connection, and workflow wrappers (9)
- `launch` - Launch a managed browser session via daemon.
- `connect` - Connect to an existing browser via daemon.
- `disconnect` - Disconnect a daemon session.
- `status` - Get daemon or session status.
- `cookie-import` - Import validated cookies into a session.
- `cookie-list` - List cookies for a session, optionally filtered by URL.
- `research` - Run research workflows.
- `shopping` - Run shopping workflows.
- `product-video` - Run product presentation asset workflows.

### Navigation (4)
- `goto` - Navigate the current session to a URL.
- `wait` - Wait for load completion or a ref/state condition.
- `snapshot` - Capture a snapshot of the active page.
- `review` - Capture a first-class review payload for the active target.

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

### Design canvas (1)
- `canvas` - Execute a design-canvas command.

### Export, diagnostics, macro, annotation, power (12)
- `clone-page` - Clone the active page to React.
- `clone-component` - Clone a component by ref.
- `perf` - Capture performance metrics.
- `screenshot` - Capture a screenshot.
- `dialog` - Inspect or handle a JavaScript dialog.
- `console-poll` - Poll console events.
- `network-poll` - Poll network events.
- `debug-trace-snapshot` - Capture page, console, network, and exception diagnostics.
- `session-inspector` - Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action.
- `macro-resolve` - Resolve or execute a macro expression via provider actions.
- `annotate` - Request interactive annotations via direct or relay transport.
- `rpc` - Execute an internal daemon RPC command. CLI-only, internal power surface.

---

## Tool Inventory (57)

### Session and cookies (6)
- `opendevbrowser_launch` - Launch a managed browser session.
- `opendevbrowser_connect` - Connect to an existing browser session.
- `opendevbrowser_disconnect` - Disconnect a managed or connected session.
- `opendevbrowser_status` - Inspect session and relay status.
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

### Navigation and interaction (19)
- `opendevbrowser_goto` - Navigate to a URL.
- `opendevbrowser_wait` - Wait for load, ref, or state conditions.
- `opendevbrowser_snapshot` - Capture AX-tree refs for actions.
- `opendevbrowser_review` - Capture a first-class review payload with status and actionables.
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

### Diagnostics and export (10)
- `opendevbrowser_console_poll` - Poll redacted console events.
- `opendevbrowser_network_poll` - Poll redacted network events.
- `opendevbrowser_debug_trace_snapshot` - Capture page, console, and network diagnostics.
- `opendevbrowser_session_inspector` - Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action.
- `opendevbrowser_perf` - Collect browser performance metrics.
- `opendevbrowser_screenshot` - Capture a page screenshot.
- `opendevbrowser_dialog` - Inspect or handle a JavaScript dialog.
- `opendevbrowser_clone_page` - Export the active page into React code.
- `opendevbrowser_clone_component` - Export a component by ref into React code.
- `opendevbrowser_annotate` - Capture interactive annotations.

### Design canvas (1)
- `opendevbrowser_canvas` - Execute a typed design-canvas command surface call.

### Macro, workflow, and skill surfaces (7)
- `opendevbrowser_macro_resolve` - Resolve or execute provider macro expressions.
- `opendevbrowser_research_run` - Run the research workflow directly.
- `opendevbrowser_shopping_run` - Run the shopping workflow directly.
- `opendevbrowser_product_video_run` - Run the product-video asset workflow directly.
- `opendevbrowser_prompting_guide` - Return best-practice prompting guidance and the bundled quick start. Tool-only.
- `opendevbrowser_skill_list` - List available bundled and discovered skill packs. Tool-only.
- `opendevbrowser_skill_load` - Load a specific skill pack locally without browser work. Tool-only.

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
- Separate `desktop.*` config gates the shipped internal sibling desktop observation runtime, but no public desktop CLI, tool, or `/ops` family is exposed and browser review remains the surfaced truth.
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
- `canvas.tab.open`
- `canvas.tab.close`
- `canvas.tab.sync`
- `canvas.overlay.mount`
- `canvas.overlay.unmount`
- `canvas.overlay.select`
- `canvas.overlay.sync`

Behavior notes:
- `canvas.session.open` creates a session and lease; `canvas.session.attach` joins an existing session as an `observer` or reclaims the write lease with `attachMode=lease_reclaim`.
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
- `canvas.feedback.poll` remains the snapshot query for cursor-based audits. `canvas.feedback.subscribe` returns `subscriptionId`, `cursor`, `heartbeatMs`, `expiresAt`, `initialItems`, and `activeTargetIds`; `canvas.feedback.next` returns exactly one `feedback.item`, `feedback.heartbeat`, or `feedback.complete` event; `canvas.feedback.unsubscribe` ends the public pull stream. The CLI `stream-json` bridge now uses the same public `subscribe -> next -> unsubscribe` contract, and tool callers can do the same through repeated `opendevbrowser_canvas` calls.
- `canvas.session.status` and `canvas.code.status` surface attached clients, active lease holder, watch state, drift/conflict state, projection mode, fallback reasons, parity artifacts, available starter count, and the currently applied starter metadata.

Envelope contract:
- request: `canvas_request` (`requestId`, `canvasSessionId`, `leaseId`, `command`, `payload`)
- success: `canvas_response`
- error: `canvas_error`
- stream/event: `canvas_event`, `canvas_chunk`
- liveness: `canvas_ping`, `canvas_pong`

Canvas event types:
- `canvas_session_created`
- `canvas_session_closed`
- `canvas_session_expired`
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

### Key mode flags
- `--no-extension`
- `--extension-only`
- `--extension-legacy`
- `--wait-for-extension`
- `--wait-timeout-ms`

### Transport flags
- Global transport flag: `--transport relay|native` (status and transport-aware flows).
- Annotation transport flag: `annotate --transport auto|direct|relay`.
- Canvas wrapper flags: `canvas --command <canvas.*> --params|--params-file [--timeout-ms]`.
- Macro execute timeout flag: `macro-resolve --timeout-ms <ms>` extends daemon-call timeout for slow execute runs.
- Workflow and macro execute override flags: `research run`, `shopping run`, `product-video run`, and `macro-resolve --execute` accept `--challenge-automation-mode off|browser|browser_with_helper`, which maps to `challengeAutomationMode` with `run > session > config` precedence.
- Workflow response keys: provider follow-up summaries use `meta.primaryConstraintSummary`; failure tallies use `meta.metrics.reasonCodeDistribution` for research/shopping and `meta.reasonCodeDistribution` for product-video.

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
