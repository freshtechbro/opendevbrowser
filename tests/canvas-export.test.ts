import { describe, expect, it } from "vitest";
import { createDefaultCanvasDocument } from "../src/canvas/document-store";
import { renderCanvasDocumentComponent, renderCanvasDocumentHtml } from "../src/canvas/export";
import type { CanvasNode } from "../src/canvas/types";

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

describe("canvas export", () => {
  it("renders mixed node kinds to HTML", () => {
    const document = createDefaultCanvasDocument("dc_export_html");
    const page = document.pages[0];
    if (!page) {
      throw new Error("Missing default page");
    }
    page.rootNodeId = "node_root";
    page.nodes = [
      createNode(page.id, {
        id: "node_root",
        kind: "frame",
        name: "***",
        childIds: ["node_text", "node_note", "node_connector", "node_shape", "node_fallback"],
        style: { backgroundColor: "#07111d", zIndex: 2, hidden: true }
      }),
      createNode(page.id, {
        id: "node_text",
        kind: "text",
        name: "Hero Copy",
        props: { text: "Hello <World>" },
        style: { color: "#f3f6fb" }
      }),
      createNode(page.id, {
        id: "node_note",
        kind: "note",
        name: "Note",
        metadata: { text: "Use metadata text" }
      }),
      createNode(page.id, {
        id: "node_connector",
        kind: "connector",
        name: "Divider"
      }),
      createNode(page.id, {
        id: "node_shape",
        kind: "shape",
        name: "Shape",
        childIds: ["node_missing"]
      }),
      createNode(page.id, {
        id: "node_fallback",
        kind: "frame",
        name: "",
        metadata: { text: 123 }
      })
    ];

    const html = renderCanvasDocumentHtml(document);

    expect(html).toContain("odb-canvas-node odb-canvas-frame");
    expect(html).toContain("background-color:#07111d;z-index:2");
    expect(html).toContain("Hello &lt;World&gt;");
    expect(html).toContain("<aside");
    expect(html).toContain("<hr");
    expect(html).toContain(">123</div>");
  });

  it("renders component output for empty pages and metadata-backed nodes", () => {
    const document = createDefaultCanvasDocument("dc_export_component");
    const [homePage] = document.pages;
    if (!homePage) {
      throw new Error("Missing default page");
    }
    homePage.rootNodeId = null;
    homePage.nodes = [];
    document.pages.push({
      id: "page_marketing",
      name: "Marketing",
      path: "/marketing",
      rootNodeId: "node_marketing",
      prototypeIds: [],
      nodes: [
        createNode("page_marketing", {
          id: "node_marketing",
          kind: "frame",
          name: "",
          childIds: ["node_copy", "node_missing"],
          style: { padding: "1rem" }
        }),
        createNode("page_marketing", {
          id: "node_copy",
          kind: "note",
          name: "Marketing Note",
          metadata: { text: "Metadata text" },
          style: { hidden: true }
        })
      ],
      metadata: {}
    });

    const html = renderCanvasDocumentHtml(document);
    const component = renderCanvasDocumentComponent(document);

    expect(html).toContain("data-page-id=\"page_home\"></section>");
    expect(component).toContain("<div />");
    expect(component).toContain("Metadata text");
    expect(component).toContain("style={{ \"padding\": \"1rem\" }}");
    expect(component).toContain("data-page-id=\"page_marketing\"");
  });

  it("filters non-renderable styles and preserves empty text slots in component output", () => {
    const document = createDefaultCanvasDocument("dc_export_component_empty");
    const [page] = document.pages;
    if (!page) {
      throw new Error("Missing default page");
    }

    page.rootNodeId = "node_root";
    page.nodes = [
      createNode(page.id, {
        id: "node_root",
        kind: "frame",
        name: "",
        childIds: ["node_child"],
        style: { hidden: true }
      }),
      createNode(page.id, {
        id: "node_child",
        kind: "text",
        name: "Child",
        props: { text: "" },
        style: { opacity: 0.5 }
      })
    ];

    const component = renderCanvasDocumentComponent(document);

    expect(component).not.toContain("style={{  }}");
    expect(component).toContain("style={{ \"opacity\": 0.5 }}");
    expect(component).toContain("<div data-node-id=\"node_root\"");
    expect(component).toContain("<p data-node-id=\"node_child\"");
  });
});
