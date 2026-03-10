import { randomUUID } from "crypto";
import * as Y from "yjs";
import type {
  CanvasBinding,
  CanvasBlockState,
  CanvasDocument,
  CanvasFeedbackItem,
  CanvasGenerationPlan,
  CanvasGovernanceBlockKey,
  CanvasGovernanceBlockState,
  CanvasNode,
  CanvasPage,
  CanvasPatch,
  CanvasPrototype,
  CanvasValidationWarning,
  CanvasVariantPatch,
  CanvasVariantSelector
} from "./types";
import { CANVAS_SCHEMA_VERSION } from "./types";

const GOVERNANCE_KEYS: CanvasGovernanceBlockKey[] = [
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
];

const OPTIONAL_INHERITED_KEYS = new Set<CanvasGovernanceBlockKey>([
  "colorSystem",
  "surfaceSystem",
  "iconSystem",
  "libraryPolicy",
  "runtimeBudgets"
]);

const REQUIRED_BEFORE_SAVE_KEYS: CanvasGovernanceBlockKey[] = [
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
];

const REQUIRED_PLAN_FIELDS = [
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

const PROJECT_DEFAULT_LIBRARY_POLICY = {
  icons: ["3dicons", "tabler", "microsoft-fluent-ui-system-icons", "@lobehub/fluent-emoji-3d"],
  components: [],
  motion: [],
  threeD: []
};

const PROJECT_DEFAULT_RUNTIME_BUDGETS = {
  defaultLivePreviewLimit: 2,
  maxPinnedFullPreviewExtra: 1,
  reconnectGraceMs: 20_000,
  overflowRenderMode: "thumbnail_only",
  backgroundTelemetryMode: "sampled"
};

function inheritedDefaultForGovernanceKey(key: CanvasGovernanceBlockKey): Record<string, unknown> | null {
  switch (key) {
    case "libraryPolicy":
      return PROJECT_DEFAULT_LIBRARY_POLICY;
    case "runtimeBudgets":
      return PROJECT_DEFAULT_RUNTIME_BUDGETS;
    default:
      return null;
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const stableStringify = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(",")}}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyRecord = (value: unknown): value is Record<string, unknown> => isRecord(value) && Object.keys(value).length > 0;

const nowIso = (): string => new Date().toISOString();

function normalizeGovernance(document: CanvasDocument["designGovernance"]): CanvasDocument["designGovernance"] {
  const next = {} as CanvasDocument["designGovernance"];
  for (const key of GOVERNANCE_KEYS) {
    const value = document[key];
    next[key] = isRecord(value) ? clone(value) : {};
  }
  if (!isNonEmptyRecord(next.libraryPolicy)) {
    next.libraryPolicy = clone(PROJECT_DEFAULT_LIBRARY_POLICY);
  }
  if (!isNonEmptyRecord(next.runtimeBudgets)) {
    next.runtimeBudgets = clone(PROJECT_DEFAULT_RUNTIME_BUDGETS);
  }
  return next;
}

function createDefaultNode(pageId: string, nodeId: string, name: string): CanvasNode {
  return {
    id: nodeId,
    kind: "frame",
    name,
    pageId,
    parentId: null,
    childIds: [],
    rect: { x: 0, y: 0, width: 1440, height: 960 },
    props: {},
    style: {},
    tokenRefs: {},
    bindingRefs: {},
    variantPatches: [],
    metadata: {}
  };
}

export function createDefaultCanvasDocument(documentId = `dc_${randomUUID()}`): CanvasDocument {
  const createdAt = nowIso();
  const rootNodeId = `node_root_${documentId.slice(-8)}`;
  const pageId = "page_home";
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    documentId,
    title: "Untitled Design Canvas",
    createdAt,
    updatedAt: createdAt,
    designGovernance: normalizeGovernance({} as CanvasDocument["designGovernance"]),
    pages: [{
      id: pageId,
      name: "Home",
      path: "/",
      rootNodeId,
      prototypeIds: ["proto_home_default"],
      nodes: [createDefaultNode(pageId, rootNodeId, "Home Root")],
      metadata: {}
    }],
    components: [],
    componentInventory: [],
    tokens: {},
    assets: [],
    viewports: [
      { id: "desktop", width: 1440 },
      { id: "tablet", width: 1024 },
      { id: "mobile", width: 390 }
    ],
    themes: [{ id: "light" }],
    bindings: [],
    prototypes: [{
      id: "proto_home_default",
      pageId,
      route: "/",
      name: "Home Default",
      defaultVariants: { viewport: "desktop", theme: "light" },
      metadata: {}
    }],
    meta: {}
  };
}

