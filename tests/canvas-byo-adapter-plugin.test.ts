import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCanvasAdapterPlugins } from "../src/canvas/adapter-plugins/loader";
import { parseCanvasAdapterPluginManifest } from "../src/canvas/adapter-plugins/manifest";
import type { CanvasAdapterPluginDeclaration } from "../src/canvas/adapter-plugins/types";
import { validatePluginTrust } from "../src/canvas/adapter-plugins/validator";
import { createFrameworkAdapterRegistry } from "../src/canvas/framework-adapters/registry";
import { createLibraryAdapterRegistry, extractSourceImports } from "../src/canvas/library-adapters/registry";

const createdRoots: string[] = [];

function pluginManifest(pluginId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0",
    adapterApiVersion: "1.0.0",
    pluginId,
    displayName: `${pluginId} plugin`,
    version: "1.0.0",
    engine: { opendevbrowser: ">=0.0.0" },
    entry: "./plugin.mjs",
    moduleFormat: "esm",
    frameworkAdapters: [{
      id: `${pluginId}:astro-v1`,
      sourceFamily: "html-static",
      adapterKind: "plugin",
      adapterVersion: 1,
      moduleExport: "ASTRO_FRAMEWORK",
      capabilities: ["preview", "inventory_extract", "code_pull"],
      fileMatchers: ["\\.astro$"]
    }],
    libraryAdapters: [{
      id: `${pluginId}:astro-ui`,
      frameworkId: "astro",
      kind: "components",
      resolutionStrategy: "import",
      moduleExport: "ASTRO_UI",
      capabilities: ["preview", "inventory_extract", "code_pull"],
      packages: ["acme/ui"]
    }],
    capabilities: ["preview", "inventory_extract", "code_pull"],
    fixtureDir: "./fixtures",
    trustedWorkspaceRoots: [],
    packageRoot: ".",
    sdkImport: "opendevbrowser/canvas-sdk",
    ...overrides
  };
}

