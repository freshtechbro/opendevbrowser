#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function hasToken(text, value) {
  return text.includes(`\`${value}\``) || text.includes(`**${value}**`);
}

function readPngSize(relativePath) {
  const buffer = fs.readFileSync(path.join(ROOT, relativePath));
  const signature = buffer.subarray(0, 8);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.equals(pngSignature)) {
    throw new Error(`Invalid PNG signature: ${relativePath}`);
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function checkAssetDimensions(expectedDimensions) {
  const checks = [];
  for (const [relativePath, expected] of Object.entries(expectedDimensions)) {
    const actual = readPngSize(relativePath);
    const ok = actual.width === expected.width && actual.height === expected.height;
    checks.push({
      id: `asset.${relativePath.replaceAll("/", ".")}`,
      ok,
      detail: `${relativePath} expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`
    });
  }
  return checks;
}

export function runChromeStoreComplianceCheck() {
  const manifest = readJson("extension/manifest.json");
  const listing = read("extension/store-assets/LISTING.md");
  const privacy = read("docs/privacy.md");
  const extensionDoc = read("docs/EXTENSION.md");

  const checks = [];

  checks.push({
    id: "manifest.mv3",
    ok: manifest.manifest_version === 3,
    detail: `manifest_version=${manifest.manifest_version}`
  });

  checks.push({
    id: "manifest.version_exists",
    ok: typeof manifest.version === "string" && manifest.version.length > 0,
    detail: `version=${manifest.version ?? "missing"}`
  });

  checks.push({
    id: "manifest.permissions_exists",
    ok: Array.isArray(manifest.permissions) && manifest.permissions.length > 0,
    detail: `permissions=${Array.isArray(manifest.permissions) ? manifest.permissions.length : "missing"}`
  });

  checks.push({
    id: "manifest.host_permissions_exists",
    ok: Array.isArray(manifest.host_permissions) && manifest.host_permissions.length > 0,
    detail: `host_permissions=${Array.isArray(manifest.host_permissions) ? manifest.host_permissions.length : "missing"}`
  });

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of permissions) {
    checks.push({
      id: `permissions.listing.${permission}`,
      ok: hasToken(listing, permission),
      detail: `extension/store-assets/LISTING.md must justify ${permission}`
    });
    checks.push({
      id: `permissions.privacy.${permission}`,
      ok: hasToken(privacy, permission),
      detail: `docs/privacy.md must justify ${permission}`
    });
  }

  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  for (const hostPermission of hostPermissions) {
    checks.push({
      id: `host_permissions.privacy.${hostPermission}`,
      ok: hasToken(privacy, hostPermission),
      detail: `docs/privacy.md must justify ${hostPermission}`
    });
  }

  checks.push({
    id: "docs.extension.restricted_urls",
    ok: extensionDoc.includes("chrome://") && extensionDoc.toLowerCase().includes("chrome web store"),
    detail: "docs/EXTENSION.md must document restricted URL behavior."
  });

  checks.push({
    id: "manifest.command.toggle_annotation",
    ok: typeof manifest.commands?.["toggle-annotation"]?.description === "string",
    detail: "manifest command toggle-annotation must exist with description."
  });

  checks.push(...checkAssetDimensions({
    "extension/icons/icon16.png": { width: 16, height: 16 },
    "extension/icons/icon32.png": { width: 32, height: 32 },
    "extension/icons/icon48.png": { width: 48, height: 48 },
    "extension/icons/icon128.png": { width: 128, height: 128 },
    "extension/store-assets/icon-store-128.png": { width: 128, height: 128 },
    "extension/store-assets/promo-small-440x280.png": { width: 440, height: 280 },
    "extension/store-assets/promo-marquee-1400x560.png": { width: 1400, height: 560 },
    "extension/store-assets/screenshot-automation-demo.png": { width: 1280, height: 800 },
    "extension/store-assets/screenshot-popup-connected.png": { width: 1280, height: 800 },
    "extension/store-assets/screenshot-popup-disconnected.png": { width: 1280, height: 800 }
  }));

  const failed = checks.filter((check) => !check.ok);

  return {
    ok: failed.length === 0,
    manifestVersion: manifest.manifest_version,
    extensionVersion: manifest.version,
    checks,
    failed
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runChromeStoreComplianceCheck();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}
