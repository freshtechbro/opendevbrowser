#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = "prompt-exports/optimize-workflow-artifacts-runs.md";
const TEST_PATH = "tests/providers-workflow-baseline.test.ts";
const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

const parseOutPath = (args) => {
  const outIndex = args.indexOf("--out");
  if (outIndex === -1) return DEFAULT_OUT;
  const value = args[outIndex + 1];
  if (!value || value.trim() === "") {
    throw new Error("--out requires a non-empty path.");
  }
  return value;
};

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.stdio ?? "pipe",
    env: options.env ?? process.env,
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  return result;
};

const getCommit = () => {
  const result = runCommand("git", ["rev-parse", "--short", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : "unavailable";
};

const formatDuration = (metrics, workflow) => {
  const metric = metrics.find((entry) => entry.workflow === workflow);
  return metric ? String(Math.round(metric.durationMs)) : "";
};

const artifactSummary = (metrics) => metrics
  .map((entry) => `${entry.workflow}=${entry.namespace}:${entry.responsePathKey}:${entry.fileCount} files`)
  .join("; ");

const failureSummary = (failures) => failures.map((failure) => [
  `${failure.workflow} invalid target`,
  `namespace=${failure.expectedNamespace}`,
  `dirExists=${failure.artifactDirectoryExists}`,
  typeof failure.auxiliaryFetchCalls === "number" ? `auxFetchCalls=${failure.auxiliaryFetchCalls}` : null,
  `error=${failure.errorMessage}`
].filter(Boolean).join("; ")).join(" / ");

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

const makeBaselineRow = (suite, commit, commandText) => {
  const notes = [
    `Node ${process.version}`,
    `${process.platform}/${process.arch}`,
    `fixtureNow=${suite.generatedAt}`,
    `root=${suite.artifactRoot}`,
    "duration uses local fixture wall time"
  ].join("; ");
  const cells = [
    DATE_FORMAT.format(new Date()).replace(",", ""),
    commit,
    commandText,
    formatDuration(suite.metrics, "research"),
    formatDuration(suite.metrics, "shopping"),
    formatDuration(suite.metrics, "product-video"),
    formatDuration(suite.metrics, "inspiredesign"),
    artifactSummary(suite.metrics),
    failureSummary(suite.failureArtifacts),
    notes
  ];
  return `| ${cells.map(escapeCell).join(" | ")} |`;
};

const scaffold = `# Optimize Workflow Artifacts Runs

## Baseline
| Date | Commit | Command | Research ms | Shopping ms | Product-video ms | Inspiredesign ms | Artifact root result | Failure artifact result | Notes |
|---|---|---:|---:|---:|---:|---|---|---|---|

## Candidate Runs
| Date | Commit | Candidate | Command | Delta | Risk observed | Pass/Fail | Notes |
|---|---|---|---|---:|---|---|---|

## Real Workflow Validation
| Date | Workflow | Command | Artifact path | Visual proof | Result | Notes |
|---|---|---|---|---|---|---|
`;

export const readOrCreateScoreboard = async (outputPath) => {
  try {
    return await readFile(outputPath, "utf8");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
    return scaffold;
  }
};

const insertBaselineRow = (content, row, commit, commandText) => {
  const identity = `| ${escapeCell(commit)} | ${escapeCell(commandText)} |`;
  const deduped = content
    .split("\n")
    .filter((line) => !line.includes(identity))
    .join("\n");
  const heading = "\n## Candidate Runs";
  if (deduped.includes(heading)) {
    return deduped.replace(heading, `\n${row}\n${heading}`);
  }
  return `${deduped.trimEnd()}\n${row}\n`;
};

const runBaseline = async () => {
  const outArg = parseOutPath(process.argv.slice(2));
  const outputPath = path.resolve(ROOT, outArg);
  const outputDir = path.dirname(outputPath);
  const jsonPath = path.join(outputDir, ".provider-workflow-baseline.json");
  await mkdir(outputDir, { recursive: true });

  const result = runCommand("npm", ["run", "test", "--", TEST_PATH], {
    stdio: "inherit",
    env: {
      ...process.env,
      ODB_PROVIDER_WORKFLOW_BASELINE_JSON: jsonPath
    }
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const suite = JSON.parse(await readFile(jsonPath, "utf8"));
  const commandText = `node scripts/provider-workflow-baseline.mjs --out ${outArg}`;
  const commit = getCommit();
  const row = makeBaselineRow(suite, commit, commandText);
  const content = await readOrCreateScoreboard(outputPath);
  await writeFile(outputPath, insertBaselineRow(content, row, commit, commandText));
  await rm(jsonPath, { force: true });
  process.stdout.write(`Updated ${path.relative(ROOT, outputPath)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBaseline();
}
