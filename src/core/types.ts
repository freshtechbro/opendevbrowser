/* c8 ignore file */
import type { BrowserManagerLike } from "../browser/manager-types";
import type { ScriptRunner } from "../browser/script-runner";
import type { AnnotationManager } from "../browser/annotation-manager";
import type {
  OpenDevBrowserConfig,
  ConfigStore,
  ParallelismGovernorConfig
} from "../config";
import type {
  BrowserFallbackPort,
  ProviderAggregateResult,
  ProviderCallResultByOperation,
  ProviderRunOptions
} from "../providers/types";
import type { RelayServer } from "../relay/relay-server";
import type { SkillLoader } from "../skills/skill-loader";

export type CoreOptions = {
  directory: string;
  worktree?: string | null;
  config?: OpenDevBrowserConfig;
};

export type OpenDevBrowserCore = {
  cacheRoot: string;
  config: OpenDevBrowserConfig;
  parallelismPolicy: ParallelismGovernorConfig;
  configStore: ConfigStore;
  manager: BrowserManagerLike;
  annotationManager: AnnotationManager;
  runner: ScriptRunner;
  skills: SkillLoader;
  providerRuntime: {
    search: (
      input: ProviderCallResultByOperation["search"],
      options?: ProviderRunOptions
    ) => Promise<ProviderAggregateResult>;
    fetch: (
      input: ProviderCallResultByOperation["fetch"],
      options?: ProviderRunOptions
    ) => Promise<ProviderAggregateResult>;
    crawl: (
      input: ProviderCallResultByOperation["crawl"],
      options?: ProviderRunOptions
    ) => Promise<ProviderAggregateResult>;
    post: (
      input: ProviderCallResultByOperation["post"],
      options?: ProviderRunOptions
    ) => Promise<ProviderAggregateResult>;
  };
  browserFallbackPort?: BrowserFallbackPort;
  relay: RelayServer;
  ensureRelay: (port?: number) => Promise<void>;
  cleanup: () => void;
  getExtensionPath: () => string | null;
};
