import type { BrowserManagerLike } from "../browser/manager-types";
import type { AnnotationManager } from "../browser/annotation-manager";
import type { ScriptRunner } from "../browser/script-runner";
import type { ConfigStore } from "../config";
import type { RelayLike } from "../relay/relay-types";
import type { SkillLoader } from "../skills/skill-loader";
import type {
  BrowserFallbackPort,
  ProviderAggregateResult,
  ProviderCallResultByOperation,
  ProviderRunOptions
} from "../providers/types";

export type ProviderRuntimeLike = {
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

export type ToolDeps = {
  manager: BrowserManagerLike;
  annotationManager: AnnotationManager;
  runner: ScriptRunner;
  config: ConfigStore;
  skills: SkillLoader;
  providerRuntime?: ProviderRuntimeLike;
  browserFallbackPort?: BrowserFallbackPort;
  relay?: RelayLike;
  getExtensionPath?: () => string | null;
  ensureHub?: () => Promise<void>;
};
