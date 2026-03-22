import * as ts from "typescript";
import type { CanvasBinding, CanvasDocument, CanvasNode } from "../types";
import { hashCodeSyncValue } from "./hash";
import { parseTsxCodeSyncBinding } from "./tsx-adapter";
import type {
  CodeSyncConflict,
  CodeSyncGraph,
  CodeSyncManifest,
  CodeSyncManifestNodeMapping,
  CodeSyncResolutionPolicy
} from "./types";

type ApplyCanvasToTsxResult =
  | {
    ok: true;
    nextSource: string;
    sourceHash: string;
    graph: CodeSyncGraph;
    nodeMappings: CodeSyncManifestNodeMapping[];
    changedNodeIds: string[];
  }
  | {
    ok: false;
    conflicts: CodeSyncConflict[];
  };

type ApplyCanvasToTsxOptions = {
  document: CanvasDocument;
  binding: CanvasBinding;
  manifest: CodeSyncManifest;
  sourceText: string;
  resolutionPolicy?: CodeSyncResolutionPolicy;
  emitTokenRefs?: (node: CanvasNode) => Record<string, string>;
  themeAttributes?: Record<string, string>;
};

const CODE_SYNC_MARKER_ATTRIBUTES = new Set(["data-node-id", "data-binding-id"]);

function findNode(document: CanvasDocument, nodeId: string): CanvasNode {
  for (const page of document.pages) {
    const match = page.nodes.find((node) => node.id === nodeId);
    if (match) {
      return match;
    }
  }
  throw new Error(`Unknown canvas node: ${nodeId}`);
}

function collectSubtree(document: CanvasDocument, nodeId: string): CanvasNode[] {
  const root = findNode(document, nodeId);
  const nodes = [root];
  for (const childId of root.childIds) {
    nodes.push(...collectSubtree(document, childId));
  }
  return nodes;
}

function escapeJsxText(value: string): string {
  return JSON.stringify(value);
}

function stringifyStyle(style: Record<string, unknown>): string | null {
  const entries = Object.entries(style)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return entries.length > 0 ? `{{ ${entries.join(", ")} }}` : null;
}

function isCodeSyncMarkerAttribute(name: string): boolean {
  return CODE_SYNC_MARKER_ATTRIBUTES.has(name.trim());
}

function isCodeSyncMarkerJsxAttribute(rawAttribute: string): boolean {
  return /^\s*data-(?:node|binding)-id\b/.test(rawAttribute);
}

function projectStyle(
  node: CanvasNode,
  emitTokenRefs?: (node: CanvasNode) => Record<string, string>
): Record<string, unknown> {
  const style = isRecord(node.style) ? { ...node.style } : {};
  if (emitTokenRefs) {
    for (const [property, value] of Object.entries(emitTokenRefs(node))) {
      style[property] = value;
    }
  }
  return style;
}

function emitAttributes(
  node: CanvasNode,
  bindingId: string,
  options: {
    emitTokenRefs?: (node: CanvasNode) => Record<string, string>;
    themeAttributes?: Record<string, string>;
    isRoot: boolean;
  }
): string[] {
  const attributes = isRecord(node.props.attributes) ? { ...node.props.attributes } : {};
  const className = typeof node.props.className === "string" ? node.props.className : null;
  const metadata = isRecord(node.metadata.codeSync) ? node.metadata.codeSync : {};
  const themeAttributes = options.isRoot ? (options.themeAttributes ?? {}) : {};
  const reservedAttributes = new Set<string>([
    ...CODE_SYNC_MARKER_ATTRIBUTES,
    ...Object.keys(themeAttributes)
  ]);
  const preserved = Array.isArray(metadata.preservedAttributes)
    ? metadata.preservedAttributes.filter((entry): entry is string =>
      typeof entry === "string" &&
      entry.trim().length > 0 &&
      !isCodeSyncMarkerJsxAttribute(entry)
    )
    : [];
  const parts: string[] = [];
  if (className) {
    parts.push(`className=${escapeJsxText(className)}`);
  }
  const style = stringifyStyle(projectStyle(node, options.emitTokenRefs));
  if (style) {
    parts.push(`style=${style}`);
  }
  for (const [key, value] of Object.entries(themeAttributes)) {
    parts.push(`${key}=${escapeJsxText(value)}`);
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string" && !reservedAttributes.has(key.trim())) {
      parts.push(`${key}=${escapeJsxText(value)}`);
    }
  }
  parts.push(`data-node-id=${escapeJsxText(node.id)}`);
  if (node.id === bindingId || node.bindingRefs.primary === bindingId) {
    parts.push(`data-binding-id=${escapeJsxText(bindingId)}`);
  }
  parts.push(...preserved);
  return parts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emitNode(
  document: CanvasDocument,
  nodeId: string,
  bindingId: string,
  order: string[],
  options: {
    emitTokenRefs?: (node: CanvasNode) => Record<string, string>;
    themeAttributes?: Record<string, string>;
    isRoot: boolean;
  }
): string {
  const node = findNode(document, nodeId);
  order.push(node.id);
  const metadata = isRecord(node.metadata.codeSync) ? node.metadata.codeSync : {};
  const tagName = typeof metadata.tagName === "string" ? metadata.tagName : typeof node.props.tagName === "string" ? node.props.tagName : "div";
  if (typeof metadata.unsupportedReason === "string" && metadata.unsupportedReason.length > 0) {
    throw new Error(`Unsupported code sync node ${node.id}: ${metadata.unsupportedReason}`);
  }
  if (node.kind === "text") {
    return `{${escapeJsxText(typeof node.props.text === "string" ? node.props.text : node.name)}}`;
  }
  const attributes = emitAttributes(node, bindingId, options);
  if (node.childIds.length === 0) {
    return `<${tagName} ${attributes.join(" ")} />`;
  }
  const children = node.childIds.map((childId) => emitNode(document, childId, bindingId, order, {
    emitTokenRefs: options.emitTokenRefs,
    themeAttributes: options.themeAttributes,
    isRoot: false
  })).join("");
  return `<${tagName} ${attributes.join(" ")}>${children}</${tagName}>`;
}

