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
        params: { canvasSessionId: "canvas_1" }
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

  it("streams feedback subscriptions via polling in stream-json mode", async () => {
    vi.useFakeTimers();
    callMock
      .mockResolvedValueOnce({
        subscriptionId: "canvas_sub_1",
        items: [{ id: "fb_1", cursor: "fb_1", category: "render" }],
        cursor: "fb_1",
        heartbeatMs: 15000,
        activeTargetIds: ["target_1"],
        completeReason: null
      })
      .mockResolvedValueOnce({
        items: [{ id: "fb_2", cursor: "fb_2", category: "render" }],
        nextCursor: "fb_2",
        retention: { activeTargetIds: ["target_1"] }
      });

    const promise = runCanvas(makeArgs([
      "--command",
      "canvas.feedback.subscribe",
      "--params",
      "{\"canvasSessionId\":\"canvas_1\",\"categories\":[\"render\"]}",
      "--timeout-ms",
      "1200"
    ], "stream-json"));

    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;

    expect(callMock).toHaveBeenNthCalledWith(
      1,
      "canvas.execute",
      {
        command: "canvas.feedback.subscribe",
        params: {
          canvasSessionId: "canvas_1",
          categories: ["render"]
        }
      },
      { timeoutMs: 1200 }
    );
    expect(callMock).toHaveBeenNthCalledWith(
      2,
      "canvas.execute",
      {
        command: "canvas.feedback.poll",
        params: {
          canvasSessionId: "canvas_1",
          categories: ["render"],
          afterCursor: "fb_1"
        }
      },
      { timeoutMs: expect.any(Number) }
    );
    expect(writeOutputMock).toHaveBeenCalledTimes(3);
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
          cursor: "fb_2",
          item: {
            id: "fb_2",
            cursor: "fb_2"
          }
        }
      }
    });
    expect(writeOutputMock.mock.calls[2]?.[0]).toMatchObject({
      success: true,
      data: {
        command: "canvas.feedback.subscribe",
        streamEvent: {
          eventType: "feedback.complete",
          cursor: "fb_2",
          completeReason: "timeout"
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
});
