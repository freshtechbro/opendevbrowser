import { describe, expect, it, vi } from "vitest";
import { inspectSession } from "../src/browser/session-inspector";
import type { SessionInspectorHandle } from "../src/browser/manager-types";
import type { RelayStatus } from "../src/relay/relay-server";

type InspectorStatus = Awaited<ReturnType<SessionInspectorHandle["status"]>>;
type InspectorTargets = Awaited<ReturnType<SessionInspectorHandle["listTargets"]>>;
type InspectorTrace = Awaited<ReturnType<SessionInspectorHandle["debugTraceSnapshot"]>>;

const makeRelayStatus = (overrides: Partial<RelayStatus> = {}): RelayStatus => ({
  running: true,
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
  },
  ...overrides
});

const makeHandle = (options: {
  session?: Partial<InspectorStatus>;
  targets?: Partial<InspectorTargets>;
  trace?: InspectorTrace;
} = {}) => {
  const session: InspectorStatus = {
    sessionId: "session-1",
    mode: "managed",
    activeTargetId: "target-1",
    url: "https://session.example",
    title: "Session Title",
    meta: {
      blockerState: "clear",
      dialog: { open: false }
    },
    ...options.session
  } as InspectorStatus;

  const targets: InspectorTargets = {
    activeTargetId: "target-1",
    targets: [
      {
        targetId: "target-1",
        type: "page",
        title: "Session Title",
        url: "https://session.example"
      }
    ],
    ...options.targets
  } as InspectorTargets;

  const trace: InspectorTrace = options.trace ?? ({
    channels: {},
    meta: {},
    page: {}
  } as InspectorTrace);

  const handle: SessionInspectorHandle = {
    status: vi.fn(async () => session),
    listTargets: vi.fn(async () => targets),
    consolePoll: vi.fn(async () => ({ events: [], nextSeq: 0 })),
    networkPoll: vi.fn(async () => ({ events: [], nextSeq: 0 })),
    debugTraceSnapshot: vi.fn(async () => trace)
  };

  return { handle, session, targets, trace };
};

