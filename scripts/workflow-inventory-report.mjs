#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkflowInventory } from "./shared/workflow-inventory.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    out: null,
    markdownOut: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--out=")) {
      options.out = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--markdown-out") {
      options.markdownOut = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--markdown-out=")) {
      options.markdownOut = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--help") {
      console.log([
        "Usage: node scripts/workflow-inventory-report.mjs [options]",
        "",
        "Options:",
        "  --out <path>           Write the JSON inventory artifact",
        "  --markdown-out <path>  Write a Markdown workflow surface map",
        "  --help                 Show help"
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function renderList(items) {
  return items.map((item) => `- \`${item}\``).join("\n");
}

export function renderWorkflowSurfaceMapMarkdown(inventory) {
  const { coverage, cliCommands, toolFamilies, scenarios } = inventory;
  const automatedScenarios = scenarios.filter((scenario) => scenario.executionPolicy === "automated");
  const guardedScenarios = scenarios.filter((scenario) => scenario.executionPolicy !== "automated");
  const cliFamilies = [...new Map(cliCommands.map((item) => [item.family, item.familyLabel])).entries()];

  return [
    "# Workflow Surface Map",
    "",
    "Status: active",
    `Last updated: ${inventory.generatedAt.slice(0, 10)}`,
    "",
    "Canonical code-derived workflow inventory across CLI commands, tool surfaces, and executable validation scenarios.",
    "",
    "Discoverability note: [SURFACE_DISCOVERABILITY_AND_NEXT_STEP_GUIDANCE_INVESTIGATION_2026-04-16.md](./SURFACE_DISCOVERABILITY_AND_NEXT_STEP_GUIDANCE_INVESTIGATION_2026-04-16.md) records the help-surface cross-link rationale; this file remains inventory-first.",
    "",
    "## Coverage summary",
    "",
    `- CLI commands: \`${coverage.commandCount}\``,
    `- Tool surfaces: \`${coverage.toolCount}\``,
    `- CLI<->tool pairs: \`${coverage.cliToolPairCount}\``,
    `- CLI-only commands: \`${coverage.cliOnlyCommandCount}\``,
    `- Tool-only surfaces: \`${coverage.toolOnlySurfaceCount}\``,
    `- Provider ids in live scenario source: \`${coverage.providerIdCount}\``,
    "",
    "## CLI command families",
    "",
    ...cliFamilies.map(([familyId, label]) => {
      const members = cliCommands.filter((item) => item.family === familyId).map((item) => item.label);
      return `### ${label}\n\n${renderList(members)}`;
    }),
    "",
    "## Tool families",
    "",
    ...toolFamilies.map((family) => `### ${family.label}\n\n${renderList(family.members)}`),
    "",
    "## Automated validation scenarios",
    "",
    "| ID | Entry path | Primary task | Secondary task |",
    "| --- | --- | --- | --- |",
    ...automatedScenarios.map((scenario) => `| \`${scenario.id}\` | \`${scenario.entryPath}\` | ${scenario.primaryTask} | ${scenario.secondaryTask} |`),
    "",
    "## Guarded / non-CLI scenarios",
    "",
    "| ID | Execution policy | Notes |",
    "| --- | --- | --- |",
    ...guardedScenarios.map((scenario) => `| \`${scenario.id}\` | \`${scenario.executionPolicy}\` | ${scenario.primaryTask} |`),
    "",
    "## CLI-only commands",
    "",
    renderList(coverage.cliOnlyCommands),
    "",
    "## Tool-only surfaces",
    "",
    renderList(coverage.toolOnlySurfaces)
  ].join("\n");
}

export function runWorkflowInventoryReport(options) {
  const inventory = buildWorkflowInventory(ROOT);
  const payload = JSON.stringify(inventory, null, 2);
  if (options.out) {
    writeFile(path.resolve(ROOT, options.out), payload);
  }
  if (options.markdownOut) {
    writeFile(path.resolve(ROOT, options.markdownOut), `${renderWorkflowSurfaceMapMarkdown(inventory)}\n`);
  }
  if (!options.out && !options.markdownOut) {
    process.stdout.write(`${payload}\n`);
    return inventory;
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    out: options.out ? path.resolve(ROOT, options.out) : null,
    markdownOut: options.markdownOut ? path.resolve(ROOT, options.markdownOut) : null,
    counts: inventory.coverage
  }, null, 2));
  process.stdout.write("\n");
  return inventory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkflowInventoryReport(parseArgs(process.argv.slice(2)));
}
