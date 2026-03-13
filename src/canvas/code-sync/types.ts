export const CODE_SYNC_ADAPTERS = ["tsx-react-v1"] as const;
export const CODE_SYNC_SYNC_MODES = ["manual", "watch"] as const;
export const CODE_SYNC_PROJECTIONS = ["canvas_html", "bound_app_runtime"] as const;
export const CODE_SYNC_ATTACH_MODES = ["observer", "lease_reclaim"] as const;
export const CODE_SYNC_LEASE_ROLES = ["lease_holder", "observer"] as const;
export const CODE_SYNC_STATES = [
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
] as const;
export const CODE_SYNC_OWNERSHIP_DIMENSIONS = [
  "structure",
  "text",
  "style",
  "tokens",
  "behavior",
  "data"
] as const;
export const CODE_SYNC_OWNERSHIP_STATES = ["shared", "canvas", "code"] as const;

export type CodeSyncAdapter = typeof CODE_SYNC_ADAPTERS[number];
export type CodeSyncSyncMode = typeof CODE_SYNC_SYNC_MODES[number];
export type CodeSyncProjectionMode = typeof CODE_SYNC_PROJECTIONS[number];
export type CodeSyncAttachMode = typeof CODE_SYNC_ATTACH_MODES[number];
export type CodeSyncLeaseRole = typeof CODE_SYNC_LEASE_ROLES[number];
export type CodeSyncState = typeof CODE_SYNC_STATES[number];
export type CodeSyncOwnershipDimension = typeof CODE_SYNC_OWNERSHIP_DIMENSIONS[number];
export type CodeSyncOwnershipState = typeof CODE_SYNC_OWNERSHIP_STATES[number];

export type CodeSyncOwnership = Record<CodeSyncOwnershipDimension, CodeSyncOwnershipState>;

export type CanvasCodeSyncBindingMetadata = {
  adapter: CodeSyncAdapter;
  repoPath: string;
  exportName?: string;
  selector?: string;
  syncMode: CodeSyncSyncMode;
  ownership: CodeSyncOwnership;
  route?: string;
  verificationTarget?: string;
  runtimeRootSelector?: string;
  projection?: CodeSyncProjectionMode;
};

export type CodeSyncSourcePosition = {
  offset: number;
  line: number;
  column: number;
};

export type CodeSyncSourceSpan = {
  start: CodeSyncSourcePosition;
  end: CodeSyncSourcePosition;
};

export type CodeSyncSourceLocator = {
  sourcePath: string;
  sourceSpan: CodeSyncSourceSpan;
  astPath: string;
};

export type CodeSyncUnsupportedFragment = {
  key: string;
  reason: string;
  raw: string;
  locator?: CodeSyncSourceLocator;
};

export type CodeSyncNodeKind = "element" | "text" | "unsupported";

export type CodeSyncNode = {
  key: string;
  kind: CodeSyncNodeKind;
  bindingId: string;
  locator: CodeSyncSourceLocator;
  tagName?: string;
  text?: string;
  attributes: Record<string, string>;
  style: Record<string, string | number>;
  preservedAttributes: string[];
  childKeys: string[];
  raw?: string;
  unsupportedReason?: string;
};

export type CodeSyncGraph = {
  adapter: CodeSyncAdapter;
  bindingId: string;
  repoPath: string;
  rootKey: string;
  nodes: Record<string, CodeSyncNode>;
  sourceHash: string;
  unsupportedFragments: CodeSyncUnsupportedFragment[];
};

export type CodeSyncRootLocator = {
  exportName?: string;
  selector?: string;
};

export type CodeSyncManifestNodeMapping = {
  nodeId: string;
  locator: CodeSyncSourceLocator;
};

export type CodeSyncManifest = {
  bindingId: string;
  documentId: string;
  repoPath: string;
  adapter: CodeSyncAdapter;
  rootLocator: CodeSyncRootLocator;
  sourceHash: string;
  documentRevision: number;
  nodeMappings: CodeSyncManifestNodeMapping[];
  lastImportedAt?: string;
  lastPushedAt?: string;
};

export type CodeSyncConflictKind =
  | "source_hash_changed"
  | "document_revision_changed"
  | "ownership_violation"
  | "unsupported_change";

export type CodeSyncConflict = {
  kind: CodeSyncConflictKind;
  bindingId: string;
  nodeId?: string;
  message: string;
  details?: Record<string, unknown>;
};

export type CodeSyncResolutionPolicy = "prefer_code" | "prefer_canvas" | "manual";

export type CodeSyncDriftState = "clean" | "source_changed" | "document_changed" | "conflict";

