import type {
  CanvasAsset,
  CanvasComponentContentContract,
  CanvasComponentInventoryItem,
  CanvasImportFailureCode,
  CanvasNode,
  CanvasPage,
  CanvasTokenStore
} from "../../canvas/types";
import type { NormalizedFigmaImportPayload, NormalizedFigmaNode } from "./normalize";
import type { FigmaVariableMappingResult } from "./variables";
import { mapFigmaBoundVariables } from "./variables";

export type FigmaImportMappingResult = {
  pages: CanvasPage[];
  componentInventory: CanvasComponentInventoryItem[];
  tokens: CanvasTokenStore;
  assets: CanvasAsset[];
  importedPageIds: string[];
  importedNodeIds: string[];
  importedInventoryItemIds: string[];
  importedTokenCollectionIds: string[];
  degradedFailureCodes: CanvasImportFailureCode[];
};

export function mapFigmaImportToCanvas(options: {
  payload: NormalizedFigmaImportPayload;
  assets: CanvasAsset[];
  variables: FigmaVariableMappingResult | null;
  requestedFrameworkId?: string | null;
  requestedFrameworkAdapterId?: string | null;
  frameworkMaterialized?: boolean;
}): FigmaImportMappingResult {
  const degradedFailureCodes = new Set<CanvasImportFailureCode>();
  const inventory = buildInventoryItems(
    options.payload,
    options.requestedFrameworkId ?? null,
    options.requestedFrameworkAdapterId ?? null,
    options.frameworkMaterialized === true
  );
  const assetIdsByNodeId = new Map<string, string[]>();
  for (const asset of options.assets) {
    const nodeId = optionalString(asset.metadata?.nodeId);
    if (!nodeId) {
      continue;
    }
    const bucket = assetIdsByNodeId.get(nodeId) ?? [];
    bucket.push(asset.id);
    assetIdsByNodeId.set(nodeId, bucket);
  }
  const pages = options.payload.rootNodes.map((rootNode, index) => createPageFromRootNode({
    rootNode,
    payload: options.payload,
    pageIndex: index,
    variableMapping: options.variables,
    assetIdsByNodeId,
    degradedFailureCodes
  }));
  if (options.requestedFrameworkId && options.frameworkMaterialized !== true) {
    degradedFailureCodes.add("framework_materializer_missing");
  }
  const importedNodeIds = pages.flatMap((page) => page.nodes.map((node) => node.id));
  const tokenStore = options.variables
    ? {
      ...options.variables.tokenStore,
      bindings: pages.flatMap((page) => page.nodes).flatMap((node) => extractTokenBindings(node))
    }
    : {
      values: {},
      collections: [],
      aliases: [],
      bindings: [],
      metadata: {}
    };
  return {
    pages,
    componentInventory: inventory,
    tokens: tokenStore,
    assets: options.assets,
    importedPageIds: pages.map((page) => page.id),
    importedNodeIds,
    importedInventoryItemIds: inventory.map((item) => item.id),
    importedTokenCollectionIds: tokenStore.collections.map((collection) => collection.id),
    degradedFailureCodes: [...degradedFailureCodes]
  };
}

function buildInventoryItems(
  payload: NormalizedFigmaImportPayload,
  requestedFrameworkId: string | null,
  requestedFrameworkAdapterId: string | null,
  frameworkMaterialized: boolean
): CanvasComponentInventoryItem[] {
  const items: CanvasComponentInventoryItem[] = [];
  const seen = new Set<string>();
  for (const component of [
    ...Object.values(payload.componentSets),
    ...Object.values(payload.components)
  ]) {
    if (seen.has(component.id)) {
      continue;
    }
    seen.add(component.id);
    items.push({
      id: buildInventoryId(component.id),
      name: component.name,
      componentName: component.name,
      description: component.description,
      sourceKind: "figma_component",
      sourceFamily: "design_import",
      origin: "import",
      framework: frameworkMaterialized && requestedFrameworkId
        ? {
          id: requestedFrameworkId,
          label: requestedFrameworkId,
          adapter: requestedFrameworkAdapterId
            ? {
              id: requestedFrameworkAdapterId,
              label: requestedFrameworkAdapterId,
              metadata: {}
            }
            : null,
          metadata: {
            source: "figma"
          }
        }
        : null,
      adapter: frameworkMaterialized && requestedFrameworkAdapterId
        ? {
          id: requestedFrameworkAdapterId,
          label: requestedFrameworkAdapterId,
          metadata: {
            source: "figma"
          }
        }
        : null,
      plugin: null,
      variants: [],
      props: [],
      slots: [],
      events: [],
      content: emptyContentContract(),
      metadata: {
        source: "figma",
        componentId: component.id,
        componentSetId: component.componentSetId
      }
    });
  }
  return items;
}

