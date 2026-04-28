import { randomUUID } from "crypto";
import * as Y from "yjs";
import type {
  CanvasAsset,
  CanvasBinding,
  CanvasBrowserValidationMode,
  CanvasBlockState,
  CanvasCapabilityGrant,
  CanvasComponentContentContract,
  CanvasComponentEventDescriptor,
  CanvasComponentInventoryItem,
  CanvasComponentPropDescriptor,
  CanvasComponentSlotDescriptor,
  CanvasComponentVariant,
  CanvasDocument,
  CanvasDocumentImportMode,
  CanvasDocumentMeta,
  CanvasFeedbackCategory,
  CanvasFeedbackItem,
  CanvasGenerationPlanField,
  CanvasGenerationPlanIssue,
  CanvasGenerationPlanValidationResult,
  CanvasGenerationPlan,
  CanvasGovernanceBlockKey,
  CanvasGovernanceBlockState,
  CanvasIconRoles,
  CanvasImportAssetReceipt,
  CanvasImportProvenance,
  CanvasImportSource,
  CanvasInventoryOrigin,
  CanvasInteractionState,
  CanvasKeyboardNavigationMode,
  CanvasLibraryPolicy,
  CanvasAdapterCapability,
  CanvasAdapterErrorEnvelope,
  CanvasAdapterPluginDeclaration,
  CanvasAdapterPluginRef,
  CanvasAdapterRef,
  CanvasFrameworkCompatibility,
  CanvasFrameworkRef,
  CanvasLibraryCompatibility,
  CanvasMotionLevel,
  CanvasNode,
  CanvasPage,
  CanvasPlanTheme,
  CanvasPlanViewport,
  CanvasPatch,
  CanvasPrototype,
  CanvasReducedMotionPolicy,
  CanvasStarterApplication,
  CanvasStarterTemplate,
  CanvasTokenAlias,
  CanvasTokenBinding,
  CanvasTokenCollection,
  CanvasTokenItem,
  CanvasTokenMode,
  CanvasTokenStore,
  CanvasValidationWarning,
  CanvasVisualDirectionProfile,
  CanvasVariantPatch,
  CanvasVariantSelector,
  CanvasSourceFamily
} from "./types";
import {
  CANVAS_BROWSER_VALIDATION_MODES,
  CANVAS_GENERATION_PLAN_REQUIRED_FIELDS,
  CANVAS_GOVERNANCE_BLOCK_KEYS,
  CANVAS_INTERACTION_STATES,
  CANVAS_KEYBOARD_NAVIGATION_MODES,
  CANVAS_MOTION_LEVELS,
  CANVAS_NAVIGATION_MODELS,
  CANVAS_OPTIONAL_INHERITED_GOVERNANCE_KEYS,
  CANVAS_PLAN_THEMES,
  CANVAS_PLAN_VIEWPORTS,
  CANVAS_PUBLIC_WARNING_CLASSES,
  CANVAS_REDUCED_MOTION_POLICIES,
  CANVAS_REQUIRED_SAVE_GOVERNANCE_KEYS,
  CANVAS_SCHEMA_VERSION,
  CANVAS_SESSION_MODES,
  CANVAS_THEME_STRATEGIES,
  CANVAS_VALIDATION_TARGET_BLOCK_ON_CODES,
  CANVAS_VISUAL_DIRECTION_PROFILES
} from "./types";
import { normalizeCodeSyncBindingMetadata } from "./code-sync/types";
import { resolveCanvasTokenValue } from "./token-references";

const GOVERNANCE_KEYS: CanvasGovernanceBlockKey[] = [...CANVAS_GOVERNANCE_BLOCK_KEYS];

const OPTIONAL_INHERITED_KEYS = new Set<CanvasGovernanceBlockKey>(CANVAS_OPTIONAL_INHERITED_GOVERNANCE_KEYS);

const REQUIRED_BEFORE_SAVE_KEYS: CanvasGovernanceBlockKey[] = [...CANVAS_REQUIRED_SAVE_GOVERNANCE_KEYS];

const PROJECT_DEFAULT_LIBRARY_POLICY: CanvasLibraryPolicy = {
  icons: ["3dicons", "tabler", "microsoft-fluent-ui-system-icons", "@lobehub/fluent-emoji-3d"],
  components: ["shadcn"],
  styling: ["tailwindcss"],
  motion: [],
  threeD: []
};

const APPROVED_LIBRARY_ENTRIES: Record<keyof CanvasLibraryPolicy, ReadonlySet<string>> = {
  icons: new Set(PROJECT_DEFAULT_LIBRARY_POLICY.icons),
  components: new Set(PROJECT_DEFAULT_LIBRARY_POLICY.components),
  styling: new Set(PROJECT_DEFAULT_LIBRARY_POLICY.styling),
  motion: new Set(PROJECT_DEFAULT_LIBRARY_POLICY.motion),
  threeD: new Set(PROJECT_DEFAULT_LIBRARY_POLICY.threeD)
};

const PROJECT_DEFAULT_RUNTIME_BUDGETS = {
  defaultLivePreviewLimit: 2,
  maxPinnedFullPreviewExtra: 1,
  reconnectGraceMs: 20_000,
  overflowRenderMode: "thumbnail_only",
  backgroundTelemetryMode: "sampled"
};

const CANVAS_SOURCE_FAMILIES = new Set<CanvasSourceFamily>([
  "canvas_document",
  "framework_component",
  "design_import",
  "starter_template",
  "adapter_plugin",
  "unknown"
]);

const CANVAS_INVENTORY_ORIGINS = new Set<CanvasInventoryOrigin>([
  "document",
  "code_sync",
  "import",
  "starter",
  "plugin",
  "unknown"
]);

const CANVAS_ADAPTER_CAPABILITIES = new Set<CanvasAdapterCapability>([
  "import",
  "export",
  "preview",
  "code_sync",
  "inventory",
  "tokens",
  "starter_templates"
]);

const CANVAS_SESSION_MODE_SET = new Set(CANVAS_SESSION_MODES);
const CANVAS_VISUAL_DIRECTION_PROFILE_SET = new Set<CanvasVisualDirectionProfile>(CANVAS_VISUAL_DIRECTION_PROFILES);
const CANVAS_THEME_STRATEGY_SET = new Set(CANVAS_THEME_STRATEGIES);
const CANVAS_NAVIGATION_MODEL_SET = new Set(CANVAS_NAVIGATION_MODELS);
const CANVAS_INTERACTION_STATE_SET = new Set<CanvasInteractionState>(CANVAS_INTERACTION_STATES);
const CANVAS_VIEWPORT_SET = new Set<CanvasPlanViewport>(CANVAS_PLAN_VIEWPORTS);
const CANVAS_THEME_SET = new Set<CanvasPlanTheme>(CANVAS_PLAN_THEMES);
const CANVAS_MOTION_LEVEL_SET = new Set<CanvasMotionLevel>(CANVAS_MOTION_LEVELS);
const CANVAS_REDUCED_MOTION_POLICY_SET = new Set<CanvasReducedMotionPolicy>(CANVAS_REDUCED_MOTION_POLICIES);
const CANVAS_KEYBOARD_NAVIGATION_SET = new Set<CanvasKeyboardNavigationMode>(CANVAS_KEYBOARD_NAVIGATION_MODES);
const CANVAS_BROWSER_VALIDATION_MODE_SET = new Set<CanvasBrowserValidationMode>(CANVAS_BROWSER_VALIDATION_MODES);
const CANVAS_VALIDATION_TARGET_BLOCK_ON_SET = new Set(CANVAS_VALIDATION_TARGET_BLOCK_ON_CODES);

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

const clone = <T>(value: T): T => {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

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

const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

const optionalString = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;

const normalizeRecord = (value: unknown): Record<string, unknown> => isRecord(value) ? clone(value) : {};

function normalizeStringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueStrings(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))
    : [];
}

function normalizeEnumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? value as T : fallback;
}

function normalizeArray<T>(value: unknown, normalizer: (entry: unknown, index: number) => T | null): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: T[] = [];
  for (const [index, entry] of value.entries()) {
    const normalized = normalizer(entry, index);
    if (normalized) {
      items.push(normalized);
    }
  }
  return items;
}

function collectExtraMetadata(record: Record<string, unknown>, knownKeys: readonly string[]): Record<string, unknown> {
  const metadata = isRecord(record.metadata) ? clone(record.metadata) : {};
  const known = new Set([...knownKeys, "metadata"]);
  for (const [key, value] of Object.entries(record)) {
    if (known.has(key)) {
      continue;
    }
    metadata[key] = clone(value);
  }
  return metadata;
}

function createEmptyCanvasContentContract(): CanvasComponentContentContract {
  return {
    acceptsText: false,
    acceptsRichText: false,
    slotNames: [],
    metadata: {}
  };
}

