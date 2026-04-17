import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  buildDocumentContext,
  buildGovernanceBlockStates,
  CANVAS_PROJECT_DEFAULTS,
  CanvasDocumentStore,
  createDefaultCanvasDocument,
  evaluateCanvasWarnings,
  mergeImportedCanvasState,
  missingRequiredSaveBlocks,
  normalizeCanvasDocument,
  resolveCanvasLibraryPolicy,
  validateCanvasSave,
  validateGenerationPlan
} from "../src/canvas/document-store";
import { DEFAULT_CODE_SYNC_OWNERSHIP } from "../src/canvas/code-sync/types";
import type { CanvasDocument, CanvasGenerationPlan } from "../src/canvas/types";

const validPlan = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Refine the hero." },
  visualDirection: { profile: "cinematic-minimal", themeStrategy: "single-theme" },
  layoutStrategy: { approach: "hero-led-grid", navigationModel: "global-header" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first", interactionStates: ["default", "hover", "focus", "disabled"] },
  motionPosture: { level: "subtle", reducedMotion: "respect-user-preference" },
  responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
  accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
  validationTargets: {
    blockOn: ["contrast-failure"],
    requiredThemes: ["light"],
    browserValidation: "required",
    maxInteractionLatencyMs: 150
  }
};

describe("canvas document store", () => {
  it("validates generation plan completeness", () => {
    expect(validateGenerationPlan(validPlan)).toMatchObject({
      ok: true,
      plan: structuredClone(validPlan)
    });
    expect(validateGenerationPlan(null)).toMatchObject({
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
    expect(validateGenerationPlan({ targetOutcome: { mode: "draft" } })).toMatchObject({
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
      ],
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: "targetOutcome.mode",
          code: "invalid_value"
        })
      ])
    });
  });

  it("reports nested missing generation plan fields when sections exist but are incomplete", () => {
    expect(validateGenerationPlan({
      targetOutcome: { mode: "high-fi-live-edit" },
      visualDirection: { profile: "clean-room" },
      layoutStrategy: { note: "missing required keys" },
      contentStrategy: { note: "missing source" },
      componentStrategy: { mode: "reuse-first", interactionStates: [] },
      motionPosture: { level: "subtle" },
      responsivePosture: { primaryViewport: "desktop" },
      accessibilityPosture: { target: "WCAG_2_2_AA" },
      validationTargets: {
        blockOn: ["contrast-failure"],
        requiredThemes: ["light"],
        browserValidation: "required"
      }
    })).toMatchObject({
      ok: false,
      missing: [],
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "targetOutcome.summary", code: "missing_field" }),
        expect.objectContaining({ path: "visualDirection.themeStrategy", code: "missing_field" }),
        expect.objectContaining({ path: "layoutStrategy.approach", code: "missing_field" }),
        expect.objectContaining({ path: "contentStrategy.source", code: "missing_field" }),
        expect.objectContaining({ path: "componentStrategy.interactionStates", code: "invalid_type" }),
        expect.objectContaining({ path: "motionPosture.reducedMotion", code: "missing_field" }),
        expect.objectContaining({ path: "responsivePosture.requiredViewports", code: "missing_field" }),
        expect.objectContaining({ path: "accessibilityPosture.keyboardNavigation", code: "missing_field" }),
        expect.objectContaining({ path: "validationTargets.maxInteractionLatencyMs", code: "missing_field" })
      ])
    });
  });

  it("reports nested invalid generation plan values without treating the sections as missing", () => {
    expect(validateGenerationPlan({
      targetOutcome: { mode: "high-fi-live-edit", summary: "Refine the hero" },
      visualDirection: { profile: "not-a-profile", themeStrategy: "single-theme" },
      layoutStrategy: { approach: "hero-led-grid", navigationModel: "global-header" },
      contentStrategy: { source: "document-context" },
      componentStrategy: { mode: "reuse-first", interactionStates: [123] },
      motionPosture: { level: "subtle", reducedMotion: "respect-user-preference" },
      responsivePosture: { primaryViewport: "desktop", requiredViewports: ["tablet"] },
      accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "sideways" },
      validationTargets: {
        blockOn: "contrast-failure",
        requiredThemes: ["sepia"],
        browserValidation: "sometimes",
        maxInteractionLatencyMs: 0
      }
    })).toMatchObject({
      ok: false,
      missing: [],
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "visualDirection.profile", code: "invalid_value" }),
        expect.objectContaining({ path: "componentStrategy.interactionStates", code: "invalid_type" }),
        expect.objectContaining({ path: "responsivePosture.requiredViewports", code: "invalid_value" }),
        expect.objectContaining({ path: "accessibilityPosture.keyboardNavigation", code: "invalid_value" }),
        expect.objectContaining({ path: "validationTargets.blockOn", code: "invalid_type" }),
        expect.objectContaining({ path: "validationTargets.requiredThemes", code: "invalid_value" }),
        expect.objectContaining({ path: "validationTargets.browserValidation", code: "invalid_value" }),
        expect.objectContaining({ path: "validationTargets.maxInteractionLatencyMs", code: "invalid_value" })
      ])
    });
  });

  it("builds governance block states and document context", () => {
    const document = createDefaultCanvasDocument("dc_context");
    document.designGovernance.intent = { product: "marketing-site" };
    document.designGovernance.colorSystem = { roles: { primary: "#0055ff" } };
    document.designGovernance.surfaceSystem = { panels: { elevation: "medium" } };
    document.designGovernance.iconSystem = { primary: "tabler" };
    document.tokens.values.brand = "teal";
    document.componentInventory.push({
      id: "inventory_hero_card",
      name: "HeroCard",
      componentName: "HeroCard",
      sourceFamily: "canvas_document",
      origin: "document",
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
    expect(normalized.tokens).toEqual({
      values: {},
      collections: [],
      aliases: [],
      bindings: [],
      metadata: {}
    });
    expect(normalized.assets).toEqual([]);
    expect(normalized.viewports).toEqual([]);
    expect(normalized.themes).toEqual([]);
    expect(normalized.bindings).toEqual([]);
    expect(normalized.prototypes).toEqual([]);
    expect(normalized.meta).toEqual({
      imports: [],
      starter: null,
      adapterPlugins: [],
      pluginErrors: [],
      metadata: {}
    });

    const minimal = normalizeCanvasDocument({} as CanvasDocument);
    expect(minimal.designGovernance.libraryPolicy).toEqual(CANVAS_PROJECT_DEFAULTS.libraryPolicy);
    expect(minimal.designGovernance.runtimeBudgets).toEqual(CANVAS_PROJECT_DEFAULTS.runtimeBudgets);
    expect(minimal.pages).toEqual([]);
    expect(minimal.components).toEqual([]);
    expect(minimal.componentInventory).toEqual([]);
    expect(minimal.tokens).toEqual({
      values: {},
      collections: [],
      aliases: [],
      bindings: [],
      metadata: {}
    });
    expect(minimal.assets).toEqual([]);
    expect(minimal.bindings).toEqual([]);
    expect(minimal.prototypes).toEqual([]);
    expect(minimal.meta).toEqual({
      imports: [],
      starter: null,
      adapterPlugins: [],
      pluginErrors: [],
      metadata: {}
    });
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

  it("normalizes structured inventory, token, and provenance contracts", () => {
    const normalized = normalizeCanvasDocument({
      documentId: "dc_structured",
      title: "Structured Canvas",
      pages: [],
      components: [],
      componentInventory: [{
        id: "inventory_button",
        componentName: "Button",
        sourceKind: "figma",
        sourceFamily: "framework_component",
        origin: "import",
        framework: { frameworkId: "react", name: "React", extraFramework: "kept" },
        adapter: { adapterId: "tsx-react-v1", name: "TSX React", extraAdapter: "kept" },
        plugin: { pluginId: "local-ui-kit", name: "Local UI Kit", extraPlugin: "kept" },
        variants: [{ id: "primary", label: "Primary", selector: { theme: "light" }, extraVariant: "kept" }],
        props: [{ name: "size", type: "enum", required: true, defaultValue: "md", description: "Size", extraProp: "kept" }],
        slots: [{ name: "icon", description: "Icon slot", allowedKinds: ["shape"], extraSlot: "kept" }],
        events: [{ name: "onClick", description: "Click", payloadShape: { pointer: true }, extraEvent: "kept" }],
        content: { acceptsText: true, acceptsRichText: false, slotNames: ["icon"], extraContent: "kept" },
        extraInventory: "kept"
      }],
      tokens: {
        values: { brand: { primary: "#ffffff" } },
        collections: [{
          id: "collection_brand",
          name: "Brand",
          items: [{
            id: "token_brand_primary",
            path: "brand.primary",
            value: "#ffffff",
            type: "color",
            description: "Brand primary",
            modes: [{ id: "mode_dark", name: "Dark", value: "#000000", extraMode: "kept" }],
            extraItem: "kept"
          }],
          extraCollection: "kept"
        }],
        aliases: [{ path: "brand.primary.alias", targetPath: "brand.primary", modeId: "mode_dark", extraAlias: "kept" }],
        bindings: [{ path: "brand.primary", nodeId: "node_cta", bindingId: "binding_cta", property: "style.color", extraBinding: "kept" }],
        extraTokenMetadata: "kept"
      },
      assets: [],
      viewports: [],
      themes: [],
      bindings: [],
      prototypes: [],
      meta: {
        imports: [{
          id: "import_figma_1",
          source: {
            id: "source_figma_1",
            kind: "figma",
            name: "Figma File",
            sourceDialect: "figma-node",
            frameworkId: "react",
            pluginId: "local-ui-kit",
            adapterIds: ["tsx-react-v1"],
            extraSource: "kept"
          },
          importedAt: "2026-03-14T00:00:00.000Z",
          assetReceipts: [{
            assetId: "asset_remote_1",
            sourceType: "remote",
            url: "https://example.com/asset.png",
            status: "ready",
            extraReceipt: "kept"
          }],
          extraImport: "kept"
        }],
        starter: {
          template: {
            id: "starter_marketing",
            name: "Marketing Starter",
            tags: ["landing"],
            extraTemplate: "kept"
          },
          appliedAt: "2026-03-14T00:00:00.000Z",
          extraStarter: "kept"
        },
        adapterPlugins: [{
          id: "local-ui-kit",
          name: "Local UI Kit",
          frameworks: [{ frameworkId: "react", versions: ["18"], extraFrameworkCompatibility: "kept" }],
          libraries: [{ libraryId: "shadcn", categories: ["components"], extraLibraryCompatibility: "kept" }],
          declaredCapabilities: ["preview", "tokens"],
          grantedCapabilities: [
            { capability: "preview", granted: true, extraGrant: "kept" },
            { capability: "tokens", granted: false, reason: "policy", extraDenial: "kept" }
          ],
          extraPluginDeclaration: "kept"
        }],
        pluginErrors: [{
          pluginId: "local-ui-kit",
          code: "preview_skipped",
          message: "Preview skipped.",
          details: { reason: "policy" }
        }],
        extraMeta: "kept"
      }
    } as unknown as CanvasDocument);

    expect(normalized.componentInventory[0]).toMatchObject({
      id: "inventory_button",
      name: "Button",
      sourceKind: "figma",
      sourceFamily: "framework_component",
      origin: "import",
      framework: { id: "react", label: "React", metadata: { extraFramework: "kept" } },
      adapter: { id: "tsx-react-v1", label: "TSX React", metadata: { extraAdapter: "kept" } },
      plugin: { id: "local-ui-kit", label: "Local UI Kit", metadata: { extraPlugin: "kept" } },
      variants: [expect.objectContaining({ name: "Primary", metadata: { extraVariant: "kept" } })],
      props: [expect.objectContaining({ name: "size", metadata: { extraProp: "kept" } })],
      slots: [expect.objectContaining({ name: "icon", metadata: { extraSlot: "kept" } })],
      events: [expect.objectContaining({ name: "onClick", metadata: { extraEvent: "kept" } })],
      content: expect.objectContaining({ acceptsText: true, slotNames: ["icon"], metadata: { extraContent: "kept" } }),
      metadata: { extraInventory: "kept" }
    });
    expect(normalized.tokens).toMatchObject({
      values: { brand: { primary: "#ffffff" } },
      collections: [expect.objectContaining({ metadata: { extraCollection: "kept" } })],
      aliases: [expect.objectContaining({ metadata: { extraAlias: "kept" } })],
      bindings: [expect.objectContaining({ metadata: { extraBinding: "kept" } })],
      metadata: { extraTokenMetadata: "kept" }
    });
    expect(normalized.meta).toMatchObject({
      imports: [expect.objectContaining({
        source: expect.objectContaining({ label: "Figma File", metadata: { extraSource: "kept" } }),
        assetReceipts: [expect.objectContaining({ metadata: { extraReceipt: "kept" } })],
        metadata: { extraImport: "kept" }
      })],
      starter: expect.objectContaining({
        template: expect.objectContaining({ metadata: { extraTemplate: "kept" } }),
        metadata: { extraStarter: "kept" }
      }),
      adapterPlugins: [expect.objectContaining({
        frameworks: [expect.objectContaining({ metadata: { extraFrameworkCompatibility: "kept" } })],
        libraries: [expect.objectContaining({ metadata: { extraLibraryCompatibility: "kept" } })],
        grantedCapabilities: [
          expect.objectContaining({ capability: "preview", granted: true, metadata: { extraGrant: "kept" } }),
          expect.objectContaining({ capability: "tokens", granted: false, reason: "policy", metadata: { extraDenial: "kept" } })
        ],
        metadata: { extraPluginDeclaration: "kept" }
      })],
      pluginErrors: [expect.objectContaining({ pluginId: "local-ui-kit", code: "preview_skipped", details: { reason: "policy" } })],
      metadata: { extraMeta: "kept" }
    });
  });

  it("migrates legacy raw inventory, token, and meta bags into typed stores", () => {
    const normalized = normalizeCanvasDocument({
      componentInventory: [{ componentName: "LegacyCard", sourceKind: "manual" }],
      tokens: { theme: { primary: "#ffffff" } },
      meta: { legacyImportMarker: true }
    } as unknown as CanvasDocument);

    expect(normalized.componentInventory).toEqual([
      expect.objectContaining({
        name: "LegacyCard",
        componentName: "LegacyCard",
        sourceKind: "manual",
        sourceFamily: "unknown",
        origin: "document"
      })
    ]);
    expect(normalized.tokens).toEqual({
      values: { theme: { primary: "#ffffff" } },
      collections: [],
      aliases: [],
      bindings: [],
      metadata: {}
    });
    expect(normalized.meta).toEqual({
      imports: [],
      starter: null,
      adapterPlugins: [],
      pluginErrors: [],
      metadata: { legacyImportMarker: true }
    });
  });

  it("drops malformed structured contract records while preserving fallback defaults", () => {
    const normalized = normalizeCanvasDocument({
      componentInventory: [
        null,
        {
          id: "inventory_fallbacks",
          framework: {},
          adapter: {},
          plugin: {},
          variants: [null, {}],
          props: [null, {}, { name: "tone", defaultValue: "brand" }],
          slots: [null, {}],
          events: [null, {}],
          content: false
        }
      ],
      tokens: {
        values: { brand: { primary: "#ffffff" } },
        collections: [
          null,
          {
            items: [
              null,
              {},
              {
                path: "brand.primary",
                value: "#ffffff",
                modes: [null, { value: false }]
              }
            ]
          }
        ],
        aliases: [null, {}, { path: "brand.primary.alias", targetPath: "brand.primary" }],
        bindings: [null, {}, { path: "brand.primary" }]
      },
      meta: {
        imports: [
          null,
          { source: null },
          { source: {} },
          {
            source: { kind: "figma" },
            assetReceipts: [null, {}, { id: "asset_receipt_valid", sourceType: "remote" }]
          }
        ],
        starter: {
          template: {}
        },
        adapterPlugins: [
          null,
          {},
          {
            id: "plugin_valid",
            frameworks: [null, {}],
            libraries: [null, {}],
            declaredCapabilities: ["preview", "bogus"],
            grantedCapabilities: [null, { reason: "policy" }]
          }
        ],
        pluginErrors: [
          null,
          {},
          { code: "missing-message" },
          { pluginId: "plugin_valid", code: "preview_skipped", message: "Preview skipped" }
        ]
      }
    } as unknown as CanvasDocument);

    expect(normalized.componentInventory).toEqual([
      expect.objectContaining({
        id: "inventory_fallbacks",
        name: "inventory_fallbacks",
        componentName: "inventory_fallbacks",
        sourceFamily: "unknown",
        origin: "document",
        framework: null,
        adapter: null,
        plugin: null,
        variants: [
          {
            id: "variant_2",
            name: "Variant 2",
            selector: {},
            description: null,
            metadata: {}
          }
        ],
        props: [
          {
            name: "tone",
            type: null,
            required: undefined,
            defaultValue: "brand",
            description: null,
            metadata: {}
          }
        ],
        slots: [
          {
            name: "slot_2",
            description: null,
            allowedKinds: [],
            metadata: {}
          }
        ],
        events: [
          {
            name: "event_2",
            description: null,
            payloadShape: undefined,
            metadata: {}
          }
        ],
        content: {
          acceptsText: false,
          acceptsRichText: false,
          slotNames: [],
          metadata: {}
        },
        metadata: {}
      })
    ]);
    expect(normalized.tokens).toEqual({
      values: { brand: { primary: "#ffffff" } },
      collections: [
        {
          id: "collection_2",
          name: "Collection 2",
          items: [
            {
              id: "token_3",
              path: "brand.primary",
              value: "#ffffff",
              type: null,
              description: null,
              modes: [
                {
                  id: "mode_2",
                  name: "mode_2",
                  value: false,
                  metadata: {}
                }
              ],
              metadata: {}
            }
          ],
          metadata: {}
        }
      ],
      aliases: [
        {
          path: "brand.primary.alias",
          targetPath: "brand.primary",
          modeId: null,
          metadata: {}
        }
      ],
      bindings: [
        {
          path: "brand.primary",
          nodeId: null,
          bindingId: null,
          property: null,
          metadata: {}
        }
      ],
      metadata: {}
    });
    expect(normalized.meta).toEqual({
      imports: [
        {
          id: "import_4",
          source: {
            id: "import_source_4",
            kind: "figma",
            label: null,
            uri: null,
            sourceDialect: null,
            frameworkId: null,
            pluginId: null,
            adapterIds: [],
            metadata: {}
          },
          importedAt: null,
          assetReceipts: [
            {
              assetId: "asset_receipt_valid",
              sourceType: "remote",
              repoPath: null,
              url: null,
              status: null,
              metadata: {}
            }
          ],
          metadata: {}
        }
      ],
      starter: {
        template: null,
        frameworkId: null,
        appliedAt: null,
        metadata: {}
      },
      adapterPlugins: [
        {
          id: "plugin_valid",
          label: null,
          frameworks: [],
          libraries: [],
          declaredCapabilities: ["preview"],
          grantedCapabilities: [
            {
              capability: "preview",
              granted: false,
              reason: "policy",
              metadata: {}
            }
          ],
          metadata: {}
        }
      ],
      pluginErrors: [
        {
          pluginId: "plugin_valid",
          code: "preview_skipped",
          message: "Preview skipped",
          details: {}
        }
      ],
      metadata: {}
    });

    expect(normalizeCanvasDocument({ meta: { starter: false } } as unknown as CanvasDocument).meta.starter).toBeNull();
    expect(normalizeCanvasDocument({
      meta: {
        starter: {
          template: false
        }
      }
    } as unknown as CanvasDocument).meta.starter).toEqual({
      template: null,
      frameworkId: null,
      appliedAt: null,
      metadata: {}
    });
  });

  it("normalizes anonymous inventory descriptors with generated names and empty defaults", () => {
    const normalized = normalizeCanvasDocument({
      componentInventory: [{
        props: [{ name: "title" }],
        slots: [{}],
        events: [{}],
        content: { acceptsText: true }
      }]
    } as unknown as CanvasDocument);

    expect(normalized.componentInventory[0]).toMatchObject({
      id: "inventory_1",
      name: "Component 1",
      componentName: "Component 1",
      props: [expect.objectContaining({ name: "title", defaultValue: undefined })],
      slots: [expect.objectContaining({ name: "slot_1" })],
      events: [expect.objectContaining({ name: "event_1" })]
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

  it("promotes imported nodes with sanitized templates, inferred slots, and declared plugins", () => {
    const document = createDefaultCanvasDocument("dc_promote_imported_inventory");
    const page = document.pages[0];
    const pageId = page?.id;
    const rootNodeId = page?.rootNodeId;
    if (!page || !pageId || !rootNodeId) {
      throw new Error("Expected default canvas page");
    }
    const rootNode = page.nodes.find((node) => node.id === rootNodeId);
    if (!rootNode) {
      throw new Error("Expected default root node");
    }

    page.nodes.push(
      {
        id: "node_imported_card",
        kind: "note",
        name: "Imported Card",
        pageId,
        parentId: rootNodeId,
        childIds: ["node_imported_child"],
        rect: { x: 120, y: 120, width: 320, height: 200 },
        props: {
          title: "Imported hero",
          enabled: true,
          count: 4,
          payload: { depth: 2 },
          choices: ["a", "b"],
          nullable: null,
          richText: { ops: [{ insert: "Rich copy" }] }
        },
        style: { backgroundColor: "#111827" },
        tokenRefs: {},
        bindingRefs: {},
        variantPatches: [
          { selector: { size: "lg" }, changes: { style: { backgroundColor: "#111827" } } },
          { selector: {}, changes: { props: { emphasis: true } } }
        ],
        metadata: {
          importSourceId: "figma://hero-card",
          pluginId: "plugin_declared",
          events: [
            null,
            { event: "submit", description: "Submit", payloadShape: { ok: true }, extraEvent: "kept" }
          ],
          inventory: {
            template: { legacy: true },
            source: "preserve"
          }
        }
      },
      {
        id: "node_imported_child",
        kind: "text",
        name: "Imported Label",
        pageId,
        parentId: "node_imported_card",
        childIds: [],
        rect: { x: 150, y: 168, width: 160, height: 24 },
        props: { text: "Hello" },
        style: {},
        tokenRefs: {},
        bindingRefs: {},
        variantPatches: [],
        metadata: {
          inventory: {
            template: { drop: true }
          }
        }
      }
    );
    rootNode.childIds.push("node_imported_card");
    document.meta.adapterPlugins.push({
      id: "plugin_declared",
      label: "Declared Plugin",
      frameworks: [],
      libraries: [],
      declaredCapabilities: [],
      grantedCapabilities: [],
      version: "1.0.0",
      packageName: "@repo/declared-plugin"
    } as unknown as CanvasDocument["meta"]["adapterPlugins"][number]);

    const store = new CanvasDocumentStore(document);
    store.setGenerationPlan(validPlan);

    store.applyPatches(2, [{
      op: "inventory.promote",
      nodeId: "node_imported_card",
      itemId: "inventory_imported_card",
      metadata: {
        catalogHint: "starter"
      }
    }]);

    const item = store.getDocument().componentInventory.find((entry) => entry.id === "inventory_imported_card");
    expect(item).toMatchObject({
      id: "inventory_imported_card",
      name: "Imported Card",
      componentName: "Imported Card",
      sourceFamily: "design_import",
      origin: "import",
      plugin: {
        id: "plugin_declared",
        label: "Declared Plugin",
        version: "1.0.0",
        packageName: "@repo/declared-plugin"
      },
      content: {
        acceptsText: true,
        acceptsRichText: true,
        slotNames: ["default"]
      },
      metadata: {
        catalogHint: "starter",
        promotedFromNodeId: "node_imported_card",
        template: {
          rootNodeId: "node_imported_card"
        }
      }
    });
    expect(item?.props).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "choices", type: "array" }),
      expect.objectContaining({ name: "count", type: "number" }),
      expect.objectContaining({ name: "enabled", type: "boolean" }),
      expect.objectContaining({ name: "nullable", type: "null" }),
      expect.objectContaining({ name: "payload", type: "object" }),
      expect.objectContaining({ name: "title", type: "string" })
    ]));
    expect(item?.variants).toEqual([
      expect.objectContaining({ name: "size:lg" }),
      expect.objectContaining({ name: "Variant 2" })
    ]);
    expect(item?.slots).toEqual([
      expect.objectContaining({
        name: "default",
        allowedKinds: ["text"],
        metadata: { childCount: 1 }
      })
    ]);
    expect(item?.events).toEqual([
      expect.objectContaining({
        name: "submit",
        description: "Submit",
        payloadShape: { ok: true },
        metadata: { extraEvent: "kept" }
      })
    ]);
    const templateNodes = (item?.metadata.template as { nodes?: Array<{ id: string; metadata: Record<string, unknown> }> }).nodes ?? [];
    expect(templateNodes.find((node) => node.id === "node_imported_card")?.metadata).toEqual({
      importSourceId: "figma://hero-card",
      pluginId: "plugin_declared",
      events: [
        null,
        { event: "submit", description: "Submit", payloadShape: { ok: true }, extraEvent: "kept" }
      ],
      inventory: {
        source: "preserve"
      }
    });
    expect(templateNodes.find((node) => node.id === "node_imported_child")?.metadata).toEqual({});
  });

  it("promotes figma-only imports with valid origin overrides and undeclared plugin fallbacks", () => {
    const document = createDefaultCanvasDocument("dc_promote_figma_inventory");
    const page = document.pages[0];
    const rootNodeId = page?.rootNodeId;
    if (!page || !rootNodeId) {
      throw new Error("Expected default canvas page");
    }
    const rootNode = page.nodes.find((node) => node.id === rootNodeId);
    if (!rootNode) {
      throw new Error("Expected default root node");
    }

    page.nodes.push({
      id: "node_figma_badge",
      kind: "component-instance",
      name: "Figma Badge",
      pageId: page.id,
      parentId: rootNodeId,
      childIds: [],
      rect: { x: 96, y: 96, width: 240, height: 96 },
      props: { label: "Beta" },
      style: { backgroundColor: "#111827" },
      tokenRefs: {},
      bindingRefs: {},
      variantPatches: [],
      metadata: {
        figmaNodeId: "1:2",
        pluginId: "plugin_ghost",
        events: [
          { description: "Implicit analytics event", payloadShape: "ignored" }
        ]
      }
    });
    rootNode.childIds.push("node_figma_badge");

    const store = new CanvasDocumentStore(document);
    store.setGenerationPlan(validPlan);

    store.applyPatches(2, [{
      op: "inventory.promote",
      nodeId: "node_figma_badge",
      itemId: "inventory_figma_badge",
      origin: "starter"
    }]);

    const item = store.getDocument().componentInventory.find((entry) => entry.id === "inventory_figma_badge");
    expect(item).toMatchObject({
      id: "inventory_figma_badge",
      sourceFamily: "design_import",
      origin: "starter",
      plugin: {
        id: "plugin_ghost",
        label: "plugin_ghost",
        metadata: {}
      }
    });
    expect(item?.events).toEqual([
      expect.objectContaining({
        name: "event_1",
        description: "Implicit analytics event",
        metadata: {}
      })
    ]);
  });

  it("promotes code-sync nodes with explicit binding metadata and replaces existing inventory entries", () => {
    const document = createDefaultCanvasDocument("dc_promote_code_sync_inventory");
    const page = document.pages[0];
    const rootNodeId = page?.rootNodeId;
    if (!page || !rootNodeId) {
      throw new Error("Expected default canvas page");
    }
    const rootNode = page.nodes.find((node) => node.id === rootNodeId);
    if (!rootNode) {
      throw new Error("Expected default root node");
    }

    rootNode.name = "Explicit Hero";
    rootNode.props = { title: "Hero title" };
    rootNode.variantPatches = [{ selector: {}, changes: { props: { emphasis: true } } }];
    rootNode.metadata = {
      sourceKind: "bound_component"
    };
    rootNode.bindingRefs.primary = "binding_explicit_inventory";
    document.bindings.push({
      id: "binding_explicit_inventory",
      nodeId: rootNodeId,
      kind: "code-sync",
      componentName: "ExplicitHero",
      metadata: {
        framework: {
          frameworkId: "nextjs",
          name: "Next.js",
          packageName: "next",
          adapter: { adapterId: "tsx-react-v1", name: "TSX React v1" },
          source: "explicit"
        },
        adapter: {
          adapterId: "tsx-react-v1",
          name: "TSX React v1",
          version: "2.0.0",
          packageName: "@opendevbrowser/tsx-react-v1",
          source: "binding"
        },
        plugin: {
          pluginId: "plugin_explicit",
          name: "Explicit Plugin",
          version: "3.1.0",
          packageName: "@repo/explicit-plugin",
          source: "binding"
        },
        events: [
          null,
          { name: "onSave", description: "Save", payloadShape: { draft: true }, extraEvent: "kept" }
        ]
      },
      codeSync: {
        adapter: "tsx-react-v1",
        repoPath: "src/ExplicitHero.tsx",
        exportName: "ExplicitHero",
        syncMode: "manual",
        ownership: {
          structure: "shared",
          text: "shared",
          style: "shared",
          tokens: "shared",
          behavior: "code",
          data: "code"
        }
      }
    });

    const store = new CanvasDocumentStore(document);
    store.setGenerationPlan(validPlan);

    store.applyPatches(2, [{
      op: "inventory.promote",
      nodeId: rootNodeId,
      itemId: "inventory_explicit_hero",
      origin: "invalid-origin" as never,
      metadata: "ignored" as never
    }]);
    store.applyPatches(3, [{
      op: "inventory.promote",
      nodeId: rootNodeId,
      itemId: "inventory_explicit_hero",
      name: "Explicit Hero Updated",
      metadata: {
        tags: ["updated"]
      }
    }]);

    const item = store.getDocument().componentInventory.find((entry) => entry.id === "inventory_explicit_hero");
    expect(item).toMatchObject({
      id: "inventory_explicit_hero",
      name: "Explicit Hero Updated",
      componentName: "ExplicitHero",
      sourceKind: "bound_component",
      sourceFamily: "framework_component",
      origin: "code_sync",
      framework: {
        id: "nextjs",
        label: "Next.js",
        packageName: "next",
        adapter: {
          id: "tsx-react-v1",
          label: "TSX React v1"
        },
        metadata: { source: "explicit" }
      },
      adapter: {
        id: "tsx-react-v1",
        label: "TSX React v1",
        version: "2.0.0",
        packageName: "@opendevbrowser/tsx-react-v1",
        metadata: { source: "binding" }
      },
      plugin: {
        id: "plugin_explicit",
        label: "Explicit Plugin",
        version: "3.1.0",
        packageName: "@repo/explicit-plugin",
        metadata: { source: "binding" }
      },
      variants: [expect.objectContaining({ name: "Variant 1" })],
      events: [
        expect.objectContaining({
          name: "onSave",
          description: "Save",
          payloadShape: { draft: true },
          metadata: { extraEvent: "kept" }
        })
      ],
      metadata: {
        tags: ["updated"]
      }
    });
  });

  it("promotes bindings discovered by node fallback with node-level plugins and default projection metadata", () => {
    const document = createDefaultCanvasDocument("dc_promote_binding_fallback_inventory");
    const page = document.pages[0];
    const rootNodeId = page?.rootNodeId;
    if (!page || !rootNodeId) {
      throw new Error("Expected default canvas page");
    }
    const rootNode = page.nodes.find((node) => node.id === rootNodeId);
    if (!rootNode) {
      throw new Error("Expected default root node");
    }

    page.nodes.push({
      id: "node_binding_fallback",
      kind: "component-instance",
      name: "Binding Fallback Card",
      pageId: page.id,
      parentId: rootNodeId,
      childIds: [],
      rect: { x: 144, y: 144, width: 280, height: 160 },
      props: {
        title: "Fallback bound"
      },
      style: {},
      tokenRefs: {},
      bindingRefs: {},
      variantPatches: [],
      metadata: {
        plugin: {
          pluginId: "plugin_node",
          name: "Node Plugin",
          version: "0.4.0",
          packageName: "@repo/node-plugin",
          source: "node"
        }
      }
    });
    rootNode.childIds.push("node_binding_fallback");
    document.bindings.push({
      id: "binding_fallback",
      nodeId: "node_binding_fallback",
      kind: "code-sync",
      componentName: "BindingFallbackCard",
      metadata: {
        events: [{ name: "submit" }]
      },
      codeSync: {
        adapter: "tsx-react-v1",
        repoPath: "src/BindingFallbackCard.tsx",
        exportName: "BindingFallbackCard",
        syncMode: "manual",
        ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP }
      }
    });

    const store = new CanvasDocumentStore(document);
    store.setGenerationPlan(validPlan);

    store.applyPatches(2, [{
      op: "inventory.promote",
      nodeId: "node_binding_fallback"
    }]);

    const item = store.getDocument().componentInventory[0];
    expect(item?.id).toMatch(/^inventory_/);
    expect(item).toMatchObject({
      componentName: "BindingFallbackCard",
      sourceFamily: "framework_component",
      origin: "code_sync",
      framework: {
        id: "react-tsx",
        label: "React TSX",
        packageName: "react"
      },
      adapter: {
        id: "tsx-react-v1",
        metadata: {
          repoPath: "src/BindingFallbackCard.tsx",
          syncMode: "manual",
          projection: "canvas_html"
        }
      },
      plugin: {
        id: "plugin_node",
        label: "Node Plugin",
        version: "0.4.0",
        packageName: "@repo/node-plugin",
        metadata: {
          source: "node"
        }
      }
    });
    expect(item?.props).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "title", type: "string" })
    ]));
  });

  it("falls back to imported origin for figma-only promotions when the requested origin is invalid", () => {
    const document = createDefaultCanvasDocument("dc_promote_figma_origin_fallback");
    const page = document.pages[0];
    const rootNodeId = page?.rootNodeId;
    if (!page || !rootNodeId) {
      throw new Error("Expected default canvas page");
    }
    const rootNode = page.nodes.find((node) => node.id === rootNodeId);
    if (!rootNode) {
      throw new Error("Expected default root node");
    }

    page.nodes.push({
      id: "node_figma_origin_fallback",
      kind: "component-instance",
      name: "Imported Badge",
      pageId: page.id,
      parentId: rootNodeId,
      childIds: [],
      rect: { x: 96, y: 96, width: 180, height: 72 },
      props: {
        label: "Imported"
      },
      style: {},
      tokenRefs: {},
      bindingRefs: {},
      variantPatches: [],
      metadata: {
        figmaNodeId: "42:7"
      }
    });
    rootNode.childIds.push("node_figma_origin_fallback");

    const store = new CanvasDocumentStore(document);
    store.setGenerationPlan(validPlan);

    store.applyPatches(2, [{
      op: "inventory.promote",
      nodeId: "node_figma_origin_fallback",
      origin: "unsupported-origin" as never
    }]);

    expect(store.getDocument().componentInventory[0]).toMatchObject({
      name: "Imported Badge",
      sourceFamily: "design_import",
      origin: "import"
    });
  });

  it("rejects inventory updates for missing items", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_missing_inventory_update"));
    store.setGenerationPlan(validPlan);

    expect(() => store.applyPatches(2, [{
      op: "inventory.update",
      itemId: "inventory_missing",
      changes: {
        description: "Nope"
      }
    }])).toThrow("Unknown inventory item: inventory_missing");
  });

  it("merges starter token stores, upserts inventory items, and persists applied starter metadata", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_starter_patch_support"));
    store.setGenerationPlan(validPlan);

    const result = store.applyPatches(2, [
      {
        op: "tokens.merge",
        tokens: {
          values: {
            surface: {
              starter: "#0f172a"
            }
          },
          collections: [{
            id: "kit.dashboard.analytics-core.tokens",
            name: "Analytics Core Tokens",
            items: [{
              id: "surface-card",
              path: "surface.card",
              value: "#111827",
              type: "color",
              description: null,
              modes: [],
              metadata: {}
            }],
            metadata: {}
          }],
          metadata: {
            starterKitIds: ["dashboard.analytics-core"]
          }
        }
      },
      {
        op: "inventory.upsert",
        item: {
          id: "kit.dashboard.analytics-core.metric-card",
          name: "Analytics Metric Card",
          componentName: "AnalyticsMetricCard",
          sourceKind: "built-in-kit",
          sourceFamily: "starter_template",
          origin: "starter",
          framework: {
            id: "nextjs",
            label: "Next.js",
            packageName: "next",
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
            catalog: {
              kitId: "dashboard.analytics-core"
            }
          }
        }
      },
      {
        op: "starter.apply",
        starter: {
          template: {
            id: "dashboard.analytics",
            name: "Analytics Dashboard",
            description: "Starter for KPI dashboards.",
            tags: ["dashboard", "analytics"],
            defaultFrameworkId: "react",
            compatibleFrameworkIds: ["react", "nextjs", "remix"],
            kitIds: ["dashboard.analytics-core"],
            metadata: {}
          },
          frameworkId: "nextjs",
          appliedAt: "2026-03-15T00:00:00.000Z",
          metadata: {
            degraded: false
          }
        }
      }
    ]);

    expect(result.appliedRevision).toBe(3);
    expect(store.getDocument().tokens).toMatchObject({
      values: {
        surface: {
          starter: "#0f172a"
        }
      },
      collections: [
        expect.objectContaining({
          id: "kit.dashboard.analytics-core.tokens",
          items: [expect.objectContaining({ path: "surface.card", value: "#111827" })]
        })
      ],
      metadata: {
        starterKitIds: ["dashboard.analytics-core"]
      }
    });
    expect(store.getDocument().componentInventory).toEqual([
      expect.objectContaining({
        id: "kit.dashboard.analytics-core.metric-card",
        framework: expect.objectContaining({ id: "nextjs" })
      })
    ]);
    expect(store.getDocument().meta.starter).toEqual(expect.objectContaining({
      template: expect.objectContaining({
        id: "dashboard.analytics",
        compatibleFrameworkIds: ["react", "nextjs", "remix"],
        kitIds: ["dashboard.analytics-core"]
      }),
      frameworkId: "nextjs",
      appliedAt: "2026-03-15T00:00:00.000Z",
      metadata: {
        degraded: false
      }
    }));
  });

  it("merges token aliases and bindings recursively while replacing inventory upserts by id", () => {
    const document = createDefaultCanvasDocument("dc_token_merge");
    document.tokens = {
      values: {
        surface: {
          card: "#111827"
        },
        nested: {
          depth: {
            base: 1
          }
        }
      },
      collections: [{
        id: "collection_existing",
        name: "Existing Collection",
        items: [],
        metadata: {}
      }],
      aliases: [{
        path: "surface.card",
        targetPath: "surface.base",
        modeId: null,
        metadata: {
          source: "original"
        }
      }],
      bindings: [{
        path: "surface.card",
        nodeId: "node_existing",
        property: "backgroundColor",
        bindingId: "binding_existing",
        metadata: {
          source: "original"
        }
      }],
      metadata: {
        existing: {
          enabled: true
        }
      }
    };
    document.componentInventory.push({
      id: "inventory_existing",
      name: "Existing Inventory Item",
      componentName: "ExistingInventoryItem",
      description: "Original inventory entry",
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
      metadata: {
        original: true
      }
    });

    const store = new CanvasDocumentStore(document);
    store.setGenerationPlan(validPlan);

    const result = store.applyPatches(2, [
      {
        op: "tokens.merge",
        tokens: {
          values: {
            nested: {
              depth: {
                accent: 2
              }
            }
          },
          aliases: [
            {
              path: "surface.card",
              targetPath: "surface.emphasis",
              modeId: null,
              metadata: {
                source: "merged"
              }
            },
            {
              path: "surface.card",
              targetPath: "surface.dark",
              modeId: "dark",
              metadata: {}
            }
          ],
          bindings: [
            {
              path: "surface.card",
              nodeId: "node_existing",
              property: "backgroundColor",
              bindingId: "binding_existing",
              metadata: {
                source: "merged"
              }
            },
            {
              path: "surface.card",
              nodeId: "node_new",
              property: "color",
              bindingId: "binding_new",
              metadata: {}
            }
          ],
          metadata: {
            existing: {
              updated: true
            },
            merged: true
          }
        }
      },
      {
        op: "inventory.upsert",
        item: {
          id: "inventory_existing",
          name: "Existing Inventory Item Updated",
          componentName: "ExistingInventoryItem",
          description: "Updated inventory entry",
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
            acceptsText: true,
            acceptsRichText: false,
            slotNames: [],
            metadata: {}
          },
          metadata: {
            updated: true
          }
        }
      }
    ]);

    expect(result.appliedRevision).toBe(3);
    expect(store.getDocument().tokens).toMatchObject({
      values: {
        surface: {
          card: "#111827"
        },
        nested: {
          depth: {
            base: 1,
            accent: 2
          }
        }
      },
      aliases: expect.arrayContaining([
        expect.objectContaining({
          path: "surface.card",
          targetPath: "surface.emphasis",
          metadata: {
            source: "merged"
          }
        }),
        expect.objectContaining({
          path: "surface.card",
          targetPath: "surface.dark",
          modeId: "dark"
        })
      ]),
      bindings: expect.arrayContaining([
        expect.objectContaining({
          path: "surface.card",
          nodeId: "node_existing",
          bindingId: "binding_existing",
          metadata: {
            source: "merged"
          }
        }),
        expect.objectContaining({
          path: "surface.card",
          nodeId: "node_new",
          bindingId: "binding_new"
        })
      ]),
      metadata: {
        existing: {
          enabled: true,
          updated: true
        },
        merged: true
      }
    });
    expect(store.getDocument().tokens.aliases).toHaveLength(2);
    expect(store.getDocument().tokens.bindings).toHaveLength(2);
    expect(store.getDocument().componentInventory).toEqual([
      expect.objectContaining({
        id: "inventory_existing",
        name: "Existing Inventory Item Updated",
        description: "Updated inventory entry",
        origin: "starter",
        sourceFamily: "starter_template",
        content: expect.objectContaining({
          acceptsText: true
        }),
        metadata: {
          updated: true
        }
      })
    ]);
  });

  it("deduplicates sparse token bindings by fallback key fields and rejects invalid inventory upserts", () => {
    const document = createDefaultCanvasDocument("dc_sparse_token_bindings");
    document.tokens.bindings = [{
      path: "surface.card",
      metadata: {
        source: "original"
      }
    } as CanvasDocument["tokens"]["bindings"][number]];

    const store = new CanvasDocumentStore(document);
    store.setGenerationPlan(validPlan);

    store.applyPatches(2, [{
      op: "tokens.merge",
      tokens: {
        bindings: [{
          path: "surface.card",
          metadata: {
            source: "merged"
          }
        } as CanvasDocument["tokens"]["bindings"][number]]
      }
    }]);

    expect(store.getDocument().tokens.bindings).toEqual([
      expect.objectContaining({
        path: "surface.card",
        metadata: {
          source: "merged"
        }
      })
    ]);

    expect(() => store.applyPatches(3, [{
      op: "inventory.upsert",
      item: null as never
    }])).toThrow("Invalid inventory item for inventory.upsert");
  });

  it("promotes imported and code-sync nodes with plugin, type, and metadata inference", () => {
    const document = createDefaultCanvasDocument("dc_inventory_inference");
    const page = document.pages[0];
    const rootNodeId = page?.rootNodeId;
    if (!page || !rootNodeId) {
      throw new Error("Expected default page root");
    }

    const rootNode = page.nodes.find((node) => node.id === rootNodeId);
    if (!rootNode) {
      throw new Error("Expected root node");
    }

    rootNode.childIds.push("node_imported", "node_code_sync");
    page.nodes.push(
      {
        id: "node_imported",
        kind: "frame",
        name: "Imported Card",
        pageId: page.id,
        parentId: rootNodeId,
        childIds: ["node_imported_copy"],
        rect: { x: 120, y: 120, width: 320, height: 180 },
        props: {
          enabled: true,
          count: 3,
          title: "Imported",
          config: { mode: "full" },
          nullable: null
        },
        style: {},
        tokenRefs: {},
        bindingRefs: {},
        variantPatches: [],
        metadata: {
          importSourceId: "figma_import_1",
          pluginId: "local-plugin",
          inventory: {
            template: {
              remove: true
            }
          },
          events: [{
            event: "submit",
            payloadShape: {
              ok: true
            }
          }]
        }
      },
      {
        id: "node_imported_copy",
        kind: "text",
        name: "Imported Copy",
        pageId: page.id,
        parentId: "node_imported",
        childIds: [],
        rect: { x: 144, y: 160, width: 180, height: 24 },
        props: {
          text: "Hello"
        },
        style: {},
        tokenRefs: {},
        bindingRefs: {},
        variantPatches: [],
        metadata: {}
      },
      {
        id: "node_code_sync",
        kind: "component-instance",
        name: "Bound Card",
        pageId: page.id,
        parentId: rootNodeId,
        childIds: [],
        rect: { x: 480, y: 120, width: 280, height: 160 },
        props: {
          label: "Bound"
        },
        style: {},
        tokenRefs: {},
        bindingRefs: {},
        variantPatches: [],
        metadata: {}
      }
    );
    document.bindings.push({
      id: "binding_bound_card",
      nodeId: "node_code_sync",
      kind: "code-sync",
      componentName: "BoundCard",
      metadata: {
        events: [{
          name: "open"
        }]
      },
      codeSync: {
        adapter: "tsx-react-v1",
        repoPath: "src/BoundCard.tsx",
        exportName: "BoundCard",
        syncMode: "manual",
        ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP }
      }
    });
    document.meta.adapterPlugins.push({
      id: "local-plugin",
      label: "Local Plugin",
      frameworks: [],
      libraries: [],
      declaredCapabilities: [],
      grantedCapabilities: [],
      metadata: {
        version: "1.2.3",
        packageName: "@repo/local-plugin"
      }
    });

    const store = new CanvasDocumentStore(document);
    store.setGenerationPlan(validPlan);

    const result = store.applyPatches(2, [
      {
        op: "inventory.promote",
        nodeId: "node_imported",
        itemId: "inventory_imported"
      },
      {
        op: "inventory.promote",
        nodeId: "node_code_sync",
        itemId: "inventory_bound"
      }
    ]);

    expect(result.appliedRevision).toBe(3);
    expect(store.getDocument().componentInventory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "inventory_imported",
        sourceFamily: "design_import",
        origin: "import",
        plugin: expect.objectContaining({
          id: "local-plugin",
          label: "Local Plugin",
          version: "1.2.3",
          packageName: "@repo/local-plugin"
        }),
        props: expect.arrayContaining([
          expect.objectContaining({ name: "enabled", type: "boolean" }),
          expect.objectContaining({ name: "count", type: "number" }),
          expect.objectContaining({ name: "title", type: "string" }),
          expect.objectContaining({ name: "config", type: "object" }),
          expect.objectContaining({ name: "nullable", type: "null" })
        ]),
        events: [
          expect.objectContaining({
            name: "submit"
          })
        ],
        metadata: expect.objectContaining({
          template: expect.objectContaining({
            rootNodeId: "node_imported"
          })
        })
      }),
      expect.objectContaining({
        id: "inventory_bound",
        sourceFamily: "framework_component",
        origin: "code_sync",
        framework: expect.objectContaining({
          id: "react-tsx",
          label: "React TSX",
          packageName: "react"
        }),
        adapter: expect.objectContaining({
          id: "tsx-react-v1",
          metadata: expect.objectContaining({
            repoPath: "src/BoundCard.tsx",
            syncMode: "manual",
            projection: "canvas_html"
          })
        }),
        events: [
          expect.objectContaining({
            name: "open"
          })
        ]
      })
    ]));

    const imported = store.getDocument().componentInventory.find((item) => item.id === "inventory_imported");
    expect(imported?.metadata.template).toMatchObject({
      rootNodeId: "node_imported"
    });
    const importedTemplateNodes = (imported?.metadata.template as { nodes?: Array<{ metadata?: Record<string, unknown> }> }).nodes ?? [];
    expect(importedTemplateNodes[0]?.metadata).not.toHaveProperty("inventory");
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

  it("supports editor node hierarchy, duplication, and visibility mutations", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_editor_ops"));
    const homeRootId = store.getDocument().pages[0]?.rootNodeId as string;
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    store.applyPatches(2, [
      {
        op: "node.insert",
        pageId: "page_home",
        parentId: homeRootId,
        node: {
          id: "node_frame",
          kind: "frame",
          name: "Frame",
          props: {},
          style: { backgroundColor: "#07111d" }
        }
      },
      {
        op: "node.insert",
        pageId: "page_home",
        parentId: homeRootId,
        node: {
          id: "node_sidebar",
          kind: "frame",
          name: "Sidebar",
          props: {},
          style: { backgroundColor: "#111827" }
        }
      },
      {
        op: "node.insert",
        pageId: "page_home",
        parentId: "node_frame",
        node: {
          id: "node_copy",
          kind: "text",
          name: "Copy",
          props: { text: "Governed canvas" },
          style: { color: "#f8fafc" },
          tokenRefs: { color: "tokens.theme.primary" },
          bindingRefs: { primary: "binding_copy" },
          metadata: {
            codeSync: {
              repoPath: "src/app.tsx",
              selector: "#hero-copy"
            }
          }
        }
      }
    ]);

    const result = store.applyPatches(3, [
      {
        op: "node.reparent",
        nodeId: "node_sidebar",
        parentId: "node_frame",
        index: 1
      },
      {
        op: "node.reorder",
        nodeId: "node_sidebar",
        index: 0
      },
      {
        op: "node.duplicate",
        nodeId: "node_frame",
        parentId: homeRootId,
        index: 1,
        idMap: {
          node_frame: "node_frame_copy",
          node_sidebar: "node_sidebar_copy",
          node_copy: "node_copy_clone"
        }
      },
      {
        op: "node.visibility.set",
        nodeId: "node_copy",
        hidden: true
      }
    ]);

    expect(result.appliedRevision).toBe(4);

    const page = store.getDocument().pages.find((entry) => entry.id === "page_home");
    expect(page).toBeTruthy();

    const frame = page?.nodes.find((entry) => entry.id === "node_frame");
    const sidebar = page?.nodes.find((entry) => entry.id === "node_sidebar");
    const copy = page?.nodes.find((entry) => entry.id === "node_copy");
    const frameCopy = page?.nodes.find((entry) => entry.id === "node_frame_copy");
    const sidebarCopy = page?.nodes.find((entry) => entry.id === "node_sidebar_copy");
    const copyClone = page?.nodes.find((entry) => entry.id === "node_copy_clone");

    expect(frame?.childIds).toEqual(["node_sidebar", "node_copy"]);
    expect(sidebar).toMatchObject({
      parentId: "node_frame",
      pageId: "page_home"
    });
    expect(copy?.metadata.visibility).toEqual({ hidden: true });

    expect(frameCopy).toMatchObject({
      name: "Frame Copy",
      parentId: homeRootId,
      childIds: ["node_sidebar_copy", "node_copy_clone"]
    });
    expect(sidebarCopy).toMatchObject({
      name: "Sidebar Copy",
      parentId: "node_frame_copy"
    });
    expect(copyClone).toMatchObject({
      name: "Copy Copy",
      parentId: "node_frame_copy",
      bindingRefs: {},
      tokenRefs: { color: "tokens.theme.primary" }
    });
    expect(copyClone?.metadata.codeSync).toBeUndefined();
  });

  it("guards hierarchy edge cases and mergeImportedCanvasState fallback branches", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_hierarchy_edges"));
    const pageId = store.getDocument().pages[0]?.id as string;
    const rootNodeId = store.getDocument().pages[0]?.rootNodeId as string;
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    const seeded = store.applyPatches(2, [
      {
        op: "node.insert",
        pageId,
        parentId: rootNodeId,
        node: {
          id: "node_parent",
          kind: "frame",
          name: "Parent"
        }
      },
      {
        op: "node.insert",
        pageId,
        parentId: "node_parent",
        node: {
          id: "node_child",
          kind: "text",
          name: "Child"
        }
      }
    ]);

    expect(() => store.applyPatches(seeded.appliedRevision, [{
      op: "node.reparent",
      nodeId: "node_parent",
      parentId: "node_parent"
    }])).toThrow("Cannot reparent node into itself: node_parent");
    expect(() => store.applyPatches(seeded.appliedRevision, [{
      op: "node.reparent",
      nodeId: "node_parent",
      parentId: "node_child"
    }])).toThrow("Cannot reparent node into its own descendant: node_parent");
    expect(() => store.applyPatches(seeded.appliedRevision, [{
      op: "node.reparent",
      nodeId: "node_child",
      parentId: "node_missing"
    }])).toThrow("Unknown parent node: node_missing");
    expect(() => store.applyPatches(seeded.appliedRevision, [{
      op: "node.reorder",
      nodeId: rootNodeId,
      index: 1
    }])).toThrow("Root node can only exist at index 0.");

    const noOpRootReorder = store.applyPatches(seeded.appliedRevision, [{
      op: "node.reorder",
      nodeId: rootNodeId,
      index: 0
    }]);
    expect(noOpRootReorder.appliedRevision).toBe(seeded.appliedRevision + 1);

    expect(() => store.applyPatches(noOpRootReorder.appliedRevision, [{
      op: "node.duplicate",
      nodeId: "node_parent",
      parentId: "node_parent"
    }])).toThrow("Cannot duplicate node into itself: node_parent");
    expect(() => store.applyPatches(noOpRootReorder.appliedRevision, [{
      op: "node.duplicate",
      nodeId: "node_parent",
      parentId: "node_child"
    }])).toThrow("Cannot duplicate node into its own descendant: node_parent");

    const inconsistentDocument = createDefaultCanvasDocument("dc_hierarchy_detached");
    const inconsistentRootId = inconsistentDocument.pages[0]?.rootNodeId as string;
    inconsistentDocument.pages[0]?.nodes.push({
      id: "node_detached_child",
      kind: "text",
      name: "Detached",
      pageId: inconsistentDocument.pages[0]?.id as string,
      parentId: inconsistentRootId,
      childIds: [],
      rect: { x: 0, y: 0, width: 100, height: 40 },
      props: {},
      style: {},
      tokenRefs: {},
      bindingRefs: {},
      variantPatches: [],
      metadata: {}
    });
    const inconsistentStore = new CanvasDocumentStore(inconsistentDocument);
    inconsistentStore.setGenerationPlan(validPlan as CanvasGenerationPlan);
    expect(() => inconsistentStore.applyPatches(2, [{
      op: "node.reorder",
      nodeId: "node_detached_child",
      index: 0
    }])).toThrow("Node is not attached to its parent: node_detached_child");

    const importedPage = {
      id: "page_imported",
      name: "Imported",
      path: "/imported",
      rootNodeId: null,
      prototypeIds: [],
      nodes: [],
      metadata: {}
    };
    const provenance = {
      id: "import_figma_1",
      source: {
        id: "figma:file",
        kind: "figma.file",
        label: "Figma File",
        uri: "https://www.figma.com/file/abc",
        sourceDialect: "figma-rest",
        frameworkId: null,
        pluginId: null,
        adapterIds: [],
        metadata: {}
      },
      importedAt: "2026-03-15T12:00:00.000Z",
      assetReceipts: [],
      metadata: {}
    };
    const current = createDefaultCanvasDocument("dc_merge_import");

    const appended = mergeImportedCanvasState(current, {
      mode: "append_pages",
      pages: [importedPage],
      componentInventory: [{
        id: "inventory_imported_card",
        name: "Imported Card",
        componentName: "ImportedCard",
        sourceFamily: "design_import",
        sourceKind: "figma_component",
        origin: "import",
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
      }, {} as never],
      tokens: {
        values: { "colors/brand": "#111827" },
        collections: [{
          id: "collection_imported",
          name: "Imported",
          items: [{
            id: "token_brand",
            path: "colors/brand",
            value: "#111827",
            type: "color",
            description: null,
            modes: [],
            metadata: {}
          }],
          metadata: {}
        }],
        aliases: [],
        bindings: [],
        metadata: {}
      },
      assets: [{
        id: "asset_imported",
        sourceType: "remote",
        kind: "image",
        repoPath: ".opendevbrowser/canvas/assets/imported.png",
        url: "https://cdn.example.com/imported.png",
        status: "cached",
        variants: [],
        metadata: {}
      }],
      provenance
    });
    expect(appended.pages.map((page) => page.id)).toContain("page_imported");
    expect(appended.componentInventory.map((item) => item.id)).toContain("inventory_imported_card");
    expect(appended.tokens.values).toMatchObject({ "colors/brand": "#111827" });
    expect(appended.assets.map((asset) => asset.id)).toContain("asset_imported");
    expect(appended.meta.imports.map((entry) => entry.id)).toContain("import_figma_1");

    const replacedExisting = mergeImportedCanvasState(appended, {
      mode: "replace_current_page",
      targetPageId: "page_home",
      pages: [{ ...importedPage, id: "page_replaced", name: "Replaced", path: "/replaced" }],
      componentInventory: [],
      provenance: {
        ...provenance,
        id: "import_figma_2"
      }
    });
    expect(replacedExisting.pages[0]?.id).toBe("page_replaced");

    const replacedMissing = mergeImportedCanvasState(appended, {
      mode: "replace_current_page",
      targetPageId: "page_missing",
      pages: [{ ...importedPage, id: "page_fallback", name: "Fallback", path: "/fallback" }],
      componentInventory: [],
      provenance: {
        ...provenance,
        id: "import_figma_3"
      }
    });
    expect(replacedMissing.pages.map((page) => page.id)).toContain("page_fallback");

    const replaceNoPages = mergeImportedCanvasState(appended, {
      mode: "replace_current_page",
      pages: [],
      componentInventory: [],
      provenance: {
        ...provenance,
        id: "import_figma_4"
      }
    });
    expect(replaceNoPages.pages).toHaveLength(appended.pages.length);
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

  it("marks malformed persisted generation plans invalid and blocks save", () => {
    const document = createDefaultCanvasDocument("dc_invalid_plan");
    document.designGovernance.generationPlan = {
      targetOutcome: { mode: "draft", summary: "Invalid plan" }
    } as unknown as CanvasDocument["designGovernance"]["generationPlan"];
    document.designGovernance.intent = { summary: "Governed invalid-plan document" };
    document.designGovernance.designLanguage = { profile: "clean-room" };
    document.designGovernance.contentModel = { requiredStates: ["default", "loading", "empty", "error"] };
    document.designGovernance.layoutSystem = { grid: { columns: 12 } };
    document.designGovernance.typographySystem = { hierarchy: { display: "display-01" }, fontPolicy: "Local Sans" };
    document.designGovernance.colorSystem = { roles: { primary: "#0055ff" } };
    document.designGovernance.surfaceSystem = { panels: { elevation: "medium" } };
    document.designGovernance.iconSystem = { primary: "tabler" };
    document.designGovernance.motionSystem = { reducedMotion: "respect-user-preference" };
    document.designGovernance.responsiveSystem = { breakpoints: { mobile: 390, tablet: 1024, desktop: 1440 } };
    document.designGovernance.accessibilityPolicy = { reducedMotion: "respect-user-preference" };
    document.designGovernance.libraryPolicy = structuredClone(CANVAS_PROJECT_DEFAULTS.libraryPolicy);
    document.designGovernance.runtimeBudgets = structuredClone(CANVAS_PROJECT_DEFAULTS.runtimeBudgets);
    document.viewports = [{ id: "desktop" }, { id: "tablet" }, { id: "mobile" }] as CanvasDocument["viewports"];
    document.themes = [{ id: "light" }] as CanvasDocument["themes"];

    expect(buildGovernanceBlockStates(document).generationPlan.status).toBe("invalid");
    expect(missingRequiredSaveBlocks(document)).toContain("generationPlan");

    const validation = validateCanvasSave(document);
    expect(validation.missingBlocks).toContain("generationPlan");
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "invalid-generation-plan",
        details: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ path: "targetOutcome.mode", code: "invalid_value" })
          ])
        })
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
    document.tokens = {
      values: { theme: { primary: "#ffffff" } },
      collections: [],
      aliases: [],
      bindings: [],
      metadata: {}
    };
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

  it("emits specific missing warning codes for empty required governance blocks", () => {
    const document = createDefaultCanvasDocument("dc_missing_warning_codes");
    document.designGovernance.contentModel = { requiredStates: ["default", "loading", "empty", "error"] };
    document.designGovernance.layoutSystem = { grid: { columns: 12 } };
    document.designGovernance.colorSystem = { roles: { primary: "#0055ff" } };
    document.designGovernance.surfaceSystem = { panels: { elevation: "medium" } };
    document.designGovernance.iconSystem = { primary: "tabler" };
    document.designGovernance.motionSystem = { reducedMotion: "respect-user-preference" };
    document.designGovernance.responsiveSystem = { breakpoints: { mobile: 390, tablet: 1024, desktop: 1440 } };
    document.designGovernance.accessibilityPolicy = { reducedMotion: "respect-user-preference" };

    const warnings = evaluateCanvasWarnings(document, { forSave: true });
    const codes = warnings.map((warning) => warning.code);

    expect(codes).toEqual(expect.arrayContaining([
      "missing-generation-plan",
      "missing-intent",
      "missing-design-language",
      "missing-typography-system"
    ]));

    const validation = validateCanvasSave(document);
    expect(validation.missingBlocks).toEqual([
      "intent",
      "generationPlan",
      "designLanguage",
      "typographySystem"
    ]);
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-generation-plan" }),
      expect.objectContaining({ code: "missing-intent" }),
      expect.objectContaining({ code: "missing-design-language" }),
      expect.objectContaining({ code: "missing-typography-system" })
    ]));
  });

  it("keeps root placement stable during root reparenting and rejects duplicate roots", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_root_reparent_duplicate"));
    const pageId = store.getDocument().pages[0]?.id as string;
    const rootNodeId = store.getDocument().pages[0]?.rootNodeId as string;
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    const seeded = store.applyPatches(2, [
      {
        op: "node.insert",
        pageId,
        parentId: rootNodeId,
        node: {
          id: "node_parent",
          kind: "frame",
          name: "Parent"
        }
      },
      {
        op: "node.insert",
        pageId,
        parentId: "node_parent",
        node: {
          id: "node_child",
          kind: "text",
          name: "Child"
        }
      }
    ]);

    const reparented = store.applyPatches(seeded.appliedRevision, [{
      op: "node.reparent",
      nodeId: rootNodeId,
      parentId: null
    }]);
    expect(store.getDocument().pages[0]?.rootNodeId).toBe(rootNodeId);

    const duplicated = store.applyPatches(reparented.appliedRevision, [{
      op: "node.duplicate",
      nodeId: "node_child"
    }]);
    const parentChildren = store.getDocument().pages[0]?.nodes.filter((node) => node.parentId === "node_parent") ?? [];
    expect(parentChildren.map((node) => node.name)).toEqual(expect.arrayContaining(["Child", "Child Copy"]));

    expect(() => store.applyPatches(duplicated.appliedRevision, [{
      op: "node.duplicate",
      nodeId: "node_child",
      parentId: null
    }])).toThrow(`Page already has a root node: ${pageId}`);
  });

  it("rejects invalid sibling indexes and broken duplicate descendants", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_invalid_sibling_index"));
    const pageId = store.getDocument().pages[0]?.id as string;
    const rootNodeId = store.getDocument().pages[0]?.rootNodeId as string;
    store.setGenerationPlan(validPlan as CanvasGenerationPlan);

    const seeded = store.applyPatches(2, [
      {
        op: "node.insert",
        pageId,
        parentId: rootNodeId,
        node: {
          id: "node_parent",
          kind: "frame",
          name: "Parent"
        }
      },
      {
        op: "node.insert",
        pageId,
        parentId: "node_parent",
        node: {
          id: "node_child",
          kind: "text",
          name: "Child"
        }
      }
    ]);

    expect(() => store.applyPatches(seeded.appliedRevision, [{
      op: "node.reorder",
      nodeId: "node_child",
      index: -1
    }])).toThrow("Invalid sibling index: -1");

    const brokenDocument = createDefaultCanvasDocument("dc_duplicate_missing_descendant");
    const brokenPage = brokenDocument.pages[0];
    if (!brokenPage) {
      throw new Error("Expected default page");
    }
    const brokenRootId = brokenPage.rootNodeId;
    if (!brokenRootId) {
      throw new Error("Expected default root node");
    }
    const brokenRoot = brokenPage.nodes.find((node) => node.id === brokenRootId);
    if (!brokenRoot) {
      throw new Error("Expected default root payload");
    }
    brokenRoot.childIds.push("node_parent");
    brokenPage.nodes.push({
      id: "node_parent",
      kind: "frame",
      name: "Parent",
      pageId: brokenPage.id,
      parentId: brokenRootId,
      childIds: ["node_missing"],
      rect: { x: 0, y: 0, width: 240, height: 120 },
      props: {},
      style: {},
      tokenRefs: {},
      bindingRefs: {},
      variantPatches: [],
      metadata: {}
    });

    const brokenStore = new CanvasDocumentStore(brokenDocument);
    brokenStore.setGenerationPlan(validPlan as CanvasGenerationPlan);
    expect(() => brokenStore.applyPatches(2, [{
      op: "node.duplicate",
      nodeId: "node_parent"
    }])).toThrow("Unknown node: node_missing");
  });

  it("exposes document ids, supports governance updates, and reloads documents", () => {
    const store = new CanvasDocumentStore(createDefaultCanvasDocument("dc_governance_methods"));
    expect(store.getDocumentId()).toBe("dc_governance_methods");

    const patchResult = store.applyPatches(1, [{
      op: "governance.update",
      block: "intent",
      changes: {
        summary: "Governed from patch",
        "metadata.owner": "qa"
      }
    }]);

    expect(patchResult.appliedRevision).toBe(2);
    expect(store.getDocument().designGovernance.intent).toEqual({
      summary: "Governed from patch",
      metadata: { owner: "qa" }
    });

    const replacement = createDefaultCanvasDocument("dc_reloaded");
    replacement.designGovernance.generationPlan = structuredClone(validPlan);
    store.loadDocument(replacement);

    expect(store.getDocumentId()).toBe("dc_reloaded");
    expect(store.getRevision()).toBe(1);
    expect(store.getDocument().designGovernance.generationPlan).toEqual(validPlan);
  });

});
