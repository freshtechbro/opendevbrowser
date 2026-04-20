import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import {
  hasBundledSkillArtifacts,
  hasManagedBundledSkillInstall,
  removeBundledSkills,
  syncBundledSkills
} from "../src/cli/installers/skills";
import * as skillInstallers from "../src/cli/installers/skills";
import {
  getBundledSkillsDir,
  getGlobalSkillTargets,
  getLocalSkillTargets
} from "../src/cli/utils/skills";
import { findInstalledConfigs, runUninstall } from "../src/cli/commands/uninstall";
import { bundledSkillDirectories } from "../src/skills/bundled-skill-directories";

let tempRoot = "";
let workspaceDir = "";
let originalCwd = "";
let originalHome: string | undefined;
let originalConfigDir: string | undefined;
let originalCodexHome: string | undefined;
let originalClaudeCodeHome: string | undefined;
let originalAmpCliHome: string | undefined;
const managedSkillsMarkerName = ".opendevbrowser-managed-skills.json";
const managedSkillSentinelName = ".opendevbrowser-managed-skill.json";
const managedSkillOwner = "opendevbrowser";

function expectNoLegacyAliasFields(value: object): void {
  expect("removedLegacyAliases" in value).toBe(false);
  expect("preservedLegacyAliases" in value).toBe(false);
}

function writeManagedMarker(
  targetDir: string,
  packNames: readonly string[],
  managesAllCanonicalPacks: boolean = true
): void {
  fs.writeFileSync(
    path.join(targetDir, managedSkillsMarkerName),
    `${JSON.stringify({ managedPacks: [...packNames], managesAllCanonicalPacks }, null, 2)}\n`,
    "utf8"
  );
}

function hashManagedPack(targetPath: string): string {
  const hash = crypto.createHash("sha256");

  const visit = (currentPath: string, relativePath: string): void => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isFile() && entry.name === managedSkillSentinelName) {
        continue;
      }

      const absolutePath = path.join(currentPath, entry.name);
      const entryRelativePath = relativePath
        ? path.posix.join(relativePath, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        hash.update(`D:${entryRelativePath}\0`);
        visit(absolutePath, entryRelativePath);
        continue;
      }

      if (entry.isFile()) {
        hash.update(`F:${entryRelativePath}\0`);
        hash.update(fs.readFileSync(absolutePath));
        hash.update("\0");
      }
    }
  };

  visit(targetPath, "");
  return hash.digest("hex");
}

function writeManagedSentinel(targetDir: string, packName: string): void {
  const targetPath = path.join(targetDir, packName);
  fs.writeFileSync(
    path.join(targetPath, managedSkillSentinelName),
    `${JSON.stringify({
      managedBy: managedSkillOwner,
      packName,
      fingerprint: hashManagedPack(targetPath)
    }, null, 2)}\n`,
    "utf8"
  );
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "odb-cli-skills-"));
  workspaceDir = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });

  originalCwd = process.cwd();
  process.chdir(workspaceDir);

  originalHome = process.env.HOME;
  originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
  originalCodexHome = process.env.CODEX_HOME;
  originalClaudeCodeHome = process.env.CLAUDECODE_HOME;
  originalAmpCliHome = process.env.AMP_CLI_HOME;

  process.env.HOME = path.join(tempRoot, "home");
  process.env.OPENCODE_CONFIG_DIR = path.join(tempRoot, "opencode-config");
  process.env.CODEX_HOME = path.join(tempRoot, "codex-home");
  process.env.CLAUDECODE_HOME = path.join(tempRoot, "claudecode-home");
  process.env.AMP_CLI_HOME = path.join(tempRoot, "ampcli-home");
});

afterEach(async () => {
  process.chdir(originalCwd);

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (originalConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR;
  } else {
    process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
  }

  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }

  if (originalClaudeCodeHome === undefined) {
    delete process.env.CLAUDECODE_HOME;
  } else {
    process.env.CLAUDECODE_HOME = originalClaudeCodeHome;
  }

  if (originalAmpCliHome === undefined) {
    delete process.env.AMP_CLI_HOME;
  } else {
    process.env.AMP_CLI_HOME = originalAmpCliHome;
  }

  await rm(tempRoot, { recursive: true, force: true });
});

