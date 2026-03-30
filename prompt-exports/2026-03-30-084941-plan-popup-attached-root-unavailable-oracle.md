<user_instructions>
<taskname="Popup attach probe"/>
<task>Investigate the lingering extension-mode popup attach/adoption failure where popup targets remain pending with `Popup target has not finished attaching yet (stage: attached_root_unavailable)`, and prepare an Oracle-ready diagnosis/plan prompt focused on why attached-root recovery remains unavailable after raw popup attach fallback paths.</task>

<architecture>
- `extension/src/services/CDPRouter.ts` owns root/child debugger attachment, root-session reattach, and child attach diagnostics (`raw_attach_*`, `attached_root_*`).
- `extension/src/services/TargetSessionMap.ts` owns root/child session registration and alias lookup (`rootTargetAliases`, `attachTargetId`, `attachedRootSessionId`).
- `extension/src/ops/ops-runtime.ts` owns popup adoption + bridge flow (`preparePopupTarget`, `attachTargetViaOpenerSession`) and surfaces retryable errors with staged diagnostics (`ops.popup_attach_stage`).
- `extension/src/ops/ops-session-store.ts` + `target-session-coordinator.ts` own Ops session target records (including `openerTargetId`) and synthetic popup target state.
- Tests in `tests/extension-cdp-router.test.ts` and `tests/extension-ops-runtime.test.ts` already encode most attached-root-unavailable and popup-bridge scenarios; use these as nearest assertion seams.
- `docs/POPUP_ATTACH_PROBE_INVESTIGATION.md` and rollout evidence summarize intended scope and non-goals.
</architecture>

<selected_context>
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/CDPRouter.ts: `attachChildTarget()`, `ensureAttachedRootSessionWithDiagnostic()`, `registerRootTab()`, `reattachRootAndAttachChildTarget()`, `syncLiveRootTargetId()`, detach/event routing, and child/root diagnostic recording.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/TargetSessionMap.ts: root/child registration, attached-root session bookkeeping, attach-target retention, alias mapping, removal/reset behavior.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-runtime.ts: popup adoption + bridge path (`handleCreatedTab`, opener hydration, `preparePopupTarget`, `attachTargetViaOpenerSession`), stage retry policy, diagnostic surfacing in `sendPopupAttachPendingError`.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-session-store.ts: synthetic popup target persistence (`sessionId`, `openerTargetId`, `attachedAt`) used by bridge/reuse paths.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/target-session-coordinator.ts: target/session identity model (`tab-*` target ids, opener metadata persistence).
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/cdp-router-commands.ts: root/session command handling context and session routing assumptions.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-cdp-router.test.ts (slices): attached_root_unavailable regressions and root restore/reattach expectations around popup attach fallthrough.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-ops-runtime.test.ts (slices): popup adoption/bridge harness + stage-aware retry/error surfacing cases.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-target-session-map.test.ts: current minimal root waiter coverage.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-chrome-mock.ts: debugger/tab event simulation behavior that shapes tests.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/POPUP_ATTACH_PROBE_INVESTIGATION.md: explicit popup-only scope and non-goals.
/Users/bishopdotun/.codex/memories/rollout_summaries/2026-03-28T17-52-24-SX2q-opendevbrowser_popup_attach_instrumentation.md: prior live evidence, including first clean post-reload session `fe38f132-1d6b-42c4-9ed5-8f322701426e` failing at `attached_root_unavailable`.
</selected_context>

<relationships>
- `OpsRuntime.preparePopupTarget()` -> `attachTargetViaOpenerSession()` -> `CDPRouter.attachChildTarget(openerTabId, popupTargetId)`.
- `CDPRouter.attachChildTarget()` raw path: `attachChildTargetWithDebuggee()` then `attachChildTargetWithRootTargetId()`.
- Raw-path fallthrough -> `ensureAttachedRootSessionWithDiagnostic(tabId)`; if null, rerun `registerRootTab(tabId)` then re-check; if still null, try `reattachRootAndAttachChildTarget()`; final failure records `stage: attached_root_unavailable`.
- `ensureAttachedRootSessionWithDiagnostic()` depends on `TargetSessionMap.getByTabId(tabId)` + `attachTargetId`/retained/live target id + successful `Target.attachToTarget` to produce `attachedRootSessionId`.
- `handleEvent(Target.attachedToTarget)` updates map via `registerAttachedRootSession` when `isAttachedRootTarget(...)` is true; detach/removal paths can clear tab/session state via `removeBySessionId/removeByTabId`.
- `OpsRuntime.sendPopupAttachPendingError()` emits user-facing failure text and structured diagnostic details from `popupAttachDiagnostics`.
</relationships>

<evidence>
- Confirmed clean post-reload live failure stage: `attached_root_unavailable` (session `fe38f132-1d6b-42c4-9ed5-8f322701426e`) for both `targets.use` and popup `review`.
- Router tests already model this class: attached-root recovery can fail with `attachedRootRecoveryStage` (`attach_failed` or `attach_null`) despite retry paths.
- Runtime tests already assert stage propagation to user errors and retry logic for transient stages.
</evidence>

<open_questions>
1. In failing live runs, which `ensureAttachedRootSessionWithDiagnostic()` branch is actually reached (`record_missing`, `session_missing`, `attach_null`, `attach_failed`) after the post-fallthrough `registerRootTab(tabId)` call?
2. Does `registerRootTab(tabId)` always persist a usable `attachTargetId` for the opener tab before attached-root recovery re-attempt, or can detach/event timing clear it first?
3. Can `handleEvent(Target.detachedFromTarget)` / `detachTabState()` race with popup recovery and remove the just-created/expected attached-root record before reuse?
4. Is `isAttachedRootTarget(...)` too permissive or too strict in a way that misclassifies attached-root sessions as child sessions (or vice versa), preventing stable `attachedRootSessionId` reuse?
</open_questions>

<smallest_next_trace_seam>
Add trace-first assertions in the owning seam before behavioral changes:
- In `CDPRouter.attachChildTarget()` around each fallback boundary, emit one structured diagnostic breadcrumb for: root record presence, attachTargetId source (`record` vs retained vs live debugger), and whether `registerRootTab` changed those values.
- In `ensureAttachedRootSessionWithDiagnostic()`, log the exact branch outcome and whether `sessions.registerAttachedRootSession(...)` was called.
- In tests, extend the closest existing cases (`extension-cdp-router.test.ts` attached_root_unavailable cases + `extension-ops-runtime.test.ts` stage surfacing cases) to assert this branch-level provenance rather than only final stage.
</smallest_next_trace_seam>

<constraints>
- Keep scope strictly popup attach/adoption in extension mode.
- Non-goals: provider fallback, `/ops` vs `/cdp` cleanup, transport replacement, shopping reruns.
- Keep solution seam-local to `CDPRouter.ts`, `ops-runtime.ts`, `TargetSessionMap.ts`, and closest tests.
</constraints>
</user_instructions>
<file_map>
/Users/bishopdotun/.codex/memories
├── rollout_summaries
│   └── 2026-03-28T17-52-24-SX2q-opendevbrowser_popup_attach_instrumentation.md *
└── skills
    ├── branch-coverage-gate-recovery
    └── multi-agent-docs-parity-audit

/Users/bishopdotun/Documents/DevProjects/opendevbrowser
├── docs
│   └── POPUP_ATTACH_PROBE_INVESTIGATION.md *
├── extension
│   ├── src
│   │   ├── ops
│   │   │   ├── ops-runtime.ts * +
│   │   │   ├── ops-session-store.ts * +
│   │   │   └── target-session-coordinator.ts * +
│   │   ├── services
│   │   │   ├── CDPRouter.ts * +
│   │   │   ├── TargetSessionMap.ts *
│   │   │   └── cdp-router-commands.ts * +
│   │   └── canvas
│   ├── icons
│   └── store-assets
├── tests
│   ├── fixtures
│   │   ├── anti-bot
│   │   ├── canvas
│   │   │   ├── adapter-plugins
│   │   │   │   └── validation-fixture
│   │   │   │       └── fixtures
│   │   │   └── frameworks
│   │   ├── canvas 2
│   │   │   └── adapter-plugins
│   │   └── figma
│   ├── extension-cdp-router.test.ts * +
│   ├── extension-chrome-mock.ts * +
│   ├── extension-ops-runtime.test.ts * +
│   └── extension-target-session-map.test.ts * +
├── .github
│   └── workflows
├── .opendevbrowser
│   └── canvas
├── .pi
│   └── todos
├── assets
│   ├── extension-icons
│   └── readme-image-candidates
│       └── 2026-02-08
├── prompt-exports
├── scripts
│   └── native
├── skills
│   ├── opendevbrowser-best-practices
│   │   ├── artifacts
│   │   ├── assets
│   │   │   └── templates
│   │   └── scripts
│   ├── opendevbrowser-continuity-ledger
│   ├── opendevbrowser-data-extraction
│   │   ├── artifacts
│   │   ├── assets
│   │   │   └── templates
│   │   ├── examples
│   │   └── scripts
│   ├── opendevbrowser-design-agent
│   │   ├── artifacts
│   │   ├── assets
│   │   │   └── templates
│   │   └── scripts
│   ├── opendevbrowser-form-testing
│   │   ├── artifacts
│   │   ├── assets
│   │   │   └── templates
│   │   ├── examples
│   │   └── scripts
│   ├── opendevbrowser-login-automation
│   │   ├── artifacts
│   │   ├── assets
│   │   │   └── templates
│   │   ├── examples
│   │   └── scripts
│   ├── opendevbrowser-product-presentation-asset
│   │   ├── artifacts
│   │   ├── assets
│   │   │   └── templates
│   │   ├── examples
│   │   └── scripts
│   ├── opendevbrowser-research
│   │   ├── artifacts
│   │   ├── assets
│   │   │   └── templates
│   │   ├── examples
│   │   └── scripts
│   ├── opendevbrowser-shopping
│   │   ├── artifacts
│   │   ├── assets
│   │   │   └── templates
│   │   ├── examples
│   │   └── scripts
│   ├── research
│   └── shopping
├── src
│   ├── annotate
│   ├── browser
│   │   └── fingerprint
│   ├── cache
│   ├── canvas
│   │   ├── adapter-plugins
│   │   ├── code-sync
│   │   ├── framework-adapters
│   │   ├── kits
│   │   ├── library-adapters
│   │   │   └── react
│   │   └── starters
│   ├── challenges
│   ├── cli
│   │   ├── commands
│   │   │   ├── devtools
│   │   │   ├── dom
│   │   │   ├── export
│   │   │   ├── interact
│   │   │   ├── nav
│   │   │   ├── pages
│   │   │   ├── session
│   │   │   └── targets
│   │   ├── installers
│   │   ├── templates
│   │   └── utils
│   ├── core
│   ├── devtools
│   ├── export
│   ├── integrations
│   │   └── figma
│   ├── macros
│   │   └── packs
│   ├── providers
│   │   ├── community
│   │   ├── safety
│   │   ├── shared
│   │   ├── shopping
│   │   ├── social
│   │   └── web
│   ├── relay
│   ├── skills
│   ├── snapshot
│   ├── tools
│   └── utils
└── templates
    └── website-deploy
        ├── .github
        │   └── workflows
        ├── docs
        └── scripts


(* denotes selected files)
(+ denotes code-map available)
Config: directory-only view; selected files shown.

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/relay/protocol.ts
Imports:
---

Type-aliases:
  - RelayCommand
  - RelayEvent
  - RelayCdpControl
  - RelayResponse
  - RelayHandshake
  - RelayHandshakeAck
  - RelayHttpStatus
  - RelayHttpConfig
  - RelayHttpPair
  - RelayHandshakeError
  - OpsPointerCommand
  - ParallelismModeCapsPolicy
  - ParallelismGovernorPolicyPayload
  - OpsErrorCode
  - OpsError
  - OpsHello
  - OpsHelloAck
  - OpsPing
  - OpsPong
  - OpsRequest
  - OpsResponse
  - OpsErrorResponse
  - OpsEventType
  - OpsEvent
  - OpsChunk
  - OpsEnvelope
  - CanvasErrorCode
  - CanvasError
  - CanvasHello
  - CanvasHelloAck
  - CanvasPing
  - CanvasPong
  - CanvasRequest
  - CanvasResponse
  - CanvasErrorResponse
  - CanvasEventType
  - CanvasEvent
  - CanvasChunk
  - CanvasEnvelope
  - RelayHealthReason
  - RelayHealthStatus
  - RelayPing
  - RelayPong
  - RelayHealthCheck
  - RelayHealthResponse
  - AnnotationScreenshotMode
  - AnnotationTransport
  - AnnotationDispatchSource
  - AgentInboxDeliveryState
  - AgentInboxReceipt
  - AnnotationCommand
  - AnnotationErrorCode
  - AnnotationRect
  - AnnotationStyle
  - AnnotationA11y
  - AnnotationDebug
  - AnnotationItem
  - AnnotationScreenshot
  - AnnotationPayload
  - AnnotationResponse
  - AnnotationEvent
  - RelayAnnotationCommand
  - RelayAnnotationResponse
  - RelayAnnotationEvent

Global vars:
  - OPS_PROTOCOL_VERSION
  - MAX_OPS_PAYLOAD_BYTES
  - MAX_SNAPSHOT_BYTES
  - CANVAS_PROTOCOL_VERSION
  - MAX_CANVAS_PAYLOAD_BYTES

Exports:
  - export type RelayCommand = {
  - export type RelayEvent = {
  - export type RelayCdpControl = {
  - export type RelayResponse = {
  - export type RelayHandshake = {
  - export type RelayHandshakeAck = {
  - export type RelayHttpStatus = {
  - export type RelayHttpConfig = {
  - export type RelayHttpPair = {
  - export type RelayHandshakeError = {
  - export const OPS_PROTOCOL_VERSION = "1";
  - export const MAX_OPS_PAYLOAD_BYTES = 12 * 1024 * 1024;
  - export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
  - export type OpsPointerCommand = "pointer.move" | "pointer.down" | "pointer.up" | "pointer.drag";
  - export type ParallelismModeCapsPolicy = {
  - export type ParallelismGovernorPolicyPayload = {
  - export type OpsErrorCode =
  - export type OpsError = {
  - export type OpsHello = {
  - export type OpsHelloAck = {
  - export type OpsPing = {
  - export type OpsPong = {
  - export type OpsRequest = {
  - export type OpsResponse = {
  - export type OpsErrorResponse = {
  - export type OpsEventType =
  - export type OpsEvent = {
  - export type OpsChunk = {
  - export type OpsEnvelope =
  - export const CANVAS_PROTOCOL_VERSION = "1";
  - export const MAX_CANVAS_PAYLOAD_BYTES = 12 * 1024 * 1024;
  - export type CanvasErrorCode =
  - export type CanvasError = {
  - export type CanvasHello = {
  - export type CanvasHelloAck = {
  - export type CanvasPing = {
  - export type CanvasPong = {
  - export type CanvasRequest = {
  - export type CanvasResponse = {
  - export type CanvasErrorResponse = {
  - export type CanvasEventType =
  - export type CanvasEvent = {
  - export type CanvasChunk = {
  - export type CanvasEnvelope =
  - export type RelayHealthReason =
  - export type RelayHealthStatus = {
  - export type RelayPing = {
  - export type RelayPong = {
  - export type RelayHealthCheck = {
  - export type RelayHealthResponse = {
  - export type AnnotationScreenshotMode = "visible" | "full" | "none";
  - export type AnnotationTransport = "auto" | "direct" | "relay";
  - export type AnnotationDispatchSource =
  - export type AgentInboxDeliveryState = "queued" | "delivered" | "stored_only" | "consumed";
  - export type AgentInboxReceipt = {
  - export type AnnotationCommand = {
  - export type AnnotationErrorCode =
  - export type AnnotationRect = {
  - export type AnnotationStyle = {
  - export type AnnotationA11y = {
  - export type AnnotationDebug = {
  - export type AnnotationItem = {
  - export type AnnotationScreenshot = {
  - export type AnnotationPayload = {
  - export type AnnotationResponse = {
  - export type AnnotationEvent = {
  - export type RelayAnnotationCommand = {
  - export type RelayAnnotationResponse = {
  - export type RelayAnnotationEvent = {
---


File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/export/dom-capture.ts
Imports:
  - import type { Page } from "playwright-core";
  - import { STYLE_ALLOWLIST, SKIP_STYLE_VALUES } from "./css-extract";
---

Type-aliases:
  - DomCapture
  - CaptureOptions

Functions:
  - L19: export async function captureDom( page: Page, selector: string, options: CaptureOptions = {} ): Promise<DomCapture>

Global vars:
  - DEFAULT_MAX_NODES

Exports:
  - export type DomCapture = {
  - export async function captureDom(
---


File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/tools/cookie_import.ts
Imports:
  - import { tool } from "@opencode-ai/plugin";
  - import type { ToolDefinition } from "@opencode-ai/plugin";
  - import { createRequestId } from "../core/logging";
  - import type { ToolDeps } from "./deps";
  - import { failure, ok, serializeError } from "./response";
---

Type-aliases:
  - CookieRecord
  - CookieImportCapableManager
  - CookieValidationResult

Functions:
  - L36: function validateCookieRecord(cookie: CookieRecord): CookieValidationResult
  - L125: export function createCookieImportTool(deps: ToolDeps): ToolDefinition

Global vars:
  - z
  - __test__

Exports:
  - export function createCookieImportTool(deps: ToolDeps): ToolDefinition {
  - export const __test__ = {
---


File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/canvas/model.ts
Imports:
---

Type-aliases:
  - CanvasPreviewState
  - CanvasAttachedClientRole
  - CanvasCodeSyncState
  - CanvasCodeSyncDriftState
  - CanvasCodeSyncWatchState
  - CanvasCodeSyncProjectionMode
  - CanvasCodeSyncFallbackReason
  - CanvasRect
  - CanvasNode
  - CanvasBinding
  - CanvasAsset
  - CanvasComponentRef
  - CanvasComponentInventoryItem
  - CanvasTokenAlias
  - CanvasTokenBinding
  - CanvasTokenMode
  - CanvasTokenItem
  - CanvasTokenCollection
  - CanvasTokenStore
  - CanvasAdapterErrorEnvelope
  - CanvasCapabilityGrant
  - CanvasDocumentMeta
  - CanvasPage
  - CanvasDocument
  - CanvasFeedbackItem
  - CanvasFeedbackEvent
  - CanvasRuntimeParityArtifact
  - CanvasTargetStateSummary
  - CanvasOverlayMountSummary
  - CanvasEditorViewport
  - CanvasEditorSelection
  - CanvasAttachedClientSummary
  - CanvasCodeSyncBindingStatusSummary
  - CanvasHistoryDirection
  - CanvasHistoryState
  - CanvasSessionSummary
  - CanvasPageState
  - CanvasPageMessage
  - CanvasPageElementAction
  - CanvasPagePortMessage
  - CanvasProjectionSummary
  - CanvasSelectedBindingIdentity

Functions:
  - L457: export function normalizeCanvasSessionSummary(value: unknown): CanvasSessionSummary
  - L505: export function normalizeCanvasTargetStateSummaries(value: unknown): CanvasTargetStateSummary[]
  - L534: export function summarizeCanvasProjectionState( summary: CanvasSessionSummary, targets: CanvasTargetStateSummary[] ): CanvasProjectionSummary
  - L556: export function summarizeCanvasHistoryState(summary: CanvasSessionSummary): string
  - L568: export function readLatestImportProvenance( summary: CanvasSessionSummary, document: CanvasDocument ): string | null
  - L584: export function readSelectedBindingIdentity( document: CanvasDocument, nodeId: string | null ): CanvasSelectedBindingIdentity
  - L620: function normalizeAttachedClient(value: unknown): CanvasAttachedClientSummary[]
  - L640: function normalizeCodeSyncBindingStatus(value: unknown): CanvasCodeSyncBindingStatusSummary[]
  - L672: function normalizeCapabilityGrant(value: unknown): CanvasCapabilityGrant[]
  - L688: function normalizePluginError(value: unknown): CanvasAdapterErrorEnvelope[]
  - L705: function normalizeHistoryState(value: unknown): CanvasHistoryState | undefined
  - L719: function normalizeParityArtifact(value: unknown): CanvasRuntimeParityArtifact | null
  - L742: function normalizePreviewState(value: unknown): CanvasPreviewState | null
  - L748: function normalizeRenderStatus(value: unknown): CanvasTargetStateSummary["renderStatus"] | null
  - L754: function isCodeSyncState(value: unknown): value is CanvasCodeSyncState
  - L758: function isCodeSyncDriftState(value: unknown): value is CanvasCodeSyncDriftState
  - L762: function isCodeSyncWatchState(value: unknown): value is CanvasCodeSyncWatchState
  - L766: function isCodeSyncProjectionMode(value: unknown): value is CanvasCodeSyncProjectionMode
  - L770: function isCodeSyncFallbackReason(value: unknown): value is CanvasCodeSyncFallbackReason
  - L774: function readStringArray(value: unknown): string[]
  - L780: function uniqueStrings<T extends string>(values: T[]): T[]
  - L784: function optionalString(value: unknown): string | null
  - L788: function optionalNumber(value: unknown): number | null
  - L792: function findNodeById(document: CanvasDocument, nodeId: string): CanvasNode | null
  - L802: function isRecord(value: unknown): value is Record<string, unknown>

Global vars:
  - CODE_SYNC_STATES
  - CODE_SYNC_DRIFT_STATES
  - CODE_SYNC_WATCH_STATES
  - CODE_SYNC_PROJECTIONS
  - CODE_SYNC_FALLBACK_REASONS
  - ATTACHED_CLIENT_ROLES

Exports:
  - export type CanvasPreviewState = "focused" | "pinned" | "background" | "degraded";
  - export type CanvasAttachedClientRole = "lease_holder" | "observer";
  - export type CanvasCodeSyncState =
  - export type CanvasCodeSyncDriftState = "clean" | "source_changed" | "document_changed" | "conflict";
  - export type CanvasCodeSyncWatchState = "idle" | "watching" | "stopped";
  - export type CanvasCodeSyncProjectionMode = "canvas_html" | "bound_app_runtime";
  - export type CanvasCodeSyncFallbackReason =
  - export type CanvasRect = {
  - export type CanvasNode = {
  - export type CanvasBinding = {
  - export type CanvasAsset = {
  - export type CanvasComponentRef = {
  - export type CanvasComponentInventoryItem = {
  - export type CanvasTokenAlias = {
  - export type CanvasTokenBinding = {
  - export type CanvasTokenMode = {
  - export type CanvasTokenItem = {
  - export type CanvasTokenCollection = {
  - export type CanvasTokenStore = {
  - export type CanvasAdapterErrorEnvelope = {
  - export type CanvasCapabilityGrant = {
  - export type CanvasDocumentMeta = {
  - export type CanvasPage = {
  - export type CanvasDocument = {
  - export type CanvasFeedbackItem = {
  - export type CanvasFeedbackEvent =
  - export type CanvasRuntimeParityArtifact = {
  - export type CanvasTargetStateSummary = {
  - export type CanvasOverlayMountSummary = {
  - export type CanvasEditorViewport = {
  - export type CanvasEditorSelection = {
  - export type CanvasAttachedClientSummary = {
  - export type CanvasCodeSyncBindingStatusSummary = {
  - export type CanvasHistoryDirection = "undo" | "redo";
  - export type CanvasHistoryState = {
  - export type CanvasSessionSummary = {
  - export type CanvasPageState = {
  - export type CanvasPageMessage = {
  - export type CanvasPageElementAction =
  - export type CanvasPagePortMessage =
  - export type CanvasProjectionSummary = {
  - export type CanvasSelectedBindingIdentity = {
  - export function normalizeCanvasSessionSummary(value: unknown): CanvasSessionSummary {
  - export function normalizeCanvasTargetStateSummaries(value: unknown): CanvasTargetStateSummary[] {
  - export function summarizeCanvasProjectionState(
  - export function summarizeCanvasHistoryState(summary: CanvasSessionSummary): string {
  - export function readLatestImportProvenance(
  - export function readSelectedBindingIdentity(
---


File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/parallelism-governor.ts
Imports:
---

Type-aliases:
  - OpsParallelModeVariant
  - OpsParallelismGovernorPolicy
  - OpsParallelPressureClass
  - OpsParallelPressureInput
  - OpsParallelismGovernorState
  - OpsParallelismGovernorSnapshot

Functions:
  - L85: const clamp = (value: number, floor: number, ceil: number): number =>
  - L91: const floorPercent = (value: number): number =>
  - L93: const classifyPressure = ( policy: OpsParallelismGovernorPolicy, input: OpsParallelPressureInput ): OpsParallelPressureClass =>
  - L120: const pressurePenalty = (pressure: OpsParallelPressureClass): number =>
  - L133: export const resolveOpsStaticCap = ( policy: OpsParallelismGovernorPolicy, modeVariant: OpsParallelModeVariant ): number =>
  - L141: export const createOpsGovernorState = ( policy: OpsParallelismGovernorPolicy, modeVariant: OpsParallelModeVariant ): OpsParallelismGovernorState =>
  - L156: export const evaluateOpsGovernor = ( policy: OpsParallelismGovernorPolicy, current: OpsParallelismGovernorState, input: OpsParallelPressureInput, sampledAt = Date.now() ): OpsParallelismGovernorSnapshot =>

Global vars:
  - DEFAULT_OPS_PARALLELISM_POLICY: OpsParallelismGovernorPolicy

Exports:
  - export type OpsParallelModeVariant =
  - export type OpsParallelismGovernorPolicy = {
  - export const DEFAULT_OPS_PARALLELISM_POLICY: OpsParallelismGovernorPolicy = {
  - export type OpsParallelPressureClass = "healthy" | "medium" | "high" | "critical";
  - export type OpsParallelPressureInput = {
  - export type OpsParallelismGovernorState = {
  - export type OpsParallelismGovernorSnapshot = {
  - export const resolveOpsStaticCap = (
  - export const createOpsGovernorState = (
  - export const evaluateOpsGovernor = (
---


File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/browser-manager.ts
Imports:
  - import { randomUUID } from "crypto";
  - import { mkdir, rm, writeFile } from "fs/promises";
  - import { join } from "path";
  - import { freemem, totalmem } from "os";
  - import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";
  - import { Mutex } from "async-mutex";
  - import type { OpenDevBrowserConfig } from "../config";
  - import { resolveCachePaths } from "../cache/paths";
  - import { findChromeExecutable } from "../cache/chrome-locator";
  - import { downloadChromeForTesting } from "../cache/downloader";
  - import { createLogger, createRequestId } from "../core/logging";
  - import { ConsoleTracker } from "../devtools/console-tracker";
  - import { ExceptionTracker } from "../devtools/exception-tracker";
  - import { NetworkTracker } from "../devtools/network-tracker";
  - import { captureDom } from "../export/dom-capture";
  - import { extractCss } from "../export/css-extract";
  - import { emitReactComponent, type ReactExport } from "../export/react-emitter";
  - import { RefStore } from "../snapshot/refs";
  - import { Snapshotter } from "../snapshot/snapshotter";
  - import { resolveRelayEndpoint, sanitizeWsEndpoint } from "../relay/relay-endpoints";
  - import type { RelayStatus } from "../relay/relay-server";
  - import { ensureLocalEndpoint } from "../utils/endpoint-validation";
  - import { buildBlockerArtifacts, classifyBlockerSignal } from "../providers/blocker";
  - import { ChallengeOrchestrator, resolveChallengeAutomationPolicy, type ChallengeAutomationMode } from "../challenges";
  - import type {
  BlockerSignalV1,
  ChallengeOwnerSurface,
  ResumeMode,
  SessionChallengeSummary,
  SuspendedIntentSummary
} from "../providers/types";
  - import type { BrowserResponseMeta, ChallengeRuntimeHandle } from "./manager-types";
  - import {
  evaluateTier1Coherence,
  formatTier1Warnings,
  type Tier1CoherenceResult
} from "./fingerprint/tier1-coherence";
  - import {
  applyTier2NetworkEvent,
  createTier2RuntimeState,
  type Tier2RuntimeState
} from "./fingerprint/tier2-runtime";
  - import {
  createTier3RuntimeState,
  evaluateTier3Adaptive,
  type Tier3RuntimeState
} from "./fingerprint/tier3-adaptive";
  - import { SessionStore, type BrowserMode } from "./session-store";
  - import { TargetManager, type TargetInfo } from "./target-manager";
  - import {
  createGovernorState,
  evaluateGovernor,
  rssUsagePercent,
  type ParallelModeVariant,
  type ParallelismGovernorSnapshot,
  type ParallelismGovernorState
} from "./parallelism-governor";
  - import {
  applyRuntimePreviewBridge as runRuntimePreviewBridge,
  type RuntimePreviewBridgeInput,
  type RuntimePreviewBridgeResult
} from "./canvas-runtime-preview-bridge";
  - import { loadChromium } from "./playwright-runtime";
  - import { loadSystemChromeCookies } from "./system-chrome-cookies";
  - import { GlobalChallengeCoordinator } from "./global-challenge-coordinator";
---
Classes:
  - BrowserManager
    Methods:
      - L389: constructor(worktree: string, config: OpenDevBrowserConfig)
      - L394: setChallengeOrchestrator(orchestrator?: ChallengeOrchestrator): void
      - L398: getSessionChallengeAutomationMode(sessionId: string): ChallengeAutomationMode | undefined
      - L402: setSessionChallengeAutomationMode(sessionId: string, mode?: ChallengeAutomationMode): void
      - L410: createChallengeRuntimeHandle(): ChallengeRuntimeHandle
      - L462: private async withChallengeAutomationSuppressed<T>(sessionId: string, action: () => Promise<T>): Promise<T>
      - L477: private isChallengeAutomationSuppressed(sessionId: string): boolean
      - L481: private getParallelState(sessionId: string): SessionParallelState
      - L508: updateConfig(config: OpenDevBrowserConfig): void
      - L544: async launch(options: LaunchOptions): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }>
      - L687: async connect(options: ConnectOptions): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }>
      - L697: async connectRelay(
      - L711: async closeAll(): Promise<void>
      - L716: async disconnect(sessionId: string, closeBrowser = false): Promise<void>
      - L806: async status(sessionId: string): Promise<{
      - L841: async withPage<T>(
      - L906: async applyRuntimePreviewBridge(
      - L921: async listTargets(sessionId: string, includeUrls = false): Promise<{ activeTargetId: string | null; targets: TargetInfo[] }>
      - L946: async page(sessionId: string, name: string, url?: string): Promise<{ targetId: string; created: boolean; url?: string; title?: string }>
      - L1006: async listPages(sessionId: string): Promise<{ pages: Array<{ name: string; targetId: string; url?: string; title?: string }> }>
      - L1023: async closePage(sessionId: string, name: string): Promise<void>
      - L1044: async useTarget(sessionId: string, targetId: string): Promise<{ activeTargetId: string; url?: string; title?: string }>
      - L1061: async newTarget(sessionId: string, url?: string): Promise<{ targetId: string }>
      - L1153: async closeTarget(sessionId: string, targetId: string): Promise<void>
      - L1169: async goto(
      - L1374: async waitForLoad(
      - L1405: async waitForRef(
      - L1437: async snapshot(
      - L1454: async click(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number; navigated: boolean }>
      - L1468: async hover(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number }>
      - L1477: async press(sessionId: string, key: string, ref?: string, targetId?: string | null): Promise<{ timingMs: number }>
      - L1489: async check(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number }>
      - L1498: async uncheck(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number }>
      - L1507: async type(
      - L1528: async select(sessionId: string, ref: string, values: string[], targetId?: string | null): Promise<void>
      - L1540: async scroll(sessionId: string, dy: number, ref?: string, targetId?: string | null): Promise<void>
      - L1550: async pointerMove(
      - L1564: async pointerDown(
      - L1580: async pointerUp(
      - L1596: async drag(
      - L1613: async resolveRefPoint(
      - L1623: async scrollIntoView(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number }>
      - L1631: async domGetHtml(
      - L1649: async domGetText(
      - L1667: async domGetAttr(
      - L1695: async domGetValue(sessionId: string, ref: string, targetId?: string | null): Promise<{ value: string }>
      - L1718: async domIsVisible(sessionId: string, ref: string, targetId?: string | null): Promise<{ value: boolean }>
      - L1741: async domIsEnabled(sessionId: string, ref: string, targetId?: string | null): Promise<{ value: boolean }>
      - L1764: async domIsChecked(sessionId: string, ref: string, targetId?: string | null): Promise<{ value: boolean }>
      - L1787: async clonePage(sessionId: string, targetId?: string | null): Promise<ReactExport>
      - L1801: async cloneComponent(sessionId: string, ref: string, targetId?: string | null): Promise<ReactExport>
      - L1816: async perfMetrics(sessionId: string, targetId?: string | null): Promise<{ metrics: Array<{ name: string; value: number }> }>
      - L1838: async screenshot(
      - L1873: private async withLegacyExtensionOperationTimeout<T>(
      - L1890: async consolePoll(
      - L1899: async exceptionPoll(
      - L1908: async networkPoll(
      - L1917: async debugTraceSnapshot(
      - L2024: async cookieImport(
      - L2067: async cookieList(
      - L2105: private async bootstrapSystemChromeCookies(
      - L2163: private async resolveSystemChromeBootstrapExecutable(): Promise<{ executablePath: string | null; warnings: string[] }>
      - L2182: private initializeFingerprintState(
      - L2255: private applyFingerprintSignals(
      - L2434: private attachContinuousFingerprintSignals(managed: ManagedSession): void
      - L2459: private isContinuousSignalsEnabled(config: { enabled: boolean }): boolean
      - L2467: private resolveCanaryTargetClass(url: string, status?: number): string
      - L2482: private buildCanaryScoreWindow(
      - L2519: private buildFingerprintSummary(managed: ManagedSession):
      - L2585: private latestStatus(
      - L2597: private recentNetworkEvents(managed: ManagedSession): ReturnType<NetworkTracker["poll"]>["events"]
      - L2602: private extractNetworkHosts(events: Array<{ url?: string }>): string[]
      - L2620: private buildTargetKey(managed: ManagedSession, url?: string): string
      - L2633: private isEnvLimitedVerifierError(error: unknown): boolean
      - L2638: private isTimeoutVerifierError(error: unknown): boolean
      - L2643: private markVerifierFailure(sessionId: string, error: unknown): void
      - L2656: reserveExternalBlockerSlot(sessionId: string): void
      - L2660: releaseExternalBlockerSlot(sessionId: string): void
      - L2665: reconcileExternalBlockerMeta(
      - L2742: private isChallengeLifecycleBlocker(
      - L2748: private syncChallengeMeta(
      - L2801: private reconcileSessionBlocker(
      - L2891: private async maybeOrchestrateChallenge(
      - L2974: private validateCookieRecord(cookie: CookieImportRecord):
      - L3069: private normalizeCookieListUrls(urls?: string[]): string[] | undefined
      - L3103: private buildOverrideSession(input: { browser: Browser; context: BrowserContext; targets: TargetManager }): ManagedSession
      - L3125: private getManaged(sessionId: string): ManagedSession
      - L3133: private resolveModeVariant(managed: ManagedSession): ParallelModeVariant
      - L3143: private clearSessionParallelState(sessionId: string): void
      - L3164: private resolveTargetContext(
      - L3178: private refreshGovernorSnapshot(sessionId: string): ParallelismGovernorSnapshot
      - L3214: private createBackpressureError(
      - L3240: private wakeWaiters(sessionId: string): void
      - L3267: private async acquireParallelSlot(sessionId: string, targetId: string, timeoutMs: number): Promise<void>
      - L3309: private releaseParallelSlot(sessionId: string): void
      - L3318: private targetQueueKey(sessionId: string, targetId: string): string
      - L3322: private async runTargetScoped<T>(
      - L3360: private async runStructural<T>(sessionId: string, execute: () => Promise<T>): Promise<T>
      - L3365: private resolveRefEntry(managed: ManagedSession, ref: string): ResolvedManagedRef
      - L3373: private resolveRefEntryForTarget(
      - L3392: private resolveSelector(managed: ManagedSession, ref: string, targetId?: string): string
      - L3399: private buildStaleSnapshotError(ref: string): Error
      - L3403: private isSnapshotStaleError(error: unknown): boolean
      - L3419: private async withResolvedRefSession<T>(
      - L3442: private async callFunctionOnResolvedRef<T>(
      - L3461: private async evaluateDomStateByBackendNode<T>(
      - L3471: private async callFunctionOnRefContextWithSession<T>(
      - L3502: private async waitForResolvedRefState(
      - L3534: private async resolveRefPointForTarget(
      - L3586: private buildProfileLockLaunchMessage(launchMessage: string, profileDir: string): string | null
      - L3604: private async safeManagedPageTitle(
      - L3615: private async safePageTitle(page: Page | null, context: string): Promise<string | undefined>
      - L3640: private shouldSkipPageTitleProbe(
      - L3650: private safePageUrl(page: Page | null, context: string): string | undefined
      - L3660: private async recoverLegacyExtensionPage(
      - L3702: private async reconnectLegacyExtensionSession(managed: ManagedSession, timeoutMs: number): Promise<Page | null>
      - L3770: private async createExtensionPage(managed: ManagedSession, context: string): Promise<Page>
      - L3788: private async navigatePage(
      - L3818: private async resetPageForHtmlFallback(page: Page, timeoutMs: number): Promise<void>
      - L3825: private async writeHtmlDocument(managed: ManagedSession | undefined, page: Page, html: string): Promise<void>
      - L3859: private async waitForExtensionTargetReady(page: Page, context: string, timeoutMs = 5000): Promise<void>
      - L3894: private isDetachedFrameError(error: unknown): boolean
      - L3899: private isClosedTargetError(error: unknown): boolean
      - L3904: private isNavigationAbortError(error: unknown): boolean
      - L3909: private isExecutionContextDestroyedError(error: unknown): boolean
      - L3915: private isScreenshotTimeoutError(error: unknown): boolean
      - L3920: private isLegacyClosedTargetError(managed: ManagedSession, error: unknown): boolean
      - L3927: private isTargetNotAllowedError(error: unknown): boolean
      - L3932: private isExtensionTargetReadyTimeout(error: unknown): boolean
      - L3937: private isExtensionTargetReadyClosed(error: unknown): boolean
      - L3942: private describeExtensionFailure(context: string, error: unknown, managed: ManagedSession): Error
      - L3954: private decodeHtmlDataUrl(url: string): string | null
      - L3973: private selectExistingExtensionEntry(
      - L4010: private async captureScreenshotViaCdp(
      - L4035: private selectStableExtensionEntry(
      - L4082: private attachTrackers(managed: ManagedSession): void
      - L4091: private attachRefInvalidation(managed: ManagedSession): void
      - L4098: private attachRefInvalidationForPage(managed: ManagedSession, targetId: string, page: Page): void
      - L4134: private async resolveWsEndpoint(options: ConnectOptions): Promise<string>
      - L4160: private async connectWithEndpoint(
      - L4307: private async resolveRelayEndpoints(wsEndpoint: string): Promise<{ connectEndpoint: string; reportedEndpoint: string; relayPort: number }>
      - L4316: private async waitForRelayCdpSlot(wsEndpoint: string, relayPort: number, timeoutMs = 5000): Promise<void>
      - L4327: private async readRelayStatus(
      - L4366: private sanitizeWsEndpointForOutput(wsEndpoint: string): string
    Properties:
      - private store
      - private sessions
      - private sessionParallel
      - private targetQueues
      - private networkSignalSubscriptions
      - private worktree: string
      - private config: OpenDevBrowserConfig
      - private pageListeners
      - private logger
      - private readonly challengeCoordinator
      - private challengeOrchestrator?: ChallengeOrchestrator
      - private readonly challengeAutomationSuppression

Type-aliases:
  - LaunchOptions
  - ConnectOptions
  - ManagedSession
  - BackpressureErrorInfo
  - ParallelWaiter
  - SessionParallelState
  - FingerprintSignalApplyOptions
  - CookieImportRecord
  - CookieListRecord
  - ResolvedManagedRef

Functions:
  - L4371: const waitForPage = async (context: BrowserContext, timeoutMs: number): Promise<Page | null> =>
  - L4381: function truncateHtml(value: string, maxChars: number): { outerHTML: string; truncated: boolean }
  - L4388: function readFlagValue(flags: string[], key: string): string | undefined
  - L4407: function resolveTier3FallbackTarget(tier: "tier1" | "tier2"): "tier1" | "tier2"
  - L4411: function isExtensionStaleTabAttachError(detail: string): boolean
  - L4416: function isExtensionRelayDisconnectError(detail: string): boolean
  - L4422: function isExtensionRelaySingleClientError(detail: string): boolean
  - L4426: const delay = (ms: number): Promise<void> =>
  - L4428: function truncateText(value: string, maxChars: number): { text: string; truncated: boolean }

Global vars:
  - LEGACY_EXTENSION_OPERATION_TIMEOUT_MS
  - DOM_GET_ATTR_DECLARATION
  - DOM_GET_VALUE_DECLARATION
  - DOM_IS_VISIBLE_DECLARATION
  - DOM_IS_ENABLED_DECLARATION
  - DOM_IS_CHECKED_DECLARATION
  - DOM_SELECTOR_STATE_DECLARATION
  - DOM_OUTER_HTML_DECLARATION
  - DOM_INNER_TEXT_DECLARATION
  - DOM_HOVER_DECLARATION
  - DOM_FOCUS_DECLARATION
  - DOM_SET_CHECKED_DECLARATION
  - DOM_TYPE_DECLARATION
  - DOM_SELECT_DECLARATION
  - DOM_SCROLL_BY_DECLARATION
  - DOM_SCROLL_INTO_VIEW_DECLARATION
  - DOM_REF_POINT_DECLARATION

Exports:
  - export type LaunchOptions = {
  - export type ConnectOptions = {
  - export type ManagedSession = {
  - export class BrowserManager {
---


File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/browser/target-manager.ts
Imports:
  - import { randomUUID } from "crypto";
  - import type { Page } from "playwright-core";
---
Classes:
  - TargetManager
    Methods:
      - L24: registerPage(page: Page, name?: string): string
      - L36: registerExistingPages(pages: Page[]): void
      - L42: setName(targetId: string, name: string): void
      - L62: getTargetIdByName(name: string): string | null
      - L66: getName(targetId: string): string | null
      - L70: listNamedTargets(): NamedTargetInfo[]
      - L77: removeName(name: string): void
      - L86: setActiveTarget(targetId: string): void
      - L93: getActiveTargetId(): string | null
      - L97: getActivePage(): Page
      - L108: getPage(targetId: string): Page
      - L116: async listTargets(includeUrls = false): Promise<TargetInfo[]>
      - L148: async closeTarget(targetId: string): Promise<void>
      - L174: listPageEntries(): Array<{ targetId: string; page: Page }>
      - L181: syncPages(pages: Page[]): void
    Properties:
      - private targets
      - private activeTargetId: string | null
      - private nameToTarget
      - private targetToName

Type-aliases:
  - TargetInfo
  - NamedTargetInfo

Functions:
  - L214: const readWithTimeout = async <T>(reader: () => Promise<T>, timeoutMs: number = TARGET_INFO_TIMEOUT_MS): Promise<T | undefined> =>

Global vars:
  - TARGET_INFO_TIMEOUT_MS

Exports:
  - export type TargetInfo = {
  - export type NamedTargetInfo = {
  - export class TargetManager {
---


File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/TabManager.ts
Imports:
  - import { getRestrictionMessage } from "./url-restrictions.js";
---
Classes:
  - TabManager
    Methods:
      - L4: async createTab(url?: string, active: boolean = true): Promise<chrome.tabs.Tab>
      - L21: async waitForTabComplete(tabId: number, timeoutMs = 10000): Promise<void>
      - L77: async closeTab(tabId: number, timeoutMs = 2000): Promise<void>
      - L149: async activateTab(tabId: number): Promise<chrome.tabs.Tab | null>
      - L162: async getTab(tabId: number): Promise<chrome.tabs.Tab | null>
      - L170: async getActiveTab(): Promise<chrome.tabs.Tab | null>
      - L175: async getActiveTabId(): Promise<number | null>
      - L180: async getFirstAttachableTab(excludeTabId?: number): Promise<chrome.tabs.Tab | null>
      - L196: async getFirstHttpTabId(excludeTabId?: number): Promise<number | null>

Exports:
  - export class TabManager {
---

</file_map>
<file_contents>
File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-cdp-router.test.ts
(lines 1-90: Test harness setup for CDPRouter unit tests: imports, chrome mock initialization, and suite scaffolding used by popup attach cases.)
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CDPRouter } from "../extension/src/services/CDPRouter";
import { createChromeMock } from "./extension-chrome-mock";

describe("CDPRouter", () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    const { chrome } = createChromeMock();
    globalThis.chrome = chrome;
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
  });

  it("attaches and detaches from debugger", async () => {
    const router = new CDPRouter();
    await router.attach(42);
    expect(chrome.debugger.attach).toHaveBeenCalled();

    await router.detachAll();
    expect(chrome.debugger.detach).toHaveBeenCalled();
  });

  it("records root attach diagnostics when chrome.debugger.attach fails at tab attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 90,
        url: "https://example.com/root-attach",
        title: "Root Attach",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    attachMock.mockImplementation((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      mock.setRuntimeError("Not allowed");
      callback();
      mock.setRuntimeError(null);
    });

    const router = new CDPRouter();

    await expect(router.attach(90)).rejects.toThrow("Not allowed");
    expect(router.getLastRootAttachDiagnostic(90)).toEqual(expect.objectContaining({
      tabId: 90,
      origin: "root_attach",
      stage: "root_debugger_attach_failed",
      attachBy: "tabId",
      reason: "Not allowed"
    }));
  });

  it("records flat-session bootstrap diagnostics when Target.setAutoAttach fails after root attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 91,
        url: "https://example.com/flat-session-probe",
        title: "Flat Session Probe",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
        if (
          method === "Target.setAutoAttach"
          && ((debuggee as { tabId?: number }).tabId === 91 || debuggeeTargetId === "target-91")
        ) {
          mock.setRuntimeError("Not allowed");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();

    await expect(router.attach(91)).rejects.toThrow(

```

(lines 2160-2810: Popup attach regression coverage for attached_root_unavailable and related recovery paths in CDPRouter.attachChildTarget, including reattach/restore expectations and diagnostic assertions.)
```ts
      };
    };
    expect(internals.sessions.getAttachedRootSession(68)).toEqual(
      expect.objectContaining({
        debuggerSession: expect.objectContaining({
          tabId: 68,
          sessionId: expect.any(String),
          targetId: "target-68"
        })
      })
    );
  });

  it("reattaches the root tab when stale popup attach has no real attached-root session to reuse", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 69,
        url: "https://fresh.example/sixty-nine",
        title: "Sixty Nine",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 69 && !sessionId && targetId === "popup-69") {
            mock.setRuntimeError("Debugger is not attached to the tab with id: 69.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if (debuggeeTargetId === "target-69" && !sessionId && targetId === "popup-69") {
            mock.setRuntimeError("Debugger is not attached to the target with id: target-69.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if ((debuggee as { tabId?: number }).tabId === 69 && !sessionId && targetId === "target-69") {
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    await router.attach(69);
    attachMock.mockClear();
    detachMock.mockClear();

    await expect(router.attachChildTarget(69, "popup-69")).rejects.toThrow(
      "Debugger is not attached to the tab with id: 69."
    );
    expect(router.getLastChildAttachDiagnostic(69, "popup-69")).toEqual(
      expect.objectContaining({
        stage: "attached_root_unavailable",
        rootTargetRetryStage: "attach_blocked",
        attachedRootRecoveryStage: "attach_failed",
        attachedRootRecoverySource: "record",
        attachedRootRecoveryReason: "Not allowed",
        reason: "Debugger is not attached to the tab with id: 69."
      })
    );
    expect(attachMock).toHaveBeenCalledWith({ tabId: 69 }, "1.3", expect.any(Function));
    expect(detachMock).toHaveBeenCalledWith({ tabId: 69 }, expect.any(Function));
  });

  it("restores the root debuggee after a blocked popup attach still ends as attached_root_unavailable", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 82,
        url: "https://fresh.example/eighty-two",
        title: "Eighty Two",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const onResponse = vi.fn();

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if ((debuggee as { tabId?: number }).tabId === 82 && !sessionId && targetId === "popup-82") {
            mock.setRuntimeError("Debugger is not attached to the tab with id: 82.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if (debuggeeTargetId === "target-82" && !sessionId && targetId === "popup-82") {
            mock.setRuntimeError("Debugger is not attached to the target with id: target-82.");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
          if ((debuggee as { tabId?: number }).tabId === 82 && !sessionId && targetId === "target-82") {
            mock.setRuntimeError("Not allowed");
            callback(undefined);
            mock.setRuntimeError(null);
            return;
          }
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    router.setCallbacks({ onEvent: vi.fn(), onResponse, onDetach: vi.fn() });
    await router.attach(82);

    await expect(router.attachChildTarget(82, "popup-82")).rejects.toThrow(
      "Debugger is not attached to the tab with id: 82."
    );

    await router.handleCommand({
      id: 982,
      method: "forwardCDPCommand",
      params: { method: "Network.enable", params: {} }
    });

    expect(onResponse).toHaveBeenCalledWith({ id: 982, result: { ok: true } });
  });

  it("routes direct public helpers through reset preflight after client close", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
      ],
      activeTab: { id: 2, url: "https://fresh.example/two", title: "Two", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
    await router.attach(2);

    type RouterWithPrepare = CDPRouter & {
      prepareForNextClientIfNeeded: () => Promise<void>;
    };

    const routerWithPrepare = router as unknown as RouterWithPrepare;
    const originalPrepare = routerWithPrepare.prepareForNextClientIfNeeded.bind(router);
    const prepareForNextClientIfNeeded = vi.fn(async () => {
      await originalPrepare();
    });
    routerWithPrepare.prepareForNextClientIfNeeded = prepareForNextClientIfNeeded;

    const directCalls: Array<{
      label: string;
      invoke: () => Promise<unknown>;
      assertResult?: (result: unknown) => void;
    }> = [
      {
        label: "attach",
        invoke: async () => {
          await router.attach(2);
          return null;
        }
      },
      {
        label: "refreshTabAttachment",
        invoke: async () => {
          await router.refreshTabAttachment(2);
          return null;
        }
      },
      {
        label: "setDiscoverTargetsEnabled",
        invoke: async () => {
          await router.setDiscoverTargetsEnabled(true);
          return null;
        }
      },
      {
        label: "configureAutoAttach",
        invoke: async () => {
          await router.configureAutoAttach({ autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
          return null;
        }
      },
      {
        label: "resolveTabTargetId",
        invoke: async () => await router.resolveTabTargetId(2),
        assertResult: (result) => {
          expect(result).toBe("target-2");
        }
      },
      {
        label: "resolveTabOpenerTargetId",
        invoke: async () => await router.resolveTabOpenerTargetId(2),
        assertResult: (result) => {
          expect(result).toBeNull();
        }
      },
      {
        label: "attachChildTarget",
        invoke: async () => await router.attachChildTarget(2, "popup-2"),
        assertResult: (result) => {
          expect(result).toEqual(expect.any(String));
        }
      },
      {
        label: "sendCommand",
        invoke: async () => await router.sendCommand({ tabId: 2 }, "Runtime.enable", {}),
        assertResult: (result) => {
          expect(result).toEqual({ ok: true });
        }
      }
    ];

    for (const directCall of directCalls) {
      prepareForNextClientIfNeeded.mockClear();
      router.markClientClosed();

      const result = await directCall.invoke();

      expect(prepareForNextClientIfNeeded.mock.calls.length, directCall.label).toBeGreaterThan(0);
      directCall.assertResult?.(result);
      expect(router.getPrimaryTabId()).toBe(2);
      expect(router.getAttachedTabIds()).toEqual([2]);
    }
  });

  it("keeps the refreshed root attached when the old root detach arrives late", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 66,
        url: "https://example.com/refresh-race",
        title: "Refresh Race",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const onDetach = vi.fn();
    const router = new CDPRouter();
    router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach });
    await router.attach(66);

    await router.refreshTabAttachment(66);
    mock.emitDebuggerDetach({ tabId: 66 }, "target_closed");

    expect(router.isTabAttached(66)).toBe(true);
    expect(router.getAttachedTabIds()).toEqual([66]);
    expect(onDetach).not.toHaveBeenCalled();
    await expect(router.attachChildTarget(66, "popup-66")).resolves.toEqual(expect.any(String));
  });

  it("keeps the restored root attached when a failed root switch delivers the old detach late", async () => {
    const mock = createChromeMock({
      tabs: [
        {
          id: 70,
          url: "https://example.com/root-restore",
          title: "Root Restore",
          groupId: 1,
          status: "complete",
          active: true
        },
        {
          id: 71,
          url: "https://example.com/popup-restore",
          title: "Popup Restore",
          groupId: 1,
          status: "complete",
          active: false
        }
      ],
      activeTab: {
        id: 70,
        url: "https://example.com/root-restore",
        title: "Root Restore",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 71) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    const router = new CDPRouter();
    await router.attach(70);

    await expect(router.attach(71)).rejects.toThrow("Not allowed");
    expect(router.getAttachedTabIds()).toEqual([70]);

    mock.emitDebuggerDetach({ tabId: 70 }, "target_closed");

    expect(router.isTabAttached(70)).toBe(true);
    expect(router.getAttachedTabIds()).toEqual([70]);
  });

  it("retries root attach by targetId when the flat-session probe is blocked after tab attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 72,
        url: "https://example.com/target-attach",
        title: "Target Attach",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;

    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      if (method === "Target.setAutoAttach" && (debuggee as { tabId?: number }).tabId === 72) {
        mock.setRuntimeError("Not allowed");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({ ok: true });
    });

    const router = new CDPRouter();
    await router.attach(72);

    expect(attachMock).toHaveBeenNthCalledWith(1, { tabId: 72 }, "1.3", expect.any(Function));
    expect(attachMock).toHaveBeenNthCalledWith(2, { targetId: "target-72" }, "1.3", expect.any(Function));
    expect(router.isTabAttached(72)).toBe(true);
    expect(router.getAttachedTabIds()).toEqual([72]);
  });

  it("keeps a restored targetId-attached root when a failed switch delivers the old detach late", async () => {
    const mock = createChromeMock({
      tabs: [
        {
          id: 80,
          url: "https://example.com/target-root",
          title: "Target Root",
          groupId: 1,
          status: "complete",
          active: true
        },
        {
          id: 81,
          url: "https://example.com/blocked-root",
          title: "Blocked Root",
          groupId: 1,
          status: "complete",
          active: false
        }
      ],
      activeTab: {
        id: 80,
        url: "https://example.com/target-root",
        title: "Target Root",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const targetId = (debuggee as { targetId?: string }).targetId;
      if ((debuggee as { tabId?: number }).tabId === 81 || targetId === "target-81") {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      if (method === "Target.setAutoAttach" && (debuggee as { tabId?: number }).tabId === 80) {
        mock.setRuntimeError("Not allowed");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({ ok: true });
    });

    const router = new CDPRouter();
    await router.attach(80);

    await expect(router.attach(81)).rejects.toThrow("Not allowed");
    expect(router.getAttachedTabIds()).toEqual([80]);

    mock.emitDebuggerDetach({ targetId: "target-80" }, "target_closed");

    expect(router.isTabAttached(80)).toBe(true);
    expect(router.getAttachedTabIds()).toEqual([80]);
  });

  it("tries a tab-scoped root reattach for popup recovery before falling back to targetId attach", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 83,
        url: "https://example.com/popup-recover",
        title: "Popup Recover",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;

    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
      const targetId = (params as { targetId?: string }).targetId;
      if (method === "Target.setAutoAttach" && (debuggee as { tabId?: number }).tabId === 83) {
        mock.setRuntimeError("Not allowed");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      if (method === "Target.attachToTarget") {
        if (debuggeeTargetId === "target-83" && !sessionId && targetId === "popup-83") {
          mock.setRuntimeError("Not allowed");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        if ((debuggee as { tabId?: number }).tabId === 83 && !sessionId && targetId === "popup-83") {
          callback({ sessionId: "popup-session-83" });
          return;
        }
      }
      callback({ ok: true });
    });

    const router = new CDPRouter();
    await router.attach(83);
    attachMock.mockClear();

    await expect(router.attachChildTarget(83, "popup-83")).resolves.toBe("popup-session-83");

    expect(attachMock).toHaveBeenCalledWith({ tabId: 83 }, "1.3", expect.any(Function));
    expect(sendCommandMock).toHaveBeenCalledWith(
      { targetId: "target-83" },
      "Target.attachToTarget",
      { targetId: "popup-83", flatten: true },
      expect.any(Function)
    );
    expect(sendCommandMock).toHaveBeenCalledWith(
      { tabId: 83 },
      "Target.attachToTarget",
      { targetId: "popup-83", flatten: true },
      expect.any(Function)
    );
  });

  it("records the raw post-refresh probe result when a refreshed root still rejects Target.getTargets", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 67,
        url: "https://example.com/refresh-probe",
        title: "Refresh Probe",
        groupId: 1,
        status: "complete",
        active: true
      }
    });
    globalThis.chrome = mock.chrome;

    const router = new CDPRouter();
    await router.attach(67);

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        if (method === "Target.getTargets" && (debuggee as { tabId?: number }).tabId === 67) {
          mock.setRuntimeError("Debugger is not attached to the tab with id: 67.");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    await router.refreshTabAttachment(67);

    expect(router.getLastRootRefreshDiagnostic(67)).toEqual(expect.objectContaining({
      tabId: 67,
      path: "reattach_root_debuggee",
      refreshCompleted: true,
      debuggeePresentAfterRefresh: true,
      rootSessionPresentAfterRefresh: true,
      rootTargetIdAfterRefresh: "target-67",
      probeMethod: "Target.getTargets",
      probeStage: "failed",
      probeReason: "Debugger is not attached to the tab with id: 67."
    }));
  });

  it("records attached_root_unavailable when blocked popup attach cannot recover through an attached root session", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 61,
        url: "https://example.com/router-stage-unavailable",
        title: "Router Stage Unavailable",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        if (method === "Page.getFrameTree") {
          callback({
            frameTree: {
              frame: {
                id: "frame-61",
                url: "https://example.com/router-stage-unavailable"
              }
            }
          });
          return;
        }
        if (method === "Target.attachToTarget" && (debuggee as { tabId?: number }).tabId === 61) {
          mock.setRuntimeError("Not allowed");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    await router.attach(61);

    await expect(router.attachChildTarget(61, "popup-61")).rejects.toThrow("Not allowed");
    expect(router.getLastChildAttachDiagnostic(61, "popup-61")).toEqual(expect.objectContaining({
      stage: "attached_root_unavailable",
      initialStage: "raw_attach_blocked",
      rootTargetRetryStage: "attach_null",
      attachedRootRecoveryStage: "attach_failed",
      attachedRootRecoverySource: "record",
      attachedRootRecoveryReason: "Not allowed",
      reason: "Not allowed"
    }));
  });

  it("records attached_root_unavailable when the raw attach returns no child session id and no real attached-root session exists", async () => {
    const mock = createChromeMock({
      activeTab: {
        id: 62,
        url: "https://example.com/router-stage-null",
        title: "Router Stage Null",
        groupId: 1
      }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.sendCommand).mockImplementation(
      (debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
        if (method === "Page.getFrameTree") {
          callback({
            frameTree: {
              frame: {
                id: "frame-62",
                url: "https://example.com/router-stage-null"
              }
            }
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const sessionId = (debuggee as { sessionId?: string }).sessionId;
          const debuggeeTargetId = (debuggee as { targetId?: string }).targetId;
          const targetId = (params as { targetId?: string }).targetId;
          if (debuggeeTargetId === "target-62" && !sessionId && targetId === "popup-62") {
            callback({});
            return;
          }
        }
        callback({ ok: true });
      }
    );

    const router = new CDPRouter();
    await router.attach(62);

    await expect(router.attachChildTarget(62, "popup-62")).resolves.toBeNull();
    expect(router.getLastChildAttachDiagnostic(62, "popup-62")).toEqual(expect.objectContaining({
      stage: "attached_root_unavailable",
      initialStage: "raw_attach_null",
      rootTargetRetryStage: "attach_null",
      attachedRootRecoveryStage: "attach_null",
      attachedRootRecoverySource: "record"
    }));
  });

  it("resolves popup opener ids from raw debugger targets after client reset", async () => {
    const mock = createChromeMock({
      tabs: [
        { id: 59, url: "https://example.com/root-alias", title: "Root Alias", groupId: 1, status: "complete", active: true },
        { id: 60, url: "https://popup.example.com/final", title: "Popup Final", groupId: 1, status: "complete", active: false }
      ],
      activeTab: { id: 59, url: "https://example.com/root-alias", title: "Root Alias", groupId: 1, status: "complete", active: true }
    });
    globalThis.chrome = mock.chrome;

    vi.mocked(chrome.debugger.getTargets).mockImplementation((callback) => {
      callback([
        {
          id: "root-target-59",
          tabId: 59,
          type: "page",
          title: "Root Alias",
          url: "https://example.com/root-alias",
          attached: false
        } as chrome.debugger.TargetInfo,
        {
          id: "popup-target-60",
          tabId: 60,
          type: "page",
          title: "Popup Final",

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-ops-runtime.test.ts
(lines 1-180: OpsRuntime popup harness and shared fixtures: createPopupRuntimeHarness plus base test setup used by popup adoption/attach tests.)
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsRuntime } from "../extension/src/ops/ops-runtime";
import { OpsSessionStore } from "../extension/src/ops/ops-session-store";
import { CDPRouter } from "../extension/src/services/CDPRouter";
import { createChromeMock } from "./extension-chrome-mock";

type TabRemovedListener = (tabId: number) => void;
type TabCreatedListener = (tab: chrome.tabs.Tab) => void;
type DebuggerDetachListener = (source: chrome.debugger.Debuggee) => void;
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createPopupRuntimeHarness = async (): Promise<{
  mock: ReturnType<typeof createChromeMock>;
  router: CDPRouter;
  runtime: OpsRuntime;
  sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }>;
  session: ReturnType<OpsSessionStore["getByTabId"]>;
  rootSessionId: string;
}> => {
  const mock = createChromeMock({
    activeTab: {
      id: 101,
      url: "https://example.com/root",
      title: "Root Page",
      groupId: 1,
      status: "complete",
      active: true
    }
  });
  globalThis.chrome = mock.chrome;

  const router = new CDPRouter();
  const routerEvents: Array<{ tabId: number; method: string; params?: unknown; sessionId?: string }> = [];
  router.setCallbacks({ onEvent: vi.fn(), onResponse: vi.fn(), onDetach: vi.fn() });
  router.addEventListener((event) => {
    routerEvents.push(event);
  });

  const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }> = [];
  const runtime = new OpsRuntime({
    send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }),
    cdp: router as never
  });

  runtime.handleMessage({
    type: "ops_request",
    requestId: "req-launch-popup-harness",
    clientId: "client-1",
    command: "session.launch",
    payload: {
      tabId: 101
    }
  });

  const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
  await vi.waitFor(() => {
    expect(sessions.getByTabId(101)).not.toBeNull();
    expect(routerEvents.some((event) => event.method === "Target.attachedToTarget")).toBe(true);
  });

  const session = sessions.getByTabId(101);
  const rootAttachedEvent = routerEvents.find((event) => event.method === "Target.attachedToTarget");
  const rootSessionId = (rootAttachedEvent?.params as { sessionId?: string } | undefined)?.sessionId;
  if (!session || !rootSessionId) {
    throw new Error("Expected popup runtime harness to create a launched root session");
  }

  return { mock, router, runtime, sent, session, rootSessionId };
};

describe("OpsRuntime target teardown", () => {
  const originalChrome = globalThis.chrome;

  let tabRemovedListener: TabRemovedListener | null = null;
  let tabCreatedListener: TabCreatedListener | null = null;
  let debuggerDetachListener: DebuggerDetachListener | null = null;

  beforeEach(() => {
    tabRemovedListener = null;
    tabCreatedListener = null;
    debuggerDetachListener = null;

    globalThis.chrome = {
      runtime: {
        lastError: undefined
      },
      tabs: {
        create: vi.fn(),
        get: vi.fn(async () => null),
        query: vi.fn(async () => []),
        remove: vi.fn((_tabId: number, callback?: () => void) => {
          callback?.();
        }),
        update: vi.fn((_tabId: number, _updateProperties: chrome.tabs.UpdateProperties, callback?: (tab?: chrome.tabs.Tab) => void) => {
          callback?.({
            id: _tabId,
            status: "complete",
            url: "https://example.com/",
            title: "Example Domain"
          } as chrome.tabs.Tab);
        }),
        onRemoved: {
          addListener: vi.fn((listener: TabRemovedListener) => {
            tabRemovedListener = listener;
          }),
          removeListener: vi.fn((listener: TabRemovedListener) => {
            if (tabRemovedListener === listener) {
              tabRemovedListener = null;
            }
          })
        },
        onCreated: {
          addListener: vi.fn((listener: TabCreatedListener) => {
            tabCreatedListener = listener;
          }),
          removeListener: vi.fn((listener: TabCreatedListener) => {
            if (tabCreatedListener === listener) {
              tabCreatedListener = null;
            }
          })
        },
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      },
      debugger: {
        onEvent: {
          addListener: vi.fn()
        },
        onDetach: {
          addListener: vi.fn((listener: DebuggerDetachListener) => {
            debuggerDetachListener = listener;
          })
        }
      },
      scripting: {
        executeScript: vi.fn()
      }
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it("attaches a replacement target without issuing a manual detach when the router already owns root normalization", async () => {
    const cdp = {
      attach: vi.fn(async () => undefined),
      detachTab: vi.fn(async () => undefined),
      getPrimaryTabId: vi.fn(() => 101)
    };

    const runtime = new OpsRuntime({
      send: () => undefined,
      cdp: cdp as never
    });

    await (runtime as unknown as { attachTargetTab: (tabId: number) => Promise<void> }).attachTargetTab(202);

    expect(cdp.attach).toHaveBeenCalledWith(202);
    expect(cdp.detachTab).not.toHaveBeenCalled();
  });

  it("retries a blocked replacement attach without reattaching the previous root tab", async () => {
    vi.useFakeTimers();
    const cdp = {
      attach: vi.fn()
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockResolvedValueOnce(undefined),
      detachTab: vi.fn(async () => undefined),
      getPrimaryTabId: vi.fn(() => 101)
    };

    const runtime = new OpsRuntime({

```

(lines 760-3915: Core popup adoption and opener-bridge tests in OpsRuntime (preparePopupTarget/attachTargetViaOpenerSession paths, opener hydration, synthetic bridge reuse, blocked attach recovery).)
```ts
      opsSessionId: session.id,
      leaseId: "lease-1",
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });
    await vi.waitFor(() => {
      expect(cdp.sendCommand).toHaveBeenCalledWith({ tabId: 101 }, "Accessibility.getFullAXTree", {});
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-nav-review",
          payload: expect.objectContaining({
            sessionId: session.id,
            targetId: "tab-101",
            mode: "extension",
            snapshotId: expect.any(String),
            url: "https://example.com/review",
            title: "Review Page",
            refCount: 1,
            content: expect.stringContaining('Review CTA')
          })
        })
      ])
    );
  });

  it("captures review payloads for the active popup target over the ops surface", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee, method, params, callback) => {
      void debuggee;
      if (method === "Accessibility.enable" || method === "DOM.enable" || method === "Target.setAutoAttach") {
        callback?.({});
        return;
      }
      if (method === "Accessibility.getFullAXTree") {
        callback?.({
          nodes: [{
            nodeId: "ax-popup-1",
            backendDOMNodeId: 2,
            role: { value: "button" },
            name: { value: "Popup CTA" }
          }]
        });
        return;
      }
      if (method === "DOM.resolveNode") {
        callback?.({ object: { objectId: "popup-node-1" } });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
          ? (params as { functionDeclaration: string }).functionDeclaration
          : "";
        if (declaration.includes("querySelectorAll")) {
          callback?.({ result: { value: "#popup-cta" } });
          return;
        }
        callback?.({ result: { value: null } });
        return;
      }
      callback?.({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: "https://example.com/root",
      title: "Root Page",
      status: "complete"
    } as chrome.tabs.Tab));

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          url: "https://popup.example.com/challenge",
          title: "Popup Challenge",
          openerId: "tab-101"
        }
      }
    );
    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.attachedToTarget",
      {
        sessionId: "popup-session-202",
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          url: "https://popup.example.com/challenge",
          title: "Popup Challenge",
          openerId: "tab-101"
        },
        waitingForDebugger: false
      }
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup",
            payload: expect.objectContaining({
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "popup-202",
                  url: "https://popup.example.com/challenge",
                  title: "Popup Challenge"
                })
              ])
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-nav-review-popup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });
    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-nav-review-popup",
          payload: expect.objectContaining({
            sessionId: session.id,
            targetId: "popup-202",
            mode: "extension",
            snapshotId: expect.any(String),
            url: "https://popup.example.com/challenge",
            title: "Popup Challenge",
            refCount: 1,
            content: expect.stringContaining("Popup CTA")
          })
        })
      ])
    );
  });

  it("captures review payloads when the popup child target reuses the real popup target id", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/numeric",
      title: "Popup Numeric",
      openerTargetId: session.targetId
    });
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee, method, params, callback) => {
      void debuggee;
      if (method === "Accessibility.enable" || method === "DOM.enable" || method === "Target.setAutoAttach") {
        callback?.({});
        return;
      }
      if (method === "Accessibility.getFullAXTree") {
        callback?.({
          nodes: [{
            nodeId: "ax-popup-numeric-1",
            backendDOMNodeId: 2,
            role: { value: "button" },
            name: { value: "Popup Same Id CTA" }
          }]
        });
        return;
      }
      if (method === "DOM.resolveNode") {
        callback?.({ object: { objectId: "popup-node-same-id-1" } });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
          ? (params as { functionDeclaration: string }).functionDeclaration
          : "";
        if (declaration.includes("querySelectorAll")) {
          callback?.({ result: { value: "#popup-same-id-cta" } });
          return;
        }
        callback?.({ result: { value: null } });
        return;
      }
      callback?.({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/numeric" : "https://example.com/root",
      title: tabId === 202 ? "Popup Numeric" : "Root Page",
      status: "complete"
    } as chrome.tabs.Tab));

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "tab-202",
          type: "page",
          url: "https://popup.example.com/numeric",
          title: "Popup Numeric",
          openerId: "tab-101"
        }
      }
    );
    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.attachedToTarget",
      {
        sessionId: "popup-session-same-id-202",
        targetInfo: {
          targetId: "tab-202",
          type: "page",
          url: "https://popup.example.com/numeric",
          title: "Popup Numeric",
          openerId: "tab-101"
        },
        waitingForDebugger: false
      }
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-numeric-target-id",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        targetId: "tab-202",
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 202, sessionId: "popup-session-same-id-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
    });

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_response",
          requestId: "req-review-popup-numeric-target-id",
          payload: expect.objectContaining({
            sessionId: session.id,
            targetId: "tab-202",
            mode: "extension",
            snapshotId: expect.any(String),
            url: "https://popup.example.com/numeric",
            title: "Popup Numeric",
            refCount: 1,
            content: expect.stringContaining("Popup Same Id CTA")
          })
        })
      ])
    );
  });

  it("dispatches non-canvas clicks through Input.dispatchMouseEvent", async () => {
    const sent: Array<{ type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }> = [];
    const sendCommand = vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string, params?: Record<string, unknown>) => {
      if (method === "DOM.resolveNode") {
        return { object: { objectId: "node-1" } };
      }
      if (method === "DOM.getBoxModel") {
        return {
          model: {
            content: [10, 20, 30, 20, 30, 40, 10, 40]
          }
        };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: undefined } };
      }
      if (method === "Input.dispatchMouseEvent") {
        return {};
      }
      return {};
    });
    const runtime = new OpsRuntime({
      send: (message) => sent.push(message as { type?: string; requestId?: string; payload?: unknown; error?: { code?: string; retryable?: boolean; message?: string } }),
      cdp: {
        detachTab: vi.fn(async () => undefined),
        sendCommand
      } as never
    });

    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const session = sessions.createSession("client-1", 101, "lease-1", {
      url: "https://example.com/root",
      title: "Root Page"
    });
    session.refStore.setSnapshot("tab-101", [{
      ref: "r1",
      selector: "#open-popup",
      backendNodeId: 3,
      role: "link",
      name: "Open Popup Window"
    }]);

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockResolvedValue({
      id: 101,
      url: "https://example.com/root",
      title: "Root Page",
      status: "complete"
    } as chrome.tabs.Tab);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-click-real-input",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "interact.click",
      payload: {
        ref: "r1"
      }
    });
    await vi.waitFor(() => {
      expect(globalThis.chrome.tabs.update).toHaveBeenCalledWith(
        101,
        { active: true },
        expect.any(Function)
      );
      expect(sendCommand).toHaveBeenCalledWith(
        { tabId: 101 },
        "Input.dispatchMouseEvent",
        expect.objectContaining({ type: "mouseMoved", x: 20, y: 30 })
      );
      expect(sendCommand).toHaveBeenCalledWith(
        { tabId: 101 },
        "Input.dispatchMouseEvent",
        expect.objectContaining({ type: "mousePressed", x: 20, y: 30, button: "left", clickCount: 1 })
      );
      expect(sendCommand).toHaveBeenCalledWith(
        { tabId: 101 },
        "Input.dispatchMouseEvent",
        expect.objectContaining({ type: "mouseReleased", x: 20, y: 30, button: "left", clickCount: 1 })
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-click-real-input",
            payload: expect.objectContaining({ navigated: false })
          })
        ])
      );
    });
  });

  it("lists popup targets when router events are keyed only by the popup child target id", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: "https://example.com/root",
      title: "Root Page",
      status: "complete"
    } as chrome.tabs.Tab));

    mock.emitDebuggerEvent(
      { targetId: "popup-303" },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-303",
          type: "page",
          url: "https://popup.example.com/child-source",
          title: "Popup Child Source",
          openerId: "tab-101"
        }
      }
    );
    mock.emitDebuggerEvent(
      { targetId: "popup-303" },
      "Target.attachedToTarget",
      {
        sessionId: "popup-session-303",
        targetInfo: {
          targetId: "popup-303",
          type: "page",
          url: "https://popup.example.com/child-source",
          title: "Popup Child Source",
          openerId: "tab-101"
        },
        waitingForDebugger: false
      }
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup-child-source",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup-child-source",
            payload: expect.objectContaining({
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "popup-303",
                  url: "https://popup.example.com/child-source",
                  title: "Popup Child Source"
                })
              ])
            })
          })
        ])
      );
    });
  });

  it("adopts top-level popup tabs created with an opener tab id when Chrome allows only one attached root tab", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = 101;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      if (method === "Target.attachToTarget") {
        callback({ sessionId: `session-${tabId ?? 0}` });
        return;
      }
      if (
        method === "Accessibility.enable"
        || method === "DOM.enable"
        || method === "Target.setAutoAttach"
        || method === "Target.setDiscoverTargets"
        || method === "Runtime.enable"
        || method === "Network.enable"
        || method === "Performance.enable"
      ) {
        callback({});
        return;
      }
      if (method === "Page.getFrameTree") {
        callback({
          frameTree: {
            frame: {
              id: `tab-${tabId ?? 0}`,
              url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root"
            }
          }
        });
        return;
      }
      if (method === "Accessibility.getFullAXTree") {
        callback({
          nodes: [{
            nodeId: "ax-popup-1",
            backendDOMNodeId: 2,
            role: { value: "button" },
            name: { value: "Popup CTA" }
          }]
        });
        return;
      }
      if (method === "DOM.resolveNode") {
        callback({ object: { objectId: "popup-node-1" } });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
          ? (params as { functionDeclaration: string }).functionDeclaration
          : "";
        if (declaration.includes("querySelectorAll")) {
          callback({ result: { value: "#popup-cta" } });
          return;
        }
        callback({ result: { value: null } });
        return;
      }
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.get("tab-202")?.openerTargetId).toBe(session.targetId);
      expect(session.activeTargetId).toBe("tab-101");
    });

    expect(detachMock).not.toHaveBeenCalled();
    expect(attachMock).not.toHaveBeenCalledWith({ tabId: 202 }, "1.3", expect.any(Function));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup-top-level",
            payload: expect.objectContaining({
              activeTargetId: "tab-101",
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "tab-202",
                  url: "https://popup.example.com/top-level",
                  title: "Popup Top Level"
                })
              ])
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-nav-review-popup-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-nav-review-popup-top-level",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("reuses a matching synthetic popup session for a top-level popup target when direct popup root attach is not allowed", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level"
    });
    sessions.upsertSyntheticTarget(session.id, {
      targetId: "popup-202",
      tabId: 101,
      type: "page",
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      sessionId: "popup-session-202",
      openerTargetId: session.targetId,
      attachedAt: Date.now()
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-bridge-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-bridge-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-bridge",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-bridge",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Top Level"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-bridge",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-bridge",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("reuses a synthetic popup session by opener when the child session metadata is still on about:blank and the opener uses a stale root alias", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      openerTargetId: session.targetId
    });
    sessions.upsertSyntheticTarget(session.id, {
      targetId: "popup-202",
      tabId: 101,
      type: "page",
      url: "about:blank",
      title: "about:blank",
      sessionId: "popup-session-202",
      openerTargetId: "target-101",
      attachedAt: Date.now()
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-bridge-opener-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-bridge-opener-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-bridge-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-bridge-opener",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Top Level"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-bridge-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-bridge-opener",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("creates a popup child-session bridge on demand when direct top-level popup attach is blocked", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Child",
      openerTargetId: session.targetId
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-bridge-demand-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-bridge-demand-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-bridge-demand",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-bridge-demand",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);
    expect(sendCommandMock).toHaveBeenCalledWith(
      { tabId: 101 },
      "Target.attachToTarget",
      { targetId: "popup-202", flatten: true },
      expect.any(Function)
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-bridge-demand",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(
        sendCommandMock.mock.calls.some(([debuggee, method]) => (
          (debuggee as { tabId?: number; sessionId?: string }).tabId === 202
          && (debuggee as { sessionId?: string }).sessionId === undefined
          && method === "Accessibility.getFullAXTree"
        ))
      ).toBe(false);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-bridge-demand",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Child",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("hydrates a missing popup opener from router metadata before targets.use bridges the popup", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Child"
    });

    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-101",
          tabId: 101,
          type: "page",
          title: "Root Page",
          url: "https://example.com/root",
          attached: false
        },
        {
          id: "popup-202",
          tabId: 202,
          type: "page",
          title: "Popup Child",
          url: "https://popup.example.com/top-level",
          attached: false
        },
        {
          id: "popup-202-initial",
          tabId: 202,
          type: "page",
          title: "about:blank",
          url: "about:blank",
          openerId: "target-101",
          attached: false
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          title: "Popup Child",
          url: "https://popup.example.com/top-level",
          openerId: "target-101"
        }
      }
    );

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Child",
              openerId: "target-101"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-hydrated-use-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-hydrated-use-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-hydrated-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(popupTarget.openerTargetId).toBe(session.targetId);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-hydrated-opener",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);
    expect(sendCommandMock).toHaveBeenCalledWith(
      { tabId: 101 },
      "Target.attachToTarget",
      { targetId: "popup-202", flatten: true },
      expect.any(Function)
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-hydrated-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-hydrated-opener",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Child",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("bridges targets.use when only the synthetic router target carries the popup opener id", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Child"
    });

    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-101",
          tabId: 101,
          type: "page",
          title: "Root Page",
          url: "https://example.com/root",
          attached: false
        },
        {
          id: "popup-202",
          tabId: 202,
          type: "page",
          title: "Popup Child",
          url: "https://popup.example.com/top-level",
          attached: false
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          title: "Popup Child",
          url: "https://popup.example.com/top-level",
          openerId: "tab-101"
        }
      }
    );

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Child",
              openerId: "tab-101"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-synthetic-opener-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-synthetic-opener-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-synthetic-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-synthetic-opener",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);
    expect(sendCommandMock).toHaveBeenCalledWith(
      { tabId: 101 },
      "Target.attachToTarget",
      { targetId: "popup-202", flatten: true },
      expect.any(Function)
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-synthetic-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-synthetic-opener",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Child",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("restores the opener root attach before bridging a blocked popup during popup creation", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = 101;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    detachMock.mockClear();
    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (typeof tabId === "number" && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      if (tabId === 101 && typeof sessionId !== "string") {
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Top Level"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const requestedTargetId = typeof (params as { targetId?: unknown } | undefined)?.targetId === "string"
            ? (params as { targetId: string }).targetId
            : null;
          if (requestedTargetId === "popup-202" || requestedTargetId === "target-101") {
            callback({ sessionId: requestedTargetId === "popup-202" ? "popup-session-202" : "root-session-101" });
            return;
          }
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-restored-root-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-restored-root-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.get("tab-202")?.openerTargetId).toBe(session.targetId);
      expect(session.activeTargetId).toBe("tab-101");
      expect(attachedTabId).toBe(101);
    });

    expect(router.getAttachedTabIds()).toEqual([101]);
    expect(attachMock).not.toHaveBeenCalledWith({ tabId: 202 }, "1.3", expect.any(Function));
    expect(attachMock).not.toHaveBeenCalledWith({ tabId: 101 }, "1.3", expect.any(Function));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-restored-root",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-restored-root",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("keeps the opener root usable after blocked popup attach following router client reset", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    router.markClientClosed();
    await router.handleCommand({
      id: 990,
      method: "forwardCDPCommand",
      params: { method: "Runtime.enable", params: {} }
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = 101;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    detachMock.mockClear();
    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (typeof tabId === "number" && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      if (tabId === 101 && typeof sessionId !== "string") {
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Top Level"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const requestedTargetId = typeof (params as { targetId?: unknown } | undefined)?.targetId === "string"
            ? (params as { targetId: string }).targetId
            : null;
          if (requestedTargetId === "popup-202" || requestedTargetId === "target-101") {
            callback({ sessionId: requestedTargetId === "popup-202" ? "popup-session-202" : "root-session-101" });
            return;
          }
        }
        if (method === "Accessibility.enable" || method === "DOM.enable" || method === "Runtime.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-root-after-reset-1",
              backendDOMNodeId: 1,
              role: { value: "link" },
              name: { value: "Open Popup Window" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "root-node-after-reset-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#open-popup" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-after-reset-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-after-reset-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
      expect(attachedTabId).toBe(101);
    });

    expect(router.getAttachedTabIds()).toEqual([101]);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-root-review-after-reset",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-101"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101 },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-root-review-after-reset",
            payload: expect.objectContaining({
              targetId: "tab-101",
              title: "Root Page",
              url: "https://example.com/root",
              content: expect.stringContaining("Open Popup Window")
            })
          })
        ])
      );
    });
  });

  it("bridges a popup child session during popup creation when Target.getTargets still reports about:blank", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [
              {
                targetId: "root-101",
                type: "page",
                url: "https://example.com/root",
                title: "Root Page"
              },
              {
                targetId: "popup-202",
                type: "page",
                url: "about:blank",
                title: "about:blank"
              }
            ]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-live-bridge-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-live-bridge-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup-top-level-live-bridge",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup-top-level-live-bridge",
            payload: expect.objectContaining({
              activeTargetId: "tab-101",
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "tab-202",
                  url: "https://popup.example.com/top-level",
                  title: "Popup Top Level"
                })
              ])
            })
          })
        ])
      );
    });

    expect(attachMock).not.toHaveBeenCalledWith({ tabId: 202 }, "1.3", expect.any(Function));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-top-level-live-bridge",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(
        sendCommandMock.mock.calls.some(([debuggee, method]) => (
          (debuggee as { tabId?: number; sessionId?: string }).tabId === 202
          && (debuggee as { sessionId?: string }).sessionId === undefined
          && method === "Accessibility.getFullAXTree"
        ))
      ).toBe(false);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-top-level-live-bridge",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Top Level",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("hydrates popup opener ownership from router metadata when popup creation omits openerTabId", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-101",
          tabId: 101,
          type: "page",
          title: "Root Page",
          url: "https://example.com/root",
          attached: false
        },
        {
          id: "popup-202",
          tabId: 202,
          type: "page",
          title: "about:blank",
          url: "about:blank",
          attached: false
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          title: "about:blank",
          url: "about:blank",
          openerId: "target-101"
        }
      }
    );

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [
              {
                targetId: "root-101",
                type: "page",
                url: "https://example.com/root",
                title: "Root Page"
              },
              {
                targetId: "popup-202",
                type: "page",
                url: "about:blank",
                title: "about:blank",
                openerId: "target-101"
              }
            ]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-hydrated-create-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-hydrated-create-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.get("tab-202")?.openerTargetId).toBe(session.targetId);
      expect(session.activeTargetId).toBe("tab-101");
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);
  });

  it("adopts a popup on tab update when router opener metadata arrives after tab creation", async () => {
    const { mock, runtime, session, rootSessionId } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    let openerReady = false;
    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([
        {
          id: "target-101",
          tabId: 101,
          type: "page",
          title: "Root Page",
          url: "https://example.com/root",
          attached: false
        },
        {
          id: "popup-202",
          tabId: 202,
          type: "page",
          title: openerReady ? "Popup Top Level" : "about:blank",
          url: openerReady ? "https://popup.example.com/top-level" : "about:blank",
          ...(openerReady ? { openerId: "target-101" } : {}),
          attached: false
        }
      ] as chrome.debugger.TargetInfo[]);
    });

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [
              {
                targetId: "target-101",
                type: "page",
                url: "https://example.com/root",
                title: "Root Page"
              },
              {
                targetId: "popup-202",
                type: "page",
                url: openerReady ? "https://popup.example.com/top-level" : "about:blank",
                title: openerReady ? "Popup Top Level" : "about:blank",
                ...(openerReady ? { openerId: "target-101" } : {})
              }
            ]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "popup-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitTabCreated({
      id: 202,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);

    await flushMicrotasks();
    expect(session.targets.has("tab-202")).toBe(false);

    openerReady = true;
    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-202",
          type: "page",
          title: "Popup Top Level",
          url: "https://popup.example.com/top-level",
          openerId: "target-101"
        }
      }
    );
    mock.emitTabUpdated(202, {
      id: 202,
      url: "https://popup.example.com/top-level",
      title: "Popup Top Level",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.get("tab-202")?.openerTargetId).toBe(session.targetId);
      expect(session.activeTargetId).toBe("tab-101");
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(false);
  });

  it("lists popup targets when created-navigation metadata preserves opener ownership without openerTabId", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();

    mock.emitCreatedNavigationTarget({
      sourceTabId: 101,
      sourceFrameId: 0,
      tabId: 202,
      timeStamp: 1,
      url: "https://popup.example.com/navigation"
    } as chrome.webNavigation.WebNavigationSourceCallbackDetails);

    mock.emitTabCreated({
      id: 202,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      url: "https://popup.example.com/navigation",
      title: "Popup Navigation",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
      expect(session.targets.get("tab-202")?.openerTargetId).toBe("tab-101");
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-created-navigation-popup",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-created-navigation-popup",
            payload: expect.objectContaining({
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "tab-202",
                  title: "Popup Navigation",
                  url: "https://popup.example.com/navigation"
                })
              ])
            })
          })
        ])
      );
    });
  });

  it("lists popup alias targets from router target events using the parsed popup tab id", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Top Level" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "tab-202",
          type: "page",
          title: "Popup Top Level",
          url: "https://popup.example.com/top-level",
          openerId: session.targetId
        }
      }
    );

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-targets-list-popup-alias",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.list",
      payload: {
        includeUrls: true
      }
    });

    await vi.waitFor(() => {
      const storedSynthetic = ((runtime as unknown as { sessions: OpsSessionStore }).sessions.get(session.id)?.syntheticTargets
        .get("tab-202"));
      expect(storedSynthetic?.tabId).toBe(202);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-targets-list-popup-alias",
            payload: expect.objectContaining({
              targets: expect.arrayContaining([
                expect.objectContaining({
                  targetId: "tab-202",
                  title: "Popup Top Level",
                  url: "https://popup.example.com/top-level"
                })
              ])
            })
          })
        ])
      );
    });
  });

  it("retries popup child-session bridging through an attached root session when root Target.attachToTarget is not allowed", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level",
      title: "Popup Child",
      openerTargetId: session.targetId
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const requestedTargetId = typeof (params as { targetId?: unknown } | undefined)?.targetId === "string"
            ? (params as { targetId: string }).targetId
            : null;
          if (requestedTargetId === "target-101") {
            callback({ sessionId: "root-session-101" });
            return;
          }
          globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
          callback(undefined);
          globalThis.chrome.runtime.lastError = null as never;
          return;
        }
      }
      if (tabId === 101 && sessionId === "root-session-101") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.attachToTarget") {
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-browser-session-1",
              backendDOMNodeId: 2,
              role: { value: "button" },
              name: { value: "Popup CTA" }
            }]
          });
          return;
        }
        if (method === "DOM.resolveNode") {
          callback({ object: { objectId: "popup-node-browser-session-1" } });
          return;
        }
        if (method === "Runtime.callFunctionOn") {
          const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
            ? (params as { functionDeclaration: string }).functionDeclaration
            : "";
          if (declaration.includes("querySelectorAll")) {
            callback({ result: { value: "#popup-cta" } });
            return;
          }
          callback({ result: { value: null } });
          return;
        }
      }
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-bridge-browser-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-bridge-browser-session",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level",
              title: "Popup Child"
            })
          })
        ])
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101 },
        "Target.attachToTarget",
        { targetId: "target-101", flatten: true },
        expect.any(Function)
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { targetId: "target-101", sessionId: "root-session-101" },
        "Target.attachToTarget",
        { targetId: "popup-202", flatten: true },
        expect.any(Function)
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-review-popup-bridge-browser-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096
      }
    });

    await vi.waitFor(() => {
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101, sessionId: "popup-session-202" },
        "Accessibility.getFullAXTree",
        {},
        expect.any(Function)
      );
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-review-popup-bridge-browser-session",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Child",
              url: "https://popup.example.com/top-level",
              content: expect.stringContaining("Popup CTA")
            })
          })
        ])
      );
    });
  });

  it("retries popup child-session bridging through an attached root session when the first root attach returns no session id", async () => {
    const { runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const popupTarget = sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/top-level-null",
      title: "Popup Child Null Attach",
      openerTargetId: session.targetId
    });

    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockClear();
    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "popup-202",
              type: "page",
              url: "https://popup.example.com/top-level-null",
              title: "Popup Child Null Attach"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          const requestedTargetId = typeof (params as { targetId?: unknown } | undefined)?.targetId === "string"
            ? (params as { targetId: string }).targetId
            : null;
          if (requestedTargetId === "popup-202") {
            callback({});
            return;
          }
          if (requestedTargetId === "target-101") {
            callback({ sessionId: "root-session-101" });
            return;
          }
        }
      }
      if (tabId === 101 && sessionId === "root-session-101") {
        globalThis.chrome.runtime.lastError = null as never;
        if (method === "Target.attachToTarget") {
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      callback({});
    });

    const getTabMock = globalThis.chrome.tabs.get as unknown as ReturnType<typeof vi.fn>;
    getTabMock.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: tabId === 202 ? "https://popup.example.com/top-level-null" : "https://example.com/root",
      title: tabId === 202 ? "Popup Child Null Attach" : "Root Page",
      status: "complete",
      active: tabId === 202
    } as chrome.tabs.Tab));

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-target-use-popup-null-attach-browser-session",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: popupTarget.targetId
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-target-use-popup-null-attach-browser-session",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              url: "https://popup.example.com/top-level-null",
              title: "Popup Child Null Attach"
            })
          })
        ])
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101 },
        "Target.attachToTarget",
        { targetId: "popup-202", flatten: true },
        expect.any(Function)
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { tabId: 101 },
        "Target.attachToTarget",
        { targetId: "target-101", flatten: true },
        expect.any(Function)
      );
      expect(sendCommandMock).toHaveBeenCalledWith(
        { targetId: "target-101", sessionId: "root-session-101" },
        "Target.attachToTarget",
        { targetId: "popup-202", flatten: true },
        expect.any(Function)
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);
  });

  it("keeps popup creation on the opener bridge path even when a top-level attach would succeed on retry", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const detachMock = globalThis.chrome.debugger.detach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    let attachedTabId: number | null = 101;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== null && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      attachedTabId = typeof tabId === "number" ? tabId : attachedTabId;
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    detachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId === tabId) {
        attachedTabId = null;
      }
      globalThis.chrome.runtime.lastError = null as never;
      callback();
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      if (typeof tabId === "number" && attachedTabId !== tabId) {
        globalThis.chrome.runtime.lastError = {
          message: `Debugger is not attached to the tab with id: ${tabId}.`
        } as never;
        callback(undefined);
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      globalThis.chrome.runtime.lastError = null as never;
      if (method === "Target.attachToTarget") {
        callback({ sessionId: `session-${tabId ?? 0}` });
        return;

```

(lines 5360-6205: Stage-aware popup attach diagnostics and retry behavior for targets.use/nav.review, including attached_root_unavailable and resolve_tab_target_failed assertions.)
```ts
  });

  it("returns retry guidance when a popup target has not finished attaching", async () => {
    const { mock, runtime, sent, session, rootSessionId } = await createPopupRuntimeHarness();
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();

    mock.emitDebuggerEvent(
      { sessionId: rootSessionId },
      "Target.targetCreated",
      {
        targetInfo: {
          targetId: "popup-303",
          type: "page",
          url: "https://popup.example.com/attach",
          title: "Popup Pending",
          openerId: "tab-101"
        }
      }
    );
    session.refStore.setSnapshot("popup-303", [{
      ref: "r1",
      selector: "#popup-cta",
      backendNodeId: 3,
      role: "button",
      name: "Popup CTA"
    }]);

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-click-pending",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "interact.click",
      payload: {
        ref: "r1",
        targetId: "popup-303"
      }
    });
    await flushMicrotasks();

    expect(sendCommandMock).not.toHaveBeenCalled();
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ops_error",
          requestId: "req-popup-click-pending",
          error: expect.objectContaining({
            code: "execution_failed",
            retryable: true,
            message: "Popup target has not finished attaching yet. Take a new review or snapshot and retry."
          })
        })
      ])
    );
  });

  it("returns a review payload for an explicitly targeted top-level popup when cached popup snapshot state is already available", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    sendCommandMock.mockClear();

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/pending",
      title: "Popup Pending",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    session.refStore.setSnapshot("tab-202", [{
      ref: "r1",
      selector: "#popup-cta",
      backendNodeId: 4,
      role: "button",
      name: "Popup CTA"
    }]);

    expect(session.activeTargetId).toBe("tab-101");

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-review-pending-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });
    await vi.waitFor(() => {
      expect(
        sendCommandMock.mock.calls.some(([debuggee, method]) => (
          (debuggee as { tabId?: number; sessionId?: string }).tabId === 202
          && (debuggee as { sessionId?: string }).sessionId === undefined
          && method === "Accessibility.getFullAXTree"
        ))
      ).toBe(false);
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-review-pending-top-level",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Pending",
              url: "https://popup.example.com/pending"
            })
          })
        ])
      );
    });
    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);
  });

  it("returns retry guidance for targets.use on a top-level popup tab before attach or bridge is ready", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/pending",
      title: "Popup Pending",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    attachMock.mockClear();
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      const tabId = (debuggee as { tabId?: number }).tabId;
      if (tabId === 101 && method === "Target.getTargets") {
        callback({
          targetInfos: [{
            targetId: "target-101",
            type: "page",
            url: "https://example.com/root",
            title: "Root Page"
          }]
        });
        return;
      }
      if (tabId === 101 && method === "Target.attachToTarget") {
        mock.setRuntimeError("Not allowed");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({ ok: true });
    });
    sent.length = 0;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-pending-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });
    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-popup-target-use-pending-top-level",
            error: expect.objectContaining({
              code: "execution_failed",
              retryable: true,
              message: expect.stringContaining("Popup target has not finished attaching yet"),
              details: expect.objectContaining({
                stage: expect.any(String)
              })
            })
          })
        ])
      );
    });

    expect(
      attachMock.mock.calls.some(([debuggee]) => ((debuggee as { tabId?: number }).tabId === 202))
    ).toBe(true);
  });

  it("retries a transient popup attach stage once before surfacing an error for targets.use", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/retry-success",
      title: "Popup Retry Success",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    const attachChildTarget = vi.fn<CDPRouter["attachChildTarget"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("popup-session-202");
    const getLastChildAttachDiagnostic = vi.fn<CDPRouter["getLastChildAttachDiagnostic"]>()
      .mockReturnValue({
        tabId: 101,
        targetId: "target-202",
        stage: "attached_root_unavailable",
        at: Date.now()
      });
    (router as unknown as { attachChildTarget: CDPRouter["attachChildTarget"] }).attachChildTarget = attachChildTarget;
    (router as unknown as { getLastChildAttachDiagnostic: CDPRouter["getLastChildAttachDiagnostic"] }).getLastChildAttachDiagnostic = getLastChildAttachDiagnostic;

    sent.length = 0;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-retry-success",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-target-use-retry-success",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              title: "Popup Retry Success",
              url: "https://popup.example.com/retry-success"
            })
          })
        ])
      );
    });

    expect(attachChildTarget.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getLastChildAttachDiagnostic).toHaveBeenCalledWith(101, "target-202");
  });

  it("refreshes the opener tab attachment before popup attach when opener target lookup reports a detached debugger", async () => {
    const { mock, router, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const activateTabMock = globalThis.chrome.tabs.update as unknown as ReturnType<typeof vi.fn>;

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/refreshed",
      title: "Popup Refreshed",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      if ((debuggee as { tabId?: number }).tabId === 101 && method === "Target.getTargets") {
        mock.setRuntimeError("Debugger is not attached to the tab with id: 101.");
        callback(undefined);
        mock.setRuntimeError(null);
        return;
      }
      callback({ ok: true });
    });

    const refreshTabAttachment = vi.fn(async (_tabId: number) => {});
    const resolveTabTargetId = vi.fn(async (_tabId: number) => "target-202");
    const attachChildTarget = vi.fn(async (_tabId: number, _targetId: string) => "popup-session-202");
    (router as unknown as { refreshTabAttachment: (tabId: number) => Promise<void> }).refreshTabAttachment = refreshTabAttachment;
    (router as unknown as { resolveTabTargetId: (tabId: number) => Promise<string | null> }).resolveTabTargetId = resolveTabTargetId;
    (router as unknown as { attachChildTarget: (tabId: number, targetId: string) => Promise<string | null> }).attachChildTarget = attachChildTarget;

    sent.length = 0;
    activateTabMock.mockClear();

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-refresh-opener",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-target-use-refresh-opener",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              title: "Popup Refreshed",
              url: "https://popup.example.com/refreshed"
            })
          })
        ])
      );
    });

    expect(refreshTabAttachment).toHaveBeenCalledWith(101);
    expect(attachChildTarget).toHaveBeenCalledWith(101, "target-202");
    expect(activateTabMock).toHaveBeenCalledWith(202, { active: true }, expect.any(Function));
  });

  it("includes root refresh diagnostics when popup attach still fails after a detached-opener lookup refresh", async () => {
    const { router, runtime, sent, session } = await createPopupRuntimeHarness();
    const sessions = (runtime as unknown as { sessions: OpsSessionStore }).sessions;
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    sessions.addTarget(session.id, 202, {
      url: "https://popup.example.com/refresh-failed",
      title: "Popup Refresh Failed",
      openerTargetId: session.targetId
    });

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        globalThis.chrome.runtime.lastError = { message: "Not allowed" } as never;
        callback();
        globalThis.chrome.runtime.lastError = null as never;
        return;
      }
      callback();
    });

    const sendCommand = vi.fn(async (_debuggee: chrome.debugger.Debuggee, method: string) => {
      if (method === "Target.getTargets") {
        throw new Error("Debugger is not attached to the tab with id: 101.");
      }
      return { ok: true };
    });
    const refreshTabAttachment = vi.fn(async (_tabId: number) => {});
    const getLastRootRefreshDiagnostic = vi.fn(() => ({
      tabId: 101,
      path: "reattach_root_debuggee" as const,
      refreshCompleted: true,
      debuggeePresentAfterRefresh: true,
      rootSessionPresentAfterRefresh: true,
      rootTargetIdAfterRefresh: "target-101",
      probeMethod: "Target.getTargets" as const,
      probeStage: "failed" as const,
      probeReason: "Debugger is not attached to the tab with id: 101.",
      at: Date.now()
    }));
    const resolveTabTargetId = vi.fn(async (_tabId: number) => "target-202");
    const attachChildTarget = vi.fn(async (_tabId: number, _targetId: string) => {
      throw new Error("Debugger is not attached to the tab with id: 101.");
    });
    const getLastChildAttachDiagnostic = vi.fn(() => ({
      tabId: 101,
      targetId: "target-202",
      stage: "raw_attach_failed" as const,
      reason: "Debugger is not attached to the tab with id: 101.",
      at: Date.now()
    }));

    (router as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;
    (router as unknown as { refreshTabAttachment: typeof refreshTabAttachment }).refreshTabAttachment = refreshTabAttachment;
    (router as unknown as { getLastRootRefreshDiagnostic: typeof getLastRootRefreshDiagnostic }).getLastRootRefreshDiagnostic = getLastRootRefreshDiagnostic;
    (router as unknown as { resolveTabTargetId: typeof resolveTabTargetId }).resolveTabTargetId = resolveTabTargetId;
    (router as unknown as { attachChildTarget: typeof attachChildTarget }).attachChildTarget = attachChildTarget;
    (router as unknown as { getLastChildAttachDiagnostic: typeof getLastChildAttachDiagnostic }).getLastChildAttachDiagnostic = getLastChildAttachDiagnostic;

    sent.length = 0;
    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-refresh-diagnostic",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-popup-target-use-refresh-diagnostic",
            error: expect.objectContaining({
              code: "execution_failed",
              retryable: true,
              message: "Popup target has not finished attaching yet (stage: raw_attach_failed). Take a new review or snapshot and retry.",
              details: expect.objectContaining({
                stage: "raw_attach_failed",
                matcher: "resolve_tab_target_id",
                targetsLookupFailed: true,
                refreshPath: "reattach_root_debuggee",
                refreshCompleted: true,
                refreshDebuggeePresent: true,
                refreshRootSessionPresent: true,
                refreshRootTargetId: "target-101",
                refreshProbeMethod: "Target.getTargets",
                refreshProbeStage: "failed",
                refreshProbeReason: "Debugger is not attached to the tab with id: 101.",
                reason: "Debugger is not attached to the tab with id: 101."
              })
            })
          })
        ])
      );
    });

    expect(refreshTabAttachment).toHaveBeenCalledWith(101);
    expect(getLastRootRefreshDiagnostic).toHaveBeenCalledWith(101);
    expect(resolveTabTargetId).toHaveBeenCalledWith(202);
    expect(attachChildTarget).toHaveBeenCalledWith(101, "target-202");
  });

  it("reports resolve_tab_target_failed when the popup target cannot be matched or resolved from the tab id", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const getTargetsMock = globalThis.chrome.debugger.getTargets as unknown as ReturnType<typeof vi.fn>;

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/unresolved",
      title: "Popup Unresolved",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    getTargetsMock.mockImplementation((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
      callback([{
        id: "target-101",
        tabId: 101,
        type: "page",
        title: "Root Page",
        url: "https://example.com/root",
        attached: false
      } as chrome.debugger.TargetInfo]);
    });
    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
      const tabId = (debuggee as { tabId?: number }).tabId;
      if (tabId === 101 && method === "Target.getTargets") {
        callback({
          targetInfos: [{
            targetId: "target-101",
            type: "page",
            url: "https://example.com/root",
            title: "Root Page"
          }]
        });
        return;
      }
      callback({ ok: true });
    });
    sent.length = 0;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-unresolved-top-level",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_error",
            requestId: "req-popup-target-use-unresolved-top-level",
            error: expect.objectContaining({
              code: "execution_failed",
              retryable: true,
              message: "Popup target has not finished attaching yet (stage: resolve_tab_target_failed). Take a new review or snapshot and retry.",
              details: expect.objectContaining({
                stage: "resolve_tab_target_failed"
              })
            })
          })
        ])
      );
    });
  });

  it("bridges a top-level popup via resolveTabTargetId when opener Target.getTargets only returns the root page", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/fallback",
      title: "Popup Fallback",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        if (method === "Target.getTargets") {
          callback({
            targetInfos: [{
              targetId: "target-101",
              type: "page",
              url: "https://example.com/root",
              title: "Root Page"
            }]
          });
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "target-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;
        }
      }
      if (tabId === 101 && sessionId === "popup-session-202") {
        if (method === "Accessibility.enable" || method === "DOM.enable") {
          callback({});
          return;
        }
        if (method === "Accessibility.getFullAXTree") {
          callback({
            nodes: [{
              nodeId: "ax-popup-fallback-1",
              backendDOMNodeId: 8,
              role: { value: "button" },
              name: { value: "Popup Fallback CTA" }
            }]
          });
          return;
        }
      }
      if (method === "DOM.resolveNode") {
        callback({ object: { objectId: "popup-fallback-node-1" } });
        return;
      }
      if (method === "Runtime.callFunctionOn") {
        const declaration = typeof (params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === "string"
          ? (params as { functionDeclaration: string }).functionDeclaration
          : "";
        if (declaration.includes("querySelectorAll")) {
          callback({ result: { value: "#popup-fallback-cta" } });
          return;
        }
        callback({ result: { value: null } });
        return;
      }
      callback({});
    });
    sent.length = 0;

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-target-use-root-only-targets",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "targets.use",
      payload: {
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-target-use-root-only-targets",
            payload: expect.objectContaining({
              activeTargetId: "tab-202",
              title: "Popup Fallback",
              url: "https://popup.example.com/fallback"
            })
          })
        ])
      );
    });

    runtime.handleMessage({
      type: "ops_request",
      requestId: "req-popup-review-root-only-targets",
      clientId: "client-1",
      opsSessionId: session.id,
      leaseId: session.leaseId,
      command: "nav.review",
      payload: {
        maxChars: 4096,
        targetId: "tab-202"
      }
    });

    await vi.waitFor(() => {
      expect(sent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "ops_response",
            requestId: "req-popup-review-root-only-targets",
            payload: expect.objectContaining({
              targetId: "tab-202",
              title: "Popup Fallback",
              url: "https://popup.example.com/fallback",
              content: expect.stringContaining("Popup Fallback CTA")
            })
          })
        ])
      );
    });
  });

  it("bridges a top-level popup via resolveTabTargetId when opener Target.getTargets fails outright", async () => {
    const { mock, runtime, sent, session } = await createPopupRuntimeHarness();
    const attachMock = globalThis.chrome.debugger.attach as unknown as ReturnType<typeof vi.fn>;
    const sendCommandMock = globalThis.chrome.debugger.sendCommand as unknown as ReturnType<typeof vi.fn>;
    const resolveDebuggeeTabId = (debuggee: chrome.debugger.Debuggee): number | null => {
      if (typeof debuggee.tabId === "number") {
        return debuggee.tabId;
      }
      if (typeof debuggee.targetId === "string" && debuggee.targetId.startsWith("target-")) {
        const parsed = Number.parseInt(debuggee.targetId.slice("target-".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    attachMock.mockImplementation((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
      if ((debuggee as { tabId?: number }).tabId === 202) {
        mock.setRuntimeError("Not allowed");
        callback();
        mock.setRuntimeError(null);
        return;
      }
      callback();
    });

    mock.emitTabCreated({
      id: 202,
      openerTabId: 101,
      url: "about:blank",
      title: "about:blank",
      status: "loading",
      active: true
    } as chrome.tabs.Tab);
    mock.emitTabUpdated(202, {
      id: 202,
      openerTabId: 101,
      url: "https://popup.example.com/fallback-error",
      title: "Popup Fallback Error",
      status: "complete",
      active: true
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(session.targets.has("tab-202")).toBe(true);
    });

    sendCommandMock.mockClear();
    sendCommandMock.mockImplementation((debuggee: chrome.debugger.Debuggee, method: string, params: object, callback: (result?: unknown) => void) => {
      const tabId = resolveDebuggeeTabId(debuggee);
      const sessionId = (debuggee as { sessionId?: string }).sessionId;
      if (tabId === 101 && typeof sessionId !== "string") {
        if (method === "Target.getTargets") {
          mock.setRuntimeError("Not allowed");
          callback(undefined);
          mock.setRuntimeError(null);
          return;
        }
        if (method === "Target.attachToTarget") {
          expect(params).toEqual({
            targetId: "target-202",
            flatten: true
          });
          callback({ sessionId: "popup-session-202" });
          return;

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/CDPRouter.ts
```ts
import type { RelayCommand, RelayEvent, RelayResponse } from "../types.js";
import { TabManager } from "./TabManager.js";
import { TargetSessionMap, type TargetInfo, type DebuggerSession } from "./TargetSessionMap.js";
import { logError } from "../logging.js";
import { getRestrictionMessage } from "./url-restrictions.js";
import {
  handleSetDiscoverTargets,
  handleSetAutoAttach,
  handleCreateTarget,
  handleCloseTarget,
  handleActivateTarget,
  handleAttachToTarget,
  handleRoutedCommand,
  type AutoAttachOptions,
  type RouterCommandContext
} from "./cdp-router-commands.js";

type RelayCallbacks = {
  onEvent: (event: RelayEvent) => void;
  onResponse: (response: RelayResponse) => void;
  onDetach: (detail?: { tabId?: number; reason?: string }) => void;
  onPrimaryTabChange?: (tabId: number | null) => void;
};

type DebuggerTargetInfo = chrome.debugger.TargetInfo & { openerId?: string };

export type CDPRouterEvent = {
  tabId: number;
  method: string;
  params?: unknown;
  sessionId?: string;
};

export type ChildTargetAttachDiagnosticStage =
  | "raw_attach_failed"
  | "attached_root_unavailable"
  | "attached_root_attach_null"
  | "attached_root_attach_failed";

export type ChildTargetAttachInitialStage =
  | "raw_attach_null"
  | "raw_attach_blocked";

type ChildTargetRootTargetRetryStage =
  | "attached"
  | "missing_root_target_id"
  | "attach_null"
  | "attach_blocked";

type ChildTargetAttachedRootRecoveryStage =
  | "attached"
  | "record_missing"
  | "session_missing"
  | "attach_null"
  | "attach_failed";

type ChildTargetAttachedRootRecoverySource =
  | "record"
  | "debuggee"
  | "debugger"
  | "targets";

export type ChildTargetAttachDiagnostic = {
  tabId: number;
  targetId: string;
  stage: ChildTargetAttachDiagnosticStage;
  initialStage?: ChildTargetAttachInitialStage;
  rootTargetRetryStage?: Exclude<ChildTargetRootTargetRetryStage, "attached">;
  attachedRootRecoveryStage?: Exclude<ChildTargetAttachedRootRecoveryStage, "attached">;
  attachedRootRecoverySource?: ChildTargetAttachedRootRecoverySource;
  attachedRootRecoveryReason?: string;
  reason?: string;
  at: number;
};

type RootRefreshPath =
  | "attach_internal"
  | "reattach_root_debuggee";

type RootRefreshProbeStage =
  | "skipped"
  | "missing_debuggee"
  | "succeeded"
  | "failed";

export type RootRefreshDiagnostic = {
  tabId: number;
  path: RootRefreshPath;
  refreshCompleted: boolean;
  debuggeePresentAfterRefresh: boolean;
  rootSessionPresentAfterRefresh: boolean;
  rootTargetIdAfterRefresh?: string;
  probeMethod: "Target.getTargets";
  probeStage: RootRefreshProbeStage;
  probeReason?: string;
  reason?: string;
  at: number;
};

export type RootAttachDiagnosticOrigin =
  | "root_attach"
  | "flat_session_bootstrap";

export type RootAttachDiagnosticStage =
  | "root_debugger_attach_failed"
  | "flat_session_probe_failed"
  | "fallback_root_debugger_attach_failed"
  | "fallback_flat_session_probe_failed";

export type RootAttachDiagnostic = {
  tabId: number;
  origin: RootAttachDiagnosticOrigin;
  stage: RootAttachDiagnosticStage;
  attachBy: NonNullable<DebuggerSession["attachBy"]>;
  probeMethod?: "Target.setAutoAttach";
  reason?: string;
  at: number;
};

type ChildTargetRootTargetRetryResult = {
  sessionId: string | null;
  stage: ChildTargetRootTargetRetryStage;
  reason?: string;
};

type AttachedRootRecoveryResult = {
  debuggerSession: DebuggerSession | null;
  stage: ChildTargetAttachedRootRecoveryStage;
  attachTargetSource?: ChildTargetAttachedRootRecoverySource;
  reason?: string;
};

type SendCommandOptions = {
  preserveTab?: boolean;
};

const FLAT_SESSION_ERROR = "Chrome 125+ required for extension relay (flat sessions).";
const DEPRECATED_SEND_MESSAGE = "Target.sendMessageToTarget is deprecated in flat session mode. Use sessionId routing.";
const DEFAULT_BROWSER_CONTEXT_ID = "default";
const DEFAULT_BROWSER_TARGET_ID = "browser";
const STALE_TAB_ERROR_MARKERS = [
  "No tab with given id",
  "Debugger is not attached",
  "Detached while handling command"
];

export class CDPRouter {
  private readonly debuggees = new Map<number, chrome.debugger.Debuggee>();
  private readonly rootTargetTabIds = new Map<string, number>();
  private readonly sessions = new TargetSessionMap();
  private readonly tabManager = new TabManager();
  private readonly rootAttachedSessions = new Set<string>();
  private readonly pendingTargetTabIds = new Map<string, number>();
  private readonly childAttachDiagnostics = new Map<string, ChildTargetAttachDiagnostic>();
  private readonly rootAttachDiagnostics = new Map<number, RootAttachDiagnostic>();
  private readonly rootRefreshDiagnostics = new Map<number, RootRefreshDiagnostic>();
  private readonly expectedRootDetachDeadlines = new Map<number, number>();
  private readonly eventListeners = new Set<(event: CDPRouterEvent) => void>();
  private callbacks: RelayCallbacks | null = null;
  private autoAttachOptions: AutoAttachOptions = { autoAttach: false, waitForDebuggerOnStart: false, flatten: true };
  private discoverTargets = false;
  private listenersActive = false;
  private flatSessionValidated = false;
  private primaryTabId: number | null = null;
  private lastActiveTabId: number | null = null;
  private sessionCounter = 1;
  private readonly quarantinedSessions = new Map<string, { tabId: number; count: number; lastSeen: number }>();
  private readonly churnTracker = new Map<number, { count: number; resetAt: number }>();
  private readonly churnWindowMs = 5000;
  private readonly churnThreshold = 3;
  private clientResetPending = false;
  private handleEventBound = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    this.handleEvent(source, method, params);
  };
  private handleDetachBound = (source: chrome.debugger.Debuggee, reason?: string) => {
    this.handleDetach(source, reason);
  };

  setCallbacks(callbacks: RelayCallbacks): void {
    this.callbacks = callbacks;
  }

  addEventListener(listener: (event: CDPRouterEvent) => void): void {
    this.eventListeners.add(listener);
  }

  removeEventListener(listener: (event: CDPRouterEvent) => void): void {
    this.eventListeners.delete(listener);
  }

  async setDiscoverTargetsEnabled(discover: boolean): Promise<void> {
    await this.prepareForNextClientIfNeeded();
    const shouldEmit = discover && !this.discoverTargets;
    this.discoverTargets = discover;
    for (const debuggee of this.debuggees.values()) {
      await this.applyDiscoverTargets(debuggee, discover);
    }
    if (!shouldEmit) {
      return;
    }
    for (const targetInfo of this.sessions.listTargetInfos()) {
      const tabId = this.sessions.getByTargetId(targetInfo.targetId)?.tabId
        ?? this.rootTargetTabIds.get(targetInfo.targetId)
        ?? this.primaryTabId;
      if (typeof tabId === "number") {
        this.emitTargetCreated(tabId, targetInfo);
      }
    }
  }

  async configureAutoAttach(options: AutoAttachOptions): Promise<void> {
    await this.prepareForNextClientIfNeeded();
    if (options.flatten === false) {
      throw new Error(FLAT_SESSION_ERROR);
    }
    this.autoAttachOptions = { ...options, flatten: true };
    if (this.autoAttachOptions.autoAttach) {
      this.resetRootAttached();
    }
    for (const debuggee of this.debuggees.values()) {
      await this.applyAutoAttach(debuggee);
    }
    if (!this.autoAttachOptions.autoAttach) {
      this.emitRootDetached();
      return;
    }
    for (const tabId of this.sessions.listTabIds()) {
      await this.refreshRootTargetInfo(tabId);
    }
    for (const targetInfo of this.sessions.listTargetInfos()) {
      this.emitRootAttached(targetInfo);
    }
  }

  async attach(tabId: number): Promise<void> {
    await this.prepareForNextClientIfNeeded();
    await this.attachInternal(tabId, true);
  }

  async refreshTabAttachment(tabId: number): Promise<void> {
    await this.prepareForNextClientIfNeeded();
    const path: RootRefreshPath = this.debuggees.has(tabId)
      ? "reattach_root_debuggee"
      : "attach_internal";
    try {
      if (path === "reattach_root_debuggee") {
        await this.reattachRootDebuggee(tabId);
      } else {
        await this.attachInternal(tabId, false);
      }
    } catch (error) {
      await this.captureRootRefreshDiagnostic(tabId, path, false, error);
      throw error;
    }
    await this.captureRootRefreshDiagnostic(tabId, path, true);
  }

  async primeAttachedRootSession(tabId: number): Promise<void> {
    await this.prepareForNextClientIfNeeded();
    if (this.sessions.getAttachedRootSession(tabId)) {
      return;
    }
    await this.ensureAttachedRootSession(tabId);
  }

  async resolveTabTargetId(tabId: number): Promise<string | null> {
    await this.prepareForNextClientIfNeeded();
    return (await this.readDebuggerTargetInfo(tabId))?.id ?? null;
  }

  async resolveTabOpenerTargetId(tabId: number): Promise<string | null> {
    await this.prepareForNextClientIfNeeded();
    const { tab, pageTargets } = await this.readDebuggerPageTargets(tabId);
    if (pageTargets.length === 0) {
      return null;
    }
    const preferredTarget = this.selectPreferredDebuggerTargetInfo(tab, pageTargets);
    const candidates = preferredTarget
      ? [preferredTarget, ...pageTargets.filter((target) => target !== preferredTarget)]
      : pageTargets;
    for (const candidate of candidates) {
      const targetInfo = this.resolveTargetInfo(candidate.id);
      const openerTabId = this.pendingTargetTabIds.get(candidate.id)
        ?? this.resolveLinkedTargetTabId(candidate.openerId)
        ?? this.resolveLinkedTargetTabId(targetInfo?.openerId)
        ?? null;
      if (openerTabId !== null) {
        return `tab-${openerTabId}`;
      }
    }
    return null;
  }

  async attachChildTarget(tabId: number, targetId: string): Promise<string | null> {
    await this.prepareForNextClientIfNeeded();
    let rootDebuggee: DebuggerSession;
    try {
      rootDebuggee = await this.resolveRootSessionDebuggee(tabId);
    } catch (error) {
      this.recordChildAttachDiagnostic(tabId, targetId, {
        stage: "raw_attach_failed",
        reason: getErrorMessage(error)
      });
      throw error;
    }

    let initialStage: ChildTargetAttachInitialStage | undefined;
    let directError: unknown = null;
    let rootTargetRetryStage: Exclude<ChildTargetRootTargetRetryStage, "attached"> | undefined;
    try {
      const directSessionId = await this.attachChildTargetWithDebuggee(rootDebuggee, targetId);
      if (directSessionId) {
        this.clearChildAttachDiagnostic(tabId, targetId);
        return directSessionId;
      }
      const directTargetRetry = await this.attachChildTargetWithRootTargetId(rootDebuggee, targetId);
      if (directTargetRetry.sessionId) {
        this.clearChildAttachDiagnostic(tabId, targetId);
        return directTargetRetry.sessionId;
      }
      if (directTargetRetry.stage !== "attached") {
        rootTargetRetryStage = directTargetRetry.stage;
      }
      initialStage = "raw_attach_null";
    } catch (error) {
      const attachBlocked = isAttachBlockedError(error);
      const staleRootDebuggee = this.isStaleTabError(error);
      if (!attachBlocked && !staleRootDebuggee) {
        this.recordChildAttachDiagnostic(tabId, targetId, {
          stage: "raw_attach_failed",
          reason: getErrorMessage(error)
        });
        throw error;
      }
      if (staleRootDebuggee) {
        directError = error;
      }
      if (attachBlocked || staleRootDebuggee) {
        let directTargetRetry: ChildTargetRootTargetRetryResult;
        try {
          directTargetRetry = await this.attachChildTargetWithRootTargetId(rootDebuggee, targetId, error);
        } catch (fallbackError) {
          this.recordChildAttachDiagnostic(tabId, targetId, {
            stage: "raw_attach_failed",
            reason: getErrorMessage(fallbackError)
          });
          throw fallbackError;
        }
        if (directTargetRetry.sessionId) {
          this.clearChildAttachDiagnostic(tabId, targetId);
          return directTargetRetry.sessionId;
        }
        if (directTargetRetry.stage !== "attached") {
          rootTargetRetryStage = directTargetRetry.stage;
        }
        if (attachBlocked) {
          initialStage = "raw_attach_blocked";
          directError = error;
        }
      }
    }
    let attachedRootRecovery = await this.ensureAttachedRootSessionWithDiagnostic(tabId);
    if (!attachedRootRecovery.debuggerSession) {
      await this.registerRootTab(tabId);
      attachedRootRecovery = await this.ensureAttachedRootSessionWithDiagnostic(tabId);
    }
    if (!attachedRootRecovery.debuggerSession) {
      const reattachedChildSessionId = await this.reattachRootAndAttachChildTarget(tabId, targetId);
      if (reattachedChildSessionId) {
        this.clearChildAttachDiagnostic(tabId, targetId);
        return reattachedChildSessionId;
      }
      this.recordChildAttachDiagnostic(tabId, targetId, {
        stage: "attached_root_unavailable",
        ...(initialStage ? { initialStage } : {}),
        ...(rootTargetRetryStage ? { rootTargetRetryStage } : {}),
        ...(attachedRootRecovery.stage !== "attached"
          ? { attachedRootRecoveryStage: attachedRootRecovery.stage }
          : {}),
        ...(attachedRootRecovery.attachTargetSource
          ? { attachedRootRecoverySource: attachedRootRecovery.attachTargetSource }
          : {}),
        ...(attachedRootRecovery.reason
          ? { attachedRootRecoveryReason: attachedRootRecovery.reason }
          : {}),
        ...((directError || attachedRootRecovery.reason)
          ? { reason: directError ? getErrorMessage(directError) : attachedRootRecovery.reason }
          : {})
      });
      if (directError) {
        throw directError;
      }
      return null;
    }
    try {
      const attachedRootSessionId = await this.attachChildTargetWithDebuggee(
        attachedRootRecovery.debuggerSession,
        targetId
      );
      if (attachedRootSessionId) {
        this.clearChildAttachDiagnostic(tabId, targetId);
        return attachedRootSessionId;
      }
      await this.restoreRootAfterChildAttachFailure(tabId);
      this.recordChildAttachDiagnostic(tabId, targetId, {
        stage: "attached_root_attach_null",
        ...(initialStage ? { initialStage } : {}),
        ...(rootTargetRetryStage ? { rootTargetRetryStage } : {})
      });
      return null;
    } catch (error) {
      await this.restoreRootAfterChildAttachFailure(tabId);
      this.recordChildAttachDiagnostic(tabId, targetId, {
        stage: "attached_root_attach_failed",
        ...(initialStage ? { initialStage } : {}),
        ...(rootTargetRetryStage ? { rootTargetRetryStage } : {}),
        reason: getErrorMessage(error)
      });
      throw error;
    }
  }

  getLastChildAttachDiagnostic(tabId: number, targetId: string): ChildTargetAttachDiagnostic | null {
    return this.childAttachDiagnostics.get(this.childAttachDiagnosticKey(tabId, targetId)) ?? null;
  }

  getLastRootRefreshDiagnostic(tabId: number): RootRefreshDiagnostic | null {
    return this.rootRefreshDiagnostics.get(tabId) ?? null;
  }

  getLastRootAttachDiagnostic(tabId: number): RootAttachDiagnostic | null {
    return this.rootAttachDiagnostics.get(tabId) ?? null;
  }

  private async attachInternal(tabId: number, allowRetry: boolean): Promise<void> {
    if (this.debuggees.has(tabId)) {
      this.clearRootAttachDiagnostic(tabId);
      this.updatePrimaryTab(tabId);
      await this.pruneRootDebuggees(tabId);
      return;
    }

    const debuggee = await this.resolveRootDebuggee(tabId);
    let attachedDebuggee = debuggee;
    const displacedRoots = await this.detachConflictingRootDebuggees(tabId);
    this.debuggees.set(tabId, debuggee);
    this.ensureListeners();

    try {
      attachedDebuggee = await this.attachRootDebuggeeWithFallback(tabId, debuggee);
      const targetInfo = await this.registerRootTab(tabId);

      if (this.discoverTargets) {
        await this.applyDiscoverTargets(attachedDebuggee, true);
        this.emitTargetCreated(tabId, targetInfo);
      }

      if (this.autoAttachOptions.autoAttach) {
        await this.applyAutoAttach(attachedDebuggee);
        this.emitRootAttached(targetInfo);
      }

      this.updatePrimaryTab(tabId);
      this.commitDetachedRootDebuggees(displacedRoots);
      await this.pruneRootDebuggees(tabId);
      this.clearRootAttachDiagnostic(tabId);
    } catch (error) {
      this.debuggees.delete(tabId);
      if (typeof attachedDebuggee.targetId === "string") {
        this.rootTargetTabIds.delete(attachedDebuggee.targetId);
      }
      if (this.debuggees.size === 0) {
        this.removeListeners();
      }
      await this.safeDetach(attachedDebuggee);
      if (allowRetry && this.isStaleTabError(error)) {
        const attemptedTabIds = new Set<number>([tabId]);
        let lastStaleError: unknown = error;
        const activeTabId = await this.tabManager.getActiveTabId();
        if (activeTabId && !attemptedTabIds.has(activeTabId)) {
          attemptedTabIds.add(activeTabId);
          try {
            await this.attachInternal(activeTabId, false);
            this.commitDetachedRootDebuggees(displacedRoots);
            return;
          } catch (candidateError) {
            if (!this.isStaleTabError(candidateError)) {
              throw candidateError;
            }
            lastStaleError = candidateError;
          }
        }
        const fallbackTabId = await this.tabManager.getFirstHttpTabId();
        if (fallbackTabId && !attemptedTabIds.has(fallbackTabId)) {
          attemptedTabIds.add(fallbackTabId);
          try {
            await this.attachInternal(fallbackTabId, false);
            this.commitDetachedRootDebuggees(displacedRoots);
            return;
          } catch (candidateError) {
            if (!this.isStaleTabError(candidateError)) {
              throw candidateError;
            }
            lastStaleError = candidateError;
          }
        }
        try {
          const createdTab = await this.tabManager.createTab("about:blank", true);
          if (typeof createdTab.id === "number" && !attemptedTabIds.has(createdTab.id)) {
            await this.attachInternal(createdTab.id, false);
            this.commitDetachedRootDebuggees(displacedRoots);
            return;
          }
        } catch (candidateError) {
          if (!this.isStaleTabError(candidateError)) {
            throw candidateError;
          }
          lastStaleError = candidateError;
        }
        await this.restoreDetachedRootDebuggees(displacedRoots);
        throw lastStaleError;
      }
      await this.restoreDetachedRootDebuggees(displacedRoots);
      throw error;
    }
  }

  private async attachRootDebuggeeWithFallback(
    tabId: number,
    debuggee: DebuggerSession
  ): Promise<DebuggerSession> {
    await this.attachRootDebuggee(debuggee);
    try {
      await this.ensureFlatSessionSupport(debuggee);
      return debuggee;
    } catch (error) {
      this.recordRootAttachDiagnostic(tabId, {
        origin: "flat_session_bootstrap",
        stage: "flat_session_probe_failed",
        attachBy: this.resolveRootAttachBy(debuggee),
        probeMethod: "Target.setAutoAttach",
        reason: getErrorMessage(error)
      });
      const targetAttachDebuggee = this.createTargetAttachRootDebuggee(tabId, debuggee, error);
      if (!targetAttachDebuggee) {
        throw error;
      }
      this.markExpectedRootDetach(tabId);
      await this.safeDetach(debuggee);
      this.debuggees.set(tabId, targetAttachDebuggee);
      await this.attachRootDebuggee(targetAttachDebuggee);
      try {
        await this.ensureFlatSessionSupport(targetAttachDebuggee);
      } catch (fallbackError) {
        this.recordRootAttachDiagnostic(tabId, {
          origin: "flat_session_bootstrap",
          stage: "fallback_flat_session_probe_failed",
          attachBy: this.resolveRootAttachBy(targetAttachDebuggee),
          probeMethod: "Target.setAutoAttach",
          reason: getErrorMessage(fallbackError)
        });
        throw fallbackError;
      }
      return targetAttachDebuggee;
    }
  }

  private async attachRootDebuggee(debuggee: DebuggerSession): Promise<void> {
    try {
      await this.runDebuggerAction((done) => {
        chrome.debugger.attach(this.toChromeDebuggee(debuggee), "1.3", done);
      });
    } catch (error) {
      if (typeof debuggee.tabId === "number") {
        this.recordRootAttachDiagnostic(debuggee.tabId, {
          origin: "root_attach",
          stage: debuggee.attachBy === "targetId"
            ? "fallback_root_debugger_attach_failed"
            : "root_debugger_attach_failed",
          attachBy: this.resolveRootAttachBy(debuggee),
          reason: getErrorMessage(error)
        });
      }
      throw error;
    }
  }

  private createTargetAttachRootDebuggee(
    tabId: number,
    debuggee: DebuggerSession,
    error: unknown
  ): DebuggerSession | null {
    if (!isAttachBlockedError(error)) {
      return null;
    }
    const targetId = typeof debuggee.targetId === "string" && debuggee.targetId.length > 0
      ? debuggee.targetId
      : null;
    if (!targetId || debuggee.attachBy === "targetId") {
      return null;
    }
    return {
      tabId,
      targetId,
      attachBy: "targetId"
    };
  }

  async detachAll(): Promise<void> {
    const entries = Array.from(this.debuggees.entries());
    this.debuggees.clear();
    this.removeListeners();

    for (const [tabId, debuggee] of entries) {
      this.detachTabState(tabId);
      await this.safeDetach(debuggee);
    }

    this.primaryTabId = null;
    this.lastActiveTabId = null;
    this.callbacks?.onDetach({ reason: "manual_disconnect" });
  }

  async detachTab(tabId: number): Promise<void> {
    const debuggee = this.debuggees.get(tabId);
    if (!debuggee) {
      return;
    }
    this.debuggees.delete(tabId);
    this.detachTabState(tabId);
    await this.safeDetach(debuggee);
    if (this.debuggees.size === 0) {
      this.removeListeners();
      this.primaryTabId = null;
      this.lastActiveTabId = null;
    } else if (this.primaryTabId === tabId) {
      this.updatePrimaryTab(this.selectFallbackPrimary());
    }
    this.callbacks?.onDetach({ tabId, reason: "manual_disconnect" });
  }

  getPrimaryTabId(): number | null {
    return this.primaryTabId;
  }

  getAttachedTabIds(): number[] {
    return Array.from(this.debuggees.keys());
  }

  isTabAttached(tabId: number): boolean {
    return this.debuggees.has(tabId);
  }

  getTabDebuggee(tabId: number): DebuggerSession | null {
    return this.debuggees.get(tabId)
      ?? this.sessions.getAttachedRootSession(tabId)?.debuggerSession
      ?? (() => {
        const rootRecord = this.sessions.getByTabId(tabId);
        if (!rootRecord) {
          return null;
        }
        return this.sessions.getBySessionId(rootRecord.rootSessionId)?.debuggerSession ?? null;
      })();
  }

  async handleCommand(command: RelayCommand): Promise<void> {
    await this.prepareForNextClientIfNeeded();
    if (!this.callbacks) return;
    if (this.debuggees.size === 0) {
      this.respondError(command.id, "No tab attached");
      return;
    }

    const { method, params, sessionId } = command.params;
    const commandParams = isRecord(params) ? params : {};
    const ctx = this.buildCommandContext();

    switch (method) {
      case "Browser.getVersion": {
        const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "OpenDevBrowser Relay";
        this.respond(command.id, {
          protocolVersion: "1.3",
          product: "Chrome",
          revision: "",
          userAgent,
          jsVersion: ""
        });
        return;
      }
      case "Browser.setDownloadBehavior":
        this.respond(command.id, {});
        return;
      case "Target.getBrowserContexts":
        this.respond(command.id, { browserContextIds: [DEFAULT_BROWSER_CONTEXT_ID] });
        return;
      case "Target.attachToBrowserTarget": {
        const rootSession = await this.ensureRootSessionForPrimary();
        if (!rootSession) {
          this.respondError(command.id, "No tab attached");
          return;
        }
        const browserSessionId = await this.ensureBrowserSession(rootSession.tabId);
        this.respond(command.id, { sessionId: browserSessionId ?? rootSession.sessionId });
        return;
      }
      case "Target.sendMessageToTarget":
        this.respondError(command.id, DEPRECATED_SEND_MESSAGE);
        return;
      case "Target.setDiscoverTargets":
        await handleSetDiscoverTargets(ctx, command.id, commandParams);
        return;
      case "Target.getTargets":
        this.respond(command.id, { targetInfos: this.sessions.listTargetInfos() });
        return;
      case "Target.getTargetInfo": {
        const targetId = typeof commandParams.targetId === "string" ? commandParams.targetId : "";
        const targetInfo = this.resolveTargetInfo(targetId, sessionId);
        this.respond(command.id, { targetInfo });
        return;
      }
      case "Target.setAutoAttach":
        await handleSetAutoAttach(ctx, command.id, commandParams, sessionId);
        return;
      case "Target.createTarget":
        await handleCreateTarget(ctx, command.id, commandParams);
        return;
      case "Target.closeTarget":
        await handleCloseTarget(ctx, command.id, commandParams);
        return;
      case "Target.activateTarget":
        await handleActivateTarget(ctx, command.id, commandParams);
        return;
      case "Target.attachToTarget":
        await handleAttachToTarget(ctx, command.id, commandParams, sessionId);
        return;
      default:
        await handleRoutedCommand(ctx, command.id, method, commandParams, sessionId);
    }
  }

  markClientClosed(): void {
    this.clientResetPending = true;
  }

  private buildCommandContext(): RouterCommandContext {
    return {
      debuggees: this.debuggees,
      sessions: this.sessions,
      tabManager: this.tabManager,
      autoAttachOptions: this.autoAttachOptions,
      discoverTargets: this.discoverTargets,
      flatSessionError: FLAT_SESSION_ERROR,
      setAutoAttachOptions: (next) => {
        this.autoAttachOptions = next;
      },
      setDiscoverTargets: (value) => {
        this.discoverTargets = value;
      },
      applyDiscoverTargets: this.applyDiscoverTargets.bind(this),
      respond: this.respond.bind(this),
      respondError: this.respondError.bind(this),
      emitEvent: (method, params, sessionId) => {
        const tabId = sessionId
          ? this.sessions.getBySessionId(sessionId)?.tabId ?? this.primaryTabId
          : this.primaryTabId;
        if (typeof tabId === "number") {
          this.emitEvent(tabId, method, params, sessionId);
        }
      },
      emitTargetCreated: (targetInfo) => {
        const tabId = this.sessions.getByTargetId(targetInfo.targetId)?.tabId
          ?? this.rootTargetTabIds.get(targetInfo.targetId)
          ?? this.primaryTabId;
        if (typeof tabId === "number") {
          this.emitTargetCreated(tabId, targetInfo);
        }
      },
      emitRootAttached: this.emitRootAttached.bind(this),
      emitRootDetached: this.emitRootDetached.bind(this),
      resetRootAttached: this.resetRootAttached.bind(this),
      updatePrimaryTab: this.updatePrimaryTab.bind(this),
      detachTabState: this.detachTabState.bind(this),
      safeDetach: this.safeDetach.bind(this),
      attach: this.attach.bind(this),
      registerRootTab: this.registerRootTab.bind(this),
      refreshRootTargetInfo: this.refreshRootTargetInfo.bind(this),
      applyAutoAttach: this.applyAutoAttach.bind(this),
      sendCommand: this.sendCommand.bind(this),
      getPrimaryDebuggee: this.getPrimaryDebuggee.bind(this),
      resolveCommandDebuggee: this.resolveCommandDebuggee.bind(this)
    };
  }

  private async registerRootTab(tabId: number): Promise<TargetInfo> {
    const existing = this.sessions.getByTabId(tabId);
    const sessionId = existing?.rootSessionId ?? this.createRootSessionId();
    const targetInfo = await this.buildTargetInfo(tabId);
    const debuggerSession = await this.resolveRootSessionDebuggee(tabId);
    this.sessions.registerRootTab(tabId, targetInfo, sessionId, debuggerSession.targetId, debuggerSession);
    return targetInfo;
  }

  private async refreshRootTargetInfo(tabId: number): Promise<TargetInfo> {
    const existing = this.sessions.getByTabId(tabId);
    const sessionId = existing?.rootSessionId ?? this.createRootSessionId();
    const targetInfo = await this.buildTargetInfo(tabId);
    const debuggerSession = await this.resolveRootSessionDebuggee(tabId);
    const rootFrame = await this.readRootFrameInfo(tabId);
    const refreshed: TargetInfo = rootFrame
      ? {
        ...targetInfo,
        targetId: rootFrame.id,
        ...(rootFrame.url ? { url: rootFrame.url } : {})
      }
      : targetInfo;
    this.sessions.registerRootTab(tabId, refreshed, sessionId, debuggerSession.targetId, debuggerSession);
    return refreshed;
  }

  private async prepareForNextClientIfNeeded(): Promise<void> {
    if (!this.clientResetPending) {
      return;
    }

    const preferredTabId = await this.resolvePreferredResetTabId();
    this.clientResetPending = false;
    this.autoAttachOptions = { autoAttach: false, waitForDebuggerOnStart: false, flatten: true };
    this.discoverTargets = false;
    this.rootAttachedSessions.clear();
    this.pendingTargetTabIds.clear();
    this.quarantinedSessions.clear();
    this.churnTracker.clear();
    this.sessions.reset();

    for (const [tabId, debuggee] of Array.from(this.debuggees.entries())) {
      if (preferredTabId !== null && tabId === preferredTabId) {
        continue;
      }
      this.debuggees.delete(tabId);
      await this.safeDetach(debuggee);
    }

    if (preferredTabId === null) {
      this.primaryTabId = null;
      this.lastActiveTabId = null;
      if (this.debuggees.size === 0) {
        this.removeListeners();
      }
      return;
    }

    const attachedPrimary = this.debuggees.get(preferredTabId);
    if (attachedPrimary) {
      this.updatePrimaryTab(preferredTabId);
      await this.registerRootTab(preferredTabId);
      const refreshedRoot = this.sessions.getByTabId(preferredTabId);
      const refreshedSession = refreshedRoot
        ? this.sessions.getBySessionId(refreshedRoot.rootSessionId)
        : null;
      if (refreshedSession) {
        this.debuggees.set(preferredTabId, refreshedSession.debuggerSession);
      }
      return;
    }

    await this.attachInternal(preferredTabId, true);
  }

  private async resolvePreferredResetTabId(): Promise<number | null> {
    const candidateTabIds: number[] = [];
    const pushCandidate = (tabId: number | null) => {
      if (typeof tabId === "number" && !candidateTabIds.includes(tabId)) {
        candidateTabIds.push(tabId);
      }
    };

    pushCandidate(await this.tabManager.getActiveTabId());
    pushCandidate(this.lastActiveTabId);
    pushCandidate(this.primaryTabId);

    for (const tabId of candidateTabIds) {
      if (await this.isUsableResetTab(tabId)) {
        return tabId;
      }
    }

    const firstHttpTabId = await this.tabManager.getFirstHttpTabId();
    if (firstHttpTabId !== null) {
      return firstHttpTabId;
    }

    for (const tabId of candidateTabIds) {
      if (this.debuggees.has(tabId)) {
        return tabId;
      }
      const tab = await this.tabManager.getTab(tabId);
      if (tab) {
        return tabId;
      }
    }

    const [firstAttachedTabId] = this.debuggees.keys();
    return typeof firstAttachedTabId === "number" ? firstAttachedTabId : null;
  }

  private async isUsableResetTab(tabId: number): Promise<boolean> {
    const tab = await this.tabManager.getTab(tabId);
    if (!tab?.url) {
      return false;
    }
    try {
      return getRestrictionMessage(new URL(tab.url)) === null;
    } catch {
      return false;
    }
  }

  private updatePrimaryTab(tabId: number | null): void {
    if (tabId === this.primaryTabId) return;
    this.primaryTabId = tabId;
    if (tabId !== null) {
      this.lastActiveTabId = tabId;
    }
    this.callbacks?.onPrimaryTabChange?.(tabId);
  }

  private async pruneRootDebuggees(primaryTabId: number): Promise<void> {
    const displacedRoots = await this.detachConflictingRootDebuggees(primaryTabId);
    this.commitDetachedRootDebuggees(displacedRoots);
  }

  private async detachConflictingRootDebuggees(nextTabId: number): Promise<Array<{ tabId: number }>> {
    const staleTabIds = Array.from(this.debuggees.keys()).filter((tabId) => tabId !== nextTabId);
    const displacedRoots: Array<{ tabId: number }> = [];
    for (const staleTabId of staleTabIds) {
      const debuggee = this.debuggees.get(staleTabId);
      if (!debuggee) {
        continue;
      }
      this.debuggees.delete(staleTabId);
      this.markExpectedRootDetach(staleTabId);
      await this.safeDetach(debuggee);
      displacedRoots.push({ tabId: staleTabId });
    }
    return displacedRoots;
  }

  private commitDetachedRootDebuggees(detachedRoots: Array<{ tabId: number }>): void {
    for (const { tabId } of detachedRoots) {
      if (this.debuggees.has(tabId)) {
        continue;
      }
      this.detachTabState(tabId);
    }
  }

  private async restoreDetachedRootDebuggees(detachedRoots: Array<{ tabId: number }>): Promise<void> {
    for (const { tabId } of detachedRoots) {
      if (this.debuggees.has(tabId)) {
        return;
      }
      try {
        await this.attachInternal(tabId, false);
        return;
      } catch (error) {
        logError("cdp.restore_root_attach", error, {
          code: "restore_root_attach_failed",
          extra: { tabId }
        });
      }
    }
  }

  private selectFallbackPrimary(): number | null {
    if (this.lastActiveTabId && this.debuggees.has(this.lastActiveTabId)) {
      return this.lastActiveTabId;
    }
    const [first] = this.debuggees.keys();
    return first ?? null;
  }

  private getPrimaryDebuggee(): DebuggerSession | null {
    if (this.primaryTabId !== null) {
      const primary = this.debuggees.get(this.primaryTabId);
      if (primary) {
        return primary;
      }
    }
    const [first] = this.debuggees.values();
    return first ?? null;
  }

  private async resolveCommandDebuggee(sessionId?: string): Promise<DebuggerSession | null> {
    if (!sessionId) {
      return this.getPrimaryDebuggee();
    }
    const session = this.sessions.getBySessionId(sessionId);
    if (!session) {
      return null;
    }
    if (session.kind !== "root") {
      return session.debuggerSession;
    }
    if (typeof session.debuggerSession.targetId === "string" && session.debuggerSession.targetId.length > 0) {
      return session.debuggerSession;
    }
    const attached = await this.ensureAttachedRootSession(session.tabId);
    return attached ?? session.debuggerSession;
  }

  private async ensureRootSessionForPrimary(): Promise<{ tabId: number; sessionId: string; targetInfo: TargetInfo } | null> {
    const tabId = this.primaryTabId ?? this.resolveSourceTabId(this.getPrimaryDebuggee() ?? {});
    if (typeof tabId !== "number") {
      return null;
    }
    const existing = this.sessions.getByTabId(tabId);
    if (existing) {
      return { tabId, sessionId: existing.rootSessionId, targetInfo: existing.targetInfo };
    }
    const targetInfo = await this.registerRootTab(tabId);
    const refreshed = this.sessions.getByTabId(tabId);
    if (!refreshed) {
      return null;
    }
    return { tabId, sessionId: refreshed.rootSessionId, targetInfo: targetInfo ?? refreshed.targetInfo };
  }

  private async ensureAttachedRootSession(tabId: number): Promise<DebuggerSession | null> {
    return (await this.ensureAttachedRootSessionWithDiagnostic(tabId)).debuggerSession;
  }

  private async ensureAttachedRootSessionWithDiagnostic(tabId: number): Promise<AttachedRootRecoveryResult> {
    const existing = this.sessions.getAttachedRootSession(tabId);
    if (existing) {
      return {
        debuggerSession: existing.debuggerSession,
        stage: "attached"
      };
    }

    const record = this.sessions.getByTabId(tabId);
    if (!record) {
      return {
        debuggerSession: null,
        stage: "record_missing"
      };
    }

    const recordAttachTargetId = typeof record.attachTargetId === "string" && record.attachTargetId.length > 0
      ? record.attachTargetId
      : null;
    const retainedAttachTargetId = recordAttachTargetId ?? this.resolveRetainedRootTargetId(tabId);
    const liveAttachTargetId = retainedAttachTargetId
      ? null
      : await this.readDebuggerTargetId(tabId);
    const attachTargetId = retainedAttachTargetId ?? liveAttachTargetId;
    const attachTargetSource: ChildTargetAttachedRootRecoverySource | undefined = recordAttachTargetId
      ? "record"
      : retainedAttachTargetId
        ? "debuggee"
        : liveAttachTargetId
          ? "debugger"
          : undefined;
    if (!attachTargetId) {
      return {
        debuggerSession: null,
        stage: "session_missing"
      };
    }
    if (recordAttachTargetId !== attachTargetId) {
      this.sessions.setRootAttachTargetId(tabId, attachTargetId);
    }

    try {
      const attached = await this.sendCommandOnce(
        { tabId },
        "Target.attachToTarget",
        {
          targetId: attachTargetId,
          flatten: true
        }
      );
      const sessionRecord = isRecord(attached) ? attached : {};
      const attachedSessionId = typeof sessionRecord.sessionId === "string" ? sessionRecord.sessionId : null;
      if (!attachedSessionId) {
        return {
          debuggerSession: null,
          stage: "attach_null",
          ...(attachTargetSource ? { attachTargetSource } : {})
        };
      }

      const attachedRecord = this.sessions.registerAttachedRootSession(tabId, attachedSessionId);
      if (attachedRecord?.debuggerSession) {
        attachedRecord.debuggerSession.targetId = attachTargetId;
      }
      return {
        debuggerSession: attachedRecord?.debuggerSession ?? {
          tabId,
          sessionId: attachedSessionId,
          targetId: attachTargetId
        },
        stage: "attached",
        ...(attachTargetSource ? { attachTargetSource } : {})
      };
    } catch (error) {
      return {
        debuggerSession: null,
        stage: "attach_failed",
        ...(attachTargetSource ? { attachTargetSource } : {}),
        reason: getErrorMessage(error)
      };
    }
  }

  private async resolveRootSessionDebuggee(tabId: number): Promise<DebuggerSession> {
    await this.syncLiveRootTargetId(tabId);
    const attachedDebuggee = this.debuggees.get(tabId);
    if (attachedDebuggee?.targetId) {
      return attachedDebuggee;
    }
    const attachedRootSession = this.sessions.getAttachedRootSession(tabId);
    if (attachedRootSession?.debuggerSession) {
      return attachedRootSession.debuggerSession;
    }
    const existing = this.sessions.getByTabId(tabId);
    const existingSession = existing ? this.sessions.getBySessionId(existing.rootSessionId) : null;
    if (existingSession?.debuggerSession?.targetId) {
      return existingSession.debuggerSession;
    }
    return await this.resolveRootDebuggee(tabId);
  }

  private async syncLiveRootTargetId(tabId: number): Promise<void> {
    const liveTargetId = await this.readDebuggerTargetId(tabId);
    if (!liveTargetId) {
      return;
    }
    this.rootTargetTabIds.set(liveTargetId, tabId);
    this.sessions.setRootAttachTargetId(tabId, liveTargetId);

    const attachedDebuggee = this.debuggees.get(tabId);
    if (attachedDebuggee) {
      attachedDebuggee.targetId = liveTargetId;
    }

    const rootRecord = this.sessions.getByTabId(tabId);
    const rootSession = rootRecord
      ? this.sessions.getBySessionId(rootRecord.rootSessionId)
      : null;
    if (rootSession?.debuggerSession) {
      rootSession.debuggerSession.targetId = liveTargetId;
    }

    const attachedRootSession = this.sessions.getAttachedRootSession(tabId);
    if (attachedRootSession?.debuggerSession) {
      attachedRootSession.debuggerSession.targetId = liveTargetId;
    }
  }

  private async resolveRootDebuggee(tabId: number): Promise<DebuggerSession> {
    const attachTargetId = await this.readDebuggerTargetId(tabId);
    if (attachTargetId) {
      this.rootTargetTabIds.set(attachTargetId, tabId);
      return { tabId, targetId: attachTargetId };
    }
    return { tabId };
  }

  private async attachChildTargetWithDebuggee(debuggee: DebuggerSession, targetId: string): Promise<string | null> {
    const result = await this.sendCommandOnce(
      debuggee,
      "Target.attachToTarget",
      { targetId, flatten: true }
    );
    const record = isRecord(result) ? result : {};
    const childSessionId = typeof record.sessionId === "string" ? record.sessionId : null;
    if (!childSessionId || typeof debuggee.tabId !== "number") {
      return childSessionId;
    }
    const targetInfo = this.resolveTargetInfo(targetId) ?? {
      targetId,
      type: "page",
      browserContextId: DEFAULT_BROWSER_CONTEXT_ID
    };
    this.sessions.registerChildSession(debuggee.tabId, targetInfo, childSessionId);
    return childSessionId;
  }

  private async attachChildTargetWithRootTargetId(
    debuggee: DebuggerSession,
    targetId: string,
    priorError?: unknown
  ): Promise<ChildTargetRootTargetRetryResult> {
    if (typeof debuggee.sessionId === "string" || typeof debuggee.tabId !== "number") {
      return {
        sessionId: null,
        stage: "missing_root_target_id"
      };
    }
    const rootTargetId = typeof debuggee.targetId === "string" && debuggee.targetId.length > 0
      ? debuggee.targetId
      : null;
    if (!rootTargetId) {
      return {
        sessionId: null,
        stage: "missing_root_target_id"
      };
    }
    try {
      const result = await this.sendCommandOnce(
        { targetId: rootTargetId },
        "Target.attachToTarget",
        {
          targetId,
          flatten: true
        }
      );
      const record = isRecord(result) ? result : {};
      const childSessionId = typeof record.sessionId === "string" ? record.sessionId : null;
      if (!childSessionId) {
        return {
          sessionId: null,
          stage: "attach_null"
        };
      }
      const targetInfo = this.resolveTargetInfo(targetId) ?? {
        targetId,
        type: "page",
        browserContextId: DEFAULT_BROWSER_CONTEXT_ID
      };
      this.sessions.registerChildSession(debuggee.tabId, targetInfo, childSessionId);
      return {
        sessionId: childSessionId,
        stage: "attached"
      };
    } catch (error) {
      if (priorError && isAttachBlockedError(priorError) && isAttachBlockedError(error)) {
        return {
          sessionId: null,
          stage: "attach_blocked",
          reason: getErrorMessage(error)
        };
      }
      if (priorError && this.isStaleTabError(priorError) && this.isStaleTabError(error)) {
        return {
          sessionId: null,
          stage: "attach_blocked",
          reason: getErrorMessage(error)
        };
      }
      throw error;
    }
  }

  private async reattachRootAndAttachChildTarget(tabId: number, targetId: string): Promise<string | null> {
    try {
      const tabScopedRootDebuggee = await this.reattachTabScopedRootDebuggeeForPopup(tabId);
      try {
        return await this.attachChildTargetWithDebuggee(tabScopedRootDebuggee, targetId);
      } catch (tabScopedError) {
        if (!isAttachBlockedError(tabScopedError) && !this.isStaleTabError(tabScopedError)) {
          throw tabScopedError;
        }
      }
      await this.reattachRootDebuggee(tabId);
      const rootDebuggee = await this.resolveRootSessionDebuggee(tabId);
      return await this.attachChildTargetWithDebuggee(rootDebuggee, targetId);
    } catch {
      await this.restoreRootAfterChildAttachFailure(tabId);
      return null;
    }
  }

  private async reattachTabScopedRootDebuggeeForPopup(tabId: number): Promise<DebuggerSession> {
    const existing = this.debuggees.get(tabId);
    this.debuggees.delete(tabId);
    this.detachTabState(tabId);
    if (existing) {
      this.markExpectedRootDetach(tabId);
      await this.safeDetach(existing);
    }
    this.ensureListeners();

    const resolvedRootDebuggee = await this.resolveRootDebuggee(tabId);
    const tabScopedDebuggee: DebuggerSession = typeof resolvedRootDebuggee.targetId === "string" && resolvedRootDebuggee.targetId.length > 0
      ? { tabId, targetId: resolvedRootDebuggee.targetId }
      : { tabId };
    await this.attachRootDebuggee(tabScopedDebuggee);
    this.debuggees.set(tabId, tabScopedDebuggee);
    await this.registerRootTab(tabId);
    this.updatePrimaryTab(tabId);
    return await this.resolveRootSessionDebuggee(tabId);
  }

  private async restoreRootAfterChildAttachFailure(tabId: number): Promise<void> {
    try {
      await this.refreshTabAttachment(tabId);
    } catch {
      // Best-effort root restoration only. The original popup attach error remains authoritative.
    }
  }

  private async reattachRootDebuggee(tabId: number, allowRetry: boolean = false): Promise<void> {
    const existing = this.debuggees.get(tabId);
    this.debuggees.delete(tabId);
    this.detachTabState(tabId);
    if (existing) {
      this.markExpectedRootDetach(tabId);
      await this.safeDetach(existing);
    }
    await this.attachInternal(tabId, allowRetry);
  }

  private async readDebuggerPageTargets(tabId: number): Promise<{ tab: chrome.tabs.Tab | null; pageTargets: DebuggerTargetInfo[] }> {
    const tab = await this.tabManager.getTab(tabId);
    const targets = await new Promise<DebuggerTargetInfo[]>((resolve) => {
      chrome.debugger.getTargets((records) => {
        const lastError = chrome.runtime.lastError;
        if (lastError || !Array.isArray(records)) {
          resolve([]);
          return;
        }
        resolve(records as DebuggerTargetInfo[]);
      });
    });
    const pageTargets = targets.filter((target) => target.tabId === tabId && target.type === "page");
    return { tab: tab ?? null, pageTargets };
  }

  private selectPreferredDebuggerTargetInfo(
    tab: chrome.tabs.Tab | null,
    pageTargets: DebuggerTargetInfo[]
  ): DebuggerTargetInfo | null {
    if (pageTargets.length === 0) {
      return null;
    }
    const preferredByUrl = typeof tab?.url === "string"
      ? pageTargets.find((target) => target.url === tab.url)
      : null;
    const preferredByTitle = typeof tab?.title === "string"
      ? pageTargets.find((target) => target.title === tab.title)
      : null;
    return preferredByUrl ?? preferredByTitle ?? pageTargets[0] ?? null;
  }

  private async readDebuggerTargetInfo(tabId: number): Promise<DebuggerTargetInfo | null> {
    const { tab, pageTargets } = await this.readDebuggerPageTargets(tabId);
    return this.selectPreferredDebuggerTargetInfo(tab, pageTargets);
  }

  private async readDebuggerTargetId(tabId: number): Promise<string | null> {
    return (await this.readDebuggerTargetInfo(tabId))?.id ?? null;
  }

  private resolveTargetInfo(targetId: string, sessionId?: string): TargetInfo | null {
    if (targetId) {
      const record = this.sessions.getByTargetId(targetId);
      return record?.targetInfo
        ?? (record?.kind === "root" ? this.sessions.getByTabId(record.tabId)?.targetInfo ?? null : null);
    }

    if (sessionId) {
      const session = this.sessions.getBySessionId(sessionId);
      return session?.targetInfo
        ?? (session?.kind === "root" ? this.sessions.getByTabId(session.tabId)?.targetInfo ?? null : null);
    }

    return {
      targetId: DEFAULT_BROWSER_TARGET_ID,
      type: "browser",
      title: "OpenDevBrowser Relay",
      url: ""
    };
  }

  private ensureListeners(): void {
    if (this.listenersActive) return;
    chrome.debugger.onEvent.addListener(this.handleEventBound);
    chrome.debugger.onDetach.addListener(this.handleDetachBound);
    this.listenersActive = true;
  }

  private removeListeners(): void {
    if (!this.listenersActive) return;
    chrome.debugger.onEvent.removeListener(this.handleEventBound);
    chrome.debugger.onDetach.removeListener(this.handleDetachBound);
    this.listenersActive = false;
  }

  private async ensureFlatSessionSupport(debuggee: chrome.debugger.Debuggee): Promise<void> {
    if (this.flatSessionValidated) return;
    try {
      await this.sendCommand(
        debuggee,
        "Target.setAutoAttach",
        {
          autoAttach: false,
          waitForDebuggerOnStart: false,
          flatten: true
        },
        { preserveTab: true }
      );
      this.flatSessionValidated = true;
    } catch (error) {
      const detail = getErrorMessage(error);
      console.warn(`[opendevbrowser] Target.setAutoAttach(flatten) failed: ${detail}`);
      throw new Error(`${FLAT_SESSION_ERROR} (${detail})`);
    }
  }

  private async applyDiscoverTargets(debuggee: DebuggerSession, discover: boolean): Promise<void> {
    await this.sendCommand(debuggee, "Target.setDiscoverTargets", { discover }, { preserveTab: true });
  }

  private async applyAutoAttach(debuggee: chrome.debugger.Debuggee): Promise<void> {
    const params: Record<string, unknown> = {
      autoAttach: this.autoAttachOptions.autoAttach,
      waitForDebuggerOnStart: this.autoAttachOptions.waitForDebuggerOnStart,
      flatten: true
    };
    if (typeof this.autoAttachOptions.filter !== "undefined") {
      params.filter = this.autoAttachOptions.filter;
    }
    try {
      await this.sendCommand(debuggee, "Target.setAutoAttach", params, { preserveTab: true });
    } catch (error) {
      const detail = getErrorMessage(error);
      console.warn(`[opendevbrowser] Target.setAutoAttach failed: ${detail}`);
      throw new Error(`${FLAT_SESSION_ERROR} (${detail})`);
    }
  }

  private async applyAutoAttachToChild(tabId: number, sessionId: string): Promise<void> {
    if (!this.autoAttachOptions.autoAttach) return;
    const params: Record<string, unknown> = {
      autoAttach: true,
      waitForDebuggerOnStart: this.autoAttachOptions.waitForDebuggerOnStart,
      flatten: true
    };
    if (typeof this.autoAttachOptions.filter !== "undefined") {
      params.filter = this.autoAttachOptions.filter;
    }
    await this.sendCommand({ tabId, sessionId }, "Target.setAutoAttach", params);
  }

  private recordSessionChurn(tabId: number, sessionId: string, reason: string): void {
    const now = Date.now();
    const existing = this.churnTracker.get(tabId);
    const record = !existing || now > existing.resetAt
      ? { count: 0, resetAt: now + this.churnWindowMs }
      : existing;
    record.count += 1;
    this.churnTracker.set(tabId, record);

    const quarantined = this.quarantinedSessions.get(sessionId);
    if (!quarantined) {
      this.quarantinedSessions.set(sessionId, { tabId, count: 1, lastSeen: now });
    }

    if (record.count >= this.churnThreshold) {
      this.churnTracker.delete(tabId);
      this.reapplyAutoAttach(tabId, reason).catch((error) => {
        logError("cdp.reapply_auto_attach", error, { code: "auto_attach_failed" });
      });
    }
  }

  private quarantineUnknownSession(tabId: number, sessionId: string, method: string): void {
    const now = Date.now();
    const existing = this.quarantinedSessions.get(sessionId);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
      return;
    }
    this.quarantinedSessions.set(sessionId, { tabId, count: 1, lastSeen: now });
    this.recordSessionChurn(tabId, sessionId, `unknown_${method}`);
  }

  private async reapplyAutoAttach(tabId: number, reason: string): Promise<void> {
    if (!this.autoAttachOptions.autoAttach) return;
    const debuggee = this.debuggees.get(tabId);
    if (!debuggee) return;
    try {
      await this.applyAutoAttach(debuggee);
    } catch (error) {
      const detail = getErrorMessage(error);
      console.warn(`[opendevbrowser] Auto-attach retry failed (${reason}): ${detail}`);
    }
  }

  private handleEvent(source: chrome.debugger.Debuggee, method: string, params?: object): void {
    if (!this.callbacks) return;
    const tabId = this.resolveEventTabId(source, params);
    if (tabId === null || !this.debuggees.has(tabId)) return;
    if (method === "Target.receivedMessageFromTarget") return;

    if (method === "Target.targetCreated" && params && isRecord(params)) {
      const targetInfo = isTargetInfo(params.targetInfo) ? params.targetInfo : null;
      if (targetInfo) {
        this.pendingTargetTabIds.set(targetInfo.targetId, tabId);
      }
    }

    if (method === "Target.attachedToTarget" && params && isRecord(params)) {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      const targetInfo = isTargetInfo(params.targetInfo) ? params.targetInfo : null;
      if (sessionId && targetInfo) {
        this.pendingTargetTabIds.delete(targetInfo.targetId);
        if (this.isAttachedRootTarget(tabId, targetInfo)) {
          this.sessions.setRootAttachTargetId(tabId, targetInfo.targetId);
          this.sessions.registerAttachedRootSession(tabId, sessionId);
        } else {
          this.sessions.registerChildSession(tabId, targetInfo, sessionId);
        }
        this.quarantinedSessions.delete(sessionId);
        this.applyAutoAttachToChild(tabId, sessionId).catch((error) => {
          logError("cdp.apply_auto_attach_child", error, { code: "auto_attach_failed" });
        });
      } else if (sessionId) {
        this.recordSessionChurn(tabId, sessionId, "attach_missing_target");
      }
    }

    if (method === "Target.detachedFromTarget" && params && isRecord(params)) {
      const detachedSessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      const detachedTargetId = typeof params.targetId === "string" ? params.targetId : null;
      if (detachedTargetId) {
        this.pendingTargetTabIds.delete(detachedTargetId);
      }
      if (detachedSessionId) {
        const removed = this.sessions.removeBySessionId(detachedSessionId);
        if (!removed) {
          this.recordSessionChurn(tabId, detachedSessionId, "detach_unknown");
          this.quarantineUnknownSession(tabId, detachedSessionId, method);
          return;
        }
      }
    }

    if (method === "Target.targetDestroyed" && params && isRecord(params)) {
      const targetId = typeof params.targetId === "string" ? params.targetId : null;
      if (targetId) {
        this.pendingTargetTabIds.delete(targetId);
      }
    }

    const sourceSessionId = (source as { sessionId?: string }).sessionId;
    if (typeof sourceSessionId === "string" && !this.sessions.hasSession(sourceSessionId)) {
      this.quarantineUnknownSession(tabId, sourceSessionId, method);
      return;
    }

    const forwardSessionId = this.resolveForwardSessionId(method, source);
    this.emitEvent(tabId, method, params, forwardSessionId);
  }

  private handleDetach(source: chrome.debugger.Debuggee, reason?: string): void {
    if (this.consumeExpectedRootDetach(source)) return;
    const tabId = this.resolveSourceTabId(source);
    if (tabId === null || !this.debuggees.has(tabId)) return;
    this.debuggees.delete(tabId);
    this.detachTabState(tabId);

    if (this.debuggees.size === 0) {
      this.removeListeners();
      this.callbacks?.onDetach({ tabId, reason });
    }
  }

  private detachTabState(tabId: number): void {
    this.expectedRootDetachDeadlines.delete(tabId);
    this.clearRootAttachDiagnostic(tabId);
    const record = this.sessions.removeByTabId(tabId);
    for (const [key, diagnostic] of this.childAttachDiagnostics.entries()) {
      if (diagnostic.tabId === tabId) {
        this.childAttachDiagnostics.delete(key);
      }
    }
    for (const [targetId, mappedTabId] of this.pendingTargetTabIds.entries()) {
      if (mappedTabId === tabId) {
        this.pendingTargetTabIds.delete(targetId);
      }
    }
    if (record) {
      if (record.attachTargetId) {
        this.rootTargetTabIds.delete(record.attachTargetId);
      }
      this.rootAttachedSessions.delete(record.rootSessionId);
      if (this.autoAttachOptions.autoAttach) {
        this.emitTargetDetached(record.tabId, record.rootSessionId, record.targetInfo.targetId);
      }
      if (this.discoverTargets) {
        this.emitTargetDestroyed(record.tabId, record.targetInfo.targetId);
      }
    }

    if (tabId === this.primaryTabId) {
      const next = this.selectFallbackPrimary();
      this.updatePrimaryTab(next);
    }
  }

  private resolveForwardSessionId(method: string, source: chrome.debugger.Debuggee): string | undefined {
    if (method === "Target.attachedToTarget" || method === "Target.detachedFromTarget") {
      return undefined;
    }
    const sessionId = (source as { sessionId?: string }).sessionId;
    if (typeof sessionId === "string") {
      return this.sessions.getBySessionId(sessionId) ? sessionId : undefined;
    }
    const tabId = this.resolveSourceTabId(source);
    if (tabId === null) return undefined;
    const record = this.sessions.getByTabId(tabId);
    if (!record) return undefined;
    const browserSession = this.sessions.getBrowserSession(tabId);
    if (browserSession) {
      return browserSession.sessionId;
    }
    return this.rootAttachedSessions.has(record.rootSessionId) ? record.rootSessionId : undefined;
  }

  private resolveEventTabId(source: chrome.debugger.Debuggee, params?: object): number | null {
    const sourceTabId = this.resolveSourceTabId(source);
    if (sourceTabId !== null) {
      return sourceTabId;
    }
    if (!params || !isRecord(params)) {
      return null;
    }
    const targetInfo = isTargetInfo(params.targetInfo) ? params.targetInfo : null;
    const openerTabId = this.resolveLinkedTargetTabId(targetInfo?.openerId);
    if (openerTabId !== null) {
      if (targetInfo) {
        this.pendingTargetTabIds.set(targetInfo.targetId, openerTabId);
      }
      return openerTabId;
    }
    if (targetInfo) {
      const targetTabId = this.resolveLinkedTargetTabId(targetInfo.targetId);
      if (targetTabId !== null) {
        return targetTabId;
      }
    }
    const targetId = typeof params.targetId === "string" ? params.targetId : null;
    if (targetId) {
      return this.resolveLinkedTargetTabId(targetId);
    }
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    if (sessionId) {
      return this.sessions.getBySessionId(sessionId)?.tabId ?? null;
    }
    return null;
  }

  private resolveSourceTabId(source: chrome.debugger.Debuggee): number | null {
    if (typeof source.tabId === "number") {
      return source.tabId;
    }
    const sourceSessionId = (source as { sessionId?: string }).sessionId;
    if (typeof sourceSessionId === "string") {
      return this.sessions.getBySessionId(sourceSessionId)?.tabId ?? null;
    }
    if (typeof source.targetId === "string") {
      return this.resolveLinkedTargetTabId(source.targetId);
    }
    return null;
  }

  private resolveLinkedTargetTabId(targetId?: string): number | null {
    if (typeof targetId !== "string" || targetId.length === 0) {
      return null;
    }
    return this.rootTargetTabIds.get(targetId)
      ?? this.sessions.getByTargetId(targetId)?.tabId
      ?? this.sessions.getTabIdByTargetAlias(targetId)
      ?? this.pendingTargetTabIds.get(targetId)
      ?? null;
  }

  private isAttachedRootTarget(tabId: number, targetInfo: TargetInfo): boolean {
    if (targetInfo.type !== "page") {
      return false;
    }
    const record = this.sessions.getByTabId(tabId);
    if (!record) {
      return false;
    }
    if (record.attachTargetId && targetInfo.targetId === record.attachTargetId) {
      return true;
    }
    if (targetInfo.targetId === record.targetInfo.targetId) {
      return true;
    }
    if (record.targetInfo.url && targetInfo.url === record.targetInfo.url) {
      return true;
    }
    if (record.targetInfo.title && targetInfo.title === record.targetInfo.title) {
      return true;
    }
    return false;
  }

  private childAttachDiagnosticKey(tabId: number, targetId: string): string {
    return `${tabId}:${targetId}`;
  }

  private resolveRootAttachBy(debuggee: DebuggerSession): NonNullable<DebuggerSession["attachBy"]> {
    return debuggee.attachBy === "targetId" ? "targetId" : "tabId";
  }

  private clearRootAttachDiagnostic(tabId: number): void {
    this.rootAttachDiagnostics.delete(tabId);
  }

  private recordRootAttachDiagnostic(
    tabId: number,
    diagnostic: Omit<RootAttachDiagnostic, "tabId" | "at">
  ): void {
    this.rootAttachDiagnostics.set(tabId, {
      tabId,
      at: Date.now(),
      ...diagnostic
    });
  }

  private clearChildAttachDiagnostic(tabId: number, targetId: string): void {
    this.childAttachDiagnostics.delete(this.childAttachDiagnosticKey(tabId, targetId));
  }

  private recordChildAttachDiagnostic(
    tabId: number,
    targetId: string,
    diagnostic: Omit<ChildTargetAttachDiagnostic, "tabId" | "targetId" | "at">
  ): void {
    this.childAttachDiagnostics.set(this.childAttachDiagnosticKey(tabId, targetId), {
      tabId,
      targetId,
      at: Date.now(),
      ...diagnostic
    });
  }

  private async captureRootRefreshDiagnostic(
    tabId: number,
    path: RootRefreshPath,
    refreshCompleted: boolean,
    error?: unknown
  ): Promise<void> {
    const attachedDebuggee = this.debuggees.get(tabId) ?? null;
    const rootRecord = this.sessions.getByTabId(tabId);
    const rootSession = rootRecord
      ? this.sessions.getBySessionId(rootRecord.rootSessionId)
      : null;
    const debuggee = attachedDebuggee ?? rootSession?.debuggerSession ?? null;
    const rootTargetIdAfterRefresh = typeof debuggee?.targetId === "string" && debuggee.targetId.length > 0
      ? debuggee.targetId
      : undefined;

    let probeStage: RootRefreshProbeStage = refreshCompleted ? "missing_debuggee" : "skipped";
    let probeReason: string | undefined;
    if (refreshCompleted && debuggee) {
      try {
        await this.sendCommandOnce(debuggee, "Target.getTargets", {});
        probeStage = "succeeded";
      } catch (probeError) {
        probeStage = "failed";
        probeReason = getErrorMessage(probeError);
      }
    }

    this.rootRefreshDiagnostics.set(tabId, {
      tabId,
      path,
      refreshCompleted,
      debuggeePresentAfterRefresh: attachedDebuggee !== null,
      rootSessionPresentAfterRefresh: rootSession !== null,
      ...(rootTargetIdAfterRefresh ? { rootTargetIdAfterRefresh } : {}),
      probeMethod: "Target.getTargets",
      probeStage,
      ...(probeReason ? { probeReason } : {}),
      ...(error ? { reason: getErrorMessage(error) } : {}),
      at: Date.now()
    });
  }

  private async buildTargetInfo(tabId: number): Promise<TargetInfo> {
    const tab = await this.tabManager.getTab(tabId);
    return {
      targetId: `tab-${tabId}`,
      type: "page",
      browserContextId: DEFAULT_BROWSER_CONTEXT_ID,
      title: tab?.title ?? undefined,
      url: tab?.url ?? undefined
    };
  }

  private async readRootFrameInfo(tabId: number): Promise<{ id: string; url?: string } | null> {
    try {
      const result = await Promise.race([
        this.sendCommand({ tabId }, "Page.getFrameTree", {}, { preserveTab: true }),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 750);
        })
      ]);
      const rootFrame = readRootFrame(result);
      if (!rootFrame) {
        return null;
      }
      return rootFrame;
    } catch {
      return null;
    }
  }

  private emitTargetCreated(tabId: number, targetInfo: TargetInfo): void {
    this.emitEvent(tabId, "Target.targetCreated", { targetInfo });
  }

  private emitTargetDestroyed(tabId: number, targetId: string): void {
    this.emitEvent(tabId, "Target.targetDestroyed", { targetId });
  }

  private emitTargetDetached(tabId: number, sessionId: string, targetId: string): void {
    this.emitEvent(tabId, "Target.detachedFromTarget", { sessionId, targetId });
  }

  private emitRootAttached(targetInfo: TargetInfo): void {
    const record = this.sessions.getByTargetId(targetInfo.targetId);
    if (!record || record.kind !== "root") return;
    if (this.rootAttachedSessions.has(record.sessionId)) return;
    this.rootAttachedSessions.add(record.sessionId);
    this.emitEvent(record.tabId, "Target.attachedToTarget", {
      sessionId: record.sessionId,
      targetInfo,
      waitingForDebugger: false
    });
  }

  private emitRootDetached(): void {
    for (const targetInfo of this.sessions.listTargetInfos()) {
      const record = this.sessions.getByTargetId(targetInfo.targetId);
      if (!record || record.kind !== "root") continue;
      if (!this.rootAttachedSessions.has(record.sessionId)) continue;
      this.rootAttachedSessions.delete(record.sessionId);
      this.emitTargetDetached(record.tabId, record.sessionId, targetInfo.targetId);
    }
  }

  private resetRootAttached(): void {
    this.rootAttachedSessions.clear();
  }

  private createRootSessionId(): string {
    const sessionId = `pw-tab-${this.sessionCounter}`;
    this.sessionCounter += 1;
    return sessionId;
  }

  private createBrowserSessionId(): string {
    const sessionId = `pw-browser-${this.sessionCounter}`;
    this.sessionCounter += 1;
    return sessionId;
  }

  private async ensureBrowserSession(tabId: number): Promise<string | null> {
    const existing = this.sessions.getBrowserSession(tabId);
    if (existing) {
      return existing.sessionId;
    }
    const browserSessionId = this.createBrowserSessionId();
    return this.sessions.registerBrowserSession(tabId, browserSessionId)?.sessionId ?? null;
  }

  async sendCommand(
    debuggee: DebuggerSession,
    method: string,
    params: Record<string, unknown>,
    options: SendCommandOptions = {}
  ): Promise<unknown> {
    await this.prepareForNextClientIfNeeded();
    try {
      return await this.sendCommandOnce(debuggee, method, params);
    } catch (error) {
      const hasChildSession = typeof (debuggee as { sessionId?: unknown }).sessionId === "string";
      if (!this.isStaleTabError(error) || hasChildSession) {
        throw error;
      }

      const retainedRootDebuggee = this.resolveRetainedRootTargetDebuggee(debuggee);
      if (retainedRootDebuggee) {
        try {
          return await this.sendCommandOnce(retainedRootDebuggee, method, params);
        } catch (retainedError) {
          if (!this.isStaleTabError(retainedError)) {
            throw retainedError;
          }
          error = retainedError;
        }
      }

      const recovered = await this.recoverFromStaleTab(debuggee, options.preserveTab === true);
      if (!recovered) {
        throw error;
      }
      return await this.sendCommandOnce(recovered, method, params);
    }
  }

  private async sendCommandOnce(debuggee: DebuggerSession, method: string, params: Record<string, unknown>): Promise<unknown> {
    const chromeDebuggee = this.toChromeDebuggee(debuggee);
    const sendCommandFn = chrome.debugger.sendCommand as unknown as { mock?: unknown };
    if (!("mock" in sendCommandFn) || chrome.debugger.sendCommand.length < 4) {
      return await (chrome.debugger.sendCommand as unknown as (
        debuggee: chrome.debugger.Debuggee,
        method: string,
        commandParams?: Record<string, unknown>
      ) => Promise<unknown>)(chromeDebuggee, method, params);
    }
    return await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(chromeDebuggee, method, params, (result) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(result);
      });
    });
  }

  private resolveRetainedRootTargetDebuggee(debuggee: DebuggerSession): DebuggerSession | null {
    if (typeof debuggee.sessionId === "string") {
      return null;
    }
    const staleTabId = typeof debuggee.tabId === "number"
      ? debuggee.tabId
      : (typeof debuggee.targetId === "string" ? this.rootTargetTabIds.get(debuggee.targetId) ?? null : null);
    if (staleTabId === null) {
      return null;
    }

    const targetId = this.resolveRetainedRootTargetId(staleTabId);
    if (!targetId) {
      return null;
    }
    if (typeof debuggee.targetId === "string" && debuggee.targetId === targetId && typeof debuggee.tabId !== "number") {
      return null;
    }
    return { targetId };
  }

  private resolveRetainedRootTargetId(tabId: number): string | null {
    const attachedDebuggee = this.debuggees.get(tabId);
    if (typeof attachedDebuggee?.targetId === "string" && attachedDebuggee.targetId.length > 0) {
      return attachedDebuggee.targetId;
    }

    const rootRecord = this.sessions.getByTabId(tabId);
    const rootSession = rootRecord
      ? this.sessions.getBySessionId(rootRecord.rootSessionId)
      : null;
    if (typeof rootSession?.debuggerSession?.targetId === "string" && rootSession.debuggerSession.targetId.length > 0) {
      return rootSession.debuggerSession.targetId;
    }
    if (typeof rootRecord?.attachTargetId === "string" && rootRecord.attachTargetId.length > 0) {
      return rootRecord.attachTargetId;
    }
    return null;
  }

  private async recoverFromStaleTab(debuggee: DebuggerSession, preserveTab: boolean): Promise<DebuggerSession | null> {
    const staleTabId = typeof debuggee.tabId === "number"
      ? debuggee.tabId
      : (typeof debuggee.targetId === "string" ? this.rootTargetTabIds.get(debuggee.targetId) ?? null : null);
    if (staleTabId === null) {
      return null;
    }

    try {
      await this.reattachRootDebuggee(staleTabId, !preserveTab);
    } catch {
      return null;
    }

    return preserveTab
      ? this.debuggees.get(staleTabId) ?? null
      : this.debuggees.get(staleTabId) ?? this.getPrimaryDebuggee();
  }

  private isStaleTabError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return STALE_TAB_ERROR_MARKERS.some((marker) => message.includes(marker));
  }

  private markExpectedRootDetach(tabId: number): void {
    this.expectedRootDetachDeadlines.set(tabId, Date.now() + 1000);
  }

  private consumeExpectedRootDetach(source: chrome.debugger.Debuggee): boolean {
    const tabId = this.resolveSourceTabId(source);
    if (tabId === null) {
      return false;
    }
    const deadline = this.expectedRootDetachDeadlines.get(tabId);
    if (typeof deadline !== "number") {
      return false;
    }
    const sourceSessionId = (source as { sessionId?: string }).sessionId;
    if (typeof sourceSessionId === "string") {
      return false;
    }
    this.expectedRootDetachDeadlines.delete(tabId);
    return deadline >= Date.now();
  }

  private toChromeDebuggee(debuggee: DebuggerSession): chrome.debugger.Debuggee {
    if (typeof debuggee.sessionId === "string") {
      if (typeof debuggee.targetId === "string" && debuggee.targetId.length > 0) {
        return { targetId: debuggee.targetId, sessionId: debuggee.sessionId } as chrome.debugger.Debuggee;
      }
      return { tabId: debuggee.tabId as number, sessionId: debuggee.sessionId } as chrome.debugger.Debuggee;
    }
    if (debuggee.attachBy === "targetId" && typeof debuggee.targetId === "string" && debuggee.targetId.length > 0) {
      return { targetId: debuggee.targetId } as chrome.debugger.Debuggee;
    }
    if (typeof debuggee.tabId === "number") {
      return { tabId: debuggee.tabId } as chrome.debugger.Debuggee;
    }
    return { targetId: debuggee.targetId as string } as chrome.debugger.Debuggee;
  }

  private async runDebuggerAction(action: (done: () => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      action(() => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  private async safeDetach(debuggee: DebuggerSession): Promise<void> {
    try {
      await this.runDebuggerAction((done) => {
        chrome.debugger.detach(this.toChromeDebuggee(debuggee), done);
      });
    } catch (error) {
      logError("cdp.safe_detach", error, { code: "detach_failed" });
    }
  }

  private respond(id: RelayResponse["id"], result: unknown, sessionId?: string): void {
    if (!this.callbacks) return;
    this.callbacks.onResponse({ id, result, ...(sessionId ? { sessionId } : {}) });
  }

  private respondError(id: RelayResponse["id"], message: string, sessionId?: string): void {
    if (!this.callbacks) return;
    this.callbacks.onResponse({ id, error: { message }, ...(sessionId ? { sessionId } : {}) });
  }

  private emitEvent(tabId: number, method: string, params?: unknown, sessionId?: string): void {
    const event: CDPRouterEvent = { tabId, method, ...(typeof params !== "undefined" ? { params } : {}), ...(sessionId ? { sessionId } : {}) };
    for (const listener of this.eventListeners) {
      listener(event);
    }
    if (!this.callbacks) return;
    const payload: RelayEvent["params"] = { method, ...(typeof params !== "undefined" ? { params } : {}) };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    this.callbacks.onEvent({ method: "forwardCDPEvent", params: payload });
  }
}

const isTargetInfo = (value: unknown): value is TargetInfo => {
  return isRecord(value) && typeof value.targetId === "string" && typeof value.type === "string";
};

const isAttachBlockedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Not allowed");
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readRootFrame = (value: unknown): { id: string; url?: string } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const frameTree = value.frameTree;
  if (!isRecord(frameTree)) {
    return null;
  }
  const frame = frameTree.frame;
  if (!isRecord(frame) || typeof frame.id !== "string") {
    return null;
  }
  return {
    id: frame.id,
    ...(typeof frame.url === "string" ? { url: frame.url } : {})
  };
};

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/TargetSessionMap.ts
```ts
export type TargetInfo = {
  targetId: string;
  type: string;
  browserContextId?: string;
  title?: string;
  url?: string;
  openerId?: string;
};

export type DebuggerSession = chrome.debugger.Debuggee & {
  sessionId?: string;
  attachBy?: "tabId" | "targetId";
};

export type TargetRecord = {
  tabId: number;
  targetInfo: TargetInfo;
  rootSessionId: string;
  attachTargetId?: string;
  attachedRootSessionId?: string;
  browserSessionId?: string;
};

export type SessionRecord = {
  kind: "root" | "child";
  sessionId: string;
  tabId: number;
  targetId: string;
  debuggerSession: DebuggerSession;
  targetInfo?: TargetInfo;
};

export class TargetSessionMap {
  private readonly tabTargets = new Map<number, TargetRecord>();
  private readonly sessionsById = new Map<string, SessionRecord>();
  private readonly sessionByTarget = new Map<string, string>();
  private readonly rootTargetAliases = new Map<string, number>();
  private readonly rootWaiters = new Map<number, Array<{ resolve: (session: SessionRecord) => void; reject: (error: Error) => void; timeoutId: number }>>();

  registerRootTab(
    tabId: number,
    targetInfo: TargetInfo,
    sessionId: string,
    attachTargetId?: string,
    debuggerSession: DebuggerSession = { tabId }
  ): SessionRecord {
    const existing = this.tabTargets.get(tabId) ?? null;
    if (existing) {
      this.rememberRootTargetAlias(tabId, existing.targetInfo.targetId);
      this.rememberRootTargetAlias(tabId, existing.attachTargetId);
      this.sessionByTarget.delete(existing.targetInfo.targetId);
      if (existing.rootSessionId !== sessionId) {
        this.sessionsById.delete(existing.rootSessionId);
      }
    }
    const record: TargetRecord = {
      tabId,
      targetInfo,
      rootSessionId: sessionId,
      attachTargetId: attachTargetId ?? existing?.attachTargetId,
      attachedRootSessionId: existing?.attachedRootSessionId,
      browserSessionId: existing?.browserSessionId
    };
    this.tabTargets.set(tabId, record);
    const session: SessionRecord = {
      kind: "root",
      sessionId,
      tabId,
      targetId: targetInfo.targetId,
      debuggerSession,
      targetInfo
    };
    this.sessionsById.set(sessionId, session);
    this.sessionByTarget.set(targetInfo.targetId, sessionId);
    this.rememberRootTargetAlias(tabId, targetInfo.targetId);
    this.rememberRootTargetAlias(tabId, record.attachTargetId);
    this.resolveRootWaiters(tabId, session);
    return session;
  }

  setRootAttachTargetId(tabId: number, attachTargetId: string): void {
    const record = this.tabTargets.get(tabId);
    if (!record) {
      return;
    }
    record.attachTargetId = attachTargetId;
    this.rememberRootTargetAlias(tabId, attachTargetId);
  }

  getAttachedRootSession(tabId: number): SessionRecord | null {
    const record = this.tabTargets.get(tabId) ?? null;
    if (!record?.attachedRootSessionId) {
      return null;
    }
    return this.sessionsById.get(record.attachedRootSessionId) ?? null;
  }

  registerAttachedRootSession(tabId: number, sessionId: string): SessionRecord | null {
    const record = this.tabTargets.get(tabId) ?? null;
    if (!record) {
      return null;
    }
    if (record.attachedRootSessionId && record.attachedRootSessionId !== sessionId) {
      this.sessionsById.delete(record.attachedRootSessionId);
    }
    record.attachedRootSessionId = sessionId;
    const session: SessionRecord = {
      kind: "child",
      sessionId,
      tabId,
      targetId: record.targetInfo.targetId,
      debuggerSession: {
        tabId,
        sessionId,
        ...(typeof record.attachTargetId === "string" && record.attachTargetId.length > 0
          ? { targetId: record.attachTargetId }
          : {})
      },
      targetInfo: record.targetInfo
    };
    this.sessionsById.set(sessionId, session);
    return session;
  }

  getBrowserSession(tabId: number): SessionRecord | null {
    const record = this.tabTargets.get(tabId) ?? null;
    if (!record?.browserSessionId) {
      return null;
    }
    return this.sessionsById.get(record.browserSessionId) ?? null;
  }

  registerBrowserSession(tabId: number, sessionId: string): SessionRecord | null {
    const record = this.tabTargets.get(tabId) ?? null;
    if (!record) {
      return null;
    }
    if (record.browserSessionId && record.browserSessionId !== sessionId) {
      this.sessionsById.delete(record.browserSessionId);
    }
    record.browserSessionId = sessionId;
    const session: SessionRecord = {
      kind: "child",
      sessionId,
      tabId,
      targetId: record.targetInfo.targetId,
      debuggerSession: { tabId }
    };
    this.sessionsById.set(sessionId, session);
    return session;
  }

  registerChildSession(tabId: number, targetInfo: TargetInfo, sessionId: string): SessionRecord {
    const session: SessionRecord = {
      kind: "child",
      sessionId,
      tabId,
      targetId: targetInfo.targetId,
      debuggerSession: { tabId, sessionId },
      targetInfo
    };
    this.sessionsById.set(sessionId, session);
    this.sessionByTarget.set(targetInfo.targetId, sessionId);
    return session;
  }

  getBySessionId(sessionId: string): SessionRecord | null {
    return this.sessionsById.get(sessionId) ?? null;
  }

  hasSession(sessionId: string): boolean {
    return this.sessionsById.has(sessionId);
  }

  getByTargetId(targetId: string): SessionRecord | null {
    const sessionId = this.sessionByTarget.get(targetId);
    if (!sessionId) {
      return null;
    }
    return this.sessionsById.get(sessionId) ?? null;
  }

  getTabIdByTargetAlias(targetId: string): number | null {
    return this.rootTargetAliases.get(targetId) ?? null;
  }

  getByTabId(tabId: number): TargetRecord | null {
    return this.tabTargets.get(tabId) ?? null;
  }

  async waitForRootSession(tabId: number, timeoutMs: number = 2000): Promise<SessionRecord> {
    const existing = this.getByTabId(tabId);
    if (existing) {
      const session = this.sessionsById.get(existing.rootSessionId);
      if (session) {
        return session;
      }
    }
    return await new Promise<SessionRecord>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.rejectRootWaiter(tabId, timeoutId);
        reject(new Error("Target attach timeout"));
      }, timeoutMs);
      const entry = { resolve, reject, timeoutId };
      const waiters = this.rootWaiters.get(tabId) ?? [];
      waiters.push(entry);
      this.rootWaiters.set(tabId, waiters);
    });
  }

  listTargetInfos(): TargetInfo[] {
    const rootTargets = Array.from(this.tabTargets.values()).map((record) => record.targetInfo);
    const childTargets = Array.from(this.sessionsById.values())
      .filter((session) => session.kind === "child" && session.targetInfo)
      .map((session) => session.targetInfo as TargetInfo);
    return [...rootTargets, ...childTargets];
  }

  listTabIds(): number[] {
    return Array.from(this.tabTargets.keys());
  }

  listSessionIds(): string[] {
    return Array.from(this.sessionsById.keys());
  }

  reset(): void {
    for (const waiters of this.rootWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeoutId);
        waiter.reject(new Error("Target attach reset"));
      }
    }
    this.rootWaiters.clear();
    this.tabTargets.clear();
    this.sessionsById.clear();
    this.sessionByTarget.clear();
    this.rootTargetAliases.clear();
  }

  removeByTabId(tabId: number): TargetRecord | null {
    const record = this.tabTargets.get(tabId) ?? null;
    if (!record) {
      return null;
    }
    for (const [sessionId, session] of this.sessionsById.entries()) {
      if (session.tabId === tabId) {
        this.sessionsById.delete(sessionId);
      }
    }
    for (const [targetId, sessionId] of this.sessionByTarget.entries()) {
      const session = this.sessionsById.get(sessionId);
      if (!session || session.tabId === tabId) {
        this.sessionByTarget.delete(targetId);
      }
    }
    for (const [targetId, mappedTabId] of this.rootTargetAliases.entries()) {
      if (mappedTabId === tabId) {
        this.rootTargetAliases.delete(targetId);
      }
    }
    this.tabTargets.delete(tabId);
    return record;
  }

  removeBySessionId(sessionId: string): SessionRecord | null {
    const session = this.sessionsById.get(sessionId) ?? null;
    if (!session) {
      return null;
    }
    if (session.kind === "root") {
      this.removeByTabId(session.tabId);
      return session;
    }
    const record = this.tabTargets.get(session.tabId) ?? null;
    if (record?.browserSessionId === sessionId) {
      record.browserSessionId = undefined;
      this.sessionsById.delete(sessionId);
      return session;
    }
    if (record?.attachedRootSessionId === sessionId) {
      record.attachedRootSessionId = undefined;
      this.sessionsById.delete(sessionId);
      return session;
    }
    this.sessionsById.delete(sessionId);
    this.sessionByTarget.delete(session.targetId);
    return session;
  }

  removeByTargetId(targetId: string): SessionRecord | null {
    const sessionId = this.sessionByTarget.get(targetId);
    if (!sessionId) {
      return null;
    }
    return this.removeBySessionId(sessionId);
  }

  private resolveRootWaiters(tabId: number, session: SessionRecord): void {
    const waiters = this.rootWaiters.get(tabId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    this.rootWaiters.delete(tabId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeoutId);
      waiter.resolve(session);
    }
  }

  private rejectRootWaiter(tabId: number, timeoutId: number): void {
    const waiters = this.rootWaiters.get(tabId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    const remaining = waiters.filter((waiter) => waiter.timeoutId !== timeoutId);
    if (remaining.length === 0) {
      this.rootWaiters.delete(tabId);
    } else {
      this.rootWaiters.set(tabId, remaining);
    }
  }

  private rememberRootTargetAlias(tabId: number, targetId?: string): void {
    if (typeof targetId !== "string" || targetId.length === 0) {
      return;
    }
    this.rootTargetAliases.set(targetId, tabId);
  }
}

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-runtime.ts
```ts
import {
  MAX_OPS_PAYLOAD_BYTES,
  MAX_SNAPSHOT_BYTES,
  OPS_PROTOCOL_VERSION,
  type OpsEnvelope,
  type OpsError,
  type OpsErrorCode,
  type OpsErrorResponse,
  type OpsEvent,
  type OpsHello,
  type OpsHelloAck,
  type OpsPing,
  type OpsPong,
  type OpsRequest,
  type OpsResponse,
  type OpsChunk
} from "../types.js";
import {
  CDPRouter,
  type CDPRouterEvent,
  type ChildTargetAttachDiagnostic,
  type RootAttachDiagnostic,
  type RootRefreshDiagnostic
} from "../services/CDPRouter.js";
import { TabManager } from "../services/TabManager.js";
import { getRestrictionMessage, isRestrictedUrl } from "../services/url-restrictions.js";
import { logError } from "../logging.js";
import type { CanvasPageElementAction, CanvasPageState } from "../canvas/model.js";
import { DomBridge, type DomCapture } from "./dom-bridge.js";
import { buildSnapshot, type SnapshotMode } from "./snapshot-builder.js";
import {
  OpsSessionStore,
  type OpsSession,
  type OpsConsoleEvent,
  type OpsNetworkEvent,
  type OpsTargetInfo,
  type OpsSyntheticTargetRecord
} from "./ops-session-store.js";
import {
  DEFAULT_OPS_PARALLELISM_POLICY,
  evaluateOpsGovernor,
  type OpsParallelismGovernorPolicy,
  type OpsParallelismGovernorSnapshot
} from "./parallelism-governor.js";
import { redactConsoleText, redactUrl } from "./redaction.js";

const MAX_CONSOLE_EVENTS = 200;
const MAX_NETWORK_EVENTS = 300;
const SESSION_TTL_MS = 20_000;
const SCREENSHOT_TIMEOUT_MS = 8000;
const TAB_CLOSE_TIMEOUT_MS = 5000;
const POPUP_ATTACH_RETRY_DELAY_MS = 100;
const STALE_REF_ERROR_SUFFIX = "Take a new snapshot first.";

const DOM_OUTER_HTML_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return "";
    return this.outerHTML;
  }
`;

const DOM_INNER_TEXT_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return "";
    return this instanceof HTMLElement ? (this.innerText || this.textContent || "") : (this.textContent || "");
  }
`;

const DOM_GET_ATTR_DECLARATION = `
  function(name) {
    if (!(this instanceof Element)) return null;
    const value = this.getAttribute(name);
    return value === null ? null : String(value);
  }
`;

const DOM_GET_VALUE_DECLARATION = `
  function() {
    if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement || this instanceof HTMLSelectElement) {
      return this.value;
    }
    if (!(this instanceof Element)) return null;
    const value = this.getAttribute("value");
    return value === null ? null : String(value);
  }
`;

const DOM_IS_VISIBLE_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return false;
    const style = window.getComputedStyle(this);
    if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = this.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
`;

const DOM_IS_ENABLED_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return false;
    return !this.hasAttribute("disabled") && this.getAttribute("aria-disabled") !== "true";
  }
`;

const DOM_IS_CHECKED_DECLARATION = `
  function() {
    if (this instanceof HTMLInputElement && (this.type === "checkbox" || this.type === "radio")) {
      return this.checked;
    }
    if (!(this instanceof Element)) return false;
    return this.getAttribute("aria-checked") === "true";
  }
`;

const DOM_SELECTOR_STATE_DECLARATION = `
  function() {
    if (!(this instanceof Element)) {
      return { attached: false, visible: false };
    }
    const style = window.getComputedStyle(this);
    const rect = this.getBoundingClientRect();
    return {
      attached: true,
      visible: Boolean(style && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0)
    };
  }
`;

const DOM_HOVER_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return;
    const init = { bubbles: true, cancelable: true, view: window };
    this.dispatchEvent(new MouseEvent("mouseenter", init));
    this.dispatchEvent(new MouseEvent("mouseover", init));
    this.dispatchEvent(new MouseEvent("mousemove", init));
  }
`;

const DOM_FOCUS_DECLARATION = `
  function() {
    if (this instanceof HTMLElement) {
      this.focus();
    }
  }
`;

const DOM_SET_CHECKED_DECLARATION = `
  function(checked) {
    if (this instanceof HTMLInputElement && (this.type === "checkbox" || this.type === "radio")) {
      this.checked = Boolean(checked);
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (this instanceof Element) {
      this.setAttribute("aria-checked", checked ? "true" : "false");
    }
  }
`;

const DOM_TYPE_DECLARATION = `
  function(value, clear, submit) {
    if (!(this instanceof Element)) return;
    if (this instanceof HTMLElement) {
      this.focus();
    }
    if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
      this.value = clear ? "" : this.value;
      this.value = String(value);
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      if (submit) {
        this.form?.requestSubmit?.();
      }
      return;
    }
    if (this instanceof HTMLSelectElement) {
      this.value = String(value);
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
`;

const DOM_SELECT_DECLARATION = `
  function(values) {
    if (!(this instanceof HTMLSelectElement)) return;
    const nextValues = Array.isArray(values) ? values.map((value) => String(value)) : [];
    for (const option of Array.from(this.options)) {
      option.selected = nextValues.includes(option.value);
    }
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }
`;

const DOM_SCROLL_BY_DECLARATION = `
  function(dy) {
    if (!(this instanceof HTMLElement)) return;
    this.scrollBy(0, Number(dy) || 0);
  }
`;

const DOM_SCROLL_INTO_VIEW_DECLARATION = `
  function() {
    if (this instanceof Element) {
      this.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    }
  }
`;

const DOM_REF_POINT_DECLARATION = `
  function() {
    if (!(this instanceof Element)) return null;
    const rect = this.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }
`;

const TARGET_SCOPED_COMMANDS = new Set<string>([
  "storage.setCookies",
  "storage.getCookies",
  "nav.goto",
  "nav.wait",
  "nav.snapshot",
  "nav.review",
  "interact.click",
  "interact.hover",
  "interact.press",
  "interact.check",
  "interact.uncheck",
  "interact.type",
  "interact.select",
  "interact.scroll",
  "interact.scrollIntoView",
  "pointer.move",
  "pointer.down",
  "pointer.up",
  "pointer.drag",
  "dom.getHtml",
  "dom.getText",
  "dom.getAttr",
  "dom.getValue",
  "dom.isVisible",
  "dom.isEnabled",
  "dom.isChecked",
  "dom.refPoint",
  "canvas.overlay.mount",
  "canvas.overlay.unmount",
  "canvas.overlay.select",
  "canvas.overlay.sync",
  "canvas.applyRuntimePreviewBridge",
  "export.clonePage",
  "export.cloneComponent",
  "devtools.perf",
  "page.screenshot"
]);

type OpsParallelWaiter = {
  targetId: string;
  enqueuedAt: number;
  timeoutMs: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number | null;
};

type ResolvedOpsTarget = {
  targetId: string;
  tabId: number;
  type: string;
  synthetic: boolean;
  url?: string;
  title?: string;
  sessionId?: string;
  openerTargetId?: string;
  debuggee: chrome.debugger.Debuggee & { sessionId?: string };
};

type ResolvedOpsRef = {
  target: ResolvedOpsTarget;
  ref: string;
  selector: string;
  backendNodeId: number;
  snapshotId: string;
  frameId?: string;
  role?: string;
  name?: string;
};

type PopupAttachDiagnosticStage =
  | "targets_lookup_failed"
  | "resolve_tab_target_failed"
  | ChildTargetAttachDiagnostic["stage"];

type PopupAttachMatcher =
  | "url"
  | "title"
  | "non_opener"
  | "resolve_tab_target_id";

type PopupAttachDiagnostic = {
  targetId: string;
  tabId: number;
  openerTargetId?: string;
  popupTargetId?: string;
  stage: PopupAttachDiagnosticStage;
  matcher?: PopupAttachMatcher;
  initialStage?: ChildTargetAttachDiagnostic["initialStage"];
  rootTargetRetryStage?: ChildTargetAttachDiagnostic["rootTargetRetryStage"];
  attachedRootRecoveryStage?: ChildTargetAttachDiagnostic["attachedRootRecoveryStage"];
  attachedRootRecoverySource?: ChildTargetAttachDiagnostic["attachedRootRecoverySource"];
  attachedRootRecoveryReason?: ChildTargetAttachDiagnostic["attachedRootRecoveryReason"];
  refreshPath?: RootRefreshDiagnostic["path"];
  refreshCompleted?: boolean;
  refreshDebuggeePresent?: boolean;
  refreshRootSessionPresent?: boolean;
  refreshRootTargetId?: string;
  refreshProbeMethod?: RootRefreshDiagnostic["probeMethod"];
  refreshProbeStage?: RootRefreshDiagnostic["probeStage"];
  refreshProbeReason?: string;
  refreshReason?: string;
  targetsLookupFailed?: boolean;
  reason?: string;
  at: number;
};

type DirectAttachFailureDetails = {
  origin?: RootAttachDiagnostic["origin"];
  stage?: RootAttachDiagnostic["stage"];
  attachBy?: RootAttachDiagnostic["attachBy"];
  probeMethod?: RootAttachDiagnostic["probeMethod"];
  reason?: string;
};

type DirectAttachDecoratedError = Error & {
  directAttachDetails?: DirectAttachFailureDetails;
};

export type OpsRuntimeOptions = {
  send: (message: OpsEnvelope) => void;
  cdp: CDPRouter;
  getCanvasPageState?: (targetId: string) => CanvasPageState | null;
  performCanvasPageAction?: (targetId: string, action: CanvasPageElementAction, selector?: string | null) => Promise<unknown>;
};

export class OpsRuntime {
  private readonly sendEnvelope: (message: OpsEnvelope) => void;
  private readonly cdp: CDPRouter;
  private readonly getCanvasPageState?: (targetId: string) => CanvasPageState | null;
  private readonly performCanvasPageAction?: (targetId: string, action: CanvasPageElementAction, selector?: string | null) => Promise<unknown>;
  private readonly tabs = new TabManager();
  private readonly dom = new DomBridge();
  private readonly sessions = new OpsSessionStore();
  private readonly encoder = new TextEncoder();
  private readonly popupOpenerTabIds = new Map<number, number>();
  private readonly popupAttachDiagnostics = new Map<string, PopupAttachDiagnostic>();
  private closingTimers = new Map<string, number>();
  private parallelWaiters = new Map<string, OpsParallelWaiter[]>();

  constructor(options: OpsRuntimeOptions) {
    this.sendEnvelope = options.send;
    this.cdp = options.cdp;
    this.getCanvasPageState = options.getCanvasPageState;
    this.performCanvasPageAction = options.performCanvasPageAction;
    chrome.tabs.onCreated.addListener(this.handleTabCreated);
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
    chrome.webNavigation?.onCreatedNavigationTarget?.addListener?.(this.handleCreatedNavigationTarget);
    chrome.debugger.onEvent.addListener(this.handleDebuggerEvent);
    chrome.debugger.onDetach.addListener(this.handleDebuggerDetach);
    if (typeof this.cdp.addEventListener === "function") {
      this.cdp.addEventListener(this.handleCdpRouterEvent);
    }
  }

  async registerCanvasTargetForSession(
    opsSessionId: string,
    targetId: string
  ): Promise<{ targetId: string; url?: string; title?: string; adopted?: boolean } | null> {
    const session = this.sessions.get(opsSessionId);
    if (!session) {
      return null;
    }
    return await this.registerCanvasTarget(session, targetId);
  }

  unregisterCanvasTargetForSession(opsSessionId: string, targetId: string): boolean {
    const session = this.sessions.get(opsSessionId);
    if (!session || targetId === session.targetId) {
      return false;
    }
    return this.sessions.removeTarget(session.id, targetId) !== null;
  }

  handleMessage(message: OpsEnvelope): void {
    if (message.type === "ops_hello") {
      this.handleHello(message);
      return;
    }
    if (message.type === "ops_ping") {
      this.handlePing(message);
      return;
    }
    if (message.type === "ops_event" && message.event === "ops_client_disconnected") {
      this.handleClientDisconnected(message);
      return;
    }
    if (message.type === "ops_request") {
      void this.handleRequest(message).catch((error) => {
        logError("ops.handle_request", error, { code: "ops_request_failed" });
        this.sendError(message, {
          code: "execution_failed",
          message: error instanceof Error ? error.message : "Ops request failed",
          retryable: false
        });
      });
    }
  }

  private handleHello(message: OpsHello): void {
    if (message.version !== OPS_PROTOCOL_VERSION) {
      const error: OpsErrorResponse = {
        type: "ops_error",
        requestId: "ops_hello",
        clientId: message.clientId,
        error: {
          code: "not_supported",
          message: "Unsupported ops protocol version.",
          retryable: false,
          details: { supported: [OPS_PROTOCOL_VERSION], received: message.version }
        }
      };
      this.sendEnvelope(error);
      return;
    }
    const ack: OpsHelloAck = {
      type: "ops_hello_ack",
      version: OPS_PROTOCOL_VERSION,
      clientId: message.clientId,
      maxPayloadBytes: MAX_OPS_PAYLOAD_BYTES,
      capabilities: []
    };
    this.sendEnvelope(ack);
  }

  private handlePing(message: OpsPing): void {
    const pong: OpsPong = {
      type: "ops_pong",
      id: message.id,
      clientId: message.clientId
    };
    this.sendEnvelope(pong);
  }

  private handleClientDisconnected(message: OpsEvent): void {
    const clientId = message.clientId;
    if (!clientId) return;
    this.cdp.markClientClosed();
    const sessions = this.sessions.listOwnedBy(clientId);
    for (const session of sessions) {
      this.markSessionClosing(session, "ops_session_expired");
    }
  }

  private handleTabRemoved = (tabId: number): void => {
    this.popupOpenerTabIds.delete(tabId);
    this.handleClosedTarget(tabId, "ops_tab_closed");
  };

  private handleCreatedNavigationTarget = (
    details: chrome.webNavigation.WebNavigationSourceCallbackDetails
  ): void => {
    const tabId = typeof details.tabId === "number" ? details.tabId : null;
    const openerTabId = typeof details.sourceTabId === "number" ? details.sourceTabId : null;
    if (tabId === null || openerTabId === null) {
      return;
    }
    this.popupOpenerTabIds.set(tabId, openerTabId);
  };

  private handleTabCreated = (tab: chrome.tabs.Tab): void => {
    const tabId = typeof tab.id === "number" ? tab.id : null;
    if (tabId === null) {
      return;
    }
    const openerTabId = typeof tab.openerTabId === "number" ? tab.openerTabId : null;
    if (openerTabId !== null) {
      const session = this.sessions.getByTabId(openerTabId);
      if (!session) {
        return;
      }
      this.finishCreatedTab(
        session,
        this.sessions.getTargetIdByTabId(session.id, openerTabId) ?? session.targetId,
        tab,
        tabId
      );
      return;
    }
    void this.handleCreatedTab(tab, tabId);
  };

  private async handleCreatedTab(tab: chrome.tabs.Tab, tabId: number): Promise<void> {
    const opener = await this.resolvePopupOpenerContext(
      tabId,
      typeof tab.openerTabId === "number" ? tab.openerTabId : null
    );
    if (!opener) {
      return;
    }
    this.finishCreatedTab(opener.session, opener.openerTargetId, tab, tabId);
  }

  private finishCreatedTab(
    session: OpsSession,
    openerTargetId: string,
    tab: chrome.tabs.Tab,
    tabId: number
  ): void {
    this.popupOpenerTabIds.delete(tabId);
    const existingTargetId = this.updateKnownTabTarget(session, tab);
    if (existingTargetId) {
      const existingTarget = session.targets.get(existingTargetId) ?? null;
      if (existingTarget && !existingTarget.openerTargetId) {
        existingTarget.openerTargetId = openerTargetId;
      }
      const resolvedTarget = this.resolveTargetContext(session, existingTargetId);
      if (
        resolvedTarget
        && this.shouldPromotePopupTarget(session, openerTargetId, resolvedTarget)
      ) {
        session.activeTargetId = existingTargetId;
      }
      return;
    }
    const target = this.sessions.addTarget(session.id, tabId, {
      url: tab.url ?? undefined,
      title: tab.title ?? undefined,
      openerTargetId: openerTargetId
    });
    void this.attachCreatedTab(session, target.targetId, tabId);
  }

  private async resolvePopupOpenerContext(
    tabId: number,
    openerTabId: number | null
  ): Promise<{ session: OpsSession; openerTargetId: string } | null> {
    let resolvedOpenerTabId = openerTabId ?? this.popupOpenerTabIds.get(tabId) ?? null;
    if (resolvedOpenerTabId === null && typeof this.cdp.resolveTabOpenerTargetId === "function") {
      const openerTargetId = await this.cdp.resolveTabOpenerTargetId(tabId).catch(() => null);
      resolvedOpenerTabId = parseTargetAliasTabId(openerTargetId ?? undefined);
    }
    if (resolvedOpenerTabId === null) {
      return null;
    }
    const session = this.sessions.getByTabId(resolvedOpenerTabId);
    if (!session) {
      return null;
    }
    return {
      session,
      openerTargetId: this.sessions.getTargetIdByTabId(session.id, resolvedOpenerTabId) ?? session.targetId
    };
  }

  private async hydratePopupOpenerTarget(session: OpsSession, targetId: string): Promise<OpsTargetInfo | null> {
    const target = session.targets.get(targetId) ?? null;
    if (!target || target.openerTargetId) {
      return target;
    }
    const opener = await this.resolvePopupOpenerContext(target.tabId, null);
    if (!opener || opener.session.id !== session.id) {
      return target;
    }
    target.openerTargetId = opener.openerTargetId;
    return target;
  }

  private handleTabUpdated = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): void => {
    const session = this.sessions.getByTabId(tabId);
    if (!session) {
      if (changeInfo.status === "complete" || tab.status === "complete" || typeof tab.openerTabId === "number") {
        void this.handleCreatedTab(tab, tabId);
      }
      return;
    }
    const targetId = this.updateKnownTabTarget(session, tab);
    if (
      targetId
      && tab.active === true
      && (changeInfo.status === "complete" || tab.status === "complete")
    ) {
      const target = this.resolveTargetContext(session, targetId);
      if (target && (!target.openerTargetId || this.hasUsableDebuggee(target))) {
        session.activeTargetId = targetId;
      }
    }
    if (changeInfo.discarded === true || tab.discarded === true) {
      session.discardedSignals += 1;
    }
    const frozenChange = (changeInfo as { frozen?: boolean }).frozen === true;
    const frozenTab = (tab as { frozen?: boolean }).frozen === true;
    if (frozenChange || frozenTab) {
      session.frozenSignals += 1;
    }
  };

  private handleDebuggerDetach = (source: chrome.debugger.Debuggee): void => {
    if (typeof source.tabId !== "number") return;
    void this.handleDebuggerDetachForTab(source.tabId);
  };

  private updateKnownTabTarget(session: OpsSession, tab: chrome.tabs.Tab): string | null {
    const tabId = typeof tab.id === "number" ? tab.id : null;
    if (tabId === null) {
      return null;
    }
    const targetId = this.sessions.getTargetIdByTabId(session.id, tabId);
    if (!targetId) {
      return null;
    }
    const target = session.targets.get(targetId);
    if (!target) {
      return targetId;
    }
    target.url = tab.url ?? target.url;
    target.title = tab.title ?? target.title;
    return targetId;
  }

  private async attachCreatedTab(session: OpsSession, targetId: string, tabId: number): Promise<void> {
    await this.tabs.waitForTabComplete(tabId, 5000).catch(() => undefined);
    const target = await this.hydratePopupOpenerTarget(session, targetId);
    if (target?.openerTargetId) {
      // Keep the opener root stable and attach popup tabs only when the caller explicitly targets them.
      return;
    }
    try {
      await this.attachTargetTab(tabId);
      await this.enableTargetDomains(tabId);
      this.promotePopupTarget(session, targetId);
    } catch (error) {
      if (target && isAttachBlockedError(error)) {
        const bridged = await this.attachTargetViaOpenerSession(session, target).catch(() => false);
        if (bridged) {
          this.promotePopupTarget(session, targetId);
          return;
        }
      }
      logError("ops.popup_tab_attach", error, {
        code: "popup_tab_attach_failed",
        extra: { tabId }
      });
    }
  }

  private handleDebuggerEvent = (source: chrome.debugger.Debuggee, method: string, params?: object): void => {
    if (typeof source.tabId !== "number") return;
    const session = this.sessions.getByTabId(source.tabId);
    if (!session) return;
    if (method === "Runtime.consoleAPICalled") {
      const payload = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
      const parts = Array.isArray(payload?.args)
        ? payload.args.map((arg) => {
          if (typeof arg.value === "string") return arg.value;
          if (typeof arg.value === "number" || typeof arg.value === "boolean") return String(arg.value);
          if (typeof arg.description === "string") return arg.description;
          return "";
        })
        : [];
      const text = redactConsoleText(parts.filter(Boolean).join(" "));
      const event: OpsConsoleEvent = {
        seq: ++session.consoleSeq,
        level: payload?.type ?? "log",
        text,
        ts: Date.now()
      };
      session.consoleEvents.push(event);
      if (session.consoleEvents.length > MAX_CONSOLE_EVENTS) {
        session.consoleEvents.shift();
      }
      return;
    }

    if (method === "Network.requestWillBeSent") {
      const payload = params as { requestId?: string; request?: { method?: string; url?: string }; type?: string };
      const requestId = payload.requestId;
      if (requestId && payload.request) {
        const methodValue = payload.request.method ?? "GET";
        const urlValue = payload.request.url ?? "";
        session.networkRequests.set(requestId, {
          method: methodValue,
          url: urlValue,
          resourceType: payload.type
        });
        const event: OpsNetworkEvent = {
          seq: ++session.networkSeq,
          method: methodValue,
          url: redactUrl(urlValue),
          resourceType: payload.type,
          ts: Date.now()
        };
        session.networkEvents.push(event);
        if (session.networkEvents.length > MAX_NETWORK_EVENTS) {
          session.networkEvents.shift();
        }
      }
      return;
    }

    if (method === "Network.responseReceived") {
      const payload = params as { requestId?: string; response?: { url?: string; status?: number } };
      const requestId = payload.requestId;
      if (requestId) {
        const pending = session.networkRequests.get(requestId);
        const urlValue = payload.response?.url ?? pending?.url ?? "";
        const methodValue = pending?.method ?? "GET";
        const event: OpsNetworkEvent = {
          seq: ++session.networkSeq,
          method: methodValue,
          url: redactUrl(urlValue),
          status: payload.response?.status,
          resourceType: pending?.resourceType,
          ts: Date.now()
        };
        session.networkEvents.push(event);
        if (session.networkEvents.length > MAX_NETWORK_EVENTS) {
          session.networkEvents.shift();
        }
        session.networkRequests.delete(requestId);
      }
    }
  };

  private handleCdpRouterEvent = (event: CDPRouterEvent): void => {
    const session = this.sessions.getByTabId(event.tabId);
    if (!session) {
      return;
    }
    switch (event.method) {
      case "Target.targetCreated":
        this.handleSyntheticTargetCreated(session, event);
        return;
      case "Target.attachedToTarget":
        this.handleSyntheticTargetAttached(session, event);
        return;
      case "Target.targetDestroyed":
        this.handleSyntheticTargetDestroyed(session, event);
        return;
      case "Target.detachedFromTarget":
        this.handleSyntheticTargetDetached(session, event);
        return;
      default:
        return;
    }
  };

  private handleSyntheticTargetCreated(session: OpsSession, event: CDPRouterEvent): void {
    const targetInfo = extractTargetInfo(event.params);
    if (!targetInfo || !isSyntheticPageTarget(session, targetInfo.targetId, targetInfo.type)) {
      return;
    }
    const resolvedTabId = parseTabTargetId(targetInfo.targetId) ?? event.tabId;
    this.sessions.upsertSyntheticTarget(session.id, {
      targetId: targetInfo.targetId,
      tabId: resolvedTabId,
      type: targetInfo.type,
      ...(typeof targetInfo.url === "string" ? { url: targetInfo.url } : {}),
      ...(typeof targetInfo.title === "string" ? { title: targetInfo.title } : {}),
      ...(typeof targetInfo.openerId === "string" ? { openerTargetId: targetInfo.openerId } : {}),
      attachedAt: Date.now()
    });
  }

  private handleSyntheticTargetAttached(session: OpsSession, event: CDPRouterEvent): void {
    const payload = isRecord(event.params) ? event.params : null;
    const targetInfo = extractTargetInfo(payload);
    const childSessionId = payload && typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    if (!targetInfo || !isSyntheticPageTarget(session, targetInfo.targetId, targetInfo.type)) {
      return;
    }
    const resolvedTabId = parseTabTargetId(targetInfo.targetId) ?? event.tabId;
    const synthetic = this.sessions.upsertSyntheticTarget(session.id, {
      targetId: targetInfo.targetId,
      tabId: resolvedTabId,
      type: targetInfo.type,
      ...(typeof targetInfo.url === "string" ? { url: targetInfo.url } : {}),
      ...(typeof targetInfo.title === "string" ? { title: targetInfo.title } : {}),
      ...(childSessionId ? { sessionId: childSessionId } : {}),
      ...(typeof targetInfo.openerId === "string" ? { openerTargetId: targetInfo.openerId } : {}),
      attachedAt: Date.now()
    });
    if (
      !session.activeTargetId
      || session.activeTargetId === session.targetId
      || session.activeTargetId === synthetic.openerTargetId
    ) {
      session.activeTargetId = synthetic.targetId;
    }
  }

  private handleSyntheticTargetDestroyed(session: OpsSession, event: CDPRouterEvent): void {
    const payload = isRecord(event.params) ? event.params : null;
    const targetId = payload && typeof payload.targetId === "string" ? payload.targetId : null;
    if (!targetId) {
      return;
    }
    const removed = this.sessions.removeSyntheticTarget(session.id, targetId);
    if (!removed) {
      return;
    }
    this.restoreSyntheticFallbackTarget(session, removed);
  }

  private handleSyntheticTargetDetached(session: OpsSession, event: CDPRouterEvent): void {
    const payload = isRecord(event.params) ? event.params : null;
    const targetId = payload && typeof payload.targetId === "string" ? payload.targetId : null;
    const sessionId = payload && typeof payload.sessionId === "string" ? payload.sessionId : null;
    const removed = targetId
      ? this.sessions.removeSyntheticTarget(session.id, targetId)
      : (sessionId ? this.sessions.findSyntheticTargetBySessionId(session.id, sessionId) : null);
    if (!removed) {
      return;
    }
    if (!targetId && sessionId) {
      this.sessions.removeSyntheticTarget(session.id, removed.targetId);
    }
    this.restoreSyntheticFallbackTarget(session, removed);
  }

  private restoreSyntheticFallbackTarget(session: OpsSession, removed: OpsSyntheticTargetRecord): void {
    if (session.activeTargetId !== removed.targetId) {
      return;
    }
    if (removed.openerTargetId && this.hasOpsTarget(session, removed.openerTargetId)) {
      session.activeTargetId = removed.openerTargetId;
      return;
    }
    const firstSynthetic = this.sessions.listSyntheticTargets(session.id)[0];
    session.activeTargetId = firstSynthetic?.targetId ?? session.targetId;
  }

  private async handleRequest(message: OpsRequest): Promise<void> {
    const clientId = message.clientId;
    if (!clientId) {
      this.sendError(message, buildError("invalid_request", "Missing clientId", false));
      return;
    }

    switch (message.command) {
      case "session.launch":
      case "session.connect":
        await this.handleSessionLaunch(message, clientId);
        return;
      case "session.disconnect":
        await this.handleSessionDisconnect(message, clientId);
        return;
      case "session.status":
        await this.handleSessionStatus(message, clientId);
        return;
      case "storage.setCookies":
        await this.withSession(message, clientId, (session) => this.handleStorageSetCookies(message, session));
        return;
      case "storage.getCookies":
        await this.withSession(message, clientId, (session) => this.handleStorageGetCookies(message, session));
        return;
      case "targets.list":
        await this.withSession(message, clientId, (session) => this.handleTargetsList(message, session));
        return;
      case "targets.use":
        await this.withSession(message, clientId, (session) => this.handleTargetsUse(message, session));
        return;
      case "targets.registerCanvas":
        await this.withSession(message, clientId, (session) => this.handleTargetsRegisterCanvas(message, session));
        return;
      case "targets.new":
        await this.withSession(message, clientId, (session) => this.handleTargetsNew(message, session));
        return;
      case "targets.close":
        await this.withSession(message, clientId, (session) => this.handleTargetsClose(message, session));
        return;
      case "page.open":
        await this.withSession(message, clientId, (session) => this.handlePageOpen(message, session));
        return;
      case "page.list":
        await this.withSession(message, clientId, (session) => this.handlePageList(message, session));
        return;
      case "page.close":
        await this.withSession(message, clientId, (session) => this.handlePageClose(message, session));
        return;
      case "nav.goto":
        await this.withSession(message, clientId, (session) => this.handleGoto(message, session));
        return;
      case "nav.wait":
        await this.withSession(message, clientId, (session) => this.handleWait(message, session));
        return;
      case "nav.snapshot":
        await this.withSession(message, clientId, (session) => this.handleSnapshot(message, session));
        return;
      case "nav.review":
        await this.withSession(message, clientId, (session) => this.handleReview(message, session));
        return;
      case "interact.click":
        await this.withSession(message, clientId, (session) => this.handleClick(message, session));
        return;
      case "interact.hover":
        await this.withSession(message, clientId, (session) => this.handleHover(message, session));
        return;
      case "interact.press":
        await this.withSession(message, clientId, (session) => this.handlePress(message, session));
        return;
      case "interact.check":
        await this.withSession(message, clientId, (session) => this.handleCheck(message, session, true));
        return;
      case "interact.uncheck":
        await this.withSession(message, clientId, (session) => this.handleCheck(message, session, false));
        return;
      case "interact.type":
        await this.withSession(message, clientId, (session) => this.handleType(message, session));
        return;
      case "interact.select":
        await this.withSession(message, clientId, (session) => this.handleSelect(message, session));
        return;
      case "interact.scroll":
        await this.withSession(message, clientId, (session) => this.handleScroll(message, session));
        return;
      case "interact.scrollIntoView":
        await this.withSession(message, clientId, (session) => this.handleScrollIntoView(message, session));
        return;
      case "pointer.move":
        await this.withSession(message, clientId, (session) => this.handlePointerMove(message, session));
        return;
      case "pointer.down":
        await this.withSession(message, clientId, (session) => this.handlePointerDown(message, session));
        return;
      case "pointer.up":
        await this.withSession(message, clientId, (session) => this.handlePointerUp(message, session));
        return;
      case "pointer.drag":
        await this.withSession(message, clientId, (session) => this.handlePointerDrag(message, session));
        return;
      case "dom.getHtml":
        await this.withSession(message, clientId, (session) => this.handleDomGetHtml(message, session));
        return;
      case "dom.getText":
        await this.withSession(message, clientId, (session) => this.handleDomGetText(message, session));
        return;
      case "dom.getAttr":
        await this.withSession(message, clientId, (session) => this.handleDomGetAttr(message, session));
        return;
      case "dom.getValue":
        await this.withSession(message, clientId, (session) => this.handleDomGetValue(message, session));
        return;
      case "dom.isVisible":
        await this.withSession(message, clientId, (session) => this.handleDomIsVisible(message, session));
        return;
      case "dom.isEnabled":
        await this.withSession(message, clientId, (session) => this.handleDomIsEnabled(message, session));
        return;
      case "dom.isChecked":
        await this.withSession(message, clientId, (session) => this.handleDomIsChecked(message, session));
        return;
      case "dom.refPoint":
        await this.withSession(message, clientId, (session) => this.handleDomRefPoint(message, session));
        return;
      case "canvas.overlay.mount":
        await this.withSession(message, clientId, (session) => this.handleCanvasOverlayMount(message, session));
        return;
      case "canvas.overlay.unmount":
        await this.withSession(message, clientId, (session) => this.handleCanvasOverlayUnmount(message, session));
        return;
      case "canvas.overlay.select":
        await this.withSession(message, clientId, (session) => this.handleCanvasOverlaySelect(message, session));
        return;
      case "canvas.overlay.sync":
        await this.withSession(message, clientId, (session) => this.handleCanvasOverlaySync(message, session));
        return;
      case "canvas.applyRuntimePreviewBridge":
        await this.withSession(message, clientId, (session) => this.handleCanvasRuntimePreviewBridge(message, session));
        return;
      case "export.clonePage":
        await this.withSession(message, clientId, (session) => this.handleClonePage(message, session));
        return;
      case "export.cloneComponent":
        await this.withSession(message, clientId, (session) => this.handleCloneComponent(message, session));
        return;
      case "devtools.perf":
        await this.withSession(message, clientId, (session) => this.handlePerf(message, session));
        return;
      case "page.screenshot":
        await this.withSession(message, clientId, (session) => this.handleScreenshot(message, session));
        return;
      case "devtools.consolePoll":
        await this.withSession(message, clientId, (session) => this.handleConsolePoll(message, session));
        return;
      case "devtools.networkPoll":
        await this.withSession(message, clientId, (session) => this.handleNetworkPoll(message, session));
        return;
      default:
        this.sendError(message, buildError("invalid_request", `Unknown ops command: ${message.command}`, false));
    }
  }

  private async handleSessionLaunch(message: OpsRequest, clientId: string): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const parallelismPolicy = parseParallelismPolicy(payload.parallelismPolicy);
    const startUrl = typeof payload.startUrl === "string" ? payload.startUrl : undefined;
    const requestedSessionId = typeof payload.sessionId === "string" && payload.sessionId.trim().length > 0
      ? payload.sessionId.trim()
      : undefined;
    const requestedTabId = typeof payload.tabId === "number" && Number.isInteger(payload.tabId)
      ? payload.tabId
      : undefined;
    if (startUrl) {
      try {
        const restriction = getRestrictionMessage(new URL(startUrl));
        if (restriction) {
          this.sendError(message, buildError("restricted_url", restriction, false));
          return;
        }
      } catch {
        this.sendError(message, buildError("invalid_request", "Invalid startUrl", false));
        return;
      }
    }
    let activeTab = startUrl
      ? await this.tabs.createTab(startUrl, true)
      : typeof requestedTabId === "number"
        ? await this.tabs.getTab(requestedTabId)
        : await this.tabs.getActiveTab();

    if (!startUrl && typeof requestedTabId !== "number") {
      const currentRawUrl = activeTab?.url ?? activeTab?.pendingUrl ?? "";
      const needsFallback = !activeTab
        || typeof activeTab.id !== "number"
        || currentRawUrl.length === 0
        || isRestrictedUrl(currentRawUrl).restricted;
      if (needsFallback) {
        activeTab = await this.tabs.getFirstAttachableTab(typeof activeTab?.id === "number" ? activeTab.id : undefined) ?? activeTab;
      }
    }

    if (!activeTab || typeof activeTab.id !== "number") {
      if (typeof requestedTabId === "number") {
        this.sendError(message, buildError("invalid_request", `Unknown tabId: ${requestedTabId}`, false));
        return;
      }
      this.sendError(message, buildError("ops_unavailable", "No active tab to attach.", true));
      return;
    }
    const activeTabId = activeTab.id;

    const resolvedTab = startUrl
      ? await this.tabs.waitForTabComplete(activeTabId)
        .catch(() => undefined)
        .then(async () => await this.tabs.getTab(activeTabId) ?? activeTab)
      : activeTab;

    if (resolvedTab.url) {
      const restriction = isRestrictedUrl(resolvedTab.url);
      if (restriction.restricted) {
        this.sendError(message, buildError("restricted_url", restriction.message ?? "Restricted tab.", false));
        return;
      }
    }

    try {
      await this.attachTargetTab(activeTabId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
      return;
    }
    if (!startUrl) {
      await this.tabs.waitForTabComplete(activeTab.id).catch(() => undefined);
    }

    const leaseId = typeof message.leaseId === "string" && message.leaseId.trim().length > 0
      ? message.leaseId.trim()
      : createId();
    const session = this.sessions.createSession(clientId, activeTabId, leaseId, {
      url: resolvedTab.url ?? undefined,
      title: resolvedTab.title ?? undefined
    }, {
      parallelismPolicy
    }, requestedSessionId);

    await this.enableSessionDomains(session);

    this.sendEvent({
      type: "ops_event",
      clientId,
      opsSessionId: session.id,
      event: "ops_session_created",
      payload: { tabId: session.tabId, targetId: session.targetId }
    });

    this.sendResponse(message, {
      opsSessionId: session.id,
      activeTargetId: session.activeTargetId,
      url: resolvedTab.url ?? undefined,
      title: resolvedTab.title ?? undefined,
      leaseId: session.leaseId
    });
  }

  private async handleSessionDisconnect(message: OpsRequest, clientId: string): Promise<void> {
    const session = this.getSessionForMessage(message, clientId);
    if (!session) return;
    this.sendResponse(message, { ok: true });
    this.scheduleSessionCleanup(session.id, "ops_session_closed");
  }

  private async handleSessionStatus(message: OpsRequest, clientId: string): Promise<void> {
    const session = this.getSessionForMessage(message, clientId);
    if (!session) return;
    const activeTarget = this.resolveTargetContext(session, session.activeTargetId ?? session.targetId)
      ?? this.resolveTargetContext(session, session.targetId);
    const tab = activeTarget ? await this.tabs.getTab(activeTarget.tabId) : null;
    this.sendResponse(message, {
      mode: "extension",
      activeTargetId: session.activeTargetId || null,
      url: resolveReportedTargetUrl(activeTarget, tab?.url),
      title: resolveReportedTargetTitle(activeTarget, tab?.title),
      leaseId: session.leaseId,
      state: session.state
    });
  }

  private async handleTargetsList(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const includeUrls = payload.includeUrls === true;
    const targetContexts = [
      ...Array.from(session.targets.values()).map((target) => ({
        targetId: target.targetId,
        tabId: target.tabId
      })),
      ...this.sessions.listSyntheticTargets(session.id)
        .filter((target) => !session.targets.has(target.targetId))
        .map((target) => ({
        targetId: target.targetId,
        tabId: target.tabId
        }))
    ];
    const targets = await Promise.all(targetContexts.map(async ({ targetId, tabId }) => {
      const target = this.resolveTargetContext(session, targetId);
      const tab = await this.tabs.getTab(tabId);
      return {
        targetId,
        type: "page" as const,
        title: resolveReportedTargetTitle(target, tab?.title),
        url: includeUrls ? resolveReportedTargetUrl(target, tab?.url) : undefined
      };
    }));
    this.sendResponse(message, { activeTargetId: session.activeTargetId || null, targets });
  }

  private async handleTargetsUse(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const targetId = typeof payload.targetId === "string" ? payload.targetId : null;
    if (!targetId || !this.hasOpsTarget(session, targetId)) {
      this.sendError(message, buildError("invalid_request", "Unknown targetId", false));
      return;
    }
    let target = this.resolveTargetContext(session, targetId);
    if (target && !this.hasUsableDebuggee(target) && (target.synthetic || !!target.openerTargetId)) {
      try {
        target = await this.preparePopupTarget(session, targetId) ?? target;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Debugger attach failed";
        this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
        return;
      }
    }
    if (target?.synthetic && !target.sessionId) {
      const syntheticPopupTarget = target.openerTargetId
        ? {
          targetId,
          tabId: target.tabId,
          ...(typeof target.url === "string" ? { url: target.url } : {}),
          ...(typeof target.title === "string" ? { title: target.title } : {}),
          openerTargetId: target.openerTargetId
        }
        : null;
      if (syntheticPopupTarget && await this.attachTargetViaOpenerSession(session, syntheticPopupTarget).catch(() => false)) {
        this.clearPopupAttachDiagnostic(session.id, targetId);
        await this.activateTargetAndRespond(message, session, targetId);
        return;
      }
      this.sendPopupAttachPendingError(message, session, targetId);
      return;
    }
    if (target && !target.synthetic) {
      const hydratedPopupTarget = typeof target.sessionId !== "string"
        ? await this.hydratePopupOpenerTarget(session, targetId)
        : null;
      const popupTarget: OpsTargetInfo | null = hydratedPopupTarget?.openerTargetId
        ? hydratedPopupTarget
        : target.openerTargetId
          ? {
            targetId,
            tabId: target.tabId,
            ...(typeof target.url === "string" ? { url: target.url } : {}),
            ...(typeof target.title === "string" ? { title: target.title } : {}),
            openerTargetId: target.openerTargetId
          }
          : null;
      if (popupTarget?.openerTargetId) {
        const resolvedPopupTarget = this.resolveTargetContext(session, targetId);
        if (resolvedPopupTarget && this.hasUsableDebuggee(resolvedPopupTarget)) {
          this.clearPopupAttachDiagnostic(session.id, targetId);
          await this.activateTargetAndRespond(message, session, targetId);
          return;
        }
      }
      const deferPopupActivation = Boolean(popupTarget?.openerTargetId && typeof target.sessionId !== "string");
      if (!deferPopupActivation) {
        await this.tabs.activateTab(target.tabId).catch(() => undefined);
      }
      if (typeof target.sessionId !== "string") {
        if (popupTarget?.openerTargetId && await this.attachTargetViaOpenerSession(session, popupTarget).catch(() => false)) {
          this.clearPopupAttachDiagnostic(session.id, targetId);
          await this.activateTargetAndRespond(message, session, targetId);
          return;
        }
        if (popupTarget?.openerTargetId) {
          const resolvedPopupTarget = this.resolveTargetContext(session, targetId);
          if (resolvedPopupTarget && this.hasUsableDebuggee(resolvedPopupTarget)) {
            this.clearPopupAttachDiagnostic(session.id, targetId);
            await this.activateTargetAndRespond(message, session, targetId);
            return;
          }
          if (this.shouldPreferDirectPopupTabAttach(popupTarget)) {
            try {
              await this.attachTargetTab(target.tabId);
              await this.enableTargetDomains(target.tabId);
              this.clearPopupAttachDiagnostic(session.id, targetId);
              await this.activateTargetAndRespond(message, session, targetId);
              return;
            } catch (error) {
              if (!isAttachBlockedError(error)) {
                const detail = error instanceof Error ? error.message : "Debugger attach failed";
                this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
                return;
              }
            }
          }
          this.sendPopupAttachPendingError(message, session, targetId);
          return;
        }
        try {
          await this.attachTargetTab(target.tabId);
          await this.enableTargetDomains(target.tabId);
          this.clearPopupAttachDiagnostic(session.id, targetId);
        } catch (error) {
          if (isAttachBlockedError(error) && popupTarget && await this.attachTargetViaOpenerSession(session, popupTarget).catch(() => false)) {
            session.activeTargetId = targetId;
            this.clearPopupAttachDiagnostic(session.id, targetId);
            await this.tabs.activateTab(target.tabId).catch(() => undefined);
            const tab = await this.tabs.getTab(target.tabId);
            this.sendResponse(message, {
              activeTargetId: targetId,
              url: resolveReportedTargetUrl(this.resolveTargetContext(session, targetId), tab?.url),
              title: resolveReportedTargetTitle(this.resolveTargetContext(session, targetId), tab?.title)
            });
            return;
          }
          const detail = error instanceof Error ? error.message : "Debugger attach failed";
          this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
          return;
        }
      }
    }
    await this.activateTargetAndRespond(message, session, targetId);
  }

  private async handleTargetsRegisterCanvas(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const targetId = typeof payload.targetId === "string" ? payload.targetId.trim() : "";
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "Missing targetId", false));
      return;
    }
    try {
      this.sendResponse(message, await this.registerCanvasTarget(session, targetId));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Canvas target registration failed";
      if (detail === "Canvas targetId must be tab-<id>.") {
        this.sendError(message, buildError("invalid_request", detail, false));
        return;
      }
      if (detail === "Unknown targetId") {
        this.sendError(message, buildError("invalid_request", detail, false));
        return;
      }
      if (detail === "Only the extension canvas tab can be registered.") {
        this.sendError(message, buildError("restricted_url", detail, false));
        return;
      }
      logError("ops.register_canvas_target", error, {
        code: "canvas_target_attach_failed",
        extra: { targetId }
      });
      this.sendError(message, buildError("execution_failed", detail, false));
      return;
    }
  }

  private async registerCanvasTarget(
    session: OpsSession,
    targetId: string
  ): Promise<{ targetId: string; url?: string; title?: string; adopted?: boolean }> {
    const tabId = parseTabTargetId(targetId);
    if (tabId === null) {
      throw new Error("Canvas targetId must be tab-<id>.");
    }
    let tab = await this.tabs.getTab(tabId);
    if (!tab) {
      throw new Error("Unknown targetId");
    }
    await this.tabs.waitForTabComplete(tabId, 5000).catch(() => undefined);
    tab = await this.tabs.getTab(tabId) ?? tab;
    if (!this.isAllowedCanvasTargetUrl(tab.url)) {
      throw new Error("Only the extension canvas tab can be registered.");
    }
    const existing = session.targets.get(targetId);
    if (existing) {
      existing.url = tab.url ?? existing.url;
      existing.title = tab.title ?? existing.title;
      session.activeTargetId = targetId;
      return {
        targetId,
        url: existing.url,
        title: existing.title,
        adopted: false
      };
    }
    try {
      await this.attachTargetTab(tabId);
      await this.enableTargetDomains(tabId);
    } catch (error) {
      logError("ops.register_canvas_target", error, {
        code: "canvas_target_attach_failed",
        extra: { tabId, targetId }
      });
    }
    const target = this.sessions.addTarget(session.id, tabId, { url: tab.url ?? undefined, title: tab.title ?? undefined });
    session.activeTargetId = target.targetId;
    return {
      targetId: target.targetId,
      url: target.url,
      title: target.title,
      adopted: true
    };
  }

  private async handleTargetsNew(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const url = typeof payload.url === "string" ? payload.url : undefined;
    const tab = await this.tabs.createTab(url, true);
    if (!tab?.id) {
      this.sendError(message, buildError("execution_failed", "Target creation failed", false));
      return;
    }
    await this.tabs.waitForTabComplete(tab.id).catch(() => undefined);
    try {
      await this.attachTargetTab(tab.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
      return;
    }
    const target = this.sessions.addTarget(session.id, tab.id, { url: tab.url ?? undefined, title: tab.title ?? undefined });
    session.activeTargetId = target.targetId;
    this.sendResponse(message, { targetId: target.targetId });
  }

  private async handleTargetsClose(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const targetId = typeof payload.targetId === "string" ? payload.targetId : null;
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "Missing targetId", false));
      return;
    }
    const target = session.targets.get(targetId) ?? null;
    const synthetic = this.sessions.getSyntheticTarget(session.id, targetId);
    if (!target && !synthetic) {
      this.sendError(message, buildError("invalid_request", "Unknown targetId", false));
      return;
    }
    if (synthetic) {
      this.sessions.removeSyntheticTarget(session.id, targetId);
      await this.cdp.sendCommand(synthetic.sessionId ? { tabId: synthetic.tabId, sessionId: synthetic.sessionId } : { tabId: synthetic.tabId }, "Target.closeTarget", {
        targetId: synthetic.targetId
      }).catch(() => undefined);
      this.restoreSyntheticFallbackTarget(session, synthetic);
      this.sendResponse(message, { ok: true });
      return;
    }
    if (!target) {
      this.sendError(message, buildError("invalid_request", "Unknown targetId", false));
      return;
    }
    this.sessions.removeTarget(session.id, targetId);
    void this.closeTabBestEffort(target.tabId);
    if (target.targetId === session.targetId || session.targets.size === 0) {
      this.sendResponse(message, { ok: true });
      this.scheduleSessionCleanup(session.id, "ops_session_closed");
      return;
    }
    this.sendResponse(message, { ok: true });
  }

  private async handlePageOpen(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const name = typeof payload.name === "string" ? payload.name : null;
    if (!name) {
      this.sendError(message, buildError("invalid_request", "Missing name", false));
      return;
    }
    const existingTargetId = this.sessions.getTargetIdByName(session.id, name);
    if (existingTargetId) {
      const target = session.targets.get(existingTargetId) ?? null;
      this.sendResponse(message, { targetId: existingTargetId, created: false, url: target?.url, title: target?.title });
      return;
    }
    const url = typeof payload.url === "string" ? payload.url : undefined;
    const tab = await this.tabs.createTab(url, true);
    if (!tab?.id) {
      this.sendError(message, buildError("execution_failed", "Target creation failed", false));
      return;
    }
    await this.tabs.waitForTabComplete(tab.id).catch(() => undefined);
    try {
      await this.attachTargetTab(tab.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
      return;
    }
    const target = this.sessions.addTarget(session.id, tab.id, { url: tab.url ?? undefined, title: tab.title ?? undefined });
    this.sessions.setName(session.id, target.targetId, name);
    session.activeTargetId = target.targetId;
    this.sendResponse(message, { targetId: target.targetId, created: true, url: target.url, title: target.title });
  }

  private async handlePageList(message: OpsRequest, session: OpsSession): Promise<void> {
    const pages = await Promise.all(this.sessions.listNamedTargets(session.id).map(async ({ name, targetId }) => {
      const target = this.resolveTargetContext(session, targetId);
      const tab = target ? await this.tabs.getTab(target.tabId) : null;
      return {
        name,
        targetId,
        url: resolveReportedTargetUrl(target, tab?.url),
        title: resolveReportedTargetTitle(target, tab?.title)
      };
    }));
    this.sendResponse(message, { pages });
  }

  private async handlePageClose(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const name = typeof payload.name === "string" ? payload.name : null;
    if (!name) {
      this.sendError(message, buildError("invalid_request", "Missing name", false));
      return;
    }
    const targetId = this.sessions.getTargetIdByName(session.id, name);
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "Unknown page name", false));
      return;
    }
    const target = session.targets.get(targetId);
    if (target) {
      this.sessions.removeTarget(session.id, targetId);
      void this.closeTabBestEffort(target.tabId);
      if (target.targetId === session.targetId || session.targets.size === 0) {
        this.sendResponse(message, { ok: true });
        this.scheduleSessionCleanup(session.id, "ops_session_closed");
        return;
      }
    }
    this.sendResponse(message, { ok: true });
  }

  private async handleGoto(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const url = typeof payload.url === "string" ? payload.url : null;
    if (!url) {
      this.sendError(message, buildError("invalid_request", "Missing url", false));
      return;
    }
    const syntheticHtml = decodeHtmlDataUrl(url);
    try {
      if (syntheticHtml === null) {
        const restriction = getRestrictionMessage(new URL(url));
        if (restriction) {
          this.sendError(message, buildError("restricted_url", restriction, false));
          return;
        }
      }
    } catch {
      this.sendError(message, buildError("invalid_request", "Invalid url", false));
      return;
    }
    const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 30000;
    const start = Date.now();
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    await this.tabs.activateTab(target.tabId).catch(() => undefined);
    const targetRecord = session.targets.get(target.targetId);
    if (syntheticHtml !== null) {
      const result = await executeInTab(target.tabId, replaceDocumentWithHtmlScript, [{ html: syntheticHtml }]);
      session.refStore.clearTarget(target.targetId);
      this.sessions.upsertSyntheticTarget(session.id, {
        targetId: target.targetId,
        tabId: target.tabId,
        type: "page",
        url,
        title: typeof result?.title === "string" && result.title.trim().length > 0
          ? result.title
          : targetRecord?.title,
        attachedAt: Date.now()
      });
      this.sendResponse(message, {
        finalUrl: url,
        status: undefined,
        timingMs: Date.now() - start
      });
      return;
    }
    const updated = await new Promise<chrome.tabs.Tab | null>((resolve) => {
      chrome.tabs.update(target.tabId, { url }, (tab) => {
        resolve(tab ?? null);
      });
    });
    await this.tabs.waitForTabComplete(target.tabId, timeoutMs).catch(() => undefined);
    const refreshed = await this.tabs.getTab(target.tabId);
    this.sessions.removeSyntheticTarget(session.id, target.targetId);
    if (targetRecord) {
      session.targets.set(target.targetId, {
        ...targetRecord,
        url: refreshed?.url ?? updated?.url ?? url,
        title: refreshed?.title ?? updated?.title ?? targetRecord.title
      });
    }
    this.sendResponse(message, {
      finalUrl: refreshed?.url ?? updated?.url ?? url,
      status: undefined,
      timingMs: Date.now() - start
    });
  }

  private async handleWait(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 30000;
    const start = Date.now();
    const target = this.requireActiveTarget(session, message);
    if (!target) return;

    if (typeof payload.ref === "string") {
      const state = payload.state === "visible" || payload.state === "hidden" ? payload.state : "attached";
      const resolved = this.resolveRefFromPayload(session, payload.ref, message);
      if (!resolved) return;
      try {
        if (this.isAllowedCanvasTargetUrl(target.url)) {
          await this.waitForSelector(target, resolved.selector, state, timeoutMs);
        } else {
          await this.waitForRefState(resolved, state, timeoutMs);
        }
        this.sendResponse(message, { timingMs: Date.now() - start });
      } catch (error) {
        this.sendError(message, buildError("timeout", error instanceof Error ? error.message : "Timeout", true));
      }
      return;
    }

    try {
      await this.tabs.waitForTabComplete(target.tabId, timeoutMs);
      this.sendResponse(message, { timingMs: Date.now() - start });
    } catch (error) {
      this.sendError(message, buildError("timeout", error instanceof Error ? error.message : "Timeout", true));
    }
  }

  private async handleSnapshot(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const snapshot = await this.captureSnapshotPayload(message, session, {
      mode: payload.mode === "actionables" ? "actionables" : "outline",
      maxChars: typeof payload.maxChars === "number" ? payload.maxChars : 16000,
      cursor: typeof payload.cursor === "string" ? payload.cursor : undefined,
      maxNodes: typeof payload.maxNodes === "number" ? payload.maxNodes : undefined
    });
    if (!snapshot) return;
    this.sendResponse(message, {
      snapshotId: snapshot.snapshotId,
      url: snapshot.url,
      title: snapshot.title,
      content: snapshot.content,
      truncated: snapshot.truncated,
      ...(snapshot.nextCursor ? { nextCursor: snapshot.nextCursor } : {}),
      refCount: snapshot.refCount,
      timingMs: snapshot.timingMs,
      warnings: snapshot.warnings
    });
  }

  private async handleReview(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const snapshot = await this.captureSnapshotPayload(message, session, {
      mode: "actionables",
      maxChars: typeof payload.maxChars === "number" ? payload.maxChars : 16000,
      cursor: typeof payload.cursor === "string" ? payload.cursor : undefined,
      maxNodes: typeof payload.maxNodes === "number" ? payload.maxNodes : undefined
    });
    if (!snapshot) return;
    this.sendResponse(message, {
      sessionId: session.id,
      targetId: snapshot.target.targetId,
      mode: "extension",
      snapshotId: snapshot.snapshotId,
      url: snapshot.url,
      title: snapshot.title,
      content: snapshot.content,
      truncated: snapshot.truncated,
      ...(snapshot.nextCursor ? { nextCursor: snapshot.nextCursor } : {}),
      refCount: snapshot.refCount,
      timingMs: snapshot.timingMs,
      ...(snapshot.warnings.length > 0 ? { warnings: snapshot.warnings } : {})
    });
  }

  private async handleClick(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const start = Date.now();
    const before = await this.tabs.getTab(resolved.target.tabId);
    await this.tabs.activateTab(resolved.target.tabId).catch(() => undefined);
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(resolved.target, resolved.selector, { type: "click" }, () => this.dom.click(resolved.target.tabId, resolved.selector));
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_SCROLL_INTO_VIEW_DECLARATION);
      const point = await this.resolveRefPoint(resolved);
      await this.dispatchMouseEvent(resolved.target.debuggee, "mouseMoved", point.x, point.y);
      await this.dispatchMouseEvent(resolved.target.debuggee, "mousePressed", point.x, point.y, {
        button: "left",
        clickCount: 1
      });
      await this.dispatchMouseEvent(resolved.target.debuggee, "mouseReleased", point.x, point.y, {
        button: "left",
        clickCount: 1
      });
    }
    const after = await this.tabs.getTab(resolved.target.tabId);
    const navigated = Boolean(before?.url && after?.url && before.url !== after.url);
    this.sendResponse(message, { timingMs: Date.now() - start, navigated });
  }

  private async handleHover(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const start = Date.now();
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(resolved.target, resolved.selector, { type: "hover" }, () => this.dom.hover(resolved.target.tabId, resolved.selector));
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_HOVER_DECLARATION);
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePress(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const key = typeof payload.key === "string" ? payload.key : null;
    if (!key) {
      this.sendError(message, buildError("invalid_request", "Missing key", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const resolved = typeof payload.ref === "string" ? this.resolveRefFromPayload(session, payload.ref, message) : null;
    if (payload.ref && !resolved) return;
    const start = Date.now();
    if (resolved && this.isAllowedCanvasTargetUrl(target.url)) {
      await this.runCanvasPageAction(
        target,
        { type: "press", key },
        resolved.selector,
        () => this.dom.press(target.tabId, resolved.selector, key)
      );
    } else if (resolved) {
      await this.callFunctionOnRef<void>(resolved, DOM_FOCUS_DECLARATION);
      await this.dispatchKeyPress(target.debuggee, key);
    } else {
      await this.dispatchKeyPress(target.debuggee, key);
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handleCheck(message: OpsRequest, session: OpsSession, checked: boolean): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const start = Date.now();
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "setChecked", checked },
        () => this.dom.setChecked(resolved.target.tabId, resolved.selector, checked)
      );
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_SET_CHECKED_DECLARATION, [checked]);
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handleType(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const text = typeof payload.text === "string" ? payload.text : null;
    if (!ref || text === null) {
      this.sendError(message, buildError("invalid_request", "Missing ref or text", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const start = Date.now();
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "type", value: text, clear: payload.clear === true, submit: payload.submit === true },
        () => this.dom.type(resolved.target.tabId, resolved.selector, text, payload.clear === true, payload.submit === true)
      );
    } else {
      await this.callFunctionOnRef<void>(
        resolved,
        DOM_TYPE_DECLARATION,
        [text, payload.clear === true, payload.submit === true]
      );
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handleSelect(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const values = Array.isArray(payload.values) ? payload.values.filter((val) => typeof val === "string") : null;
    if (!ref || !values) {
      this.sendError(message, buildError("invalid_request", "Missing ref or values", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "select", values: values as string[] },
        () => this.dom.select(resolved.target.tabId, resolved.selector, values as string[])
      );
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_SELECT_DECLARATION, [values as string[]]);
    }
    this.sendResponse(message, {});
  }

  private async handleScroll(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const dy = typeof payload.dy === "number" ? payload.dy : 0;
    const ref = typeof payload.ref === "string" ? payload.ref : undefined;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const resolved = ref ? this.resolveRefFromPayload(session, ref, message) : null;
    if (ref && !resolved) return;
    if (resolved && !this.isAllowedCanvasTargetUrl(target.url)) {
      await this.callFunctionOnRef<void>(resolved, DOM_SCROLL_BY_DECLARATION, [dy]);
    } else {
      const selector = resolved?.selector;
      await this.runCanvasPageAction(
        target,
        { type: "scroll", dy },
        selector ?? null,
        () => this.dom.scroll(target.tabId, dy, selector)
      );
    }
    this.sendResponse(message, {});
  }

  private async handleScrollIntoView(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const start = Date.now();
    if (this.isAllowedCanvasTargetUrl(resolved.target.url)) {
      await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "scrollIntoView" },
        () => this.dom.scrollIntoView(resolved.target.tabId, resolved.selector)
      );
    } else {
      await this.callFunctionOnRef<void>(resolved, DOM_SCROLL_INTO_VIEW_DECLARATION);
    }
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePointerMove(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const coords = this.parsePointerCoords(payload);
    if (!coords) {
      this.sendError(message, buildError("invalid_request", "Pointer move requires numeric x and y.", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", coords.x, coords.y, {
      steps: typeof payload.steps === "number" && Number.isFinite(payload.steps)
        ? Math.max(1, Math.floor(payload.steps))
        : undefined
    });
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePointerDown(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const coords = this.parsePointerCoords(payload);
    if (!coords) {
      this.sendError(message, buildError("invalid_request", "Pointer down requires numeric x and y.", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", coords.x, coords.y);
    await this.dispatchMouseEvent(target.debuggee, "mousePressed", coords.x, coords.y, {
      button: this.parsePointerButton(payload.button),
      clickCount: typeof payload.clickCount === "number" && Number.isFinite(payload.clickCount)
        ? Math.max(1, Math.floor(payload.clickCount))
        : 1
    });
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePointerUp(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const coords = this.parsePointerCoords(payload);
    if (!coords) {
      this.sendError(message, buildError("invalid_request", "Pointer up requires numeric x and y.", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", coords.x, coords.y);
    await this.dispatchMouseEvent(target.debuggee, "mouseReleased", coords.x, coords.y, {
      button: this.parsePointerButton(payload.button),
      clickCount: typeof payload.clickCount === "number" && Number.isFinite(payload.clickCount)
        ? Math.max(1, Math.floor(payload.clickCount))
        : 1
    });
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handlePointerDrag(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const from = isRecord(payload.from) ? this.parsePointerCoords(payload.from) : null;
    const to = isRecord(payload.to) ? this.parsePointerCoords(payload.to) : null;
    if (!from || !to) {
      this.sendError(message, buildError("invalid_request", "Pointer drag requires numeric from/to coordinates.", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const start = Date.now();
    const steps = typeof payload.steps === "number" && Number.isFinite(payload.steps)
      ? Math.max(1, Math.floor(payload.steps))
      : 1;
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", from.x, from.y);
    await this.dispatchMouseEvent(target.debuggee, "mousePressed", from.x, from.y);
    await this.dispatchMouseEvent(target.debuggee, "mouseMoved", to.x, to.y, { steps });
    await this.dispatchMouseEvent(target.debuggee, "mouseReleased", to.x, to.y);
    this.sendResponse(message, { timingMs: Date.now() - start });
  }

  private async handleDomGetHtml(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const maxChars = typeof payload.maxChars === "number" ? payload.maxChars : 8000;
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const html = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "outerHTML" },
        () => this.dom.getOuterHtml(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<string>(resolved, DOM_OUTER_HTML_DECLARATION);
    const truncated = html.length > maxChars;
    const outerHTML = truncated ? html.slice(0, maxChars) : html;
    this.sendResponse(message, { outerHTML, truncated });
  }

  private async handleDomGetText(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const maxChars = typeof payload.maxChars === "number" ? payload.maxChars : 8000;
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const text = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "innerText" },
        () => this.dom.getInnerText(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<string>(resolved, DOM_INNER_TEXT_DECLARATION);
    const truncated = text.length > maxChars;
    this.sendResponse(message, { text: truncated ? text.slice(0, maxChars) : text, truncated });
  }

  private async handleDomGetAttr(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    const name = typeof payload.name === "string" ? payload.name : null;
    if (!ref || !name) {
      this.sendError(message, buildError("invalid_request", "Missing ref or name", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const value = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "getAttr", name },
        () => this.dom.getAttr(resolved.target.tabId, resolved.selector, name)
      )
      : await this.callFunctionOnRef<string | null>(resolved, DOM_GET_ATTR_DECLARATION, [name]);
    this.sendResponse(message, { value });
  }

  private async handleDomGetValue(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return;
    }
    const resolved = this.resolveRefFromPayload(session, ref, message);
    if (!resolved) return;
    const value = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "getValue" },
        () => this.dom.getValue(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<string | null>(resolved, DOM_GET_VALUE_DECLARATION);
    this.sendResponse(message, { value });
  }

  private async handleDomIsVisible(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const visible = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "getSelectorState" },
        async () => await this.dom.getSelectorState(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<boolean>(resolved, DOM_IS_VISIBLE_DECLARATION);
    const isVisible = typeof visible === "object" && visible !== null && "visible" in visible
      ? Boolean((visible as { visible?: unknown }).visible)
      : Boolean(visible);
    this.sendResponse(message, { value: isVisible });
  }

  private async handleDomIsEnabled(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const enabled = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "isEnabled" },
        () => this.dom.isEnabled(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<boolean>(resolved, DOM_IS_ENABLED_DECLARATION);
    this.sendResponse(message, { value: enabled });
  }

  private async handleDomIsChecked(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const checked = this.isAllowedCanvasTargetUrl(resolved.target.url)
      ? await this.runElementAction(
        resolved.target,
        resolved.selector,
        { type: "isChecked" },
        () => this.dom.isChecked(resolved.target.tabId, resolved.selector)
      )
      : await this.callFunctionOnRef<boolean>(resolved, DOM_IS_CHECKED_DECLARATION);
    this.sendResponse(message, { value: checked });
  }

  private async handleDomRefPoint(message: OpsRequest, session: OpsSession): Promise<void> {
    const resolved = this.resolveRefFromPayload(session, message.payload, message);
    if (!resolved) return;
    const point = await this.resolveRefPoint(resolved);
    this.sendResponse(message, point);
  }

  private async handleCanvasOverlayMount(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const mountId = typeof payload.mountId === "string" && payload.mountId.trim().length > 0
      ? payload.mountId.trim()
      : `mount_${createId()}`;
    const title = typeof payload.title === "string" && payload.title.trim().length > 0
      ? payload.title.trim()
      : "OpenDevBrowser Canvas";
    const prototypeId = typeof payload.prototypeId === "string" && payload.prototypeId.trim().length > 0
      ? payload.prototypeId.trim()
      : "prototype";
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const selection = parseCanvasOverlaySelection(payload.selection, target.targetId);
    const result = await this.dom.mountCanvasOverlay(target.tabId, {
      mountId,
      title,
      prototypeId,
      selection
    });
    this.sendResponse(message, {
      mountId,
      targetId: target.targetId,
      previewState: "background",
      overlayState: result.overlayState ?? "mounted",
      capabilities: { selection: true, guides: true }
    });
  }

  private async handleCanvasOverlayUnmount(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const mountId = typeof payload.mountId === "string" ? payload.mountId.trim() : "";
    if (!mountId) {
      this.sendError(message, buildError("invalid_request", "Missing mountId", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    await this.dom.unmountCanvasOverlay(target.tabId, mountId);
    this.sendResponse(message, {
      ok: true,
      mountId,
      targetId: target.targetId,
      overlayState: "idle"
    });
  }

  private async handleCanvasOverlaySelect(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const mountId = typeof payload.mountId === "string" ? payload.mountId.trim() : "";
    const nodeId = typeof payload.nodeId === "string" && payload.nodeId.trim().length > 0
      ? payload.nodeId.trim()
      : null;
    const selectionHint = isRecord(payload.selectionHint) ? payload.selectionHint : {};
    if (!mountId || (!nodeId && Object.keys(selectionHint).length === 0)) {
      this.sendError(message, buildError("invalid_request", "Missing mountId or selection target", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const selection = await this.dom.selectCanvasOverlay(target.tabId, { nodeId, selectionHint });
    this.sendResponse(message, {
      mountId,
      targetId: target.targetId,
      selection
    });
  }

  private async handleCanvasOverlaySync(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const mountId = typeof payload.mountId === "string" ? payload.mountId.trim() : "";
    if (!mountId) {
      this.sendError(message, buildError("invalid_request", "Missing mountId", false));
      return;
    }
    const title = typeof payload.title === "string" && payload.title.trim().length > 0
      ? payload.title.trim()
      : "OpenDevBrowser Canvas";
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const selection = parseCanvasOverlaySelection(payload.selection, target.targetId);
    const result = await this.dom.syncCanvasOverlay(target.tabId, {
      mountId,
      title,
      selection
    });
    this.sendResponse(message, {
      ok: true,
      mountId,
      targetId: target.targetId,
      overlayState: result.overlayState ?? "mounted"
    });
  }

  private async handleCanvasRuntimePreviewBridge(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const bindingId = typeof payload.bindingId === "string" ? payload.bindingId.trim() : "";
    const rootSelector = typeof payload.rootSelector === "string" ? payload.rootSelector.trim() : "";
    const html = typeof payload.html === "string" ? payload.html : "";
    if (!bindingId || !rootSelector) {
      this.sendError(message, buildError("invalid_request", "Missing bindingId or rootSelector", false));
      return;
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const result = await this.dom.applyRuntimePreviewBridge(target.tabId, bindingId, rootSelector, html);
    this.sendResponse(message, result);
  }

  private async handleClonePage(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const canvasCapture = await this.captureCanvasPage(target.tabId, target.targetId);
    if (canvasCapture) {
      this.sendResponse(message, { capture: canvasCapture });
      return;
    }
    const capture = await this.dom.captureDom(target.tabId, "body", {
      sanitize: payload.sanitize !== false,
      maxNodes: typeof payload.maxNodes === "number" ? payload.maxNodes : undefined,
      inlineStyles: payload.inlineStyles !== false,
      styleAllowlist: Array.isArray(payload.styleAllowlist) ? payload.styleAllowlist.filter((item) => typeof item === "string") : [],
      skipStyleValues: Array.isArray(payload.skipStyleValues) ? payload.skipStyleValues.filter((item) => typeof item === "string") : []
    });
    this.sendResponse(message, { capture });
  }

  private async handleCloneComponent(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return;
    }
    const selector = this.resolveSelector(session, ref, message);
    if (!selector) return;
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const capture = await this.dom.captureDom(target.tabId, selector, {
      sanitize: payload.sanitize !== false,
      maxNodes: typeof payload.maxNodes === "number" ? payload.maxNodes : undefined,
      inlineStyles: payload.inlineStyles !== false,
      styleAllowlist: Array.isArray(payload.styleAllowlist) ? payload.styleAllowlist.filter((item) => typeof item === "string") : [],
      skipStyleValues: Array.isArray(payload.skipStyleValues) ? payload.skipStyleValues.filter((item) => typeof item === "string") : []
    });
    this.sendResponse(message, { capture });
  }

  private async handlePerf(message: OpsRequest, session: OpsSession): Promise<void> {
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    const result = await this.cdp.sendCommand(target.debuggee, "Performance.getMetrics", {}) as { metrics?: Array<{ name: string; value: number }> };
    this.sendResponse(message, { metrics: Array.isArray(result.metrics) ? result.metrics : [] });
  }

  private async handleScreenshot(message: OpsRequest, session: OpsSession): Promise<void> {
    const target = this.requireActiveTarget(session, message);
    if (!target) return;
    try {
      const result = await withTimeout(
        this.cdp.sendCommand(target.debuggee, "Page.captureScreenshot", { format: "png" }),
        SCREENSHOT_TIMEOUT_MS,
        "Ops screenshot timed out"
      ) as { data?: string };
      if (result?.data) {
        this.sendResponse(message, { base64: result.data });
        return;
      }
    } catch (error) {
      logError("ops.screenshot", error, { code: "screenshot_failed" });
    }
    const fallback = await this.captureVisibleTab(target.tabId);
    if (fallback) {
      this.sendResponse(message, { base64: fallback, warning: "visible_only_fallback" });
      return;
    }
    this.sendError(message, buildError("execution_failed", "Screenshot failed", false));
  }

  private async handleConsolePoll(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const sinceSeq = typeof payload.sinceSeq === "number" ? payload.sinceSeq : 0;
    const max = typeof payload.max === "number" ? payload.max : 50;
    const events = session.consoleEvents.filter((event) => event.seq > sinceSeq).slice(0, max);
    const lastEvent = events.at(-1);
    const nextSeq = lastEvent ? lastEvent.seq : sinceSeq;
    this.sendResponse(message, { events, nextSeq });
  }

  private async handleNetworkPoll(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const sinceSeq = typeof payload.sinceSeq === "number" ? payload.sinceSeq : 0;
    const max = typeof payload.max === "number" ? payload.max : 50;
    const events = session.networkEvents.filter((event) => event.seq > sinceSeq).slice(0, max);
    const lastEvent = events.at(-1);
    const nextSeq = lastEvent ? lastEvent.seq : sinceSeq;
    this.sendResponse(message, { events, nextSeq });
  }

  private async handleStorageSetCookies(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const cookies = Array.isArray(payload.cookies) ? payload.cookies : null;
    if (!cookies) {
      this.sendError(message, buildError("invalid_request", "Missing cookies", false));
      return;
    }

    const strict = payload.strict !== false;
    const requestId = typeof payload.requestId === "string" && payload.requestId.trim().length > 0
      ? payload.requestId
      : createId();

    const normalized: CookieImportRecord[] = [];
    const rejected: Array<{ index: number; reason: string }> = [];
    cookies.forEach((entry, index) => {
      if (!isRecord(entry)) {
        rejected.push({ index, reason: "Invalid cookie entry: expected object." });
        return;
      }
      const validation = validateCookieRecord(entry as CookieImportRecord);
      if (!validation.valid) {
        rejected.push({ index, reason: validation.reason });
        return;
      }
      normalized.push(validation.cookie);
    });

    if (strict && rejected.length > 0) {
      this.sendError(message, buildError("invalid_request", `Cookie import rejected ${rejected.length} entries.`, false));
      return;
    }

    if (normalized.length > 0) {
      const target = this.requireActiveTarget(session, message);
      if (!target) return;
      try {
        await this.cdp.sendCommand(
          target.debuggee,
          "Network.setCookies",
          { cookies: normalized }
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Cookie import failed";
        this.sendError(message, buildError("execution_failed", detail, false));
        return;
      }
    }

    this.sendResponse(message, {
      requestId,
      imported: normalized.length,
      rejected
    });
  }

  private async handleStorageGetCookies(message: OpsRequest, session: OpsSession): Promise<void> {
    const payload = isRecord(message.payload) ? message.payload : {};
    const requestId = typeof payload.requestId === "string" && payload.requestId.trim().length > 0
      ? payload.requestId
      : createId();

    let urls: string[] | undefined;
    try {
      urls = parseCookieFilterUrls(payload.urls);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Invalid cookie url filter.";
      this.sendError(message, buildError("invalid_request", detail, false));
      return;
    }

    const target = this.requireActiveTarget(session, message);
    if (!target) return;

    let rawCookies: unknown[] = [];
    try {
      const response = await this.cdp.sendCommand(
        target.debuggee,
        "Network.getCookies",
        urls ? { urls } : {}
      ) as { cookies?: unknown[] };
      rawCookies = Array.isArray(response.cookies) ? response.cookies : [];
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Cookie list failed";
      this.sendError(message, buildError("execution_failed", detail, false));
      return;
    }

    const cookies = rawCookies
      .map((entry) => toCookieListRecord(entry))
      .filter((entry): entry is CookieListRecord => entry !== null);

    this.sendResponse(message, {
      requestId,
      cookies,
      count: cookies.length
    });
  }

  private async enableSessionDomains(session: OpsSession): Promise<void> {
    await this.enableTargetDomains(session.tabId);
  }

  private async attachTargetTab(tabId: number): Promise<void> {
    try {
      await this.cdp.attach(tabId);
    } catch (error) {
      if (isAttachBlockedError(error)) {
        await delay(50);
        try {
          await this.cdp.attach(tabId);
          return;
        } catch (retryError) {
          error = retryError;
        }
      }
      const diagnostic = this.cdp.getLastRootAttachDiagnostic?.(tabId) ?? null;
      const detail = error instanceof Error ? error.message : "Debugger attach failed";
      logError("ops.direct_attach_stage", error instanceof Error ? error : new Error(detail), {
        code: "direct_attach_stage",
        extra: {
          tabId,
          ...(this.toDirectAttachDiagnosticDetails(diagnostic) ?? {}),
          ...(!diagnostic ? { reason: detail } : {})
        }
      });
      throw this.decorateDirectAttachError(error, diagnostic);
    }
  }

  private async enableTargetDomains(tabId: number): Promise<void> {
    try {
      await this.cdp.setDiscoverTargetsEnabled?.(true);
      await this.cdp.configureAutoAttach?.({
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      });
      await this.cdp.primeAttachedRootSession?.(tabId);
      await this.cdp.sendCommand({ tabId }, "Runtime.enable", {});
      await this.cdp.sendCommand({ tabId }, "Network.enable", {});
      await this.cdp.sendCommand({ tabId }, "Performance.enable", {});
    } catch (error) {
      logError("ops.enable_domains", error, { code: "enable_domains_failed" });
    }
  }

  private parsePointerCoords(payload: Record<string, unknown>): { x: number; y: number } | null {
    const x = typeof payload.x === "number" && Number.isFinite(payload.x) ? payload.x : null;
    const y = typeof payload.y === "number" && Number.isFinite(payload.y) ? payload.y : null;
    return x === null || y === null ? null : { x, y };
  }

  private parsePointerButton(value: unknown): "left" | "middle" | "right" {
    return value === "middle" || value === "right" ? value : "left";
  }

  private async dispatchMouseEvent(
    debuggee: chrome.debugger.Debuggee,
    type: "mouseMoved" | "mousePressed" | "mouseReleased",
    x: number,
    y: number,
    options: {
      button?: "left" | "middle" | "right";
      clickCount?: number;
      steps?: number;
    } = {}
  ): Promise<void> {
    if (type === "mouseMoved" && options.steps && options.steps > 1) {
      const stepCount = Math.max(1, options.steps);
      for (let index = 1; index <= stepCount; index += 1) {
        await this.cdp.sendCommand(
          debuggee,
          "Input.dispatchMouseEvent",
          {
            type,
            x,
            y,
            button: options.button ?? "none",
            clickCount: options.clickCount ?? 0
          }
        );
      }
      return;
    }
    await this.cdp.sendCommand(
      debuggee,
      "Input.dispatchMouseEvent",
      {
        type,
        x,
        y,
        button: options.button ?? (type === "mouseMoved" ? "none" : "left"),
        clickCount: options.clickCount ?? (type === "mouseMoved" ? 0 : 1)
      }
    );
  }

  private async dispatchKeyPress(debuggee: chrome.debugger.Debuggee, key: string): Promise<void> {
    const text = key.length === 1 ? key : undefined;
    await this.cdp.sendCommand(debuggee, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      ...(text ? { text } : {})
    });
    await this.cdp.sendCommand(debuggee, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key
    });
  }

  private async withSession(message: OpsRequest, clientId: string, handler: (session: OpsSession) => Promise<void>): Promise<void> {
    const session = this.getSessionForMessage(message, clientId);
    if (!session) return;
    if (!TARGET_SCOPED_COMMANDS.has(message.command)) {
      session.queue = session.queue.then(() => handler(session), () => handler(session));
      await session.queue;
      return;
    }
    try {
      await this.withTargetQueue(message, session, handler);
    } catch (error) {
      if (isParallelismBackpressureError(error)) {
        this.sendError(
          message,
          buildError("parallelism_backpressure", error.message, true, error.details)
        );
        return;
      }
      throw error;
    }
  }

  private resolveTargetIdForQueue(session: OpsSession, message: OpsRequest): string {
    const payload = isRecord(message.payload) ? message.payload : {};
    const requested = typeof payload.targetId === "string" ? payload.targetId.trim() : "";
    return requested || session.activeTargetId || session.targetId;
  }

  private sessionQueueAgeMs(session: OpsSession): number {
    let oldest: number | null = null;
    for (const value of session.targetQueueOldestAt.values()) {
      if (oldest === null || value < oldest) {
        oldest = value;
      }
    }
    return oldest === null ? 0 : Math.max(0, Date.now() - oldest);
  }

  private sampleParallelism(session: OpsSession): OpsParallelismGovernorSnapshot {
    const now = Date.now();
    const policy = session.parallelismPolicy;
    if (
      session.parallelismState.lastSampleAt > 0
      && now - session.parallelismState.lastSampleAt < policy.sampleIntervalMs
    ) {
      return {
        state: session.parallelismState,
        pressure: session.parallelismState.lastPressure,
        targetCap: session.parallelismState.effectiveCap,
        waitQueueDepth: session.pendingParallel,
        waitQueueAgeMs: this.sessionQueueAgeMs(session)
      };
    }
    const snapshot = evaluateOpsGovernor(
      policy,
      session.parallelismState,
      {
        hostFreeMemPct: 100,
        rssUsagePct: 0,
        queueAgeMs: this.sessionQueueAgeMs(session),
        queueDepth: session.pendingParallel,
        discardedSignals: session.discardedSignals,
        frozenSignals: session.frozenSignals
      },
      now
    );
    session.parallelismState = snapshot.state;
    session.discardedSignals = 0;
    session.frozenSignals = 0;
    return snapshot;
  }

  private wakeParallelWaiters(session: OpsSession): void {
    const waiters = this.parallelWaiters.get(session.id);
    if (!waiters || waiters.length === 0) {
      return;
    }
    this.sampleParallelism(session);
    while (waiters.length > 0 && session.parallelInFlight < session.parallelismState.effectiveCap) {
      const waiter = waiters.shift();
      if (!waiter) break;
      if (waiter.timer !== null) {
        clearTimeout(waiter.timer);
        waiter.timer = null;
      }
      session.parallelInFlight += 1;
      waiter.resolve();
    }
    if (waiters.length === 0) {
      this.parallelWaiters.delete(session.id);
    }
  }

  private createParallelismBackpressureError(
    session: OpsSession,
    targetId: string,
    timeoutMs: number
  ): Error {
    const snapshot = this.sampleParallelism(session);
    const details = {
      sessionId: session.id,
      targetId,
      effectiveParallelCap: session.parallelismState.effectiveCap,
      inFlight: session.parallelInFlight,
      waitQueueDepth: snapshot.waitQueueDepth,
      waitQueueAgeMs: snapshot.waitQueueAgeMs,
      pressure: snapshot.pressure,
      timeoutMs
    };
    const error = new Error(`Parallelism cap reached for target ${targetId}; retry later.`);
    (error as Error & { code: string; details: Record<string, unknown> }).code = "parallelism_backpressure";
    (error as Error & { code: string; details: Record<string, unknown> }).details = details;
    return error;
  }

  private async acquireParallelSlot(session: OpsSession, targetId: string, timeoutMs: number): Promise<void> {
    const waiters = this.parallelWaiters.get(session.id) ?? [];
    this.parallelWaiters.set(session.id, waiters);
    this.sampleParallelism(session);
    if (session.parallelInFlight < session.parallelismState.effectiveCap && waiters.length === 0) {
      session.parallelInFlight += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: OpsParallelWaiter = {
        targetId,
        enqueuedAt: Date.now(),
        timeoutMs,
        resolve,
        reject,
        timer: null
      };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
        }
        if (waiters.length === 0) {
          this.parallelWaiters.delete(session.id);
        }
        reject(this.createParallelismBackpressureError(session, targetId, timeoutMs));
      }, timeoutMs) as unknown as number;
      waiters.push(waiter);
      this.wakeParallelWaiters(session);
    });
  }

  private releaseParallelSlot(session: OpsSession): void {
    session.parallelInFlight = Math.max(0, session.parallelInFlight - 1);
    this.wakeParallelWaiters(session);
  }

  private async withTargetQueue(
    message: OpsRequest,
    session: OpsSession,
    handler: (session: OpsSession) => Promise<void>
  ): Promise<void> {
    const targetId = this.resolveTargetIdForQueue(session, message);
    const enqueuedAt = Date.now();
    const previous = session.targetQueues.get(targetId) ?? Promise.resolve();
    let releaseQueue: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const tail = previous.then(() => gate, () => gate);
    session.targetQueues.set(targetId, tail);
    session.pendingParallel += 1;
    session.targetQueueDepth.set(targetId, (session.targetQueueDepth.get(targetId) ?? 0) + 1);
    if (!session.targetQueueOldestAt.has(targetId)) {
      session.targetQueueOldestAt.set(targetId, enqueuedAt);
    }
    await previous;

    let acquired = false;
    try {
      await this.acquireParallelSlot(session, targetId, session.parallelismPolicy.backpressureTimeoutMs);
      acquired = true;
      await handler(session);
    } finally {
      if (acquired) {
        this.releaseParallelSlot(session);
      }
      releaseQueue();
      const depth = (session.targetQueueDepth.get(targetId) ?? 1) - 1;
      if (depth <= 0) {
        session.targetQueueDepth.delete(targetId);
        session.targetQueueOldestAt.delete(targetId);
      } else {
        session.targetQueueDepth.set(targetId, depth);
      }
      session.pendingParallel = Math.max(0, session.pendingParallel - 1);
      if (session.targetQueues.get(targetId) === tail) {
        session.targetQueues.delete(targetId);
      }
    }
  }

  private getSessionForMessage(message: OpsRequest, clientId: string): OpsSession | null {
    const opsSessionId = message.opsSessionId;
    if (!opsSessionId) {
      this.sendError(message, buildError("invalid_request", "Missing opsSessionId", false));
      return null;
    }
    const session = this.sessions.get(opsSessionId);
    if (!session) {
      this.sendError(message, buildError("invalid_session", "Unknown ops session", false));
      return null;
    }
    const leaseId = typeof message.leaseId === "string" ? message.leaseId : "";
    if (session.ownerClientId !== clientId) {
      if (leaseId && leaseId === session.leaseId) {
        this.reclaimSession(session, clientId);
      } else {
        this.sendError(message, buildError("not_owner", "Client does not own session", false));
        return null;
      }
    } else if (session.state === "closing") {
      if (leaseId && leaseId === session.leaseId) {
        this.reclaimSession(session, clientId);
      } else {
        this.sendError(message, buildError("not_owner", "Client does not own session", false));
        return null;
      }
    }
    if (leaseId !== session.leaseId) {
      this.sendError(message, buildError("not_owner", "Lease does not match session owner", false));
      return null;
    }
    session.lastUsedAt = Date.now();
    return session;
  }

  private requestedTargetId(session: OpsSession, message: OpsRequest): string | null {
    const payload = isRecord(message.payload) ? message.payload : {};
    if (typeof payload.targetId === "string" && payload.targetId.trim().length > 0) {
      return payload.targetId.trim();
    }
    return session.activeTargetId || null;
  }

  private hasOpsTarget(session: OpsSession, targetId: string): boolean {
    return session.targets.has(targetId) || this.sessions.getSyntheticTarget(session.id, targetId) !== null;
  }

  private resolveTargetContext(session: OpsSession, targetId: string): ResolvedOpsTarget | null {
    const target = session.targets.get(targetId) ?? null;
    const explicitSynthetic = this.sessions.getSyntheticTarget(session.id, targetId);
    const bridgeSynthetic = explicitSynthetic ? null : this.findSyntheticSessionBridge(session, target);
    const synthetic = explicitSynthetic ?? bridgeSynthetic;
    if (!target && !synthetic) {
      return null;
    }
    const targetTabId = target?.tabId ?? synthetic?.tabId ?? session.tabId;
    const baseType = synthetic?.type ?? "page";
    return {
      targetId,
      tabId: targetTabId,
      type: baseType,
      synthetic: explicitSynthetic !== null && !session.targets.has(targetId),
      ...(explicitSynthetic?.url ? { url: explicitSynthetic.url } : target?.url ? { url: target.url } : bridgeSynthetic?.url ? { url: bridgeSynthetic.url } : {}),
      ...(explicitSynthetic?.title ? { title: explicitSynthetic.title } : target?.title ? { title: target.title } : bridgeSynthetic?.title ? { title: bridgeSynthetic.title } : {}),
      ...(synthetic?.sessionId ? { sessionId: synthetic.sessionId } : {}),
      ...(explicitSynthetic?.openerTargetId
        ? { openerTargetId: explicitSynthetic.openerTargetId }
        : target?.openerTargetId
          ? { openerTargetId: target.openerTargetId }
          : bridgeSynthetic?.openerTargetId
            ? { openerTargetId: bridgeSynthetic.openerTargetId }
            : {}),
      debuggee: synthetic?.sessionId
        ? { tabId: synthetic.tabId, sessionId: synthetic.sessionId }
        : this.cdp.getTabDebuggee?.(targetTabId) ?? { tabId: targetTabId }
    };
  }

  private hasUsableDebuggee(target: ResolvedOpsTarget): boolean {
    if (typeof target.sessionId === "string" && target.sessionId.length > 0) {
      return true;
    }
    if (typeof this.cdp.isTabAttached === "function") {
      return this.cdp.isTabAttached(target.tabId);
    }
    if (typeof this.cdp.getAttachedTabIds === "function") {
      return this.cdp.getAttachedTabIds().includes(target.tabId);
    }
    if (typeof this.cdp.getPrimaryTabId === "function") {
      return this.cdp.getPrimaryTabId() === target.tabId;
    }
    return false;
  }

  private async preparePopupTarget(session: OpsSession, targetId: string): Promise<ResolvedOpsTarget | null> {
    let target = this.resolveTargetContext(session, targetId);
    if (!target || this.hasUsableDebuggee(target)) {
      return target;
    }

    const hydratedPopupTarget = typeof target.sessionId !== "string"
      ? await this.hydratePopupOpenerTarget(session, targetId)
      : null;
    const popupTarget: OpsTargetInfo | null = hydratedPopupTarget?.openerTargetId
      ? hydratedPopupTarget
      : target.openerTargetId
        ? {
          targetId,
          tabId: target.tabId,
          ...(typeof target.url === "string" ? { url: target.url } : {}),
          ...(typeof target.title === "string" ? { title: target.title } : {}),
          openerTargetId: target.openerTargetId
        }
        : null;
    if (!popupTarget?.openerTargetId) {
      return target;
    }

    if (this.shouldPreferDirectPopupTabAttach(popupTarget)) {
      await this.tabs.activateTab(popupTarget.tabId).catch(() => undefined);
      try {
        await this.attachTargetTab(popupTarget.tabId);
        await this.enableTargetDomains(popupTarget.tabId);
        this.clearPopupAttachDiagnostic(session.id, targetId);
        target = this.resolveTargetContext(session, targetId) ?? target;
        if (this.hasUsableDebuggee(target)) {
          return target;
        }
      } catch (error) {
        if (!isAttachBlockedError(error)) {
          throw error;
        }
        this.cdp.markClientClosed();
        try {
          await this.attachTargetTab(popupTarget.tabId);
          await this.enableTargetDomains(popupTarget.tabId);
          this.clearPopupAttachDiagnostic(session.id, targetId);
          target = this.resolveTargetContext(session, targetId) ?? target;
          if (this.hasUsableDebuggee(target)) {
            return target;
          }
        } catch (resetError) {
          if (!isAttachBlockedError(resetError)) {
            throw resetError;
          }
        }
      }
    }

    if (await this.attachTargetViaOpenerSession(session, popupTarget).catch(() => false)) {
      this.clearPopupAttachDiagnostic(session.id, targetId);
    }
    return this.resolveTargetContext(session, targetId) ?? target;
  }

  private shouldPreferDirectPopupTabAttach(target: Pick<OpsTargetInfo, "tabId" | "openerTargetId">): boolean {
    const openerTabId = parseTargetAliasTabId(target.openerTargetId);
    return openerTabId !== null && openerTabId !== target.tabId;
  }

  private async activateTargetAndRespond(message: OpsRequest, session: OpsSession, targetId: string): Promise<void> {
    session.activeTargetId = targetId;
    const target = this.resolveTargetContext(session, targetId);
    if (target) {
      await this.tabs.activateTab(target.tabId).catch(() => undefined);
    }
    const tab = target ? await this.tabs.getTab(target.tabId) : null;
    this.sendResponse(message, {
      activeTargetId: targetId,
      url: target ? resolveReportedTargetUrl(target, tab?.url) : undefined,
      title: target ? resolveReportedTargetTitle(target, tab?.title) : undefined
    });
  }

  private shouldPromotePopupTarget(
    session: OpsSession,
    openerTargetId: string,
    target: ResolvedOpsTarget
  ): boolean {
    return (
      (!!target.openerTargetId || target.targetId !== session.targetId)
      && this.hasUsableDebuggee(target)
      && (
        !session.activeTargetId
        || session.activeTargetId === session.targetId
        || session.activeTargetId === openerTargetId
      )
    );
  }

  private promotePopupTarget(session: OpsSession, targetId: string): void {
    const target = this.resolveTargetContext(session, targetId);
    if (!target || !target.openerTargetId) {
      return;
    }
    if (this.shouldPromotePopupTarget(session, target.openerTargetId, target)) {
      session.activeTargetId = targetId;
    }
  }

  private findSyntheticSessionBridge(
    session: OpsSession,
    target: OpsTargetInfo | null
  ): OpsSyntheticTargetRecord | null {
    if (!target) {
      return null;
    }
    const candidates = this.sessions
      .listSyntheticTargets(session.id)
      .filter((candidate) => typeof candidate.sessionId === "string" && candidate.sessionId.length > 0);
    if (candidates.length === 0) {
      return null;
    }

    const targetUrl = typeof target.url === "string" && target.url.length > 0 ? target.url : null;
    const targetTitle = typeof target.title === "string" && target.title.length > 0 ? target.title : null;
    let matches = targetUrl
      ? candidates.filter((candidate) => candidate.url === targetUrl)
      : [];

    if (matches.length === 0 && targetTitle) {
      matches = candidates.filter((candidate) => candidate.title === targetTitle);
    } else if (matches.length > 1 && targetTitle) {
      const titledMatches = matches.filter((candidate) => candidate.title === targetTitle);
      if (titledMatches.length > 0) {
        matches = titledMatches;
      }
    }

    if (matches.length === 0 && typeof target.openerTargetId === "string" && target.openerTargetId.length > 0) {
      const targetOpenerTabId = parseTargetAliasTabId(target.openerTargetId);
      matches = candidates.filter((candidate) => {
        if (candidate.openerTargetId === target.openerTargetId) {
          return true;
        }
        const candidateOpenerTabId = parseTargetAliasTabId(candidate.openerTargetId);
        return targetOpenerTabId !== null && candidateOpenerTabId === targetOpenerTabId;
      });
    }

    if (matches.length === 0) {
      return null;
    }
    if (matches.length === 1) {
      return matches[0] ?? null;
    }
    return matches.sort((left, right) => right.attachedAt - left.attachedAt)[0] ?? null;
  }

  private async attachTargetViaOpenerSession(session: OpsSession, target: OpsTargetInfo): Promise<boolean> {
    if (typeof target.openerTargetId !== "string" || target.openerTargetId.length === 0) {
      return false;
    }
    const opener = this.resolveTargetContext(session, target.openerTargetId)
      ?? this.resolveTargetContext(session, session.targetId);
    if (!opener) {
      return false;
    }
    const openerBridgeDebuggee: chrome.debugger.Debuggee = { tabId: opener.tabId };

    let targetsLookupFailedReason: string | null = null;
    let targetInfos: Array<NonNullable<ReturnType<typeof extractTargetInfo>>> = [];
    try {
      const rawTargets = await this.cdp.sendCommand(openerBridgeDebuggee, "Target.getTargets", {}, { preserveTab: true });
      targetInfos = isRecord(rawTargets) && Array.isArray(rawTargets.targetInfos)
        ? rawTargets.targetInfos.map((entry) => extractTargetInfo(entry)).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        : [];
    } catch (error) {
      targetsLookupFailedReason = error instanceof Error ? error.message : String(error);
      targetInfos = [];
    }
    const pageTargets = targetInfos.filter((info) => info.type === "page");
    const targetUrl = typeof target.url === "string" && target.url.length > 0 ? target.url : null;
    const targetTitle = typeof target.title === "string" && target.title.length > 0 ? target.title : null;
    let matcher: PopupAttachMatcher | undefined = targetUrl ? "url" : undefined;
    let matches = targetUrl
      ? pageTargets.filter((info) => info.url === targetUrl)
      : pageTargets;
    if (matches.length === 0 && targetTitle) {
      matches = pageTargets.filter((info) => info.title === targetTitle);
      if (matches.length > 0) {
        matcher = "title";
      }
    } else if (matches.length > 1 && targetTitle) {
      const titledMatches = matches.filter((info) => info.title === targetTitle);
      if (titledMatches.length > 0) {
        matches = titledMatches;
        matcher = "title";
      }
    }

    if (matches.length === 0 && typeof target.openerTargetId === "string" && target.openerTargetId.length > 0) {
      const openerUrl = typeof opener.url === "string" && opener.url.length > 0 ? opener.url : null;
      const openerTitle = typeof opener.title === "string" && opener.title.length > 0 ? opener.title : null;
      const nonOpenerMatches = pageTargets.filter((info) => {
        if (openerUrl && info.url === openerUrl) {
          return false;
        }
        if (openerTitle && info.title === openerTitle) {
          return false;
        }
        return true;
      });
      if (nonOpenerMatches.length === 1) {
        matches = nonOpenerMatches;
        matcher = "non_opener";
      }
    }

    const popupTargetInfo = matches[0] ?? null;
    const resolvedTabTargetId = popupTargetInfo?.targetId
      ? null
      : (typeof this.cdp.resolveTabTargetId === "function"
        ? await this.cdp.resolveTabTargetId(target.tabId)
        : null);
    const popupTargetId = popupTargetInfo?.targetId ?? resolvedTabTargetId;
    if (!popupTargetId) {
      this.recordPopupAttachDiagnostic(session, target, {
        stage: targetsLookupFailedReason ? "targets_lookup_failed" : "resolve_tab_target_failed",
        ...(matcher ? { matcher } : {}),
        ...(targetsLookupFailedReason ? { reason: targetsLookupFailedReason, targetsLookupFailed: true } : {})
      });
      return false;
    }
    if (resolvedTabTargetId) {
      matcher = "resolve_tab_target_id";
    }

    const shouldRefreshAfterResolvedFallback = Boolean(
      resolvedTabTargetId
      && typeof this.cdp.refreshTabAttachment === "function"
      && (
        (targetsLookupFailedReason
          && this.shouldRefreshPopupOpenerAfterLookupFailure(targetsLookupFailedReason))
        || (popupTargetInfo === null && pageTargets.length === 0)
      )
    );

    let refreshDiagnostic: RootRefreshDiagnostic | null = null;
    let refreshReasonOverride: string | null = null;
    if (shouldRefreshAfterResolvedFallback) {
      try {
        await this.cdp.refreshTabAttachment(opener.tabId);
      } catch (error) {
        refreshDiagnostic = this.cdp.getLastRootRefreshDiagnostic?.(opener.tabId) ?? null;
        const refreshReason = error instanceof Error ? error.message : String(error);
        const canProceedWithRetainedRoot = Boolean(
          refreshDiagnostic?.rootSessionPresentAfterRefresh
          && refreshDiagnostic?.rootTargetIdAfterRefresh
          && refreshReason.includes("Not allowed")
        );
        if (canProceedWithRetainedRoot) {
          refreshReasonOverride = refreshReason;
        } else {
          this.recordPopupAttachDiagnostic(session, target, {
            stage: "raw_attach_failed",
            popupTargetId,
            ...(matcher ? { matcher } : {}),
            ...this.toPopupRefreshDiagnostic(refreshDiagnostic),
            ...(targetsLookupFailedReason ? { targetsLookupFailed: true } : {}),
            reason: refreshReason
          });
          return false;
        }
      }
      refreshDiagnostic = this.cdp.getLastRootRefreshDiagnostic?.(opener.tabId) ?? null;
    }

    let sessionId: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        sessionId = typeof this.cdp.attachChildTarget === "function"
          ? await this.cdp.attachChildTarget(opener.tabId, popupTargetId)
          : await this.cdp.sendCommand(openerBridgeDebuggee, "Target.attachToTarget", {
            targetId: popupTargetId,
            flatten: true
          }).then((attached) => isRecord(attached) && typeof attached.sessionId === "string" ? attached.sessionId : null);
      } catch (error) {
        const routerDiagnostic = this.cdp.getLastChildAttachDiagnostic(opener.tabId, popupTargetId);
        const stage = routerDiagnostic?.stage ?? "attached_root_attach_failed";
        if (attempt === 0 && this.shouldRetryPopupAttachStage(stage)) {
          await this.waitForPopupAttachRetry();
          continue;
        }
        this.recordPopupAttachDiagnostic(session, target, {
          stage,
          popupTargetId,
          ...(matcher ? { matcher } : {}),
          ...(routerDiagnostic?.initialStage ? { initialStage: routerDiagnostic.initialStage } : {}),
          ...(routerDiagnostic?.rootTargetRetryStage ? { rootTargetRetryStage: routerDiagnostic.rootTargetRetryStage } : {}),
          ...(routerDiagnostic?.attachedRootRecoveryStage
            ? { attachedRootRecoveryStage: routerDiagnostic.attachedRootRecoveryStage }
            : {}),
          ...(routerDiagnostic?.attachedRootRecoverySource
            ? { attachedRootRecoverySource: routerDiagnostic.attachedRootRecoverySource }
            : {}),
          ...(routerDiagnostic?.attachedRootRecoveryReason
            ? { attachedRootRecoveryReason: routerDiagnostic.attachedRootRecoveryReason }
            : {}),
          ...this.toPopupRefreshDiagnostic(refreshDiagnostic),
          ...(refreshReasonOverride ? { refreshReason: refreshReasonOverride } : {}),
          ...(targetsLookupFailedReason ? { targetsLookupFailed: true } : {}),
          reason: routerDiagnostic?.reason ?? (error instanceof Error ? error.message : String(error))
        });
        return false;
      }
      if (sessionId) {
        break;
      }
      const routerDiagnostic = this.cdp.getLastChildAttachDiagnostic(opener.tabId, popupTargetId);
      const stage = routerDiagnostic?.stage ?? "attached_root_attach_null";
      if (attempt === 0 && this.shouldRetryPopupAttachStage(stage)) {
        await this.waitForPopupAttachRetry();
        continue;
      }
      this.recordPopupAttachDiagnostic(session, target, {
        stage,
        popupTargetId,
        ...(matcher ? { matcher } : {}),
        ...(routerDiagnostic?.initialStage ? { initialStage: routerDiagnostic.initialStage } : {}),
        ...(routerDiagnostic?.rootTargetRetryStage ? { rootTargetRetryStage: routerDiagnostic.rootTargetRetryStage } : {}),
        ...(routerDiagnostic?.attachedRootRecoveryStage
          ? { attachedRootRecoveryStage: routerDiagnostic.attachedRootRecoveryStage }
          : {}),
        ...(routerDiagnostic?.attachedRootRecoverySource
          ? { attachedRootRecoverySource: routerDiagnostic.attachedRootRecoverySource }
          : {}),
        ...(routerDiagnostic?.attachedRootRecoveryReason
          ? { attachedRootRecoveryReason: routerDiagnostic.attachedRootRecoveryReason }
          : {}),
        ...this.toPopupRefreshDiagnostic(refreshDiagnostic),
        ...(refreshReasonOverride ? { refreshReason: refreshReasonOverride } : {}),
        ...(targetsLookupFailedReason ? { targetsLookupFailed: true } : {}),
        ...(routerDiagnostic?.reason ? { reason: routerDiagnostic.reason } : {})
      });
      return false;
    }

    this.sessions.upsertSyntheticTarget(session.id, {
      targetId: popupTargetId,
      tabId: opener.tabId,
      type: popupTargetInfo?.type ?? "page",
      ...(typeof popupTargetInfo?.url === "string" ? { url: popupTargetInfo.url } : targetUrl ? { url: targetUrl } : {}),
      ...(typeof popupTargetInfo?.title === "string" ? { title: popupTargetInfo.title } : targetTitle ? { title: targetTitle } : {}),
      sessionId: sessionId ?? undefined,
      openerTargetId: target.openerTargetId,
      attachedAt: Date.now()
    });
    this.clearPopupAttachDiagnostic(session.id, target.targetId);
    return true;
  }

  private popupAttachDiagnosticKey(sessionId: string, targetId: string): string {
    return `${sessionId}:${targetId}`;
  }

  private shouldRefreshPopupOpenerAfterLookupFailure(reason: string): boolean {
    return reason.includes("Debugger is not attached")
      || reason.includes("Detached while handling command");
  }

  private shouldRetryPopupAttachStage(stage?: PopupAttachDiagnosticStage): boolean {
    return stage === "raw_attach_failed"
      || stage === "attached_root_unavailable"
      || stage === "attached_root_attach_null"
      || stage === "attached_root_attach_failed";
  }

  private async waitForPopupAttachRetry(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, POPUP_ATTACH_RETRY_DELAY_MS));
  }

  private formatDirectAttachDiagnosticSuffix(diagnostic: RootAttachDiagnostic | null): string {
    if (!diagnostic?.stage) {
      return "";
    }
    return ` (origin: ${diagnostic.origin}; stage: ${diagnostic.stage})`;
  }

  private toDirectAttachDiagnosticDetails(diagnostic: RootAttachDiagnostic | null): DirectAttachFailureDetails | undefined {
    if (!diagnostic) {
      return undefined;
    }
    return {
      origin: diagnostic.origin,
      stage: diagnostic.stage,
      attachBy: diagnostic.attachBy,
      ...(diagnostic.probeMethod ? { probeMethod: diagnostic.probeMethod } : {}),
      ...(diagnostic.reason ? { reason: diagnostic.reason } : {})
    };
  }

  private decorateDirectAttachError(error: unknown, diagnostic: RootAttachDiagnostic | null): Error {
    const detail = error instanceof Error ? error.message : "Debugger attach failed";
    if (!diagnostic) {
      return error instanceof Error ? error : new Error(detail);
    }
    const decorated = error instanceof Error ? error as DirectAttachDecoratedError : new Error(detail) as DirectAttachDecoratedError;
    decorated.message = `${detail}${this.formatDirectAttachDiagnosticSuffix(diagnostic)}`;
    decorated.directAttachDetails = this.toDirectAttachDiagnosticDetails(diagnostic);
    return decorated;
  }

  private getDirectAttachErrorDetails(error: unknown): Record<string, unknown> | undefined {
    if (!(error instanceof Error)) {
      return undefined;
    }
    const decorated = error as DirectAttachDecoratedError;
    return decorated.directAttachDetails;
  }

  private getPopupAttachDiagnostic(sessionId: string, targetId: string): PopupAttachDiagnostic | null {
    return this.popupAttachDiagnostics.get(this.popupAttachDiagnosticKey(sessionId, targetId)) ?? null;
  }

  private clearPopupAttachDiagnostic(sessionId: string, targetId: string): void {
    this.popupAttachDiagnostics.delete(this.popupAttachDiagnosticKey(sessionId, targetId));
  }

  private recordPopupAttachDiagnostic(
    session: OpsSession,
    target: OpsTargetInfo,
    diagnostic: Omit<PopupAttachDiagnostic, "targetId" | "tabId" | "openerTargetId" | "at">
  ): void {
    const entry: PopupAttachDiagnostic = {
      targetId: target.targetId,
      tabId: target.tabId,
      ...(target.openerTargetId ? { openerTargetId: target.openerTargetId } : {}),
      at: Date.now(),
      ...diagnostic
    };
    this.popupAttachDiagnostics.set(this.popupAttachDiagnosticKey(session.id, target.targetId), entry);
    logError("ops.popup_attach_stage", new Error(entry.stage), {
      code: "popup_attach_stage",
      extra: {
        targetId: entry.targetId,
        tabId: entry.tabId,
        ...(entry.openerTargetId ? { openerTargetId: entry.openerTargetId } : {}),
        ...(entry.popupTargetId ? { popupTargetId: entry.popupTargetId } : {}),
        ...(entry.matcher ? { matcher: entry.matcher } : {}),
        ...(entry.initialStage ? { initialStage: entry.initialStage } : {}),
        ...(entry.rootTargetRetryStage ? { rootTargetRetryStage: entry.rootTargetRetryStage } : {}),
        ...(entry.attachedRootRecoveryStage ? { attachedRootRecoveryStage: entry.attachedRootRecoveryStage } : {}),
        ...(entry.attachedRootRecoverySource ? { attachedRootRecoverySource: entry.attachedRootRecoverySource } : {}),
        ...(entry.attachedRootRecoveryReason ? { attachedRootRecoveryReason: entry.attachedRootRecoveryReason } : {}),
        ...(entry.refreshPath ? { refreshPath: entry.refreshPath } : {}),
        ...(typeof entry.refreshCompleted === "boolean" ? { refreshCompleted: entry.refreshCompleted } : {}),
        ...(typeof entry.refreshDebuggeePresent === "boolean" ? { refreshDebuggeePresent: entry.refreshDebuggeePresent } : {}),
        ...(typeof entry.refreshRootSessionPresent === "boolean"
          ? { refreshRootSessionPresent: entry.refreshRootSessionPresent }
          : {}),
        ...(entry.refreshRootTargetId ? { refreshRootTargetId: entry.refreshRootTargetId } : {}),
        ...(entry.refreshProbeMethod ? { refreshProbeMethod: entry.refreshProbeMethod } : {}),
        ...(entry.refreshProbeStage ? { refreshProbeStage: entry.refreshProbeStage } : {}),
        ...(entry.refreshProbeReason ? { refreshProbeReason: entry.refreshProbeReason } : {}),
        ...(entry.refreshReason ? { refreshReason: entry.refreshReason } : {}),
        ...(entry.targetsLookupFailed ? { targetsLookupFailed: true } : {}),
        ...(entry.reason ? { reason: entry.reason } : {})
      }
    });
  }

  private toPopupRefreshDiagnostic(
    diagnostic: RootRefreshDiagnostic | null
  ): Partial<Omit<PopupAttachDiagnostic, "targetId" | "tabId" | "openerTargetId" | "at" | "stage">> {
    if (!diagnostic) {
      return {};
    }
    return {
      refreshPath: diagnostic.path,
      refreshCompleted: diagnostic.refreshCompleted,
      refreshDebuggeePresent: diagnostic.debuggeePresentAfterRefresh,
      refreshRootSessionPresent: diagnostic.rootSessionPresentAfterRefresh,
      ...(diagnostic.rootTargetIdAfterRefresh ? { refreshRootTargetId: diagnostic.rootTargetIdAfterRefresh } : {}),
      refreshProbeMethod: diagnostic.probeMethod,
      refreshProbeStage: diagnostic.probeStage,
      ...(diagnostic.probeReason ? { refreshProbeReason: diagnostic.probeReason } : {}),
      ...(diagnostic.reason ? { refreshReason: diagnostic.reason } : {})
    };
  }

  private requireActiveTarget(session: OpsSession, message: OpsRequest): ResolvedOpsTarget | null {
    const targetId = this.requestedTargetId(session, message);
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "No active target", false));
      return null;
    }
    const target = this.resolveTargetContext(session, targetId);
    if (!target) {
      this.sendError(message, buildError("invalid_request", "Active target missing", false));
      return null;
    }
    if (target.url) {
      const restriction = isRestrictedUrl(target.url);
      if (restriction.restricted && !this.isAllowedCanvasTargetUrl(target.url)) {
        this.sendError(message, buildError("restricted_url", restriction.message ?? "Restricted tab.", false));
        return null;
      }
    }
    if (target.synthetic && !target.sessionId) {
      this.sendPopupAttachPendingError(message, session, targetId);
      return null;
    }
    if (target.openerTargetId && !this.hasUsableDebuggee(target)) {
      this.sendPopupAttachPendingError(message, session, targetId);
      return null;
    }
    return target;
  }

  private isAllowedCanvasTargetUrl(rawUrl: string | undefined): boolean {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
      return false;
    }
    try {
      const allowedUrl = chrome.runtime.getURL("canvas.html");
      return rawUrl === allowedUrl || rawUrl.startsWith(`${allowedUrl}#`) || rawUrl.startsWith(`${allowedUrl}?`);
    } catch {
      return false;
    }
  }

  private async captureCanvasPage(tabId: number, targetId: string): Promise<DomCapture | null> {
    if (!this.getCanvasPageState) {
      return null;
    }
    const state = this.getCanvasPageState(targetId);
    if (!state) {
      return null;
    }
    const previewHtml = typeof state.html === "string" && state.html.length > 0
      ? extractBodyHtml(state.html)
      : null;
    const shouldProbeLiveStage = Boolean(state.pendingMutation)
      || (canvasStateContainsRichMedia(state) && !htmlContainsRichMedia(previewHtml));
    if (shouldProbeLiveStage) {
      const liveStageCapture = await this.captureLiveCanvasStage(tabId);
      if (liveStageCapture) {
        return liveStageCapture;
      }
      const documentCapture = buildCanvasDocumentCapture(state);
      if (documentCapture) {
        return documentCapture;
      }
    }
    if (!previewHtml) {
      return buildCanvasDocumentCapture(state);
    }
    return {
      html: previewHtml,
      styles: {},
      warnings: ["canvas_state_capture"],
      inlineStyles: false
    };
  }

  private async runElementAction<T>(
    target: { tabId: number; targetId: string; url?: string },
    selector: string,
    action: CanvasPageElementAction,
    fallback: () => Promise<T>
  ): Promise<T> {
    return await this.runCanvasPageAction(target, action, selector, fallback);
  }

  private async runCanvasPageAction<T>(
    target: { tabId: number; targetId: string; url?: string },
    action: CanvasPageElementAction,
    selector: string | null | undefined,
    fallback: () => Promise<T>
  ): Promise<T> {
    if (!this.isAllowedCanvasTargetUrl(target.url) || !this.performCanvasPageAction) {
      return await fallback();
    }
    return await this.performCanvasPageAction(target.targetId, action, selector ?? null) as T;
  }

  private async captureLiveCanvasStage(tabId: number): Promise<DomCapture | null> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const stage = document.getElementById("canvas-stage-inner");
          if (!(stage instanceof HTMLElement)) {
            return null;
          }
          const html = stage.innerHTML.trim();
          if (!html) {
            return null;
          }
          const width = stage.style.width || `${Math.max(stage.scrollWidth, 320)}px`;
          const height = stage.style.height || `${Math.max(stage.scrollHeight, 240)}px`;
          return `<body><main data-surface="canvas" style="position:relative;width:${width};min-height:${height};">${html}</main></body>`;
        }
      });
      const html = typeof results[0]?.result === "string" ? results[0].result : null;
      if (!html) {
        return null;
      }
      return {
        html,
        styles: {},
        warnings: ["canvas_state_capture"],
        inlineStyles: true
      };
    } catch {
      return null;
    }
  }

  private resolveRefContext(session: OpsSession, ref: string, targetId: string): ResolvedOpsRef | null {
    const target = this.resolveTargetContext(session, targetId);
    if (!target) {
      return null;
    }
    const entry = session.refStore.resolve(targetId, ref);
    if (!entry) {
      return null;
    }
    const snapshotId = session.refStore.getSnapshotId(targetId);
    if (!snapshotId || entry.snapshotId !== snapshotId) {
      return null;
    }
    return {
      target,
      ref,
      selector: entry.selector,
      backendNodeId: entry.backendNodeId,
      snapshotId: entry.snapshotId,
      ...(entry.frameId ? { frameId: entry.frameId } : {}),
      ...(entry.role ? { role: entry.role } : {}),
      ...(entry.name ? { name: entry.name } : {})
    };
  }

  private async captureSnapshotPayload(
    message: OpsRequest,
    session: OpsSession,
    options: {
      mode: SnapshotMode;
      maxChars: number;
      cursor?: string;
      maxNodes?: number;
    }
  ): Promise<{
    target: ResolvedOpsTarget;
    snapshotId: string;
    url: string | undefined;
    title: string | undefined;
    content: string;
    truncated: boolean;
    nextCursor?: string;
    refCount: number;
    timingMs: number;
    warnings: string[];
  } | null> {
    const requestedTargetId = this.requestedTargetId(session, message);
    if (requestedTargetId) {
      try {
        await this.preparePopupTarget(session, requestedTargetId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Debugger attach failed";
        this.sendError(message, buildError("cdp_attach_failed", detail, false, this.getDirectAttachErrorDetails(error)));
        return null;
      }
    }
    const target = this.requireActiveTarget(session, message);
    if (!target) return null;

    const start = Date.now();
    const entriesData = await buildSnapshot(
      (method, params) => this.cdp.sendCommand(target.debuggee, method, params as Record<string, unknown>),
      options.mode,
      () => session.refStore.nextRef(target.targetId),
      options.mode !== "actionables",
      options.maxNodes
    );
    const snapshot = session.refStore.setSnapshot(target.targetId, entriesData.entries);
    const startIndex = parseCursor(options.cursor);
    const { content, truncated, nextCursor } = paginate(entriesData.lines, startIndex, options.maxChars);
    const contentBytes = this.encoder.encode(content).length;
    if (contentBytes > MAX_SNAPSHOT_BYTES) {
      this.sendError(message, buildError("snapshot_too_large", "Snapshot exceeded max size.", false, {
        maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
        actualBytes: contentBytes
      }));
      return null;
    }

    const tab = await this.tabs.getTab(target.tabId);
    return {
      target,
      snapshotId: snapshot.snapshotId,
      url: resolveReportedTargetUrl(target, tab?.url),
      title: resolveReportedTargetTitle(target, tab?.title),
      content,
      truncated,
      ...(nextCursor ? { nextCursor } : {}),
      refCount: snapshot.count,
      timingMs: Date.now() - start,
      warnings: entriesData.warnings
    };
  }

  private resolveRefFromPayload(session: OpsSession, refOrPayload: unknown, message: OpsRequest): ResolvedOpsRef | null {
    const ref = typeof refOrPayload === "string"
      ? refOrPayload
      : (isRecord(refOrPayload) && typeof refOrPayload.ref === "string" ? refOrPayload.ref : null);
    if (!ref) {
      this.sendError(message, buildError("invalid_request", "Missing ref", false));
      return null;
    }
    const targetId = this.requestedTargetId(session, message);
    if (!targetId) {
      this.sendError(message, buildError("invalid_request", "No active target", false));
      return null;
    }
    const resolved = this.resolveRefContext(session, ref, targetId);
    if (!resolved) {
      this.sendError(message, buildError("invalid_request", `Unknown ref: ${ref}. Take a new snapshot first.`, false));
      return null;
    }
    if (resolved.target.synthetic && !resolved.target.sessionId) {
      this.sendPopupAttachPendingError(message, session, resolved.target.targetId);
      return null;
    }
    return resolved;
  }

  private formatPopupAttachDiagnosticSuffix(diagnostic: PopupAttachDiagnostic | null): string {
    if (!diagnostic?.stage) {
      return "";
    }
    const parts = [`stage: ${diagnostic.stage}`];
    if (diagnostic.rootTargetRetryStage) {
      parts.push(`root-target-retry: ${diagnostic.rootTargetRetryStage}`);
    }
    if (diagnostic.attachedRootRecoveryStage) {
      const attachedRootPart = diagnostic.attachedRootRecoverySource
        ? `${diagnostic.attachedRootRecoveryStage} via ${diagnostic.attachedRootRecoverySource}`
        : diagnostic.attachedRootRecoveryStage;
      parts.push(`attached-root: ${attachedRootPart}`);
    }
    return ` (${parts.join("; ")})`;
  }

  private sendPopupAttachPendingError(message: OpsRequest, session?: OpsSession, targetId?: string | null): void {
    const diagnostic = session && typeof targetId === "string"
      ? this.getPopupAttachDiagnostic(session.id, targetId)
      : null;
    const stageSuffix = this.formatPopupAttachDiagnosticSuffix(diagnostic);
    this.sendError(message, buildError(
      "execution_failed",
      `Popup target has not finished attaching yet${stageSuffix}. Take a new review or snapshot and retry.`,
      true,
      diagnostic
        ? {
          stage: diagnostic.stage,
          ...(diagnostic.popupTargetId ? { popupTargetId: diagnostic.popupTargetId } : {}),
          ...(diagnostic.matcher ? { matcher: diagnostic.matcher } : {}),
          ...(diagnostic.initialStage ? { initialStage: diagnostic.initialStage } : {}),
          ...(diagnostic.rootTargetRetryStage ? { rootTargetRetryStage: diagnostic.rootTargetRetryStage } : {}),
          ...(diagnostic.attachedRootRecoveryStage
            ? { attachedRootRecoveryStage: diagnostic.attachedRootRecoveryStage }
            : {}),
          ...(diagnostic.attachedRootRecoverySource
            ? { attachedRootRecoverySource: diagnostic.attachedRootRecoverySource }
            : {}),
          ...(diagnostic.attachedRootRecoveryReason
            ? { attachedRootRecoveryReason: diagnostic.attachedRootRecoveryReason }
            : {}),
          ...(diagnostic.refreshPath ? { refreshPath: diagnostic.refreshPath } : {}),
          ...(typeof diagnostic.refreshCompleted === "boolean" ? { refreshCompleted: diagnostic.refreshCompleted } : {}),
          ...(typeof diagnostic.refreshDebuggeePresent === "boolean"
            ? { refreshDebuggeePresent: diagnostic.refreshDebuggeePresent }
            : {}),
          ...(typeof diagnostic.refreshRootSessionPresent === "boolean"
            ? { refreshRootSessionPresent: diagnostic.refreshRootSessionPresent }
            : {}),
          ...(diagnostic.refreshRootTargetId ? { refreshRootTargetId: diagnostic.refreshRootTargetId } : {}),
          ...(diagnostic.refreshProbeMethod ? { refreshProbeMethod: diagnostic.refreshProbeMethod } : {}),
          ...(diagnostic.refreshProbeStage ? { refreshProbeStage: diagnostic.refreshProbeStage } : {}),
          ...(diagnostic.refreshProbeReason ? { refreshProbeReason: diagnostic.refreshProbeReason } : {}),
          ...(diagnostic.refreshReason ? { refreshReason: diagnostic.refreshReason } : {}),
          ...(diagnostic.targetsLookupFailed ? { targetsLookupFailed: true } : {}),
          ...(diagnostic.reason ? { reason: diagnostic.reason } : {})
        }
        : undefined
    ));
  }

  private resolveSelector(session: OpsSession, refOrPayload: unknown, message: OpsRequest): string | null {
    return this.resolveRefFromPayload(session, refOrPayload, message)?.selector ?? null;
  }

  private async callFunctionOnRef<T>(
    resolved: ResolvedOpsRef,
    functionDeclaration: string,
    args: unknown[] = [],
    ref: string = resolved.ref
  ): Promise<T> {
    try {
      const resolvedNode = await this.cdp.sendCommand(resolved.target.debuggee, "DOM.resolveNode", {
        backendNodeId: resolved.backendNodeId
      }) as { object?: { objectId?: string } };
      const objectId = resolvedNode.object?.objectId;
      if (!objectId) {
        throw buildStaleSnapshotError(ref);
      }
      const result = await this.cdp.sendCommand(resolved.target.debuggee, "Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true
      }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "Runtime.callFunctionOn failed");
      }
      return result.result?.value as T;
    } catch (error) {
      if (isSnapshotStaleMessage(error)) {
        throw buildStaleSnapshotError(ref);
      }
      throw error;
    }
  }

  private async resolveRefPoint(resolved: ResolvedOpsRef): Promise<{ x: number; y: number }> {
    try {
      const box = await this.cdp.sendCommand(resolved.target.debuggee, "DOM.getBoxModel", {
        backendNodeId: resolved.backendNodeId
      }) as { model?: { content?: number[] } };
      const quad = Array.isArray(box.model?.content) ? box.model?.content : [];
      if (quad.length >= 8) {
        const xs = [quad[0], quad[2], quad[4], quad[6]].filter((value): value is number => typeof value === "number");
        const ys = [quad[1], quad[3], quad[5], quad[7]].filter((value): value is number => typeof value === "number");
        if (xs.length === 4 && ys.length === 4) {
          return {
            x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
            y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2)
          };
        }
      }
    } catch (error) {
      if (isSnapshotStaleMessage(error)) {
        throw buildStaleSnapshotError(resolved.ref);
      }
    }
    const point = await this.callFunctionOnRef<{ x?: unknown; y?: unknown }>(resolved, DOM_REF_POINT_DECLARATION);
    const x = typeof point?.x === "number" && Number.isFinite(point.x) ? Math.round(point.x) : null;
    const y = typeof point?.y === "number" && Number.isFinite(point.y) ? Math.round(point.y) : null;
    if (x === null || y === null) {
      throw new Error(`Could not resolve a clickable point for ref: ${resolved.ref}`);
    }
    return { x, y };
  }

  private async waitForSelector(
    target: ResolvedOpsTarget,
    selector: string,
    state: "attached" | "visible" | "hidden",
    timeoutMs: number
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const snapshot = await this.runElementAction(
        target,
        selector,
        { type: "getSelectorState" },
        () => this.dom.getSelectorState(target.tabId, selector)
      ) as { attached?: boolean; visible?: boolean };
      if (state === "attached" && snapshot.attached) return;
      if (state === "visible" && snapshot.visible) return;
      if (state === "hidden" && (!snapshot.attached || !snapshot.visible)) return;
      await delay(200);
    }
    throw new Error("Wait for selector timed out");
  }

  private async waitForRefState(
    resolved: ResolvedOpsRef,
    state: "attached" | "visible" | "hidden",
    timeoutMs: number
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const snapshot = await this.callFunctionOnRef<{ attached?: unknown; visible?: unknown }>(
        resolved,
        DOM_SELECTOR_STATE_DECLARATION
      );
      const attached = snapshot?.attached === true;
      const visible = snapshot?.visible === true;
      if (state === "attached" && attached) return;
      if (state === "visible" && visible) return;
      if (state === "hidden" && (!attached || !visible)) return;
      await delay(200);
    }
    throw new Error("Wait for selector timed out");
  }

  private cleanupSession(session: OpsSession, event: OpsEvent["event"]): void {
    this.clearClosingTimer(session.id);
    const waiters = this.parallelWaiters.get(session.id);
    if (waiters) {
      for (const waiter of waiters) {
        if (waiter.timer !== null) {
          clearTimeout(waiter.timer);
          waiter.timer = null;
        }
        waiter.reject(new Error("Ops session closed while waiting for parallelism slot."));
      }
      this.parallelWaiters.delete(session.id);
    }
    this.sessions.delete(session.id);
    for (const target of session.targets.values()) {
      void this.cdp.detachTab(target.tabId).catch(() => undefined);
    }
    this.sendEvent({
      type: "ops_event",
      clientId: session.ownerClientId,
      opsSessionId: session.id,
      event,
      payload: { tabId: session.tabId, targetId: session.targetId }
    });
  }

  private handleClosedTarget(tabId: number, event: OpsEvent["event"]): void {
    const session = this.sessions.getByTabId(tabId);
    if (!session) return;
    const targetId = this.sessions.getTargetIdByTabId(session.id, tabId);
    if (!targetId) return;
    const removedTarget = this.sessions.removeTarget(session.id, targetId);
    if (!removedTarget) return;
    if (targetId === session.targetId || session.targets.size === 0) {
      this.cleanupSession(session, event);
    }
  }

  private async handleDebuggerDetachForTab(tabId: number): Promise<void> {
    const session = this.sessions.getByTabId(tabId);
    if (!session) return;
    if (tabId === session.tabId) {
      // Root tab detach can be transient during child-target shutdown; tab removal handler owns root teardown.
      return;
    }
    const targetId = this.sessions.getTargetIdByTabId(session.id, tabId);
    const target = targetId ? session.targets.get(targetId) ?? null : null;
    const liveTab = await this.tabs.getTab(tabId);
    if (target && this.isAllowedCanvasTargetUrl(target.url ?? liveTab?.url)) {
      if (liveTab && targetId) {
        session.targets.set(targetId, {
          ...target,
          url: liveTab.url ?? target.url,
          title: liveTab.title ?? target.title
        });
      }
      // Design tabs can detach transiently while the extension page stays open; retain the target so `/ops`
      // can reattach it later via `targets.use`.
      return;
    }
    this.handleClosedTarget(tabId, "ops_session_closed");
  }

  private async closeTabBestEffort(tabId: number): Promise<void> {
    try {
      await withTimeout(this.tabs.closeTab(tabId), TAB_CLOSE_TIMEOUT_MS, "Ops tab close timed out");
    } catch (error) {
      logError("ops.close_tab", error, {
        code: "close_tab_failed",
        extra: { tabId }
      });
    }
  }

  private scheduleSessionCleanup(sessionId: string, event: OpsEvent["event"]): void {
    setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }
      this.cleanupSession(session, event);
    }, 0);
  }

  private sendResponse(message: OpsRequest, payload: unknown): void {
    const response: OpsResponse = {
      type: "ops_response",
      requestId: message.requestId,
      clientId: message.clientId,
      opsSessionId: message.opsSessionId,
      payload
    };

    const serialized = JSON.stringify(payload ?? null);
    if (this.encoder.encode(serialized).length <= MAX_OPS_PAYLOAD_BYTES) {
      this.sendEnvelope(response);
      return;
    }

    const payloadId = createId();
    const chunkSize = Math.max(1024, MAX_OPS_PAYLOAD_BYTES - 1024);
    const chunks: string[] = [];
    for (let i = 0; i < serialized.length; i += chunkSize) {
      chunks.push(serialized.slice(i, i + chunkSize));
    }

    this.sendEnvelope({
      type: "ops_response",
      requestId: message.requestId,
      clientId: message.clientId,
      opsSessionId: message.opsSessionId,
      chunked: true,
      payloadId,
      totalChunks: chunks.length
    } satisfies OpsResponse);

    chunks.forEach((data, index) => {
      const chunk: OpsChunk = {
        type: "ops_chunk",
        requestId: message.requestId,
        clientId: message.clientId,
        opsSessionId: message.opsSessionId,
        payloadId,
        chunkIndex: index,
        totalChunks: chunks.length,
        data
      };
      this.sendEnvelope(chunk);
    });
  }

  private sendError(message: OpsRequest, error: OpsError): void {
    const payload: OpsErrorResponse = {
      type: "ops_error",
      requestId: message.requestId,
      clientId: message.clientId,
      opsSessionId: message.opsSessionId,
      error
    };
    this.sendEnvelope(payload);
  }

  private sendEvent(event: OpsEvent): void {
    this.sendEnvelope(event);
  }

  private markSessionClosing(session: OpsSession, reason: OpsEvent["event"]): void {
    if (session.state === "closing") return;
    session.state = "closing";
    session.closingReason = reason;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    const timeoutId = setTimeout(() => {
      this.closingTimers.delete(session.id);
      const current = this.sessions.get(session.id);
      if (current && current.state === "closing") {
        this.cleanupSession(current, "ops_session_expired");
      }
    }, SESSION_TTL_MS);
    this.closingTimers.set(session.id, timeoutId as unknown as number);
  }

  private reclaimSession(session: OpsSession, clientId: string): void {
    session.ownerClientId = clientId;
    session.state = "active";
    session.expiresAt = undefined;
    session.closingReason = undefined;
    this.clearClosingTimer(session.id);
  }

  private clearClosingTimer(sessionId: string): void {
    const timer = this.closingTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.closingTimers.delete(sessionId);
    }
  }

  private async captureVisibleTab(tabId: number): Promise<string | null> {
    const tab = await this.tabs.getTab(tabId);
    const windowId = tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    return await new Promise((resolve) => {
      chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (!dataUrl) {
          resolve(null);
          return;
        }
        const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
        const base64 = match?.[1] ?? null;
        resolve(base64);
      });
    });
  }
}

const numberInRange = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
};

const parseParallelismPolicy = (value: unknown): OpsParallelismGovernorPolicy => {
  if (!isRecord(value)) {
    return DEFAULT_OPS_PARALLELISM_POLICY;
  }
  const modeCapsInput = isRecord(value.modeCaps) ? value.modeCaps : {};
  return {
    floor: numberInRange(value.floor, DEFAULT_OPS_PARALLELISM_POLICY.floor, 1, 32),
    backpressureTimeoutMs: numberInRange(
      value.backpressureTimeoutMs,
      DEFAULT_OPS_PARALLELISM_POLICY.backpressureTimeoutMs,
      100,
      120000
    ),
    sampleIntervalMs: numberInRange(
      value.sampleIntervalMs,
      DEFAULT_OPS_PARALLELISM_POLICY.sampleIntervalMs,
      250,
      60000
    ),
    recoveryStableWindows: numberInRange(
      value.recoveryStableWindows,
      DEFAULT_OPS_PARALLELISM_POLICY.recoveryStableWindows,
      1,
      20
    ),
    hostFreeMemMediumPct: numberInRange(
      value.hostFreeMemMediumPct,
      DEFAULT_OPS_PARALLELISM_POLICY.hostFreeMemMediumPct,
      1,
      99
    ),
    hostFreeMemHighPct: numberInRange(
      value.hostFreeMemHighPct,
      DEFAULT_OPS_PARALLELISM_POLICY.hostFreeMemHighPct,
      1,
      99
    ),
    hostFreeMemCriticalPct: numberInRange(
      value.hostFreeMemCriticalPct,
      DEFAULT_OPS_PARALLELISM_POLICY.hostFreeMemCriticalPct,
      1,
      99
    ),
    rssBudgetMb: numberInRange(
      value.rssBudgetMb,
      DEFAULT_OPS_PARALLELISM_POLICY.rssBudgetMb,
      64,
      65536
    ),
    rssSoftPct: numberInRange(
      value.rssSoftPct,
      DEFAULT_OPS_PARALLELISM_POLICY.rssSoftPct,
      1,
      99
    ),
    rssHighPct: numberInRange(
      value.rssHighPct,
      DEFAULT_OPS_PARALLELISM_POLICY.rssHighPct,
      1,
      99
    ),
    rssCriticalPct: numberInRange(
      value.rssCriticalPct,
      DEFAULT_OPS_PARALLELISM_POLICY.rssCriticalPct,
      1,
      99
    ),
    queueAgeHighMs: numberInRange(
      value.queueAgeHighMs,
      DEFAULT_OPS_PARALLELISM_POLICY.queueAgeHighMs,
      100,
      120000
    ),
    queueAgeCriticalMs: numberInRange(
      value.queueAgeCriticalMs,
      DEFAULT_OPS_PARALLELISM_POLICY.queueAgeCriticalMs,
      100,
      120000
    ),
    modeCaps: {
      managedHeaded: numberInRange(
        modeCapsInput.managedHeaded,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.managedHeaded,
        1,
        64
      ),
      managedHeadless: numberInRange(
        modeCapsInput.managedHeadless,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.managedHeadless,
        1,
        64
      ),
      cdpConnectHeaded: numberInRange(
        modeCapsInput.cdpConnectHeaded,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.cdpConnectHeaded,
        1,
        64
      ),
      cdpConnectHeadless: numberInRange(
        modeCapsInput.cdpConnectHeadless,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.cdpConnectHeadless,
        1,
        64
      ),
      extensionOpsHeaded: numberInRange(
        modeCapsInput.extensionOpsHeaded,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.extensionOpsHeaded,
        1,
        64
      ),
      extensionLegacyCdpHeaded: numberInRange(
        modeCapsInput.extensionLegacyCdpHeaded,
        DEFAULT_OPS_PARALLELISM_POLICY.modeCaps.extensionLegacyCdpHeaded,
        1,
        64
      )
    }
  };
};

const isParallelismBackpressureError = (
  error: unknown
): error is Error & { code: "parallelism_backpressure"; details: Record<string, unknown> } => {
  if (!(error instanceof Error)) {
    return false;
  }
  const typed = error as Error & { code?: string; details?: Record<string, unknown> };
  return typed.code === "parallelism_backpressure" && typeof typed.details === "object" && typed.details !== null;
};

const isAttachBlockedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Not allowed");
};

const buildError = (code: OpsErrorCode, message: string, retryable: boolean, details?: Record<string, unknown>): OpsError => ({
  code,
  message,
  retryable,
  details
});

type CookieImportRecord = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type CookieListRecord = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type CookieValidationResult = {
  valid: boolean;
  reason: string;
  cookie: CookieImportRecord;
};

const validateCookieRecord = (cookie: CookieImportRecord): CookieValidationResult => {
  const name = cookie.name?.trim();
  if (!name) {
    return { valid: false, reason: "Cookie name is required.", cookie };
  }
  if (!/^[^\s;=]+$/.test(name)) {
    return { valid: false, reason: `Invalid cookie name: ${cookie.name}.`, cookie };
  }
  if (typeof cookie.value !== "string" || /\r|\n|;/.test(cookie.value)) {
    return { valid: false, reason: `Invalid cookie value for ${name}.`, cookie };
  }

  const hasUrl = typeof cookie.url === "string" && cookie.url.trim().length > 0;
  const hasDomain = typeof cookie.domain === "string" && cookie.domain.trim().length > 0;
  if (!hasUrl && !hasDomain) {
    return { valid: false, reason: `Cookie ${name} requires url or domain.`, cookie };
  }

  let normalizedUrl: string | undefined;
  if (hasUrl) {
    try {
      const parsedUrl = new URL(cookie.url as string);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return { valid: false, reason: `Cookie ${name} url must be http(s).`, cookie };
      }
      normalizedUrl = parsedUrl.toString();
    } catch {
      return { valid: false, reason: `Cookie ${name} has invalid url.`, cookie };
    }
  }

  let normalizedDomain: string | undefined;
  if (hasDomain) {
    normalizedDomain = String(cookie.domain).trim().toLowerCase();
    if (!/^\.?[a-z0-9.-]+$/.test(normalizedDomain) || normalizedDomain.includes("..")) {
      return { valid: false, reason: `Cookie ${name} has invalid domain.`, cookie };
    }
  }

  const normalizedPath = typeof cookie.path === "string" ? cookie.path.trim() : undefined;
  if (typeof normalizedPath === "string" && !normalizedPath.startsWith("/")) {
    return { valid: false, reason: `Cookie ${name} path must start with '/'.`, cookie };
  }

  if (typeof cookie.expires !== "undefined") {
    if (!Number.isFinite(cookie.expires) || cookie.expires < -1) {
      return { valid: false, reason: `Cookie ${name} has invalid expires.`, cookie };
    }
  }

  if (cookie.sameSite === "None" && cookie.secure !== true) {
    return { valid: false, reason: `Cookie ${name} with SameSite=None must set secure=true.`, cookie };
  }

  const normalizedCookie: CookieImportRecord = {
    name,
    value: cookie.value,
    ...(typeof cookie.expires === "number" ? { expires: cookie.expires } : {}),
    ...(typeof cookie.httpOnly === "boolean" ? { httpOnly: cookie.httpOnly } : {}),
    ...(typeof cookie.secure === "boolean" ? { secure: cookie.secure } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
  };

  if (normalizedDomain) {
    normalizedCookie.domain = normalizedDomain;
    normalizedCookie.path = normalizedPath ?? "/";
  } else if (normalizedUrl) {
    normalizedCookie.url = normalizedUrl;
  }

  return {
    valid: true,
    reason: "",
    cookie: normalizedCookie
  };
};

const parseCookieFilterUrls = (value: unknown): string[] | undefined => {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Cookie url filters must be an array of strings.");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error("Cookie url filters must be an array of strings.");
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      throw new Error("Cookie url filters must be non-empty strings.");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new Error(`Cookie url filter is invalid: ${trimmed}`);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Cookie url filter must be http(s): ${trimmed}`);
    }

    const normalizedUrl = parsedUrl.toString();
    if (seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    normalized.push(normalizedUrl);
  }

  return normalized.length > 0 ? normalized : undefined;
};

const toCookieListRecord = (entry: unknown): CookieListRecord | null => {
  if (!isRecord(entry)) {
    return null;
  }

  const name = typeof entry.name === "string" ? entry.name : "";
  const value = typeof entry.value === "string" ? entry.value : "";
  const domain = typeof entry.domain === "string" ? entry.domain : "";
  const path = typeof entry.path === "string" ? entry.path : "";
  const expires = typeof entry.expires === "number" && Number.isFinite(entry.expires) ? entry.expires : -1;
  const httpOnly = entry.httpOnly === true;
  const secure = entry.secure === true;

  if (!name || !domain || !path) {
    return null;
  }

  const sameSiteRaw = entry.sameSite;
  const sameSite = sameSiteRaw === "Strict" || sameSiteRaw === "Lax" || sameSiteRaw === "None"
    ? sameSiteRaw
    : undefined;

  return {
    name,
    value,
    domain,
    path,
    expires,
    httpOnly,
    secure,
    ...(sameSite ? { sameSite } : {})
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
};

const parseCanvasOverlaySelection = (
  value: unknown,
  targetId: string
): { pageId: string | null; nodeId: string | null; targetId: string | null; updatedAt?: string } => {
  const record = isRecord(value) ? value : {};
  const updatedAt = typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
    ? record.updatedAt
    : undefined;
  return {
    pageId: typeof record.pageId === "string" && record.pageId.trim().length > 0 ? record.pageId : null,
    nodeId: typeof record.nodeId === "string" && record.nodeId.trim().length > 0 ? record.nodeId : null,
    targetId: typeof record.targetId === "string" && record.targetId.trim().length > 0 ? record.targetId : targetId,
    ...(updatedAt ? { updatedAt } : {})
  };
};

const parseCursor = (cursor?: string): number => {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
};

const paginate = (lines: string[], startIndex: number, maxChars: number): { content: string; truncated: boolean; nextCursor?: string } => {
  let total = 0;
  const parts: string[] = [];
  let idx = startIndex;

  while (idx < lines.length) {
    const line = lines[idx];
    if (line === undefined) {
      break;
    }
    if (total + line.length + 1 > maxChars && parts.length > 0) {
      break;
    }
    parts.push(line);
    total += line.length + 1;
    idx += 1;
  }

  const truncated = idx < lines.length;
  const nextCursor = truncated ? String(idx) : undefined;
  return {
    content: parts.join("\n"),
    truncated,
    nextCursor
  };
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parseTabTargetId = (targetId: string): number | null => {
  const match = /^tab-(\d+)$/.exec(targetId);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1]!, 10);
  return parsed;
};

const parseTargetAliasTabId = (targetId: string | undefined): number | null => {
  if (typeof targetId !== "string" || targetId.length === 0) {
    return null;
  }
  if (targetId.startsWith("target-")) {
    const parsed = Number.parseInt(targetId.slice(7), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return parseTabTargetId(targetId);
};

const extractBodyHtml = (html: string): string => {
  const bodyMatch = html.match(/<body\b[^>]*>[\s\S]*<\/body>/i);
  if (bodyMatch) {
    return bodyMatch[0];
  }
  return html;
};

const htmlContainsRichMedia = (html: string | null): boolean => {
  return typeof html === "string" && /<(img|video|audio)\b/i.test(html);
};

const canvasStateContainsRichMedia = (state: CanvasPageState): boolean => {
  const document = isRecord(state.document) ? state.document : null;
  const pages = Array.isArray(document?.pages) ? document.pages : [];
  const assets = Array.isArray(document?.assets) ? document.assets : [];
  const assetsById = new Map(assets.flatMap((asset) => typeof asset?.id === "string" ? [[asset.id, asset]] : []));
  return pages.some((page) => Array.isArray(page?.nodes) && page.nodes.some((node) => nodeContainsRichMedia(node, assetsById)));
};

const nodeContainsRichMedia = (
  node: CanvasPageState["document"]["pages"][number]["nodes"][number],
  assetsById: Map<string, CanvasPageState["document"]["assets"][number]>
): boolean => {
  const tagName = readCanvasMediaTagName(node);
  if (tagName === "img" || tagName === "video" || tagName === "audio") {
    return true;
  }
  const assetIds = Array.isArray(node.metadata.assetIds)
    ? node.metadata.assetIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return assetIds.some((assetId) => {
    const asset = assetsById.get(assetId);
    const kind = typeof asset?.kind === "string" ? asset.kind.toLowerCase() : "";
    const mime = typeof asset?.mime === "string" ? asset.mime.toLowerCase() : "";
    return kind === "image" || kind === "video" || kind === "audio" || mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");
  });
};

const readCanvasMediaTagName = (node: CanvasPageState["document"]["pages"][number]["nodes"][number]): string | null => {
  if (typeof node.props.tagName === "string" && node.props.tagName.trim().length > 0) {
    return node.props.tagName.trim().toLowerCase();
  }
  const codeSync = isRecord(node.metadata.codeSync) ? node.metadata.codeSync : null;
  if (codeSync && typeof codeSync.tagName === "string" && codeSync.tagName.trim().length > 0) {
    return codeSync.tagName.trim().toLowerCase();
  }
  return null;
};

const buildCanvasDocumentCapture = (state: CanvasPageState): DomCapture | null => {
  const page = Array.isArray(state.document.pages) ? state.document.pages[0] : null;
  if (!page || !Array.isArray(page.nodes) || page.nodes.length === 0) {
    return null;
  }
  const { width, height } = computeCanvasDocumentBounds(page.nodes);
  const nodes = [...page.nodes]
    .sort(compareCanvasCaptureNodes)
    .map((node) => renderCanvasDocumentNode(state.document, node))
    .join("");
  return {
    html: `<body><main data-surface="canvas" style="position:relative;width:${width}px;min-height:${height}px;">${nodes}</main></body>`,
    styles: {},
    warnings: ["canvas_state_capture"],
    inlineStyles: true
  };
};

const computeCanvasDocumentBounds = (
  nodes: CanvasPageState["document"]["pages"][number]["nodes"]
): { width: number; height: number } => {
  if (nodes.length === 0) {
    return { width: 1600, height: 1200 };
  }
  const maxX = Math.max(...nodes.map((node) => node.rect.x + node.rect.width));
  const maxY = Math.max(...nodes.map((node) => node.rect.y + node.rect.height));
  return {
    width: Math.max(maxX + 240, 1600),
    height: Math.max(maxY + 240, 1200)
  };
};

const compareCanvasCaptureNodes = (
  left: CanvasPageState["document"]["pages"][number]["nodes"][number],
  right: CanvasPageState["document"]["pages"][number]["nodes"][number]
): number => {
  const rootOrder = Number(left.parentId !== null) - Number(right.parentId !== null);
  if (rootOrder !== 0) {
    return rootOrder;
  }
  const areaOrder = (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height);
  if (areaOrder !== 0) {
    return areaOrder;
  }
  const verticalOrder = left.rect.y - right.rect.y;
  return verticalOrder !== 0 ? verticalOrder : left.rect.x - right.rect.x;
};

const renderCanvasDocumentNode = (
  document: CanvasPageState["document"],
  node: CanvasPageState["document"]["pages"][number]["nodes"][number]
): string => {
  const media = resolveCanvasDocumentMedia(document, node);
  const text = escapeCanvasHtml(nodeTextForCapture(node) || node.name);
  const style = serializeCanvasCaptureStyle({
    position: "absolute",
    left: `${node.rect.x}px`,
    top: `${node.rect.y}px`,
    width: `${Math.max(node.rect.width, 40)}px`,
    minHeight: `${Math.max(node.rect.height, readCanvasMediaTagName(node) === "audio" ? 64 : 40)}px`,
    overflow: "hidden",
    ...node.style
  });
  const title = escapeCanvasAttribute(`${node.kind} • ${node.name}`);
  if (media?.kind === "image" && media.src) {
    return `<div data-node-id="${escapeCanvasAttribute(node.id)}" title="${title}" style="${style}"><img src="${escapeCanvasAttribute(media.src)}" alt="${escapeCanvasAttribute(media.alt ?? node.name)}" loading="lazy" draggable="false" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`;
  }
  if (media?.kind === "video" && media.src) {
    const poster = media.poster ? ` poster="${escapeCanvasAttribute(media.poster)}"` : "";
    return `<div data-node-id="${escapeCanvasAttribute(node.id)}" title="${title}" style="${style}"><video src="${escapeCanvasAttribute(media.src)}"${poster} muted loop autoplay playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;"></video></div>`;
  }
  if (media?.kind === "audio" && media.src) {
    return `<div data-node-id="${escapeCanvasAttribute(node.id)}" title="${title}" style="${style}"><audio src="${escapeCanvasAttribute(media.src)}" controls preload="metadata" style="width:100%;display:block;"></audio>${text ? `<div style="margin-top:8px;font:500 12px/1.4 sans-serif;">${text}</div>` : ""}</div>`;
  }
  return `<div data-node-id="${escapeCanvasAttribute(node.id)}" title="${title}" style="${style}">${text}</div>`;
};

const nodeTextForCapture = (
  node: CanvasPageState["document"]["pages"][number]["nodes"][number]
): string => {
  const raw = node.props.text ?? node.metadata.text;
  if (raw !== undefined && raw !== null) {
    return typeof raw === "string" ? raw : String(raw);
  }
  return node.kind === "text" || node.kind === "note" || node.kind === "component-instance"
    ? node.name
    : "";
};

const resolveCanvasDocumentMedia = (
  document: CanvasPageState["document"],
  node: CanvasPageState["document"]["pages"][number]["nodes"][number]
): { kind: "image" | "video" | "audio"; src: string | null; poster: string | null; alt: string | null } | null => {
  const tagName = readCanvasMediaTagName(node);
  const attributes = isRecord(node.props.attributes) ? node.props.attributes : {};
  const assetIds = Array.isArray(node.metadata.assetIds)
    ? node.metadata.assetIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const asset = assetIds.length > 0
    ? document.assets.find((entry) => entry.id === assetIds[0])
    : null;
  const assetKind = typeof asset?.kind === "string" ? asset.kind.toLowerCase() : null;
  const assetMime = typeof asset?.mime === "string" ? asset.mime.toLowerCase() : null;
  const src = typeof node.props.src === "string"
    ? node.props.src
    : typeof attributes.src === "string"
      ? attributes.src
      : typeof asset?.url === "string"
        ? asset.url
        : typeof asset?.repoPath === "string"
          ? asset.repoPath
          : null;
  const poster = typeof node.props.poster === "string"
    ? node.props.poster
    : typeof attributes.poster === "string"
      ? attributes.poster
      : null;
  const alt = typeof node.props.alt === "string"
    ? node.props.alt
    : typeof attributes.alt === "string"
      ? attributes.alt
      : node.name;
  if (tagName === "img" || assetKind === "image" || assetMime?.startsWith("image/")) {
    return { kind: "image", src, poster: null, alt };
  }
  if (tagName === "video" || assetKind === "video" || assetMime?.startsWith("video/")) {
    return { kind: "video", src, poster, alt };
  }
  if (tagName === "audio" || assetKind === "audio" || assetMime?.startsWith("audio/")) {
    return { kind: "audio", src, poster: null, alt };
  }
  return null;
};

const serializeCanvasCaptureStyle = (style: Record<string, unknown>): string => {
  return Object.entries(style)
    .flatMap(([key, value]) => {
      if (typeof value !== "string" && typeof value !== "number") {
        return [];
      }
      const cssKey = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      const cssValue = typeof value === "number" && !CANVAS_CAPTURE_UNITLESS_STYLES.has(key) ? `${value}px` : String(value);
      return `${cssKey}:${escapeCanvasAttribute(cssValue)};`;
    })
    .join("");
};

const escapeCanvasHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
};

const escapeCanvasAttribute = (value: string): string => {
  return escapeCanvasHtml(value)
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
};

const CANVAS_CAPTURE_UNITLESS_STYLES = new Set(["fontWeight", "lineHeight", "opacity", "zIndex"]);

const buildStaleSnapshotError = (ref: string): Error => (
  new Error(`Unknown ref: ${ref}. ${STALE_REF_ERROR_SUFFIX}`)
);

const isSnapshotStaleMessage = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes(STALE_REF_ERROR_SUFFIX)) {
    return true;
  }
  const normalized = message.toLowerCase();
  return normalized.includes("no node with given id")
    || normalized.includes("could not find node with given id")
    || normalized.includes("cannot find object with id")
    || normalized.includes("cannot find context with specified id")
    || normalized.includes("execution context was destroyed")
    || normalized.includes("inspected target navigated or closed");
};

const extractTargetInfo = (params: unknown): {
  targetId: string;
  type: string;
  url?: string;
  title?: string;
  openerId?: string;
} | null => {
  const payload = isRecord(params) && isRecord(params.targetInfo) ? params.targetInfo : params;
  if (!isRecord(payload) || typeof payload.targetId !== "string" || typeof payload.type !== "string") {
    return null;
  }
  return {
    targetId: payload.targetId,
    type: payload.type,
    ...(typeof payload.url === "string" ? { url: payload.url } : {}),
    ...(typeof payload.title === "string" ? { title: payload.title } : {}),
    ...(typeof payload.openerId === "string" ? { openerId: payload.openerId } : {})
  };
};

const isSyntheticPageTarget = (session: OpsSession, targetId: string, type: string): boolean => {
  if (type !== "page" || targetId === session.targetId) {
    return false;
  }
  const parsedTabId = parseTabTargetId(targetId);
  return session.targets.has(targetId) || parsedTabId === null || parsedTabId !== session.tabId;
};

const resolveReportedTargetUrl = (
  target: { url?: string; title?: string; sessionId?: string; synthetic?: boolean } | null | undefined,
  liveUrl?: string
): string | undefined => {
  if (typeof target?.sessionId === "string" && typeof target.url === "string" && target.url.length > 0) {
    return target.url;
  }
  if (target?.synthetic === true && typeof target.url === "string" && target.url.length > 0) {
    return target.url;
  }
  if (typeof target?.url === "string" && isHtmlDataUrl(target.url)) {
    return target.url;
  }
  if (typeof target?.url === "string" && isCanvasExtensionUrl(target.url)) {
    return target.url;
  }
  return liveUrl ?? target?.url;
};

const resolveReportedTargetTitle = (
  target: { url?: string; title?: string; sessionId?: string; synthetic?: boolean } | null | undefined,
  liveTitle?: string
): string | undefined => {
  if (typeof target?.sessionId === "string" && typeof target.title === "string" && target.title.length > 0) {
    return target.title;
  }
  if (target?.synthetic === true && typeof target.title === "string" && target.title.length > 0) {
    return target.title;
  }
  if (typeof target?.url === "string" && isHtmlDataUrl(target.url) && typeof target.title === "string" && target.title.length > 0) {
    return target.title;
  }
  if (typeof target?.url === "string" && isCanvasExtensionUrl(target.url) && typeof target.title === "string" && target.title.length > 0) {
    return target.title;
  }
  return liveTitle ?? target?.title;
};

const isHtmlDataUrl = (url: string): boolean => {
  return url.startsWith("data:text/html");
};

const isCanvasExtensionUrl = (url: string): boolean => {
  try {
    const canvasUrl = chrome.runtime.getURL("canvas.html");
    return url === canvasUrl || url.startsWith(`${canvasUrl}#`) || url.startsWith(`${canvasUrl}?`);
  } catch {
    return false;
  }
};

const decodeHtmlDataUrl = (url: string): string | null => {
  if (!isHtmlDataUrl(url)) {
    return null;
  }
  const commaIndex = url.indexOf(",");
  if (commaIndex === -1) {
    return null;
  }
  const metadata = url.slice(0, commaIndex).toLowerCase();
  const payload = url.slice(commaIndex + 1);
  if (metadata.includes(";base64")) {
    const decoded = atob(payload);
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
};

const executeInTab = async <TArg, TResult>(
  tabId: number,
  func: (arg: TArg) => TResult,
  args: [TArg]
): Promise<TResult> => {
  return await new Promise<TResult>((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId }, func: func as never, args },
      (results) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        const [first] = results ?? [];
        resolve((first?.result ?? null) as TResult);
      }
    );
  });
};

function replaceDocumentWithHtmlScript(input: { html: string }): { title: string } {
  document.open();
  document.write(input.html);
  document.close();
  return { title: document.title };
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then((value) => {
      clearTimeout(timeoutId);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
};

const createId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-session-store.ts
```ts
import {
  DEFAULT_OPS_PARALLELISM_POLICY,
  createOpsGovernorState,
  type OpsParallelismGovernorPolicy,
  type OpsParallelismGovernorState
} from "./parallelism-governor.js";
import {
  createCoordinatorId,
  TargetSessionCoordinator,
  type TargetSessionInfo,
  type TargetSessionRecord
} from "./target-session-coordinator.js";

export type OpsTargetInfo = TargetSessionInfo;

export type OpsConsoleEvent = {
  seq: number;
  level: string;
  text: string;
  ts: number;
};

export type OpsNetworkEvent = {
  seq: number;
  method: string;
  url: string;
  status?: number;
  resourceType?: string;
  ts: number;
};

export type OpsSyntheticTargetRecord = {
  targetId: string;
  tabId: number;
  type: string;
  url?: string;
  title?: string;
  sessionId?: string;
  openerTargetId?: string;
  attachedAt: number;
};

type OpsSessionExtra = {
  refStore: OpsRefStore;
  syntheticTargets: Map<string, OpsSyntheticTargetRecord>;
  consoleEvents: OpsConsoleEvent[];
  networkEvents: OpsNetworkEvent[];
  networkRequests: Map<string, { method: string; url: string; resourceType?: string }>;
  consoleSeq: number;
  networkSeq: number;
  queue: Promise<unknown>;
  targetQueues: Map<string, Promise<void>>;
  targetQueueDepth: Map<string, number>;
  targetQueueOldestAt: Map<string, number>;
  parallelInFlight: number;
  pendingParallel: number;
  discardedSignals: number;
  frozenSignals: number;
  parallelismPolicy: OpsParallelismGovernorPolicy;
  parallelismState: OpsParallelismGovernorState;
};

export type OpsSession = TargetSessionRecord<OpsSessionExtra>;

export class OpsRefStore {
  private refsByTarget = new Map<string, Map<string, { ref: string; selector: string; backendNodeId: number; snapshotId: string; frameId?: string; role?: string; name?: string }>>();
  private snapshotByTarget = new Map<string, string>();
  private refCounterByTarget = new Map<string, number>();

  nextRef(targetId: string): string {
    const next = (this.refCounterByTarget.get(targetId) ?? 0) + 1;
    this.refCounterByTarget.set(targetId, next);
    return `r${next}`;
  }

  setSnapshot(targetId: string, entries: Array<{ ref: string; selector: string; backendNodeId: number; frameId?: string; role?: string; name?: string }>): { snapshotId: string; targetId: string; count: number } {
    const map = new Map<string, { ref: string; selector: string; backendNodeId: number; snapshotId: string; frameId?: string; role?: string; name?: string }>();
    const snapshotId = createCoordinatorId();
    for (const entry of entries) {
      map.set(entry.ref, {
        ...entry,
        snapshotId
      });
    }
    this.refsByTarget.set(targetId, map);
    this.snapshotByTarget.set(targetId, snapshotId);
    return { snapshotId, targetId, count: entries.length };
  }

  resolve(targetId: string, ref: string): { ref: string; selector: string; backendNodeId: number; snapshotId: string; frameId?: string; role?: string; name?: string } | null {
    const map = this.refsByTarget.get(targetId);
    if (!map) return null;
    return map.get(ref) ?? null;
  }

  getSnapshotId(targetId: string): string | null {
    return this.snapshotByTarget.get(targetId) ?? null;
  }

  getRefCount(targetId: string): number {
    const map = this.refsByTarget.get(targetId);
    return map ? map.size : 0;
  }

  clearTarget(targetId: string): void {
    this.refsByTarget.delete(targetId);
    this.snapshotByTarget.delete(targetId);
  }
}

export class OpsSessionStore {
  private readonly coordinator = new TargetSessionCoordinator<OpsSessionExtra>();

  createSession(
    ownerClientId: string,
    tabId: number,
    leaseId: string,
    info?: { url?: string; title?: string },
    options?: {
      parallelismPolicy?: OpsParallelismGovernorPolicy;
    },
    sessionId?: string
  ): OpsSession {
    const parallelismPolicy = options?.parallelismPolicy ?? DEFAULT_OPS_PARALLELISM_POLICY;
    return this.coordinator.createSession(ownerClientId, tabId, leaseId, info, {
      refStore: new OpsRefStore(),
      syntheticTargets: new Map(),
      consoleEvents: [],
      networkEvents: [],
      networkRequests: new Map(),
      consoleSeq: 0,
      networkSeq: 0,
      queue: Promise.resolve(),
      targetQueues: new Map(),
      targetQueueDepth: new Map(),
      targetQueueOldestAt: new Map(),
      parallelInFlight: 0,
      pendingParallel: 0,
      discardedSignals: 0,
      frozenSignals: 0,
      parallelismPolicy,
      parallelismState: createOpsGovernorState(parallelismPolicy, "extensionOpsHeaded")
    }, sessionId);
  }

  get(sessionId: string): OpsSession | null {
    return this.coordinator.get(sessionId);
  }

  getByTabId(tabId: number): OpsSession | null {
    return this.coordinator.getByTabId(tabId);
  }

  listOwnedBy(clientId: string): OpsSession[] {
    return this.coordinator.listOwnedBy(clientId);
  }

  delete(sessionId: string): OpsSession | null {
    return this.coordinator.delete(sessionId);
  }

  addTarget(sessionId: string, tabId: number, info?: { url?: string; title?: string; openerTargetId?: string }): OpsTargetInfo {
    return this.coordinator.addTarget(sessionId, tabId, info);
  }

  removeTarget(sessionId: string, targetId: string): OpsTargetInfo | null {
    const target = this.coordinator.removeTarget(sessionId, targetId);
    const session = this.requireSession(sessionId);
    if (!target) return null;
    session.targetQueues.delete(targetId);
    session.targetQueueDepth.delete(targetId);
    session.targetQueueOldestAt.delete(targetId);
    session.refStore.clearTarget(targetId);
    session.syntheticTargets.delete(targetId);
    return target;
  }

  getTargetIdByTabId(sessionId: string, tabId: number): string | null {
    return this.coordinator.getTargetIdByTabId(sessionId, tabId);
  }

  removeTargetByTabId(sessionId: string, tabId: number): OpsTargetInfo | null {
    const targetId = this.coordinator.getTargetIdByTabId(sessionId, tabId);
    if (!targetId) return null;
    return this.removeTarget(sessionId, targetId);
  }

  setActiveTarget(sessionId: string, targetId: string): void {
    this.coordinator.setActiveTarget(sessionId, targetId);
  }

  setName(sessionId: string, targetId: string, name: string): void {
    this.coordinator.setName(sessionId, targetId, name);
  }

  getTargetIdByName(sessionId: string, name: string): string | null {
    return this.coordinator.getTargetIdByName(sessionId, name);
  }

  listNamedTargets(sessionId: string): Array<{ name: string; targetId: string }> {
    return this.coordinator.listNamedTargets(sessionId);
  }

  upsertSyntheticTarget(sessionId: string, target: OpsSyntheticTargetRecord): OpsSyntheticTargetRecord {
    const session = this.requireSession(sessionId);
    const existing = session.syntheticTargets.get(target.targetId);
    const nextTarget: OpsSyntheticTargetRecord = {
      ...(existing ?? {}),
      ...target,
      tabId: target.tabId,
      type: target.type,
      attachedAt: target.attachedAt
    };
    session.syntheticTargets.set(target.targetId, nextTarget);
    return nextTarget;
  }

  getSyntheticTarget(sessionId: string, targetId: string): OpsSyntheticTargetRecord | null {
    return this.requireSession(sessionId).syntheticTargets.get(targetId) ?? null;
  }

  listSyntheticTargets(sessionId: string): OpsSyntheticTargetRecord[] {
    return Array.from(this.requireSession(sessionId).syntheticTargets.values());
  }

  findSyntheticTargetBySessionId(sessionId: string, childSessionId: string): OpsSyntheticTargetRecord | null {
    const session = this.requireSession(sessionId);
    for (const target of session.syntheticTargets.values()) {
      if (target.sessionId === childSessionId) {
        return target;
      }
    }
    return null;
  }

  removeSyntheticTarget(sessionId: string, targetId: string): OpsSyntheticTargetRecord | null {
    const session = this.requireSession(sessionId);
    const existing = session.syntheticTargets.get(targetId) ?? null;
    if (!existing) {
      return null;
    }
    session.syntheticTargets.delete(targetId);
    session.refStore.clearTarget(targetId);
    return existing;
  }

  requireSession(sessionId: string): OpsSession {
    return this.coordinator.requireSession(sessionId);
  }
}

export const createOpsSessionId = (): string => createCoordinatorId();

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/target-session-coordinator.ts
```ts
export type TargetSessionInfo = {
  targetId: string;
  tabId: number;
  title?: string;
  url?: string;
  openerTargetId?: string;
};

export type TargetSessionRecord<TExtra extends object> = {
  id: string;
  ownerClientId: string;
  leaseId: string;
  state: "active" | "closing";
  expiresAt?: number;
  closingReason?: string;
  tabId: number;
  targetId: string;
  activeTargetId: string;
  createdAt: number;
  lastUsedAt: number;
  targets: Map<string, TargetSessionInfo>;
  nameToTarget: Map<string, string>;
  targetToName: Map<string, string>;
} & TExtra;

export class TargetSessionCoordinator<TExtra extends object> {
  private readonly sessions = new Map<string, TargetSessionRecord<TExtra>>();
  private readonly tabToSession = new Map<number, string>();

  createSession(
    ownerClientId: string,
    tabId: number,
    leaseId: string,
    info: { url?: string; title?: string } | undefined,
    extra: TExtra,
    sessionId?: string
  ): TargetSessionRecord<TExtra> {
    const id = sessionId ?? createCoordinatorId();
    const targetId = `tab-${tabId}`;
    const target: TargetSessionInfo = {
      targetId,
      tabId,
      url: info?.url,
      title: info?.title,
      openerTargetId: undefined
    };
    const createdAt = Date.now();
    const session: TargetSessionRecord<TExtra> = {
      id,
      ownerClientId,
      leaseId,
      state: "active",
      tabId,
      targetId,
      activeTargetId: targetId,
      createdAt,
      lastUsedAt: createdAt,
      targets: new Map([[targetId, target]]),
      nameToTarget: new Map(),
      targetToName: new Map(),
      ...extra
    };
    this.sessions.set(id, session);
    this.tabToSession.set(tabId, id);
    return session;
  }

  get(sessionId: string): TargetSessionRecord<TExtra> | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getByTabId(tabId: number): TargetSessionRecord<TExtra> | null {
    const sessionId = this.tabToSession.get(tabId);
    if (!sessionId) {
      return null;
    }
    return this.sessions.get(sessionId) ?? null;
  }

  listOwnedBy(clientId: string): TargetSessionRecord<TExtra>[] {
    return Array.from(this.sessions.values()).filter((session) => session.ownerClientId === clientId);
  }

  delete(sessionId: string): TargetSessionRecord<TExtra> | null {
    const session = this.sessions.get(sessionId) ?? null;
    if (!session) {
      return null;
    }
    this.sessions.delete(sessionId);
    for (const target of session.targets.values()) {
      this.tabToSession.delete(target.tabId);
    }
    return session;
  }

  addTarget(sessionId: string, tabId: number, info?: { url?: string; title?: string; openerTargetId?: string }): TargetSessionInfo {
    const session = this.requireSession(sessionId);
    const targetId = `tab-${tabId}`;
    const target: TargetSessionInfo = {
      targetId,
      tabId,
      url: info?.url,
      title: info?.title,
      openerTargetId: info?.openerTargetId
    };
    session.targets.set(targetId, target);
    this.tabToSession.set(tabId, sessionId);
    if (!session.activeTargetId) {
      session.activeTargetId = targetId;
    }
    return target;
  }

  removeTarget(sessionId: string, targetId: string): TargetSessionInfo | null {
    const session = this.requireSession(sessionId);
    const target = session.targets.get(targetId) ?? null;
    if (!target) {
      return null;
    }
    session.targets.delete(targetId);
    this.tabToSession.delete(target.tabId);
    const name = session.targetToName.get(targetId);
    if (name) {
      session.targetToName.delete(targetId);
      session.nameToTarget.delete(name);
    }
    if (session.activeTargetId === targetId) {
      const [first] = session.targets.keys();
      session.activeTargetId = first ?? "";
    }
    return target;
  }

  getTargetIdByTabId(sessionId: string, tabId: number): string | null {
    const session = this.requireSession(sessionId);
    for (const target of session.targets.values()) {
      if (target.tabId === tabId) {
        return target.targetId;
      }
    }
    return null;
  }

  removeTargetByTabId(sessionId: string, tabId: number): TargetSessionInfo | null {
    const targetId = this.getTargetIdByTabId(sessionId, tabId);
    if (!targetId) {
      return null;
    }
    return this.removeTarget(sessionId, targetId);
  }

  setActiveTarget(sessionId: string, targetId: string): void {
    const session = this.requireSession(sessionId);
    if (!session.targets.has(targetId)) {
      throw new Error(`Unknown targetId: ${targetId}`);
    }
    session.activeTargetId = targetId;
  }

  setName(sessionId: string, targetId: string, name: string): void {
    const session = this.requireSession(sessionId);
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Name must be non-empty");
    }
    if (!session.targets.has(targetId)) {
      throw new Error(`Unknown targetId: ${targetId}`);
    }
    const existing = session.nameToTarget.get(trimmed);
    if (existing && existing !== targetId) {
      throw new Error(`Name already in use: ${trimmed}`);
    }
    const previousName = session.targetToName.get(targetId);
    if (previousName && previousName !== trimmed) {
      session.nameToTarget.delete(previousName);
    }
    session.nameToTarget.set(trimmed, targetId);
    session.targetToName.set(targetId, trimmed);
  }

  getTargetIdByName(sessionId: string, name: string): string | null {
    const session = this.requireSession(sessionId);
    return session.nameToTarget.get(name.trim()) ?? null;
  }

  listNamedTargets(sessionId: string): Array<{ name: string; targetId: string }> {
    const session = this.requireSession(sessionId);
    return Array.from(session.nameToTarget.entries()).map(([name, targetId]) => ({ name, targetId }));
  }

  requireSession(sessionId: string): TargetSessionRecord<TExtra> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }
    session.lastUsedAt = Date.now();
    return session;
  }
}

export const createCoordinatorId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/cdp-router-commands.ts
```ts
import type { RelayCommand, RelayResponse } from "../types.js";
import type { TargetInfo, DebuggerSession, SessionRecord, TargetSessionMap } from "./TargetSessionMap.js";
import type { TabManager } from "./TabManager.js";

export type AutoAttachOptions = {
  autoAttach: boolean;
  waitForDebuggerOnStart: boolean;
  flatten: boolean;
  filter?: unknown;
};

export type RouterCommandContext = {
  debuggees: Map<number, chrome.debugger.Debuggee>;
  sessions: TargetSessionMap;
  tabManager: TabManager;
  autoAttachOptions: AutoAttachOptions;
  discoverTargets: boolean;
  flatSessionError: string;
  setAutoAttachOptions: (next: AutoAttachOptions) => void;
  setDiscoverTargets: (value: boolean) => void;
  applyDiscoverTargets: (debuggee: DebuggerSession, discover: boolean) => Promise<void>;
  respond: (id: RelayResponse["id"], result: unknown, sessionId?: string) => void;
  respondError: (id: RelayResponse["id"], message: string, sessionId?: string) => void;
  emitEvent: (method: string, params: unknown, sessionId?: string) => void;
  emitTargetCreated: (targetInfo: TargetInfo) => void;
  emitRootAttached: (targetInfo: TargetInfo) => void;
  emitRootDetached: () => void;
  resetRootAttached: () => void;
  updatePrimaryTab: (tabId: number | null) => void;
  detachTabState: (tabId: number) => void;
  safeDetach: (debuggee: chrome.debugger.Debuggee) => Promise<void>;
  attach: (tabId: number) => Promise<void>;
  registerRootTab: (tabId: number) => Promise<TargetInfo>;
  refreshRootTargetInfo: (tabId: number) => Promise<TargetInfo>;
  applyAutoAttach: (debuggee: chrome.debugger.Debuggee) => Promise<void>;
  sendCommand: (debuggee: DebuggerSession, method: string, params: Record<string, unknown>) => Promise<unknown>;
  getPrimaryDebuggee: () => DebuggerSession | null;
  resolveCommandDebuggee: (sessionId?: string) => Promise<DebuggerSession | null>;
};

export async function handleSetDiscoverTargets(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>
): Promise<void> {
  const discover = params.discover === true;
  const shouldEmit = discover && !ctx.discoverTargets;
  ctx.setDiscoverTargets(discover);
  try {
    for (const debuggee of ctx.debuggees.values()) {
      await ctx.applyDiscoverTargets(debuggee as DebuggerSession, discover);
    }
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error));
    return;
  }
  if (shouldEmit) {
    for (const targetInfo of ctx.sessions.listTargetInfos()) {
      ctx.emitTargetCreated(targetInfo);
    }
  }
  ctx.respond(commandId, {});
}

export async function handleSetAutoAttach(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  if (params.flatten === false) {
    ctx.respondError(commandId, ctx.flatSessionError, sessionId);
    return;
  }

  const autoAttach = params.autoAttach === true;
  const waitForDebuggerOnStart = params.waitForDebuggerOnStart === true;
  ctx.setAutoAttachOptions({ autoAttach, waitForDebuggerOnStart, flatten: true, filter: params.filter });
  if (autoAttach && !sessionId) {
    ctx.resetRootAttached();
  }

  try {
    if (sessionId) {
      const session = ctx.sessions.getBySessionId(sessionId);
      if (!session) {
        ctx.respondError(commandId, `Unknown sessionId: ${sessionId}`, sessionId);
        return;
      }
      await ctx.sendCommand(session.debuggerSession, "Target.setAutoAttach", {
        autoAttach,
        waitForDebuggerOnStart,
        flatten: true,
        ...(typeof params.filter !== "undefined" ? { filter: params.filter } : {})
      });
    } else {
      for (const debuggee of ctx.debuggees.values()) {
        await ctx.applyAutoAttach(debuggee);
      }
    }
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error));
    return;
  }

  if (sessionId) {
    ctx.respond(commandId, {}, sessionId);
    return;
  }

  if (!autoAttach) {
    ctx.emitRootDetached();
  } else {
    for (const tabId of ctx.sessions.listTabIds()) {
      await ctx.refreshRootTargetInfo(tabId);
    }
    for (const targetInfo of ctx.sessions.listTargetInfos()) {
      ctx.emitRootAttached(targetInfo);
    }
  }

  ctx.respond(commandId, {});
}

export async function handleCreateTarget(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>
): Promise<void> {
  const url = typeof params.url === "string" ? params.url : undefined;
  const background = params.background === true;
  let createdTabId: number | null = null;

  try {
    const tab = await ctx.tabManager.createTab(url, !background);
    if (typeof tab.id !== "number") {
      throw new Error("Target.createTarget did not yield a tab id");
    }
    createdTabId = tab.id;
    await ctx.tabManager.waitForTabComplete(tab.id);
    await ctx.attach(tab.id);
    await ctx.sessions.waitForRootSession(tab.id);
    await ctx.sendCommand({ tabId: tab.id }, "Target.getTargets", {});

    await ctx.registerRootTab(tab.id);
    const targetInfo = await ctx.refreshRootTargetInfo(tab.id);
    if (ctx.discoverTargets) {
      ctx.emitTargetCreated(targetInfo);
    }
    if (ctx.autoAttachOptions.autoAttach) {
      ctx.emitRootAttached(targetInfo);
    }
    if (!background) {
      ctx.updatePrimaryTab(tab.id);
    }

    ctx.respond(commandId, { targetId: targetInfo.targetId });
  } catch (error) {
    if (createdTabId !== null) {
      const debuggee = ctx.debuggees.get(createdTabId) ?? null;
      ctx.detachTabState(createdTabId);
      if (debuggee) {
        await ctx.safeDetach(debuggee);
      }
      try {
        await ctx.tabManager.closeTab(createdTabId);
      } catch {
        // Best-effort cleanup for partially created targets.
      }
    }
    ctx.respondError(commandId, getErrorMessage(error));
  }
}

export async function handleCloseTarget(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>
): Promise<void> {
  const targetId = typeof params.targetId === "string" ? params.targetId : null;
  if (!targetId) {
    ctx.respondError(commandId, "Missing targetId");
    return;
  }
  const session = ctx.sessions.getByTargetId(targetId);
  if (!session || session.kind !== "root") {
    ctx.respondError(commandId, "Target not found");
    return;
  }

  try {
    const debuggee = ctx.debuggees.get(session.tabId) ?? null;
    ctx.detachTabState(session.tabId);
    if (debuggee) {
      await ctx.safeDetach(debuggee);
    }
    await ctx.tabManager.closeTab(session.tabId);
    ctx.respond(commandId, { success: true });
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error));
  }
}

export async function handleActivateTarget(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>
): Promise<void> {
  const targetId = typeof params.targetId === "string" ? params.targetId : null;
  if (!targetId) {
    ctx.respondError(commandId, "Missing targetId");
    return;
  }
  const session = ctx.sessions.getByTargetId(targetId);
  if (!session || session.kind !== "root") {
    ctx.respondError(commandId, "Target not found");
    return;
  }

  try {
    await ctx.tabManager.activateTab(session.tabId);
    ctx.updatePrimaryTab(session.tabId);
    ctx.respond(commandId, {});
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error));
  }
}

export async function handleAttachToTarget(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  params: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  const targetId = typeof params.targetId === "string" ? params.targetId : null;
  if (!targetId) {
    ctx.respondError(commandId, "Missing targetId", sessionId);
    return;
  }
  if (params.flatten === false) {
    ctx.respondError(commandId, ctx.flatSessionError, sessionId);
    return;
  }

  const targetSession = ctx.sessions.getByTargetId(targetId);
  if (targetSession && targetSession.kind === "root") {
    ctx.respond(commandId, { sessionId: targetSession.sessionId }, sessionId);
    return;
  }

  const session = sessionId ? ctx.sessions.getBySessionId(sessionId) : null;
  if (sessionId && !session) {
    ctx.respondError(commandId, `Unknown sessionId: ${sessionId}`, sessionId);
    return;
  }

  const debuggee = session?.debuggerSession ?? ctx.getPrimaryDebuggee();
  if (!debuggee) {
    ctx.respondError(commandId, "No tab attached", sessionId);
    return;
  }

  try {
    const result = await ctx.sendCommand(debuggee, "Target.attachToTarget", { targetId, flatten: true });
    const record = isRecord(result) ? result : {};
    const childSessionId = typeof record.sessionId === "string" ? record.sessionId : null;
    if (childSessionId) {
      const targetInfo: TargetInfo = {
        targetId,
        type: "page",
        browserContextId: "default"
      };
      ctx.sessions.registerChildSession(debuggee.tabId as number, targetInfo, childSessionId);
    }
    ctx.respond(commandId, result);
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error), sessionId);
  }
}

export async function handleRoutedCommand(
  ctx: RouterCommandContext,
  commandId: RelayCommand["id"],
  method: string,
  params: Record<string, unknown>,
  sessionId?: string
): Promise<void> {
  const session = sessionId ? ctx.sessions.getBySessionId(sessionId) : null;
  const compatSession = resolveSyntheticCompatSession(ctx, session, sessionId);
  if (compatSession) {
    const compatResult = buildSyntheticRootCompatResult(compatSession, method, commandId);
    if (compatResult) {
      ctx.respond(commandId, compatResult.result, sessionId);
      if (compatResult.emitExecutionContext) {
        ctx.emitEvent("Runtime.executionContextCreated", compatResult.emitExecutionContext, sessionId);
      }
      return;
    }
  }
  if (sessionId && !session) {
    ctx.respondError(commandId, `Unknown sessionId: ${sessionId}`, sessionId);
    return;
  }

  const debuggee = await ctx.resolveCommandDebuggee(sessionId);
  if (!debuggee) {
    ctx.respondError(commandId, "No tab attached", sessionId);
    return;
  }

  try {
    const result = await ctx.sendCommand(debuggee, method, params);
    ctx.respond(commandId, result, sessionId);
  } catch (error) {
    ctx.respondError(commandId, getErrorMessage(error), sessionId);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
};

const SYNTHETIC_ROOT_NOOP_METHODS = new Set<string>([
  "Runtime.runIfWaitingForDebugger",
  "Emulation.setFocusEmulationEnabled",
  "Emulation.setEmulatedMedia"
]);

const resolveSyntheticCompatSession = (
  ctx: RouterCommandContext,
  session: SessionRecord | null,
  sessionId?: string
): SessionRecord | null => {
  if (session && isSyntheticSessionId(session.sessionId)) {
    return session;
  }
  if (!isSyntheticSessionId(sessionId)) {
    return null;
  }
  const primary = ctx.getPrimaryDebuggee();
  if (typeof primary?.tabId !== "number") {
    return null;
  }
  const record = ctx.sessions.getByTabId(primary.tabId);
  if (!record) {
    return null;
  }
  const rootSession = ctx.sessions.getBySessionId(record.rootSessionId);
  if (rootSession) {
    return rootSession;
  }
  return {
    kind: "root",
    sessionId,
    tabId: record.tabId,
    targetId: record.targetInfo.targetId,
    debuggerSession: primary,
    targetInfo: record.targetInfo
  };
};

type SyntheticRootFrame = {
  id: string;
  loaderId: string;
  url: string;
  securityOrigin: string;
  mimeType: string;
};

const buildSyntheticRootCompatResult = (
  session: SessionRecord,
  method: string,
  commandId: RelayCommand["id"]
): { result: unknown; emitExecutionContext?: Record<string, unknown> } | null => {
  if (SYNTHETIC_ROOT_NOOP_METHODS.has(method)) {
    return { result: {} };
  }
  const frame = buildSyntheticRootFrame(session);
  if (method === "Page.getFrameTree") {
    return { result: { frameTree: { frame } } };
  }
  if (method === "Page.addScriptToEvaluateOnNewDocument") {
    return { result: { identifier: `odb-root-script-${String(commandId)}` } };
  }
  if (method === "Runtime.enable") {
    return {
      result: {},
      emitExecutionContext: {
        context: {
          id: 1,
          origin: deriveSecurityOrigin(frame.url),
          name: "",
          auxData: {
            frameId: frame.id,
            isDefault: true,
            type: "default"
          }
        }
      }
    };
  }
  return null;
};

const buildSyntheticRootFrame = (session: SessionRecord): SyntheticRootFrame => {
  const targetInfo = session.targetInfo;
  const url = typeof targetInfo?.url === "string" ? targetInfo.url : "";
  return {
    id: session.targetId,
    loaderId: session.targetId,
    url,
    securityOrigin: deriveSecurityOrigin(url),
    mimeType: "text/html"
  };
};

const deriveSecurityOrigin = (url: string): string => {
  if (!url) {
    return "";
  }
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

const isSyntheticSessionId = (value?: string): value is string => {
  return typeof value === "string" && value.startsWith("pw-tab-");
};

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-target-session-map.test.ts
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TargetSessionMap } from "../extension/src/services/TargetSessionMap";

describe("TargetSessionMap.waitForRootSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when root session is registered", async () => {
    const map = new TargetSessionMap();
    const wait = map.waitForRootSession(1, 1000);
    map.registerRootTab(1, { targetId: "tab-1", type: "page" }, "root-1");
    await expect(wait).resolves.toMatchObject({ sessionId: "root-1" });
  });

  it("rejects on timeout", async () => {
    const map = new TargetSessionMap();
    const wait = map.waitForRootSession(2, 500);
    const expectation = expect(wait).rejects.toThrow("Target attach timeout");
    await vi.advanceTimersByTimeAsync(600);
    await expectation;
  });
});

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-chrome-mock.ts
```ts
import { vi } from "vitest";

type StorageListener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => void;
type TabActivatedListener = (activeInfo: chrome.tabs.TabActiveInfo) => void;
type TabCreatedListener = (tab: chrome.tabs.Tab) => void;
type TabRemovedListener = (tabId: number) => void;
type TabUpdatedListener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
type DebuggerEventListener = (source: chrome.debugger.Debuggee, method: string, params?: object) => void;
type DebuggerDetachListener = (source: chrome.debugger.Debuggee, reason?: string) => void;
type RuntimeListener = () => void;
type MessageListener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => void;
type AlarmListener = (alarm: chrome.alarms.Alarm) => void;
type ConnectListener = (port: chrome.runtime.Port) => void;
type CreatedNavigationTargetListener = (details: chrome.webNavigation.WebNavigationSourceCallbackDetails) => void;

export type ChromeMockState = {
  chrome: typeof chrome;
  setActiveTab: (tab: chrome.tabs.Tab | null) => void;
  emitTabCreated: (tab: chrome.tabs.Tab) => void;
  emitTabActivated: (tabId: number) => void;
  emitStorageChange: (value: unknown) => void;
  emitTabRemoved: (tabId: number) => void;
  emitTabUpdated: (tabId: number, tab: chrome.tabs.Tab) => void;
  emitCreatedNavigationTarget: (details: chrome.webNavigation.WebNavigationSourceCallbackDetails) => void;
  emitDebuggerEvent: (source: chrome.debugger.Debuggee, method: string, params?: object) => void;
  emitDebuggerDetach: (source: chrome.debugger.Debuggee, reason?: string) => void;
  setRuntimeError: (message: string | null) => void;
  setCaptureVisibleTabResult: (dataUrl: string) => void;
  setCaptureVisibleTabError: (message: string | null) => void;
  getLastCaptureArgs: () => { windowId: number | undefined; options?: chrome.tabs.CaptureVisibleTabOptions } | null;
  emitStartup: () => void;
  emitInstalled: () => void;
  emitAlarm: (name: string) => void;
  emitConnect: (options?: { name?: string; sender?: chrome.runtime.MessageSender }) => chrome.runtime.Port;
};

export const createChromeMock = (initial?: {
  activeTab?: chrome.tabs.Tab | null;
  tabs?: chrome.tabs.Tab[];
  pairingToken?: string | null;
  pairingEnabled?: boolean | null;
  relayPort?: number | null;
  relayInstanceId?: string | null;
  relayEpoch?: number | null;
  tokenEpoch?: number | null;
  autoConnect?: boolean | null;
  autoPair?: boolean | null;
}): ChromeMockState => {
  const hasExplicitTabs = Array.isArray(initial?.tabs) && initial.tabs.length > 0;
  let activeTab = initial?.activeTab ?? {
    id: 1,
    url: "https://example.com",
    title: "Example",
    groupId: 1,
    status: "complete"
  };
  const tabsById = new Map<number, chrome.tabs.Tab>();
  for (const tab of initial?.tabs ?? []) {
    if (typeof tab.id === "number") {
      tabsById.set(tab.id, tab);
    }
  }
  if (!activeTab) {
    const seededActive = Array.from(tabsById.values()).find((tab) => tab.active);
    activeTab = seededActive ?? null;
  }
  if (activeTab && typeof activeTab.id === "number") {
    tabsById.set(activeTab.id, { ...tabsById.get(activeTab.id), ...activeTab });
  }
  const highestSeededTabId = Array.from(tabsById.keys()).reduce((max, id) => Math.max(max, id), 0);
  let nextTabId = highestSeededTabId > 0 ? highestSeededTabId + 1 : 1;
  let storageData: Record<string, unknown> = {
    pairingToken: initial?.pairingToken ?? null,
    pairingEnabled: initial?.pairingEnabled ?? true,
    relayPort: initial?.relayPort ?? 8787,
    relayInstanceId: initial?.relayInstanceId ?? null,
    relayEpoch: initial?.relayEpoch ?? null,
    tokenEpoch: initial?.tokenEpoch ?? null,
    autoConnect: initial?.autoConnect ?? null,
    autoPair: initial?.autoPair ?? null,
    annotationLastMeta: null,
    annotationLastPayloadSansScreenshots: null
  };

  const storageListeners = new Set<StorageListener>();
  const tabActivatedListeners = new Set<TabActivatedListener>();
  const tabCreatedListeners = new Set<TabCreatedListener>();
  const tabRemovedListeners = new Set<TabRemovedListener>();
  const tabUpdatedListeners = new Set<TabUpdatedListener>();
  const debuggerEventListeners = new Set<DebuggerEventListener>();
  const debuggerDetachListeners = new Set<DebuggerDetachListener>();
  const createdNavigationTargetListeners = new Set<CreatedNavigationTargetListener>();
  const startupListeners = new Set<RuntimeListener>();
  const installedListeners = new Set<RuntimeListener>();
  const messageListeners = new Set<MessageListener>();
  const alarmListeners = new Set<AlarmListener>();
  const connectListeners = new Set<ConnectListener>();
  const scheduledAlarms = new Map<string, chrome.alarms.Alarm>();
  let sessionCounter = 1;
  let captureVisibleTabResult = "data:image/png;base64,AAAA";
  let captureVisibleTabError: string | null = null;
  let lastCaptureArgs: { windowId: number | undefined; options?: chrome.tabs.CaptureVisibleTabOptions } | null = null;

  const setActiveTabState = (tab: chrome.tabs.Tab | null) => {
    if (activeTab && typeof activeTab.id === "number") {
      if (!hasExplicitTabs) {
        tabsById.delete(activeTab.id);
      } else {
        const previous = tabsById.get(activeTab.id);
        if (previous) {
          tabsById.set(activeTab.id, { ...previous, active: false });
        }
      }
    }
    activeTab = tab ? { ...tab, active: true } : null;
    if (activeTab && typeof activeTab.id === "number") {
      tabsById.set(activeTab.id, activeTab);
    }
  };

  const listTabs = (): chrome.tabs.Tab[] => {
    const tabs = Array.from(tabsById.values());
    if (!activeTab || typeof activeTab.id !== "number") {
      return tabs;
    }
    return tabs.sort((left, right) => Number(right.id === activeTab.id) - Number(left.id === activeTab.id));
  };

  const createPort = (name = "", sender: chrome.runtime.MessageSender = activeTab ? { tab: activeTab } : {}): chrome.runtime.Port => {
    const messageListeners = new Set<(message: unknown, port: chrome.runtime.Port) => void>();
    const disconnectListeners = new Set<(port: chrome.runtime.Port) => void>();
    const port = {
      name,
      sender,
      disconnect: vi.fn(() => {
        for (const listener of disconnectListeners) {
          listener(port);
        }
      }),
      onDisconnect: {
        addListener: (listener: (port: chrome.runtime.Port) => void) => {
          disconnectListeners.add(listener);
        }
      },
      onMessage: {
        addListener: (listener: (message: unknown, port: chrome.runtime.Port) => void) => {
          messageListeners.add(listener);
        }
      },
      postMessage: vi.fn((message: unknown) => {
        for (const listener of messageListeners) {
          listener(message, port);
        }
      })
    } as unknown as chrome.runtime.Port;
    return port;
  };

  const chromeMock = {
    runtime: {
      lastError: null as { message: string } | null,
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      onStartup: {
        addListener: (listener: RuntimeListener) => {
          startupListeners.add(listener);
        }
      },
      onInstalled: {
        addListener: (listener: RuntimeListener) => {
          installedListeners.add(listener);
        }
      },
      onMessage: {
        addListener: (listener: MessageListener) => {
          messageListeners.add(listener);
        }
      },
      onConnect: {
        addListener: (listener: ConnectListener) => {
          connectListeners.add(listener);
        }
      },
      connect: vi.fn((connectInfo?: { name?: string }) => {
        const port = createPort(connectInfo?.name ?? "");
        for (const listener of connectListeners) {
          listener(port);
        }
        return port;
      }),
      sendMessage: vi.fn((message: unknown, callback?: (response: unknown) => void) => {
        for (const listener of messageListeners) {
          const sender: chrome.runtime.MessageSender = activeTab ? { tab: activeTab } : {};
          listener(message, sender, (response) => {
            callback?.(response);
          });
        }
      })
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      setBadgeTextColor: vi.fn()
    },
    alarms: {
      create: vi.fn((name: string, alarmInfo: chrome.alarms.AlarmCreateInfo) => {
        const scheduled: chrome.alarms.Alarm = {
          name,
          scheduledTime: alarmInfo.when ?? Date.now()
        };
        scheduledAlarms.set(name, scheduled);
      }),
      clear: vi.fn((name: string, callback?: (wasCleared: boolean) => void) => {
        const removed = scheduledAlarms.delete(name);
        callback?.(removed);
      }),
      get: vi.fn((name: string, callback: (alarm?: chrome.alarms.Alarm) => void) => {
        callback(scheduledAlarms.get(name));
      }),
      onAlarm: {
        addListener: (listener: AlarmListener) => {
          alarmListeners.add(listener);
        }
      }
    },
    storage: {
      local: {
        get: vi.fn((key: unknown, callback: (items: Record<string, unknown>) => void) => {
          void key;
          callback({ ...storageData });
        }),
        set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
          storageData = { ...storageData, ...items };
          callback?.();
        })
      },
      onChanged: {
        addListener: (listener: StorageListener) => {
          storageListeners.add(listener);
        }
      }
    },
    tabs: {
      query: vi.fn(async (queryInfo?: chrome.tabs.QueryInfo) => {
        const tabs = listTabs();
        if (queryInfo?.active) {
          return activeTab ? [activeTab] : [];
        }
        return tabs;
      }),
      get: vi.fn(async (tabId: number) => {
        return tabsById.get(tabId) ?? null;
      }),
      getCurrent: vi.fn((callback: (tab?: chrome.tabs.Tab) => void) => {
        callback(activeTab ?? undefined);
      }),
      sendMessage: vi.fn((tabId: number, _message: unknown, callback?: (response: unknown) => void) => {
        void tabId;
        const type = (_message as { type?: string } | null)?.type;
        if (type === "annotation:start" || type === "annotation:toggle") {
          callback?.({ ok: true, bootId: "mock-boot", active: true });
          return;
        }
        if (type === "annotation:cancel") {
          callback?.({ ok: true, bootId: "mock-boot", active: false });
          return;
        }
        if (type === "annotation:ping") {
          callback?.({ ok: true, bootId: "mock-boot", active: false });
          return;
        }
        callback?.({ ok: true });
      }),
      captureVisibleTab: vi.fn((windowId: number | undefined, options: chrome.tabs.CaptureVisibleTabOptions, callback: (dataUrl?: string) => void) => {
        lastCaptureArgs = { windowId, options };
        if (captureVisibleTabError) {
          chromeMock.runtime.lastError = { message: captureVisibleTabError };
          callback(undefined);
          chromeMock.runtime.lastError = null;
          return;
        }
        callback(captureVisibleTabResult);
      }),
      create: vi.fn((createProperties: chrome.tabs.CreateProperties, callback?: (tab: chrome.tabs.Tab) => void) => {
        const tabId = nextTabId++;
        const tab: chrome.tabs.Tab = {
          id: tabId,
          url: createProperties.url ?? "about:blank",
          title: createProperties.url ?? "New Tab",
          status: "complete",
          active: createProperties.active ?? true
        };
        tabsById.set(tabId, tab);
        if (createProperties.active ?? true) {
          setActiveTabState(tab);
        }
        callback?.(tab);
        return tab;
      }),
      update: vi.fn((tabId: number, updateProperties: chrome.tabs.UpdateProperties, callback?: (tab?: chrome.tabs.Tab) => void) => {
        const existing = tabsById.get(tabId);
        if (!existing) {
          callback?.(undefined);
          return null;
        }
        const updated: chrome.tabs.Tab = {
          ...existing,
          url: updateProperties.url ?? existing.url,
          title: updateProperties.url ? updateProperties.url : existing.title,
          status: "complete",
          active: updateProperties.active ?? existing.active
        };
        tabsById.set(tabId, updated);
        if (updateProperties.active) {
          setActiveTabState(updated);
        }
        callback?.(updated);
        return updated;
      }),
      remove: vi.fn((tabId: number | number[], callback?: () => void) => {
        const ids = Array.isArray(tabId) ? tabId : [tabId];
        for (const id of ids) {
          tabsById.delete(id);
          for (const listener of tabRemovedListeners) {
            listener(id);
          }
        }
        if (activeTab && typeof activeTab.id === "number" && !tabsById.has(activeTab.id)) {
          const [first] = tabsById.values();
          activeTab = first ?? null;
        }
        callback?.();
      }),
      onRemoved: {
        addListener: (listener: TabRemovedListener) => {
          tabRemovedListeners.add(listener);
        }
      },
      onCreated: {
        addListener: (listener: TabCreatedListener) => {
          tabCreatedListeners.add(listener);
        }
      },
      onActivated: {
        addListener: (listener: TabActivatedListener) => {
          tabActivatedListeners.add(listener);
        }
      },
      onUpdated: {
        addListener: (listener: TabUpdatedListener) => {
          tabUpdatedListeners.add(listener);
        },
        removeListener: (listener: TabUpdatedListener) => {
          tabUpdatedListeners.delete(listener);
        }
      }
    },
    webNavigation: {
      onCreatedNavigationTarget: {
        addListener: (listener: CreatedNavigationTargetListener) => {
          createdNavigationTargetListeners.add(listener);
        }
      }
    },
    scripting: {
      insertCSS: vi.fn((_inject: chrome.scripting.CSSInjection, callback?: () => void) => {
        callback?.();
      }),
      executeScript: vi.fn((_inject: chrome.scripting.ScriptInjection, callback?: () => void) => {
        callback?.();
      })
    },
    debugger: {
      getTargets: vi.fn((callback: (result: chrome.debugger.TargetInfo[]) => void) => {
        const targets = listTabs()
          .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number")
          .map((tab) => ({
            id: `target-${tab.id}`,
            tabId: tab.id,
            type: "page",
            title: tab.title ?? "",
            url: tab.url ?? "",
            attached: false
          })) as chrome.debugger.TargetInfo[];
        callback(targets);
      }),
      attach: vi.fn((debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => {
        void debuggee;
        callback();
      }),
      detach: vi.fn((debuggee: chrome.debugger.Debuggee, callback: () => void) => {
        void debuggee;
        callback();
      }),
      sendCommand: vi.fn((debuggee: chrome.debugger.Debuggee, method: string, _params: object, callback: (result?: unknown) => void) => {
        void debuggee;
        if (method === "Target.attachToTarget") {
          const sessionId = `session-${sessionCounter}`;
          sessionCounter += 1;
          callback({ sessionId });
          return;
        }
        callback({ ok: true });
      }),
      onEvent: {
        addListener: (listener: DebuggerEventListener) => {
          debuggerEventListeners.add(listener);
        },
        removeListener: (listener: DebuggerEventListener) => {
          debuggerEventListeners.delete(listener);
        }
      },
      onDetach: {
        addListener: (listener: DebuggerDetachListener) => {
          debuggerDetachListeners.add(listener);
        },
        removeListener: (listener: DebuggerDetachListener) => {
          debuggerDetachListeners.delete(listener);
        }
      }
    }
  } as typeof chrome;

  return {
    chrome: chromeMock,
    setActiveTab: (tab) => {
      setActiveTabState(tab);
    },
    emitTabCreated: (tab) => {
      if (typeof tab.id === "number") {
        tabsById.set(tab.id, tab);
      }
      if (tab.active) {
        setActiveTabState(tab);
      }
      for (const listener of tabCreatedListeners) {
        listener(tab);
      }
    },
    emitTabActivated: (tabId) => {
      const tab = tabsById.get(tabId) ?? null;
      if (tab) {
        setActiveTabState(tab);
      }
      for (const listener of tabActivatedListeners) {
        listener({ tabId, windowId: 1 });
      }
    },
    emitStorageChange: (value) => {
      const updates = typeof value === "object" && value !== null
        ? value as Record<string, unknown>
        : { pairingToken: value };
      const changes: { [key: string]: chrome.storage.StorageChange } = {};
      for (const [key, newValue] of Object.entries(updates)) {
        changes[key] = { newValue } as chrome.storage.StorageChange;
      }
      for (const listener of storageListeners) {
        listener(changes, "local");
      }
    },
    emitTabRemoved: (tabId) => {
      for (const listener of tabRemovedListeners) {
        listener(tabId);
      }
    },
    emitTabUpdated: (tabId, tab) => {
      if (tab && typeof tab.id === "number") {
        tabsById.set(tab.id, tab);
      }
      for (const listener of tabUpdatedListeners) {
        listener(tabId, tab.status ? { status: tab.status } : {}, tab);
      }
    },
    emitCreatedNavigationTarget: (details) => {
      for (const listener of createdNavigationTargetListeners) {
        listener(details);
      }
    },
    emitDebuggerEvent: (source, method, params) => {
      for (const listener of debuggerEventListeners) {
        listener(source, method, params);
      }
    },
    emitDebuggerDetach: (source, reason) => {
      for (const listener of debuggerDetachListeners) {
        listener(source, reason);
      }
    },
    setRuntimeError: (message) => {
      chromeMock.runtime.lastError = message ? { message } : null;
    },
    setCaptureVisibleTabResult: (dataUrl: string) => {
      captureVisibleTabResult = dataUrl;
    },
    setCaptureVisibleTabError: (message: string | null) => {
      captureVisibleTabError = message;
    },
    getLastCaptureArgs: () => lastCaptureArgs,
    emitStartup: () => {
      for (const listener of startupListeners) {
        listener();
      }
    },
    emitInstalled: () => {
      for (const listener of installedListeners) {
        listener();
      }
    },
    emitAlarm: (name: string) => {
      const alarm = scheduledAlarms.get(name) ?? { name, scheduledTime: Date.now() };
      for (const listener of alarmListeners) {
        listener(alarm);
      }
    },
    emitConnect: (options) => {
      const port = createPort(options?.name ?? "", options?.sender ?? (activeTab ? { tab: activeTab } : {}));
      for (const listener of connectListeners) {
        listener(port);
      }
      return port;
    }
  };
};

```

File: /Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/POPUP_ATTACH_PROBE_INVESTIGATION.md
```md
# Popup Attach Probe Investigation

## Objective

Instrument the focused-popup extension-mode direct-launch failure so `[cdp_attach_failed] ... Not allowed` can be classified as exactly one of these seams:

- `root_attach`: `chrome.debugger.attach({ tabId })` failed before flat-session bootstrap
- `flat_session_bootstrap`: root attach succeeded, then flat-session setup failed during `Target.setAutoAttach`

This probe is limited to:

- `extension/src/services/CDPRouter.ts`
- `extension/src/ops/ops-runtime.ts`
- closest tests

## Evidence Matrix

| Signal | Meaning | Owning seam |
| --- | --- | --- |
| `ops.direct_attach_stage` with `origin: "root_attach"` | Chrome rejected direct root attach itself | `CDPRouter.attachRootDebuggee()` |
| `ops.direct_attach_stage` with `origin: "flat_session_bootstrap"` | Root attach succeeded, but flat-session bootstrap failed | `CDPRouter.attachRootDebuggeeWithFallback()` / `ensureFlatSessionSupport()` |
| `ops.popup_attach_stage` with `stage: ...` | Popup child adoption failed after launch already succeeded | existing popup attach flow in `OpsRuntime.attachTargetViaOpenerSession()` |

Current direct-attach diagnostic payload fields:

- `origin`
- `stage`
- `attachBy`
- `probeMethod` when the failure is bootstrap-side
- `reason`

## Non-Goals

- No provider fallback changes
- No `/ops` versus `/cdp` route-classifier work
- No transport swap or transport rewrite in this probe
- No popup ownership redesign beyond diagnostics
- No broad troubleshooting or product-doc rewrite

## Live Rerun Instructions

1. Build the current extension bundle:

```bash
npm run extension:build
```

2. Rebuild the repo code used by the CLI and daemon:

```bash
npm run build
```

3. Restart the daemon:

```bash
node dist/cli/index.js serve --stop --output-format json
node dist/cli/index.js serve --output-format json
```

4. Reload the unpacked extension in Chrome from `chrome://extensions/?id=jmhlfninmadkljgnahjnaleonjdncaml`.

5. Verify extension handshake is back:

```bash
node dist/cli/index.js status --output-format json
```

6. Focus the popup tab directly in Chrome, then run a fresh extension-only launch probe:

```bash
node dist/cli/index.js launch --extension-only --output-format json
```

7. Interpret the result:

- `cdp_attach_failed` message suffix `origin: root_attach` means Chrome blocked `chrome.debugger.attach({ tabId })` itself.
- `cdp_attach_failed` message suffix `origin: flat_session_bootstrap` means root attach worked and the failure happened later during flat-session setup.
- If direct launch succeeds but popup adoption still fails later, switch back to `ops.popup_attach_stage` and inspect the popup child stage instead.

## Replacement-Track Trigger

Open the replacement track only after one fresh rerun records a direct-attach stage conclusively:

- `root_attach` means extension-mode same-tab root attach is the blocker.
- `flat_session_bootstrap` means the blocker is still local to flat-session bootstrap and can be reasoned about without guessing.

```

File: /Users/bishopdotun/.codex/memories/rollout_summaries/2026-03-28T17-52-24-SX2q-opendevbrowser_popup_attach_instrumentation.md
```md
thread_id: 019d3593-6222-72e2-b89e-a171d26575b2
updated_at: 2026-03-28T19:12:52+00:00
rollout_path: /Users/bishopdotun/.codex/sessions/2026/03/28/rollout-2026-03-28T12-52-24-019d3593-6222-72e2-b89e-a171d26575b2.jsonl
cwd: /Users/bishopdotun/Documents/DevProjects/opendevbrowser
git_branch: antibot

# Instrument popup attach diagnostics and prove attached_root_unavailable failure stage

Rollout context: the user wanted to stay strictly on the extension popup attach/adoption seam, add stage-level diagnostics in CDPRouter and OpsRuntime, rerun the focused regression suite, reload the unpacked extension, and rerun the popup flow until the live failure message included the new stage information before considering any broader investigations.

## Task 1: Stage-level instrumentation of popup attach path

Outcome: success

Preference signals:
- when the user reminded “Keep scope on popup attach/adoption only” and “Do not widen into provider fallback ... transport replacement,” focus only on `extension/src/services/CDPRouter.ts`, `extension/src/ops/ops-runtime.ts`, and their dedicated tests (and avoid unrelated files) -> future agents should avoid editing other seams unless new evidence forces it.
- when the user insisted “the next live run should prove which stage fails inside `attachTargetViaOpenerSession()` and `attachChildTarget()`,” add stage names/diagnostics so `Popup target has not finished attaching yet (stage: …)` appears in the artifact -> future agents should instrument stage reporting in similar attach problems without adding blind fallbacks.

Key steps:
- Added new diagnostic enums and helpers in CDPRouter to record `raw_attach_failed`, `raw_attach_null`, `attached_root_unavailable`, `attached_root_attach_null`, and `attached_root_attach_failed`, surfacing the deepest stage when child attach retries fail.
- Added matching diagnostics recording/clearing logic in OpsRuntime, including the `popupAttachDiagnostics` map, `recordPopupAttachDiagnostic()`, and `sendPopupAttachPendingError()` that appends `(stage: <stage>)` plus detail to retryable errors and logs `ops.popup_attach_stage` to stderr.
- Extended presence of chrome webNavigation tracking for opener tab mapping and refined the popup attach retry path to retry on both ops- and router-level failure stages, clearing diagnostics upon successful attach.
- Updated `tests/extension-cdp-router.test.ts` and `tests/extension-ops-runtime.test.ts` to assert on the new diagnostics (staged errors for `attached_root_unavailable`/`resolve_tab_target_failed` and router diagnostics for blocked/null attach attempts).
- Rebuilt and reran `npx vitest run tests/extension-cdp-router.test.ts tests/extension-ops-runtime.test.ts --coverage.enabled=false`, `npm run extension:build`, `npm run lint`, `npm run typecheck`, and `npm run build` and confirmed the suite passed; repeated reruns after stage instrumentation stayed green.

Failures and how to do differently:
- Initial live rerun before reloading the unpacked extension still produced the old generic error, showing the active Chrome extension bundle hadn’t picked up the instrumentation; this indicates future live proofs must include a Chrome extension reload even after refreshing the daemon.

Reusable knowledge:
- After stage instrumentation, failing `target-use`/`review` now returns `[execution_failed] Popup target has not finished attaching yet (stage: <stage>).` The `details` payload includes `stage`, optional `popupTargetId`, `matcher`, `initialStage`, and `targetsLookupFailed`. Future runs should capture both the CLI message and these attached log entries (see `ops.popup_attach_stage`).
- Fresh daemon restart plus Chrome unpacked-extension reload is required for the instrumented extension to take effect; merely restarting the daemon left the generic error in place.

References:
- [1] `extension/src/services/CDPRouter.ts`—records router child-attach diagnostics, initial stage tracking, and detailed `attached_root_*` failure logging.
- [2] `extension/src/ops/ops-runtime.ts`—adds `PopupAttachDiagnostic` tracking and stage suffix to retryable attach errors, plus webNavigation tracking for opener mapping.
- [3] `tests/extension-ops-runtime.test.ts` & `tests/extension-cdp-router.test.ts`—new assertions covering diagnostically rich failures.
- [4] Verification commands: `npx vitest run tests/extension-cdp-router.test.ts tests/extension-ops-runtime.test.ts --coverage.enabled=false`, `npm run extension:build`, `npm run lint`, `npm run typecheck`, `npm run build`.

## Task 2: Live popup proof after extension reload

Outcome: success

Preference signals:
- when the live failure was “Popup target has not finished attaching yet” without stage, that indicated Chrome still used an old bundle; reload the unpacked extension manually (only chrome://extensions reload is documented) before claiming live proof -> future agents should treat missing stage suffix as an indicator to reload Chrome’s extension, not to patch more code.

Key steps:
- Restarted the daemon cleanly, ran `node dist/cli/index.js status --output-format json` to confirm daemon+extension handshakes, then clicked the extension’s reload button via `osascript` on `chrome://extensions` to ensure the instrumented bundle was active.
- Re-ran the popup runbook (`launch -> review -> click -> targets-list -> target-use -> review`), capturing CLI outputs. The first clean session (`fe38f132-1d6b-42c4-9ed5-8f322701426e`) now failed with `attached_root_unavailable` on both `target-use` and `review`, providing the desired artifact-backed stage.
- Additional retries (same session and subsequent new launch) degraded to `raw_attach_failed` or `[cdp_attach_failed] Not allowed`, which are now recorded as post-failure drift; these should not be treated as new primary stages without fresh, clean proof.

Failures and how to do differently:
- If the first `target-use` occurs before a fresh extension reload after instrumentation, the CLI still shows the generic error; always complete the Chrome reload step before drawing conclusions about the remaining stage.

Reusable knowledge:
- The confirmed live failure stage after reload is `attached_root_unavailable`, meaning `CDPRouter.attachChildTarget()` cannot recover an attached-root session after the initial raw attach attempt fails. The next investigations should stay in `extension/src/services/CDPRouter.ts` (not provider fallback) and trace why `ensureAttachedRootSession(tabId)` still returns null even after `registerRootTab(tabId)` runs (line 213 in the file).

References:
- [5] Verification session `fe38f132-1d6b-42c4-9ed5-8f322701426e` with `target-use`/`review` failures containing the stage suffix.
- [6] CLI commands used: `node dist/cli/index.js launch --extension-only ...`, `review`, `click`, `targets-list`, `target-use`, `review`.
- [7] Chrome reload command via AppleScript to click `#dev-reload-button` on the extensions detail page and subsequent `node dist/cli/index.js status --output-format json` to confirm the handshake.


```
</file_contents>
<meta prompt 1 = "[Architect]">
You are producing an implementation-ready technical plan. The implementer will work from your plan without asking clarifying questions, so every design decision must be resolved, every touched component must be identified, and every behavioral change must be specified precisely.

Your job:
1. Analyze the requested change against the provided code — identify the relevant architecture, constraints, data flow, and extension points.
2. Decide whether this is best solved by a targeted change or a broader refactor, and justify that decision.
3. Produce a plan detailed enough that an engineer can implement it file-by-file without making design decisions of their own.

Hard constraints:
- Do not write production code, patches, diffs, or copy-paste-ready implementations.
- Stay in analysis and architecture mode only.
- Use illustrative snippets, interface shapes, sample signatures, state/data shapes, or pseudocode when they communicate the design more precisely than prose. Keep them partial — enough to remove ambiguity, not enough to copy-paste.

─── ANALYSIS ───

Current-state analysis (always include):
- Map the existing responsibilities, type relationships, ownership, data flow, and mutation points relevant to the request.
- Identify existing code that should be reused or extended — never duplicate what already exists without justification.
- Note hard constraints: API contracts, protocol conformances, state ownership rules, thread/actor isolation, persistence schemas, UI update mechanisms.
- When multiple subsystems interact, trace the call chain end-to-end and identify each transformation boundary.

─── DESIGN ───

Design standards — apply uniformly to every aspect of the plan:

1. New and modified components/types: For each, specify:
   - The name, kind (for example: class, interface, enum, record, service, module, controller), and why that kind fits the codebase and language.
   - The fields/properties/state it owns, including data shape, mutability, and ownership/lifecycle semantics.
   - Key callable interfaces or signatures, including inputs, outputs, and whether execution is synchronous/asynchronous or can fail.
   - Contracts it implements, extends, composes with, or depends on.
   - For closed sets of variants (for example enums, tagged unions, discriminated unions): all cases/variants and any attached data.
   - Where the component lives (file path) and who creates/owns its instances.

2. State and data flow: For each state change the plan introduces or modifies:
   - What triggers the change (user action, callback, notification, timer, stream event).
   - The exact path the data travels: source → transformations → destination.
   - Thread/actor/queue context at each step.
   - How downstream consumers observe the change (published property, delegate, notification, binding, callback).
   - What happens if the change arrives out of order, is duplicated, or is dropped.

3. API and interface changes: For each modified public/internal interface:
   - The before and after signatures (or new signature if additive).
   - Every call site that must be updated, grouped by file.
   - Backward-compatibility strategy if the interface is used by external consumers or persisted data.

4. Persistence and serialization: When the plan touches stored data:
   - Schema changes with exact field names, types, and defaults.
   - Migration strategy: how existing data is read, transformed, and re-persisted.
   - What happens when new code reads old data and when old code reads new data (if rollback is possible).

5. Concurrency and lifecycle:
   - Specify the execution model and safety boundaries for each new/modified component: thread affinity, event-loop/runtime constraints, isolation boundaries, queue/worker discipline, or thread-safety expectations as applicable.
   - Identify potential races, leaked references/resources, or lifecycle mismatches introduced by the change.
   - When operations are asynchronous, specify cancellation/abort behavior and what state remains after interruption.

6. Error handling and edge cases:
   - For each operation that can fail, specify what failures are possible and how they propagate.
   - Describe degraded-mode behavior: what the user sees, what state is preserved, what recovery is available.
   - Identify boundary conditions: empty collections, missing/null/optional values, first-run states, interrupted operations.

7. Algorithmic and logic-heavy work (include whenever the change involves non-trivial control flow, state machines, data transformations, or performance-sensitive paths):
   - Describe the algorithm step-by-step: inputs, outputs, invariants, and data structures.
   - Cover edge cases, failure modes, and performance characteristics (time/space complexity if relevant).
   - Explain why this approach over the most plausible alternatives.

8. Avoid unnecessary complexity:
   - Do not add layers, abstractions, or indirection without a concrete benefit identified in the plan.
   - Do not create parallel code paths — unify where possible.
   - Reuse existing patterns unless those patterns are themselves the problem.

─── OUTPUT ───

Structure your response as:

1. **Summary** — One paragraph: what changes, why, and the high-level approach.

2. **Current-state analysis** — How the relevant code works today. Trace the data/control flow end-to-end. Identify what is reusable and what is blocking.

3. **Design** — The core of the plan. Apply every applicable standard from above. Organize by logical component or subsystem, not by standard number. Each component section should cover types, state flow, interfaces, persistence, concurrency, and error handling as relevant to that component.

4. **File-by-file impact** — For every file that changes, list:
   - What changes (added/modified/removed types, methods, properties).
   - Why (which design decision drives this change).
   - Dependencies on other changes in this plan (ordering constraints).

5. **Trade-offs and alternatives** — What was considered and rejected, and why. Include the cost/benefit of the chosen approach vs. the runner-up.

6. **Risks and migration** — Breaking changes, rollback concerns, data migration, feature flags, and incremental delivery strategy if the change is large.

7. **Implementation order** — A numbered sequence of steps. Each step should be independently compilable and testable where possible. Call out steps that must be atomic (landed together).

Response discipline:
- Be specific to the provided code — reference actual type names, file paths, method names, and property names.
- Make every assumption explicit.
- Flag unknowns that must be validated during implementation, with a suggested validation approach.
- When a design decision has a non-obvious rationale, explain it in one sentence.
- Do not pad with generic advice. Every sentence should convey information the implementer needs.

Please proceed with your analysis based on the following <user instructions>
</meta prompt 1>
<user_instructions>
<taskname="Popup attach probe"/>
<task>Investigate the lingering extension-mode popup attach/adoption failure where popup targets remain pending with `Popup target has not finished attaching yet (stage: attached_root_unavailable)`, and prepare an Oracle-ready diagnosis/plan prompt focused on why attached-root recovery remains unavailable after raw popup attach fallback paths.</task>

<architecture>
- `extension/src/services/CDPRouter.ts` owns root/child debugger attachment, root-session reattach, and child attach diagnostics (`raw_attach_*`, `attached_root_*`).
- `extension/src/services/TargetSessionMap.ts` owns root/child session registration and alias lookup (`rootTargetAliases`, `attachTargetId`, `attachedRootSessionId`).
- `extension/src/ops/ops-runtime.ts` owns popup adoption + bridge flow (`preparePopupTarget`, `attachTargetViaOpenerSession`) and surfaces retryable errors with staged diagnostics (`ops.popup_attach_stage`).
- `extension/src/ops/ops-session-store.ts` + `target-session-coordinator.ts` own Ops session target records (including `openerTargetId`) and synthetic popup target state.
- Tests in `tests/extension-cdp-router.test.ts` and `tests/extension-ops-runtime.test.ts` already encode most attached-root-unavailable and popup-bridge scenarios; use these as nearest assertion seams.
- `docs/POPUP_ATTACH_PROBE_INVESTIGATION.md` and rollout evidence summarize intended scope and non-goals.
</architecture>

<selected_context>
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/CDPRouter.ts: `attachChildTarget()`, `ensureAttachedRootSessionWithDiagnostic()`, `registerRootTab()`, `reattachRootAndAttachChildTarget()`, `syncLiveRootTargetId()`, detach/event routing, and child/root diagnostic recording.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/TargetSessionMap.ts: root/child registration, attached-root session bookkeeping, attach-target retention, alias mapping, removal/reset behavior.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-runtime.ts: popup adoption + bridge path (`handleCreatedTab`, opener hydration, `preparePopupTarget`, `attachTargetViaOpenerSession`), stage retry policy, diagnostic surfacing in `sendPopupAttachPendingError`.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/ops-session-store.ts: synthetic popup target persistence (`sessionId`, `openerTargetId`, `attachedAt`) used by bridge/reuse paths.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/ops/target-session-coordinator.ts: target/session identity model (`tab-*` target ids, opener metadata persistence).
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/extension/src/services/cdp-router-commands.ts: root/session command handling context and session routing assumptions.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-cdp-router.test.ts (slices): attached_root_unavailable regressions and root restore/reattach expectations around popup attach fallthrough.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-ops-runtime.test.ts (slices): popup adoption/bridge harness + stage-aware retry/error surfacing cases.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-target-session-map.test.ts: current minimal root waiter coverage.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/extension-chrome-mock.ts: debugger/tab event simulation behavior that shapes tests.
/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/POPUP_ATTACH_PROBE_INVESTIGATION.md: explicit popup-only scope and non-goals.
/Users/bishopdotun/.codex/memories/rollout_summaries/2026-03-28T17-52-24-SX2q-opendevbrowser_popup_attach_instrumentation.md: prior live evidence, including first clean post-reload session `fe38f132-1d6b-42c4-9ed5-8f322701426e` failing at `attached_root_unavailable`.
</selected_context>

<relationships>
- `OpsRuntime.preparePopupTarget()` -> `attachTargetViaOpenerSession()` -> `CDPRouter.attachChildTarget(openerTabId, popupTargetId)`.
- `CDPRouter.attachChildTarget()` raw path: `attachChildTargetWithDebuggee()` then `attachChildTargetWithRootTargetId()`.
- Raw-path fallthrough -> `ensureAttachedRootSessionWithDiagnostic(tabId)`; if null, rerun `registerRootTab(tabId)` then re-check; if still null, try `reattachRootAndAttachChildTarget()`; final failure records `stage: attached_root_unavailable`.
- `ensureAttachedRootSessionWithDiagnostic()` depends on `TargetSessionMap.getByTabId(tabId)` + `attachTargetId`/retained/live target id + successful `Target.attachToTarget` to produce `attachedRootSessionId`.
- `handleEvent(Target.attachedToTarget)` updates map via `registerAttachedRootSession` when `isAttachedRootTarget(...)` is true; detach/removal paths can clear tab/session state via `removeBySessionId/removeByTabId`.
- `OpsRuntime.sendPopupAttachPendingError()` emits user-facing failure text and structured diagnostic details from `popupAttachDiagnostics`.
</relationships>

<evidence>
- Confirmed clean post-reload live failure stage: `attached_root_unavailable` (session `fe38f132-1d6b-42c4-9ed5-8f322701426e`) for both `targets.use` and popup `review`.
- Router tests already model this class: attached-root recovery can fail with `attachedRootRecoveryStage` (`attach_failed` or `attach_null`) despite retry paths.
- Runtime tests already assert stage propagation to user errors and retry logic for transient stages.
</evidence>

<open_questions>
1. In failing live runs, which `ensureAttachedRootSessionWithDiagnostic()` branch is actually reached (`record_missing`, `session_missing`, `attach_null`, `attach_failed`) after the post-fallthrough `registerRootTab(tabId)` call?
2. Does `registerRootTab(tabId)` always persist a usable `attachTargetId` for the opener tab before attached-root recovery re-attempt, or can detach/event timing clear it first?
3. Can `handleEvent(Target.detachedFromTarget)` / `detachTabState()` race with popup recovery and remove the just-created/expected attached-root record before reuse?
4. Is `isAttachedRootTarget(...)` too permissive or too strict in a way that misclassifies attached-root sessions as child sessions (or vice versa), preventing stable `attachedRootSessionId` reuse?
</open_questions>

<smallest_next_trace_seam>
Add trace-first assertions in the owning seam before behavioral changes:
- In `CDPRouter.attachChildTarget()` around each fallback boundary, emit one structured diagnostic breadcrumb for: root record presence, attachTargetId source (`record` vs retained vs live debugger), and whether `registerRootTab` changed those values.
- In `ensureAttachedRootSessionWithDiagnostic()`, log the exact branch outcome and whether `sessions.registerAttachedRootSession(...)` was called.
- In tests, extend the closest existing cases (`extension-cdp-router.test.ts` attached_root_unavailable cases + `extension-ops-runtime.test.ts` stage surfacing cases) to assert this branch-level provenance rather than only final stage.
</smallest_next_trace_seam>

<constraints>
- Keep scope strictly popup attach/adoption in extension mode.
- Non-goals: provider fallback, `/ops` vs `/cdp` cleanup, transport replacement, shopping reruns.
- Keep solution seam-local to `CDPRouter.ts`, `ops-runtime.ts`, `TargetSessionMap.ts`, and closest tests.
</constraints>
</user_instructions>
