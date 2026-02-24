import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { __test__, runScreenshot } from "../src/cli/commands/devtools/screenshot";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "screenshot",
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

describe("screenshot CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("parses timeout-ms in equals form", () => {
    const parsed = __test__.parseScreenshotArgs([
      "--session-id=s1",
      "--timeout-ms=45000"
    ]);
    expect(parsed).toEqual({
      sessionId: "s1",
      timeoutMs: 45000
    });
  });

  it("passes timeout-ms to daemon call options", async () => {
    callDaemon.mockResolvedValue({ path: "/tmp/capture.png" });

    const result = await runScreenshot(makeArgs([
      "--session-id",
      "s1",
      "--path",
      "/tmp/capture.png",
      "--timeout-ms",
      "60000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "page.screenshot",
      { sessionId: "s1", path: "/tmp/capture.png" },
      { timeoutMs: 60000 }
    );
    expect(result).toEqual({
      success: true,
      message: "Screenshot captured.",
      data: { path: "/tmp/capture.png" }
    });
  });

  it("calls daemon without timeout options when timeout is not provided", async () => {
    callDaemon.mockResolvedValue({ path: "/tmp/capture.png" });

    await runScreenshot(makeArgs([
      "--session-id",
      "s1"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "page.screenshot",
      { sessionId: "s1", path: undefined }
    );
  });

  it("rejects invalid timeout-ms values", () => {
    expect(() => __test__.parseScreenshotArgs([
      "--session-id",
      "s1",
      "--timeout-ms",
      "oops"
    ])).toThrow("Invalid --timeout-ms");
  });

  it("requires --session-id", async () => {
    await expect(runScreenshot(makeArgs([]))).rejects.toThrow("Missing --session-id");
  });
});
