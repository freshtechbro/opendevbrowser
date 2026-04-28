import type {
  CanvasCodeSyncBindingMetadata,
  CanvasParityArtifact,
  CodeSyncAttachMode,
  CodeSyncBindingStatus,
  CodeSyncLeaseRole,
  CodeSyncProjectionMode,
  CodeSyncSessionStatus,
  CodeSyncState
} from "./code-sync/types";
export type { CanvasParityArtifact } from "./code-sync/types";

export const CANVAS_SCHEMA_VERSION = "1.0.0";

export type CanvasPreflightState =
  | "opened"
  | "handshake_read"
  | "plan_submitted"
  | "plan_invalid"
  | "plan_accepted"
  | "patching_enabled";

export type CanvasPlanStatus = "missing" | "submitted" | "invalid" | "accepted";

export const CANVAS_SESSION_MODES = ["low-fi-wireframe", "high-fi-live-edit", "dual-track", "document-only"] as const;

export type CanvasSessionMode = (typeof CANVAS_SESSION_MODES)[number];

export const CANVAS_GOVERNANCE_BLOCK_KEYS = [
  "intent",
  "generationPlan",
  "designLanguage",
  "contentModel",
  "layoutSystem",
  "typographySystem",
  "colorSystem",
  "surfaceSystem",
  "iconSystem",
  "motionSystem",
  "responsiveSystem",
  "accessibilityPolicy",
  "libraryPolicy",
  "runtimeBudgets"
] as const;

export type CanvasGovernanceBlockKey = (typeof CANVAS_GOVERNANCE_BLOCK_KEYS)[number];

export const CANVAS_REQUIRED_MUTATION_GOVERNANCE_KEYS = [
  "intent",
  "generationPlan",
  "designLanguage",
  "contentModel",
  "layoutSystem",
  "typographySystem",
  "motionSystem",
  "responsiveSystem",
  "accessibilityPolicy"
] as const satisfies readonly CanvasGovernanceBlockKey[];

export const CANVAS_REQUIRED_SAVE_GOVERNANCE_KEYS = [
  "intent",
  "generationPlan",
  "designLanguage",
  "contentModel",
  "layoutSystem",
  "typographySystem",
  "colorSystem",
  "surfaceSystem",
  "iconSystem",
  "motionSystem",
  "responsiveSystem",
  "accessibilityPolicy",
  "libraryPolicy",
  "runtimeBudgets"
] as const satisfies readonly CanvasGovernanceBlockKey[];

export const CANVAS_OPTIONAL_INHERITED_GOVERNANCE_KEYS = [
  "colorSystem",
  "surfaceSystem",
  "iconSystem",
  "libraryPolicy",
  "runtimeBudgets"
] as const satisfies readonly CanvasGovernanceBlockKey[];

export const CANVAS_GENERATION_PLAN_REQUIRED_FIELDS = [
  "targetOutcome",
  "visualDirection",
  "layoutStrategy",
  "contentStrategy",
  "componentStrategy",
  "motionPosture",
  "responsivePosture",
  "accessibilityPosture",
  "validationTargets"
] as const;

export type CanvasGenerationPlanField = (typeof CANVAS_GENERATION_PLAN_REQUIRED_FIELDS)[number];

export const CANVAS_VISUAL_DIRECTION_PROFILES = [
  "clean-room",
  "cinematic-minimal",
  "product-story",
  "commerce-system",
  "control-room",
  "ops-control",
  "auth-focused",
  "settings-system",
  "documentation"
] as const;

export type CanvasVisualDirectionProfile = (typeof CANVAS_VISUAL_DIRECTION_PROFILES)[number];

export const CANVAS_THEME_STRATEGIES = ["single-theme", "light-dark-parity", "multi-theme-system"] as const;

export type CanvasThemeStrategy = (typeof CANVAS_THEME_STRATEGIES)[number];

export const CANVAS_NAVIGATION_MODELS = ["global-header", "sidebar", "tabbed", "contextual", "immersive"] as const;

export type CanvasNavigationModel = (typeof CANVAS_NAVIGATION_MODELS)[number];

export const CANVAS_INTERACTION_STATES = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "empty",
  "error",
  "success",
  "selected"
] as const;

export type CanvasInteractionState = (typeof CANVAS_INTERACTION_STATES)[number];

export const CANVAS_PLAN_VIEWPORTS = ["desktop", "tablet", "mobile"] as const;

