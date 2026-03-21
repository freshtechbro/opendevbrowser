import { extractSourceImports } from "../library-adapters/registry";
import { parseMarkupToCodeSyncGraph } from "./markup";
import type { CanvasFrameworkAdapter } from "./types";

function extractVueTemplate(sourceText: string): string {
  const match = sourceText.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
  return match?.[1]?.trim() ?? "";
}

export const VUE_SFC_V1_ADAPTER: CanvasFrameworkAdapter = {
  id: "builtin:vue-sfc-v1",
  displayName: "Vue SFC v1",
  sourceFamily: "vue-sfc",
  sourceDialects: ["vue-sfc"],
  fileMatchers: [/\.vue$/i],
  capabilities: ["preview", "inventory_extract", "code_pull"],
  detectEntrypoint: (filePath, sourceText, detectContext) => ({
    filePath,
    sourceText,
    rootLocator: detectContext.metadata.rootLocator
  }),
  parseSource: (entrypoint, sourceText, parseContext) => {
    const template = extractVueTemplate(sourceText);
    return {
      graph: parseMarkupToCodeSyncGraph({
        bindingId: parseContext.bindingId,
        filePath: entrypoint.filePath,
        sourceText: template || "<div></div>",
        metadata: parseContext.metadata,
        rootLocator: parseContext.metadata.rootLocator
      }),
      rootLocator: parseContext.metadata.rootLocator,
      imports: extractSourceImports(sourceText),
      libraryAdapterIds: [],
      feedback: template ? [] : ["framework_construct_unsupported"]
    };
  },
  emitSource: () => null,
  buildProjectionDescriptor: () => ({
    frameworkId: "vue",
    adapterId: "builtin:vue-sfc-v1",
    sourceFamily: "vue-sfc",
    attributes: {
      "data-framework-id": "vue",
      "data-framework-adapter": "builtin:vue-sfc-v1"
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
