export type CanvasPreviewState = "focused" | "pinned" | "background" | "degraded";
export type CanvasAttachedClientRole = "lease_holder" | "observer";
export type CanvasCodeSyncState =
  | "idle"
  | "session_join_pending"
  | "pull_pending"
  | "push_pending"
  | "in_sync"
  | "drift_detected"
  | "conflict"
  | "unsupported"
  | "lease_lost"
  | "projection_fallback";
export type CanvasCodeSyncDriftState = "clean" | "source_changed" | "document_changed" | "conflict";
export type CanvasCodeSyncWatchState = "idle" | "watching" | "stopped";
export type CanvasCodeSyncProjectionMode = "canvas_html" | "bound_app_runtime";
export type CanvasCodeSyncFallbackReason =
  | "runtime_bridge_unavailable"
  | "runtime_projection_unsupported"
  | "runtime_projection_failed"
  | "runtime_instrumentation_missing"
  | "fallback_canvas_html";

export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasNode = {
  id: string;
  kind: string;
  name: string;
  pageId?: string;
  parentId?: string | null;
  childIds: string[];
  rect: CanvasRect;
  props: Record<string, unknown>;
  style: Record<string, unknown>;
  bindingRefs: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type CanvasBinding = {
  id: string;
  nodeId: string;
  kind: string;
  componentName?: string;
  metadata: Record<string, unknown>;
};

export type CanvasAsset = {
  id: string;
  sourceType?: string;
  kind?: string;
  repoPath?: string | null;
  url?: string | null;
  mime?: string;
  metadata: Record<string, unknown>;
};

export type CanvasPage = {
  id: string;
  name: string;
  path: string;
  rootNodeId: string | null;
  prototypeIds: string[];
  nodes: CanvasNode[];
  metadata: Record<string, unknown>;
};

export type CanvasDocument = {
  documentId: string;
  title: string;
  updatedAt?: string;
  pages: CanvasPage[];
  bindings: CanvasBinding[];
  assets: CanvasAsset[];
  componentInventory: Array<Record<string, unknown>>;
};

export type CanvasFeedbackItem = {
  id: string;
  cursor: string;
  category: string;
  class: string;
  severity: string;
  message: string;
  documentId: string;
  documentRevision: number;
  pageId: string | null;
  prototypeId: string | null;
  targetId: string | null;
  evidenceRefs: string[];
  details?: Record<string, unknown>;
};

export type CanvasFeedbackEvent =
  | {
    eventType: "feedback.item";
    item: CanvasFeedbackItem;
  }
  | {
    eventType: "feedback.heartbeat";
    cursor: string | null;
    ts: string;
    activeTargetIds: string[];
  }
  | {
    eventType: "feedback.complete";
    cursor: string | null;
    ts: string;
      reason: "session_closed" | "lease_revoked" | "subscription_replaced" | "document_unloaded";
  };

export type CanvasRuntimeParityArtifact = {
  projection: CanvasCodeSyncProjectionMode;
  rootBindingId: string;
  capturedAt: string;
  hierarchyHash: string;
  nodeCount: number;
};

export type CanvasTargetStateSummary = {
  targetId: string;
  prototypeId: string | null;
  previewMode: CanvasPreviewState;
  previewState: CanvasPreviewState;
  renderStatus?: "idle" | "rendered" | "degraded";
  degradeReason?: string | null;
  lastRenderedAt?: string;
  projection?: CanvasCodeSyncProjectionMode;
  fallbackReason?: CanvasCodeSyncFallbackReason | null;
  parityArtifact?: CanvasRuntimeParityArtifact | null;
};

export type CanvasOverlayMountSummary = {
  mountId: string;
  targetId: string;
  mountedAt: string;
};

export type CanvasEditorViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasEditorSelection = {
  pageId: string | null;
  nodeId: string | null;
  targetId: string | null;
  updatedAt: string;
};

export type CanvasAttachedClientSummary = {
  clientId: string;
  role: CanvasAttachedClientRole;
  attachedAt: string;
  lastSeenAt: string;
};

export type CanvasCodeSyncBindingStatusSummary = {
  bindingId: string;
  nodeId: string;
  repoPath: string;
  adapter: string;
  syncMode: string;
  projection: CanvasCodeSyncProjectionMode;
  state: CanvasCodeSyncState;
  driftState: CanvasCodeSyncDriftState;
  watchEnabled: boolean;
  lastImportedAt?: string;
  lastPushedAt?: string;
  conflictCount: number;
  unsupportedCount: number;
};

export type CanvasSessionSummary = {
  canvasSessionId?: string;
  mode?: string;
  planStatus?: string;
  preflightState?: string;
  libraryPolicy?: Record<string, unknown>;
  componentInventoryCount?: number;
  componentSourceKinds?: string[];
  attachedClients: CanvasAttachedClientSummary[];
  leaseHolderClientId: string | null;
  watchState?: CanvasCodeSyncWatchState;
  codeSyncState?: CanvasCodeSyncState;
  boundFiles: string[];
  conflictCount?: number;
  driftState?: CanvasCodeSyncDriftState;
  lastImportAt?: string;
  lastPushAt?: string;
  bindings: CanvasCodeSyncBindingStatusSummary[];
  [key: string]: unknown;
};

export type CanvasPageState = {
  tabId: number;
  targetId: string;
  canvasSessionId: string;
  documentId: string;
  documentRevision: number | null;
  title: string;
  document: CanvasDocument;
  html: string;
  previewMode: CanvasPreviewState;
  previewState: CanvasPreviewState;
  updatedAt: string;
  summary: CanvasSessionSummary;
  targets: CanvasTargetStateSummary[];
  overlayMounts: CanvasOverlayMountSummary[];
  feedback: CanvasFeedbackEvent[];
  feedbackCursor: string | null;
  selection: CanvasEditorSelection;
  viewport: CanvasEditorViewport;
  pendingMutation?: boolean;
};

export type CanvasPageMessage = {
  type: "canvas-page:init" | "canvas-page:update" | "canvas-page:closed";
  state?: CanvasPageState | null;
  reason?: string;
} | {
  type: "canvas-page-action-request";
  requestId: string;
  selector?: string | null;
  action: CanvasPageElementAction;
};

export type CanvasPageElementAction =
  | { type: "outerHTML" }
  | { type: "innerText" }
  | { type: "getAttr"; name: string }
  | { type: "getValue" }
  | { type: "isEnabled" }
  | { type: "isChecked" }
  | { type: "getSelectorState" }
  | { type: "click" }
  | { type: "hover" }
  | { type: "focus" }
  | { type: "press"; key: string }
  | { type: "type"; value: string; clear: boolean; submit: boolean }
  | { type: "setChecked"; checked: boolean }
  | { type: "select"; values: string[] }
  | { type: "scroll"; dy: number }
  | { type: "scrollIntoView" };

export type CanvasPagePortMessage =
  | { type: "canvas-page-ready" }
  | { type: "canvas-page-request-state" }
  | {
    type: "canvas-page-view-state";
    viewport?: Partial<CanvasEditorViewport>;
    selection?: Partial<CanvasEditorSelection>;
  }
  | {
    type: "canvas-page-patch-request";
    baseRevision: number;
    patches: unknown[];
    selection?: Partial<CanvasEditorSelection>;
  }
  | {
    type: "canvas-page-action-response";
    requestId: string;
    ok: true;
    value?: unknown;
  }
  | {
    type: "canvas-page-action-response";
    requestId: string;
    ok: false;
    error: string;
  };

export type CanvasProjectionSummary = {
  activeProjections: CanvasCodeSyncProjectionMode[];
  fallbackReasons: CanvasCodeSyncFallbackReason[];
  conflictCount: number;
  watchConflict: boolean;
};

const CODE_SYNC_STATES = new Set<CanvasCodeSyncState>([
  "idle",
  "session_join_pending",
  "pull_pending",
  "push_pending",
  "in_sync",
  "drift_detected",
  "conflict",
  "unsupported",
  "lease_lost",
  "projection_fallback"
]);
const CODE_SYNC_DRIFT_STATES = new Set<CanvasCodeSyncDriftState>([
  "clean",
  "source_changed",
  "document_changed",
  "conflict"
]);
const CODE_SYNC_WATCH_STATES = new Set<CanvasCodeSyncWatchState>(["idle", "watching", "stopped"]);
const CODE_SYNC_PROJECTIONS = new Set<CanvasCodeSyncProjectionMode>(["canvas_html", "bound_app_runtime"]);
const CODE_SYNC_FALLBACK_REASONS = new Set<CanvasCodeSyncFallbackReason>([
  "runtime_bridge_unavailable",
  "runtime_projection_unsupported",
  "runtime_projection_failed",
  "runtime_instrumentation_missing",
  "fallback_canvas_html"
]);
const ATTACHED_CLIENT_ROLES = new Set<CanvasAttachedClientRole>(["lease_holder", "observer"]);

export function normalizeCanvasSessionSummary(value: unknown): CanvasSessionSummary {
  const summary = isRecord(value) ? { ...value } : {};
  return {
    ...summary,
    canvasSessionId: optionalString(summary.canvasSessionId) ?? undefined,
    mode: optionalString(summary.mode) ?? undefined,
    planStatus: optionalString(summary.planStatus) ?? undefined,
    preflightState: optionalString(summary.preflightState) ?? undefined,
    libraryPolicy: isRecord(summary.libraryPolicy) ? summary.libraryPolicy : undefined,
    componentInventoryCount: optionalNumber(summary.componentInventoryCount) ?? undefined,
    componentSourceKinds: readStringArray(summary.componentSourceKinds),
    attachedClients: Array.isArray(summary.attachedClients)
      ? summary.attachedClients.flatMap((entry) => normalizeAttachedClient(entry))
      : [],
    leaseHolderClientId: optionalString(summary.leaseHolderClientId),
    watchState: isCodeSyncWatchState(summary.watchState) ? summary.watchState : undefined,
    codeSyncState: isCodeSyncState(summary.codeSyncState) ? summary.codeSyncState : undefined,
    boundFiles: readStringArray(summary.boundFiles),
    conflictCount: optionalNumber(summary.conflictCount) ?? undefined,
    driftState: isCodeSyncDriftState(summary.driftState) ? summary.driftState : undefined,
    lastImportAt: optionalString(summary.lastImportAt) ?? undefined,
    lastPushAt: optionalString(summary.lastPushAt) ?? undefined,
    bindings: Array.isArray(summary.bindings)
      ? summary.bindings.flatMap((entry) => normalizeCodeSyncBindingStatus(entry))
      : []
  };
}

export function normalizeCanvasTargetStateSummaries(value: unknown): CanvasTargetStateSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const targetId = optionalString(entry.targetId);
    const previewMode = normalizePreviewState(entry.previewMode);
    const previewState = normalizePreviewState(entry.previewState);
    if (!targetId || !previewMode || !previewState) {
      return [];
    }
    return [{
      targetId,
      prototypeId: optionalString(entry.prototypeId),
      previewMode,
      previewState,
      renderStatus: normalizeRenderStatus(entry.renderStatus) ?? undefined,
      degradeReason: optionalString(entry.degradeReason),
      lastRenderedAt: optionalString(entry.lastRenderedAt) ?? undefined,
      projection: isCodeSyncProjectionMode(entry.projection) ? entry.projection : undefined,
      fallbackReason: isCodeSyncFallbackReason(entry.fallbackReason) ? entry.fallbackReason : null,
      parityArtifact: normalizeParityArtifact(entry.parityArtifact)
    }];
  });
}

