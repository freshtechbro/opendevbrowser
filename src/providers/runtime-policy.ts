import { resolveChallengeAutomationPolicy, type ChallengeAutomationMode } from "../challenges";
import { DEFAULT_GOOGLE_AUTH_INTENT, type GoogleAuthIntent } from "../core/auth-intent";
import type {
  BrowserFallbackMode,
  ProviderAuthCapability,
  ProviderAuthDoNotProceedReason,
  ProviderAuthProof,
  ProviderAuthRecommendedMode,
  ProviderCookiePolicy,
  ProviderGoogleSensitiveRisk,
  ProviderProfileMode,
  ProviderProfileTrust,
  ProviderRecoveryHints,
  ProviderRuntimePolicyInput,
  ProviderTrustedProfileProvenance,
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

const isCookieContinuityRequested = (args: {
  resolvedPolicy: ProviderCookiePolicy;
  requestedUseCookies?: boolean;
  requestedOverride?: ProviderCookiePolicy;
  configPolicy?: ProviderCookiePolicy;
}): boolean => args.requestedUseCookies === true
  || args.requestedOverride === "required"
  || args.configPolicy === "required"
  || args.resolvedPolicy === "required";

const PROVIDER_PROFILE_ID_HASH_LENGTH = 12;

const hashProviderProfileValue = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(PROVIDER_PROFILE_ID_HASH_LENGTH, "0").slice(0, PROVIDER_PROFILE_ID_HASH_LENGTH);
};

const sanitizeProviderProfileId = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (normalized.length > 0) {
    return normalized.slice(0, 80);
  }
  return `profile-${hashProviderProfileValue(value)}`;
};

const resolveRecommendedAuthMode = (args: {
  browserMode?: WorkflowBrowserMode;
  capability: ProviderAuthCapability;
  profileId?: string;
}): ProviderAuthRecommendedMode => {
  if (args.capability === "live_extension_required" || args.browserMode === "extension") {
    return "extension";
  }
  if (args.capability === "explicit_cdp_profile") {
    return "explicit_cdp_profile";
  }
  if (
    args.capability === "profile_continuity"
    || args.capability === "cookie_continuity"
    || args.profileId
    || args.browserMode === "managed"
  ) {
    return "managed_headed";
  }
  return "managed_headless";
};

const resolveProviderAuthCapability = (args: {
  googleAuthIntent: GoogleAuthIntent;
  requestedUseCookies?: boolean;
  requestedCookiePolicyOverride?: ProviderCookiePolicy;
  resolvedCookiePolicy: ProviderCookiePolicy;
  configCookiePolicy?: ProviderCookiePolicy;
  browserMode?: WorkflowBrowserMode;
  profileId?: string;
  profileMode?: ProviderProfileMode;
  trustedProfile?: {
    profileId: string;
    profileMode: ProviderProfileMode;
    profileTrust: ProviderProfileTrust;
  };
  providerVerified?: boolean;
}): ResolvedProviderRuntimePolicy["auth"] => {
  const capability = resolveProviderAuthCapabilityKind(args);
  const recommendedMode = resolveRecommendedAuthMode({
    browserMode: args.browserMode,
    capability,
    profileId: args.profileId
  });
  return {
    googleAuthIntent: args.googleAuthIntent,
    capability,
    proof: resolveProviderAuthProof({
      capability,
      requestedUseCookies: args.requestedUseCookies,
      providerVerified: args.providerVerified
    }),
    googleSensitiveRisk: resolveGoogleSensitiveRisk(capability),
    recommendedMode,
    doNotProceedIf: resolveDoNotProceedReasons(capability),
    ...(args.profileId ? { profileId: args.profileId } : {}),
    ...(args.profileId && args.profileMode ? { profileMode: args.profileMode } : {}),
    ...(args.trustedProfile?.profileTrust === "trusted" && (
      capability === "profile_continuity" || capability === "explicit_cdp_profile"
    ) ? { profileTrust: args.trustedProfile.profileTrust } : {})
  };
};

const resolveProviderAuthCapabilityKind = (args: {
  googleAuthIntent: GoogleAuthIntent;
  requestedUseCookies?: boolean;
  requestedCookiePolicyOverride?: ProviderCookiePolicy;
  resolvedCookiePolicy: ProviderCookiePolicy;
  configCookiePolicy?: ProviderCookiePolicy;
  browserMode?: WorkflowBrowserMode;
  profileId?: string;
  profileMode?: ProviderProfileMode;
  trustedProfile?: {
    profileId: string;
    profileMode: ProviderProfileMode;
    profileTrust: ProviderProfileTrust;
  };
}): ProviderAuthCapability => {
  if (args.googleAuthIntent === "user_owned_google") {
    return "live_extension_required";
  }
  if (
    args.trustedProfile?.profileTrust === "trusted"
    && args.trustedProfile.profileMode === "explicit_cdp"
    && args.browserMode !== "managed"
  ) {
    return "explicit_cdp_profile";
  }
  if (
    args.trustedProfile?.profileTrust === "trusted"
    && args.trustedProfile.profileMode === "managed"
    && args.browserMode !== "extension"
  ) {
    return "profile_continuity";
  }
  if (isCookieContinuityRequested({
    resolvedPolicy: args.resolvedCookiePolicy,
    requestedUseCookies: args.requestedUseCookies,
    requestedOverride: args.requestedCookiePolicyOverride,
    configPolicy: args.configCookiePolicy
  })) {
    return "cookie_continuity";
  }
  return "public";
};

