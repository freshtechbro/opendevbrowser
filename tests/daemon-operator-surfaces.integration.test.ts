import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenDevBrowserCore } from "../src/core";
import { handleDaemonCommand } from "../src/cli/daemon-commands";
import { clearBinding, clearSessionLeases, registerSessionLease } from "../src/cli/daemon-state";

const makeRelayStatus = () => ({
  running: true,
  extensionConnected: false,
  extensionHandshakeComplete: true,
  cdpConnected: false,
  annotationConnected: false,
  opsConnected: true,
  canvasConnected: false,
  pairingRequired: false,
  health: { ok: true },
  instanceId: "relay-operator"
});

const makeCore = () => {
  const manager = {
    status: vi.fn(async () => ({ mode: "managed", activeTargetId: "target-1", url: "https://example.com", title: "Example" })),
    createSessionInspector: vi.fn()
  };
  const relay = {
    status: vi.fn(() => makeRelayStatus())
  };
  const automationCoordinator = {
    reviewDesktop: vi.fn(),
    inspectChallengePlan: vi.fn(),
    statusCapabilities: vi.fn()
  };
  const core = {
    manager,
    relay,
    automationCoordinator,
    config: {
      snapshot: { maxChars: 16_000 }
    }
  } as unknown as OpenDevBrowserCore;

  return {
    core,
    manager,
    relay,
    automationCoordinator
  };
};

const reviewDesktopResult = {
  browserSessionId: "session-1",
  observation: {
    observationId: "observation-1",
    requestedAt: "2026-04-17T00:00:00.000Z",
    status: {
      platform: "darwin",
      permissionLevel: "observe",
      available: true,
      capabilities: ["observe.windows"],
      auditArtifactsDir: "/tmp/desktop-audit"
    }
  },
  verification: {
    observationId: "observation-1",
    verifiedAt: "2026-04-17T00:00:01.000Z",
    review: {
      sessionId: "session-1",
      targetId: "target-1",
      mode: "managed",
      snapshotId: "snapshot-1",
      content: "review content",
      truncated: false,
      refCount: 1,
      timingMs: 5
    }
  }
};

const challengePlan = {
  classification: "auth_required",
  authState: "credentials_required",
  summary: "Authentication challenge detected.",
  mode: "browser",
  source: "run",
  helperEligibility: { allowed: true, reason: "Helper available." },
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
    helperEligibility: { allowed: true, reason: "Helper available." },
    mustYield: false,
    mustDefer: false
  },
  helper: {
    status: "suggested",
    reason: "Helper returned bounded browser actions.",
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
};

