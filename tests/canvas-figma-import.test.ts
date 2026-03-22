import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { normalizeFigmaImportRequest } from "../src/integrations/figma/url";
import {
  normalizeFigmaFilePayload,
  normalizeFigmaImagesPayload,
  normalizeFigmaNodesPayload,
  normalizeFigmaVariablesPayload
} from "../src/integrations/figma/normalize";
import type { NormalizedFigmaNode } from "../src/integrations/figma/normalize";
import { FigmaClientError } from "../src/integrations/figma/client";
import { mapFigmaBoundVariables, mapFigmaVariablesToTokenStore } from "../src/integrations/figma/variables";
import { mapFigmaImportToCanvas } from "../src/integrations/figma/mappers";
import { materializeFigmaAssets } from "../src/integrations/figma/assets";

const fileFixture = readJson("tests/fixtures/figma/file-response.json");
const nodesFixture = readJson("tests/fixtures/figma/nodes-response.json");
const variablesFixture = readJson("tests/fixtures/figma/variables-response.json");

describe("figma import helpers", () => {
  it("normalizes file and node urls into a stable import request", () => {
    const fileRequest = normalizeFigmaImportRequest({
      sourceUrl: "https://www.figma.com/file/AbCdEf12345/Marketing-Landing",
      mode: "append_pages"
    });
    expect(fileRequest.fileKey).toBe("AbCdEf12345");
    expect(fileRequest.nodeIds).toEqual([]);
    expect(fileRequest.mode).toBe("append_pages");

    const nodeRequest = normalizeFigmaImportRequest({
      sourceUrl: "https://www.figma.com/design/AbCdEf12345/Marketing-Landing?node-id=2%3A1",
      nodeIds: ["3:1"]
    });
    expect(nodeRequest.fileKey).toBe("AbCdEf12345");
    expect(nodeRequest.nodeIds).toEqual(["2:1", "3:1"]);
    expect(nodeRequest.mode).toBe("replace_current_page");
  });

  it("maps file fixtures into pages, inventory, assets, and tokens", () => {
    const payload = normalizeFigmaFilePayload("AbCdEf12345", fileFixture);
    const variableMapping = mapFigmaVariablesToTokenStore(normalizeFigmaVariablesPayload(variablesFixture));
    const mapping = mapFigmaImportToCanvas({
      payload,
      assets: [
        {
          id: "figma-AbCdEf12345-5-1-png",
          sourceType: "remote",
          kind: "image",
          repoPath: ".opendevbrowser/canvas/assets/figma/AbCdEf12345/hero.png",
          url: "https://cdn.example.com/hero.png",
          status: "cached",
          metadata: {
            nodeId: "5:1"
          }
        }
      ],
      variables: variableMapping
    });

    expect(mapping.pages).toHaveLength(1);
    expect(mapping.pages[0]?.nodes.map((node) => node.name)).toContain("Headline");
    expect(mapping.componentInventory.map((item) => item.name)).toEqual(["Button Set", "Button"]);
    expect(mapping.assets.map((asset) => asset.id)).toEqual(["figma-AbCdEf12345-5-1-png"]);
    expect(mapping.tokens.collections.map((collection) => collection.name)).toEqual(["Colors", "Spacing"]);
    expect(mapping.tokens.aliases).toContainEqual(expect.objectContaining({
      path: "spacing/lg",
      targetPath: "spacing/md"
    }));
    const headline = mapping.pages[0]?.nodes.find((node) => node.name === "Headline");
    expect(headline?.tokenRefs).toMatchObject({
      fills: "colors/primary"
    });
    const buttonInstance = mapping.pages[0]?.nodes.find((node) => node.name === "CTA/Button");
    expect(buttonInstance?.props.inventoryItemId).toBe("figma-component-ButtonComponent");
  });

  it("maps targeted node imports into synthetic pages", () => {
    const payload = normalizeFigmaNodesPayload("AbCdEf12345", nodesFixture);
    const mapping = mapFigmaImportToCanvas({
      payload,
      assets: [],
      variables: null
    });

    expect(mapping.pages).toHaveLength(1);
    expect(mapping.pages[0]?.name).toContain("Hero");
    expect(mapping.pages[0]?.rootNodeId).toBe("figma-node-2:1");
  });

  it("normalizes fallback figma request defaults and rejects unsupported source urls", () => {
    const fallbackRequest = normalizeFigmaImportRequest({
      fileKey: " AbCdEf12345 ",
      nodeIds: ["2:1", "2:1, 3:1", "", "3:1"],
      mode: "unsupported-mode" as never,
      includeVariables: false,
      depth: 0,
      geometryPaths: false
    });
    const fractionalDepthRequest = normalizeFigmaImportRequest({
      fileKey: "AbCdEf12345",
      depth: 2.9
    });

    expect(fallbackRequest).toMatchObject({
      sourceUrl: "https://www.figma.com/file/AbCdEf12345",
      fileKey: "AbCdEf12345",
      nodeIds: ["2:1", "3:1"],
      mode: "replace_current_page",
      includeVariables: false,
      depth: null,
      geometryPaths: false
    });
    expect(() => normalizeFigmaImportRequest({})).toThrow("Figma import requires sourceUrl or fileKey.");
    expect(() => normalizeFigmaImportRequest({
      sourceUrl: "not-a-url"
    })).toThrow("Invalid Figma sourceUrl");
    expect(() => normalizeFigmaImportRequest({
      sourceUrl: "https://example.com/file/AbCdEf12345"
    })).toThrow("Unsupported Figma hostname");
    expect(() => normalizeFigmaImportRequest({
      sourceUrl: "https://www.figma.com/inspect/AbCdEf12345"
    })).toThrow("Unsupported Figma URL path");
    expect(fractionalDepthRequest.depth).toBe(2);
  });

  it("materializes png and svg assets into the repo-local figma cache", async () => {
    const payload = normalizeFigmaFilePayload("AbCdEf12345", fileFixture);
    const worktree = await mkdtemp(join(tmpdir(), "odb-figma-assets-"));
    try {
      const client = {
        getImages: async (_fileKey: string, nodeIds: string[], format: "png" | "svg") =>
          Object.fromEntries(nodeIds.map((nodeId) => [nodeId, `https://cdn.example.com/${nodeId}.${format}`])),
        downloadAsset: async (url: string) => ({
          buffer: Buffer.from(url.endsWith(".svg") ? "<svg />" : "png-bytes"),
          contentType: url.endsWith(".svg") ? "image/svg+xml" : "image/png"
        })
      };

      const result = await materializeFigmaAssets({
        worktree,
        fileKey: "AbCdEf12345",
        nodes: payload.rootNodes,
        client: client as never
      });

      expect(result.assets.map((asset) => asset.id).sort()).toEqual([
        "figma-AbCdEf12345-5-1-png",
        "figma-AbCdEf12345-5-1-svg",
        "figma-AbCdEf12345-6-1-svg"
      ]);
      expect(result.assetReceipts.every((receipt) => receipt.status === "cached")).toBe(true);
      const cachedAsset = result.assets.find((asset) => asset.id === "figma-AbCdEf12345-6-1-svg");
      expect(cachedAsset?.repoPath).toContain(".opendevbrowser/canvas/assets/figma/AbCdEf12345");
      const fileContent = await readFile(cachedAsset?.repoPath as string, "utf-8");
      expect(fileContent).toBe("<svg />");
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it("classifies generic asset failures and falls back to svg mime metadata", async () => {
    const payload = normalizeFigmaFilePayload("AbCdEf12345", fileFixture);
    const worktree = await mkdtemp(join(tmpdir(), "odb-figma-assets-generic-"));
    try {
      const result = await materializeFigmaAssets({
        worktree,
        fileKey: "AbCdEf12345",
        nodes: payload.rootNodes,
        client: {
          getImages: async (_fileKey: string, nodeIds: string[], format: "png" | "svg") => {
            if (format === "png") {
              throw new Error("upstream unavailable");
            }
            return Object.fromEntries(nodeIds.map((nodeId) => [nodeId, `https://cdn.example.com/${nodeId}.${format}`]));
          },
          downloadAsset: async (url: string) => {
            if (url.endsWith("6:1.svg")) {
              throw new Error("disk write failed");
            }
            return {
              buffer: Buffer.from("<svg />"),
              contentType: null
            };
          }
        } as never
      });

      expect(result.assets).toContainEqual(expect.objectContaining({
        id: "figma-AbCdEf12345-5-1-svg",
        mime: "image/svg+xml",
        status: "cached"
      }));
      expect(result.assetReceipts).toContainEqual(expect.objectContaining({
        assetId: "figma-AbCdEf12345-5-1-png",
        status: "asset_fetch_failed",
        metadata: expect.objectContaining({
          reason: "asset_fetch_failed"
        })
      }));
      expect(result.assetReceipts).toContainEqual(expect.objectContaining({
        assetId: "figma-AbCdEf12345-6-1-svg",
        status: "asset_fetch_failed",
        metadata: expect.objectContaining({
          reason: "asset_fetch_failed"
        })
      }));
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it("preserves figma client error codes when image URL lookup fails", async () => {
    const payload = normalizeFigmaFilePayload("AbCdEf12345", fileFixture);
    const worktree = await mkdtemp(join(tmpdir(), "odb-figma-assets-client-error-"));
    try {
      const result = await materializeFigmaAssets({
        worktree,
        fileKey: "AbCdEf12345",
        nodes: payload.rootNodes,
        client: {
          getImages: async (_fileKey: string, _nodeIds: string[], format: "png" | "svg") => {
            if (format === "png") {
              throw new FigmaClientError("rate_limited", "Retry later");
            }
            return {};
          },
          downloadAsset: async () => ({
            buffer: Buffer.from(""),
            contentType: null
          })
        } as never
      });

      expect(result.assetReceipts).toContainEqual(expect.objectContaining({
        assetId: "figma-AbCdEf12345-5-1-png",
        status: "asset_fetch_failed",
        metadata: expect.objectContaining({
          reason: "rate_limited"
        })
      }));
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it("records unresolved bound variables and asset fetch failures", async () => {
    const payload = normalizeFigmaFilePayload("AbCdEf12345", fileFixture);
    const boundVariables = mapFigmaBoundVariables("figma-node-1", {
      fills: { id: "missing-variable" },
      effects: [
        {
          id: "variable:primary"
        }
      ]
    }, {
      "variable:primary": {
        variableId: "variable:primary",
        path: "colors/primary",
        collectionId: "colors"
      }
    });
    const worktree = await mkdtemp(join(tmpdir(), "odb-figma-asset-failures-"));
    try {
      const emptyAssets = await materializeFigmaAssets({
        worktree,
        fileKey: "AbCdEf12345",
        nodes: [],
        client: {
          getImages: async () => ({}),
          downloadAsset: async () => ({
            buffer: Buffer.from(""),
            contentType: null
          })
        } as never
      });
      const failedAssets = await materializeFigmaAssets({
        worktree,
        fileKey: "AbCdEf12345",
        nodes: payload.rootNodes,
        client: {
          getImages: async (_fileKey: string, nodeIds: string[], format: "png" | "svg") => format === "png"
            ? {}
            : Object.fromEntries(nodeIds.map((nodeId) => [nodeId, `https://cdn.example.com/${nodeId}.${format}`])),
          downloadAsset: async () => {
            throw new FigmaClientError("asset_fetch_failed", "download failed");
          }
        } as never
      });

      expect(boundVariables.tokenRefs).toEqual({
        "effects.0": "colors/primary"
      });
      expect(boundVariables.bindings).toContainEqual(expect.objectContaining({
        path: "colors/primary",
        property: "effects.0"
      }));
      expect(boundVariables.unresolved).toEqual([
        {
          propertyPath: "fills",
          variableId: "missing-variable"
        }
      ]);
      expect(emptyAssets).toEqual({
        assets: [],
        assetReceipts: []
      });
      expect(failedAssets.assets).toEqual([]);
      expect(failedAssets.assetReceipts.some((receipt) => receipt.metadata?.reason === "missing_image_url")).toBe(true);
      expect(failedAssets.assetReceipts.some((receipt) => receipt.metadata?.reason === "asset_fetch_failed")).toBe(true);
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it("normalizes sparse figma payloads, skips malformed entries, and keeps fallback metadata stable", () => {
    const filePayload = normalizeFigmaFilePayload("SparseFile", {
      name: "  ",
      version: " version-1 ",
      branch_data: { branchId: " branch-1 " },
      document: {
        id: "doc-1",
        name: "Document",
        type: "DOCUMENT",
        children: [
          {
            id: "canvas-1",
            name: "Landing",
            type: "CANVAS",
            children: [{
              id: "",
              name: "",
              type: "FRAME",
              fills: [{ type: null }, { type: "SOLID", color: {} }],
              strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 0.5 } }],
              fillGeometry: [null, { path: "M 0 0" }],
              boundVariables: { fills: { id: "var-1" } },
              style: { fill: "style-1" },
              children: [{ id: "child-invalid" }]
            }]
          },
          {
            id: "frame-root",
            name: "Ignored Root",
            type: "FRAME"
          }
        ]
      },
      components: {
        keep: { key: "component-1", name: "Button" },
        drop: { key: "component-2", name: "" }
      },
      componentSets: {
        setA: { name: "Button Set" }
      }
    });

    expect(filePayload.fileName).toBeNull();
    expect(filePayload.versionId).toBe("version-1");
    expect(filePayload.branchId).toBe("branch-1");
    expect(filePayload.rootNodes).toHaveLength(1);
    const frameNode = filePayload.rootNodes[0]?.children[0];
    expect(frameNode).toMatchObject({
      id: "figma-node-0",
      name: "figma-node-0",
      fills: [{
        type: "SOLID",
        visible: true,
        opacity: 1,
        color: null,
        imageRef: null,
        scaleMode: null
      }],
      strokes: [{ color: { r: 1, g: 0, b: 0, a: 0.5 } }],
      vectorPaths: [{ path: "M 0 0" }],
      children: []
    });
    expect(frameNode?.metadata).toMatchObject({
      boundVariables: { fills: { id: "var-1" } },
      style: { fill: "style-1" }
    });
    expect(filePayload.components).toEqual({
      "component-1": {
        id: "component-1",
        name: "Button",
        description: null,
        componentSetId: null
      }
    });
    expect(filePayload.componentSets).toEqual({
      setA: {
        id: "setA",
        name: "Button Set",
        description: null,
        componentSetId: null
      }
    });

    const nodesPayload = normalizeFigmaNodesPayload("SparseNodes", {
      version: " v2 ",
      nodes: {
        good: {
          document: {
            id: "",
            name: "",
            type: "TEXT",
            characters: "Hello"
          }
        },
        bad: {
          document: {
            id: "missing-type"
          }
        }
      }
    });
    expect(nodesPayload.versionId).toBe("v2");
    expect(nodesPayload.rootNodes).toEqual([expect.objectContaining({
      id: "figma-node-0",
      name: "figma-node-0",
      type: "TEXT",
      characters: "Hello"
    })]);

    expect(normalizeFigmaImagesPayload({
      images: {
        keep: " https://cdn.example.com/asset.png ",
        dropEmpty: "",
        dropNull: null
      }
    })).toEqual({ keep: "https://cdn.example.com/asset.png" });

    const variables = normalizeFigmaVariablesPayload({
      meta: {
        collections: [{
          id: "collection-1",
          name: "Colors",
          hiddenFromPublishing: true,
          defaultModeId: "mode-light",
          modes: [{ modeId: "mode-light", name: "Light" }, { modeId: "", name: "Drop" }],
          variableIds: ["var-1", "", 99]
        }, {
          id: "",
          name: "Invalid"
        }],
        variables: [{
          id: "var-1",
          name: "Primary / Base",
          variableCollectionId: "collection-1",
          resolvedType: "COLOR",
          valuesByMode: {
            "mode-light": { r: 1 },
            "mode-dark": { type: "VARIABLE_ALIAS", id: "var-2" },
            "mode-null": null
          },
          scopes: ["ALL_FILLS", "", 42],
          hiddenFromPublishing: true,
          codeSyntax: { css: "var(--brand-primary)" }
        }, {
          id: "var-2",
          name: "Alias Target",
          valuesByMode: { base: "#ffffff" }
        }, {
          id: "",
          name: "Drop"
        }]
      }
    });

    expect(variables.collections).toEqual([{
      id: "collection-1",
      name: "Colors",
      hiddenFromPublishing: true,
      defaultModeId: "mode-light",
      modes: [{ modeId: "mode-light", name: "Light" }],
      variableIds: ["var-1"]
    }]);
    expect(variables.variables).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "var-1",
        aliasesByModeId: { "mode-dark": "var-2" },
        valuesByModeId: {
          "mode-light": { r: 1 },
          "mode-dark": { aliasTo: "var-2" },
          "mode-null": null
        },
        scopes: ["ALL_FILLS"],
        hiddenFromPublishing: true
      }),
      expect.objectContaining({ id: "var-2", valuesByModeId: { base: "#ffffff" } })
    ]));
  });

  it("maps figma variables, nested bound refs, unsupported nodes, and raw fallback metadata", () => {
    const variableMapping = mapFigmaVariablesToTokenStore({
      collections: [{
        id: "collection-colors",
        name: "Brand Colors",
        hiddenFromPublishing: false,
        defaultModeId: "mode-missing",
        modes: [{ modeId: "mode-dark", name: "Dark" }],
        variableIds: ["variable-primary", "variable-alias"]
      }],
      variables: [{
        id: "variable-primary",
        name: "Primary / Base",
        resolvedType: "COLOR",
        collectionId: "collection-colors",
        valuesByModeId: {
          "mode-dark": "#111827",
          "mode-light": "#f8fafc"
        },
        scopes: [],
        hiddenFromPublishing: false,
        codeSyntax: {},
        aliasesByModeId: {}
      }, {
        id: "variable-alias",
        name: "Alias Target",
        resolvedType: "COLOR",
        collectionId: "collection-colors",
        valuesByModeId: {
          "mode-dark": { aliasTo: "variable-primary" },
          "mode-light": null
        },
        scopes: [],
        hiddenFromPublishing: false,
        codeSyntax: {},
        aliasesByModeId: {
          "mode-dark": "variable-primary",
          "mode-light": "missing-variable"
        }
      }, {
        id: "variable-unscoped",
        name: "  ///  ",
        resolvedType: null,
        collectionId: null,
        valuesByModeId: {},
        scopes: [],
        hiddenFromPublishing: false,
        codeSyntax: {},
        aliasesByModeId: {}
      }]
    });

    expect(variableMapping.tokenStore.collections.map((collection) => collection.name).sort()).toEqual([
      "Brand Colors",
      "Imported"
    ]);
    expect(variableMapping.tokenStore.values).toMatchObject({
      "brand-colors/primary/base": "#111827",
      "brand-colors/alias-target": { aliasTo: "variable-primary" },
      "imported/token/token/token/token": null
    });
    expect(variableMapping.tokenStore.aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "brand-colors/alias-target",
        modeId: "mode-dark",
        targetPath: "brand-colors/primary/base"
      }),
      expect.objectContaining({
        path: "brand-colors/alias-target",
        modeId: "mode-light",
        targetPath: "missing-variable"
      })
    ]));

    expect(mapFigmaBoundVariables("node-bound", { id: "variable-primary" }, variableMapping.variableLookup)).toMatchObject({
      tokenRefs: { bound: "brand-colors/primary/base" },
      unresolved: []
    });
    expect(mapFigmaBoundVariables("node-bound", {
      fills: { id: "variable-primary" },
      nested: [{ stroke: { id: "missing-variable" } }],
      ignored: { id: "   " }
    }, variableMapping.variableLookup)).toMatchObject({
      tokenRefs: {
        fills: "brand-colors/primary/base"
      },
      unresolved: [{ propertyPath: "nested.0.stroke", variableId: "missing-variable" }]
    });
    expect(mapFigmaBoundVariables("node-array", [
      { id: "variable-primary" },
      { nested: { id: "missing-variable" } }
    ], variableMapping.variableLookup)).toMatchObject({
      tokenRefs: {
        "0": "brand-colors/primary/base"
      },
      unresolved: [{ propertyPath: "1.nested", variableId: "missing-variable" }]
    });

    const payload = {
      fileKey: "CanvasFigma",
      fileName: "Marketing File",
      sourceKind: "nodes",
      versionId: null,
      branchId: null,
      rootNodes: [createNormalizedFigmaNode({
        id: "root-frame",
        name: "Hero Root",
        type: "FRAME",
        boundVariables: { opacity: { id: "variable-primary" } },
        children: [
          createNormalizedFigmaNode({
            id: "headline",
            name: "Headline",
            type: "TEXT",
            characters: "Governed canvas",
            fills: [{ type: "SOLID", visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 0.5 }, imageRef: null, scaleMode: null }]
          }),
          createNormalizedFigmaNode({
            id: "shape",
            name: "Card",
            type: "RECTANGLE",
            fills: [
              { type: "SOLID", visible: false, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 }, imageRef: null, scaleMode: null },
              { type: "SOLID", visible: true, opacity: 1, color: { r: 0, g: 0, b: 0, a: 1 }, imageRef: null, scaleMode: null }
            ],
            strokes: [{ type: "SOLID", visible: true, opacity: 1, color: { r: 1, g: 0, b: 0, a: 1 }, imageRef: null, scaleMode: null }]
          }),
          createNormalizedFigmaNode({
            id: "instance",
            name: "CTA/Button",
            type: "INSTANCE",
            componentSetId: "ButtonSet",
            boundVariables: { fills: { id: "missing-variable" } }
          }),
          createNormalizedFigmaNode({
            id: "unsupported",
            name: "Sticky",
            type: "STICKY"
          })
        ]
      })],
      components: {
        ButtonSet: {
          id: "ButtonSet",
          name: "Button Set",
          description: null,
          componentSetId: null
        },
        ButtonComponent: {
          id: "ButtonComponent",
          name: "Button",
          description: "Primary CTA",
          componentSetId: "ButtonSet"
        },
        DuplicateButtonSet: {
          id: "ButtonSet",
          name: "Duplicate",
          description: null,
          componentSetId: null
        }
      },
      componentSets: {},
      images: {},
      variables: null,
      metadata: {}
    } as const;

    const withVariables = mapFigmaImportToCanvas({
      payload,
      assets: [{
        id: "asset_orphan",
        sourceType: "remote",
        kind: "image",
        repoPath: ".opendevbrowser/canvas/assets/figma/orphan.png",
        url: "https://cdn.example.com/orphan.png",
        status: "cached",
        metadata: {}
      }, {
        id: "asset_shape",
        sourceType: "remote",
        kind: "image",
        repoPath: ".opendevbrowser/canvas/assets/figma/shape.png",
        url: "https://cdn.example.com/shape.png",
        status: "cached",
        metadata: { nodeId: "shape" }
      }],
      variables: variableMapping,
      requestedFrameworkId: "react",
      requestedFrameworkAdapterId: "builtin:react-tsx-v2",
      frameworkMaterialized: false
    });

    expect(withVariables.pages[0]).toMatchObject({
      name: "Marketing File / Hero Root",
      path: "/marketing-file-hero-root"
    });
    expect(withVariables.degradedFailureCodes.sort()).toEqual([
      "framework_materializer_missing",
      "unsupported_figma_node"
    ]);
    expect(withVariables.componentInventory.map((item) => item.id)).toEqual([
      "figma-component-ButtonSet",
      "figma-component-ButtonComponent"
    ]);
    const headlineNode = withVariables.pages[0]?.nodes.find((node) => node.id === "figma-node-headline");
    const shapeNode = withVariables.pages[0]?.nodes.find((node) => node.id === "figma-node-shape");
    const instanceNode = withVariables.pages[0]?.nodes.find((node) => node.id === "figma-node-instance");
    expect(headlineNode?.style).toMatchObject({ color: "rgba(255, 255, 255, 0.5)" });
    expect(headlineNode?.style).not.toHaveProperty("backgroundColor");
    expect(shapeNode?.style).toMatchObject({
      backgroundColor: "rgb(0, 0, 0)",
      borderColor: "rgb(255, 0, 0)"
    });
    expect(shapeNode?.metadata.assetIds).toEqual(["asset_shape"]);
    expect(instanceNode?.props.inventoryItemId).toBe("figma-component-ButtonSet");
    expect(instanceNode?.metadata.unresolvedBoundVariables).toEqual([
      { propertyPath: "fills", variableId: "missing-variable" }
    ]);
    expect(withVariables.tokens.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "figma-node-root-frame", path: "brand-colors/primary/base" })
    ]));

    const withoutVariables = mapFigmaImportToCanvas({
      payload,
      assets: [],
      variables: null
    });
    expect(withoutVariables.pages[0]?.nodes.find((node) => node.id === "figma-node-instance")?.metadata.figmaBoundVariables).toEqual({
      fills: { id: "missing-variable" }
    });
  });

  it("materializes framework inventory metadata and style branches for sparse non-canvas roots", () => {
    const payload = {
      fileKey: "SparseAdapterFile",
      fileName: "Adapter Import",
      sourceKind: "nodes",
      versionId: null,
      branchId: null,
      rootNodes: [createNormalizedFigmaNode({
        id: "adapter-root",
        name: "Adapter Root",
        type: "FRAME",
        layoutMode: "HORIZONTAL",
        itemSpacing: 24,
        padding: { top: 8, right: 12, bottom: 16, left: 20 },
        cornerRadius: 18,
        strokeWeight: 3,
        fills: [{ type: "SOLID", visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 }, imageRef: null, scaleMode: null }],
        strokes: [{ type: "SOLID", visible: true, opacity: 1, color: { r: 0, g: 0, b: 0, a: 1 }, imageRef: null, scaleMode: null }]
      })],
      components: {
        CardComponent: {
          id: "CardComponent",
          name: "Card",
          description: null,
          componentSetId: null
        }
      },
      componentSets: {},
      images: {},
      variables: null,
      metadata: {}
    } as const;

    const materialized = mapFigmaImportToCanvas({
      payload,
      assets: [],
      variables: null,
      requestedFrameworkId: "react",
      requestedFrameworkAdapterId: "builtin:react-tsx-v2",
      frameworkMaterialized: true
    });
    const adapterOnly = mapFigmaImportToCanvas({
      payload,
      assets: [],
      variables: null,
      requestedFrameworkAdapterId: "builtin:html-static-v1",
      frameworkMaterialized: true
    });

    expect(materialized.degradedFailureCodes).toEqual([]);
    expect(materialized.pages[0]).toMatchObject({
      name: "Adapter Import / Adapter Root",
      path: "/adapter-import-adapter-root"
    });
    expect(materialized.pages[0]?.nodes[0]?.style).toMatchObject({
      display: "flex",
      flexDirection: "row",
      gap: 24,
      paddingTop: 8,
      paddingRight: 12,
      paddingBottom: 16,
      paddingLeft: 20,
      borderRadius: 18,
      borderWidth: 3,
      backgroundColor: "rgb(255, 255, 255)",
      borderColor: "rgb(0, 0, 0)"
    });
    expect(materialized.componentInventory[0]).toMatchObject({
      framework: {
        id: "react",
        adapter: {
          id: "builtin:react-tsx-v2"
        }
      },
      adapter: {
        id: "builtin:react-tsx-v2"
      }
    });
    expect(adapterOnly.componentInventory[0]).toMatchObject({
      framework: null,
      adapter: {
        id: "builtin:html-static-v1"
      }
    });
  });

  it("dedupes asset requests, preserves default mime fallbacks, and records generic fetch failures", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "odb-figma-assets-extra-"));
    try {
      const pngNode = createNormalizedFigmaNode({
        id: "dup-node",
        type: "FRAME",
        fills: [{ type: "IMAGE", visible: true, opacity: 1, color: null, imageRef: "img", scaleMode: "FILL" }]
      });
      const duplicateChild = createNormalizedFigmaNode({
        id: "dup-node",
        type: "FRAME",
        fills: [{ type: "IMAGE", visible: true, opacity: 1, color: null, imageRef: "img-2", scaleMode: "FILL" }]
      });
      pngNode.children = [duplicateChild];

      const cached = await materializeFigmaAssets({
        worktree,
        fileKey: "CanvasFigma",
        nodes: [pngNode],
        client: {
          getImages: async (_fileKey: string, nodeIds: string[], format: "png" | "svg") => {
            expect(format).toBe("png");
            expect(nodeIds).toEqual(["dup-node"]);
            return { "dup-node": "https://cdn.example.com/dup-node.png" };
          },
          downloadAsset: async () => ({
            buffer: Buffer.from("png-fallback"),
            contentType: null
          })
        } as never
      });
      expect(cached.assets).toEqual([expect.objectContaining({
        id: "figma-CanvasFigma-dup-node-png",
        mime: "image/png"
      })]);
      expect(cached.assetReceipts).toHaveLength(1);

      const failed = await materializeFigmaAssets({
        worktree,
        fileKey: "CanvasFigma",
        nodes: [createNormalizedFigmaNode({
          id: "vector-node",
          type: "VECTOR",
          vectorPaths: [{ path: "M 0 0" }]
        })],
        client: {
          getImages: async () => {
            throw new Error("boom");
          },
          downloadAsset: async () => ({
            buffer: Buffer.from("unused"),
            contentType: "image/svg+xml"
          })
        } as never
      });

      expect(failed.assets).toEqual([]);
      expect(failed.assetReceipts).toEqual([expect.objectContaining({
        assetId: "figma-CanvasFigma-vector-node-svg",
        status: "asset_fetch_failed",
        metadata: expect.objectContaining({ reason: "asset_fetch_failed" })
      })]);
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });
});

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), "utf-8"));
}

