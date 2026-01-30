import { execFileSync } from "child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const MAC_LABEL = "com.opendevbrowser.daemon";
const WIN_TASK_NAME = "OpenDevBrowser Daemon";

export type CliEntrypoint = {
  nodePath: string;
  cliPath: string;
  args: string[];
  command: string;
};

export type AutostartStatus = {
  platform: NodeJS.Platform;
  supported: boolean;
  installed: boolean;
  location?: string;
  taskName?: string;
  command?: string;
  label?: string;
};

export type AutostartInstallResult = AutostartStatus;

export type AutostartDeps = {
  platform?: NodeJS.Platform;
  argv1?: string;
  moduleUrl?: string;
  uid?: number;
  homedir?: () => string;
  existsSync?: typeof existsSync;
  mkdirSync?: typeof mkdirSync;
  writeFileSync?: typeof writeFileSync;
  unlinkSync?: typeof unlinkSync;
  execFileSync?: typeof execFileSync;
};

const defaultDeps = (): Required<AutostartDeps> => ({
  platform: process.platform,
  argv1: process.argv[1],
  moduleUrl: import.meta.url,
  uid: typeof process.getuid === "function" ? process.getuid() : 0,
  homedir,
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  execFileSync
});

const resolveCliPathFromModule = (moduleUrl: string, exists: typeof existsSync): string => {
  const modulePath = fileURLToPath(moduleUrl);
  const candidate = resolve(dirname(modulePath), "..", "index.js");
  if (!exists(candidate)) {
    throw new Error(`CLI entrypoint not found at ${candidate}`);
  }
  return candidate;
};

export const resolveCliEntrypoint = (deps: AutostartDeps = {}): CliEntrypoint => {
  const resolved = { ...defaultDeps(), ...deps };
  const exists = resolved.existsSync;
  let cliPath: string | null = null;

  if (resolved.argv1) {
    const candidate = resolve(resolved.argv1);
    if (exists(candidate)) {
      cliPath = candidate;
    }
  }

  if (!cliPath) {
    cliPath = resolveCliPathFromModule(resolved.moduleUrl, exists);
  }

  const nodePath = process.execPath;
  const args = [cliPath, "serve"];
  const command = `"${nodePath}" "${cliPath}" serve`;

  return { nodePath, cliPath, args, command };
};

export const getLaunchAgentPath = (home = homedir()): string => {
  return join(home, "Library", "LaunchAgents", `${MAC_LABEL}.plist`);
};

export const buildLaunchAgentPlist = (
  entrypoint: CliEntrypoint,
  options: { label?: string; stdoutPath?: string; stderrPath?: string } = {}
): string => {
  const label = options.label ?? MAC_LABEL;
  const stdoutPath = options.stdoutPath ?? join(homedir(), "Library", "Logs", "opendevbrowser-daemon.log");
  const stderrPath = options.stderrPath ?? join(homedir(), "Library", "Logs", "opendevbrowser-daemon.err.log");
  const programArgs = [entrypoint.nodePath, ...entrypoint.args]
    .map((value) => `      <string>${value}</string>`)
    .join("\n");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    `  <key>Label</key>`,
    `  <string>${label}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    programArgs,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${stdoutPath}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${stderrPath}</string>`,
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
};

export const buildWindowsTaskArgs = (
  entrypoint: CliEntrypoint,
  taskName = WIN_TASK_NAME
): { taskName: string; command: string; args: string[] } => {
  const command = `"${entrypoint.nodePath}" "${entrypoint.cliPath}" serve`;
  const args = [
    "/Create",
    "/TN",
    taskName,
    "/TR",
    command,
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/F"
  ];
  return { taskName, command, args };
};