export type CanvasPlanViewport = (typeof CANVAS_PLAN_VIEWPORTS)[number];

export const CANVAS_PLAN_THEMES = ["light", "dark"] as const;

export type CanvasPlanTheme = (typeof CANVAS_PLAN_THEMES)[number];

export const CANVAS_MOTION_LEVELS = ["none", "minimal", "subtle", "expressive"] as const;

export type CanvasMotionLevel = (typeof CANVAS_MOTION_LEVELS)[number];

export const CANVAS_REDUCED_MOTION_POLICIES = ["respect-user-preference", "static-alternative"] as const;

export type CanvasReducedMotionPolicy = (typeof CANVAS_REDUCED_MOTION_POLICIES)[number];

export const CANVAS_KEYBOARD_NAVIGATION_MODES = ["full", "core-flows"] as const;

export type CanvasKeyboardNavigationMode = (typeof CANVAS_KEYBOARD_NAVIGATION_MODES)[number];

export const CANVAS_BROWSER_VALIDATION_MODES = ["required", "optional"] as const;

export type CanvasBrowserValidationMode = (typeof CANVAS_BROWSER_VALIDATION_MODES)[number];

export type CanvasVariantSelector = Partial<Record<"viewport" | "theme" | "interaction" | "content", string>>;

export type CanvasLibraryPolicy = {
  icons: string[];
  components: string[];
  styling: string[];
  motion: string[];
  threeD: string[];
};

export type CanvasIconRoles = {
  primary: string | null;
  secondary: string | null;
  secondaryAlt: string | null;
  decorative: string | null;
};

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
  | "export"
  | "import"
  | "plugin"
  | "code-sync"
  | "parity";

export type CanvasFeedbackSeverity = "info" | "warning" | "error";

export type CanvasValidationWarningCode =
  | "missing-generation-plan"
  | "invalid-generation-plan"
  | "missing-governance-block"
  | "missing-intent"
  | "missing-design-language"
  | "missing-content-model"
  | "missing-typography-system"
  | "missing-color-role"
  | "missing-surface-policy"
  | "missing-state-coverage"
  | "missing-reduced-motion-policy"
  | "missing-responsive-policy"
  | "overflow"
  | "token-missing"
  | "broken-asset-reference"
  | "contrast-failure"
  | "hierarchy-weak"
  | "asset-provenance-missing"
  | "font-policy-missing"
  | "font-load-failure"
  | "reduced-motion-violation"
  | "unresolved-component-binding"
  | "icon-policy-violation"
  | "library-policy-violation"
  | "responsive-mismatch"
  | "runtime-budget-exceeded"
  | "unsupported-target"
  | "export-warning";

export const CANVAS_VALIDATION_TARGET_BLOCK_ON_CODES = [
  "missing-generation-plan",
  "invalid-generation-plan",
  "missing-governance-block",
  "missing-intent",
  "missing-design-language",
  "missing-content-model",
  "missing-typography-system",
  "missing-color-role",
  "missing-surface-policy",
  "missing-state-coverage",
  "missing-reduced-motion-policy",
  "missing-responsive-policy",
  "overflow",
  "token-missing",
  "broken-asset-reference",
  "contrast-failure",
  "hierarchy-weak",
  "asset-provenance-missing",
  "font-policy-missing",
  "font-load-failure",
  "reduced-motion-violation",
  "unresolved-component-binding",
  "icon-policy-violation",
  "library-policy-violation",
  "responsive-mismatch",
  "runtime-budget-exceeded",
  "unsupported-target",
  "export-warning"
] as const satisfies readonly CanvasValidationWarningCode[];

export const CANVAS_PUBLIC_WARNING_CLASSES = CANVAS_VALIDATION_TARGET_BLOCK_ON_CODES;

export type CanvasPreviewState = "focused" | "pinned" | "background" | "degraded";

export type CanvasDegradeReason = "overflow" | "memory_pressure" | "queue_pressure" | "frozen" | "discarded";

export type CanvasProjectionFallbackReason =
  | "runtime_bridge_unavailable"
  | "runtime_projection_unsupported"
  | "runtime_projection_failed"
  | "runtime_instrumentation_missing"
  | "fallback_canvas_html";

export type CanvasBlockerCode =
  | "plan_required"
  | "generation_plan_invalid"
  | "revision_conflict"
  | "unsupported_target"
  | "lease_reclaim_required"
  | "policy_violation"
  | "code_sync_required"
  | "code_sync_conflict"
  | "code_sync_unsupported"
  | "code_sync_out_of_date";

