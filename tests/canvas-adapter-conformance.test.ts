import { readFileSync } from "fs";
import { readdir } from "fs/promises";
import { relative, join } from "path";
import { describe, expect, it } from "vitest";
import { loadCanvasAdapterPlugins } from "../src/canvas/adapter-plugins/loader";
import { importCodeSyncGraph } from "../src/canvas/code-sync/import";
import {
  DEFAULT_CODE_SYNC_OWNERSHIP,
  normalizeCodeSyncBindingMetadata,
  type CanvasCodeSyncBindingMetadata,
  type CodeSyncCapability,
  type CodeSyncSourceFamily
} from "../src/canvas/code-sync/types";
import { CanvasDocumentStore, createDefaultCanvasDocument } from "../src/canvas/document-store";
import { renderCanvasBindingHtml } from "../src/canvas/export";
import { createFrameworkAdapterRegistry } from "../src/canvas/framework-adapters/registry";
import type { CanvasFrameworkAdapter } from "../src/canvas/framework-adapters/types";
import { createLibraryAdapterRegistry } from "../src/canvas/library-adapters/registry";
import { tokenPathToCssVar } from "../src/canvas/token-references";
import type { CanvasBinding, CanvasNode } from "../src/canvas/types";

const FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "canvas", "frameworks");

const BUILT_IN_CASES = [
  {
    adapterId: "builtin:react-tsx-v2",
    frameworkId: "react",
    sourceFamily: "react-tsx",
    repoPath: "tests/fixtures/canvas/frameworks/react-dashboard.fixture.tsx",
    fileName: "react-dashboard.fixture.tsx",
    exportName: "DashboardHero"
  },
  {
    adapterId: "builtin:html-static-v1",
    frameworkId: "html",
    sourceFamily: "html-static",
    repoPath: "tests/fixtures/canvas/frameworks/landing.fixture.html",
    fileName: "landing.fixture.html"
  },
  {
    adapterId: "builtin:custom-elements-v1",
    frameworkId: "custom-elements",
    sourceFamily: "custom-elements",
    repoPath: "tests/fixtures/canvas/frameworks/custom-elements.fixture.html",
    fileName: "custom-elements.fixture.html"
  },
  {
    adapterId: "builtin:vue-sfc-v1",
    frameworkId: "vue",
    sourceFamily: "vue-sfc",
    repoPath: "tests/fixtures/canvas/frameworks/profile-card.fixture.vue",
    fileName: "profile-card.fixture.vue"
  },
  {
    adapterId: "builtin:svelte-sfc-v1",
    frameworkId: "svelte",
    sourceFamily: "svelte-sfc",
    repoPath: "tests/fixtures/canvas/frameworks/banner.fixture.svelte",
    fileName: "banner.fixture.svelte"
  }
] as const satisfies Array<{
  adapterId: string;
  frameworkId: string;
  sourceFamily: CodeSyncSourceFamily;
  repoPath: string;
  fileName: string;
  exportName?: string;
}>;

function readFixture(fileName: string): string {
  return readFileSync(join(FIXTURE_ROOT, fileName), "utf8");
}

function guessReactExportName(sourceText: string): string | undefined {
  const directMatch = sourceText.match(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/);
  if (directMatch?.[1]) {
    return directMatch[1];
  }
  const constMatch = sourceText.match(/export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/);
  return constMatch?.[1];
}

