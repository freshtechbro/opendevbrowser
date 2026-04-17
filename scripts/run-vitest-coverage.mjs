import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COVERAGE_ROOT = path.join(ROOT, "coverage");
const COVERAGE_TMP = path.join(COVERAGE_ROOT, ".tmp");
const VITEST_BIN = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const RM_GUARD = path.join(ROOT, "scripts", "vitest-coverage-rm-guard.cjs");
const RETRYABLE_COVERAGE_SHARD_ERROR = /ENOENT: no such file or directory, open '([^']+coverage\/\.tmp\/coverage-\d+\.json)'/;
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

export function isRetryableCoverageShardError(output, coverageRoot = COVERAGE_ROOT) {
  if (typeof output !== "string") {
    return false;
  }
  const match = RETRYABLE_COVERAGE_SHARD_ERROR.exec(output);
  if (!match?.[1]) {
    return false;
  }
  const missingPath = path.resolve(match[1]);
  const relative = path.relative(path.resolve(coverageRoot), missingPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  return relative.startsWith(`.tmp${path.sep}coverage-`) && relative.endsWith(".json");
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

export function buildVitestArgs(args = []) {
  if (!shouldRelaxCoverageThresholds(args)) {
    return [...args];
  }
  return [...args, ...FOCUSED_COVERAGE_THRESHOLD_ARGS];
}

async function spawnVitest(args) {
  const vitestArgs = buildVitestArgs(args);
  return await new Promise((resolve) => {
    let combinedOutput = "";
    const child = spawn(
      process.execPath,
      ["--require", RM_GUARD, VITEST_BIN, "run", "--coverage", ...vitestArgs],
      {
        cwd: ROOT,
        stdio: ["inherit", "pipe", "pipe"],
        env: {
          ...process.env,
          ODB_COVERAGE_ROOT: COVERAGE_ROOT
        }
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