export function summarizeCanvasProjectionState(
  summary: CanvasSessionSummary,
  targets: CanvasTargetStateSummary[]
): CanvasProjectionSummary {
  const activeProjections = uniqueStrings<CanvasCodeSyncProjectionMode>([
    ...targets.flatMap((entry) => entry.projection ? [entry.projection] : []),
    ...summary.bindings.flatMap((entry) => entry.projection ? [entry.projection] : [])
  ]);
  const fallbackReasons = uniqueStrings<CanvasCodeSyncFallbackReason>(
    targets.flatMap((entry) => entry.fallbackReason ? [entry.fallbackReason] : [])
  );
  const conflictCount = typeof summary.conflictCount === "number"
    ? summary.conflictCount
    : summary.bindings.reduce((sum, entry) => sum + entry.conflictCount, 0);
  return {
    activeProjections,
    fallbackReasons,
    conflictCount,
    watchConflict: summary.watchState === "watching" && (summary.driftState === "conflict" || conflictCount > 0)
  };
}

function normalizeAttachedClient(value: unknown): CanvasAttachedClientSummary[] {
  if (!isRecord(value)) {
    return [];
  }
  const clientId = optionalString(value.clientId);
  const attachedAt = optionalString(value.attachedAt);
  const lastSeenAt = optionalString(value.lastSeenAt);
  if (!clientId || !attachedAt || !lastSeenAt) {
    return [];
  }
  return [{
    clientId,
    role: ATTACHED_CLIENT_ROLES.has(value.role as CanvasAttachedClientRole)
      ? value.role as CanvasAttachedClientRole
      : "observer",
    attachedAt,
    lastSeenAt
  }];
}

