import { describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { buildUninstallCommandResult, buildUpdateCommandResult } from "../src/cli/skill-lifecycle";
import { resolveUpdateSkillModes } from "../src/cli/update-skill-modes";

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

describe("cli skill lifecycle helpers", () => {
  it("keeps update refresh scoped to marker-managed targets when config is absent", () => {
    const resolveUpdateSkillModes = vi.fn(() => ["global"]);
    const hasInstalledConfig = vi.fn(() => false);
    const getBundledSkillTargets = vi.fn(() => [{ agents: ["codex"], dir: "/tmp/update-target" }]);
    const getBundledSkillLifecycleTargets = vi.fn(() => [{ agents: ["codex"], dir: "/tmp/update-target" }]);
    const syncBundledSkillsForTargets = vi.fn(() => ({
      success: true,
      message: "Skills global sync: 1 refreshed across 1 targets",
      mode: "global" as const,
      targets: [],
      installed: [],
      refreshed: ["opendevbrowser-best-practices"],
      unchanged: []
    }));

    const result = buildUpdateCommandResult(
      makeArgs("update", ["--update"]),
      { success: true, message: "updated", cleared: true },
      {
        resolveUpdateSkillModes,
        hasInstalledConfig,
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillTargets,
        getBundledSkillLifecycleTargets,
        syncBundledSkillsForTargets
      }
    );

    expect(resolveUpdateSkillModes).toHaveBeenCalledWith(expect.objectContaining({ command: "update" }));
    expect(getBundledSkillTargets).not.toHaveBeenCalled();
    expect(getBundledSkillLifecycleTargets).toHaveBeenCalledWith("global", {
      includeLegacyArtifacts: false
    });
    expect(syncBundledSkillsForTargets).toHaveBeenCalledWith("global", [{ agents: ["codex"], dir: "/tmp/update-target" }]);
    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        cacheCleared: true,
        skillModes: ["global"]
      })
    }));
  });

  it("repairs every target for config-backed default updates", () => {
    const resolveUpdateSkillModes = vi.fn(() => ["global"]);
    const hasInstalledConfig = vi.fn(() => true);
    const allTargets = [{ agents: ["codex"], dir: "/tmp/repair-target" }];
    const getBundledSkillTargets = vi.fn(() => allTargets);
    const getBundledSkillLifecycleTargets = vi.fn(() => []);
    const syncBundledSkillsForTargets = vi.fn(() => ({
      success: true,
      message: "Skills global sync: 9 installed across 1 targets",
      mode: "global" as const,
      targets: [],
      installed: ["opendevbrowser-best-practices"],
      refreshed: [],
      unchanged: []
    }));

    const result = buildUpdateCommandResult(
      makeArgs("update", ["--update"]),
      { success: true, message: "updated", cleared: true },
      {
        resolveUpdateSkillModes,
        hasInstalledConfig,
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillTargets,
        getBundledSkillLifecycleTargets,
        syncBundledSkillsForTargets
      }
    );

    expect(getBundledSkillTargets).toHaveBeenCalledWith("global");
    expect(getBundledSkillLifecycleTargets).not.toHaveBeenCalled();
    expect(syncBundledSkillsForTargets).toHaveBeenCalledWith("global", allTargets);
    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        skillModes: ["global"]
      })
    }));
  });

  it("treats explicit update scope as authoritative for full target repair", () => {
    const resolveUpdateSkillModes = vi.fn(() => ["global"]);
    const hasInstalledConfig = vi.fn(() => true);
    const allTargets = [{ agents: ["codex"], dir: "/tmp/repair-target" }];
    const getBundledSkillTargets = vi.fn(() => allTargets);
    const getBundledSkillLifecycleTargets = vi.fn(() => []);
    const syncBundledSkillsForTargets = vi.fn(() => ({
      success: true,
      message: "Skills global sync: 9 installed across 1 targets",
      mode: "global" as const,
      targets: [],
      installed: ["opendevbrowser-best-practices"],
      refreshed: [],
      unchanged: []
    }));

    const result = buildUpdateCommandResult(
      makeArgs("update", ["--update", "--global"], "global"),
      { success: true, message: "updated", cleared: true },
      {
        resolveUpdateSkillModes,
        hasInstalledConfig,
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillTargets,
        getBundledSkillLifecycleTargets,
        syncBundledSkillsForTargets
      }
    );

    expect(getBundledSkillTargets).toHaveBeenCalledWith("global");
    expect(getBundledSkillLifecycleTargets).not.toHaveBeenCalled();
    expect(syncBundledSkillsForTargets).toHaveBeenCalledWith("global", allTargets);
    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        skillModes: ["global"]
      })
    }));
  });

  it("preserves resolved update scope in data even when no targets need execution", () => {
    const result = buildUpdateCommandResult(
      makeArgs("update", ["--update", "--skills-global"]),
      { success: true, message: "updated", cleared: true },
      {
        resolveUpdateSkillModes: vi.fn(() => ["global"]),
        hasInstalledConfig: vi.fn(() => false),
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillTargets: vi.fn(() => []),
        getBundledSkillLifecycleTargets: vi.fn(() => []),
        syncBundledSkillsForTargets: vi.fn()
      }
    );

    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        skillModes: ["global"],
        skills: []
      })
    }));
  });

  it("skips update skill refresh execution when --no-skills is present", () => {
    const syncBundledSkillsForTargets = vi.fn();

    const result = buildUpdateCommandResult(
      makeArgs("update", ["--update", "--no-skills"]),
      { success: true, message: "updated", cleared: true },
      {
        resolveUpdateSkillModes,
        hasInstalledConfig: vi.fn(() => true),
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillTargets: vi.fn(() => [{ agents: ["codex"], dir: "/tmp/update-target" }]),
        getBundledSkillLifecycleTargets: vi.fn(() => [{ agents: ["codex"], dir: "/tmp/update-target" }]),
        syncBundledSkillsForTargets
      }
    );

    expect(syncBundledSkillsForTargets).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      success: true,
      message: expect.stringContaining("Managed skill refresh skipped (--no-skills)."),
      data: expect.objectContaining({
        skillModes: [],
        skills: []
      })
    }));
  });

  it("keeps marker-drifted artifact-backed updates repairable without config", () => {
    const resolveUpdateSkillModes = vi.fn(() => ["global"]);
    const hasInstalledConfig = vi.fn(() => false);
    const hasBundledSkillArtifacts = vi.fn(() => true);
    const getBundledSkillTargets = vi.fn(() => []);
    const getBundledSkillLifecycleTargets = vi.fn(() => [{ agents: ["codex"], dir: "/tmp/update-target" }]);
    const syncBundledSkillsForTargets = vi.fn(() => ({
      success: true,
      message: "Skills global sync: 1 refreshed across 1 targets",
      mode: "global" as const,
      targets: [],
      installed: [],
      refreshed: ["opendevbrowser-best-practices"],
      unchanged: []
    }));

    buildUpdateCommandResult(
      makeArgs("update", ["--update"]),
      { success: true, message: "updated", cleared: true },
      {
        resolveUpdateSkillModes,
        hasInstalledConfig,
        hasBundledSkillArtifacts,
        getBundledSkillTargets,
        getBundledSkillLifecycleTargets,
        syncBundledSkillsForTargets
      }
    );

    expect(getBundledSkillTargets).not.toHaveBeenCalled();
    expect(getBundledSkillLifecycleTargets).toHaveBeenCalledWith("global", {
      includeLegacyArtifacts: true
    });
    expect(syncBundledSkillsForTargets).toHaveBeenCalledWith("global", [{ agents: ["codex"], dir: "/tmp/update-target" }]);
  });

  it("keeps explicit skill update scope refresh-only when config is absent", () => {
    const getBundledSkillTargets = vi.fn(() => [{ agents: ["codex"], dir: "/tmp/full-target" }]);
    const getBundledSkillLifecycleTargets = vi.fn(() => [{ agents: ["codex"], dir: "/tmp/managed-target" }]);
    const syncBundledSkillsForTargets = vi.fn(() => ({
      success: true,
      message: "Skills global sync: 1 refreshed across 1 targets",
      mode: "global" as const,
      targets: [],
      installed: [],
      refreshed: ["opendevbrowser-best-practices"],
      unchanged: []
    }));

    buildUpdateCommandResult(
      makeArgs("update", ["--update", "--skills-global"]),
      { success: true, message: "updated", cleared: true },
      {
        resolveUpdateSkillModes: vi.fn(() => ["global"]),
        hasInstalledConfig: vi.fn(() => false),
        hasBundledSkillArtifacts: vi.fn(() => true),
        getBundledSkillTargets,
        getBundledSkillLifecycleTargets,
        syncBundledSkillsForTargets
      }
    );

    expect(getBundledSkillTargets).not.toHaveBeenCalled();
    expect(getBundledSkillLifecycleTargets).toHaveBeenCalledWith("global", {
      includeLegacyArtifacts: true
    });
    expect(syncBundledSkillsForTargets).toHaveBeenCalledWith("global", [{
      agents: ["codex"],
      dir: "/tmp/managed-target"
    }]);
  });

  it("keeps missing-config uninstall cleanup scoped to managed targets", () => {
    const getBundledSkillLifecycleTargets = vi.fn(() => [{ agents: ["codex"], dir: "/tmp/uninstall-target" }]);
    const removeBundledSkillsForTargets = vi.fn(() => ({
      success: true,
      message: "Skills global removal: 9 removed across 1 targets",
      mode: "global" as const,
      targets: [],
      removed: ["opendevbrowser-best-practices"],
      missing: []
    }));

    const result = buildUninstallCommandResult(
      makeArgs("uninstall", ["--global"], "global"),
      "global",
      {
        success: true,
        message: "No plugin config found in /tmp/opendevbrowser.jsonc",
        removed: false,
        configFileDeleted: false
      },
      {
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillLifecycleTargets,
        removeBundledSkillsForTargets
      }
    );

    expect(getBundledSkillLifecycleTargets).toHaveBeenCalledWith("global", {
      includeLegacyArtifacts: false
    });
    expect(removeBundledSkillsForTargets).toHaveBeenCalledWith("global", [{ agents: ["codex"], dir: "/tmp/uninstall-target" }]);
    expect(result).toEqual(expect.objectContaining({
      success: true,
      message: expect.stringContaining("No plugin config found"),
      data: expect.objectContaining({
        skills: expect.objectContaining({
          success: true
        })
      })
    }));
  });

  it("keeps missing-config uninstall cleanup discoverable when canonical packs remain", () => {
    const getBundledSkillLifecycleTargets = vi.fn(() => [{ agents: ["codex"], dir: "/tmp/uninstall-target" }]);
    const removeBundledSkillsForTargets = vi.fn(() => ({
      success: true,
      message: "Skills global removal: 9 removed across 1 targets",
      mode: "global" as const,
      targets: [],
      removed: ["opendevbrowser-best-practices"],
      missing: []
    }));

    buildUninstallCommandResult(
      makeArgs("uninstall", ["--global"], "global"),
      "global",
      {
        success: true,
        message: "No plugin config found in /tmp/opendevbrowser.jsonc",
        removed: false,
        configFileDeleted: false
      },
      {
        hasBundledSkillArtifacts: vi.fn(() => true),
        getBundledSkillLifecycleTargets,
        removeBundledSkillsForTargets
      }
    );

    expect(getBundledSkillLifecycleTargets).toHaveBeenCalledWith("global", {
      includeLegacyArtifacts: true
    });
    expect(removeBundledSkillsForTargets).toHaveBeenCalledWith("global", [{ agents: ["codex"], dir: "/tmp/uninstall-target" }]);
  });

  it("keeps config-backed uninstall cleanup eligible for legacy-target selection", () => {
    const getBundledSkillLifecycleTargets = vi.fn(() => [{ agents: ["codex"], dir: "/tmp/uninstall-target" }]);
    const removeBundledSkillsForTargets = vi.fn(() => ({
      success: true,
      message: "Skills global removal: 9 removed across 1 targets",
      mode: "global" as const,
      targets: [],
      removed: ["opendevbrowser-best-practices"],
      missing: []
    }));

    buildUninstallCommandResult(
      makeArgs("uninstall", ["--global"], "global"),
      "global",
      {
        success: true,
        message: "Removed opendevbrowser from /tmp/opendevbrowser.jsonc",
        removed: true,
        configFileDeleted: false
      },
      {
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillLifecycleTargets,
        removeBundledSkillsForTargets
      }
    );

    expect(getBundledSkillLifecycleTargets).toHaveBeenCalledWith("global", {
      includeLegacyArtifacts: true
    });
    expect(removeBundledSkillsForTargets).toHaveBeenCalledWith("global", [{ agents: ["codex"], dir: "/tmp/uninstall-target" }]);
  });

  it("returns an explicit no-op skills result when uninstall finds no lifecycle targets", () => {
    const getBundledSkillLifecycleTargets = vi.fn(() => []);
    const removeBundledSkillsForTargets = vi.fn();

    const result = buildUninstallCommandResult(
      makeArgs("uninstall", ["--global"], "global"),
      "global",
      {
        success: true,
        message: "Removed opendevbrowser from /tmp/opendevbrowser.jsonc",
        removed: true,
        configFileDeleted: false
      },
      {
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillLifecycleTargets,
        removeBundledSkillsForTargets
      }
    );

    expect(removeBundledSkillsForTargets).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      success: true,
      message: expect.stringContaining("Skills global removal"),
      data: expect.objectContaining({
        skills: {
          success: true,
          message: "Skills global removal: no lifecycle changes across 0 targets",
          mode: "global",
          targets: [],
          removed: [],
          missing: []
        }
      })
    }));
  });

  it("keeps missing-config zero-target uninstalls on the explicit no-op skills contract", () => {
    const getBundledSkillLifecycleTargets = vi.fn(() => []);
    const removeBundledSkillsForTargets = vi.fn();

    const result = buildUninstallCommandResult(
      makeArgs("uninstall", ["--global"], "global"),
      "global",
      {
        success: true,
        message: "No plugin config found in /tmp/opendevbrowser.jsonc",
        removed: false,
        configFileDeleted: false
      },
      {
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillLifecycleTargets,
        removeBundledSkillsForTargets
      }
    );

    expect(removeBundledSkillsForTargets).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      success: true,
      message: expect.stringContaining("Skills global removal"),
      data: expect.objectContaining({
        skills: {
          success: true,
          message: "Skills global removal: no lifecycle changes across 0 targets",
          mode: "global",
          targets: [],
          removed: [],
          missing: []
        }
      })
    }));
  });

  it("skips uninstall skill cleanup execution when --no-skills is present", () => {
    const getBundledSkillLifecycleTargets = vi.fn();
    const removeBundledSkillsForTargets = vi.fn();

    const result = buildUninstallCommandResult(
      makeArgs("uninstall", ["--global", "--no-skills"], "global"),
      "global",
      {
        success: true,
        message: "Removed opendevbrowser from /tmp/opendevbrowser.jsonc",
        removed: true,
        configFileDeleted: false
      },
      {
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillLifecycleTargets,
        removeBundledSkillsForTargets
      }
    );

    expect(getBundledSkillLifecycleTargets).not.toHaveBeenCalled();
    expect(removeBundledSkillsForTargets).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      success: true,
      message: expect.stringContaining("Managed skill cleanup skipped (--no-skills)."),
      data: expect.objectContaining({
        skills: undefined
      })
    }));
  });

  it("suppresses uninstall skill messaging when config removal fails", () => {
    const getBundledSkillLifecycleTargets = vi.fn();
    const removeBundledSkillsForTargets = vi.fn();

    const result = buildUninstallCommandResult(
      makeArgs("uninstall", ["--global", "--no-skills"], "global"),
      "global",
      {
        success: false,
        message: "Failed to uninstall: boom",
        removed: false,
        configFileDeleted: false
      },
      {
        hasBundledSkillArtifacts: vi.fn(() => false),
        getBundledSkillLifecycleTargets,
        removeBundledSkillsForTargets
      }
    );

    expect(getBundledSkillLifecycleTargets).not.toHaveBeenCalled();
    expect(removeBundledSkillsForTargets).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      success: false,
      message: "Failed to uninstall: boom"
    }));
  });
});
