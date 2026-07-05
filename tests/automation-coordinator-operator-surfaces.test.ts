import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAutomationCoordinator } from "../src/automation/coordinator";
import { buildBrowserReviewResult } from "../src/browser/review-surface";
import type { BrowserManagerLike, BrowserReviewResult } from "../src/browser/manager-types";
import type { ProvidersChallengeGovernedLanesConfig } from "../src/config";
import type { InspiredesignMediaAnalysisBinaryResolution } from "../src/inspiredesign/media-analysis";
import type { ChallengeInspectPlan } from "../src/challenges";
import type { RelayStatus } from "../src/relay/relay-server";
import type {
  DesktopAccessibilityValue,
  DesktopCaptureValue,
  DesktopRuntimeLike,
  DesktopRuntimeStatus,
  DesktopWindowSummary
} from "../src/desktop";

vi.mock("../src/browser/review-surface", () => ({
  buildBrowserReviewResult: vi.fn()
}));

const primaryWindow: DesktopWindowSummary = {
  id: "window-alpha",
  ownerName: "Google Chrome",
  ownerPid: 42,
  title: "Workspace",
  bounds: { x: 0, y: 0, width: 1280, height: 800 },
  layer: 0,
  alpha: 1,
  isOnscreen: true
};

const desktopStatus: DesktopRuntimeStatus = {
  platform: "darwin",
  permissionLevel: "observe",
  available: true,
  capabilities: ["observe.screen", "observe.accessibility"],
  auditArtifactsDir: "/tmp/desktop-audit"
};

const governedLanes: ProvidersChallengeGovernedLanesConfig = {
  allowOwnedEnvironmentFixtures: true,
  allowSanctionedIdentity: true,
  allowServiceAdapters: true,
  requireAuditMetadata: true
};

const auditInfo = {
  auditId: "audit-1",
  at: "2026-04-15T00:00:00.000Z",
  recordPath: "/tmp/desktop-audit/record.json",
  artifactPaths: []
};

const okResult = <T,>(value: T) => ({
  ok: true as const,
  value,
  audit: auditInfo
});

const mediaAnalysisCapabilities: InspiredesignMediaAnalysisBinaryResolution = {
  available: true,
  capabilityTier: "full",
  limitations: [],
  ffmpeg: {
    tool: "ffmpeg",
    available: true,
    source: "config",
    requestedPath: "/fake/ffmpeg",
    resolvedPath: "/fake/ffmpeg",
    version: "ffmpeg version test",
    capabilityTier: "frame_decode"
  },
  ffprobe: {
    tool: "ffprobe",
    available: true,
    source: "config",
    requestedPath: "/fake/ffprobe",
    resolvedPath: "/fake/ffprobe",
    version: "ffprobe version test",
    capabilityTier: "metadata_probe"
  }
};

const makeDesktopRuntime = (
  overrides: Partial<DesktopRuntimeLike> = {}
): DesktopRuntimeLike => ({
  status: vi.fn(async () => desktopStatus),
  listWindows: vi.fn(async () => okResult({ windows: [primaryWindow] })),
  activeWindow: vi.fn(async () => okResult(primaryWindow)),
  captureDesktop: vi.fn(async () => okResult<DesktopCaptureValue>({
    capture: { path: "/tmp/full.png", mimeType: "image/png" }
  })),
  captureWindow: vi.fn(async (windowId: string) => okResult<DesktopCaptureValue>({
    capture: { path: `/tmp/${windowId}.png`, mimeType: "image/png" },
    window: primaryWindow
  })),
  accessibilitySnapshot: vi.fn(async () => okResult<DesktopAccessibilityValue>({
    window: primaryWindow,
    tree: { role: "AXWindow", children: [] }
  })),
  ...overrides
});

const makeChallengePlan = (): ChallengeInspectPlan => ({
  challengeId: "challenge-1",
  classification: "auth_required",
  authState: "credentials_required",
  summary: "Authentication challenge detected.",
  mode: "browser_with_helper",
  source: "config",
  helperEligibility: { allowed: true, reason: "Helper remains eligible." },
  yield: { required: false, reason: "none" },
  decision: {
    lane: "generic_browser_autonomy",
    rationale: "Use bounded browser actions.",
    attemptBudget: 1,
    noProgressLimit: 1,
    verificationLevel: "full",
    stopConditions: [],
    allowedActionFamilies: ["verification"]
  },
  allowedActionFamilies: ["verification"],
  forbiddenActionFamilies: [],
  governedLanes: ["owned_environment_fixture"],
  capabilityMatrix: {
    canNavigateToAuth: false,
    canReuseExistingSession: false,
    canReuseCookies: false,
    canFillNonSecretFields: false,
    canExploreClicks: false,
    canUseOwnedEnvironmentFixture: true,
    canUseSanctionedIdentity: false,
    canUseServiceAdapter: false,
    canUseComputerUseBridge: true,
    helperEligibility: { allowed: true, reason: "Helper remains eligible." },
    mustYield: false,
    mustDefer: false
  },
  helper: {
    status: "suggested",
    reason: "Bridge returned bounded browser actions.",
    suggestedSteps: []
  },
  suggestedSteps: [],
  evidence: {
    blockerState: "active",
    loginRefs: [],
    sessionReuseRefs: [],
    humanVerificationRefs: [],
    checkpointRefs: []
  }
});

