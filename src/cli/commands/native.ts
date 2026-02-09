import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import type { ParsedArgs } from "../args";
import { createUsageError, EXIT_DISCONNECTED, EXIT_EXECUTION } from "../errors";
import { getExtensionPath } from "../../extension-extractor";

type NativeSubcommand = "install" | "uninstall" | "status";

type NativeStatus = {
  installed: boolean;
  manifestPath: string | null;
  wrapperPath: string | null;
  hostScriptPath: string;
  extensionId: string | null;
  registryPath: string | null;
};

const EXTENSION_ID_RE = /^[a-p]{32}$/;
const EXTENSION_NAME = "OpenDevBrowser Relay";
const ANNOTATION_COMMAND_NAME = "toggle-annotation";
type ExtensionIdMatchReason = "path" | "name" | "command";

const normalizeExtensionId = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return EXTENSION_ID_RE.test(trimmed) ? trimmed : null;
};

const requireExtensionId = (value: string | undefined): string => {
  if (!value) {
    throw createUsageError("Missing extension ID. Usage: opendevbrowser native install <extension-id>");
  }
  const normalized = normalizeExtensionId(value);
  if (!normalized) {
    throw createUsageError("Invalid extension ID format. Expected 32 characters (a-p).");
  }
  return normalized;
};

const parseNativeArgs = (rawArgs: string[]): { subcommand: NativeSubcommand; extensionId?: string } => {
  const subcommand = rawArgs[0];
  if (subcommand !== "install" && subcommand !== "uninstall" && subcommand !== "status") {
    throw createUsageError("Usage: opendevbrowser native <install|uninstall|status> [extension-id]");
  }
  if (subcommand === "install") {
    const extensionId = requireExtensionId(rawArgs[1]);
    return { subcommand, extensionId };
  }
  return { subcommand };
};

const getManifestDir = (): string => {
  if (process.platform === "darwin") {
    return path.join(process.env.HOME || "", "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
  }
  if (process.platform === "linux") {
    return path.join(process.env.HOME || "", ".config", "google-chrome", "NativeMessagingHosts");
  }
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA
      || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
    if (!base) {
      throw createUsageError("LOCALAPPDATA is not set. Unable to locate NativeMessagingHosts directory.");
    }
    return path.join(base, "Google", "Chrome", "User Data", "NativeMessagingHosts");
  }
  throw createUsageError(`Native messaging is not supported on ${process.platform}.`);
};

const getScriptsDir = (): string => {
  const __filename = fileURLToPath(import.meta.url);
  const startDir = path.dirname(__filename);
  const rootsToScan = [startDir, process.cwd()];

  for (const root of rootsToScan) {
    let current = path.resolve(root);
    while (true) {
      const scriptsDir = path.join(current, "scripts", "native");
      const packageJsonPath = path.join(current, "package.json");
      if (fs.existsSync(scriptsDir) && fs.existsSync(packageJsonPath)) {
        return scriptsDir;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  throw createUsageError("Unable to locate scripts/native directory.");
};

const getHostScriptPath = (): string => {
  return path.join(getScriptsDir(), "host.cjs");
};

const getManifestPath = (): string => {
  return path.join(getManifestDir(), "com.opendevbrowser.native.json");
};

const getWrapperPath = (): string => {
  const wrapperName = process.platform === "win32"
    ? "com.opendevbrowser.native.cmd"
    : "com.opendevbrowser.native.sh";
  return path.join(getManifestDir(), wrapperName);
};

const readManifest = (manifestPath: string): { extensionId: string | null } => {
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const data = JSON.parse(raw) as { allowed_origins?: string[] };
    const origins = Array.isArray(data.allowed_origins) ? data.allowed_origins : [];
    const match = origins.find((origin) => origin.startsWith("chrome-extension://"));
    if (!match) return { extensionId: null };
    const id = match.replace("chrome-extension://", "").replace("/", "");
    return { extensionId: EXTENSION_ID_RE.test(id) ? id : null };
  } catch {
    return { extensionId: null };
  }
};

const runScript = (script: string, args: string[]): void => {
  if (process.platform === "win32") {
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { stdio: "pipe" });
    return;
  }
  execFileSync("bash", [script, ...args], { stdio: "pipe" });
};

const readRegistryPath = (): string | null => {
  if (process.platform !== "win32") return null;
  const key = "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.opendevbrowser.native";
  try {
    const output = execFileSync("reg", ["query", key, "/ve"], { encoding: "utf8" });
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      if (line.includes("REG_SZ")) {
        const parts = line.trim().split(/\s{2,}/);
        return parts[parts.length - 1] || null;
      }
    }
    return null;
  } catch {
    return null;
  }
};

