import { mkdtemp, readFile } from "fs/promises";
import { describe, expect, it } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { parseCodeSyncManifest, normalizeCodeSyncManifest, normalizeRootLocator } from "../src/canvas/code-sync/manifest";
import { hashCodeSyncJson, hashCodeSyncValue } from "../src/canvas/code-sync/hash";
import { buildManifestLookup, locatorKey } from "../src/canvas/code-sync/graph";
import { finalizeCodeSyncManifest, writeCodeSyncSource } from "../src/canvas/code-sync/write";
import {
  DEFAULT_CODE_SYNC_OWNERSHIP,
  inferBuiltInFrameworkAdapterIdFromPath,
  inferCodeSyncSourceFamilyFromPath,
  isCodeSyncProjectionMode,
  isCodeSyncState,
  normalizeCodeSyncRootLocator,
  normalizeCodeSyncBindingMetadata,
  normalizeCodeSyncCapabilityGrant,
  normalizeCodeSyncOwnership,
  normalizeFrameworkAdapterIdentity,
  type CodeSyncManifest,
  type CodeSyncSourceLocator
} from "../src/canvas/code-sync/types";

function reactExportLocator(exportName: string, selector?: string) {
  return selector
    ? { kind: "react-export" as const, exportName, selector }
    : { kind: "react-export" as const, exportName };
}

function buildLocator(overrides: Partial<CodeSyncSourceLocator> = {}): CodeSyncSourceLocator {
  return {
    sourcePath: "src/app.tsx",
    astPath: "exports.default",
    sourceSpan: {
      start: { offset: 1, line: 1, column: 1 },
      end: { offset: 10, line: 1, column: 10 }
    },
    ...overrides
  };
}

function buildManifest(overrides: Partial<CodeSyncManifest> = {}): CodeSyncManifest {
  const metadata = normalizeCodeSyncBindingMetadata({
    adapter: "tsx-react-v1",
    repoPath: "src/app.tsx",
    exportName: "App",
    syncMode: "manual",
    ownership: {}
  });
  return {
    manifestVersion: metadata.manifestVersion,
    bindingId: "binding_code",
    documentId: "dc_sync",
    repoPath: metadata.repoPath,
    adapter: metadata.adapter,
    frameworkAdapterId: metadata.frameworkAdapterId,
    frameworkId: metadata.frameworkId,
    sourceFamily: metadata.sourceFamily,
    adapterKind: metadata.adapterKind,
    adapterVersion: metadata.adapterVersion,
    pluginId: metadata.pluginId,
    libraryAdapterIds: [...metadata.libraryAdapterIds],
    rootLocator: metadata.rootLocator,
    sourceHash: "hash_123",
    documentRevision: 3,
    nodeMappings: [{
      nodeId: "node_root",
      locator: buildLocator()
    }],
    lastImportedAt: "2026-03-12T00:00:00.000Z",
    lastPushedAt: "2026-03-12T01:00:00.000Z",
    reasonCode: metadata.reasonCode,
    ...overrides
  };
}