describe("inspectSession", () => {
  it("aggregates console and network summaries into a warning result", async () => {
    const { handle } = makeHandle({
      trace: {
        requestId: "trace-1",
        generatedAt: "2026-04-03T20:00:00.000Z",
        page: {
          url: "https://trace.example/path",
          title: "Trace Title"
        },
        channels: {
          console: {
            events: [
              { level: "error", text: " boom " },
              { type: "warning", message: " heads up " },
              { level: "info", value: " from value " },
              { level: "log" }
            ],
            nextSeq: 8,
            truncated: true
          },
          network: {
            events: [
              { status: 500, method: "GET", url: "https://trace.example/fail-1" },
              { status: 200, method: "POST", url: "https://trace.example/ok" },
              { errorText: "timeout", method: "PUT", url: "https://trace.example/fail-2" },
              { error: "dns" }
            ],
            nextSeq: 9,
            truncated: false
          }
        },
        meta: {
          blockerState: "clear"
        }
      } as InspectorTrace
    });

    const relayStatus = makeRelayStatus({ port: 8787 });
    const result = await inspectSession(handle, {
      sessionId: "session-1",
      max: 10,
      relayStatus
    });

    expect(handle.listTargets).toHaveBeenCalledWith("session-1", true);
    expect(handle.debugTraceSnapshot).toHaveBeenCalledWith("session-1", {
      sinceConsoleSeq: undefined,
      sinceNetworkSeq: undefined,
      sinceExceptionSeq: undefined,
      max: 10,
      requestId: undefined
    });
    expect(result.relay).toMatchObject({
      running: true,
      port: 8787,
      health: { ok: true }
    });
    expect(result.console).toEqual({
      eventCount: 4,
      nextSeq: 8,
      truncated: true,
      errorCount: 1,
      warningCount: 1,
      latest: [
        { level: "info", message: "from value" },
        { level: "warning", message: "heads up" },
        { level: "error", message: "boom" }
      ]
    });
    expect(result.network).toEqual({
      eventCount: 4,
      nextSeq: 9,
      truncated: false,
      failureCount: 3,
      latestFailures: [
        { error: "dns" },
        { error: "timeout", method: "PUT", url: "https://trace.example/fail-2" },
        { status: 500, method: "GET", url: "https://trace.example/fail-1" }
      ]
    });
    expect(result.proofArtifact).toEqual({
      source: "debug_trace_snapshot",
      requestId: "trace-1",
      generatedAt: "2026-04-03T20:00:00.000Z",
      blockerState: "clear",
      url: "https://trace.example/path",
      title: "Trace Title"
    });
    expect(result.healthState).toBe("warning");
    expect(result.suggestedNextAction).toBe(
      "Inspect the summarized trace failures, fix the page instability, then rerun snapshot or review."
    );
  });

  it("falls back to session metadata and defaults when trace metadata is incomplete", async () => {
    const { handle, session } = makeHandle({
      session: {
        meta: {
          blockerState: "resolving",
          dialog: { open: false }
        }
      },
      trace: {
        channels: {},
        meta: {},
        page: {
          url: "",
          title: ""
        }
      } as InspectorTrace
    });

    const result = await inspectSession(handle, {
      sessionId: "session-2",
      includeUrls: false,
      requestId: "fallback-req"
    });

    expect(handle.listTargets).toHaveBeenCalledWith("session-2", false);
    expect(handle.debugTraceSnapshot).toHaveBeenCalledWith("session-2", {
      sinceConsoleSeq: undefined,
      sinceNetworkSeq: undefined,
      sinceExceptionSeq: undefined,
      max: 25,
      requestId: "fallback-req"
    });
    expect(result.relay).toBeNull();
    expect(result.console).toEqual({
      eventCount: 0,
      nextSeq: null,
      truncated: false,
      errorCount: 0,
      warningCount: 0,
      latest: []
    });
    expect(result.network).toEqual({
      eventCount: 0,
      nextSeq: null,
      truncated: false,
      failureCount: 0,
      latestFailures: []
    });
    expect(result.proofArtifact).toEqual({
      source: "debug_trace_snapshot",
      requestId: "fallback-req",
      generatedAt: null,
      blockerState: "resolving",
      url: session.url,
      title: session.title
    });
    expect(result.healthState).toBe("ok");
    expect(result.suggestedNextAction).toBe(
      "Capture snapshot or review and continue the normal snapshot -> action -> snapshot loop."
    );
  });

  it("normalizes unsupported blocker-state strings to clear", async () => {
    const { handle } = makeHandle({
      session: {
        meta: {
          blockerState: "resolving",
          dialog: { open: false }
        }
      },
      trace: {
        channels: {},
        meta: {
          blockerState: "unknown"
        },
        page: {}
      } as InspectorTrace
    });

    const result = await inspectSession(handle, {
      sessionId: "session-invalid-blocker"
    });

    expect(result.proofArtifact.blockerState).toBe("clear");
    expect(result.healthState).toBe("ok");
  });

  it("omits proof url and title when neither trace nor session provides them", async () => {
    const { handle } = makeHandle({
      session: {
        url: undefined,
        title: undefined,
        meta: undefined
      },
      trace: {
        channels: {
          console: {
            events: [{ message: "plain message" }],
            nextSeq: 1
          }
        },
        meta: {},
        page: {
          url: "",
          title: ""
        }
      } as InspectorTrace
    });

    const result = await inspectSession(handle, {
      sessionId: "session-no-proof-fields"
    });

    expect(result.proofArtifact).toEqual({
      source: "debug_trace_snapshot",
      requestId: null,
      generatedAt: null,
      blockerState: "clear"
    });
    expect(result.console.latest).toEqual([{ level: "log", message: "plain message" }]);
    expect(result.healthState).toBe("ok");
  });

  it("treats an open dialog as blocked before warning-level trace noise", async () => {
    const { handle } = makeHandle({
      session: {
        meta: {
          blockerState: "clear",
          dialog: { open: true }
        }
      },
      trace: {
        channels: {
          console: {
            events: [{ level: "error", text: "still blocked" }],
            nextSeq: 1,
            truncated: false
          }
        },
        meta: {
          blockerState: "clear"
        },
        page: {}
      } as InspectorTrace
    });

    const result = await inspectSession(handle, {
      sessionId: "session-3",
      relayStatus: makeRelayStatus({
        health: {
          ok: false,
          challengeState: "blocked",
          blockedSessions: ["session-3"],
          waitingForExtension: false,
          actionable: ["Reconnect relay"]
        }
      })
    });

    expect(result.healthState).toBe("blocked");
    expect(result.suggestedNextAction).toBe(
      "Handle the open dialog before continuing any page interaction."
    );
  });

  it.each([
    {
      name: "extension handshake incomplete",
      handleOptions: {
        session: { mode: "extension" }
      },
      relayStatus: makeRelayStatus({
        extensionConnected: true,
        extensionHandshakeComplete: false
      }),
      expected: "Re-establish a clean daemon-extension handshake: open the extension popup, click Connect again, confirm `status --daemon` shows ext=on and handshake=on, then retry the next page action."
    },
    {
      name: "active blocker",
      handleOptions: {
        session: {
          meta: {
            blockerState: "active",
            dialog: { open: false }
          }
        }
      },
      relayStatus: null,
      expected: "Resolve the active blocker or challenge before issuing more page actions."
    },
    {
      name: "missing active target",
      handleOptions: {
        targets: {
          activeTargetId: null,
          targets: []
        }
      },
      relayStatus: null,
      expected: "Create or select a target before continuing the next automation step."
    }
  ])("marks the session blocked for $name", async ({ handleOptions, relayStatus, expected }) => {
    const { handle } = makeHandle(handleOptions);
    const result = await inspectSession(handle, {
      sessionId: "session-4",
      ...(relayStatus ? { relayStatus } : {})
    });

    expect(result.healthState).toBe("blocked");
    expect(result.suggestedNextAction).toBe(expected);
  });

  it("returns a relay-health warning without blocking when the trace is otherwise clean", async () => {
    const { handle } = makeHandle();
    const result = await inspectSession(handle, {
      sessionId: "session-5",
      relayStatus: makeRelayStatus({
        health: {
          ok: false,
          challengeState: "clear",
          blockedSessions: [],
          waitingForExtension: true,
          actionable: ["Wait for relay health to recover"]
        }
      })
    });

    expect(result.relay).toMatchObject({
      running: true,
      health: {
        ok: false,
        waitingForExtension: true
      }
    });
    expect("port" in (result.relay ?? {})).toBe(false);
    expect(result.healthState).toBe("warning");
    expect(result.suggestedNextAction).toBe(
      "Capture snapshot or review and continue the normal snapshot -> action -> snapshot loop."
    );
  });
});
