# Canvas Pencil Parity Audit

Verified on March 13, 2026 against the current `opendevbrowser` worktree with source inspection, live OpenDevBrowser CLI runs, targeted tests, current-turn compiler checks, and direct browsing of Pencil public pages/docs.

---

## Evidence Base

| Evidence type | Verified artifact / source |
| --- | --- |
| Public `/canvas` router | `src/browser/canvas-manager.ts` |
| CLI and tool surface | `src/cli/index.ts`, `src/cli/commands/canvas.ts`, `src/tools/canvas.ts`, `node dist/cli/index.js --help` |
| Relay event types | `src/relay/protocol.ts`, `extension/src/types.ts` |
| Rebuilt live mode summary | `/tmp/odb-canvas-rebuilt-validation.IIemIV/summary.json` |
| Managed full watch + push retest | `/tmp/odb-canvas-managed-retest-run.RJEHHm/summary.json` |
| Extension full watch + push retest | `/tmp/odb-canvas-extension-retest-run.vnwvrH/summary.json` |
| Earlier CDP watch-loop artifact | `/tmp/odb-canvas-cdp-retest-run2.tHhkWi/summary.json` |
| Final TSX compiler validation | `npx tsc --jsx preserve --noEmit /tmp/odb-canvas-managed-retest-run.RJEHHm/final-source.tsx /tmp/odb-canvas-extension-retest-run.vnwvrH/final-source.tsx /tmp/odb-canvas-cdp-retest-run2.tHhkWi/final-source.tsx /tmp/odb-canvas-audit.HHBg4q/Hero-live-fixed.tsx` |
| Current export verification | `/tmp/odb-canvas-export-check.LfCIdf/export-html.json`, `/tmp/odb-canvas-export-check.LfCIdf/export-tsx.json`, `/tmp/odb-canvas-export-check.LfCIdf/preview.json` |
| Pencil live browsing | `/tmp/odb-pencil-pages.UZK7x8/*-snapshot.json`, homepage snapshot from session `430628e6-2f30-4dac-b881-845c5ff71c14` |
| Targeted tests | `npx vitest run tests/canvas-export.test.ts tests/canvas-code-sync-transform.test.ts tests/canvas-document-store.test.ts --coverage.enabled=false`, `npx vitest run tests/extension-background.test.ts tests/direct-annotator.test.ts tests/extension-canvas-runtime.test.ts --coverage.enabled=false` |

---

## Reclassification Lens

Against the now-green repo baseline, remaining non-pass rows are interpreted as follows:

| Status | Meaning in this audit |
| --- | --- |
| `Bounded shipped` | The feature is real in the current public surface, but the shipped lane is narrower than Pencil's desktop/editor-first experience. |
| `Near` | The validated TSX-first lane is strong and live, with the remaining delta mostly in breadth, fidelity, or editor ergonomics. |
| `Alternative` | OpenDevBrowser reaches a similar outcome through a different public abstraction, so this is not a direct missing-surface defect. |
| `Validation gap` | Code/tests are green, but this audit still lacks one focused live retest cell to promote the claim further. |
| `Missing` | No comparable verified user-facing surface was found in the current worktree. |

---

## Surface Inventory

| Surface | Exact count | Verified source | Notes |
| --- | ---: | --- | --- |
| Public CLI commands | 56 | `node dist/cli/index.js --help` | Full CLI inventory is current in the built dist. |
| Public tools | 49 | `node dist/cli/index.js --help`, `src/tools/index.ts` | Includes the generic `opendevbrowser_canvas` tool. |
| Public `canvas.*` commands | 26 | `src/browser/canvas-manager.ts` | This is the source of truth for the public canvas command surface. |
| Canvas relay event types | 15 | `src/relay/protocol.ts`, `extension/src/types.ts` | Protocol and extension type unions match. |
| Public CLI wrappers for canvas | 1 | `src/cli/commands/canvas.ts` | Generic `canvas --command canvas.*`. |
| Public tool wrappers for canvas | 1 | `src/tools/canvas.ts` | Generic `opendevbrowser_canvas`. |
| Extension runtime-only helper commands | 7 | `extension/src/canvas/canvas-runtime.ts` | Includes internal `canvas.tab.sync` and `canvas.overlay.sync`, which are not public agent-callable commands. |

