import { execFileSync } from "child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const MAC_LABEL = "com.opendevbrowser.daemon";
const WIN_TASK_NAME = "OpenDevBrowser Daemon";
export const STABLE_DAEMON_INSTALL_GUIDANCE =
  "Run opendevbrowser daemon install from a stable install location (for example, a global npm install or a persistent local package install).";

export type CliEntrypoint = {
  nodePath: string;
  cliPath: string;
  args: string[];
  command: string;
  source: "argv1" | "module";
  isTransient: boolean;
};

export type AutostartHealth = "unsupported" | "missing" | "healthy" | "needs_repair" | "malformed";

export type AutostartReason =
  | "missing_plist"
  | "missing_program_arguments"
  | "malformed_plist"
  | "missing_node_path"
  | "missing_cli_path"
  | "transient_cli_path"
  | "entrypoint_mismatch"
  | "unsupported_platform";

export type AutostartStatus = {
  platform: NodeJS.Platform;
  supported: boolean;
  installed: boolean;
  health: AutostartHealth;
  needsRepair: boolean;
  location?: string;
  taskName?: string;
  command?: string;
  expectedCommand?: string;
  label?: string;
  reason?: AutostartReason;
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
  transientEntrypointRoots?: string[];
};

type ResolvedAutostartDeps = Required<Omit<AutostartDeps, "transientEntrypointRoots">>
  & Pick<AutostartDeps, "transientEntrypointRoots">;

type MacLaunchAgentParseResult =
  | { ok: true; command: string; programArguments: string[] }
  | { ok: false; reason: "missing_program_arguments" | "malformed_plist" };

type WindowsTaskActionParseResult =
  | { ok: true; command: string; programArguments: string[] }
  | { ok: false };

const defaultDeps = (): ResolvedAutostartDeps => ({
  platform: process.platform,
  argv1: process.argv[1] ?? "",
  moduleUrl: import.meta.url,
  uid: typeof process.getuid === "function" ? process.getuid() : 0,
  homedir,
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  execFileSync,
  transientEntrypointRoots: undefined
});

const NPX_CACHE_SEGMENT_PATTERN = /[\\/]_npx(?:[\\/]|$)/;

const formatCommand = (programArguments: string[]): string => {
  return programArguments.map((value) => `"${value}"`).join(" ");
};

const resolveCliPathFromModule = (moduleUrl: string, exists: typeof existsSync): string => {
  const modulePath = fileURLToPath(moduleUrl);
  const candidate = resolve(dirname(modulePath), "..", "index.js");
  if (!exists(candidate)) {
    throw new Error(`CLI entrypoint not found at ${candidate}`);
  }
  return candidate;
};

const normalizeComparisonPath = (value: string, platform: NodeJS.Platform): string => {
  const resolvedPath = resolve(value);
  return platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
};

const isPathInsideRoot = (candidate: string, root: string, platform: NodeJS.Platform): boolean => {
  const normalizedCandidate = normalizeComparisonPath(candidate, platform);
  const normalizedRoot = normalizeComparisonPath(root, platform);
  const relation = relative(normalizedRoot, normalizedCandidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
};

const getTransientEntrypointRoots = (deps: ResolvedAutostartDeps): string[] => {
  const configuredRoots = deps.transientEntrypointRoots;
  if (configuredRoots && configuredRoots.length > 0) {
    return [...new Set(configuredRoots.map((root) => normalizeComparisonPath(root, deps.platform)))];
  }

  const roots = [tmpdir()];
  if (deps.platform === "darwin") {
    roots.push("/tmp", "/private/tmp");
  }
  return [...new Set(roots.map((root) => normalizeComparisonPath(root, deps.platform)))];
};

const isTransientCliPath = (cliPath: string, deps: ResolvedAutostartDeps): boolean => {
  const normalizedCliPath = normalizeComparisonPath(cliPath, deps.platform);
  return getTransientEntrypointRoots(deps).some((root) => isPathInsideRoot(cliPath, root, deps.platform))
    || NPX_CACHE_SEGMENT_PATTERN.test(normalizedCliPath);
};

const TRANSIENT_AUTOSTART_INSTALL_ERROR_PREFIX = "Cannot install daemon autostart from transient CLI path";

export const isTransientAutostartInstallError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith(TRANSIENT_AUTOSTART_INSTALL_ERROR_PREFIX);
};

