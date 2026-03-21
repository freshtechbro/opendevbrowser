import path from "node:path";
import { describe, expect, it } from "vitest";
import { isRetryableCoverageShardError } from "../scripts/run-vitest-coverage.mjs";

describe("run-vitest-coverage", () => {
  it("retries only for missing shard ENOENTs under the coverage tmp root", () => {
    const coverageRoot = path.join("/tmp", "opendevbrowser", "coverage");
    const output = [
      "Unhandled Error",
      `Error: ENOENT: no such file or directory, open '${path.join(coverageRoot, ".tmp", "coverage-2.json")}'`
    ].join("\n");

    expect(isRetryableCoverageShardError(output, coverageRoot)).toBe(true);
  });

  it("ignores unrelated ENOENTs and non-coverage failures", () => {
    const coverageRoot = path.join("/tmp", "opendevbrowser", "coverage");
    const unrelatedEnoent = [
      "Unhandled Error",
      `Error: ENOENT: no such file or directory, open '${path.join("/tmp", "other", "coverage-2.json")}'`
    ].join("\n");
    const assertionFailure = "AssertionError: expected true to be false";

    expect(isRetryableCoverageShardError(unrelatedEnoent, coverageRoot)).toBe(false);
    expect(isRetryableCoverageShardError(assertionFailure, coverageRoot)).toBe(false);
  });
});