const runCommand = (
  exec: typeof execFileSync,
  command: string,
  args: string[],
  ignoreFailure = false
): void => {
  try {
    exec(command, args, { stdio: "ignore" });
  } catch (error) {
    if (ignoreFailure) return;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} ${args.join(" ")} failed: ${message}`);
  }
};

const installMacAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const resolved = { ...defaultDeps(), ...deps };
  const entrypoint = resolveCliEntrypoint(resolved);
  const plistPath = getLaunchAgentPath(resolved.homedir());
  resolved.mkdirSync(dirname(plistPath), { recursive: true });
  resolved.writeFileSync(plistPath, buildLaunchAgentPlist(entrypoint), { encoding: "utf-8" });

  const uid = resolved.uid;
  runCommand(resolved.execFileSync, "launchctl", ["bootout", `gui/${uid}`, plistPath], true);
  runCommand(resolved.execFileSync, "launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  runCommand(resolved.execFileSync, "launchctl", ["enable", `gui/${uid}/${MAC_LABEL}`], true);
  runCommand(resolved.execFileSync, "launchctl", ["kickstart", "-k", `gui/${uid}/${MAC_LABEL}`], true);

  return {
    platform: "darwin",
    supported: true,
    installed: true,
    location: plistPath,
    label: MAC_LABEL,
    command: entrypoint.command
  };
};

const uninstallMacAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const resolved = { ...defaultDeps(), ...deps };
  const plistPath = getLaunchAgentPath(resolved.homedir());
  const uid = resolved.uid;
  runCommand(resolved.execFileSync, "launchctl", ["bootout", `gui/${uid}`, plistPath], true);
  if (resolved.existsSync(plistPath)) {
    resolved.unlinkSync(plistPath);
  }
  return {
    platform: "darwin",
    supported: true,
    installed: false,
    location: plistPath,
    label: MAC_LABEL
  };
};

const isWindowsTaskInstalled = (deps: AutostartDeps = {}): boolean => {
  const resolved = { ...defaultDeps(), ...deps };
  try {
    resolved.execFileSync("schtasks", ["/Query", "/TN", WIN_TASK_NAME], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const installWindowsAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const resolved = { ...defaultDeps(), ...deps };
  const entrypoint = resolveCliEntrypoint(resolved);
  const { args } = buildWindowsTaskArgs(entrypoint, WIN_TASK_NAME);
  runCommand(resolved.execFileSync, "schtasks", args);
  return {
    platform: "win32",
    supported: true,
    installed: true,
    taskName: WIN_TASK_NAME,
    command: entrypoint.command
  };
};

const uninstallWindowsAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const resolved = { ...defaultDeps(), ...deps };
  runCommand(resolved.execFileSync, "schtasks", ["/Delete", "/TN", WIN_TASK_NAME, "/F"], true);
  return {
    platform: "win32",
    supported: true,
    installed: false,
    taskName: WIN_TASK_NAME
  };
};

export const getAutostartStatus = (deps: AutostartDeps = {}): AutostartStatus => {
  const resolved = { ...defaultDeps(), ...deps };
  const platform = resolved.platform;

  if (platform === "darwin") {
    const location = getLaunchAgentPath(resolved.homedir());
    return {
      platform,
      supported: true,
      installed: resolved.existsSync(location),
      location,
      label: MAC_LABEL
    };
  }

  if (platform === "win32") {
    return {
      platform,
      supported: true,
      installed: isWindowsTaskInstalled(resolved),
      taskName: WIN_TASK_NAME
    };
  }

  return {
    platform,
    supported: false,
    installed: false
  };
};

export const installAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const platform = deps.platform ?? process.platform;
  if (platform === "darwin") {
    return installMacAutostart(deps);
  }
  if (platform === "win32") {
    return installWindowsAutostart(deps);
  }
  return {
    platform,
    supported: false,
    installed: false
  };
};

export const uninstallAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const platform = deps.platform ?? process.platform;
  if (platform === "darwin") {
    return uninstallMacAutostart(deps);
  }
  if (platform === "win32") {
    return uninstallWindowsAutostart(deps);
  }
  return {
    platform,
    supported: false,
    installed: false
  };
};
