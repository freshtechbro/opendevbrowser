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
  console.warn("[opendevbrowser] package postinstall skipped: built installer entry missing.");
  process.exit(0);
}

try {
  const installer = await import(pathToFileURL(entryPath).href);
  if (typeof installer.runPackagePostinstall !== "function") {
    console.warn("[opendevbrowser] package postinstall skipped: built installer entry missing runPackagePostinstall export.");
    process.exit(0);
  }

  const result = installer.runPackagePostinstall();
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  for (const warning of warnings) {
    console.warn(`[opendevbrowser] ${warning}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[opendevbrowser] package postinstall failed: ${message}`);
}
