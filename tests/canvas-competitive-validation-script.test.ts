import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANVAS_VALIDATION_GROUPS,
  parseValidationArgs,
  readCanvasValidationRuntime,
  resolveSelectedValidationGroups,
  summarizeValidationResults
} from "../scripts/canvas-competitive-validation.mjs";

const createdRoots: string[] = [];

async function withRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canvas competitive validation script", () => {
  it("parses group and output overrides", () => {
    const parsed = parseValidationArgs(["--group", "token-roundtrip", "--out", "artifacts/custom.json"]);

    expect(parsed.group).toBe("token-roundtrip");
    expect(parsed.out).toContain("artifacts/custom.json");
  });

  it("lists validation groups with stable ids", () => {
    expect(CANVAS_VALIDATION_GROUPS.map((group) => group.id)).toContain("figma-live-smoke");
    expect(resolveSelectedValidationGroups({ group: null })).toHaveLength(CANVAS_VALIDATION_GROUPS.length);
    expect(resolveSelectedValidationGroups({ group: "surface-parity" })[0]?.name).toContain("surface parity");
  });

  it("summarizes skips without failing the report", () => {
    const summary = summarizeValidationResults([
      { id: "a", covers: ["send_to_agent"], status: "pass" },
      { id: "b", covers: ["figma_live_smoke"], status: "skipped_no_figma_token" },
      { id: "c", covers: ["configured_plugin_fixtures"], status: "skipped" }
    ], Date.now() - 25, { outPath: "/tmp/report.json" });

    expect(summary.ok).toBe(true);
    expect(summary.counts).toEqual({
      pass: 1,
      fail: 0,
      skipped: 1,
      skipped_no_figma_token: 1
    });
    expect(summary.featureAreas).toMatchObject({
      send_to_agent: "pass",
      figma_live_smoke: "skipped_no_figma_token",
      configured_plugin_fixtures: "skipped"
    });
  });

  it("merges plugin declarations across package, repo, and config precedence", async () => {
    const root = await withRoot("odb-canvas-validation-");
    const configDir = join(root, ".config");
    await mkdir(join(root, ".opendevbrowser", "canvas"), { recursive: true });
    await mkdir(configDir, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "fixture-root",
      opendevbrowser: {
        canvas: {
          adapterPlugins: [
            "./plugins/pkg",
            { ref: "./plugins/repo", enabled: false }
          ]
        }
      }
    }, null, 2));
    await writeFile(join(root, ".opendevbrowser", "canvas", "adapters.json"), JSON.stringify({
      adapterPlugins: [
        "./plugins/repo",
        "./plugins/repo-only"
      ]
    }, null, 2));
    await writeFile(join(configDir, "opendevbrowser.jsonc"), [
      "{",
      "  // local override",
      "  \"canvas\": {",
      "    \"adapterPlugins\": [",
      "      { \"ref\": \"./plugins/repo-only\", \"enabled\": false },",
      "      \"./plugins/config-only\"",
      "    ]",
      "  },",
      "  \"integrations\": {",
      "    \"figma\": { \"accessToken\": \"figma-config-token\" }",
      "  }",
      "}"
    ].join("\n"));

    const runtime = readCanvasValidationRuntime({
      OPENCODE_CONFIG_DIR: configDir,
      FIGMA_ACCESS_TOKEN: "figma-env-token",
      CANVAS_FIGMA_LIVE_URL: "https://www.figma.com/file/AbCdEf12345/Fixture"
    }, {
      rootDir: root,
      homeDir: root
    });

    expect(runtime.configuredPluginRefs).toEqual([
      "./plugins/pkg",
      "./plugins/repo",
      "./plugins/config-only"
    ]);
    expect(runtime.figmaAccessToken).toBe("figma-env-token");
    expect(runtime.figmaSourceUrl).toContain("figma.com/file/AbCdEf12345");
  });

  it("ships a checked-in repo plugin fixture so configured plugin validation cannot skip", async () => {
    const configDir = await withRoot("odb-canvas-validation-config-");

    const runtime = readCanvasValidationRuntime({
      OPENCODE_CONFIG_DIR: configDir
    }, {
      rootDir: process.cwd(),
      homeDir: process.cwd()
    });

    expect(runtime.configuredPluginRefs).toContain(
      "./tests/fixtures/canvas/adapter-plugins/validation-fixture"
    );
  });
});
