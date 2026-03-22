export const LEGACY_CODE_SYNC_ADAPTERS = ["tsx-react-v1"] as const;
export const BUILT_IN_FRAMEWORK_ADAPTER_IDS = [
  "builtin:react-tsx-v2",
  "builtin:html-static-v1",
  "builtin:custom-elements-v1",
  "builtin:vue-sfc-v1",
  "builtin:svelte-sfc-v1"
] as const;
export const CODE_SYNC_ADAPTERS = [
  ...LEGACY_CODE_SYNC_ADAPTERS,
  ...BUILT_IN_FRAMEWORK_ADAPTER_IDS
] as const;
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
export const CODE_SYNC_CAPABILITIES = [
  "preview",
  "inventory_extract",
  "code_pull",
  "code_push",
  "token_roundtrip",
  "figma_materialize"
] as const;
export const CODE_SYNC_STATUS_REASONS = [
  "none",
  "framework_migrated",
  "manifest_migrated",
  "requires_rebind",
  "framework_mismatch",
  "adapter_mismatch",
  "capability_denied",
  "plugin_not_found",
  "plugin_load_failed",
  "plugin_execution_failed",
  "import_graph_changed"
] as const;

export type CodeSyncBuiltInFrameworkAdapterId = typeof BUILT_IN_FRAMEWORK_ADAPTER_IDS[number];
export type CodeSyncLegacyAdapter = typeof LEGACY_CODE_SYNC_ADAPTERS[number];
export type CodeSyncAdapter =
  | CodeSyncBuiltInFrameworkAdapterId
  | CodeSyncLegacyAdapter
  | `${string}/${string}`;
export type CodeSyncSyncMode = typeof CODE_SYNC_SYNC_MODES[number];
export type CodeSyncProjectionMode = typeof CODE_SYNC_PROJECTIONS[number];
export type CodeSyncAttachMode = typeof CODE_SYNC_ATTACH_MODES[number];
export type CodeSyncLeaseRole = typeof CODE_SYNC_LEASE_ROLES[number];
export type CodeSyncState = typeof CODE_SYNC_STATES[number];
export type CodeSyncOwnershipDimension = typeof CODE_SYNC_OWNERSHIP_DIMENSIONS[number];
export type CodeSyncOwnershipState = typeof CODE_SYNC_OWNERSHIP_STATES[number];
export type CodeSyncCapability = typeof CODE_SYNC_CAPABILITIES[number];
export type CodeSyncStatusReason = typeof CODE_SYNC_STATUS_REASONS[number];

export type CodeSyncOwnership = Record<CodeSyncOwnershipDimension, CodeSyncOwnershipState>;

export type CodeSyncSourceFamily =
  | "react-tsx"
  | "html-static"
  | "custom-elements"
  | "vue-sfc"
  | "svelte-sfc"
  | "unknown";

export type CodeSyncRootLocator =
  | {
    kind: "react-export";
    exportName: string;
    selector?: string;
  }
  | {
    kind: "dom-selector";
    selector: string;
  }
  | {
    kind: "document-root";
    selector?: string;
  }
  | {
    kind: "vue-template";
    selector?: string;
  }
  | {
    kind: "svelte-markup";
    selector?: string;
  };

export type CodeSyncCapabilityGrant = {
  capability: CodeSyncCapability;
  granted: boolean;
  reasonCode?: CodeSyncStatusReason;
  details?: Record<string, unknown>;
};

export type CanvasCodeSyncBindingMetadata = {
  adapter: string;
  frameworkAdapterId: string;
  frameworkId: string;
  sourceFamily: CodeSyncSourceFamily;
  adapterKind: string;
  adapterVersion: number;
  repoPath: string;
  rootLocator: CodeSyncRootLocator;
  exportName?: string;
  selector?: string;
  syncMode: CodeSyncSyncMode;
  ownership: CodeSyncOwnership;
  route?: string;
  verificationTarget?: string;
  runtimeRootSelector?: string;
  projection?: CodeSyncProjectionMode;
  manifestVersion: number;
  libraryAdapterIds: string[];
  pluginId?: string;
  declaredCapabilities: CodeSyncCapability[];
  grantedCapabilities: CodeSyncCapabilityGrant[];
  reasonCode: CodeSyncStatusReason;
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
  metadata?: Record<string, unknown>;
};

