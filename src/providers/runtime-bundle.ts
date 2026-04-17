import type { BrowserManagerLike } from "../browser/manager-types";
import type {
  OpenDevBrowserConfig,
  ProvidersChallengeOrchestrationConfig
} from "../config";
import { type ChallengeOrchestrator } from "../challenges";
import type { BrowserFallbackPort } from "./types";
import {
  createBrowserFallbackPort,
  createConfiguredProviderRuntime,
  resolveEffectiveChallengeConfig
} from "./runtime-factory";
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

const runtimeChallengeConfigFingerprints = new WeakMap<BundledProviderRuntime, string | null>();
const fallbackPortChallengeConfigFingerprints = new WeakMap<BrowserFallbackPort, string | null>();

const canReuseRuntime = (
  runtime: BundledProviderRuntime | undefined,
  challengeFingerprint: string | null,
  hasInitOverride: boolean,
  hasExplicitChallengeConfig: boolean
): runtime is BundledProviderRuntime => {
  if (!runtime || hasInitOverride) {
    return false;
  }
  const fingerprint = runtimeChallengeConfigFingerprints.get(runtime);
  if (fingerprint === undefined) {
    return !hasExplicitChallengeConfig;
  }
  return fingerprint === challengeFingerprint;
};

const canReuseFallbackPort = (
  fallbackPort: BrowserFallbackPort | undefined,
  challengeFingerprint: string | null
): fallbackPort is BrowserFallbackPort => {
  if (!fallbackPort) {
    return false;
  }
  const fingerprint = fallbackPortChallengeConfigFingerprints.get(fallbackPort);
  return fingerprint === undefined || fingerprint === challengeFingerprint;
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
  const challengeConfig = resolveEffectiveChallengeConfig(args.config, args.challengeConfig);
  const challengeFingerprint = challengeConfig ? JSON.stringify(challengeConfig) : null;
  const browserFallbackPort = canReuseFallbackPort(args.browserFallbackPort, challengeFingerprint)
    ? args.browserFallbackPort
    : createBrowserFallbackPort(
    args.manager,
    {
      policy: args.config?.providers?.cookiePolicy,
      source: args.config?.providers?.cookieSource
    },
    resolveFallbackTransportConfig(args.config),
    args.challengeOrchestrator,
    challengeConfig?.mode ?? "browser_with_helper",
    challengeConfig?.optionalComputerUseBridge.enabled ?? true
  );
  if (browserFallbackPort && browserFallbackPort !== args.browserFallbackPort) {
    fallbackPortChallengeConfigFingerprints.set(browserFallbackPort, challengeFingerprint);
  }
  const providerRuntime = createConfiguredProviderRuntime({
    config: args.config,
    manager: args.manager,
    browserFallbackPort,
    challengeConfig,
    challengeOrchestrator: args.challengeOrchestrator,
    init: args.init
  });
  runtimeChallengeConfigFingerprints.set(
    providerRuntime,
    challengeFingerprint
  );

  return {
    providerRuntime,
    ...(browserFallbackPort ? { browserFallbackPort } : {})
  };
};

export const resolveBundledProviderRuntime = (
  args: ResolveBundledProviderRuntimeArgs
): BundledProviderRuntime => {
  const challengeConfig = resolveEffectiveChallengeConfig(args.config, args.challengeConfig);
  const challengeFingerprint = challengeConfig ? JSON.stringify(challengeConfig) : null;
  if (canReuseRuntime(
    args.existingRuntime,
    challengeFingerprint,
    Boolean(args.init),
    typeof args.challengeConfig !== "undefined"
  )) {
    return args.existingRuntime;
  }

  return createProviderRuntimeBundle({
    ...args,
    challengeConfig
  }).providerRuntime;
};