function frameworkIdFromSourceFamily(sourceFamily: CodeSyncSourceFamily): string {
  switch (sourceFamily) {
    case "react-tsx":
      return "react";
    case "vue-sfc":
      return "vue";
    case "svelte-sfc":
      return "svelte";
    case "custom-elements":
      return "custom-elements";
    default:
      return "html";
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function createMetadata(options: {
  adapterId: string;
  repoPath: string;
  sourceFamily: CodeSyncSourceFamily;
  frameworkId?: string;
  adapterKind?: string;
  adapterVersion?: number;
  capabilities: CodeSyncCapability[];
  sourceText: string;
  exportName?: string;
}): CanvasCodeSyncBindingMetadata {
  const exportName = options.exportName ?? (
    options.sourceFamily === "react-tsx"
      ? guessReactExportName(options.sourceText)
      : undefined
  );
  return normalizeCodeSyncBindingMetadata({
    adapter: options.adapterId,
    frameworkAdapterId: options.adapterId,
    frameworkId: options.frameworkId ?? frameworkIdFromSourceFamily(options.sourceFamily),
    sourceFamily: options.sourceFamily,
    adapterKind: options.adapterKind ?? (options.adapterId.startsWith("builtin:") ? "builtin" : "plugin"),
    adapterVersion: options.adapterVersion ?? 1,
    repoPath: options.repoPath,
    exportName,
    syncMode: "manual",
    ownership: { ...DEFAULT_CODE_SYNC_OWNERSHIP },
    declaredCapabilities: [...options.capabilities],
    grantedCapabilities: options.capabilities.map((capability) => ({
      capability,
      granted: true
    }))
  });
}

function createBinding(nodeId: string, metadata: CanvasCodeSyncBindingMetadata): CanvasBinding {
  return {
    id: `binding_${metadata.frameworkAdapterId.replace(/[^a-z0-9]+/gi, "_")}`,
    nodeId,
    kind: "code-sync",
    codeSync: metadata,
    metadata: {}
  };
}

function assertTokenHookBehavior(
  adapter: CanvasFrameworkAdapter,
  metadata: CanvasCodeSyncBindingMetadata,
  sourceText: string
): void {
  const tokenContext = {
    bindingId: "binding_token_hook",
    metadata,
    activeModeId: "night"
  };
  if (metadata.declaredCapabilities.includes("token_roundtrip")) {
    const parsed = adapter.parseSource(
      adapter.detectEntrypoint(metadata.repoPath, sourceText, { metadata })!,
      sourceText,
      { bindingId: tokenContext.bindingId, metadata },
      createLibraryAdapterRegistry()
    );
    expect(adapter.readTokenRefs(parsed.graph, tokenContext)).toMatchObject({
      [parsed.graph.rootKey]: {
        backgroundColor: "theme.primary"
      }
    });
    const document = createDefaultCanvasDocument("dc_token_hook");
    const rootNode = document.pages[0]!.nodes.find((node) => node.id === document.pages[0]!.rootNodeId)!;
    rootNode.tokenRefs = { backgroundColor: "theme.primary" };
    const emitted = adapter.emitTokenRefs({
      ...rootNode
    } satisfies CanvasNode, tokenContext);
    expect(emitted).toEqual({
      backgroundColor: tokenPathToCssVar("theme.primary")
    });
    expect(adapter.emitThemeBindings(tokenContext)).toMatchObject({
      "data-token-mode": "night",
      "data-theme": "night"
    });
    return;
  }

  const document = createDefaultCanvasDocument("dc_token_hook_static");
  const rootNode = document.pages[0]!.nodes.find((node) => node.id === document.pages[0]!.rootNodeId)!;
  rootNode.tokenRefs = { backgroundColor: "theme.primary" };
  const emitted = adapter.emitTokenRefs({
    ...rootNode
  } satisfies CanvasNode, tokenContext);
  expect(emitted).toEqual({});
  expect(adapter.emitThemeBindings(tokenContext)).toEqual({});
}

function runAdapterConformanceCase(params: {
  adapter: CanvasFrameworkAdapter;
  metadata: CanvasCodeSyncBindingMetadata;
  sourceText: string;
  expectedFrameworkId?: string;
}): void {
  const libraryRegistry = createLibraryAdapterRegistry();
  const bindingId = `binding_${params.adapter.id.replace(/[^a-z0-9]+/gi, "_")}`;
  const entrypoint = params.adapter.detectEntrypoint(params.metadata.repoPath, params.sourceText, {
    metadata: params.metadata
  });
  expect(entrypoint).toBeTruthy();
  const parsed = params.adapter.parseSource(entrypoint!, params.sourceText, {
    bindingId,
    metadata: params.metadata
  }, libraryRegistry);
  const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
  expect(rootNode).toBeTruthy();
  const projection = params.adapter.buildProjectionDescriptor(rootNode!, {
    bindingId,
    metadata: params.metadata
  });

  expect(projection.adapterId).toBe(params.adapter.id);
  expect(projection.sourceFamily).toBe(params.metadata.sourceFamily);
  expect(projection.attributes["data-framework-adapter"]).toBe(params.adapter.id);
  expect(projection.frameworkId).toBe(params.expectedFrameworkId ?? projection.frameworkId);
  expect(parsed.rootLocator).toEqual(params.metadata.rootLocator);
  expect(params.adapter.resolveLibraryAdapters(params.sourceText, libraryRegistry).sort()).toEqual(parsed.libraryAdapterIds.sort());

  for (const node of Object.values(parsed.graph.nodes)) {
    expect(node.locator.sourcePath).toBe(params.metadata.repoPath);
    expect(node.locator.astPath.length).toBeGreaterThan(0);
    expect(node.locator.sourceSpan.start.line).toBeGreaterThan(0);
    expect(node.locator.sourceSpan.end.line).toBeGreaterThan(0);
  }

  const document = createDefaultCanvasDocument(`dc_${bindingId}`);
  const binding = createBinding(document.pages[0]!.rootNodeId, params.metadata);
  document.bindings = [binding];
  const imported = importCodeSyncGraph({
    document,
    binding,
    documentRevision: 1,
    graph: parsed.graph,
    tokenRefsByNodeKey: params.adapter.readTokenRefs(parsed.graph, {
      bindingId,
      metadata: params.metadata,
      activeModeId: "night"
    })
  });
  const store = new CanvasDocumentStore(document);
  store.applyPatches(1, imported.patches);
  const html = renderCanvasBindingHtml(store.getDocument(), binding.id);

  expect(imported.unsupportedRegions).toEqual(parsed.graph.unsupportedFragments);
  expect(html).not.toBeNull();
  if (!html) {
    return;
  }
  expect(html).toContain(`data-binding-id="${binding.id}"`);
  expect(html).toContain(`odb-node-${slugify(rootNode?.tagName ?? rootNode?.kind ?? "element")}`);
}

async function listFixtureFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFixtureFiles(absolute));
      continue;
    }
    files.push(absolute);
  }
  return files;
}

