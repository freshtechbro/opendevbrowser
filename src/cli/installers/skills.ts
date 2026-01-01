import * as fs from "fs";
import * as path from "path";
import { ensureDir } from "../utils/config";
import { getBundledSkillsDir, getGlobalSkillDir, getLocalSkillDir } from "../utils/skills";

export type SkillInstallMode = "global" | "local";

export interface SkillInstallResult {
  success: boolean;
  message: string;
  targetDir: string;
  installed: string[];
  skipped: string[];
}

export function installSkills(mode: SkillInstallMode): SkillInstallResult {
  const targetDir = mode === "global" ? getGlobalSkillDir() : getLocalSkillDir();
  const installed: string[] = [];
  const skipped: string[] = [];

  try {
    const sourceDir = getBundledSkillsDir();
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    ensureDir(targetDir);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      const sourcePath = path.join(sourceDir, skillName);
      const targetPath = path.join(targetDir, skillName);

      if (fs.existsSync(targetPath)) {
        skipped.push(skillName);
        continue;
      }

      fs.cpSync(sourcePath, targetPath, { recursive: true });
      installed.push(skillName);
    }

    const summary = `Skills ${mode} install: ${installed.length} installed${skipped.length ? `, ${skipped.length} skipped` : ""} (${targetDir})`;
    return {
      success: true,
      message: summary,
      targetDir,
      installed,
      skipped
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to install skills (${mode}): ${message}`,
      targetDir,
      installed,
      skipped
    };
  }
}
