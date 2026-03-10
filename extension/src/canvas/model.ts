export type CanvasPreviewState = "focused" | "pinned" | "background" | "degraded";

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

export type CanvasTargetStateSummary = {
  targetId: string;
  prototypeId: string;
  previewMode: CanvasPreviewState;
  previewState: CanvasPreviewState;
  renderStatus?: string;
  degradeReason?: string | null;
  lastRenderedAt?: string;
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
  summary: Record<string, unknown>;
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
};

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
  };