export function normalizeCanvasDocument(input: CanvasDocument): CanvasDocument {
  const base = clone(input);
  const createdAt = typeof base.createdAt === "string" ? base.createdAt : nowIso();
  const updatedAt = typeof base.updatedAt === "string" ? base.updatedAt : createdAt;
  return {
    schemaVersion: typeof base.schemaVersion === "string" ? base.schemaVersion : CANVAS_SCHEMA_VERSION,
    documentId: typeof base.documentId === "string" ? base.documentId : `dc_${randomUUID()}`,
    title: typeof base.title === "string" && base.title.trim() ? base.title : "Untitled Design Canvas",
    createdAt,
    updatedAt,
    designGovernance: normalizeGovernance(base.designGovernance ?? ({} as CanvasDocument["designGovernance"])),
    pages: Array.isArray(base.pages) ? base.pages.map((page) => ({
      id: page.id,
      name: page.name || page.id,
      description: page.description,
      path: page.path || "/",
      rootNodeId: page.rootNodeId ?? null,
      prototypeIds: Array.isArray(page.prototypeIds) ? [...page.prototypeIds] : [],
      nodes: Array.isArray(page.nodes) ? page.nodes.map((node) => ({
        ...node,
        name: node.name || node.id,
        childIds: Array.isArray(node.childIds) ? [...node.childIds] : [],
        rect: node.rect ?? { x: 0, y: 0, width: 320, height: 180 },
        props: isRecord(node.props) ? clone(node.props) : {},
        style: isRecord(node.style) ? clone(node.style) : {},
        tokenRefs: isRecord(node.tokenRefs) ? clone(node.tokenRefs) : {},
        bindingRefs: isRecord(node.bindingRefs) ? clone(node.bindingRefs) : {},
        variantPatches: Array.isArray(node.variantPatches) ? node.variantPatches.map((patch) => ({
          selector: isRecord(patch.selector) ? clone(patch.selector as CanvasVariantSelector) : {},
          changes: isRecord(patch.changes) ? clone(patch.changes) : {}
        })) : [],
        metadata: isRecord(node.metadata) ? clone(node.metadata) : {}
      })) : [],
      metadata: isRecord(page.metadata) ? clone(page.metadata) : {}
    })) : [],
    components: Array.isArray(base.components) ? clone(base.components) : [],
    componentInventory: Array.isArray(base.componentInventory) ? clone(base.componentInventory) : [],
    tokens: isRecord(base.tokens) ? clone(base.tokens) : {},
    assets: Array.isArray(base.assets) ? base.assets.map((asset) => ({
      id: typeof asset.id === "string" ? asset.id : `asset_${randomUUID()}`,
      sourceType: typeof asset.sourceType === "string" ? asset.sourceType : undefined,
      kind: typeof asset.kind === "string" ? asset.kind : undefined,
      repoPath: typeof asset.repoPath === "string" ? asset.repoPath : null,
      url: typeof asset.url === "string" ? asset.url : null,
      mime: typeof asset.mime === "string" ? asset.mime : undefined,
      width: typeof asset.width === "number" ? asset.width : undefined,
      height: typeof asset.height === "number" ? asset.height : undefined,
      hash: typeof asset.hash === "string" ? asset.hash : undefined,
      status: typeof asset.status === "string" ? asset.status : undefined,
      variants: Array.isArray(asset.variants) ? clone(asset.variants) : [],
      metadata: isRecord(asset.metadata) ? clone(asset.metadata) : {}
    })) : [],
    viewports: Array.isArray(base.viewports) ? clone(base.viewports) : [],
    themes: Array.isArray(base.themes) ? clone(base.themes) : [],
    bindings: Array.isArray(base.bindings) ? clone(base.bindings) : [],
    prototypes: Array.isArray(base.prototypes) ? clone(base.prototypes) : [],
    meta: isRecord(base.meta) ? clone(base.meta) : {}
  };
}

export function validateGenerationPlan(plan: unknown): { ok: true } | { ok: false; missing: string[] } {
  if (!isRecord(plan)) {
    return { ok: false, missing: [...REQUIRED_PLAN_FIELDS] };
  }
  const missing = REQUIRED_PLAN_FIELDS.filter((field) => !isNonEmptyRecord(plan[field]));
  return missing.length === 0 ? { ok: true } : { ok: false, missing: [...missing] };
}

export function buildGovernanceBlockStates(document: CanvasDocument): Record<CanvasGovernanceBlockKey, CanvasGovernanceBlockState> {
  const states = {} as Record<CanvasGovernanceBlockKey, CanvasGovernanceBlockState>;
  for (const key of GOVERNANCE_KEYS) {
    const block = document.designGovernance[key];
    let status: CanvasBlockState = "missing";
    let source: "document" | "project-default" = "document";
    if (isNonEmptyRecord(block)) {
      const inheritedDefault = OPTIONAL_INHERITED_KEYS.has(key) ? inheritedDefaultForGovernanceKey(key) : null;
      status = inheritedDefault && stableStringify(block) === stableStringify(inheritedDefault)
        ? "inherited"
        : "present";
      if (status === "inherited") {
        source = "project-default";
      }
    } else if (OPTIONAL_INHERITED_KEYS.has(key)) {
      status = "inherited";
      source = "project-default";
    }
    states[key] = { status, source, editable: true };
  }
  return states;
}

export function buildDocumentContext(document: CanvasDocument): {
  status: "existing";
  existingGovernanceBlocks: CanvasGovernanceBlockKey[];
  missingGovernanceBlocks: CanvasGovernanceBlockKey[];
  tokensPresent: boolean;
  themesPresent: boolean;
  viewportsPresent: boolean;
  componentInventoryPresent: boolean;
} {
  const states = buildGovernanceBlockStates(document);
  const existingGovernanceBlocks = GOVERNANCE_KEYS.filter((key) => states[key].status !== "missing");
  const missingGovernanceBlocks = GOVERNANCE_KEYS.filter((key) => states[key].status === "missing");
  return {
    status: "existing",
    existingGovernanceBlocks,
    missingGovernanceBlocks,
    tokensPresent: Object.keys(document.tokens).length > 0,
    themesPresent: document.themes.length > 0,
    viewportsPresent: document.viewports.length > 0,
    componentInventoryPresent: document.componentInventory.length > 0
  };
}

