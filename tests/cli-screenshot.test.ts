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
      targetId: undefined,
      path: undefined,
      ref: undefined,
      fullPage: false,
      timeoutMs: 45000
    });
  });

  it("parses target-id in equals form", () => {
    const parsed = __test__.parseScreenshotArgs([
      "--session-id=s1",
      "--target-id=tab-11",
      "--timeout-ms=45000"
    ]);
    expect(parsed).toEqual({
      sessionId: "s1",
      targetId: "tab-11",
      path: undefined,
      ref: undefined,
      fullPage: false,
      timeoutMs: 45000
    });
  });

  it("parses ref and full-page flags", () => {
    expect(__test__.parseScreenshotArgs([
      "--session-id=s1",
      "--ref",
      "r4"
    ])).toEqual({
      sessionId: "s1",
      targetId: undefined,
      path: undefined,
      ref: "r4",
      fullPage: false,
      timeoutMs: undefined
    });

    expect(__test__.parseScreenshotArgs([
      "--session-id=s1",
      "--full-page"
    ])).toEqual({
      sessionId: "s1",
      targetId: undefined,
      path: undefined,
      ref: undefined,
      fullPage: true,
      timeoutMs: undefined
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

  it("passes target-id through screenshot calls", async () => {
    callDaemon.mockResolvedValue({ path: "/tmp/capture.png" });

    await runScreenshot(makeArgs([
      "--session-id",
      "s1",
      "--target-id",
      "tab-11"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "page.screenshot",
      { sessionId: "s1", targetId: "tab-11" }
    );
  });

  it("passes ref and full-page through screenshot calls", async () => {
    callDaemon.mockResolvedValue({ base64: "image" });

    await runScreenshot(makeArgs([
      "--session-id",
      "s1",
      "--ref",
      "r4"
    ]));

    expect(callDaemon).toHaveBeenNthCalledWith(
      1,
      "page.screenshot",
      { sessionId: "s1", ref: "r4" }
    );

    await runScreenshot(makeArgs([
      "--session-id",
      "s1",
      "--full-page"
    ]));

    expect(callDaemon).toHaveBeenNthCalledWith(
      2,
      "page.screenshot",
      { sessionId: "s1", fullPage: true }
    );
  });

  it("calls daemon without timeout options when timeout is not provided", async () => {
    callDaemon.mockResolvedValue({ path: "/tmp/capture.png" });

    await runScreenshot(makeArgs([
      "--session-id",
      "s1"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "page.screenshot",
      { sessionId: "s1" }
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

  it("rejects --ref with --full-page", () => {
    expect(() => __test__.parseScreenshotArgs([
      "--session-id",
      "s1",
      "--ref",
      "r1",
      "--full-page"
    ])).toThrow("Choose either --ref or --full-page.");
  });
});
