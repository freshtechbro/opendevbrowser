import { describe, expect, it, vi } from "vitest";
import { createDefaultCanvasDocument } from "../src/canvas/document-store";
import { applyCanvasToTsx } from "../src/canvas/code-sync/apply-tsx";
import { hashCodeSyncValue } from "../src/canvas/code-sync/hash";
import { importCodeSyncGraph } from "../src/canvas/code-sync/import";
import {
  DEFAULT_CODE_SYNC_OWNERSHIP,
  normalizeCodeSyncBindingMetadata,
  type CanvasCodeSyncBindingMetadata,
  type CodeSyncGraph,
  type CodeSyncManifest
} from "../src/canvas/code-sync/types";
import { parseTsxCodeSyncBinding } from "../src/canvas/code-sync/tsx-adapter";
import * as tsxAdapter from "../src/canvas/code-sync/tsx-adapter";
import type { CanvasBinding, CanvasDocument, CanvasNode } from "../src/canvas/types";

function createNode(
  pageId: string,
  node: Pick<CanvasNode, "id" | "kind" | "name"> & Partial<Omit<CanvasNode, "id" | "kind" | "name" | "pageId">>
): CanvasNode {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    pageId,
    parentId: node.parentId ?? null,
    childIds: node.childIds ? [...node.childIds] : [],
    rect: node.rect ?? { x: 0, y: 0, width: 320, height: 180 },
    props: node.props ?? {},
    style: node.style ?? {},
    tokenRefs: node.tokenRefs ?? {},
    bindingRefs: node.bindingRefs ?? {},
    variantPatches: node.variantPatches ?? [],
    metadata: node.metadata ?? {}
  };
}

function createMetadata(
  overrides: Partial<CanvasCodeSyncBindingMetadata> = {}
): CanvasCodeSyncBindingMetadata {
  return normalizeCodeSyncBindingMetadata({
    adapter: "tsx-react-v1",
    repoPath: "src/example.tsx",
    exportName: "Example",
    syncMode: "manual",
    ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP },
    ...overrides
  });
}

function createBinding(
  codeSync: CanvasCodeSyncBindingMetadata | undefined,
  overrides: Partial<CanvasBinding> = {}
): CanvasBinding {
  return {
    id: overrides.id ?? "binding_code",
    nodeId: overrides.nodeId ?? "node_root",
    kind: overrides.kind ?? "code-sync",
    selector: overrides.selector,
    componentName: overrides.componentName,
    metadata: overrides.metadata ?? {},
    codeSync
  };
}

function createDocument(
  binding: CanvasBinding,
  nodes: Array<Pick<CanvasNode, "id" | "kind" | "name"> & Partial<Omit<CanvasNode, "id" | "kind" | "name" | "pageId">>>
): CanvasDocument {
  const document = createDefaultCanvasDocument("dc_code_sync_transform");
  const [page] = document.pages;
  if (!page) {
    throw new Error("Missing default canvas page");
  }
  page.rootNodeId = nodes[0]?.id ?? null;
  page.nodes = nodes.map((node) => createNode(page.id, node));
  document.bindings = [binding];
  return document;
}

function buildManifest(
  document: CanvasDocument,
  binding: CanvasBinding,
  metadata: CanvasCodeSyncBindingMetadata,
  sourceText: string
): CodeSyncManifest {
  const parsed = parseTsxCodeSyncBinding(sourceText, metadata.repoPath, binding.id, metadata);
  const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
  if (!rootNode) {
    throw new Error("Missing parsed root node");
  }
  return {
    bindingId: binding.id,
    documentId: document.documentId,
    repoPath: metadata.repoPath,
    adapter: metadata.adapter,
    rootLocator: parsed.rootLocator,
    sourceHash: hashCodeSyncValue(sourceText),
    documentRevision: 1,
    nodeMappings: [{
      nodeId: binding.nodeId,
      locator: rootNode.locator
    }]
  };
}

function findGraphNodeById(
  graphNodes: Record<string, { attributes: Record<string, string> }>,
  id: string
) {
  return Object.values(graphNodes).find((node) => node.attributes.id === id);
}

