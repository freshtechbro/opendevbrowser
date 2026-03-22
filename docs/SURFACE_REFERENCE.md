# OpenDevBrowser Surface Reference

Source-accurate inventory for CLI commands, plugin tools, relay channel commands, flags, and modes.
Status: active  
Last updated: 2026-03-22

This reference is intentionally exhaustive and should stay synchronized with:
- `src/cli/args.ts`
- `src/cli/help.ts`
- `src/tools/index.ts`
- `src/tools/surface.ts`
- `extension/src/ops/ops-runtime.ts`
- `extension/src/canvas/canvas-runtime.ts`
- `src/relay/protocol.ts`

Operational mirror:
- `npx opendevbrowser --help` (all commands with usage + primary flags, all grouped flags, all tools)
- `npx opendevbrowser help` (same inventory as `--help`)

---

## CLI Command Inventory (60)

### Install and runtime management (10)
- `install`
- `update`
- `uninstall`
- `help`
- `version`
- `serve`
- `daemon`
- `native`
- `run`
- `artifacts`

### Session, connection, and workflow wrappers (9)
- `launch`
- `connect`
- `disconnect`
- `status`
- `cookie-import`
- `cookie-list`
- `research`
- `shopping`
- `product-video`

### Navigation (3)
- `goto`
- `wait`
- `snapshot`

### Interaction (13)
- `click`
- `hover`
- `press`
- `check`
- `uncheck`
- `type`
- `select`
- `scroll`
- `scroll-into-view`
- `pointer-move`
- `pointer-down`
- `pointer-up`
- `pointer-drag`

### Targets and pages (7)
- `targets-list`
- `target-use`
- `target-new`
- `target-close`
- `page`
- `pages`
- `page-close`

### DOM inspection (7)
- `dom-html`
- `dom-text`
- `dom-attr`
- `dom-value`
- `dom-visible`
- `dom-enabled`
- `dom-checked`

### Design canvas (1)
- `canvas`

### Export, diagnostics, macro, annotation, power (10)
- `clone-page`
- `clone-component`
- `perf`
- `screenshot`
- `console-poll`
- `network-poll`
- `debug-trace-snapshot`
- `macro-resolve`
- `annotate`
- `rpc` (CLI-only, internal power surface)

---

## Tool Inventory (53)

### Session and cookies (6)
- `opendevbrowser_launch`
- `opendevbrowser_connect`
- `opendevbrowser_disconnect`
- `opendevbrowser_status`
- `opendevbrowser_cookie_import`
- `opendevbrowser_cookie_list`

### Targets and pages (7)
- `opendevbrowser_targets_list`
- `opendevbrowser_target_use`
- `opendevbrowser_target_new`
- `opendevbrowser_target_close`
- `opendevbrowser_page`
- `opendevbrowser_list`
- `opendevbrowser_close`

### Navigation and interaction (17)
- `opendevbrowser_goto`
- `opendevbrowser_wait`
- `opendevbrowser_snapshot`
- `opendevbrowser_click`
- `opendevbrowser_hover`
- `opendevbrowser_press`
- `opendevbrowser_check`
- `opendevbrowser_uncheck`
- `opendevbrowser_type`
- `opendevbrowser_select`
- `opendevbrowser_scroll`
- `opendevbrowser_scroll_into_view`
- `opendevbrowser_pointer_move`
- `opendevbrowser_pointer_down`
- `opendevbrowser_pointer_up`
- `opendevbrowser_pointer_drag`
- `opendevbrowser_run`

### DOM inspection (7)
- `opendevbrowser_dom_get_html`
- `opendevbrowser_dom_get_text`
- `opendevbrowser_get_attr`
- `opendevbrowser_get_value`
- `opendevbrowser_is_visible`
- `opendevbrowser_is_enabled`
- `opendevbrowser_is_checked`

### Diagnostics and export (8)
- `opendevbrowser_console_poll`
- `opendevbrowser_network_poll`
- `opendevbrowser_debug_trace_snapshot`
- `opendevbrowser_perf`
- `opendevbrowser_screenshot`
- `opendevbrowser_clone_page`
- `opendevbrowser_clone_component`
- `opendevbrowser_annotate`

### Design canvas (1)
- `opendevbrowser_canvas`

### Macro, workflow, and skill surfaces (7)
- `opendevbrowser_macro_resolve`
- `opendevbrowser_research_run`
- `opendevbrowser_shopping_run`
- `opendevbrowser_product_video_run`
- `opendevbrowser_prompting_guide` (tool-only)
- `opendevbrowser_skill_list` (tool-only)
- `opendevbrowser_skill_load` (tool-only)

---

## Relay Channel Inventory

### `/ops` command names (48)

`/ops` is the high-level relay protocol used by default extension sessions.

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

#### Pages (4)
- `page.open`
- `page.list`
- `page.close`
- `page.screenshot`

#### Navigation (3)
- `nav.goto`
- `nav.wait`
- `nav.snapshot`

#### Interaction (9)
- `interact.click`
- `interact.hover`
- `interact.press`
- `interact.check`
- `interact.uncheck`
- `interact.type`
- `interact.select`
- `interact.scroll`
- `interact.scrollIntoView`

#### Pointer (4)
- `pointer.move`
- `pointer.down`
- `pointer.up`
- `pointer.drag`

#### DOM (7)
- `dom.getHtml`
- `dom.getText`
- `dom.getAttr`
- `dom.getValue`
- `dom.isVisible`
- `dom.isEnabled`
- `dom.isChecked`

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
- Provider browser fallback uses explicit transport `disposition` values: `completed`, `challenge_preserved`, `deferred`, and `failed`.
- `ProviderRegistry` is the only durable anti-bot pressure authority. Workflow outputs keep their existing keys while reading registry-backed pressure instead of provider-local durable state.

## Legitimacy boundary

- In scope: preserved sessions, low-level pointer control, visual observation loops, manual completion on third-party sites, and owned-environment fixtures that use vendor test keys only.
- Out of scope: hidden bypasses, CAPTCHA-solving services, challenge token harvesting, or autonomous solving of third-party anti-bot systems.

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
  - `nav.*`, `interact.*`, `dom.*`, `export.*`, `devtools.*`, `page.screenshot`
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
