import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayStatus } from "../src/relay/relay-server";

const { buildCorrelatedAuditBundle } = vi.hoisted(() => ({
  buildCorrelatedAuditBundle: vi.fn()
}));

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

vi.mock("../src/browser/session-inspector", () => ({
  buildCorrelatedAuditBundle
}));

const parse = (value: string): Record<string, unknown> => JSON.parse(value) as Record<string, unknown>;

const makeRelayStatus = (): RelayStatus => ({
  running: true,
  port: 8787,
  extensionConnected: false,
  extensionHandshakeComplete: true,
  annotationConnected: false,
  opsConnected: true,
  canvasConnected: false,
  cdpConnected: false,
  pairingRequired: false,
  health: {
    ok: true,
    challengeState: "clear",
    blockedSessions: [],
    waitingForExtension: false,
    actionable: []
  }
});

const makeCoordinator = () => ({
  reviewDesktop: vi.fn(async (input: Record<string, unknown>) => ({
    observation: { observationId: "obs-1", browserSessionId: input.browserSessionId },
    verification: { summary: "verified" }
  })),
  inspectChallengePlan: vi.fn(async (input: Record<string, unknown>) => ({
    mode: input.runMode ?? "browser",
    source: "config",
    summary: "challenge plan"
  })),
  statusCapabilities: vi.fn(async (input: Record<string, unknown>) => ({
    host: { desktopObservationAvailable: true },
    session: input.browserSessionId ?? null
  }))
});