export type CodeSyncGraph = {
  adapter: string;
  frameworkAdapterId: string;
  frameworkId: string;
  sourceFamily: CodeSyncSourceFamily;
  bindingId: string;
  repoPath: string;
  rootKey: string;
  nodes: Record<string, CodeSyncNode>;
  sourceHash: string;
  unsupportedFragments: CodeSyncUnsupportedFragment[];
  libraryAdapterIds: string[];
  declaredCapabilities: CodeSyncCapability[];
  grantedCapabilities: CodeSyncCapabilityGrant[];
};

export type CodeSyncManifestNodeMapping = {
  nodeId: string;
  locator: CodeSyncSourceLocator;
};

export type CodeSyncManifest = {
  manifestVersion: number;
  bindingId: string;
  documentId: string;
  repoPath: string;
  adapter: string;
  frameworkAdapterId: string;
  frameworkId: string;
  sourceFamily: CodeSyncSourceFamily;
  adapterKind: string;
  adapterVersion: number;
  pluginId?: string;
  libraryAdapterIds: string[];
  rootLocator: CodeSyncRootLocator;
  sourceHash: string;
  documentRevision: number;
  nodeMappings: CodeSyncManifestNodeMapping[];
  lastImportedAt?: string;
  lastPushedAt?: string;
  reasonCode: CodeSyncStatusReason;
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
  adapter: string;
  frameworkAdapterId: string;
  frameworkId: string;
  sourceFamily: CodeSyncSourceFamily;
  adapterKind: string;
  adapterVersion: number;
  syncMode: CodeSyncSyncMode;
  projection: CodeSyncProjectionMode;
  state: CodeSyncState;
  driftState: CodeSyncDriftState;
  watchEnabled: boolean;
  lastImportedAt?: string;
  lastPushedAt?: string;
  conflictCount: number;
  unsupportedCount: number;
  pluginId?: string;
  libraryAdapterIds: string[];
  manifestVersion: number;
  declaredCapabilities: CodeSyncCapability[];
  grantedCapabilities: CodeSyncCapability[];
  capabilityDenials: CodeSyncCapabilityGrant[];
  reasonCode: CodeSyncStatusReason;
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

const BUILT_IN_FRAMEWORK_DETAILS: Record<
  CodeSyncBuiltInFrameworkAdapterId,
  {
    frameworkId: string;
    sourceFamily: CodeSyncSourceFamily;
    adapterKind: string;
    adapterVersion: number;
    declaredCapabilities: CodeSyncCapability[];
  }
> = {
  "builtin:react-tsx-v2": {
    frameworkId: "react",
    sourceFamily: "react-tsx",
    adapterKind: "tsx-react",
    adapterVersion: 2,
    declaredCapabilities: ["preview", "inventory_extract", "code_pull", "code_push", "token_roundtrip"]
  },
  "builtin:html-static-v1": {
    frameworkId: "html",
    sourceFamily: "html-static",
    adapterKind: "html-static",
    adapterVersion: 1,
    declaredCapabilities: ["preview", "inventory_extract", "code_pull"]
  },
  "builtin:custom-elements-v1": {
    frameworkId: "custom-elements",
    sourceFamily: "custom-elements",
    adapterKind: "custom-elements",
    adapterVersion: 1,
    declaredCapabilities: ["preview", "inventory_extract", "code_pull"]
  },
  "builtin:vue-sfc-v1": {
    frameworkId: "vue",
    sourceFamily: "vue-sfc",
    adapterKind: "vue-sfc",
    adapterVersion: 1,
    declaredCapabilities: ["preview", "inventory_extract", "code_pull"]
  },
  "builtin:svelte-sfc-v1": {
    frameworkId: "svelte",
    sourceFamily: "svelte-sfc",
    adapterKind: "svelte-sfc",
    adapterVersion: 1,
    declaredCapabilities: ["preview", "inventory_extract", "code_pull"]
  }
};

const LEGACY_ADAPTER_MAP: Record<
  CodeSyncLegacyAdapter,
  {
    frameworkAdapterId: CodeSyncBuiltInFrameworkAdapterId;
    reasonCode: CodeSyncStatusReason;
  }
> = {
  "tsx-react-v1": {
    frameworkAdapterId: "builtin:react-tsx-v2",
    reasonCode: "framework_migrated"
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()))];
}

