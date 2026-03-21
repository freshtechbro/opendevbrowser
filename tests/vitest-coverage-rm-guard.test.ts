import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  resolveCoverageRoot,
  shouldPreserveCoveragePath
} = require("../scripts/vitest-coverage-rm-guard.cjs") as {
  resolveCoverageRoot: () => string;
  shouldPreserveCoveragePath: (target: string, coverageRoot?: string) => boolean;
};

describe("vitest coverage rm guard", () => {
  it("guards temporary coverage shard paths under the reports root", () => {
    const coverageRoot = "/tmp/opendevbrowser/coverage";

    expect(shouldPreserveCoveragePath("/tmp/opendevbrowser/coverage/.tmp/coverage-1.json", coverageRoot)).toBe(true);
    expect(shouldPreserveCoveragePath("/tmp/opendevbrowser/coverage/.tmp-2-4/coverage-1.json", coverageRoot)).toBe(true);
    expect(shouldPreserveCoveragePath("/tmp/opendevbrowser/coverage/lcov.info", coverageRoot)).toBe(false);
    expect(shouldPreserveCoveragePath("/tmp/opendevbrowser/coverage", coverageRoot)).toBe(false);
    expect(shouldPreserveCoveragePath("/tmp/opendevbrowser/other/.tmp/coverage-1.json", coverageRoot)).toBe(false);
  });

  it("resolves the coverage root from ODB_COVERAGE_ROOT when set", () => {
    const previous = process.env.ODB_COVERAGE_ROOT;
    process.env.ODB_COVERAGE_ROOT = path.join("/tmp", "odb-coverage-root");

    expect(resolveCoverageRoot()).toBe(path.join("/tmp", "odb-coverage-root"));

    if (previous === undefined) {
      delete process.env.ODB_COVERAGE_ROOT;
    } else {
      process.env.ODB_COVERAGE_ROOT = previous;
    }
  });
});
