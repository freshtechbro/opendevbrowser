import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveConfig } from "../src/config";
import { CanvasManager } from "../src/browser/canvas-manager";
import { CanvasDocumentStore } from "../src/canvas/document-store";

const config = resolveConfig({});
const validGenerationPlan = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Exercise inventory normalization branches." },
  visualDirection: { profile: "clean-room" },
  layoutStrategy: { approach: "component-first" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first" },
  motionPosture: { level: "subtle" },
  responsivePosture: { primaryViewport: "desktop" },
  accessibilityPosture: { target: "WCAG_2_2_AA" },
  validationTargets: { blockOn: ["contrast-failure"] }
};

describe("canvas inventory normalization branches", () => {
  let worktree: string;

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "odb-canvas-inventory-branches-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(worktree, { recursive: true, force: true });
  });

  it("falls back across malformed inventory template metadata and orphan parents", async () => {
    const manager = new CanvasManager({
      worktree,
      browserManager: {
        status: vi.fn(),
        closeTarget: vi.fn()
      } as never,
      config
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
      documentId: string;
    };
    const loaded = await manager.execute("canvas.document.load", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      documentId: opened.documentId
    }) as { document: { pages: Array<{ id: string; rootNodeId: string | null }> } };
    const pageId = loaded.document.pages[0]?.id;
    const rootNodeId = loaded.document.pages[0]?.rootNodeId;
    if (!pageId || !rootNodeId) {
      throw new Error("Expected root page");
    }

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const session = (manager as unknown as {
      sessions: Map<string, {
        store: CanvasDocumentStore;
        editorSelection: { pageId: string | null; nodeId: string | null; targetId: string | null; updatedAt: string | null };
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Expected canvas session");
    }

    const document = session.store.getDocument();
    document.componentInventory.push(
      {
        id: "inventory_metadata_non_record",
        name: "Metadata Fallback",
        componentName: "MetadataFallback",
        description: null,
        sourceKind: "canvas_document",
        sourceFamily: "canvas_document",
        origin: "document",
        framework: null,
        adapter: null,
        plugin: null,
        variants: [],
        props: [],
        slots: [],
        events: [],
        content: {
          acceptsText: true,
          acceptsRichText: false,
          slotNames: [],
          metadata: {}
        },
        metadata: "broken" as never
      },
      {
        id: "inventory_template_nodes_non_array",
        name: "Nodes Non Array",
        componentName: "NodesNonArray",
        description: null,
        sourceKind: "starter_template",
        sourceFamily: "starter_template",
        origin: "starter",
        framework: null,
        adapter: null,
        plugin: null,
        variants: [],
        props: [],
        slots: [],
        events: [],
        content: {
          acceptsText: false,
          acceptsRichText: false,
          slotNames: [],
          metadata: {}
        },
        metadata: {
          template: {
            rootNodeId: "template_root",
            nodes: "broken"
          }
        }
      },
      {
        id: "inventory_template_missing_root",
        name: "Missing Root Id",
        componentName: "MissingRootId",
        description: null,
        sourceKind: "starter_template",
        sourceFamily: "starter_template",
        origin: "starter",
        framework: null,
        adapter: null,
        plugin: null,
        variants: [],
        props: [],
        slots: [],
        events: [],
        content: {
          acceptsText: false,
          acceptsRichText: false,
          slotNames: [],
          metadata: {}
        },
        metadata: {
          template: {
            rootNodeId: "",
            nodes: [{
              id: "template_root",
              kind: "frame",
              childIds: [],
              rect: { x: 16, y: 24, width: 160, height: 80 },
              props: {},
              style: {},
              tokenRefs: {},
              variantPatches: [],
              metadata: {}
            }]
          }
        }
      },
      {
        id: "inventory_template_orphan_parent",
        name: "Orphan Parent Card",
        componentName: "OrphanParentCard",
        description: null,
        sourceKind: "starter_template",
        sourceFamily: "starter_template",
        origin: "starter",
        framework: null,
        adapter: null,
        plugin: null,
        variants: [],
        props: [],
        slots: [],
        events: [],
        content: {
          acceptsText: false,
          acceptsRichText: false,
          slotNames: [],
          metadata: {}
        },
        metadata: {
          template: {
            rootNodeId: "template_root",
            nodes: [
              {
                id: "template_root",
                kind: "frame",
                childIds: ["template_child"],
                rect: null,
                props: {},
                style: {},
                tokenRefs: {},
                variantPatches: [],
                metadata: {}
              },
              {
                id: "template_child",
                kind: "text",
                parentId: "ghost_parent",
                childIds: [],
                rect: { x: 120, y: 140, width: 160, height: "bad" },
                props: { text: "Orphan child" },
                style: {},
                tokenRefs: {},
                variantPatches: [],
                metadata: {}
              }
            ]
          }
        }
      }
    );
    document.designGovernance.generationPlan = structuredClone(validGenerationPlan);
    session.store.loadDocument(document);
    session.editorSelection = {
      pageId,
      nodeId: rootNodeId,
      targetId: null,
      updatedAt: null
    };

    const metadataFallback = await manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      pageId,
      parentId: rootNodeId,
      itemId: "inventory_metadata_non_record"
    }) as { rootNodeId: string };
    expect(session.store.getDocument().pages[0]?.nodes.find((node) => node.id === metadataFallback.rootNodeId)).toMatchObject({
      parentId: rootNodeId,
      name: "Metadata Fallback",
      rect: { x: 96, y: 96, width: 320, height: 180 },
      props: { text: "Metadata Fallback" }
    });

    const nodesNonArray = await manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      pageId,
      parentId: rootNodeId,
      itemId: "inventory_template_nodes_non_array"
    }) as { rootNodeId: string };
    expect(session.store.getDocument().pages[0]?.nodes.find((node) => node.id === nodesNonArray.rootNodeId)).toMatchObject({
      parentId: rootNodeId,
      name: "Nodes Non Array",
      rect: { x: 96, y: 96, width: 320, height: 180 }
    });

    const missingRoot = await manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      pageId,
      parentId: rootNodeId,
      itemId: "inventory_template_missing_root"
    }) as { rootNodeId: string };
    expect(session.store.getDocument().pages[0]?.nodes.find((node) => node.id === missingRoot.rootNodeId)).toMatchObject({
      parentId: rootNodeId,
      name: "Missing Root Id",
      rect: { x: 96, y: 96, width: 320, height: 180 }
    });

    const orphanParent = await manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      pageId,
      parentId: rootNodeId,
      itemId: "inventory_template_orphan_parent"
    }) as { rootNodeId: string; insertedNodeIds: string[] };
    expect(orphanParent.insertedNodeIds).toHaveLength(2);
    const insertedNodes = orphanParent.insertedNodeIds
      .map((nodeId) => session.store.getDocument().pages[0]?.nodes.find((node) => node.id === nodeId))
      .filter((node): node is NonNullable<typeof node> => node !== undefined);
    expect(insertedNodes.find((node) => node.id === orphanParent.rootNodeId)).toMatchObject({
      parentId: rootNodeId,
      rect: { x: 96, y: 96, width: 320, height: 180 }
    });
    expect(insertedNodes.find((node) => node.id !== orphanParent.rootNodeId)).toMatchObject({
      parentId: null,
      kind: "text",
      props: { text: "Orphan child" },
      rect: { x: 120, y: 140, width: 160, height: 180 }
    });
  });
});
