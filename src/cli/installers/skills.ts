import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ensureDir } from "../utils/config";
import { getBundledSkillsDir, getGlobalSkillTargets, getLocalSkillTargets, type SkillTarget } from "../utils/skills";
import { listBundledSkillDirectories } from "../../skills/bundled-skill-directories";

export type SkillInstallMode = "global" | "local";

type SyncOutcome = "installed" | "refreshed" | "unchanged";
type LegacyAliasName = "research" | "shopping";
export type LegacyAliasPreservationReason = "contains_skill_md" | "non_empty" | "unknown_layout";

export interface PreservedLegacyAlias {
  targetDir: string;
  name: LegacyAliasName;
  reason: LegacyAliasPreservationReason;
}

export interface SkillTargetSyncResult {
  agents: string[];
  targetDir: string;
  installed: string[];
  refreshed: string[];
  unchanged: string[];
  removedLegacyAliases: string[];
  preservedLegacyAliases: PreservedLegacyAlias[];
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
  removedLegacyAliases: string[];
  preservedLegacyAliases: PreservedLegacyAlias[];
}

export interface SkillTargetRemovalResult {
  agents: string[];
  targetDir: string;
  removed: string[];
  missing: string[];
  removedLegacyAliases: string[];
  preservedLegacyAliases: PreservedLegacyAlias[];
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
  removedLegacyAliases: string[];
  preservedLegacyAliases: PreservedLegacyAlias[];
}

function getTargets(mode: SkillInstallMode): SkillTarget[] {
  return mode === "global" ? getGlobalSkillTargets() : getLocalSkillTargets();
}

function getCanonicalBundledSkillNames(): string[] {
  return listBundledSkillDirectories().map((entry) => entry.name);
}

function hasCanonicalBundledSkillInTarget(targetDir: string, packNames: readonly string[]): boolean {
  return packNames.some((packName) => fs.existsSync(path.join(targetDir, packName)));
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

function syncSkillDirectory(sourcePath: string, targetPath: string, sourceFingerprint: string): SyncOutcome {
  if (!fs.existsSync(targetPath)) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return "installed";
  }

  const targetFingerprint = hashDirectoryTree(targetPath);
  if (targetFingerprint === sourceFingerprint) {
    return "unchanged";
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

export function syncBundledSkills(mode: SkillInstallMode): SkillSyncResult {
  const targets = getTargets(mode);
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

      try {
        ensureDir(target.dir);

        for (const packName of packNames) {
          const sourcePath = path.join(sourceDir, packName);
          const targetPath = path.join(target.dir, packName);
          const sourceFingerprint = bundledFingerprints.get(packName);
          if (!sourceFingerprint) {
            throw new Error(`Bundled fingerprint missing: ${packName}`);
          }

          const outcome = syncSkillDirectory(sourcePath, targetPath, sourceFingerprint);
          if (outcome === "installed") {
            installed.push(packName);
          } else if (outcome === "refreshed") {
            refreshed.push(packName);
          } else {
            unchanged.push(packName);
          }
        }

        targetResults.push({
          agents: target.agents,
          targetDir: target.dir,
          installed,
          refreshed,
          unchanged,
          removedLegacyAliases: [],
          preservedLegacyAliases: [],
          success: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        targetResults.push({
          agents: target.agents,
          targetDir: target.dir,
          installed,
          refreshed,
          unchanged,
          removedLegacyAliases: [],
          preservedLegacyAliases: [],
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
      unchanged: targetResults.flatMap((entry) => entry.unchanged),
      removedLegacyAliases: targetResults.flatMap((entry) => entry.removedLegacyAliases),
      preservedLegacyAliases: targetResults.flatMap((entry) => entry.preservedLegacyAliases)
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
      unchanged: targetResults.flatMap((entry) => entry.unchanged),
      removedLegacyAliases: targetResults.flatMap((entry) => entry.removedLegacyAliases),
      preservedLegacyAliases: targetResults.flatMap((entry) => entry.preservedLegacyAliases)
    };
    result.message = `Failed to sync skills (${mode}): ${message}`;
    return result;
  }
}

export function removeBundledSkills(mode: SkillInstallMode): SkillRemovalResult {
  const targets = getTargets(mode);
  const packNames = getCanonicalBundledSkillNames();
  const targetResults: SkillTargetRemovalResult[] = [];

  for (const target of targets) {
    const removed: string[] = [];
    const missing: string[] = [];

    try {
      for (const packName of packNames) {
        const targetPath = path.join(target.dir, packName);
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true });
          removed.push(packName);
        } else {
          missing.push(packName);
        }
      }

      targetResults.push({
        agents: target.agents,
        targetDir: target.dir,
        removed,
        missing,
        removedLegacyAliases: [],
        preservedLegacyAliases: [],
        success: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      targetResults.push({
        agents: target.agents,
        targetDir: target.dir,
        removed,
        missing,
        removedLegacyAliases: [],
        preservedLegacyAliases: [],
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
    missing: targetResults.flatMap((entry) => entry.missing),
    removedLegacyAliases: targetResults.flatMap((entry) => entry.removedLegacyAliases),
    preservedLegacyAliases: targetResults.flatMap((entry) => entry.preservedLegacyAliases)
  };
  result.message = buildRemovalMessage(mode, result);
  return result;
}

export function hasBundledSkillArtifacts(mode: SkillInstallMode): boolean {
  const packNames = getCanonicalBundledSkillNames();
  const targets = getTargets(mode);

  return targets.some((target) => hasCanonicalBundledSkillInTarget(target.dir, packNames));
}