export type CanvasBindingKind = string;

export type CanvasBlockState = "present" | "missing" | "invalid" | "inherited" | "locked";

export type CanvasGenerationPlanIssueCode = "missing_field" | "invalid_type" | "invalid_value";

export type CanvasGenerationPlanIssue = {
  path: string;
  code: CanvasGenerationPlanIssueCode;
  message: string;
  expected?: string | string[];
  received?: unknown;
};

export type CanvasGenerationPlanTargetOutcome = {
  mode: CanvasSessionMode;
  summary: string;
};

export type CanvasGenerationPlanVisualDirection = {
  profile: CanvasVisualDirectionProfile;
  themeStrategy: CanvasThemeStrategy;
};

export type CanvasGenerationPlanLayoutStrategy = {
  approach: string;
  navigationModel: CanvasNavigationModel;
};

export type CanvasGenerationPlanContentStrategy = {
  source: string;
};

export type CanvasGenerationPlanComponentStrategy = {
  mode: string;
  interactionStates: CanvasInteractionState[];
};

export type CanvasGenerationPlanMotionPosture = {
  level: CanvasMotionLevel;
  reducedMotion: CanvasReducedMotionPolicy;
};

export type CanvasGenerationPlanResponsivePosture = {
  primaryViewport: CanvasPlanViewport;
  requiredViewports: CanvasPlanViewport[];
};

export type CanvasGenerationPlanAccessibilityPosture = {
  target: string;
  keyboardNavigation: CanvasKeyboardNavigationMode;
};

export type CanvasGenerationPlanValidationTargets = {
  blockOn: CanvasValidationWarningCode[];
  requiredThemes: CanvasPlanTheme[];
  browserValidation: CanvasBrowserValidationMode;
  maxInteractionLatencyMs: number;
};

export type CanvasGenerationPlan = {
  targetOutcome: CanvasGenerationPlanTargetOutcome;
  visualDirection: CanvasGenerationPlanVisualDirection;
  layoutStrategy: CanvasGenerationPlanLayoutStrategy;
  contentStrategy: CanvasGenerationPlanContentStrategy;
  componentStrategy: CanvasGenerationPlanComponentStrategy;
  motionPosture: CanvasGenerationPlanMotionPosture;
  responsivePosture: CanvasGenerationPlanResponsivePosture;
  accessibilityPosture: CanvasGenerationPlanAccessibilityPosture;
  validationTargets: CanvasGenerationPlanValidationTargets;
  interactionMoments?: string[];
  materialEffects?: string[];
  designVectors?: Record<string, unknown>;
};

export type CanvasGenerationPlanValidationResult =
  | {
    ok: true;
    missing: [];
    issues: [];
    plan: CanvasGenerationPlan;
  }
  | {
    ok: false;
    missing: CanvasGenerationPlanField[];
    issues: CanvasGenerationPlanIssue[];
  };

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
  kind: CanvasBindingKind;
  selector?: string;
  componentName?: string;
  metadata?: Record<string, unknown>;
  codeSync?: CanvasCodeSyncBindingMetadata;
};

