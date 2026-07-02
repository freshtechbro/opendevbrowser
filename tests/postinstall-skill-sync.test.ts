import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import { fileURLToPath } from "url";
import packageJson from "../package.json";
import type { AutostartDeps, AutostartHealth, AutostartStatus } from "../src/cli/daemon-autostart";
import type { PostinstallSkillSyncResult } from "../src/cli/installers/postinstall-skill-sync";
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

async function createPackageRootWithCli(name: string): Promise<string> {
  const packageRoot = path.join(tempRoot, name);
  const cliPath = path.join(packageRoot, "dist", "cli", "index.js");
  await fs.promises.mkdir(path.dirname(cliPath), { recursive: true });
  await fs.promises.writeFile(cliPath, "#!/usr/bin/env node\n", "utf8");
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

function createSuccessfulSkillSync(message = "synced"): PostinstallSkillSyncResult {
  return {
    success: true,
    skipped: false,
    message
  };
}

function createGlobalPostinstallEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    npm_lifecycle_event: "postinstall",
    npm_package_name: "opendevbrowser",
    npm_config_global: "true",
    npm_config_user_agent: "npm/10.8.0 node/v20.11.0 darwin arm64 workspaces/false",
    ...overrides
  };
}

function createAutostartStatus(health: AutostartHealth, platform: NodeJS.Platform = "darwin"): AutostartStatus {
  const supported = platform === "darwin" || platform === "win32";
  return {
    platform,
    supported,
    installed: supported && health !== "missing",
    health,
    needsRepair: health === "needs_repair" || health === "malformed",
    expectedCommand: `"${process.execPath}" "dist/cli/index.js" "serve"`,
    ...(health === "missing" ? { reason: "missing_plist" as const } : {}),
    ...(health === "malformed" ? { reason: "malformed_plist" as const } : {}),
    ...(health === "unsupported" ? { reason: "unsupported_platform" as const } : {})
  };
}

function captureArgv1(target: string[], deps?: AutostartDeps): void {
  target.push(deps?.argv1 ?? "");
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
    expect(result.syncResult?.installed.length).toBe(5 * bundledSkillDirectories.length);

    const requiredPack = "opendevbrowser-design-agent";
    const targetDirs = [
      path.join(process.env.OPENCODE_CONFIG_DIR!, "skill"),
      path.join(process.env.CODEX_HOME!, "skills"),
      path.join(process.env.CLAUDECODE_HOME!, "skills"),
      path.join(process.env.AMP_CLI_HOME!, "skills"),
      path.join(process.env.HOME!, ".agents", "skills")
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
});

