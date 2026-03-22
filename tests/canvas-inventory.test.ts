import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { resolveConfig } from "../src/config";
import { CanvasDocumentStore, createDefaultCanvasDocument } from "../src/canvas/document-store";
import { CanvasManager } from "../src/browser/canvas-manager";
import { DEFAULT_CODE_SYNC_OWNERSHIP } from "../src/canvas/code-sync/types";

const validGenerationPlan = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Promote inventory items." },
  visualDirection: { profile: "clean-room" },
  layoutStrategy: { approach: "component-first" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first" },
  motionPosture: { level: "subtle" },
  responsivePosture: { primaryViewport: "desktop" },
  accessibilityPosture: { target: "WCAG_2_2_AA" },
  validationTargets: { blockOn: ["contrast-failure"] }
};

describe("canvas inventory runtime", () => {
  let worktree = "";

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "odb-canvas-inventory-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(worktree, { recursive: true, force: true });
  });

  it("promotes, updates, and removes reusable inventory items through typed patch ops", () => {
    const document = createDefaultCanvasDocument("dc_inventory_store");
    const rootNodeId = document.pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();
    document.bindings.push({
      id: "binding_inventory_source",
      nodeId: rootNodeId as string,
      kind: "code-sync",
      componentName: "HeroSection",
      metadata: {},
      codeSync: {
        adapter: "tsx-react-v1",
        repoPath: "src/HeroSection.tsx",
        exportName: "HeroSection",
        syncMode: "manual",
        ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP }
      }
    });
    const rootNode = document.pages[0]?.nodes.find((node) => node.id === rootNodeId);
    if (!rootNode) {
      throw new Error("Expected root node");
    }
    rootNode.bindingRefs.primary = "binding_inventory_source";
    const store = new CanvasDocumentStore(document);
    store.setGenerationPlan(validGenerationPlan);

    const promoted = store.applyPatches(2, [{
      op: "inventory.promote",
      nodeId: rootNodeId as string,
      itemId: "inventory_hero",
      name: "Hero Section",
      description: "Reusable landing-page hero"
    }]);

    expect(promoted.appliedRevision).toBe(3);
    expect(store.getDocument().componentInventory).toHaveLength(1);
    expect(store.getDocument().componentInventory[0]).toMatchObject({
      id: "inventory_hero",
      name: "Hero Section",
      description: "Reusable landing-page hero",
      origin: "code_sync",
      sourceFamily: "framework_component",
      adapter: { id: "tsx-react-v1" },
      framework: { id: "react-tsx" }
    });
    expect(store.getDocument().componentInventory[0]?.metadata.template).toMatchObject({
      rootNodeId
    });

    const updated = store.applyPatches(3, [{
      op: "inventory.update",
      itemId: "inventory_hero",
      changes: {
        description: "Updated hero description",
        "metadata.tags": ["hero", "marketing"]
      }
    }]);
    expect(updated.appliedRevision).toBe(4);
    expect(store.getDocument().componentInventory[0]).toMatchObject({
      description: "Updated hero description",
      metadata: {
        tags: ["hero", "marketing"]
      }
    });

    const removed = store.applyPatches(4, [{
      op: "inventory.remove",
      itemId: "inventory_hero"
    }]);
    expect(removed.appliedRevision).toBe(5);
    expect(store.getDocument().componentInventory).toEqual([]);
  });

  it("lists and inserts inventory items through the public canvas surface", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
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
    expect(pageId).toBeTruthy();
    expect(rootNodeId).toBeTruthy();

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const insertedNodeId = "node_inventory_source";
    const firstPatch = await manager.execute("canvas.document.patch", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: 2,
      patches: [
        {
          op: "node.insert",
          pageId,
          parentId: rootNodeId,
          node: {
            id: insertedNodeId,
            kind: "component-instance",
            name: "Marketing Hero",
            rect: { x: 180, y: 140, width: 360, height: 180 },
            props: { text: "Launch faster" },
            style: { backgroundColor: "#0f172a", color: "#f8fafc" }
          }
        },
        {
          op: "binding.set",
          nodeId: insertedNodeId,
          binding: {
            id: "binding_inventory_source",
            kind: "code-sync",
            componentName: "MarketingHero",
            metadata: {},
            codeSync: {
              adapter: "tsx-react-v1",
              repoPath: "src/MarketingHero.tsx",
              exportName: "MarketingHero",
              syncMode: "manual",
              ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP }
            }
          }
        },
        {
          op: "inventory.promote",
          nodeId: insertedNodeId,
          itemId: "inventory_marketing_hero",
          name: "Marketing Hero"
        }
      ]
    }) as { appliedRevision: number };

    const listed = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId,
      query: "inventory_marketing_hero"
    }) as {
      total: number;
      items: Array<{ id: string; name: string; origin: string; sourceFamily: string }>;
      summary: { componentInventoryCount: number; availableInventoryCount?: number; catalogKitIds?: string[] };
    };
    expect(listed.total).toBe(1);
    expect(listed.items[0]).toMatchObject({
      id: "inventory_marketing_hero",
      name: "Marketing Hero",
      origin: "code_sync",
      sourceFamily: "framework_component"
    });
    expect(listed.summary).toMatchObject({
      componentInventoryCount: 1,
      availableInventoryCount: 6,
      catalogKitIds: [
        "dashboard.analytics-core",
        "dashboard.operations-control",
        "marketing.product-launch",
        "auth.multi-step",
        "settings.account-security"
      ]
    });

    const availableInventory = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId
    }) as {
      total: number;
      items: Array<{ id: string; name: string; origin: string; sourceFamily: string }>;
    };
    expect(availableInventory.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "kit.dashboard.analytics-core.metric-card",
        origin: "starter",
        sourceFamily: "starter_template"
      })
    ]));

    const inserted = await manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: firstPatch.appliedRevision,
      itemId: "kit.dashboard.analytics-core.metric-card",
      pageId,
      parentId: rootNodeId,
      x: 620,
      y: 180
    }) as {
      ok: boolean;
      rootNodeId: string;
      insertedNodeIds: string[];
      documentRevision: number;
    };
    expect(inserted.ok).toBe(true);
    expect(inserted.insertedNodeIds).toHaveLength(4);
    expect(inserted.rootNodeId).not.toBe(insertedNodeId);
    expect(inserted.documentRevision).toBeGreaterThan(firstPatch.appliedRevision);

    const sessionDocument = (manager as unknown as {
      sessions: Map<string, { store: { getDocument: () => { pages: Array<{ nodes: Array<{ id: string; parentId: string | null; metadata: Record<string, unknown> }> }> } } }>;
    }).sessions.get(opened.canvasSessionId)?.store.getDocument();
    const createdNode = sessionDocument?.pages[0]?.nodes.find((node) => node.id === inserted.rootNodeId);
    expect(createdNode).toMatchObject({
      parentId: rootNodeId,
      metadata: {
        inventory: {
          itemId: "kit.dashboard.analytics-core.metric-card",
          origin: "starter"
        }
      }
    });
  });

  it("filters inventory across source, provenance, framework, adapter, plugin, and query", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };
    const session = (manager as unknown as {
      sessions: Map<string, { store: CanvasDocumentStore }>;
    }).sessions.get(opened.canvasSessionId);
    const document = session?.store.getDocument();
    if (!document) {
      throw new Error("Expected session document");
    }

    document.componentInventory.push({
      id: "inventory_plugin_card",
      name: "Plugin Hero Card",
      componentName: "PluginHeroCard",
      description: "Plugin hero block for filtered inventory search.",
      sourceKind: "code-sync",
      sourceFamily: "framework_component",
      origin: "code_sync",
      framework: {
        id: "react-tsx",
        label: "React TSX",
        packageName: "react",
        adapter: null,
        metadata: {}
      },
      adapter: {
        id: "tsx-react-v1",
        label: "TSX React v1",
        packageName: "@opendevbrowser/tsx-react-v1",
        version: "1.0.0",
        metadata: {}
      },
      plugin: {
        id: "local-ui-kit",
        label: "Local UI Kit",
        packageName: "@repo/local-ui-kit",
        version: "1.0.0",
        metadata: {}
      },
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
      metadata: {}
    }, {
      id: "inventory_untyped_card",
      name: "Untyped Card",
      componentName: "UntypedCard",
      description: "Inventory item without framework or adapter metadata.",
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
        acceptsText: false,
        acceptsRichText: false,
        slotNames: [],
        metadata: {}
      },
      metadata: {}
    });
    document.designGovernance.generationPlan = structuredClone(validGenerationPlan);
    session.store.loadDocument(document);

    const frameworkScoped = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId,
      query: "plugin hero",
      sourceFamilies: ["framework_component"],
      origins: ["code_sync"],
      frameworkIds: ["react-tsx"],
      adapterIds: ["tsx-react-v1"],
      pluginIds: ["local-ui-kit"]
    }) as {
      total: number;
      items: Array<{ id: string; name: string; origin: string; sourceFamily: string }>;
    };
    expect(frameworkScoped.total).toBe(1);
    expect(frameworkScoped.items).toEqual([
      expect.objectContaining({
        id: "inventory_plugin_card",
        name: "Plugin Hero Card",
        origin: "code_sync",
        sourceFamily: "framework_component"
      })
    ]);

    const sourceScoped = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId,
      sourceFamilies: ["framework_component"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(sourceScoped.total).toBe(1);
    expect(sourceScoped.items).toEqual([expect.objectContaining({ id: "inventory_plugin_card" })]);

    const originScoped = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId,
      origins: ["code_sync"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(originScoped.total).toBe(1);
    expect(originScoped.items).toEqual([expect.objectContaining({ id: "inventory_plugin_card" })]);

    const frameworkOnly = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId,
      frameworkIds: ["react-tsx"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(frameworkOnly.total).toBe(1);
    expect(frameworkOnly.items).toEqual([expect.objectContaining({ id: "inventory_plugin_card" })]);

    const pluginOnly = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId,
      pluginIds: ["local-ui-kit"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(pluginOnly.total).toBe(1);
    expect(pluginOnly.items).toEqual([expect.objectContaining({ id: "inventory_plugin_card" })]);

    const nullFrameworkFiltered = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId,
      query: "untyped",
      frameworkIds: ["react-tsx"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(nullFrameworkFiltered.total).toBe(0);
    expect(nullFrameworkFiltered.items).toEqual([]);

    const nullAdapterFiltered = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId,
      query: "untyped",
      adapterIds: ["tsx-react-v1"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(nullAdapterFiltered.total).toBe(0);
    expect(nullAdapterFiltered.items).toEqual([]);

    const starterScoped = await manager.execute("canvas.inventory.list", {
      canvasSessionId: opened.canvasSessionId,
      query: "analytics",
      sourceFamilies: ["starter_template"],
      origins: ["starter"],
      frameworkIds: ["react"],
      adapterIds: ["tsx-react-v1"]
    }) as {
      total: number;
      items: Array<{ id: string; name: string; origin: string; sourceFamily: string }>;
    };
    expect(starterScoped.total).toBe(1);
    expect(starterScoped.items).toEqual([
      expect.objectContaining({
        id: "kit.dashboard.analytics-core.metric-card",
        origin: "starter",
        sourceFamily: "starter_template"
      })
    ]);
  });

  it("filters starter listings across framework, kit, and tag-only requests", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
    };

    const frameworkOnly = await manager.execute("canvas.starter.list", {
      canvasSessionId: opened.canvasSessionId,
      frameworkIds: ["astro"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(frameworkOnly.total).toBe(1);
    expect(frameworkOnly.items).toEqual([
      expect.objectContaining({ id: "docs.reference" })
    ]);

    const kitOnly = await manager.execute("canvas.starter.list", {
      canvasSessionId: opened.canvasSessionId,
      kitIds: ["marketing.product-launch"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(kitOnly.total).toBe(2);
    expect(kitOnly.items).toEqual([
      expect.objectContaining({ id: "hero.saas-product" }),
      expect.objectContaining({ id: "pricing.subscription" })
    ]);

    const tagOnly = await manager.execute("canvas.starter.list", {
      canvasSessionId: opened.canvasSessionId,
      tags: ["auth"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(tagOnly.total).toBe(2);
    expect(tagOnly.items).toEqual([
      expect.objectContaining({ id: "auth.sign-in" }),
      expect.objectContaining({ id: "auth.sign-up" })
    ]);
  });

  it("materializes fallback inventory templates and rejects invalid insert requests", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
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

    await expect(manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      itemId: "kit.dashboard.analytics-core.metric-card"
    })).rejects.toThrow("generationPlan must be accepted before mutation.");

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
    const document = session?.store.getDocument();
    if (!session || !document) {
      throw new Error("Expected session document");
    }

    document.componentInventory.push(
      {
        id: "inventory_text_fallback",
        name: "Fallback Copy Block",
        componentName: "FallbackCopyBlock",
        description: null,
        sourceKind: "canvas_document",
        sourceFamily: "canvas_document",
        origin: "document",
        framework: null,
        adapter: null,
        plugin: null,
        variants: [],
        props: [
          { name: "headline", type: "string", required: false, defaultValue: "Ready now", metadata: {} },
          { name: "supportingText", type: "string", required: false, description: "No default", metadata: {} }
        ],
        slots: [],
        events: [],
        content: {
          acceptsText: true,
          acceptsRichText: false,
          slotNames: [],
          metadata: {}
        },
        metadata: {}
      },
      {
        id: "inventory_template_normalized",
        name: "Normalized Template Card",
        componentName: "NormalizedTemplateCard",
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
              null,
              {
                id: "template_incomplete"
              },
              {
                id: "template_root",
                kind: "component-instance",
                childIds: ["", "template_child", "  "],
                rect: { width: "wide", height: 44 },
                props: false,
                style: false,
                tokenRefs: null,
                variantPatches: [null, { selector: { state: "default" }, changes: { style: { color: "#ffffff" } } }],
                metadata: false
              },
              {
                id: "template_child",
                kind: "text",
                parentId: "template_root",
                rect: { x: 120, y: 140, width: 160, height: 24 },
                props: { text: "Hello" },
                metadata: {}
              }
            ]
          }
        }
      },
      {
        id: "inventory_bad_root",
        name: "Broken Template",
        componentName: "BrokenTemplate",
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
            rootNodeId: "missing_root",
            nodes: [{
              id: "template_existing",
              kind: "frame",
              name: "Existing Template Node",
              parentId: null,
              childIds: [],
              rect: { x: 10, y: 10, width: 100, height: 50 },
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
        id: "inventory_text_preserved",
        name: "Preserved Copy Block",
        componentName: "PreservedCopyBlock",
        description: null,
        sourceKind: "canvas_document",
        sourceFamily: "canvas_document",
        origin: "document",
        framework: null,
        adapter: null,
        plugin: null,
        variants: [],
        props: [
          { name: "text", type: "string", required: false, defaultValue: "Preset body", metadata: {} }
        ],
        slots: [],
        events: [],
        content: {
          acceptsText: true,
          acceptsRichText: false,
          slotNames: [],
          metadata: {}
        },
        metadata: {}
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

    const fallbackInsert = await manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      itemId: "inventory_text_fallback",
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY
    }) as {
      ok: boolean;
      rootNodeId: string;
      insertedNodeIds: string[];
    };
    expect(fallbackInsert.ok).toBe(true);
    expect(fallbackInsert.insertedNodeIds).toHaveLength(1);

    const documentAfterFallback = session.store.getDocument();
    const fallbackNode = documentAfterFallback.pages[0]?.nodes.find((node) => node.id === fallbackInsert.rootNodeId);
    expect(fallbackNode).toMatchObject({
      parentId: rootNodeId,
      kind: "component-instance",
      name: "Fallback Copy Block",
      rect: { x: 96, y: 96, width: 320, height: 180 },
      props: {
        headline: "Ready now",
        text: "Fallback Copy Block"
      }
    });

    const normalizedInsert = await manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      itemId: "inventory_template_normalized"
    }) as {
      ok: boolean;
      rootNodeId: string;
      insertedNodeIds: string[];
    };
    expect(normalizedInsert.ok).toBe(true);
    expect(normalizedInsert.insertedNodeIds).toHaveLength(2);

    const normalizedRoot = session.store.getDocument().pages[0]?.nodes.find((node) => node.id === normalizedInsert.rootNodeId);
    expect(normalizedRoot).toMatchObject({
      parentId: fallbackInsert.rootNodeId,
      kind: "component-instance",
      name: "Normalized Template Card",
      rect: { x: 96, y: 96, width: 320, height: 44 },
      props: {},
      style: {},
      tokenRefs: {}
    });

    await expect(manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      pageId,
      parentId: "node_missing",
      itemId: "inventory_template_normalized"
    })).rejects.toThrow("Unknown node: node_missing");

    await expect(manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      pageId: "page_missing",
      itemId: "inventory_template_normalized"
    })).rejects.toThrow("Unknown page: page_missing");

    await expect(manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      itemId: "inventory_missing"
    })).rejects.toThrow("Unknown inventory item: inventory_missing");

    await expect(manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      itemId: "inventory_bad_root"
    })).rejects.toThrow("Inventory template is missing root node: inventory_bad_root");

    const detachedDocument = session.store.getDocument();
    detachedDocument.pages[0]!.rootNodeId = null;
    detachedDocument.designGovernance.generationPlan = structuredClone(validGenerationPlan);
    session.store.loadDocument(detachedDocument);
    session.editorSelection = {
      pageId,
      nodeId: null,
      targetId: null,
      updatedAt: null
    };

    const preservedInsert = await manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      pageId,
      itemId: "inventory_text_preserved"
    }) as {
      rootNodeId: string;
      insertedNodeIds: string[];
    };
    expect(preservedInsert.insertedNodeIds).toHaveLength(1);
    const preservedNode = session.store.getDocument().pages[0]?.nodes.find((node) => node.id === preservedInsert.rootNodeId);
    expect(preservedNode).toMatchObject({
      parentId: null,
      props: {
        text: "Preset body"
      }
    });

    const emptyPageDocument = session.store.getDocument();
    emptyPageDocument.pages = [];
    emptyPageDocument.designGovernance.generationPlan = structuredClone(validGenerationPlan);
    session.store.loadDocument(emptyPageDocument);
    session.editorSelection = {
      pageId: null,
      nodeId: null,
      targetId: null,
      updatedAt: null
    };

    await expect(manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      itemId: "inventory_text_fallback"
    })).rejects.toThrow("Missing pageId");
  });

  it("lists built-in starters and applies a starter with real token, inventory, and node seeding", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };

    const starters = await manager.execute("canvas.starter.list", {
      canvasSessionId: opened.canvasSessionId,
      query: "analytics",
      frameworkIds: ["nextjs"],
      kitIds: ["dashboard.analytics-core"]
    }) as {
      total: number;
      items: Array<{ id: string; defaultFrameworkId: string; compatibleFrameworkIds: string[]; kitIds: string[] }>;
      summary: { availableStarterCount?: number };
    };
    expect(starters.total).toBe(1);
    expect(starters.items).toEqual([
      expect.objectContaining({
        id: "dashboard.analytics",
        defaultFrameworkId: "react",
        compatibleFrameworkIds: ["react", "nextjs", "remix"],
        kitIds: ["dashboard.analytics-core"]
      })
    ]);
    expect(starters.summary.availableStarterCount).toBe(8);

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: 1,
      starterId: "dashboard.analytics",
      frameworkId: "nextjs"
    }) as {
      ok: boolean;
      planSeeded: boolean;
      degraded: boolean;
      documentRevision: number;
      insertedNodeIds: string[];
      seededInventoryItemIds: string[];
      summary: {
        starterId?: string | null;
        starterFrameworkId?: string | null;
        availableStarterCount?: number;
      };
    };

    expect(applied.ok).toBe(true);
    expect(applied.planSeeded).toBe(true);
    expect(applied.degraded).toBe(false);
    expect(applied.documentRevision).toBe(3);
    expect(applied.insertedNodeIds.length).toBeGreaterThan(4);
    expect(applied.seededInventoryItemIds).toEqual(["kit.dashboard.analytics-core.metric-card"]);
    expect(applied.summary).toMatchObject({
      starterId: "dashboard.analytics",
      starterFrameworkId: "nextjs",
      availableStarterCount: 8
    });

    const sessionDocument = (manager as unknown as {
      sessions: Map<string, { feedback: Array<{ class: string; severity: string }>; store: { getDocument: () => { componentInventory: Array<{ id: string; framework?: { id: string } | null }>; tokens: { collections: Array<{ id: string }> }; meta: { starter: { frameworkId?: string | null; template?: { id?: string } } | null }; pages: Array<{ nodes: Array<{ metadata: Record<string, unknown> }> }> } } }>;
    }).sessions.get(opened.canvasSessionId);
    const document = sessionDocument?.store.getDocument();
    expect(document?.componentInventory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "kit.dashboard.analytics-core.metric-card",
        framework: expect.objectContaining({ id: "nextjs" })
      })
    ]));
    expect(document?.tokens.collections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "kit.dashboard.analytics-core.tokens" })
    ]));
    expect(document?.meta.starter).toEqual(expect.objectContaining({
      frameworkId: "nextjs",
      template: expect.objectContaining({ id: "dashboard.analytics" })
    }));
    expect(document?.pages[0]?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          starter: expect.objectContaining({ id: "dashboard.analytics", role: "shell" })
        })
      })
    ]));
    expect(sessionDocument?.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({ class: "starter-applied", severity: "info" })
    ]));
  });

  it("degrades starter application to semantic shell nodes when the requested framework is unavailable", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: 1,
      starterId: "dashboard.analytics",
      frameworkId: "vue"
    }) as {
      degraded: boolean;
      reason: string | null;
      insertedNodeIds: string[];
      rootNodeId: string;
      summary: { starterFrameworkId?: string | null };
    };

    expect(applied.degraded).toBe(true);
    expect(applied.reason).toBe("framework_unavailable:vue");
    expect(applied.insertedNodeIds).toContain(applied.rootNodeId);
    expect(applied.summary.starterFrameworkId).toBe("vue");

    const sessionDocument = (manager as unknown as {
      sessions: Map<string, { feedback: Array<{ class: string; severity: string; details: Record<string, unknown> }>; store: { getDocument: () => { meta: { starter: { frameworkId?: string | null } | null } } } }>;
    }).sessions.get(opened.canvasSessionId);
    expect(sessionDocument?.store.getDocument().meta.starter).toEqual(expect.objectContaining({
      frameworkId: "vue"
    }));
    expect(sessionDocument?.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({
        class: "starter-applied-degraded",
        severity: "warning",
        details: expect.objectContaining({ reason: "framework_unavailable:vue" })
      })
    ]));
  });

  it("records undo and redo history for starter application and inventory insertion", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: 1,
      starterId: "hero.saas-product",
      frameworkId: "nextjs"
    }) as {
      documentRevision: number;
      rootNodeId: string;
    };

    expect(await manager.execute("canvas.session.status", {
      canvasSessionId: opened.canvasSessionId
    })).toMatchObject({
      history: {
        canUndo: true,
        undoDepth: 1,
        canRedo: false,
        redoDepth: 0
      }
    });

    const undoneStarter = await manager.execute("canvas.history.undo", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    }) as {
      ok: boolean;
      documentRevision: number;
      summary: {
        history: {
          canUndo: boolean;
          undoDepth: number;
          canRedo: boolean;
          redoDepth: number;
        };
      };
    };
    expect(undoneStarter.ok).toBe(true);
    expect(undoneStarter.summary.history).toMatchObject({
      canUndo: false,
      undoDepth: 0,
      canRedo: true,
      redoDepth: 1
    });

    const redoneStarter = await manager.execute("canvas.history.redo", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    }) as {
      ok: boolean;
      documentRevision: number;
      summary: {
        history: {
          canUndo: boolean;
          undoDepth: number;
          canRedo: boolean;
          redoDepth: number;
        };
      };
    };
    expect(redoneStarter.ok).toBe(true);
    expect(redoneStarter.summary.history).toMatchObject({
      canUndo: true,
      undoDepth: 1,
      canRedo: false,
      redoDepth: 0
    });

    const inserted = await manager.execute("canvas.inventory.insert", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: redoneStarter.documentRevision,
      itemId: "kit.marketing.product-launch.feature-hero",
      pageId: "page_home",
      parentId: applied.rootNodeId,
      x: 760,
      y: 220
    }) as {
      documentRevision: number;
      rootNodeId: string;
    };

    expect(await manager.execute("canvas.session.status", {
      canvasSessionId: opened.canvasSessionId
    })).toMatchObject({
      history: {
        canUndo: true,
        undoDepth: 2,
        canRedo: false,
        redoDepth: 0
      }
    });

    const undoneInsert = await manager.execute("canvas.history.undo", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    }) as {
      ok: boolean;
      documentRevision: number;
      summary: {
        history: {
          canUndo: boolean;
          undoDepth: number;
          canRedo: boolean;
          redoDepth: number;
        };
      };
    };
    expect(undoneInsert.ok).toBe(true);
    expect(undoneInsert.summary.history).toMatchObject({
      canUndo: true,
      undoDepth: 1,
      canRedo: true,
      redoDepth: 1
    });

    const afterUndo = await manager.execute("canvas.document.load", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      documentId: (opened as unknown as { documentId?: string }).documentId ?? (manager as unknown as {
        sessions: Map<string, { store: { getDocumentId: () => string } }>;
      }).sessions.get(opened.canvasSessionId)?.store.getDocumentId() ?? ""
    }) as {
      document: {
        pages: Array<{
          nodes: Array<{ id: string }>;
        }>;
      };
    };
    expect(afterUndo.document.pages[0]?.nodes.some((node) => node.id === inserted.rootNodeId)).toBe(false);

    const redoneInsert = await manager.execute("canvas.history.redo", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId
    }) as {
      ok: boolean;
      documentRevision: number;
      summary: {
        history: {
          canUndo: boolean;
          undoDepth: number;
          canRedo: boolean;
          redoDepth: number;
        };
      };
    };
    expect(redoneInsert.ok).toBe(true);
    expect(redoneInsert.summary.history).toMatchObject({
      canUndo: true,
      undoDepth: 2,
      canRedo: false,
      redoDepth: 0
    });

    const afterRedo = await manager.execute("canvas.document.load", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      documentId: (manager as unknown as {
        sessions: Map<string, { store: { getDocumentId: () => string } }>;
      }).sessions.get(opened.canvasSessionId)?.store.getDocumentId() ?? ""
    }) as {
      document: {
        pages: Array<{
          nodes: Array<{ id: string }>;
        }>;
      };
    };
    expect(afterRedo.document.pages[0]?.nodes.some((node) => node.id === inserted.rootNodeId)).toBe(true);
  });

  it("filters starters by tag and applies the framework-neutral docs starter without reseeding the plan", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const session = (manager as unknown as {
      sessions: Map<string, {
        planStatus: string;
        editorSelection: { pageId: string | null; nodeId: string | null; targetId: string | null; updatedAt: string | null };
        store: CanvasDocumentStore;
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Expected canvas session");
    }

    const document = session.store.getDocument();
    document.pages[0]!.rootNodeId = null;
    document.componentInventory.push({
      id: "inventory_framework_hint",
      name: "Framework Hint",
      componentName: "FrameworkHint",
      description: "Used to infer the preferred framework for docs starter.",
      sourceKind: "canvas_document",
      sourceFamily: "canvas_document",
      origin: "document",
      framework: {
        id: "nextjs",
        label: "Next.js",
        packageName: "next",
        adapter: null,
        metadata: {}
      },
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
      metadata: {}
    });
    session.editorSelection = {
      pageId: null,
      nodeId: null,
      targetId: null,
      updatedAt: null
    };
    session.store.loadDocument(document);

    const filtered = await manager.execute("canvas.starter.list", {
      canvasSessionId: opened.canvasSessionId,
      tags: ["knowledge-base"],
      frameworkIds: ["nextjs"]
    }) as {
      total: number;
      items: Array<{ id: string; defaultFrameworkId: string; kitIds: string[] }>;
    };
    expect(filtered.total).toBe(1);
    expect(filtered.items).toEqual([
      expect.objectContaining({
        id: "docs.reference",
        defaultFrameworkId: "astro",
        kitIds: []
      })
    ]);

    const unmatched = await manager.execute("canvas.starter.list", {
      canvasSessionId: opened.canvasSessionId,
      tags: ["knowledge-base"],
      kitIds: ["dashboard.analytics-core"]
    }) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(unmatched.total).toBe(0);
    expect(unmatched.items).toEqual([]);

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      starterId: "docs.reference"
    }) as {
      ok: boolean;
      planSeeded: boolean;
      degraded: boolean;
      rootNodeId: string;
      insertedNodeIds: string[];
      seededInventoryItemIds: string[];
      summary: {
        starterFrameworkId?: string | null;
      };
    };

    expect(applied.ok).toBe(true);
    expect(applied.planSeeded).toBe(false);
    expect(applied.degraded).toBe(false);
    expect(applied.insertedNodeIds.length).toBeGreaterThanOrEqual(5);
    expect(applied.seededInventoryItemIds).toEqual([]);
    expect(applied.summary.starterFrameworkId).toBe("nextjs");

    const afterDocument = session.store.getDocument();
    const appliedRoot = afterDocument.pages[0]?.nodes.find((node) => node.id === applied.rootNodeId);
    expect(appliedRoot).toMatchObject({
      parentId: null,
      metadata: {
        starter: {
          id: "docs.reference",
          role: "shell"
        }
      }
    });
    expect(afterDocument.tokens.collections).toEqual([]);
    expect(afterDocument.componentInventory).toHaveLength(1);
    expect(afterDocument.meta.starter).toEqual(expect.objectContaining({
      frameworkId: "nextjs",
      template: expect.objectContaining({
        id: "docs.reference",
        kitIds: []
      }),
      metadata: expect.objectContaining({
        seededInventoryItemIds: [],
        materializedItemIds: []
      })
    }));
    expect(session.planStatus).toBe("accepted");
  });

  it("degrades starter application when the requested adapter is unavailable and replaces existing seeded assets by id", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const session = (manager as unknown as {
      sessions: Map<string, {
        feedback: Array<{ class: string; severity: string; details: Record<string, unknown> }>;
        store: CanvasDocumentStore;
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Expected canvas session");
    }

    const document = session.store.getDocument();
    document.componentInventory.push({
      id: "kit.dashboard.analytics-core.metric-card",
      name: "Stale Analytics Card",
      componentName: "AnalyticsMetricCard",
      description: "Outdated starter asset",
      sourceKind: "built-in-kit",
      sourceFamily: "starter_template",
      origin: "starter",
      framework: {
        id: "react",
        label: "React",
        packageName: "react",
        adapter: {
          id: "tsx-react-v1",
          label: "TSX React v1",
          packageName: "@opendevbrowser/tsx-react-v1",
          metadata: {}
        },
        metadata: {}
      },
      adapter: {
        id: "tsx-react-v1",
        label: "TSX React v1",
        packageName: "@opendevbrowser/tsx-react-v1",
        metadata: {}
      },
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
        stale: true
      }
    });
    document.tokens.collections.push({
      id: "kit.dashboard.analytics-core.tokens",
      name: "Stale Analytics Tokens",
      items: [{
        id: "surface-card",
        path: "surface.card",
        value: "#ffffff",
        type: "color",
        description: null,
        modes: [],
        metadata: {}
      }],
      metadata: {
        stale: true
      }
    });
    session.store.loadDocument(document);
    const baseRevision = session.store.getRevision();

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision,
      starterId: "dashboard.analytics",
      frameworkId: "nextjs",
      adapterId: "custom-adapter-v2"
    }) as {
      degraded: boolean;
      planSeeded: boolean;
      reason: string | null;
      seededInventoryItemIds: string[];
      summary: {
        starterFrameworkId?: string | null;
      };
    };

    expect(applied.degraded).toBe(true);
    expect(applied.planSeeded).toBe(false);
    expect(applied.reason).toBe("adapter_unavailable:custom-adapter-v2");
    expect(applied.seededInventoryItemIds).toEqual(["kit.dashboard.analytics-core.metric-card"]);
    expect(applied.summary.starterFrameworkId).toBe("nextjs");

    const afterDocument = session.store.getDocument();
    expect(afterDocument.componentInventory.filter((item) => item.id === "kit.dashboard.analytics-core.metric-card")).toHaveLength(1);
    expect(afterDocument.componentInventory.find((item) => item.id === "kit.dashboard.analytics-core.metric-card")).toMatchObject({
      name: "Analytics Metric Card",
      framework: expect.objectContaining({ id: "nextjs" }),
      adapter: expect.objectContaining({ id: "tsx-react-v1" })
    });
    expect(afterDocument.tokens.collections.filter((collection) => collection.id === "kit.dashboard.analytics-core.tokens")).toHaveLength(1);
    expect(afterDocument.tokens.collections.find((collection) => collection.id === "kit.dashboard.analytics-core.tokens")).toMatchObject({
      name: "Analytics Core Tokens"
    });
    expect(session.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({
        class: "starter-applied-degraded",
        severity: "warning",
        details: expect.objectContaining({
          reason: "adapter_unavailable:custom-adapter-v2"
        })
      })
    ]));
  });

  it("rejects starter application for unknown starters, revision conflicts, invalid parents, and missing pages", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };

    await expect(manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      starterId: "starter.unknown"
    })).rejects.toThrow("Unknown starter template: starter.unknown");

    await manager.execute("canvas.plan.set", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      generationPlan: structuredClone(validGenerationPlan)
    });

    const session = (manager as unknown as {
      sessions: Map<string, {
        editorSelection: { pageId: string | null; nodeId: string | null; targetId: string | null; updatedAt: string | null };
        store: CanvasDocumentStore;
      }>;
    }).sessions.get(opened.canvasSessionId);
    if (!session) {
      throw new Error("Expected canvas session");
    }

    const pageId = session.store.getDocument().pages[0]?.id;
    if (!pageId) {
      throw new Error("Expected page id");
    }

    await expect(manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: 999,
      starterId: "dashboard.analytics"
    })).rejects.toThrow("The canvas document revision changed before this patch batch was applied.");

    await expect(manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: session.store.getRevision(),
      starterId: "dashboard.analytics",
      pageId,
      parentId: "node_missing"
    })).rejects.toThrow("Unknown node: node_missing");

    const document = session.store.getDocument();
    document.pages = [];
    session.store.loadDocument(document);
    session.editorSelection = {
      pageId: null,
      nodeId: null,
      targetId: null,
      updatedAt: null
    };

    await expect(manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      baseRevision: session.store.getRevision(),
      starterId: "docs.reference"
    })).rejects.toThrow("Missing pageId");
  });

  it("seeds the kitless docs starter with default astro inference and explicit adapter passthrough", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const opened = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };

    const applied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: opened.canvasSessionId,
      leaseId: opened.leaseId,
      starterId: "docs.reference",
      adapterId: "mdx-docs-v1"
    }) as {
      degraded: boolean;
      planSeeded: boolean;
      summary: {
        starterFrameworkId?: string | null;
      };
    };

    expect(applied.degraded).toBe(false);
    expect(applied.planSeeded).toBe(true);
    expect(applied.summary.starterFrameworkId).toBe("astro");

    const session = (manager as unknown as {
      sessions: Map<string, { store: CanvasDocumentStore }>;
    }).sessions.get(opened.canvasSessionId);
    const document = session?.store.getDocument();
    expect(document?.meta.starter).toEqual(expect.objectContaining({
      frameworkId: "astro",
      metadata: expect.objectContaining({
        adapterId: "mdx-docs-v1",
        seededInventoryItemIds: [],
        materializedItemIds: []
      })
    }));
    expect(document?.tokens.collections).toEqual([]);
    expect(document?.componentInventory).toEqual([]);
  });

  it("supports framework aliases and remix starter application without assuming Next.js defaults", async () => {
    const browserManager = {
      status: vi.fn(),
      closeTarget: vi.fn()
    };
    const manager = new CanvasManager({
      worktree,
      browserManager: browserManager as never,
      config: resolveConfig({})
    });

    const reactSession = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };
    const reactApplied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: reactSession.canvasSessionId,
      leaseId: reactSession.leaseId,
      starterId: "dashboard.analytics",
      frameworkId: "react-tsx"
    }) as {
      degraded: boolean;
      summary: {
        starterFrameworkId?: string | null;
      };
    };
    expect(reactApplied.degraded).toBe(false);
    expect(reactApplied.summary.starterFrameworkId).toBe("react");

    const reactDocument = (manager as unknown as {
      sessions: Map<string, { store: CanvasDocumentStore }>;
    }).sessions.get(reactSession.canvasSessionId)?.store.getDocument();
    expect(reactDocument?.componentInventory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "kit.dashboard.analytics-core.metric-card",
        framework: expect.objectContaining({ id: "react" })
      })
    ]));

    const remixSession = await manager.execute("canvas.session.open", {}) as {
      canvasSessionId: string;
      leaseId: string;
    };
    const remixApplied = await manager.execute("canvas.starter.apply", {
      canvasSessionId: remixSession.canvasSessionId,
      leaseId: remixSession.leaseId,
      starterId: "auth.sign-up",
      frameworkId: "remix"
    }) as {
      degraded: boolean;
      summary: {
        starterFrameworkId?: string | null;
      };
    };
    expect(remixApplied.degraded).toBe(false);
    expect(remixApplied.summary.starterFrameworkId).toBe("remix");

    const remixDocument = (manager as unknown as {
      sessions: Map<string, { store: CanvasDocumentStore }>;
    }).sessions.get(remixSession.canvasSessionId)?.store.getDocument();
    expect(remixDocument?.componentInventory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "kit.auth.multi-step.sign-in-shell",
        framework: expect.objectContaining({ id: "remix" })
      })
    ]));
    expect(remixDocument?.meta.starter).toEqual(expect.objectContaining({
      frameworkId: "remix"
    }));
  });
});