function createEmptyCanvasTokenStore(): CanvasTokenStore {
  return {
    values: {},
    collections: [],
    aliases: [],
    bindings: [],
    metadata: {}
  };
}

function createEmptyCanvasDocumentMeta(): CanvasDocumentMeta {
  return {
    imports: [],
    starter: null,
    adapterPlugins: [],
    pluginErrors: [],
    metadata: {}
  };
}

function normalizeCanvasAdapterRef(value: unknown): CanvasAdapterRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = optionalString(value.id) ?? optionalString(value.adapterId);
  if (!id) {
    return null;
  }
  return {
    id,
    label: optionalString(value.label) ?? optionalString(value.name),
    version: optionalString(value.version),
    packageName: optionalString(value.packageName),
    metadata: collectExtraMetadata(value, ["id", "adapterId", "label", "name", "version", "packageName"])
  };
}

function normalizeCanvasFrameworkRef(value: unknown): CanvasFrameworkRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = optionalString(value.id) ?? optionalString(value.frameworkId);
  if (!id) {
    return null;
  }
  return {
    id,
    label: optionalString(value.label) ?? optionalString(value.name),
    packageName: optionalString(value.packageName),
    adapter: normalizeCanvasAdapterRef(value.adapter),
    metadata: collectExtraMetadata(value, ["id", "frameworkId", "label", "name", "packageName", "adapter"])
  };
}

function normalizeCanvasAdapterPluginRef(value: unknown): CanvasAdapterPluginRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = optionalString(value.id) ?? optionalString(value.pluginId);
  if (!id) {
    return null;
  }
  return {
    id,
    label: optionalString(value.label) ?? optionalString(value.name),
    version: optionalString(value.version),
    packageName: optionalString(value.packageName),
    metadata: collectExtraMetadata(value, ["id", "pluginId", "label", "name", "version", "packageName"])
  };
}

function normalizeCanvasComponentVariant(value: unknown, index: number): CanvasComponentVariant | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = optionalString(value.name) ?? optionalString(value.label) ?? `Variant ${index + 1}`;
  return {
    id: optionalString(value.id) ?? `variant_${index + 1}`,
    name,
    selector: isRecord(value.selector) ? clone(value.selector as CanvasVariantSelector) : {},
    description: optionalString(value.description),
    metadata: collectExtraMetadata(value, ["id", "name", "label", "selector", "description"])
  };
}

function normalizeCanvasComponentPropDescriptor(value: unknown, index: number): CanvasComponentPropDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = optionalString(value.name);
  if (!name) {
    return null;
  }
  return {
    name,
    type: optionalString(value.type),
    required: typeof value.required === "boolean" ? value.required : undefined,
    defaultValue: "defaultValue" in value ? clone(value.defaultValue) : undefined,
    description: optionalString(value.description),
    metadata: collectExtraMetadata(value, ["name", "type", "required", "defaultValue", "description"])
  };
}

function normalizeCanvasComponentSlotDescriptor(value: unknown, index: number): CanvasComponentSlotDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = optionalString(value.name) ?? `slot_${index + 1}`;
  return {
    name,
    description: optionalString(value.description),
    allowedKinds: normalizeStringArrayValue(value.allowedKinds),
    metadata: collectExtraMetadata(value, ["name", "description", "allowedKinds"])
  };
}

function normalizeCanvasComponentEventDescriptor(value: unknown, index: number): CanvasComponentEventDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = optionalString(value.name) ?? `event_${index + 1}`;
  return {
    name,
    description: optionalString(value.description),
    payloadShape: isRecord(value.payloadShape) ? clone(value.payloadShape) : undefined,
    metadata: collectExtraMetadata(value, ["name", "description", "payloadShape"])
  };
}

function normalizeCanvasComponentContentContract(value: unknown): CanvasComponentContentContract {
  if (!isRecord(value)) {
    return createEmptyCanvasContentContract();
  }
  return {
    acceptsText: value.acceptsText === true,
    acceptsRichText: value.acceptsRichText === true,
    slotNames: normalizeStringArrayValue(value.slotNames),
    metadata: collectExtraMetadata(value, ["acceptsText", "acceptsRichText", "slotNames"])
  };
}

function normalizeCanvasComponentInventoryItem(value: unknown, index: number): CanvasComponentInventoryItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = optionalString(value.name) ?? optionalString(value.componentName) ?? optionalString(value.id) ?? `Component ${index + 1}`;
  return {
    id: optionalString(value.id) ?? `inventory_${index + 1}`,
    name,
    componentName: optionalString(value.componentName) ?? name,
    description: optionalString(value.description),
    sourceKind: optionalString(value.sourceKind) ?? optionalString(value.source),
    sourceFamily: normalizeEnumValue(value.sourceFamily, CANVAS_SOURCE_FAMILIES, "unknown"),
    origin: normalizeEnumValue(value.origin, CANVAS_INVENTORY_ORIGINS, "document"),
    framework: normalizeCanvasFrameworkRef(value.framework),
    adapter: normalizeCanvasAdapterRef(value.adapter),
    plugin: normalizeCanvasAdapterPluginRef(value.plugin ?? value.adapterPlugin),
    variants: normalizeArray(value.variants, normalizeCanvasComponentVariant),
    props: normalizeArray(value.props, normalizeCanvasComponentPropDescriptor),
    slots: normalizeArray(value.slots, normalizeCanvasComponentSlotDescriptor),
    events: normalizeArray(value.events, normalizeCanvasComponentEventDescriptor),
    content: normalizeCanvasComponentContentContract(value.content ?? value.contentContract),
    metadata: collectExtraMetadata(value, [
      "id",
      "name",
      "componentName",
      "description",
      "sourceKind",
      "source",
      "sourceFamily",
      "origin",
      "framework",
      "adapter",
      "plugin",
      "adapterPlugin",
      "variants",
      "props",
      "slots",
      "events",
      "content",
      "contentContract"
    ])
  };
}

function normalizeCanvasTokenMode(value: unknown, index: number): CanvasTokenMode | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = optionalString(value.id) ?? `mode_${index + 1}`;
  const name = optionalString(value.name) ?? id;
  return {
    id,
    name,
    value: clone(value.value),
    metadata: collectExtraMetadata(value, ["id", "name", "value"])
  };
}

function normalizeCanvasTokenItem(value: unknown, index: number): CanvasTokenItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const path = optionalString(value.path);
  if (!path) {
    return null;
  }
  return {
    id: optionalString(value.id) ?? `token_${index + 1}`,
    path,
    value: clone(value.value),
    type: optionalString(value.type),
    description: optionalString(value.description),
    modes: normalizeArray(value.modes, normalizeCanvasTokenMode),
    metadata: collectExtraMetadata(value, ["id", "path", "value", "type", "description", "modes"])
  };
}

function normalizeCanvasTokenCollection(value: unknown, index: number): CanvasTokenCollection | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = optionalString(value.name) ?? `Collection ${index + 1}`;
  return {
    id: optionalString(value.id) ?? `collection_${index + 1}`,
    name,
    items: normalizeArray(value.items, normalizeCanvasTokenItem),
    metadata: collectExtraMetadata(value, ["id", "name", "items"])
  };
}

function normalizeCanvasTokenAlias(value: unknown, index: number): CanvasTokenAlias | null {
  if (!isRecord(value)) {
    return null;
  }
  const path = optionalString(value.path);
  const targetPath = optionalString(value.targetPath);
  if (!path || !targetPath) {
    return null;
  }
  return {
    path,
    targetPath,
    modeId: optionalString(value.modeId),
    metadata: collectExtraMetadata(value, ["path", "targetPath", "modeId"])
  };
}

function normalizeCanvasTokenBinding(value: unknown, index: number): CanvasTokenBinding | null {
  if (!isRecord(value)) {
    return null;
  }
  const path = optionalString(value.path);
  if (!path) {
    return null;
  }
  return {
    path,
    nodeId: optionalString(value.nodeId),
    bindingId: optionalString(value.bindingId),
    property: optionalString(value.property),
    metadata: collectExtraMetadata(value, ["path", "nodeId", "bindingId", "property"])
  };
}

function normalizeCanvasTokenStore(value: unknown): CanvasTokenStore {
  if (!isRecord(value)) {
    return createEmptyCanvasTokenStore();
  }
  const structured = "values" in value || "collections" in value || "aliases" in value || "bindings" in value || "metadata" in value;
  return {
    values: structured ? normalizeRecord(value.values) : clone(value),
    collections: normalizeArray(value.collections, normalizeCanvasTokenCollection),
    aliases: normalizeArray(value.aliases, normalizeCanvasTokenAlias),
    bindings: normalizeArray(value.bindings, normalizeCanvasTokenBinding),
    metadata: structured
      ? collectExtraMetadata(value, ["values", "collections", "aliases", "bindings"])
      : {}
  };
}

