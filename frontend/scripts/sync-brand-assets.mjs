import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const sourceDir = path.join(repoRoot, "assets");
const targetDir = path.join(frontendRoot, "public", "brand");

async function main() {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
  console.log(`Synced assets from ${sourceDir} to ${targetDir}`);
}

main().catch((error) => {
  console.error("Asset sync failed", error);
  process.exitCode = 1;
});
