import { describe, expect, it, vi } from "vitest";
import { existsSync as fsExistsSync, mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import {
  buildLaunchAgentPlist,
  buildWindowsTaskArgs,
  getAutostartStatus,
  installAutostart,
  resolveCliEntrypoint
} from "../src/cli/daemon-autostart";

const createCliFixture = (options: { transient?: boolean } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "odb-cli-entry-"));
  const cliPath = join(root, "index.js");
  writeFileSync(cliPath, "// cli", "utf-8");
  return {
    root,
    cliPath,
    transientEntrypointRoots: [options.transient ? root : join(root, "stable-only-root")]
  };
};

const createNpxCacheCliFixture = () => {
  const root = mkdtempSync(join(resolve(tmpdir(), ".."), "odb-cli-stable-"));
  const cacheRoot = join(root, "_npx", "runner");
  mkdirSync(cacheRoot, { recursive: true });
  const cliPath = join(cacheRoot, "index.js");
  writeFileSync(cliPath, "// cli", "utf-8");
  return {
    root,
    cliPath,
    transientEntrypointRoots: [join(root, "stable-only-root")]
  };
};

const createDarwinStatusFixture = (
  options: {
    currentCliTransient?: boolean;
    omitProgramArguments?: boolean;
    parseFailure?: boolean;
    plistExists?: boolean;
    programArguments?: string[];
  } = {}
) => {
  const { cliPath, root, transientEntrypointRoots } = createCliFixture({
    transient: options.currentCliTransient
  });
  const home = join(root, "home");
  const plistPath = join(home, "Library", "LaunchAgents", "com.opendevbrowser.daemon.plist");
  mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
  if (options.plistExists !== false) {
    writeFileSync(plistPath, "plist", "utf-8");
  }

  const entrypoint = resolveCliEntrypoint({ argv1: cliPath, transientEntrypointRoots });
  const execFileSyncMock = vi.fn(() => {
    if (options.parseFailure) {
      throw new Error("invalid plist");
    }
    const payload = options.omitProgramArguments
      ? {}
      : { ProgramArguments: options.programArguments ?? [entrypoint.nodePath, ...entrypoint.args] };
    return JSON.stringify(payload);
  });

  return {
    entrypoint,
    execFileSyncMock,
    plistPath,
    deps: {
      platform: "darwin" as const,
      argv1: cliPath,
      execFileSync: execFileSyncMock,
      homedir: () => home,
      transientEntrypointRoots
    }
  };
};

const encodeXmlText = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

const buildWindowsTaskXml = (programArguments: string[]): string => {
  const [command = "", ...args] = programArguments;
  const argumentsValue = args.map((value) => `"${value}"`).join(" ");
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-16\"?>",
    "<Task>",
    "  <Actions>",
    "    <Exec>",
    `      <Command>${encodeXmlText(command)}</Command>`,
    ...(args.length > 0 ? [`      <Arguments>${encodeXmlText(argumentsValue)}</Arguments>`] : []),
    "    </Exec>",
    "  </Actions>",
    "</Task>"
  ].join("\n");
};

const createWindowsStatusFixture = (
  options: {
    currentCliTransient?: boolean;
    existsSync?: (path: string) => boolean;
    programArguments?: string[];
    taskInstalled?: boolean;
    xml?: string;
  } = {}
) => {
  const { cliPath, transientEntrypointRoots } = createCliFixture({
    transient: options.currentCliTransient
  });
  const entrypoint = resolveCliEntrypoint({
    platform: "win32",
    argv1: cliPath,
    transientEntrypointRoots
  });
  const execFileSyncMock = vi.fn((_command: string, args: string[]) => {
    if (options.taskInstalled === false) {
      throw new Error("not found");
    }
    if (args.includes("/XML")) {
      return options.xml ?? buildWindowsTaskXml(options.programArguments ?? [entrypoint.nodePath, entrypoint.cliPath, "serve"]);
    }
    return undefined;
  });

  return {
    entrypoint,
    execFileSyncMock,
    deps: {
      platform: "win32" as const,
      argv1: cliPath,
      execFileSync: execFileSyncMock,
      existsSync: options.existsSync ?? fsExistsSync,
      transientEntrypointRoots
    }
  };
};

