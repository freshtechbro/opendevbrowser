import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const PACKAGE_NAME = "opendevbrowser";
const SKILL_DIR_NAME = "skill";

let cachedPackageRoot: string | null = null;

function findPackageRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { name?: string };
        if (parsed.name === PACKAGE_NAME) {
          return current;
        }
      } catch {
        void 0;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error("Unable to locate opendevbrowser package root for skill installation.");
}

export function getPackageRoot(): string {
  if (cachedPackageRoot) return cachedPackageRoot;
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  cachedPackageRoot = findPackageRoot(moduleDir);
  return cachedPackageRoot;
}

export function getBundledSkillsDir(): string {
  const skillsDir = path.join(getPackageRoot(), "skills");
  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Bundled skills directory not found at ${skillsDir}`);
  }
  return skillsDir;
}

export function getGlobalSkillDir(): string {
  const configDir = process.env.OPENCODE_CONFIG_DIR
    || path.join(os.homedir(), ".config", "opencode");
  return path.join(configDir, SKILL_DIR_NAME);
}

export function getLocalSkillDir(): string {
  return path.join(process.cwd(), ".opencode", SKILL_DIR_NAME);
}
