import { parseTsxCodeSyncBinding } from "../code-sync/tsx-adapter";
import type { CanvasFrameworkAdapter, CanvasFrameworkProjectionDescriptor } from "./types";
import { extractSourceImports } from "../library-adapters/registry";
import { readCanvasTokenPath, readTokenPathFromCssValue, tokenPathToCssVar } from "../token-references";

function buildProjectionDescriptor(adapterId: string, frameworkId: string): CanvasFrameworkProjectionDescriptor {
  return {
    frameworkId,
    adapterId,
    sourceFamily: "react-tsx",
    attributes: {
      "data-framework-id": frameworkId,
      "data-framework-adapter": adapterId
    },
    metadata: {}
  };
}

export const REACT_TSX_V2_ADAPTER: CanvasFrameworkAdapter = {
  id: "builtin:react-tsx-v2",
  displayName: "React TSX v2",
  sourceFamily: "react-tsx",
  sourceDialects: ["tsx", "jsx"],
  fileMatchers: [/\.tsx$/i, /\.jsx$/i],
  capabilities: ["preview", "inventory_extract", "code_pull", "code_push", "token_roundtrip"],
  detectEntrypoint: (filePath, sourceText, detectContext) => ({
    filePath,
    sourceText,
    rootLocator: detectContext.metadata.rootLocator
  }),
  parseSource: (entrypoint, sourceText, parseContext, libraryRegistry) => {
    const parsed = parseTsxCodeSyncBinding(sourceText, entrypoint.filePath, parseContext.bindingId, parseContext.metadata);
    const imports = extractSourceImports(sourceText);
    const libraryAdapterIds = libraryRegistry.resolveForSource({
      frameworkId: "react",
      sourceText,
      imports
    }).map((entry) => entry.id);
    return {
      graph: {
        ...parsed.graph,
        frameworkAdapterId: parseContext.metadata.frameworkAdapterId,
        frameworkId: parseContext.metadata.frameworkId,
        sourceFamily: parseContext.metadata.sourceFamily,
        libraryAdapterIds,
        declaredCapabilities: [...parseContext.metadata.declaredCapabilities],
        grantedCapabilities: parseContext.metadata.grantedCapabilities.map((entry) => ({ ...entry }))
      },
      rootLocator: parseContext.metadata.rootLocator,
      imports,
      libraryAdapterIds,
      feedback: []
    };
  },
  emitSource: () => null,
  buildProjectionDescriptor: (_node, context) => buildProjectionDescriptor(context.metadata.frameworkAdapterId, context.metadata.frameworkId),
  readTokenRefs: (sourceGraph) => {
    const byNodeKey: Record<string, Record<string, string>> = {};
    for (const node of Object.values(sourceGraph.nodes)) {
      const refs = Object.fromEntries(
        Object.entries(node.style)
          .flatMap(([property, value]) => {
            if (typeof value !== "string") {
              return [];
            }
            const tokenPath = readTokenPathFromCssValue(value);
            return tokenPath ? [[property, tokenPath]] : [];
          })
      );
      if (Object.keys(refs).length > 0) {
        byNodeKey[node.key] = refs;
      }
    }
    return byNodeKey;
  },
  emitTokenRefs: (node) => Object.fromEntries(
    Object.entries(node.tokenRefs)
      .flatMap(([property, value]) => {
        const tokenPath = readCanvasTokenPath(value);
        return tokenPath ? [[property, tokenPathToCssVar(tokenPath)]] : [];
      })
  ),
  emitThemeBindings: (themeContext): Record<string, string> => {
    if (!themeContext.activeModeId) {
      return {};
    }
    return {
      "data-token-mode": themeContext.activeModeId,
      "data-theme": themeContext.activeModeId
    };
  },
  resolveLibraryAdapters: (sourceText, libraryRegistry) => libraryRegistry.resolveForSource({
    frameworkId: "react",
    sourceText,
    imports: extractSourceImports(sourceText)
  }).map((entry) => entry.id),
  fallbackReason: () => null,
  grantCapabilities: (metadata) => metadata.grantedCapabilities.map((entry) => ({ ...entry }))
};