function normalizeCanvasImportAssetReceipt(value: unknown, index: number): CanvasImportAssetReceipt | null {
  if (!isRecord(value)) {
    return null;
  }
  const assetId = optionalString(value.assetId) ?? optionalString(value.id);
  if (!assetId) {
    return null;
  }
  return {
    assetId,
    sourceType: optionalString(value.sourceType),
    repoPath: optionalString(value.repoPath),
    url: optionalString(value.url),
    status: optionalString(value.status),
    metadata: collectExtraMetadata(value, ["assetId", "id", "sourceType", "repoPath", "url", "status"])
  };
}

function normalizeCanvasImportSource(value: unknown, index: number): CanvasImportSource | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = optionalString(value.kind);
  if (!kind) {
    return null;
  }
  return {
    id: optionalString(value.id) ?? `import_source_${index + 1}`,
    kind,
    label: optionalString(value.label) ?? optionalString(value.name),
    uri: optionalString(value.uri),
    sourceDialect: optionalString(value.sourceDialect),
    frameworkId: optionalString(value.frameworkId),
    pluginId: optionalString(value.pluginId),
    adapterIds: normalizeStringArrayValue(value.adapterIds),
    metadata: collectExtraMetadata(value, ["id", "kind", "label", "name", "uri", "sourceDialect", "frameworkId", "pluginId", "adapterIds"])
  };
}

function normalizeCanvasImportProvenance(value: unknown, index: number): CanvasImportProvenance | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = normalizeCanvasImportSource(value.source, index);
  if (!source) {
    return null;
  }
  return {
    id: optionalString(value.id) ?? `import_${index + 1}`,
    source,
    importedAt: optionalString(value.importedAt),
    assetReceipts: normalizeArray(value.assetReceipts, normalizeCanvasImportAssetReceipt),
    metadata: collectExtraMetadata(value, ["id", "source", "importedAt", "assetReceipts"])
  };
}

function normalizeCanvasStarterTemplate(value: unknown): CanvasStarterTemplate | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = optionalString(value.id);
  const name = optionalString(value.name);
  if (!id || !name) {
    return null;
  }
  const defaultFrameworkId = optionalString(value.defaultFrameworkId)
    ?? optionalString(value.frameworkId)
    ?? "react";
  const compatibleFrameworkIds = normalizeStringArrayValue(value.compatibleFrameworkIds);
  return {
    id,
    name,
    description: optionalString(value.description),
    tags: normalizeStringArrayValue(value.tags),
    defaultFrameworkId,
    compatibleFrameworkIds: compatibleFrameworkIds.length > 0
      ? compatibleFrameworkIds
      : [defaultFrameworkId],
    kitIds: normalizeStringArrayValue(value.kitIds),
    metadata: collectExtraMetadata(value, [
      "id",
      "name",
      "description",
      "tags",
      "defaultFrameworkId",
      "frameworkId",
      "compatibleFrameworkIds",
      "kitIds"
    ])
  };
}

function normalizeCanvasStarterApplication(value: unknown): CanvasStarterApplication | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    template: normalizeCanvasStarterTemplate(value.template),
    frameworkId: optionalString(value.frameworkId),
    appliedAt: optionalString(value.appliedAt),
    metadata: collectExtraMetadata(value, ["template", "frameworkId", "appliedAt"])
  };
}

function normalizeCanvasFrameworkCompatibility(value: unknown, index: number): CanvasFrameworkCompatibility | null {
  if (!isRecord(value)) {
    return null;
  }
  const frameworkId = optionalString(value.frameworkId);
  if (!frameworkId) {
    return null;
  }
  return {
    frameworkId,
    versions: normalizeStringArrayValue(value.versions),
    metadata: collectExtraMetadata(value, ["frameworkId", "versions"])
  };
}

function normalizeCanvasLibraryCompatibility(value: unknown, index: number): CanvasLibraryCompatibility | null {
  if (!isRecord(value)) {
    return null;
  }
  const libraryId = optionalString(value.libraryId);
  if (!libraryId) {
    return null;
  }
  return {
    libraryId,
    categories: normalizeStringArrayValue(value.categories),
    metadata: collectExtraMetadata(value, ["libraryId", "categories"])
  };
}

function normalizeCanvasCapabilityGrant(value: unknown, index: number): CanvasCapabilityGrant | null {
  if (!isRecord(value)) {
    return null;
  }
  const capability = normalizeEnumValue(value.capability, CANVAS_ADAPTER_CAPABILITIES, "preview");
  return {
    capability,
    granted: value.granted === true,
    reason: optionalString(value.reason),
    metadata: collectExtraMetadata(value, ["capability", "granted", "reason"])
  };
}

function normalizeCanvasAdapterPluginDeclaration(value: unknown, index: number): CanvasAdapterPluginDeclaration | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = optionalString(value.id) ?? optionalString(value.pluginId);
  if (!id) {
    return null;
  }
  return {
    id,
    label: optionalString(value.label) ?? optionalString(value.name),
    frameworks: normalizeArray(value.frameworks, normalizeCanvasFrameworkCompatibility),
    libraries: normalizeArray(value.libraries, normalizeCanvasLibraryCompatibility),
    declaredCapabilities: normalizeStringArrayValue(value.declaredCapabilities)
      .filter((entry): entry is CanvasAdapterCapability => CANVAS_ADAPTER_CAPABILITIES.has(entry as CanvasAdapterCapability)),
    grantedCapabilities: normalizeArray(value.grantedCapabilities, normalizeCanvasCapabilityGrant),
    metadata: collectExtraMetadata(value, [
      "id",
      "pluginId",
      "label",
      "name",
      "frameworks",
      "libraries",
      "declaredCapabilities",
      "grantedCapabilities"
    ])
  };
}

function normalizeCanvasAdapterErrorEnvelope(value: unknown, index: number): CanvasAdapterErrorEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }
  const code = optionalString(value.code);
  const message = optionalString(value.message);
  if (!code || !message) {
    return null;
  }
  return {
    pluginId: optionalString(value.pluginId),
    code,
    message,
    details: isRecord(value.details) ? clone(value.details) : collectExtraMetadata(value, ["pluginId", "code", "message", "details"])
  };
}

function normalizeCanvasDocumentMeta(value: unknown): CanvasDocumentMeta {
  if (!isRecord(value)) {
    return createEmptyCanvasDocumentMeta();
  }
  const metadata = isRecord(value.metadata) ? clone(value.metadata) : {};
  for (const [key, entry] of Object.entries(value)) {
    if (["imports", "starter", "adapterPlugins", "pluginErrors", "metadata"].includes(key)) {
      continue;
    }
    metadata[key] = clone(entry);
  }
  return {
    imports: normalizeArray(value.imports, normalizeCanvasImportProvenance),
    starter: normalizeCanvasStarterApplication(value.starter),
    adapterPlugins: normalizeArray(value.adapterPlugins, normalizeCanvasAdapterPluginDeclaration),
    pluginErrors: normalizeArray(value.pluginErrors, normalizeCanvasAdapterErrorEnvelope),
    metadata
  };
}

function hasTokenStoreContent(tokens: CanvasTokenStore): boolean {
  return Object.keys(tokens.values).length > 0
    || tokens.collections.length > 0
    || tokens.aliases.length > 0
    || tokens.bindings.length > 0;
}

const normalizeLibraryPolicyField = (value: unknown, fallback: readonly string[]): string[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return uniqueStrings(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0));
};

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
    tokens: createEmptyCanvasTokenStore(),
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
    meta: createEmptyCanvasDocumentMeta()
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
    componentInventory: normalizeArray(base.componentInventory, normalizeCanvasComponentInventoryItem),
    tokens: normalizeCanvasTokenStore(base.tokens),
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
    bindings: Array.isArray(base.bindings) ? base.bindings.map((binding) => normalizeBinding(binding)) : [],
    prototypes: Array.isArray(base.prototypes) ? clone(base.prototypes) : [],
    meta: normalizeCanvasDocumentMeta(base.meta)
  };
}

function normalizeBinding(binding: CanvasBinding): CanvasBinding {
  const normalized: CanvasBinding = {
    id: binding.id,
    nodeId: binding.nodeId,
    kind: binding.kind,
    selector: typeof binding.selector === "string" ? binding.selector : undefined,
    componentName: typeof binding.componentName === "string" ? binding.componentName : undefined,
    metadata: isRecord(binding.metadata) ? clone(binding.metadata) : {}
  };
  if (binding.kind === "code-sync" || binding.codeSync) {
    normalized.codeSync = normalizeCodeSyncBindingMetadata(binding.codeSync ?? binding.metadata?.codeSync);
  }
  return normalized;
}

function sanitizeInventoryNodeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const metadata = clone(value);
  const inventory = isRecord(metadata.inventory) ? { ...metadata.inventory } : null;
  if (inventory) {
    delete inventory.template;
    if (Object.keys(inventory).length > 0) {
      metadata.inventory = inventory;
    } else {
      delete metadata.inventory;
    }
  }
  return metadata;
}

function describeInventoryValueType(value: unknown): string | null {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return typeof value;
    case "object":
      return "object";
    default:
      return null;
  }
}

function buildInventoryProps(node: CanvasNode): CanvasComponentPropDescriptor[] {
  return Object.entries(node.props)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, defaultValue]) => ({
      name,
      type: describeInventoryValueType(defaultValue),
      required: false,
      defaultValue: clone(defaultValue),
      description: null,
      metadata: {}
    }));
}

function buildInventorySlots(document: CanvasDocument, node: CanvasNode): CanvasComponentSlotDescriptor[] {
  if (node.childIds.length === 0) {
    return [];
  }
  const childKinds: string[] = [];
  for (const childId of node.childIds) {
    try {
      childKinds.push(findNode(document, childId).kind);
    } catch {
      continue;
    }
  }
  return [{
    name: "default",
    description: null,
    allowedKinds: [...new Set(childKinds)],
    metadata: {
      childCount: node.childIds.length
    }
  }];
}

function buildInventoryEvents(node: CanvasNode, binding: CanvasBinding | null): CanvasComponentEventDescriptor[] {
  const rawEvents = Array.isArray(node.metadata.events)
    ? node.metadata.events
    : Array.isArray(binding?.metadata?.events)
      ? binding.metadata.events
      : [];
  const events: CanvasComponentEventDescriptor[] = [];
  for (const [index, entry] of rawEvents.entries()) {
    if (!isRecord(entry)) {
      continue;
    }
    const name = optionalString(entry.name) ?? optionalString(entry.event) ?? `event_${index + 1}`;
    events.push({
      name,
      description: optionalString(entry.description),
      payloadShape: isRecord(entry.payloadShape) ? clone(entry.payloadShape) : undefined,
      metadata: collectExtraMetadata(entry, ["name", "event", "description", "payloadShape"])
    });
  }
  return events;
}

function buildInventoryContent(node: CanvasNode, slots: CanvasComponentSlotDescriptor[]): CanvasComponentContentContract {
  return {
    acceptsText: node.kind === "text" || node.kind === "note" || "text" in node.props,
    acceptsRichText: isRecord(node.props.richText) || node.metadata.richText === true,
    slotNames: slots.map((entry) => entry.name),
    metadata: {}
  };
}

function inferInventoryFramework(binding: CanvasBinding | null): CanvasFrameworkRef | null {
  const explicit = normalizeCanvasFrameworkRef(isRecord(binding?.metadata?.framework) ? binding?.metadata?.framework : null);
  if (explicit) {
    return explicit;
  }
  if (!binding?.codeSync) {
    return null;
  }
  return {
    id: "react-tsx",
    label: "React TSX",
    packageName: "react",
    adapter: null,
    metadata: {}
  };
}

function inferInventoryAdapter(binding: CanvasBinding | null): CanvasAdapterRef | null {
  const explicit = normalizeCanvasAdapterRef(isRecord(binding?.metadata?.adapter) ? binding?.metadata?.adapter : null);
  if (explicit) {
    return explicit;
  }
  if (!binding?.codeSync) {
    return null;
  }
  return {
    id: binding.codeSync.adapter,
    label: binding.codeSync.adapter,
    packageName: null,
    version: null,
    metadata: {
      repoPath: binding.codeSync.repoPath,
      syncMode: binding.codeSync.syncMode,
      projection: binding.codeSync.projection
    }
  };
}

function inferInventoryPlugin(document: CanvasDocument, binding: CanvasBinding | null, node: CanvasNode): CanvasAdapterPluginRef | null {
  const explicit = normalizeCanvasAdapterPluginRef(
    isRecord(binding?.metadata?.plugin)
      ? binding?.metadata?.plugin
      : isRecord(node.metadata.plugin)
        ? node.metadata.plugin
        : null
  );
  if (explicit) {
    return explicit;
  }
  const pluginId = optionalString(binding?.metadata?.pluginId) ?? optionalString(node.metadata.pluginId);
  if (!pluginId) {
    return null;
  }
  const declaration = document.meta.adapterPlugins.find((entry) => entry.id === pluginId);
  return {
    id: pluginId,
    label: declaration?.label ?? pluginId,
    version: optionalString(declaration?.metadata.version),
    packageName: optionalString(declaration?.metadata.packageName),
    metadata: declaration ? clone(declaration.metadata) : {}
  };
}

function inferInventorySourceFamily(node: CanvasNode, binding: CanvasBinding | null): CanvasSourceFamily {
  if (binding?.codeSync) {
    return "framework_component";
  }
  if (typeof node.metadata.importSourceId === "string" || typeof node.metadata.figmaNodeId === "string") {
    return "design_import";
  }
  return "canvas_document";
}

function inferInventoryOrigin(node: CanvasNode, binding: CanvasBinding | null): CanvasInventoryOrigin {
  if (binding?.codeSync) {
    return "code_sync";
  }
  if (typeof node.metadata.importSourceId === "string" || typeof node.metadata.figmaNodeId === "string") {
    return "import";
  }
  return "document";
}

function buildInventoryTemplate(document: CanvasDocument, nodeId: string): Record<string, unknown> {
  const rootNode = findNode(document, nodeId);
  const pending = [rootNode];
  const nodes: Array<Record<string, unknown>> = [];
  while (pending.length > 0) {
    const current = pending.shift() as CanvasNode;
    nodes.push({
      id: current.id,
      kind: current.kind,
      name: current.name,
      parentId: current.parentId,
      childIds: [...current.childIds],
      rect: clone(current.rect),
      props: clone(current.props),
      style: clone(current.style),
      tokenRefs: clone(current.tokenRefs),
      variantPatches: clone(current.variantPatches),
      metadata: sanitizeInventoryNodeMetadata(current.metadata)
    });
    for (const childId of current.childIds) {
      pending.push(findNode(document, childId));
    }
  }
  return {
    rootNodeId: rootNode.id,
    nodes
  };
}

function buildInventoryItemFromNode(
  document: CanvasDocument,
  nodeId: string,
  options: {
    itemId?: string;
    name?: string;
    description?: string | null;
    origin?: CanvasInventoryOrigin;
    metadata?: Record<string, unknown>;
  } = {}
): CanvasComponentInventoryItem {
  const node = findNode(document, nodeId);
  const bindingId = typeof node.bindingRefs.primary === "string" ? node.bindingRefs.primary : null;
  const binding = bindingId
    ? document.bindings.find((entry) => entry.id === bindingId) ?? null
    : document.bindings.find((entry) => entry.nodeId === node.id) ?? null;
  const slots = buildInventorySlots(document, node);
  const baseOrigin = inferInventoryOrigin(node, binding);
  const origin = options.origin && CANVAS_INVENTORY_ORIGINS.has(options.origin)
    ? options.origin
    : baseOrigin;
  const template = buildInventoryTemplate(document, nodeId);
  return normalizeCanvasComponentInventoryItem({
    id: options.itemId ?? `inventory_${randomUUID().slice(0, 8)}`,
    name: options.name ?? node.name,
    componentName: binding?.componentName ?? node.name,
    description: options.description ?? null,
    sourceKind: optionalString(node.metadata.sourceKind) ?? binding?.kind ?? node.kind,
    sourceFamily: inferInventorySourceFamily(node, binding),
    origin,
    framework: inferInventoryFramework(binding),
    adapter: inferInventoryAdapter(binding),
    plugin: inferInventoryPlugin(document, binding, node),
    variants: node.variantPatches.map((entry, index) => ({
      id: `variant_${index + 1}`,
      name: Object.entries(entry.selector)
        .map(([key, value]) => `${key}:${String(value)}`)
        .join(" / ") || `Variant ${index + 1}`,
      selector: clone(entry.selector),
      description: null,
      metadata: {
        changes: clone(entry.changes)
      }
    })),
    props: buildInventoryProps(node),
    slots,
    events: buildInventoryEvents(node, binding),
    content: buildInventoryContent(node, slots),
    metadata: {
      promotedFromNodeId: node.id,
      promotedAt: new Date().toISOString(),
      template,
      ...(isRecord(options.metadata) ? clone(options.metadata) : {})
    }
  }, document.componentInventory.length + 1) as CanvasComponentInventoryItem;
}

