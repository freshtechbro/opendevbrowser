import * as fs from "fs";
import * as path from "path";
import { ensureDir } from "../utils/config";
import { getBundledSkillsDir, getGlobalSkillTargets, getLocalSkillTargets } from "../utils/skills";

export type SkillInstallMode = "global" | "local";

export interface SkillTargetInstallResult {
  agents: string[];
  targetDir: string;
  installed: string[];
  skipped: string[];
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
}

export function installSkills(mode: SkillInstallMode): SkillInstallResult {
  const targets = mode === "global" ? getGlobalSkillTargets() : getLocalSkillTargets();
  const targetResults: SkillTargetInstallResult[] = [];

  try {
    const sourceDir = getBundledSkillsDir();
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    for (const target of targets) {
      const installed: string[] = [];
      const skipped: string[] = [];

      try {
        ensureDir(target.dir);

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const skillName = entry.name;
          const sourcePath = path.join(sourceDir, skillName);
          const targetPath = path.join(target.dir, skillName);

          if (fs.existsSync(targetPath)) {
            skipped.push(skillName);
            continue;
          }

          fs.cpSync(sourcePath, targetPath, { recursive: true });
          installed.push(skillName);
        }

        targetResults.push({
          agents: target.agents,
          targetDir: target.dir,
          installed,
          skipped,
          success: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        targetResults.push({
          agents: target.agents,
          targetDir: target.dir,
          installed,
          skipped,
          success: false,
          error: message
        });
      }
    }

    const installed = targetResults.flatMap((result) => result.installed);
    const skipped = targetResults.flatMap((result) => result.skipped);
    const failures = targetResults.filter((result) => !result.success);
    const failedSummary = failures.length > 0
      ? `, ${failures.length} failed`
      : "";
    const summary = `Skills ${mode} install: ${installed.length} installed${skipped.length ? `, ${skipped.length} skipped` : ""}${failedSummary} across ${targetResults.length} targets`;

    return {
      success: failures.length === 0,
      message: summary,
      mode,
      targets: targetResults,
      installed,
      skipped
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to install skills (${mode}): ${message}`,
      mode,
      targets: targetResults,
      installed: targetResults.flatMap((result) => result.installed),
      skipped: targetResults.flatMap((result) => result.skipped)
    };
  }
}
