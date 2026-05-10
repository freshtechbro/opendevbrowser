#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = "prompt-exports/optimize-cli-tools-runs.md";
const BENCHMARK_BUNDLE_DIR = path.join(ROOT, ".tmp", "cli-tools-latency");
export const BENCHMARK_CLI_PATH = path.join(BENCHMARK_BUNDLE_DIR, "cli", "index.js");
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

export const BENCHMARK_SUBCASES = [
  { id: "cli_version_process", label: "Version", type: "process", args: [BENCHMARK_CLI_PATH, "--version"] },
  { id: "cli_help_flag_process", label: "Help flag", type: "process", args: [BENCHMARK_CLI_PATH, "--help"] },
  { id: "cli_help_command_process", label: "Help cmd", type: "process", args: [BENCHMARK_CLI_PATH, "help"] },
  { id: "cli_parse_args_module", label: "Parse args", type: "module", moduleCase: "parseArgs" },
  { id: "cli_help_render_module", label: "Help render", type: "module", moduleCase: "helpRender" },
  { id: "tools_registry_create_module", label: "Tool registry", type: "module", moduleCase: "toolRegistry" }
];

export const PRIMARY_METRIC_GROUP = "cheap_cli_surface";

export const BENCHMARK_GROUPS = [
  {
    id: PRIMARY_METRIC_GROUP,
    label: "Cheap CLI surface",
    subcases: ["cli_version_process", "cli_help_flag_process", "cli_help_command_process"]
  },
  {
    id: "parser_render_module",
    label: "Parser/render fresh-process modules",
    subcases: ["cli_parse_args_module", "cli_help_render_module"]
  },
  {
    id: "tool_registry_module",
    label: "Tool registry fresh-process module",
    subcases: ["tools_registry_create_module"]
  },
  {
    id: "all_subcases",
    label: "All subcases",
    subcases: BENCHMARK_SUBCASES.map((subcase) => subcase.id)
  }
];

const HEADER_BY_SUBCASE = new Map(BENCHMARK_SUBCASES.map((subcase) => [subcase.id, subcase.label]));

export const SCOREBOARD_SCAFFOLD = `# Optimize CLI Tools Runs

## Metric Contract

Primary metric: cheap CLI surface p95 in milliseconds.

Cheap CLI surface p95 is computed across equal-count measured samples from:
- cli_version_process
- cli_help_flag_process
- cli_help_command_process

Parser/render and tool-registry measurements are reported as separate fresh-process module diagnostics:
- cli_parse_args_module
- cli_help_render_module
- tools_registry_create_module

The all-subcase aggregate p95 is retained as a secondary diagnostic only. Warmups are excluded. Latency outliers are retained in every p95 and reported diagnostically. All subcases run against script-owned temporary bundles built from current source, not possibly stale dist artifacts. Fresh-process module diagnostics include Node startup, ESM loading, eval parsing, and module import overhead by design.

## Baseline Runs

| Date UTC | Commit | Branch | Command | Samples x Trials | Cheap CLI p95 ms | Parser/render p95 ms | Tool registry p95 ms | Aggregate p95 ms | Version p50/p95 | Help flag p50/p95 | Help cmd p50/p95 | Parse args p50/p95 | Help render p50/p95 | Tool registry p50/p95 | Outliers | Primary variance | Status | Notes |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|---|

## Candidate Runs

| Date UTC | Commit | Candidate | Command | Baseline aggregate p95 ms | Candidate aggregate p95 ms | Delta ms | Delta % | Version delta | Help delta | Parse delta | Registry delta | Risk observed | Status | Notes |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|

## Stop Decisions

| Date UTC | Commit | Decision | Evidence | Oracle status | Next action |
|---|---|---|---|---|---|
`;

const KNOWN_OPTIONS = new Set(["--samples", "--warmup", "--trials", "--out"]);

const assignOption = (options, name, value) => {
  if (Object.hasOwn(options, name)) {
    throw new Error(`${name} cannot be provided more than once.`);
  }
  options[name] = value;
};

const collectRawOptions = (args) => {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!KNOWN_OPTIONS.has(name)) {
      throw new Error(`Unknown benchmark option: ${name ?? ""}`);
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    assignOption(options, name, value);
  }
  return options;
};