function mergeCanvasTokenStore(
  current: CanvasTokenStore,
  patch: Partial<CanvasTokenStore>
): CanvasTokenStore {
  const next = normalizeCanvasTokenStore(current);
  const incoming = normalizeCanvasTokenStore(patch);
  next.values = mergeUnknownRecord(next.values, incoming.values);
  next.collections = upsertTokenCollections(next.collections, incoming.collections);
  next.aliases = upsertTokenAliases(next.aliases, incoming.aliases);
  next.bindings = upsertTokenBindings(next.bindings, incoming.bindings);
  next.metadata = mergeUnknownRecord(next.metadata, incoming.metadata);
  return next;
}

function mergeUnknownRecord(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next = clone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (isRecord(value) && isRecord(next[key])) {
      next[key] = mergeUnknownRecord(next[key] as Record<string, unknown>, value);
      continue;
    }
    next[key] = clone(value);
  }
  return next;
}

function upsertTokenCollections(
  current: CanvasTokenCollection[],
  incoming: CanvasTokenCollection[]
): CanvasTokenCollection[] {
  const byId = new Map(current.map((collection) => [collection.id, normalizeCanvasTokenCollection(collection, 0)!]));
  for (const collection of incoming) {
    byId.set(collection.id, normalizeCanvasTokenCollection(collection, 0)!);
  }
  return [...byId.values()];
}

function upsertTokenAliases(
  current: CanvasTokenAlias[],
  incoming: CanvasTokenAlias[]
): CanvasTokenAlias[] {
  const byKey = new Map(current.map((alias) => [`${alias.path}:${alias.modeId ?? ""}`, clone(alias)]));
  for (const alias of incoming) {
    byKey.set(`${alias.path}:${alias.modeId ?? ""}`, clone(alias));
  }
  return [...byKey.values()];
}

function upsertTokenBindings(
  current: CanvasTokenBinding[],
  incoming: CanvasTokenBinding[]
): CanvasTokenBinding[] {
  const keyOf = (binding: CanvasTokenBinding) => `${binding.path}:${binding.nodeId ?? ""}:${binding.property ?? ""}:${binding.bindingId ?? ""}`;
  const byKey = new Map(current.map((binding) => [keyOf(binding), clone(binding)]));
  for (const binding of incoming) {
    byKey.set(keyOf(binding), clone(binding));
  }
  return [...byKey.values()];
}

function upsertCanvasAssets(current: CanvasAsset[], incoming: CanvasAsset[]): CanvasAsset[] {
  const byId = new Map(current.map((asset) => [asset.id, clone(asset)]));
  for (const asset of incoming) {
    byId.set(asset.id, clone(asset));
  }
  return [...byId.values()];
}

function upsertCanvasImports(
  current: CanvasImportProvenance[],
  incoming: CanvasImportProvenance[]
): CanvasImportProvenance[] {
  const byId = new Map(current.map((entry) => [entry.id, clone(entry)]));
  for (const entry of incoming) {
    byId.set(entry.id, clone(entry));
  }
  return [...byId.values()];
}

function upsertCanvasInventoryItems(
  current: CanvasComponentInventoryItem[],
  incoming: CanvasComponentInventoryItem[]
): CanvasComponentInventoryItem[] {
  const byId = new Map(current.map((entry, index) => [entry.id, normalizeCanvasComponentInventoryItem(entry, index + 1)!]));
  for (const [index, entry] of incoming.entries()) {
    const normalized = normalizeCanvasComponentInventoryItem(entry, current.length + index + 1);
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()];
}

export function mergeImportedCanvasState(
  current: CanvasDocument,
  input: {
    mode: CanvasDocumentImportMode;
    targetPageId?: string | null;
    pages: CanvasPage[];
    componentInventory: CanvasComponentInventoryItem[];
    tokens?: Partial<CanvasTokenStore>;
    assets?: CanvasAsset[];
    provenance: CanvasImportProvenance;
  }
): CanvasDocument {
  const next = normalizeCanvasDocument(current);
  const importedPages = input.pages.map((page) => clone(page));
  if (input.mode === "append_pages") {
    next.pages.push(...importedPages);
  } else if (input.mode === "replace_current_page" && importedPages.length > 0) {
    const replaceIndex = input.targetPageId
      ? next.pages.findIndex((page) => page.id === input.targetPageId)
      : 0;
    if (replaceIndex >= 0 && replaceIndex < next.pages.length) {
      next.pages.splice(replaceIndex, 1, importedPages[0] as CanvasPage, ...importedPages.slice(1));
    } else {
      next.pages.push(...importedPages);
    }
  }
  next.componentInventory = upsertCanvasInventoryItems(next.componentInventory, input.componentInventory);
  next.tokens = mergeCanvasTokenStore(next.tokens, input.tokens ?? {});
  next.assets = upsertCanvasAssets(next.assets, input.assets ?? []);
  next.meta.imports = upsertCanvasImports(next.meta.imports, [input.provenance]);
  return next;
}

function pushGenerationPlanIssue(
  issues: CanvasGenerationPlanIssue[],
  issue: CanvasGenerationPlanIssue
): void {
  issues.push(issue);
}

function requirePlanSection(
  plan: Record<string, unknown>,
  field: CanvasGenerationPlanField,
  missing: CanvasGenerationPlanField[],
  issues: CanvasGenerationPlanIssue[]
): Record<string, unknown> | null {
  const value = plan[field];
  if (isNonEmptyRecord(value)) {
    return value;
  }
  missing.push(field);
  pushGenerationPlanIssue(issues, {
    path: field,
    code: "missing_field",
    message: `generationPlan.${field} is required.`,
    expected: "non-empty object",
    received: clone(value)
  });
  return null;
}

function requirePlanString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: CanvasGenerationPlanIssue[]
): string | null {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  pushGenerationPlanIssue(issues, {
    path,
    code: value === undefined ? "missing_field" : "invalid_type",
    message: `${path} must be a non-empty string.`,
    expected: "non-empty string",
    received: clone(value)
  });
  return null;
}

function requirePlanEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  allowedValues: readonly T[],
  allowedSet: ReadonlySet<T>,
  issues: CanvasGenerationPlanIssue[]
): T | null {
  const value = record[key];
  if (typeof value === "string" && allowedSet.has(value as T)) {
    return value as T;
  }
  pushGenerationPlanIssue(issues, {
    path,
    code: value === undefined ? "missing_field" : "invalid_value",
    message: `${path} must be one of the supported values.`,
    expected: [...allowedValues],
    received: clone(value)
  });
  return null;
}

function requirePlanEnumArray<T extends string>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  allowedValues: readonly T[],
  allowedSet: ReadonlySet<T>,
  issues: CanvasGenerationPlanIssue[]
): T[] | null {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    pushGenerationPlanIssue(issues, {
      path,
      code: value === undefined ? "missing_field" : "invalid_type",
      message: `${path} must be a non-empty array of supported values.`,
      expected: [...allowedValues],
      received: clone(value)
    });
    return null;
  }
  const normalized = uniqueStrings(value.filter((entry): entry is T => typeof entry === "string")) as T[];
  const invalidEntries = normalized.filter((entry) => !allowedSet.has(entry));
  if (invalidEntries.length > 0) {
    pushGenerationPlanIssue(issues, {
      path,
      code: "invalid_value",
      message: `${path} contains unsupported values.`,
      expected: [...allowedValues],
      received: invalidEntries
    });
    return null;
  }
  if (normalized.length === 0) {
    pushGenerationPlanIssue(issues, {
      path,
      code: "invalid_type",
      message: `${path} must include at least one supported value.`,
      expected: [...allowedValues],
      received: clone(value)
    });
    return null;
  }
  return normalized;
}

function optionalPlanStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: CanvasGenerationPlanIssue[]
): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    pushGenerationPlanIssue(issues, {
      path,
      code: "invalid_type",
      message: `${path} must include only non-empty strings.`,
      expected: "string[]",
      received: clone(value)
    });
    return undefined;
  }
  const strings = value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean);
  const normalized = uniqueStrings(strings);
  if (strings.length !== value.length || normalized.length === 0) {
    pushGenerationPlanIssue(issues, {
      path,
      code: "invalid_type",
      message: `${path} must include only non-empty strings.`,
      expected: "string[]",
      received: clone(value)
    });
    return undefined;
  }
  return normalized;
}

function optionalPlanRecord(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: CanvasGenerationPlanIssue[]
): Record<string, unknown> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (isRecord(value)) {
    return clone(value);
  }
  pushGenerationPlanIssue(issues, {
    path,
    code: "invalid_type",
    message: `${path} must be an object.`,
    expected: "object",
    received: clone(value)
  });
  return undefined;
}

function requirePositiveNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: CanvasGenerationPlanIssue[]
): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  pushGenerationPlanIssue(issues, {
    path,
    code: value === undefined ? "missing_field" : "invalid_value",
    message: `${path} must be a finite positive number.`,
    expected: "finite positive number",
    received: clone(value)
  });
  return null;
}