const makeManagedProfileStatus = () => ({
  mode: "managed" as const,
  activeTargetId: "target-1",
  diagnostics: {
    authProvenance: {
      googleAuthIntent: "none" as const,
      profileSource: "managed_profile" as const,
      profile: {
        profileId: "studio",
        displayName: "studio",
        kind: "managed_persistent" as const,
        scope: "opendevbrowser_owned" as const,
        browserFamily: "chromium" as const,
        persistent: true,
        headless: false,
        authCapability: "profile_continuity" as const,
        authProof: "profile_declared" as const,
        pathHash: "hash-1"
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

const makeConnectedRelayStatus = (): RelayStatus => ({
  running: true,
  extensionConnected: true,
  extensionHandshakeComplete: true,
  cdpConnected: true,
  annotationConnected: false,
  opsConnected: true,
  opsOwnedTargetCount: 1,
  canvasConnected: false,
  pairingRequired: false,
  instanceId: "relay-1",
  epoch: 1,
  health: {
    ok: true,
    reason: "ok",
    extensionConnected: true,
    extensionHandshakeComplete: true,
    cdpConnected: true,
    annotationConnected: false,
    opsConnected: true,
    opsOwnedTargetCount: 1,
    canvasConnected: false,
    pairingRequired: false
  }
});

describe("automation coordinator operator surfaces", () => {
  beforeEach(() => {
    vi.mocked(buildBrowserReviewResult).mockReset();
  });

  it("reports host capabilities with governed browser-scoped computer-use lanes", async () => {
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime: makeDesktopRuntime(),
      challengeMode: "browser_with_helper",
      governedLanes,
      helperBridgeEnabled: true,
      snapshotMaxChars: 333,
      mediaAnalysisConfig: {
        ffmpegPath: "/fake/ffmpeg",
        ffprobePath: "/fake/ffprobe"
      },
      resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities
    });

    const result = await coordinator.statusCapabilities({});

    expect(result).toEqual({
      host: {
        desktopObservation: {
          ...desktopStatus,
          accessibilityAvailable: true
        },
        browserReplay: {
          available: true
        },
        browserScopedComputerUse: {
          mode: "browser_with_helper",
          helperBridgeEnabled: true,
          governedLanes: [
            "owned_environment_fixture",
            "sanctioned_identity",
            "service_adapter"
          ]
        },
        mediaAnalysis: mediaAnalysisCapabilities,
        firstClassSurfaces: {
          reviewDesktop: true,
          sessionInspectorPlan: true,
          sessionInspectorAudit: true,
          statusCapabilities: true
        }
      }
    });
  });

  it("reports status-capabilities through the default media-analysis resolver", async () => {
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime: makeDesktopRuntime({
        status: vi.fn(async () => ({
          ...desktopStatus,
          capabilities: ["observe.screen" as const]
        }))
      }),
      challengeMode: "browser",
      governedLanes: {
        allowOwnedEnvironmentFixtures: false,
        allowSanctionedIdentity: false,
        allowServiceAdapters: false,
        requireAuditMetadata: true
      },
      helperBridgeEnabled: false,
      snapshotMaxChars: 333,
      mediaAnalysisConfig: {
        ffmpegPath: "/missing/ffmpeg",
        ffprobePath: "/missing/ffprobe"
      }
    });

    const result = await coordinator.statusCapabilities({});

    expect(result.host.desktopObservation.accessibilityAvailable).toBe(false);
    expect(result.host.browserScopedComputerUse).toEqual({
      mode: "browser",
      helperBridgeEnabled: false,
      governedLanes: []
    });
    expect(result.host.mediaAnalysis).toEqual(expect.objectContaining({
      available: false,
      capabilityTier: "unavailable",
      limitations: [
        "ffmpeg binary was not found.",
        "ffprobe binary was not found."
      ]
    }));
    expect(result.host.mediaAnalysis.ffmpeg).toEqual(expect.objectContaining({
      available: false,
      source: "config",
      requestedPath: "/missing/ffmpeg"
    }));
    expect(result.host.mediaAnalysis.ffprobe).toEqual(expect.objectContaining({
      available: false,
      source: "config",
      requestedPath: "/missing/ffprobe"
    }));
  });

  it("omits targetId when session capability discovery is requested without one", async () => {
    const inspectChallengePlan = vi.fn(async () => makeChallengePlan());
    const status = vi.fn(async () => makeManagedProfileStatus());
    const coordinator = createAutomationCoordinator({
      manager: {
        inspectChallengePlan,
        status,
        listTargets: vi.fn(async () => ({
          activeTargetId: "target-1",
          targets: []
        }))
      } as unknown as BrowserManagerLike,
      desktopRuntime: makeDesktopRuntime(),
      challengeMode: "browser_with_helper",
      governedLanes,
      helperBridgeEnabled: true,
      snapshotMaxChars: 333,
      resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities
    });

    const result = await coordinator.statusCapabilities({
      browserSessionId: "session-1",
      runMode: "browser"
    });

    expect(inspectChallengePlan).toHaveBeenCalledWith({
      sessionId: "session-1",
      targetId: undefined,
      runMode: "browser"
    });
    expect(result.session).toMatchObject({
      sessionId: "session-1",
      challengePlan: makeChallengePlan(),
      capabilities: {
        transport: {
          mode: "managed",
          boundary: "managed_profile",
          managed: true,
          liveActiveTabReuse: "extension_ops_required"
        },
        profile: {
          kind: "managed_persistent",
          scope: "opendevbrowser_owned",
          authCapability: "profile_continuity",
          authProof: "profile_declared",
          pathHashPresent: true
        },
        auth: {
          googleUserOwnedAuth: "extension_ops_required",
          cookieContinuityIsLoginProof: false
        },
        challengeAutomation: {
          mode: "browser_with_helper",
          browserScopedActions: true,
          helperEligible: true
        }
      }
    });
    expect(status).toHaveBeenCalledWith("session-1");
    expect(result.session).not.toHaveProperty("targetId");
  });

  it("keeps session capability diagnostics when target listing is unavailable", async () => {
    const inspectChallengePlan = vi.fn(async () => makeChallengePlan());
    const listTargets = vi.fn(async () => {
      throw new Error("target list unavailable");
    });
    const coordinator = createAutomationCoordinator({
      manager: {
        inspectChallengePlan,
        status: vi.fn(async () => makeManagedProfileStatus()),
        listTargets
      } as unknown as BrowserManagerLike,
      desktopRuntime: makeDesktopRuntime(),
      challengeMode: "browser_with_helper",
      governedLanes,
      helperBridgeEnabled: true,
      snapshotMaxChars: 333,
      resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities
    });

    const result = await coordinator.statusCapabilities({
      browserSessionId: "session-1",
      runMode: "browser"
    });

    expect(listTargets).toHaveBeenCalledWith("session-1", false);
    expect(result.session?.capabilities.browserPrimitives.popupOwnershipMetadata).toBe("unavailable");
    expect(result.session?.capabilities.profile).toEqual(expect.objectContaining({
      kind: "managed_persistent",
      scope: "opendevbrowser_owned",
      authCapability: "profile_continuity"
    }));
  });

  it("preserves an explicit targetId when session capability discovery includes one", async () => {
    const inspectChallengePlan = vi.fn(async () => makeChallengePlan());
    const status = vi.fn(async () => ({
      mode: "extension" as const,
      activeTargetId: "target-7",
      diagnostics: {
        authProvenance: {
          googleAuthIntent: "user_owned_google" as const,
          profileSource: "live_extension_profile" as const,
          cookieBootstrap: {
            attempted: false,
            disabled: true,
            importedCount: 0,
            rejectedCount: 0
          }
        }
      }
    }));
    const listTargets = vi.fn(async () => ({
      activeTargetId: "target-7",
      targets: [
        {
          targetId: "target-7",
          type: "page" as const
        },
        {
          targetId: "target-popup",
          type: "page" as const,
          openerTargetId: "target-7",
          ownershipSource: "cdp_target_event" as const
        }
      ]
    }));
    const coordinator = createAutomationCoordinator({
      manager: {
        inspectChallengePlan,
        status,
        listTargets
      } as unknown as BrowserManagerLike,
      desktopRuntime: makeDesktopRuntime(),
      challengeMode: "browser_with_helper",
      governedLanes,
      helperBridgeEnabled: true,
      snapshotMaxChars: 333,
      relayStatus: makeConnectedRelayStatus,
      resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities
    });

    const result = await coordinator.statusCapabilities({
      browserSessionId: "session-1",
      targetId: "target-7"
    });

    expect(result.session).toMatchObject({
      sessionId: "session-1",
      targetId: "target-7",
      capabilities: {
        transport: {
          mode: "extension",
          boundary: "extension_relay",
          liveActiveTabReuse: "available",
          opsRelay: true,
          relayCdp: true
        },
        auth: {
          googleAuthIntent: "user_owned_google",
          googleUserOwnedAuth: "extension_ops_available"
        },
        browserPrimitives: {
          popupOwnershipMetadata: "observed"
        }
      }
    });
    expect(listTargets).toHaveBeenCalledWith("session-1", false);
  });

  it("applies desktop-review defaults before browser-owned verification", async () => {
    const review: BrowserReviewResult = {
      sessionId: "session-1",
      targetId: "target-9",
      mode: "managed",
      snapshotId: "snapshot-1",
      content: "review content",
      truncated: false,
      refCount: 1,
      timingMs: 5
    };
    vi.mocked(buildBrowserReviewResult).mockResolvedValue(review);
    const desktopRuntime = makeDesktopRuntime();
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime,
      challengeMode: "browser_with_helper",
      governedLanes,
      helperBridgeEnabled: true,
      snapshotMaxChars: 333,
      resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities
    });

    const result = await coordinator.reviewDesktop({
      browserSessionId: "session-1",
      targetId: "target-9",
      reason: "   "
    });

    expect(desktopRuntime.activeWindow).toHaveBeenCalledWith("Desktop-assisted browser review.");
    expect(desktopRuntime.captureWindow).toHaveBeenCalledWith("window-alpha", {
      reason: "Desktop-assisted browser review."
    });
    expect(desktopRuntime.accessibilitySnapshot).toHaveBeenCalledWith(
      "Desktop-assisted browser review.",
      "window-alpha"
    );
    expect(buildBrowserReviewResult).toHaveBeenCalledWith({
      manager: {},
      sessionId: "session-1",
      targetId: "target-9",
      maxChars: 333,
      cursor: undefined
    });
    expect(result).toMatchObject({
      browserSessionId: "session-1",
      observation: {
        activeWindow: primaryWindow
      },
      verification: {
        observationId: result.observation.observationId,
        review
      }
    });
  });

  it("preserves explicit desktop-review observation settings", async () => {
    const review: BrowserReviewResult = {
      sessionId: "session-1",
      targetId: "target-9",
      mode: "managed",
      snapshotId: "snapshot-1",
      content: "review content",
      truncated: false,
      refCount: 1,
      timingMs: 5
    };
    vi.mocked(buildBrowserReviewResult).mockResolvedValue(review);
    const desktopRuntime = makeDesktopRuntime();
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime,
      challengeMode: "browser_with_helper",
      governedLanes,
      helperBridgeEnabled: true,
      snapshotMaxChars: 333,
      resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities
    });

    const result = await coordinator.reviewDesktop({
      browserSessionId: "session-1",
      targetId: "target-9",
      reason: "Full desktop review",
      capture: "desktop",
      accessibility: "none",
      includeActiveWindow: false
    });

    expect(desktopRuntime.activeWindow).not.toHaveBeenCalled();
    expect(desktopRuntime.captureDesktop).toHaveBeenCalledWith({
      reason: "Full desktop review"
    });
    expect(desktopRuntime.accessibilitySnapshot).not.toHaveBeenCalled();
    expect(result.observation).toEqual(expect.objectContaining({
      capture: {
        capture: { path: "/tmp/full.png", mimeType: "image/png" }
      }
    }));
  });

  it("captures the active window when accessibility uses the active-window default", async () => {
    const review: BrowserReviewResult = {
      sessionId: "session-1",
      targetId: "target-9",
      mode: "managed",
      snapshotId: "snapshot-1",
      content: "review content",
      truncated: false,
      refCount: 1,
      timingMs: 5
    };
    vi.mocked(buildBrowserReviewResult).mockResolvedValue(review);
    const desktopRuntime = makeDesktopRuntime();
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime,
      challengeMode: "browser_with_helper",
      governedLanes,
      helperBridgeEnabled: true,
      snapshotMaxChars: 333,
      resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities
    });

    await coordinator.reviewDesktop({
      browserSessionId: "session-1",
      targetId: "target-9",
      reason: "Accessibility review",
      capture: "desktop",
      accessibility: "active_window"
    });

    expect(desktopRuntime.activeWindow).toHaveBeenCalledWith("Accessibility review");
    expect(desktopRuntime.captureDesktop).toHaveBeenCalledWith({
      reason: "Accessibility review"
    });
    expect(desktopRuntime.accessibilitySnapshot).toHaveBeenCalledWith(
      "Accessibility review",
      "window-alpha"
    );
  });

  it("throws when the manager does not expose inspect-plan support", async () => {
    const coordinator = createAutomationCoordinator({
      manager: {} as BrowserManagerLike,
      desktopRuntime: makeDesktopRuntime(),
      challengeMode: "browser_with_helper",
      governedLanes,
      helperBridgeEnabled: true,
      snapshotMaxChars: 333,
      resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities
    });

    await expect(coordinator.inspectChallengePlan({
      browserSessionId: "session-missing"
    })).rejects.toThrow("Challenge inspect-plan is unavailable for the current runtime.");
  });
});
