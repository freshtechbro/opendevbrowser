import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runSessionDisconnect } from "../src/cli/commands/session/disconnect";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "disconnect",
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

describe("disconnect CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("uses the standard daemon timeout when not closing the browser", async () => {
    callDaemon.mockResolvedValue({ success: true });

    const result = await runSessionDisconnect(makeArgs([
      "--session-id",
      "session-1"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.disconnect",
      {
        sessionId: "session-1",
        closeBrowser: undefined
      },
      { timeoutMs: 20_000 }
    );
    expect(result).toEqual({
      success: true,
      message: "Session disconnected: session-1"
    });
  });

  it("extends the daemon timeout when closing the browser", async () => {
    callDaemon.mockResolvedValue({ success: true });

    const result = await runSessionDisconnect(makeArgs([
      "--session-id",
      "session-2",
      "--close-browser"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.disconnect",
      {
        sessionId: "session-2",
        closeBrowser: true
      },
      { timeoutMs: 120_000 }
    );
    expect(result).toEqual({
      success: true,
      message: "Session disconnected: session-2"
    });
  });

  it("accepts inline session ids", async () => {
    callDaemon.mockResolvedValue({ success: true });

    await runSessionDisconnect(makeArgs([
      "--session-id=session-3",
      "--close-browser"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.disconnect",
      {
        sessionId: "session-3",
        closeBrowser: true
      },
      { timeoutMs: 120_000 }
    );
  });

  it("rejects missing session ids", async () => {
    await expect(runSessionDisconnect(makeArgs([]))).rejects.toThrow("Missing --session-id");
    expect(callDaemon).not.toHaveBeenCalled();
  });

  it("rejects missing inline session id values", async () => {
    await expect(runSessionDisconnect(makeArgs(["--session-id"]))).rejects.toThrow("Missing value for --session-id");
    expect(callDaemon).not.toHaveBeenCalled();
  });
});
