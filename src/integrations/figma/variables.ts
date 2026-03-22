import type {
  CanvasTokenAlias,
  CanvasTokenBinding,
  CanvasTokenCollection,
  CanvasTokenItem,
  CanvasTokenMode,
  CanvasTokenStore
} from "../../canvas/types";
import type { NormalizedFigmaVariablePayload } from "./normalize";

export type FigmaVariableLookupEntry = {
  variableId: string;
  path: string;
  collectionId: string;
};

export type FigmaVariableMappingResult = {
  tokenStore: CanvasTokenStore;
  variableLookup: Record<string, FigmaVariableLookupEntry>;
};

export function mapFigmaVariablesToTokenStore(payload: NormalizedFigmaVariablePayload): FigmaVariableMappingResult {
  const lookup: Record<string, FigmaVariableLookupEntry> = {};
  const collectionById = new Map(payload.collections.map((collection) => [collection.id, collection]));
  const variableByCollection = new Map<string, typeof payload.variables>();
  for (const variable of payload.variables) {
    const collectionId = variable.collectionId ?? "figma:unscoped";
    const bucket = variableByCollection.get(collectionId) ?? [];
    bucket.push(variable);
    variableByCollection.set(collectionId, bucket);
  }

  const collections: CanvasTokenCollection[] = [];
  const aliases: CanvasTokenAlias[] = [];
  const values: Record<string, unknown> = {};

  for (const [collectionId, variables] of variableByCollection.entries()) {
    const collection = collectionById.get(collectionId);
    const collectionName = collection?.name ?? "Imported";
    const items: CanvasTokenItem[] = variables.map((variable) => {
      const path = `${normalizeTokenSegment(collectionName)}/${normalizeTokenPath(variable.name)}`;
      lookup[variable.id] = { variableId: variable.id, path, collectionId };
      const modes = resolveVariableModes(variable, collection?.modes ?? []);
      values[path] = resolveBaseVariableValue(variable, collection?.defaultModeId);
      for (const [modeId, targetVariableId] of Object.entries(variable.aliasesByModeId)) {
        aliases.push({
          path,
          targetPath: targetVariableId,
          modeId,
          metadata: {
            source: "figma",
            variableId: variable.id,
            targetVariableId
          }
        });
      }
      return {
        id: variable.id,
        path,
        value: values[path],
        type: variable.resolvedType,
        description: null,
        modes,
        metadata: {
          source: "figma",
          scopes: [...variable.scopes],
          hiddenFromPublishing: variable.hiddenFromPublishing,
          codeSyntax: structuredClone(variable.codeSyntax)
        }
      };
    });
    collections.push({
      id: collectionId,
      name: collectionName,
      items,
      metadata: {
        source: "figma",
        defaultModeId: collection?.defaultModeId ?? null,
        hiddenFromPublishing: collection?.hiddenFromPublishing ?? false
      }
    });
  }

  for (const alias of aliases) {
    const target = lookup[alias.targetPath];
    if (target) {
      alias.targetPath = target.path;
    }
  }

  return {
    tokenStore: {
      values,
      collections,
      aliases,
      bindings: [],
      metadata: {
        source: "figma",
        importedVariableCount: payload.variables.length,
        importedCollectionCount: payload.collections.length
      }
    },
    variableLookup: lookup
  };
}

export function mapFigmaBoundVariables(
  nodeId: string,
  boundVariables: Record<string, unknown>,
  variableLookup: Record<string, FigmaVariableLookupEntry>
): {
  tokenRefs: Record<string, unknown>;
  bindings: CanvasTokenBinding[];
  unresolved: Array<{ propertyPath: string; variableId: string }>;
} {
  const tokenRefs: Record<string, unknown> = {};
  const bindings: CanvasTokenBinding[] = [];
  const unresolved: Array<{ propertyPath: string; variableId: string }> = [];
  for (const { propertyPath, variableId } of collectBoundVariableRefs(boundVariables)) {
    const entry = variableLookup[variableId];
    if (!entry) {
      unresolved.push({ propertyPath, variableId });
      continue;
    }
    tokenRefs[propertyPath] = entry.path;
    bindings.push({
      path: entry.path,
      nodeId,
      property: propertyPath,
      metadata: {
        source: "figma",
        variableId,
        collectionId: entry.collectionId
      }
    });
  }
  return { tokenRefs, bindings, unresolved };
}

function resolveVariableModes(
  variable: NormalizedFigmaVariablePayload["variables"][number],
  collectionModes: Array<{ modeId: string; name: string }>
): CanvasTokenMode[] {
  return Object.entries(variable.valuesByModeId).map(([modeId, value]) => ({
    id: modeId,
    name: collectionModes.find((mode) => mode.modeId === modeId)?.name ?? modeId,
    value,
    metadata: {
      source: "figma"
    }
  }));
}

function resolveBaseVariableValue(
  variable: NormalizedFigmaVariablePayload["variables"][number],
  defaultModeId: string | null | undefined
): unknown {
  if (defaultModeId && defaultModeId in variable.valuesByModeId) {
    return variable.valuesByModeId[defaultModeId];
  }
  const first = Object.values(variable.valuesByModeId)[0];
  return first ?? null;
}

function collectBoundVariableRefs(value: unknown, prefix = ""): Array<{ propertyPath: string; variableId: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectBoundVariableRefs(entry, prefix ? `${prefix}.${index}` : String(index)));
  }
  if (!isRecord(value)) {
    return [];
  }
  if (typeof value.id === "string" && value.id.trim().length > 0) {
    return [{
      propertyPath: prefix || "bound",
      variableId: value.id
    }];
  }
  return Object.entries(value).flatMap(([key, entry]) => collectBoundVariableRefs(entry, prefix ? `${prefix}.${key}` : key));
}

function normalizeTokenPath(value: string): string {
  return value
    .split("/")
    .map((segment) => normalizeTokenSegment(segment))
    .filter((segment) => segment.length > 0)
    .join("/");
}

function normalizeTokenSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "token";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
