import type { BrowserManagerLike } from "../browser/manager-types";
import type {
  OpenDevBrowserConfig,
  ProvidersChallengeOrchestrationConfig
} from "../config";
import { ChallengeOrchestrator } from "../challenges";
import type { BrowserFallbackPort } from "./types";
import {
  createBrowserFallbackPort,
  createConfiguredProviderRuntime,
  resolveEffectiveChallengeConfig
} from "./runtime-factory";
import type { RuntimeInit } from "./index";

export type ProviderRuntimeBundleConfig = Pick<OpenDevBrowserConfig, "blockerDetectionThreshold" | "security" | "providers">
  & Partial<Pick<OpenDevBrowserConfig, "inspiredesign" | "relayPort" | "relayToken">>;

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

const runtimeConfigFingerprints = new WeakMap<BundledProviderRuntime, string>();
const fallbackPortFingerprints = new WeakMap<BrowserFallbackPort, string>();

const hasExplicitMediaAnalysisConfig = (
  config: ProviderRuntimeBundleConfig | undefined
): boolean => Boolean(config?.inspiredesign?.mediaAnalysis.ffmpegPath || config?.inspiredesign?.mediaAnalysis.ffprobePath);

const runtimeConfigFingerprint = (
  challengeFingerprint: string | null,
  config: ProviderRuntimeBundleConfig | undefined,
  init: Omit<RuntimeInit, "providers"> | undefined
): string => JSON.stringify({
  challengeFingerprint,
  mediaAnalysis: init?.inspiredesignMediaAnalysis ?? config?.inspiredesign?.mediaAnalysis ?? {}
});

const canReuseRuntime = (
  runtime: BundledProviderRuntime | undefined,
  runtimeFingerprint: string,
  hasInitOverride: boolean,
  hasExplicitChallengeConfig: boolean,
  hasExplicitMediaAnalysisOverride: boolean
): runtime is BundledProviderRuntime => {
  if (!runtime || hasInitOverride) {
    return false;
  }
  const fingerprint = runtimeConfigFingerprints.get(runtime);
  if (fingerprint === undefined) {
    return !hasExplicitChallengeConfig && !hasExplicitMediaAnalysisOverride;
  }
  return fingerprint === runtimeFingerprint;
};

const canReuseFallbackPort = (
  fallbackPort: BrowserFallbackPort | undefined,
  fingerprint: string
): fallbackPort is BrowserFallbackPort => {
  if (!fallbackPort) {
    return false;
  }
  const currentFingerprint = fallbackPortFingerprints.get(fallbackPort);
  if (currentFingerprint === undefined) {
    return !fingerprint.includes("\"extensionWsEndpoint\":\"ws://");
  }
  return currentFingerprint === fingerprint;
};

const resolveFallbackTransportConfig = (
  config?: ProviderRuntimeBundleConfig
): { extensionWsEndpoint?: string } => (
  config && typeof config.relayPort === "number" && config.relayPort > 0 && config.relayToken !== false
    ? { extensionWsEndpoint: `ws://127.0.0.1:${config.relayPort}` }
    : {}
);

const fallbackPortFingerprint = (
  challengeFingerprint: string | null,
  transportConfig: { extensionWsEndpoint?: string }
): string => JSON.stringify({
  challengeFingerprint,
  extensionWsEndpoint: transportConfig.extensionWsEndpoint ?? null
});

export const createProviderRuntimeBundle = (
  args: ProviderRuntimeBundleArgs
): ProviderRuntimeBundle => {
  const challengeConfig = resolveEffectiveChallengeConfig(args.config, args.challengeConfig);
  const challengeFingerprint = challengeConfig ? JSON.stringify(challengeConfig) : null;
  const transportConfig = resolveFallbackTransportConfig(args.config);
  const runtimeFingerprint = runtimeConfigFingerprint(challengeFingerprint, args.config, args.init);
  const fallbackFingerprint = fallbackPortFingerprint(challengeFingerprint, transportConfig);
  const challengeOrchestrator = args.challengeOrchestrator
    ?? (challengeConfig ? new ChallengeOrchestrator(challengeConfig) : undefined);
  const browserFallbackPort = canReuseFallbackPort(args.browserFallbackPort, fallbackFingerprint)
    ? args.browserFallbackPort
    : createBrowserFallbackPort(
    args.manager,
    {
      policy: args.config?.providers?.cookiePolicy,
      source: args.config?.providers?.cookieSource
    },
    transportConfig,
    challengeOrchestrator,
    challengeConfig?.mode ?? "browser_with_helper",
    challengeConfig?.optionalComputerUseBridge.enabled ?? true
  );
  if (browserFallbackPort && browserFallbackPort !== args.browserFallbackPort) {
    fallbackPortFingerprints.set(browserFallbackPort, fallbackFingerprint);
  }
  const providerRuntime = createConfiguredProviderRuntime({
    config: args.config,
    manager: args.manager,
    browserFallbackPort,
    challengeConfig,
    challengeOrchestrator,
    init: args.init
  });
  runtimeConfigFingerprints.set(
    providerRuntime,
    runtimeFingerprint
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
  const runtimeFingerprint = runtimeConfigFingerprint(challengeFingerprint, args.config, args.init);
  if (canReuseRuntime(
    args.existingRuntime,
    runtimeFingerprint,
    Boolean(args.init),
    typeof args.challengeConfig !== "undefined",
    hasExplicitMediaAnalysisConfig(args.config)
  )) {
    return args.existingRuntime;
  }

  return createProviderRuntimeBundle({
    ...args,
    challengeConfig
  }).providerRuntime;
};