const buildWarning = (
  code: CanvasValidationWarning["code"],
  message: string,
  options: {
    severity?: CanvasValidationWarning["severity"];
    details?: Record<string, unknown>;
    auditId?: string;
  } = {}
): CanvasValidationWarning => ({
  code,
  severity: options.severity ?? "warning",
  message,
  details: options.details,
  auditId: options.auditId
});

export function evaluateCanvasWarnings(
  document: CanvasDocument,
  options: {
    forSave?: boolean;
    degradeReason?: string | null;
    unsupportedTarget?: string | null;
  } = {}
): CanvasValidationWarning[] {
  const warnings: CanvasValidationWarning[] = [];
  const states = buildGovernanceBlockStates(document);
  const generationPlan = getGovernanceBlock(document, "generationPlan");
  const typographySystem = getGovernanceBlock(document, "typographySystem");
  if (!isNonEmptyRecord(generationPlan)) {
    warnings.push(buildWarning("missing-generation-plan", "generationPlan is required before mutation or save.", { auditId: "CANVAS-03" }));
  }
  if (states.intent.status === "missing") {
    warnings.push(buildWarning("missing-intent", "designGovernance.intent is missing.", { auditId: "CANVAS-02" }));
  }
  if (states.designLanguage.status === "missing") {
    warnings.push(buildWarning("missing-design-language", "designGovernance.designLanguage is missing.", { auditId: "CANVAS-02" }));
  }
  if (states.contentModel.status === "missing") {
    warnings.push(buildWarning("missing-content-model", "designGovernance.contentModel is missing.", { auditId: "CANVAS-02" }));
  }
  if (states.typographySystem.status === "missing") {
    warnings.push(buildWarning("missing-typography-system", "designGovernance.typographySystem is missing.", { auditId: "CANVAS-02" }));
  }
  if (states.colorSystem.status === "missing") {
    warnings.push(buildWarning("missing-color-role", "designGovernance.colorSystem is missing.", { auditId: "CANVAS-02" }));
  }
  if (states.surfaceSystem.status === "missing") {
    warnings.push(buildWarning("missing-surface-policy", "designGovernance.surfaceSystem is missing.", { auditId: "CANVAS-02" }));
  }
  if (states.responsiveSystem.status === "missing") {
    warnings.push(buildWarning("missing-responsive-policy", "designGovernance.responsiveSystem is missing.", { auditId: "CANVAS-02" }));
  }
  if (!hasTypographyHierarchy(document)) {
    warnings.push(buildWarning("hierarchy-weak", "Typography hierarchy is missing from the governance model.", { auditId: "CANVAS-02" }));
  }
  if (!hasTypographyFontPolicy(typographySystem)) {
    warnings.push(buildWarning("font-policy-missing", "Typography font policy is missing from the governance model.", { auditId: "CANVAS-02" }));
  }
  if (!hasReducedMotionPolicy(document)) {
    warnings.push(buildWarning("missing-reduced-motion-policy", "Reduced-motion policy is missing from the governance model.", { auditId: "CANVAS-02" }));
  }
  if (!hasRequiredStateCoverage(document)) {
    warnings.push(buildWarning("missing-state-coverage", "Variant state coverage is incomplete for the required viewport/theme/content model.", { auditId: "CANVAS-02" }));
  }
  if (!hasResponsiveViewportCoverage(document)) {
    warnings.push(buildWarning("responsive-mismatch", "Viewport coverage is incomplete for desktop, tablet, and mobile previews.", { auditId: "CANVAS-02" }));
  }
  if (hasDisallowedLibrary(document)) {
    warnings.push(buildWarning("library-policy-violation", "Library policy references a non-approved canvas library.", { auditId: "CANVAS-04", severity: "error" }));
  }
  if (hasIconPolicyViolation(document)) {
    warnings.push(buildWarning("icon-policy-violation", "Icon policy references a non-approved icon family.", { auditId: "CANVAS-04", severity: "error" }));
  }
  if (hasUnresolvedComponentBindings(document)) {
    warnings.push(buildWarning("unresolved-component-binding", "One or more nodes reference bindings that are missing from the document.", {
      auditId: "CANVAS-02",
      severity: "error"
    }));
  }
  if (hasMissingTokenRefs(document)) {
    warnings.push(buildWarning("token-missing", "One or more nodes reference missing tokens.", {
      auditId: "CANVAS-02",
      severity: "error"
    }));
  }
  for (const asset of document.assets) {
    if (hasBrokenAssetReference(asset)) {
      warnings.push(buildWarning("broken-asset-reference", `Asset ${asset.id} is missing the required repoPath or URL reference.`, {
        auditId: "CANVAS-02",
        severity: "error",
        details: { assetId: asset.id, sourceType: asset.sourceType ?? null }
      }));
    }
    if (assetRequiresProvenance(asset) && !isNonEmptyRecord(asset.metadata?.provenance)) {
      warnings.push(buildWarning("asset-provenance-missing", `Asset ${asset.id} is missing provenance metadata.`, {
        auditId: "CANVAS-02",
        details: { assetId: asset.id, sourceType: asset.sourceType ?? null }
      }));
    }
  }
  if (options.degradeReason) {
    warnings.push(buildWarning("runtime-budget-exceeded", "Canvas preview exceeded the configured live-preview budget.", {
      auditId: "CANVAS-06",
      details: { degradeReason: options.degradeReason }
    }));
  }
  if (options.unsupportedTarget) {
    warnings.push(buildWarning("unsupported-target", `Canvas preview target is unavailable: ${options.unsupportedTarget}.`, {
      auditId: "CANVAS-05",
      severity: "error",
      details: { targetId: options.unsupportedTarget }
    }));
  }
  if (options.forSave) {
    for (const key of missingRequiredSaveBlocks(document)) {
      warnings.push(buildWarning(warningCodeForGovernanceBlock(key), `Required save governance block ${key} is missing.`, {
        auditId: "CANVAS-02",
        details: { block: key },
        severity: "error"
      }));
    }
  }
  return dedupeWarnings(warnings);
}

