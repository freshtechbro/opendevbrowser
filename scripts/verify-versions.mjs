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

const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const extensionPackage = JSON.parse(readFileSync(extensionPackagePath, "utf-8"));

const pkgVersion = String(pkg.version ?? "");
const manifestVersion = String(manifest.version ?? "");
const extensionPackageVersion = String(extensionPackage.version ?? "");

if (!pkgVersion) {
  console.error("package.json version is missing.");
  process.exit(1);
}

if (!manifestVersion) {
  console.error("extension/manifest.json version is missing.");
  process.exit(1);
}

if (!extensionPackageVersion) {
  console.error("extension/package.json version is missing.");
  process.exit(1);
}

if (pkgVersion !== manifestVersion) {
  console.error(`Version mismatch: package.json=${pkgVersion} manifest.json=${manifestVersion}`);
  process.exit(1);
}

if (pkgVersion !== extensionPackageVersion) {
  console.error(`Version mismatch: package.json=${pkgVersion} extension/package.json=${extensionPackageVersion}`);
  process.exit(1);
}

if (manifestVersion !== extensionPackageVersion) {
  console.error(`Version mismatch: extension/manifest.json=${manifestVersion} extension/package.json=${extensionPackageVersion}`);
  process.exit(1);
}

console.log(`Version check passed: ${pkgVersion}`);
