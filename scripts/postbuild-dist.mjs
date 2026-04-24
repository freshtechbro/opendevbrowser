import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = resolve("dist");
const DAEMON_FINGERPRINT_FILE = "daemon-fingerprint.json";

const canonicalizeGeneratedName = (name) => (
  name
    .replace(/ \d+(?=\.d\.ts(?:\.map)?$)/, "")
    .replace(/ \d+(?=\.js(?:\.map)?$)/, "")
    .replace(/(?<=\.js) \d+(?=\.map$)/, "")
);

export const normalizeGeneratedDir = (dir) => {
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

function resolveDaemonFingerprintSources(rootDistDir, currentDir = rootDistDir) {
  return readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        return resolveDaemonFingerprintSources(rootDistDir, entryPath);
      }
      if (!entry.isFile() || !entry.name.endsWith(".js")) {
        return [];
      }
      return [entryPath];
    });
}

function buildDaemonFingerprint(rootDistDir, sourcePaths) {
  const hash = createHash("sha256");
  for (const sourcePath of sourcePaths) {
    hash.update(relative(rootDistDir, sourcePath));
    hash.update("\n");
    hash.update(readFileSync(sourcePath));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function writeDaemonFingerprint(rootDistDir = distDir) {
  const sourcePaths = resolveDaemonFingerprintSources(rootDistDir);
  if (sourcePaths.length === 0) {
    return null;
  }
  const fingerprint = buildDaemonFingerprint(rootDistDir, sourcePaths);
  const targetPath = resolve(rootDistDir, DAEMON_FINGERPRINT_FILE);
  writeFileSync(targetPath, `${JSON.stringify({ fingerprint }, null, 2)}\n`, "utf8");
  chmodSync(targetPath, statSync(sourcePaths[0]).mode);
  return fingerprint;
}

export function postbuildDist(rootDistDir = distDir) {
  normalizeGeneratedDir(rootDistDir);
  normalizeGeneratedDir(resolve(rootDistDir, "cli"));

  for (const [sourceName, targetName] of [
    ["index.js", "opendevbrowser.js"],
    ["index.js.map", "opendevbrowser.js.map"],
    ["index.d.ts", "opendevbrowser.d.ts"],
    ["index.d.ts.map", "opendevbrowser.d.ts.map"]
  ]) {
    const sourcePath = resolve(rootDistDir, sourceName);
    const targetPath = resolve(rootDistDir, targetName);
    if (!existsSync(sourcePath)) {
      continue;
    }
    copyFileSync(sourcePath, targetPath);
    chmodSync(targetPath, statSync(sourcePath).mode);
  }

  return writeDaemonFingerprint(rootDistDir);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  postbuildDist();
}