function createPageFromRootNode(options: {
  rootNode: NormalizedFigmaNode;
  payload: NormalizedFigmaImportPayload;
  pageIndex: number;
  variableMapping: FigmaVariableMappingResult | null;
  assetIdsByNodeId: Map<string, string[]>;
  degradedFailureCodes: Set<CanvasImportFailureCode>;
}): CanvasPage {
  const pageId = options.rootNode.type === "CANVAS"
    ? `figma-page-${options.rootNode.id}`
    : `figma-page-import-${options.pageIndex + 1}`;
  const pageName = options.rootNode.type === "CANVAS"
    ? options.rootNode.name
    : `${options.payload.fileName ?? "Figma"} / ${options.rootNode.name}`;
  const nodeRoots = options.rootNode.type === "CANVAS" ? options.rootNode.children : [options.rootNode];
  const nodes = nodeRoots.flatMap((node) => flattenNodeTree(node, pageId, null, options.variableMapping, options.assetIdsByNodeId, options.degradedFailureCodes));
  return {
    id: pageId,
    name: pageName,
    path: `/${normalizePagePath(pageName)}`,
    rootNodeId: nodes[0]?.id ?? null,
    prototypeIds: [],
    nodes,
    metadata: {
      source: "figma",
      figmaNodeId: options.rootNode.id,
      sourceKind: options.payload.sourceKind
    }
  };
}

function flattenNodeTree(
  node: NormalizedFigmaNode,
  pageId: string,
  parentId: string | null,
  variableMapping: FigmaVariableMappingResult | null,
  assetIdsByNodeId: Map<string, string[]>,
  degradedFailureCodes: Set<CanvasImportFailureCode>
): CanvasNode[] {
  const nodeId = `figma-node-${node.id}`;
  const kind = mapNodeKind(node.type, degradedFailureCodes);
  const childNodes = node.children.flatMap((child) => flattenNodeTree(child, pageId, nodeId, variableMapping, assetIdsByNodeId, degradedFailureCodes));
  const variableBindings = variableMapping
    ? mapFigmaBoundVariables(nodeId, node.boundVariables, variableMapping.variableLookup)
    : { tokenRefs: {}, bindings: [], unresolved: [] };
  const metadata: Record<string, unknown> = {
    source: "figma",
    figmaNodeId: node.id,
    figmaType: node.type,
    visible: node.visible,
    ...structuredClone(node.metadata)
  };
  const assetIds = assetIdsByNodeId.get(node.id) ?? [];
  if (assetIds.length > 0) {
    metadata.assetIds = [...assetIds];
  }
  if (!variableMapping && Object.keys(node.boundVariables).length > 0) {
    metadata.figmaBoundVariables = structuredClone(node.boundVariables);
  }
  if (variableBindings.unresolved.length > 0) {
    metadata.unresolvedBoundVariables = variableBindings.unresolved.map((entry) => ({ ...entry }));
  }
  const currentNode: CanvasNode = {
    id: nodeId,
    kind,
    name: node.name,
    pageId,
    parentId,
    childIds: childNodes
      .filter((child) => child.parentId === nodeId)
      .map((child) => child.id),
    rect: { ...node.rect },
    props: buildNodeProps(node),
    style: buildNodeStyle(node),
    tokenRefs: variableBindings.tokenRefs,
    bindingRefs: {},
    variantPatches: [],
    metadata
  };
  if (kind === "component-instance") {
    currentNode.props.inventoryItemId = buildInventoryId(node.componentId ?? node.componentSetId ?? node.id);
  }
  currentNode.metadata.tokenBindings = variableBindings.bindings;
  return [currentNode, ...childNodes];
}

