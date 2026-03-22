import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const PACKAGE_NAME = "opendevbrowser";
const SKILLS_DIR_NAME = "skills";

let cachedPackageRoot: string | null = null;

function findPackageRoot(startDir: string): string | null {
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

  return null;
}

export function getPackageRoot(): string {
  if (cachedPackageRoot) {
    return cachedPackageRoot;
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = findPackageRoot(moduleDir);
  if (!packageRoot) {
    throw new Error(`Unable to locate ${PACKAGE_NAME} package root.`);
  }
  cachedPackageRoot = packageRoot;
  return cachedPackageRoot;
}

export function findBundledSkillsDir(): string | null {
  try {
    const skillsDir = path.join(getPackageRoot(), SKILLS_DIR_NAME);
    return fs.existsSync(skillsDir) ? skillsDir : null;
  } catch {
    return null;
  }
}

export function getBundledSkillsDir(): string {
  const skillsDir = findBundledSkillsDir();
  if (!skillsDir) {
    throw new Error(`Bundled skills directory not found in ${PACKAGE_NAME} package.`);
  }
  return skillsDir;
}