function buildGenerationPlanFailureMessage(
  missing: CanvasGenerationPlanField[],
  issues: CanvasGenerationPlanIssue[]
): string {
  if (missing.length > 0) {
    return `Generation plan missing fields: ${missing.join(", ")}`;
  }
  const invalidPaths = uniqueStrings(issues.map((issue) => issue.path));
  return `Generation plan has invalid fields: ${invalidPaths.join(", ")}`;
}

export function validateGenerationPlan(plan: unknown): CanvasGenerationPlanValidationResult {
  if (!isRecord(plan)) {
    return {
      ok: false,
      missing: [...CANVAS_GENERATION_PLAN_REQUIRED_FIELDS],
      issues: CANVAS_GENERATION_PLAN_REQUIRED_FIELDS.map((field) => ({
        path: field,
        code: "missing_field",
        message: `generationPlan.${field} is required.`,
        expected: "non-empty object",
        received: clone(plan)
      }))
    };
  }
  const missing: CanvasGenerationPlanField[] = [];
  const issues: CanvasGenerationPlanIssue[] = [];
  const targetOutcome = requirePlanSection(plan, "targetOutcome", missing, issues);
  const visualDirection = requirePlanSection(plan, "visualDirection", missing, issues);
  const layoutStrategy = requirePlanSection(plan, "layoutStrategy", missing, issues);
  const contentStrategy = requirePlanSection(plan, "contentStrategy", missing, issues);
  const componentStrategy = requirePlanSection(plan, "componentStrategy", missing, issues);
  const motionPosture = requirePlanSection(plan, "motionPosture", missing, issues);
  const responsivePosture = requirePlanSection(plan, "responsivePosture", missing, issues);
  const accessibilityPosture = requirePlanSection(plan, "accessibilityPosture", missing, issues);
  const validationTargets = requirePlanSection(plan, "validationTargets", missing, issues);

  const mode = targetOutcome
    ? requirePlanEnum(targetOutcome, "mode", "targetOutcome.mode", CANVAS_SESSION_MODES, CANVAS_SESSION_MODE_SET, issues)
    : null;
  const summary = targetOutcome
    ? requirePlanString(targetOutcome, "summary", "targetOutcome.summary", issues)
    : null;
  const profile = visualDirection
    ? requirePlanEnum(
      visualDirection,
      "profile",
      "visualDirection.profile",
      CANVAS_VISUAL_DIRECTION_PROFILES,
      CANVAS_VISUAL_DIRECTION_PROFILE_SET,
      issues
    )
    : null;
  const themeStrategy = visualDirection
    ? requirePlanEnum(
      visualDirection,
      "themeStrategy",
      "visualDirection.themeStrategy",
      CANVAS_THEME_STRATEGIES,
      CANVAS_THEME_STRATEGY_SET,
      issues
    )
    : null;
  const approach = layoutStrategy
    ? requirePlanString(layoutStrategy, "approach", "layoutStrategy.approach", issues)
    : null;
  const navigationModel = layoutStrategy
    ? requirePlanEnum(
      layoutStrategy,
      "navigationModel",
      "layoutStrategy.navigationModel",
      CANVAS_NAVIGATION_MODELS,
      CANVAS_NAVIGATION_MODEL_SET,
      issues
    )
    : null;
  const contentSource = contentStrategy
    ? requirePlanString(contentStrategy, "source", "contentStrategy.source", issues)
    : null;
  const componentMode = componentStrategy
    ? requirePlanString(componentStrategy, "mode", "componentStrategy.mode", issues)
    : null;
  const interactionStates = componentStrategy
    ? requirePlanEnumArray(
      componentStrategy,
      "interactionStates",
      "componentStrategy.interactionStates",
      CANVAS_INTERACTION_STATES,
      CANVAS_INTERACTION_STATE_SET,
      issues
    )
    : null;
  const motionLevel = motionPosture
    ? requirePlanEnum(
      motionPosture,
      "level",
      "motionPosture.level",
      CANVAS_MOTION_LEVELS,
      CANVAS_MOTION_LEVEL_SET,
      issues
    )
    : null;
  const reducedMotion = motionPosture
    ? requirePlanEnum(
      motionPosture,
      "reducedMotion",
      "motionPosture.reducedMotion",
      CANVAS_REDUCED_MOTION_POLICIES,
      CANVAS_REDUCED_MOTION_POLICY_SET,
      issues
    )
    : null;
  const primaryViewport = responsivePosture
    ? requirePlanEnum(
      responsivePosture,
      "primaryViewport",
      "responsivePosture.primaryViewport",
      CANVAS_PLAN_VIEWPORTS,
      CANVAS_VIEWPORT_SET,
      issues
    )
    : null;
  const requiredViewports = responsivePosture
    ? requirePlanEnumArray(
      responsivePosture,
      "requiredViewports",
      "responsivePosture.requiredViewports",
      CANVAS_PLAN_VIEWPORTS,
      CANVAS_VIEWPORT_SET,
      issues
    )
    : null;
  if (primaryViewport && requiredViewports && !requiredViewports.includes(primaryViewport)) {
    pushGenerationPlanIssue(issues, {
      path: "responsivePosture.requiredViewports",
      code: "invalid_value",
      message: "responsivePosture.requiredViewports must include responsivePosture.primaryViewport.",
      expected: primaryViewport,
      received: clone(requiredViewports)
    });
  }
  const accessibilityTarget = accessibilityPosture
    ? requirePlanString(accessibilityPosture, "target", "accessibilityPosture.target", issues)
    : null;
  const keyboardNavigation = accessibilityPosture
    ? requirePlanEnum(
      accessibilityPosture,
      "keyboardNavigation",
      "accessibilityPosture.keyboardNavigation",
      CANVAS_KEYBOARD_NAVIGATION_MODES,
      CANVAS_KEYBOARD_NAVIGATION_SET,
      issues
    )
    : null;
  const blockOn = validationTargets
    ? requirePlanEnumArray(
      validationTargets,
      "blockOn",
      "validationTargets.blockOn",
      CANVAS_VALIDATION_TARGET_BLOCK_ON_CODES,
      CANVAS_VALIDATION_TARGET_BLOCK_ON_SET,
      issues
    )
    : null;
  const requiredThemes = validationTargets
    ? requirePlanEnumArray(
      validationTargets,
      "requiredThemes",
      "validationTargets.requiredThemes",
      CANVAS_PLAN_THEMES,
      CANVAS_THEME_SET,
      issues
    )
    : null;
  const browserValidation = validationTargets
    ? requirePlanEnum(
      validationTargets,
      "browserValidation",
      "validationTargets.browserValidation",
      CANVAS_BROWSER_VALIDATION_MODES,
      CANVAS_BROWSER_VALIDATION_MODE_SET,
      issues
    )
    : null;
  const maxInteractionLatencyMs = validationTargets
    ? requirePositiveNumber(validationTargets, "maxInteractionLatencyMs", "validationTargets.maxInteractionLatencyMs", issues)
    : null;
  const interactionMoments = optionalPlanStringArray(plan, "interactionMoments", "interactionMoments", issues);
  const materialEffects = optionalPlanStringArray(plan, "materialEffects", "materialEffects", issues);
  const designVectors = optionalPlanRecord(plan, "designVectors", "designVectors", issues);

  if (issues.length > 0 || missing.length > 0) {
    return {
      ok: false,
      missing,
      issues
    };
  }

  return {
    ok: true,
    missing: [],
    issues: [],
    plan: {
      targetOutcome: {
        mode: mode as CanvasGenerationPlan["targetOutcome"]["mode"],
        summary: summary as string
      },
      visualDirection: {
        profile: profile as CanvasGenerationPlan["visualDirection"]["profile"],
        themeStrategy: themeStrategy as CanvasGenerationPlan["visualDirection"]["themeStrategy"]
      },
      layoutStrategy: {
        approach: approach as string,
        navigationModel: navigationModel as CanvasGenerationPlan["layoutStrategy"]["navigationModel"]
      },
      contentStrategy: {
        source: contentSource as string
      },
      componentStrategy: {
        mode: componentMode as string,
        interactionStates: interactionStates as CanvasGenerationPlan["componentStrategy"]["interactionStates"]
      },
      motionPosture: {
        level: motionLevel as CanvasGenerationPlan["motionPosture"]["level"],
        reducedMotion: reducedMotion as CanvasGenerationPlan["motionPosture"]["reducedMotion"]
      },
      responsivePosture: {
        primaryViewport: primaryViewport as CanvasGenerationPlan["responsivePosture"]["primaryViewport"],
        requiredViewports: requiredViewports as CanvasGenerationPlan["responsivePosture"]["requiredViewports"]
      },
      accessibilityPosture: {
        target: accessibilityTarget as string,
        keyboardNavigation: keyboardNavigation as CanvasGenerationPlan["accessibilityPosture"]["keyboardNavigation"]
      },
      validationTargets: {
        blockOn: blockOn as CanvasGenerationPlan["validationTargets"]["blockOn"],
        requiredThemes: requiredThemes as CanvasGenerationPlan["validationTargets"]["requiredThemes"],
        browserValidation: browserValidation as CanvasGenerationPlan["validationTargets"]["browserValidation"],
        maxInteractionLatencyMs: maxInteractionLatencyMs as number
      },
      ...(interactionMoments ? { interactionMoments } : {}),
      ...(materialEffects ? { materialEffects } : {}),
      ...(designVectors ? { designVectors } : {})
    }
  };
}