describe("daemon operator surfaces", () => {
  afterEach(() => {
    clearBinding();
    clearSessionLeases();
    vi.restoreAllMocks();
  });

  it("routes host and session-scoped status.capabilities through the automation coordinator", async () => {
    const { core, manager, automationCoordinator } = makeCore();
    const hostCapabilities = {
      host: {
        desktopObservation: {
          platform: "darwin",
          permissionLevel: "observe",
          available: true,
          capabilities: ["observe.windows"],
          auditArtifactsDir: "/tmp/desktop-audit",
          accessibilityAvailable: false
        },
        browserReplay: { available: true },
        browserScopedComputerUse: {
          mode: "browser_with_helper",
          helperBridgeEnabled: true,
          governedLanes: []
        },
        firstClassSurfaces: {
          reviewDesktop: true,
          sessionInspectorPlan: true,
          sessionInspectorAudit: true,
          statusCapabilities: true
        }
      }
    };
    const sessionCapabilities = {
      ...hostCapabilities,
      session: {
        sessionId: "session-1",
        targetId: "target-1",
        challengePlan
      }
    };
    automationCoordinator.statusCapabilities
      .mockResolvedValueOnce(hostCapabilities)
      .mockResolvedValueOnce(sessionCapabilities);

    await expect(handleDaemonCommand(core, {
      name: "status.capabilities",
      params: {}
    })).resolves.toEqual(hostCapabilities);

    await expect(handleDaemonCommand(core, {
      name: "status.capabilities",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        targetId: "target-1",
        challengeAutomationMode: "browser"
      }
    })).resolves.toEqual(sessionCapabilities);

    expect(manager.status).toHaveBeenCalledWith("session-1");
    expect(automationCoordinator.statusCapabilities).toHaveBeenNthCalledWith(1, {
      browserSessionId: undefined,
      targetId: undefined,
      runMode: undefined
    });
    expect(automationCoordinator.statusCapabilities).toHaveBeenNthCalledWith(2, {
      browserSessionId: "session-1",
      targetId: "target-1",
      runMode: "browser"
    });
  });

  it("routes nav.reviewDesktop through the automation coordinator", async () => {
    const { core, manager, automationCoordinator } = makeCore();
    automationCoordinator.reviewDesktop.mockResolvedValue(reviewDesktopResult);

    await expect(handleDaemonCommand(core, {
      name: "nav.reviewDesktop",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        targetId: "target-1",
        reason: "Capture desktop proof.",
        maxChars: 6000,
        cursor: "cursor-1"
      }
    })).resolves.toEqual(reviewDesktopResult);

    expect(manager.status).toHaveBeenCalledWith("session-1");
    expect(automationCoordinator.reviewDesktop).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      reason: "Capture desktop proof.",
      maxChars: 6000,
      cursor: "cursor-1"
    });
  });

  it("routes session.inspectPlan through the automation coordinator", async () => {
    const { core, manager, automationCoordinator } = makeCore();
    automationCoordinator.inspectChallengePlan.mockResolvedValue(challengePlan);

    await expect(handleDaemonCommand(core, {
      name: "session.inspectPlan",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        targetId: "target-1",
        challengeAutomationMode: "browser"
      }
    })).resolves.toEqual(challengePlan);

    expect(manager.status).toHaveBeenCalledWith("session-1");
    expect(automationCoordinator.inspectChallengePlan).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      runMode: "browser"
    });
  });

  it("builds session.inspectAudit with exception cursoring and coordinator outputs", async () => {
    const { core, manager, automationCoordinator } = makeCore();
    const inspector = {
      status: vi.fn(async () => ({ mode: "managed", activeTargetId: "target-1", url: "https://example.com", title: "Example" })),
      listTargets: vi.fn(async () => ({
        activeTargetId: "target-1",
        targets: [{ targetId: "target-1", type: "page", url: "https://example.com" }]
      })),
      consolePoll: vi.fn(async () => ({ events: [], nextSeq: 0 })),
      networkPoll: vi.fn(async () => ({ events: [], nextSeq: 0 })),
      debugTraceSnapshot: vi.fn(async (_sessionId: string, options: {
        sinceConsoleSeq?: number;
        sinceNetworkSeq?: number;
        sinceExceptionSeq?: number;
        max?: number;
        requestId?: string;
      }) => ({
        requestId: options.requestId ?? "audit-request",
        generatedAt: "2026-04-17T00:00:02.000Z",
        page: { url: "https://example.com", title: "Example" },
        channels: {
          console: { events: [], nextSeq: 0, truncated: false },
          network: { events: [], nextSeq: 0, truncated: false },
          exception: {
            events: [{ message: "Unhandled ReferenceError", sourceURL: "https://example.com/app.js", lineNumber: 17, columnNumber: 4 }],
            nextSeq: 9,
            truncated: false
          }
        },
        meta: { blockerState: "clear" }
      }))
    };
    manager.createSessionInspector = vi.fn(() => inspector);
    automationCoordinator.reviewDesktop.mockResolvedValue(reviewDesktopResult);
    automationCoordinator.inspectChallengePlan.mockResolvedValue(challengePlan);

    const response = await handleDaemonCommand(core, {
      name: "session.inspectAudit",
      params: {
        sessionId: "session-1",
        clientId: "client-1",
        targetId: "target-1",
        reason: "Audit the session.",
        maxChars: 5000,
        cursor: "cursor-2",
        includeUrls: true,
        sinceConsoleSeq: 3,
        sinceNetworkSeq: 4,
        sinceExceptionSeq: 5,
        max: 6,
        requestId: "audit-request",
        challengeAutomationMode: "browser"
      }
    }) as {
      sessionInspector: {
        exception: {
          eventCount: number;
          nextSeq: number | null;
          latest: Array<{ message: string; url?: string; line?: number; column?: number }>;
        };
      };
      requestId: string | null;
    };

    expect(manager.status).toHaveBeenCalledWith("session-1");
    expect(automationCoordinator.reviewDesktop).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      reason: "Audit the session.",
      maxChars: 5000,
      cursor: "cursor-2"
    });
    expect(automationCoordinator.inspectChallengePlan).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      runMode: "browser"
    });
    expect(inspector.debugTraceSnapshot).toHaveBeenCalledWith("session-1", {
      sinceConsoleSeq: 3,
      sinceNetworkSeq: 4,
      sinceExceptionSeq: 5,
      max: 6,
      requestId: "audit-request"
    });
    expect(response.requestId).toBe("audit-request");
    expect(response.sessionInspector.exception).toEqual({
      eventCount: 1,
      nextSeq: 9,
      truncated: false,
      latest: [
        {
          message: "Unhandled ReferenceError",
          url: "https://example.com/app.js",
          line: 17,
          column: 4
        }
      ]
    });
  });

  it.each([
    {
      name: "status.capabilities",
      params: { sessionId: "session-1", clientId: "client-1", targetId: "target-1", challengeAutomationMode: "browser" }
    },
    {
      name: "nav.reviewDesktop",
      params: { sessionId: "session-1", clientId: "client-1", targetId: "target-1", reason: "review", maxChars: 4000 }
    },
    {
      name: "session.inspectPlan",
      params: { sessionId: "session-1", clientId: "client-1", targetId: "target-1", challengeAutomationMode: "browser" }
    },
    {
      name: "session.inspectAudit",
      params: { sessionId: "session-1", clientId: "client-1", targetId: "target-1", reason: "audit", maxChars: 4000 }
    }
  ])("requires relay binding for %s when the session is extension-owned", async ({ name, params }) => {
    const { core, manager, automationCoordinator } = makeCore();
    manager.status.mockResolvedValue({ mode: "extension", activeTargetId: "target-1", url: "https://example.com", title: "Example" });

    await expect(handleDaemonCommand(core, { name, params })).rejects.toThrow("RELAY_BINDING_REQUIRED");

    expect(automationCoordinator.statusCapabilities).not.toHaveBeenCalled();
    expect(automationCoordinator.reviewDesktop).not.toHaveBeenCalled();
    expect(automationCoordinator.inspectChallengePlan).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "status.capabilities",
      params: { sessionId: "session-1", clientId: "client-2", leaseId: "lease-1", targetId: "target-1", challengeAutomationMode: "browser" }
    },
    {
      name: "nav.reviewDesktop",
      params: { sessionId: "session-1", clientId: "client-2", leaseId: "lease-1", targetId: "target-1", reason: "review", maxChars: 4000 }
    },
    {
      name: "session.inspectPlan",
      params: { sessionId: "session-1", clientId: "client-2", leaseId: "lease-1", targetId: "target-1", challengeAutomationMode: "browser" }
    },
    {
      name: "session.inspectAudit",
      params: { sessionId: "session-1", clientId: "client-2", leaseId: "lease-1", targetId: "target-1", reason: "audit", maxChars: 4000 }
    }
  ])("rejects lease mismatches for %s before coordinator work begins", async ({ name, params }) => {
    const { core, automationCoordinator } = makeCore();
    registerSessionLease("session-1", "lease-1", "client-1");

    await expect(handleDaemonCommand(core, { name, params })).rejects.toThrow("RELAY_LEASE_INVALID");

    expect(automationCoordinator.statusCapabilities).not.toHaveBeenCalled();
    expect(automationCoordinator.reviewDesktop).not.toHaveBeenCalled();
    expect(automationCoordinator.inspectChallengePlan).not.toHaveBeenCalled();
  });
});
