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
  overflowRenderMode: "thumbnail_only"
};

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
    assets: Array.isArray(base.assets) ? clone(base.assets) : [],
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
      status = OPTIONAL_INHERITED_KEYS.has(key) && stableStringify(block) === stableStringify(key === "libraryPolicy"
        ? PROJECT_DEFAULT_LIBRARY_POLICY
        : key === "runtimeBudgets"
          ? PROJECT_DEFAULT_RUNTIME_BUDGETS
          : block)
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
  warnings: string[];
  evidenceRefs: string[];
};

export class CanvasDocumentStore {
  private readonly ydoc = new Y.Doc();
  private readonly root = this.ydoc.getMap<unknown>("canvas");
  private document: CanvasDocument;
  private revision = 1;

  constructor(document?: CanvasDocument) {
    this.document = normalizeCanvasDocument(document ?? createDefaultCanvasDocument());
    this.commitProjection();
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

  setGenerationPlan(plan: CanvasGenerationPlan): { planStatus: "accepted"; documentRevision: number } {
    const validation = validateGenerationPlan(plan);
    if (!validation.ok) {
      throw new Error(`Generation plan missing fields: ${validation.missing.join(", ")}`);
    }
    this.document.designGovernance.generationPlan = clone(plan);
    this.bumpRevision();
    return { planStatus: "accepted", documentRevision: this.revision };
  }

  applyPatches(baseRevision: number, patches: CanvasPatch[]): PatchResult {
    if (baseRevision !== this.revision) {
      throw new Error(`Revision conflict: expected ${this.revision}, got ${baseRevision}`);
    }
    const nextDocument = normalizeCanvasDocument(this.document);
    for (const patch of patches) {
      this.applyPatch(nextDocument, patch);
    }
    this.document = nextDocument;
    this.bumpRevision();
    return {
      transactionId: `txn_${randomUUID()}`,
      appliedRevision: this.revision,
      warnings: [],
      evidenceRefs: []
    };
  }

  loadDocument(document: CanvasDocument): void {
    this.document = normalizeCanvasDocument(document);
    this.revision = 1;
    this.commitProjection();
  }

  private bumpRevision(): void {
    this.document.updatedAt = nowIso();
    this.revision += 1;
    this.commitProjection();
  }

  private commitProjection(): void {
    const snapshot = stableStringify(this.document);
    this.ydoc.transact(() => {
      this.root.set("projection", snapshot);
      this.root.set("documentId", this.document.documentId);
      this.root.set("revision", this.revision);
      this.root.set("updatedAt", this.document.updatedAt);
    });
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
        ensureAllowedRoots(patch.changes, ["name", "props", "style", "tokenRefs", "bindingRefs", "metadata"]);
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
      case "asset.attach": {
        const node = findNode(document, patch.nodeId);
        const assetIds = Array.isArray(node.metadata.assetIds) ? [...node.metadata.assetIds as string[]] : [];
        if (!assetIds.includes(patch.assetId)) {
          assetIds.push(patch.assetId);
        }
        node.metadata.assetIds = assetIds;
        if (!document.assets.some((asset) => asset.id === patch.assetId)) {
          document.assets.push({ id: patch.assetId, metadata: {} });
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