function createNormalizedFigmaNode(overrides: Partial<NormalizedFigmaNode> & Pick<NormalizedFigmaNode, "id" | "type">): NormalizedFigmaNode {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    type: overrides.type,
    visible: overrides.visible ?? true,
    rect: overrides.rect ?? { x: 0, y: 0, width: 320, height: 180 },
    characters: overrides.characters ?? null,
    fills: overrides.fills ?? [],
    strokes: overrides.strokes ?? [],
    strokeWeight: overrides.strokeWeight ?? null,
    cornerRadius: overrides.cornerRadius ?? null,
    layoutMode: overrides.layoutMode ?? null,
    itemSpacing: overrides.itemSpacing ?? null,
    padding: overrides.padding ?? { top: 0, right: 0, bottom: 0, left: 0 },
    primaryAxisAlignItems: overrides.primaryAxisAlignItems ?? null,
    counterAxisAlignItems: overrides.counterAxisAlignItems ?? null,
    layoutSizingHorizontal: overrides.layoutSizingHorizontal ?? null,
    layoutSizingVertical: overrides.layoutSizingVertical ?? null,
    componentId: overrides.componentId ?? null,
    componentSetId: overrides.componentSetId ?? null,
    boundVariables: overrides.boundVariables ?? {},
    vectorPaths: overrides.vectorPaths ?? [],
    metadata: overrides.metadata ?? {},
    children: overrides.children ?? []
  };
}
