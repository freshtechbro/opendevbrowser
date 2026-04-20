import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ensureDir } from "../utils/config";
import { getBundledSkillsDir, getGlobalSkillTargets, getLocalSkillTargets, type SkillTarget } from "../utils/skills";
import { listBundledSkillDirectories } from "../../skills/bundled-skill-directories";

export type SkillInstallMode = "global" | "local";
type ManagedSkillTarget = SkillTarget & {
  managedPackNames?: string[];
};

type SyncOutcome = "installed" | "refreshed" | "unchanged";
const MANAGED_SKILLS_MARKER = ".opendevbrowser-managed-skills.json";
const MANAGED_SKILL_SENTINEL = ".opendevbrowser-managed-skill.json";
const MANAGED_SKILL_OWNER = "opendevbrowser";
const MANAGED_PACK_PREFIX = "opendevbrowser-";

interface ManagedSkillsMarker {
  managedPacks: string[];
  managesAllCanonicalPacks: boolean;
}

interface ManagedSkillSentinel {
  managedBy: string;
  packName: string;
  fingerprint: string;
}

interface SkillLifecycleTargetOptions {
  includeLegacyArtifacts: boolean;
}

interface ManagedPackScope {
  managedPackNames: string[];
  activePackNames: string[];
  managesAllCanonicalPacks: boolean;
}

export interface SkillTargetSyncResult {
  agents: string[];
  targetDir: string;
  installed: string[];
  refreshed: string[];
  unchanged: string[];
  success: boolean;
  error?: string;
}

export interface SkillSyncResult {
  success: boolean;
  message: string;
  mode: SkillInstallMode;
  targets: SkillTargetSyncResult[];
  installed: string[];
  refreshed: string[];
  unchanged: string[];
}

export interface SkillTargetRemovalResult {
  agents: string[];
  targetDir: string;
  removed: string[];
  missing: string[];
  success: boolean;
  error?: string;
}

export interface SkillRemovalResult {
  success: boolean;
  message: string;
  mode: SkillInstallMode;
  targets: SkillTargetRemovalResult[];
  removed: string[];
  missing: string[];
}

function getTargets(mode: SkillInstallMode): SkillTarget[] {
  return mode === "global" ? getGlobalSkillTargets() : getLocalSkillTargets();
}

function getCanonicalBundledSkillNames(): string[] {
  return listBundledSkillDirectories().map((entry) => entry.name);
}

function getManagedSkillsMarkerPath(targetDir: string): string {
  return path.join(targetDir, MANAGED_SKILLS_MARKER);
}

function getManagedSkillSentinelPath(targetPath: string): string {
  return path.join(targetPath, MANAGED_SKILL_SENTINEL);
}

function snapshotManagedSkillsMarker(targetDir: string): string | null {
  const markerPath = getManagedSkillsMarkerPath(targetDir);
  return fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8") : null;
}

function restoreManagedSkillsMarker(targetDir: string, previousMarker: string | null): void {
  if (previousMarker === null) {
    removeManagedSkillsMarker(targetDir);
    return;
  }
  fs.writeFileSync(getManagedSkillsMarkerPath(targetDir), previousMarker, "utf8");
}

function hasManagedSkillsMarker(targetDir: string): boolean {
  return fs.existsSync(getManagedSkillsMarkerPath(targetDir));
}

function isSafePathSegment(value: string): boolean {
  return value.length > 0
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && path.basename(value) === value;
}

function isManagedPackName(value: string): boolean {
  return isSafePathSegment(value) && value.startsWith(MANAGED_PACK_PREFIX);
}