describe("daemon autostart helpers", () => {
  it("resolves CLI entrypoint from argv1 when present", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-cli-entry-"));
    const cliPath = join(root, "index.js");
    writeFileSync(cliPath, "// test", "utf-8");

    const entry = resolveCliEntrypoint({
      argv1: cliPath,
      transientEntrypointRoots: [join(root, "stable-only-root")]
    });

    expect(entry.cliPath).toBe(resolve(cliPath));
    expect(entry.source).toBe("argv1");
    expect(entry.isTransient).toBe(false);
    expect(entry.command).toContain(entry.nodePath);
    expect(entry.command).toContain(entry.cliPath);
  });

  it("marks temp-root entrypoints as transient", () => {
    const { cliPath, transientEntrypointRoots } = createCliFixture({ transient: true });

    const entry = resolveCliEntrypoint({
      argv1: cliPath,
      transientEntrypointRoots
    });

    expect(entry.cliPath).toBe(resolve(cliPath));
    expect(entry.isTransient).toBe(true);
    expect(entry.command).toContain(entry.cliPath);
  });

  it("marks _npx cache entrypoints as transient even outside configured temp roots", () => {
    const { cliPath, transientEntrypointRoots } = createNpxCacheCliFixture();

    const entry = resolveCliEntrypoint({
      argv1: cliPath,
      transientEntrypointRoots
    });

    expect(entry.cliPath).toBe(resolve(cliPath));
    expect(entry.isTransient).toBe(true);
  });

  it("marks Windows-style backslash _npx entrypoints as transient", () => {
    const cliPath = "C:\\Users\\test\\AppData\\Local\\npm-cache\\_npx\\runner\\node_modules\\opendevbrowser\\dist\\cli\\index.js";
    const resolvedCliPath = resolve(cliPath);

    const entry = resolveCliEntrypoint({
      platform: "win32",
      argv1: cliPath,
      existsSync: vi.fn((value) => value === resolvedCliPath),
      transientEntrypointRoots: [join(tmpdir(), "stable-only-root")]
    });

    expect(entry.cliPath).toBe(resolvedCliPath);
    expect(entry.isTransient).toBe(true);
  });

  it("resolves CLI entrypoint from module location when argv1 is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-cli-module-"));
    const cliDir = join(root, "cli");
    const commandsDir = join(cliDir, "commands");
    const cliPath = join(cliDir, "index.js");
    const commandPath = join(commandsDir, "daemon.js");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(cliPath, "// cli", "utf-8");
    writeFileSync(commandPath, "// command", "utf-8");

    const entry = resolveCliEntrypoint({
      argv1: join(root, "missing.js"),
      moduleUrl: pathToFileURL(commandPath).toString(),
      transientEntrypointRoots: [join(root, "stable-only-root")]
    });

    expect(entry.cliPath).toBe(resolve(cliPath));
    expect(entry.source).toBe("module");
    expect(entry.isTransient).toBe(false);
  });

  it("builds a launch agent plist with program arguments", () => {
    const entry = {
      nodePath: "/node",
      cliPath: "/cli/index.js",
      args: ["/cli/index.js", "serve"],
      command: "\"/node\" \"/cli/index.js\" serve",
      source: "argv1" as const,
      isTransient: false
    };
    const plist = buildLaunchAgentPlist(entry, { label: "com.test.daemon" });
    expect(plist).toContain("com.test.daemon");
    expect(plist).toContain("/node");
    expect(plist).toContain("/cli/index.js");
    expect(plist).toContain("serve");
  });

  it("builds Windows task args", () => {
    const entry = {
      nodePath: "C:\\node.exe",
      cliPath: "C:\\cli\\index.js",
      args: ["C:\\cli\\index.js", "serve"],
      command: "\"C:\\node.exe\" \"C:\\cli\\index.js\" serve",
      source: "argv1" as const,
      isTransient: false
    };
    const task = buildWindowsTaskArgs(entry, "Test Task");
    expect(task.args).toContain("/Create");
    expect(task.args).toContain("/TN");
    expect(task.args).toContain("Test Task");
    expect(task.command).toContain("serve");
  });
});

