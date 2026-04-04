import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import onboardingMetadata from "../src/cli/onboarding-metadata.json";
import { installSkills } from "../src/cli/installers/skills";
import { getGlobalSkillTargets, getLocalSkillTargets } from "../src/cli/utils/skills";
import { bundledSkillDirectories } from "../src/skills/bundled-skill-directories";

let tempRoot = "";
let workspaceDir = "";
let originalCwd = "";
let originalHome: string | undefined;
let originalConfigDir: string | undefined;
let originalCodexHome: string | undefined;
let originalClaudeCodeHome: string | undefined;
let originalClaudeHome: string | undefined;
let originalAmpCliAliasHome: string | undefined;
let originalAmpCliHome: string | undefined;

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
  originalClaudeHome = process.env.CLAUDE_HOME;
  originalAmpCliAliasHome = process.env.AMPCLI_HOME;
  originalAmpCliHome = process.env.AMP_CLI_HOME;

  process.env.HOME = path.join(tempRoot, "home");
  process.env.OPENCODE_CONFIG_DIR = path.join(tempRoot, "opencode-config");
  process.env.CODEX_HOME = path.join(tempRoot, "codex-home");
  process.env.CLAUDECODE_HOME = path.join(tempRoot, "claudecode-home");
  delete process.env.CLAUDE_HOME;
  process.env.AMPCLI_HOME = path.join(tempRoot, "ampcli-home");
  process.env.AMP_CLI_HOME = path.join(tempRoot, "amp-home");
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

  if (originalClaudeHome === undefined) {
    delete process.env.CLAUDE_HOME;
  } else {
    process.env.CLAUDE_HOME = originalClaudeHome;
  }

  if (originalAmpCliAliasHome === undefined) {
    delete process.env.AMPCLI_HOME;
  } else {
    process.env.AMPCLI_HOME = originalAmpCliAliasHome;
  }

  if (originalAmpCliHome === undefined) {
    delete process.env.AMP_CLI_HOME;
  } else {
    process.env.AMP_CLI_HOME = originalAmpCliHome;
  }

  await rm(tempRoot, { recursive: true, force: true });
});

describe("installSkills", () => {
  const discoverableBundledSkillNames = bundledSkillDirectories
    .filter((entry) => entry.policy === "discoverable")
    .map((entry) => entry.name);
  const aliasOnlyBundledSkillNames = bundledSkillDirectories
    .filter((entry) => entry.policy === "aliasOnly")
    .map((entry) => entry.name);

  it("installs bundled skills across all global agent targets", () => {
    const result = installSkills("global");
    expect(result.success).toBe(true);
    expect(result.targets.length).toBe(getGlobalSkillTargets().length);
    expect(result.discoverableInstalled.length).toBe(
      getGlobalSkillTargets().length * discoverableBundledSkillNames.length
    );
    expect(result.aliasOnlyInstalled.length).toBe(
      getGlobalSkillTargets().length * aliasOnlyBundledSkillNames.length
    );
    expect(result.aliasOnlyInstalled).toEqual(expect.arrayContaining(aliasOnlyBundledSkillNames));
    expect(result.message).toContain("discoverable");
    expect(result.message).toContain("alias-only");
    expect(result.notes).toEqual({
      aliasOnlyCompatibility: onboardingMetadata.skillDiscovery.aliasOnlyCycleNote,
      shadowRiskPath: onboardingMetadata.skillDiscovery.shadowRiskPath,
      shadowRiskSummary: onboardingMetadata.skillDiscovery.shadowRiskSummary,
      shadowRiskAction: onboardingMetadata.skillDiscovery.shadowRiskAction
    });

    for (const target of getGlobalSkillTargets()) {
      const skillPath = path.join(target.dir, "opendevbrowser-best-practices", "SKILL.md");
      expect(fs.existsSync(skillPath)).toBe(true);
      expect(fs.existsSync(path.join(target.dir, "research"))).toBe(true);
      expect(fs.existsSync(path.join(target.dir, "shopping"))).toBe(true);
    }
  }, 60_000);

  it("installs bundled skills across all local agent targets", () => {
    const result = installSkills("local");
    expect(result.success).toBe(true);
    expect(result.targets.length).toBe(getLocalSkillTargets().length);
    expect(result.discoverableInstalled.length).toBe(
      getLocalSkillTargets().length * discoverableBundledSkillNames.length
    );
    expect(result.aliasOnlyInstalled.length).toBe(
      getLocalSkillTargets().length * aliasOnlyBundledSkillNames.length
    );

    for (const target of getLocalSkillTargets()) {
      const skillPath = path.join(target.dir, "opendevbrowser-best-practices", "SKILL.md");
      expect(fs.existsSync(skillPath)).toBe(true);
    }
  }, 60_000);

  it("skips existing skill directories on rerun", () => {
    const firstRun = installSkills("global");
    expect(firstRun.success).toBe(true);

    const secondRun = installSkills("global");
    expect(secondRun.success).toBe(true);
    expect(secondRun.targets.every((target) => target.installed.length === 0)).toBe(true);
    expect(secondRun.targets.every((target) => target.skipped.length > 0)).toBe(true);
    expect(secondRun.notes.shadowRiskPath).toBe(onboardingMetadata.skillDiscovery.shadowRiskPath);
    expect(secondRun.discoverableSkipped.length).toBe(
      getGlobalSkillTargets().length * discoverableBundledSkillNames.length
    );
    expect(secondRun.aliasOnlySkipped.length).toBe(
      getGlobalSkillTargets().length * aliasOnlyBundledSkillNames.length
    );
  }, 60_000);

  it("publishes canonical and legacy aliases for ClaudeCode and AmpCLI targets", () => {
    const globalTargets = getGlobalSkillTargets();
    const claudeDir = path.join(process.env.CLAUDECODE_HOME!, "skills");
    const ampDir = path.join(process.env.AMPCLI_HOME!, "skills");

    const claudeTarget = globalTargets.find((target) => path.resolve(target.dir) === path.resolve(claudeDir));
    expect(claudeTarget).toBeDefined();
    expect(claudeTarget?.agents).toEqual(expect.arrayContaining(["claudecode", "claude"]));

    const ampTarget = globalTargets.find((target) => path.resolve(target.dir) === path.resolve(ampDir));
    expect(ampTarget).toBeDefined();
    expect(ampTarget?.agents).toEqual(expect.arrayContaining(["ampcli", "amp"]));
  });

  it("keeps alias-only guidance explicit for one more cycle", () => {
    const result = installSkills("local");

    expect(result.notes.aliasOnlyCompatibility).toContain("one more cycle");
    expect(result.notes.shadowRiskSummary).toContain("shadow");
  });
});
