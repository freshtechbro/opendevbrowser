import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { __test__ as screencastStartTest, runScreencastStart } from "../src/cli/commands/devtools/screencast-start";
import { __test__ as screencastStopTest, runScreencastStop } from "../src/cli/commands/devtools/screencast-stop";
import { DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS } from "../src/cli/transport-timeouts";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (command: ParsedArgs["command"], rawArgs: string[]): ParsedArgs => ({
  command,
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("screencast CLI commands", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("parses screencast-start numeric flags in equals form", () => {
    expect(screencastStartTest.parseScreencastStartArgs([
      "--session-id=s1",
      "--interval-ms=500",
      "--max-frames=4",
      "--timeout-ms=45000"
    ])).toEqual({
      sessionId: "s1",
      targetId: undefined,
      outputDir: undefined,
      intervalMs: 500,
      maxFrames: 4,
      timeoutMs: 45000
    });
  });

  it("starts a screencast with optional fields and timeout forwarding", async () => {
    callDaemon.mockResolvedValue({ screencastId: "cast-1", sessionId: "s1" });

    const result = await runScreencastStart(makeArgs("screencast-start", [
      "--session-id",
      "s1",
      "--target-id",
      "tab-1",
      "--output-dir",
      "/tmp/cast",
      "--interval-ms",
      "750",
      "--max-frames",
      "5",
      "--timeout-ms",
      "60000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("page.screencast.start", {
      sessionId: "s1",
      targetId: "tab-1",
      outputDir: "/tmp/cast",
      intervalMs: 750,
      maxFrames: 5
    }, {
      timeoutMs: 60000
    });
    expect(result).toEqual({
      success: true,
      message: "Screencast started.",
      data: { screencastId: "cast-1", sessionId: "s1" }
    });
  });

  it("stops a screencast with the default transport timeout", async () => {
    callDaemon.mockResolvedValue({ screencastId: "cast-1", endedReason: "stopped" });

    const result = await runScreencastStop(makeArgs("screencast-stop", [
      "--screencast-id",
      "cast-1"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("page.screencast.stop", {
      screencastId: "cast-1"
    }, {
      timeoutMs: DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS
    });
    expect(result).toEqual({
      success: true,
      message: "Screencast stopped.",
      data: { screencastId: "cast-1", endedReason: "stopped" }
    });
  });

  it("requires identifiers for screencast start and stop", async () => {
    await expect(runScreencastStart(makeArgs("screencast-start", []))).rejects.toThrow("Missing --session-id");
    await expect(runScreencastStop(makeArgs("screencast-stop", []))).rejects.toThrow("Missing --screencast-id");
  });

  it("rejects invalid screencast intervals", () => {
    expect(() => screencastStartTest.parseScreencastStartArgs([
      "--session-id",
      "s1",
      "--interval-ms",
      "249"
    ])).toThrow("Invalid --interval-ms");
    expect(() => screencastStopTest.parseScreencastStopArgs([
      "--screencast-id",
      "cast-1",
      "--timeout-ms",
      "oops"
    ])).toThrow("Invalid --timeout-ms");
  });
});
