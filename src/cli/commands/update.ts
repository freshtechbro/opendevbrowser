import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

const PLUGIN_NAME = "opendevbrowser";
const CACHE_MANIFEST = "package.json";
const CACHE_LOCKFILE = "package-lock.json";
const CACHE_UPDATE_LOCK = ".opendevbrowser-update.lock";
const OPENCODE_PACKAGE_ALIAS = `${PLUGIN_NAME}@latest`;
const CACHE_LOCK_STALE_MS = 30 * 60 * 1000;
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
] as const;

type DependencySection = typeof DEPENDENCY_SECTIONS[number];
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type CacheMutationLock = {
  pid: number;
  createdAt: number;
  token?: string;
};
type HeldCacheMutationLock = {
  fd: number;
  token: string;
};

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

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isExistingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function assertNoSymlinkCachePath(targetPath: string, cacheDir: string): void {
  assertCacheChild(targetPath, cacheDir);
  const resolvedCache = path.resolve(cacheDir);
  const relativeSegments = path.relative(resolvedCache, path.resolve(targetPath)).split(path.sep).filter(Boolean);
  for (const candidate of [resolvedCache, ...relativeSegments.map((_, index) => path.join(resolvedCache, ...relativeSegments.slice(0, index + 1)))]) {
    try {
      if (fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error(`Security: refusing to modify symlinked cache path: ${candidate}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }
      throw error;
    }
  }
}

function cacheDirectoryExists(cacheDir: string): boolean {
  try {
    const stat = fs.lstatSync(cacheDir);
    if (stat.isSymbolicLink()) {
      throw new Error(`Security: refusing to modify symlinked cache path: ${cacheDir}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${cacheDir} must be a directory`);
    }
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

function removePathIfExists(targetPath: string, cacheDir: string): boolean {
  assertNoSymlinkCachePath(targetPath, cacheDir);
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function cacheFileExists(targetPath: string, cacheDir: string): boolean {
  assertNoSymlinkCachePath(targetPath, cacheDir);
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Security: refusing to modify symlinked cache manifest: ${targetPath}`);
    }
    return stat.isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

function writeManifestAtomic(manifestPath: string, cacheDir: string, manifest: JsonObject): void {
  const tempPath = `${manifestPath}.${process.pid}.tmp`;
  assertNoSymlinkCachePath(tempPath, cacheDir);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tempPath, "wx");
    fs.writeFileSync(fd, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, manifestPath);
  } catch (error) {
    if (fd !== null) {
      fs.closeSync(fd);
    }
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function withCacheMutationLock<T>(cacheDir: string, action: () => T): T {
  const lockPath = path.join(cacheDir, CACHE_UPDATE_LOCK);
  assertNoSymlinkCachePath(lockPath, cacheDir);
  let lock: HeldCacheMutationLock | null = null;
  try {
    lock = openCacheMutationLock(lockPath);
    return action();
  } catch (error) {
    if (isExistingPathError(error)) {
      throw new Error("another update is already running for this OpenCode cache");
    }
    throw error;
  } finally {
    if (lock !== null) {
      fs.closeSync(lock.fd);
      removeOwnedCacheMutationLock(lockPath, lock.token);
    }
  }
}

function openCacheMutationLock(lockPath: string): HeldCacheMutationLock {
  try {
    return writeCacheMutationLock(lockPath);
  } catch (error) {
    if (!isExistingPathError(error) || !isStaleCacheMutationLock(lockPath)) {
      throw error;
    }
    removeStaleCacheMutationLock(lockPath);
    return writeCacheMutationLock(lockPath);
  }
}

function writeCacheMutationLock(lockPath: string): HeldCacheMutationLock {
  const fd = fs.openSync(lockPath, "wx");
  const token = randomUUID();
  try {
    const lock: CacheMutationLock = { pid: process.pid, createdAt: Date.now(), token };
    fs.writeFileSync(fd, `${JSON.stringify(lock)}\n`, "utf8");
    return { fd, token };
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(lockPath, { force: true });
    throw error;
  }
}

function isStaleCacheMutationLock(lockPath: string): boolean {
  const lock = readCacheMutationLock(lockPath);
  if (!lock) {
    return isLegacyCacheMutationLockStale(lockPath);
  }
  if (Date.now() - lock.createdAt < CACHE_LOCK_STALE_MS) {
    return false;
  }
  return !isProcessRunning(lock.pid);
}

function isLegacyCacheMutationLockStale(lockPath: string): boolean {
  try {
    const pid = readLegacyCacheMutationLockPid(lockPath);
    if (pid !== null && isProcessRunning(pid)) {
      return false;
    }
    return Date.now() - fs.statSync(lockPath).mtimeMs >= CACHE_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function readLegacyCacheMutationLockPid(lockPath: string): number | null {
  const raw = fs.readFileSync(lockPath, "utf8").trim();
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const pid = Number(raw);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function readCacheMutationLock(lockPath: string): CacheMutationLock | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<CacheMutationLock>;
    const { pid, createdAt, token } = parsed;
    const hasToken = token === undefined || (typeof token === "string" && token.length > 0);
    if (typeof pid === "number" && typeof createdAt === "number" && hasToken
      && Number.isInteger(pid) && Number.isFinite(createdAt)) {
      return token === undefined ? { pid, createdAt } : { pid, createdAt, token };
    }
  } catch {
    return null;
  }
  return null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function createExistingLockError(): NodeJS.ErrnoException {
  const error = new Error("cache update lock changed before stale cleanup") as NodeJS.ErrnoException;
  error.code = "EEXIST";
  return error;
}

function removeStaleCacheMutationLock(lockPath: string): void {
  const content = fs.readFileSync(lockPath, "utf8");
  if (!isStaleCacheMutationLock(lockPath) || fs.readFileSync(lockPath, "utf8") !== content) {
    throw createExistingLockError();
  }
  fs.rmSync(lockPath, { force: true });
}

function removeOwnedCacheMutationLock(lockPath: string, token: string): void {
  const lock = readCacheMutationLock(lockPath);
  if (lock?.token === token) {
    fs.rmSync(lockPath, { force: true });
  }
}

function preflightCacheMutationPaths(cacheDir: string, paths: readonly string[]): void {
  for (const targetPath of paths) {
    assertNoSymlinkCachePath(targetPath, cacheDir);
  }
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
  if (!cacheFileExists(manifestPath, cacheDir)) {
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
    writeManifestAtomic(manifestPath, cacheDir, manifest);
  }
  return removed;
}

export function runUpdate(): UpdateResult {
  const cacheDir = getCacheDir();
  const nodeModulesDir = path.join(cacheDir, "node_modules");
  const pluginCacheDir = path.join(nodeModulesDir, PLUGIN_NAME);
  const pluginPackageCacheDir = path.join(cacheDir, "packages", OPENCODE_PACKAGE_ALIAS);
  const lockfilePath = path.join(cacheDir, CACHE_LOCKFILE);

  try {
    if (!cacheDirectoryExists(cacheDir)) {
      return {
        success: true,
        message: "No cached plugin found. OpenCode will install the latest version on next run.",
        cleared: false
      };
    }

    preflightCacheMutationPaths(cacheDir, [
      path.join(cacheDir, CACHE_MANIFEST),
      pluginCacheDir,
      pluginPackageCacheDir,
      lockfilePath,
      path.join(cacheDir, CACHE_UPDATE_LOCK)
    ]);
    const cleared = withCacheMutationLock(cacheDir, () => {
      const manifestPinRemoved = removeManifestPin(cacheDir);
      const packageRemoved = removePathIfExists(pluginCacheDir, cacheDir);
      const aliasedPackageRemoved = removePathIfExists(pluginPackageCacheDir, cacheDir);
      const lockfileRemoved = removePathIfExists(lockfilePath, cacheDir);
      return packageRemoved || aliasedPackageRemoved || manifestPinRemoved || lockfileRemoved;
    });

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