describe("canvas code-sync primitive helpers", () => {
  it("hashes raw values and JSON payloads deterministically", () => {
    expect(hashCodeSyncValue("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(hashCodeSyncJson({ b: 2, a: 1 })).toBe(hashCodeSyncValue(JSON.stringify({ b: 2, a: 1 })));
    expect(hashCodeSyncJson({ a: 1 })).not.toBe(hashCodeSyncJson({ a: 2 }));
  });

  it("recognizes valid sync states and projection modes", () => {
    expect(isCodeSyncState("in_sync")).toBe(true);
    expect(isCodeSyncState("bogus")).toBe(false);
    expect(isCodeSyncState(42)).toBe(false);
    expect(isCodeSyncProjectionMode("bound_app_runtime")).toBe(true);
    expect(isCodeSyncProjectionMode("projectionless")).toBe(false);
    expect(isCodeSyncProjectionMode(null)).toBe(false);
  });

  it("matches manifest locators by stable AST path instead of source offsets", () => {
    const original = buildLocator({
      astPath: "export:Hero.child.0.child.0",
      sourceSpan: {
        start: { offset: 40, line: 2, column: 12 },
        end: { offset: 60, line: 2, column: 32 }
      }
    });
    const moved = buildLocator({
      astPath: original.astPath,
      sourceSpan: {
        start: { offset: 140, line: 5, column: 4 },
        end: { offset: 180, line: 5, column: 44 }
      }
    });

    expect(locatorKey(moved)).toBe(locatorKey(original));
    expect(buildManifestLookup([{ nodeId: "node_text", locator: original }]).get(locatorKey(moved))).toBe("node_text");
  });

  it("normalizes ownership defaults and invalid per-dimension values", () => {
    expect(normalizeCodeSyncOwnership(null)).toEqual(DEFAULT_CODE_SYNC_OWNERSHIP);
    expect(normalizeCodeSyncOwnership({
      structure: "canvas",
      text: "invalid",
      style: "shared",
      tokens: 123,
      behavior: "code",
      data: "canvas"
    })).toEqual({
      structure: "canvas",
      text: "shared",
      style: "shared",
      tokens: "shared",
      behavior: "code",
      data: "canvas"
    });
  });

  it("infers built-in framework lanes and plugin identities from repo paths", () => {
    expect(inferBuiltInFrameworkAdapterIdFromPath("src/App.vue")).toBe("builtin:vue-sfc-v1");
    expect(inferBuiltInFrameworkAdapterIdFromPath("src/App.svelte")).toBe("builtin:svelte-sfc-v1");
    expect(inferBuiltInFrameworkAdapterIdFromPath("public/index.html")).toBe("builtin:html-static-v1");
    expect(inferBuiltInFrameworkAdapterIdFromPath("public/index.htm")).toBe("builtin:html-static-v1");
    expect(inferCodeSyncSourceFamilyFromPath("src/routes/+page.svelte")).toBe("svelte-sfc");

    expect(normalizeFrameworkAdapterIdentity({
      adapter: "acme/astro-v1",
      repoPath: "src/App.vue"
    })).toMatchObject({
      adapter: "acme/astro-v1",
      frameworkAdapterId: "acme/astro-v1",
      frameworkId: "vue",
      sourceFamily: "vue-sfc",
      adapterKind: "plugin",
      pluginId: "acme"
    });

    expect(normalizeFrameworkAdapterIdentity({
      adapter: null,
      frameworkAdapterId: "builtin:custom-elements-v1",
      repoPath: "src/app.js"
    })).toMatchObject({
      adapter: "builtin:custom-elements-v1",
      frameworkAdapterId: "builtin:custom-elements-v1",
      frameworkId: "custom-elements",
      sourceFamily: "custom-elements",
      adapterKind: "custom-elements"
    });
  });

  it("keeps selector-aware root locators across react and vue bindings", () => {
    expect(normalizeCodeSyncRootLocator({
      kind: "react-export",
      exportName: "Hero",
      selector: "#root"
    }, {
      sourceFamily: "react-tsx"
    })).toEqual({
      kind: "react-export",
      exportName: "Hero",
      selector: "#root"
    });

    expect(normalizeCodeSyncBindingMetadata({
      adapter: "builtin:vue-sfc-v1",
      repoPath: "src/App.vue",
      selector: "#app",
      syncMode: "manual",
      ownership: {}
    }).rootLocator).toEqual({
      kind: "vue-template",
      selector: "#app"
    });
  });

  it("normalizes builtin and plugin adapter identities when the adapter field is omitted", () => {
    expect(normalizeFrameworkAdapterIdentity({
      adapter: "builtin:custom-elements-v1",
      repoPath: "src/app.js"
    })).toMatchObject({
      adapter: "builtin:custom-elements-v1",
      frameworkAdapterId: "builtin:custom-elements-v1",
      frameworkId: "custom-elements",
      sourceFamily: "custom-elements",
      adapterKind: "custom-elements"
    });

    expect(normalizeFrameworkAdapterIdentity({
      adapter: null,
      frameworkAdapterId: "acme/svelte-kit",
      repoPath: "src/routes/+page.svelte"
    })).toMatchObject({
      adapter: "acme/svelte-kit",
      frameworkAdapterId: "acme/svelte-kit",
      frameworkId: "svelte",
      sourceFamily: "svelte-sfc",
      adapterKind: "plugin",
      pluginId: "acme"
    });

    expect(normalizeFrameworkAdapterIdentity({
      adapter: null,
      frameworkAdapterId: "acme/html-static",
      repoPath: "public/index.html"
    })).toMatchObject({
      adapter: "acme/html-static",
      frameworkAdapterId: "acme/html-static",
      frameworkId: "html",
      sourceFamily: "html-static",
      adapterKind: "plugin",
      pluginId: "acme"
    });
  });

  it("normalizes valid binding metadata and defaults optional fields", () => {
    expect(normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: " src/components/App.tsx ",
      exportName: "App",
      syncMode: "watch",
      ownership: { structure: "canvas", behavior: "shared" },
      route: " /preview ",
      verificationTarget: " #app ",
      runtimeRootSelector: " #root ",
      projection: "bound_app_runtime"
    })).toEqual({
      adapter: "tsx-react-v1",
      frameworkAdapterId: "builtin:react-tsx-v2",
      frameworkId: "react",
      sourceFamily: "react-tsx",
      adapterKind: "tsx-react",
      adapterVersion: 2,
      repoPath: "src/components/App.tsx",
      rootLocator: reactExportLocator("App"),
      exportName: "App",
      selector: undefined,
      syncMode: "watch",
      ownership: {
        structure: "canvas",
        text: "shared",
        style: "shared",
        tokens: "shared",
        behavior: "shared",
        data: "code"
      },
      route: "/preview",
      verificationTarget: "#app",
      runtimeRootSelector: "#root",
      projection: "bound_app_runtime",
      manifestVersion: 2,
      libraryAdapterIds: [],
      pluginId: undefined,
      declaredCapabilities: ["preview", "inventory_extract", "code_pull", "code_push", "token_roundtrip"],
      grantedCapabilities: [
        { capability: "preview", granted: true },
        { capability: "inventory_extract", granted: true },
        { capability: "code_pull", granted: true },
        { capability: "code_push", granted: true },
        { capability: "token_roundtrip", granted: true }
      ],
      reasonCode: "framework_migrated"
    });

    expect(normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "src/components/App.tsx",
      selector: "[data-testid='app']",
      syncMode: "manual",
      ownership: {},
      projection: "not-real"
    }).projection).toBe("canvas_html");
  });

  it("rejects invalid binding metadata payloads and normalizes legacy adapter inputs", () => {
    expect(() => normalizeCodeSyncBindingMetadata(null)).toThrow("Invalid code sync binding metadata.");
    expect(normalizeCodeSyncBindingMetadata({
      adapter: "unknown-adapter",
      repoPath: "src/app.tsx",
      exportName: "App",
      syncMode: "manual",
      ownership: {}
    })).toMatchObject({
      adapter: "unknown-adapter",
      frameworkAdapterId: "builtin:react-tsx-v2",
      frameworkId: "react",
      sourceFamily: "react-tsx"
    });
    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "   ",
      exportName: "App",
      syncMode: "manual",
      ownership: {}
    })).toThrow("codeSync.repoPath is required.");
    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "src/app.tsx",
      exportName: "App",
      syncMode: "later",
      ownership: {}
    })).toThrow("Unsupported code sync mode: later");
    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "src/app.tsx",
      syncMode: "manual",
      ownership: {}
    })).toThrow("codeSync.exportName or codeSync.selector is required.");

    expect(normalizeCodeSyncBindingMetadata({
      adapter: 123,
      repoPath: "src/app.tsx",
      exportName: "App",
      syncMode: "manual",
      ownership: {}
    })).toMatchObject({
      adapter: "builtin:react-tsx-v2",
      frameworkAdapterId: "builtin:react-tsx-v2",
      frameworkId: "react"
    });

    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: 123,
      exportName: "App",
      syncMode: "manual",
      ownership: {}
    })).toThrow("codeSync.repoPath is required.");

    expect(() => normalizeCodeSyncBindingMetadata({
      adapter: "tsx-react-v1",
      repoPath: "src/app.tsx",
      exportName: "App",
      syncMode: 123,
      ownership: {}
    })).toThrow("Unsupported code sync mode: unknown");
  });

  it("normalizes non-react root locators and capability grants", () => {
    expect(normalizeRootLocator(undefined, "vue-sfc")).toEqual({ kind: "vue-template" });
    expect(normalizeRootLocator({
      selector: " #app "
    }, "svelte-sfc")).toEqual({ kind: "svelte-markup", selector: "#app" });
    expect(normalizeRootLocator({
      selector: " #preview "
    }, "html-static")).toEqual({ kind: "dom-selector", selector: "#preview" });

    expect(normalizeCodeSyncCapabilityGrant(null)).toBeNull();
    expect(normalizeCodeSyncCapabilityGrant({
      capability: "preview",
      granted: false,
      reasonCode: "capability_denied",
      details: { source: "workspace-policy" }
    })).toEqual({
      capability: "preview",
      granted: false,
      reasonCode: "capability_denied",
      details: { source: "workspace-policy" }
    });
    expect(normalizeCodeSyncCapabilityGrant({
      capability: "code_pull",
      granted: true,
      reasonCode: "not-real",
      details: "skip"
    })).toEqual({
      capability: "code_pull",
      granted: true
    });
  });

  it("normalizes root locators and parses valid manifests", () => {
    expect(normalizeRootLocator(undefined, "html-static")).toEqual({ kind: "document-root" });
    expect(normalizeRootLocator({
      exportName: "  ",
      selector: " #root "
    }, "react-tsx")).toEqual({ kind: "dom-selector", selector: "#root" });

    const parsed = parseCodeSyncManifest({
      ...buildManifest(),
      rootLocator: { kind: "react-export", exportName: "App", selector: "  " },
      nodeMappings: [
        {
          nodeId: "node_root",
          locator: buildLocator()
        },
        {
          nodeId: 42,
          locator: buildLocator()
        }
      ]
    });

    expect(parsed.rootLocator).toEqual(reactExportLocator("App"));
    expect(parsed.nodeMappings).toHaveLength(1);
    expect(parsed.nodeMappings[0]?.locator.sourceSpan.end.column).toBe(10);

    expect(parseCodeSyncManifest({
      ...buildManifest({
        manifestVersion: 1,
        adapter: "tsx-react-v1"
      }),
      rootLocator: { exportName: "App" }
    } as unknown as CodeSyncManifest)).toMatchObject({
      manifestVersion: 1,
      frameworkAdapterId: "builtin:react-tsx-v2",
      sourceFamily: "react-tsx",
      reasonCode: "manifest_migrated"
    });
  });

  it("rejects invalid manifest payloads and malformed locators", () => {
    expect(() => parseCodeSyncManifest(null)).toThrow("Invalid code sync manifest payload.");
    expect(() => parseCodeSyncManifest({
      ...buildManifest(),
      sourceHash: ""
    })).toThrow("Invalid code sync manifest payload.");

    expect(() => parseCodeSyncManifest({
      ...buildManifest(),
      bindingId: 1,
      documentId: 2,
      repoPath: 3,
      adapter: 4,
      sourceHash: 5
    })).toThrow("Invalid code sync manifest payload.");

    expect(parseCodeSyncManifest({
      ...buildManifest(),
      rootLocator: "not-an-object",
      exportName: "App",
      lastImportedAt: 123,
      lastPushedAt: "2026-03-12T02:00:00.000Z"
    } as unknown as CodeSyncManifest & { exportName: string })).toMatchObject({
      rootLocator: reactExportLocator("App"),
      lastImportedAt: undefined,
      lastPushedAt: "2026-03-12T02:00:00.000Z"
    });

    expect(() => normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [{
        nodeId: "node_root",
        locator: null as unknown as CodeSyncSourceLocator
      }]
    }))).toThrow("Invalid code sync locator.");

    expect(() => normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [{
        nodeId: "node_root",
        locator: {
          sourceSpan: null,
          sourcePath: 123,
          astPath: false
        } as unknown as CodeSyncSourceLocator
      }]
    }))).toThrow("Invalid code sync locator.");

    expect(() => normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [{
        nodeId: "node_root",
        locator: {
          sourcePath: "",
          astPath: "",
          sourceSpan: {
            start: { offset: 1, line: 1, column: 1 },
            end: { offset: 2, line: 1, column: 2 }
          }
        }
      }]
    }))).toThrow("Invalid code sync locator.");

    expect(() => normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [{
        nodeId: "node_root",
        locator: {
          sourcePath: "src/app.tsx",
          astPath: "exports.default",
          sourceSpan: {
            start: { offset: Number.NaN, line: 1, column: 1 },
            end: { offset: 2, line: 1, column: 2 }
          }
        }
      }]
    }))).toThrow("Invalid code sync locator positions.");
  });

  it("drops non-array and malformed node mappings during normalization", () => {
    expect(normalizeCodeSyncManifest(buildManifest({
      nodeMappings: null as unknown as CodeSyncManifest["nodeMappings"]
    })).nodeMappings).toEqual([]);

    const normalized = normalizeCodeSyncManifest(buildManifest({
      nodeMappings: [
        { nodeId: "node_root", locator: buildLocator() },
        { locator: buildLocator() } as unknown as CodeSyncManifest["nodeMappings"][number]
      ]
    }));

    expect(normalized.nodeMappings).toHaveLength(1);
    expect(normalized.nodeMappings[0]?.nodeId).toBe("node_root");
  });

  it("normalizes legacy manifest adapter arrays and plugin metadata fallbacks", () => {
    const normalized = normalizeCodeSyncManifest({
      ...buildManifest({
        adapter: "acme/astro-v1",
        frameworkAdapterId: "" as unknown as CodeSyncManifest["frameworkAdapterId"],
        frameworkId: "" as unknown as CodeSyncManifest["frameworkId"],
        sourceFamily: "" as unknown as CodeSyncManifest["sourceFamily"],
        adapterKind: "" as unknown as CodeSyncManifest["adapterKind"],
        adapterVersion: Number.NaN as unknown as CodeSyncManifest["adapterVersion"],
        repoPath: "src/routes/App.vue",
        pluginId: "   " as unknown as CodeSyncManifest["pluginId"],
        libraryAdapterIds: undefined as unknown as CodeSyncManifest["libraryAdapterIds"],
        rootLocator: null as unknown as CodeSyncManifest["rootLocator"]
      }),
      libraryAdapters: ["", " adapter.one ", "adapter.one", 42, "adapter.two"]
    } as unknown as CodeSyncManifest & { libraryAdapters: unknown[] });

    expect(normalized.frameworkAdapterId).toBe("acme/astro-v1");
    expect(normalized.frameworkId).toBe("vue");
    expect(normalized.sourceFamily).toBe("vue-sfc");
    expect(normalized.adapterKind).toBe("plugin");
    expect(normalized.pluginId).toBe("acme");
    expect(normalized.libraryAdapterIds).toEqual(["adapter.one", "adapter.two"]);
    expect(normalized.rootLocator).toEqual({ kind: "vue-template" });
  });

  it("normalizes manifest identity and selector fallbacks when optional metadata is blank or invalid", () => {
    const normalized = normalizeCodeSyncManifest(buildManifest({
      adapter: "   " as unknown as CodeSyncManifest["adapter"],
      frameworkAdapterId: "   " as unknown as CodeSyncManifest["frameworkAdapterId"],
      frameworkId: "   " as unknown as CodeSyncManifest["frameworkId"],
      sourceFamily: "   " as unknown as CodeSyncManifest["sourceFamily"],
      adapterKind: "   " as unknown as CodeSyncManifest["adapterKind"],
      adapterVersion: Number.NaN as unknown as CodeSyncManifest["adapterVersion"],
      repoPath: "src/App.svelte",
      manifestVersion: Number.NaN as unknown as CodeSyncManifest["manifestVersion"],
      rootLocator: {
        kind: "dom-selector",
        selector: " #app "
      } as unknown as CodeSyncManifest["rootLocator"],
      reasonCode: "   " as unknown as CodeSyncManifest["reasonCode"]
    }));

    expect(normalized).toMatchObject({
      manifestVersion: 2,
      adapter: "builtin:svelte-sfc-v1",
      frameworkAdapterId: "builtin:svelte-sfc-v1",
      frameworkId: "svelte",
      sourceFamily: "svelte-sfc",
      adapterKind: "svelte-sfc",
      adapterVersion: 1,
      reasonCode: "none",
      rootLocator: {
        kind: "svelte-markup",
        selector: "#app"
      }
    });
  });

  it("routes blank or invalid manifest repoPath values through the required repoPath guard", () => {
    expect(() => normalizeCodeSyncManifest(buildManifest({
      repoPath: "   " as unknown as CodeSyncManifest["repoPath"]
    }))).toThrow("codeSync.repoPath is required.");

    expect(() => normalizeCodeSyncManifest(buildManifest({
      repoPath: null as unknown as CodeSyncManifest["repoPath"]
    }))).toThrow("codeSync.repoPath is required.");
  });

  it("writes source files atomically and finalizes manifest timestamps with fallback preservation", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-code-sync-"));
    const repoPath = join(root, "src/components/App.tsx");
    await writeCodeSyncSource(repoPath, "export const App = () => <main />;\n");

    await expect(readFile(repoPath, "utf8")).resolves.toBe("export const App = () => <main />;\n");

    const manifest = buildManifest({
      lastImportedAt: "2026-03-12T03:00:00.000Z",
      lastPushedAt: "2026-03-12T04:00:00.000Z"
    });

    expect(finalizeCodeSyncManifest(manifest, {
      sourceHash: "hash_next",
      documentRevision: 4,
      lastImportedAt: "2026-03-12T05:00:00.000Z"
    })).toMatchObject({
      sourceHash: "hash_next",
      documentRevision: 4,
      lastImportedAt: "2026-03-12T05:00:00.000Z",
      lastPushedAt: "2026-03-12T04:00:00.000Z"
    });

    expect(finalizeCodeSyncManifest(manifest, {
      sourceHash: "hash_final",
      documentRevision: 5,
      lastPushedAt: "2026-03-12T06:00:00.000Z"
    })).toMatchObject({
      sourceHash: "hash_final",
      documentRevision: 5,
      lastImportedAt: "2026-03-12T03:00:00.000Z",
      lastPushedAt: "2026-03-12T06:00:00.000Z"
    });
  });
});