### Public command inventory

- `canvas.session.open`
- `canvas.session.attach`
- `canvas.session.status`
- `canvas.session.close`
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
- `canvas.code.bind`
- `canvas.code.unbind`
- `canvas.code.pull`
- `canvas.code.push`
- `canvas.code.status`
- `canvas.code.resolve`

---

## Agent Accessibility

| Capability | Tool surface | CLI surface | Verified status | Notes |
| --- | --- | --- | --- | --- |
| Session, plan, document, preview, overlay, code-sync commands | `opendevbrowser_canvas` | `opendevbrowser canvas --command canvas.*` | Pass | All 26 public commands are callable through the generic wrappers. |
| Natural-language agent control | Yes | Yes | Pass | The surface is generic but fully command-addressable; NL intent maps to `{ command, params }`. |
| Raw relay event consumption | No direct wrapper | No direct wrapper | Alternative | Public agent access is intentionally shaped around `canvas.feedback.poll` / `canvas.feedback.subscribe`; raw relay envelopes remain protocol internals rather than first-class agent APIs. |
| `canvas.feedback.subscribe` initial payload | Yes | Yes | Pass | Initial items, cursor, and subscription metadata are returned publicly. |
| `canvas.feedback.subscribe` live stream | No | Yes | Bounded shipped | CLI `--output-format stream-json` now bridges the subscription through repeated `canvas.feedback.poll` calls until timeout; the tool wrapper still returns only the initial payload, so the remaining gap is wrapper ergonomics rather than missing feedback data. |
| Extension runtime internals (`canvas.tab.sync`, `canvas.overlay.sync`) | No | No | By design | Core issues these internally; they are not intended as public agent commands. |

Verdict:
- Public command coverage for agents is complete.
- Live feedback streaming is now available through the public CLI surface.
- The remaining wrapper gap is tool-side live feedback streaming.

---

## Practical Validation Matrix

| Mode | Real-time code -> canvas watch | Canvas -> code push | Final preview projection | Final source compiles | Evidence | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Managed | Pass | Pass | `bound_app_runtime` | Pass | `/tmp/odb-canvas-managed-retest-run.RJEHHm/summary.json`, `/tmp/odb-canvas-managed-retest-run.RJEHHm/final-source.tsx` | Green |
| Extension | Pass | Pass | `bound_app_runtime` | Pass | `/tmp/odb-canvas-extension-retest-run.vnwvrH/summary.json`, `/tmp/odb-canvas-extension-retest-run.vnwvrH/final-source.tsx` | Green |
| CDP connect | Earlier same-day watch loop passed, but on pre-rebuild fallback path | Rebuilt patch-only + push passed | Rebuilt flow stayed `bound_app_runtime` for initial render, patch-only sync, and push | Pass | `/tmp/odb-canvas-rebuilt-validation.IIemIV/summary.json`, `/tmp/odb-canvas-cdp-retest-run2.tHhkWi/summary.json`, `/tmp/odb-canvas-cdp-retest-run2.tHhkWi/final-source.tsx` | Validation gap: rebuilt watch-loop parity was not rerun separately after the rebuild/target-selection fix |
| Managed forced fallback / recovery | N/A | N/A | `bound_app_runtime -> canvas_html -> bound_app_runtime` | N/A | `/tmp/odb-canvas-rebuilt-validation.IIemIV/summary.json` | Green |

### What is verified in practice

| Claim | Current verified state |
| --- | --- |
| Code changes show on canvas in real time | Verified in managed and extension mode from the watch-loop retests. |
| Canvas edits rewrite code and stay live | Verified in managed and extension mode; rebuilt CDP push is also green. |
| `bound_app_runtime` works now | Verified in managed, extension, and rebuilt CDP patch/push flows when instrumentation and target selection are correct. |
| Fallback is explicit and recoverable | Verified. Forced fallback drops to `canvas_html` and can recover back to `bound_app_runtime`. |
| Push still emits invalid TSX | Not reproduced. Current-turn `tsc` checks pass on all final generated files and the active bound file. The older audit claim was stale. |

---

