#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST_BIN = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");

export const RELEASE_GATE_GROUPS = [
  {
    id: "1",
    name: "provider-matrix-contracts",
    files: [
      "tests/provider-live-scenarios.test.ts",
      "tests/provider-live-matrix-script.test.ts"
    ]
  },
  {
    id: "2",
    name: "live-regression-gate-semantics",
    files: [
      "tests/live-regression-release-gate.test.ts"
    ]
  },
  {
    id: "3",
    name: "cli-help-parity",
    files: [
      "tests/cli-help-parity.test.ts"
    ]
  },
  {
    id: "4",
    name: "docs-and-zombie-audits",
    files: [
      "tests/docs-drift-check.test.ts",
      "tests/audit-zombie-files.test.ts"
    ]
  },
  {
    id: "5",
    name: "chrome-store-compliance",
    files: [
      "tests/chrome-store-compliance-check.test.ts"
    ]
  }
];

export function parseGroupArgs(argv) {
  const options = {
    group: null,
    list: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (arg === "--group") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--group requires a numeric group id.");
      }
      options.group = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--group=")) {
      const value = arg.slice("--group=".length);
      if (!value) {
        throw new Error("--group requires a numeric group id.");
      }
      options.group = value;
      continue;
    }
    if (arg === "--help") {
      options.list = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function resolveSelectedGroups(options, groups = RELEASE_GATE_GROUPS) {
  if (options.group === null) {
    return groups;
  }
  const match = groups.find((group) => group.id === String(options.group));
  if (!match) {
    throw new Error(`Unknown release-gate group: ${options.group}`);
  }
  return [match];
}

function printGroupList(groups = RELEASE_GATE_GROUPS) {
  console.log("Release-gate test groups:");
  for (const group of groups) {
    console.log(`${group.id}. ${group.name}`);
    for (const file of group.files) {
      console.log(`   - ${file}`);
    }
  }
}

function runGroup(group) {
  const args = [VITEST_BIN, "run", ...group.files, "--coverage=false"];
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit"
  });
  const durationMs = Date.now() - startedAt;
  return {
    id: group.id,
    name: group.name,
    status: result.status ?? 1,
    durationMs
  };
}

export function runSelectedGroups(groups) {
  const results = [];
  for (const group of groups) {
    console.log(`\n[release-gate] running group ${group.id}: ${group.name}`);
    const result = runGroup(group);
    results.push(result);
    if (result.status !== 0) {
      break;
    }
  }
  return results;
}

function printSummary(results) {
  console.log("\n[release-gate] summary");
  for (const result of results) {
    const seconds = (result.durationMs / 1000).toFixed(2);
    const label = result.status === 0 ? "PASS" : "FAIL";
    console.log(`- group ${result.id} (${result.name}): ${label} (${seconds}s)`);
  }
  const firstFailure = results.find((result) => result.status !== 0);
  if (firstFailure) {
    console.log(`\n[release-gate] rerun only failed group: npm run test:release-gate:g${firstFailure.id}`);
  }
}

function main() {
  const options = parseGroupArgs(process.argv.slice(2));
  if (options.list) {
    printGroupList();
    return;
  }

  const selected = resolveSelectedGroups(options);
  const results = runSelectedGroups(selected);
  printSummary(results);

  if (results.some((result) => result.status !== 0)) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