function normalizeCodeSyncBindingStatus(value: unknown): CanvasCodeSyncBindingStatusSummary[] {
  if (!isRecord(value)) {
    return [];
  }
  const bindingId = optionalString(value.bindingId);
  const nodeId = optionalString(value.nodeId);
  const repoPath = optionalString(value.repoPath);
  const adapter = optionalString(value.adapter);
  const syncMode = optionalString(value.syncMode);
  const projection = isCodeSyncProjectionMode(value.projection) ? value.projection : null;
  const state = isCodeSyncState(value.state) ? value.state : null;
  const driftState = isCodeSyncDriftState(value.driftState) ? value.driftState : null;
  if (!bindingId || !nodeId || !repoPath || !adapter || !syncMode || !projection || !state || !driftState) {
    return [];
  }
  return [{
    bindingId,
    nodeId,
    repoPath,
    adapter,
    syncMode,
    projection,
    state,
    driftState,
    watchEnabled: value.watchEnabled === true,
    lastImportedAt: optionalString(value.lastImportedAt) ?? undefined,
    lastPushedAt: optionalString(value.lastPushedAt) ?? undefined,
    conflictCount: optionalNumber(value.conflictCount) ?? 0,
    unsupportedCount: optionalNumber(value.unsupportedCount) ?? 0
  }];
}