## Component, Icon, and Library Fidelity

| Lane | Current representation | Practical result | Fidelity verdict |
| --- | --- | --- | --- |
| `shadcn` components | Policy string plus binding metadata (`componentName`, `sourceKind`) | Exports and preview render semantic Button, Tabs, and Card shapes | Semantic pass, not library-faithful |
| `tailwindcss` styling lane | Policy string only | Utility classes and local CSS shims are emitted when the policy allows it | Semantic pass, not original runtime-style fidelity |
| `tabler` icons | `iconRef.sourceLibrary = "tabler"` | Inline SVG approximations render in export and preview | Bounded shipped |
| `microsoft-fluent-ui-system-icons` | `iconRef.sourceLibrary = "microsoft-fluent-ui-system-icons"` | Inline SVG approximations render in export and preview | Bounded shipped |
| `3dicons` | Decorative metadata only | Reduced to a generic orb-style decorative element | Degraded semantic fallback |
| `@lobehub/fluent-emoji-3d` | Decorative metadata only | Reduced to emoji fallback (`✨` / `🎉`) | Degraded semantic fallback |
| Motion / dialog-like lanes | Inferred from component names | Collapse into the same semantic card/article shell | Semantic-only |
| Arbitrary component libraries | Allowlist strings + unsupported JSX fallbacks | Unapproved/custom libraries are blocked or degrade to unsupported regions | Missing |
| Reusable component inventory | Raw arrays on the document model | Live runtime artifacts still show `componentInventoryCount: 0` | Missing |

### Current export and render proof

| Check | Verified evidence |
| --- | --- |
| Export carries library metadata | Current export includes `data-component-libraries="shadcn"`, `data-icon-libraries="3dicons,tabler,microsoft-fluent-ui-system-icons,@lobehub/fluent-emoji-3d"`, and `data-styling-libraries="tailwindcss"` in `.opendevbrowser/canvas/exports-canvas_b1898766-4880-4dd3-87c0-14b44d5b968b.html` and `.tsx`. |
| Export emits semantic components | Current export contains real semantic tags (`<button>`, tab shell, `<article>`) with source-kind metadata rather than imported library code. |
| Preview renders the exported shapes | Current preview snapshot from `/tmp/odb-canvas-export-check.LfCIdf/preview.png` and the active-page snapshot show a rendered button, tab, article, and note on the preview page. |
| Export and preview stay on the same materialized lane | Verified: the preview page is a `data:` HTML page using the same core-generated output path. |

Verdict:
- Integrated library metadata does show up on canvas/export output.
- Rendering is currently semantic and constrained, not package-faithful or library-agnostic.

---

## Pencil Feature Inventory vs OpenDevBrowser `/canvas`

The table below inventories directly observed public Pencil features from the homepage, downloads page, prompt gallery, pricing page, and the docs pages visited in this audit.

