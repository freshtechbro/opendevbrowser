import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runSessionConnect } from "../src/cli/commands/session/connect";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "connect",
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

describe("connect CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("uses an extended daemon transport timeout for session.connect", async () => {
    callDaemon.mockResolvedValue({ sessionId: "session-1", mode: "extension" });

    const result = await runSessionConnect(makeArgs([
      "--ws-endpoint",
      "ws://127.0.0.1:8787/cdp",
      "--extension-legacy"
    ]));

    expect(callDaemon).toHaveBeenCalledWith(
      "session.connect",
      {
        wsEndpoint: "ws://127.0.0.1:8787/cdp",
        extensionLegacy: true
      },
      { timeoutMs: 30000 }
    );
    expect(result).toEqual({
      success: true,
      message: "Session connected: session-1",
      data: {
        sessionId: "session-1",
        mode: "extension"
      }
    });
  });
});
