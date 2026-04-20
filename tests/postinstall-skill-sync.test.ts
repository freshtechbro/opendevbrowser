import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import { fileURLToPath } from "url";
import packageJson from "../package.json";
import { bundledSkillDirectories } from "../src/skills/bundled-skill-directories";

let tempRoot = "";
let originalHome: string | undefined;
let originalConfigDir: string | undefined;
let originalCodexHome: string | undefined;
let originalClaudeCodeHome: string | undefined;
let originalAmpCliHome: string | undefined;
let originalSkipEnv: string | undefined;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function createPackagedPostinstallFixture(): Promise<string> {
  const packageRoot = path.join(tempRoot, "package");
  const scriptSource = await fs.promises.readFile(
    path.join(repoRoot, "scripts", "postinstall-sync-skills.mjs"),
    "utf8"
  );

  await fs.promises.mkdir(path.join(packageRoot, "scripts"), { recursive: true });
  await fs.promises.writeFile(
    path.join(packageRoot, "scripts", "postinstall-sync-skills.mjs"),
    scriptSource
  );

  return packageRoot;
}

async function writePackagedInstallerEntry(packageRoot: string, source: string): Promise<void> {
  const entryPath = path.join(packageRoot, "dist", "cli", "installers", "postinstall-skill-sync.js");
  await fs.promises.mkdir(path.dirname(entryPath), { recursive: true });
  await fs.promises.writeFile(entryPath, source);
}

function runPackagedPostinstallScript(packageRoot: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [path.join(packageRoot, "scripts", "postinstall-sync-skills.mjs")], {
    cwd: packageRoot,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "odb-postinstall-skills-"));
  originalHome = process.env.HOME;
  originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
  originalCodexHome = process.env.CODEX_HOME;
  originalClaudeCodeHome = process.env.CLAUDECODE_HOME;
  originalAmpCliHome = process.env.AMP_CLI_HOME;
  originalSkipEnv = process.env.OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC;

  process.env.HOME = path.join(tempRoot, "home");
  process.env.OPENCODE_CONFIG_DIR = path.join(tempRoot, "opencode-config");
  process.env.CODEX_HOME = path.join(tempRoot, "codex-home");
  process.env.CLAUDECODE_HOME = path.join(tempRoot, "claudecode-home");
  process.env.AMP_CLI_HOME = path.join(tempRoot, "ampcli-home");
  delete process.env.OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC;
});

afterEach(async () => {
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

  if (originalSkipEnv === undefined) {
    delete process.env.OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC;
  } else {
    process.env.OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC = originalSkipEnv;
  }

  await rm(tempRoot, { recursive: true, force: true });
});

describe("postinstall skill sync", () => {
  it("registers the postinstall hook in package scripts", () => {
    expect(packageJson.scripts.postinstall).toBe("node scripts/postinstall-sync-skills.mjs");
    expect(packageJson.files).toContain("scripts/postinstall-sync-skills.mjs");
  });

  it("syncs canonical bundled skills into all managed global targets", async () => {
    const { runPostinstallSkillSync } = await import("../src/cli/installers/postinstall-skill-sync.ts");

    const result = runPostinstallSkillSync({ skipRepoCheckoutGuard: true });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.syncResult?.installed.length).toBe(4 * bundledSkillDirectories.length);

    const requiredPack = "opendevbrowser-design-agent";
    const targetDirs = [
      path.join(process.env.OPENCODE_CONFIG_DIR!, "skill"),
      path.join(process.env.CODEX_HOME!, "skills"),
      path.join(process.env.CLAUDECODE_HOME!, "skills"),
      path.join(process.env.AMP_CLI_HOME!, "skills")
    ];

    for (const targetDir of targetDirs) {
      expect(fs.existsSync(path.join(targetDir, requiredPack, "SKILL.md"))).toBe(true);
    }
  });

  it("skips automatic sync inside the repo checkout", async () => {
    const { runPostinstallSkillSync } = await import("../src/cli/installers/postinstall-skill-sync.ts");

    const result = runPostinstallSkillSync();

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("repo_checkout");
  });

  it("skips the packaged postinstall script when the opt-out env var is set", async () => {
    const packageRoot = await createPackagedPostinstallFixture();
    const sentinelPath = path.join(packageRoot, "sync-called.txt");

    await writePackagedInstallerEntry(
      packageRoot,
      [
        'import * as fs from "fs";',
        `const sentinelPath = ${JSON.stringify(sentinelPath)};`,
        "export function runPostinstallSkillSync() {",
        '  fs.writeFileSync(sentinelPath, "called");',
        '  return { success: true, skipped: false, message: "synced" };',
        "}"
      ].join("\n")
    );

    const result = runPackagedPostinstallScript(packageRoot, {
      OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC: "1"
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(fs.existsSync(sentinelPath)).toBe(false);
  });

  it("warns when the packaged postinstall script cannot find the built installer entry", async () => {
    const packageRoot = await createPackagedPostinstallFixture();

    const result = runPackagedPostinstallScript(packageRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("postinstall skill sync skipped: built installer entry missing.");
  });

  it("loads the built installer entry from a packaged layout", async () => {
    const packageRoot = await createPackagedPostinstallFixture();
    const sentinelPath = path.join(packageRoot, "sync-called.txt");

    await writePackagedInstallerEntry(
      packageRoot,
      [
        'import * as fs from "fs";',
        `const sentinelPath = ${JSON.stringify(sentinelPath)};`,
        "export function runPostinstallSkillSync() {",
        '  fs.writeFileSync(sentinelPath, "called");',
        '  return { success: true, skipped: false, message: "synced" };',
        "}"
      ].join("\n")
    );

    const result = runPackagedPostinstallScript(packageRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(fs.readFileSync(sentinelPath, "utf8")).toBe("called");
  });
});