export const resolveCliEntrypoint = (deps: AutostartDeps = {}): CliEntrypoint => {
  const resolved = { ...defaultDeps(), ...deps };
  const exists = resolved.existsSync;
  let cliPath: string | null = null;
  let source: CliEntrypoint["source"] = "module";

  if (resolved.argv1) {
    const candidate = resolve(resolved.argv1);
    if (exists(candidate)) {
      cliPath = candidate;
      source = "argv1";
    }
  }

  if (!cliPath) {
    cliPath = resolveCliPathFromModule(resolved.moduleUrl, exists);
  }

  const nodePath = process.execPath;
  const args = [cliPath, "serve"];
  const command = formatCommand([nodePath, ...args]);
  const isTransient = isTransientCliPath(cliPath, resolved);

  return { nodePath, cliPath, args, command, source, isTransient };
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
  const command = formatCommand([entrypoint.nodePath, entrypoint.cliPath, "serve"]);
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

const createAutostartStatus = (status: AutostartStatus): AutostartStatus => status;

const createMacAutostartStatus = (
  entrypoint: CliEntrypoint,
  location: string,
  overrides: Partial<AutostartStatus>
): AutostartStatus => {
  return createAutostartStatus({
    platform: "darwin",
    supported: true,
    installed: false,
    health: "missing",
    needsRepair: false,
    location,
    label: MAC_LABEL,
    expectedCommand: entrypoint.isTransient ? undefined : entrypoint.command,
    ...overrides
  });
};

const createWindowsAutostartStatus = (
  entrypoint: CliEntrypoint,
  overrides: Partial<AutostartStatus>
): AutostartStatus => {
  return createAutostartStatus({
    platform: "win32",
    supported: true,
    installed: false,
    health: "missing",
    needsRepair: false,
    taskName: WIN_TASK_NAME,
    expectedCommand: entrypoint.isTransient ? undefined : entrypoint.command,
    ...overrides
  });
};

const classifyPersistedProgramArguments = (
  programArguments: string[],
  deps: ResolvedAutostartDeps
): { health: "healthy" | "needs_repair"; reason?: AutostartReason } => {
  const actualNodePath = programArguments[0];
  const actualCliPath = programArguments[1];

  if (!actualNodePath || !deps.existsSync(actualNodePath)) {
    return { health: "needs_repair", reason: "missing_node_path" };
  }

  if (!actualCliPath || !deps.existsSync(actualCliPath)) {
    return { health: "needs_repair", reason: "missing_cli_path" };
  }

  if (isTransientCliPath(actualCliPath, deps)) {
    return { health: "needs_repair", reason: "transient_cli_path" };
  }

  if (programArguments.length !== 3 || programArguments[2] !== "serve") {
    return { health: "needs_repair", reason: "entrypoint_mismatch" };
  }

  return { health: "healthy" };
};

const hasMatchingProgramArgument = (
  programArguments: string[],
  expectedValue: string,
  deps: ResolvedAutostartDeps,
  isPath = false
): boolean => {
  const normalizedExpected = isPath ? normalizeComparisonPath(expectedValue, deps.platform) : expectedValue;
  return programArguments.some((value) => {
    const normalizedValue = isPath ? normalizeComparisonPath(value, deps.platform) : value;
    return normalizedValue === normalizedExpected;
  });
};

const classifyExpectedProgramArguments = (
  expectedArgs: string[],
  actualArgs: string[],
  deps: ResolvedAutostartDeps
): AutostartReason | undefined => {
  if (!hasMatchingProgramArgument([actualArgs[0] ?? ""], expectedArgs[0] ?? "", deps, true)) {
    return hasMatchingProgramArgument(actualArgs, expectedArgs[0] ?? "", deps, true)
      ? "entrypoint_mismatch"
      : "missing_node_path";
  }

  if (!hasMatchingProgramArgument([actualArgs[1] ?? ""], expectedArgs[1] ?? "", deps, true)) {
    return hasMatchingProgramArgument(actualArgs, expectedArgs[1] ?? "", deps, true)
      ? "entrypoint_mismatch"
      : "missing_cli_path";
  }

  if (
    actualArgs.length !== expectedArgs.length
    || !actualArgs.every((value, index) => {
      const expectedValue = expectedArgs[index] ?? "";
      return index < 2
        ? normalizeComparisonPath(value, deps.platform) === normalizeComparisonPath(expectedValue, deps.platform)
        : value === expectedValue;
    })
  ) {
    return "entrypoint_mismatch";
  }

  return undefined;
};

const readMacLaunchAgentProgramArguments = (
  plistPath: string,
  deps: ResolvedAutostartDeps
): MacLaunchAgentParseResult => {
  try {
    const text = deps.execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], { encoding: "utf-8" }) as string;
    const parsed = JSON.parse(text) as { ProgramArguments?: unknown };
    const programArguments = parsed?.ProgramArguments;
    if (
      !Array.isArray(programArguments)
      || programArguments.length < 2
      || programArguments.some((value) => typeof value !== "string")
    ) {
      return { ok: false, reason: "missing_program_arguments" };
    }
    const commandArgs = programArguments as string[];
    return {
      ok: true,
      command: formatCommand(commandArgs),
      programArguments: commandArgs
    };
  } catch {
    return { ok: false, reason: "malformed_plist" };
  }
};

