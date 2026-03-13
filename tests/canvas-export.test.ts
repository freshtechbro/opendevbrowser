import { describe, expect, it } from "vitest";
import { createDefaultCanvasDocument } from "../src/canvas/document-store";
import {
  buildCanvasParityArtifact,
  renderCanvasBindingHtml,
  renderCanvasDocumentComponent,
  renderCanvasDocumentHtml
} from "../src/canvas/export";
import { CANVAS_SURFACE_TOKENS, CANVAS_SURFACE_TOKEN_VARIABLES } from "../src/canvas/surface-palette";
import type { CanvasBinding, CanvasNode } from "../src/canvas/types";

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

function createBinding(binding: Partial<CanvasBinding> & Pick<CanvasBinding, "id" | "nodeId" | "kind">): CanvasBinding {
  return {
    id: binding.id,
    nodeId: binding.nodeId,
    kind: binding.kind,
    componentName: binding.componentName,
    selector: binding.selector,
    metadata: binding.metadata ?? {}
  };
}

function createLibraryDocument() {
  const document = createDefaultCanvasDocument("dc_export_library_primitives");
  const [page] = document.pages;
  if (!page) {
    throw new Error("Missing default page");
  }
  page.rootNodeId = "node_root";
  page.nodes = [
    createNode(page.id, {
      id: "node_root",
      kind: "frame",
      name: "Root Surface",
      childIds: ["node_nav", "node_primary_cta", "node_secondary_tabs", "node_card", "node_note", "node_connector"],
      rect: { x: 0, y: 0, width: 960, height: 720 },
      style: {
        background: "linear-gradient(135deg, #081220 0%, #10263b 100%)",
        borderRadius: "32px",
        padding: "40px"
      },
      metadata: { pageRole: "root-surface" }
    }),
    createNode(page.id, {
      id: "node_nav",
      kind: "text",
      name: "Navigation",
      rect: { x: 48, y: 36, width: 360, height: 32 },
      props: { text: "Platform    Workflows    Pricing    Docs" },
      style: { color: "#d8e7f5", fontSize: "14px", fontWeight: 600 }
    }),
    createNode(page.id, {
      id: "node_primary_cta",
      kind: "component-instance",
      name: "Primary CTA",
      rect: { x: 48, y: 96, width: 236, height: 54 },
      props: { text: "Launch board" },
      style: {
        alignItems: "center",
        background: "linear-gradient(135deg, #20d5c6 0%, #22c3ee 100%)",
        borderRadius: "999px",
        color: "#06101a",
        display: "flex",
        fontSize: "15px",
        fontWeight: 800,
        justifyContent: "center"
      },
      bindingRefs: { primary: "binding_button" },
      metadata: {
        iconRef: {
          identifier: "rocket",
          sourceLibrary: "tabler"
        }
      }
    }),
    createNode(page.id, {
      id: "node_secondary_tabs",
      kind: "component-instance",
      name: "Secondary Tabs",
      rect: { x: 304, y: 96, width: 220, height: 54 },
      props: { text: "System map" },
      style: {
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: "999px",
        color: "#dbe8f6",
        fontSize: "15px",
        fontWeight: 700
      },
      bindingRefs: { primary: "binding_tabs" },
      metadata: {
        iconRef: {
          identifier: "grid-dots-24",
          sourceLibrary: "microsoft-fluent-ui-system-icons"
        }
      }
    }),
    createNode(page.id, {
      id: "node_card",
      kind: "component-instance",
      name: "Library Card",
      rect: { x: 48, y: 196, width: 336, height: 148 },
      props: {
        text: "shadcn UI\nButton, Card, Badge, Tabs\nTabler utility icons keep dense controls readable."
      },
      style: {
        background: "rgba(10, 22, 35, 0.92)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "24px",
        color: "#e5eff8",
        fontSize: "15px",
        fontWeight: 700,
        lineHeight: 1.5,
        padding: "20px"
      },
      bindingRefs: { primary: "binding_card" },
      metadata: {
        iconRefs: [
          { identifier: "components", sourceLibrary: "tabler" },
          { identifier: "sparkles", sourceLibrary: "@lobehub/fluent-emoji-3d" }
        ]
      }
    }),
    createNode(page.id, {
      id: "node_note",
      kind: "note",
      name: "Export Note",
      rect: { x: 420, y: 212, width: 248, height: 110 },
      metadata: { text: "Fallback note still renders in the same positioned page." },
      style: {
        borderLeft: "3px solid #20d5c6",
        color: "#9db4c9",
        padding: "12px 16px"
      }
    }),
    createNode(page.id, {
      id: "node_connector",
      kind: "connector",
      name: "Divider",
      rect: { x: 48, y: 388, width: 560, height: 2 }
    })
  ];
  document.bindings = [
    createBinding({
      id: "binding_button",
      nodeId: "node_primary_cta",
      kind: "component",
      componentName: "Button",
      metadata: { sourceKind: "shadcn" }
    }),
    createBinding({
      id: "binding_tabs",
      nodeId: "node_secondary_tabs",
      kind: "component",
      componentName: "Tabs",
      metadata: { sourceKind: "shadcn" }
    }),
    createBinding({
      id: "binding_card",
      nodeId: "node_card",
      kind: "component",
      componentName: "Card",
      metadata: { sourceKind: "shadcn" }
    })
  ];
  return document;
}

