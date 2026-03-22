import type { CodeSyncCapability } from "../code-sync/types";
import type { CanvasFrameworkAdapterRegistry } from "../framework-adapters/registry";
import type { CanvasLibraryAdapterRegistry } from "../library-adapters/registry";

export type CanvasAdapterPluginFrameworkDescriptor = {
  id: string;
  sourceFamily: string;
  adapterKind: string;
  adapterVersion: number;
  moduleExport: string;
  capabilities: CodeSyncCapability[];
  fileMatchers?: string[];
};

export type CanvasAdapterPluginLibraryDescriptor = {
  id: string;
  frameworkId: string;
  kind: string;
  resolutionStrategy: "import" | "tag";
  moduleExport: string;
  capabilities: CodeSyncCapability[];
  packages?: string[];
};

export type CanvasAdapterPluginManifest = {
  schemaVersion: string;
  adapterApiVersion: string;
  pluginId: string;
  displayName: string;
  version: string;
  engine: {
    opendevbrowser: string;
  };
  entry: string;
  moduleFormat: "esm";
  frameworkAdapters: CanvasAdapterPluginFrameworkDescriptor[];
  libraryAdapters: CanvasAdapterPluginLibraryDescriptor[];
  capabilities: CodeSyncCapability[];
  fixtureDir: string;
  trustedWorkspaceRoots: string[];
  packageRoot: string;
  sdkImport: string;
};

export type CanvasAdapterPluginDeclaration =
  | string
  | {
    ref: string;
    enabled?: boolean;
    trustedWorkspaceRoots?: string[];
    capabilityOverrides?: CodeSyncCapability[];
  };

export type CanvasAdapterPluginRuntimeContext = {
  worktree: string;
};

export type CanvasAdapterPluginWorkspaceContext = {
  worktree: string;
};

export type CanvasAdapterPluginDefinition = {
  manifest: CanvasAdapterPluginManifest;
  initialize: (runtimeContext: CanvasAdapterPluginRuntimeContext) => Promise<void> | void;
  validateWorkspace: (workspaceContext: CanvasAdapterPluginWorkspaceContext) => Promise<void> | void;
  registerFrameworkAdapters: (registry: CanvasFrameworkAdapterRegistry) => Promise<void> | void;
  registerLibraryAdapters: (registry: CanvasLibraryAdapterRegistry) => Promise<void> | void;
  onBind: (bindingContext: { bindingId: string }) => Promise<void> | void;
  onUnbind: (bindingContext: { bindingId: string }) => Promise<void> | void;
  dispose: (disposeContext: { worktree: string }) => Promise<void> | void;
};

export type CanvasLoadedAdapterPlugin = {
  manifest: CanvasAdapterPluginManifest;
  definition: CanvasAdapterPluginDefinition;
  packageRoot: string;
  fixtureDir: string;
};

export type CanvasAdapterPluginLoadErrorCode =
  | "plugin_not_found"
  | "duplicate_plugin_id"
  | "duplicate_adapter_id"
  | "manifest_version_unsupported"
  | "adapter_api_unsupported"
  | "entry_export_invalid"
  | "trust_denied"
  | "dependency_missing"
  | "plugin_manifest_invalid"
  | "plugin_init_failed"
  | "plugin_load_failed";

export type CanvasAdapterPluginLoadError = {
  code: CanvasAdapterPluginLoadErrorCode;
  pluginId?: string;
  ref: string;
  message: string;
  details?: Record<string, unknown>;
};
