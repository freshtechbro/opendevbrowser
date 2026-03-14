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

export function syncExtensionVersion(repoRoot = rootDir) {
  const packageJsonPath = join(repoRoot, "package.json");
  const manifestPath = join(repoRoot, "extension", "manifest.json");
  const extensionPackagePath = join(repoRoot, "extension", "package.json");

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
