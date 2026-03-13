import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  buildDocumentContext,
  buildGovernanceBlockStates,
  CANVAS_PROJECT_DEFAULTS,
  CanvasDocumentStore,
  createDefaultCanvasDocument,
  evaluateCanvasWarnings,
  missingRequiredSaveBlocks,
  normalizeCanvasDocument,
  resolveCanvasLibraryPolicy,
  validateCanvasSave,
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
    document.designGovernance.colorSystem = { roles: { primary: "#0055ff" } };
    document.designGovernance.surfaceSystem = { panels: { elevation: "medium" } };
    document.designGovernance.iconSystem = { primary: "tabler" };
    document.tokens.brand = "teal";
    document.componentInventory.push({ componentName: "HeroCard" });

    const states = buildGovernanceBlockStates(document);
    expect(states.intent.status).toBe("present");
    expect(states.colorSystem.status).toBe("present");
    expect(states.surfaceSystem.status).toBe("present");
    expect(states.iconSystem.status).toBe("present");
    expect(states.libraryPolicy.status).toBe("inherited");
    expect(states.runtimeBudgets.status).toBe("inherited");
    expect(states.designLanguage.status).toBe("missing");

    const context = buildDocumentContext(document);
    expect(context.status).toBe("existing");
    expect(context.tokensPresent).toBe(true);
    expect(context.componentInventoryPresent).toBe(true);
    expect(context.existingGovernanceBlocks).toContain("intent");
    expect(context.missingGovernanceBlocks).toContain("designLanguage");
    expect(resolveCanvasLibraryPolicy(document)).toEqual(CANVAS_PROJECT_DEFAULTS.libraryPolicy);
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

  it("normalizes sparse asset fields into stable defaults", () => {
    const normalized = normalizeCanvasDocument({
      assets: [
        {
          id: 99,
          sourceType: 42,
          kind: null,
          repoPath: false,
          url: false,
          mime: 10,
          width: "wide",
          height: "tall",
          hash: [],
          status: {},
          variants: null,
          metadata: null
        },
        {
          id: "asset_remote",
          sourceType: "remote",
          kind: "image",
          repoPath: "assets/logo.svg",
          url: "https://example.com/logo.svg",
          mime: "image/svg+xml",
          width: 320,
          height: 180,
          hash: "sha256-logo",
          status: "ready",
          variants: [{ density: 2 }],
          metadata: { provenance: { sourceUrl: "https://example.com/logo.svg" } }
        }
      ]
    } as unknown as CanvasDocument);

    expect(normalized.assets[0]).toMatchObject({
      id: expect.stringMatching(/^asset_/),
      repoPath: null,
      url: null,
      variants: [],
      metadata: {}
    });
    expect(normalized.assets[0]?.sourceType).toBeUndefined();
    expect(normalized.assets[0]?.kind).toBeUndefined();
    expect(normalized.assets[0]?.mime).toBeUndefined();
    expect(normalized.assets[0]?.width).toBeUndefined();
    expect(normalized.assets[0]?.height).toBeUndefined();
    expect(normalized.assets[0]?.hash).toBeUndefined();
    expect(normalized.assets[0]?.status).toBeUndefined();
    expect(normalized.assets[1]).toMatchObject({
      id: "asset_remote",
      sourceType: "remote",
      kind: "image",
      repoPath: "assets/logo.svg",
      url: "https://example.com/logo.svg",
      mime: "image/svg+xml",
      width: 320,
      height: 180,
      hash: "sha256-logo",
      status: "ready",
      variants: [{ density: 2 }],
      metadata: { provenance: { sourceUrl: "https://example.com/logo.svg" } }
    });
  });

  it("normalizes code-sync bindings and falls back invalid library policy fields", () => {
    const normalized = normalizeCanvasDocument({
      designGovernance: {
        libraryPolicy: {
          icons: "invalid" as unknown as string[],
          components: ["shadcn", "custom-kit", "", 7 as unknown as string],
          styling: null as unknown as string[],
          motion: {} as unknown as string[],
          threeD: undefined as unknown as string[]
        }
      },
      bindings: [
        {
          id: "binding_kind_code_sync",
          nodeId: "node_kind",
          kind: "code-sync",
          selector: 42 as unknown as string,
          componentName: false as unknown as string,
          metadata: null as unknown as Record<string, unknown>,
          codeSync: {
            adapter: "tsx-react-v1",
            repoPath: "src/app/Hero.tsx",
            exportName: "HeroSection",
            syncMode: "watch"
          }
        },
        {
          id: "binding_explicit_code_sync",
          nodeId: "node_explicit",
          kind: "component-prop",
          selector: "props.title",
          metadata: null as unknown as Record<string, unknown>,
          codeSync: {
            adapter: "tsx-react-v1",
            repoPath: "src/app/Card.tsx",
            selector: "[data-card]",
            syncMode: "manual"
          }
        },
        {
          id: "binding_metadata_code_sync",
          nodeId: "node_metadata",
          kind: "code-sync",
          metadata: {
            codeSync: {
              adapter: "tsx-react-v1",
              repoPath: "src/app/MetadataBacked.tsx",
              exportName: "MetadataBacked",
              syncMode: "manual"
            }
          }
        }
      ]
    } as unknown as CanvasDocument);

    expect(resolveCanvasLibraryPolicy(normalized)).toEqual({
      icons: CANVAS_PROJECT_DEFAULTS.libraryPolicy.icons,
      components: ["shadcn", "custom-kit"],
      styling: CANVAS_PROJECT_DEFAULTS.libraryPolicy.styling,
      motion: CANVAS_PROJECT_DEFAULTS.libraryPolicy.motion,
      threeD: CANVAS_PROJECT_DEFAULTS.libraryPolicy.threeD
    });
    expect(normalized.bindings).toEqual([
      expect.objectContaining({
        id: "binding_kind_code_sync",
        metadata: {},
        selector: undefined,
        componentName: undefined,
        codeSync: expect.objectContaining({
          adapter: "tsx-react-v1",
          repoPath: "src/app/Hero.tsx",
          exportName: "HeroSection",
          syncMode: "watch",
          projection: "canvas_html"
        })
      }),
      expect.objectContaining({
        id: "binding_explicit_code_sync",
        metadata: {},
        selector: "props.title",
        codeSync: expect.objectContaining({
          adapter: "tsx-react-v1",
          repoPath: "src/app/Card.tsx",
          selector: "[data-card]",
          syncMode: "manual",
          projection: "canvas_html"
        })
      }),
      expect.objectContaining({
        id: "binding_metadata_code_sync",
        metadata: expect.objectContaining({
          codeSync: expect.objectContaining({
            repoPath: "src/app/MetadataBacked.tsx"
          })
        }),
        codeSync: expect.objectContaining({
          adapter: "tsx-react-v1",
          repoPath: "src/app/MetadataBacked.tsx",
          exportName: "MetadataBacked",
          syncMode: "manual",
          projection: "canvas_html"
        })
      })
    ]);

    const inheritedStateDocument = createDefaultCanvasDocument("dc_library_policy_status");
    inheritedStateDocument.designGovernance.libraryPolicy = {
      icons: undefined
    } as unknown as CanvasDocument["designGovernance"]["libraryPolicy"];
    expect(buildGovernanceBlockStates(inheritedStateDocument).libraryPolicy.status).toBe("present");
  });

  it("publishes typed Yjs updates and applies encoded state round-trip", () => {
    const source = new CanvasDocumentStore(createDefaultCanvasDocument("dc_sync"));
    const updates: Array<{ documentId: string; revision: number; origin: unknown; encodedState: string }> = [];
    const unsubscribe = source.observe((update) => {
      updates.push(update);
    });

    const planResult = source.setGenerationPlan(validPlan as CanvasGenerationPlan);
    expect(planResult.documentRevision).toBe(2);
    expect(updates.at(-1)).toMatchObject({
      documentId: "dc_sync",
      revision: 2,
      origin: "canvas.store.set-generation-plan",
      encodedState: expect.any(String)
    });

    const mirror = new CanvasDocumentStore(createDefaultCanvasDocument("dc_mirror"));
    mirror.applyEncodedState(source.getEncodedState());

    expect(mirror.getDocument().documentId).toBe("dc_sync");
    expect(mirror.getRevision()).toBe(2);
    expect(mirror.getDocument().designGovernance.generationPlan).toEqual(validPlan);

    unsubscribe();
  });

  it("replaces existing array-backed state when applying encoded updates", () => {
    const source = new CanvasDocumentStore(createDefaultCanvasDocument("dc_sync_source"));
    source.setGenerationPlan(validPlan as CanvasGenerationPlan);
    source.applyPatches(2, [
      {
        op: "page.create",
        page: {
          id: "page_marketing",
          name: "Marketing",
          path: "/marketing",
          prototypeIds: []
        }
      }
    ]);

    const target = new CanvasDocumentStore(createDefaultCanvasDocument("dc_sync_target"));
    target.setGenerationPlan(validPlan as CanvasGenerationPlan);
    expect(target.getDocument().pages).toHaveLength(1);

    target.applyEncodedState(source.getEncodedState());

    expect(target.getDocument().documentId).toBe("dc_sync_source");
    expect(target.getDocument().pages.map((page) => page.id)).toEqual(["page_home", "page_marketing"]);
  });

  it("falls back when remote encoded state omits a revision and local y-root revision is invalid", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_revision_fallback"));
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    const internal = store as unknown as {
      ydoc: Y.Doc;
      root: Y.Map<unknown>;
    };
    internal.ydoc.transact(() => {
      internal.root.set("revision", "invalid");
    }, "test.invalid-revision");
    expect(store.getRevision()).toBe(2);

    const remote = new Y.Doc();
    const remoteRoot = remote.getMap<unknown>("canvas");
    remoteRoot.set("schemaVersion", "design-canvas.v1");
    remoteRoot.set("documentId", "dc_remote_replace");
    remoteRoot.set("title", "Remote Snapshot");

    store.applyEncodedState(Buffer.from(Y.encodeStateAsUpdate(remote)).toString("base64"));

    expect(store.getDocument().documentId).toBe("dc_remote_replace");
    expect(store.getDocument().title).toBe("Remote Snapshot");
    expect(store.getRevision()).toBe(2);
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
    expect(document.assets).toEqual([{
      id: "asset_brand",
      sourceType: "transient",
      repoPath: null,
      url: null,
      status: "attached",
      variants: [],
      metadata: {}
    }]);
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
    expect(() => store.applyPatches(2, [
      {
        op: "node.update",
        nodeId: rootNodeId as string,
        changes: {
          "description.text": "blocked"
        }
      }
    ])).toThrow("Policy violation for change root");
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
    expect(document.assets).toEqual([{
      id: "asset_logo",
      sourceType: "transient",
      repoPath: null,
      url: null,
      status: "attached",
      variants: [],
      metadata: {}
    }]);
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

    const rectUpdate = store.applyPatches(rootInsert.appliedRevision, [
      {
        op: "node.update",
        nodeId: "node_new_root",
        changes: { "rect.width": 100 }
      }
    ]);
    expect(store.getDocument().pages[0]?.nodes.find((node) => node.id === "node_new_root")?.rect.width).toBe(100);

    expect(() => store.applyPatches(rectUpdate.appliedRevision, [
      {
        op: "node.remove",
        nodeId: "node_missing"
      }
    ])).toThrow("Unknown node: node_missing");
  });

  it("creates deep nested change paths and rejects reversed overlaps", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_nested_paths"));
    const rootNodeId = store.getDocument().pages[0]?.rootNodeId as string;
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    const nestedResult = store.applyPatches(2, [
      {
        op: "node.update",
        nodeId: rootNodeId,
        changes: {
          "props.theme.colors.primary": "#123456",
          "metadata.review.status": "ready"
        }
      }
    ]);

    const rootNode = store.getDocument().pages[0]?.nodes.find((node) => node.id === rootNodeId);
    expect(nestedResult.appliedRevision).toBe(3);
    expect(rootNode?.props).toMatchObject({
      theme: {
        colors: {
          primary: "#123456"
        }
      }
    });
    expect(rootNode?.metadata).toMatchObject({
      review: {
        status: "ready"
      }
    });

    expect(() => store.applyPatches(nestedResult.appliedRevision, [
      {
        op: "node.update",
        nodeId: rootNodeId,
        changes: {
          "metadata.review.status": "stale",
          metadata: {}
        }
      }
    ])).toThrow("Overlapping change paths: metadata.review.status vs metadata");
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

  it("covers binding removal for missing, primary, and detached-primary bindings", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_binding_remove"));
    const rootNodeId = store.getDocument().pages[0]?.rootNodeId as string;
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    const missingRemoval = store.applyPatches(2, [{
      op: "binding.remove",
      bindingId: "binding_missing"
    }]);
    expect(missingRemoval.appliedRevision).toBe(3);

    const primaryBinding = store.applyPatches(missingRemoval.appliedRevision, [{
      op: "binding.set",
      nodeId: rootNodeId,
      binding: {
        id: "binding_primary",
        kind: "component-prop",
        selector: "props.title"
      }
    }]);
    expect(store.getDocument().bindings.map((binding) => binding.id)).toEqual(["binding_primary"]);

    const removedPrimary = store.applyPatches(primaryBinding.appliedRevision, [{
      op: "binding.remove",
      bindingId: "binding_primary"
    }]);
    expect(store.getDocument().bindings).toEqual([]);
    expect(store.getDocument().pages[0]?.nodes.find((node) => node.id === rootNodeId)?.bindingRefs.primary).toBeUndefined();

    const detachedPrimary = store.applyPatches(removedPrimary.appliedRevision, [
      {
        op: "binding.set",
        nodeId: rootNodeId,
        binding: {
          id: "binding_secondary",
          kind: "component-prop",
          selector: "props.subtitle"
        }
      },
      {
        op: "node.update",
        nodeId: rootNodeId,
        changes: {
          "bindingRefs.primary": "binding_detached",
          "bindingRefs.secondary": "binding_secondary"
        }
      }
    ]);
    const removedSecondary = store.applyPatches(detachedPrimary.appliedRevision, [{
      op: "binding.remove",
      bindingId: "binding_secondary"
    }]);

    expect(removedSecondary.appliedRevision).toBe(detachedPrimary.appliedRevision + 1);
    expect(store.getDocument().bindings).toEqual([]);
    expect(store.getDocument().pages[0]?.nodes.find((node) => node.id === rootNodeId)?.bindingRefs).toMatchObject({
      primary: "binding_detached",
      secondary: "binding_secondary"
    });
  });

  it("reports rich governance, asset, and runtime warnings for save-time validation", () => {
    const document = createDefaultCanvasDocument("dc_warning_matrix");
    const rootNode = document.pages[0]?.nodes.find((node) => node.id === document.pages[0]?.rootNodeId);
    expect(rootNode).toBeTruthy();
    if (!rootNode) {
      throw new Error("Expected default root node");
    }

    document.designGovernance.generationPlan = structuredClone(validPlan);
    document.designGovernance.intent = { summary: "Governed preview document" };
    document.designGovernance.designLanguage = { profile: "clean-room" };
    document.designGovernance.contentModel = { requiredStates: ["default", "loading"] };
    document.designGovernance.layoutSystem = { grid: { columns: 12 } };
    document.designGovernance.typographySystem = { hierarchy: { display: "display-01" }, fontPolicy: "Local Sans" };
    document.designGovernance.colorSystem = { roles: { primary: "#0055ff" } };
    document.designGovernance.iconSystem = { primary: "rogue-icons" };
    document.designGovernance.motionSystem = {};
    document.designGovernance.accessibilityPolicy = {};
    document.designGovernance.libraryPolicy = {
      icons: ["lucide-react"],
      components: ["rogue-kit"],
      styling: ["rogue-css"],
      motion: [],
      threeD: []
    };
    document.designGovernance.runtimeBudgets = {
      defaultLivePreviewLimit: 1,
      maxPinnedFullPreviewExtra: 0,
      reconnectGraceMs: 12_000,
      overflowRenderMode: "thumbnail_only",
      backgroundTelemetryMode: "sampled"
    };
    document.viewports = [{ id: "desktop" }, { id: "tablet" }] as CanvasDocument["viewports"];
    document.themes = [{ id: "light" }] as CanvasDocument["themes"];

    rootNode.bindingRefs.primary = "binding_missing";
    rootNode.tokenRefs.color = "tokens.missing";

    document.assets = [
      { id: "asset_repo", sourceType: "repo", repoPath: null, metadata: {} } as CanvasDocument["assets"][number],
      { id: "asset_remote", sourceType: "remote", url: null, metadata: {} } as CanvasDocument["assets"][number],
      { id: "asset_page", sourceType: "page-derived", url: "https://example.com/asset.png", metadata: {} } as CanvasDocument["assets"][number],
      { id: "asset_generated", sourceType: "generated", metadata: {} } as CanvasDocument["assets"][number]
    ];

    const warnings = evaluateCanvasWarnings(document, {
      forSave: true,
      degradeReason: "overflow",
      unsupportedTarget: "tab-missing"
    });
    const codes = new Set(warnings.map((warning) => warning.code));

    expect([...codes]).toEqual(expect.arrayContaining([
      "missing-responsive-policy",
      "missing-reduced-motion-policy",
      "missing-state-coverage",
      "responsive-mismatch",
      "missing-governance-block",
      "library-policy-violation",
      "icon-policy-violation",
      "unresolved-component-binding",
      "token-missing",
      "broken-asset-reference",
      "asset-provenance-missing",
      "runtime-budget-exceeded",
      "unsupported-target"
    ]));

    expect(missingRequiredSaveBlocks(document)).toEqual(expect.arrayContaining([
      "motionSystem",
      "accessibilityPolicy",
      "responsiveSystem"
    ]));

    const validation = validateCanvasSave(document);
    expect(validation.missingBlocks).toEqual(expect.arrayContaining([
      "motionSystem",
      "accessibilityPolicy",
      "responsiveSystem"
    ]));
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-responsive-policy" }),
      expect.objectContaining({
        code: "missing-governance-block",
        details: expect.objectContaining({ block: "motionSystem" })
      }),
      expect.objectContaining({
        code: "broken-asset-reference",
        details: expect.objectContaining({ assetId: "asset_repo" })
      }),
      expect.objectContaining({
        code: "asset-provenance-missing",
        details: expect.objectContaining({ assetId: "asset_generated" })
      })
    ]));
  });

  it("covers inherited-governance warning branches with resolved tokens and valid repo assets", () => {
    const document = createDefaultCanvasDocument("dc_warning_resolution");
    const rootNode = document.pages[0]?.nodes.find((node) => node.id === document.pages[0]?.rootNodeId);
    expect(rootNode).toBeTruthy();
    if (!rootNode) {
      throw new Error("Expected default root node");
    }

    document.designGovernance.generationPlan = structuredClone(validPlan);
    document.designGovernance.intent = { summary: "Governed warning resolution" };
    document.designGovernance.designLanguage = { profile: "clean-room" };
    document.designGovernance.contentModel = [] as unknown as CanvasDocument["designGovernance"]["contentModel"];
    document.designGovernance.layoutSystem = { grid: { columns: 12 } };
    document.designGovernance.typographySystem = { hierarchy: { display: "display-01" }, fontPolicy: "Local Sans" };
    document.designGovernance.motionSystem = { reducedMotion: "respect-user-preference" };
    document.designGovernance.responsiveSystem = { breakpoints: { mobile: 390, tablet: 1024, desktop: 1440 } };
    document.designGovernance.accessibilityPolicy = { reducedMotion: "respect-user-preference" };
    document.designGovernance.libraryPolicy = {
      icons: ["tabler"],
      components: ["shadcn"],
      styling: ["tailwindcss"],
      motion: [],
      threeD: []
    };
    document.viewports = [
      { id: "desktop" },
      { id: 1024 as unknown as string },
      { id: "mobile" }
    ] as CanvasDocument["viewports"];
    document.themes = [{ id: 1 as unknown as string }] as CanvasDocument["themes"];
    document.tokens = { theme: { primary: "#ffffff" } };
    rootNode.tokenRefs = {
      color: "theme.primary",
      accent: 7 as unknown as string
    } as typeof rootNode.tokenRefs;
    document.assets = [{
      id: "asset_repo_ok",
      sourceType: "repo",
      repoPath: "assets/logo.svg",
      metadata: {}
    } as CanvasDocument["assets"][number]];

    const warnings = evaluateCanvasWarnings(document, { forSave: true });
    const codes = warnings.map((warning) => warning.code);

    expect(codes).toEqual(expect.arrayContaining([
      "missing-content-model",
      "missing-state-coverage",
      "responsive-mismatch"
    ]));
    expect(codes).not.toContain("token-missing");
    expect(codes).not.toContain("broken-asset-reference");

    const validation = validateCanvasSave(document);
    expect(validation.missingBlocks).toEqual(["contentModel"]);
  });

  it("dedupes duplicate asset warnings and preserves explicit page payloads", () => {
    const warningDocument = createDefaultCanvasDocument("dc_duplicate_assets");
    warningDocument.designGovernance.generationPlan = structuredClone(validPlan);
    warningDocument.designGovernance.intent = { summary: "Duplicate asset coverage" };
    warningDocument.designGovernance.designLanguage = { profile: "clean-room" };
    warningDocument.designGovernance.contentModel = { requiredStates: ["default", "loading", "empty", "error"] };
    warningDocument.designGovernance.layoutSystem = { grid: { columns: 12 } };
    warningDocument.designGovernance.typographySystem = { hierarchy: { display: "display-01" }, fontPolicy: "Local Sans" };
    warningDocument.designGovernance.colorSystem = { roles: { primary: "#0055ff" } };
    warningDocument.designGovernance.surfaceSystem = { panels: { elevation: "medium" } };
    warningDocument.designGovernance.iconSystem = { primary: "tabler" };
    warningDocument.designGovernance.motionSystem = { reducedMotion: "respect-user-preference" };
    warningDocument.designGovernance.responsiveSystem = { breakpoints: { mobile: 390, tablet: 1024, desktop: 1440 } };
    warningDocument.designGovernance.accessibilityPolicy = { reducedMotion: "respect-user-preference" };
    warningDocument.designGovernance.libraryPolicy = {
      icons: ["tabler"],
      components: ["shadcn"],
      styling: ["tailwindcss"],
      motion: [],
      threeD: []
    };
    warningDocument.viewports = [{ id: "desktop" }, { id: "tablet" }, { id: "mobile" }] as CanvasDocument["viewports"];
    warningDocument.themes = [{ id: "light" }] as CanvasDocument["themes"];
    warningDocument.assets = [
      { id: "asset_dup", sourceType: "repo", repoPath: null, metadata: {} } as CanvasDocument["assets"][number],
      { id: "asset_dup", sourceType: "repo", repoPath: null, metadata: {} } as CanvasDocument["assets"][number]
    ];

    const warnings = evaluateCanvasWarnings(warningDocument);
    expect(warnings.filter((warning) => warning.code === "broken-asset-reference")).toHaveLength(1);

    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_explicit_page_payload"));
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    store.applyPatches(2, [{
      op: "page.create",
      page: {
        id: "page_explicit",
        name: "Explicit",
        path: "/explicit",
        nodes: [{
          id: "node_explicit",
          kind: "text",
          name: "Explicit Node",
          pageId: "page_explicit",
          parentId: null,
          childIds: [],
          rect: { x: 12, y: 18, width: 320, height: 120 },
          props: { text: "Explicit payload" },
          style: { color: "#ffffff" },
          tokenRefs: {},
          bindingRefs: {},
          variantPatches: [],
          metadata: { source: "test" }
        }],
        metadata: { source: "test" }
      }
    }]);

    expect(store.getDocument().pages.find((page) => page.id === "page_explicit")).toMatchObject({
      nodes: [expect.objectContaining({
        id: "node_explicit",
        metadata: { source: "test" },
        props: { text: "Explicit payload" }
      })],
      metadata: { source: "test" }
    });
  });

});
