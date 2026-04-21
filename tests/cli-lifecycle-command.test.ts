import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import type { CommandDefinition } from "../src/cli/commands/types";
import type { SkillTarget } from "../src/cli/utils/skills";

const writeOutput = vi.fn();
const flushOutputAndExit = vi.fn(async () => {});
const runUpdate = vi.fn();
const runUninstall = vi.fn();
const resolveUpdateSkillModes = vi.fn();
const hasBundledSkillArtifacts = vi.fn();
const getBundledSkillLifecycleTargets = vi.fn();
const syncBundledSkillsForTargets = vi.fn();
const removeBundledSkillsForTargets = vi.fn();
const registry = new Map<string, CommandDefinition>();
const originalArgv = [...process.argv];

function makeArgs(command: ParsedArgs["command"], rawArgs: string[], mode?: "global" | "local"): ParsedArgs {
  return {
    command,
    mode,
    withConfig: false,
    noPrompt: true,
    noInteractive: true,
    quiet: false,
    outputFormat: "json",
    transport: "relay",
    skillsMode: "global",
    fullInstall: false,
    rawArgs
  };
}

function mockCommandRegistry() {
  return {
    registerCommand(definition: CommandDefinition) {
      registry.set(definition.name, definition);
    },
    getCommand(name: string) {
      return registry.get(name);
    }
  };
}

async function runCliWithMocks(args: ParsedArgs): Promise<void> {
  vi.resetModules();
  registry.clear();
  writeOutput.mockClear();
  flushOutputAndExit.mockClear();
  runUpdate.mockClear();
  runUninstall.mockClear();
  resolveUpdateSkillModes.mockClear();
  hasBundledSkillArtifacts.mockClear();
  getBundledSkillLifecycleTargets.mockClear();
  syncBundledSkillsForTargets.mockClear();
  removeBundledSkillsForTargets.mockClear();

  process.argv = ["node", "cli", args.command, ...args.rawArgs];

  vi.doMock("../src/cli/args", () => ({
    parseArgs: () => args,
    detectOutputFormat: () => args.outputFormat
  }));
  vi.doMock("../src/cli/help", () => ({ getHelpText: () => "help" }));
  vi.doMock("../src/cli/commands/registry", mockCommandRegistry);
  vi.doMock("../src/cli/output", () => ({
    writeOutput,
    flushOutputAndExit
  }));
  vi.doMock("../src/cli/commands/update", () => ({ runUpdate }));
  vi.doMock("../src/cli/commands/uninstall", () => ({
    runUninstall,
    findInstalledConfigs: () => ({ global: false, local: false }),
    hasInstalledConfig: () => false
  }));
  vi.doMock("../src/cli/update-skill-modes", () => ({ resolveUpdateSkillModes }));
  vi.doMock("../src/cli/installers/skills", async () => {
    const actual = await vi.importActual<typeof import("../src/cli/installers/skills")>("../src/cli/installers/skills");
    return {
      ...actual,
      hasBundledSkillArtifacts,
      getBundledSkillLifecycleTargets,
      syncBundledSkillsForTargets,
      removeBundledSkillsForTargets
    };
  });

  await import("../src/cli/index.ts");
  await vi.waitFor(() => {
    expect(writeOutput.mock.calls.length + flushOutputAndExit.mock.calls.length).toBeGreaterThan(0);
  });
}

afterEach(() => {
  process.argv = [...originalArgv];
  vi.restoreAllMocks();
});

describe("cli lifecycle command wiring", () => {
  it("keeps update refresh scoped to marker-managed targets when config is absent", async () => {
    const targets: SkillTarget[] = [{ agents: ["codex"], dir: "/tmp/update-skill-target" }];
    runUpdate.mockReturnValue({ success: true, message: "updated", cleared: true });
    resolveUpdateSkillModes.mockReturnValue(["global"]);
    hasBundledSkillArtifacts.mockReturnValue(false);
    getBundledSkillLifecycleTargets.mockReturnValue(targets);
    syncBundledSkillsForTargets.mockReturnValue({
      success: true,
      message: "Skills global sync: 1 refreshed across 1 targets",
      mode: "global",
      targets: [],
      installed: [],
      refreshed: ["opendevbrowser-best-practices"],
      unchanged: []
    });

    await runCliWithMocks(makeArgs("update", ["--update"]));

    expect(getBundledSkillLifecycleTargets).toHaveBeenCalledWith("global", {
      includeLegacyArtifacts: false
    });
    expect(syncBundledSkillsForTargets).toHaveBeenCalledWith("global", targets);
    expect(writeOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          cacheCleared: true,
          skillModes: ["global"]
        })
      }),
      expect.objectContaining({ format: "json", quiet: false })
    );
  });

  it("broadens explicit uninstall cleanup to canonical packs even when config is already gone", async () => {
    const targets: SkillTarget[] = [{ agents: ["codex"], dir: "/tmp/uninstall-skill-target" }];
    runUninstall.mockReturnValue({
      success: true,
      message: "No plugin config found in /tmp/opendevbrowser.jsonc",
      removed: false,
      configFileDeleted: false
    });
    hasBundledSkillArtifacts.mockReturnValue(true);
    getBundledSkillLifecycleTargets.mockReturnValue(targets);
    removeBundledSkillsForTargets.mockReturnValue({
      success: true,
      message: "Skills global removal: 9 removed across 1 targets",
      mode: "global",
      targets: [],
      removed: ["opendevbrowser-best-practices"],
      missing: []
    });

    await runCliWithMocks(makeArgs("uninstall", ["--global"], "global"));

    expect(getBundledSkillLifecycleTargets).toHaveBeenCalledWith("global", {
      includeLegacyArtifacts: true
    });
    expect(removeBundledSkillsForTargets).toHaveBeenCalledWith("global", targets);
    expect(writeOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining("No plugin config found"),
        data: expect.objectContaining({
          skills: expect.objectContaining({
            success: true
          })
        })
      }),
      expect.objectContaining({ format: "json", quiet: false })
    );
  });
});
