import { extractSourceImports } from "../library-adapters/registry";
import { parseMarkupToCodeSyncGraph } from "./markup";
import type { CanvasFrameworkAdapter } from "./types";

export const CUSTOM_ELEMENTS_V1_ADAPTER: CanvasFrameworkAdapter = {
  id: "builtin:custom-elements-v1",
  displayName: "Custom Elements v1",
  sourceFamily: "custom-elements",
  sourceDialects: ["html", "web-component"],
  fileMatchers: [/\.html?$/i, /\.tsx?$/i, /\.jsx?$/i],
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
    frameworkId: "custom-elements",
    adapterId: "builtin:custom-elements-v1",
    sourceFamily: "custom-elements",
    attributes: {
      "data-framework-id": "custom-elements",
      "data-framework-adapter": "builtin:custom-elements-v1"
    },
    metadata: {}
  }),
  readTokenRefs: () => ({}),
  emitTokenRefs: () => ({}),
  emitThemeBindings: () => ({}),
  resolveLibraryAdapters: () => [],
  fallbackReason: (node) => node.tagName?.includes("-") ? null : "framework_construct_unsupported",
  grantCapabilities: (metadata) => metadata.grantedCapabilities.map((entry) => ({ ...entry }))
};