export function isCodeSyncState(value: unknown): value is CodeSyncState {
  return typeof value === "string" && (CODE_SYNC_STATES as readonly string[]).includes(value);
}

export function isCodeSyncProjectionMode(value: unknown): value is CodeSyncProjectionMode {
  return typeof value === "string" && (CODE_SYNC_PROJECTIONS as readonly string[]).includes(value);
}

export function isCodeSyncCapability(value: unknown): value is CodeSyncCapability {
  return typeof value === "string" && (CODE_SYNC_CAPABILITIES as readonly string[]).includes(value);
}

export function isCodeSyncStatusReason(value: unknown): value is CodeSyncStatusReason {
  return typeof value === "string" && (CODE_SYNC_STATUS_REASONS as readonly string[]).includes(value);
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

function defaultDeclaredCapabilities(frameworkAdapterId: string): CodeSyncCapability[] {
  const details = BUILT_IN_FRAMEWORK_DETAILS[frameworkAdapterId as CodeSyncBuiltInFrameworkAdapterId];
  return details ? [...details.declaredCapabilities] : ["preview"];
}

function defaultGrantedCapabilities(frameworkAdapterId: string): CodeSyncCapabilityGrant[] {
  return defaultDeclaredCapabilities(frameworkAdapterId).map((capability) => ({
    capability,
    granted: true
  }));
}

function mergeDeclaredCapabilities(
  frameworkAdapterId: string,
  explicitCapabilities: CodeSyncCapability[]
): CodeSyncCapability[] {
  const merged = new Set<CodeSyncCapability>(defaultDeclaredCapabilities(frameworkAdapterId));
  for (const capability of explicitCapabilities) {
    merged.add(capability);
  }
  return [...merged];
}

function mergeGrantedCapabilities(
  frameworkAdapterId: string,
  explicitGrants: CodeSyncCapabilityGrant[]
): CodeSyncCapabilityGrant[] {
  const grants = new Map<CodeSyncCapability, CodeSyncCapabilityGrant>();
  for (const grant of defaultGrantedCapabilities(frameworkAdapterId)) {
    grants.set(grant.capability, grant);
  }
  for (const grant of explicitGrants) {
    grants.set(grant.capability, grant);
  }
  return [...grants.values()];
}

export function inferBuiltInFrameworkAdapterIdFromPath(repoPath: string): CodeSyncBuiltInFrameworkAdapterId {
  const normalized = repoPath.toLowerCase();
  if (normalized.endsWith(".vue")) {
    return "builtin:vue-sfc-v1";
  }
  if (normalized.endsWith(".svelte")) {
    return "builtin:svelte-sfc-v1";
  }
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) {
    return "builtin:html-static-v1";
  }
  return "builtin:react-tsx-v2";
}

export function inferCodeSyncSourceFamilyFromPath(repoPath: string): CodeSyncSourceFamily {
  return BUILT_IN_FRAMEWORK_DETAILS[inferBuiltInFrameworkAdapterIdFromPath(repoPath)].sourceFamily;
}

