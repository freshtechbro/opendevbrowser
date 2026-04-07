import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { __test__, runUpload } from "../src/cli/commands/interact/upload";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "upload",
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

describe("upload CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("parses files and target id", () => {
    expect(__test__.parseUploadArgs([
      "--session-id=s1",
      "--target-id=tab-11",
      "--ref=r4",
      "--files=/tmp/a.txt,/tmp/b.txt"
    ])).toEqual({
      sessionId: "s1",
      targetId: "tab-11",
      ref: "r4",
      files: ["/tmp/a.txt", "/tmp/b.txt"]
    });
  });

  it("forwards upload requests to the daemon", async () => {
    callDaemon.mockResolvedValue({ fileCount: 2, mode: "direct_input" });

    const result = await runUpload(makeArgs([
      "--session-id",
      "s1",
      "--target-id",
      "tab-11",
      "--ref",
      "r4",
      "--files",
      "/tmp/a.txt,/tmp/b.txt"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("interact.upload", {
      sessionId: "s1",
      targetId: "tab-11",
      ref: "r4",
      files: ["/tmp/a.txt", "/tmp/b.txt"]
    });
    expect(result).toEqual({
      success: true,
      message: "Upload complete.",
      data: { fileCount: 2, mode: "direct_input" }
    });
  });

  it("requires session id, ref, and files", async () => {
    await expect(runUpload(makeArgs(["--ref", "r4", "--files", "/tmp/a.txt"]))).rejects.toThrow("Missing --session-id");
    await expect(runUpload(makeArgs(["--session-id", "s1", "--files", "/tmp/a.txt"]))).rejects.toThrow("Missing --ref");
    await expect(runUpload(makeArgs(["--session-id", "s1", "--ref", "r4"]))).rejects.toThrow("Missing --files");
  });
});
