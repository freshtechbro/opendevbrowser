import type { BrowserManagerLike } from "../browser/manager-types";
import type {
  OpenDevBrowserConfig,
  ProvidersChallengeOrchestrationConfig
} from "../config";
import { type ChallengeOrchestrator } from "../challenges";
import type { BrowserFallbackPort } from "./types";
import { createBrowserFallbackPort, createConfiguredProviderRuntime } from "./runtime-factory";
import type { RuntimeInit } from "./index";

export type ProviderRuntimeBundleConfig = Pick<OpenDevBrowserConfig, "blockerDetectionThreshold" | "security" | "providers">
  & Partial<Pick<OpenDevBrowserConfig, "relayPort" | "relayToken">>;

export type BundledProviderRuntime = Pick<
  ReturnType<typeof createConfiguredProviderRuntime>,
  "search" | "fetch" | "crawl" | "post"
>;

type ProviderRuntimeBundleArgs = {
  config?: ProviderRuntimeBundleConfig;
  manager?: BrowserManagerLike;
  browserFallbackPort?: BrowserFallbackPort;
  challengeConfig?: ProvidersChallengeOrchestrationConfig;
  challengeOrchestrator?: ChallengeOrchestrator;
  init?: Omit<RuntimeInit, "providers">;
};

type ProviderRuntimeBundle = {
  providerRuntime: BundledProviderRuntime;
  browserFallbackPort?: BrowserFallbackPort;
};

type ResolveBundledProviderRuntimeArgs = ProviderRuntimeBundleArgs & {
  existingRuntime?: BundledProviderRuntime;
};

const resolveFallbackTransportConfig = (
  config?: ProviderRuntimeBundleConfig
): { extensionWsEndpoint?: string } => (
  config && typeof config.relayPort === "number" && config.relayPort > 0 && config.relayToken !== false
    ? { extensionWsEndpoint: `ws://127.0.0.1:${config.relayPort}` }
    : {}
);

export const createProviderRuntimeBundle = (
  args: ProviderRuntimeBundleArgs
): ProviderRuntimeBundle => {
  const browserFallbackPort = args.browserFallbackPort ?? createBrowserFallbackPort(
    args.manager,
    {
      policy: args.config?.providers?.cookiePolicy,
      source: args.config?.providers?.cookieSource
    },
    resolveFallbackTransportConfig(args.config),
    args.challengeOrchestrator,
    args.challengeConfig?.mode ?? "browser_with_helper",
    args.challengeConfig?.optionalComputerUseBridge.enabled ?? true
  );
  const providerRuntime = createConfiguredProviderRuntime({
    config: args.config,
    manager: args.manager,
    browserFallbackPort,
    challengeConfig: args.challengeConfig,
    challengeOrchestrator: args.challengeOrchestrator,
    init: args.init
  });

  return {
    providerRuntime,
    ...(browserFallbackPort ? { browserFallbackPort } : {})
  };
};

export const resolveBundledProviderRuntime = (
  args: ResolveBundledProviderRuntimeArgs
): BundledProviderRuntime => {
  if (args.existingRuntime && !args.init) {
    return args.existingRuntime;
  }

  return createProviderRuntimeBundle(args).providerRuntime;
};