| Pencil feature / claim | Pencil evidence | OpenDevBrowser `/canvas` evidence | Verdict | Notes |
| --- | --- | --- | --- | --- |
| Desktop app | `downloads` page lists macOS, Windows, and Linux downloads | No desktop design app; OpenDevBrowser is CLI + extension + daemon | Missing | Different product shape. |
| IDE extensions | `downloads` lists Cursor, VSCode, Antigravity, Windsurf, Open VSX | Chrome extension exists; no IDE-native design extension | Alternative | OpenDevBrowser reaches agents through CLI/tool/Chrome-extension surfaces rather than IDE-native design plugins. |
| Infinite canvas | Homepage and `Pencil Interface` docs | `/canvas`, design tab, preview targets, overlays | Bounded shipped | The stage supports pan/zoom and node movement, but this audit does not claim Pencil-level infinite-workspace ergonomics. |
| Frames | `Pencil Interface` docs | Canvas pages and nodes exist | Bounded shipped | Frame/page primitives are real, but Pencil-style framing tooling is still thinner. |
| Layers panel | `Pencil Interface` docs | No verified layers panel in current extension canvas UI | Missing | Editor ergonomics gap. |
| Properties panel | `Pencil Interface` docs | Inspector panel supports node name/text editing plus selection metadata | Bounded shipped | There is a real inspector, but it is not a Pencil-complete properties system. |
| AI chat in surface | `Pencil Interface` docs and `AI Integration` page | Agent can drive `/canvas`; no verified in-canvas chat UI | Alternative | OpenDevBrowser externalizes agent control through CLI/tool surfaces instead of embedding chat inside the canvas UI. |
| Prompt gallery | `prompts` page | No product prompt gallery | Missing | Closest alternative is skills/docs. |
| Curated design kits | Homepage and docs nav (`Styles and UI Kits`) | Library policy lanes plus semantic component primitives | Missing | No verified kit browser/import workflow exists in the current public surface. |
| Bring your own libraries | Homepage claim | Unapproved/custom libraries are blocked or degrade | Missing | Current implementation is intentionally constrained. |
| Open file format | Homepage + docs nav (`.pen Files`) | Repo-native `.canvas.json` plus code-sync manifests | Alternative | Open local files exist, but not Pencil format compatibility. |
| Design as code | Homepage + docs | Repo-native canvas docs, TSX export, TSX import | Near | Strong overlap in the supported TSX-first lane. |
| Design -> code | `Design ↔ Code` docs | `canvas.document.export`, `canvas.code.push` | Near | Verified for the supported TSX-first lane, but still semantic/constrained rather than library-faithful. |
| Code -> design | `Design ↔ Code` docs | `canvas.code.pull` and watched import loop | Near | Verified live in managed and extension mode. |
| Two-way sync | Homepage + docs | Managed and extension loops are green; rebuilt CDP render/push is green | Near | Strong in the validated TSX-first lane; the remaining delta is library breadth plus one unrepeated rebuilt CDP watch-loop artifact. |
| Variables / design tokens | `Design ↔ Code` docs, `Variables` nav | Tokens exist in the model and export path | Validation gap | Source-level token support is present, but this audit still lacks a focused live CSS-variable round-trip proof. |
| Figma import | Homepage + docs | No verified Figma import surface | Missing | No direct equivalent found. |
| MCP / AI assistant integration | `AI Integration` docs | OpenDevBrowser is itself agent-first with CLI/tool/daemon/relay surfaces | Match | OpenDevBrowser is stronger here than on desktop design UX. |
| Claude Code integration | `AI Integration` docs | Native fit; OpenDevBrowser tools/CLI already target agent use | Match | Strong alignment. |
| Cursor integration | `AI Integration` docs | Not a dedicated Cursor extension; agents can still control via CLI/tool surface | Alternative | Cursor can drive OpenDevBrowser through the same agent-first CLI/tool path, but there is no dedicated Cursor-native extension. |
| Codex CLI integration | `AI Integration` docs | Native fit; verified current audit uses Codex + OpenDevBrowser CLI together | Match | Strong alignment. |
| Keyboard shortcuts / undo-redo | `Pencil Interface` docs | No equivalent public canvas-editor shortcut matrix verified | Missing | Editor polish gap. |

Practical comparison:
- OpenDevBrowser is competitive on agent control, command addressability, and the repo-native TSX lane.
- Pencil is ahead on native editor UX, Figma import, prompt gallery, UI-kit experience, and general-purpose library bring-your-own support.

---

## Annotation and Send-from-Canvas Gap Map

| Requested capability | Current verified state | Gap type | Likely impacted files |
| --- | --- | --- | --- |
| Per-annotation copy in the annotation popup | Shipped and live-validated through popup `Copy item` actions | No current UI gap | None |
| Per-annotation send to agent from annotation popup | Shipped through popup `Send item`; payload is persisted for later `annotate --stored` retrieval | Bounded shipped: storage-backed, not proactive chat ingest | `extension/src/background.ts`, `extension/src/types.ts`, `src/browser/annotation-manager.ts`, `src/cli/daemon-commands.ts`, `src/index.ts` |
| Combined send to agent from annotation popup | Shipped through popup `Send payload`; same storage-backed semantics | Bounded shipped: storage-backed, not proactive chat ingest | same as above |
| Direct annotation on canvas | Shipped as selected-node draft annotations with per-item and combined copy/send in `canvas.html` | Bounded shipped: selection-driven drafts, not a freeform stage-overlay picker | `extension/src/canvas-page.ts`, `extension/src/background.ts`, `extension/src/types.ts` |
| Per-element copy/send from canvas popup | Shipped and verified through `Copy item` / `Send item` | Bounded shipped: storage-backed, not proactive chat ingest | `extension/src/background.ts`, `src/browser/annotation-manager.ts`, `src/cli/daemon-commands.ts`, `src/index.ts` |
| Combined payload copy/send from canvas | Shipped through `Copy All` / `Send All` | Bounded shipped: storage-backed, not proactive chat ingest | same as above |

