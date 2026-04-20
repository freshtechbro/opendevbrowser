import type { InstallMode, ParsedArgs } from "./args";
import type { UninstallResult } from "./commands/uninstall";
import type { UpdateResult } from "./commands/update";
import type { CommandResult } from "./commands/types";
import {
  createNoOpSkillRemovalResult,
  type SkillInstallMode,
  type SkillRemovalResult,
  type SkillSyncResult
} from "./installers/skills";
import type { SkillTarget } from "./utils/skills";

type SkillTargetOptions = {
  includeLegacyArtifacts: boolean;
};

type UpdateSkillDeps = {
  resolveUpdateSkillModes(args: ParsedArgs): InstallMode[];
  hasInstalledConfig(mode: InstallMode): boolean;
  hasBundledSkillArtifacts(mode: SkillInstallMode): boolean;
  getBundledSkillTargets(mode: SkillInstallMode): SkillTarget[];
  getBundledSkillLifecycleTargets(mode: SkillInstallMode, options: SkillTargetOptions): SkillTarget[];
  syncBundledSkillsForTargets(mode: SkillInstallMode, targets: readonly SkillTarget[]): SkillSyncResult;
};

type UninstallSkillDeps = {
  hasBundledSkillArtifacts(mode: SkillInstallMode): boolean;
  getBundledSkillLifecycleTargets(mode: SkillInstallMode, options: SkillTargetOptions): SkillTarget[];
  removeBundledSkillsForTargets(mode: SkillInstallMode, targets: readonly SkillTarget[]): SkillRemovalResult;
};

function shouldSkipSkills(args: ParsedArgs): boolean {
  return args.rawArgs.includes("--no-skills");
}

function getUpdateTargets(
  args: ParsedArgs,
  mode: SkillInstallMode,
  deps: UpdateSkillDeps
): SkillTarget[] {
  if (deps.hasInstalledConfig(mode)) {
    return deps.getBundledSkillTargets(mode);
  }
  return deps.getBundledSkillLifecycleTargets(mode, {
    includeLegacyArtifacts: deps.hasBundledSkillArtifacts(mode)
  });
}

function collectUpdateSkillResults(
  args: ParsedArgs,
  deps: UpdateSkillDeps,
  modes: readonly InstallMode[]
): SkillSyncResult[] {
  return modes.flatMap((mode) => {
    const targets = getUpdateTargets(args, mode, deps);
    return targets.length > 0 ? [deps.syncBundledSkillsForTargets(mode, targets)] : [];
  });
}

function getResolvedUpdateSkillModes(args: ParsedArgs, result: UpdateResult, deps: UpdateSkillDeps): InstallMode[] {
  return result.success ? deps.resolveUpdateSkillModes(args) : [];
}

function buildUpdateSkillMessage(
  args: ParsedArgs,
  result: UpdateResult,
  skillResults: readonly SkillSyncResult[]
): string {
  if (!result.success) {
    return "";
  }
  if (shouldSkipSkills(args)) {
    return "Managed skill refresh skipped (--no-skills).";
  }
  if (skillResults.length === 0) {
    return "No managed skill packs required refresh.";
  }
  return skillResults.map((entry) => entry.message).join("\n");
}

export function buildUpdateCommandResult(
  args: ParsedArgs,
  result: UpdateResult,
  deps: UpdateSkillDeps
): CommandResult {
  const skillModes = getResolvedUpdateSkillModes(args, result, deps);
  const skillResults = result.success && !shouldSkipSkills(args)
    ? collectUpdateSkillResults(args, deps, skillModes)
    : [];
  const message = [result.message, buildUpdateSkillMessage(args, result, skillResults)].filter(Boolean).join("\n");

  return {
    success: result.success && skillResults.every((entry) => entry.success),
    message,
    data: {
      cacheCleared: result.cleared,
      skillModes,
      skills: skillResults
    }
  };
}

function buildUninstallSkillMessage(
  args: ParsedArgs,
  result: UninstallResult,
  skillsResult: SkillRemovalResult | undefined
): string {
  if (!result.success) {
    return "";
  }
  if (shouldSkipSkills(args)) {
    return "Managed skill cleanup skipped (--no-skills).";
  }
  return skillsResult?.message ?? "No managed skill packs required cleanup.";
}

function getUninstallTargets(
  args: ParsedArgs,
  mode: InstallMode,
  result: UninstallResult,
  deps: UninstallSkillDeps
): SkillTarget[] {
  if (!result.success || shouldSkipSkills(args)) {
    return [];
  }
  return deps.getBundledSkillLifecycleTargets(mode, {
    includeLegacyArtifacts: result.removed || deps.hasBundledSkillArtifacts(mode)
  });
}

export function buildUninstallCommandResult(
  args: ParsedArgs,
  mode: InstallMode,
  result: UninstallResult,
  deps: UninstallSkillDeps
): CommandResult {
  const targets = getUninstallTargets(args, mode, result, deps);
  const skillsResult = result.success && !shouldSkipSkills(args)
    ? (targets.length > 0
        ? deps.removeBundledSkillsForTargets(mode, targets)
        : createNoOpSkillRemovalResult(mode))
    : undefined;
  const skillMessage = buildUninstallSkillMessage(args, result, skillsResult);

  return {
    success: result.success && (skillsResult?.success ?? true),
    message: [result.message, skillMessage].filter(Boolean).join("\n"),
    data: {
      config: result,
      skills: skillsResult
    }
  };
}
