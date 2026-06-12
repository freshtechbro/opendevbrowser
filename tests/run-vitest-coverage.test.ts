import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendNodeRequireOption,
  buildVitestArgs,
  buildVitestEnv,
  isRetryableCoverageCleanupError,
  isRetryableCoverageShardError,
  removeRedundantCoverageArgs,
  resetCoverageRoot,
  shouldRelaxCoverageThresholds
} from "../scripts/run-vitest-coverage.mjs";

describe("run-vitest-coverage", () => {
  it("retries only for missing shard ENOENTs under the coverage tmp root", () => {
    const coverageRoot = path.join("/tmp", "opendevbrowser", "coverage");
    const output = [
      "Unhandled Error",
      `Error: ENOENT: no such file or directory, open '${path.join(coverageRoot, ".tmp", "coverage-2.json")}'`
    ].join("\n");
    const shardRootOutput = [
      "Unhandled Error",
      `Error: ENOENT: no such file or directory, open "${path.join(coverageRoot, ".tmp-2-4", "coverage-11.json")}"`
    ].join("\n");

    expect(isRetryableCoverageShardError(output, coverageRoot)).toBe(true);
    expect(isRetryableCoverageShardError(shardRootOutput, coverageRoot)).toBe(true);
  });

  it("ignores unrelated ENOENTs and non-coverage failures", () => {
    const coverageRoot = path.join("/tmp", "opendevbrowser", "coverage");
    const unrelatedEnoent = [
      "Unhandled Error",
      `Error: ENOENT: no such file or directory, open '${path.join("/tmp", "other", "coverage-2.json")}'`
    ].join("\n");
    const assertionFailure = "AssertionError: expected true to be false";
    const nonShardCoverageEnoent = [
      "Unhandled Error",
      `Error: ENOENT: no such file or directory, open '${path.join(coverageRoot, ".tmp", "summary.json")}'`
    ].join("\n");
    const invalidTmpPrefixEnoent = [
      "Unhandled Error",
      `Error: ENOENT: no such file or directory, open '${path.join(coverageRoot, ".tmpfoo", "coverage-2.json")}'`
    ].join("\n");

    expect(isRetryableCoverageShardError(unrelatedEnoent, coverageRoot)).toBe(false);
    expect(isRetryableCoverageShardError(assertionFailure, coverageRoot)).toBe(false);
    expect(isRetryableCoverageShardError(nonShardCoverageEnoent, coverageRoot)).toBe(false);
    expect(isRetryableCoverageShardError(invalidTmpPrefixEnoent, coverageRoot)).toBe(false);
  });

  it("does not retry when shard ENOENT output also contains a real test failure", () => {
    const coverageRoot = path.join("/tmp", "opendevbrowser", "coverage");
    const mixedFailureOutput = [
      "FAIL tests/example.test.ts > sample > fails",
      "AssertionError: expected true to be false",
      `Error: ENOENT: no such file or directory, open '${path.join(coverageRoot, ".tmp", "coverage-2.json")}'`,
      "Test Files  1 failed | 1 passed",
      "Tests  1 failed | 10 passed"
    ].join("\n");

    expect(isRetryableCoverageShardError(mixedFailureOutput, coverageRoot)).toBe(false);
  });

  it("relaxes coverage thresholds for focused invocations with explicit args", () => {
    expect(shouldRelaxCoverageThresholds([])).toBe(false);
    expect(shouldRelaxCoverageThresholds(["tests/cli-help-parity.test.ts"])).toBe(true);
    expect(buildVitestArgs(["tests/cli-help-parity.test.ts"])).toEqual([
      "tests/cli-help-parity.test.ts",
      "--coverage.thresholds.lines",
      "0",
      "--coverage.thresholds.functions",
      "0",
      "--coverage.thresholds.branches",
      "0",
      "--coverage.thresholds.statements",
      "0"
    ]);
  });

  it("preserves explicit coverage threshold overrides", () => {
    const args = ["tests/cli-help-parity.test.ts", "--coverage.thresholds.lines", "97"];

    expect(shouldRelaxCoverageThresholds(args)).toBe(false);
    expect(buildVitestArgs(args)).toEqual(args);
  });

  it("drops redundant coverage enablement before spawning vitest", () => {
    expect(removeRedundantCoverageArgs(["--coverage", "--coverage=true", "--coverage.thresholds.lines", "97"])).toEqual([
      "--coverage.thresholds.lines",
      "97"
    ]);
    expect(buildVitestArgs(["--coverage"])).toEqual([]);
  });

  it("propagates the rm guard through Node options for Vitest worker cleanup", () => {
    const requirePath = path.join("/tmp", "vitest-coverage-rm-guard.cjs");

    expect(appendNodeRequireOption(undefined, requirePath)).toBe(`--require=${requirePath}`);
    expect(appendNodeRequireOption("--stack-trace-limit=20", requirePath)).toBe(
      `--stack-trace-limit=20 --require=${requirePath}`
    );
    expect(appendNodeRequireOption(`--require=${requirePath}`, requirePath)).toBe(`--require=${requirePath}`);
    expect(buildVitestEnv({ NODE_OPTIONS: "--stack-trace-limit=20" })).toMatchObject({
      ODB_COVERAGE_ROOT: expect.stringContaining("coverage"),
      NODE_OPTIONS: expect.stringContaining("vitest-coverage-rm-guard.cjs")
    });
  });

  it("retries coverage cleanup for transient non-empty directory errors", async () => {
    let attempt = 0;
    const rmImpl = async () => {
      attempt += 1;
      if (attempt === 1) {
        const error = new Error("coverage busy");
        Object.assign(error, { code: "ENOTEMPTY" });
        throw error;
      }
    };
    const mkdirImpl = async () => {};
    const sleepImpl = async () => {};

    await expect(resetCoverageRoot({
      coverageRoot: "/tmp/coverage-root",
      coverageTmp: "/tmp/coverage-root/.tmp",
      rmImpl,
      mkdirImpl,
      sleepImpl
    })).resolves.toBeUndefined();
    expect(attempt).toBe(2);
  });

  it("recognizes retryable coverage cleanup error codes", () => {
    expect(isRetryableCoverageCleanupError({ code: "ENOTEMPTY" })).toBe(true);
    expect(isRetryableCoverageCleanupError({ code: "EBUSY" })).toBe(true);
    expect(isRetryableCoverageCleanupError({ code: "ENOENT" })).toBe(false);
  });
});
