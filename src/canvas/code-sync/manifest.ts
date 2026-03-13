import type {
  CodeSyncManifest,
  CodeSyncManifestNodeMapping,
  CodeSyncRootLocator,
  CodeSyncSourceLocator
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSourceLocator(value: unknown): CodeSyncSourceLocator {
  if (!isRecord(value)) {
    throw new Error("Invalid code sync locator.");
  }
  const sourceSpan = isRecord(value.sourceSpan) ? value.sourceSpan : null;
  const start = sourceSpan && isRecord(sourceSpan.start) ? sourceSpan.start : null;
  const end = sourceSpan && isRecord(sourceSpan.end) ? sourceSpan.end : null;
  const sourcePath = typeof value.sourcePath === "string" ? value.sourcePath : "";
  const astPath = typeof value.astPath === "string" ? value.astPath : "";
  if (!sourcePath || !astPath || !start || !end) {
    throw new Error("Invalid code sync locator.");
  }
  const startOffset = readNumber(start.offset);
  const startLine = readNumber(start.line);
  const startColumn = readNumber(start.column);
  const endOffset = readNumber(end.offset);
  const endLine = readNumber(end.line);
  const endColumn = readNumber(end.column);
  if (
    startOffset === null
    || startLine === null
    || startColumn === null
    || endOffset === null
    || endLine === null
    || endColumn === null
  ) {
    throw new Error("Invalid code sync locator positions.");
  }
  return {
    sourcePath,
    astPath,
    sourceSpan: {
      start: { offset: startOffset, line: startLine, column: startColumn },
      end: { offset: endOffset, line: endLine, column: endColumn }
    }
  };
}

function normalizeNodeMappings(value: unknown): CodeSyncManifestNodeMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const mappings: CodeSyncManifestNodeMapping[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.nodeId !== "string") {
      continue;
    }
    mappings.push({
      nodeId: entry.nodeId,
      locator: normalizeSourceLocator(entry.locator)
    });
  }
  return mappings;
}

export function normalizeCodeSyncManifest(input: CodeSyncManifest): CodeSyncManifest {
  return {
    bindingId: input.bindingId,
    documentId: input.documentId,
    repoPath: input.repoPath,
    adapter: input.adapter,
    rootLocator: normalizeRootLocator(input.rootLocator),
    sourceHash: input.sourceHash,
    documentRevision: input.documentRevision,
    nodeMappings: normalizeNodeMappings(input.nodeMappings),
    lastImportedAt: input.lastImportedAt,
    lastPushedAt: input.lastPushedAt
  };
}

export function normalizeRootLocator(value: CodeSyncRootLocator | Record<string, unknown> | undefined): CodeSyncRootLocator {
  const source = isRecord(value) ? value : {};
  const exportName = typeof source.exportName === "string" && source.exportName.trim().length > 0 ? source.exportName : undefined;
  const selector = typeof source.selector === "string" && source.selector.trim().length > 0 ? source.selector : undefined;
  return { exportName, selector };
}

export function parseCodeSyncManifest(input: unknown): CodeSyncManifest {
  if (!isRecord(input)) {
    throw new Error("Invalid code sync manifest payload.");
  }
  const bindingId = typeof input.bindingId === "string" ? input.bindingId : "";
  const documentId = typeof input.documentId === "string" ? input.documentId : "";
  const repoPath = typeof input.repoPath === "string" ? input.repoPath : "";
  const adapter = typeof input.adapter === "string" ? input.adapter : "";
  const sourceHash = typeof input.sourceHash === "string" ? input.sourceHash : "";
  const documentRevision = readNumber(input.documentRevision);
  if (!bindingId || !documentId || !repoPath || !adapter || !sourceHash || documentRevision === null) {
    throw new Error("Invalid code sync manifest payload.");
  }
  return normalizeCodeSyncManifest({
    bindingId,
    documentId,
    repoPath,
    adapter,
    rootLocator: normalizeRootLocator(isRecord(input.rootLocator) ? input.rootLocator : undefined),
    sourceHash,
    documentRevision,
    nodeMappings: normalizeNodeMappings(input.nodeMappings),
    lastImportedAt: typeof input.lastImportedAt === "string" ? input.lastImportedAt : undefined,
    lastPushedAt: typeof input.lastPushedAt === "string" ? input.lastPushedAt : undefined
  } as CodeSyncManifest);
}
