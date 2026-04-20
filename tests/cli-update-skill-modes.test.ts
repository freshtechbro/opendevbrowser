import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import type { ParsedArgs } from "../src/cli/args";
import { installGlobal } from "../src/cli/installers/global";
import { syncBundledSkills } from "../src/cli/installers/skills";
import { getGlobalSkillTargets } from "../src/cli/utils/skills";
import { resolveUpdateSkillModes } from "../src/cli/update-skill-modes";
import { bundledSkillDirectories } from "../src/skills/bundled-skill-directories";

const MANAGED_SKILLS_MARKER = ".opendevbrowser-managed-skills.json";

let tempRoot = "";
let workspaceDir = "";
let originalCwd = "";
let originalHome: string | undefined;
let originalConfigDir: string | undefined;
let originalCodexHome: string | undefined;
let originalClaudeCodeHome: string | undefined;
let originalAmpCliHome: string | undefined;

function makeUpdateArgs(rawArgs: string[] = ["--update"], mode?: "global" | "local"): ParsedArgs {
  return {
    command: "update",
    mode,
    withConfig: false,
    noPrompt: false,
    noInteractive: false,
    quiet: false,
    outputFormat: "text",
    transport: "relay",
    skillsMode: "global",
    fullInstall: false,
    rawArgs
  };
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "odb-cli-update-skills-"));
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
  vi.restoreAllMocks();
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

describe("resolveUpdateSkillModes", () => {
  it("does not recreate skills for config-only installs", () => {
    const installResult = installGlobal();
    expect(installResult.success).toBe(true);

    expect(resolveUpdateSkillModes(makeUpdateArgs())).toEqual([]);
  });

  it("refreshes marker-managed installs without plugin config", () => {
    const skillResult = syncBundledSkills("global");
    expect(skillResult.success).toBe(true);

    expect(resolveUpdateSkillModes(makeUpdateArgs())).toEqual(["global"]);
  }, 60_000);

  it("refreshes legacy config installs that already have canonical packs", () => {
    const installResult = installGlobal();
    expect(installResult.success).toBe(true);

    const skillResult = syncBundledSkills("global");
    expect(skillResult.success).toBe(true);

    for (const target of getGlobalSkillTargets()) {
      fs.rmSync(path.join(target.dir, MANAGED_SKILLS_MARKER), { force: true });
    }

    expect(resolveUpdateSkillModes(makeUpdateArgs())).toEqual(["global"]);
  }, 60_000);

  it("keeps explicit update scope when both global and local managed installs exist", () => {
    const globalResult = syncBundledSkills("global");
    expect(globalResult.success).toBe(true);

    const localResult = syncBundledSkills("local");
    expect(localResult.success).toBe(true);

    expect(resolveUpdateSkillModes(makeUpdateArgs(["--update", "--global"], "global"))).toEqual(["global"]);
    expect(resolveUpdateSkillModes(makeUpdateArgs(["--update", "--local"], "local"))).toEqual(["local"]);
  }, 60_000);

  it("keeps partially synced marker-managed targets discoverable for a later repair", () => {
    const installResult = syncBundledSkills("global");
    expect(installResult.success).toBe(true);

    const [target, ...otherTargets] = getGlobalSkillTargets();
    if (!target) {
      throw new Error("Missing global target for postinstall recovery test.");
    }

    const [firstPackName, secondPackName] = bundledSkillDirectories.map((entry) => entry.name);
    if (!firstPackName || !secondPackName) {
      throw new Error("Missing bundled skills for postinstall recovery test.");
    }

    for (const otherTarget of otherTargets) {
      fs.rmSync(otherTarget.dir, { recursive: true, force: true });
    }

    expect(fs.existsSync(path.join(target.dir, firstPackName))).toBe(true);
    expect(fs.existsSync(path.join(target.dir, MANAGED_SKILLS_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(target.dir, firstPackName, ".opendevbrowser-managed-skill.json"))).toBe(true);
    fs.rmSync(path.join(target.dir, secondPackName), { recursive: true, force: true });
    expect(fs.existsSync(path.join(target.dir, secondPackName))).toBe(false);
    expect(resolveUpdateSkillModes(makeUpdateArgs())).toEqual(["global"]);
  }, 60_000);
});