export function missingRequiredSaveBlocks(document: CanvasDocument): CanvasGovernanceBlockKey[] {
  const states = buildGovernanceBlockStates(document);
  return REQUIRED_BEFORE_SAVE_KEYS.filter((key) => states[key].status === "missing");
}

export function validateCanvasSave(document: CanvasDocument): {
  missingBlocks: CanvasGovernanceBlockKey[];
  warnings: CanvasValidationWarning[];
} {
  const missingBlocks = missingRequiredSaveBlocks(document);
  return {
    missingBlocks,
    warnings: evaluateCanvasWarnings(document, { forSave: true })
  };
}

function dedupeWarnings(warnings: CanvasValidationWarning[]): CanvasValidationWarning[] {
  const seen = new Set<string>();
  const deduped: CanvasValidationWarning[] = [];
  for (const warning of warnings) {
    const key = stableStringify([warning.code, warning.message, warning.details ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(warning);
  }
  return deduped;
}

function hasRequiredStateCoverage(document: CanvasDocument): boolean {
  const viewportIds = new Set(document.viewports.map((viewport) => typeof viewport.id === "string" ? viewport.id : ""));
  const themeIds = new Set(document.themes.map((theme) => typeof theme.id === "string" ? theme.id : ""));
  const contentModel = getGovernanceBlock(document, "contentModel");
  const requiredContentStates = new Set(readStringArray(contentModel, "requiredStates"));
  return viewportIds.has("desktop")
    && viewportIds.has("tablet")
    && viewportIds.has("mobile")
    && themeIds.has("light")
    && requiredContentStates.has("default")
    && requiredContentStates.has("loading")
    && requiredContentStates.has("empty")
    && requiredContentStates.has("error");
}

function hasReducedMotionPolicy(document: CanvasDocument): boolean {
  const motionSystem = getGovernanceBlock(document, "motionSystem");
  const accessibilityPolicy = getGovernanceBlock(document, "accessibilityPolicy");
  return Boolean(readString(motionSystem, "reducedMotion") ?? readString(accessibilityPolicy, "reducedMotion"));
}

function hasDisallowedLibrary(document: CanvasDocument): boolean {
  const policy = getGovernanceBlock(document, "libraryPolicy");
  const iconLibraries = readStringArray(policy, "icons");
  const componentLibraries = readStringArray(policy, "components");
  const disallowedIcons = iconLibraries.some((entry) => entry === "lucide-react");
  const disallowedComponents = componentLibraries.some((entry) => entry.startsWith("unknown:"));
  return disallowedIcons || disallowedComponents;
}

function hasIconPolicyViolation(document: CanvasDocument): boolean {
  const iconPolicy = getGovernanceBlock(document, "iconSystem");
  const approved = new Set(PROJECT_DEFAULT_LIBRARY_POLICY.icons);
  const families = [
    readString(iconPolicy, "primary"),
    readString(iconPolicy, "secondary"),
    readString(iconPolicy, "secondaryAlt"),
    readString(iconPolicy, "decorative")
  ].filter((entry): entry is string => Boolean(entry));
  return families.some((entry) => !approved.has(entry));
}

function assetRequiresProvenance(asset: CanvasDocument["assets"][number]): boolean {
  return asset.sourceType === "remote" || asset.sourceType === "generated" || asset.sourceType === "page-derived";
}

function getGovernanceBlock(document: CanvasDocument, key: CanvasGovernanceBlockKey): Record<string, unknown> {
  const block = document.designGovernance[key];
  return isRecord(block) ? block : {};
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function warningCodeForGovernanceBlock(key: CanvasGovernanceBlockKey): CanvasValidationWarning["code"] {
  switch (key) {
    case "generationPlan":
      return "missing-generation-plan";
    case "intent":
      return "missing-intent";
    case "designLanguage":
      return "missing-design-language";
    case "contentModel":
      return "missing-content-model";
    case "typographySystem":
      return "missing-typography-system";
    case "colorSystem":
      return "missing-color-role";
    case "surfaceSystem":
      return "missing-surface-policy";
    case "responsiveSystem":
      return "missing-responsive-policy";
    default:
      return "missing-governance-block";
  }
}

function hasTypographyHierarchy(document: CanvasDocument): boolean {
  const typographySystem = getGovernanceBlock(document, "typographySystem");
  return isNonEmptyRecord(getNestedRecord(typographySystem, "hierarchy"));
}

function hasTypographyFontPolicy(typographySystem: Record<string, unknown>): boolean {
  return isNonEmptyRecord(getNestedRecord(typographySystem, "fontPolicy"))
    || readString(typographySystem, "fontPolicy") !== null;
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function hasResponsiveViewportCoverage(document: CanvasDocument): boolean {
  const viewportIds = new Set(document.viewports.map((viewport) => typeof viewport.id === "string" ? viewport.id : ""));
  return viewportIds.has("desktop") && viewportIds.has("tablet") && viewportIds.has("mobile");
}

function hasUnresolvedComponentBindings(document: CanvasDocument): boolean {
  const bindingIds = new Set(document.bindings.map((binding) => binding.id));
  for (const page of document.pages) {
    for (const node of page.nodes) {
      const primaryBinding = typeof node.bindingRefs.primary === "string" ? node.bindingRefs.primary : null;
      if (primaryBinding && !bindingIds.has(primaryBinding)) {
        return true;
      }
    }
  }
  return false;
}

function hasMissingTokenRefs(document: CanvasDocument): boolean {
  for (const page of document.pages) {
    for (const node of page.nodes) {
      for (const value of Object.values(node.tokenRefs)) {
        if (typeof value === "string" && getTokenValue(document.tokens, value) === undefined) {
          return true;
        }
      }
    }
  }
  return false;
}

function getTokenValue(tokens: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = tokens;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function hasBrokenAssetReference(asset: CanvasDocument["assets"][number]): boolean {
  if (asset.sourceType === "repo") {
    return typeof asset.repoPath !== "string" || asset.repoPath.trim().length === 0;
  }
  if (asset.sourceType === "remote" || asset.sourceType === "page-derived") {
    return typeof asset.url !== "string" || asset.url.trim().length === 0;
  }
  return false;
}

function validatePath(path: string): string[] {
  const segments = path.split(".");
  if (segments.length === 0 || segments.some((segment) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(segment))) {
    throw new Error(`Invalid path: ${path}`);
  }
  return segments;
}

function assertNoOverlappingPaths(changes: Record<string, unknown>): void {
  const paths = Object.keys(changes);
  for (const path of paths) {
    validatePath(path);
  }
  for (let index = 0; index < paths.length; index += 1) {
    const left = paths[index];
    for (let inner = index + 1; inner < paths.length; inner += 1) {
      const right = paths[inner];
      /* v8 ignore next -- validatePath guarantees non-empty keys */
      if (!left || !right) continue;
      if (left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`)) {
        throw new Error(`Overlapping change paths: ${left} vs ${right}`);
      }
    }
  }
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = validatePath(path);
  let current: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    /* v8 ignore next -- validatePath guarantees non-empty segments */
    if (!segment) {
      throw new Error(`Invalid path segment in ${path}`);
    }
    const existing = current[segment];
    if (!isRecord(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1] as string] = clone(value);
}

function ensureAllowedRoots(changes: Record<string, unknown>, allowedRoots: string[]): void {
  for (const key of Object.keys(changes)) {
    if (!allowedRoots.some((root) => key === root || key.startsWith(`${root}.`))) {
      throw new Error(`Policy violation for change root: ${key}`);
    }
  }
}

function upsertVariantPatch(list: CanvasVariantPatch[], selector: CanvasVariantSelector, changes: Record<string, unknown>): CanvasVariantPatch[] {
  const key = stableStringify(selector);
  const next = list.map((entry) => clone(entry));
  const existing = next.find((entry) => stableStringify(entry.selector) === key);
  if (existing) {
    assertNoOverlappingPaths(changes);
    for (const [path, value] of Object.entries(changes)) {
      setNestedValue(existing.changes, path, value);
    }
    return next;
  }
  return [...next, { selector: clone(selector), changes: clone(changes) }];
}

type PatchResult = {
  transactionId: string;
  appliedRevision: number;
  warnings: CanvasValidationWarning[];
  evidenceRefs: string[];
};

export type CanvasDocumentStoreUpdate = {
  documentId: string;
  revision: number;
  encodedState: string;
  origin: unknown;
};

type CanvasDocumentStoreListener = (update: CanvasDocumentStoreUpdate) => void;

const Y_ROOT_KEYS = [
  "schemaVersion",
  "documentId",
  "title",
  "createdAt",
  "updatedAt",
  "designGovernance",
  "pages",
  "components",
  "componentInventory",
  "tokens",
  "assets",
  "viewports",
  "themes",
  "bindings",
  "prototypes",
  "meta",
  "revision"
] as const;

type YRootKey = typeof Y_ROOT_KEYS[number];

function clearYMap(map: Y.Map<unknown>): void {
  if (!map.doc) {
    return;
  }
  for (const key of Array.from(map.keys())) {
    map.delete(key);
  }
}

function clearYArray(array: Y.Array<unknown>): void {
  if (!array.doc) {
    return;
  }
  if (array.length > 0) {
    array.delete(0, array.length);
  }
}

function toYValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    array.insert(0, value.map((entry) => toYValue(entry)));
    return array;
  }
  if (isRecord(value)) {
    const map = new Y.Map<unknown>();
    for (const [key, entry] of Object.entries(value)) {
      map.set(key, toYValue(entry));
    }
    return map;
  }
  return value ?? null;
}

function fromYValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const record: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      record[key] = fromYValue(entry);
    }
    return record;
  }
  if (value instanceof Y.Array) {
    return value.toArray().map((entry) => fromYValue(entry));
  }
  return value ?? null;
}

function setYMapContents(target: Y.Map<unknown>, value: Record<string, unknown>): void {
  clearYMap(target);
  for (const [key, entry] of Object.entries(value)) {
    target.set(key, toYValue(entry));
  }
}

function setYArrayContents(target: Y.Array<unknown>, value: unknown[]): void {
  clearYArray(target);
  if (value.length > 0) {
    target.insert(0, value.map((entry) => toYValue(entry)));
  }
}

function projectRootValue(root: Y.Map<unknown>, key: YRootKey): unknown {
  return fromYValue(root.get(key));
}

function encodeYState(ydoc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString("base64");
}

export class CanvasDocumentStore {
  private readonly ydoc = new Y.Doc();
  private readonly root = this.ydoc.getMap<unknown>("canvas");
  private readonly listeners = new Set<CanvasDocumentStoreListener>();
  private document: CanvasDocument;
  private revision = 1;

  constructor(document?: CanvasDocument) {
    this.document = normalizeCanvasDocument(document ?? createDefaultCanvasDocument());
    this.ydoc.on("update", this.handleYUpdate);
    this.replaceDocument(this.document, 1, "canvas.store.init");
  }

  observe(listener: CanvasDocumentStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getDocument(): CanvasDocument {
    return clone(this.document);
  }

  getDocumentId(): string {
    return this.document.documentId;
  }

  getRevision(): number {
    return this.revision;
  }

  getEncodedState(): string {
    return encodeYState(this.ydoc);
  }

  applyEncodedState(encodedState: string): void {
    const update = Buffer.from(encodedState, "base64");
    const snapshot = new Y.Doc();
    Y.applyUpdate(snapshot, update, "canvas.store.remote-update");
    const root = snapshot.getMap<unknown>("canvas");
    const revision = typeof root.get("revision") === "number" ? root.get("revision") as number : this.revision;
    const document = normalizeCanvasDocument({
      schemaVersion: projectRootValue(root, "schemaVersion"),
      documentId: projectRootValue(root, "documentId"),
      title: projectRootValue(root, "title"),
      createdAt: projectRootValue(root, "createdAt"),
      updatedAt: projectRootValue(root, "updatedAt"),
      designGovernance: projectRootValue(root, "designGovernance"),
      pages: projectRootValue(root, "pages"),
      components: projectRootValue(root, "components"),
      componentInventory: projectRootValue(root, "componentInventory"),
      tokens: projectRootValue(root, "tokens"),
      assets: projectRootValue(root, "assets"),
      viewports: projectRootValue(root, "viewports"),
      themes: projectRootValue(root, "themes"),
      bindings: projectRootValue(root, "bindings"),
      prototypes: projectRootValue(root, "prototypes"),
      meta: projectRootValue(root, "meta")
    } as CanvasDocument);
    this.replaceDocument(document, revision, "canvas.store.remote-update");
  }

  setGenerationPlan(plan: CanvasGenerationPlan): { planStatus: "accepted"; documentRevision: number; warnings: CanvasValidationWarning[] } {
    const validation = validateGenerationPlan(plan);
    if (!validation.ok) {
      throw new Error(`Generation plan missing fields: ${validation.missing.join(", ")}`);
    }
    const nextDocument = normalizeCanvasDocument(this.document);
    nextDocument.designGovernance.generationPlan = clone(plan);
    this.replaceDocument(nextDocument, this.revision + 1, "canvas.store.set-generation-plan");
    return {
      planStatus: "accepted",
      documentRevision: this.revision,
      warnings: evaluateCanvasWarnings(this.document)
    };
  }

  applyPatches(baseRevision: number, patches: CanvasPatch[]): PatchResult {
    if (baseRevision !== this.revision) {
      throw new Error(`Revision conflict: expected ${this.revision}, got ${baseRevision}`);
    }
    const nextDocument = normalizeCanvasDocument(this.document);
    for (const patch of patches) {
      this.applyPatch(nextDocument, patch);
    }
    this.replaceDocument(nextDocument, this.revision + 1, "canvas.store.apply-patches");
    return {
      transactionId: `txn_${randomUUID()}`,
      appliedRevision: this.revision,
      warnings: evaluateCanvasWarnings(this.document),
      evidenceRefs: []
    };
  }

  loadDocument(document: CanvasDocument): void {
    this.replaceDocument(normalizeCanvasDocument(document), 1, "canvas.store.load-document");
  }

  private readonly handleYUpdate = (_update: Uint8Array, origin: unknown): void => {
    this.refreshProjectionFromY();
    const detail: CanvasDocumentStoreUpdate = {
      documentId: this.document.documentId,
      revision: this.revision,
      encodedState: encodeYState(this.ydoc),
      origin
    };
    for (const listener of this.listeners) {
      listener(detail);
    }
  };

  private refreshProjectionFromY(): void {
    const projected = normalizeCanvasDocument({
      schemaVersion: projectRootValue(this.root, "schemaVersion"),
      documentId: projectRootValue(this.root, "documentId"),
      title: projectRootValue(this.root, "title"),
      createdAt: projectRootValue(this.root, "createdAt"),
      updatedAt: projectRootValue(this.root, "updatedAt"),
      designGovernance: projectRootValue(this.root, "designGovernance"),
      pages: projectRootValue(this.root, "pages"),
      components: projectRootValue(this.root, "components"),
      componentInventory: projectRootValue(this.root, "componentInventory"),
      tokens: projectRootValue(this.root, "tokens"),
      assets: projectRootValue(this.root, "assets"),
      viewports: projectRootValue(this.root, "viewports"),
      themes: projectRootValue(this.root, "themes"),
      bindings: projectRootValue(this.root, "bindings"),
      prototypes: projectRootValue(this.root, "prototypes"),
      meta: projectRootValue(this.root, "meta")
    } as CanvasDocument);
    this.document = projected;
    this.revision = typeof this.root.get("revision") === "number" ? this.root.get("revision") as number : this.revision;
  }

  private replaceDocument(document: CanvasDocument, revision: number, origin: string): void {
    const nextDocument = normalizeCanvasDocument(document);
    nextDocument.updatedAt = nowIso();
    this.ydoc.transact(() => {
      clearYMap(this.root);
      this.root.set("schemaVersion", nextDocument.schemaVersion);
      this.root.set("documentId", nextDocument.documentId);
      this.root.set("title", nextDocument.title);
      this.root.set("createdAt", nextDocument.createdAt);
      this.root.set("updatedAt", nextDocument.updatedAt);
      const governance = new Y.Map<unknown>();
      setYMapContents(governance, nextDocument.designGovernance);
      this.root.set("designGovernance", governance);
      const pages = new Y.Array<unknown>();
      setYArrayContents(pages, nextDocument.pages);
      this.root.set("pages", pages);
      const components = new Y.Array<unknown>();
      setYArrayContents(components, nextDocument.components);
      this.root.set("components", components);
      const componentInventory = new Y.Array<unknown>();
      setYArrayContents(componentInventory, nextDocument.componentInventory);
      this.root.set("componentInventory", componentInventory);
      const tokens = new Y.Map<unknown>();
      setYMapContents(tokens, nextDocument.tokens);
      this.root.set("tokens", tokens);
      const assets = new Y.Array<unknown>();
      setYArrayContents(assets, nextDocument.assets);
      this.root.set("assets", assets);
      const viewports = new Y.Array<unknown>();
      setYArrayContents(viewports, nextDocument.viewports);
      this.root.set("viewports", viewports);
      const themes = new Y.Array<unknown>();
      setYArrayContents(themes, nextDocument.themes);
      this.root.set("themes", themes);
      const bindings = new Y.Array<unknown>();
      setYArrayContents(bindings, nextDocument.bindings);
      this.root.set("bindings", bindings);
      const prototypes = new Y.Array<unknown>();
      setYArrayContents(prototypes, nextDocument.prototypes);
      this.root.set("prototypes", prototypes);
      const meta = new Y.Map<unknown>();
      setYMapContents(meta, nextDocument.meta);
      this.root.set("meta", meta);
      this.root.set("revision", revision);
    }, origin);
    this.document = nextDocument;
    this.revision = revision;
  }

  private applyPatch(document: CanvasDocument, patch: CanvasPatch): void {
    switch (patch.op) {
      case "page.create": {
        if (document.pages.some((page) => page.id === patch.page.id)) {
          throw new Error(`Page already exists: ${patch.page.id}`);
        }
        document.pages.push({
          id: patch.page.id,
          name: patch.page.name ?? patch.page.id,
          description: patch.page.description,
          path: patch.page.path ?? "/",
          rootNodeId: patch.page.rootNodeId,
          prototypeIds: Array.isArray(patch.page.prototypeIds) ? [...patch.page.prototypeIds] : [],
          nodes: Array.isArray(patch.page.nodes) ? clone(patch.page.nodes) : [],
          metadata: isRecord(patch.page.metadata) ? clone(patch.page.metadata) : {}
        });
        return;
      }
      case "page.update": {
        const page = document.pages.find((entry) => entry.id === patch.pageId);
        if (!page) throw new Error(`Unknown page: ${patch.pageId}`);
        assertNoOverlappingPaths(patch.changes);
        ensureAllowedRoots(patch.changes, ["name", "description", "rootNodeId", "prototypeIds", "metadata"]);
        for (const [path, value] of Object.entries(patch.changes)) {
          setNestedValue(page as unknown as Record<string, unknown>, path, value);
        }
        return;
      }
      case "node.insert": {
        const page = document.pages.find((entry) => entry.id === patch.pageId);
        if (!page) throw new Error(`Unknown page: ${patch.pageId}`);
        if (page.nodes.some((entry) => entry.id === patch.node.id)) {
          throw new Error(`Node already exists: ${patch.node.id}`);
        }
        const node: CanvasNode = {
          id: patch.node.id,
          kind: patch.node.kind,
          name: patch.node.name ?? patch.node.id,
          pageId: patch.pageId,
          parentId: patch.parentId,
          childIds: Array.isArray(patch.node.childIds) ? [...patch.node.childIds] : [],
          rect: patch.node.rect ?? { x: 0, y: 0, width: 320, height: 180 },
          props: isRecord(patch.node.props) ? clone(patch.node.props) : {},
          style: isRecord(patch.node.style) ? clone(patch.node.style) : {},
          tokenRefs: isRecord(patch.node.tokenRefs) ? clone(patch.node.tokenRefs) : {},
          bindingRefs: isRecord(patch.node.bindingRefs) ? clone(patch.node.bindingRefs) : {},
          variantPatches: Array.isArray(patch.node.variantPatches) ? clone(patch.node.variantPatches) : [],
          metadata: isRecord(patch.node.metadata) ? clone(patch.node.metadata) : {}
        };
        page.nodes.push(node);
        if (patch.parentId) {
          const parent = page.nodes.find((entry) => entry.id === patch.parentId);
          if (!parent) throw new Error(`Unknown parent node: ${patch.parentId}`);
          parent.childIds.push(node.id);
        } else {
          page.rootNodeId = node.id;
        }
        return;
      }
      case "node.update": {
        const node = findNode(document, patch.nodeId);
        assertNoOverlappingPaths(patch.changes);
        ensureAllowedRoots(patch.changes, ["name", "rect", "props", "style", "tokenRefs", "bindingRefs", "metadata"]);
        for (const [path, value] of Object.entries(patch.changes)) {
          setNestedValue(node as unknown as Record<string, unknown>, path, value);
        }
        return;
      }
      case "node.remove": {
        const removedNodeIds = removeNode(document, patch.nodeId);
        const removedSet = new Set(removedNodeIds);
        document.bindings = document.bindings.filter((binding) => !removedSet.has(binding.nodeId));
        return;
      }
      case "variant.patch": {
        const node = findNode(document, patch.nodeId);
        assertNoOverlappingPaths(patch.changes);
        ensureAllowedRoots(patch.changes, ["props", "style", "tokenRefs", "bindingRefs", "metadata"]);
        node.variantPatches = upsertVariantPatch(node.variantPatches, patch.selector, patch.changes);
        return;
      }
      case "token.set": {
        const segments = validatePath(patch.path);
        if (!["colorSystem", "typographySystem", "layoutSystem", "surfaceSystem", "motionSystem", "iconSystem"].includes(segments[0] as string)) {
          throw new Error(`Policy violation for token path: ${patch.path}`);
        }
        setNestedValue(document.designGovernance as unknown as Record<string, unknown>, patch.path, patch.value);
        return;
      }
      case "governance.update": {
        const block = document.designGovernance[patch.block];
        assertNoOverlappingPaths(patch.changes);
        for (const [path, value] of Object.entries(patch.changes)) {
          setNestedValue(block, path, value);
        }
        return;
      }
      case "asset.attach": {
        const node = findNode(document, patch.nodeId);
        const assetIds = Array.isArray(node.metadata.assetIds) ? [...node.metadata.assetIds as string[]] : [];
        if (!assetIds.includes(patch.assetId)) {
          assetIds.push(patch.assetId);
        }
        node.metadata.assetIds = assetIds;
        if (!document.assets.some((asset) => asset.id === patch.assetId)) {
          document.assets.push({
            id: patch.assetId,
            sourceType: "transient",
            status: "attached",
            variants: [],
            metadata: {}
          });
        }
        return;
      }
      case "binding.set": {
        findNode(document, patch.nodeId);
        const binding: CanvasBinding = {
          id: patch.binding.id,
          nodeId: patch.nodeId,
          kind: patch.binding.kind,
          selector: patch.binding.selector,
          componentName: patch.binding.componentName,
          metadata: isRecord(patch.binding.metadata) ? clone(patch.binding.metadata) : {}
        };
        const existing = document.bindings.findIndex((entry) => entry.id === binding.id);
        if (existing >= 0) {
          document.bindings[existing] = binding;
        } else {
          document.bindings.push(binding);
        }
        const node = findNode(document, patch.nodeId);
        node.bindingRefs.primary = binding.id;
        return;
      }
      case "prototype.upsert": {
        const prototype = clone(patch.prototype);
        const existing = document.prototypes.findIndex((entry) => entry.id === prototype.id);
        if (existing >= 0) {
          document.prototypes[existing] = prototype;
        } else {
          document.prototypes.push(prototype);
        }
      }
    }
  }
}

function findNode(document: CanvasDocument, nodeId: string): CanvasNode {
  for (const page of document.pages) {
    const match = page.nodes.find((node) => node.id === nodeId);
    if (match) {
      return match;
    }
  }
  throw new Error(`Unknown node: ${nodeId}`);
}

function removeNode(document: CanvasDocument, nodeId: string): string[] {
  for (const page of document.pages) {
    const node = page.nodes.find((entry) => entry.id === nodeId);
    if (!node) continue;
    const removedNodeIds = [nodeId];
    for (const childId of [...node.childIds]) {
      removedNodeIds.push(...removeNode(document, childId));
    }
    page.nodes = page.nodes.filter((entry) => entry.id !== nodeId);
    for (const parent of page.nodes) {
      parent.childIds = parent.childIds.filter((childId) => childId !== nodeId);
    }
    if (page.rootNodeId === nodeId) {
      page.rootNodeId = null;
    }
    return removedNodeIds;
  }
  throw new Error(`Unknown node: ${nodeId}`);
}

export const CANVAS_PROJECT_DEFAULTS = {
  libraryPolicy: PROJECT_DEFAULT_LIBRARY_POLICY,
  runtimeBudgets: PROJECT_DEFAULT_RUNTIME_BUDGETS
};