const parseIntegerOption = (rawOptions, name, defaultValue) => {
  const rawValue = rawOptions[name];
  if (rawValue === undefined) return defaultValue;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} requires a positive integer.`);
  }
  return value;
};

const parseOutPath = (rawOptions) => {
  const value = rawOptions["--out"];
  if (value === undefined) return DEFAULT_OUT;
  if (!value || value.trim() === "") {
    throw new Error("--out requires a non-empty path.");
  }
  return value;
};

export const parseBenchmarkOptions = (args) => {
  const rawOptions = collectRawOptions(args);
  return {
    samples: parseIntegerOption(rawOptions, "--samples", 40),
    warmup: parseIntegerOption(rawOptions, "--warmup", 8),
    trials: parseIntegerOption(rawOptions, "--trials", 3),
    out: parseOutPath(rawOptions)
  };
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

const gitValue = (args, fallback) => {
  const result = runCommand("git", args);
  return result.status === 0 ? result.stdout.trim() : fallback;
};

const roundMs = (value) => Number(value.toFixed(1));

export const percentile = (values, percentileRank) => {
  if (values.length === 0) throw new Error("Cannot calculate percentile for an empty sample set.");
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1);
  return sorted[index];
};

export const median = (values) => {
  if (values.length === 0) throw new Error("Cannot calculate median for an empty sample set.");
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  const left = sorted[midpoint - 1];
  const right = sorted[midpoint];
  return (left + right) / 2;
};

export const summarizeLatencySamples = (samples) => {
  const medianMs = median(samples);
  const p95Ms = percentile(samples, 95);
  const q1 = percentile(samples, 25);
  const q3 = percentile(samples, 75);
  const iqr = q3 - q1;
  const outlierThreshold = q3 + (3 * iqr);
  const diagnosticOutliers = samples.filter((sample) => sample > outlierThreshold).length;
  const maxMs = Math.max(...samples);
  const outlierRatio = diagnosticOutliers / samples.length;
  const status = outlierRatio > 0.05 || maxMs > (3 * medianMs) ? "unstable" : "stable";
  return {
    medianMs: roundMs(medianMs),
    p95Ms: roundMs(p95Ms),
    q1Ms: roundMs(q1),
    q3Ms: roundMs(q3),
    maxMs: roundMs(maxMs),
    sampleCount: samples.length,
    diagnosticOutliers,
    outlierThresholdMs: roundMs(outlierThreshold),
    status
  };
};

const moduleCaseCode = (moduleCase) => {
  const bundleUrl = pathToFileURL(BENCHMARK_BUNDLE_DIR).href;
  if (moduleCase === "parseArgs") {
    return `import { parseArgs } from ${JSON.stringify(`${bundleUrl}/cli/args.js`)};\nconst parsed = parseArgs(["node", "opendevbrowser", "status", "--output-format", "json"]);\nif (parsed.command !== "status") throw new Error("parseArgs failed");`;
  }
  if (moduleCase === "helpRender") {
    return `import { getHelpText } from ${JSON.stringify(`${bundleUrl}/cli/help.js`)};\nconst text = getHelpText();\nif (!text.includes("opendevbrowser")) throw new Error("help render failed");`;
  }
  return `import { createTools } from ${JSON.stringify(`${bundleUrl}/tools/index.js`)};\nconst callable = async () => ({ success: true });\nconst callableProxy = new Proxy(callable, { get: () => callable, apply: () => Promise.resolve({ success: true }) });\nconst providerRuntime = { search: callable, fetch: callable, crawl: callable, post: callable };\nconst deps = new Proxy(Object.create(null), { get: (_target, property) => {\n  if (property === "ensureHub") return undefined;\n  if (property === "getExtensionPath") return () => null;\n  if (property === "providerRuntime") return providerRuntime;\n  if (property === "browserFallbackPort") return callableProxy;\n  return callableProxy;\n}});\nconst tools = createTools(deps);\nif (Object.keys(tools).length === 0) throw new Error("tool registry failed");`;
};

const argsForSubcase = (subcase) => {
  if (subcase.type === "process") return subcase.args;
  return ["--input-type=module", "--eval", moduleCaseCode(subcase.moduleCase)];
};

const measureSubcaseSample = (subcase) => {
  const start = performance.now();
  const result = runCommand(process.execPath, argsForSubcase(subcase));
  const durationMs = performance.now() - start;
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const output = stderr || stdout || "no child process output";
    throw new Error(`${subcase.id} failed with status ${result.status}: ${output}`);
  }
  return durationMs;
};

const runSubcaseTrial = (subcase, options) => {
  for (let index = 0; index < options.warmup; index += 1) {
    measureSubcaseSample(subcase);
  }
  const samples = [];
  for (let index = 0; index < options.samples; index += 1) {
    samples.push(measureSubcaseSample(subcase));
  }
  return samples;
};

const varianceRatio = (trialAggregateP95Ms) => {
  if (trialAggregateP95Ms.length === 0) return 0;
  const minimum = Math.min(...trialAggregateP95Ms);
  const maximum = Math.max(...trialAggregateP95Ms);
  const midpoint = median(trialAggregateP95Ms);
  if (midpoint === 0) return 0;
  return (maximum - minimum) / midpoint;
};

export const summarizeBenchmarkSuite = (trialSamples, options, generatedAt = new Date().toISOString()) => {
  const allSamples = [];
  const bySubcase = new Map(BENCHMARK_SUBCASES.map((subcase) => [subcase.id, []]));
  const trialGroupP95Ms = new Map(BENCHMARK_GROUPS.map((group) => [group.id, []]));

  for (const trial of trialSamples) {
    const trialMeasuredSamples = [];
    for (const subcase of BENCHMARK_SUBCASES) {
      const samples = trial[subcase.id] ?? [];
      const target = bySubcase.get(subcase.id);
      target.push(...samples);
      trialMeasuredSamples.push(...samples);
      allSamples.push(...samples);
    }
    for (const group of BENCHMARK_GROUPS) {
      const groupSamples = group.subcases.flatMap((subcaseId) => trial[subcaseId] ?? []);
      trialGroupP95Ms.get(group.id).push(roundMs(percentile(groupSamples, 95)));
    }
  }

  const subcases = BENCHMARK_SUBCASES.map((subcase) => {
    const samples = bySubcase.get(subcase.id) ?? [];
    return {
      id: subcase.id,
      ...summarizeLatencySamples(samples)
    };
  });
  const groups = BENCHMARK_GROUPS.map((group) => {
    const samples = group.subcases.flatMap((subcaseId) => bySubcase.get(subcaseId) ?? []);
    const trialP95Ms = trialGroupP95Ms.get(group.id) ?? [];
    return {
      id: group.id,
      label: group.label,
      ...summarizeLatencySamples(samples),
      trialP95Ms,
      varianceRatio: varianceRatio(trialP95Ms)
    };
  });
  const primaryGroup = groups.find((group) => group.id === PRIMARY_METRIC_GROUP);
  const aggregateP95Ms = roundMs(percentile(allSamples, 95));
  const totalDiagnosticOutliers = subcases.reduce((total, subcase) => total + subcase.diagnosticOutliers, 0);
  const primaryVarianceRatio = primaryGroup?.varianceRatio ?? 0;
  const stable = primaryVarianceRatio <= 0.15 && primaryGroup?.status === "stable";
  return {
    generatedAt,
    options: {
      samples: options.samples,
      warmup: options.warmup,
      trials: options.trials
    },
    primaryMetricGroup: PRIMARY_METRIC_GROUP,
    primaryP95Ms: primaryGroup?.p95Ms ?? aggregateP95Ms,
    aggregateP95Ms,
    trialAggregateP95Ms: trialGroupP95Ms.get("all_subcases") ?? [],
    trialPrimaryP95Ms: trialGroupP95Ms.get(PRIMARY_METRIC_GROUP) ?? [],
    varianceRatio: primaryVarianceRatio,
    stable,
    status: stable ? "stable" : "unstable",
    totalDiagnosticOutliers,
    totalSamples: allSamples.length,
    groups,
    subcases,
    rawSamples: trialSamples
  };
};

export const ensureBenchmarkBundles = () => {
  const result = runCommand(process.execPath, [
    "scripts/run-package-tool.mjs",
    "tsup",
    "src/cli/index.ts",
    "src/cli/args.ts",
    "src/cli/help.ts",
    "src/tools/index.ts",
    "--format",
    "esm",
    "--target",
    "es2022",
    "--out-dir",
    BENCHMARK_BUNDLE_DIR,
    "--clean",
    "--silent"
  ]);
  if (result.status !== 0) {
    const output = result.stderr.trim() || result.stdout.trim() || "no bundler output";
    throw new Error(`Failed to create benchmark bundles: ${output}`);
  }
};

const runBenchmarkSuite = (options) => {
  ensureBenchmarkBundles();
  const trialSamples = [];
  for (let trialIndex = 0; trialIndex < options.trials; trialIndex += 1) {
    const trial = {};
    for (const subcase of BENCHMARK_SUBCASES) {
      process.stdout.write(`trial ${trialIndex + 1}/${options.trials} ${subcase.id}\n`);
      trial[subcase.id] = runSubcaseTrial(subcase, options);
    }
    trialSamples.push(trial);
  }
  return summarizeBenchmarkSuite(trialSamples, options);
};

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const formatMetricPair = (subcase) => `${subcase.medianMs.toFixed(1)}/${subcase.p95Ms.toFixed(1)}`;
const formatSubcasePair = (suite, id) => {
  const subcase = suite.subcases.find((entry) => entry.id === id);
  return subcase ? formatMetricPair(subcase) : "";
};
const groupP95 = (suite, id) => suite.groups.find((entry) => entry.id === id)?.p95Ms ?? 0;

const outlierSummary = (suite) => {
  const unstable = suite.subcases
    .filter((subcase) => subcase.status === "unstable")
    .map((subcase) => `${subcase.id}:${subcase.diagnosticOutliers}/${subcase.sampleCount},max=${subcase.maxMs}`);
  const prefix = `${suite.totalDiagnosticOutliers}/${suite.totalSamples}`;
  return unstable.length > 0 ? `${prefix}; unstable=${unstable.join(";")}` : prefix;
};

const notesForSuite = (suite) => [
  `Node ${process.version}`,
  `${process.platform}/${process.arch}`,
  `warmup=${suite.options.warmup}`,
  `primary=${suite.primaryMetricGroup}`,
  `benchmarkBundles=.tmp/cli-tools-latency`,
  `primaryTrialP95=${suite.trialPrimaryP95Ms.map((value) => value.toFixed(1)).join("/")}`,
  `aggregateP95=${suite.aggregateP95Ms.toFixed(1)}`,
  `aggregateTrialP95=${suite.trialAggregateP95Ms.map((value) => value.toFixed(1)).join("/")}`,
  `primaryVarianceRatio=${suite.varianceRatio.toFixed(4)}`,
  `status=${suite.status}`
].join("; ");

export const makeBaselineRow = (suite, commit, branch, commandText) => {
  const cells = [
    DATE_FORMAT.format(new Date(suite.generatedAt)).replace(",", ""),
    commit,
    branch,
    commandText,
    `${suite.options.samples} x ${suite.options.trials}`,
    groupP95(suite, "cheap_cli_surface").toFixed(1),
    groupP95(suite, "parser_render_module").toFixed(1),
    groupP95(suite, "tool_registry_module").toFixed(1),
    suite.aggregateP95Ms.toFixed(1),
    formatSubcasePair(suite, "cli_version_process"),
    formatSubcasePair(suite, "cli_help_flag_process"),
    formatSubcasePair(suite, "cli_help_command_process"),
    formatSubcasePair(suite, "cli_parse_args_module"),
    formatSubcasePair(suite, "cli_help_render_module"),
    formatSubcasePair(suite, "tools_registry_create_module"),
    outlierSummary(suite),
    suite.varianceRatio.toFixed(4),
    suite.status,
    notesForSuite(suite)
  ];
  return `| ${cells.map(escapeCell).join(" | ")} |`;
};

export const readOrCreateScoreboard = async (outputPath) => {
  try {
    const content = await readFile(outputPath, "utf8");
    if (content.includes("Cheap CLI p95 ms")) {
      return content;
    }
    return `${SCOREBOARD_SCAFFOLD}\n## Legacy Scoreboard Before Metric Split\n\n${content.trim()}\n`;
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
    return SCOREBOARD_SCAFFOLD;
  }
};

