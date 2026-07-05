import { describe, expect, it } from "vitest";
import { summarizeBrowserSessionCapabilities } from "../src/browser/session-capabilities";

describe("summarizeBrowserSessionCapabilities", () => {
  it("reports extension relay availability and provider-verified auth fallback", () => {
    const summary = summarizeBrowserSessionCapabilities({
      mode: "extension",
      relay: {
        extensionConnected: true,
        opsConnected: true,
        cdpConnected: true
      },
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "user_owned_google",
          profileSource: "live_extension_profile",
          cookieBootstrap: {
            attempted: false,
            disabled: true,
            importedCount: 0,
            rejectedCount: 0
          },
          providerCookieImport: {
            policy: "auto",
            source: "inline",
            attempted: true,
            available: true,
            loadedCount: 2,
            importedCount: 2,
            rejectedCount: 0,
            verifiedCount: 2,
            strict: false,
            sessionEvidence: "cookies_observable",
            authStateVerified: true
          },
          explicitCookieImportAttempted: true
        }
      },
      targets: {
        targets: [
          {
            targetId: "popup",
            type: "page",
            openerTargetId: "root"
          }
        ]
      }
    });

    expect(summary.transport).toMatchObject({
      boundary: "extension_relay",
      extensionRelay: true,
      opsRelay: true,
      relayCdp: true,
      directCdp: false,
      managed: false,
      liveActiveTabReuse: "available"
    });
    expect(summary.profile).toMatchObject({
      source: "live_extension_profile",
      authCapability: "live_extension",
      authProof: "live_extension",
      pathHashPresent: false
    });
    expect(summary.auth).toMatchObject({
      googleAuthIntent: "user_owned_google",
      googleUserOwnedAuth: "extension_ops_available",
      providerVerified: true,
      explicitCookieImportAttempted: true
    });
    expect(summary.browserPrimitives.popupOwnershipMetadata).toBe("observed");
    expect(summary.extensionBoundaries).toMatchObject({
      opsRelay: "available",
      relayCdp: "available"
    });
  });

  it("requires ops relay before reporting user-owned Google auth availability", () => {
    const summary = summarizeBrowserSessionCapabilities({
      mode: "extension",
      relay: {
        extensionConnected: true,
        opsConnected: false,
        cdpConnected: true
      },
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "user_owned_google",
          profileSource: "live_extension_profile",
          cookieBootstrap: {
            attempted: false,
            disabled: true,
            importedCount: 0,
            rejectedCount: 0
          }
        }
      }
    });

    expect(summary.transport).toMatchObject({
      extensionRelay: true,
      opsRelay: false,
      relayCdp: true,
      liveActiveTabReuse: "extension_ops_required"
    });
    expect(summary.auth.googleUserOwnedAuth).toBe("extension_ops_required");
    expect(summary.extensionBoundaries).toMatchObject({
      opsRelay: "extension_required",
      relayCdp: "available"
    });
  });

  it("does not report user-owned Google auth availability for non-extension sessions", () => {
    const summary = summarizeBrowserSessionCapabilities({
      mode: "managed",
      relay: {
        extensionConnected: true,
        opsConnected: true,
        cdpConnected: true
      },
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "user_owned_google",
          profileSource: "managed_profile",
          cookieBootstrap: {
            attempted: false,
            disabled: true,
            importedCount: 0,
            rejectedCount: 0
          }
        }
      }
    });

    expect(summary.transport.opsRelay).toBe(true);
    expect(summary.auth.googleUserOwnedAuth).toBe("extension_ops_required");
  });

  it("distinguishes raw CDP from explicit CDP profiles and keeps helper reasons bounded", () => {
    const raw = summarizeBrowserSessionCapabilities({
      mode: "cdpConnect",
      relay: null,
      challengeAutomationMode: "off"
    });
    const explicit = summarizeBrowserSessionCapabilities({
      mode: "cdpConnect",
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "none",
          profileSource: "cdp_connected_profile",
          profile: {
            profileId: "pinterest-design",
            displayName: "Pinterest Design",
            kind: "explicit_cdp_profile",
            scope: "explicit_local_cdp",
            browserFamily: "chrome",
            persistent: true,
            headless: false,
            authCapability: "explicit_cdp_profile",
            authProof: "profile_declared",
            pathHash: "abc123",
            endpoint: {
              host: "127.0.0.1",
              port: 9333
            },
            lease: {
              acquiredAt: "2026-07-04T00:00:00.000Z",
              lastSeenAt: "2026-07-04T00:00:00.000Z",
              active: true
            }
          },
          cookieBootstrap: {
            attempted: true,
            disabled: false,
            importedCount: 1,
            rejectedCount: 0
          }
        }
      },
      challengePlan: {
        classification: "checkpoint_or_friction",
        authState: "unknown",
        summary: "checkpoint",
        mode: "browser_with_helper",
        source: "run",
        helperEligibility: {
          allowed: false,
          reason: "No safe actions.",
          standDownReason: "helper_no_safe_actions"
        },
        yield: {
          required: false,
          reason: "none"
        },
        decision: {
          lane: "defer",
          rationale: "defer",
          attemptBudget: 1,
          noProgressLimit: 1,
          verificationLevel: "light",
          stopConditions: [],
          allowedActionFamilies: []
        },
        allowedActionFamilies: [],
        forbiddenActionFamilies: [],
        governedLanes: [],
        capabilityMatrix: {
          canNavigateToAuth: false,
          canReuseExistingSession: false,
          canReuseCookies: false,
          canFillNonSecretFields: false,
          canExploreClicks: false,
          canUseOwnedEnvironmentFixture: false,
          canUseSanctionedIdentity: false,
          canUseServiceAdapter: false,
          canUseComputerUseBridge: false,
          helperEligibility: {
            allowed: false,
            reason: "No safe actions.",
            standDownReason: "helper_no_safe_actions"
          },
          mustYield: false,
          mustDefer: true
        },
        helper: {
          status: "suggested",
          reason: "Helper unavailable for this page.",
          suggestedSteps: [],
          standDownReason: "helper_no_safe_actions"
        },
        suggestedSteps: [],
        evidence: {
          blockerState: "clear",
          loginRefs: [],
          sessionReuseRefs: [],
          humanVerificationRefs: [],
          checkpointRefs: []
        }
      }
    });

    expect(raw.transport.boundary).toBe("raw_cdp_unknown");
    expect(raw.auth.cookieBootstrap).toEqual({
      attempted: false,
      disabled: false,
      importedCount: 0,
      rejectedCount: 0
    });
    expect(raw.challengeAutomation).toMatchObject({
      mode: "off",
      browserScopedActions: false,
      helperEligible: false
    });
    expect(explicit.transport.boundary).toBe("explicit_local_cdp");
    expect(explicit.profile).toMatchObject({
      kind: "explicit_cdp_profile",
      scope: "explicit_local_cdp",
      leaseActive: true,
      pathHashPresent: true
    });
    expect(JSON.stringify(explicit)).not.toContain("launchTokenId");
    expect(explicit.challengeAutomation).toMatchObject({
      mode: "browser_with_helper",
      browserScopedActions: true,
      helperEligible: false,
      helperReason: "No safe actions.",
      standDownReason: "helper_no_safe_actions"
    });
  });

  it("derives cookie continuity and provider proof for non-extension sessions", () => {
    const summary = summarizeBrowserSessionCapabilities({
      mode: "managed",
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "none",
          profileSource: "managed_profile",
          providerCookieImport: {
            policy: "required",
            source: "file",
            attempted: true,
            available: true,
            loadedCount: 1,
            importedCount: 1,
            rejectedCount: 0,
            verifiedCount: 1,
            strict: true,
            sessionEvidence: "cookies_observable",
            authStateVerified: true
          },
          cookieBootstrap: {
            attempted: false,
            disabled: false,
            importedCount: 0,
            rejectedCount: 0
          }
        }
      }
    });

    expect(summary.profile.authCapability).toBe("cookie_continuity");
    expect(summary.profile.authProof).toBe("provider_verified");
    expect(summary.auth.providerVerified).toBe(true);
  });

  it("disables optional helper eligibility for managed headless profiles", () => {
    const summary = summarizeBrowserSessionCapabilities({
      mode: "managed",
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "none",
          profileSource: "managed_profile",
          profile: {
            profileId: "ci-public",
            displayName: "ci-public",
            kind: "managed_temporary",
            scope: "temporary",
            browserFamily: "chromium",
            persistent: false,
            headless: true,
            authCapability: "public",
            authProof: "none"
          },
          cookieBootstrap: {
            attempted: false,
            disabled: false,
            importedCount: 0,
            rejectedCount: 0
          }
        }
      },
      challengePlan: {
        classification: "checkpoint_or_friction",
        authState: "unknown",
        summary: "checkpoint",
        mode: "browser_with_helper",
        source: "run",
        helperEligibility: {
          allowed: true,
          reason: "Optional helper bridge remains eligible after mode resolution."
        },
        yield: {
          required: false,
          reason: "none"
        },
        decision: {
          lane: "optional_computer_use_bridge",
          rationale: "probe",
          attemptBudget: 1,
          noProgressLimit: 1,
          verificationLevel: "light",
          stopConditions: [],
          allowedActionFamilies: []
        },
        allowedActionFamilies: [],
        forbiddenActionFamilies: [],
        governedLanes: [],
        capabilityMatrix: {
          canNavigateToAuth: false,
          canReuseExistingSession: false,
          canReuseCookies: false,
          canFillNonSecretFields: false,
          canExploreClicks: false,
          canUseOwnedEnvironmentFixture: false,
          canUseSanctionedIdentity: false,
          canUseServiceAdapter: false,
          canUseComputerUseBridge: true,
          helperEligibility: {
            allowed: true,
            reason: "Optional helper bridge remains eligible after mode resolution."
          },
          mustYield: false,
          mustDefer: false
        },
        helper: {
          status: "suggested",
          reason: "Helper is available.",
          suggestedSteps: []
        },
        suggestedSteps: [],
        evidence: {
          blockerState: "clear",
          loginRefs: [],
          sessionReuseRefs: [],
          humanVerificationRefs: [],
          checkpointRefs: []
        }
      }
    });

    expect(summary.challengeAutomation).toMatchObject({
      mode: "browser_with_helper",
      browserScopedActions: true,
      helperEligible: false,
      helperReason: "Headless browser sessions cannot use the optional helper bridge.",
      standDownReason: "helper_disabled_for_browser_mode"
    });
  });

  it("reports headed helper eligibility and default non-popup metadata", () => {
    const summary = summarizeBrowserSessionCapabilities({
      mode: "managed",
      relay: {
        extensionConnected: false,
        opsConnected: false,
        cdpConnected: false
      },
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "none",
          profileSource: "managed_profile",
          profile: {
            profileId: "pinterest-design",
            displayName: "pinterest-design",
            kind: "managed_persistent",
            scope: "opendevbrowser_owned",
            browserFamily: "chromium",
            persistent: true,
            headless: false,
            authCapability: "profile_continuity",
            authProof: "profile_declared"
          },
          cookieBootstrap: {
            attempted: true,
            disabled: false,
            importedCount: 0,
            rejectedCount: 0
          }
        }
      },
      targets: { targets: [] },
      challengePlan: {
        classification: "checkpoint_or_friction",
        authState: "unknown",
        summary: "checkpoint",
        mode: "browser_with_helper",
        source: "run",
        helperEligibility: {
          allowed: true,
          reason: "Optional helper bridge remains eligible after mode resolution."
        },
        yield: {
          required: false,
          reason: "none"
        },
        decision: {
          lane: "optional_computer_use_bridge",
          rationale: "probe",
          attemptBudget: 1,
          noProgressLimit: 1,
          verificationLevel: "light",
          stopConditions: [],
          allowedActionFamilies: []
        },
        allowedActionFamilies: [],
        forbiddenActionFamilies: [],
        governedLanes: [],
        capabilityMatrix: {
          canNavigateToAuth: false,
          canReuseExistingSession: false,
          canReuseCookies: false,
          canFillNonSecretFields: false,
          canExploreClicks: false,
          canUseOwnedEnvironmentFixture: false,
          canUseSanctionedIdentity: false,
          canUseServiceAdapter: false,
          canUseComputerUseBridge: true,
          helperEligibility: {
            allowed: true,
            reason: "Optional helper bridge remains eligible after mode resolution."
          },
          mustYield: false,
          mustDefer: false
        },
        helper: {
          status: "suggested",
          reason: "Helper is available.",
          suggestedSteps: []
        },
        suggestedSteps: [],
        evidence: {
          blockerState: "clear",
          loginRefs: [],
          sessionReuseRefs: [],
          humanVerificationRefs: [],
          checkpointRefs: []
        }
      }
    });

    expect(summary.transport).toMatchObject({
      boundary: "managed_profile",
      extensionRelay: false,
      opsRelay: false,
      relayCdp: false,
      managed: true,
      liveActiveTabReuse: "extension_ops_required"
    });
    expect(summary.browserPrimitives.popupOwnershipMetadata).toBe("not_observed");
    expect(summary.challengeAutomation).toMatchObject({
      mode: "browser_with_helper",
      browserScopedActions: true,
      helperEligible: true,
      helperReason: "Optional helper bridge remains eligible after mode resolution."
    });
    expect(summary.challengeAutomation).not.toHaveProperty("standDownReason");
    expect(summary.extensionBoundaries).toMatchObject({
      opsRelay: "extension_required",
      relayCdp: "relay_required"
    });
  });

  it("reports popup ownership metadata unavailable when target enumeration fails", () => {
    const summary = summarizeBrowserSessionCapabilities({
      mode: "managed",
      targets: {
        targets: [],
        unavailable: true
      }
    });

    expect(summary.browserPrimitives.popupOwnershipMetadata).toBe("unavailable");
  });
});
