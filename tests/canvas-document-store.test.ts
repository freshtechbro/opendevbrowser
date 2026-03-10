import { describe, expect, it } from "vitest";
import {
  buildDocumentContext,
  buildGovernanceBlockStates,
  CANVAS_PROJECT_DEFAULTS,
  CanvasDocumentStore,
  createDefaultCanvasDocument,
  normalizeCanvasDocument,
  validateGenerationPlan
} from "../src/canvas/document-store";
import type { CanvasDocument, CanvasGenerationPlan } from "../src/canvas/types";

const validPlan = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Refine the hero." },
  visualDirection: { profile: "cinematic-minimal" },
  layoutStrategy: { approach: "hero-led-grid" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first" },
  motionPosture: { level: "subtle" },
  responsivePosture: { primaryViewport: "desktop" },
  accessibilityPosture: { target: "WCAG_2_2_AA" },
  validationTargets: { blockOn: ["contrast-failure"] }
};

describe("canvas document store", () => {
  it("validates generation plan completeness", () => {
    expect(validateGenerationPlan(validPlan)).toEqual({ ok: true });
    expect(validateGenerationPlan(null)).toEqual({
      ok: false,
      missing: [
        "targetOutcome",
        "visualDirection",
        "layoutStrategy",
        "contentStrategy",
        "componentStrategy",
        "motionPosture",
        "responsivePosture",
        "accessibilityPosture",
        "validationTargets"
      ]
    });
    expect(validateGenerationPlan({ targetOutcome: { mode: "draft" } })).toEqual({
      ok: false,
      missing: [
        "visualDirection",
        "layoutStrategy",
        "contentStrategy",
        "componentStrategy",
        "motionPosture",
        "responsivePosture",
        "accessibilityPosture",
        "validationTargets"
      ]
    });
  });

  it("builds governance block states and document context", () => {
    const document = createDefaultCanvasDocument("dc_context");
    document.designGovernance.intent = { product: "marketing-site" };
    document.tokens.brand = "teal";
    document.componentInventory.push({ componentName: "HeroCard" });

    const states = buildGovernanceBlockStates(document);
    expect(states.intent.status).toBe("present");
    expect(states.libraryPolicy.status).toBe("inherited");
    expect(states.runtimeBudgets.status).toBe("inherited");
    expect(states.designLanguage.status).toBe("missing");

    const context = buildDocumentContext(document);
    expect(context.status).toBe("existing");
    expect(context.tokensPresent).toBe(true);
    expect(context.componentInventoryPresent).toBe(true);
    expect(context.existingGovernanceBlocks).toContain("intent");
    expect(context.missingGovernanceBlocks).toContain("designLanguage");
  });

  it("normalizes sparse canvas documents with project defaults", () => {
    const sparse = {
      pages: [{
        id: "page_sparse",
        name: "",
        path: "",
        rootNodeId: undefined,
        prototypeIds: null,
        nodes: [{
          id: "node_sparse",
          kind: "text",
          name: "",
          pageId: "page_sparse",
          parentId: null,
          childIds: null,
          rect: null,
          props: null,
          style: null,
          tokenRefs: null,
          bindingRefs: null,
          variantPatches: [{ selector: null, changes: null }],
          metadata: null
        }, {
          id: "node_sparse_null",
          kind: "frame",
          name: "Sparse Null",
          pageId: "page_sparse",
          parentId: null,
          childIds: [],
          rect: null,
          props: null,
          style: null,
          tokenRefs: null,
          bindingRefs: null,
          variantPatches: null,
          metadata: null
        }],
        metadata: null
      }, {
        id: "page_sparse_empty",
        name: "Empty",
        path: "",
        rootNodeId: undefined,
        prototypeIds: null,
        nodes: null,
        metadata: null
      }],
      designGovernance: { libraryPolicy: {}, runtimeBudgets: {} },
      components: null,
      componentInventory: null,
      tokens: null,
      assets: null,
      viewports: null,
      themes: null,
      bindings: null,
      prototypes: null,
      meta: null
    } as unknown as CanvasDocument;

    const normalized = normalizeCanvasDocument(sparse);

    expect(normalized.documentId).toMatch(/^dc_/);
    expect(normalized.title).toBe("Untitled Design Canvas");
    expect(normalized.createdAt).toBeTruthy();
    expect(normalized.updatedAt).toBe(normalized.createdAt);
    expect(normalized.designGovernance.libraryPolicy).toEqual(CANVAS_PROJECT_DEFAULTS.libraryPolicy);
    expect(normalized.designGovernance.runtimeBudgets).toEqual(CANVAS_PROJECT_DEFAULTS.runtimeBudgets);
    expect(normalized.pages[0]).toMatchObject({
      id: "page_sparse",
      name: "page_sparse",
      path: "/",
      rootNodeId: null,
      prototypeIds: [],
      metadata: {}
    });
    expect(normalized.pages[0]?.nodes[0]).toMatchObject({
      id: "node_sparse",
      name: "node_sparse",
      childIds: [],
      rect: { x: 0, y: 0, width: 320, height: 180 },
      props: {},
      style: {},
      tokenRefs: {},
      bindingRefs: {},
      variantPatches: [{ selector: {}, changes: {} }],
      metadata: {}
    });
    expect(normalized.components).toEqual([]);
    expect(normalized.componentInventory).toEqual([]);
    expect(normalized.tokens).toEqual({});
    expect(normalized.assets).toEqual([]);
    expect(normalized.viewports).toEqual([]);
    expect(normalized.themes).toEqual([]);
    expect(normalized.bindings).toEqual([]);
    expect(normalized.prototypes).toEqual([]);
    expect(normalized.meta).toEqual({});

    const minimal = normalizeCanvasDocument({} as CanvasDocument);
    expect(minimal.designGovernance.libraryPolicy).toEqual(CANVAS_PROJECT_DEFAULTS.libraryPolicy);
    expect(minimal.designGovernance.runtimeBudgets).toEqual(CANVAS_PROJECT_DEFAULTS.runtimeBudgets);
    expect(minimal.pages).toEqual([]);
    expect(minimal.components).toEqual([]);
    expect(minimal.componentInventory).toEqual([]);
    expect(minimal.assets).toEqual([]);
    expect(minimal.bindings).toEqual([]);
    expect(minimal.prototypes).toEqual([]);
  });

  it("applies additive canvas patches and tracks revisions", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_store"));
    const homeRootId = store.getDocument().pages[0]?.rootNodeId;
    expect(homeRootId).toBeTruthy();
    const planResult = store.setGenerationPlan(validPlan);
    expect(planResult.planStatus).toBe("accepted");
    expect(planResult.documentRevision).toBe(2);

    const patchResult = store.applyPatches(2, [
      {
        op: "page.create",
        page: {
          id: "page_marketing",
          name: "Marketing",
          path: "/marketing",
          prototypeIds: []
        }
      },
      {
        op: "page.update",
        pageId: "page_marketing",
        changes: {
          description: "Campaign landing page",
          "metadata.channel": "growth"
        }
      },
      {
        op: "node.insert",
        pageId: "page_home",
        parentId: homeRootId,
        node: {
          id: "node_hero",
          kind: "frame",
          name: "Hero",
          props: { text: "Hero" },
          style: { backgroundColor: "#07111d" }
        }
      },
      {
        op: "node.insert",
        pageId: "page_home",
        parentId: "node_hero",
        node: {
          id: "node_copy",
          kind: "text",
          name: "Copy",
          props: { text: "Design better" }
        }
      },
      {
        op: "node.update",
        nodeId: "node_copy",
        changes: {
          "props.text": "Design better with a governed canvas",
          "style.color": "#20d5c6",
          "metadata.priority": "high"
        }
      },
      {
        op: "variant.patch",
        nodeId: "node_copy",
        selector: { viewport: "mobile" },
        changes: {
          "style.fontSize": "14px"
        }
      },
      {
        op: "token.set",
        path: "colorSystem.surface.default",
        value: "#07111d"
      },
      {
        op: "asset.attach",
        nodeId: "node_copy",
        assetId: "asset_brand"
      },
      {
        op: "binding.set",
        nodeId: "node_copy",
        binding: {
          id: "binding_copy",
          kind: "component-prop",
          selector: "props.text",
          componentName: "HeroTitle",
          metadata: { source: "cms" }
        }
      },
      {
        op: "prototype.upsert",
        prototype: {
          id: "proto_marketing_default",
          pageId: "page_marketing",
          route: "/marketing",
          name: "Marketing Default",
          defaultVariants: { viewport: "desktop", theme: "light" },
          metadata: {}
        }
      }
    ]);

    expect(patchResult.appliedRevision).toBe(3);
    const document = store.getDocument();
    expect(document.pages.find((page) => page.id === "page_marketing")?.metadata.channel).toBe("growth");
    expect(document.designGovernance.colorSystem.surface.default).toBe("#07111d");
    expect(document.assets).toEqual([{ id: "asset_brand", metadata: {} }]);
    expect(document.bindings[0]).toMatchObject({ id: "binding_copy", nodeId: "node_copy" });
    expect(document.prototypes.find((prototype) => prototype.id === "proto_marketing_default")?.route).toBe("/marketing");

    const homePage = document.pages.find((page) => page.id === "page_home");
    const copyNode = homePage?.nodes.find((node) => node.id === "node_copy");
    expect(copyNode?.props.text).toBe("Design better with a governed canvas");
    expect(copyNode?.variantPatches[0]?.changes["style.fontSize"]).toBe("14px");

    const removeResult = store.applyPatches(3, [
      {
        op: "node.remove",
        nodeId: "node_hero"
      }
    ]);
    expect(removeResult.appliedRevision).toBe(4);
    expect(store.getDocument().pages.find((page) => page.id === "page_home")?.nodes.find((node) => node.id === "node_hero")).toBeUndefined();
    expect(store.getDocument().bindings).toEqual([]);
  });

  it("rejects revision conflicts and policy violations", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_errors"));
    const rootNodeId = store.getDocument().pages[0]?.rootNodeId;
    expect(rootNodeId).toBeTruthy();
    store.setGenerationPlan(validPlan);

    expect(() => store.applyPatches(999, [])).toThrow("Revision conflict");
    expect(() => store.applyPatches(2, [
      {
        op: "node.update",
        nodeId: rootNodeId as string,
        changes: {
          props: {},
          "props.text": "duplicate"
        }
      }
    ])).toThrow("Overlapping change paths");
    expect(() => store.applyPatches(2, [
      {
        op: "token.set",
        path: "color.surface.default",
        value: "#fff"
      }
    ])).toThrow("Policy violation for token path");
  });

  it("upserts variant patches, bindings, assets, and prototypes", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_upsert"));
    const rootNodeId = store.getDocument().pages[0]?.rootNodeId as string;
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    store.applyPatches(2, [
      {
        op: "variant.patch",
        nodeId: rootNodeId,
        selector: { viewport: "desktop" },
        changes: { "style.color": "#111111" }
      },
      {
        op: "binding.set",
        nodeId: rootNodeId,
        binding: {
          id: "binding_primary",
          kind: "component-prop",
          selector: "props.title"
        }
      },
      {
        op: "prototype.upsert",
        prototype: {
          id: "proto_home_default",
          pageId: "page_home",
          route: "/initial",
          name: "Home Initial",
          defaultVariants: { viewport: "desktop", theme: "light" },
          metadata: {}
        }
      }
    ]);

    store.applyPatches(3, [
      {
        op: "variant.patch",
        nodeId: rootNodeId,
        selector: { viewport: "desktop" },
        changes: { "metadata.note": "merged" }
      },
      {
        op: "binding.set",
        nodeId: rootNodeId,
        binding: {
          id: "binding_primary",
          kind: "component-prop",
          selector: "props.title",
          componentName: "HeroTitle",
          metadata: { source: "cms" }
        }
      },
      {
        op: "prototype.upsert",
        prototype: {
          id: "proto_home_default",
          pageId: "page_home",
          route: "/updated",
          name: "Home Updated",
          defaultVariants: { viewport: "desktop", theme: "light" },
          metadata: {}
        }
      },
      {
        op: "asset.attach",
        nodeId: rootNodeId,
        assetId: "asset_logo"
      },
      {
        op: "asset.attach",
        nodeId: rootNodeId,
        assetId: "asset_logo"
      }
    ]);

    const document = store.getDocument();
    const rootNode = document.pages[0]?.nodes.find((node) => node.id === rootNodeId);
    expect(rootNode?.variantPatches).toEqual([{
      selector: { viewport: "desktop" },
      changes: {
        "style.color": "#111111",
        metadata: { note: "merged" }
      }
    }]);
    expect(document.bindings).toEqual([expect.objectContaining({
      id: "binding_primary",
      componentName: "HeroTitle",
      metadata: { source: "cms" }
    })]);
    expect(rootNode?.bindingRefs.primary).toBe("binding_primary");
    expect(document.prototypes.find((prototype) => prototype.id === "proto_home_default")?.route).toBe("/updated");
    expect(document.assets).toEqual([{ id: "asset_logo", metadata: {} }]);
    expect(rootNode?.metadata.assetIds).toEqual(["asset_logo"]);
  });

  it("covers invalid patch guards and root replacement branches", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_invalid"));

    expect(() => store.setGenerationPlan(null as unknown as CanvasGenerationPlan)).toThrow("Generation plan missing fields");
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    expect(() => store.applyPatches(2, [
      {
        op: "page.create",
        page: {
          id: "page_home",
          name: "Duplicate Home",
          path: "/"
        }
      }
    ])).toThrow("Page already exists: page_home");

    expect(() => store.applyPatches(2, [
      {
        op: "page.update",
        pageId: "page_missing",
        changes: { name: "Missing" }
      }
    ])).toThrow("Unknown page: page_missing");

    expect(() => store.applyPatches(2, [
      {
        op: "node.insert",
        pageId: "page_home",
        parentId: "node_missing_parent",
        node: {
          id: "node_orphan",
          kind: "text",
          name: "Orphan"
        }
      }
    ])).toThrow("Unknown parent node: node_missing_parent");

    const rootInsert = store.applyPatches(2, [
      {
        op: "node.insert",
        pageId: "page_home",
        parentId: null,
        node: {
          id: "node_new_root",
          kind: "frame",
          name: "New Root"
        }
      }
    ]);
    expect(store.getDocument().pages[0]?.rootNodeId).toBe("node_new_root");

    expect(() => store.applyPatches(rootInsert.appliedRevision, [
      {
        op: "node.insert",
        pageId: "page_home",
        parentId: null,
        node: {
          id: "node_new_root",
          kind: "frame",
          name: "Duplicate Root"
        }
      }
    ])).toThrow("Node already exists: node_new_root");

    expect(() => store.applyPatches(rootInsert.appliedRevision, [
      {
        op: "node.update",
        nodeId: "node_new_root",
        changes: { "props.bad-key": "broken" }
      }
    ])).toThrow("Invalid path: props.bad-key");

    expect(() => store.applyPatches(rootInsert.appliedRevision, [
      {
        op: "node.update",
        nodeId: "node_new_root",
        changes: { "rect.width": 100 }
      }
    ])).toThrow("Policy violation for change root: rect.width");

    expect(() => store.applyPatches(rootInsert.appliedRevision, [
      {
        op: "node.remove",
        nodeId: "node_missing"
      }
    ])).toThrow("Unknown node: node_missing");
  });

  it("rejects missing patch targets for inserts and attachments", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_missing_targets"));
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    expect(() => store.applyPatches(2, [
      {
        op: "node.insert",
        pageId: "page_missing",
        parentId: null,
        node: {
          id: "node_missing_page",
          kind: "text"
        }
      }
    ])).toThrow("Unknown page: page_missing");

    expect(() => store.applyPatches(2, [
      {
        op: "asset.attach",
        nodeId: "node_missing",
        assetId: "asset_missing"
      }
    ])).toThrow("Unknown node: node_missing");

    expect(() => store.applyPatches(2, [
      {
        op: "binding.set",
        nodeId: "node_missing",
        binding: {
          id: "binding_missing",
          kind: "component-prop",
          selector: "props.title"
        }
      }
    ])).toThrow("Unknown node: node_missing");
  });

  it("covers default constructor, page defaults, and root removal on secondary pages", () => {
    const store = new CanvasDocumentStore();
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    const pageResult = store.applyPatches(2, [
      {
        op: "page.create",
        page: {
          id: "page_secondary",
          nodes: null as unknown as [],
          metadata: null as unknown as Record<string, unknown>
        }
      }
    ]);

    const insertResult = store.applyPatches(pageResult.appliedRevision, [
      {
        op: "node.insert",
        pageId: "page_secondary",
        parentId: null,
        node: {
          id: "node_secondary_root",
          kind: "frame",
          props: { title: "Secondary" },
          style: { color: "#ffffff" },
          tokenRefs: { color: "colorSystem.surface.default" },
          bindingRefs: { primary: "binding_secondary" },
          variantPatches: [{ selector: { viewport: "desktop" }, changes: { "style.color": "#ffffff" } }],
          metadata: { role: "secondary" }
        }
      },
      {
        op: "node.insert",
        pageId: "page_secondary",
        parentId: "node_secondary_root",
        node: {
          id: "node_secondary_child",
          kind: "text",
          name: "Secondary Child",
          childIds: []
        }
      }
    ]);

    const updateResult = store.applyPatches(insertResult.appliedRevision, [
      {
        op: "node.update",
        nodeId: "node_secondary_root",
        changes: {
          "metadata.role": "updated-secondary"
        }
      }
    ]);

    const page = store.getDocument().pages.find((entry) => entry.id === "page_secondary");
    const rootNode = page?.nodes.find((node) => node.id === "node_secondary_root");
    expect(page).toMatchObject({
      name: "page_secondary",
      path: "/",
      prototypeIds: [],
      metadata: {}
    });
    expect(rootNode).toMatchObject({
      name: "node_secondary_root",
      childIds: ["node_secondary_child"],
      props: { title: "Secondary" },
      style: { color: "#ffffff" },
      tokenRefs: { color: "colorSystem.surface.default" },
      bindingRefs: { primary: "binding_secondary" },
      variantPatches: [{ selector: { viewport: "desktop" }, changes: { "style.color": "#ffffff" } }],
      metadata: { role: "updated-secondary" }
    });

    store.applyPatches(updateResult.appliedRevision, [
      {
        op: "node.remove",
        nodeId: "node_secondary_root"
      }
    ]);
    expect(store.getDocument().pages.find((entry) => entry.id === "page_secondary")?.rootNodeId).toBeNull();
  });
});
