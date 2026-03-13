import type { CodeSyncGraph, CodeSyncManifestNodeMapping, CodeSyncSourceLocator } from "./types";

export function locatorKey(locator: CodeSyncSourceLocator): string {
  return [
    locator.sourcePath,
    locator.astPath
  ].join(":");
}

export function buildManifestLookup(mappings: CodeSyncManifestNodeMapping[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const mapping of mappings) {
    lookup.set(locatorKey(mapping.locator), mapping.nodeId);
  }
  return lookup;
}

export function buildGraphMappings(graph: CodeSyncGraph, nodeIdByLocator: Map<string, string>): CodeSyncManifestNodeMapping[] {
  const mappings: CodeSyncManifestNodeMapping[] = [];
  for (const node of Object.values(graph.nodes)) {
    const nodeId = nodeIdByLocator.get(locatorKey(node.locator));
    if (!nodeId) {
      continue;
    }
    mappings.push({
      nodeId,
      locator: node.locator
    });
  }
  return mappings.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}
