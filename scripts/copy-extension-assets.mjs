import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const copyOptionalFile = (sourcePath, destinationPath) => {
  if (!existsSync(sourcePath)) return false;
  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
  return true;
};

const copyRequiredFile = (sourcePath, destinationPath) => {
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing required extension asset: ${sourcePath}`);
  }
  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
};

const copiedAnnotateCss = copyOptionalFile(
  resolve("extension", "src", "annotate-content.css"),
  resolve("extension", "dist", "annotate-content.css")
);

const iconSizes = [16, 32, 48, 128];
for (const size of iconSizes) {
  const filename = `icon${size}.png`;
  copyRequiredFile(
    resolve("assets", "extension-icons", filename),
    resolve("extension", "icons", filename)
  );
}

if (copiedAnnotateCss) {
  console.log("Synced extension annotate stylesheet.");
}
console.log("Synced extension icons from assets/extension-icons to extension/icons.");
