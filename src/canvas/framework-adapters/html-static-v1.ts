import { extractSourceImports } from "../library-adapters/registry";
import { parseMarkupToCodeSyncGraph } from "./markup";
import type { CanvasFrameworkAdapter } from "./types";

export const HTML_STATIC_V1_ADAPTER: CanvasFrameworkAdapter = {
  id: "builtin:html-static-v1",
  displayName: "Static HTML v1",
  sourceFamily: "html-static",
  sourceDialects: ["html"],
  fileMatchers: [/\.html?$/i],
  capabilities: ["preview", "inventory_extract", "code_pull"],
  detectEntrypoint: (filePath, sourceText, detectContext) => ({
    filePath,
    sourceText,
    rootLocator: detectContext.metadata.rootLocator
  }),
  parseSource: (entrypoint, sourceText, parseContext) => ({
    graph: parseMarkupToCodeSyncGraph({
      bindingId: parseContext.bindingId,
      filePath: entrypoint.filePath,
      sourceText,
      metadata: parseContext.metadata,
      rootLocator: parseContext.metadata.rootLocator
    }),
    rootLocator: parseContext.metadata.rootLocator,
    imports: extractSourceImports(sourceText),
    libraryAdapterIds: [],
    feedback: []
  }),
  emitSource: () => null,
  buildProjectionDescriptor: () => ({
    frameworkId: "html",
    adapterId: "builtin:html-static-v1",
    sourceFamily: "html-static",
    attributes: {
      "data-framework-id": "html",
      "data-framework-adapter": "builtin:html-static-v1"
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