function createLocator(astPath: string, startOffset: number) {
  return {
    sourcePath: "src/example.tsx",
    astPath,
    sourceSpan: {
      start: { offset: startOffset, line: 1, column: startOffset + 1 },
      end: { offset: startOffset + 5, line: 1, column: startOffset + 6 }
    }
  };
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function reactExportLocator(exportName: string, selector?: string) {
  return selector
    ? { kind: "react-export" as const, exportName, selector }
    : { kind: "react-export" as const, exportName };
}

describe("canvas code sync TSX adapter", () => {
  it("parses literal attributes, style variants, and unsupported fragments from function exports", () => {
    const metadata = createMetadata();
    const parsed = parseTsxCodeSyncBinding(
      [
        "export function Example() {",
        "  return <div className=\"hero\" disabled count={3} aria-hidden={false} data-node-id=\"existing-root\" data-binding-id=\"existing-binding\">",
        "    <span id=\"literal-text\">{\"Hello\"}</span>",
        "    <div id=\"style-ok\" style={{ fontSize: 18, fontWeight: \"700\" }} />",
        "    <div id=\"style-ref\" style={styleMap} />",
        "    <div id=\"style-spread\" style={{ ...theme }} />",
        "    <div id=\"style-computed\" style={{ [token]: 1 }} />",
        "    <div id=\"style-dynamic\" style={{ padding: space }} />",
        "    <FancyCard />",
        "    <div>{dynamicValue}</div>",
        "  </div>;",
        "}"
      ].join("\n"),
      metadata.repoPath,
      "binding_code",
      metadata
    );

    expect(parsed.rootLocator).toEqual(reactExportLocator("Example"));

    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
    expect(rootNode).toMatchObject({
      tagName: "div",
      attributes: {
        className: "hero",
        disabled: "true",
        count: "3",
        "aria-hidden": "false"
      }
    });
    expect(rootNode?.preservedAttributes).toEqual(
      expect.arrayContaining([
        "data-node-id=\"existing-root\"",
        "data-binding-id=\"existing-binding\""
      ])
    );

    const literalText = Object.values(parsed.graph.nodes).find((node) => node.text === "Hello");
    expect(literalText?.kind).toBe("text");

    const styledNode = findGraphNodeById(parsed.graph.nodes, "style-ok");
    expect(styledNode?.style).toEqual({ fontSize: 18, fontWeight: "700" });

    expect(findGraphNodeById(parsed.graph.nodes, "style-ref")?.preservedAttributes).toContain("style={styleMap}");
    expect(findGraphNodeById(parsed.graph.nodes, "style-spread")?.preservedAttributes).toContain("style={{ ...theme }}");
    expect(findGraphNodeById(parsed.graph.nodes, "style-computed")?.preservedAttributes).toContain("style={{ [token]: 1 }}");
    expect(findGraphNodeById(parsed.graph.nodes, "style-dynamic")?.preservedAttributes).toContain("style={{ padding: space }}");

    expect(parsed.graph.unsupportedFragments.map((fragment) => fragment.reason)).toEqual([
      "unsupported_component_tag",
      "unsupported_jsx_expression"
    ]);
  });

  it("parses variable statement function exports and preserves unsupported style expressions", () => {
    const metadata = createMetadata();
    const parsed = parseTsxCodeSyncBinding(
      [
        "export const Example = function () {",
        "  return <section id=\"section-root\" style={styles.panel} />;",
        "};"
      ].join("\n"),
      metadata.repoPath,
      "binding_code",
      metadata
    );

    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
    expect(rootNode).toMatchObject({
      tagName: "section",
      attributes: { id: "section-root" }
    });
    expect(rootNode?.preservedAttributes).toContain("style={styles.panel}");
  });

  it("parses export default arrow functions that return fragments", () => {
    const metadata = createMetadata({ exportName: "default" });
    const parsed = parseTsxCodeSyncBinding(
      "export default () => (<><div id=\"default-root\" /></>);",
      metadata.repoPath,
      "binding_code",
      metadata
    );

    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
    expect(parsed.rootLocator).toEqual(reactExportLocator("default"));
    expect(rootNode?.tagName).toBe("fragment");
    expect(rootNode?.childKeys).toHaveLength(1);
  });

  it("preserves spread and reserved attributes while reading namespaced attributes and literal booleans", () => {
    const metadata = createMetadata();
    const parsed = parseTsxCodeSyncBinding(
      [
        "export function Example() {",
        "  return <div {...rest} xml:lang=\"en\" className data-empty={} data-flag={true}>",
        "    {}",
        "    {true}",
        "  </div>;",
        "}"
      ].join("\n"),
      metadata.repoPath,
      "binding_code",
      metadata
    );

    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
    expect(rootNode?.attributes).toMatchObject({
      "xml:lang": "en",
      "data-flag": "true"
    });
    expect(rootNode?.preservedAttributes).toEqual(expect.arrayContaining([
      "{...rest}",
      "className",
      "data-empty={}"
    ]));

    const childNodes = rootNode?.childKeys.map((key) => parsed.graph.nodes[key]);
    expect(childNodes?.map((node) => node.kind)).toEqual(["unsupported", "text"]);
    expect(childNodes?.[1]?.text).toBe("true");
    expect(parsed.graph.unsupportedFragments.map((fragment) => fragment.reason)).toContain("unsupported_jsx_expression");
  });

  it("treats member-expression JSX tags as unsupported component tags", () => {
    const metadata = createMetadata();
    const parsed = parseTsxCodeSyncBinding(
      "export function Example() { return <ui.Box />; }",
      metadata.repoPath,
      "binding_code",
      metadata
    );

    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
    expect(rootNode?.kind).toBe("unsupported");
    expect(rootNode?.unsupportedReason).toBe("unsupported_component_tag");
  });

  it("skips non-matching declarations and resolves arrow-block exports after default exports", () => {
    const metadata = createMetadata();
    const parsed = parseTsxCodeSyncBinding(
      [
        "export default () => <div id=\"ignored-default\" />;",
        "const { Example: Alias } = registry;",
        "let Example;",
        "export const skipped = () => <div id=\"ignored-variable\" />;",
        "export const Example = () => {",
        "  const prelude = 1;",
        "  return <div id=\"arrow-block-root\" />;",
        "};"
      ].join("\n"),
      metadata.repoPath,
      "binding_code",
      metadata
    );

    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
    expect(rootNode?.attributes.id).toBe("arrow-block-root");
    expect(parsed.rootLocator).toEqual(reactExportLocator("Example"));
  });

  it("falls back from non-JSX initializers and overload signatures before resolving function exports", () => {
    const metadata = createMetadata();
    const parsed = parseTsxCodeSyncBinding(
      [
        "const Example = renderSomething;",
        "export function Example();",
        "export function Example() {",
        "  return <div id=\"function-root\" />;",
        "}"
      ].join("\n"),
      metadata.repoPath,
      "binding_code",
      metadata
    );

    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
    expect(rootNode?.attributes.id).toBe("function-root");
  });

  it("rejects missing export names, invalid TSX, and missing JSX roots", () => {
    expect(() => parseTsxCodeSyncBinding(
      "export function Example() { return <div />; }",
      "src/example.tsx",
      "binding_code",
      {
        ...createMetadata(),
        exportName: undefined,
        rootLocator: undefined as unknown as CanvasCodeSyncBindingMetadata["rootLocator"]
      }
    )).toThrow("codeSync.exportName or codeSync.selector is required.");

    expect(() => parseTsxCodeSyncBinding(
      "export function Example() { return <div>; }",
      "src/example.tsx",
      "binding_code",
      createMetadata()
    )).toThrow("TSX parse failed:");

    expect(() => parseTsxCodeSyncBinding(
      "export function Example() { return renderSomething(); }",
      "src/example.tsx",
      "binding_code",
      createMetadata()
    )).toThrow("Unable to locate TSX export root: Example");
  });
});

describe("canvas code sync apply TSX", () => {
  it("imports graphs with selector and empty repo-path fallbacks while covering element conversion branches", () => {
    const selectorBinding = createBinding(undefined, {
      selector: "#bound-root"
    });
    const selectorDocument = createDocument(selectorBinding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: selectorBinding.id },
      props: { tagName: "div" }
    }]);

    const sharedGraph: CodeSyncGraph = {
      adapter: "tsx-react-v1",
      bindingId: selectorBinding.id,
      repoPath: "src/example.tsx",
      rootKey: "root",
      sourceHash: "graph_hash",
      unsupportedFragments: [{
        key: "unsupported:1",
        reason: "unsupported_component_tag",
        raw: "<FancyCard />",
        locator: createLocator("export:Example.child.unsupported", 40)
      }],
      nodes: {
        root: {
          key: "root",
          kind: "element",
          bindingId: selectorBinding.id,
          locator: createLocator("export:Example", 0),
          tagName: "div",
          attributes: { className: "hero", role: "presentation" },
          style: { padding: 16 },
          preservedAttributes: ["data-extra={theme}"],
          childKeys: ["text", "control", "unsupported", "untagged"]
        },
        text: {
          key: "text",
          kind: "text",
          bindingId: selectorBinding.id,
          locator: createLocator("export:Example.child.0", 10),
          text: "Imported label",
          attributes: {},
          style: {},
          preservedAttributes: [],
          childKeys: []
        },
        control: {
          key: "control",
          kind: "element",
          bindingId: selectorBinding.id,
          locator: createLocator("export:Example.child.1", 20),
          tagName: "input",
          attributes: { type: "text" },
          style: {},
          preservedAttributes: [],
          childKeys: []
        },
        unsupported: {
          key: "unsupported",
          kind: "unsupported",
          bindingId: selectorBinding.id,
          locator: createLocator("export:Example.child.2", 30),
          attributes: {},
          style: {},
          preservedAttributes: [],
          childKeys: [],
          raw: "{dynamicValue}",
          unsupportedReason: "unsupported_jsx_expression"
        },
        untagged: {
          key: "untagged",
          kind: "element",
          bindingId: selectorBinding.id,
          locator: createLocator("export:Example.child.3", 50),
          attributes: {},
          style: {},
          preservedAttributes: [],
          childKeys: []
        }
      }
    };
    const mappedManifest: CodeSyncManifest = {
      bindingId: selectorBinding.id,
      documentId: selectorDocument.documentId,
      repoPath: "src/example.tsx",
      adapter: "tsx-react-v1",
      rootLocator: { exportName: "Example" },
      sourceHash: sharedGraph.sourceHash,
      documentRevision: 2,
      nodeMappings: [
        { nodeId: "node_root", locator: sharedGraph.nodes.root.locator },
        { nodeId: "node_text", locator: sharedGraph.nodes.text.locator },
        { nodeId: "node_control", locator: sharedGraph.nodes.control.locator },
        { nodeId: "node_unsupported", locator: sharedGraph.nodes.unsupported.locator },
        { nodeId: "node_untagged", locator: sharedGraph.nodes.untagged.locator }
      ],
      lastPushedAt: "2026-03-12T03:00:00.000Z"
    };

    const selectorResult = importCodeSyncGraph({
      document: selectorDocument,
      binding: selectorBinding,
      documentRevision: 7,
      graph: sharedGraph,
      manifest: mappedManifest
    });

    expect(selectorResult.manifest.repoPath).toBe("#bound-root");
    expect(selectorResult.manifest.adapter).toBe("tsx-react-v1");
    expect(selectorResult.manifest.lastPushedAt).toBe("2026-03-12T03:00:00.000Z");
    expect(selectorResult.unsupportedRegions).toEqual(sharedGraph.unsupportedFragments);
    expect(selectorResult.changedNodeIds).toEqual(expect.arrayContaining([
      "node_root",
      "node_text",
      "node_control",
      "node_unsupported",
      "node_untagged"
    ]));

    const inserts = selectorResult.patches.filter((patch) => patch.op === "node.insert");
    expect(inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        node: expect.objectContaining({
          id: "node_text",
          kind: "text",
          name: "Imported label",
          props: expect.objectContaining({ text: "Imported label" })
        })
      }),
      expect.objectContaining({
        node: expect.objectContaining({
          id: "node_control",
          kind: "component-instance",
          name: "input"
        })
      }),
      expect.objectContaining({
        node: expect.objectContaining({
          id: "node_unsupported",
          kind: "dom-binding",
          name: "Unsupported Runtime Node"
        })
      }),
      expect.objectContaining({
        node: expect.objectContaining({
          id: "node_untagged",
          kind: "frame",
          name: "Element",
          props: expect.objectContaining({ tagName: "element" })
        })
      })
    ]));

    const emptyPathBinding = createBinding(undefined);
    const emptyPathDocument = createDocument(emptyPathBinding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: emptyPathBinding.id },
      props: { tagName: "div" }
    }]);
    const emptyPathResult = importCodeSyncGraph({
      document: emptyPathDocument,
      binding: emptyPathBinding,
      documentRevision: 3,
      graph: {
        ...sharedGraph,
        bindingId: emptyPathBinding.id,
        nodes: {
          ...sharedGraph.nodes,
          root: {
            ...sharedGraph.nodes.root,
            bindingId: emptyPathBinding.id,
            childKeys: []
          }
        }
      }
    });

    expect(emptyPathResult.manifest.repoPath).toBe("");
    expect(emptyPathResult.manifest.adapter).toBe("tsx-react-v1");
  });

  it("generates ids for unmapped nodes, preserves nested parents, and falls back missing text values", () => {
    const metadata = createMetadata();
    const binding = createBinding(metadata);
    const document = createDocument(binding, [
      {
        id: "node_root",
        kind: "frame",
        name: "Root",
        childIds: ["node_existing"],
        bindingRefs: { primary: binding.id },
        props: { tagName: "div" }
      },
      {
        id: "node_existing",
        kind: "text",
        name: "Existing",
        parentId: "node_root",
        props: { text: "Remove me" }
      }
    ]);

    const graph: CodeSyncGraph = {
      adapter: "tsx-react-v1",
      bindingId: binding.id,
      repoPath: metadata.repoPath,
      rootKey: "root",
      sourceHash: "graph_hash_nested",
      unsupportedFragments: [],
      nodes: {
        root: {
          key: "root",
          kind: "element",
          bindingId: binding.id,
          locator: createLocator("export:Example", 0),
          tagName: "div",
          attributes: {},
          style: {},
          preservedAttributes: [],
          childKeys: ["text", "group"]
        },
        text: {
          key: "text",
          kind: "text",
          bindingId: binding.id,
          locator: createLocator("export:Example.child.0", 10),
          attributes: {},
          style: {},
          preservedAttributes: [],
          childKeys: []
        },
        group: {
          key: "group",
          kind: "element",
          bindingId: binding.id,
          locator: createLocator("export:Example.child.1", 20),
          tagName: "section",
          attributes: {},
          style: {},
          preservedAttributes: [],
          childKeys: ["nested"]
        },
        nested: {
          key: "nested",
          kind: "text",
          bindingId: binding.id,
          locator: createLocator("export:Example.child.1.child.0", 30),
          text: "Nested child",
          attributes: {},
          style: {},
          preservedAttributes: [],
          childKeys: []
        }
      }
    };
    const manifest: CodeSyncManifest = {
      bindingId: binding.id,
      documentId: document.documentId,
      repoPath: metadata.repoPath,
      adapter: metadata.adapter,
      rootLocator: { exportName: metadata.exportName },
      sourceHash: graph.sourceHash,
      documentRevision: 1,
      nodeMappings: [{
        nodeId: binding.nodeId,
        locator: graph.nodes.root.locator
      }]
    };

    const result = importCodeSyncGraph({
      document,
      binding,
      documentRevision: 5,
      graph,
      manifest
    });
    const inserts = result.patches.filter((patch) => patch.op === "node.insert") as Array<{
      pageId: string;
      parentId: string | null;
      node: CanvasNode;
    }>;

    expect(result.patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "node.remove", nodeId: "node_existing" })
    ]));

    const textInsert = inserts.find((patch) => patch.node.kind === "text" && patch.node.props.text === "");
    expect(textInsert).toMatchObject({
      pageId: "page_home",
      parentId: "node_root",
      node: expect.objectContaining({
        name: "Text",
        props: expect.objectContaining({ text: "" })
      })
    });

    const groupInsert = inserts.find((patch) => patch.node.props.tagName === "section");
    expect(groupInsert?.node.id).toMatch(/^node_sync_/);
    const nestedInsert = inserts.find((patch) => patch.node.props.text === "Nested child");
    expect(nestedInsert?.parentId).toBe(groupInsert?.node.id);
  });

  it("throws for missing canvas roots and malformed imported graph traversals", () => {
    const metadata = createMetadata();
    const binding = createBinding(metadata, { nodeId: "node_missing" });
    const document = createDocument(binding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: binding.id },
      props: { tagName: "div" }
    }]);
    const sourceText = "export function Example() { return <div />; }";

    const parsed = parseTsxCodeSyncBinding(sourceText, metadata.repoPath, binding.id, metadata);
    expect(() => importCodeSyncGraph({
      document,
      binding,
      documentRevision: 1,
      graph: parsed.graph
    })).toThrow("Unknown canvas node: node_missing");

    const goodBinding = createBinding(metadata);
    const goodDocument = createDocument(goodBinding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: goodBinding.id },
      props: { tagName: "div" }
    }]);
    expect(() => importCodeSyncGraph({
      document: goodDocument,
      binding: goodBinding,
      documentRevision: 1,
      graph: {
        ...parsed.graph,
        rootKey: parsed.graph.rootKey,
        nodes: {
          [parsed.graph.rootKey]: {
            ...parsed.graph.nodes[parsed.graph.rootKey],
            childKeys: ["ghost"]
          }
        }
      }
    })).toThrow("Unknown graph node: ghost");
  });

  it("returns a source hash conflict unless prefer_canvas is used", () => {
    const metadata = createMetadata();
    const binding = createBinding(metadata);
    const document = createDocument(binding, [
      {
        id: "node_root",
        kind: "frame",
        name: "Root",
        childIds: ["node_label"],
        bindingRefs: { primary: binding.id },
        props: { tagName: "div" }
      },
      {
        id: "node_label",
        kind: "text",
        name: "Hello",
        parentId: "node_root",
        props: { text: "Hello" }
      }
    ]);
    const sourceText = "export function Example() { return <div><span>Hello</span></div>; }";
    const manifest = buildManifest(document, binding, metadata, sourceText);
    const changedSource = `${sourceText}\n// changed outside the bound region`;

    const conflict = applyCanvasToTsx({
      document,
      binding,
      manifest,
      sourceText: changedSource
    });
    expect(conflict).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({
        kind: "source_hash_changed",
        bindingId: binding.id
      })]
    });

    const preferred = applyCanvasToTsx({
      document,
      binding,
      manifest,
      sourceText: changedSource,
      resolutionPolicy: "prefer_canvas"
    });
    expect(preferred.ok).toBe(true);
    if (preferred.ok) {
      expect(preferred.changedNodeIds).toEqual(["node_root", "node_label"]);
      expect(preferred.nextSource).toContain("data-binding-id=\"binding_code\"");
    }
  });

  it("returns conflicts for missing manifest mappings and unsupported canvas nodes", () => {
    const metadata = createMetadata();
    const binding = createBinding(metadata);
    const sourceText = "export function Example() { return <div><span>Hello</span></div>; }";

    const missingMappingDocument = createDocument(binding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: binding.id },
      props: { tagName: "div" }
    }]);
    const missingMappingManifest: CodeSyncManifest = {
      bindingId: binding.id,
      documentId: missingMappingDocument.documentId,
      repoPath: metadata.repoPath,
      adapter: metadata.adapter,
      rootLocator: { exportName: metadata.exportName },
      sourceHash: hashCodeSyncValue(sourceText),
      documentRevision: 1,
      nodeMappings: []
    };
    expect(applyCanvasToTsx({
      document: missingMappingDocument,
      binding,
      manifest: missingMappingManifest,
      sourceText
    })).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        nodeId: binding.nodeId,
        message: "Missing root manifest mapping for the bound TSX region."
      })]
    });

    const unsupportedDocument = createDocument(binding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: binding.id },
      props: { tagName: "div" },
      metadata: {
        codeSync: {
          tagName: "div",
          unsupportedReason: "dynamic-runtime-only"
        }
      }
    }]);
    const unsupportedManifest = buildManifest(unsupportedDocument, binding, metadata, sourceText);
    expect(applyCanvasToTsx({
      document: unsupportedDocument,
      binding,
      manifest: unsupportedManifest,
      sourceText
    })).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "Unsupported code sync node node_root: dynamic-runtime-only"
      })]
    });
  });

  it("emits class names, styles, string attributes, and mixed child nodes", () => {
    const metadata = createMetadata({ repoPath: "src/emission.tsx" });
    const binding = createBinding(metadata);
    const sourceText = "export function Example() { return <section />; }";
    const document = createDocument(binding, [
      {
        id: "node_root",
        kind: "frame",
        name: "Root",
        childIds: ["node_copy", "node_divider"],
        bindingRefs: { primary: binding.id },
        props: {
          tagName: "section",
          className: "hero-shell",
          attributes: {
            title: "Hero"
          }
        },
        style: {
          padding: 16
        }
      },
      {
        id: "node_copy",
        kind: "text",
        name: "Live Copy",
        parentId: "node_root",
        props: { text: "Live copy" }
      },
      {
        id: "node_divider",
        kind: "frame",
        name: "Divider",
        parentId: "node_root",
        props: {
          tagName: "hr",
          attributes: {
            "aria-hidden": "true"
          }
        }
      }
    ]);
    const manifest = buildManifest(document, binding, metadata, sourceText);
    const result = applyCanvasToTsx({
      document,
      binding,
      manifest,
      sourceText
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected TSX emission success");
    }

    expect(result.nextSource).toContain('className="hero-shell"');
    expect(result.nextSource).toContain('style={{ padding: 16 }}');
    expect(result.nextSource).toContain('title="Hero"');
    expect(result.nextSource).toContain('data-node-id="node_root"');
    expect(result.nextSource).toContain('data-binding-id="binding_code"');
    expect(result.nextSource).toContain('{"Live copy"}');
    expect(result.nextSource).toContain('<hr aria-hidden="true" data-node-id="node_divider" />');
  });

  it("canonicalizes code sync markers instead of re-emitting stale preserved attributes", () => {
    const metadata = createMetadata({ repoPath: "src/canonical-markers.tsx" });
    const binding = createBinding(metadata);
    const sourceText = [
      "export function Example() {",
      "  return <section data-node-id=\"legacy-root\" data-binding-id=\"binding_code\" data-extra={theme}><span data-node-id=\"legacy-copy\" data-binding-id=\"binding_code\">{\"Hello\"}</span></section>;",
      "}"
    ].join("\n");
    const document = createDocument(binding, [
      {
        id: "node_root",
        kind: "frame",
        name: "Root",
        childIds: ["node_copy"],
        bindingRefs: { primary: binding.id },
        props: { tagName: "section" },
        metadata: {
          codeSync: {
            tagName: "section",
            preservedAttributes: [
              'data-node-id="legacy-root"',
              'data-binding-id="binding_code"',
              "data-extra={theme}"
            ]
          }
        }
      },
      {
        id: "node_copy",
        kind: "frame",
        name: "Copy Shell",
        parentId: "node_root",
        childIds: ["node_label"],
        bindingRefs: { primary: binding.id },
        props: { tagName: "span" },
        metadata: {
          codeSync: {
            tagName: "span",
            preservedAttributes: [
              'data-node-id="legacy-copy"',
              'data-binding-id="binding_code"'
            ]
          }
        }
      },
      {
        id: "node_label",
        kind: "text",
        name: "Live Copy",
        parentId: "node_copy",
        props: { text: "Hello canonical" }
      }
    ]);
    const manifest = buildManifest(document, binding, metadata, sourceText);
    const result = applyCanvasToTsx({
      document,
      binding,
      manifest,
      sourceText,
      resolutionPolicy: "prefer_canvas"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected TSX emission success");
    }

    expect(result.nextSource).toContain('data-node-id="node_root"');
    expect(result.nextSource).toContain('data-node-id="node_copy"');
    expect(result.nextSource).toContain('data-binding-id="binding_code"');
    expect(result.nextSource).toContain("data-extra={theme}");
    expect(result.nextSource).not.toContain("legacy-root");
    expect(result.nextSource).not.toContain("legacy-copy");
    expect(countOccurrences(result.nextSource, "data-node-id=")).toBe(2);
    expect(countOccurrences(result.nextSource, 'data-binding-id="binding_code"')).toBe(2);
  });

  it("returns conflicts for invalid generated TSX and missing code sync metadata", () => {
    const metadata = createMetadata();
    const sourceText = "export function Example() { return <div><span>Hello</span></div>; }";

    const invalidBinding = createBinding(metadata);
    const invalidDocument = createDocument(invalidBinding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: invalidBinding.id },
      props: { tagName: "div" },
      metadata: {
        codeSync: {
          tagName: "div",
          preservedAttributes: ["oops={"]
        }
      }
    }]);
    const invalidManifest = buildManifest(invalidDocument, invalidBinding, metadata, sourceText);
    expect(applyCanvasToTsx({
      document: invalidDocument,
      binding: invalidBinding,
      manifest: invalidManifest,
      sourceText
    })).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: expect.stringContaining("Generated TSX is invalid:")
      })]
    });

    const parsedMetadata = createMetadata();
    const missingMetadataBinding = createBinding(undefined);
    const missingMetadataDocument = createDocument(missingMetadataBinding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: missingMetadataBinding.id },
      props: { tagName: "div" }
    }]);
    const missingMetadataManifest = buildManifest(
      missingMetadataDocument,
      createBinding(parsedMetadata, { id: missingMetadataBinding.id, nodeId: missingMetadataBinding.nodeId }),
      parsedMetadata,
      sourceText
    );
    expect(applyCanvasToTsx({
      document: missingMetadataDocument,
      binding: missingMetadataBinding,
      manifest: missingMetadataManifest,
      sourceText
    })).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "Binding is missing code-sync metadata."
      })]
    });
  });

  it("returns a drift conflict when emitted TSX re-parses into a different subtree", () => {
    const metadata = createMetadata();
    const binding = createBinding(metadata);
    const sourceText = "export function Example() { return <div><span>Hello</span></div>; }";
    const document = createDocument(binding, [
      {
        id: "node_root",
        kind: "frame",
        name: "Fancy Root",
        childIds: ["node_label"],
        bindingRefs: { primary: binding.id },
        props: { tagName: "div" },
        metadata: {
          codeSync: {
            tagName: "FancyBox"
          }
        }
      },
      {
        id: "node_label",
        kind: "text",
        name: "Hello",
        parentId: "node_root",
        props: { text: "Hello" }
      }
    ]);
    const manifest = buildManifest(document, binding, metadata, sourceText);

    expect(applyCanvasToTsx({
      document,
      binding,
      manifest,
      sourceText
    })).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "Re-parsed TSX graph drifted from the emitted canvas subtree."
      })]
    });
  });

  it("emits self-closing roots, drops invalid attrs/styles, and falls back to text node names", () => {
    const selfClosingMetadata = createMetadata();
    const selfClosingBinding = createBinding(selfClosingMetadata, {
      id: "node_root",
      nodeId: "node_root"
    });
    const selfClosingDocument = createDocument(selfClosingBinding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: {},
      props: {
        tagName: "div",
        attributes: {
          title: 42 as unknown as string
        }
      },
      style: {
        nested: { color: "red" },
        enabled: true
      } as unknown as CanvasNode["style"]
    }]);
    const selfClosingSource = "export function Example() { return <div />; }";
    const selfClosingManifest = buildManifest(selfClosingDocument, selfClosingBinding, selfClosingMetadata, selfClosingSource);
    const selfClosingResult = applyCanvasToTsx({
      document: selfClosingDocument,
      binding: selfClosingBinding,
      manifest: selfClosingManifest,
      sourceText: selfClosingSource
    });

    expect(selfClosingResult.ok).toBe(true);
    if (selfClosingResult.ok) {
      expect(selfClosingResult.nextSource).toContain("<div data-node-id=\"node_root\" data-binding-id=\"node_root\" />");
      expect(selfClosingResult.nextSource).not.toContain("style=");
      expect(selfClosingResult.nextSource).not.toContain("title=");
    }

    const textMetadata = createMetadata();
    const textBinding = createBinding(textMetadata);
    const textDocument = createDocument(textBinding, [
      {
        id: "node_root",
        kind: "frame",
        name: "Root",
        childIds: ["node_label"],
        bindingRefs: { primary: textBinding.id },
        props: { tagName: "div" }
      },
      {
        id: "node_label",
        kind: "text",
        name: "Fallback Label",
        parentId: "node_root",
        props: {
          text: 42 as unknown as string
        }
      }
    ]);
    const textSource = "export function Example() { return <div><span>Hello</span></div>; }";
    const textManifest = buildManifest(textDocument, textBinding, textMetadata, textSource);
    const textResult = applyCanvasToTsx({
      document: textDocument,
      binding: textBinding,
      manifest: textManifest,
      sourceText: textSource
    });

    expect(textResult.ok).toBe(true);
    if (textResult.ok) {
      expect(textResult.nextSource).toContain("{\"Fallback Label\"}");
    }
  });

  it("returns caught conflicts for missing emitted roots and string-thrown child traversal failures", () => {
    const metadata = createMetadata();
    const sourceText = "export function Example() { return <div />; }";

    const missingBinding = createBinding(metadata, { nodeId: "node_missing" });
    const missingDocument = createDocument(missingBinding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: missingBinding.id },
      props: { tagName: "div" }
    }]);
    const missingParsed = parseTsxCodeSyncBinding(sourceText, metadata.repoPath, missingBinding.id, metadata);
    expect(applyCanvasToTsx({
      document: missingDocument,
      binding: missingBinding,
      manifest: {
        bindingId: missingBinding.id,
        documentId: missingDocument.documentId,
        repoPath: metadata.repoPath,
        adapter: metadata.adapter,
        rootLocator: { exportName: metadata.exportName },
        sourceHash: hashCodeSyncValue(sourceText),
        documentRevision: 1,
        nodeMappings: [{
          nodeId: missingBinding.nodeId,
          locator: missingParsed.graph.nodes[missingParsed.graph.rootKey]!.locator
        }]
      },
      sourceText
    })).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "Unknown canvas node: node_missing"
      })]
    });

    const throwingBinding = createBinding(metadata);
    const throwingDocument = createDocument(throwingBinding, [
      {
        id: "node_root",
        kind: "frame",
        name: "Root",
        childIds: ["node_label"],
        bindingRefs: { primary: throwingBinding.id },
        props: { tagName: "div" }
      },
      {
        id: "node_label",
        kind: "text",
        name: "Hello",
        parentId: "node_root",
        props: { text: "Hello" }
      }
    ]);
    const throwingManifest = buildManifest(throwingDocument, throwingBinding, metadata, "export function Example() { return <div><span>Hello</span></div>; }");
    const rootNode = throwingDocument.pages[0]?.nodes[0];
    if (!rootNode) {
      throw new Error("Missing test root node");
    }
    rootNode.childIds = {
      length: 1,
      map() {
        throw "string failure";
      }
    } as unknown as string[];

    expect(applyCanvasToTsx({
      document: throwingDocument,
      binding: throwingBinding,
      manifest: throwingManifest,
      sourceText: "export function Example() { return <div><span>Hello</span></div>; }"
    })).toEqual({
      ok: false,
      conflicts: [expect.objectContaining({
        kind: "unsupported_change",
        message: "string failure"
      })]
    });
  });

  it("surfaces collectGraphOrder failures from mocked re-parse results", () => {
    const metadata = createMetadata();
    const binding = createBinding(metadata);
    const sourceText = "export function Example() { return <div />; }";
    const document = createDocument(binding, [{
      id: "node_root",
      kind: "frame",
      name: "Root",
      bindingRefs: { primary: binding.id },
      props: { tagName: "div" }
    }]);
    const manifest = buildManifest(document, binding, metadata, sourceText);

    const spy = vi.spyOn(tsxAdapter, "parseTsxCodeSyncBinding").mockReturnValue({
      graph: {
        adapter: metadata.adapter,
        bindingId: binding.id,
        repoPath: metadata.repoPath,
        rootKey: "root",
        sourceHash: hashCodeSyncValue(sourceText),
        unsupportedFragments: [],
        nodes: {
          root: {
            key: "root",
            kind: "element",
            bindingId: binding.id,
            locator: manifest.nodeMappings[0]!.locator,
            tagName: "div",
            attributes: {},
            style: {},
            preservedAttributes: [],
            childKeys: ["ghost"]
          }
        }
      },
      rootLocator: { exportName: metadata.exportName }
    });

    try {
      expect(() => applyCanvasToTsx({
        document,
        binding,
        manifest,
        sourceText
      })).toThrow("Unknown graph node: ghost");
    } finally {
      spy.mockRestore();
    }
  });
});