export type CanvasAsset = {
  id: string;
  sourceType?: "repo" | "remote" | "page-derived" | "generated" | "transient";
  kind?: string;
  repoPath?: string | null;
  url?: string | null;
  mime?: string;
  width?: number;
  height?: number;
  hash?: string;
  status?: string;
  variants?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

export type CanvasSourceFamily =
  | "canvas_document"
  | "framework_component"
  | "design_import"
  | "starter_template"
  | "adapter_plugin"
  | "unknown";

export type CanvasInventoryOrigin =
  | "document"
  | "code_sync"
  | "import"
  | "starter"
  | "plugin"
  | "unknown";

export type CanvasAdapterCapability =
  | "import"
  | "export"
  | "preview"
  | "code_sync"
  | "inventory"
  | "tokens"
  | "starter_templates";

export type CanvasAdapterRef = {
  id: string;
  label?: string | null;
  version?: string | null;
  packageName?: string | null;
  metadata: Record<string, unknown>;
};

export type CanvasFrameworkRef = {
  id: string;
  label?: string | null;
  packageName?: string | null;
  adapter?: CanvasAdapterRef | null;
  metadata: Record<string, unknown>;
};

export type CanvasAdapterPluginRef = {
  id: string;
  label?: string | null;
  version?: string | null;
  packageName?: string | null;
  metadata: Record<string, unknown>;
};

export type CanvasComponentVariant = {
  id: string;
  name: string;
  selector: CanvasVariantSelector;
  description?: string | null;
  metadata: Record<string, unknown>;
};

export type CanvasComponentPropDescriptor = {
  name: string;
  type?: string | null;
  required?: boolean;
  defaultValue?: unknown;
  description?: string | null;
  metadata: Record<string, unknown>;
};

export type CanvasComponentSlotDescriptor = {
  name: string;
  description?: string | null;
  allowedKinds: string[];
  metadata: Record<string, unknown>;
};

export type CanvasComponentEventDescriptor = {
  name: string;
  description?: string | null;
  payloadShape?: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type CanvasComponentContentContract = {
  acceptsText: boolean;
  acceptsRichText: boolean;
  slotNames: string[];
  metadata: Record<string, unknown>;
};

export type CanvasComponentInventoryItem = {
  id: string;
  name: string;
  componentName?: string | null;
  description?: string | null;
  sourceKind?: string | null;
  sourceFamily: CanvasSourceFamily;
  origin: CanvasInventoryOrigin;
  framework?: CanvasFrameworkRef | null;
  adapter?: CanvasAdapterRef | null;
  plugin?: CanvasAdapterPluginRef | null;
  variants: CanvasComponentVariant[];
  props: CanvasComponentPropDescriptor[];
  slots: CanvasComponentSlotDescriptor[];
  events: CanvasComponentEventDescriptor[];
  content: CanvasComponentContentContract;
  metadata: Record<string, unknown>;
};

export type CanvasTokenAlias = {
  path: string;
  targetPath: string;
  modeId?: string | null;
  metadata: Record<string, unknown>;
};

export type CanvasTokenBinding = {
  path: string;
  nodeId?: string | null;
  bindingId?: string | null;
  property?: string | null;
  metadata: Record<string, unknown>;
};

export type CanvasTokenMode = {
  id: string;
  name: string;
  value: unknown;
  metadata: Record<string, unknown>;
};

export type CanvasTokenItem = {
  id: string;
  path: string;
  value: unknown;
  type?: string | null;
  description?: string | null;
  modes: CanvasTokenMode[];
  metadata: Record<string, unknown>;
};

export type CanvasTokenCollection = {
  id: string;
  name: string;
  items: CanvasTokenItem[];
  metadata: Record<string, unknown>;
};

export type CanvasTokenStore = {
  values: Record<string, unknown>;
  collections: CanvasTokenCollection[];
  aliases: CanvasTokenAlias[];
  bindings: CanvasTokenBinding[];
  metadata: Record<string, unknown>;
};

export type CanvasDocumentImportMode =
  | "replace_current_page"
  | "append_pages"
  | "components_only";

export type CanvasImportFailureCode =
  | "missing_token"
  | "scope_denied"
  | "variables_unavailable"
  | "plan_limited"
  | "account_limited"
  | "rate_limited"
  | "node_not_found"
  | "asset_fetch_failed"
  | "framework_materializer_missing"
  | "unsupported_figma_node";

export type CanvasDocumentImportRequest = {
  sourceUrl?: string | null;
  fileKey?: string | null;
  nodeIds?: string[];
  mode?: CanvasDocumentImportMode;
  frameworkId?: string | null;
  frameworkAdapterId?: string | null;
  includeVariables?: boolean;
  depth?: number | null;
  geometryPaths?: boolean;
};

export type CanvasImportAssetReceipt = {
  assetId: string;
  sourceType?: string | null;
  repoPath?: string | null;
  url?: string | null;
  status?: string | null;
  metadata: Record<string, unknown>;
};

export type CanvasImportSource = {
  id: string;
  kind: string;
  label?: string | null;
  uri?: string | null;
  sourceDialect?: string | null;
  frameworkId?: string | null;
  pluginId?: string | null;
  adapterIds: string[];
  metadata: Record<string, unknown>;
};

export type CanvasImportProvenance = {
  id: string;
  source: CanvasImportSource;
  importedAt?: string | null;
  assetReceipts: CanvasImportAssetReceipt[];
  metadata: Record<string, unknown>;
};

export type CanvasDocumentImportResult = {
  ok: true;
  mode: CanvasDocumentImportMode;
  documentRevision: number;
  importedPageIds: string[];
  importedNodeIds: string[];
  importedInventoryItemIds: string[];
  importedAssetIds: string[];
  importedTokenCollectionIds: string[];
  degradedFailureCodes: CanvasImportFailureCode[];
  provenance: CanvasImportProvenance;
  summary: CanvasSessionSummary;
};

export type CanvasStarterTemplate = {
  id: string;
  name: string;
  description?: string | null;
  tags: string[];
  defaultFrameworkId: string;
  compatibleFrameworkIds: string[];
  kitIds: string[];
  metadata: Record<string, unknown>;
};

export type CanvasStarterApplication = {
  template: CanvasStarterTemplate | null;
  frameworkId?: string | null;
  appliedAt?: string | null;
  metadata: Record<string, unknown>;
};

export type CanvasKitStarterHook = {
  starterId: string;
  priority?: number;
  metadata: Record<string, unknown>;
};

export type CanvasKitCatalogEntry = {
  id: string;
  label: string;
  description?: string | null;
  defaultFrameworkId: string;
  compatibleFrameworkIds: string[];
  defaultLibraryAdapterIds: string[];
  pluginHints: string[];
  starterHooks: CanvasKitStarterHook[];
  tokenCollections: CanvasTokenCollection[];
  items: CanvasComponentInventoryItem[];
  metadata: Record<string, unknown>;
};

export type CanvasFrameworkCompatibility = {
  frameworkId: string;
  versions: string[];
  metadata: Record<string, unknown>;
};

export type CanvasLibraryCompatibility = {
  libraryId: string;
  categories: string[];
  metadata: Record<string, unknown>;
};

export type CanvasCapabilityGrant = {
  capability: CanvasAdapterCapability;
  granted: boolean;
  reason?: string | null;
  metadata: Record<string, unknown>;
};

export type CanvasAdapterPluginDeclaration = {
  id: string;
  label?: string | null;
  frameworks: CanvasFrameworkCompatibility[];
  libraries: CanvasLibraryCompatibility[];
  declaredCapabilities: CanvasAdapterCapability[];
  grantedCapabilities: CanvasCapabilityGrant[];
  metadata: Record<string, unknown>;
};

export type CanvasAdapterErrorEnvelope = {
  pluginId?: string | null;
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export type CanvasDocumentMeta = {
  imports: CanvasImportProvenance[];
  starter: CanvasStarterApplication | null;
  adapterPlugins: CanvasAdapterPluginDeclaration[];
  pluginErrors: CanvasAdapterErrorEnvelope[];
  metadata: Record<string, unknown>;
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

export type CanvasGovernanceRecord = Record<string, unknown>;

export type CanvasDesignGovernance = {
  intent: CanvasGovernanceRecord;
  generationPlan: CanvasGenerationPlan | CanvasGovernanceRecord;
  designLanguage: CanvasGovernanceRecord;
  contentModel: CanvasGovernanceRecord;
  layoutSystem: CanvasGovernanceRecord;
  typographySystem: CanvasGovernanceRecord;
  colorSystem: CanvasGovernanceRecord;
  surfaceSystem: CanvasGovernanceRecord;
  iconSystem: CanvasGovernanceRecord;
  motionSystem: CanvasGovernanceRecord;
  responsiveSystem: CanvasGovernanceRecord;
  accessibilityPolicy: CanvasGovernanceRecord;
  libraryPolicy: CanvasGovernanceRecord;
  runtimeBudgets: CanvasGovernanceRecord;
};

export type CanvasDocument = {
  schemaVersion: string;
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  designGovernance: CanvasDesignGovernance;
  pages: CanvasPage[];
  components: Array<Record<string, unknown>>;
  componentInventory: CanvasComponentInventoryItem[];
  tokens: CanvasTokenStore;
  assets: CanvasAsset[];
  viewports: Array<Record<string, unknown>>;
  themes: Array<Record<string, unknown>>;
  bindings: CanvasBinding[];
  prototypes: CanvasPrototype[];
  meta: CanvasDocumentMeta;
};

export type CanvasHistoryDirection = "undo" | "redo";

export type CanvasHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
  stale: boolean;
  depthLimit: number;
};

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
    op: "node.reparent";
    nodeId: string;
    parentId: string | null;
    index?: number;
  }
  | {
    op: "node.reorder";
    nodeId: string;
    index: number;
  }
  | {
    op: "node.duplicate";
    nodeId: string;
    parentId?: string | null;
    index?: number;
    idMap?: Record<string, string>;
  }
  | {
    op: "node.visibility.set";
    nodeId: string;
    hidden: boolean;
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
    op: "tokens.merge";
    tokens: Partial<CanvasTokenStore>;
  }
  | {
    op: "tokens.replace";
    tokens: CanvasTokenStore;
  }
  | {
    op: "governance.update";
    block: CanvasGovernanceBlockKey;
    changes: Record<string, unknown>;
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
    op: "binding.remove";
    bindingId: string;
  }
  | {
    op: "prototype.upsert";
    prototype: CanvasPrototype;
  }
  | {
    op: "inventory.promote";
    nodeId: string;
    itemId?: string;
    name?: string;
    description?: string | null;
    origin?: CanvasInventoryOrigin;
    metadata?: Record<string, unknown>;
  }
  | {
    op: "inventory.update";
    itemId: string;
    changes: Record<string, unknown>;
  }
  | {
    op: "inventory.upsert";
    item: CanvasComponentInventoryItem;
  }
  | {
    op: "inventory.remove";
    itemId: string;
  }
  | {
    op: "starter.apply";
    starter: CanvasStarterApplication | null;
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

export type CanvasFeedbackCompleteReason =
  | "session_closed"
  | "lease_revoked"
  | "subscription_replaced"
  | "document_unloaded";

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
    reason: CanvasFeedbackCompleteReason;
  };

export type CanvasFeedbackSubscribeResult = {
  subscriptionId: string;
  cursor: string | null;
  heartbeatMs: number;
  expiresAt: string | null;
  initialItems: CanvasFeedbackItem[];
  activeTargetIds: string[];
};

export type CanvasFeedbackUnsubscribeResult = {
  ok: true;
  subscriptionId: string;
};

export type CanvasValidationWarning = {
  code: CanvasValidationWarningCode;
  severity: CanvasFeedbackSeverity;
  message: string;
  details?: Record<string, unknown>;
  auditId?: string;
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
  previewMode: CanvasPreviewState;
  previewState: CanvasPreviewState;
  renderStatus: "idle" | "rendered" | "degraded";
  degradeReason?: CanvasDegradeReason;
  lastRenderedAt?: string;
  sourceUrl?: string | null;
  projection?: CodeSyncProjectionMode;
  fallbackReason?: CanvasProjectionFallbackReason | null;
  parityArtifact?: CanvasParityArtifact | null;
};

export type CanvasAttachedClient = {
  clientId: string;
  role: CodeSyncLeaseRole;
  attachedAt: string;
  lastSeenAt: string;
};

export type CanvasSessionSummary = {
  canvasSessionId: string;
  browserSessionId: string | null;
  documentId: string;
  leaseId: string;
  attachModes?: CodeSyncAttachMode[];
  preflightState: CanvasPreflightState;
  planStatus: CanvasPlanStatus;
  mode: CanvasSessionMode;
  documentRevision: number;
  libraryPolicy: CanvasLibraryPolicy;
  componentInventoryCount: number;
  availableInventoryCount?: number;
  catalogKitIds?: string[];
  availableStarterCount?: number;
  componentSourceKinds: string[];
  frameworkIds?: string[];
  pluginIds?: string[];
  inventoryOrigins?: CanvasInventoryOrigin[];
  declaredCapabilities?: CanvasAdapterCapability[];
  grantedCapabilities?: CanvasAdapterCapability[];
  capabilityDenials?: CanvasCapabilityGrant[];
  pluginErrors?: CanvasAdapterErrorEnvelope[];
  importSources?: string[];
  iconRoles: CanvasIconRoles;
  targets: CanvasTargetState[];
  overlayMounts: Array<{ mountId: string; targetId: string; mountedAt: string }>;
  designTabTargetId?: string | null;
  attachedClients?: CanvasAttachedClient[];
  leaseHolderClientId?: string | null;
  watchState?: CodeSyncSessionStatus["watchState"];
  codeSyncState?: CodeSyncState;
  boundFiles?: string[];
  conflictCount?: number;
  driftState?: CodeSyncSessionStatus["driftState"];
  lastImportAt?: string;
  lastPushAt?: string;
  starterId?: string | null;
  starterName?: string | null;
  starterFrameworkId?: string | null;
  starterAppliedAt?: string | null;
  bindings?: CodeSyncBindingStatus[];
  history?: CanvasHistoryState;
};

export type CanvasCommandContext = {
  command: string;
  canvasSessionId?: string;
  leaseId?: string;
};