function createFallbackDocument() {
  const document = createDefaultCanvasDocument("dc_export_fallback_variants");
  document.designGovernance.libraryPolicy = {
    components: ["shadcn"],
    icons: ["3dicons", "tabler", "microsoft-fluent-ui-system-icons", "@lobehub/fluent-emoji-3d"],
    styling: [],
    motion: ["motion"],
    threeD: []
  };
  const [page] = document.pages;
  if (!page) {
    throw new Error("Missing default page");
  }
  page.rootNodeId = null;
  page.nodes = [
    createNode(page.id, {
      id: "node_title",
      kind: "text",
      name: "Hero Title",
      rect: { x: 40, y: 32, width: 380, height: 72 },
      props: { text: "Atlas Workspace" },
      style: { fontSize: 56, fontWeight: 800 }
    }),
    createNode(page.id, {
      id: "node_section",
      kind: "text",
      name: "Section Intro",
      rect: { x: 40, y: 120, width: 280, height: 36 },
      props: { text: "Operator visibility" },
      style: { fontSize: 30, fontWeight: 700 }
    }),
    createNode(page.id, {
      id: "node_brand",
      kind: "text",
      name: "Brand Logos",
      rect: { x: 40, y: 176, width: 320, height: 28 },
      props: { text: "shadcn  Tabler  Fluent" },
      style: { fontSize: 16, fontWeight: 600 }
    }),
    createNode(page.id, {
      id: "node_copy",
      kind: "text",
      name: "Body Copy",
      rect: { x: 40, y: 220, width: 320, height: 48 },
      props: { text: "One line body copy." },
      style: { fontSize: 16 }
    }),
    createNode(page.id, {
      id: "node_group",
      kind: "frame",
      name: "Support Group",
      rect: { x: 40, y: 288, width: 240, height: 56 },
      metadata: { text: "Support copy" },
      style: { border: "1px solid rgba(255,255,255,0.12)", borderRadius: "16px", padding: "12px 16px" }
    }),
    createNode(page.id, {
      id: "node_badge_fallback",
      kind: "component-instance",
      name: "Badge Fallback",
      rect: { x: 420, y: 40, width: 132, height: 40 },
      props: { text: "Preview" },
      style: { background: "#0f2438", borderRadius: "999px", color: "#dfe9f4" }
    }),
    createNode(page.id, {
      id: "node_button_fallback",
      kind: "component-instance",
      name: "Button Fallback",
      rect: { x: 420, y: 96, width: 180, height: 64 },
      props: { text: "Ship update" },
      metadata: {
        iconRefs: [
          { identifier: "spark", sourceLibrary: "tabler" },
          { identifier: "arrow-right", sourceLibrary: "tabler" }
        ]
      },
      style: { background: "#20d5c6", borderRadius: "999px", color: "#06101a", fontWeight: 800 }
    }),
    createNode(page.id, {
      id: "node_motion_card",
      kind: "component-instance",
      name: "Motion Card",
      rect: { x: 420, y: 188, width: 260, height: 120 },
      props: { text: "Motion board" },
      bindingRefs: { primary: "binding_motion" },
      metadata: {
        iconRef: { identifier: "layout-dashboard", sourceLibrary: "tabler" }
      },
      style: { background: "#0d1d2e", borderRadius: "24px", color: "#f2f7fb", padding: "20px" }
    }),
    createNode(page.id, {
      id: "node_dialog_card",
      kind: "component-instance",
      name: "Dialog Card",
      rect: { x: 700, y: 188, width: 260, height: 120 },
      props: { text: "Dialog shell" },
      bindingRefs: { primary: "binding_dialog" },
      metadata: {
        iconRef: { identifier: "branch-24", sourceLibrary: "microsoft-fluent-ui-system-icons" }
      },
      style: { background: "#13283c", borderRadius: "24px", color: "#f2f7fb", padding: "20px" }
    }),
    createNode(page.id, {
      id: "node_party_badge",
      kind: "component-instance",
      name: "Party Badge",
      rect: { x: 420, y: 332, width: 196, height: 40 },
      props: { text: "Party ready" },
      bindingRefs: { primary: "binding_badge" },
      metadata: {
        iconRefs: [
          { identifier: "orb", sourceLibrary: "3dicons" },
          { identifier: "party-popper", sourceLibrary: "@lobehub/fluent-emoji-3d" }
        ]
      },
      style: { background: "#16283a", borderRadius: "999px", color: "#eef4fa" }
    }),
    createNode(page.id, {
      id: "node_divider",
      kind: "connector",
      name: "Divider",
      rect: { x: 40, y: 388, width: 920, height: 2 }
    })
  ];
  document.bindings = [
    createBinding({
      id: "binding_motion",
      nodeId: "node_motion_card",
      kind: "component",
      metadata: { exportName: "Motion Panel", sourceKind: "motion" }
    }),
    createBinding({
      id: "binding_dialog",
      nodeId: "node_dialog_card",
      kind: "component",
      metadata: { exportName: "Dialog Shell" }
    }),
    createBinding({
      id: "binding_badge",
      nodeId: "node_party_badge",
      kind: "component",
      componentName: "Badge",
      metadata: { sourceKind: "shadcn" }
    })
  ];
  return document;
}

