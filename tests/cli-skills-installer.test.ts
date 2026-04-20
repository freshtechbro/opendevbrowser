import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import {
  hasBundledSkillArtifacts,
  removeBundledSkills,
  syncBundledSkills
} from "../src/cli/installers/skills";
import {
  getBundledSkillsDir,
  getGlobalSkillTargets,
  getLocalSkillTargets
} from "../src/cli/utils/skills";
import { bundledSkillDirectories } from "../src/skills/bundled-skill-directories";

let tempRoot = "";
let workspaceDir = "";
let originalCwd = "";
let originalHome: string | undefined;
let originalConfigDir: string | undefined;
let originalCodexHome: string | undefined;
let originalClaudeCodeHome: string | undefined;
let originalAmpCliHome: string | undefined;

function expectNoLegacyAliasFields(value: object): void {
  expect("removedLegacyAliases" in value).toBe(false);
  expect("preservedLegacyAliases" in value).toBe(false);
}

function copyCanonicalSkillToAlias(targetDir: string, canonicalName: string, aliasName: string): void {
  const sourceDir = path.join(targetDir, canonicalName);
  const aliasDir = path.join(targetDir, aliasName);
  fs.cpSync(sourceDir, aliasDir, { recursive: true });
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

  it("ignores legacy alias directories during sync", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for legacy alias sync test.");
    }

    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-research", "research");
    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-shopping", "shopping");

    const secondRun = syncBundledSkills("global");
    expect(secondRun.success).toBe(true);
    expectNoLegacyAliasFields(secondRun);
    secondRun.targets.forEach(expectNoLegacyAliasFields);
    expect(fs.existsSync(path.join(targetDir, "research"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "shopping"))).toBe(true);
  }, 60_000);

  it("does not treat legacy alias leftovers as canonical bundled artifacts", () => {
    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for legacy alias artifact test.");
    }

    fs.mkdirSync(path.join(targetDir, "research"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, "shopping"), { recursive: true });

    expect(hasBundledSkillArtifacts("global")).toBe(false);
  });

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

  it("removes managed canonical packs and ignores legacy alias leftovers during uninstall cleanup", () => {
    const firstRun = syncBundledSkills("global");
    expect(firstRun.success).toBe(true);
    expect(hasBundledSkillArtifacts("global")).toBe(true);

    const targetDir = getGlobalSkillTargets()[0]?.dir;
    if (!targetDir) {
      throw new Error("Missing global target for uninstall cleanup test.");
    }

    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-research", "research");
    copyCanonicalSkillToAlias(targetDir, "opendevbrowser-shopping", "shopping");

    const result = removeBundledSkills("global");
    expect(result.success).toBe(true);
    expect(result.removed.length).toBe(getGlobalSkillTargets().length * bundledSkillNames.length);
    expectNoLegacyAliasFields(result);
    result.targets.forEach(expectNoLegacyAliasFields);
    expect(fs.existsSync(path.join(targetDir, "research"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "shopping"))).toBe(true);
    expect(hasBundledSkillArtifacts("global")).toBe(false);
  }, 60_000);
});