describe("canvas adapter conformance", () => {
  it.each(BUILT_IN_CASES)("built-in adapter conformance: $adapterId", ({ adapterId, frameworkId, sourceFamily, repoPath, fileName, exportName }) => {
    const frameworkRegistry = createFrameworkAdapterRegistry();
    const adapter = frameworkRegistry.get(adapterId);
    const sourceText = readFixture(fileName);
    const metadata = createMetadata({
      adapterId,
      repoPath,
      frameworkId,
      sourceFamily,
      sourceText,
      exportName,
      capabilities: adapter?.capabilities ?? []
    });

    expect(adapter).toBeTruthy();
    runAdapterConformanceCase({
      adapter: adapter!,
      metadata,
      sourceText,
      expectedFrameworkId: frameworkId
    });
  });

  it("built-in adapter conformance propagates unsupported fragments through import", () => {
    const frameworkRegistry = createFrameworkAdapterRegistry();
    const adapter = frameworkRegistry.get("builtin:react-tsx-v2");
    const sourceText = [
      "export function BrokenCard() {",
      "  const palette = { backgroundColor: \"var(--missing-token)\" };",
      "  return <section>{palette.backgroundColor}</section>;",
      "}",
      ""
    ].join("\n");
    const metadata = createMetadata({
      adapterId: "builtin:react-tsx-v2",
      frameworkId: "react",
      sourceFamily: "react-tsx",
      repoPath: "src/BrokenCard.tsx",
      sourceText,
      exportName: "BrokenCard",
      capabilities: adapter?.capabilities ?? []
    });
    const parsed = adapter!.parseSource(
      adapter!.detectEntrypoint(metadata.repoPath, sourceText, { metadata })!,
      sourceText,
      { bindingId: "binding_broken_card", metadata },
      createLibraryAdapterRegistry()
    );
    const document = createDefaultCanvasDocument("dc_broken_card");
    const binding = createBinding(document.pages[0]!.rootNodeId, metadata);
    document.bindings = [binding];
    const imported = importCodeSyncGraph({
      document,
      binding,
      documentRevision: 1,
      graph: parsed.graph
    });

    expect(parsed.graph.unsupportedFragments.map((fragment) => fragment.reason)).toContain("unsupported_jsx_expression");
    expect(imported.unsupportedRegions).toEqual(parsed.graph.unsupportedFragments);
  });

  it("built-in adapter conformance enforces token IO hook behavior", () => {
    const frameworkRegistry = createFrameworkAdapterRegistry();
    const reactAdapter = frameworkRegistry.get("builtin:react-tsx-v2");
    const reactSource = [
      "export function TokenHero() {",
      `  return <section style={{ backgroundColor: \"${tokenPathToCssVar("theme.primary")}\" }} />;`,
      "}",
      ""
    ].join("\n");
    const reactMetadata = createMetadata({
      adapterId: "builtin:react-tsx-v2",
      frameworkId: "react",
      sourceFamily: "react-tsx",
      repoPath: "src/TokenHero.tsx",
      sourceText: reactSource,
      exportName: "TokenHero",
      capabilities: reactAdapter?.capabilities ?? []
    });
    assertTokenHookBehavior(reactAdapter!, reactMetadata, reactSource);

    const htmlAdapter = frameworkRegistry.get("builtin:html-static-v1");
    const htmlSource = "<main><section>Static</section></main>\n";
    const htmlMetadata = createMetadata({
      adapterId: "builtin:html-static-v1",
      frameworkId: "html",
      sourceFamily: "html-static",
      repoPath: "src/static.html",
      sourceText: htmlSource,
      capabilities: htmlAdapter?.capabilities ?? []
    });
    assertTokenHookBehavior(htmlAdapter!, htmlMetadata, htmlSource);
  });

  it("configured plugin fixtures satisfy the shared adapter contract and lifecycle cleanup", async () => {
    const configDeclarations = process.env.CANVAS_VALIDATION_CONFIG_DECLARATIONS_JSON
      ? JSON.parse(process.env.CANVAS_VALIDATION_CONFIG_DECLARATIONS_JSON)
      : [];
    const frameworkRegistry = createFrameworkAdapterRegistry();
    const libraryRegistry = createLibraryAdapterRegistry();
    const loaded = await loadCanvasAdapterPlugins({
      worktree: process.cwd(),
      configDeclarations,
      frameworkRegistry,
      libraryRegistry
    });

    expect(loaded.errors).toEqual([]);
    if (loaded.plugins.length === 0) {
      return;
    }

    for (const plugin of loaded.plugins) {
      const bindingId = `binding_${plugin.manifest.pluginId}`;
      await plugin.definition.onBind({ bindingId });
      await plugin.definition.onUnbind({ bindingId });
      const fixtureFiles = await listFixtureFiles(plugin.fixtureDir);

      for (const descriptor of plugin.manifest.frameworkAdapters) {
        const adapter = frameworkRegistry.get(descriptor.id);
        expect(adapter).toBeTruthy();
        const matchedFiles = fixtureFiles.filter((filePath) => adapter!.fileMatchers.some((matcher) => matcher.test(filePath)));
        expect(matchedFiles.length).toBeGreaterThan(0);

        for (const filePath of matchedFiles) {
          const sourceText = readFileSync(filePath, "utf8");
          const repoPath = relative(process.cwd(), filePath).replaceAll("\\", "/");
          const metadata = createMetadata({
            adapterId: descriptor.id,
            repoPath,
            frameworkId: frameworkIdFromSourceFamily(adapter!.sourceFamily),
            sourceFamily: adapter!.sourceFamily,
            adapterKind: "plugin",
            adapterVersion: descriptor.adapterVersion,
            capabilities: adapter!.capabilities,
            sourceText
          });
          runAdapterConformanceCase({
            adapter: adapter!,
            metadata,
            sourceText
          });
        }
      }

      await plugin.definition.dispose({ worktree: process.cwd() });
    }
  });
});