describe("bundled skill lifecycle sync", () => {
  const bundledSkillNames = bundledSkillDirectories.map((entry) => entry.name);

  it("does not leave a managed marker behind when sync fails before any pack lands", () => {
    const blockedTargetDir = path.join(tempRoot, "blocked-skill-target");
    fs.writeFileSync(blockedTargetDir, "blocked", "utf8");

    const result = skillInstallers.syncBundledSkillsForTargets("global", [{
      agents: ["codex"],
      dir: blockedTargetDir
    }]);

    expect(result.success).toBe(false);
    expect(fs.existsSync(path.join(blockedTargetDir, managedSkillsMarkerName))).toBe(false);
    expect(hasManagedBundledSkillInstall("global")).toBe(false);
  });

  it("installs canonical bundled skills across all global agent targets", () => {
    const result = syncBundledSkills("global");

    expect(result.success).toBe(true);
    expect(result.targets.length).toBe(getGlobalSkillTargets().length);
    expect(result.installed.length).toBe(getGlobalSkillTargets().length * bundledSkillNames.length);
    expect(result.refreshed).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expectNoLegacyAliasFields(result);
    result.targets.forEach(expectNoLegacyAliasFields);
    expect(result.message).toContain("installed");
    expect(result.message).not.toContain("legacy aliases preserved");

    for (const target of getGlobalSkillTargets()) {
      const bestPracticesPath = path.join(target.dir, "opendevbrowser-best-practices", "SKILL.md");
      expect(fs.existsSync(bestPracticesPath)).toBe(true);
      expect(fs.existsSync(path.join(target.dir, "research"))).toBe(false);
      expect(fs.existsSync(path.join(target.dir, "shopping"))).toBe(false);
    }
  }, 60_000);

  it("installs canonical bundled skills across all local agent targets", () => {
    const result = syncBundledSkills("local");

    expect(result.success).toBe(true);
    expect(result.targets.length).toBe(getLocalSkillTargets().length);
    expect(result.installed.length).toBe(getLocalSkillTargets().length * bundledSkillNames.length);

    for (const target of getLocalSkillTargets()) {
      const bestPracticesPath = path.join(target.dir, "opendevbrowser-best-practices", "SKILL.md");
      expect(fs.existsSync(bestPracticesPath)).toBe(true);
    }
  }, 60_000);

  it("marks reruns unchanged when the managed copies already match the bundled packs", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);

    const secondRun = syncBundledSkills("global");
    expect(secondRun.success).toBe(true);
    expect(secondRun.installed).toEqual([]);
    expect(secondRun.refreshed).toEqual([]);
    expect(secondRun.unchanged.length).toBe(getGlobalSkillTargets().length * bundledSkillNames.length);
  }, 60_000);

  it("refreshes a drifted managed canonical pack and restores the bundled quick start", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);

    const bundledSkillPath = path.join(getBundledSkillsDir(), "opendevbrowser-best-practices", "SKILL.md");
    const bundledContent = fs.readFileSync(bundledSkillPath, "utf8");
    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for refresh test.");
    }

    const targetSkillPath = path.join(targetDir, "opendevbrowser-best-practices", "SKILL.md");
    fs.writeFileSync(targetSkillPath, bundledContent.replace("## Quick Start", "## Drifted Start"), "utf8");

    const secondRun = syncBundledSkills("global");
    expect(secondRun.success).toBe(true);
    expect(secondRun.installed).toEqual([]);
    expect(secondRun.refreshed).toEqual(["opendevbrowser-best-practices"]);
    expect(fs.readFileSync(targetSkillPath, "utf8")).toBe(bundledContent);
  }, 60_000);

  it("repairs blocking non-directory pack paths during sync", () => {
    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for blocking-path repair test.");
    }

    const [firstPackName, secondPackName] = bundledSkillNames;
    if (!firstPackName || !secondPackName) {
      throw new Error("Missing bundled skills for blocking-path repair test.");
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, secondPackName), "blocking file", "utf8");

    const result = skillInstallers.syncBundledSkillsForTargets("global", [getGlobalSkillTargets()[0]!]);

    expect(result.success).toBe(true);
    expect(result.targets[0]?.installed).toContain(firstPackName);
    expect(result.targets[0]?.refreshed).toContain(secondPackName);
    expect(fs.statSync(path.join(targetDir, secondPackName)).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(targetDir, secondPackName, "SKILL.md"))).toBe(true);
  }, 60_000);

  it("does not treat noncanonical skill directories as canonical bundled artifacts", () => {
    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for noncanonical artifact test.");
    }

    fs.mkdirSync(path.join(targetDir, "research"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, "shopping"), { recursive: true });

    expect(hasBundledSkillArtifacts("global")).toBe(false);
  });

  it("does not treat bare canonical directories without sentinels as managed artifacts", () => {
    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for bare canonical artifact test.");
    }

    fs.mkdirSync(path.join(targetDir, "opendevbrowser-best-practices"), { recursive: true });

    expect(hasBundledSkillArtifacts("global")).toBe(false);
    expect(findInstalledConfigs()).toEqual({ global: false, local: false });
    expect(skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: true
    })).toEqual([]);
  });

  it("does not refresh bare canonical packs during markerless lifecycle recovery", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for markerless sync ownership test.");
    }

    const bundledSkillPath = path.join(getBundledSkillsDir(), "opendevbrowser-best-practices", "SKILL.md");
    const bundledContent = fs.readFileSync(bundledSkillPath, "utf8");
    const managedPath = path.join(targetDir, "opendevbrowser-best-practices");
    const userOwnedPath = path.join(targetDir, "opendevbrowser-design-agent");
    fs.rmSync(path.join(targetDir, managedSkillsMarkerName), { force: true });
    fs.writeFileSync(path.join(managedPath, "SKILL.md"), "managed drift", "utf8");
    fs.rmSync(path.join(userOwnedPath, managedSkillSentinelName), { force: true });
    fs.writeFileSync(path.join(userOwnedPath, "SKILL.md"), "user drift", "utf8");

    const selectedTargets = skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: true
    });
    const result = skillInstallers.syncBundledSkillsForTargets("global", selectedTargets);

    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(managedPath, "SKILL.md"), "utf8")).toBe(bundledContent);
    expect(fs.readFileSync(path.join(userOwnedPath, "SKILL.md"), "utf8")).toBe("user drift");
  }, 60_000);

  it("does not remove bare canonical packs during markerless lifecycle cleanup", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for markerless removal ownership test.");
    }

    const managedPath = path.join(targetDir, "opendevbrowser-best-practices");
    const userOwnedPath = path.join(targetDir, "opendevbrowser-design-agent");
    fs.rmSync(path.join(targetDir, managedSkillsMarkerName), { force: true });
    fs.rmSync(path.join(userOwnedPath, managedSkillSentinelName), { force: true });

    const selectedTargets = skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: true
    });
    const result = skillInstallers.removeBundledSkillsForTargets("global", selectedTargets);

    expect(result.success).toBe(true);
    expect(fs.existsSync(managedPath)).toBe(false);
    expect(fs.existsSync(userOwnedPath)).toBe(true);
  }, 60_000);

  it("keeps subset ownership scoped after markerless recovery recreates the marker", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for subset ownership persistence test.");
    }

    const bundledSkillPath = path.join(getBundledSkillsDir(), "opendevbrowser-best-practices", "SKILL.md");
    const bundledContent = fs.readFileSync(bundledSkillPath, "utf8");
    const managedPath = path.join(targetDir, "opendevbrowser-best-practices");
    const userOwnedPath = path.join(targetDir, "opendevbrowser-design-agent");
    fs.rmSync(path.join(targetDir, managedSkillsMarkerName), { force: true });
    fs.rmSync(path.join(userOwnedPath, managedSkillSentinelName), { force: true });
    fs.writeFileSync(path.join(managedPath, "SKILL.md"), "managed drift", "utf8");
    fs.writeFileSync(path.join(userOwnedPath, "SKILL.md"), "user drift", "utf8");

    const recoveryTargets = skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: true
    });
    const recoveryResult = skillInstallers.syncBundledSkillsForTargets("global", recoveryTargets);
    expect(recoveryResult.success).toBe(true);
    expect(fs.readFileSync(path.join(managedPath, "SKILL.md"), "utf8")).toBe(bundledContent);
    expect(fs.readFileSync(path.join(userOwnedPath, "SKILL.md"), "utf8")).toBe("user drift");

    const cleanupTargets = skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: true
    });
    const cleanupResult = skillInstallers.removeBundledSkillsForTargets("global", cleanupTargets);
    expect(cleanupResult.success).toBe(true);
    expect(fs.existsSync(managedPath)).toBe(false);
    expect(fs.existsSync(userOwnedPath)).toBe(true);
  }, 60_000);

  it("restores all canonical packs when a full target sync follows subset marker drift", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const target = getGlobalSkillTargets()[0];
    if (!target) {
      throw new Error("Missing global target for full-target repair test.");
    }

    const retainedPackName = "opendevbrowser-best-practices";
    const restoredPackName = bundledSkillNames.find((packName) => packName !== retainedPackName);
    if (!restoredPackName) {
      throw new Error("Missing secondary bundled skill for full-target repair test.");
    }

    writeManagedMarker(target.dir, [retainedPackName], false);
    fs.rmSync(path.join(target.dir, restoredPackName), { recursive: true, force: true });

    const result = skillInstallers.syncBundledSkillsForTargets("global", [target]);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(target.dir, retainedPackName, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(target.dir, restoredPackName, "SKILL.md"))).toBe(true);
    expect(
      fs.readFileSync(path.join(target.dir, managedSkillsMarkerName), "utf8")
    ).toContain('"managesAllCanonicalPacks": true');
  }, 60_000);

  it("restores the previous marker when full-target sync fails after touching earlier packs", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const target = getGlobalSkillTargets()[0];
    const retainedPackName = bundledSkillNames[0];
    const installedPackName = bundledSkillNames[1];
    const failingPackName = bundledSkillNames[2];
    if (!target || !retainedPackName || !installedPackName || !failingPackName) {
      throw new Error("Missing bundled skill targets for marker rollback test.");
    }

    writeManagedMarker(target.dir, [retainedPackName], false);
    fs.rmSync(path.join(target.dir, installedPackName), { recursive: true, force: true });
    fs.rmSync(path.join(target.dir, failingPackName), { recursive: true, force: true });

    return (async () => {
      vi.resetModules();
      const originalFs = await vi.importActual<typeof import("fs")>("fs");
      const mockedCpSync: typeof originalFs.cpSync = (...args) => {
        const [sourcePath, targetPath] = args;
        if (typeof sourcePath === "string"
          && typeof targetPath === "string"
          && path.basename(sourcePath) === failingPackName
          && targetPath === path.join(target.dir, failingPackName)) {
          throw new Error("simulated sync failure");
        }
        return originalFs.cpSync(...args);
      };

      vi.doMock("fs", () => ({
        ...originalFs,
        cpSync: mockedCpSync
      }));

      try {
        const freshInstallers = await import("../src/cli/installers/skills");
        const result = freshInstallers.syncBundledSkillsForTargets("global", [target]);
        const lifecycleTargets = freshInstallers.getBundledSkillLifecycleTargets("global", {
          includeLegacyArtifacts: true
        });
        const restoredTarget = lifecycleTargets.find((entry) => entry.dir === target.dir) as
          | ({ managedPackNames?: string[] } & { dir: string })
          | undefined;

        expect(result.success).toBe(false);
        expect(fs.existsSync(path.join(target.dir, installedPackName, "SKILL.md"))).toBe(true);
        expect(
          fs.readFileSync(path.join(target.dir, managedSkillsMarkerName), "utf8")
        ).toContain('"managesAllCanonicalPacks": false');
        expect(
          fs.readFileSync(path.join(target.dir, managedSkillsMarkerName), "utf8")
        ).toContain(retainedPackName);
        expect(
          fs.readFileSync(path.join(target.dir, managedSkillsMarkerName), "utf8")
        ).not.toContain(installedPackName);
        expect(
          fs.readFileSync(path.join(target.dir, managedSkillsMarkerName), "utf8")
        ).not.toContain(failingPackName);
        expect(restoredTarget?.managedPackNames).toEqual(
          expect.arrayContaining([retainedPackName, installedPackName])
        );
        expect(restoredTarget?.managedPackNames).not.toContain(failingPackName);
      } finally {
        vi.doUnmock("fs");
        vi.resetModules();
      }
    })();
  }, 60_000);

  it("cleans retired packs from subset markers without failing sync", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for subset retired-pack sync test.");
    }

    const retiredPackName = "opendevbrowser-retired-pack";
    const retiredPackPath = path.join(targetDir, retiredPackName);
    fs.mkdirSync(retiredPackPath, { recursive: true });
    fs.writeFileSync(path.join(retiredPackPath, "SKILL.md"), "retired", "utf8");
    writeManagedSentinel(targetDir, retiredPackName);
    writeManagedMarker(targetDir, ["opendevbrowser-best-practices", retiredPackName], false);

    const selectedTargets = skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: true
    });
    const result = skillInstallers.syncBundledSkillsForTargets("global", selectedTargets);

    expect(result.success).toBe(true);
    expect(fs.existsSync(retiredPackPath)).toBe(false);
  }, 60_000);

  it("discovers and cleans markerless retired sentinel-backed packs", () => {
    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for markerless retired-pack cleanup test.");
    }

    const retiredPackName = "opendevbrowser-retired-pack";
    const retiredPackPath = path.join(targetDir, retiredPackName);
    fs.mkdirSync(retiredPackPath, { recursive: true });
    fs.writeFileSync(path.join(retiredPackPath, "SKILL.md"), "retired", "utf8");
    writeManagedSentinel(targetDir, retiredPackName);

    expect(hasBundledSkillArtifacts("global")).toBe(true);
    expect(findInstalledConfigs()).toEqual({ global: true, local: false });

    const selectedTargets = skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: true
    });
    const result = skillInstallers.syncBundledSkillsForTargets("global", selectedTargets);

    expect(result.success).toBe(true);
    expect(fs.existsSync(retiredPackPath)).toBe(false);
    expect(hasManagedBundledSkillInstall("global")).toBe(false);
    expect(hasBundledSkillArtifacts("global")).toBe(false);
  });

  it("treats managed skill markers as installed for uninstall discovery", () => {
    expect(findInstalledConfigs()).toEqual({ global: false, local: false });

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for uninstall discovery test.");
    }

    fs.mkdirSync(path.join(targetDir, "research"), { recursive: true });
    expect(findInstalledConfigs()).toEqual({ global: false, local: false });

    const result = syncBundledSkills("global");
    expect(result.success).toBe(true);

    expect(hasManagedBundledSkillInstall("global")).toBe(true);
    expect(findInstalledConfigs()).toEqual({ global: true, local: false });
  }, 60_000);

  it("ignores unreadable markers for managed install discovery", () => {
    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for unreadable marker discovery test.");
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, managedSkillsMarkerName), "{not-json", "utf8");

    expect(hasManagedBundledSkillInstall("global")).toBe(false);
    expect(findInstalledConfigs()).toEqual({ global: false, local: false });
  });

  it("treats canonical bundled packs as installed for uninstall discovery after marker drift", () => {
    const result = syncBundledSkills("global");
    expect(result.success).toBe(true);

    for (const target of getGlobalSkillTargets()) {
      fs.rmSync(path.join(target.dir, managedSkillsMarkerName), { force: true });
    }

    expect(hasManagedBundledSkillInstall("global")).toBe(false);
    expect(hasBundledSkillArtifacts("global")).toBe(true);
    expect(findInstalledConfigs()).toEqual({ global: true, local: false });
  }, 60_000);

  it("publishes canonical shared targets for ClaudeCode and AmpCLI homes", () => {
    const globalTargets = getGlobalSkillTargets();
    const claudeDir = path.join(process.env.CLAUDECODE_HOME!, "skills");
    const ampDir = path.join(process.env.AMP_CLI_HOME!, "skills");

    const claudeTarget = globalTargets.find((target) => path.resolve(target.dir) === path.resolve(claudeDir));
    expect(claudeTarget).toBeDefined();
    expect(claudeTarget?.agents).toEqual(["claudecode"]);

    const ampTarget = globalTargets.find((target) => path.resolve(target.dir) === path.resolve(ampDir));
    expect(ampTarget).toBeDefined();
    expect(ampTarget?.agents).toEqual(["ampcli"]);
  });

  it("removes managed canonical packs during uninstall cleanup", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);
    expect(hasBundledSkillArtifacts("global")).toBe(true);

    const result = removeBundledSkills("global");
    expect(result.success).toBe(true);
    expect(result.removed.length).toBe(getGlobalSkillTargets().length * bundledSkillNames.length);
    expectNoLegacyAliasFields(result);
    result.targets.forEach(expectNoLegacyAliasFields);
    expect(hasManagedBundledSkillInstall("global")).toBe(false);
    expect(hasBundledSkillArtifacts("global")).toBe(false);
  }, 60_000);

  it("keeps the other managed scope intact during scoped lifecycle cleanup", () => {
    const globalResult = syncBundledSkills("global");
    expect(globalResult.success).toBe(true);

    const localResult = syncBundledSkills("local");
    expect(localResult.success).toBe(true);

    const localRemoval = removeBundledSkills("local");
    expect(localRemoval.success).toBe(true);

    expect(hasManagedBundledSkillInstall("global")).toBe(true);
    expect(hasBundledSkillArtifacts("global")).toBe(true);
    expect(hasManagedBundledSkillInstall("local")).toBe(false);
    expect(hasBundledSkillArtifacts("local")).toBe(false);

    const globalTarget = getGlobalSkillTargets()[0]?.dir;
    const localTarget = getLocalSkillTargets()[0]?.dir;
    if (!globalTarget || !localTarget) {
      throw new Error("Missing managed targets for scoped lifecycle test.");
    }

    expect(fs.existsSync(path.join(globalTarget, "opendevbrowser-design-agent", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(localTarget, "opendevbrowser-design-agent", "SKILL.md"))).toBe(false);
  }, 60_000);

  it("syncs only the selected managed targets during update-style refresh", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const [firstTarget, secondTarget] = getGlobalSkillTargets();
    if (!firstTarget || !secondTarget) {
      throw new Error("Missing global targets for scoped sync test.");
    }

    fs.rmSync(path.join(secondTarget.dir, ".opendevbrowser-managed-skills.json"), { force: true });
    fs.rmSync(path.join(secondTarget.dir, "opendevbrowser-design-agent"), { recursive: true, force: true });
    fs.writeFileSync(
      path.join(firstTarget.dir, "opendevbrowser-design-agent", "SKILL.md"),
      "drifted",
      "utf8"
    );

    const selectedTargets = skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: false
    });

    const result = skillInstallers.syncBundledSkillsForTargets("global", selectedTargets);

    expect(result.success).toBe(true);
    expect(result.targets.map((target) => target.targetDir)).toContain(firstTarget.dir);
    expect(result.targets.map((target) => target.targetDir)).not.toContain(secondTarget.dir);
    expect(fs.existsSync(path.join(secondTarget.dir, "opendevbrowser-design-agent", "SKILL.md"))).toBe(false);
  }, 60_000);

  it("removes only the selected managed targets during uninstall-style cleanup", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const [firstTarget, secondTarget] = getGlobalSkillTargets();
    if (!firstTarget || !secondTarget) {
      throw new Error("Missing global targets for scoped removal test.");
    }

    fs.rmSync(path.join(secondTarget.dir, ".opendevbrowser-managed-skills.json"), { force: true });

    const selectedTargets = skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: false
    });
    const result = skillInstallers.removeBundledSkillsForTargets("global", selectedTargets);

    expect(result.success).toBe(true);
    expect(result.targets.map((target) => target.targetDir)).toContain(firstTarget.dir);
    expect(result.targets.map((target) => target.targetDir)).not.toContain(secondTarget.dir);
    expect(fs.existsSync(path.join(firstTarget.dir, "opendevbrowser-design-agent", "SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(secondTarget.dir, "opendevbrowser-design-agent", "SKILL.md"))).toBe(true);
  }, 60_000);

  it("treats sentinel-backed canonical packs as lifecycle targets when config installs still exist", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const [firstTarget, secondTarget] = getGlobalSkillTargets();
    if (!firstTarget || !secondTarget) {
      throw new Error("Missing global targets for lifecycle selection test.");
    }

    fs.rmSync(path.join(secondTarget.dir, ".opendevbrowser-managed-skills.json"), { force: true });

    const selectedTargets = skillInstallers.getBundledSkillLifecycleTargets("global", {
      includeLegacyArtifacts: true
    });

    expect(selectedTargets.map((target) => target.dir)).toEqual(
      expect.arrayContaining([firstTarget.dir, secondTarget.dir])
    );
  }, 60_000);

  it("removes retired managed packs recorded in the marker during sync", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for retired managed pack sync test.");
    }

    const retiredPackName = "opendevbrowser-retired-pack";
    fs.mkdirSync(path.join(targetDir, retiredPackName), { recursive: true });
    fs.writeFileSync(path.join(targetDir, retiredPackName, "SKILL.md"), "# retired\n", "utf8");
    writeManagedMarker(targetDir, [...bundledSkillNames, retiredPackName]);
    writeManagedSentinel(targetDir, retiredPackName);

    const result = syncBundledSkills("global");

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(targetDir, retiredPackName))).toBe(false);
    expect(fs.readFileSync(path.join(targetDir, managedSkillsMarkerName), "utf8")).not.toContain(retiredPackName);
  }, 60_000);

  it("removes retired managed packs recorded in the marker during uninstall cleanup", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for retired managed pack removal test.");
    }

    const retiredPackName = "opendevbrowser-retired-pack";
    fs.mkdirSync(path.join(targetDir, retiredPackName), { recursive: true });
    fs.writeFileSync(path.join(targetDir, retiredPackName, "SKILL.md"), "# retired\n", "utf8");
    writeManagedMarker(targetDir, [...bundledSkillNames, retiredPackName]);
    writeManagedSentinel(targetDir, retiredPackName);

    const result = removeBundledSkills("global");

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(targetDir, retiredPackName))).toBe(false);
  }, 60_000);

  it("ignores marker entries for paths outside the target root and custom prefixed packs without a managed sentinel", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for unsafe marker test.");
    }

    const escapedPackName = path.join("..", "..", "escaped-pack");
    const escapedPackPath = path.join(targetDir, escapedPackName);
    const customPackName = "opendevbrowser-custom-foo";
    const customPackPath = path.join(targetDir, customPackName);
    const systemPackName = ".system";
    const systemPackPath = path.join(targetDir, systemPackName);
    fs.mkdirSync(escapedPackPath, { recursive: true });
    fs.mkdirSync(customPackPath, { recursive: true });
    fs.mkdirSync(systemPackPath, { recursive: true });
    fs.writeFileSync(path.join(escapedPackPath, "SKILL.md"), "# escaped\n", "utf8");
    fs.writeFileSync(path.join(customPackPath, "SKILL.md"), "# custom\n", "utf8");
    fs.writeFileSync(path.join(systemPackPath, "SKILL.md"), "# system\n", "utf8");

    writeManagedMarker(targetDir, [...bundledSkillNames, escapedPackName, customPackName, systemPackName]);

    const syncResult = syncBundledSkills("global");
    expect(syncResult.success).toBe(true);
    expect(fs.existsSync(path.join(escapedPackPath, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(customPackPath, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(systemPackPath, "SKILL.md"))).toBe(true);

    writeManagedMarker(targetDir, [...bundledSkillNames, escapedPackName, customPackName, systemPackName]);

    const removalResult = removeBundledSkills("global");
    expect(removalResult.success).toBe(true);
    expect(fs.existsSync(path.join(escapedPackPath, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(customPackPath, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(systemPackPath, "SKILL.md"))).toBe(true);
  }, 60_000);

  it("reports missing plugin config explicitly when only managed skills remain", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const result = runUninstall("global");

    expect(result.success).toBe(true);
    expect(result.removed).toBe(false);
    expect(result.message).toContain("No plugin config found");
    expect(result.message).not.toContain("not installed");
  }, 60_000);
});
