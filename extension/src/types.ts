export type ConnectionStatus = "connected" | "disconnected";

export type PopupAnnotationStartMessage = {
  type: "annotation:start";
  options?: AnnotationCommand["options"];
  tabId?: number;
};
export type PopupAnnotationLastMetaMessage = { type: "annotation:lastMeta" };
export type PopupAnnotationGetPayloadMessage = { type: "annotation:getPayload"; includeScreenshots?: boolean };
export type PopupAnnotationSanitizePayloadMessage = { type: "annotation:sanitizePayload"; payload: AnnotationPayload };
export type PopupAnnotationSendPayloadMessage = {
  type: "annotation:sendPayload";
  payload: AnnotationPayload;
  source?: AnnotationDispatchSource;
  label?: string;
};
export type PopupAnnotationProbeMessage = { type: "annotation:probe"; tabId?: number };

export type PopupMessage =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "status" }
  | PopupAnnotationStartMessage
  | PopupAnnotationLastMetaMessage
  | PopupAnnotationGetPayloadMessage
  | PopupAnnotationSanitizePayloadMessage
  | PopupAnnotationSendPayloadMessage
  | PopupAnnotationProbeMessage;

export type BackgroundMessage = {
  type: "status";
  status: ConnectionStatus;
  note?: string;
  relayHealth?: RelayHealthStatus | null;
  nativeHealth?: NativeTransportHealth | null;
  nativeEnabled?: boolean;
};

export type RelayCommand = {
  id: string | number;
  method: "forwardCDPCommand";
  params: {
    method: string;
    params?: unknown;
    sessionId?: string;
  };
};

export type RelayEvent = {
  method: "forwardCDPEvent";
  params: {
    method: string;
    params?: unknown;
    sessionId?: string;
  };
};

export type RelayCdpControl = {
  type: "cdp_control";
  action: "client_closed";
};

export type RelayResponse = {
  id: string | number;
  result?: unknown;
  error?: { message: string };
  sessionId?: string;
};

export type RelayHandshake = {
  type: "handshake";
  payload: {
    tabId: number;
    url?: string;
    title?: string;
    groupId?: number;
    pairingToken?: string;
  };
};

export type RelayHandshakeAck = {
  type: "handshakeAck";
  payload: {
    instanceId: string;
    relayPort: number;
    pairingRequired: boolean;
    epoch?: number;
  };
};

export type RelayHandshakeError = {
  code: "pairing_missing" | "pairing_invalid" | "rate_limited" | "origin_blocked";
  message: string;
  at: number;
};

export const OPS_PROTOCOL_VERSION = "1";
export const MAX_OPS_PAYLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export type OpsPointerCommand = "pointer.move" | "pointer.down" | "pointer.up" | "pointer.drag";

export type ParallelismModeCapsPolicy = {
  managedHeaded: number;
  managedHeadless: number;
  cdpConnectHeaded: number;
  cdpConnectHeadless: number;
  extensionOpsHeaded: number;
  extensionLegacyCdpHeaded: number;
};

export type ParallelismGovernorPolicyPayload = {
  floor: number;
  backpressureTimeoutMs: number;
  sampleIntervalMs: number;
  recoveryStableWindows: number;
  hostFreeMemMediumPct: number;
  hostFreeMemHighPct: number;
  hostFreeMemCriticalPct: number;
  rssBudgetMb: number;
  rssSoftPct: number;
  rssHighPct: number;
  rssCriticalPct: number;
  queueAgeHighMs: number;
  queueAgeCriticalMs: number;
  modeCaps: ParallelismModeCapsPolicy;
};

export type OpsErrorCode =
  | "ops_unavailable"
  | "invalid_request"
  | "invalid_session"
  | "not_owner"
  | "restricted_url"
  | "timeout"
  | "not_supported"
  | "snapshot_too_large"
  | "execution_failed"
  | "parallelism_backpressure"
  | "cdp_attach_failed"
  | "cdp_session_lost"
  | "cdp_attach_blocked";

