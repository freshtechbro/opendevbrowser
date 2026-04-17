import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { __test__, runSessionInspector } from "../src/cli/commands/session/inspector";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "session-inspector",
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

describe("session-inspector CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("parses split-form flags", () => {
    expect(__test__.parseSessionInspectorArgs([
      "--session-id",
      "s1",
      "--include-urls",
      "--since-console-seq",
      "1",
      "--since-network-seq",
      "2",
      "--since-exception-seq",
      "3",
      "--max",
      "4",
      "--request-id",
      "req-1"
    ])).toEqual({
      sessionId: "s1",
      includeUrls: true,
      sinceConsoleSeq: 1,
      sinceNetworkSeq: 2,
      sinceExceptionSeq: 3,
      max: 4,
      requestId: "req-1"
    });
  });

  it("parses equals-form flags", () => {
    expect(__test__.parseSessionInspectorArgs([
      "--session-id=s2",
      "--since-console-seq=5",
      "--since-network-seq=6",
      "--since-exception-seq=7",
      "--max=8",
      "--request-id=req-2"
    ])).toEqual({
      sessionId: "s2",
      sinceConsoleSeq: 5,
      sinceNetworkSeq: 6,
      sinceExceptionSeq: 7,
      max: 8,
      requestId: "req-2"
    });
  });

  it.each([
    ["--session-id", "Missing value for --session-id"],
    ["--since-console-seq", "Missing value for --since-console-seq"],
    ["--since-network-seq", "Missing value for --since-network-seq"],
    ["--since-exception-seq", "Missing value for --since-exception-seq"],
    ["--max", "Missing value for --max"],
    ["--request-id", "Missing value for --request-id"]
  ])("rejects a missing value for %s", (flag, message) => {
    expect(() => __test__.parseSessionInspectorArgs([flag])).toThrow(message);
  });

  it("rejects invalid numeric flags", () => {
    expect(() => __test__.parseSessionInspectorArgs([
      "--session-id",
      "s1",
      "--since-network-seq",
      "-1"
    ])).toThrow("Invalid --since-network-seq");

    expect(() => __test__.parseSessionInspectorArgs([
      "--session-id",
      "s1",
      "--max",
      "0"
    ])).toThrow("Invalid --max");
  });

  it("forwards the daemon payload and omits includeUrls when the flag is absent", async () => {
    callDaemon.mockResolvedValue({
      session: { sessionId: "s1" },
      healthState: "ok"
    });

    const result = await runSessionInspector(makeArgs([
      "--session-id",
      "s1",
      "--since-console-seq",
      "1",
      "--since-network-seq",
      "2",
      "--since-exception-seq",
      "3",
      "--max",
      "20",
      "--request-id",
      "req-1"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("session.inspect", {
      sessionId: "s1",
      sinceConsoleSeq: 1,
      sinceNetworkSeq: 2,
      sinceExceptionSeq: 3,
      max: 20,
      requestId: "req-1"
    });
    expect(result).toEqual({
      success: true,
      message: "Session inspector snapshot captured.",
      data: {
        session: { sessionId: "s1" },
        healthState: "ok"
      }
    });
    expect(result.message).not.toContain("Next step:");
  });

  it("requires --session-id before calling the daemon", async () => {
    await expect(runSessionInspector(makeArgs([]))).rejects.toThrow("Missing --session-id");
    expect(callDaemon).not.toHaveBeenCalled();
  });
});