function rootMapping(manifest: CodeSyncManifest, bindingId: string): CodeSyncManifestNodeMapping | null {
  return manifest.nodeMappings.find((entry) => entry.nodeId === bindingId) ?? null;
}

export function applyCanvasToTsx(options: ApplyCanvasToTsxOptions): ApplyCanvasToTsxResult {
  const resolutionPolicy = options.resolutionPolicy ?? "manual";
  const currentSourceHash = hashCodeSyncValue(options.sourceText);
  if (currentSourceHash !== options.manifest.sourceHash && resolutionPolicy !== "prefer_canvas") {
    return {
      ok: false,
      conflicts: [{
        kind: "source_hash_changed",
        bindingId: options.binding.id,
        message: "Source file changed since the last code-sync baseline.",
        details: {
          expectedSourceHash: options.manifest.sourceHash,
          actualSourceHash: currentSourceHash
        }
      }]
    };
  }
  const mapping = rootMapping(options.manifest, options.binding.nodeId);
  if (!mapping) {
    return {
      ok: false,
      conflicts: [{
        kind: "unsupported_change",
        bindingId: options.binding.id,
        nodeId: options.binding.nodeId,
        message: "Missing root manifest mapping for the bound TSX region."
      }]
    };
  }

  const emissionOrder: string[] = [];
  let jsx: string;
  try {
    jsx = emitNode(options.document, options.binding.nodeId, options.binding.id, emissionOrder, {
      emitTokenRefs: options.emitTokenRefs,
      themeAttributes: options.themeAttributes,
      isRoot: true
    });
  } catch (error) {
    return {
      ok: false,
      conflicts: [{
        kind: "unsupported_change",
        bindingId: options.binding.id,
        message: error instanceof Error ? error.message : String(error)
      }]
    };
  }

  const nextSource = [
    options.sourceText.slice(0, mapping.locator.sourceSpan.start.offset),
    jsx,
    options.sourceText.slice(mapping.locator.sourceSpan.end.offset)
  ].join("");

  const sourceFile = ts.createSourceFile(options.manifest.repoPath, nextSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics
    .filter((diagnostic: ts.DiagnosticWithLocation) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      conflicts: [{
        kind: "unsupported_change",
        bindingId: options.binding.id,
        message: `Generated TSX is invalid: ${ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, "\n")}`
      }]
    };
  }

  const metadata = options.binding.codeSync;
  if (!metadata) {
    return {
      ok: false,
      conflicts: [{
        kind: "unsupported_change",
        bindingId: options.binding.id,
        message: "Binding is missing code-sync metadata."
      }]
    };
  }

  const parsed = parseTsxCodeSyncBinding(nextSource, options.manifest.repoPath, options.binding.id, metadata);
  const graphOrder = collectGraphOrder(parsed.graph, parsed.graph.rootKey);
  if (graphOrder.length !== emissionOrder.length) {
    return {
      ok: false,
      conflicts: [{
        kind: "unsupported_change",
        bindingId: options.binding.id,
        message: "Re-parsed TSX graph drifted from the emitted canvas subtree."
      }]
    };
  }

  const nodeMappings = graphOrder.map((graphNode, index) => ({
    nodeId: emissionOrder[index] as string,
    locator: graphNode.locator
  }));

  return {
    ok: true,
    nextSource,
    sourceHash: hashCodeSyncValue(nextSource),
    graph: parsed.graph,
    nodeMappings,
    changedNodeIds: [...emissionOrder]
  };
}

function collectGraphOrder(graph: CodeSyncGraph, nodeKey: string): Array<CodeSyncGraph["nodes"][string]> {
  const node = graph.nodes[nodeKey];
  if (!node) {
    throw new Error(`Unknown graph node: ${nodeKey}`);
  }
  const ordered = [node];
  for (const childKey of node.childKeys) {
    ordered.push(...collectGraphOrder(graph, childKey));
  }
  return ordered;
}