describe("operator tool wrappers", () => {
  beforeEach(() => {
    buildCorrelatedAuditBundle.mockReset();
  });

  it("forwards review-desktop calls through the automation coordinator", async () => {
    const coordinator = makeCoordinator();
    const { createReviewDesktopTool } = await import("../src/tools/review_desktop");

    const tool = createReviewDesktopTool({
      automationCoordinator: coordinator
    } as never);

    const result = parse(await tool.execute({
      sessionId: "session-1",
      targetId: "target-1",
      reason: "qa",
      maxChars: 120,
      cursor: "cursor-1"
    } as never));

    expect(coordinator.reviewDesktop).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      reason: "qa",
      maxChars: 120,
      cursor: "cursor-1"
    });
    expect(result).toMatchObject({
      ok: true,
      observation: { observationId: "obs-1", browserSessionId: "session-1" }
    });
  });

  it("returns automation_coordinator_unavailable when review-desktop has no coordinator", async () => {
    const { createReviewDesktopTool } = await import("../src/tools/review_desktop");

    const tool = createReviewDesktopTool({} as never);
    const result = parse(await tool.execute({ sessionId: "session-1" } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Automation coordinator unavailable.",
        code: "automation_coordinator_unavailable"
      }
    });
  });

  it("forwards session-inspector-plan calls through the automation coordinator", async () => {
    const coordinator = makeCoordinator();
    const { createSessionInspectorPlanTool } = await import("../src/tools/session_inspector_plan");

    const tool = createSessionInspectorPlanTool({
      automationCoordinator: coordinator
    } as never);

    const result = parse(await tool.execute({
      sessionId: "session-2",
      targetId: "target-2",
      challengeAutomationMode: "browser_with_helper"
    } as never));

    expect(coordinator.inspectChallengePlan).toHaveBeenCalledWith({
      browserSessionId: "session-2",
      targetId: "target-2",
      runMode: "browser_with_helper"
    });
    expect(result).toMatchObject({
      ok: true,
      mode: "browser_with_helper"
    });
  });

  it("returns automation_coordinator_unavailable when session-inspector-plan has no coordinator", async () => {
    const { createSessionInspectorPlanTool } = await import("../src/tools/session_inspector_plan");

    const tool = createSessionInspectorPlanTool({} as never);
    const result = parse(await tool.execute({ sessionId: "session-2" } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Automation coordinator unavailable.",
        code: "automation_coordinator_unavailable"
      }
    });
  });

  it("forwards status-capabilities calls for host and session-scoped discovery", async () => {
    const coordinator = makeCoordinator();
    const { createStatusCapabilitiesTool } = await import("../src/tools/status_capabilities");

    const tool = createStatusCapabilitiesTool({
      automationCoordinator: coordinator
    } as never);

    const hostResult = parse(await tool.execute({} as never));
    const sessionResult = parse(await tool.execute({
      sessionId: "session-3",
      targetId: "target-3",
      challengeAutomationMode: "browser"
    } as never));

    expect(coordinator.statusCapabilities).toHaveBeenNthCalledWith(1, {
      browserSessionId: undefined,
      targetId: undefined,
      runMode: undefined
    });
    expect(coordinator.statusCapabilities).toHaveBeenNthCalledWith(2, {
      browserSessionId: "session-3",
      targetId: "target-3",
      runMode: "browser"
    });
    expect(hostResult).toMatchObject({
      ok: true,
      host: { desktopObservationAvailable: true },
      session: null
    });
    expect(sessionResult).toMatchObject({
      ok: true,
      session: "session-3"
    });
  });

  it("returns automation_coordinator_unavailable when status-capabilities has no coordinator", async () => {
    const { createStatusCapabilitiesTool } = await import("../src/tools/status_capabilities");

    const tool = createStatusCapabilitiesTool({} as never);
    const result = parse(await tool.execute({ sessionId: "session-3" } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Automation coordinator unavailable.",
        code: "automation_coordinator_unavailable"
      }
    });
  });

  it("composes session-inspector-audit with relay status even when refresh fails", async () => {
    const coordinator = makeCoordinator();
    const relayStatus = makeRelayStatus();
    const refresh = vi.fn(async () => {
      throw new Error("refresh failed");
    });
    const createSessionInspector = vi.fn(() => ({ inspector: true }));
    buildCorrelatedAuditBundle.mockResolvedValue({
      bundleId: "bundle-1",
      relay: relayStatus,
      challengePlan: { summary: "challenge plan" }
    });

    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");
    const tool = createSessionInspectorAuditTool({
      automationCoordinator: coordinator,
      manager: {
        createSessionInspector
      },
      relay: {
        refresh,
        status: vi.fn(() => relayStatus)
      }
    } as never);

    const result = parse(await tool.execute({
      sessionId: "session-4",
      targetId: "target-4",
      requestId: "req-4",
      challengeAutomationMode: "browser_with_helper"
    } as never));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(coordinator.reviewDesktop).toHaveBeenCalledWith({
      browserSessionId: "session-4",
      targetId: "target-4",
      reason: undefined,
      maxChars: undefined,
      cursor: undefined
    });
    expect(coordinator.inspectChallengePlan).toHaveBeenCalledWith({
      browserSessionId: "session-4",
      targetId: "target-4",
      runMode: "browser_with_helper"
    });
    expect(buildCorrelatedAuditBundle).toHaveBeenCalledWith(expect.objectContaining({
      browserSessionId: "session-4",
      targetId: "target-4",
      requestId: "req-4",
      relayStatus
    }));
    expect(createSessionInspector).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      bundleId: "bundle-1"
    });
  });

  it("composes session-inspector-audit with a null relay status when relay is absent", async () => {
    const coordinator = makeCoordinator();
    buildCorrelatedAuditBundle.mockResolvedValue({
      bundleId: "bundle-2",
      relay: null
    });

    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");
    const tool = createSessionInspectorAuditTool({
      automationCoordinator: coordinator,
      manager: {
        createSessionInspector: vi.fn(() => ({ inspector: true }))
      }
    } as never);

    const result = parse(await tool.execute({
      sessionId: "session-5"
    } as never));

    expect(buildCorrelatedAuditBundle).toHaveBeenCalledWith(expect.objectContaining({
      browserSessionId: "session-5",
      relayStatus: null
    }));
    expect(result).toMatchObject({
      ok: true,
      bundleId: "bundle-2"
    });
  });

  it("returns session_inspector_unavailable when session-inspector-audit has no inspector", async () => {
    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");

    const tool = createSessionInspectorAuditTool({
      automationCoordinator: makeCoordinator(),
      manager: {}
    } as never);
    const result = parse(await tool.execute({ sessionId: "session-6" } as never));

    expect(buildCorrelatedAuditBundle).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Session inspector is unavailable for the current runtime.",
        code: "session_inspector_unavailable"
      }
    });
  });

  it("returns automation_coordinator_unavailable when session-inspector-audit has no coordinator", async () => {
    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");

    const tool = createSessionInspectorAuditTool({
      manager: {
        createSessionInspector: vi.fn(() => ({ inspector: true }))
      }
    } as never);
    const result = parse(await tool.execute({ sessionId: "session-7" } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Automation coordinator unavailable.",
        code: "automation_coordinator_unavailable"
      }
    });
  });
});