export type CodeSyncBindingStatus = {
  bindingId: string;
  nodeId: string;
  repoPath: string;
  adapter: CodeSyncAdapter;
  syncMode: CodeSyncSyncMode;
  projection: CodeSyncProjectionMode;
  state: CodeSyncState;
  driftState: CodeSyncDriftState;
  watchEnabled: boolean;
  lastImportedAt?: string;
  lastPushedAt?: string;
  conflictCount: number;
  unsupportedCount: number;
};

export type CodeSyncWatchState = "idle" | "watching" | "stopped";

export type CodeSyncSessionStatus = {
  state: CodeSyncState;
  boundFiles: string[];
  attachedClients: number;
  activeLeaseHolder: string | null;
  watchState: CodeSyncWatchState;
  lastImportAt?: string;
  lastPushAt?: string;
  conflictCount: number;
  driftState: CodeSyncDriftState;
  bindings: CodeSyncBindingStatus[];
};

export type CanvasParityNodeArtifact = {
  nodeId: string;
  bindingId: string;
  text: string;
  childOrderHash: string;
  attributes: Record<string, string>;
  styleProjection: Record<string, string>;
};

export type CanvasParityArtifact = {
  projection: CodeSyncProjectionMode;
  rootBindingId: string;
  capturedAt: string;
  hierarchyHash: string;
  nodes: CanvasParityNodeArtifact[];
};

export const DEFAULT_CODE_SYNC_OWNERSHIP: CodeSyncOwnership = {
  structure: "shared",
  text: "shared",
  style: "shared",
  tokens: "shared",
  behavior: "code",
  data: "code"
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function isCodeSyncState(value: unknown): value is CodeSyncState {
  return typeof value === "string" && (CODE_SYNC_STATES as readonly string[]).includes(value);
}

export function isCodeSyncProjectionMode(value: unknown): value is CodeSyncProjectionMode {
  return typeof value === "string" && (CODE_SYNC_PROJECTIONS as readonly string[]).includes(value);
}

export function normalizeCodeSyncOwnership(value: unknown): CodeSyncOwnership {
  if (!isRecord(value)) {
    return { ...DEFAULT_CODE_SYNC_OWNERSHIP };
  }
  const normalized = {} as CodeSyncOwnership;
  for (const dimension of CODE_SYNC_OWNERSHIP_DIMENSIONS) {
    const entry = value[dimension];
    normalized[dimension] = typeof entry === "string" && (CODE_SYNC_OWNERSHIP_STATES as readonly string[]).includes(entry)
      ? entry as CodeSyncOwnershipState
      : DEFAULT_CODE_SYNC_OWNERSHIP[dimension];
  }
  return normalized;
}

export function normalizeCodeSyncBindingMetadata(value: unknown): CanvasCodeSyncBindingMetadata {
  if (!isRecord(value)) {
    throw new Error("Invalid code sync binding metadata.");
  }
  const adapter = typeof value.adapter === "string" ? value.adapter : "";
  const repoPath = typeof value.repoPath === "string" ? value.repoPath.trim() : "";
  const syncMode = typeof value.syncMode === "string" ? value.syncMode : "";
  if (!(CODE_SYNC_ADAPTERS as readonly string[]).includes(adapter)) {
    throw new Error(`Unsupported code sync adapter: ${adapter || "unknown"}`);
  }
  if (!repoPath) {
    throw new Error("codeSync.repoPath is required.");
  }
  if (!(CODE_SYNC_SYNC_MODES as readonly string[]).includes(syncMode)) {
    throw new Error(`Unsupported code sync mode: ${syncMode || "unknown"}`);
  }
  const exportName = typeof value.exportName === "string" && value.exportName.trim().length > 0 ? value.exportName : undefined;
  const selector = typeof value.selector === "string" && value.selector.trim().length > 0 ? value.selector : undefined;
  if (!exportName && !selector) {
    throw new Error("codeSync.exportName or codeSync.selector is required.");
  }
  const projection = typeof value.projection === "string" && (CODE_SYNC_PROJECTIONS as readonly string[]).includes(value.projection)
    ? value.projection as CodeSyncProjectionMode
    : "canvas_html";
  return {
    adapter: adapter as CodeSyncAdapter,
    repoPath,
    exportName,
    selector,
    syncMode: syncMode as CodeSyncSyncMode,
    ownership: normalizeCodeSyncOwnership(value.ownership),
    route: typeof value.route === "string" && value.route.trim().length > 0 ? value.route : undefined,
    verificationTarget: typeof value.verificationTarget === "string" && value.verificationTarget.trim().length > 0
      ? value.verificationTarget
      : undefined,
    runtimeRootSelector: typeof value.runtimeRootSelector === "string" && value.runtimeRootSelector.trim().length > 0
      ? value.runtimeRootSelector
      : undefined,
    projection
  };
}
