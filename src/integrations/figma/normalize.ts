export type NormalizedFigmaColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type NormalizedFigmaPaint = {
  type: string;
  visible: boolean;
  opacity: number;
  color: NormalizedFigmaColor | null;
  imageRef: string | null;
  scaleMode: string | null;
};

export type NormalizedFigmaNode = {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  characters: string | null;
  fills: NormalizedFigmaPaint[];
  strokes: NormalizedFigmaPaint[];
  strokeWeight: number | null;
  cornerRadius: number | null;
  layoutMode: string | null;
  itemSpacing: number | null;
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  primaryAxisAlignItems: string | null;
  counterAxisAlignItems: string | null;
  layoutSizingHorizontal: string | null;
  layoutSizingVertical: string | null;
  componentId: string | null;
  componentSetId: string | null;
  boundVariables: Record<string, unknown>;
  vectorPaths: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  children: NormalizedFigmaNode[];
};

export type NormalizedFigmaComponent = {
  id: string;
  name: string;
  description: string | null;
  componentSetId: string | null;
};

export type NormalizedFigmaVariable = {
  id: string;
  name: string;
  resolvedType: string | null;
  collectionId: string | null;
  valuesByModeId: Record<string, unknown>;
  scopes: string[];
  hiddenFromPublishing: boolean;
  codeSyntax: Record<string, unknown>;
  aliasesByModeId: Record<string, string>;
};

export type NormalizedFigmaVariableCollection = {
  id: string;
  name: string;
  hiddenFromPublishing: boolean;
  defaultModeId: string | null;
  modes: Array<{ modeId: string; name: string }>;
  variableIds: string[];
};

export type NormalizedFigmaVariablePayload = {
  collections: NormalizedFigmaVariableCollection[];
  variables: NormalizedFigmaVariable[];
};

export type NormalizedFigmaImportPayload = {
  fileKey: string;
  fileName: string | null;
  sourceKind: "file" | "nodes";
  versionId: string | null;
  branchId: string | null;
  rootNodes: NormalizedFigmaNode[];
  components: Record<string, NormalizedFigmaComponent>;
  componentSets: Record<string, NormalizedFigmaComponent>;
  images: Record<string, string>;
  variables: NormalizedFigmaVariablePayload | null;
  metadata: Record<string, unknown>;
};

export function normalizeFigmaFilePayload(fileKey: string, raw: unknown): NormalizedFigmaImportPayload {
  const record = asRecord(raw);
  const document = normalizeFigmaNode(record.document, 0);
  const rootNodes = document?.children.filter((child) => child.type === "CANVAS") ?? [];
  return {
    fileKey,
    fileName: optionalString(record.name),
    sourceKind: "file",
    versionId: optionalString(record.version),
    branchId: readNestedString(record, ["branch_data", "branchId"]),
    rootNodes,
    components: normalizeComponentMap(record.components),
    componentSets: normalizeComponentMap(record.componentSets),
    images: {},
    variables: null,
    metadata: {
      role: "file",
      documentType: document?.type ?? null
    }
  };
}

export function normalizeFigmaNodesPayload(fileKey: string, raw: unknown): NormalizedFigmaImportPayload {
  const record = asRecord(raw);
  const nodesRecord = asRecord(record.nodes);
  const rootNodes: NormalizedFigmaNode[] = [];
  for (const entry of Object.values(nodesRecord)) {
    const entryRecord = asRecord(entry);
    const node = normalizeFigmaNode(entryRecord.document, 0);
    if (node) {
      rootNodes.push(node);
    }
  }
  return {
    fileKey,
    fileName: null,
    sourceKind: "nodes",
    versionId: optionalString(record.version),
    branchId: readNestedString(record, ["branch_data", "branchId"]),
    rootNodes,
    components: normalizeComponentMap(record.components),
    componentSets: normalizeComponentMap(record.componentSets),
    images: {},
    variables: null,
    metadata: {
      role: "nodes",
      nodeCount: rootNodes.length
    }
  };
}

export function normalizeFigmaImagesPayload(raw: unknown): Record<string, string> {
  const record = asRecord(raw);
  const images = asRecord(record.images);
  return Object.fromEntries(
    Object.entries(images)
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([key, value]) => [key, (value as string).trim()])
  );
}

export function normalizeFigmaVariablesPayload(raw: unknown): NormalizedFigmaVariablePayload {
  const record = asRecord(raw);
  const meta = asRecord(record.meta);
  const collections = normalizeCollections(meta.variableCollections ?? meta.collections);
  const variables = normalizeVariables(meta.variables);
  return { collections, variables };
}

function normalizeCollections(value: unknown): NormalizedFigmaVariableCollection[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    const id = optionalString(record.id);
    const name = optionalString(record.name);
    if (!id || !name) {
      return [];
    }
    return [{
      id,
      name,
      hiddenFromPublishing: record.hiddenFromPublishing === true,
      defaultModeId: optionalString(record.defaultModeId),
      modes: asArray(record.modes).flatMap((modeEntry) => {
        const mode = asRecord(modeEntry);
        const modeId = optionalString(mode.modeId);
        const modeName = optionalString(mode.name);
        return modeId && modeName ? [{ modeId, name: modeName }] : [];
      }),
      variableIds: asArray(record.variableIds).flatMap((variableId) => typeof variableId === "string" && variableId.trim().length > 0 ? [variableId] : [])
    }];
  });
}