export function normalizeCodeSyncRootLocator(
  value: unknown,
  options: {
    sourceFamily: CodeSyncSourceFamily;
    exportName?: string;
    selector?: string;
  }
): CodeSyncRootLocator {
  const record = isRecord(value) ? value : {};
  const kind = readString(record.kind);
  const exportName = readString(record.exportName) ?? options.exportName;
  const selector = readString(record.selector) ?? options.selector;

  if (options.sourceFamily === "react-tsx") {
    if (kind === "dom-selector" && selector) {
      return { kind, selector };
    }
    if (exportName) {
      return {
        kind: "react-export",
        exportName,
        ...(selector ? { selector } : {})
      };
    }
    if (selector) {
      return {
        kind: "dom-selector",
        selector
      };
    }
    throw new Error("codeSync.exportName or codeSync.selector is required.");
  }

  if (options.sourceFamily === "vue-sfc") {
    return {
      kind: "vue-template",
      ...(selector ? { selector } : {})
    };
  }

  if (options.sourceFamily === "svelte-sfc") {
    return {
      kind: "svelte-markup",
      ...(selector ? { selector } : {})
    };
  }

  if (selector) {
    return {
      kind: "dom-selector",
      selector
    };
  }

  return {
    kind: "document-root"
  };
}

export function normalizeCodeSyncCapabilityGrant(value: unknown): CodeSyncCapabilityGrant | null {
  if (!isRecord(value) || !isCodeSyncCapability(value.capability)) {
    return null;
  }
  return {
    capability: value.capability,
    granted: value.granted !== false,
    ...(isCodeSyncStatusReason(value.reasonCode) ? { reasonCode: value.reasonCode } : {}),
    ...(isRecord(value.details) ? { details: value.details } : {})
  };
}

export function normalizeFrameworkAdapterIdentity(input: {
  adapter: string | null;
  frameworkAdapterId?: string | null;
  repoPath: string;
}): {
  adapter: string;
  frameworkAdapterId: string;
  frameworkId: string;
  sourceFamily: CodeSyncSourceFamily;
  adapterKind: string;
  adapterVersion: number;
  reasonCode: CodeSyncStatusReason;
  pluginId?: string;
} {
  const adapter = input.adapter ?? "";
  const explicitFrameworkAdapterId = readString(input.frameworkAdapterId);
  const inferredFrameworkAdapterId = explicitFrameworkAdapterId
    ?? (adapter in LEGACY_ADAPTER_MAP
      ? LEGACY_ADAPTER_MAP[adapter as CodeSyncLegacyAdapter].frameworkAdapterId
      : adapter.startsWith("builtin:")
        ? adapter
        : adapter.includes("/")
        ? adapter
          : inferBuiltInFrameworkAdapterIdFromPath(input.repoPath));
  const migratedReason = adapter in LEGACY_ADAPTER_MAP
    ? LEGACY_ADAPTER_MAP[adapter as CodeSyncLegacyAdapter].reasonCode
    : "none";

  if (inferredFrameworkAdapterId in BUILT_IN_FRAMEWORK_DETAILS) {
    const details = BUILT_IN_FRAMEWORK_DETAILS[inferredFrameworkAdapterId as CodeSyncBuiltInFrameworkAdapterId];
    return {
      adapter: adapter || inferredFrameworkAdapterId,
      frameworkAdapterId: inferredFrameworkAdapterId,
      frameworkId: details.frameworkId,
      sourceFamily: details.sourceFamily,
      adapterKind: details.adapterKind,
      adapterVersion: details.adapterVersion,
      reasonCode: migratedReason
    };
  }

  const pluginId = inferredFrameworkAdapterId.includes("/")
    ? inferredFrameworkAdapterId.split("/", 1)[0]
    : undefined;
  const sourceFamily = inferCodeSyncSourceFamilyFromPath(input.repoPath);
  return {
    adapter: adapter || inferredFrameworkAdapterId,
    frameworkAdapterId: inferredFrameworkAdapterId,
    frameworkId: sourceFamily === "react-tsx"
      ? "react"
      : sourceFamily === "vue-sfc"
        ? "vue"
        : sourceFamily === "svelte-sfc"
          ? "svelte"
          : "html",
    sourceFamily,
    adapterKind: pluginId ? "plugin" : "unknown",
    adapterVersion: 1,
    reasonCode: migratedReason,
    ...(pluginId ? { pluginId } : {})
  };
}

