import { randomUUID } from "crypto";
import type { CanvasBinding, CanvasDocument, CanvasNode, CanvasPatch } from "../types";
import { buildGraphMappings, buildManifestLookup, locatorKey } from "./graph";
import type {
  CodeSyncGraph,
  CodeSyncManifest,
  CodeSyncManifestNodeMapping,
  CodeSyncUnsupportedFragment
} from "./types";

type ImportCodeSyncGraphOptions = {
  document: CanvasDocument;
  binding: CanvasBinding;
  documentRevision: number;
  graph: CodeSyncGraph;
  manifest?: CodeSyncManifest | null;
};

type ImportCodeSyncGraphResult = {
  patches: CanvasPatch[];
  manifest: CodeSyncManifest;
  unsupportedRegions: CodeSyncUnsupportedFragment[];
  changedNodeIds: string[];
};

function findNode(document: CanvasDocument, nodeId: string): CanvasNode {
  for (const page of document.pages) {
    const node = page.nodes.find((entry) => entry.id === nodeId);
    if (node) {
      return node;
    }
  }
  throw new Error(`Unknown canvas node: ${nodeId}`);
}

function collectDescendantIds(document: CanvasDocument, nodeId: string): string[] {
  const node = findNode(document, nodeId);
  const descendants: string[] = [];
  for (const childId of node.childIds) {
    descendants.push(childId);
    descendants.push(...collectDescendantIds(document, childId));
  }
  return descendants;
}

function toCanvasKind(graphNode: CodeSyncGraph["nodes"][string]): CanvasNode["kind"] {
  if (graphNode.kind === "text") {
    return "text";
  }
  if (graphNode.kind === "unsupported") {
    return "dom-binding";
  }
  if (graphNode.tagName === "button" || graphNode.tagName === "input" || graphNode.tagName === "select") {
    return "component-instance";
  }
  return "frame";
}

function buildCanvasNodeMetadata(graphNode: CodeSyncGraph["nodes"][string]): Record<string, unknown> {
  const attributes = { ...graphNode.attributes };
  const className = typeof attributes.className === "string" ? attributes.className : undefined;
  if (className) {
    delete attributes.className;
  }
  return {
    codeSync: {
      tagName: graphNode.tagName ?? graphNode.kind,
      attributes,
      preservedAttributes: [...graphNode.preservedAttributes],
      locator: graphNode.locator,
      raw: graphNode.raw ?? null,
      unsupportedReason: graphNode.unsupportedReason ?? null
    },
    importedFromCodeSync: true,
    className: className ?? null
  };
}

function buildCanvasNodeProps(graphNode: CodeSyncGraph["nodes"][string]): Record<string, unknown> {
  const attributes = { ...graphNode.attributes };
  const className = typeof attributes.className === "string" ? attributes.className : undefined;
  if (className) {
    delete attributes.className;
  }
  const props: Record<string, unknown> = {
    tagName: graphNode.tagName ?? graphNode.kind,
    attributes
  };
  if (className) {
    props.className = className;
  }
  if (graphNode.kind === "text") {
    props.text = graphNode.text ?? "";
  }
  return props;
}

function buildNodeName(graphNode: CodeSyncGraph["nodes"][string]): string {
  if (graphNode.kind === "text") {
    return (graphNode.text ?? "Text").slice(0, 48);
  }
  if (graphNode.kind === "unsupported") {
    return "Unsupported Runtime Node";
  }
  return graphNode.tagName ?? "Element";
}

function buildNodeId(
  graphNode: CodeSyncGraph["nodes"][string],
  manifestLookup: Map<string, string>
): string {
  return manifestLookup.get(locatorKey(graphNode.locator)) ?? `node_sync_${randomUUID().slice(0, 8)}`;
}

function preorder(graph: CodeSyncGraph, nodeKey: string): Array<CodeSyncGraph["nodes"][string]> {
  const node = graph.nodes[nodeKey];
  if (!node) {
    throw new Error(`Unknown graph node: ${nodeKey}`);
  }
  const ordered = [node];
  for (const childKey of node.childKeys) {
    ordered.push(...preorder(graph, childKey));
  }
  return ordered;
}

