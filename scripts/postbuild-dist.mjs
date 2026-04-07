import { chmodSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve("dist");

const canonicalizeGeneratedName = (name) => (
  name
    .replace(/ \d+(?=\.d\.ts(?:\.map)?$)/, "")
    .replace(/ \d+(?=\.js(?:\.map)?$)/, "")
    .replace(/(?<=\.js) \d+(?=\.map$)/, "")
);

const normalizeGeneratedDir = (dir) => {
  const groups = new Map();

  for (const entry of readdirSync(dir)) {
    const absolutePath = resolve(dir, entry);
    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      continue;
    }
    const canonicalName = canonicalizeGeneratedName(entry);
    const group = groups.get(canonicalName) ?? [];
    group.push({
      name: entry,
      path: absolutePath,
      mtimeMs: stats.mtimeMs
    });
    groups.set(canonicalName, group);
  }

  for (const [canonicalName, variants] of groups.entries()) {
    const canonicalPath = resolve(dir, canonicalName);
    const freshestVariant = [...variants].sort((left, right) => (
      right.mtimeMs - left.mtimeMs
      || left.name.length - right.name.length
      || left.name.localeCompare(right.name)
    ))[0];

    if (!freshestVariant) {
      continue;
    }
    if (freshestVariant.path === canonicalPath && existsSync(canonicalPath)) {
      continue;
    }

    copyFileSync(freshestVariant.path, canonicalPath);
    chmodSync(canonicalPath, statSync(freshestVariant.path).mode);
  }
};

normalizeGeneratedDir(distDir);
normalizeGeneratedDir(resolve(distDir, "cli"));

for (const [sourceName, targetName] of [
  ["index.js", "opendevbrowser.js"],
  ["index.js.map", "opendevbrowser.js.map"],
  ["index.d.ts", "opendevbrowser.d.ts"],
  ["index.d.ts.map", "opendevbrowser.d.ts.map"]
]) {
  const sourcePath = resolve(distDir, sourceName);
  const targetPath = resolve(distDir, targetName);
  if (!existsSync(sourcePath)) {
    continue;
  }
  copyFileSync(sourcePath, targetPath);
  chmodSync(targetPath, statSync(sourcePath).mode);
}
