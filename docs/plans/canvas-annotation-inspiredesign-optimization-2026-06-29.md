# Canvas, Annotation, and Inspired Design Optimization Plan

## Goal

Deliver a focused implementation path for three connected upgrades:

- Annotation V2 compact agent handoff with safe redaction, stable identity, and anchor-first placement.
- Canvas workspace orchestration above existing child `CanvasManager` sessions, including extension 4x2 workspace isolation.
- Inspired Design strict proof that preserves existing artifact authority semantics.

Success means the implementation keeps existing behavior intact, adds no hidden release paths, proves real workflows, and updates docs plus public surface in the same atomic sequence.

## Background

Current annotation flows send rich payloads from DOM, popup, canvas, and background paths. The target architecture keeps rich internal payloads for debugging and explicit raw retrieval, but makes compact redacted payloads the default for copy, send, AgentInbox, and system injection. Protocol ownership must be aligned between extension types and relay protocol types.

Current canvas runtime has one `CanvasManager` session per document. This is the correct unit for leases, revision streams, document store, repo path, code-sync binding, feedback, preview, and cleanup. The workspace layer must orchestrate child sessions rather than turning one session into multiple documents.

Current extension `canvas.html` is singleton state with one page state, one BroadcastChannel, one IndexedDB cache behavior, and one active draft set. Workspace identity and child identity must be added before the 4x2 shell.

Inspired Design already distinguishes `pin-media-index.json` as Pinterest readiness authority, `motion-evidence.json` as browser replay authority, and `media-analysis.json` as advisory saved-media design facts. This plan strengthens proof requirements without changing that authority model.

## Approach

1. Define contracts before behavior changes.
2. Redact before compact derivation, persistence, relay send, or injection.
3. Keep rich internal payloads bounded and explicit.
4. Add canvas workspace as refs-only orchestration over existing child sessions.
5. Add extension workspace and child isolation before visual shell work.
6. Preserve Inspired Design authority semantics while requiring direct artifact inspection.
7. Run lane review, fixes, real workflow proof, adversarial review, full gates, and PR review.
8. Keep changes atomic and avoid broad rewrites.

Assumptions:

- Final workspace command names may use `canvas.workspace.*`, but names are not fixed until implementation.
- Existing `CanvasManager`, `CanvasSessionSyncManager`, and `CanvasCodeSyncManager` remain the child-session authority.
- No diagnostic-only Inspired Design bundle can satisfy product-ready acceptance.

## Scenario Inventory

- Annotation direct DOM copy and send with compact default payload.
- Annotation relay delivery with delivered, stored-only, no active scope, ambiguous scope, relay failure, and MV3 restart states.
- Canvas annotation copy and send with canvas binding metadata included.
- Rich payload explicit retrieval with screenshot bytes excluded from shared inbox and injection.
- Redaction before disk persistence, clipboard copy, relay send, AgentInbox, and system injection.
- Identity from explicit data metadata, canvas binding metadata, custom elements, AX and selector heuristics, with framework internals debug-only.
- Ordered locator bundles for stable target recovery, explicitly covering backend node id, frame id, test id, ARIA, CSS, shadow-chain, XPath, and text fallbacks across CDP and extension-only capture.
- Anchor-first placement near DOM and canvas targets with collisions, viewport clamp, panel avoidance, resize reclamp, and mobile side-panel fallback.
- Four child canvas workspace lifecycle with create, attach, patch, undo, save, close, and reopen.
- Eight child canvas workspace lifecycle with preview budgets and degradation.
- Child A patch, undo, save, and code-sync operations cannot mutate child B.
- Lease collision, duplicate `documentId`, duplicate `repoPath`, and duplicate code-sync binding collision handling.
- Bound app preview degradation without claiming parity beyond supported safe preview contracts.
- Inspired Design current daemon preflight with unique config root, cache root, ports, and tokens.
- Inspired Design direct inspection of `evidence.json`, `ranked-references.json`, `pin-media-index.json`, `motion-evidence.json`, `media-analysis.json`, and `bundle-manifest.json`.
- Docs and generated public surface drift detection.

## Work Plan

### Task 1 - Annotation V2 contract and shared redaction

Reasoning: Annotation compact handoff must be safe and consistent before copy, send, persistence, or injection changes.

What to do: Add the V2 annotation contract, compact shape, redaction metadata, and shared sanitizer.