export const insertBaselineRow = (content, row, commit, branch, commandText) => {
  const identity = `| ${escapeCell(commit)} | ${escapeCell(branch)} | ${escapeCell(commandText)} |`;
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

const commandTextForOptions = (options) => [
  "node scripts/cli-tools-latency-baseline.mjs",
  `--samples ${options.samples}`,
  `--warmup ${options.warmup}`,
  `--trials ${options.trials}`,
  `--out ${options.out}`
].join(" ");

const writeScoreboard = async (suite, options) => {
  const outputPath = path.resolve(ROOT, options.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const commit = gitValue(["rev-parse", "--short", "HEAD"], "unavailable");
  const branch = gitValue(["rev-parse", "--abbrev-ref", "HEAD"], "unavailable");
  const commandText = commandTextForOptions(options);
  const row = makeBaselineRow(suite, commit, branch, commandText);
  const content = await readOrCreateScoreboard(outputPath);
  await writeFile(outputPath, insertBaselineRow(content, row, commit, branch, commandText));
  process.stdout.write(`Updated ${path.relative(ROOT, outputPath)}\n`);
};

const writeJsonArtifact = async (suite, options) => {
  const outputPath = path.resolve(ROOT, options.out);
  const jsonPath = path.join(path.dirname(outputPath), ".cli-tools-latency-baseline.json");
  await writeFile(jsonPath, `${JSON.stringify(suite, null, 2)}\n`);
  process.stdout.write(`Updated ${path.relative(ROOT, jsonPath)}\n`);
};

const runBaseline = async () => {
  const options = parseBenchmarkOptions(process.argv.slice(2));
  const suite = runBenchmarkSuite(options);
  await writeScoreboard(suite, options);
  await writeJsonArtifact(suite, options);
  process.stdout.write(`Aggregate p95 ms: ${suite.aggregateP95Ms.toFixed(1)}\n`);
  process.stdout.write(`Variance ratio: ${suite.varianceRatio.toFixed(4)}\n`);
  process.stdout.write(`Status: ${suite.status}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBaseline();
}
