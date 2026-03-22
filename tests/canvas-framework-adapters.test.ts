import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { normalizeCodeSyncBindingMetadata, type CanvasCodeSyncBindingMetadata } from "../src/canvas/code-sync/types";
import type { CanvasFrameworkAdapter, CanvasFrameworkParseResult } from "../src/canvas/framework-adapters/types";
import { createFrameworkAdapterRegistry } from "../src/canvas/framework-adapters/registry";
import { createLibraryAdapterRegistry } from "../src/canvas/library-adapters/registry";
import { tokenPathToCssVar } from "../src/canvas/token-references";
import type { CanvasNode } from "../src/canvas/types";

const FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "canvas", "frameworks");

function readFixture(fileName: string): string {
  return readFileSync(join(FIXTURE_ROOT, fileName), "utf8");
}

function createMetadata(
  repoPath: string,
  overrides: Partial<CanvasCodeSyncBindingMetadata> = {}
): CanvasCodeSyncBindingMetadata {
  return normalizeCodeSyncBindingMetadata({
    adapter: overrides.frameworkAdapterId ?? overrides.adapter ?? "builtin:react-tsx-v2",
    frameworkAdapterId: overrides.frameworkAdapterId,
    repoPath,
    exportName: overrides.exportName,
    selector: overrides.selector,
    syncMode: "manual",
    ownership: {},
    ...overrides
  });
}

function createCanvasNode(tokenRefs: Record<string, unknown> = {}): CanvasNode {
  return {
    id: "canvas-node",
    kind: "element",
    name: "Canvas node",
    pageId: "page",
    parentId: null,
    childIds: [],
    rect: {
      x: 0,
      y: 0,
      width: 1,
      height: 1
    },
    props: {},
    style: {},
    tokenRefs,
    bindingRefs: {},
    variantPatches: [],
    metadata: {}
  };
}

function expectPassiveAdapterHelpers(
  adapter: CanvasFrameworkAdapter,
  parsed: CanvasFrameworkParseResult,
  metadata: CanvasCodeSyncBindingMetadata,
  bindingId: string,
  sourceText: string
): void {
  const tokenContext = {
    bindingId,
    metadata,
    activeModeId: "dark"
  };
  const grantedCapabilities = adapter.grantCapabilities(metadata);

  expect(adapter.emitSource(parsed.graph, { bindingId, metadata })).toBeNull();
  expect(adapter.readTokenRefs(parsed.graph, tokenContext)).toEqual({});
  expect(adapter.emitTokenRefs(createCanvasNode(), tokenContext)).toEqual({});
  expect(adapter.emitThemeBindings(tokenContext)).toEqual({});
  expect(adapter.resolveLibraryAdapters(sourceText, createLibraryAdapterRegistry())).toEqual([]);
  expect(adapter.fallbackReason(parsed.graph.nodes[parsed.graph.rootKey]!)).toBeNull();
  expect(grantedCapabilities).toEqual(metadata.grantedCapabilities);
  expect(grantedCapabilities).not.toBe(metadata.grantedCapabilities);
}

