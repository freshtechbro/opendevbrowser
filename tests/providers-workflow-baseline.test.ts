import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  insertBaselineRow,
  makeBaselineRow,
  readOrCreateScoreboard
} from "../scripts/provider-workflow-baseline.mjs";
import {
  PROVIDER_WORKFLOW_BASELINE_NOW,
  WORKFLOW_BASELINE_SCENARIOS,
  runProviderWorkflowBaselineSuite,
  type ProviderWorkflowBaselineSuite,
  type WorkflowBaselineName
} from "./support/provider-workflow-bench-fixtures";

const createdDirs: string[] = [];

const makeRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "odb-workflow-baseline-"));
  createdDirs.push(directory);
  return directory;
};

const byWorkflow = (
  suite: ProviderWorkflowBaselineSuite,
  workflow: WorkflowBaselineName
) => {
  const metric = suite.metrics.find((entry) => entry.workflow === workflow);
  if (!metric) {
    throw new Error(`Missing baseline metric for ${workflow}.`);
  }
  return metric;
};

const byFailure = (
  suite: ProviderWorkflowBaselineSuite,
  workflow: WorkflowBaselineName
) => {
  const metric = suite.failureArtifacts.find((entry) => entry.workflow === workflow);
  if (!metric) {
    throw new Error(`Missing failure artifact metric for ${workflow}.`);
  }
  return metric;
};

const writeBaselineJson = async (suite: ProviderWorkflowBaselineSuite): Promise<void> => {
  const outputPath = process.env.ODB_PROVIDER_WORKFLOW_BASELINE_JSON;
  if (!outputPath) return;
  await writeFile(outputPath, `${JSON.stringify(suite, null, 2)}\n`);
};

describe("provider workflow baseline instrumentation", () => {
  afterEach(async () => {
    await Promise.all(createdDirs.map((directory) => rm(directory, { recursive: true, force: true })));
    createdDirs.length = 0;
  });

  it("records current artifact contract and timing facts for provider workflows", async () => {
    const root = await makeRoot();
    const suite = await runProviderWorkflowBaselineSuite(root);

    expect(suite.generatedAt).toBe(PROVIDER_WORKFLOW_BASELINE_NOW);
    expect(suite.scenarios).toEqual(WORKFLOW_BASELINE_SCENARIOS);
    expect(suite.metrics.map((metric) => metric.workflow)).toEqual([
      "research",
      "shopping",
      "product-video",
      "inspiredesign"
    ]);

    expect(byWorkflow(suite, "research")).toMatchObject({
      artifactRoot: root,
      namespace: "research",
      responsePathKey: "artifact_path"
    });
    expect(byWorkflow(suite, "shopping")).toMatchObject({
      artifactRoot: root,
      namespace: "shopping",
      responsePathKey: "artifact_path"
    });
    expect(byWorkflow(suite, "product-video")).toMatchObject({
      artifactRoot: root,
      namespace: "product-video",
      responsePathKey: "artifact_path"
    });
    expect(byWorkflow(suite, "inspiredesign")).toMatchObject({
      artifactRoot: root,
      namespace: "inspiredesign",
      responsePathKey: "artifact_path"
    });

    for (const metric of suite.metrics) {
      expect(metric.durationMs).toBeGreaterThanOrEqual(0);
      expect(metric.fileCount).toBeGreaterThan(0);
      expect(metric.artifactPath).toContain(metric.namespace);
    }

    expect(suite.failureArtifacts.map((metric) => metric.workflow)).toEqual([
      "research",
      "shopping",
      "product-video",
      "inspiredesign"
    ]);
    for (const failureArtifact of suite.failureArtifacts) {
      expect(failureArtifact.artifactDirectoryExists).toBe(false);
      expect(failureArtifact.errorMessage.length).toBeGreaterThan(0);
    }
    expect(byFailure(suite, "product-video")).toMatchObject({
      expectedNamespace: "product-video",
      auxiliaryFetchCalls: 0
    });
    expect(byFailure(suite, "product-video").errorMessage).toContain("not-found page");

    await writeBaselineJson(suite);
  });

  it("creates a new scoreboard only when the output file is missing", async () => {
    const root = await makeRoot();

    await expect(readOrCreateScoreboard(join(root, "missing.md"))).resolves.toContain(
      "# Optimize Workflow Artifacts Runs"
    );
    await expect(readOrCreateScoreboard(join(root, "missing.md"))).resolves.toContain(
      "Research ms (live)"
    );
    await expect(readOrCreateScoreboard(root)).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("renders deterministic baseline metadata and dedupes by commit plus command", async () => {
    const suite = {
      generatedAt: PROVIDER_WORKFLOW_BASELINE_NOW,
      artifactRoot: "/tmp/odb-baseline",
      metrics: [
        { workflow: "research", durationMs: 12, namespace: "research", responsePathKey: "artifact_path", fileCount: 6 },
        { workflow: "shopping", durationMs: 13, namespace: "shopping", responsePathKey: "artifact_path", fileCount: 5 },
        { workflow: "product-video", durationMs: 14, namespace: "product-video", responsePathKey: "artifact_path", fileCount: 7 },
        { workflow: "inspiredesign", durationMs: 15, namespace: "inspiredesign", responsePathKey: "artifact_path", fileCount: 8 }
      ],
      failureArtifacts: [
        {
          workflow: "product-video",
          expectedNamespace: "product-video",
          artifactDirectoryExists: false,
          auxiliaryFetchCalls: 0,
          errorMessage: "not-found page"
        }
      ]
    };
    const row = makeBaselineRow(suite, "abc123", "node scripts/provider-workflow-baseline.mjs");

    expect(row).toContain("2026-05-07");
    expect(row).toContain("fixtureAt=2026-05-07T23:08:56.000Z");
    expect(row).toContain("durationColumns=live_fixture_wall_time");

    const content = insertBaselineRow(`${row}\n## Candidate Runs`, row, "abc123", "node scripts/provider-workflow-baseline.mjs");
    expect(content.match(/\| abc123 \|/g)).toHaveLength(1);
  });
});