function normalizeVariables(value: unknown): NormalizedFigmaVariable[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    const id = optionalString(record.id);
    const name = optionalString(record.name);
    if (!id || !name) {
      return [];
    }
    const valuesByModeId = asRecord(record.valuesByMode);
    const aliasesByModeId = Object.fromEntries(
      Object.entries(valuesByModeId)
        .filter(([, variableValue]) => isAliasValue(variableValue))
        .map(([modeId, variableValue]) => [modeId, (variableValue as { id: string }).id])
    );
    return [{
      id,
      name,
      resolvedType: optionalString(record.resolvedType),
      collectionId: optionalString(record.variableCollectionId),
      valuesByModeId: Object.fromEntries(
        Object.entries(valuesByModeId).map(([modeId, variableValue]) => [modeId, normalizeVariableValue(variableValue)])
      ),
      scopes: asArray(record.scopes).flatMap((scope) => typeof scope === "string" && scope.trim().length > 0 ? [scope] : []),
      hiddenFromPublishing: record.hiddenFromPublishing === true,
      codeSyntax: asRecord(record.codeSyntax),
      aliasesByModeId
    }];
  });
}

function normalizeComponentMap(value: unknown): Record<string, NormalizedFigmaComponent> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).flatMap(([key, entry]) => {
      const record = asRecord(entry);
      const id = optionalString(record.key) ?? key;
      const name = optionalString(record.name);
      if (!name) {
        return [];
      }
      return [[id, {
        id,
        name,
        description: optionalString(record.description),
        componentSetId: optionalString(record.componentSetId)
      } satisfies NormalizedFigmaComponent]];
    })
  );
}

function normalizeFigmaNode(value: unknown, index: number): NormalizedFigmaNode | null {
  const record = asRecord(value);
  const id = optionalString(record.id) ?? `figma-node-${index}`;
  const name = optionalString(record.name) ?? id;
  const type = optionalString(record.type);
  if (!type) {
    return null;
  }
  const absoluteBoundingBox = asRecord(record.absoluteBoundingBox);
  const size = asRecord(record.size);
  const x = readNumber(absoluteBoundingBox.x, 0);
  const y = readNumber(absoluteBoundingBox.y, 0);
  const width = readNumber(absoluteBoundingBox.width, readNumber(size.x, 320));
  const height = readNumber(absoluteBoundingBox.height, readNumber(size.y, 180));
  return {
    id,
    name,
    type,
    visible: record.visible !== false,
    rect: { x, y, width, height },
    characters: optionalString(record.characters),
    fills: normalizePaints(record.fills),
    strokes: normalizePaints(record.strokes),
    strokeWeight: readOptionalNumber(record.strokeWeight),
    cornerRadius: readOptionalNumber(record.cornerRadius),
    layoutMode: optionalString(record.layoutMode),
    itemSpacing: readOptionalNumber(record.itemSpacing),
    padding: {
      top: readNumber(record.paddingTop, 0),
      right: readNumber(record.paddingRight, 0),
      bottom: readNumber(record.paddingBottom, 0),
      left: readNumber(record.paddingLeft, 0)
    },
    primaryAxisAlignItems: optionalString(record.primaryAxisAlignItems),
    counterAxisAlignItems: optionalString(record.counterAxisAlignItems),
    layoutSizingHorizontal: optionalString(record.layoutSizingHorizontal),
    layoutSizingVertical: optionalString(record.layoutSizingVertical),
    componentId: optionalString(record.componentId),
    componentSetId: optionalString(record.componentSetId),
    boundVariables: asRecord(record.boundVariables),
    vectorPaths: asArray(record.fillGeometry).flatMap((entry) => isRecord(entry) ? [structuredClone(entry)] : []),
    metadata: collectNodeMetadata(record),
    children: asArray(record.children).flatMap((entry, childIndex) => {
      const child = normalizeFigmaNode(entry, childIndex);
      return child ? [child] : [];
    })
  };
}

function normalizePaints(value: unknown): NormalizedFigmaPaint[] {
  return asArray(value).flatMap((entry) => {
    const record = asRecord(entry);
    const type = optionalString(record.type);
    if (!type) {
      return [];
    }
    return [{
      type,
      visible: record.visible !== false,
      opacity: readNumber(record.opacity, 1),
      color: normalizeColor(record.color),
      imageRef: optionalString(record.imageRef),
      scaleMode: optionalString(record.scaleMode)
    }];
  });
}

function normalizeColor(value: unknown): NormalizedFigmaColor | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return null;
  }
  return {
    r: readNumber(record.r, 0),
    g: readNumber(record.g, 0),
    b: readNumber(record.b, 0),
    a: readNumber(record.a, 1)
  };
}

function collectNodeMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const key of [
    "blendMode",
    "constraints",
    "layoutAlign",
    "layoutGrow",
    "layoutPositioning",
    "counterAxisSizingMode",
    "primaryAxisSizingMode",
    "clipsContent",
    "boundVariables",
    "transitionNodeID",
    "effects",
    "strokesIncludedInLayout",
    "textAutoResize",
    "style",
    "styles"
  ]) {
    if (key in record) {
      metadata[key] = structuredClone(record[key]);
    }
  }
  return metadata;
}

function normalizeVariableValue(value: unknown): unknown {
  if (isAliasValue(value)) {
    return { aliasTo: value.id };
  }
  if (isRecord(value)) {
    return structuredClone(value);
  }
  return value ?? null;
}

function isAliasValue(value: unknown): value is { type?: unknown; id: string } {
  return isRecord(value) && typeof value.id === "string" && (value.type === "VARIABLE_ALIAS" || "id" in value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNestedString(record: Record<string, unknown>, keys: string[]): string | null {
  let current: unknown = record;
  for (const key of keys) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[key];
  }
  return optionalString(current);
}
