import type { CodeSyncCapability, CodeSyncNode } from "../code-sync/types";
import type { CanvasComponentInventoryItem } from "../types";

export type CanvasSourceImport = {
  source: string;
  specifiers: string[];
  defaultImport?: string;
  namespaceImport?: string;
};

export type CanvasLibrarySourceContext = {
  frameworkId: string;
  sourceText: string;
  imports: CanvasSourceImport[];
};

export type CanvasLibrarySourceNodeContext = CanvasLibrarySourceContext & {
  node?: CodeSyncNode;
  componentName?: string | null;
  tagName?: string | null;
};

export type CanvasLibraryProjectionHint = {
  attributes: Record<string, string>;
  metadata: Record<string, unknown>;
};

export type CanvasLibraryAdapter = {
  id: string;
  frameworkId: string;
  kind: string;
  resolutionStrategy: "import" | "tag";
  capabilities: CodeSyncCapability[];
  packages?: string[];
  sourceLocatorSchema: string;
  matchesImport?: (importDecl: CanvasSourceImport) => boolean;
  matchesSourceNode: (context: CanvasLibrarySourceNodeContext) => boolean;
  buildInventoryItem: (context: CanvasLibrarySourceNodeContext) => Partial<CanvasComponentInventoryItem> | null;
  buildProjectionDescriptor: (context: CanvasLibrarySourceNodeContext) => CanvasLibraryProjectionHint | null;
  emitSourceFragment: (context: CanvasLibrarySourceNodeContext) => string | null;
  extractVariantInfo: (context: CanvasLibrarySourceNodeContext) => Array<{ id: string; name: string }>;
  extractTokenBindings: (context: CanvasLibrarySourceNodeContext) => string[];
  fallbackReason: (context: CanvasLibrarySourceNodeContext) => string | null;
};