How:
1. Add `schemaVersion: 2` and `annotation.compact` contract to shared extension and relay protocol types.
2. Define compact required fields, byte budget, truncation order, and redaction metadata.
3. Extract one sanitizer used before compact derivation, storage, send, copy, AgentInbox, and system injection.
4. Keep rich internal payload available through explicit raw retrieval only.
5. Ensure screenshot bytes are stripped from inbox and injection paths while asset refs remain allowed.
Files impacted:
- `extension/src/types.ts`
- `src/relay/protocol.ts`
- `extension/src/annotation-payload.ts`
- `extension/src/background.ts`
- `extension/src/annotate-content.ts`
- `extension/src/canvas-page.ts`
- `src/core/bootstrap.ts`
- `tests/extension-annotation-payload.test.ts`
- `tests/extension-background.test.ts`

End goal: Compact redacted annotation payloads are the default agent handoff, and rich payloads remain explicit and bounded.

Acceptance criteria:
- `schemaVersion: 2` is present on new annotation payloads.
- Compact payload is default for copy, send, AgentInbox, and system injection.
- Shared redaction runs before every persistence or handoff boundary.
- No screenshot base64 reaches shared inbox or system injection.
- Delivered, stored-only, no active scope, ambiguous scope, and relay failure receipts are preserved accurately.

QA and evidence:
- Recompute branch coverage deficit before adding tests.
- Run `npm run test -- tests/extension-annotation-payload.test.ts tests/extension-background.test.ts`.
- Capture byte reduction and task parity evidence under `.opendevbrowser/annotation-v2/<runId>/` with `compact-payload.json`, `rich-payload.json`, `byte-report.json`, and `parity-report.json`.
- Verify no base64 screenshot fields in persisted AgentInbox payloads.

Atomic commit: `feat: add annotation v2 compact payload contract`

### Task 2 - Annotation identity and placement

Reasoning: Compact payloads are only useful if agents can reliably recover the target and if visible notes do not obscure work.

What to do: Add ordered identity hierarchy, locator bundles, and pure anchor-first placement helper.

How:
1. Implement ordered identity priority: explicit data metadata, canvas binding metadata, custom elements, AX and selector heuristics.
2. Keep framework internals debug-only and redacted by default.
3. Add ordered locator bundle output with confidence, scope, transport provenance, frame facts, and recovery hints.
4. Require selector bundle candidates for backend node id, frame id, test id, ARIA role and name, CSS selector, shadow-chain path, XPath, and text fallback locators.
5. Define transport availability explicitly: CDP capture must include backend node id and frame id when CDP exposes them; extension-only capture must record unavailable CDP-only fields as absent with a reason while still emitting test id, ARIA, CSS, shadow-chain, XPath, and text fallback candidates when derivable.
6. Rank locator candidates by stability: backend node and frame scoped facts for same-session recovery, explicit test or data ids, ARIA role and name, stable CSS and shadow-chain paths, XPath, then bounded text fallback.
7. Add a pure placement helper that accepts anchor rect, viewport, panels, existing annotations, and desired side.
8. Handle collision scoring, viewport clamp, target avoidance, connector fallback, resize reclamp, and mobile side-panel fallback.
9. Wire DOM and canvas annotation UIs to the helper without moving business logic into UI handlers.

Files impacted:
- `extension/src/annotation-payload.ts`
- `extension/src/annotate-content.ts`
- `extension/src/canvas-page.ts`
- `extension/src/canvas/viewport-fit.ts`
- `src/browser/canvas-manager.ts`
- `src/canvas/types.ts`
- `tests/extension-annotation-payload.test.ts`
- `tests/extension-canvas-annotation.test.ts`

End goal: Annotation targets carry stable ordered identity and visible placement is deterministic, testable, and collision-aware.

Acceptance criteria:
- Locator bundles include candidate families for backend node id, frame id, test id, ARIA role and name, CSS selector, shadow-chain path, XPath, and text fallback.
- Locator bundles rank stable metadata above weak selectors, with backend node and frame facts used for same-session recovery and text fallback ranked last.
- CDP and extension-only transport differences are represented explicitly, including reasoned absence for CDP-only backend node id or frame id in extension-only capture.
- Canvas binding metadata is included for canvas-origin annotations.
- Framework-private metadata never appears in default compact payloads.
- Placement helper is pure and covered for collision, clamp, panel avoidance, resize, and mobile cases.
- DOM and canvas annotations use the same placement rules.

