#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SOCIAL_PLATFORMS_SMOKE = ["x", "facebook", "linkedin", "instagram", "youtube"];
const SOCIAL_PLATFORMS_FULL = ["x", "reddit", "bluesky", "facebook", "linkedin", "instagram", "tiktok", "threads", "youtube"];

const SHOPPING_PROVIDERS_SMOKE = ["shopping/amazon", "shopping/costco"];
const SHOPPING_PROVIDERS_FULL = [
  "shopping/amazon",
  "shopping/walmart",
  "shopping/bestbuy",
  "shopping/ebay",
  "shopping/target",
  "shopping/costco",
  "shopping/macys",
  "shopping/aliexpress",
  "shopping/temu",
  "shopping/newegg",
  "shopping/others"
];

function uniqSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function socialPlatformsForMode(smoke) {
  return smoke ? [...SOCIAL_PLATFORMS_SMOKE] : [...SOCIAL_PLATFORMS_FULL];
}

export function shoppingProvidersForMode(smoke) {
  return smoke ? [...SHOPPING_PROVIDERS_SMOKE] : [...SHOPPING_PROVIDERS_FULL];
}

function readSourceFile(relativePath, rootDir = ROOT) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function parseSocialProviderIdsFromSource(rootDir = ROOT) {
  const source = readSourceFile("src/providers/social/index.ts", rootDir);
  const names = [...source.matchAll(/case\s+"([a-z]+)"\s*:/g)].map((match) => match[1]);
  return uniqSorted(names.map((name) => `social/${name}`));
}

function parseShoppingProviderIdsFromSource(rootDir = ROOT) {
  const source = readSourceFile("src/providers/shopping/index.ts", rootDir);
  const ids = [...source.matchAll(/id:\s*"(shopping\/[a-z]+)"/g)].map((match) => match[1]);
  return uniqSorted(ids);
}

export function expectedProviderIdsFromSource(rootDir = ROOT) {
  const web = ["web/default"];
  const community = ["community/default"];
  const social = parseSocialProviderIdsFromSource(rootDir);
  const shopping = parseShoppingProviderIdsFromSource(rootDir);

  const all = uniqSorted([...web, ...community, ...social, ...shopping]);

  return {
    web,
    community,
    social,
    shopping,
    all
  };
}

export function scenarioProviderIds({
  smoke,
  runAuthGated,
  runHighFriction,
  releaseGate
}) {
  const social = socialPlatformsForMode(smoke).map((name) => `social/${name}`);
  const shopping = shoppingProvidersForMode(smoke).filter((provider) => {
    if (releaseGate) return true;
    if (!runHighFriction && provider === "shopping/bestbuy") return false;
    if (!runAuthGated && (provider === "shopping/costco" || provider === "shopping/macys")) return false;
    return true;
  });

  const web = ["web/default"];
  const community = ["community/default"];
  const all = uniqSorted([...web, ...community, ...social, ...shopping]);

  return {
    web,
    community,
    social,
    shopping,
    all
  };
}

export function buildProviderCoverageSummary(options = {}) {
  const expected = expectedProviderIdsFromSource();
  const scenarios = scenarioProviderIds(options);

  const missing = expected.all.filter((providerId) => !scenarios.all.includes(providerId));
  const extra = scenarios.all.filter((providerId) => !expected.all.includes(providerId));

  return {
    expected,
    scenarios,
    missingProviderIds: missing,
    extraScenarioProviderIds: extra,
    ok: missing.length === 0 && extra.length === 0
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const smoke = process.argv.includes("--smoke");
  const releaseGate = process.argv.includes("--release-gate");
  const runAuthGated = releaseGate || process.argv.includes("--include-auth-gated");
  const runHighFriction = releaseGate || process.argv.includes("--include-high-friction");

  const summary = buildProviderCoverageSummary({
    smoke,
    runAuthGated,
    runHighFriction,
    releaseGate
  });

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}