export type OpsError = {
  code: OpsErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type OpsHello = {
  type: "ops_hello";
  version: string;
  clientId?: string;
  capabilities?: string[];
  maxPayloadBytes?: number;
};

export type OpsHelloAck = {
  type: "ops_hello_ack";
  version: string;
  clientId?: string;
  capabilities?: string[];
  maxPayloadBytes: number;
};

export type OpsPing = {
  type: "ops_ping";
  id: string;
  clientId?: string;
};

export type OpsPong = {
  type: "ops_pong";
  id: string;
  clientId?: string;
};

export type OpsRequest = {
  type: "ops_request";
  requestId: string;
  clientId?: string;
  opsSessionId?: string;
  leaseId?: string;
  command: string;
  payload?: unknown;
};

export type OpsResponse = {
  type: "ops_response";
  requestId: string;
  clientId?: string;
  opsSessionId?: string;
  payload?: unknown;
  chunked?: boolean;
  payloadId?: string;
  totalChunks?: number;
};

export type OpsErrorResponse = {
  type: "ops_error";
  requestId: string;
  clientId?: string;
  opsSessionId?: string;
  error: OpsError;
};

export type OpsEventType =
  | "ops_session_created"
  | "ops_session_released"
  | "ops_session_reclaimed"
  | "ops_session_closed"
  | "ops_session_expired"
  | "ops_tab_closed"
  | "ops_client_disconnected";

export type OpsEvent = {
  type: "ops_event";
  clientId?: string;
  opsSessionId?: string;
  event: OpsEventType;
  payload?: unknown;
};

export type OpsChunk = {
  type: "ops_chunk";
  requestId: string;
  clientId?: string;
  opsSessionId?: string;
  payloadId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
};

export type OpsEnvelope =
  | OpsHello
  | OpsHelloAck
  | OpsPing
  | OpsPong
  | OpsRequest
  | OpsResponse
  | OpsErrorResponse
  | OpsEvent
  | OpsChunk;

export const CANVAS_PROTOCOL_VERSION = "1";
export const MAX_CANVAS_PAYLOAD_BYTES = 12 * 1024 * 1024;

export type CanvasErrorCode =
  | "canvas_unavailable"
  | "invalid_request"
  | "invalid_session"
  | "not_owner"
  | "restricted_url"
  | "timeout"
  | "not_supported"
  | "execution_failed"
  | "plan_required"
  | "revision_conflict"
  | "unsupported_target"
  | "lease_reclaim_required"
  | "policy_violation"
  | "code_sync_required"
  | "code_sync_conflict"
  | "code_sync_unsupported"
  | "code_sync_out_of_date";

export type CanvasError = {
  code: CanvasErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type CanvasHello = {
  type: "canvas_hello";
  version: string;
  clientId?: string;
  capabilities?: string[];
  maxPayloadBytes?: number;
};

export type CanvasHelloAck = {
  type: "canvas_hello_ack";
  version: string;
  clientId?: string;
  capabilities?: string[];
  maxPayloadBytes: number;
};

export type CanvasPing = {
  type: "canvas_ping";
  id: string;
  clientId?: string;
};

export type CanvasPong = {
  type: "canvas_pong";
  id: string;
  clientId?: string;
};

export type CanvasRequest = {
  type: "canvas_request";
  requestId: string;
  clientId?: string;
  canvasSessionId?: string;
  leaseId?: string;
  command: string;
  payload?: unknown;
};

export type CanvasResponse = {
  type: "canvas_response";
  requestId: string;
  clientId?: string;
  canvasSessionId?: string;
  payload?: unknown;
  chunked?: boolean;
  payloadId?: string;
  totalChunks?: number;
};

export type CanvasErrorResponse = {
  type: "canvas_error";
  requestId: string;
  clientId?: string;
  canvasSessionId?: string;
  error: CanvasError;
};

export type CanvasEventType =
  | "canvas_session_created"
  | "canvas_session_closed"
  | "canvas_session_expired"
  | "canvas_target_closed"
  | "canvas_document_snapshot"
  | "canvas_document_update"
  | "canvas_presence"
  | "canvas_lease_changed"
  | "canvas_feedback_item"
  | "canvas_patch_requested"
  | "canvas_history_requested"
  | "canvas_code_sync_started"
  | "canvas_code_sync_applied"
  | "canvas_code_sync_conflict"
  | "canvas_code_sync_failed"
  | "canvas_client_disconnected";

export type CanvasSessionLifecycleEventPayload = {
  leaseId: string;
  workspaceId?: string | null;
  childId?: string | null;
  reason?: string;
};

export type CanvasSessionLifecycleEvent = {
  type: "canvas_event";
  clientId?: string;
  canvasSessionId: string;
  event: "canvas_session_closed" | "canvas_session_expired";
  payload: CanvasSessionLifecycleEventPayload;
};

export type CanvasNonLifecycleEvent = {
  type: "canvas_event";
  clientId?: string;
  canvasSessionId?: string;
  event: Exclude<CanvasEventType, CanvasSessionLifecycleEvent["event"]>;
  payload?: unknown;
};

export type CanvasEvent = CanvasSessionLifecycleEvent | CanvasNonLifecycleEvent;

export type CanvasChunk = {
  type: "canvas_chunk";
  requestId: string;
  clientId?: string;
  canvasSessionId?: string;
  payloadId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
};

export type CanvasEnvelope =
  | CanvasHello
  | CanvasHelloAck
  | CanvasPing
  | CanvasPong
  | CanvasRequest
  | CanvasResponse
  | CanvasErrorResponse
  | CanvasEvent
  | CanvasChunk;

export type RelayHealthReason =
  | "ok"
  | "relay_down"
  | "extension_disconnected"
  | "handshake_incomplete"
  | "pairing_required"
  | "pairing_invalid"
  | "cdp_disconnected"
  | "annotation_disconnected"
  | "ops_disconnected"
  | "canvas_disconnected"
  | "relay_dirty";

export type RelayHealthStatus = {
  ok: boolean;
  reason: RelayHealthReason;
  detail?: string;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;
  annotationConnected: boolean;
  opsConnected: boolean;
  opsOwnedTargetCount: number;
  canvasConnected: boolean;
  pairingRequired: boolean;
  lastHandshakeError?: RelayHandshakeError;
};

export type RelayPing = {
  type: "ping";
  id: string;
};

export type RelayPong = {
  type: "pong";
  id: string;
  payload: RelayHealthStatus;
};

export type RelayHealthCheck = {
  type: "healthCheck";
  id: string;
};

export type RelayHealthResponse = {
  type: "healthCheckResult";
  id: string;
  payload: RelayHealthStatus;
};

export type AnnotationScreenshotMode = "visible" | "full" | "none";

export type AnnotationDispatchSource =
  | "annotate_item"
  | "annotate_all"
  | "popup_item"
  | "popup_all"
  | "canvas_item"
  | "canvas_all";

export type AgentInboxDeliveryState = "queued" | "delivered" | "stored_only" | "consumed";

export type AgentInboxReceipt = {
  receiptId: string;
  deliveryState: AgentInboxDeliveryState;
  storedFallback: boolean;
  reason?: string;
  chatScopeKey?: string | null;
  createdAt: string;
  itemCount: number;
  byteLength: number;
  source: AnnotationDispatchSource;
  label: string;
};

export type AnnotationCommand = {
  version: 1;
  requestId: string;
  command: "start" | "cancel" | "fetch_stored" | "store_agent_payload";
  url?: string;
  tabId?: number;
  payload?: AnnotationPayload;
  source?: AnnotationDispatchSource;
  label?: string;
  options?: {
    screenshotMode?: AnnotationScreenshotMode;
    debug?: boolean;
    context?: string;
    includeScreenshots?: boolean;
  };
};

export type AnnotationErrorCode =
  | "invalid_request"
  | "payload_too_large"
  | "timeout"
  | "direct_unavailable"
  | "direct_failed"
  | "relay_unavailable"
  | "restricted_url"
  | "injection_failed"
  | "capture_failed"
  | "payload_unavailable"
  | "cancelled"
  | "unknown";

export type AnnotationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AnnotationSchemaVersion = 2;

export type AnnotationSelectorFamily =
  | "backendNodeId"
  | "frameId"
  | "testId"
  | "aria"
  | "css"
  | "shadowChain"
  | "xpath"
  | "text";

export type AnnotationSelectorAvailability = "available" | "unavailable";
export type AnnotationSelectorConfidence = "high" | "medium" | "low";
export type AnnotationSelectorScope = "same-session" | "frame" | "document" | "shadow" | "text";
export type AnnotationTransportProvenance = "cdp" | "extension" | "canvas" | "unknown";

export type AnnotationSelectorCandidate = {
  family: AnnotationSelectorFamily;
  rank: number;
  confidence: AnnotationSelectorConfidence;
  scope: AnnotationSelectorScope;
  transport: AnnotationTransportProvenance;
  availability: AnnotationSelectorAvailability;
  value?: string;
  unavailableReason?: string;
  recoveryHint?: string;
};

export type AnnotationSelectorBundle = {
  primary: string;
  transport: AnnotationTransportProvenance;
  candidates: AnnotationSelectorCandidate[];
  recoveryHints: string[];
};

export type AnnotationTargetIdentitySource =
  | "explicitData"
  | "canvasBinding"
  | "customElement"
  | "accessibility"
  | "selector";

export type AnnotationTargetIdentity = {
  source: AnnotationTargetIdentitySource;
  priority: number;
  stableId: string;
  label?: string;
  canvas?: {
    documentId?: string;
    pageId?: string;
    nodeId?: string;
    regionId?: string;
    bindingId?: string;
    componentName?: string;
    sourceKind?: string;
    framework?: string;
    adapter?: string;
    plugin?: string;
  };
  customElement?: {
    tag: string;
  };
};

export type AnnotationCompactRedaction = {
  removedFields: string[];
  truncatedFields: string[];
  screenshotBytesRemoved: boolean;
  originalByteLength: number;
  compactByteLength: number;
};

export type AnnotationCompactItem = {
  id: string;
  label: string;
  note?: string;
  target: {
    tag: string;
    selector: string;
    rect: AnnotationRect;
    text?: string;
    a11y?: AnnotationA11y;
  };
  identity: AnnotationTargetIdentity;
  selectorBundle: AnnotationSelectorBundle;
  redaction: AnnotationCompactRedaction;
};

export type AnnotationCompactPayload = {
  schemaVersion: AnnotationSchemaVersion;
  url: string;
  title?: string;
  timestamp: string;
  context?: string;
  screenshotMode: "none";
  byteBudget: number;
  redaction: AnnotationCompactRedaction;
  items: AnnotationCompactItem[];
};

export type AnnotationStyle = {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: string;
  lineHeight?: string;
  display?: string;
  position?: string;
};

export type AnnotationA11y = {
  role?: string;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  hidden?: boolean;
};

export type AnnotationDebug = {
  computedStyles?: Record<string, string>;
  cssVariables?: Record<string, string>;
  parentChain?: Array<{
    tag: string;
    id?: string;
    classes?: string[];
    role?: string;
  }>;
};

export type AnnotationItem = {
  id: string;
  selector: string;
  tag: string;
  idAttr?: string;
  classes?: string[];
  text?: string;
  rect: AnnotationRect;
  attributes: Record<string, string>;
  a11y: AnnotationA11y;
  styles: AnnotationStyle;
  note?: string;
  screenshotId?: string;
  debug?: AnnotationDebug;
  identity?: AnnotationTargetIdentity;
  selectorBundle?: AnnotationSelectorBundle;
};

export type AnnotationScreenshot = {
  id: string;
  label: string;
  base64: string;
  mime: "image/png";
  width?: number;
  height?: number;
};

export type AnnotationPayload = {
  schemaVersion?: AnnotationSchemaVersion;
  url: string;
  title?: string;
  timestamp: string;
  context?: string;
  screenshotMode: AnnotationScreenshotMode;
  screenshots?: AnnotationScreenshot[];
  annotations: AnnotationItem[];
  compact?: AnnotationCompactPayload;
};

export type AnnotationResponse = {
  version: 1;
  requestId: string;
  status: "ok" | "cancelled" | "error";
  error?: { code: AnnotationErrorCode; message: string };
  payload?: AnnotationPayload;
  receipt?: AgentInboxReceipt;
};

export type PopupAnnotationPayloadSource = "memory" | "storage" | "none";

export type PopupAnnotationMeta = {
  requestId: string;
  status: AnnotationResponse["status"];
  error?: AnnotationResponse["error"];
  receipt?: AgentInboxReceipt;
  source?: AnnotationDispatchSource;
  label?: string;
  url?: string;
  title?: string;
  timestamp?: string;
  annotationCount?: number;
  screenshotCount?: number;
  screenshotMode?: AnnotationScreenshotMode;
  storedAt: number;
  hasScreenshots: boolean;
  hasFullPayloadInMemory: boolean;
};

export type PopupAnnotationStartResponse = {
  type: "annotation:startResult";
  requestId: string;
  ok: boolean;
  error?: { code: AnnotationErrorCode; message: string };
};

export type PopupAnnotationLastMetaResponse = {
  type: "annotation:lastMetaResult";
  meta: PopupAnnotationMeta | null;
};

export type PopupAnnotationGetPayloadResponse = {
  type: "annotation:payloadResult";
  payload: AnnotationPayload | null;
  meta: PopupAnnotationMeta | null;
  source: PopupAnnotationPayloadSource;
  warning?: string;
};

export type PopupAnnotationSendPayloadResponse = {
  type: "annotation:sendPayloadResult";
  ok: boolean;
  meta: PopupAnnotationMeta | null;
  receipt: AgentInboxReceipt | null;
  error?: { code: AnnotationErrorCode; message: string };
};

export type PopupAnnotationProbeResponse = {
  type: "annotation:probeResult";
  injected: boolean;
  detail?: string;
};

export type PopupResponse =
  | BackgroundMessage
  | PopupAnnotationStartResponse
  | PopupAnnotationLastMetaResponse
  | PopupAnnotationGetPayloadResponse
  | PopupAnnotationSendPayloadResponse
  | PopupAnnotationProbeResponse;

export type AnnotationEvent = {
  version: 1;
  requestId: string;
  event: "progress" | "ready" | "warning";
  message?: string;
};

export type RelayAnnotationCommand = {
  type: "annotationCommand";
  payload: AnnotationCommand;
};

export type RelayAnnotationResponse = {
  type: "annotationResponse";
  payload: AnnotationResponse;
};

export type RelayAnnotationEvent = {
  type: "annotationEvent";
  payload: AnnotationEvent;
};

export type NativeTransportError =
  | "host_not_installed"
  | "host_forbidden"
  | "host_disconnect"
  | "host_timeout"
  | "host_message_too_large"
  | "unknown";

export type NativeTransportStatus = "connected" | "disconnected" | "error";

export type NativeTransportHealth = {
  status: NativeTransportStatus;
  error?: NativeTransportError;
  detail?: string;
  lastPongAt?: number;
};
