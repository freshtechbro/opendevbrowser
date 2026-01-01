import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, renameSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const EXTENSION_DIR_NAME = "opendevbrowser";
const VERSION_FILE = ".version";

function getConfigDir(): string {
  return join(homedir(), ".config", "opencode", EXTENSION_DIR_NAME, "extension");
}

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version || "0.0.0";
  } catch (error) {
    console.warn("[opendevbrowser] Failed to read package.json for extension version:", error);
    return "0.0.0";
  }
}

function getInstalledVersion(destDir: string): string | null {
  try {
    const versionPath = join(destDir, VERSION_FILE);
    if (existsSync(versionPath)) {
      return readFileSync(versionPath, "utf-8").trim();
    }
  } catch (error) {
    console.warn("[opendevbrowser] Failed to read installed extension version:", error);
  }
  return null;
}

function getBundledExtensionPath(): string | null {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "extension"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "extension")
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "manifest.json"))) {
      return candidate;
    }
  }
  return null;
}

function isCompleteInstall(dir: string): boolean {
  const required = ["manifest.json", VERSION_FILE];
  return required.every(file => existsSync(join(dir, file)));
}

export function extractExtension(): string | null {
  const bundledPath = getBundledExtensionPath();
  if (!bundledPath) {
    return null;
  }

  const destDir = getConfigDir();
  const currentVersion = getPackageVersion();
  const installedVersion = getInstalledVersion(destDir);

  // Early return if version matches and installation is complete
  if (installedVersion === currentVersion && isCompleteInstall(destDir)) {
    return destDir;
  }

  // Create staging directory (sibling to destDir for same-device rename)
  const parentDir = dirname(destDir);
  const stagingDir = join(parentDir, `.opendevbrowser-staging-${process.pid}-${Date.now()}`);
  const backupDir = join(parentDir, `.opendevbrowser-backup-${process.pid}-${Date.now()}`);

  try {
    // Step 1: Copy to staging
    mkdirSync(stagingDir, { recursive: true });
    const itemsToCopy = ["manifest.json", "popup.html", "dist", "icons"];
    for (const item of itemsToCopy) {
      const src = join(bundledPath, item);
      const dest = join(stagingDir, item);
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true, force: true });
      }
    }
    writeFileSync(join(stagingDir, VERSION_FILE), currentVersion, "utf-8");

    // Step 2: Validate staging is complete
    if (!isCompleteInstall(stagingDir)) {
      throw new Error("Staging directory incomplete after copy");
    }

    // Step 3: Atomic swap
    if (existsSync(destDir)) {
      renameSync(destDir, backupDir);
    }
    renameSync(stagingDir, destDir);

    // Step 4: Cleanup backup
    if (existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }

    return destDir;
  } catch (error) {
    // Rollback: restore backup if it exists
    if (existsSync(backupDir) && !existsSync(destDir)) {
      try {
        renameSync(backupDir, destDir);
      } catch (rollbackError) {
        console.warn(`[opendevbrowser] Warning: Rollback failed for ${backupDir}:`, rollbackError);
      }
    }
    // Cleanup staging
    if (existsSync(stagingDir)) {
      try {
        rmSync(stagingDir, { recursive: true, force: true });
      } catch (stagingCleanupError) {
        console.warn(`[opendevbrowser] Warning: Failed to clean up staging directory ${stagingDir}:`, stagingCleanupError);
      }
    }
    // Cleanup backup
    if (existsSync(backupDir)) {
      try {
        rmSync(backupDir, { recursive: true, force: true });
      } catch (backupCleanupError) {
        console.warn(`[opendevbrowser] Warning: Failed to clean up backup directory ${backupDir}:`, backupCleanupError);
      }
    }
    throw error;
  }
}

export function getExtensionPath(): string | null {
  const destDir = getConfigDir();
  if (isCompleteInstall(destDir)) {
    return destDir;
  }
  return getBundledExtensionPath();
}
