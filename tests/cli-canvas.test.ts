import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";

const { callMock, releaseBindingMock, writeOutputMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  releaseBindingMock: vi.fn(),
  writeOutputMock: vi.fn()
}));

vi.mock("../src/cli/daemon-client", () => ({
  DaemonClient: class {
    call = callMock;
    releaseBinding = releaseBindingMock;
  }
}));

vi.mock("../src/cli/output", () => ({
  writeOutput: writeOutputMock
}));

import { runCanvas } from "../src/cli/commands/canvas";

const repoRoot = process.cwd();

const makeArgs = (rawArgs: string[], outputFormat: ParsedArgs["outputFormat"] = "json"): ParsedArgs => ({
  command: "canvas",
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat,
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("canvas CLI command", () => {
  beforeEach(() => {
    callMock.mockReset();
    releaseBindingMock.mockReset();
    writeOutputMock.mockReset();
    releaseBindingMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes a generic canvas command through the daemon client", async () => {
    callMock.mockResolvedValue({ canvasSessionId: "canvas_1" });

    const result = await runCanvas(makeArgs([
      "--command",
      "canvas.session.status",
      "--params",
      "{\"canvasSessionId\":\"canvas_1\"}"
    ]));

    expect(callMock).toHaveBeenCalledWith(
      "canvas.execute",
      {
        command: "canvas.session.status",
        params: { canvasSessionId: "canvas_1", repoRoot }
      },
      { timeoutMs: undefined }
    );
    expect(releaseBindingMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      message: "Canvas executed: canvas.session.status",
      data: {
        command: "canvas.session.status",
        result: { canvasSessionId: "canvas_1" }
      }
    });
  });

  it("routes starter commands through the same generic canvas execution path", async () => {
    callMock.mockResolvedValue({ ok: true, starterId: "dashboard.analytics" });

    const result = await runCanvas(makeArgs([
      "--command",
      "canvas.starter.apply",
      "--params",
      "{\"canvasSessionId\":\"canvas_1\",\"leaseId\":\"lease_1\",\"starterId\":\"dashboard.analytics\"}"
    ]));

    expect(callMock).toHaveBeenCalledWith(
      "canvas.execute",
      {
        command: "canvas.starter.apply",
        params: {
          canvasSessionId: "canvas_1",
          leaseId: "lease_1",
          starterId: "dashboard.analytics",
          repoRoot
        }
      },
      { timeoutMs: undefined }
    );
    expect(result).toEqual({
      success: true,
      message: "Canvas executed: canvas.starter.apply",
      data: {
        command: "canvas.starter.apply",
        result: { ok: true, starterId: "dashboard.analytics" }
      }
    });
  });

  it("streams feedback subscriptions via the public pull-stream commands in stream-json mode", async () => {
    callMock
      .mockResolvedValueOnce({
        subscriptionId: "canvas_sub_1",
        initialItems: [{ id: "fb_1", cursor: "fb_1", category: "render" }],
        cursor: "fb_1",
        heartbeatMs: 15000,
        activeTargetIds: ["target_1"],
        expiresAt: null
      })
      .mockResolvedValueOnce({
        eventType: "feedback.item",
        item: { id: "fb_2", cursor: "fb_2", category: "render" }
      })
      .mockResolvedValueOnce({
        eventType: "feedback.complete",
        cursor: "fb_2",
        ts: "2026-03-14T00:00:00.000Z",
        reason: "session_closed"
      })
      .mockResolvedValueOnce({
        ok: true,
        subscriptionId: "canvas_sub_1"
      });

    const result = await runCanvas(makeArgs([
      "--command",
      "canvas.feedback.subscribe",
      "--params",
      "{\"canvasSessionId\":\"canvas_1\",\"categories\":[\"render\"]}",
      "--timeout-ms",
      "1200"
    ], "stream-json"));

    expect(callMock).toHaveBeenNthCalledWith(
      1,
      "canvas.execute",
      {
        command: "canvas.feedback.subscribe",
        params: {
          canvasSessionId: "canvas_1",
          categories: ["render"],
          repoRoot
        }
      },
      { timeoutMs: 1200 }
    );
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      "canvas.execute",
      expect.objectContaining({
        command: "canvas.feedback.next",
        params: expect.objectContaining({
          canvasSessionId: "canvas_1",
          categories: ["render"],
          subscriptionId: "canvas_sub_1",
          repoRoot
        })
      }),
      { timeoutMs: expect.any(Number) }
    );
    expect(callMock).toHaveBeenNthCalledWith(
      3,
      "canvas.execute",
      expect.objectContaining({
        command: "canvas.feedback.next",
        params: expect.objectContaining({
          canvasSessionId: "canvas_1",
          categories: ["render"],
          subscriptionId: "canvas_sub_1",
          repoRoot
        })
      }),
      { timeoutMs: expect.any(Number) }
    );
    const nextTimeoutMs = [
      callMock.mock.calls[1]?.[1],
      callMock.mock.calls[2]?.[1]
    ].map((call) => (call as { params?: { timeoutMs?: number } } | undefined)?.params?.timeoutMs);
    expect(nextTimeoutMs).toHaveLength(2);
    for (const timeoutMs of nextTimeoutMs) {
      expect(timeoutMs).toEqual(expect.any(Number));
      expect(timeoutMs).toBeGreaterThan(0);
      expect(timeoutMs).toBeLessThanOrEqual(1200);
    }
    expect(callMock).toHaveBeenNthCalledWith(
      4,
      "canvas.execute",
      {
        command: "canvas.feedback.unsubscribe",
        params: {
          canvasSessionId: "canvas_1",
          categories: ["render"],
          subscriptionId: "canvas_sub_1",
          repoRoot
        }
      }
    );
    expect(writeOutputMock).toHaveBeenCalledTimes(4);
    expect(writeOutputMock.mock.calls[0]?.[0]).toMatchObject({
      success: true,
      data: {
        command: "canvas.feedback.subscribe",
        result: {
          subscriptionId: "canvas_sub_1",
          cursor: "fb_1"
        }
      }
    });
    expect(writeOutputMock.mock.calls[1]?.[0]).toMatchObject({
      success: true,
      data: {
        command: "canvas.feedback.subscribe",
        streamEvent: {
          eventType: "feedback.item",
          item: {
            id: "fb_1",
            cursor: "fb_1"
          }
        }
      }
    });
    expect(writeOutputMock.mock.calls[2]?.[0]).toMatchObject({
      success: true,
      data: {
        command: "canvas.feedback.subscribe",
        streamEvent: {
          eventType: "feedback.item",
          item: {
            id: "fb_2",
            cursor: "fb_2"
          }
        }
      }
    });
    expect(writeOutputMock.mock.calls[3]?.[0]).toMatchObject({
      success: true,
      data: {
        command: "canvas.feedback.subscribe",
        streamEvent: {
          eventType: "feedback.complete",
          cursor: "fb_2",
          reason: "session_closed"
        }
      }
    });
    expect(releaseBindingMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      message: "Canvas executed: canvas.feedback.subscribe",
      data: {
        suppressOutput: true
      }
    });
  });

  it("preserves an explicit repoRoot from the caller params", async () => {
    callMock.mockResolvedValue({ ok: true });

    await runCanvas(makeArgs([
      "--command",
      "canvas.session.status",
      "--params",
      "{\"canvasSessionId\":\"canvas_1\",\"repoRoot\":\"/tmp/custom-root\"}"
    ]));

    expect(callMock).toHaveBeenCalledWith(
      "canvas.execute",
      {
        command: "canvas.session.status",
        params: { canvasSessionId: "canvas_1", repoRoot: "/tmp/custom-root" }
      },
      { timeoutMs: undefined }
    );
  });
});