function createMissingRootDocument() {
  const document = createDefaultCanvasDocument("dc_export_missing_root");
  const [page] = document.pages;
  if (!page) {
    throw new Error("Missing default page");
  }
  page.rootNodeId = "node_missing";
  page.nodes = [
    createNode(page.id, {
      id: "node_orphan",
      kind: "text",
      name: "Orphan Copy",
      rect: { x: 0, y: 0, width: 200, height: 40 },
      props: { text: "This page should render empty because the declared root is missing." }
    })
  ];
  return document;
}

function createEdgeCaseBranchDocument() {
  const document = createDefaultCanvasDocument("dc_export_edge_cases");
  const [page] = document.pages;
  if (!page) {
    throw new Error("Missing default page");
  }
  page.rootNodeId = null;
  page.nodes = [
    createNode(page.id, {
      id: "node_empty_card",
      kind: "component-instance",
      name: "",
      rect: { x: 24, y: 24, width: 240, height: 132 },
      bindingRefs: { primary: "binding_card_edge" },
      style: { background: "#081220", borderRadius: "24px", color: "#f3f7fb", padding: "20px" }
    }),
    createNode(page.id, {
      id: "node_empty_button",
      kind: "component-instance",
      name: "",
      rect: { x: 296, y: 24, width: 176, height: 60 },
      bindingRefs: { primary: "binding_button_edge" },
      style: { background: "#20d5c6", borderRadius: "999px", color: "#06101a" }
    }),
    createNode(page.id, {
      id: "node_empty_badge",
      kind: "component-instance",
      name: "",
      rect: { x: 296, y: 100, width: 176, height: 36 },
      bindingRefs: { primary: "binding_badge_edge" },
      metadata: {
        iconRef: { sourceLibrary: "microsoft-fluent-ui-system-icons" }
      },
      style: { background: "#10263b", borderRadius: "999px", color: "#e5eff8" }
    }),
    createNode(page.id, {
      id: "node_empty_tabs",
      kind: "component-instance",
      name: "",
      rect: { x: 296, y: 152, width: 220, height: 56 },
      bindingRefs: { primary: "binding_tabs_edge" },
      metadata: {
        iconRef: { identifier: "chat-bubbles-24", sourceLibrary: "microsoft-fluent-ui-system-icons" }
      },
      style: { background: "rgba(255,255,255,0.06)", borderRadius: "999px", color: "#dbe8f6" }
    }),
    createNode(page.id, {
      id: "node_numeric_note",
      kind: "note",
      name: "Numeric Note",
      rect: { x: 24, y: 188, width: 180, height: 72 },
      metadata: { text: 42 },
      style: { borderLeft: "3px solid #20d5c6", padding: "12px 16px" }
    }),
    createNode(page.id, {
      id: "node_empty_text",
      kind: "text",
      name: "",
      rect: { x: 24, y: 284, width: 160, height: 32 },
      style: { fontSize: "huge" }
    }),
    createNode(page.id, {
      id: "node_heuristic_card",
      kind: "component-instance",
      name: "Heuristic Card",
      rect: { x: 24, y: 332, width: 220, height: 112 },
      props: { text: "Heuristic panel" },
      style: { background: "#13283c", borderRadius: "24px", color: "#f2f7fb", padding: "20px" }
    }),
    createNode(page.id, {
      id: "node_missing_binding",
      kind: "component-instance",
      name: "Loose Node",
      rect: { x: 296, y: 224, width: 176, height: 40 },
      props: { text: "Loose node" },
      bindingRefs: { primary: "binding_missing" },
      metadata: {
        iconRefs: [
          null as unknown as Record<string, unknown>,
          { identifier: "spark" } as unknown as Record<string, unknown>
        ]
      },
      style: { background: "#0f2438", borderRadius: "999px", color: "#dfe9f4" }
    }),
    createNode(page.id, {
      id: "node_boolean_font",
      kind: "text",
      name: "Boolean Font",
      rect: { x: 24, y: 460, width: 180, height: 32 },
      props: { text: "Boolean font fallback" },
      style: { fontSize: true as unknown as string }
    })
  ];
  document.bindings = [
    createBinding({
      id: "binding_card_edge",
      nodeId: "node_empty_card",
      kind: "component",
      componentName: "Card",
      metadata: "invalid" as unknown as CanvasBinding["metadata"]
    }),
    createBinding({
      id: "binding_button_edge",
      nodeId: "node_empty_button",
      kind: "component",
      componentName: "Button",
      metadata: "invalid" as unknown as CanvasBinding["metadata"]
    }),
    createBinding({
      id: "binding_badge_edge",
      nodeId: "node_empty_badge",
      kind: "component",
      componentName: "Badge",
      metadata: "invalid" as unknown as CanvasBinding["metadata"]
    }),
    createBinding({
      id: "binding_tabs_edge",
      nodeId: "node_empty_tabs",
      kind: "component",
      componentName: "Tabs",
      metadata: "invalid" as unknown as CanvasBinding["metadata"]
    })
  ];
  return document;
}