function validPluginSource(): string {
  return `
export async function createCanvasAdapterPlugin({ manifest }) {
  const frameworkDescriptor = manifest.frameworkAdapters[0];
  const libraryDescriptor = manifest.libraryAdapters[0];
  const frameworkId = libraryDescriptor?.frameworkId ?? "astro";
  return {
    manifest,
    async initialize() {},
    async validateWorkspace() {},
    async registerFrameworkAdapters(registry) {
      registry.register({
        id: frameworkDescriptor.id,
        displayName: frameworkDescriptor.id,
        sourceFamily: frameworkDescriptor.sourceFamily,
        sourceDialects: ["astro"],
        fileMatchers: [/\\.astro$/i],
        capabilities: ["preview", "inventory_extract", "code_pull"],
        detectEntrypoint(filePath, sourceText, { metadata }) {
          return { filePath, sourceText, rootLocator: metadata.rootLocator };
        },
        parseSource(entrypoint, sourceText, parseContext) {
          return {
            graph: {
              adapter: parseContext.metadata.adapter,
              frameworkAdapterId: parseContext.metadata.frameworkAdapterId,
              frameworkId: parseContext.metadata.frameworkId,
              sourceFamily: parseContext.metadata.sourceFamily,
              bindingId: parseContext.bindingId,
              repoPath: parseContext.metadata.repoPath,
              rootKey: "root",
              nodes: {
                root: {
                  key: "root",
                  kind: "element",
                  bindingId: parseContext.bindingId,
                  locator: {
                    sourcePath: entrypoint.filePath,
                    astPath: "root",
                    sourceSpan: {
                      start: { offset: 0, line: 1, column: 1 },
                      end: { offset: sourceText.length, line: 1, column: sourceText.length + 1 }
                    }
                  },
                  tagName: "main",
                  attributes: {},
                  style: {},
                  preservedAttributes: [],
                  childKeys: []
                }
              },
              sourceHash: "plugin-source-hash",
              unsupportedFragments: [],
              libraryAdapterIds: libraryDescriptor ? [libraryDescriptor.id] : [],
              declaredCapabilities: [...parseContext.metadata.declaredCapabilities],
              grantedCapabilities: parseContext.metadata.grantedCapabilities.map((entry) => ({ ...entry }))
            },
            rootLocator: parseContext.metadata.rootLocator,
            imports: [],
            libraryAdapterIds: libraryDescriptor ? [libraryDescriptor.id] : [],
            feedback: []
          };
        },
        emitSource() { return null; },
        buildProjectionDescriptor() {
          return {
            frameworkId,
            adapterId: frameworkDescriptor.id,
            sourceFamily: frameworkDescriptor.sourceFamily,
            attributes: {
              "data-framework-id": frameworkId,
              "data-framework-adapter": frameworkDescriptor.id
            },
            metadata: {
              pluginId: manifest.pluginId
            }
          };
        },
        readTokenRefs() { return []; },
        emitTokenRefs() { return []; },
        emitThemeBindings() { return {}; },
        resolveLibraryAdapters() { return libraryDescriptor ? [libraryDescriptor.id] : []; },
        fallbackReason() { return null; },
        grantCapabilities(metadata) { return metadata.grantedCapabilities.map((entry) => ({ ...entry })); }
      });
    },
    async registerLibraryAdapters(registry) {
      if (!libraryDescriptor) {
        return;
      }
      registry.register({
        id: libraryDescriptor.id,
        frameworkId: libraryDescriptor.frameworkId,
        kind: libraryDescriptor.kind,
        resolutionStrategy: "import",
        capabilities: ["preview", "inventory_extract", "code_pull"],
        packages: libraryDescriptor.packages ?? [],
        sourceLocatorSchema: "import-specifier",
        matchesImport(importDecl) {
          return (libraryDescriptor.packages ?? []).includes(importDecl.source);
        },
        matchesSourceNode({ imports, componentName }) {
          return Boolean(componentName) && imports.some((entry) =>
            (libraryDescriptor.packages ?? []).includes(entry.source)
            && (entry.specifiers.includes(componentName) || entry.defaultImport === componentName)
          );
        },
        buildInventoryItem({ componentName }) {
          return componentName ? {
            componentName,
            metadata: {
              libraryAdapterId: libraryDescriptor.id
            }
          } : null;
        },
        buildProjectionDescriptor({ imports }) {
          const matched = imports.find((entry) => (libraryDescriptor.packages ?? []).includes(entry.source));
          return matched ? {
            attributes: {
              "data-library-adapter": libraryDescriptor.id,
              "data-library-source": matched.source
            },
            metadata: {
              source: matched.source
            }
          } : null;
        },
        emitSourceFragment() { return null; },
        extractVariantInfo() { return []; },
        extractTokenBindings() { return []; },
        fallbackReason({ componentName }) { return componentName ?? null; }
      });
    },
    async onBind() {},
    async onUnbind() {},
    async dispose() {}
  };
}
`.trimStart();
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function writePluginPackage(options: {
  packageRoot: string;
  pluginId: string;
  manifestOverrides?: Record<string, unknown>;
  entrySource?: string;
}): Promise<void> {
  await mkdir(join(options.packageRoot, "fixtures"), { recursive: true });
  await writeJson(join(options.packageRoot, "package.json"), {
    name: options.pluginId,
    type: "module"
  });
  await writeJson(join(options.packageRoot, "canvas-adapter.plugin.json"), pluginManifest(options.pluginId, options.manifestOverrides));
  await writeFile(join(options.packageRoot, "plugin.mjs"), options.entrySource ?? validPluginSource());
}

async function withWorktree(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

async function loadPlugins(
  worktree: string,
  configDeclarations?: CanvasAdapterPluginDeclaration[]
): Promise<Awaited<ReturnType<typeof loadCanvasAdapterPlugins>>> {
  return loadCanvasAdapterPlugins({
    worktree,
    configDeclarations,
    frameworkRegistry: createFrameworkAdapterRegistry(),
    libraryRegistry: createLibraryAdapterRegistry()
  });
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canvas BYO adapter plugins", () => {
  it("loads a repo-local package declaration and registers framework and library adapters without core edits", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const pluginRoot = join(worktree, "plugins", "acme");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: ["./plugins/acme"]
        }
      }
    });
    await writePluginPackage({
      packageRoot: pluginRoot,
      pluginId: "acme-plugin"
    });

    const frameworkRegistry = createFrameworkAdapterRegistry();
    const libraryRegistry = createLibraryAdapterRegistry();
    const result = await loadCanvasAdapterPlugins({
      worktree,
      frameworkRegistry,
      libraryRegistry
    });

    expect(result.errors).toEqual([]);
    expect(result.plugins).toHaveLength(1);
    expect(frameworkRegistry.get("acme-plugin:astro-v1")).toBeTruthy();
    expect(result.plugins[0]?.fixtureDir).toBe(join(pluginRoot, "fixtures"));
    expect(libraryRegistry.resolveForSource({
      frameworkId: "astro",
      sourceText: "import { Card } from 'acme/ui';",
      imports: extractSourceImports("import { Card } from 'acme/ui';")
    }).map((entry) => entry.id)).toContain("acme-plugin:astro-ui");
  });

  it("applies discovery precedence as repo over package and config over repo", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const pluginRoot = join(worktree, "plugins", "acme");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: [{ ref: "./plugins/acme", enabled: false }]
        }
      }
    });
    await writeJson(join(worktree, ".opendevbrowser", "canvas", "adapters.json"), {
      adapterPlugins: ["./plugins/acme"]
    });
    await writePluginPackage({
      packageRoot: pluginRoot,
      pluginId: "precedence-plugin"
    });

    const repoPreferred = await loadPlugins(worktree);
    expect(repoPreferred.errors).toEqual([]);
    expect(repoPreferred.plugins.map((entry) => entry.manifest.pluginId)).toEqual(["precedence-plugin"]);

    const configDisabled = await loadPlugins(worktree, [{ ref: "./plugins/acme", enabled: false }]);
    expect(configDisabled.errors).toEqual([]);
    expect(configDisabled.plugins).toEqual([]);
  });

  it("applies declaration-level trusted roots and capability overrides before plugin registration", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const pluginRoot = join(worktree, "plugins", "acme");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree"
    });
    await writePluginPackage({
      packageRoot: pluginRoot,
      pluginId: "override-plugin"
    });

    const frameworkRegistry = createFrameworkAdapterRegistry();
    const libraryRegistry = createLibraryAdapterRegistry();
    const result = await loadCanvasAdapterPlugins({
      worktree,
      configDeclarations: [{
        ref: "./plugins/acme",
        trustedWorkspaceRoots: ["./shared-read"],
        capabilityOverrides: ["preview"]
      }],
      frameworkRegistry,
      libraryRegistry
    });

    expect(result.errors).toEqual([]);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.manifest.trustedWorkspaceRoots).toContain("./shared-read");
    expect(result.plugins[0]?.manifest.capabilities).toEqual(["preview"]);
    expect(frameworkRegistry.get("override-plugin:astro-v1")?.capabilities).toEqual(["preview"]);
    expect(libraryRegistry.get("override-plugin:astro-ui")?.capabilities).toEqual(["preview"]);
  });

  it("loads direct manifest refs from config declarations even when the worktree has no package.json", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const pluginRoot = join(worktree, "plugins", "manifest-ref");
    await writePluginPackage({
      packageRoot: pluginRoot,
      pluginId: "manifest-ref-plugin"
    });

    const result = await loadCanvasAdapterPlugins({
      worktree,
      configDeclarations: ["./plugins/manifest-ref/canvas-adapter.plugin.json"],
      frameworkRegistry: createFrameworkAdapterRegistry(),
      libraryRegistry: createLibraryAdapterRegistry()
    });

    expect(result.errors).toEqual([]);
    expect(result.plugins.map((entry) => entry.manifest.pluginId)).toEqual(["manifest-ref-plugin"]);
  });

  it("loads repo-local plugin roots even when the plugin package omits package.json", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const pluginRoot = join(worktree, "plugins", "package-less");
    await mkdir(join(pluginRoot, "fixtures"), { recursive: true });
    await writeJson(join(pluginRoot, "canvas-adapter.plugin.json"), pluginManifest("package-less-plugin"));
    await writeFile(join(pluginRoot, "plugin.mjs"), validPluginSource());

    const result = await loadCanvasAdapterPlugins({
      worktree,
      configDeclarations: ["./plugins/package-less"],
      frameworkRegistry: createFrameworkAdapterRegistry(),
      libraryRegistry: createLibraryAdapterRegistry()
    });

    expect(result.errors).toEqual([]);
    expect(result.plugins.map((entry) => entry.manifest.pluginId)).toEqual(["package-less-plugin"]);
  });

  it("ignores repo adapter config files that omit adapterPlugins", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const pluginRoot = join(worktree, "plugins", "package-fallback");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: ["./plugins/package-fallback"]
        }
      }
    });
    await writeJson(join(worktree, ".opendevbrowser", "canvas", "adapters.json"), {
      note: "present but intentionally missing adapterPlugins"
    });
    await writePluginPackage({
      packageRoot: pluginRoot,
      pluginId: "package-fallback-plugin"
    });

    const result = await loadPlugins(worktree);

    expect(result.errors).toEqual([]);
    expect(result.plugins.map((entry) => entry.manifest.pluginId)).toEqual(["package-fallback-plugin"]);
  });

  it("reuses cached plugin loads when the manifest fingerprint is unchanged", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const pluginRoot = join(worktree, "plugins", "cached");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: ["./plugins/cached"]
        }
      }
    });
    await writePluginPackage({
      packageRoot: pluginRoot,
      pluginId: "cached-plugin"
    });

    const frameworkRegistry = createFrameworkAdapterRegistry();
    const libraryRegistry = createLibraryAdapterRegistry();
    const first = await loadCanvasAdapterPlugins({
      worktree,
      frameworkRegistry,
      libraryRegistry
    });
    const second = await loadCanvasAdapterPlugins({
      worktree,
      frameworkRegistry,
      libraryRegistry
    });

    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(second.plugins[0]).toBe(first.plugins[0]);
  });

  it("reports duplicate plugin ids deterministically", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: ["./plugins/one", "./plugins/two"]
        }
      }
    });
    await writePluginPackage({
      packageRoot: join(worktree, "plugins", "one"),
      pluginId: "duplicate-plugin"
    });
    await writePluginPackage({
      packageRoot: join(worktree, "plugins", "two"),
      pluginId: "duplicate-plugin"
    });

    const result = await loadPlugins(worktree);

    expect(result.plugins).toHaveLength(1);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "duplicate_plugin_id",
        pluginId: "duplicate-plugin",
        ref: "./plugins/two"
      })
    ]);
  });

  it("rejects out-of-worktree package declarations on trust boundaries", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const outsidePluginRoot = join(dirname(worktree), "outside-plugin");
    createdRoots.push(outsidePluginRoot);

    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: [outsidePluginRoot]
        }
      }
    });
    await writePluginPackage({
      packageRoot: outsidePluginRoot,
      pluginId: "outside-plugin"
    });

    const result = await loadPlugins(worktree);

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "trust_denied",
        ref: outsidePluginRoot
      })
    ]);
  });

  it("does not let manifest trusted workspace roots bypass package-source trust boundaries", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const outsidePluginRoot = join(dirname(worktree), "outside-plugin-trusted");
    createdRoots.push(outsidePluginRoot);

    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: [outsidePluginRoot]
        }
      }
    });
    await writePluginPackage({
      packageRoot: outsidePluginRoot,
      pluginId: "outside-trusted-plugin",
      manifestOverrides: {
        trustedWorkspaceRoots: [outsidePluginRoot]
      }
    });

    const result = await loadPlugins(worktree);

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "trust_denied",
        ref: outsidePluginRoot
      })
    ]);
  });

  it("rejects remote plugin specifiers before filesystem trust checks", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const manifest = parseCanvasAdapterPluginManifest(pluginManifest("remote-plugin"));

    await expect(validatePluginTrust({
      ref: "https://example.com/remote-plugin",
      packageRoot: worktree,
      manifest,
      worktree,
      source: "config"
    })).rejects.toThrow("trust_denied");
  });

  it("reports entry export and manifest packaging failures deterministically", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: ["./plugins/invalid-entry", "./plugins/invalid-manifest"]
        }
      }
    });
    await writePluginPackage({
      packageRoot: join(worktree, "plugins", "invalid-entry"),
      pluginId: "invalid-entry-plugin",
      entrySource: "export const notAFactory = true;\n"
    });
    await writePluginPackage({
      packageRoot: join(worktree, "plugins", "invalid-manifest"),
      pluginId: "invalid-manifest-plugin",
      manifestOverrides: {
        fixtureDir: undefined
      }
    });

    const result = await loadPlugins(worktree);

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "entry_export_invalid",
        ref: "./plugins/invalid-entry"
      }),
      expect.objectContaining({
        code: "plugin_manifest_invalid",
        ref: "./plugins/invalid-manifest"
      })
    ]));
  });

  it("reports missing plugin dependencies deterministically", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: ["./plugins/missing-dependency"]
        }
      }
    });
    await writePluginPackage({
      packageRoot: join(worktree, "plugins", "missing-dependency"),
      pluginId: "missing-dependency-plugin",
      entrySource: "import \"./missing-local.mjs\";\n" + validPluginSource()
    });

    const result = await loadPlugins(worktree);

    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "dependency_missing",
        ref: "./plugins/missing-dependency"
      })
    ]);
  });

  it("loads adapter plugins from node_modules package declarations", async () => {
    const worktree = await withWorktree("odb-canvas-plugin-");
    const pluginRoot = join(worktree, "node_modules", "@acme", "canvas-plugin");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: ["@acme/canvas-plugin"]
        }
      }
    });
    await writePluginPackage({
      packageRoot: pluginRoot,
      pluginId: "node-modules-plugin"
    });

    const result = await loadPlugins(worktree);

    expect(result.errors).toEqual([]);
    expect(result.plugins.map((entry) => entry.manifest.pluginId)).toEqual(["node-modules-plugin"]);
  });

  it("surfaces malformed worktree package metadata and plugin_load_failed string errors", async () => {
    const malformedWorktree = await withWorktree("odb-canvas-plugin-");
    await writeFile(join(malformedWorktree, "package.json"), "{ invalid json");

    await expect(loadPlugins(malformedWorktree)).rejects.toThrow();

    const worktree = await withWorktree("odb-canvas-plugin-");
    await writeJson(join(worktree, "package.json"), {
      name: "fixture-worktree",
      opendevbrowser: {
        canvas: {
          adapterPlugins: ["./plugins/string-failure", "./plugins/missing-registrations"]
        }
      }
    });
    await writePluginPackage({
      packageRoot: join(worktree, "plugins", "string-failure"),
      pluginId: "string-failure-plugin",
      entrySource: `
export async function createCanvasAdapterPlugin({ manifest }) {
  return {
    manifest,
    async initialize() {},
    async validateWorkspace() { throw "workspace exploded"; },
    async registerFrameworkAdapters() {},
    async registerLibraryAdapters() {},
    async onBind() {},
    async onUnbind() {},
    async dispose() {}
  };
}
`.trimStart()
    });
    await writePluginPackage({
      packageRoot: join(worktree, "plugins", "missing-registrations"),
      pluginId: "missing-registrations-plugin",
      manifestOverrides: {
        capabilities: ["preview"],
        frameworkAdapters: [{
          id: "missing-registrations:astro-v1",
          sourceFamily: "html-static",
          adapterKind: "plugin",
          adapterVersion: 1,
          moduleExport: "ASTRO_FRAMEWORK",
          capabilities: ["preview"],
          fileMatchers: ["\\.astro$"]
        }],
        libraryAdapters: [{
          id: "missing-registrations:astro-ui",
          frameworkId: "astro",
          kind: "components",
          resolutionStrategy: "import",
          moduleExport: "ASTRO_UI",
          capabilities: ["preview"],
          packages: ["acme/ui"]
        }]
      },
      entrySource: `
export async function createCanvasAdapterPlugin({ manifest }) {
  return {
    manifest,
    async initialize() {},
    async validateWorkspace() {},
    async registerFrameworkAdapters() {},
    async registerLibraryAdapters() {},
    async onBind() {},
    async onUnbind() {},
    async dispose() {}
  };
}
`.trimStart()
    });

    const result = await loadPlugins(worktree, [{
      ref: "./plugins/missing-registrations",
      capabilityOverrides: ["preview"]
    }]);

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "plugin_load_failed",
        ref: "./plugins/string-failure",
        message: "workspace exploded"
      })
    ]));
    expect(result.plugins.map((entry) => entry.manifest.pluginId)).toContain("missing-registrations-plugin");
  });
});