describe("getAutostartStatus", () => {
  it("reports missing on macOS when the plist does not exist", () => {
    const { deps, entrypoint, execFileSyncMock, plistPath } = createDarwinStatusFixture({ plistExists: false });
    const status = getAutostartStatus(deps);

    expect(status).toMatchObject({
      supported: true,
      installed: false,
      health: "missing",
      needsRepair: false,
      reason: "missing_plist",
      location: plistPath,
      expectedCommand: entrypoint.command
    });
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("reports healthy on macOS when the plist command matches the current entrypoint", () => {
    const { deps, entrypoint } = createDarwinStatusFixture();
    const status = getAutostartStatus(deps);

    expect(status).toMatchObject({
      supported: true,
      installed: true,
      health: "healthy",
      needsRepair: false,
      command: entrypoint.command,
      expectedCommand: entrypoint.command
    });
  });

  it("reports missing_node_path when the plist uses a different node binary", () => {
    const { deps, entrypoint } = createDarwinStatusFixture();
    const status = getAutostartStatus({
      ...deps,
      execFileSync: vi.fn(() => JSON.stringify({
        ProgramArguments: ["/old/node", entrypoint.cliPath, "serve"]
      }))
    });

    expect(status).toMatchObject({
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      reason: "missing_node_path"
    });
  });

  it("reports missing_cli_path when the plist uses a different CLI entrypoint", () => {
    const { deps, entrypoint } = createDarwinStatusFixture();
    const status = getAutostartStatus({
      ...deps,
      execFileSync: vi.fn(() => JSON.stringify({
        ProgramArguments: [entrypoint.nodePath, "/old/cli/index.js", "serve"]
      }))
    });

    expect(status).toMatchObject({
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      reason: "missing_cli_path"
    });
  });

  it("reports transient_cli_path when the persisted plist points at a temp-root CLI path", () => {
    const { deps, entrypoint } = createDarwinStatusFixture();
    const transientCli = createCliFixture({ transient: true });
    const status = getAutostartStatus({
      ...deps,
      execFileSync: vi.fn(() => JSON.stringify({
        ProgramArguments: [entrypoint.nodePath, transientCli.cliPath, "serve"]
      })),
      transientEntrypointRoots: transientCli.transientEntrypointRoots
    });

    expect(status).toMatchObject({
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      reason: "transient_cli_path"
    });
  });

  it("reports entrypoint mismatch when the plist command shape changes", () => {
    const { deps, entrypoint } = createDarwinStatusFixture();
    const status = getAutostartStatus({
      ...deps,
      execFileSync: vi.fn(() => JSON.stringify({
        ProgramArguments: [entrypoint.nodePath, entrypoint.cliPath, "status"]
      }))
    });

    expect(status).toMatchObject({
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      reason: "entrypoint_mismatch"
    });
  });

  it("reports malformed_plist when macOS plist parsing fails", () => {
    const { deps } = createDarwinStatusFixture({ parseFailure: true });
    const status = getAutostartStatus(deps);

    expect(status).toMatchObject({
      installed: true,
      health: "malformed",
      needsRepair: true,
      reason: "malformed_plist"
    });
  });

  it("reports missing_program_arguments when ProgramArguments are absent", () => {
    const { deps } = createDarwinStatusFixture({ omitProgramArguments: true });
    const status = getAutostartStatus(deps);

    expect(status).toMatchObject({
      installed: true,
      health: "malformed",
      needsRepair: true,
      reason: "missing_program_arguments"
    });
  });

  it("keeps a stable persisted plist healthy even when the current invocation is transient", () => {
    const current = createDarwinStatusFixture({ currentCliTransient: true });
    const stablePersisted = createCliFixture();
    const stableEntrypoint = resolveCliEntrypoint({
      argv1: stablePersisted.cliPath,
      transientEntrypointRoots: current.deps.transientEntrypointRoots
    });
    const status = getAutostartStatus({
      ...current.deps,
      execFileSync: vi.fn(() => JSON.stringify({
        ProgramArguments: [stableEntrypoint.nodePath, stableEntrypoint.cliPath, "serve"]
      }))
    });

    expect(status).toMatchObject({
      installed: true,
      health: "healthy",
      needsRepair: false,
      command: stableEntrypoint.command
    });
    expect(status.expectedCommand).toBeUndefined();
  });

  it("still reports missing_cli_path when a transient current invocation finds a broken persisted command", () => {
    const current = createDarwinStatusFixture({ currentCliTransient: true });
    const status = getAutostartStatus({
      ...current.deps,
      execFileSync: vi.fn(() => JSON.stringify({
        ProgramArguments: [current.entrypoint.nodePath, "/missing/cli/index.js", "serve"]
      }))
    });

    expect(status).toMatchObject({
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      reason: "missing_cli_path"
    });
  });

  it("reports healthy on Windows when the persisted task action matches the current entrypoint", () => {
    const { deps, entrypoint, execFileSyncMock } = createWindowsStatusFixture();
    const status = getAutostartStatus(deps);

    expect(status).toMatchObject({
      supported: true,
      installed: true,
      health: "healthy",
      needsRepair: false,
      command: entrypoint.command,
      expectedCommand: entrypoint.command
    });
    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
  });

  it("reports missing Windows scheduled tasks as missing", () => {
    const { deps, entrypoint, execFileSyncMock } = createWindowsStatusFixture({ taskInstalled: false });
    const status = getAutostartStatus(deps);

    expect(status).toMatchObject({
      supported: true,
      installed: false,
      health: "missing",
      needsRepair: false,
      expectedCommand: entrypoint.command
    });
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("reports transient_cli_path when the persisted Windows task points at a backslash _npx CLI path", () => {
    const transientCliPath =
      "C:\\Users\\test\\AppData\\Local\\npm-cache\\_npx\\runner\\node_modules\\opendevbrowser\\dist\\cli\\index.js";
    const fixture = createWindowsStatusFixture({
      existsSync: (value) => value === transientCliPath || fsExistsSync(value)
    });
    const status = getAutostartStatus({
      ...fixture.deps,
      execFileSync: vi.fn((_command: string, args: string[]) => {
        if (args.includes("/XML")) {
          return buildWindowsTaskXml([fixture.entrypoint.nodePath, transientCliPath, "serve"]);
        }
        return undefined;
      })
    });

    expect(status).toMatchObject({
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      reason: "transient_cli_path",
      command: `"${fixture.entrypoint.nodePath}" "${transientCliPath}" "serve"`
    });
  });

  it("reports missing_cli_path when the persisted Windows task uses a missing CLI entrypoint", () => {
    const fixture = createWindowsStatusFixture();
    const status = getAutostartStatus({
      ...fixture.deps,
      execFileSync: vi.fn((_command: string, args: string[]) => {
        if (args.includes("/XML")) {
          return buildWindowsTaskXml([fixture.entrypoint.nodePath, "C:\\missing\\opendevbrowser\\index.js", "serve"]);
        }
        return undefined;
      })
    });

    expect(status).toMatchObject({
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      reason: "missing_cli_path"
    });
  });

  it("reports entrypoint_mismatch when the persisted Windows task action shape changes", () => {
    const fixture = createWindowsStatusFixture();
    const status = getAutostartStatus({
      ...fixture.deps,
      execFileSync: vi.fn((_command: string, args: string[]) => {
        if (args.includes("/XML")) {
          return buildWindowsTaskXml([fixture.entrypoint.nodePath, fixture.entrypoint.cliPath, "status"]);
        }
        return undefined;
      })
    });

    expect(status).toMatchObject({
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      reason: "entrypoint_mismatch"
    });
  });

  it("keeps a stable persisted Windows task healthy even when the current invocation is transient", () => {
    const current = createWindowsStatusFixture({ currentCliTransient: true });
    const stablePersisted = createCliFixture();
    const stableEntrypoint = resolveCliEntrypoint({
      platform: "win32",
      argv1: stablePersisted.cliPath,
      transientEntrypointRoots: current.deps.transientEntrypointRoots
    });
    const status = getAutostartStatus({
      ...current.deps,
      execFileSync: vi.fn((_command: string, args: string[]) => {
        if (args.includes("/XML")) {
          return buildWindowsTaskXml([stableEntrypoint.nodePath, stableEntrypoint.cliPath, "serve"]);
        }
        return undefined;
      })
    });

    expect(status).toMatchObject({
      installed: true,
      health: "healthy",
      needsRepair: false,
      command: stableEntrypoint.command
    });
    expect(status.expectedCommand).toBeUndefined();
  });

  it("marks unsupported platforms explicitly", () => {
    const status = getAutostartStatus({ platform: "linux" });

    expect(status).toMatchObject({
      supported: false,
      installed: false,
      health: "unsupported",
      needsRepair: false,
      reason: "unsupported_platform"
    });
  });
});

describe("installAutostart", () => {
  it("creates the macOS LaunchAgents and Logs directories before bootstrap", () => {
    const { cliPath, root, transientEntrypointRoots } = createCliFixture();
    const home = join(root, "home");
    const plistPath = join(home, "Library", "LaunchAgents", "com.opendevbrowser.daemon.plist");
    const logsDir = join(home, "Library", "Logs");
    const mkdirSyncMock = vi.fn();
    const writeFileSyncMock = vi.fn();
    const execFileSyncMock = vi.fn();

    const result = installAutostart({
      platform: "darwin",
      argv1: cliPath,
      homedir: () => home,
      transientEntrypointRoots,
      mkdirSync: mkdirSyncMock,
      writeFileSync: writeFileSyncMock,
      execFileSync: execFileSyncMock,
      uid: 501
    });

    expect(result).toMatchObject({
      installed: true,
      health: "healthy",
      needsRepair: false
    });
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(1, join(home, "Library", "LaunchAgents"), { recursive: true });
    expect(mkdirSyncMock).toHaveBeenNthCalledWith(2, logsDir, { recursive: true });
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      plistPath,
      expect.stringContaining("opendevbrowser-daemon.log"),
      { encoding: "utf-8" }
    );
    expect(writeFileSyncMock.mock.invocationCallOrder[0]).toBeGreaterThan(mkdirSyncMock.mock.invocationCallOrder[1]);
    expect(execFileSyncMock.mock.calls).toEqual([
      ["launchctl", ["bootout", "gui/501", plistPath], { stdio: "ignore" }],
      ["launchctl", ["bootstrap", "gui/501", plistPath], { stdio: "ignore" }],
      ["launchctl", ["enable", "gui/501/com.opendevbrowser.daemon"], { stdio: "ignore" }],
      ["launchctl", ["kickstart", "-k", "gui/501/com.opendevbrowser.daemon"], { stdio: "ignore" }]
    ]);
  });

  it("fails before writing a macOS LaunchAgent when the current CLI path is transient", () => {
    const { cliPath, transientEntrypointRoots } = createCliFixture({ transient: true });
    const writeFileSyncMock = vi.fn();
    const execFileSyncMock = vi.fn();

    expect(() => installAutostart({
      platform: "darwin",
      argv1: cliPath,
      homedir: () => join(tmpdir(), "odb-home"),
      transientEntrypointRoots,
      writeFileSync: writeFileSyncMock,
      execFileSync: execFileSyncMock
    })).toThrow(/transient CLI path/);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("fails before creating a Windows scheduled task when the current CLI path is transient", () => {
    const { cliPath, transientEntrypointRoots } = createCliFixture({ transient: true });
    const execFileSyncMock = vi.fn();

    expect(() => installAutostart({
      platform: "win32",
      argv1: cliPath,
      transientEntrypointRoots,
      execFileSync: execFileSyncMock
    })).toThrow(/transient CLI path/);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});
