#!/usr/bin/env node
/**
 * Verify version alignment between package.json and extension/manifest.json.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const pkgPath = join(rootDir, "package.json");
const manifestPath = join(rootDir, "extension", "manifest.json");
const extensionPackagePath = join(rootDir, "extension", "package.json");
const packageLockPath = join(rootDir, "package-lock.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

export function readVersionAlignment(repoRoot = rootDir) {
  const pkg = readJson(join(repoRoot, "package.json"));
  const manifest = readJson(join(repoRoot, "extension", "manifest.json"));
  const extensionPackage = readJson(join(repoRoot, "extension", "package.json"));
  const packageLock = readJson(join(repoRoot, "package-lock.json"));
  return {
    packageJson: String(pkg.version ?? ""),
    manifest: String(manifest.version ?? ""),
    extensionPackage: String(extensionPackage.version ?? ""),
    packageLock: String(packageLock.version ?? ""),
    packageLockRoot: String(packageLock.packages?.[""]?.version ?? "")
  };
}

export function verifyVersionAlignment(repoRoot = rootDir) {
  const versions = readVersionAlignment(repoRoot);
  const pkgVersion = versions.packageJson;
  if (!pkgVersion) {
    throw new Error("package.json version is missing.");
  }

  if (!versions.manifest) {
    throw new Error("extension/manifest.json version is missing.");
  }

  if (!versions.extensionPackage) {
    throw new Error("extension/package.json version is missing.");
  }

  if (!versions.packageLock) {
    throw new Error("package-lock.json version is missing.");
  }

  if (!versions.packageLockRoot) {
    throw new Error("package-lock.json root package version is missing.");
  }

  if (pkgVersion !== versions.manifest) {
    throw new Error(`Version mismatch: package.json=${pkgVersion} manifest.json=${versions.manifest}`);
  }

  if (pkgVersion !== versions.extensionPackage) {
    throw new Error(`Version mismatch: package.json=${pkgVersion} extension/package.json=${versions.extensionPackage}`);
  }

  if (versions.manifest !== versions.extensionPackage) {
    throw new Error(`Version mismatch: extension/manifest.json=${versions.manifest} extension/package.json=${versions.extensionPackage}`);
  }

  if (pkgVersion !== versions.packageLock) {
    throw new Error(`Version mismatch: package.json=${pkgVersion} package-lock.json=${versions.packageLock}`);
  }

  if (pkgVersion !== versions.packageLockRoot) {
    throw new Error(`Version mismatch: package.json=${pkgVersion} package-lock.json#packages[\"\"]=${versions.packageLockRoot}`);
  }

  return pkgVersion;
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    const version = verifyVersionAlignment();
    console.log(`Version check passed: ${version}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
