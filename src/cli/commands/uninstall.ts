import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getGlobalConfigPath,
  getLocalConfigPath,
  readConfig,
  hasPlugin,
  removePluginFromContent
} from "../utils/config";
import type { InstallMode } from "../args";

export interface UninstallResult {
  success: boolean;
  message: string;
  configPath?: string;
  removed: boolean;
  configFileDeleted: boolean;
}

function getPluginConfigPath(mode: InstallMode): string {
  if (mode === "global") {
    const configDir = process.env.OPENCODE_CONFIG_DIR
      || path.join(os.homedir(), ".config", "opencode");
    return path.join(configDir, "opendevbrowser.jsonc");
  }
  return path.join(process.cwd(), "opendevbrowser.jsonc");
}

function removePluginConfigFile(mode: InstallMode): boolean {
  const configPath = getPluginConfigPath(mode);
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    return true;
  }
  return false;
}

export function runUninstall(
  mode: InstallMode,
  deleteConfigFile: boolean = false
): UninstallResult {
  const configPath = mode === "global" ? getGlobalConfigPath() : getLocalConfigPath();

  try {
    const { content, config } = readConfig(configPath);

    if (!hasPlugin(config)) {
      return {
        success: true,
        message: `opendevbrowser is not installed in ${configPath}`,
        configPath,
        removed: false,
        configFileDeleted: false
      };
    }

    const newContent = removePluginFromContent(content, "opendevbrowser");

    fs.writeFileSync(configPath, newContent, "utf-8");

    let configFileDeleted = false;
    if (deleteConfigFile) {
      configFileDeleted = removePluginConfigFile(mode);
    }

    return {
      success: true,
      message: `Removed opendevbrowser from ${configPath}`,
      configPath,
      removed: true,
      configFileDeleted
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to uninstall: ${message}`,
      configPath,
      removed: false,
      configFileDeleted: false
    };
  }
}

export function findInstalledConfigs(): { global: boolean; local: boolean } {
  let global = false;
  let local = false;

  try {
    const { config: globalConfig } = readConfig(getGlobalConfigPath());
    global = hasPlugin(globalConfig);
  } catch {
    void 0;
  }

  try {
    const { config: localConfig } = readConfig(getLocalConfigPath());
    local = hasPlugin(localConfig);
  } catch {
    void 0;
  }

  return { global, local };
}
