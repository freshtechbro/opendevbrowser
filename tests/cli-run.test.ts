import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { __test__, runScriptCommand } from "../src/cli/commands/run";

const {
  cleanup,
  createOpenDevBrowserCore,
  managerDisconnect,
  managerLaunch,
  readFileSync,
  runnerRun,
  writeOutput
} = vi.hoisted(() => ({
  cleanup: vi.fn(),
  createOpenDevBrowserCore: vi.fn(),
  managerDisconnect: vi.fn(),
  managerLaunch: vi.fn(),
  readFileSync: vi.fn(),
  runnerRun: vi.fn(),
  writeOutput: vi.fn()
}));

vi.mock("fs", () => ({
  readFileSync
}));

vi.mock("../src/core", () => ({
  createOpenDevBrowserCore
}));

vi.mock("../src/cli/output", () => ({
  writeOutput
}));

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "run",
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

describe("run CLI command", () => {
  beforeEach(() => {
    cleanup.mockReset();
    createOpenDevBrowserCore.mockReset();
    managerDisconnect.mockReset();
    managerLaunch.mockReset();
    readFileSync.mockReset();
    runnerRun.mockReset();
    writeOutput.mockReset();

    readFileSync.mockReturnValue(JSON.stringify({
      steps: [
        {
          action: "snapshot",
          args: { mode: "outline" }
        }
      ]
    }));
    managerLaunch.mockResolvedValue({ sessionId: "session-run", warnings: [] });
    managerDisconnect.mockResolvedValue(undefined);
    runnerRun.mockResolvedValue({ steps: [{ ok: true, action: "snapshot" }] });
    createOpenDevBrowserCore.mockReturnValue({
      manager: {
        launch: managerLaunch,
        disconnect: managerDisconnect
      },
      runner: {
        run: runnerRun
      },
      cleanup
    });
  });

  it("parses --persist-profile as a boolean flag when no value is provided", () => {
    expect(__test__.parseRunArgs(["--persist-profile"])).toEqual({
      flags: [],
      persistProfile: true
    });
  });

  it("parses --persist-profile in value and equals forms", () => {
    expect(__test__.parseRunArgs(["--persist-profile", "false"]).persistProfile).toBe(false);
    expect(__test__.parseRunArgs(["--persist-profile", "1"]).persistProfile).toBe(true);
    expect(__test__.parseRunArgs(["--persist-profile=0"]).persistProfile).toBe(false);
    expect(__test__.parseRunArgs(["--persist-profile=true"]).persistProfile).toBe(true);
  });

  it("rejects invalid --persist-profile values", () => {
    expect(() => __test__.parseRunArgs(["--persist-profile", "maybe"])).toThrow("Invalid --persist-profile");
  });

  it("uses a temporary profile by default for one-shot runs", async () => {
    await runScriptCommand(makeArgs([
      "--script",
      "/tmp/workflow.json",
      "--headless"
    ]));

    expect(managerLaunch).toHaveBeenCalledWith(expect.objectContaining({
      headless: true,
      persistProfile: false
    }));
    expect(managerDisconnect).toHaveBeenCalledWith("session-run", true);
    expect(cleanup).toHaveBeenCalled();
  });

  it("preserves explicit persist-profile opt-in for one-shot runs", async () => {
    await runScriptCommand(makeArgs([
      "--script",
      "/tmp/workflow.json",
      "--headless",
      "--persist-profile"
    ]));

    expect(managerLaunch).toHaveBeenCalledWith(expect.objectContaining({
      persistProfile: true
    }));
  });

  it("forwards explicit persist-profile=false for one-shot runs", async () => {
    await runScriptCommand(makeArgs([
      "--script",
      "/tmp/workflow.json",
      "--headless",
      "--persist-profile",
      "false"
    ]));

    expect(managerLaunch).toHaveBeenCalledWith(expect.objectContaining({
      persistProfile: false
    }));
  });
});
