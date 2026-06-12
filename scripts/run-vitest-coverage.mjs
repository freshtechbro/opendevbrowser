import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COVERAGE_ROOT = path.join(ROOT, "coverage");
const COVERAGE_TMP = path.join(COVERAGE_ROOT, ".tmp");
const VITEST_BIN = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const RM_GUARD = path.join(ROOT, "scripts", "vitest-coverage-rm-guard.cjs");
const MISSING_FILE_OPEN_ERROR = /ENOENT: no such file or directory, open ['"]([^'"]+)['"]/g;
const COVERAGE_SHARD_FILE_PATTERN = /^coverage-\d+\.json$/;
const NON_COVERAGE_FAILURE_SIGNAL_PATTERNS = [
  /(?:^|\n)\s*FAIL\s+/,
  /(?:^|\n)\s*Failed Tests\s+\d+/,
  /(?:^|\n)\s*Test Files\s+.*\bfailed\b/,
  /(?:^|\n)\s*Tests\s+.*\bfailed\b/,
  /\bAssertionError\b/,
  /(?:^|\n)\s*(?:Error|TypeError|ReferenceError|SyntaxError|RangeError):\s(?!ENOENT: no such file or directory, open)/
];
const COVERAGE_CLEANUP_RETRIES = 3;
const FOCUSED_COVERAGE_THRESHOLD_ARGS = [
  "--coverage.thresholds.lines",
  "0",
  "--coverage.thresholds.functions",
  "0",
  "--coverage.thresholds.branches",
  "0",
  "--coverage.thresholds.statements",
  "0"
];

function isRetryableCoverageShardPath(missingFilePath, coverageRoot) {
  const missingPath = path.resolve(missingFilePath);
  const relative = path.relative(path.resolve(coverageRoot), missingPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const [tempSegment, fileSegment, ...extraSegments] = relative.split(path.sep);
  return extraSegments.length === 0
    && (tempSegment === ".tmp" || Boolean(tempSegment?.startsWith(".tmp-")))
    && COVERAGE_SHARD_FILE_PATTERN.test(fileSegment ?? "");
}

function getMissingOpenErrorPaths(output) {
  return Array.from(output.matchAll(MISSING_FILE_OPEN_ERROR), (match) => match[1]).filter(Boolean);
}

function stripRetryableCoverageShardLines(output, coverageRoot) {
  return output
    .split(/\r?\n/)
    .filter((line) => {
      const matches = Array.from(line.matchAll(MISSING_FILE_OPEN_ERROR));
      return matches.length === 0
        || !matches.every((match) => match[1] && isRetryableCoverageShardPath(match[1], coverageRoot));
    })
    .join("\n");
}

function hasNonCoverageFailureSignal(output, coverageRoot) {
  const outputWithoutShardLines = stripRetryableCoverageShardLines(output, coverageRoot);
  return NON_COVERAGE_FAILURE_SIGNAL_PATTERNS.some((pattern) => pattern.test(outputWithoutShardLines));
}

export function isRetryableCoverageShardError(output, coverageRoot = COVERAGE_ROOT) {
  if (typeof output !== "string") {
    return false;
  }
  const missingPaths = getMissingOpenErrorPaths(output);
  if (missingPaths.length === 0) {
    return false;
  }
  if (!missingPaths.every((missingPath) => isRetryableCoverageShardPath(missingPath, coverageRoot))) {
    return false;
  }
  return !hasNonCoverageFailureSignal(output, coverageRoot);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableCoverageCleanupError(error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "ENOTEMPTY" || code === "EBUSY";
}

export async function resetCoverageRoot({
  coverageRoot = COVERAGE_ROOT,
  coverageTmp = path.join(coverageRoot, ".tmp"),
  rmImpl = rm,
  mkdirImpl = mkdir,
  sleepImpl = sleep
} = {}) {
  for (let attempt = 1; attempt <= COVERAGE_CLEANUP_RETRIES; attempt += 1) {
    try {
      await rmImpl(coverageRoot, { recursive: true, force: true });
      await mkdirImpl(coverageTmp, { recursive: true });
      return;
    } catch (error) {
      if (!isRetryableCoverageCleanupError(error) || attempt === COVERAGE_CLEANUP_RETRIES) {
        throw error;
      }
      await sleepImpl(250);
    }
  }
}

export function shouldRelaxCoverageThresholds(args = []) {
  if (!Array.isArray(args) || args.length === 0) {
    return false;
  }
  return !args.some(
    (arg) => typeof arg === "string" && arg.startsWith("--coverage.thresholds.")
  );
}

export function removeRedundantCoverageArgs(args = []) {
  return args.filter((arg) => arg !== "--coverage" && arg !== "--coverage=true");
}

export function appendNodeRequireOption(nodeOptions, requirePath) {
  const requireOption = `--require=${requirePath}`;
  if (typeof nodeOptions !== "string" || nodeOptions.trim() === "") {
    return requireOption;
  }
  if (nodeOptions.split(/\s+/).includes(requireOption)) {
    return nodeOptions;
  }
  return `${nodeOptions} ${requireOption}`;
}

export function buildVitestEnv(sourceEnv = process.env) {
  return {
    ...sourceEnv,
    NODE_OPTIONS: appendNodeRequireOption(sourceEnv.NODE_OPTIONS, RM_GUARD),
    ODB_COVERAGE_ROOT: COVERAGE_ROOT
  };
}

export function buildVitestArgs(args = []) {
  const vitestArgs = removeRedundantCoverageArgs(args);
  if (!shouldRelaxCoverageThresholds(vitestArgs)) {
    return vitestArgs;
  }
  return [...vitestArgs, ...FOCUSED_COVERAGE_THRESHOLD_ARGS];
}

async function spawnVitest(args) {
  const vitestArgs = buildVitestArgs(args);
  return await new Promise((resolve) => {
    let combinedOutput = "";
    const child = spawn(
      process.execPath,
      [VITEST_BIN, "run", "--coverage", ...vitestArgs],
      {
        cwd: ROOT,
        stdio: ["inherit", "pipe", "pipe"],
        env: buildVitestEnv()
      }
    );

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      process.stderr.write(chunk);
    });

    child.once("exit", (code, signal) => {
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        signal,
        output: combinedOutput
      });
    });
    child.once("error", (error) => {
      const text = error instanceof Error ? error.message : String(error);
      combinedOutput += text;
      process.stderr.write(`${text}\n`);
      resolve({
        exitCode: 1,
        signal: null,
        output: combinedOutput
      });
    });
  });
}

export async function runVitestCoverage(args = process.argv.slice(2)) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await resetCoverageRoot();
    const result = await spawnVitest(args);
    if (result.signal) {
      process.kill(process.pid, result.signal);
      return 1;
    }
    if (result.exitCode === 0) {
      return 0;
    }
    if (attempt === 1 && isRetryableCoverageShardError(result.output)) {
      process.stderr.write("[coverage] Missing Vitest V8 shard detected; retrying once with a clean coverage root.\n");
      continue;
    }
    return result.exitCode;
  }
  return 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const exitCode = await runVitestCoverage();
  process.exit(exitCode);
}
