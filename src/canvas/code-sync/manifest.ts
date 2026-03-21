import type {
  CodeSyncManifest,
  CodeSyncManifestNodeMapping,
  CodeSyncRootLocator,
  CodeSyncSourceLocator
} from "./types";
import {
  normalizeCodeSyncBindingMetadata,
  normalizeCodeSyncRootLocator,
  normalizeFrameworkAdapterIdentity,
  type CodeSyncSourceFamily
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

export function normalizeRootLocator(
  value: CodeSyncRootLocator | Record<string, unknown> | undefined,
  sourceFamily: CodeSyncSourceFamily,
  exportName?: string,
  selector?: string
): CodeSyncRootLocator {
  return normalizeCodeSyncRootLocator(value, { sourceFamily, exportName, selector });
}

export function normalizeCodeSyncManifest(input: CodeSyncManifest): CodeSyncManifest {
  const rootLocatorRecord = isRecord(input.rootLocator) ? input.rootLocator as Record<string, unknown> : undefined;
  const identity = normalizeFrameworkAdapterIdentity({
    adapter: readString(input.adapter) ?? "",
    frameworkAdapterId: readString(input.frameworkAdapterId),
    repoPath: readString(input.repoPath) ?? ""
  });
  const manifestVersion = readNumber(input.manifestVersion) ?? 2;
  const normalizedBinding = normalizeCodeSyncBindingMetadata({
    adapter: readString(input.adapter) ?? identity.frameworkAdapterId,
    frameworkAdapterId: readString(input.frameworkAdapterId) ?? identity.frameworkAdapterId,
    frameworkId: readString(input.frameworkId) ?? identity.frameworkId,
    sourceFamily: readString(input.sourceFamily) ?? identity.sourceFamily,
    adapterKind: readString(input.adapterKind) ?? identity.adapterKind,
    adapterVersion: readNumber(input.adapterVersion) ?? identity.adapterVersion,
    repoPath: readString(input.repoPath) ?? "",
    exportName: readString((input as Record<string, unknown>).exportName) ?? readString(rootLocatorRecord?.exportName) ?? undefined,
    selector: readString((input as Record<string, unknown>).selector) ?? readString(rootLocatorRecord?.selector) ?? undefined,
    rootLocator: rootLocatorRecord,
    syncMode: "manual",
    ownership: {},
    manifestVersion,
    libraryAdapterIds: (input as Record<string, unknown>).libraryAdapterIds ?? (input as Record<string, unknown>).libraryAdapters,
    pluginId: readString(input.pluginId) ?? identity.pluginId,
    declaredCapabilities: (input as Record<string, unknown>).declaredCapabilities,
    grantedCapabilities: (input as Record<string, unknown>).grantedCapabilities,
    reasonCode: manifestVersion < 2 ? "manifest_migrated" : (readString(input.reasonCode) ?? identity.reasonCode)
  });
  return {
    manifestVersion,
    bindingId: input.bindingId,
    documentId: input.documentId,
    repoPath: normalizedBinding.repoPath,
    adapter: normalizedBinding.adapter,
    frameworkAdapterId: normalizedBinding.frameworkAdapterId,
    frameworkId: normalizedBinding.frameworkId,
    sourceFamily: normalizedBinding.sourceFamily,
    adapterKind: normalizedBinding.adapterKind,
    adapterVersion: normalizedBinding.adapterVersion,
    pluginId: normalizedBinding.pluginId,
    libraryAdapterIds: [...normalizedBinding.libraryAdapterIds],
    rootLocator: normalizedBinding.rootLocator,
    sourceHash: input.sourceHash,
    documentRevision: input.documentRevision,
    nodeMappings: normalizeNodeMappings(input.nodeMappings),
    lastImportedAt: input.lastImportedAt,
    lastPushedAt: input.lastPushedAt,
    reasonCode: manifestVersion < 2 ? "manifest_migrated" : normalizedBinding.reasonCode
  };
}

export function parseCodeSyncManifest(input: unknown): CodeSyncManifest {
  if (!isRecord(input)) {
    throw new Error("Invalid code sync manifest payload.");
  }
  const bindingId = readString(input.bindingId) ?? "";
  const documentId = readString(input.documentId) ?? "";
  const repoPath = readString(input.repoPath) ?? "";
  const adapter = readString(input.adapter) ?? "";
  const sourceHash = readString(input.sourceHash) ?? "";
  const documentRevision = readNumber(input.documentRevision);
  if (!bindingId || !documentId || !repoPath || !adapter || !sourceHash || documentRevision === null) {
    throw new Error("Invalid code sync manifest payload.");
  }

  const identity = normalizeFrameworkAdapterIdentity({
    adapter,
    frameworkAdapterId: readString(input.frameworkAdapterId),
    repoPath
  });
  const manifestVersion = readNumber(input.manifestVersion) ?? 2;
  const normalizedBinding = normalizeCodeSyncBindingMetadata({
    adapter,
    frameworkAdapterId: readString(input.frameworkAdapterId) ?? identity.frameworkAdapterId,
    frameworkId: readString(input.frameworkId) ?? identity.frameworkId,
    sourceFamily: readString(input.sourceFamily) ?? identity.sourceFamily,
    adapterKind: readString(input.adapterKind) ?? identity.adapterKind,
    adapterVersion: readNumber(input.adapterVersion) ?? identity.adapterVersion,
    repoPath,
    exportName: readString(input.exportName) ?? (isRecord(input.rootLocator) ? readString(input.rootLocator.exportName) : null) ?? undefined,
    selector: readString(input.selector) ?? (isRecord(input.rootLocator) ? readString(input.rootLocator.selector) : null) ?? undefined,
    rootLocator: isRecord(input.rootLocator) ? input.rootLocator : undefined,
    syncMode: "manual",
    ownership: {},
    manifestVersion,
    libraryAdapterIds: input.libraryAdapterIds ?? input.libraryAdapters,
    pluginId: readString(input.pluginId) ?? identity.pluginId,
    declaredCapabilities: input.declaredCapabilities,
    grantedCapabilities: input.grantedCapabilities,
    reasonCode: manifestVersion < 2 ? "manifest_migrated" : (readString(input.reasonCode) ?? identity.reasonCode)
  });

  return normalizeCodeSyncManifest({
    manifestVersion,
    bindingId,
    documentId,
    repoPath,
    adapter,
    frameworkAdapterId: normalizedBinding.frameworkAdapterId,
    frameworkId: normalizedBinding.frameworkId,
    sourceFamily: normalizedBinding.sourceFamily,
    adapterKind: normalizedBinding.adapterKind,
    adapterVersion: normalizedBinding.adapterVersion,
    pluginId: normalizedBinding.pluginId,
    libraryAdapterIds: normalizedBinding.libraryAdapterIds,
    rootLocator: normalizedBinding.rootLocator,
    sourceHash,
    documentRevision,
    nodeMappings: normalizeNodeMappings(input.nodeMappings),
    lastImportedAt: typeof input.lastImportedAt === "string" ? input.lastImportedAt : undefined,
    lastPushedAt: typeof input.lastPushedAt === "string" ? input.lastPushedAt : undefined,
    reasonCode: manifestVersion < 2 ? "manifest_migrated" : normalizedBinding.reasonCode
  });
}