export function assessGenerationPlan(plan: unknown):
  | { status: "missing"; missing: CanvasGenerationPlanField[]; issues: CanvasGenerationPlanIssue[] }
  | { status: "invalid"; missing: CanvasGenerationPlanField[]; issues: CanvasGenerationPlanIssue[] }
  | { status: "accepted"; missing: []; issues: []; plan: CanvasGenerationPlan } {
  const validation = validateGenerationPlan(plan);
  if (validation.ok) {
    return {
      status: "accepted",
      missing: [],
      issues: [],
      plan: validation.plan
    };
  }
  if (!isNonEmptyRecord(plan)) {
    return {
      status: "missing",
      missing: validation.missing,
      issues: validation.issues
    };
  }
  return {
    status: "invalid",
    missing: validation.missing,
    issues: validation.issues
  };
}

export function resolveCanvasLibraryPolicy(document: CanvasDocument): CanvasLibraryPolicy {
  const policy = getGovernanceBlock(document, "libraryPolicy");
  return {
    icons: normalizeLibraryPolicyField(policy.icons, PROJECT_DEFAULT_LIBRARY_POLICY.icons),
    components: normalizeLibraryPolicyField(policy.components, PROJECT_DEFAULT_LIBRARY_POLICY.components),
    styling: normalizeLibraryPolicyField(policy.styling, PROJECT_DEFAULT_LIBRARY_POLICY.styling),
    motion: normalizeLibraryPolicyField(policy.motion, PROJECT_DEFAULT_LIBRARY_POLICY.motion),
    threeD: normalizeLibraryPolicyField(policy.threeD, PROJECT_DEFAULT_LIBRARY_POLICY.threeD)
  };
}

export function readCanvasIconRoles(document: CanvasDocument): CanvasIconRoles {
  const iconPolicy = getGovernanceBlock(document, "iconSystem");
  return {
    primary: readString(iconPolicy, "primary"),
    secondary: readString(iconPolicy, "secondary"),
    secondaryAlt: readString(iconPolicy, "secondaryAlt"),
    decorative: readString(iconPolicy, "decorative")
  };
}