function createEmptyRootlessDocument() {
  const document = createDefaultCanvasDocument("dc_export_empty_rootless");
  const [page] = document.pages;
  if (!page) {
    throw new Error("Missing default page");
  }
  page.rootNodeId = null;
  page.nodes = [];
  return document;
}

function createMultimediaDocument() {
  const document = createDefaultCanvasDocument("dc_export_multimedia");
  const [page] = document.pages;
  if (!page) {
    throw new Error("Missing default page");
  }
  page.rootNodeId = "node_media_root";
  page.nodes = [
    createNode(page.id, {
      id: "node_media_root",
      kind: "frame",
      name: "Media Root",
      childIds: ["node_hero_image", "node_demo_video", "node_demo_audio"],
      rect: { x: 0, y: 0, width: 880, height: 620 },
      style: {
        background: "#081220",
        borderRadius: "28px",
        padding: "32px"
      }
    }),
    createNode(page.id, {
      id: "node_hero_image",
      kind: "frame",
      name: "Hero Image",
      parentId: "node_media_root",
      rect: { x: 36, y: 36, width: 360, height: 220 },
      metadata: {
        assetIds: ["asset_hero_image"]
      }
    }),
    createNode(page.id, {
      id: "node_demo_video",
      kind: "frame",
      name: "Demo Video",
      parentId: "node_media_root",
      rect: { x: 432, y: 36, width: 360, height: 220 },
      props: {
        tagName: "video",
        attributes: {
          src: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
          poster: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%23081220'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23e6eef8' font-size='36'%3EDemo video%3C/text%3E%3C/svg%3E",
          controls: "true",
          muted: "true",
          playsInline: "true"
        }
      },
      metadata: {
        codeSync: {
          tagName: "video"
        }
      }
    }),
    createNode(page.id, {
      id: "node_demo_audio",
      kind: "frame",
      name: "Demo Audio",
      parentId: "node_media_root",
      rect: { x: 36, y: 304, width: 756, height: 72 },
      props: {
        tagName: "audio",
        src: "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3",
        controls: true
      },
      metadata: {
        codeSync: {
          tagName: "audio"
        }
      }
    })
  ];
  document.assets = [{
    id: "asset_hero_image",
    sourceType: "remote",
    kind: "image",
    url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 720 440'%3E%3Crect width='720' height='440' fill='%2311263b'/%3E%3Ccircle cx='560' cy='120' r='74' fill='%2320d5c6' fill-opacity='0.55'/%3E%3Ctext x='64' y='220' fill='%23f3f6fb' font-size='52' font-family='Segoe UI, sans-serif'%3EMultimedia canvas%3C/text%3E%3C/svg%3E",
    mime: "image/svg+xml",
    metadata: {
      alt: "Generated multimedia hero"
    }
  }];
  return document;
}