describe("package postinstall autostart orchestration", () => {
  it("runs skill sync and installs missing autostart for eligible global package postinstall", async () => {
    const { runPackagePostinstall } = await import("../src/cli/installers/postinstall-skill-sync.ts");
    const packageRoot = await createPackageRootWithCli("global-install-package");
    const statusArgv: string[] = [];
    const installArgv: string[] = [];

    const result = runPackagePostinstall({
      packageRoot,
      env: createGlobalPostinstallEnv(),
      runSkillSync: () => createSuccessfulSkillSync(),
      autostartDeps: {
        getAutostartStatus: (deps) => {
          captureArgv1(statusArgv, deps);
          return createAutostartStatus("missing");
        },
        installAutostart: (deps) => {
          captureArgv1(installArgv, deps);
          return createAutostartStatus("healthy");
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.skillSync.skipped).toBe(false);
    expect(result.autostart.action).toBe("installed");
    expect(result.autostart.attempted).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(statusArgv).toHaveLength(1);
    expect(installArgv).toHaveLength(1);
    expect(statusArgv[0]).toBe(path.join(packageRoot, "dist", "cli", "index.js"));
    expect(installArgv[0]).toBe(path.join(packageRoot, "dist", "cli", "index.js"));
  });

  it("treats npm location global as eligible when npm global is absent", async () => {
    const { runPackagePostinstall } = await import("../src/cli/installers/postinstall-skill-sync.ts");
    const packageRoot = await createPackageRootWithCli("location-global-package");
    const statusArgv: string[] = [];
    const installArgv: string[] = [];

    const result = runPackagePostinstall({
      packageRoot,
      env: createGlobalPostinstallEnv({ npm_config_global: undefined, npm_config_location: "global" }),
      runSkillSync: () => createSuccessfulSkillSync(),
      autostartDeps: {
        getAutostartStatus: (deps) => {
          captureArgv1(statusArgv, deps);
          return createAutostartStatus("missing");
        },
        installAutostart: (deps) => {
          captureArgv1(installArgv, deps);
          return createAutostartStatus("healthy");
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.autostart.action).toBe("installed");
    expect(statusArgv[0]).toBe(path.join(packageRoot, "dist", "cli", "index.js"));
    expect(installArgv[0]).toBe(path.join(packageRoot, "dist", "cli", "index.js"));
  });

  it.each(["needs_repair", "malformed"] as const)("repairs %s autostart status", async (health) => {
    const { runPackagePostinstall } = await import("../src/cli/installers/postinstall-skill-sync.ts");
    const packageRoot = await createPackageRootWithCli(`repair-${health}-package`);
    let installCalls = 0;

    const result = runPackagePostinstall({
      packageRoot,
      env: createGlobalPostinstallEnv(),
      runSkillSync: () => createSuccessfulSkillSync(),
      autostartDeps: {
        getAutostartStatus: () => createAutostartStatus(health),
        installAutostart: () => {
          installCalls += 1;
          return createAutostartStatus("healthy");
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.autostart.action).toBe("repaired");
    expect(result.autostart.attempted).toBe(true);
    expect(installCalls).toBe(1);
  });

  it("returns a non-fatal warning when transient repair fails", async () => {
    const { runPackagePostinstall } = await import("../src/cli/installers/postinstall-skill-sync.ts");
    const packageRoot = await createPackageRootWithCli("transient-repair-package");

    const result = runPackagePostinstall({
      packageRoot,
      env: createGlobalPostinstallEnv(),
      runSkillSync: () => createSuccessfulSkillSync(),
      autostartDeps: {
        getAutostartStatus: () => createAutostartStatus("needs_repair"),
        installAutostart: () => {
          throw new Error("Cannot install daemon autostart from transient CLI path.");
        }
      }
    });

    expect(result.success).toBe(false);
    expect(result.autostart.action).toBe("repair_failed");
    expect(result.autostart.attempted).toBe(true);
    expect(result.warnings.join("\n")).toContain("transient CLI path");
  });

  it("preserves skill sync when autostart skip env is set", async () => {
    const { runPackagePostinstall } = await import("../src/cli/installers/postinstall-skill-sync.ts");
    let skillSyncCalls = 0;

    const result = runPackagePostinstall({
      env: createGlobalPostinstallEnv({ OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION: "1" }),
      runSkillSync: () => {
        skillSyncCalls += 1;
        return createSuccessfulSkillSync();
      },
      autostartDeps: {
        getAutostartStatus: () => {
          throw new Error("status should not run");
        },
        installAutostart: () => {
          throw new Error("install should not run");
        }
      }
    });

    expect(skillSyncCalls).toBe(1);
    expect(result.success).toBe(true);
    expect(result.autostart.skipped).toBe(true);
    expect(result.autostart.reason).toBe("disabled");
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ["local", createGlobalPostinstallEnv({ npm_config_global: "false" }), "local_install"],
    ["ambiguous", createGlobalPostinstallEnv({ npm_config_global: undefined }), "ambiguous_install"],
    ["conflicting", createGlobalPostinstallEnv({ npm_config_global: "true", npm_config_location: "project" }), "conflicting_global_context"]
  ] as const)("skips autostart for %s package context", async (_label, env, reason) => {
    const { runPackagePostinstall } = await import("../src/cli/installers/postinstall-skill-sync.ts");
    let statusCalls = 0;
    let installCalls = 0;

    const result = runPackagePostinstall({
      env,
      runSkillSync: () => createSuccessfulSkillSync(),
      autostartDeps: {
        getAutostartStatus: () => {
          statusCalls += 1;
          return createAutostartStatus("missing");
        },
        installAutostart: () => {
          installCalls += 1;
          return createAutostartStatus("healthy");
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.autostart.skipped).toBe(true);
    expect(result.autostart.reason).toBe(reason);
    expect(statusCalls).toBe(0);
    expect(installCalls).toBe(0);
  });

  it.each([
    ["non-postinstall lifecycle", createGlobalPostinstallEnv({ npm_lifecycle_event: "install" }), "not_postinstall"],
    ["different package", createGlobalPostinstallEnv({ npm_package_name: "other-package" }), "package_mismatch"],
    ["non-npm package manager", createGlobalPostinstallEnv({ npm_config_user_agent: "pnpm/9.0.0 npm/? node/v20.11.0 darwin arm64" }), "non_npm_package_manager"]
  ] as const)("skips autostart for %s context", async (_label, env, reason) => {
    const { runPackagePostinstall } = await import("../src/cli/installers/postinstall-skill-sync.ts");
    let statusCalls = 0;
    let installCalls = 0;

    const result = runPackagePostinstall({
      env,
      runSkillSync: () => createSuccessfulSkillSync(),
      autostartDeps: {
        getAutostartStatus: () => {
          statusCalls += 1;
          return createAutostartStatus("missing");
        },
        installAutostart: () => {
          installCalls += 1;
          return createAutostartStatus("healthy");
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.autostart.skipped).toBe(true);
    expect(result.autostart.reason).toBe(reason);
    expect(statusCalls).toBe(0);
    expect(installCalls).toBe(0);
  });

  it("skips unsupported platforms without installing autostart", async () => {
    const { runPackagePostinstall } = await import("../src/cli/installers/postinstall-skill-sync.ts");
    const packageRoot = await createPackageRootWithCli("unsupported-platform-package");
    let installCalls = 0;

    const result = runPackagePostinstall({
      packageRoot,
      env: createGlobalPostinstallEnv(),
      runSkillSync: () => createSuccessfulSkillSync(),
      autostartDeps: {
        getAutostartStatus: () => createAutostartStatus("unsupported", "linux"),
        installAutostart: () => {
          installCalls += 1;
          return createAutostartStatus("healthy");
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.autostart.skipped).toBe(true);
    expect(result.autostart.action).toBe("unsupported");
    expect(result.autostart.reason).toBe("unsupported_platform");
    expect(installCalls).toBe(0);
  });

  it("warns and skips autostart when the packaged CLI entrypoint is missing", async () => {
    const { runPackagePostinstall } = await import("../src/cli/installers/postinstall-skill-sync.ts");
    const packageRoot = path.join(tempRoot, "missing-cli-package");
    await fs.promises.mkdir(packageRoot, { recursive: true });
    let statusCalls = 0;

    const result = runPackagePostinstall({
      packageRoot,
      env: createGlobalPostinstallEnv(),
      runSkillSync: () => createSuccessfulSkillSync(),
      autostartDeps: {
        getAutostartStatus: () => {
          statusCalls += 1;
          return createAutostartStatus("missing");
        }
      }
    });

    expect(result.success).toBe(false);
    expect(result.autostart.skipped).toBe(true);
    expect(result.autostart.reason).toBe("missing_cli_entrypoint");
    expect(result.warnings.join("\n")).toContain("packaged CLI entrypoint not found");
    expect(statusCalls).toBe(0);
  });
});

describe("packaged postinstall shim", () => {
  it("skips the packaged postinstall script when the opt-out env var is set", async () => {
    const packageRoot = await createPackagedPostinstallFixture();
    const sentinelPath = path.join(packageRoot, "sync-called.txt");

    await writePackagedInstallerEntry(
      packageRoot,
      [
        'import * as fs from "fs";',
        `const sentinelPath = ${JSON.stringify(sentinelPath)};`,
        "export function runPackagePostinstall() {",
        '  fs.writeFileSync(sentinelPath, "called");',
        '  return { success: true, skipped: false, message: "synced", warnings: [] };',
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

  it("skips the packaged postinstall script inside repo checkouts", async () => {
    const packageRoot = await createPackagedPostinstallFixture();
    const sentinelPath = path.join(packageRoot, "sync-called.txt");
    await fs.promises.mkdir(path.join(packageRoot, ".git"), { recursive: true });

    await writePackagedInstallerEntry(
      packageRoot,
      [
        'import * as fs from "fs";',
        `const sentinelPath = ${JSON.stringify(sentinelPath)};`,
        "export function runPackagePostinstall() {",
        '  fs.writeFileSync(sentinelPath, "called");',
        '  return { success: true, skipped: false, message: "synced", warnings: [] };',
        "}"
      ].join("\n")
    );

    const result = runPackagedPostinstallScript(packageRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(fs.existsSync(sentinelPath)).toBe(false);
  });

  it("warns when the packaged postinstall script cannot find the built installer entry", async () => {
    const packageRoot = await createPackagedPostinstallFixture();

    const result = runPackagedPostinstallScript(packageRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("package postinstall skipped: built installer entry missing.");
  });

  it("loads the built installer entry from a packaged layout", async () => {
    const packageRoot = await createPackagedPostinstallFixture();
    const sentinelPath = path.join(packageRoot, "sync-called.txt");

    await writePackagedInstallerEntry(
      packageRoot,
      [
        'import * as fs from "fs";',
        `const sentinelPath = ${JSON.stringify(sentinelPath)};`,
        "export function runPackagePostinstall() {",
        '  fs.writeFileSync(sentinelPath, "called");',
        '  return { success: true, skipped: false, message: "done", warnings: [] };',
        "}"
      ].join("\n")
    );

    const result = runPackagedPostinstallScript(packageRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(fs.readFileSync(sentinelPath, "utf8")).toBe("called");
  });

  it("prints package postinstall warnings returned by the built installer", async () => {
    const packageRoot = await createPackagedPostinstallFixture();

    await writePackagedInstallerEntry(
      packageRoot,
      [
        "export function runPackagePostinstall() {",
        '  return { success: false, skipped: false, message: "done", warnings: ["autostart warning"] };',
        "}"
      ].join("\n")
    );

    const result = runPackagedPostinstallScript(packageRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[opendevbrowser] autostart warning");
  });

  it("exits zero when the built package postinstall throws", async () => {
    const packageRoot = await createPackagedPostinstallFixture();

    await writePackagedInstallerEntry(
      packageRoot,
      [
        "export function runPackagePostinstall() {",
        '  throw new Error("boom");',
        "}"
      ].join("\n")
    );

    const result = runPackagedPostinstallScript(packageRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("package postinstall failed: boom");
  });
});
