import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");

if (process.env.OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC === "1") {
  process.exit(0);
}

if (fs.existsSync(path.join(packageRoot, ".git"))) {
  process.exit(0);
}

const entryPath = path.join(packageRoot, "dist", "cli", "installers", "postinstall-skill-sync.js");

if (!fs.existsSync(entryPath)) {
  console.warn("[opendevbrowser] postinstall skill sync skipped: built installer entry missing.");
  process.exit(0);
}

try {
  const { runPostinstallSkillSync } = await import(pathToFileURL(entryPath).href);
  const result = runPostinstallSkillSync();

  if (!result.success || result.skipped) {
    console.warn(`[opendevbrowser] ${result.message}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[opendevbrowser] postinstall skill sync failed: ${message}`);
}
