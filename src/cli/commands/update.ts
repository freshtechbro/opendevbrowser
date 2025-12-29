import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PLUGIN_NAME = "opendevbrowser";

export interface UpdateResult {
  success: boolean;
  message: string;
  cleared: boolean;
}

function getCacheDir(): string {
  return process.env.OPENCODE_CACHE_DIR
    || path.join(os.homedir(), ".cache", "opencode");
}

function rmdir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export function runUpdate(): UpdateResult {
  const cacheDir = getCacheDir();
  const nodeModulesDir = path.join(cacheDir, "node_modules");
  const pluginCacheDir = path.join(nodeModulesDir, PLUGIN_NAME);

  try {
    if (!fs.existsSync(pluginCacheDir)) {
      if (fs.existsSync(nodeModulesDir)) {
        rmdir(nodeModulesDir);
        return {
          success: true,
          message: "Cleared OpenCode plugin cache. The latest version will be installed on next run.",
          cleared: true
        };
      }

      return {
        success: true,
        message: "No cached plugin found. OpenCode will install the latest version on next run.",
        cleared: false
      };
    }

    rmdir(pluginCacheDir);

    return {
      success: true,
      message: "Cache cleared. OpenCode will install the latest version on next run.",
      cleared: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to clear cache: ${message}`,
      cleared: false
    };
  }
}
