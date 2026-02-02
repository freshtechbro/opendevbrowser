import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import type { ParsedArgs } from "../args";
import { createUsageError, EXIT_DISCONNECTED, EXIT_EXECUTION } from "../errors";

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

const parseNativeArgs = (rawArgs: string[]): { subcommand: NativeSubcommand; extensionId?: string } => {
  const subcommand = rawArgs[0];
  if (subcommand !== "install" && subcommand !== "uninstall" && subcommand !== "status") {
    throw createUsageError("Usage: opendevbrowser native <install|uninstall|status> [extension-id]");
  }
  if (subcommand === "install") {
    const extensionId = rawArgs[1];
    if (!extensionId) {
      throw createUsageError("Missing extension ID. Usage: opendevbrowser native install <extension-id>");
    }
    if (!EXTENSION_ID_RE.test(extensionId)) {
      throw createUsageError("Invalid extension ID format. Expected 32 characters (a-p).");
    }
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
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../../../scripts/native");
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

export async function runNativeCommand(args: ParsedArgs) {
  const { subcommand, extensionId } = parseNativeArgs(args.rawArgs);
  const scriptsDir = getScriptsDir();
  const hostScript = getHostScriptPath();
  const manifestPath = getManifestPath();
  const installScript = process.platform === "win32"
    ? path.join(scriptsDir, "install.ps1")
    : path.join(scriptsDir, "install.sh");
  const uninstallScript = process.platform === "win32"
    ? path.join(scriptsDir, "uninstall.ps1")
    : path.join(scriptsDir, "uninstall.sh");

  if (subcommand === "install") {
    if (!fs.existsSync(hostScript)) {
      return {
        success: false,
        message: `Native host not found at ${hostScript}.`,
        exitCode: EXIT_EXECUTION
      };
    }
    try {
      runScript(installScript, [extensionId as string]);
      return {
        success: true,
        message: `Native host installed for extension ${extensionId}.`,
        data: { manifestPath }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Native install failed: ${message}`, exitCode: EXIT_EXECUTION };
    }
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
  getNativeStatusSnapshot
};
