import { describe, expect, it, vi } from "vitest";
import { BrowserManager } from "../src/browser/browser-manager";
import { OpsBrowserManager } from "../src/browser/ops-browser-manager";
import { RemoteManager } from "../src/cli/remote-manager";
import { resolveConfig } from "../src/config";

const expectInspectorShape = (handle: Record<string, unknown>): void => {
  expect(Object.keys(handle).sort()).toEqual([
    "consolePoll",
    "debugTraceSnapshot",
    "listTargets",
    "networkPoll",
    "status"
  ]);
  expect("goto" in handle).toBe(false);
  expect("click" in handle).toBe(false);
};

describe("session inspector composition", () => {
  it("composes the managed browser inspection primitives without adding action methods", async () => {
    const manager = new BrowserManager("/tmp/project", resolveConfig({}));
    const managerAny = manager as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const status = vi.fn(async () => ({ mode: "managed", activeTargetId: "target-1" }));
    const listTargets = vi.fn(async () => ({ activeTargetId: "target-1", targets: [{ targetId: "target-1", type: "page" }] }));
    const consolePoll = vi.fn(async () => ({ events: [{ type: "log" }], nextSeq: 2 }));
    const networkPoll = vi.fn(async () => ({ events: [{ status: 200 }], nextSeq: 3 }));
    const debugTraceSnapshot = vi.fn(async () => ({ requestId: "trace-1", channels: {}, page: {} }));

    Object.assign(managerAny, {
      status,
      listTargets,
      consolePoll,
      networkPoll,
      debugTraceSnapshot
    });

    const handle = manager.createSessionInspector();
    expectInspectorShape(handle as Record<string, unknown>);

    await handle.status("session-1");
    await handle.listTargets("session-1", true);
    await handle.consolePoll("session-1", 1, 5);
    await handle.networkPoll("session-1", 2, 7);
    await handle.debugTraceSnapshot("session-1", { max: 10 });

    expect(status).toHaveBeenCalledWith("session-1");
    expect(listTargets).toHaveBeenCalledWith("session-1", true);
    expect(consolePoll).toHaveBeenCalledWith("session-1", 1, 5);
    expect(networkPoll).toHaveBeenCalledWith("session-1", 2, 7);
    expect(debugTraceSnapshot).toHaveBeenCalledWith("session-1", { max: 10 });
  });

  it("composes the ops inspection primitives without adding action methods", async () => {
    const manager = new OpsBrowserManager({ setChallengeOrchestrator: vi.fn() } as never, resolveConfig({}));
    const managerAny = manager as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const status = vi.fn(async () => ({ mode: "extension", activeTargetId: "ops-target-1" }));
    const listTargets = vi.fn(async () => ({ activeTargetId: "ops-target-1", targets: [{ targetId: "ops-target-1", type: "page" }] }));
    const consolePoll = vi.fn(async () => ({ events: [{ type: "log" }], nextSeq: 2 }));
    const networkPoll = vi.fn(async () => ({ events: [{ status: 200 }], nextSeq: 3 }));
    const debugTraceSnapshot = vi.fn(async () => ({ requestId: "ops-trace-1", channels: {}, page: {} }));

    Object.assign(managerAny, {
      status,
      listTargets,
      consolePoll,
      networkPoll,
      debugTraceSnapshot
    });

    const handle = manager.createSessionInspector();
    expectInspectorShape(handle as Record<string, unknown>);

    await handle.status("ops-session-1");
    await handle.listTargets("ops-session-1", false);
    await handle.consolePoll("ops-session-1", 1, 5);
    await handle.networkPoll("ops-session-1", 2, 7);
    await handle.debugTraceSnapshot("ops-session-1", { max: 10 });

    expect(status).toHaveBeenCalledWith("ops-session-1");
    expect(listTargets).toHaveBeenCalledWith("ops-session-1", false);
    expect(consolePoll).toHaveBeenCalledWith("ops-session-1", 1, 5);
    expect(networkPoll).toHaveBeenCalledWith("ops-session-1", 2, 7);
    expect(debugTraceSnapshot).toHaveBeenCalledWith("ops-session-1", { max: 10 });
  });

  it("composes the remote inspection primitives without adding action methods", async () => {
    const client = {
      call: vi.fn(async (method: string, params: Record<string, unknown>) => {
        switch (method) {
          case "session.status":
            return { mode: "remote", activeTargetId: "remote-target-1" };
          case "targets.list":
            return { activeTargetId: "remote-target-1", targets: [{ targetId: "remote-target-1", type: "page" }] };
          case "devtools.consolePoll":
            return { events: [{ level: "warn", text: "remote warning" }], nextSeq: 2 };
          case "devtools.networkPoll":
            return { events: [{ status: 500, url: "https://example.com" }], nextSeq: 3 };
          case "devtools.debugTraceSnapshot":
            return {
              requestId: "remote-trace-1",
              generatedAt: "2026-04-04T00:00:00.000Z",
              page: { url: "https://example.com", title: "Remote" },
              channels: {
                console: { events: [{ level: "warn", text: "remote warning" }], nextSeq: 2, truncated: false },
                network: { events: [{ status: 500, url: "https://example.com" }], nextSeq: 3, truncated: false }
              },
              meta: { blockerState: "clear" }
            };
          default:
            throw new Error(`Unexpected remote call: ${method}`);
        }
      })
    };
    const manager = new RemoteManager(client as never);

    const handle = manager.createSessionInspector();
    expectInspectorShape(handle as Record<string, unknown>);

    await handle.status("remote-session-1");
    await handle.listTargets("remote-session-1", false);
    await handle.consolePoll("remote-session-1", 1, 5);
    await handle.networkPoll("remote-session-1", 2, 7);
    await handle.debugTraceSnapshot("remote-session-1", { max: 10 });

    expect(client.call).toHaveBeenCalledWith("session.status", { sessionId: "remote-session-1" });
    expect(client.call).toHaveBeenCalledWith("targets.list", { sessionId: "remote-session-1", includeUrls: false });
    expect(client.call).toHaveBeenCalledWith("devtools.consolePoll", { sessionId: "remote-session-1", sinceSeq: 1, max: 5 });
    expect(client.call).toHaveBeenCalledWith("devtools.networkPoll", { sessionId: "remote-session-1", sinceSeq: 2, max: 7 });
    expect(client.call).toHaveBeenCalledWith("devtools.debugTraceSnapshot", { sessionId: "remote-session-1", max: 10 });
  });
});
