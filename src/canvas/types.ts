export const CANVAS_SCHEMA_VERSION = "1.0.0";

export type CanvasPreflightState =
  | "opened"
  | "handshake_read"
  | "plan_submitted"
  | "plan_accepted"
  | "patching_enabled";

export type CanvasPlanStatus = "missing" | "accepted";

export type CanvasSessionMode = "low-fi-wireframe" | "high-fi-live-edit" | "dual-track";

export type CanvasGovernanceBlockKey =
  | "intent"
  | "generationPlan"
  | "designLanguage"
  | "contentModel"
  | "layoutSystem"
  | "typographySystem"
  | "colorSystem"
  | "surfaceSystem"
  | "iconSystem"
  | "motionSystem"
  | "responsiveSystem"
  | "accessibilityPolicy"
  | "libraryPolicy"
  | "runtimeBudgets";

export type CanvasVariantSelector = Partial<Record<"viewport" | "theme" | "interaction" | "content", string>>;

export type CanvasNodeKind =
  | "frame"
  | "group"
  | "text"
  | "shape"
  | "note"
  | "connector"
  | "wire-block"
  | "component-instance"
  | "dom-binding";

export type CanvasFeedbackCategory =
  | "render"
  | "console"
  | "network"
  | "validation"
  | "performance"
  | "asset"
  | "export";

export type CanvasFeedbackSeverity = "info" | "warning" | "error";

export type CanvasBlockerCode =
  | "plan_required"
  | "revision_conflict"
  | "unsupported_target"
  | "lease_reclaim_required"
  | "policy_violation";

export type CanvasBlockState = "present" | "missing" | "inherited" | "locked";

export type CanvasGovernanceBlockState = {
  status: CanvasBlockState;
  source: "document" | "project-default";
  editable: boolean;
};

export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasVariantPatch = {
  selector: CanvasVariantSelector;
  changes: Record<string, unknown>;
};

export type CanvasBinding = {
  id: string;
  nodeId: string;
  kind: string;
  selector?: string;
  componentName?: string;
  metadata?: Record<string, unknown>;
};

export type CanvasAsset = {
  id: string;
  kind?: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

export type CanvasNode = {
  id: string;
  kind: CanvasNodeKind;
  name: string;
  pageId: string;
  parentId: string | null;
  childIds: string[];
  rect: CanvasRect;
  props: Record<string, unknown>;
  style: Record<string, unknown>;
  tokenRefs: Record<string, unknown>;
  bindingRefs: Record<string, unknown>;
  variantPatches: CanvasVariantPatch[];
  metadata: Record<string, unknown>;
};

export type CanvasPage = {
  id: string;
  name: string;
  description?: string;
  path: string;
  rootNodeId: string | null;
  prototypeIds: string[];
  nodes: CanvasNode[];
  metadata: Record<string, unknown>;
};

export type CanvasPrototype = {
  id: string;
  pageId: string;
  route: string;
  name?: string;
  defaultVariants?: CanvasVariantSelector;
  targetPreferences?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type CanvasDocument = {
  schemaVersion: string;
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  designGovernance: Record<CanvasGovernanceBlockKey, Record<string, unknown>>;
  pages: CanvasPage[];
  components: Array<Record<string, unknown>>;
  componentInventory: Array<Record<string, unknown>>;
  tokens: Record<string, unknown>;
  assets: CanvasAsset[];
  viewports: Array<Record<string, unknown>>;
  themes: Array<Record<string, unknown>>;
  bindings: CanvasBinding[];
  prototypes: CanvasPrototype[];
  meta: Record<string, unknown>;
};

export type CanvasGenerationPlan = Record<string, unknown>;

export type CanvasPatch =
  | {
    op: "page.create";
    page: Partial<CanvasPage> & Pick<CanvasPage, "id" | "rootNodeId">;
  }
  | {
    op: "page.update";
    pageId: string;
    changes: Record<string, unknown>;
  }
  | {
    op: "node.insert";
    pageId: string;
    parentId: string | null;
    node: Partial<CanvasNode> & Pick<CanvasNode, "id" | "kind">;
  }
  | {
    op: "node.update";
    nodeId: string;
    changes: Record<string, unknown>;
  }
  | {
    op: "node.remove";
    nodeId: string;
  }
  | {
    op: "variant.patch";
    nodeId: string;
    selector: CanvasVariantSelector;
    changes: Record<string, unknown>;
  }
  | {
    op: "token.set";
    path: string;
    value: unknown;
  }
  | {
    op: "asset.attach";
    nodeId: string;
    assetId: string;
  }
  | {
    op: "binding.set";
    nodeId: string;
    binding: Omit<CanvasBinding, "nodeId"> & Partial<Pick<CanvasBinding, "nodeId">>;
  }
  | {
    op: "prototype.upsert";
    prototype: CanvasPrototype;
  };

export type CanvasFeedbackItem = {
  id: string;
  cursor: string;
  severity: CanvasFeedbackSeverity;
  category: CanvasFeedbackCategory;
  class: string;
  documentId: string;
  pageId: string | null;
  prototypeId: string | null;
  targetId: string | null;
  documentRevision: number;
  message: string;
  evidenceRefs: string[];
  details: Record<string, unknown>;
};

export type CanvasBlocker = {
  code: CanvasBlockerCode;
  blockingCommand: string;
  requiredNextCommands: string[];
  latestRevision?: number;
  message: string;
  details?: Record<string, unknown>;
};

export type CanvasTargetState = {
  targetId: string;
  prototypeId: string | null;
  previewMode: "focused" | "pinned" | "background";
  previewState: string;
  renderStatus: "idle" | "rendered" | "degraded";
  degradeReason?: string;
  lastRenderedAt?: string;
};

export type CanvasSessionSummary = {
  canvasSessionId: string;
  browserSessionId: string | null;
  documentId: string;
  leaseId: string;
  preflightState: CanvasPreflightState;
  planStatus: CanvasPlanStatus;
  mode: CanvasSessionMode;
  documentRevision: number;
  targets: CanvasTargetState[];
  overlayMounts: Array<{ mountId: string; targetId: string; mountedAt: string }>;
  designTabTargetId?: string | null;
};

export type CanvasCommandContext = {
  command: string;
  canvasSessionId?: string;
  leaseId?: string;
};
