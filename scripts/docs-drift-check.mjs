#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function extractCountFromSource(pattern, source, label) {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Unable to parse ${label}.`);
  }
  const values = [...match[1].matchAll(/"([^"]+)"/g)];
  return values.length;
}

export function getSurfaceCounts() {
  const argsSource = read("src/cli/args.ts");
  const toolsSource = read("src/tools/index.ts");

  const commandCount = extractCountFromSource(/export const CLI_COMMANDS = \[(.*?)\] as const;/s, argsSource, "CLI commands");
  const toolCount = [...toolsSource.matchAll(/\s(opendevbrowser_[a-z_]+):/g)].length;

  return {
    commandCount,
    toolCount
  };
}

function parseDocCount(regex, source, label) {
  const match = source.match(regex);
  if (!match) {
    throw new Error(`Unable to parse ${label}.`);
  }
  return Number.parseInt(match[1], 10);
}

export function runDocsDriftChecks() {
  const packageJson = JSON.parse(read("package.json"));
  const version = String(packageJson.version ?? "");
  if (!version) {
    throw new Error("package.json version is missing.");
  }

  const cliDoc = read("docs/CLI.md");
  const onboardingDoc = read("docs/FIRST_RUN_ONBOARDING.md");
  const surfaceDoc = read("docs/SURFACE_REFERENCE.md");

  const { commandCount, toolCount } = getSurfaceCounts();

  const checks = [];

  checks.push({
    id: "doc.cli.no_stale_tgz_ref",
    ok: !/opendevbrowser-0\.0\.15\.tgz/.test(cliDoc),
    detail: "docs/CLI.md must not reference old local package artifacts."
  });

  checks.push({
    id: "doc.onboarding.no_stale_tgz_ref",
    ok: !/opendevbrowser-0\.0\.15\.tgz/.test(onboardingDoc),
    detail: "docs/FIRST_RUN_ONBOARDING.md must not reference old local package artifacts."
  });

  const surfaceCommandCount = parseDocCount(/## CLI Command Inventory \((\d+)\)/, surfaceDoc, "surface CLI command count");
  const surfaceToolCount = parseDocCount(/## Tool Inventory \((\d+)\)/, surfaceDoc, "surface tool count");
  checks.push({
    id: "doc.surface.command_count_matches_source",
    ok: surfaceCommandCount === commandCount,
    detail: `docs/SURFACE_REFERENCE.md command count=${surfaceCommandCount}, source=${commandCount}`
  });
  checks.push({
    id: "doc.surface.tool_count_matches_source",
    ok: surfaceToolCount === toolCount,
    detail: `docs/SURFACE_REFERENCE.md tool count=${surfaceToolCount}, source=${toolCount}`
  });

  const cliCommandsCount = parseDocCount(/- Total commands: `([0-9]+)`\./, cliDoc, "CLI docs command count");
  const cliToolsCount = parseDocCount(/- Total tools: `([0-9]+)`/, cliDoc, "CLI docs tool count");
  checks.push({
    id: "doc.cli.command_count_matches_source",
    ok: cliCommandsCount === commandCount,
    detail: `docs/CLI.md command count=${cliCommandsCount}, source=${commandCount}`
  });
  checks.push({
    id: "doc.cli.tool_count_matches_source",
    ok: cliToolsCount === toolCount,
    detail: `docs/CLI.md tool count=${cliToolsCount}, source=${toolCount}`
  });

  checks.push({
    id: "doc.cli.current_package_version_ref",
    ok: cliDoc.includes(`opendevbrowser-${version}.tgz`),
    detail: `docs/CLI.md should reference opendevbrowser-${version}.tgz`
  });

  checks.push({
    id: "doc.onboarding.current_package_version_ref",
    ok: onboardingDoc.includes(`opendevbrowser-${version}.tgz`),
    detail: `docs/FIRST_RUN_ONBOARDING.md should reference opendevbrowser-${version}.tgz`
  });

  const failed = checks.filter((check) => !check.ok);

  return {
    ok: failed.length === 0,
    version,
    source: {
      commandCount,
      toolCount
    },
    checks,
    failed
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runDocsDriftChecks();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}
