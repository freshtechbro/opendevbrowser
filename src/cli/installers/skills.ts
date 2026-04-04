import * as fs from "fs";
import * as path from "path";
import { ensureDir } from "../utils/config";
import { getBundledSkillsDir, getGlobalSkillTargets, getLocalSkillTargets } from "../utils/skills";
import { listBundledSkillDirectories } from "../../skills/bundled-skill-directories";

export type SkillInstallMode = "global" | "local";

export interface SkillTargetInstallResult {
  agents: string[];
  targetDir: string;
  installed: string[];
  skipped: string[];
  discoverableInstalled: string[];
  aliasOnlyInstalled: string[];
  discoverableSkipped: string[];
  aliasOnlySkipped: string[];
  success: boolean;
  error?: string;
}

export interface SkillInstallResult {
  success: boolean;
  message: string;
  mode: SkillInstallMode;
  targets: SkillTargetInstallResult[];
  installed: string[];
  skipped: string[];
  discoverableInstalled: string[];
  aliasOnlyInstalled: string[];
  discoverableSkipped: string[];
  aliasOnlySkipped: string[];
}

type SkillInstallClassification = "discoverable" | "aliasOnly";

function formatClassificationBreakdown(discoverableCount: number, aliasOnlyCount: number): string {
  const parts: string[] = [];
  if (discoverableCount > 0) {
    parts.push(`${discoverableCount} discoverable`);
  }
  if (aliasOnlyCount > 0) {
    parts.push(`${aliasOnlyCount} alias-only`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export function installSkills(mode: SkillInstallMode): SkillInstallResult {
  const targets = mode === "global" ? getGlobalSkillTargets() : getLocalSkillTargets();
  const targetResults: SkillTargetInstallResult[] = [];

  try {
    const sourceDir = getBundledSkillsDir();
    const entries = listBundledSkillDirectories();

    for (const target of targets) {
      const installed: string[] = [];
      const skipped: string[] = [];
      const discoverableInstalled: string[] = [];
      const aliasOnlyInstalled: string[] = [];
      const discoverableSkipped: string[] = [];
      const aliasOnlySkipped: string[] = [];

      try {
        ensureDir(target.dir);

        for (const entry of entries) {
          const skillName = entry.name;
          const sourcePath = path.join(sourceDir, skillName);
          const targetPath = path.join(target.dir, skillName);
          const classification: SkillInstallClassification = entry.policy === "discoverable" ? "discoverable" : "aliasOnly";

          if (!fs.existsSync(sourcePath)) {
            throw new Error(`Bundled skill directory missing: ${skillName}`);
          }

          if (fs.existsSync(targetPath)) {
            skipped.push(skillName);
            if (classification === "discoverable") {
              discoverableSkipped.push(skillName);
            } else {
              aliasOnlySkipped.push(skillName);
            }
            continue;
          }

          fs.cpSync(sourcePath, targetPath, { recursive: true });
          installed.push(skillName);
          if (classification === "discoverable") {
            discoverableInstalled.push(skillName);
          } else {
            aliasOnlyInstalled.push(skillName);
          }
        }

        targetResults.push({
          agents: target.agents,
          targetDir: target.dir,
          installed,
          skipped,
          discoverableInstalled,
          aliasOnlyInstalled,
          discoverableSkipped,
          aliasOnlySkipped,
          success: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        targetResults.push({
          agents: target.agents,
          targetDir: target.dir,
          installed,
          skipped,
          discoverableInstalled,
          aliasOnlyInstalled,
          discoverableSkipped,
          aliasOnlySkipped,
          success: false,
          error: message
        });
      }
    }

    const installed = targetResults.flatMap((result) => result.installed);
    const skipped = targetResults.flatMap((result) => result.skipped);
    const discoverableInstalled = targetResults.flatMap((result) => result.discoverableInstalled);
    const aliasOnlyInstalled = targetResults.flatMap((result) => result.aliasOnlyInstalled);
    const discoverableSkipped = targetResults.flatMap((result) => result.discoverableSkipped);
    const aliasOnlySkipped = targetResults.flatMap((result) => result.aliasOnlySkipped);
    const failures = targetResults.filter((result) => !result.success);
    const failedSummary = failures.length > 0
      ? `, ${failures.length} failed`
      : "";
    const installedSummary = `${installed.length} installed${formatClassificationBreakdown(
      discoverableInstalled.length,
      aliasOnlyInstalled.length
    )}`;
    const skippedSummary = skipped.length > 0
      ? `, ${skipped.length} skipped${formatClassificationBreakdown(
        discoverableSkipped.length,
        aliasOnlySkipped.length
      )}`
      : "";
    const summary = `Skills ${mode} install: ${installedSummary}${skippedSummary}${failedSummary} across ${targetResults.length} targets`;

    return {
      success: failures.length === 0,
      message: summary,
      mode,
      targets: targetResults,
      installed,
      skipped,
      discoverableInstalled,
      aliasOnlyInstalled,
      discoverableSkipped,
      aliasOnlySkipped
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to install skills (${mode}): ${message}`,
      mode,
      targets: targetResults,
      installed: targetResults.flatMap((result) => result.installed),
      skipped: targetResults.flatMap((result) => result.skipped),
      discoverableInstalled: targetResults.flatMap((result) => result.discoverableInstalled),
      aliasOnlyInstalled: targetResults.flatMap((result) => result.aliasOnlyInstalled),
      discoverableSkipped: targetResults.flatMap((result) => result.discoverableSkipped),
      aliasOnlySkipped: targetResults.flatMap((result) => result.aliasOnlySkipped)
    };
  }
}
