import { extractSourceImports } from "../library-adapters/registry";
import { parseMarkupToCodeSyncGraph } from "./markup";
import type { CanvasFrameworkAdapter } from "./types";

function extractSvelteMarkup(sourceText: string): string {
  const withoutModuleScript = sourceText.replace(/<script[^>]*context=["']module["'][^>]*>[\s\S]*?<\/script>/gi, "");
  const withoutScripts = withoutModuleScript.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  const withoutStyles = withoutScripts.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  return withoutStyles.trim();
}

export const SVELTE_SFC_V1_ADAPTER: CanvasFrameworkAdapter = {
  id: "builtin:svelte-sfc-v1",
  displayName: "Svelte SFC v1",
  sourceFamily: "svelte-sfc",
  sourceDialects: ["svelte"],
  fileMatchers: [/\.svelte$/i],
  capabilities: ["preview", "inventory_extract", "code_pull"],
  detectEntrypoint: (filePath, sourceText, detectContext) => ({
    filePath,
    sourceText,
    rootLocator: detectContext.metadata.rootLocator
  }),
  parseSource: (entrypoint, sourceText, parseContext) => {
    const markup = extractSvelteMarkup(sourceText);
    return {
      graph: parseMarkupToCodeSyncGraph({
        bindingId: parseContext.bindingId,
        filePath: entrypoint.filePath,
        sourceText: markup || "<div></div>",
        metadata: parseContext.metadata,
        rootLocator: parseContext.metadata.rootLocator
      }),
      rootLocator: parseContext.metadata.rootLocator,
      imports: extractSourceImports(sourceText),
      libraryAdapterIds: [],
      feedback: markup ? [] : ["framework_construct_unsupported"]
    };
  },
  emitSource: () => null,
  buildProjectionDescriptor: () => ({
    frameworkId: "svelte",
    adapterId: "builtin:svelte-sfc-v1",
    sourceFamily: "svelte-sfc",
    attributes: {
      "data-framework-id": "svelte",
      "data-framework-adapter": "builtin:svelte-sfc-v1"
    },
    metadata: {}
  }),
  readTokenRefs: () => ({}),
  emitTokenRefs: () => ({}),
  emitThemeBindings: () => ({}),
  resolveLibraryAdapters: () => [],
  fallbackReason: () => null,
  grantCapabilities: (metadata) => metadata.grantedCapabilities.map((entry) => ({ ...entry }))
};