const normalizePath = (value: string): string => {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
};

const getChromeUserDataRoots = (): string[] => {
  if (process.platform === "darwin") {
    return [
      path.join(homedir(), "Library", "Application Support", "Google", "Chrome"),
      path.join(homedir(), "Library", "Application Support", "Chromium"),
      path.join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser")
    ];
  }
  if (process.platform === "linux") {
    return [
      path.join(homedir(), ".config", "google-chrome"),
      path.join(homedir(), ".config", "chromium"),
      path.join(homedir(), ".config", "BraveSoftware", "Brave-Browser")
    ];
  }
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA
      || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
    if (!base) return [];
    return [
      path.join(base, "Google", "Chrome", "User Data"),
      path.join(base, "Chromium", "User Data"),
      path.join(base, "BraveSoftware", "Brave-Browser", "User Data")
    ];
  }
  return [];
};

const PROFILE_PREFERENCES_FILES = ["Preferences", "Secure Preferences"] as const;

const getProfileDirs = (root: string): string[] => {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && (entry.name === "Default" || entry.name.startsWith("Profile ")))
      .map((entry) => path.join(root, entry.name))
      .filter((dir) => PROFILE_PREFERENCES_FILES.some((filename) => fs.existsSync(path.join(dir, filename))));
  } catch {
    return [];
  }
};

const readProfilePreferences = (profileDir: string): Record<string, unknown>[] => {
  const records: Record<string, unknown>[] = [];
  for (const filename of PROFILE_PREFERENCES_FILES) {
    try {
      const raw = fs.readFileSync(path.join(profileDir, filename), "utf8");
      records.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // Missing or invalid preference files are ignored; other sources may still be valid.
    }
  }
  return records;
};

const findExtensionIdInCommands = (preferences: Record<string, unknown>): string | null => {
  const extensionCommands = preferences.extensions as Record<string, unknown> | undefined;
  const commandMaps: Array<Record<string, unknown> | undefined> = [
    extensionCommands?.commands as Record<string, unknown> | undefined,
    ((preferences.account_values as Record<string, unknown> | undefined)?.extensions as Record<string, unknown> | undefined)
      ?.commands as Record<string, unknown> | undefined
  ];

  for (const commandMap of commandMaps) {
    if (!commandMap) {
      continue;
    }
    for (const value of Object.values(commandMap)) {
      if (typeof value !== "object" || value === null) {
        continue;
      }
      const entry = value as Record<string, unknown>;
      const commandName = typeof entry.command_name === "string" ? entry.command_name : null;
      const extensionId = typeof entry.extension === "string" ? entry.extension : null;
      if (commandName === ANNOTATION_COMMAND_NAME && extensionId && EXTENSION_ID_RE.test(extensionId)) {
        return extensionId;
      }
    }
  }

  return null;
};