export function buildGovernanceBlockStates(document: CanvasDocument): Record<CanvasGovernanceBlockKey, CanvasGovernanceBlockState> {
  const states = {} as Record<CanvasGovernanceBlockKey, CanvasGovernanceBlockState>;
  for (const key of GOVERNANCE_KEYS) {
    const block = document.designGovernance[key];
    let status: CanvasBlockState = "missing";
    let source: "document" | "project-default" = "document";
    if (isNonEmptyRecord(block)) {
      if (key === "generationPlan") {
        status = assessGenerationPlan(block).status === "invalid" ? "invalid" : "present";
      } else {
        const inheritedDefault = OPTIONAL_INHERITED_KEYS.has(key) ? inheritedDefaultForGovernanceKey(key) : null;
        status = inheritedDefault && stableStringify(block) === stableStringify(inheritedDefault)
          ? "inherited"
          : "present";
        if (status === "inherited") {
          source = "project-default";
        }
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
    tokensPresent: hasTokenStoreContent(document.tokens),
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
  const generationPlanStatus = assessGenerationPlan(document.designGovernance.generationPlan);
  const typographySystem = getGovernanceBlock(document, "typographySystem");
  if (generationPlanStatus.status === "missing") {
    warnings.push(buildWarning("missing-generation-plan", "generationPlan is required before mutation or save.", { auditId: "CANVAS-03" }));
  } else if (generationPlanStatus.status === "invalid") {
    warnings.push(buildWarning("invalid-generation-plan", buildGenerationPlanFailureMessage(generationPlanStatus.missing, generationPlanStatus.issues), {
      auditId: "CANVAS-03",
      severity: "error",
      details: {
        missingFields: generationPlanStatus.missing,
        issues: generationPlanStatus.issues
      }
    }));
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
        details: { assetId: asset.id, sourceType: asset.sourceType }
      }));
    }
    if (assetRequiresProvenance(asset) && !isNonEmptyRecord(asset.metadata?.provenance)) {
      warnings.push(buildWarning("asset-provenance-missing", `Asset ${asset.id} is missing provenance metadata.`, {
        auditId: "CANVAS-02",
        details: { assetId: asset.id, sourceType: asset.sourceType }
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
      if (key === "generationPlan" && generationPlanStatus.status === "invalid") {
        continue;
      }
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
  return REQUIRED_BEFORE_SAVE_KEYS.filter((key) => key === "generationPlan"
    ? states[key].status === "missing" || states[key].status === "invalid"
    : states[key].status === "missing");
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
  const policy = resolveCanvasLibraryPolicy(document);
  return (Object.entries(policy) as Array<[keyof CanvasLibraryPolicy, string[]]>)
    .some(([category, entries]) => entries.some((entry) => !APPROVED_LIBRARY_ENTRIES[category].has(entry)));
}

function hasIconPolicyViolation(document: CanvasDocument): boolean {
  const iconRoles = readCanvasIconRoles(document);
  return Object.values(iconRoles)
    .filter((entry): entry is string => Boolean(entry))
    .some((entry) => !APPROVED_LIBRARY_ENTRIES.icons.has(entry));
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

function getTokenValue(tokens: CanvasTokenStore, path: string): unknown {
  return resolveCanvasTokenValue(tokens, path, optionalString(tokens.metadata.activeModeId));
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
  for (const [index, left] of paths.entries()) {
    for (const right of paths.slice(index + 1)) {
      if (left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`)) {
        throw new Error(`Overlapping change paths: ${left} vs ${right}`);
      }
    }
  }
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = validatePath(path);
  const [leaf, ...parents] = segments.slice().reverse();
  let current: Record<string, unknown> = target;
  for (const segment of parents.reverse()) {
    const existing = current[segment];
    if (!isRecord(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[leaf as string] = clone(value);
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
      throw new Error(buildGenerationPlanFailureMessage(validation.missing, validation.issues));
    }
    const nextDocument = normalizeCanvasDocument(this.document);
    nextDocument.designGovernance.generationPlan = clone(validation.plan);
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

  replaceDocumentState(baseRevision: number, document: CanvasDocument): PatchResult {
    if (baseRevision !== this.revision) {
      throw new Error(`Revision conflict: expected ${this.revision}, got ${baseRevision}`);
    }
    this.replaceDocument(normalizeCanvasDocument(document), this.revision + 1, "canvas.store.replace-document");
    return {
      transactionId: `txn_${randomUUID()}`,
      appliedRevision: this.revision,
      warnings: evaluateCanvasWarnings(this.document),
      evidenceRefs: []
    };
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
      case "node.reparent": {
        reparentNode(document, patch.nodeId, patch.parentId, patch.index);
        return;
      }
      case "node.reorder": {
        reorderNode(document, patch.nodeId, patch.index);
        return;
      }
      case "node.duplicate": {
        duplicateNodeSubtree(document, patch.nodeId, patch.parentId, patch.index, patch.idMap);
        return;
      }
      case "node.visibility.set": {
        const node = findNode(document, patch.nodeId);
        const visibility = isRecord(node.metadata.visibility) ? clone(node.metadata.visibility) : {};
        visibility.hidden = patch.hidden;
        node.metadata.visibility = visibility;
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
      case "tokens.merge": {
        document.tokens = mergeCanvasTokenStore(document.tokens, patch.tokens);
        return;
      }
      case "tokens.replace": {
        document.tokens = normalizeCanvasTokenStore(patch.tokens);
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
        const binding = normalizeBinding({
          id: patch.binding.id,
          nodeId: patch.nodeId,
          kind: patch.binding.kind,
          selector: patch.binding.selector,
          componentName: patch.binding.componentName,
          metadata: isRecord(patch.binding.metadata) ? clone(patch.binding.metadata) : {},
          codeSync: patch.binding.codeSync
        });
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
      case "binding.remove": {
        const existing = document.bindings.find((entry) => entry.id === patch.bindingId);
        if (!existing) {
          return;
        }
        document.bindings = document.bindings.filter((entry) => entry.id !== patch.bindingId);
        const node = findNode(document, existing.nodeId);
        if (node.bindingRefs.primary === patch.bindingId) {
          delete node.bindingRefs.primary;
        }
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
        return;
      }
      case "inventory.promote": {
        const item = buildInventoryItemFromNode(document, patch.nodeId, {
          itemId: patch.itemId,
          name: patch.name,
          description: patch.description,
          origin: patch.origin,
          metadata: patch.metadata
        });
        const existing = document.componentInventory.findIndex((entry) => entry.id === item.id);
        if (existing >= 0) {
          document.componentInventory[existing] = item;
        } else {
          document.componentInventory.push(item);
        }
        return;
      }
      case "inventory.update": {
        const index = document.componentInventory.findIndex((entry) => entry.id === patch.itemId);
        if (index < 0) {
          throw new Error(`Unknown inventory item: ${patch.itemId}`);
        }
        assertNoOverlappingPaths(patch.changes);
        ensureAllowedRoots(patch.changes, [
          "name",
          "componentName",
          "description",
          "sourceKind",
          "sourceFamily",
          "origin",
          "framework",
          "adapter",
          "plugin",
          "variants",
          "props",
          "slots",
          "events",
          "content",
          "metadata"
        ]);
        const nextValue = clone(document.componentInventory[index]) as Record<string, unknown>;
        for (const [path, value] of Object.entries(patch.changes)) {
          setNestedValue(nextValue, path, value);
        }
        document.componentInventory[index] = normalizeCanvasComponentInventoryItem(nextValue, index + 1)!;
        return;
      }
      case "inventory.upsert": {
        const item = normalizeCanvasComponentInventoryItem(patch.item, document.componentInventory.length + 1);
        if (!item) {
          throw new Error("Invalid inventory item for inventory.upsert");
        }
        const existing = document.componentInventory.findIndex((entry) => entry.id === item.id);
        if (existing >= 0) {
          document.componentInventory[existing] = item;
        } else {
          document.componentInventory.push(item);
        }
        return;
      }
      case "inventory.remove": {
        document.componentInventory = document.componentInventory.filter((entry) => entry.id !== patch.itemId);
        return;
      }
      case "starter.apply": {
        document.meta.starter = normalizeCanvasStarterApplication(patch.starter);
        return;
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

function findNodeLocation(
  document: CanvasDocument,
  nodeId: string
): {
  page: CanvasPage;
  node: CanvasNode;
  parent: CanvasNode | null;
  index: number;
} {
  for (const page of document.pages) {
    const node = page.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      continue;
    }
    const parent = node.parentId
      ? page.nodes.find((entry) => entry.id === node.parentId) ?? null
      : null;
    const siblings = parent ? parent.childIds : page.rootNodeId ? [page.rootNodeId] : [];
    return {
      page,
      node,
      parent,
      index: siblings.indexOf(node.id)
    };
  }
  throw new Error(`Unknown node: ${nodeId}`);
}

function clampSiblingIndex(index: number | undefined, length: number): number {
  if (typeof index !== "number" || !Number.isInteger(index)) {
    return length;
  }
  return Math.max(0, Math.min(index, length));
}

function insertNodeReference(
  page: CanvasPage,
  nodeId: string,
  parentId: string | null,
  index?: number
): void {
  if (parentId) {
    const parent = page.nodes.find((entry) => entry.id === parentId);
    if (!parent) {
      throw new Error(`Unknown parent node: ${parentId}`);
    }
    const nextIndex = clampSiblingIndex(index, parent.childIds.length);
    parent.childIds.splice(nextIndex, 0, nodeId);
    return;
  }
  if (page.rootNodeId && page.rootNodeId !== nodeId) {
    throw new Error(`Page already has a root node: ${page.id}`);
  }
  page.rootNodeId = nodeId;
}

function detachNodeReference(page: CanvasPage, node: CanvasNode): void {
  if (node.parentId) {
    const parent = page.nodes.find((entry) => entry.id === node.parentId);
    if (parent) {
      parent.childIds = parent.childIds.filter((childId) => childId !== node.id);
    }
    return;
  }
  if (page.rootNodeId === node.id) {
    page.rootNodeId = null;
  }
}

function isDescendantNode(page: CanvasPage, nodeId: string, potentialAncestorId: string): boolean {
  const node = page.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return false;
  }
  let currentParentId = node.parentId;
  while (currentParentId) {
    if (currentParentId === potentialAncestorId) {
      return true;
    }
    const parent = page.nodes.find((entry) => entry.id === currentParentId);
    currentParentId = parent?.parentId ?? null;
  }
  return false;
}

function reparentNode(document: CanvasDocument, nodeId: string, parentId: string | null, index?: number): void {
  const { page, node } = findNodeLocation(document, nodeId);
  if (parentId === node.id) {
    throw new Error(`Cannot reparent node into itself: ${node.id}`);
  }
  if (parentId && isDescendantNode(page, parentId, node.id)) {
    throw new Error(`Cannot reparent node into its own descendant: ${node.id}`);
  }
  if (parentId) {
    const nextParent = page.nodes.find((entry) => entry.id === parentId);
    if (!nextParent) {
      throw new Error(`Unknown parent node: ${parentId}`);
    }
  }
  detachNodeReference(page, node);
  node.parentId = parentId;
  node.pageId = page.id;
  insertNodeReference(page, node.id, parentId, index);
}

function reorderNode(document: CanvasDocument, nodeId: string, index: number): void {
  const { page, node, parent } = findNodeLocation(document, nodeId);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid sibling index: ${index}`);
  }
  if (!parent) {
    if (index !== 0) {
      throw new Error("Root node can only exist at index 0.");
    }
    return;
  }
  const siblings = [...parent.childIds];
  const currentIndex = siblings.indexOf(node.id);
  if (currentIndex < 0) {
    throw new Error(`Node is not attached to its parent: ${node.id}`);
  }
  siblings.splice(currentIndex, 1);
  const nextIndex = clampSiblingIndex(index, siblings.length);
  siblings.splice(nextIndex, 0, node.id);
  parent.childIds = siblings;
  node.pageId = page.id;
}

function duplicateNodeSubtree(
  document: CanvasDocument,
  nodeId: string,
  parentId?: string | null,
  index?: number,
  idMapInput?: Record<string, string>
): { duplicatedNodeId: string; duplicatedNodeIds: string[] } {
  const { page, node } = findNodeLocation(document, nodeId);
  const targetParentId = parentId === undefined ? node.parentId : parentId;
  if (targetParentId === node.id) {
    throw new Error(`Cannot duplicate node into itself: ${node.id}`);
  }
  if (targetParentId && isDescendantNode(page, targetParentId, node.id)) {
    throw new Error(`Cannot duplicate node into its own descendant: ${node.id}`);
  }
  const idMap = new Map<string, string>();
  const duplicates: CanvasNode[] = [];
  const walk = (sourceNodeId: string, nextParentId: string | null): string => {
    const sourceNode = page.nodes.find((entry) => entry.id === sourceNodeId);
    if (!sourceNode) {
      throw new Error(`Unknown node: ${sourceNodeId}`);
    }
    const mappedId = isRecord(idMapInput) ? idMapInput[sourceNode.id] : null;
    const duplicateId = typeof mappedId === "string" && mappedId.trim().length > 0
      ? mappedId
      : `${sourceNode.id}_copy_${randomUUID().slice(0, 8)}`;
    idMap.set(sourceNode.id, duplicateId);
    const nextMetadata = clone(sourceNode.metadata);
    if (isRecord(nextMetadata.codeSync)) {
      delete nextMetadata.codeSync;
    }
    const duplicateNode: CanvasNode = {
      id: duplicateId,
      kind: sourceNode.kind,
      name: `${sourceNode.name} Copy`,
      pageId: page.id,
      parentId: nextParentId,
      childIds: [],
      rect: clone(sourceNode.rect),
      props: clone(sourceNode.props),
      style: clone(sourceNode.style),
      tokenRefs: clone(sourceNode.tokenRefs),
      bindingRefs: {},
      variantPatches: clone(sourceNode.variantPatches),
      metadata: nextMetadata
    };
    duplicates.push(duplicateNode);
    duplicateNode.childIds = sourceNode.childIds.map((childId) => walk(childId, duplicateId));
    return duplicateId;
  };
  const duplicateRootId = walk(node.id, targetParentId ?? null);
  page.nodes.push(...duplicates);
  insertNodeReference(page, duplicateRootId, targetParentId ?? null, index);
  return {
    duplicatedNodeId: duplicateRootId,
    duplicatedNodeIds: duplicates.map((entry) => entry.id)
  };
}

export const CANVAS_PROJECT_DEFAULTS = {
  libraryPolicy: PROJECT_DEFAULT_LIBRARY_POLICY,
  runtimeBudgets: PROJECT_DEFAULT_RUNTIME_BUDGETS
};
