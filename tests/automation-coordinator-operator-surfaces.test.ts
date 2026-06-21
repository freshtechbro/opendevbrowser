import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAutomationCoordinator } from "../src/automation/coordinator";
import { buildBrowserReviewResult } from "../src/browser/review-surface";
import type { BrowserManagerLike, BrowserReviewResult } from "../src/browser/manager-types";
import type { ProvidersChallengeGovernedLanesConfig } from "../src/config";
import type { InspiredesignMediaAnalysisBinaryResolution } from "../src/inspiredesign/media-analysis";
import type { ChallengeInspectPlan } from "../src/challenges";
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
          capabilities: ["observe.screen"]
        }))
      }),
      challengeMode: "browser_only",
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
      mode: "browser_only",
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
    const coordinator = createAutomationCoordinator({
      manager: {
        inspectChallengePlan
      } as BrowserManagerLike,
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
      challengePlan: makeChallengePlan()
    });
    expect(result.session).not.toHaveProperty("targetId");
  });

  it("preserves an explicit targetId when session capability discovery includes one", async () => {
    const inspectChallengePlan = vi.fn(async () => makeChallengePlan());
    const coordinator = createAutomationCoordinator({
      manager: {
        inspectChallengePlan
      } as BrowserManagerLike,
      desktopRuntime: makeDesktopRuntime(),
      challengeMode: "browser_with_helper",
      governedLanes,
      helperBridgeEnabled: true,
      snapshotMaxChars: 333,
      resolveMediaAnalysisBinaries: async () => mediaAnalysisCapabilities
    });

    const result = await coordinator.statusCapabilities({
      browserSessionId: "session-1",
      targetId: "target-7"
    });

    expect(result.session).toMatchObject({
      sessionId: "session-1",
      targetId: "target-7"
    });
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