const classifyMacAutostartStatus = (
  entrypoint: CliEntrypoint,
  location: string,
  deps: ResolvedAutostartDeps
): AutostartStatus => {
  if (!deps.existsSync(location)) {
    return createMacAutostartStatus(entrypoint, location, {
      installed: false,
      health: "missing",
      needsRepair: false,
      reason: "missing_plist"
    });
  }

  const parsed = readMacLaunchAgentProgramArguments(location, deps);
  if (!parsed.ok) {
    return createMacAutostartStatus(entrypoint, location, {
      installed: true,
      health: "malformed",
      needsRepair: true,
      reason: parsed.reason
    });
  }

  const expectedNodePath = entrypoint.nodePath;
  const expectedCliPath = entrypoint.cliPath;
  const expectedArgs = [expectedNodePath, ...entrypoint.args];
  const actualArgs = parsed.programArguments;
  const actualStatus = classifyPersistedProgramArguments(actualArgs, deps);

  if (actualStatus.health !== "healthy") {
    return createMacAutostartStatus(entrypoint, location, {
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      command: parsed.command,
      reason: actualStatus.reason
    });
  }

  if (entrypoint.isTransient) {
    return createMacAutostartStatus(entrypoint, location, {
      installed: true,
      health: "healthy",
      needsRepair: false,
      command: parsed.command
    });
  }

  const mismatchReason = classifyExpectedProgramArguments(expectedArgs, actualArgs, deps);
  if (mismatchReason) {
    return createMacAutostartStatus(entrypoint, location, {
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      command: parsed.command,
      reason: mismatchReason
    });
  }

  return createMacAutostartStatus(entrypoint, location, {
    installed: true,
    health: "healthy",
    needsRepair: false,
    command: parsed.command
  });
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

const assertPersistentEntrypoint = (entrypoint: CliEntrypoint): void => {
  if (!entrypoint.isTransient) {
    return;
  }

  throw new Error(
    `${TRANSIENT_AUTOSTART_INSTALL_ERROR_PREFIX} "${entrypoint.cliPath}". `
    + `${STABLE_DAEMON_INSTALL_GUIDANCE} Do not use a temporary npx cache or onboarding workspace.`
  );
};

const installMacAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const resolved = { ...defaultDeps(), ...deps };
  const entrypoint = resolveCliEntrypoint(resolved);
  assertPersistentEntrypoint(entrypoint);
  const home = resolved.homedir();
  const plistPath = getLaunchAgentPath(home);
  const stdoutPath = join(home, "Library", "Logs", "opendevbrowser-daemon.log");
  const stderrPath = join(home, "Library", "Logs", "opendevbrowser-daemon.err.log");
  resolved.mkdirSync(dirname(plistPath), { recursive: true });
  resolved.writeFileSync(
    plistPath,
    buildLaunchAgentPlist(entrypoint, { stdoutPath, stderrPath }),
    { encoding: "utf-8" }
  );

  const uid = resolved.uid;
  runCommand(resolved.execFileSync, "launchctl", ["bootout", `gui/${uid}`, plistPath], true);
  runCommand(resolved.execFileSync, "launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  runCommand(resolved.execFileSync, "launchctl", ["enable", `gui/${uid}/${MAC_LABEL}`], true);
  runCommand(resolved.execFileSync, "launchctl", ["kickstart", "-k", `gui/${uid}/${MAC_LABEL}`], true);

  return createMacAutostartStatus(entrypoint, plistPath, {
    installed: true,
    health: "healthy",
    needsRepair: false,
    command: entrypoint.command
  });
};

const uninstallMacAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const resolved = { ...defaultDeps(), ...deps };
  const entrypoint = resolveCliEntrypoint(resolved);
  const plistPath = getLaunchAgentPath(resolved.homedir());
  const uid = resolved.uid;
  runCommand(resolved.execFileSync, "launchctl", ["bootout", `gui/${uid}`, plistPath], true);
  if (resolved.existsSync(plistPath)) {
    resolved.unlinkSync(plistPath);
  }
  return createMacAutostartStatus(entrypoint, plistPath, {
    installed: false,
    health: "missing",
    needsRepair: false,
    reason: "missing_plist"
  });
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

const decodeXmlText = (value: string): string => {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
};

const readXmlTag = (xml: string, tagName: string): string | undefined => {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  return match?.[1] ? decodeXmlText(match[1]) : undefined;
};

const splitCommandLine = (value: string): string[] => {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let backslashes = 0;

  for (const char of value) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }

    if (char === "\"") {
      if (backslashes > 0) {
        current += "\\".repeat(Math.floor(backslashes / 2));
        if (backslashes % 2 === 1) {
          current += "\"";
          backslashes = 0;
          continue;
        }
      }
      backslashes = 0;
      inQuotes = !inQuotes;
      continue;
    }

    if (backslashes > 0) {
      current += "\\".repeat(backslashes);
      backslashes = 0;
    }

    if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (backslashes > 0) {
    current += "\\".repeat(backslashes);
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
};

const readWindowsTaskAction = (
  taskName: string,
  deps: ResolvedAutostartDeps
): WindowsTaskActionParseResult => {
  try {
    const xml = deps.execFileSync("schtasks", ["/Query", "/TN", taskName, "/XML"], { encoding: "utf-8" }) as string;
    const command = readXmlTag(xml, "Command");
    const argumentsValue = readXmlTag(xml, "Arguments");

    if (!command) {
      return { ok: false };
    }

    const programArguments = argumentsValue !== undefined
      ? [command, ...splitCommandLine(argumentsValue)]
      : splitCommandLine(command);

    if (programArguments.length === 0) {
      return { ok: false };
    }

    return {
      ok: true,
      command: formatCommand(programArguments),
      programArguments
    };
  } catch {
    return { ok: false };
  }
};

const classifyWindowsAutostartStatus = (
  entrypoint: CliEntrypoint,
  deps: ResolvedAutostartDeps
): AutostartStatus => {
  const installed = isWindowsTaskInstalled(deps);
  if (!installed) {
    return createWindowsAutostartStatus(entrypoint, {
      installed: false,
      health: "missing",
      needsRepair: false
    });
  }

  const parsed = readWindowsTaskAction(WIN_TASK_NAME, deps);
  if (!parsed.ok) {
    return createWindowsAutostartStatus(entrypoint, {
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      reason: "entrypoint_mismatch"
    });
  }

  const expectedArgs = [entrypoint.nodePath, ...entrypoint.args];
  const actualStatus = classifyPersistedProgramArguments(parsed.programArguments, deps);

  if (actualStatus.health !== "healthy") {
    return createWindowsAutostartStatus(entrypoint, {
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      command: parsed.command,
      reason: actualStatus.reason
    });
  }

  if (entrypoint.isTransient) {
    return createWindowsAutostartStatus(entrypoint, {
      installed: true,
      health: "healthy",
      needsRepair: false,
      command: parsed.command
    });
  }

  const mismatchReason = classifyExpectedProgramArguments(expectedArgs, parsed.programArguments, deps);
  if (mismatchReason) {
    return createWindowsAutostartStatus(entrypoint, {
      installed: true,
      health: "needs_repair",
      needsRepair: true,
      command: parsed.command,
      reason: mismatchReason
    });
  }

  return createWindowsAutostartStatus(entrypoint, {
    installed: true,
    health: "healthy",
    needsRepair: false,
    command: parsed.command
  });
};

const installWindowsAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const resolved = { ...defaultDeps(), ...deps };
  const entrypoint = resolveCliEntrypoint(resolved);
  assertPersistentEntrypoint(entrypoint);
  const { args } = buildWindowsTaskArgs(entrypoint, WIN_TASK_NAME);
  runCommand(resolved.execFileSync, "schtasks", args);
  return createWindowsAutostartStatus(entrypoint, {
    installed: true,
    health: "healthy",
    needsRepair: false,
    command: entrypoint.command
  });
};

const uninstallWindowsAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const resolved = { ...defaultDeps(), ...deps };
  const entrypoint = resolveCliEntrypoint(resolved);
  runCommand(resolved.execFileSync, "schtasks", ["/Delete", "/TN", WIN_TASK_NAME, "/F"], true);
  return createWindowsAutostartStatus(entrypoint, {
    installed: false,
    health: "missing",
    needsRepair: false
  });
};

export const getAutostartStatus = (deps: AutostartDeps = {}): AutostartStatus => {
  const resolved = { ...defaultDeps(), ...deps };
  const platform = resolved.platform;

  if (platform === "darwin") {
    const entrypoint = resolveCliEntrypoint(resolved);
    const location = getLaunchAgentPath(resolved.homedir());
    return classifyMacAutostartStatus(entrypoint, location, resolved);
  }

  if (platform === "win32") {
    const entrypoint = resolveCliEntrypoint(resolved);
    return classifyWindowsAutostartStatus(entrypoint, resolved);
  }

  return createAutostartStatus({
    platform,
    supported: false,
    installed: false,
    health: "unsupported",
    needsRepair: false,
    reason: "unsupported_platform"
  });
};

export const installAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const platform = deps.platform ?? process.platform;
  if (platform === "darwin") {
    return installMacAutostart(deps);
  }
  if (platform === "win32") {
    return installWindowsAutostart(deps);
  }
  return createAutostartStatus({
    platform,
    supported: false,
    installed: false,
    health: "unsupported",
    needsRepair: false,
    reason: "unsupported_platform"
  });
};

export const uninstallAutostart = (deps: AutostartDeps = {}): AutostartInstallResult => {
  const platform = deps.platform ?? process.platform;
  if (platform === "darwin") {
    return uninstallMacAutostart(deps);
  }
  if (platform === "win32") {
    return uninstallWindowsAutostart(deps);
  }
  return createAutostartStatus({
    platform,
    supported: false,
    installed: false,
    health: "unsupported",
    needsRepair: false,
    reason: "unsupported_platform"
  });
};