describe("canvas framework adapters", () => {
  it("covers registry detection, missing lookups, and duplicate registration guards", () => {
    const registry = createFrameworkAdapterRegistry();

    expect(registry.detectForPath("src/Hero.tsx")?.id).toBe("builtin:react-tsx-v2");
    expect(registry.detectForPath("src/Profile.vue")?.id).toBe("builtin:vue-sfc-v1");
    expect(registry.detectForPath("src/Banner.svelte")?.id).toBe("builtin:svelte-sfc-v1");
    expect(registry.detectForPath("src/landing.html")?.id).toBe("builtin:html-static-v1");
    expect(registry.detectForPath("src/plain.ts")?.id).toBe("builtin:custom-elements-v1");
    expect(registry.detectForPath("src/plain.css")).toBeNull();
    expect(registry.get("missing")).toBeNull();
    expect(registry.resolveForBinding(createMetadata("src/unknown.tsx", {
      adapter: "missing",
      frameworkAdapterId: "missing",
      exportName: "Unknown"
    }))).toBeNull();
    expect(() => registry.register(registry.get("builtin:vue-sfc-v1")!)).toThrow("duplicate_adapter_id:builtin:vue-sfc-v1");
  });

  it("covers the react-dashboard fixture through react-tsx-v2 with projection and library resolution", () => {
    const registry = createFrameworkAdapterRegistry();
    const libraryRegistry = createLibraryAdapterRegistry();
    const repoPath = "tests/fixtures/canvas/frameworks/react-dashboard.fixture.tsx";
    const metadata = createMetadata(repoPath, {
      adapter: "builtin:react-tsx-v2",
      frameworkAdapterId: "builtin:react-tsx-v2",
      exportName: "DashboardHero"
    });
    const adapter = registry.resolveForBinding(metadata);
    const sourceText = readFixture("react-dashboard.fixture.tsx");

    expect(adapter?.id).toBe("builtin:react-tsx-v2");

    const entrypoint = adapter?.detectEntrypoint(repoPath, sourceText, { metadata });
    expect(entrypoint).toBeTruthy();

    const parsed = adapter!.parseSource(entrypoint!, sourceText, {
      bindingId: "binding_react_dashboard",
      metadata
    }, libraryRegistry);
    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];
    const projection = adapter!.buildProjectionDescriptor(rootNode!, {
      bindingId: "binding_react_dashboard",
      metadata
    });

    expect(parsed.rootLocator).toEqual({ kind: "react-export", exportName: "DashboardHero" });
    expect(rootNode?.tagName).toBe("main");
    expect(parsed.graph.frameworkAdapterId).toBe("builtin:react-tsx-v2");
    expect(parsed.graph.frameworkId).toBe("react");
    expect(parsed.libraryAdapterIds.sort()).toEqual([
      "builtin:react/framer-motion",
      "builtin:react/lucide-react",
      "builtin:react/shadcn-ui"
    ]);
    expect(adapter!.resolveLibraryAdapters(sourceText, libraryRegistry).sort()).toEqual(parsed.libraryAdapterIds.sort());
    expect(projection).toMatchObject({
      frameworkId: "react",
      adapterId: "builtin:react-tsx-v2",
      sourceFamily: "react-tsx",
      attributes: {
        "data-framework-id": "react",
        "data-framework-adapter": "builtin:react-tsx-v2"
      }
    });
    expect(adapter!.emitSource(parsed.graph, {
      bindingId: "binding_react_dashboard",
      metadata
    })).toBeNull();
    expect(adapter!.readTokenRefs({
      ...parsed.graph,
      nodes: {
        ...parsed.graph.nodes,
        [parsed.graph.rootKey]: {
          ...rootNode!,
          style: {
            ...rootNode!.style,
            opacity: 0.5,
            color: "var(--not-a-token)"
          }
        }
      }
    }, {
      bindingId: "binding_react_dashboard",
      metadata
    })).toEqual({});
    expect(adapter!.emitTokenRefs(createCanvasNode({
      color: { tokenPath: "palette/primary" },
      borderColor: { tokenPath: "   " }
    }), {
      bindingId: "binding_react_dashboard",
      metadata
    })).toEqual({
      color: tokenPathToCssVar("palette/primary")
    });
    expect(adapter!.emitThemeBindings({
      bindingId: "binding_react_dashboard",
      metadata
    })).toEqual({});
    expect(adapter!.fallbackReason(rootNode!)).toBeNull();
    const grantedCapabilities = adapter!.grantCapabilities(metadata);
    expect(grantedCapabilities).toEqual(metadata.grantedCapabilities);
    expect(grantedCapabilities).not.toBe(metadata.grantedCapabilities);
  });

  it("covers the landing html fixture through html-static-v1", () => {
    const registry = createFrameworkAdapterRegistry();
    const repoPath = "tests/fixtures/canvas/frameworks/landing.fixture.html";
    const metadata = createMetadata(repoPath, {
      adapter: "builtin:html-static-v1",
      frameworkAdapterId: "builtin:html-static-v1"
    });
    const adapter = registry.resolveForBinding(metadata);
    const sourceText = readFixture("landing.fixture.html");
    const parsed = adapter!.parseSource(adapter!.detectEntrypoint(repoPath, sourceText, { metadata })!, sourceText, {
      bindingId: "binding_html_landing",
      metadata
    }, createLibraryAdapterRegistry());
    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];

    expect(adapter?.id).toBe("builtin:html-static-v1");
    expect(parsed.rootLocator).toEqual({ kind: "document-root" });
    expect(rootNode?.tagName).toBe("main");
    expect(parsed.libraryAdapterIds).toEqual([]);
    expect(adapter!.buildProjectionDescriptor(rootNode!, { bindingId: "binding_html_landing", metadata })).toMatchObject({
      frameworkId: "html",
      adapterId: "builtin:html-static-v1",
      attributes: {
        "data-framework-id": "html",
        "data-framework-adapter": "builtin:html-static-v1"
      }
    });
    expectPassiveAdapterHelpers(adapter!, parsed, metadata, "binding_html_landing", sourceText);
  });

  it("covers the custom-elements fixture with explicit adapter binding and fallback semantics", () => {
    const registry = createFrameworkAdapterRegistry();
    const repoPath = "tests/fixtures/canvas/frameworks/custom-elements.fixture.html";
    const metadata = createMetadata(repoPath, {
      adapter: "builtin:custom-elements-v1",
      frameworkAdapterId: "builtin:custom-elements-v1"
    });
    const adapter = registry.resolveForBinding(metadata);
    const sourceText = readFixture("custom-elements.fixture.html");
    const parsed = adapter!.parseSource(adapter!.detectEntrypoint(repoPath, sourceText, { metadata })!, sourceText, {
      bindingId: "binding_custom_elements",
      metadata
    }, createLibraryAdapterRegistry());
    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];

    expect(adapter?.id).toBe("builtin:custom-elements-v1");
    expect(rootNode?.tagName).toBe("app-shell");
    expect(adapter!.fallbackReason(rootNode!)).toBeNull();
    expect(adapter!.fallbackReason({
      key: "plain",
      kind: "element",
      bindingId: "binding_custom_elements",
      locator: rootNode!.locator,
      tagName: "div",
      attributes: {},
      style: {},
      preservedAttributes: [],
      childKeys: []
    })).toBe("framework_construct_unsupported");
    expect(adapter!.buildProjectionDescriptor(rootNode!, { bindingId: "binding_custom_elements", metadata })).toMatchObject({
      frameworkId: "custom-elements",
      adapterId: "builtin:custom-elements-v1",
      attributes: {
        "data-framework-id": "custom-elements",
        "data-framework-adapter": "builtin:custom-elements-v1"
      }
    });
    expectPassiveAdapterHelpers(adapter!, parsed, metadata, "binding_custom_elements", sourceText);
  });

  it("covers the profile-card vue fixture through vue-sfc-v1", () => {
    const registry = createFrameworkAdapterRegistry();
    const repoPath = "tests/fixtures/canvas/frameworks/profile-card.fixture.vue";
    const metadata = createMetadata(repoPath, {
      adapter: "builtin:vue-sfc-v1",
      frameworkAdapterId: "builtin:vue-sfc-v1"
    });
    const adapter = registry.resolveForBinding(metadata);
    const sourceText = readFixture("profile-card.fixture.vue");
    const parsed = adapter!.parseSource(adapter!.detectEntrypoint(repoPath, sourceText, { metadata })!, sourceText, {
      bindingId: "binding_vue_profile",
      metadata
    }, createLibraryAdapterRegistry());
    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];

    expect(adapter?.id).toBe("builtin:vue-sfc-v1");
    expect(parsed.rootLocator).toEqual({ kind: "vue-template" });
    expect(rootNode?.tagName).toBe("section");
    expect(parsed.feedback).toEqual([]);
    expect(adapter!.buildProjectionDescriptor(rootNode!, { bindingId: "binding_vue_profile", metadata })).toMatchObject({
      frameworkId: "vue",
      adapterId: "builtin:vue-sfc-v1"
    });
    expectPassiveAdapterHelpers(adapter!, parsed, metadata, "binding_vue_profile", sourceText);
  });

  it("covers the banner svelte fixture through svelte-sfc-v1", () => {
    const registry = createFrameworkAdapterRegistry();
    const repoPath = "tests/fixtures/canvas/frameworks/banner.fixture.svelte";
    const metadata = createMetadata(repoPath, {
      adapter: "builtin:svelte-sfc-v1",
      frameworkAdapterId: "builtin:svelte-sfc-v1"
    });
    const adapter = registry.resolveForBinding(metadata);
    const sourceText = readFixture("banner.fixture.svelte");
    const parsed = adapter!.parseSource(adapter!.detectEntrypoint(repoPath, sourceText, { metadata })!, sourceText, {
      bindingId: "binding_svelte_banner",
      metadata
    }, createLibraryAdapterRegistry());
    const rootNode = parsed.graph.nodes[parsed.graph.rootKey];

    expect(adapter?.id).toBe("builtin:svelte-sfc-v1");
    expect(parsed.rootLocator).toEqual({ kind: "svelte-markup" });
    expect(rootNode?.tagName).toBe("main");
    expect(parsed.feedback).toEqual([]);
    expect(adapter!.buildProjectionDescriptor(rootNode!, { bindingId: "binding_svelte_banner", metadata })).toMatchObject({
      frameworkId: "svelte",
      adapterId: "builtin:svelte-sfc-v1"
    });
    expectPassiveAdapterHelpers(adapter!, parsed, metadata, "binding_svelte_banner", sourceText);
  });

  it("falls back to a safe div container when vue or svelte markup is missing", () => {
    const registry = createFrameworkAdapterRegistry();
    const libraryRegistry = createLibraryAdapterRegistry();
    const vueMetadata = createMetadata("src/Empty.vue", {
      adapter: "builtin:vue-sfc-v1",
      frameworkAdapterId: "builtin:vue-sfc-v1"
    });
    const svelteMetadata = createMetadata("src/Empty.svelte", {
      adapter: "builtin:svelte-sfc-v1",
      frameworkAdapterId: "builtin:svelte-sfc-v1"
    });
    const vueAdapter = registry.resolveForBinding(vueMetadata)!;
    const svelteAdapter = registry.resolveForBinding(svelteMetadata)!;
    const emptyVueSource = "<script setup>const value = 1;</script>";
    const emptySvelteSource = "<script>export let name;</script><style>main { color: red; }</style>";
    const parsedVue = vueAdapter.parseSource(
      vueAdapter.detectEntrypoint("src/Empty.vue", emptyVueSource, { metadata: vueMetadata })!,
      emptyVueSource,
      {
        bindingId: "binding_vue_empty",
        metadata: vueMetadata
      },
      libraryRegistry
    );
    const parsedSvelte = svelteAdapter.parseSource(
      svelteAdapter.detectEntrypoint("src/Empty.svelte", emptySvelteSource, { metadata: svelteMetadata })!,
      emptySvelteSource,
      {
        bindingId: "binding_svelte_empty",
        metadata: svelteMetadata
      },
      libraryRegistry
    );

    expect(parsedVue.graph.nodes[parsedVue.graph.rootKey]?.tagName).toBe("div");
    expect(parsedVue.feedback).toEqual(["framework_construct_unsupported"]);
    expect(parsedSvelte.graph.nodes[parsedSvelte.graph.rootKey]?.tagName).toBe("div");
    expect(parsedSvelte.feedback).toEqual(["framework_construct_unsupported"]);
  });
});