QA and evidence:
- Run focused identity and placement tests, including fixture cases for backend node id, frame id, test id, ARIA, CSS, shadow-chain, XPath, and text fallback candidates.
- Store fixture evidence under `.opendevbrowser/annotation-v2/<runId>/identity/` with `selector-bundle-candidates.json`, `transport-availability-report.json`, and top-1 and top-3 recovery reports.
- Store placement screenshots and JSON decisions under `.opendevbrowser/annotation-v2/<runId>/placement/`.

Atomic commit: `feat: add annotation identity and placement helpers`

### Task 3 - Canvas workspace core above child sessions

Reasoning: Workspace behavior must preserve the proven one-session-per-document model while coordinating multiple children safely.

What to do: Add `CanvasWorkspace` orchestration with refs-only manifests, child routing, collision guards, and preview budgets.

How:
1. Add workspace domain types for `workspaceId`, `childId`, child refs, coordinator state, and preview budget state.
2. Implement a workspace manager above existing `CanvasManager` child sessions.
3. Persist workspace manifests as refs only: child session refs, document ids, repo paths, code-sync binding ids, and role metadata.
4. Guard duplicate leases, duplicate `documentId`, duplicate `repoPath`, duplicate code-sync binding, and stale child routing.
5. Route child commands to existing `CanvasManager.execute()` without changing child session semantics.
6. Add preview budget states: focused live, pinned live, background live, thumbnail, paused, and degraded.
7. Add workspace performance and memory telemetry hooks for lifecycle runs, including child count, active previews, queued preview work, operation latency, process memory samples, and retained workspace manifest size.
8. Add close semantics that preserve children unless explicit child close is requested.
Files impacted:
- `src/browser/canvas-manager.ts`
- `src/browser/canvas-session-sync-manager.ts`
- `src/browser/canvas-code-sync-manager.ts`
- `src/browser/canvas-runtime-preview-bridge.ts`
- `src/canvas/types.ts`
- `src/canvas/document-store.ts`
- `src/canvas/code-sync/types.ts`
- `src/canvas/code-sync/manifest.ts`
- `src/core/bootstrap.ts`
- `src/cli/commands/canvas.ts`
- `tests/canvas-manager*.test.ts`
- `tests/canvas-code-sync-manager.test.ts`

End goal: A workspace can coordinate four or eight child sessions without cross-child mutation or uncontrolled preview fanout.

Acceptance criteria:
- Workspace manifest stores refs only and does not duplicate child document contents.
- Child A operations cannot mutate child B.
- Duplicate document, repo path, lease, and code-sync binding conflicts are blocked with actionable errors.
- Existing single-canvas commands remain green.
- Workspace close does not delete child documents.
- Preview budgets degrade deterministically.
- Four-child and eight-child workflows meet documented operation latency, preview fanout, and memory budgets without unbounded growth between open, patch, save, close, and reopen phases.
- Canvas workspace proof records sampled memory and process telemetry before open, at steady state, after preview degradation, and after close, with retained resources limited to expected child refs and manifests.

QA and evidence:
- Run `npm run test -- tests/canvas-manager*.test.ts tests/canvas-code-sync-manager.test.ts`.
- Run four-child and eight-child lifecycle workflows.
- Run `npm run build` before real workspace proof so telemetry reflects built runtime behavior when applicable.
- Store evidence under `.opendevbrowser/canvas-workspace/<runId>/` with `workspace-manifest.json`, `child-routing-report.json`, `preview-budget-report.json`, `performance-report.json`, `memory-samples.json`, and conflict artifacts.
- Acceptance evidence must state the selected latency, fanout, and memory budgets, the sampled commands used, and whether each budget passed.

Atomic commit: `feat: add canvas workspace orchestration`

### Task 4 - Extension canvas isolation and 4x2 shell

Reasoning: The extension page is singleton today, so workspace identity and child identity must be isolated before rendering a multi-agent shell.

What to do: Add `workspaceId` and `childId` through extension state, BroadcastChannel, IndexedDB keys, runtime messages, and the 4x2 shell.