function mapNodeKind(type: string, degradedFailureCodes: Set<CanvasImportFailureCode>): CanvasNode["kind"] {
  switch (type) {
    case "FRAME":
    case "SECTION":
      return "frame";
    case "GROUP":
      return "group";
    case "TEXT":
      return "text";
    case "COMPONENT":
    case "COMPONENT_SET":
    case "INSTANCE":
      return "component-instance";
    case "RECTANGLE":
    case "ELLIPSE":
    case "REGULAR_POLYGON":
    case "STAR":
    case "VECTOR":
    case "LINE":
    case "BOOLEAN_OPERATION":
      return "shape";
    default:
      degradedFailureCodes.add("unsupported_figma_node");
      return "group";
  }
}

function buildNodeProps(node: NormalizedFigmaNode): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (node.characters) {
    props.textContent = node.characters;
  }
  if (node.layoutMode) {
    props.direction = node.layoutMode === "VERTICAL" ? "column" : node.layoutMode === "HORIZONTAL" ? "row" : undefined;
  }
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}

function buildNodeStyle(node: NormalizedFigmaNode): Record<string, unknown> {
  const style: Record<string, unknown> = {
    width: node.rect.width,
    height: node.rect.height
  };
  if (node.layoutMode === "VERTICAL") {
    style.display = "flex";
    style.flexDirection = "column";
  } else if (node.layoutMode === "HORIZONTAL") {
    style.display = "flex";
    style.flexDirection = "row";
  }
  if (node.itemSpacing !== null) {
    style.gap = node.itemSpacing;
  }
  if (node.padding.top || node.padding.right || node.padding.bottom || node.padding.left) {
    style.paddingTop = node.padding.top;
    style.paddingRight = node.padding.right;
    style.paddingBottom = node.padding.bottom;
    style.paddingLeft = node.padding.left;
  }
  if (node.cornerRadius !== null) {
    style.borderRadius = node.cornerRadius;
  }
  if (node.strokeWeight !== null) {
    style.borderWidth = node.strokeWeight;
  }
  const fill = node.fills.find((entry) => entry.visible && entry.color);
  if (fill?.color) {
    style.backgroundColor = colorToCss(fill.color);
    if (node.type === "TEXT") {
      style.color = colorToCss(fill.color);
      delete style.backgroundColor;
    }
  }
  const stroke = node.strokes.find((entry) => entry.visible && entry.color);
  if (stroke?.color) {
    style.borderColor = colorToCss(stroke.color);
  }
  return style;
}

function extractTokenBindings(node: CanvasNode): CanvasTokenStore["bindings"] {
  const bindings = Array.isArray(node.metadata.tokenBindings) ? node.metadata.tokenBindings : [];
  return bindings.flatMap((binding) => isRecord(binding) ? [structuredClone(binding) as CanvasTokenStore["bindings"][number]] : []);
}

function buildInventoryId(componentId: string): string {
  return `figma-component-${componentId}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function emptyContentContract(): CanvasComponentContentContract {
  return {
    acceptsText: false,
    acceptsRichText: false,
    slotNames: [],
    metadata: {}
  };
}

function normalizePagePath(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "figma-import";
}

function colorToCss(color: { r: number; g: number; b: number; a: number }): string {
  const red = Math.round(color.r * 255);
  const green = Math.round(color.g * 255);
  const blue = Math.round(color.b * 255);
  return color.a < 1 ? `rgba(${red}, ${green}, ${blue}, ${color.a})` : `rgb(${red}, ${green}, ${blue})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
