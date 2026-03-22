import type { CanvasDocumentImportMode, CanvasDocumentImportRequest } from "../../canvas/types";

const FIGMA_IMPORT_MODES = new Set<CanvasDocumentImportMode>([
  "replace_current_page",
  "append_pages",
  "components_only"
]);

export type NormalizedFigmaImportRequest = {
  sourceUrl: string;
  fileKey: string;
  nodeIds: string[];
  mode: CanvasDocumentImportMode;
  frameworkId: string | null;
  frameworkAdapterId: string | null;
  includeVariables: boolean;
  depth: number | null;
  geometryPaths: boolean;
  branchData: boolean;
  versionId: string | null;
  branchId: string | null;
};

export function normalizeFigmaImportRequest(input: CanvasDocumentImportRequest): NormalizedFigmaImportRequest {
  const sourceUrl = optionalString(input.sourceUrl);
  const fileKeyInput = optionalString(input.fileKey);
  const parsed = sourceUrl ? parseFigmaUrl(sourceUrl) : null;
  const fileKey = parsed?.fileKey ?? fileKeyInput;
  if (!fileKey) {
    throw new Error("Figma import requires sourceUrl or fileKey.");
  }
  const nodeIds = uniqueStrings([
    ...normalizeNodeIds(parsed?.nodeIds ?? []),
    ...normalizeNodeIds(Array.isArray(input.nodeIds) ? input.nodeIds : [])
  ]);
  return {
    sourceUrl: parsed?.sourceUrl ?? `https://www.figma.com/file/${fileKey}`,
    fileKey,
    nodeIds,
    mode: normalizeImportMode(input.mode),
    frameworkId: optionalString(input.frameworkId),
    frameworkAdapterId: optionalString(input.frameworkAdapterId),
    includeVariables: input.includeVariables !== false,
    depth: typeof input.depth === "number" && Number.isFinite(input.depth) && input.depth > 0
      ? Math.floor(input.depth)
      : null,
    geometryPaths: input.geometryPaths === true,
    branchData: true,
    versionId: parsed?.versionId ?? null,
    branchId: parsed?.branchId ?? null
  };
}

function parseFigmaUrl(sourceUrl: string): {
  sourceUrl: string;
  fileKey: string;
  nodeIds: string[];
  versionId: string | null;
  branchId: string | null;
} {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error(`Invalid Figma sourceUrl: ${sourceUrl}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname.endsWith("figma.com")) {
    throw new Error(`Unsupported Figma hostname: ${url.hostname}`);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const fileSegmentIndex = segments.findIndex((segment) => segment === "file" || segment === "design" || segment === "proto");
  if (fileSegmentIndex < 0 || !segments[fileSegmentIndex + 1]) {
    throw new Error(`Unsupported Figma URL path: ${url.pathname}`);
  }
  const fileKey = segments[fileSegmentIndex + 1] as string;
  const queryNodeIds = normalizeNodeIds([
    url.searchParams.get("node-id"),
    url.searchParams.get("nodeId")
  ]);
  return {
    sourceUrl: url.toString(),
    fileKey,
    nodeIds: queryNodeIds,
    versionId: optionalString(url.searchParams.get("version-id")),
    branchId: optionalString(url.searchParams.get("branch-id"))
  };
}

function normalizeImportMode(value: CanvasDocumentImportRequest["mode"]): CanvasDocumentImportMode {
  return typeof value === "string" && FIGMA_IMPORT_MODES.has(value) ? value : "replace_current_page";
}

function normalizeNodeIds(values: Array<string | null | undefined>): string[] {
  return uniqueStrings(values.flatMap((value) => {
    if (typeof value !== "string") {
      return [];
    }
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }));
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