How:
1. Extend `CanvasPageState`, `CanvasSessionSummary`, and page messages with workspace and child identity.
2. Scope BroadcastChannel names, IndexedDB keys, current state, selection, drafts, and cached previews by workspace and child.
3. Update `CanvasRuntime` serialization and preview sync paths to preserve child routing.
4. Build the 4x2 shell after isolation: coordinator lane, active child detail, worker panes, activity log, review and checkpoint lane, and preview budget indicators.
5. Add visible delivered, degraded, paused, conflict, lease, revision, and sync states.
6. Prove extension reload preserves isolated state and does not mix children.
7. Prove relay stability for canvas workspace updates under load, including relay reconnect, MV3 extension restart, BroadcastChannel resubscription, and no duplicate or lost child update delivery after reconnect.
8. Capture extension memory and UI responsiveness samples for four-child and eight-child shells, including active preview degradation and reload recovery.
Files impacted:
- `extension/src/canvas/model.ts`
- `extension/src/canvas-page.ts`
- `extension/src/canvas/canvas-runtime.ts`
- `extension/src/types.ts`
- `extension/src/background.ts`
- `docs/EXTENSION.md`
- `tests/extension-canvas-*.test.ts`

End goal: The extension supports an agent-centric 4x2 workspace shell with deterministic child isolation and reload behavior.

Acceptance criteria:
- BroadcastChannel and IndexedDB data are scoped by workspace and child.
- Reload restores the correct workspace without cross-child draft, selection, or preview leakage.
- 4x2 shell exposes coordinator controls, active child detail, worker lanes, activity log, checkpoints, and preview budget state.
- Extension build passes.
- Single-canvas extension behavior remains compatible.
- Relay reconnect and MV3 restart preserve workspace and child routing without duplicate delivery, lost acknowledged updates, or cross-child state mixing.
- Extension shell proof records bounded memory and responsiveness samples for four-child and eight-child workspaces before reload, after reload, and after relay reconnect.

QA and evidence:
- Run `npm run extension:build`.
- Run focused extension canvas tests.
- Capture reload proof under `.opendevbrowser/canvas-workspace/<runId>/extension-reload/` with before and after state snapshots.
- Capture relay stability proof under `.opendevbrowser/canvas-workspace/<runId>/relay-stability/` with `reconnect-report.json`, `mv3-restart-report.json`, delivery logs, duplicate-delivery checks, and lost-update checks.
- Capture extension memory and responsiveness proof under `.opendevbrowser/canvas-workspace/<runId>/extension-performance/` with `memory-samples.json`, `responsiveness-report.json`, and preview degradation state snapshots.
- Capture desktop, tablet, and mobile screenshots for the shell.

Atomic commit: `feat: add extension canvas workspace shell`

### Task 5 - Inspired Design strict proof and authority preservation

Reasoning: Proof must verify actual artifacts, not command success, while keeping product readiness authority unchanged.

What to do: Harden strict harvest proof, preflight isolation, and artifact inspection without making `media-analysis.json` authoritative.

How:
1. Require daemon preflight with `npx opendevbrowser status --daemon --output-format json` and `data.fingerprintCurrent === true`.
2. Run strict workflows with unique `OPENCODE_CONFIG_DIR`, `OPENCODE_CACHE_DIR`, daemon port, relay port, and token.
3. Inspect artifact contents directly rather than trusting exit status.
4. Preserve authority boundaries: `pin-media-index.json` for Pinterest readiness, `motion-evidence.json` for browser replay, `media-analysis.json` for advisory saved-media facts only.
5. Fail acceptance for diagnostic-only bundles even if commands exit successfully.
6. Add tests that missing media-analysis binaries degrade advisory facts only and do not pass readiness.
Files impacted:
- `src/providers/workflows.ts`
- `src/inspiredesign/types.ts`
- `src/inspiredesign/media-analysis/analyzer.ts`
- `src/inspiredesign/media-analysis/binaries.ts`
- `src/public-surface/source.ts`
- `tests/inspiredesign-*`
- `tests/media-analysis-dependency-guidance.test.ts`

End goal: Inspired Design follow-through is accepted only when direct artifact inspection proves product-ready evidence.

Acceptance criteria:
- `media-analysis.json` cannot pass or fail product readiness.
- Diagnostic-only bundles fail acceptance.
- Current daemon fingerprint is required before strict harvest proof.
- Unique config, cache, ports, and tokens are used for strict proof.
- Artifact inspection verifies hashes, bytes, readiness fields, and top-reference relevance.

QA and evidence:
- Run Inspired Design focused tests.
- Run strict harvest workflow with unique env values.
- Store proof under `.opendevbrowser/inspiredesign-strict/<runId>/` with inspected `evidence.json`, `ranked-references.json`, `pin-media-index.json`, `motion-evidence.json`, `media-analysis.json`, `bundle-manifest.json`, and `inspection-report.json`.

Atomic commit: `test: add inspiredesign strict proof gates`

### Task 6 - Docs and public surface synchronization

Reasoning: Behavior, command names, generated manifests, and user-facing authority wording must move together.

