import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PLUGIN_NAME = "opendevbrowser";
const CACHE_MANIFEST = "package.json";
const CACHE_LOCKFILE = "package-lock.json";
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
] as const;

type DependencySection = typeof DEPENDENCY_SECTIONS[number];
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export interface UpdateResult {
  success: boolean;
  message: string;
  cleared: boolean;
}

function getCacheDir(): string {
  return process.env.OPENCODE_CACHE_DIR
    || path.join(os.homedir(), ".cache", "opencode");
}

function assertCacheChild(targetPath: string, cacheDir: string): void {
  const resolvedCache = path.resolve(cacheDir);
  const resolvedPath = path.resolve(targetPath);
  const relativePath = path.relative(resolvedCache, resolvedPath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Security: refusing to modify path outside cache directory: ${targetPath}`);
  }
}

function removePathIfExists(targetPath: string, cacheDir: string): boolean {
  assertCacheChild(targetPath, cacheDir);
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function removeDependencyPin(manifest: JsonObject, section: DependencySection): boolean {
  const dependencies = manifest[section];
  if (!isJsonObject(dependencies) || !(PLUGIN_NAME in dependencies)) {
    return false;
  }

  delete dependencies[PLUGIN_NAME];
  if (Object.keys(dependencies).length === 0) {
    delete manifest[section];
  }
  return true;
}

function removeManifestPin(cacheDir: string): boolean {
  const manifestPath = path.join(cacheDir, CACHE_MANIFEST);
  assertCacheChild(manifestPath, cacheDir);
  if (!fs.existsSync(manifestPath)) {
    return false;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as JsonValue;
  if (!isJsonObject(manifest)) {
    throw new Error(`${CACHE_MANIFEST} must contain a JSON object`);
  }

  const removed = DEPENDENCY_SECTIONS
    .map((section) => removeDependencyPin(manifest, section))
    .some(Boolean);
  if (removed) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return removed;
}

export function runUpdate(): UpdateResult {
  const cacheDir = getCacheDir();
  const nodeModulesDir = path.join(cacheDir, "node_modules");
  const pluginCacheDir = path.join(nodeModulesDir, PLUGIN_NAME);
  const lockfilePath = path.join(cacheDir, CACHE_LOCKFILE);

  try {
    const packageRemoved = removePathIfExists(pluginCacheDir, cacheDir);
    const manifestPinRemoved = removeManifestPin(cacheDir);
    const lockfileRemoved = removePathIfExists(lockfilePath, cacheDir);
    const cleared = packageRemoved || manifestPinRemoved || lockfileRemoved;

    if (!cleared) {
      return {
        success: true,
        message: "No cached plugin found. OpenCode will install the latest version on next run.",
        cleared: false
      };
    }

    return {
      success: true,
      message: "Cache repaired. OpenCode will install the latest version on next run.",
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