function normalizeParityArtifact(value: unknown): CanvasRuntimeParityArtifact | null {
  if (!isRecord(value)) {
    return null;
  }
  const projection = isCodeSyncProjectionMode(value.projection) ? value.projection : null;
  const rootBindingId = optionalString(value.rootBindingId);
  const capturedAt = optionalString(value.capturedAt);
  const hierarchyHash = optionalString(value.hierarchyHash);
  if (!projection || !rootBindingId || !capturedAt || !hierarchyHash) {
    return null;
  }
  const nodeCount = Array.isArray(value.nodes)
    ? value.nodes.length
    : optionalNumber(value.nodeCount) ?? 0;
  return {
    projection,
    rootBindingId,
    capturedAt,
    hierarchyHash,
    nodeCount
  };
}

function normalizePreviewState(value: unknown): CanvasPreviewState | null {
  return value === "focused" || value === "pinned" || value === "background" || value === "degraded"
    ? value
    : null;
}

function normalizeRenderStatus(value: unknown): CanvasTargetStateSummary["renderStatus"] | null {
  return value === "idle" || value === "rendered" || value === "degraded"
    ? value
    : null;
}

function isCodeSyncState(value: unknown): value is CanvasCodeSyncState {
  return typeof value === "string" && CODE_SYNC_STATES.has(value as CanvasCodeSyncState);
}

function isCodeSyncDriftState(value: unknown): value is CanvasCodeSyncDriftState {
  return typeof value === "string" && CODE_SYNC_DRIFT_STATES.has(value as CanvasCodeSyncDriftState);
}

function isCodeSyncWatchState(value: unknown): value is CanvasCodeSyncWatchState {
  return typeof value === "string" && CODE_SYNC_WATCH_STATES.has(value as CanvasCodeSyncWatchState);
}

function isCodeSyncProjectionMode(value: unknown): value is CanvasCodeSyncProjectionMode {
  return typeof value === "string" && CODE_SYNC_PROJECTIONS.has(value as CanvasCodeSyncProjectionMode);
}

function isCodeSyncFallbackReason(value: unknown): value is CanvasCodeSyncFallbackReason {
  return typeof value === "string" && CODE_SYNC_FALLBACK_REASONS.has(value as CanvasCodeSyncFallbackReason);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