describe("canvas export", () => {
  it("renders positioned library-backed html with semantic primitives and icons", () => {
    const document = createLibraryDocument();

    const html = renderCanvasDocumentHtml(document);

    expect(html).toContain('data-component-libraries="shadcn"');
    expect(html).toContain('data-icon-libraries="3dicons,tabler,microsoft-fluent-ui-system-icons,@lobehub/fluent-emoji-3d"');
    expect(html).toContain('data-styling-libraries="tailwindcss"');
    expect(html).toContain('class="odb-canvas-root min-h-screen w-full bg-white text-slate-950 antialiased"');
    expect(html).toContain(`${CANVAS_SURFACE_TOKEN_VARIABLES.background}: ${CANVAS_SURFACE_TOKENS.background};`);
    expect(html).toContain(`${CANVAS_SURFACE_TOKEN_VARIABLES.text}: ${CANVAS_SURFACE_TOKENS.text};`);
    expect(html).toContain(`${CANVAS_SURFACE_TOKEN_VARIABLES.grid}: ${CANVAS_SURFACE_TOKENS.grid};`);
    expect(html).toContain('body { margin: 0; font-family: "Segoe UI", sans-serif; background: var(--surface-bg); color: var(--surface-text); }');
    expect(html).toContain("position:relative;width:960px;min-height:720px");
    expect(html).toContain("left:48px;top:96px;width:236px;min-height:54px");
    expect(html).toContain("inline-flex items-center justify-center gap-3 rounded-full");
    expect(html).toContain(".min-h-screen { min-height: 100vh; }");
    expect(html).toContain("<button");
    expect(html).toContain('data-component-name="Button"');
    expect(html).toContain('role="tab"');
    expect(html).toContain("odb-canvas-card-copy");
    expect(html).toContain("odb-canvas-inline-list");
    expect(html).toContain("stroke-width=\"1.85\"");
    expect(html).toContain("Fallback note still renders in the same positioned page.");
  });

  it("renders filtered preview html with base href and preview metadata", () => {
    const document = createLibraryDocument();
    document.pages.push({
      id: "page_secondary",
      name: "Secondary",
      path: "/secondary",
      rootNodeId: null,
      prototypeIds: [],
      nodes: [
        createNode("page_secondary", {
          id: "node_secondary_copy",
          kind: "text",
          name: "Secondary Copy",
          rect: { x: 0, y: 0, width: 240, height: 48 },
          props: { text: "Secondary page only" }
        })
      ],
      metadata: {}
    });

    const html = renderCanvasDocumentHtml(document, {
      pageIds: ["page_secondary"],
      baseHref: "https://example.com/preview/",
      rootAttributes: {
        "data-preview-prototype-id": "proto_secondary",
        "data-preview-source-url": "https://example.com/preview/"
      }
    });

    expect(html).toContain('<base href="https://example.com/preview/" />');
    expect(html).toContain('data-preview-prototype-id="proto_secondary"');
    expect(html).toContain('data-page-id="page_secondary"');
    expect(html).not.toContain('data-page-id="page_home"');
    expect(html).toContain('data-preview-source-url="https://example.com/preview/"');
  });

  it("renders react component output with library primitives and positioned styles", () => {
    const document = createLibraryDocument();

    const component = renderCanvasDocumentComponent(document);

    expect(component).toContain("<button");
    expect(component).toContain('className="odb-canvas-root min-h-screen w-full bg-white text-slate-950 antialiased"');
    expect(component).toContain('odb-canvas-component-button');
    expect(component).toContain('inline-flex items-center justify-center gap-3 rounded-full font-semibold shadow-2xl');
    expect(component).toContain('data-component-name="Tabs"');
    expect(component).toContain('data-styling-libraries="tailwindcss"');
    expect(component).toContain('"position": "absolute"');
    expect(component).toContain('"left": "48px"');
    expect(component).toContain('"minHeight": "54px"');
    expect(component).toContain('{"Launch board"}');
    expect(component).toContain('data-icon-library="tabler"');
    expect(component).toContain("odb-canvas-card-copy");
  });

  it("renders unstyled fallback primitives, icon variants, and rootless page surfaces", () => {
    const document = createFallbackDocument();

    const html = renderCanvasDocumentHtml(document);
    const component = renderCanvasDocumentComponent(document);

    expect(html).not.toContain('data-styling-libraries="tailwindcss"');
    expect(html).toContain('class="odb-canvas-root"');
    expect(html).toContain("<h1");
    expect(html).toContain("Atlas Workspace");
    expect(html).toContain("<h2");
    expect(html).toContain("Operator visibility");
    expect(html).toContain("odb-canvas-inline-item");
    expect(html).toContain("<p");
    expect(html).toContain("One line body copy.");
    expect(html).toContain('data-component-name="Motion Panel"');
    expect(html).toContain('data-source-kind="motion"');
    expect(html).toContain('data-component-name="Dialog Shell"');
    expect(html).toContain("odb-canvas-icon-orb");
    expect(html).toContain("🎉");
    expect(html).toContain('data-icon-library="tabler"');
    expect(html).toContain('data-icon-library="microsoft-fluent-ui-system-icons"');
    expect(html).toContain('data-icon-library="3dicons,@lobehub/fluent-emoji-3d"');
    expect(html).toContain('role="separator"');
    expect(html).toContain("Support copy");
    expect(html).not.toContain(".min-h-screen { min-height: 100vh; }");
    expect(component).toContain('className="odb-canvas-page-surface"');
    expect(component).toContain('{"Atlas Workspace"}');
    expect(component).toContain('{"One line body copy."}');
  });

  it("renders an empty page when the declared root node is missing", () => {
    const document = createMissingRootDocument();

    const html = renderCanvasDocumentHtml(document);
    const component = renderCanvasDocumentComponent(document);

    expect(html).toContain('data-document-id="dc_export_missing_root"');
    expect(html).toContain('data-page-id="page_home"></section>');
    expect(html).not.toContain("data-node-id=");
    expect(component).toContain('data-document-id="dc_export_missing_root"');
    expect(component).toContain('<section className="odb-canvas-page w-full grid place-items-center" data-page-id="page_home"></section>');
    expect(component).not.toContain("data-node-id=");
  });

  it("covers rootless edge cases for empty labels, numeric text, and fluent fallback icons", () => {
    const document = createEdgeCaseBranchDocument();

    const html = renderCanvasDocumentHtml(document);
    const component = renderCanvasDocumentComponent(document);

    expect(html).toContain('data-document-id="dc_export_edge_cases"');
    expect(html).toContain("Canvas Component");
    expect(html).toContain("M5.5 8.5a3.5 3.5");
    expect(html).toContain("M12 3.5 14.4 9");
    expect(html).toContain(">42<");
    expect(html).toContain("left:272px;top:0px;width:176px;min-height:60px");
    expect(html).toContain("Heuristic panel");
    expect(html).toContain("Loose node");
    expect(html).toContain("Boolean font fallback");
    expect(html).toContain('class="odb-canvas-page w-full grid place-items-center"');
    expect(component).toContain('className="odb-canvas-page-surface relative isolate overflow-hidden mx-auto"');
    expect(component).toContain('data-component-name="Button"');
    expect(component).toContain('data-component-name="Badge"');
    expect(component).toContain('data-component-name="Tabs"');
  });

  it("renders a deterministic empty surface when a page has no root and no nodes", () => {
    const document = createEmptyRootlessDocument();

    const html = renderCanvasDocumentHtml(document);
    const component = renderCanvasDocumentComponent(document);

    expect(html).toContain("position:relative;width:1200px;min-height:720px");
    expect(html).toContain('class="odb-canvas-page-surface relative isolate overflow-hidden mx-auto"');
    expect(component).toContain('"width": "1200px"');
    expect(component).toContain('"minHeight": "720px"');
  });

  it("omits export library attributes when the document policy explicitly disables them", () => {
    const document = createDefaultCanvasDocument("dc_export_without_libraries");
    document.designGovernance.libraryPolicy = {
      icons: [],
      components: [],
      styling: [],
      motion: [],
      threeD: []
    };

    const html = renderCanvasDocumentHtml(document);
    const component = renderCanvasDocumentComponent(document);

    expect(html).not.toContain("data-component-libraries=");
    expect(html).not.toContain("data-icon-libraries=");
    expect(html).not.toContain("data-styling-libraries=");
    expect(html).not.toContain(".min-h-screen { min-height: 100vh; }");
    expect(component).not.toContain("data-component-libraries=");
    expect(component).not.toContain("data-icon-libraries=");
    expect(component).not.toContain("data-styling-libraries=");
    expect(component).toContain('className="odb-canvas-root"');
  });

  it("renders binding html and structured parity artifacts for bound nodes", () => {
    const document = createLibraryDocument();

    const bindingHtml = renderCanvasBindingHtml(document, "binding_button");
    const artifact = buildCanvasParityArtifact(document, "binding_button", "canvas_html");

    expect(bindingHtml).toContain('data-binding-id="binding_button"');
    expect(bindingHtml).toContain('data-node-id="node_primary_cta"');
    expect(artifact).toMatchObject({
      projection: "canvas_html",
      rootBindingId: "binding_button",
      nodes: [
        expect.objectContaining({
          nodeId: "node_primary_cta",
          bindingId: "binding_button",
          text: "Launch board"
        })
      ]
    });
  });

  it("ignores empty root attributes and returns null for missing binding and node lookups", () => {
    const document = createLibraryDocument();

    const html = renderCanvasDocumentHtml(document, {
      rootAttributes: {
        "": "ignored",
        "data-extra-preview": "true"
      }
    });

    expect(html).toContain('data-extra-preview="true"');
    expect(html).not.toContain('=""');
    expect(renderCanvasBindingHtml(document, "binding_missing")).toBeNull();
    expect(buildCanvasParityArtifact(document, "binding_missing", "canvas_html")).toBeNull();

    document.bindings.push(createBinding({
      id: "binding_orphan",
      nodeId: "node_orphan_binding",
      kind: "component"
    }));

    expect(renderCanvasBindingHtml(document, "binding_orphan")).toBeNull();
    expect(buildCanvasParityArtifact(document, "binding_orphan", "canvas_html")).toBeNull();
  });

  it("renders multimedia tags, smooth scrolling, and hover affordances from node metadata", () => {
    const document = createMultimediaDocument();

    const html = renderCanvasDocumentHtml(document);
    const component = renderCanvasDocumentComponent(document);

    expect(html).toContain("<img");
    expect(html).toContain("Generated multimedia hero");
    expect(html).toContain("interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm");
    expect(html).toContain("<video");
    expect(html).toContain('controls="true"');
    expect(html).toContain("<audio");
    expect(html).toContain("scroll-behavior: smooth;");
    expect(html).toContain(".odb-canvas-media-surface:hover");
    expect(html).toContain(".odb-canvas-media-placeholder");
    expect(component).toContain("<img");
    expect(component).toContain("<video");
    expect(component).toContain("<audio");
    expect(component).toContain("odb-canvas-media-surface");
    expect(component).toContain("odb-canvas-media-image");
  });

  it("builds parity artifacts when descendants have no primary binding and some child ids are missing", () => {
    const document = createDefaultCanvasDocument("dc_export_parity_edges");
    const [page] = document.pages;
    if (!page) {
      throw new Error("Missing default page");
    }
    page.rootNodeId = "node_root";
    page.nodes = [
      createNode(page.id, {
        id: "node_root",
        kind: "frame",
        name: "Parity Root",
        childIds: ["node_child", "node_missing_descendant"],
        bindingRefs: { primary: "binding_root" },
        style: { background: "#081220" }
      }),
      createNode(page.id, {
        id: "node_child",
        kind: "text",
        name: "Parity Child",
        parentId: "node_root",
        props: { text: "Child copy" }
      })
    ];
    document.bindings = [
      createBinding({
        id: "binding_root",
        nodeId: "node_root",
        kind: "component",
        componentName: "Card"
      })
    ];

    const artifact = buildCanvasParityArtifact(document, "binding_root", "bound_app_runtime");
    expect(artifact).toMatchObject({
      projection: "bound_app_runtime",
      rootBindingId: "binding_root",
      nodes: [
        expect.objectContaining({
          nodeId: "node_root",
          attributes: expect.objectContaining({
            "data-node-id": "node_root",
            "data-binding-id": "binding_root"
          })
        }),
        expect.objectContaining({
          nodeId: "node_child",
          text: "Child copy",
          attributes: { "data-node-id": "node_child" }
        })
      ]
    });
    expect(artifact?.nodes).toHaveLength(2);
  });
});