Smallest safe implementation order:
1. Add an explicit host-ingest contract so popup/canvas `Send` can deliver into the active agent/chat rather than only persisting payloads.
2. Keep the current `annotate --stored` retrieval path as a fallback/audit trail, but expose delivered vs stored-only acknowledgements in the UI.
3. Decide whether canvas needs a freeform stage-overlay picker beyond the current selected-node draft workflow.
4. If freeform stage annotation is required, reuse the existing canonical payload schema and current draft serialization path instead of creating a second annotation model.

---

## Library-Agnostic Path

| Target capability | Current blocker | Safe next step |
| --- | --- | --- |
| Bring your own component libraries | Library identity is mostly raw strings plus allowlists | Add typed adapter identities to the model and validation layer. |
| Library-faithful render/export | `src/canvas/export.ts` emits semantic primitives, not imported library code | Add a render adapter registry inside `src/canvas/export.ts`, but keep one canonical renderer. |
| Library-aware import from code | `tsx-react-v1` only understands the constrained TSX lane | Extend import only when a library adapter can prove exact component/icon matches. |
| Reusable components on canvas | `components` and `componentInventory` remain untyped/raw and effectively unused | Add typed reusable-component records and stable inventory semantics. |
| Icon-library fidelity | Only a few inline approximations exist | Move icon handling behind adapters with capability metadata and explicit fallback policy. |

Design rule:
- Do not add a second renderer.
- Keep `src/canvas/export.ts` as the single semantic materializer and make library support an adapter seam inside it.

---

## Issue Inventory

| Status | Issue | Current state |
| --- | --- | --- |
| Fixed this sweep | Live CLI behavior lagged source because the daemon was serving stale `dist/` output | Rebuilt and restarted; rebuilt validation artifact is green. |
| Fixed this sweep | Runtime fallback could stick on unstable preview URLs | Patched with stable `sourceUrl` retention and a regression test. |
| Fixed this sweep | Old audit claimed `canvas.code.push` emitted invalid TSX | Current-turn `tsc` checks pass on all validated output files; the old claim was stale and is retired. |
| Fixed in docs | Earlier parity notes underreported popup/canvas annotation actions | Current source and live evidence show popup and canvas both ship per-item and combined copy/send actions. |
| Fixed in docs | Public docs blurred public canvas commands with extension-runtime helper commands | This audit treats `canvas.tab.sync` and `canvas.overlay.sync` as internal runtime commands only. |
| Open | `canvas.feedback.subscribe` live stream is still not consumable through the tool wrapper | CLI now streams via a polling bridge; tool-driven agents can still loop on `canvas.feedback.poll`, but the wrapper does not yet expose a first-class stream contract. |
| Open | Popup and canvas `Send` actions are storage-backed rather than proactive chat delivery | Current extension/background flow persists payloads for later `annotate --stored` retrieval; direct host-ingest semantics are still missing. |
| Open | Canvas annotation remains selected-node draft based rather than freeform stage-overlay picking | Current workflow is usable, but it is not a Pencil-style freeform annotator on the stage itself. |
| Open | Renderer is not library-agnostic or library-faithful | Semantic-only beyond the narrow supported lanes. |
| Open | Reusable component inventory is not a real working surface yet | Still effectively unused in live artifacts. |
| Validation gap | Rebuilt CDP watch-loop parity was not rerun separately after the target-selection fix | Rebuilt render + patch-only + push are green; full rebuilt watch-loop remains one incomplete retest cell. |

---

## Validation Status

| Gate | Status |
| --- | --- |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm run extension:build` | Pass |
| `npm run test` | Pass (`139` files, `1654` tests, global branch coverage `97.01%`) |
