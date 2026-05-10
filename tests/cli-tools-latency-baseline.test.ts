import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BENCHMARK_SUBCASES,
  BENCHMARK_CLI_PATH,
  SCOREBOARD_SCAFFOLD,
  ensureBenchmarkBundles,
  insertBaselineRow,
  makeBaselineRow,
  median,
  parseBenchmarkOptions,
  percentile,
  readOrCreateScoreboard,
  summarizeBenchmarkSuite,
  summarizeLatencySamples
} from "../scripts/cli-tools-latency-baseline.mjs";
import {
  CLI_TOOLS_LATENCY_SAMPLE_VALUES,
  EXPECTED_CLI_TOOLS_LATENCY_SUBCASES,
  createCliToolsLatencySuiteFixture
} from "./support/cli-tools-latency-bench-fixtures";

const createdDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "odb-cli-tools-latency-"));
  createdDirs.push(directory);
  return directory;
};

describe("CLI tools latency baseline instrumentation", () => {
  afterEach(async () => {
    await Promise.all(createdDirs.map((directory) => rm(directory, { recursive: true, force: true })));
    createdDirs.length = 0;
  });

  it("keeps the planned subcase inventory explicit", () => {
    expect(BENCHMARK_SUBCASES.map((subcase) => subcase.id)).toEqual(EXPECTED_CLI_TOOLS_LATENCY_SUBCASES);
    expect(SCOREBOARD_SCAFFOLD).toContain("# Optimize CLI Tools Runs");
    expect(SCOREBOARD_SCAFFOLD).toContain("Aggregate p95 ms");
    expect(SCOREBOARD_SCAFFOLD).toContain("tools_registry_create_module");
  });

  it("parses benchmark options with plan defaults", () => {
    expect(parseBenchmarkOptions([])).toEqual({
      samples: 40,
      warmup: 8,
      trials: 3,
      out: "prompt-exports/optimize-cli-tools-runs.md"
    });
    expect(parseBenchmarkOptions([
      "--samples",
      "4",
      "--warmup",
      "1",
      "--trials",
      "2",
      "--out",
      "prompt-exports/custom.md"
    ])).toEqual({
      samples: 4,
      warmup: 1,
      trials: 2,
      out: "prompt-exports/custom.md"
    });
  });

  it("rejects benchmark option typos before writing misleading scoreboards", () => {
    expect(() => parseBenchmarkOptions(["--sample", "4"])).toThrow("Unknown benchmark option: --sample");
    expect(() => parseBenchmarkOptions(["--samples"])).toThrow("--samples requires a value.");
    expect(() => parseBenchmarkOptions(["--samples", "--warmup"])).toThrow("--samples requires a value.");
    expect(() => parseBenchmarkOptions(["--samples", "4", "--samples", "5"])).toThrow(
      "--samples cannot be provided more than once."
    );
  });

  it("computes deterministic latency summaries", () => {
    expect(median(CLI_TOOLS_LATENCY_SAMPLE_VALUES)).toBe(45);
    expect(percentile(CLI_TOOLS_LATENCY_SAMPLE_VALUES, 95)).toBe(80);
    expect(summarizeLatencySamples(CLI_TOOLS_LATENCY_SAMPLE_VALUES)).toMatchObject({
      medianMs: 45,
      p95Ms: 80,
      sampleCount: CLI_TOOLS_LATENCY_SAMPLE_VALUES.length,
      diagnosticOutliers: 0,
      status: "stable"
    });
  });

  it("summarizes a suite with aggregate p95 and variance", () => {
    const options = { samples: 2, warmup: 1, trials: 2 };
    const trialSamples = [
      Object.fromEntries(EXPECTED_CLI_TOOLS_LATENCY_SUBCASES.map((id, index) => [id, [10 + index, 20 + index]])),
      Object.fromEntries(EXPECTED_CLI_TOOLS_LATENCY_SUBCASES.map((id, index) => [id, [12 + index, 24 + index]]))
    ];
    const suite = summarizeBenchmarkSuite(trialSamples, options, "2026-05-10T21:24:05.000Z");

    expect(suite.generatedAt).toBe("2026-05-10T21:24:05.000Z");
    expect(suite.totalSamples).toBe(24);
    expect(suite.aggregateP95Ms).toBe(28);
    expect(suite.primaryMetricGroup).toBe("cheap_cli_surface");
    expect(suite.primaryP95Ms).toBe(26);
    expect(suite.groups.map((group) => group.id)).toEqual([
      "cheap_cli_surface",
      "parser_render_module",
      "tool_registry_module",
      "all_subcases"
    ]);
    expect(suite.subcases).toHaveLength(EXPECTED_CLI_TOOLS_LATENCY_SUBCASES.length);
    expect(suite.varianceRatio).toBeGreaterThan(0);
    expect(suite.rawSamples).toEqual(trialSamples);
  });

  it("creates scoreboards, normalizes old scoreboards, and rejects non-missing read errors", async () => {
    const root = await makeRoot();
    const existingPath = join(root, "existing.md");
    await writeFile(existingPath, "existing scoreboard");

    await expect(readOrCreateScoreboard(existingPath)).resolves.toContain("## Legacy Scoreboard Before Metric Split");
    await expect(readOrCreateScoreboard(join(root, "missing.md"))).resolves.toContain(
      "## Baseline Runs"
    );
    await expect(readOrCreateScoreboard(root)).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("renders deterministic baseline rows and dedupes by commit, branch, and command", () => {
    const suite = createCliToolsLatencySuiteFixture();
    const command = "node scripts/cli-tools-latency-baseline.mjs --samples 4 --warmup 1 --trials 2 --out prompt-exports/optimize-cli-tools-runs.md";
    const row = makeBaselineRow(suite, "abc123", "codex/optimize-cli-tools", command);

    expect(row).toContain("2026-05-10");
    expect(row).toContain("| abc123 | codex/optimize-cli-tools |");
    expect(row).toContain("| 80.0 |");
    expect(row).toContain("warmup=1");
    expect(row).toContain("primaryVarianceRatio=0.1053");

    const content = insertBaselineRow(
      `${row}\n## Candidate Runs`,
      row,
      "abc123",
      "codex/optimize-cli-tools",
      command
    );
    expect(content.match(/\| abc123 \| codex\/optimize-cli-tools \|/g)).toHaveLength(1);
  });

  it("runs fast-path CLI process cases from the current-source benchmark bundle", () => {
    ensureBenchmarkBundles();

    const version = spawnSync(process.execPath, [BENCHMARK_CLI_PATH, "--version"], { encoding: "utf8" });
    expect(version.status).toBe(0);
    expect(version.stderr).toBe("");
    expect(version.stdout).toMatch(/^opendevbrowser v\d+\.\d+\.\d+/);

    const jsonVersion = spawnSync(process.execPath, [
      BENCHMARK_CLI_PATH,
      "version",
      "--output-format",
      "json"
    ], { encoding: "utf8" });
    expect(jsonVersion.status).toBe(0);
    expect(JSON.parse(jsonVersion.stdout)).toMatchObject({
      success: true,
      message: expect.stringMatching(/^opendevbrowser v\d+\.\d+\.\d+/)
    });

    const streamHelp = spawnSync(process.execPath, [
      BENCHMARK_CLI_PATH,
      "help",
      "--output-format",
      "stream-json"
    ], { encoding: "utf8" });
    expect(streamHelp.status).toBe(0);
    expect(JSON.parse(streamHelp.stdout)).toMatchObject({
      success: true,
      message: expect.stringContaining("Command Inventory")
    });

    const quietVersion = spawnSync(process.execPath, [
      BENCHMARK_CLI_PATH,
      "--version",
      "--quiet"
    ], { encoding: "utf8" });
    expect(quietVersion.status).toBe(0);
    expect(quietVersion.stdout).toMatch(/^opendevbrowser v\d+\.\d+\.\d+/);
    expect(quietVersion.stderr).toBe("");

    const quietHelp = spawnSync(process.execPath, [
      BENCHMARK_CLI_PATH,
      "help",
      "--quiet"
    ], { encoding: "utf8" });
    expect(quietHelp.status).toBe(0);
    expect(quietHelp.stdout).toContain("Command Inventory");
    expect(quietHelp.stderr).toBe("");
  });

  it("runs representative lazy command process cases from the current-source benchmark bundle", async () => {
    const root = await makeRoot();
    ensureBenchmarkBundles();

    const artifacts = spawnSync(process.execPath, [
      BENCHMARK_CLI_PATH,
      "artifacts",
      "cleanup",
      "--expired-only",
      "--output-dir",
      root,
      "--output-format",
      "json"
    ], { encoding: "utf8" });
    expect(artifacts.status).toBe(0);
    expect(JSON.parse(artifacts.stdout)).toMatchObject({
      success: true,
      data: {
        expiredOnly: true,
        rootDir: root
      }
    });

    const status = spawnSync(process.execPath, [
      BENCHMARK_CLI_PATH,
      "status",
      "--output-format",
      "json"
    ], { encoding: "utf8" });
    expect([0, 10]).toContain(status.status);
    expect(JSON.parse(status.stdout)).toMatchObject({
      success: expect.any(Boolean)
    });
  });
});
