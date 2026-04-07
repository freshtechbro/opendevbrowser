import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionInspectorTool } from "../src/tools/session_inspector";
import type { RelayStatus } from "../src/relay/relay-server";

const { inspectSession } = vi.hoisted(() => ({
  inspectSession: vi.fn()
}));

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

vi.mock("../src/browser/session-inspector", () => ({
  inspectSession
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

describe("session inspector tool", () => {
  beforeEach(() => {
    inspectSession.mockReset();
  });

  it("returns the summarized result and swallows relay refresh failures", async () => {
    const inspector = { inspector: true };
    const relayStatus = makeRelayStatus();
    const refresh = vi.fn(async () => {
      throw new Error("relay refresh failed");
    });
    const status = vi.fn(() => relayStatus);
    inspectSession.mockResolvedValue({
      session: { sessionId: "s1", mode: "managed" },
      relay: null,
      targets: { activeTargetId: "target-1", count: 1, items: [] },
      console: { eventCount: 0, nextSeq: 0, truncated: false, errorCount: 0, warningCount: 0, latest: [] },
      network: { eventCount: 0, nextSeq: 0, truncated: false, failureCount: 0, latestFailures: [] },
      proofArtifact: { source: "debug_trace_snapshot", requestId: null, generatedAt: null, blockerState: "clear" },
      healthState: "ok",
      suggestedNextAction: "Continue."
    });

    const tool = createSessionInspectorTool({
      manager: {
        createSessionInspector: vi.fn(() => inspector)
      },
      relay: {
        refresh,
        status
      }
    } as never);

    const result = parse(await tool.execute({
      sessionId: "s1",
      includeUrls: true,
      sinceConsoleSeq: 1,
      sinceNetworkSeq: 2,
      sinceExceptionSeq: 3,
      max: 4,
      requestId: "req-1"
    } as never));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(inspectSession).toHaveBeenCalledWith(inspector, {
      sessionId: "s1",
      includeUrls: true,
      sinceConsoleSeq: 1,
      sinceNetworkSeq: 2,
      sinceExceptionSeq: 3,
      max: 4,
      requestId: "req-1",
      relayStatus
    });
    expect(result).toMatchObject({
      ok: true,
      session: { sessionId: "s1", mode: "managed" },
      healthState: "ok"
    });
  });

  it("returns session_inspector_unavailable when the runtime has no inspector", async () => {
    const tool = createSessionInspectorTool({
      manager: {},
      relay: {
        refresh: vi.fn(async () => undefined),
        status: vi.fn(() => makeRelayStatus())
      }
    } as never);

    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(inspectSession).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        message: "Session inspector is unavailable for the current runtime.",
        code: "session_inspector_unavailable"
      }
    });
  });

  it("serializes Error failures from inspectSession", async () => {
    inspectSession.mockRejectedValue(new Error("trace blew up"));

    const tool = createSessionInspectorTool({
      manager: {
        createSessionInspector: vi.fn(() => ({ inspector: true }))
      }
    } as never);

    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "trace blew up",
        code: "session_inspector_failed"
      }
    });
  });

  it("falls back to Unknown error for non-Error throwables", async () => {
    inspectSession.mockRejectedValue("bad throwable");

    const tool = createSessionInspectorTool({
      manager: {
        createSessionInspector: vi.fn(() => ({ inspector: true }))
      }
    } as never);

    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Unknown error",
        code: "session_inspector_failed"
      }
    });
  });
});