export function importCodeSyncGraph(options: ImportCodeSyncGraphOptions): ImportCodeSyncGraphResult {
  const rootNode = findNode(options.document, options.binding.nodeId);
  const pageId = rootNode.pageId;
  const manifestLookup = buildManifestLookup(options.manifest?.nodeMappings ?? []);
  const descendantIds = collectDescendantIds(options.document, options.binding.nodeId);
  const patches: CanvasPatch[] = [];
  const changedNodeIds = new Set<string>([rootNode.id, ...descendantIds]);
  const nodeIdByLocator = new Map<string, string>();
  nodeIdByLocator.set(locatorKey(options.graph.nodes[options.graph.rootKey]!.locator), options.binding.nodeId);

  const rootMetadata = buildCanvasNodeMetadata(options.graph.nodes[options.graph.rootKey]!);
  const rootProps = buildCanvasNodeProps(options.graph.nodes[options.graph.rootKey]!);
  patches.push({
    op: "node.update",
    nodeId: rootNode.id,
    changes: {
      name: buildNodeName(options.graph.nodes[options.graph.rootKey]!),
      props: rootProps,
      style: options.graph.nodes[options.graph.rootKey]!.style,
      bindingRefs: { ...rootNode.bindingRefs, primary: options.binding.id },
      metadata: { ...rootNode.metadata, ...rootMetadata }
    }
  });

  descendantIds.reverse().forEach((nodeId) => {
    patches.push({ op: "node.remove", nodeId });
  });

  const orderedNodes = preorder(options.graph, options.graph.rootKey).slice(1);
  const canvasChildren = new Map<string, string[]>();
  for (const graphNode of orderedNodes) {
    const nodeId = buildNodeId(graphNode, manifestLookup);
    nodeIdByLocator.set(locatorKey(graphNode.locator), nodeId);
    const parentKey = orderedNodes.find((candidate) => candidate.childKeys.includes(graphNode.key))?.key ?? options.graph.rootKey;
    const parentId = parentKey === options.graph.rootKey
      ? options.binding.nodeId
      : nodeIdByLocator.get(locatorKey(options.graph.nodes[parentKey]!.locator)) ?? options.binding.nodeId;
    const siblings = canvasChildren.get(parentId) ?? [];
    siblings.push(nodeId);
    canvasChildren.set(parentId, siblings);
    patches.push({
      op: "node.insert",
      pageId,
      parentId,
      node: {
        id: nodeId,
        kind: toCanvasKind(graphNode),
        name: buildNodeName(graphNode),
        rect: graphNode.kind === "text"
          ? { x: 0, y: 0, width: 240, height: 28 }
          : { x: 0, y: 0, width: 320, height: 120 },
        props: buildCanvasNodeProps(graphNode),
        style: graphNode.style,
        bindingRefs: { primary: options.binding.id },
        metadata: buildCanvasNodeMetadata(graphNode)
      }
    });
    changedNodeIds.add(nodeId);
  }

  const nodeMappings: CodeSyncManifestNodeMapping[] = buildGraphMappings(options.graph, nodeIdByLocator);
  const manifest: CodeSyncManifest = {
    bindingId: options.binding.id,
    documentId: options.document.documentId,
    repoPath: options.binding.codeSync?.repoPath ?? options.binding.selector ?? "",
    adapter: options.binding.codeSync?.adapter ?? options.graph.adapter,
    rootLocator: {
      exportName: options.binding.codeSync?.exportName,
      selector: options.binding.codeSync?.selector
    },
    sourceHash: options.graph.sourceHash,
    documentRevision: options.documentRevision,
    nodeMappings,
    lastImportedAt: new Date().toISOString(),
    lastPushedAt: options.manifest?.lastPushedAt
  };

  return {
    patches,
    manifest,
    unsupportedRegions: options.graph.unsupportedFragments,
    changedNodeIds: [...changedNodeIds]
  };
}
