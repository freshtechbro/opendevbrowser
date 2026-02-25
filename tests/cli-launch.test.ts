import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { __test__, runSessionLaunch } from "../src/cli/commands/session/launch";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "launch",
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: true,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("launch CLI command", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("parses --persist-profile as boolean flag when no value is provided", () => {
    expect(__test__.parseLaunchArgs(["--persist-profile"])).toEqual({
      flags: [],
      persistProfile: true
    });
  });

  it("parses --persist-profile in value and equals forms", () => {
    expect(__test__.parseLaunchArgs(["--persist-profile", "false"]).persistProfile).toBe(false);
    expect(__test__.parseLaunchArgs(["--persist-profile=true"]).persistProfile).toBe(true);
  });

  it("rejects invalid --persist-profile values", () => {
    expect(() => __test__.parseLaunchArgs(["--persist-profile", "maybe"])).toThrow("Invalid --persist-profile");
  });

  it("forwards persistProfile=false to daemon launch", async () => {
    callDaemon.mockResolvedValue({ sessionId: "session-temp" });

    const result = await runSessionLaunch(makeArgs([
      "--no-extension",
      "--headless",
      "--persist-profile",
      "false",
      "--start-url",
      "https://www.youtube.com"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("session.launch", expect.objectContaining({
      noExtension: true,
      headless: true,
      persistProfile: false,
      startUrl: "https://www.youtube.com"
    }));
    expect(result).toEqual({
      success: true,
      message: "Session launched: session-temp",
      data: { sessionId: "session-temp" }
    });
  });
});
