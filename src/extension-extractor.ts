import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "fs";
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
    void error;
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
    // Ignore version read failures; we'll proceed with extraction.
    void error;
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

export async function extractExtension(): Promise<string | null> {
  const bundledPath = getBundledExtensionPath();
  if (!bundledPath) {
    return null;
  }

  const destDir = getConfigDir();
  const currentVersion = getPackageVersion();
  const installedVersion = getInstalledVersion(destDir);

  if (installedVersion === currentVersion && existsSync(join(destDir, "manifest.json"))) {
    return destDir;
  }

  mkdirSync(destDir, { recursive: true });

  const itemsToCopy = ["manifest.json", "popup.html", "dist", "icons"];
  for (const item of itemsToCopy) {
    const src = join(bundledPath, item);
    const dest = join(destDir, item);
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true, force: true });
    }
  }

  writeFileSync(join(destDir, VERSION_FILE), currentVersion, "utf-8");

  return destDir;
}

export function getExtensionPath(): string | null {
  const destDir = getConfigDir();
  if (existsSync(join(destDir, "manifest.json"))) {
    return destDir;
  }
  return getBundledExtensionPath();
}