const resolveProviderAuthProof = (args: {
  capability: ProviderAuthCapability;
  requestedUseCookies?: boolean;
  providerVerified?: boolean;
}): ProviderAuthProof => {
  if (args.providerVerified === true && args.capability !== "public" && args.capability !== "blocked") {
    return "provider_verified";
  }
  if (args.capability === "profile_continuity" || args.capability === "explicit_cdp_profile") {
    return "profile_declared";
  }
  if (args.capability === "cookie_continuity" && args.requestedUseCookies === true) {
    return "cookies_observable";
  }
  return "none";
};

const resolveGoogleSensitiveRisk = (
  capability: ProviderAuthCapability
): ProviderGoogleSensitiveRisk => {
  if (capability === "live_extension_required") {
    return "user_owned_google_extension_only";
  }
  if (capability === "explicit_cdp_profile") {
    return "explicit_cdp_not_google_proof";
  }
  if (capability === "cookie_continuity") {
    return "cookies_not_google_proof";
  }
  return "none";
};

const resolveDoNotProceedReasons = (
  capability: ProviderAuthCapability
): ProviderAuthDoNotProceedReason[] => {
  if (capability === "live_extension_required") {
    return ["extension_ops_unavailable"];
  }
  if (capability === "cookie_continuity") {
    return ["requires_provider_verified_login"];
  }
  if (capability === "explicit_cdp_profile") {
    return ["google_user_owned_requires_extension_ops"];
  }
  return [];
};

export const resolveProviderRuntimePolicy = (args: {
  source: ProviderSource;
  runtimePolicy?: ProviderRuntimePolicyInput;
  providerVerification?: { authStateVerified?: boolean };
  preferredFallbackModes?: BrowserFallbackMode[];
  forceBrowserTransport?: boolean;
  useCookies?: boolean;
  cookiePolicyOverride?: ProviderCookiePolicy;
  challengeAutomationMode?: ChallengeAutomationMode;
  sessionChallengeAutomationMode?: ChallengeAutomationMode;
  configChallengeAutomationMode?: ChallengeAutomationMode;
  configCookiePolicy?: ProviderCookiePolicy;
  recoveryHints?: ProviderRecoveryHints;
  trustedProfile?: ProviderTrustedProfileProvenance;
}): ResolvedProviderRuntimePolicy => {
  const runtimeInput = args.runtimePolicy;
  const browserMode = runtimeInput?.browserMode;
  const googleAuthIntent = runtimeInput?.googleAuthIntent ?? DEFAULT_GOOGLE_AUTH_INTENT;
  const trustedProfileId = sanitizeProviderProfileId(args.trustedProfile?.profileId ?? args.trustedProfile?.profile);
  const requestedProfileId = sanitizeProviderProfileId(runtimeInput?.profile);
  const trustedProfileMatchesRequest = !requestedProfileId || trustedProfileId === requestedProfileId;
  const trustedProfile = trustedProfileId && args.trustedProfile && trustedProfileMatchesRequest
    ? { profileId: trustedProfileId, profileMode: args.trustedProfile.profileMode, profileTrust: "trusted" as const }
    : undefined;
  const profileId = trustedProfile?.profileId ?? requestedProfileId;
  const profileMode = trustedProfile?.profileMode ?? runtimeInput?.profileMode;
  const requestedUseCookies = typeof runtimeInput?.useCookies === "boolean"
    ? runtimeInput.useCookies
    : args.useCookies;
  const requestedCookiePolicyOverride = runtimeInput?.cookiePolicyOverride ?? args.cookiePolicyOverride;
  const requestedChallengeAutomationMode = runtimeInput?.challengeAutomationMode ?? args.challengeAutomationMode;
  const authIntentModes = resolveAuthIntentFallbackModes(googleAuthIntent);
  const preferredModes = authIntentModes ?? (args.preferredFallbackModes?.length
    ? args.preferredFallbackModes
    : resolveWorkflowBrowserModeFallbackModes(browserMode));
  const cookiePolicy = resolveCookiePolicy({
    configPolicy: args.configCookiePolicy,
    requestedUseCookies,
    requestedOverride: requestedCookiePolicyOverride
  });

  return {
    auth: resolveProviderAuthCapability({
      googleAuthIntent,
      requestedUseCookies,
      requestedCookiePolicyOverride,
      resolvedCookiePolicy: cookiePolicy,
      configCookiePolicy: args.configCookiePolicy,
      browserMode,
      profileId,
      profileMode,
      trustedProfile,
      providerVerified: args.providerVerification?.authStateVerified
    }),
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
      policy: cookiePolicy
    },
    challenge: resolveChallengeAutomationPolicy({
      runMode: requestedChallengeAutomationMode,
      sessionMode: args.sessionChallengeAutomationMode,
      configMode: args.configChallengeAutomationMode ?? "browser_with_helper"
    })
  };
};
