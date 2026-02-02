import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve("extension", "src", "annotate-content.css");
const destDir = resolve("extension", "dist");
const dest = resolve(destDir, "annotate-content.css");

if (!existsSync(src)) {
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