function readManagedSkillsMarker(targetDir: string): ManagedSkillsMarker | null {
  if (!hasManagedSkillsMarker(targetDir)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(getManagedSkillsMarkerPath(targetDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<ManagedSkillsMarker>;
    return Array.isArray(parsed.managedPacks)
      ? {
          managedPacks: parsed.managedPacks.filter(
            (value): value is string => typeof value === "string" && isManagedPackName(value)
          ),
          managesAllCanonicalPacks: parsed.managesAllCanonicalPacks !== false
        }
      : null;
  } catch {
    return null;
  }
}

function writeManagedSkillsMarker(
  targetDir: string,
  packNames: readonly string[],
  managesAllCanonicalPacks: boolean
): void {
  const marker: ManagedSkillsMarker = {
    managedPacks: Array.from(new Set(packNames)),
    managesAllCanonicalPacks
  };
  fs.writeFileSync(
    getManagedSkillsMarkerPath(targetDir),
    `${JSON.stringify(marker, null, 2)}\n`,
    "utf8"
  );
}

function removeManagedSkillsMarker(targetDir: string): void {
  fs.rmSync(getManagedSkillsMarkerPath(targetDir), { force: true });
}

function writeManagedSkillSentinel(targetPath: string, packName: string, fingerprint: string): void {
  const sentinel: ManagedSkillSentinel = {
    managedBy: MANAGED_SKILL_OWNER,
    packName,
    fingerprint
  };
  fs.writeFileSync(
    getManagedSkillSentinelPath(targetPath),
    `${JSON.stringify(sentinel, null, 2)}\n`,
    "utf8"
  );
}

function readManagedSkillFingerprint(targetPath: string): string | null {
  const sentinelPath = getManagedSkillSentinelPath(targetPath);
  if (!fs.existsSync(sentinelPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(sentinelPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ManagedSkillSentinel>;
    return parsed.managedBy === MANAGED_SKILL_OWNER
      && parsed.packName === path.basename(targetPath)
      && typeof parsed.fingerprint === "string"
      ? parsed.fingerprint
      : null;
  } catch {
    return null;
  }
}

function getSentinelManagedPackNames(targetDir: string, packNames: readonly string[]): string[] {
  const canonicalPackNames = new Set(packNames);
  const candidatePackNames = new Set(packNames);
  if (fs.existsSync(targetDir) && isDirectoryPath(targetDir)) {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (entry.isDirectory() && isManagedPackName(entry.name)) {
        candidatePackNames.add(entry.name);
      }
    }
  }

  return Array.from(candidatePackNames).filter((packName) => {
    const targetPath = path.join(targetDir, packName);
    if (!fs.existsSync(targetPath) || readManagedSkillFingerprint(targetPath) === null) {
      return false;
    }
    return canonicalPackNames.has(packName) || shouldRemoveRetiredManagedPack(targetPath);
  });
}

function hasManagedCanonicalBundledSkillInTarget(targetDir: string, packNames: readonly string[]): boolean {
  return getSentinelManagedPackNames(targetDir, packNames).length > 0;
}

function removeManagedPackArtifacts(
  targetDir: string,
  packNames: readonly string[]
): { removed: string[]; missing: string[] } {
  const removed: string[] = [];
  const missing: string[] = [];

  for (const packName of packNames) {
    const targetPath = path.join(targetDir, packName);
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      removed.push(packName);
      continue;
    }
    missing.push(packName);
  }

  return { removed, missing };
}

function formatSummary(parts: string[], totalTargets: number, failures: number): string {
  const summary = parts.length > 0 ? parts.join(", ") : "no lifecycle changes";
  const failureSummary = failures > 0 ? `, ${failures} failed` : "";
  return `${summary} across ${totalTargets} targets${failureSummary}`;
}

function hashDirectoryTree(dirPath: string): string {
  const hash = crypto.createHash("sha256");

  const visit = (currentPath: string, relativePath: string): void => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const entryRelativePath = relativePath
        ? path.posix.join(relativePath, entry.name)
        : entry.name;

      if (entry.isFile() && entry.name === MANAGED_SKILL_SENTINEL) {
        continue;
      }

      if (entry.isDirectory()) {
        hash.update(`D:${entryRelativePath}\0`);
        visit(absolutePath, entryRelativePath);
        continue;
      }

      if (entry.isFile()) {
        hash.update(`F:${entryRelativePath}\0`);
        hash.update(fs.readFileSync(absolutePath));
        hash.update("\0");
        continue;
      }

      if (entry.isSymbolicLink()) {
        hash.update(`L:${entryRelativePath}\0${fs.readlinkSync(absolutePath)}\0`);
      }
    }
  };

  visit(dirPath, "");
  return hash.digest("hex");
}

