import { resolveChallengeAutomationPolicy, type ChallengeAutomationMode } from "../challenges";
import { DEFAULT_GOOGLE_AUTH_INTENT, type GoogleAuthIntent } from "../core/auth-intent";
import type {
  BrowserFallbackMode,
  ProviderCookiePolicy,
  ProviderRecoveryHints,
  ProviderRuntimePolicyInput,
  ProviderSource,
  ResolvedProviderRuntimePolicy,
  WorkflowBrowserMode
} from "./types";

export const DEFAULT_PROVIDER_FALLBACK_MODES: Record<ProviderSource, BrowserFallbackMode[]> = {
  web: ["managed_headed"],
  community: ["managed_headed"],
  social: ["managed_headed"],
  shopping: ["extension", "managed_headed"]
};

export const resolveWorkflowBrowserModeFallbackModes = (
  browserMode?: WorkflowBrowserMode
): BrowserFallbackMode[] | undefined => {
  if (browserMode === "extension") {
    return ["extension"];
  }
  if (browserMode === "managed") {
    return ["managed_headed"];
  }
  return undefined;
};

export const shouldForceWorkflowBrowserTransport = (
  browserMode?: WorkflowBrowserMode
): boolean => browserMode === "extension" || browserMode === "managed";

const resolveAuthIntentFallbackModes = (
  googleAuthIntent?: GoogleAuthIntent
): BrowserFallbackMode[] | undefined => (
  googleAuthIntent === "user_owned_google" ? ["extension"] : undefined
);

const shouldForceAuthIntentTransport = (
  googleAuthIntent?: GoogleAuthIntent
): boolean => googleAuthIntent === "user_owned_google";

export const resolveProviderFallbackModes = (args: {
  source: ProviderSource;
  recoveryHints?: ProviderRecoveryHints;
  preferredModes?: BrowserFallbackMode[];
}): BrowserFallbackMode[] => {
  const candidates = args.preferredModes?.length
    ? args.preferredModes
    : args.recoveryHints?.preferredFallbackModes?.length
      ? args.recoveryHints.preferredFallbackModes
      : DEFAULT_PROVIDER_FALLBACK_MODES[args.source];
  return [...new Set(candidates)];
};

const resolveCookiePolicy = (args: {
  configPolicy?: ProviderCookiePolicy;
  requestedUseCookies?: boolean;
  requestedOverride?: ProviderCookiePolicy;
}): ProviderCookiePolicy => {
  if (args.requestedOverride) {
    return args.requestedOverride;
  }
  if (args.requestedUseCookies === false) {
    return "off";
  }
  const configPolicy = args.configPolicy ?? "auto";
  if (args.requestedUseCookies === true && configPolicy === "off") {
    return "auto";
  }
  return configPolicy;
};

export const resolveProviderRuntimePolicy = (args: {
  source: ProviderSource;
  runtimePolicy?: ProviderRuntimePolicyInput;
  preferredFallbackModes?: BrowserFallbackMode[];
  forceBrowserTransport?: boolean;
  useCookies?: boolean;
  cookiePolicyOverride?: ProviderCookiePolicy;
  challengeAutomationMode?: ChallengeAutomationMode;
  sessionChallengeAutomationMode?: ChallengeAutomationMode;
  configChallengeAutomationMode?: ChallengeAutomationMode;
  configCookiePolicy?: ProviderCookiePolicy;
  recoveryHints?: ProviderRecoveryHints;
}): ResolvedProviderRuntimePolicy => {
  const runtimeInput = args.runtimePolicy;
  const browserMode = runtimeInput?.browserMode;
  const googleAuthIntent = runtimeInput?.googleAuthIntent ?? DEFAULT_GOOGLE_AUTH_INTENT;
  const requestedUseCookies = typeof runtimeInput?.useCookies === "boolean"
    ? runtimeInput.useCookies
    : args.useCookies;
  const requestedCookiePolicyOverride = runtimeInput?.cookiePolicyOverride ?? args.cookiePolicyOverride;
  const requestedChallengeAutomationMode = runtimeInput?.challengeAutomationMode ?? args.challengeAutomationMode;
  const authIntentModes = resolveAuthIntentFallbackModes(googleAuthIntent);
  const preferredModes = authIntentModes ?? (args.preferredFallbackModes?.length
    ? args.preferredFallbackModes
    : resolveWorkflowBrowserModeFallbackModes(browserMode));

  return {
    auth: {
      googleAuthIntent
    },
    browser: {
      preferredModes: resolveProviderFallbackModes({
        source: args.source,
        recoveryHints: args.recoveryHints,
        preferredModes
      }),
      forceTransport: args.forceBrowserTransport === true
        || shouldForceAuthIntentTransport(googleAuthIntent)
        || shouldForceWorkflowBrowserTransport(browserMode)
    },
    cookies: {
      ...(typeof requestedUseCookies === "boolean" ? { requested: requestedUseCookies } : {}),
      policy: resolveCookiePolicy({
        configPolicy: args.configCookiePolicy,
        requestedUseCookies,
        requestedOverride: requestedCookiePolicyOverride
      })
    },
    challenge: resolveChallengeAutomationPolicy({
      runMode: requestedChallengeAutomationMode,
      sessionMode: args.sessionChallengeAutomationMode,
      configMode: args.configChallengeAutomationMode ?? "browser_with_helper"
    })
  };
};
