# Workflow Surface Map

Status: active
Last updated: 2026-04-16

Canonical code-derived workflow inventory across CLI commands, tool surfaces, and executable validation scenarios.

## Coverage summary

- CLI commands: `77`
- Tool surfaces: `70`
- CLI<->tool pairs: `67`
- CLI-only commands: `10`
- Tool-only surfaces: `3`
- Provider ids in live scenario source: `22`

## CLI command families

### System lifecycle

- `install`
- `update`
- `uninstall`
- `help`
- `version`
- `serve`
- `daemon`
### Guarded power-user surfaces

- `native`
- `rpc`
### Script automation

- `run`
### Session lifecycle

- `launch`
- `connect`
- `disconnect`
- `status`
- `status-capabilities`
- `cookie-import`
- `cookie-list`
### First-class provider workflows

- `research`
- `shopping`
- `product-video`
- `inspiredesign`
### Diagnostics

- `artifacts`
- `session-inspector`
- `session-inspector-plan`
- `session-inspector-audit`
- `perf`
- `screenshot`
- `dialog`
- `console-poll`
- `network-poll`
- `debug-trace-snapshot`
- `screencast-start`
- `screencast-stop`
### Macro provider workflows

- `macro-resolve`
### Canvas workflow

- `canvas`
### Navigation and review

- `goto`
- `wait`
- `snapshot`
- `review`
- `review-desktop`
### Interaction and pointer control

- `click`
- `hover`
- `press`
- `check`
- `uncheck`
- `type`
- `select`
- `scroll`
- `scroll-into-view`
- `upload`
- `pointer-move`
- `pointer-down`
- `pointer-up`
- `pointer-drag`
### Targets and named pages

- `targets-list`
- `target-use`
- `target-new`
- `target-close`
- `page`
- `pages`
- `page-close`
### DOM inspection and export

- `dom-html`
- `dom-text`
- `dom-attr`
- `dom-value`
- `dom-visible`
- `dom-enabled`
- `dom-checked`
- `clone-page`
- `clone-component`
### Annotation workflow

- `annotate`
### Desktop observation

- `desktop-status`
- `desktop-windows`
- `desktop-active-window`
- `desktop-capture-desktop`
- `desktop-capture-window`
- `desktop-accessibility-snapshot`

## Tool families

### Session lifecycle

- `opendevbrowser_launch`
- `opendevbrowser_connect`
- `opendevbrowser_disconnect`
- `opendevbrowser_status`
- `opendevbrowser_status_capabilities`
- `opendevbrowser_cookie_import`
- `opendevbrowser_cookie_list`
### Targets and pages

- `opendevbrowser_targets_list`
- `opendevbrowser_target_use`
- `opendevbrowser_target_new`
- `opendevbrowser_target_close`
- `opendevbrowser_page`
- `opendevbrowser_list`
- `opendevbrowser_close`
### Navigation and review

- `opendevbrowser_goto`
- `opendevbrowser_wait`
- `opendevbrowser_snapshot`
- `opendevbrowser_review`
- `opendevbrowser_review_desktop`
### Interaction and pointer control

- `opendevbrowser_click`
- `opendevbrowser_hover`
- `opendevbrowser_press`
- `opendevbrowser_check`
- `opendevbrowser_uncheck`
- `opendevbrowser_type`
- `opendevbrowser_select`
- `opendevbrowser_scroll`
- `opendevbrowser_scroll_into_view`
- `opendevbrowser_upload`
- `opendevbrowser_pointer_move`
- `opendevbrowser_pointer_down`
- `opendevbrowser_pointer_up`
- `opendevbrowser_pointer_drag`
### DOM inspection

- `opendevbrowser_dom_get_html`
- `opendevbrowser_dom_get_text`
- `opendevbrowser_get_attr`
- `opendevbrowser_get_value`
- `opendevbrowser_is_visible`
- `opendevbrowser_is_enabled`
- `opendevbrowser_is_checked`
### Export

- `opendevbrowser_clone_page`
- `opendevbrowser_clone_component`
### Diagnostics

- `opendevbrowser_session_inspector`
- `opendevbrowser_session_inspector_plan`
- `opendevbrowser_session_inspector_audit`
- `opendevbrowser_console_poll`
- `opendevbrowser_network_poll`
- `opendevbrowser_debug_trace_snapshot`
- `opendevbrowser_perf`
- `opendevbrowser_screenshot`
- `opendevbrowser_screencast_start`
- `opendevbrowser_screencast_stop`
- `opendevbrowser_dialog`
### Desktop observation

- `opendevbrowser_desktop_status`
- `opendevbrowser_desktop_windows`
- `opendevbrowser_desktop_active_window`
- `opendevbrowser_desktop_capture_desktop`
- `opendevbrowser_desktop_capture_window`
- `opendevbrowser_desktop_accessibility_snapshot`
### Script execution

- `opendevbrowser_run`
### Macro provider workflows

- `opendevbrowser_macro_resolve`
### First-class workflows

- `opendevbrowser_research_run`
- `opendevbrowser_shopping_run`
- `opendevbrowser_product_video_run`
- `opendevbrowser_inspiredesign_run`
### Annotation

- `opendevbrowser_annotate`
### Canvas

- `opendevbrowser_canvas`
### Local-only tool helpers

- `opendevbrowser_prompting_guide`
- `opendevbrowser_skill_list`
- `opendevbrowser_skill_load`

## Automated validation scenarios