function isDirectoryPath(targetPath: string): boolean {
  return fs.lstatSync(targetPath).isDirectory();
}

function shouldRemoveRetiredManagedPack(targetPath: string): boolean {
  if (!fs.existsSync(targetPath) || !isDirectoryPath(targetPath)) {
    return false;
  }
  const fingerprint = readManagedSkillFingerprint(targetPath);
  return fingerprint !== null && hashDirectoryTree(targetPath) === fingerprint;
}

function syncSkillDirectory(sourcePath: string, targetPath: string, sourceFingerprint: string): SyncOutcome {
  if (!fs.existsSync(targetPath)) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return "installed";
  }

  if (isDirectoryPath(targetPath)) {
    const targetFingerprint = hashDirectoryTree(targetPath);
    if (targetFingerprint === sourceFingerprint) {
      return "unchanged";
    }
  }

  const parentDir = path.dirname(targetPath);
  const targetName = path.basename(targetPath);
  const stagingRoot = fs.mkdtempSync(path.join(parentDir, `.${targetName}-sync-`));
  const stagedPath = path.join(stagingRoot, targetName);
  const backupPath = path.join(stagingRoot, `${targetName}-backup`);

  try {
    fs.cpSync(sourcePath, stagedPath, { recursive: true });
    fs.renameSync(targetPath, backupPath);
    try {
      fs.renameSync(stagedPath, targetPath);
    } catch (error) {
      if (fs.existsSync(backupPath) && !fs.existsSync(targetPath)) {
        fs.renameSync(backupPath, targetPath);
      }
      throw error;
    }
    fs.rmSync(backupPath, { recursive: true, force: true });
    return "refreshed";
  } finally {
    if (fs.existsSync(stagedPath)) {
      fs.rmSync(stagedPath, { recursive: true, force: true });
    }
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function buildSyncMessage(mode: SkillInstallMode, result: SkillSyncResult): string {
  return `Skills ${mode} sync: ${formatSummary(
    [
      result.installed.length > 0 ? `${result.installed.length} installed` : "",
      result.refreshed.length > 0 ? `${result.refreshed.length} refreshed` : "",
      result.unchanged.length > 0 ? `${result.unchanged.length} unchanged` : ""
    ].filter(Boolean),
    result.targets.length,
    result.targets.filter((entry) => !entry.success).length
  )}`;
}

function buildRemovalMessage(mode: SkillInstallMode, result: SkillRemovalResult): string {
  return `Skills ${mode} removal: ${formatSummary(
    [
      result.removed.length > 0 ? `${result.removed.length} removed` : "",
      result.missing.length > 0 ? `${result.missing.length} already absent` : ""
    ].filter(Boolean),
    result.targets.length,
    result.targets.filter((entry) => !entry.success).length
  )}`;
}

function resolveManagedPackScope(
  target: ManagedSkillTarget,
  marker: ManagedSkillsMarker | null,
  packNames: readonly string[]
): ManagedPackScope {
  const requestedAllCanonicalPacks = target.managedPackNames === undefined;
  const managesAllCanonicalPacks = requestedAllCanonicalPacks || marker?.managesAllCanonicalPacks === true;
  const managedPackNames = managesAllCanonicalPacks
    ? Array.from(new Set([...(marker?.managedPacks ?? []), ...packNames]))
    : Array.from(new Set(target.managedPackNames ?? marker?.managedPacks ?? []));
  const activePackNames = managesAllCanonicalPacks
    ? [...packNames]
    : managedPackNames.filter((packName) => packNames.includes(packName));

  return {
    managedPackNames,
    activePackNames,
    managesAllCanonicalPacks
  };
}

export function createNoOpSkillRemovalResult(mode: SkillInstallMode): SkillRemovalResult {
  const result: SkillRemovalResult = {
    success: true,
    message: "",
    mode,
    targets: [],
    removed: [],
    missing: []
  };
  result.message = buildRemovalMessage(mode, result);
  return result;
}

export function getBundledSkillLifecycleTargets(
  mode: SkillInstallMode,
  options: SkillLifecycleTargetOptions
): SkillTarget[] {
  const packNames = getCanonicalBundledSkillNames();
  return getTargets(mode).flatMap((target) => {
    const marker = readManagedSkillsMarker(target.dir);
    if (marker) {
      if (marker.managesAllCanonicalPacks || !options.includeLegacyArtifacts) {
        return marker.managesAllCanonicalPacks
        ? [target]
        : [{ ...target, managedPackNames: marker.managedPacks }];
      }
      const managedPackNames = Array.from(new Set([
        ...marker.managedPacks,
        ...getSentinelManagedPackNames(target.dir, packNames)
      ]));
      return managedPackNames.length > 0 ? [{ ...target, managedPackNames }] : [];
    }
    if (!options.includeLegacyArtifacts) {
      return [];
    }
    const managedPackNames = getSentinelManagedPackNames(target.dir, packNames);
    return managedPackNames.length > 0 ? [{ ...target, managedPackNames }] : [];
  });
}

export function getBundledSkillTargets(mode: SkillInstallMode): SkillTarget[] {
  return getTargets(mode);
}

export function syncBundledSkillsForTargets(
  mode: SkillInstallMode,
  targets: readonly SkillTarget[]
): SkillSyncResult {
  const targetResults: SkillTargetSyncResult[] = [];

  try {
    const sourceDir = getBundledSkillsDir();
    const packNames = getCanonicalBundledSkillNames();
    const bundledFingerprints = new Map<string, string>();

    for (const packName of packNames) {
      const sourcePath = path.join(sourceDir, packName);
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Bundled skill directory missing: ${packName}`);
      }
      bundledFingerprints.set(packName, hashDirectoryTree(sourcePath));
    }

    for (const target of targets) {
      const installed: string[] = [];
      const refreshed: string[] = [];
      const unchanged: string[] = [];
      const previousMarker = snapshotManagedSkillsMarker(target.dir);

      try {
        ensureDir(target.dir);
        const managedTarget = target as ManagedSkillTarget;
        const marker = readManagedSkillsMarker(target.dir);
        const { managedPackNames, activePackNames, managesAllCanonicalPacks } = resolveManagedPackScope(
          managedTarget,
          marker,
          packNames
        );
        const activePackNameSet = new Set(activePackNames);
        writeManagedSkillsMarker(target.dir, managedPackNames, managesAllCanonicalPacks);

        for (const packName of activePackNames) {
          const sourcePath = path.join(sourceDir, packName);
          const targetPath = path.join(target.dir, packName);
          const sourceFingerprint = bundledFingerprints.get(packName);
          if (!sourceFingerprint) {
            throw new Error(`Bundled fingerprint missing: ${packName}`);
          }

          const outcome = syncSkillDirectory(sourcePath, targetPath, sourceFingerprint);
          writeManagedSkillSentinel(targetPath, packName, sourceFingerprint);
          if (outcome === "installed") {
            installed.push(packName);
          } else if (outcome === "refreshed") {
            refreshed.push(packName);
          } else {
            unchanged.push(packName);
          }
        }

        const retiredPackNames = managedPackNames.filter((packName) => {
          return !activePackNameSet.has(packName)
            && shouldRemoveRetiredManagedPack(path.join(target.dir, packName));
        });
        removeManagedPackArtifacts(target.dir, retiredPackNames);
        if (activePackNames.length > 0 || managesAllCanonicalPacks) {
          writeManagedSkillsMarker(target.dir, activePackNames, managesAllCanonicalPacks);
        } else {
          removeManagedSkillsMarker(target.dir);
        }

        targetResults.push({
          agents: target.agents,
          targetDir: target.dir,
          installed,
          refreshed,
          unchanged,
          success: true
        });
      } catch (error) {
        restoreManagedSkillsMarker(target.dir, previousMarker);
        const message = error instanceof Error ? error.message : String(error);
        targetResults.push({
          agents: target.agents,
          targetDir: target.dir,
          installed,
          refreshed,
          unchanged,
          success: false,
          error: message
        });
      }
    }

    const result: SkillSyncResult = {
      success: targetResults.every((entry) => entry.success),
      message: "",
      mode,
      targets: targetResults,
      installed: targetResults.flatMap((entry) => entry.installed),
      refreshed: targetResults.flatMap((entry) => entry.refreshed),
      unchanged: targetResults.flatMap((entry) => entry.unchanged)
    };
    result.message = buildSyncMessage(mode, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: SkillSyncResult = {
      success: false,
      message: "",
      mode,
      targets: targetResults,
      installed: targetResults.flatMap((entry) => entry.installed),
      refreshed: targetResults.flatMap((entry) => entry.refreshed),
      unchanged: targetResults.flatMap((entry) => entry.unchanged)
    };
    result.message = `Failed to sync skills (${mode}): ${message}`;
    return result;
  }
}

export function syncBundledSkills(mode: SkillInstallMode): SkillSyncResult {
  return syncBundledSkillsForTargets(mode, getTargets(mode));
}

export function removeBundledSkillsForTargets(
  mode: SkillInstallMode,
  targets: readonly SkillTarget[]
): SkillRemovalResult {
  const packNames = getCanonicalBundledSkillNames();
  const targetResults: SkillTargetRemovalResult[] = [];

  for (const target of targets) {
    const removed: string[] = [];
    const missing: string[] = [];

    try {
      const managedTarget = target as ManagedSkillTarget;
      const marker = readManagedSkillsMarker(target.dir);
      const { managedPackNames, activePackNames } = resolveManagedPackScope(
        managedTarget,
        marker,
        packNames
      );
      const currentRemoval = removeManagedPackArtifacts(
        target.dir,
        activePackNames
      );
      removed.push(...currentRemoval.removed);
      missing.push(...currentRemoval.missing);
      const retiredPackNames = managedPackNames.filter((packName) => {
        return !packNames.includes(packName)
          && shouldRemoveRetiredManagedPack(path.join(target.dir, packName));
      });
      const retiredRemoval = removeManagedPackArtifacts(target.dir, retiredPackNames);
      removed.push(...retiredRemoval.removed);
      missing.push(...retiredRemoval.missing);
      removeManagedSkillsMarker(target.dir);

      targetResults.push({
        agents: target.agents,
        targetDir: target.dir,
        removed,
        missing,
        success: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      targetResults.push({
        agents: target.agents,
        targetDir: target.dir,
        removed,
        missing,
        success: false,
        error: message
      });
    }
  }

  const result: SkillRemovalResult = {
    success: targetResults.every((entry) => entry.success),
    message: "",
    mode,
    targets: targetResults,
    removed: targetResults.flatMap((entry) => entry.removed),
    missing: targetResults.flatMap((entry) => entry.missing)
  };
  result.message = buildRemovalMessage(mode, result);
  return result;
}

export function removeBundledSkills(mode: SkillInstallMode): SkillRemovalResult {
  return removeBundledSkillsForTargets(mode, getTargets(mode));
}

export function hasBundledSkillArtifacts(mode: SkillInstallMode): boolean {
  const packNames = getCanonicalBundledSkillNames();
  const targets = getTargets(mode);

  return targets.some((target) => hasManagedCanonicalBundledSkillInTarget(target.dir, packNames));
}

export function hasManagedBundledSkillInstall(mode: SkillInstallMode): boolean {
  return getTargets(mode).some((target) => readManagedSkillsMarker(target.dir) !== null);
}