What to do: Update docs, skills, generated manifests, and command inventory after implementation decisions are final.

How:
1. Update annotation docs for compact default, rich explicit retrieval, redaction, receipts, and identity fields.
2. Update canvas docs for workspace architecture, child sessions, 4x2 shell, preview budgets, and code-sync collision rules.
3. Update Inspired Design docs for strict proof, authority boundaries, diagnostic-only failure, and media-analysis advisory status.
4. Update public surface source when command names or help wording change.
5. Regenerate public-surface manifests.
6. Update relevant bundled skills when workflow guidance changes.
Files impacted:
- `docs/ANNOTATE.md`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/EXTENSION.md`
- `docs/TROUBLESHOOTING.md`
- `docs/privacy.md`
- `docs/DESIGN_CANVAS_TECHNICAL_SPEC.md`
- `docs/CANVAS_BIDIRECTIONAL_CODE_SYNC_TECHNICAL_SPEC.md`
- `docs/CANVAS_ADAPTER_PLUGIN_CONTRACT.md`
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `skills/opendevbrowser-best-practices/SKILL.md`
- Relevant guidance tests and command inventory tests

End goal: Documentation and generated public surface accurately describe implemented behavior and proof requirements.

Acceptance criteria:
- Public surface source and generated manifests are in sync.
- CLI docs and surface reference use the same command names and authority wording.
- Privacy docs describe redaction and no screenshot-byte inbox policy.
- Extension docs include reload and workspace isolation troubleshooting.
- Skills match current workflow guidance.

QA and evidence:
- Run `node scripts/generate-public-surface-manifest.mjs`.
- Run `npm run test -- tests/public-surface-manifest.test.ts tests/workflow-surface-map.test.ts`.
- Run `npx opendevbrowser --help` and `npx opendevbrowser help` against the built package as applicable.
- Store generated help snapshots under `.opendevbrowser/public-surface/<runId>/`.

Atomic commit: `docs: sync canvas annotation inspiredesign surfaces`

### Task 7 - Full QA, review, and release readiness

Reasoning: This change spans protocol, extension, runtime, docs, and workflow proof, so acceptance requires progressive review and full quality gates.

What to do: Run the review and QA loop until scoped issues are fixed and commit-ready.

How:
1. Recompute global branch deficit before adding or finalizing tests.
2. Add or update tests for every new branch outcome.
3. Run lane review for annotation, canvas core, extension, Inspired Design, docs, and public surface.
4. Fix lane issues and rerun real workflow proof.
5. Run explicit annotation, canvas workspace, extension shell, and relay stability proof with performance and memory telemetry enabled.
6. Run adversarial review on the final diff.
7. Fix scoped issues only.
8. Run full quality gates with zero errors and zero warnings.
9. Inspect git diff and stage atomic commits.
Files impacted:
- Test files listed in earlier tasks
- Release evidence directories under `.opendevbrowser/`
- Docs and public surface files listed in Task 6

End goal: The implementation is tested, reviewed, documented, and ready for PR.

Acceptance criteria:
- Formatter, lint, typecheck, build, coverage, tests, extension build, and release gates pass with zero warnings.
- Coverage remains at or above the project threshold.
- Real workflow evidence exists for annotation, canvas workspace, code-sync collisions, extension reload, relay stability, performance, memory, and Inspired Design strict proof.
- Annotation selector evidence proves backend node id, frame id, test id, ARIA, CSS, shadow-chain, XPath, and text fallback candidates with CDP and extension-only transport differences.
- Canvas and extension evidence proves bounded performance, sampled memory, preview fanout control, relay reconnect, and MV3 restart stability.
- Review loop produces no unresolved scoped issues.
- Atomic commits are ready with required co-author trailer.

QA and evidence:
- Run `npm run lint`.
- Run `npm run build`.
- Run `npm run extension:build`.
- Run `npm run version:check`.
- Run `npm run test`.
- Run real annotation selector proof and store `.opendevbrowser/annotation-v2/<runId>/identity/selector-bundle-candidates.json` plus `.opendevbrowser/annotation-v2/<runId>/identity/transport-availability-report.json`.
- Run real canvas workspace performance and memory proof and store `.opendevbrowser/canvas-workspace/<runId>/performance-report.json`, `.opendevbrowser/canvas-workspace/<runId>/memory-samples.json`, and `.opendevbrowser/canvas-workspace/<runId>/preview-budget-report.json`.
- Run real relay stability proof and store `.opendevbrowser/canvas-workspace/<runId>/relay-stability/reconnect-report.json` and `.opendevbrowser/canvas-workspace/<runId>/relay-stability/mv3-restart-report.json`.
- Run any release harness commands required by current release docs.
- Store final QA report under `.opendevbrowser/final-qa/<runId>/qa-report.md`, linking every acceptance evidence path and recording pass or fail for each budget.

Atomic commit: `chore: verify canvas annotation inspiredesign upgrade`

## Review And QA Loop

Use a bounded progressive loop:

1. Lane review: one focused review per lane.
2. Fix: address only scoped review findings.
3. Real workflow proof: run the actual workflow and inspect artifacts.
4. Adversarial review: check for leakage, cross-child mutation, authority drift, and docs drift.
5. Fix: address only confirmed defects.
6. Full gates: formatter, lint, typecheck, build, extension build, version check, tests, coverage, generated surface checks.
7. PR review: verify final diff, evidence paths, docs, and commits.

Required test families:

- `tests/extension-annotation-payload.test.ts`
- `tests/extension-background.test.ts`
- `tests/extension-canvas-*.test.ts`
- `tests/canvas-manager*.test.ts`
- `tests/canvas-code-sync-manager.test.ts`
- `tests/inspiredesign-*`
- `tests/media-analysis-dependency-guidance.test.ts`
- `tests/public-surface-manifest.test.ts`
- `tests/workflow-surface-map.test.ts`
- Command inventory tests

Required real workflow evidence:

- Annotation byte reduction and task parity proof.
- Annotation direct, relay, stored-only, and MV3 restart proof.
- DOM and canvas annotation identity and placement proof.
- Annotation selector bundle candidate proof for backend node id, frame id, test id, ARIA, CSS, shadow-chain, XPath, and text fallback, including CDP and extension-only transport availability.
- Four-child and eight-child canvas lifecycle proof.
- Code-sync duplicate binding, repo path, document id, lease, and conflict proof.
- Extension 4x2 reload proof.
- Canvas workspace performance proof with operation latency, preview fanout, and degradation budget results.
- Canvas workspace memory proof with sampled process telemetry before open, steady state, after degradation, and after close.
- Relay stability proof for annotation delivery and canvas workspace updates across reconnect and MV3 restart.
- Inspired Design strict harvest proof with unique daemon config, cache, ports, and tokens.
- Direct artifact inspection for `evidence.json`, `ranked-references.json`, `pin-media-index.json`, `motion-evidence.json`, `media-analysis.json`, and `bundle-manifest.json`.

## Commit Strategy

Use atomic Conventional Commits, each with `Co-authored-by: Codex <noreply@openai.com>` exactly once.

Recommended order:

1. `feat: add annotation v2 compact payload contract`
2. `feat: add annotation identity and placement helpers`
3. `feat: add canvas workspace orchestration`
4. `feat: add extension canvas workspace shell`
5. `test: add inspiredesign strict proof gates`
6. `docs: sync canvas annotation inspiredesign surfaces`
7. `chore: verify canvas annotation inspiredesign upgrade`

Do not mix unrelated changes. Keep tests with implementation unless a separate proof commit is clearer. Before every commit, inspect `git status`, inspect staged diff, and verify the relevant quality gates.

## Success Criteria

- Annotation V2 compact payload is default for agent handoff and proves byte reduction plus task parity.
- Redaction is shared and runs before copy, send, persistence, AgentInbox, and system injection.
- Rich annotation payload remains available only through explicit bounded retrieval.
- Identity uses the ordered hierarchy and excludes framework internals from default compact payloads.
- Placement is pure, anchor-first, collision-aware, and covered by tests.
- Canvas workspace orchestrates child sessions without redesigning single-session document semantics.
- Workspace manifests are refs-only.
- Duplicate lease, document, repo path, and code-sync binding collisions are blocked.
- Four-child and eight-child workspace workflows pass with preview budget degradation, performance, and memory evidence.
- Extension 4x2 shell is isolated by `workspaceId` and `childId`, reload proof passes, and relay reconnect plus MV3 restart proof shows no duplicate delivery, lost acknowledged updates, or cross-child mixing.
- Inspired Design keeps artifact authority boundaries unchanged.
- Diagnostic-only Inspired Design bundles fail acceptance.
- Docs, skills, public surface source, generated manifests, and command inventory are synced.
- Formatter, linter, type checker, build, extension build, version check, full tests, and coverage pass with zero errors and zero warnings.