const findExtensionIdInPreferences = (
  preferences: Record<string, unknown>,
  extensionPath: string | null
): { id: string; matchedBy: "path" | "name" } | null => {
  const extensions = preferences.extensions as Record<string, unknown> | undefined;
  const settings = extensions?.settings as Record<string, unknown> | undefined;
  if (!settings) return null;

  const normalizedTargetPath = extensionPath ? normalizePath(extensionPath) : null;
  let nameMatch: string | null = null;

  for (const [id, entry] of Object.entries(settings)) {
    if (!EXTENSION_ID_RE.test(id) || typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const recordPath = typeof record.path === "string" ? record.path : null;
    if (recordPath && normalizedTargetPath) {
      if (normalizePath(recordPath) === normalizedTargetPath) {
        return { id, matchedBy: "path" };
      }
    }
    const manifest = record.manifest as Record<string, unknown> | undefined;
    const name = typeof manifest?.name === "string" ? manifest.name : null;
    if (!nameMatch && name === EXTENSION_NAME) {
      nameMatch = id;
    }
  }

  if (nameMatch) {
    return { id: nameMatch, matchedBy: "name" };
  }
  return null;
};

const getExtensionPathCandidates = (): Array<string | null> => {
  const candidates = new Set<string>();
  const primary = getExtensionPath();
  if (primary) {
    candidates.add(normalizePath(primary));
  }

  const cwdExtension = path.join(process.cwd(), "extension");
  if (fs.existsSync(path.join(cwdExtension, "manifest.json"))) {
    candidates.add(normalizePath(cwdExtension));
  }

  if (candidates.size === 0) {
    return [null];
  }
  return [...candidates];
};

export const getNativeStatusSnapshot = (): NativeStatus => {
  const hostScript = getHostScriptPath();
  const manifestPath = getManifestPath();
  const wrapperPath = getWrapperPath();
  const registryPath = readRegistryPath();

  let installed = false;
  let manifestExists = false;
  let wrapperExists = false;
  let extensionIdValue: string | null = null;
  if (fs.existsSync(manifestPath)) {
    manifestExists = true;
    installed = true;
    const manifest = readManifest(manifestPath);
    extensionIdValue = manifest.extensionId;
  }
  if (fs.existsSync(wrapperPath)) {
    wrapperExists = true;
  }
  if (!manifestExists || !wrapperExists) {
    installed = false;
  }
  if (process.platform === "win32" && !registryPath) {
    installed = false;
  }

  return {
    installed,
    manifestPath: manifestExists ? manifestPath : null,
    wrapperPath: wrapperExists ? wrapperPath : null,
    hostScriptPath: hostScript,
    extensionId: extensionIdValue,
    registryPath
  };
};

export function discoverExtensionId(): { extensionId: string | null; matchedBy?: ExtensionIdMatchReason } {
  const extensionPaths = getExtensionPathCandidates();
  const roots = getChromeUserDataRoots();
  for (const root of roots) {
    for (const profileDir of getProfileDirs(root)) {
      let nameFallback: { id: string; matchedBy: "name" } | null = null;
      let commandFallback: string | null = null;
      for (const preferences of readProfilePreferences(profileDir)) {
        for (const extensionPath of extensionPaths) {
          const match = findExtensionIdInPreferences(preferences, extensionPath);
          if (!match) {
            continue;
          }
          if (match.matchedBy === "path") {
            return { extensionId: match.id, matchedBy: match.matchedBy };
          }
          if (!nameFallback) {
            nameFallback = { id: match.id, matchedBy: "name" };
          }
        }

        if (!commandFallback) {
          commandFallback = findExtensionIdInCommands(preferences);
        }
      }
      if (nameFallback) {
        return { extensionId: nameFallback.id, matchedBy: nameFallback.matchedBy };
      }
      if (commandFallback) {
        return { extensionId: commandFallback, matchedBy: "command" };
      }
    }
  }
  return { extensionId: null };
}

export function installNativeHost(extensionId: string) {
  const normalized = normalizeExtensionId(extensionId);
  if (!normalized) {
    return {
      success: false,
      message: "Invalid extension ID format. Expected 32 characters (a-p).",
      exitCode: EXIT_EXECUTION
    };
  }

  const hostScript = getHostScriptPath();
  if (!fs.existsSync(hostScript)) {
    return {
      success: false,
      message: `Native host not found at ${hostScript}.`,
      exitCode: EXIT_EXECUTION
    };
  }

  const scriptsDir = getScriptsDir();
  const manifestPath = getManifestPath();
  const installScript = process.platform === "win32"
    ? path.join(scriptsDir, "install.ps1")
    : path.join(scriptsDir, "install.sh");

  try {
    runScript(installScript, [normalized]);
    return {
      success: true,
      message: `Native host installed for extension ${normalized}.`,
      data: { manifestPath }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Native install failed: ${message}`,
      exitCode: EXIT_EXECUTION
    };
  }
}

export async function runNativeCommand(args: ParsedArgs) {
  const { subcommand, extensionId } = parseNativeArgs(args.rawArgs);
  const scriptsDir = getScriptsDir();
  const uninstallScript = process.platform === "win32"
    ? path.join(scriptsDir, "uninstall.ps1")
    : path.join(scriptsDir, "uninstall.sh");

  if (subcommand === "install") {
    return installNativeHost(extensionId as string);
  }

  if (subcommand === "uninstall") {
    try {
      runScript(uninstallScript, []);
      return { success: true, message: "Native host uninstalled." };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Native uninstall failed: ${message}`, exitCode: EXIT_EXECUTION };
    }
  }

  const data = getNativeStatusSnapshot();

  if (!data.installed) {
    return {
      success: false,
      message: "Native host not installed.",
      data,
      exitCode: EXIT_DISCONNECTED
    };
  }

  const message = data.extensionId
    ? `Native host installed for extension ${data.extensionId}.`
    : "Native host installed (extension id missing).";
  return { success: true, message, data };
}

export const __test__ = {
  readManifest,
  getManifestDir,
  getManifestPath,
  getWrapperPath,
  getHostScriptPath,
  parseNativeArgs,
  getNativeStatusSnapshot,
  normalizeExtensionId,
  findExtensionIdInPreferences,
  getProfileDirs,
  readProfilePreferences,
  findExtensionIdInCommands,
  getExtensionPathCandidates
};
