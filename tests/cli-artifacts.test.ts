import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { createArtifactBundle } from "../src/providers/artifacts";
import { __test__, runArtifactsCommand } from "../src/cli/commands/artifacts";

const makeArgs = (rawArgs: string[]): ParsedArgs => ({
  command: "artifacts",
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("artifacts command", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }));
    createdDirs.length = 0;
  });

  it("parses cleanup flags", () => {
    const parsed = __test__.parseArtifactsArgs([
      "cleanup",
      "--expired-only",
      "--output-dir=/tmp/opendevbrowser"
    ]);

    expect(parsed).toEqual({
      subcommand: "cleanup",
      expiredOnly: true,
      outputDir: "/tmp/opendevbrowser"
    });
  });

  it("requires --expired-only", () => {
    expect(() => __test__.parseArtifactsArgs(["cleanup"])).toThrow("Usage: opendevbrowser artifacts cleanup --expired-only");
  });

  it("cleans expired artifact runs", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "odb-artifacts-cli-"));
    createdDirs.push(rootDir);

    const expired = await createArtifactBundle({
      namespace: "shopping",
      outputDir: rootDir,
      ttlHours: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
      files: [{ path: "summary.md", content: "expired" }]
    });

    const active = await createArtifactBundle({
      namespace: "shopping",
      outputDir: rootDir,
      ttlHours: 48,
      now: new Date("2026-02-16T00:00:00.000Z"),
      files: [{ path: "summary.md", content: "active" }]
    });

    const result = await runArtifactsCommand(makeArgs([
      "cleanup",
      "--expired-only",
      "--output-dir",
      rootDir
    ]));

    expect(result).toMatchObject({
      success: true,
      data: {
        rootDir,
        expiredOnly: true,
        removedCount: 1
      }
    });

    const data = result.data as {
      removed: string[];
      skipped: string[];
    };
    expect(data.removed.some((entry) => entry.includes(expired.runId))).toBe(true);
    expect(data.skipped.some((entry) => entry.includes(active.runId))).toBe(true);
  });
});