export function normalizeCodeSyncBindingMetadata(value: unknown): CanvasCodeSyncBindingMetadata {
  if (!isRecord(value)) {
    throw new Error("Invalid code sync binding metadata.");
  }
  const repoPath = readString(value.repoPath);
  const syncMode = readString(value.syncMode);
  if (!repoPath) {
    throw new Error("codeSync.repoPath is required.");
  }
  if (!syncMode || !(CODE_SYNC_SYNC_MODES as readonly string[]).includes(syncMode)) {
    throw new Error(`Unsupported code sync mode: ${syncMode || "unknown"}`);
  }

  const exportName = readString(value.exportName) ?? undefined;
  const selector = readString(value.selector) ?? undefined;
  const identity = normalizeFrameworkAdapterIdentity({
    adapter: readString(value.adapter),
    frameworkAdapterId: readString(value.frameworkAdapterId),
    repoPath
  });
  const rootLocator = normalizeCodeSyncRootLocator(value.rootLocator, {
    sourceFamily: identity.sourceFamily,
    exportName,
    selector
  });
  const declaredCapabilities = readStringArray(value.declaredCapabilities)
    .filter((entry): entry is CodeSyncCapability => isCodeSyncCapability(entry));
  const grantedCapabilities = Array.isArray(value.grantedCapabilities)
    ? value.grantedCapabilities
      .map((entry) => normalizeCodeSyncCapabilityGrant(entry))
      .filter((entry): entry is CodeSyncCapabilityGrant => Boolean(entry))
    : [];
  const manifestVersion = readNumber(value.manifestVersion) ?? 2;
  const reasonCode = isCodeSyncStatusReason(value.reasonCode)
    ? value.reasonCode
    : identity.reasonCode;

  return {
    adapter: identity.adapter,
    frameworkAdapterId: identity.frameworkAdapterId,
    frameworkId: readString(value.frameworkId) ?? identity.frameworkId,
    sourceFamily: (readString(value.sourceFamily) as CodeSyncSourceFamily | null) ?? identity.sourceFamily,
    adapterKind: readString(value.adapterKind) ?? identity.adapterKind,
    adapterVersion: readNumber(value.adapterVersion) ?? identity.adapterVersion,
    repoPath,
    rootLocator,
    exportName,
    selector,
    syncMode: syncMode as CodeSyncSyncMode,
    ownership: normalizeCodeSyncOwnership(value.ownership),
    route: readString(value.route) ?? undefined,
    verificationTarget: readString(value.verificationTarget) ?? undefined,
    runtimeRootSelector: readString(value.runtimeRootSelector) ?? undefined,
    projection: isCodeSyncProjectionMode(value.projection) ? value.projection : "canvas_html",
    manifestVersion,
    libraryAdapterIds: readStringArray(value.libraryAdapterIds ?? value.libraryAdapters),
    pluginId: readString(value.pluginId) ?? identity.pluginId,
    declaredCapabilities: declaredCapabilities.length > 0
      ? mergeDeclaredCapabilities(identity.frameworkAdapterId, declaredCapabilities)
      : defaultDeclaredCapabilities(identity.frameworkAdapterId),
    grantedCapabilities: grantedCapabilities.length > 0
      ? mergeGrantedCapabilities(identity.frameworkAdapterId, grantedCapabilities)
      : defaultGrantedCapabilities(identity.frameworkAdapterId),
    reasonCode
  };
}
