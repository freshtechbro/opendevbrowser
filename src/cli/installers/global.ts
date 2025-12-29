import * as fs from "fs";
import {
  getGlobalConfigPath,
  readConfig,
  hasPlugin,
  ensureDir,
  updateConfigContent
} from "../utils/config";
import { createPluginConfig } from "../templates/config";

export interface InstallResult {
  success: boolean;
  message: string;
  configPath: string;
  created: boolean;
  alreadyInstalled: boolean;
}

export function installGlobal(withConfig: boolean = false): InstallResult {
  const configPath = getGlobalConfigPath();

  try {
    const { content, config } = readConfig(configPath);

    if (hasPlugin(config)) {
      return {
        success: true,
        message: `opendevbrowser is already installed in ${configPath}`,
        configPath,
        created: false,
        alreadyInstalled: true
      };
    }

    const newContent = updateConfigContent(content, "opendevbrowser");

    ensureDir(configPath.replace(/[/\\][^/\\]+$/, ""));
    fs.writeFileSync(configPath, newContent, "utf-8");

    if (withConfig) {
      createPluginConfig("global");
    }

    return {
      success: true,
      message: `Added opendevbrowser to ${configPath}`,
      configPath,
      created: content.trim() === "",
      alreadyInstalled: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to install globally: ${message}`,
      configPath,
      created: false,
      alreadyInstalled: false
    };
  }
}
