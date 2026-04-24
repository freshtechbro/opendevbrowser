#!/usr/bin/env node
/**
 * Syncs extension version metadata with root package.json version.
 * Run via: npm run extension:sync
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function syncVersionFile(filePath, version) {
  const json = readJson(filePath);
  if (json.version === version) {
    return false;
  }
  json.version = version;
  writeJson(filePath, json);
  return true;
}

function syncPackageLockVersion(filePath, version) {
  const json = readJson(filePath);
  let changed = false;
  if (json.version !== version) {
    json.version = version;
    changed = true;
  }
  if (json.packages?.[""]?.version !== version) {
    json.packages = {
      ...json.packages,
      "": {
        ...json.packages?.[""],
        version
      }
    };
    changed = true;
  }
  if (changed) {
    writeJson(filePath, json);
  }
  return changed;
}

export function syncExtensionVersion(repoRoot = rootDir) {
  const packageJsonPath = join(repoRoot, "package.json");
  const manifestPath = join(repoRoot, "extension", "manifest.json");
  const extensionPackagePath = join(repoRoot, "extension", "package.json");
  const packageLockPath = join(repoRoot, "package-lock.json");

  const pkg = readJson(packageJsonPath);
  const version = String(pkg.version ?? "");
  if (!version) {
    throw new Error("package.json version is missing.");
  }

  const changedFiles = [];
  if (syncVersionFile(manifestPath, version)) {
    changedFiles.push("extension/manifest.json");
  }
  if (syncVersionFile(extensionPackagePath, version)) {
    changedFiles.push("extension/package.json");
  }
  if (syncPackageLockVersion(packageLockPath, version)) {
    changedFiles.push("package-lock.json");
  }

  return {
    version,
    changedFiles
  };
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const result = syncExtensionVersion();
  if (result.changedFiles.length > 0) {
    console.log(`Synced ${result.changedFiles.join(", ")} to ${result.version}`);
  } else {
    console.log(`Extension version metadata already at ${result.version}`);
  }
}
