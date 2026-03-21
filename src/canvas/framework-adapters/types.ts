import type {
  CanvasCodeSyncBindingMetadata,
  CodeSyncCapabilityGrant,
  CodeSyncGraph,
  CodeSyncNode,
  CodeSyncRootLocator,
  CodeSyncSourceFamily
} from "../code-sync/types";
import type { CanvasNode } from "../types";
import type { CanvasLibraryAdapterRegistry } from "../library-adapters/registry";
import type { CanvasSourceImport } from "../library-adapters/types";

export type CanvasFrameworkProjectionDescriptor = {
  frameworkId: string;
  adapterId: string;
  sourceFamily: CodeSyncSourceFamily;
  attributes: Record<string, string>;
  metadata: Record<string, unknown>;
};

export type CanvasFrameworkEntrypoint = {
  filePath: string;
  sourceText: string;
  rootLocator: CodeSyncRootLocator;
};

export type CanvasFrameworkParseContext = {
  bindingId: string;
  metadata: CanvasCodeSyncBindingMetadata;
};

export type CanvasFrameworkParseResult = {
  graph: CodeSyncGraph;
  rootLocator: CodeSyncRootLocator;
  imports: CanvasSourceImport[];
  libraryAdapterIds: string[];
  feedback: string[];
};

export type CanvasFrameworkEmitContext = {
  bindingId: string;
  metadata: CanvasCodeSyncBindingMetadata;
};

export type CanvasFrameworkTokenContext = {
  bindingId: string;
  metadata: CanvasCodeSyncBindingMetadata;
  activeModeId?: string | null;
};

export type CanvasFrameworkAdapter = {
  id: string;
  displayName: string;
  sourceFamily: CodeSyncSourceFamily;
  sourceDialects: string[];
  fileMatchers: RegExp[];
  capabilities: CanvasCodeSyncBindingMetadata["declaredCapabilities"];
  detectEntrypoint: (filePath: string, sourceText: string, detectContext: { metadata: CanvasCodeSyncBindingMetadata }) => CanvasFrameworkEntrypoint | null;
  parseSource: (entrypoint: CanvasFrameworkEntrypoint, sourceText: string, parseContext: CanvasFrameworkParseContext, libraryRegistry: CanvasLibraryAdapterRegistry) => CanvasFrameworkParseResult;
  emitSource: (graph: CodeSyncGraph, emitContext: CanvasFrameworkEmitContext) => string | null;
  buildProjectionDescriptor: (node: CodeSyncNode, context: CanvasFrameworkEmitContext) => CanvasFrameworkProjectionDescriptor;
  readTokenRefs: (sourceGraph: CodeSyncGraph, tokenContext: CanvasFrameworkTokenContext) => Record<string, Record<string, string>>;
  emitTokenRefs: (node: CanvasNode, tokenContext: CanvasFrameworkTokenContext) => Record<string, string>;
  emitThemeBindings: (themeContext: CanvasFrameworkTokenContext) => Record<string, string>;
  resolveLibraryAdapters: (sourceText: string, libraryRegistry: CanvasLibraryAdapterRegistry) => string[];
  fallbackReason: (node: CodeSyncNode) => string | null;
  grantCapabilities: (metadata: CanvasCodeSyncBindingMetadata) => CodeSyncCapabilityGrant[];
};