| ID | Entry path | Primary task | Secondary task |
| --- | --- | --- | --- |
| `scenario.feature.cli.onboarding` | `node scripts/cli-onboarding-smoke.mjs` | Read generated help, follow the best-practices quick-start guidance, and confirm a minimal managed happy path. | Repeat the same help-led onboarding flow to prove the alias help path and bundled quick-start guidance stay deterministic. |
| `scenario.feature.cli.smoke` | `node scripts/cli-smoke-test.mjs` | Bootstrap a clean temp install, run a managed browser-debugging session end to end, and verify the low-level CLI surface a power user reaches for during page triage. | Repeat the same low-level CLI matrix against a second synthetic page while rechecking connect, cookies, review, pointer, export, diagnostics, and teardown flows. |
| `scenario.workflow.research.run` | `opendevbrowser research run` | Research the last 14 days of public anti-bot changes that affect production browser automation teams. | Research public guidance and field reports about Chrome extension debugging workflows over the last month. |
| `scenario.workflow.shopping.run` | `opendevbrowser shopping run` | Find the best ergonomic wireless mouse under a real budget using providers that should return live offers without auth walls. | Compare 27-inch 4K monitors under budget with explicit provider selection and price sorting pressure. |
| `scenario.workflow.product_video.url` | `opendevbrowser product-video run --product-url ...` | Build a product presentation asset pack from a live Best Buy PDP for a creative brief. | Build a second product presentation asset pack from a different live Best Buy PDP to check asset extraction variability. |
| `scenario.workflow.product_video.name` | `opendevbrowser product-video run --product-name ...` | Resolve a product by name and prepare an asset pack for a motion designer without supplying a URL manually. | Resolve a second named product with the same provider hint to check search-driven asset-pack stability. |
| `scenario.workflow.inspiredesign.run` | `opendevbrowser inspiredesign run` | Study multiple public references and return a reusable design contract without relying on deep browser capture. | Return the same inspiredesign contract plus prototype guidance while proving repeated --url inputs stay canonical. |
| `scenario.workflow.macro.web_search` | `opendevbrowser macro-resolve --execute @web.search(...)` | Find authoritative public guidance on Playwright locators for a browser automation debugging note. | Find public Chrome DevTools Protocol guidance on popup attach flows for a browser-runtime investigation. |
| `scenario.workflow.macro.web_fetch` | `opendevbrowser macro-resolve --execute @web.fetch(...)` | Fetch a Chrome extensions debugger reference page to inspect the document content directly. | Fetch a Playwright docs page to confirm direct page retrieval across a different domain and docs stack. |
| `scenario.workflow.macro.community_search` | `opendevbrowser macro-resolve --execute @community.search(...)` | Find public community threads about browser automation failures that an engineer would review before opening an incident. | Find community discussions about popup attach failures to compare troubleshooting patterns. |
| `scenario.workflow.macro.media_search` | `opendevbrowser macro-resolve --execute @media.search(...)` | Search a first-party social surface for current practitioner chatter about browser automation. | Repeat the media search on a second platform to verify first-party routing and shell detection on another surface. |
| `scenario.feature.annotate.direct` | `node scripts/annotate-live-probe.mjs --transport direct` | Request a direct annotation session on a live page to validate the annotation transport boundary. | Repeat the direct annotation probe on the second pass to ensure the manual-boundary behavior is stable. |
| `scenario.feature.annotate.relay` | `node scripts/annotate-live-probe.mjs --transport relay` | Validate relay-backed annotation on the connected extension surface as a real review handoff would. | Repeat the relay probe to ensure extension-boundary behavior stays stable across runs. |
| `scenario.feature.canvas.managed_headless` | `node scripts/canvas-live-workflow.mjs --surface managed-headless` | Build and patch a hero composition headlessly for a landing page iteration. | Repeat the headless hero-edit flow to check for replay stability after code fixes. |
| `scenario.feature.canvas.managed_headed` | `node scripts/canvas-live-workflow.mjs --surface managed-headed` | Run the same hero-edit flow in a visible managed browser for a designer reviewing changes live. | Repeat the headed canvas flow after fixes to confirm the visible surface did not regress. |
| `scenario.feature.canvas.extension` | `node scripts/canvas-live-workflow.mjs --surface extension` | Run the hero-edit canvas flow through the connected extension surface that a logged-in operator would use. | Repeat the extension canvas flow to confirm relay and runtime continuity after fixes. |
| `scenario.feature.canvas.cdp` | `node scripts/canvas-live-workflow.mjs --surface cdp` | Run the hero-edit canvas flow through the legacy CDP surface a power user still expects to work. | Repeat the legacy CDP canvas flow to check that reconnect/release behavior remains stable. |

## Guarded / non-CLI scenarios

| ID | Execution policy | Notes |
| --- | --- | --- |
| `scenario.guarded.connect.remote` | `guarded` | Attach to an already-running Chrome instance that was started with remote debugging or a known relay endpoint. |
| `scenario.guarded.native.bridge` | `guarded` | Use the native bridge from a trusted desktop/browser integration where the host integration is already provisioned. |
| `scenario.guarded.rpc.surface` | `guarded` | Issue an internal daemon RPC during a trusted power-user debugging session after verifying the exact command contract. |
| `scenario.non_cli.tool_only` | `non_cli` | Use tool-only local helpers from the plugin/tool API where no public CLI entry exists. |

## CLI-only commands

- `install`
- `update`
- `uninstall`
- `help`
- `version`
- `serve`
- `daemon`
- `native`
- `artifacts`
- `rpc`

## Tool-only surfaces

- `opendevbrowser_prompting_guide`
- `opendevbrowser_skill_list`
- `opendevbrowser_skill_load`
