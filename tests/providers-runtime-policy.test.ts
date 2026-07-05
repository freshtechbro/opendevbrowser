import { describe, expect, it } from "vitest";
import { resolveProviderRuntimePolicy } from "../src/providers/runtime-policy";

describe("provider runtime policy", () => {
  it("resolves browser-mode intent into fallback modes and forced transport", () => {
    const extensionPolicy = resolveProviderRuntimePolicy({
      source: "shopping",
      runtimePolicy: { browserMode: "extension" }
    });
    const managedPolicy = resolveProviderRuntimePolicy({
      source: "shopping",
      runtimePolicy: { browserMode: "managed" }
    });
    const autoPolicy = resolveProviderRuntimePolicy({
      source: "shopping",
      runtimePolicy: { browserMode: "auto" }
    });

    expect(extensionPolicy.browser).toEqual({
      preferredModes: ["extension"],
      forceTransport: true
    });
    expect(extensionPolicy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "extension",
      doNotProceedIf: []
    });
    expect(managedPolicy.browser).toEqual({
      preferredModes: ["managed_headed"],
      forceTransport: true
    });
    expect(autoPolicy.browser).toEqual({
      preferredModes: ["extension", "managed_headed"],
      forceTransport: false
    });
    expect(autoPolicy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headless",
      doNotProceedIf: []
    });
  });

  it("resolves cookie intent from runtime policy input", () => {
    const requiredCookies = resolveProviderRuntimePolicy({
      source: "web",
      runtimePolicy: {
        useCookies: true,
        cookiePolicyOverride: "required"
      }
    });
    const cookiesOff = resolveProviderRuntimePolicy({
      source: "web",
      runtimePolicy: {
        useCookies: false
      }
    });

    expect(requiredCookies.cookies).toEqual({
      requested: true,
      policy: "required"
    });
    expect(cookiesOff.cookies).toEqual({
      requested: false,
      policy: "off"
    });
  });

  it("preserves user-owned Google auth intent in resolved policy", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "web",
      runtimePolicy: {
        googleAuthIntent: "user_owned_google"
      }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "user_owned_google",
      capability: "live_extension_required",
      proof: "none",
      googleSensitiveRisk: "user_owned_google_extension_only",
      recommendedMode: "extension",
      doNotProceedIf: ["extension_ops_unavailable"]
    });
    expect(policy.browser).toEqual({
      preferredModes: ["extension"],
      forceTransport: true
    });
  });

  it("marks requested cookie usage as continuity without provider login proof", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        useCookies: true
      }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "cookie_continuity",
      proof: "cookies_observable",
      googleSensitiveRisk: "cookies_not_google_proof",
      recommendedMode: "managed_headed",
      doNotProceedIf: ["requires_provider_verified_login"]
    });
    expect(policy.cookies).toEqual({
      requested: true,
      policy: "auto"
    });
  });

  it("keeps cookie policy continuity separate from observable cookie proof", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "web",
      configCookiePolicy: "required"
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "cookie_continuity",
      proof: "none",
      googleSensitiveRisk: "cookies_not_google_proof",
      recommendedMode: "managed_headed",
      doNotProceedIf: ["requires_provider_verified_login"]
    });
    expect(policy.cookies).toEqual({
      policy: "required"
    });
  });

  it("does not turn raw non-extension browser mode into auth proof", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "web",
      runtimePolicy: {
        browserMode: "managed"
      },
      preferredFallbackModes: ["managed_headed"]
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headed",
      doNotProceedIf: []
    });
    expect(policy.browser).toEqual({
      preferredModes: ["managed_headed"],
      forceTransport: true
    });
  });

  it("keeps requested profiles as launch preference without auth proof", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        browserMode: "managed",
        profile: "Pinterest Design",
        profileMode: "managed"
      }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headed",
      doNotProceedIf: [],
      profileId: "pinterest-design",
      profileMode: "managed"
    });
    expect(policy.browser).toEqual({
      preferredModes: ["managed_headed"],
      forceTransport: true
    });
  });

  it("hashes profile names that normalize to an empty provider profile id", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        profile: "!!!",
        profileMode: "managed"
      }
    });

    expect(policy.auth.profileId).toMatch(/^profile-[a-f0-9]{12}$/);
    expect(policy.auth.profileMode).toBe("managed");
    expect(policy.auth.capability).toBe("public");
  });

  it("requires trusted provenance before managed profiles become auth-capable", () => {
    const untrustedPolicy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        profile: "Pinterest Design",
        profileMode: "managed"
      }
    });
    const trustedPolicy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        browserMode: "managed",
        profile: "Pinterest Design",
        profileMode: "managed"
      },
      trustedProfile: {
        profile: "Pinterest Design",
        profileMode: "managed"
      }
    });

    expect(untrustedPolicy.auth).toMatchObject({
      capability: "public",
      proof: "none",
      profileId: "pinterest-design",
      profileMode: "managed"
    });
    expect(trustedPolicy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "profile_continuity",
      proof: "profile_declared",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headed",
      doNotProceedIf: [],
      profileId: "pinterest-design",
      profileMode: "managed",
      profileTrust: "trusted"
    });
  });

  it("does not apply trusted managed profile provenance to a different requested profile", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        browserMode: "managed",
        profile: "Pinterest Design",
        profileMode: "managed"
      },
      trustedProfile: {
        profile: "Other Workspace",
        profileMode: "managed"
      }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headed",
      doNotProceedIf: [],
      profileId: "pinterest-design",
      profileMode: "managed"
    });
  });

  it("requires trusted provenance before explicit CDP profiles become auth-capable", () => {
    const untrustedPolicy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        profile: "Pinterest Design",
        profileMode: "explicit_cdp"
      }
    });
    const trustedPolicy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        profile: "Pinterest Design",
        profileMode: "explicit_cdp"
      },
      trustedProfile: {
        profileId: "Pinterest Design",
        profileMode: "explicit_cdp"
      }
    });

    expect(untrustedPolicy.auth).toMatchObject({
      capability: "public",
      proof: "none",
      profileId: "pinterest-design",
      profileMode: "explicit_cdp"
    });
    expect(trustedPolicy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "explicit_cdp_profile",
      proof: "profile_declared",
      googleSensitiveRisk: "explicit_cdp_not_google_proof",
      recommendedMode: "explicit_cdp_profile",
      doNotProceedIf: ["google_user_owned_requires_extension_ops"],
      profileId: "pinterest-design",
      profileMode: "explicit_cdp",
      profileTrust: "trusted"
    });
  });

  it("does not apply trusted explicit CDP profile provenance to a different requested profile", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        profile: "Pinterest Design",
        profileMode: "explicit_cdp"
      },
      trustedProfile: {
        profileId: "Other Workspace",
        profileMode: "explicit_cdp"
      }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headed",
      doNotProceedIf: [],
      profileId: "pinterest-design",
      profileMode: "explicit_cdp"
    });
  });

  it("does not let managed browser mode claim explicit CDP profile auth", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        browserMode: "managed",
        profile: "Pinterest Design",
        profileMode: "explicit_cdp"
      },
      trustedProfile: {
        profileId: "Pinterest Design",
        profileMode: "explicit_cdp"
      }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headed",
      doNotProceedIf: [],
      profileId: "pinterest-design",
      profileMode: "explicit_cdp"
    });
  });

  it("does not let runtime policy input spoof provider-verified proof", () => {
    const spoofedRuntimePolicy = {
      profile: "Pinterest Design",
      profileMode: "managed",
      profileTrust: "trusted",
      providerVerified: true
    } as const;

    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: spoofedRuntimePolicy
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headed",
      doNotProceedIf: [],
      profileId: "pinterest-design",
      profileMode: "managed"
    });
  });

  it("does not let internal provider verification upgrade public browser control", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        browserMode: "managed"
      },
      providerVerification: { authStateVerified: true }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headed",
      doNotProceedIf: []
    });
  });

  it("does not let extension mode claim managed profile continuity", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        browserMode: "extension",
        profile: "Pinterest Design",
        profileMode: "managed"
      },
      trustedProfile: {
        profile: "Pinterest Design",
        profileMode: "managed"
      }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "public",
      proof: "none",
      googleSensitiveRisk: "none",
      recommendedMode: "extension",
      doNotProceedIf: [],
      profileId: "pinterest-design",
      profileMode: "managed"
    });
  });

  it("lets internal provider verification upgrade proof only after a trusted auth-capable profile exists", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        profile: "Pinterest Design",
        profileMode: "managed"
      },
      trustedProfile: {
        profile: "Pinterest Design",
        profileMode: "managed"
      },
      providerVerification: { authStateVerified: true }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "none",
      capability: "profile_continuity",
      proof: "provider_verified",
      googleSensitiveRisk: "none",
      recommendedMode: "managed_headed",
      doNotProceedIf: [],
      profileId: "pinterest-design",
      profileMode: "managed",
      profileTrust: "trusted"
    });
  });

  it("keeps Google user-owned auth extension-only even with trusted profiles", () => {
    const policy = resolveProviderRuntimePolicy({
      source: "social",
      runtimePolicy: {
        googleAuthIntent: "user_owned_google",
        profile: "Google Work",
        profileMode: "managed"
      },
      trustedProfile: {
        profile: "Google Work",
        profileMode: "managed"
      }
    });

    expect(policy.auth).toEqual({
      googleAuthIntent: "user_owned_google",
      capability: "live_extension_required",
      proof: "none",
      googleSensitiveRisk: "user_owned_google_extension_only",
      recommendedMode: "extension",
      doNotProceedIf: ["extension_ops_unavailable"],
      profileId: "google-work",
      profileMode: "managed"
    });
    expect(policy.browser).toEqual({
      preferredModes: ["extension"],
      forceTransport: true
    });
  });

  it("downgrades requested cookies to auto when config policy is off", () => {
    const cookiesAuto = resolveProviderRuntimePolicy({
      source: "web",
      runtimePolicy: {
        useCookies: true
      },
      configCookiePolicy: "off"
    });

    expect(cookiesAuto.cookies).toEqual({
      requested: true,
      policy: "auto"
    });
  });
});
