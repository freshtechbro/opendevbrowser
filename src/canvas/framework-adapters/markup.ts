import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { hashCodeSyncValue } from "../code-sync/hash";
import type {
  CanvasCodeSyncBindingMetadata,
  CodeSyncGraph,
  CodeSyncNode,
  CodeSyncRootLocator
} from "../code-sync/types";

type Parse5Node =
  | DefaultTreeAdapterMap["element"]
  | DefaultTreeAdapterMap["textNode"]
  | DefaultTreeAdapterMap["commentNode"];

type ElementNode = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];

function isElementNode(node: Parse5Node): node is ElementNode {
  return "tagName" in node;
}

function isTextNode(node: Parse5Node): node is TextNode {
  return "value" in node && !("tagName" in node);
}

function lineOffsetsForText(sourceText: string): number[] {
  const offsets = [0];
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function toPosition(offset: number, lineOffsets: number[]): { offset: number; line: number; column: number } {
  let lineIndex = 0;
  for (let index = 0; index < lineOffsets.length; index += 1) {
    const next = lineOffsets[index + 1] ?? Number.POSITIVE_INFINITY;
    if (offset >= lineOffsets[index]! && offset < next) {
      lineIndex = index;
      break;
    }
  }
  return {
    offset,
    line: lineIndex + 1,
    column: offset - lineOffsets[lineIndex]! + 1
  };
}

function toLocator(
  filePath: string,
  astPath: string,
  startOffset: number,
  endOffset: number,
  lineOffsets: number[]
): CodeSyncNode["locator"] {
  return {
    sourcePath: filePath,
    astPath,
    sourceSpan: {
      start: toPosition(startOffset, lineOffsets),
      end: toPosition(endOffset, lineOffsets)
    }
  };
}

function parseInlineStyle(styleText: string): Record<string, string> {
  const style: Record<string, string> = {};
  for (const part of styleText.split(";")) {
    const [rawKey, ...rest] = part.split(":");
    const key = rawKey?.trim();
    const value = rest.join(":").trim();
    if (!key || !value) {
      continue;
    }
    style[key] = value;
  }
  return style;
}

function normalizeAttributeName(name: string): string {
  return name === "class" ? "className" : name;
}

function locationOffsets(node: Parse5Node, sourceLength: number): { start: number; end: number } {
  const location = "sourceCodeLocation" in node ? node.sourceCodeLocation : undefined;
  if (!location) {
    return { start: 0, end: sourceLength };
  }
  if ("startOffset" in location && typeof location.startOffset === "number" && typeof location.endOffset === "number") {
    return {
      start: location.startOffset,
      end: location.endOffset
    };
  }
  const startTag = "startTag" in location ? location.startTag : undefined;
  const endTag = "endTag" in location ? location.endTag : undefined;
  const startTagLocation = typeof startTag === "object" && startTag !== null
    ? startTag as { startOffset?: number; endOffset?: number }
    : {};
  const endTagLocation = typeof endTag === "object" && endTag !== null
    ? endTag as { endOffset?: number }
    : {};
  return {
    start: typeof startTagLocation.startOffset === "number" ? startTagLocation.startOffset : 0,
    end: typeof endTagLocation.endOffset === "number"
      ? endTagLocation.endOffset
      : typeof startTagLocation.endOffset === "number"
        ? startTagLocation.endOffset
        : sourceLength
  };
}

function visitMarkupNode(
  node: Parse5Node,
  options: {
    bindingId: string;
    filePath: string;
    sourceText: string;
    astPath: string;
    lineOffsets: number[];
    nodes: Record<string, CodeSyncNode>;
  }
): string | null {
  if (isTextNode(node)) {
    if (!node.value.trim()) {
      return null;
    }
    const key = `${options.bindingId}:${options.astPath}`;
    const { start, end } = locationOffsets(node, options.sourceText.length);
    options.nodes[key] = {
      key,
      kind: "text",
      bindingId: options.bindingId,
      locator: toLocator(options.filePath, options.astPath, start, end, options.lineOffsets),
      text: node.value,
      attributes: {},
      style: {},
      preservedAttributes: [],
      childKeys: [],
      raw: node.value
    };
    return key;
  }

  if (!isElementNode(node)) {
    return null;
  }

  const key = `${options.bindingId}:${options.astPath}`;
  const { start, end } = locationOffsets(node, options.sourceText.length);
  const attributes: Record<string, string> = {};
  const preservedAttributes: string[] = [];
  let style: Record<string, string> = {};
  for (const attr of node.attrs) {
    if (attr.name === "style") {
      style = parseInlineStyle(attr.value);
      continue;
    }
    const normalizedName = normalizeAttributeName(attr.name);
    attributes[normalizedName] = attr.value;
    if (attr.name.startsWith("data-")) {
      preservedAttributes.push(`${attr.name}="${attr.value}"`);
    }
  }

  const childKeys: string[] = [];
  node.childNodes.forEach((child, index) => {
    const childKey = visitMarkupNode(child as Parse5Node, {
      ...options,
      astPath: `${options.astPath}/${index}`
    });
    if (childKey) {
      childKeys.push(childKey);
    }
  });

  options.nodes[key] = {
    key,
    kind: "element",
    bindingId: options.bindingId,
    locator: toLocator(options.filePath, options.astPath, start, end, options.lineOffsets),
    tagName: node.tagName,
    attributes,
    style,
    preservedAttributes,
    childKeys,
    raw: options.sourceText.slice(start, end),
    metadata: {
      tagName: node.tagName
    }
  };
  return key;
}

export function parseMarkupToCodeSyncGraph(options: {
  bindingId: string;
  filePath: string;
  sourceText: string;
  metadata: CanvasCodeSyncBindingMetadata;
  rootLocator: CodeSyncRootLocator;
}): CodeSyncGraph {
  const fragment = parseFragment(options.sourceText, { sourceCodeLocationInfo: true }) as DefaultTreeAdapterMap["documentFragment"];
  const lineOffsets = lineOffsetsForText(options.sourceText);
  const nodes: Record<string, CodeSyncNode> = {};
  const rootKeys = fragment.childNodes
    .map((child, index) => visitMarkupNode(child as Parse5Node, {
      bindingId: options.bindingId,
      filePath: options.filePath,
      sourceText: options.sourceText,
      astPath: `root/${index}`,
      lineOffsets,
      nodes
    }))
    .filter((entry): entry is string => Boolean(entry));

  let rootKey = rootKeys[0] ?? `${options.bindingId}:root`;
  if (rootKeys.length !== 1) {
    rootKey = `${options.bindingId}:root`;
    const rootLocator = toLocator(options.filePath, "root", 0, options.sourceText.length, lineOffsets);
    nodes[rootKey] = {
      key: rootKey,
      kind: "element",
      bindingId: options.bindingId,
      locator: rootLocator,
      tagName: "section",
      attributes: {},
      style: {},
      preservedAttributes: [],
      childKeys: rootKeys,
      raw: options.sourceText
    };
  }

  return {
    adapter: options.metadata.adapter,
    frameworkAdapterId: options.metadata.frameworkAdapterId,
    frameworkId: options.metadata.frameworkId,
    sourceFamily: options.metadata.sourceFamily,
    bindingId: options.bindingId,
    repoPath: options.metadata.repoPath,
    rootKey,
    nodes,
    sourceHash: hashCodeSyncValue(options.sourceText),
    unsupportedFragments: [],
    libraryAdapterIds: [...options.metadata.libraryAdapterIds],
    declaredCapabilities: [...options.metadata.declaredCapabilities],
    grantedCapabilities: options.metadata.grantedCapabilities.map((entry) => ({ ...entry }))
  };
}
