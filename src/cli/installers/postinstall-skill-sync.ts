import * as fs from "fs";
import * as path from "path";
import { getPackageRoot } from "../../utils/package-assets";
import {
  syncBundledSkills,
  type SkillSyncResult,
  type SkillInstallMode
} from "./skills";

export type PostinstallSkipReason = "disabled" | "repo_checkout";

export interface PostinstallSkillSyncResult {
  success: boolean;
  skipped: boolean;
  reason?: PostinstallSkipReason;
  message: string;
  syncResult?: SkillSyncResult;
}

export interface RunPostinstallSkillSyncOptions {
  mode?: SkillInstallMode;
  skipRepoCheckoutGuard?: boolean;
}

function getSkipReason(packageRoot: string, skipRepoCheckoutGuard: boolean): PostinstallSkipReason | null {
  if (process.env.OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC === "1") {
    return "disabled";
  }

  if (!skipRepoCheckoutGuard && fs.existsSync(path.join(packageRoot, ".git"))) {
    return "repo_checkout";
  }

  return null;
}

function createSkippedResult(reason: PostinstallSkipReason): PostinstallSkillSyncResult {
  const message = reason === "disabled"
    ? "Postinstall skill sync skipped (OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1)."
    : "Postinstall skill sync skipped inside repo checkout.";

  return {
    success: true,
    skipped: true,
    reason,
    message
  };
}

export function runPostinstallSkillSync(
  options: RunPostinstallSkillSyncOptions = {}
): PostinstallSkillSyncResult {
  const mode = options.mode ?? "global";
  const packageRoot = getPackageRoot();
  const skipReason = getSkipReason(packageRoot, options.skipRepoCheckoutGuard === true);

  if (skipReason) {
    return createSkippedResult(skipReason);
  }

  const syncResult = syncBundledSkills(mode);
  return {
    success: syncResult.success,
    skipped: false,
    message: syncResult.message,
    syncResult
  };
}
