import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_ROUTINE_WORKFLOW_ROOTS = [
  "/tmp/inspiredesign",
  "/tmp/product-video",
  "artifacts/pinterest-harvest"
] as const;

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function extractSection(source: string, startMarker: string, endMarker: string): string {
  const startIndex = source.indexOf(startMarker);
  expect(startIndex, `Missing section start: ${startMarker}`).toBeGreaterThanOrEqual(0);

  const contentStart = startIndex + startMarker.length;
  const endIndex = source.indexOf(endMarker, contentStart);
  expect(endIndex, `Missing section end: ${endMarker}`).toBeGreaterThan(contentStart);

  return source.slice(startIndex, endIndex);
}

function expectNoRoutineCustomRoots(label: string, content: string): void {
  for (const forbiddenRoot of FORBIDDEN_ROUTINE_WORKFLOW_ROOTS) {
    expect(content, `${label} should not teach ${forbiddenRoot} for routine workflow output`)
      .not.toContain(forbiddenRoot);
  }
}

describe("workflow output guidance", () => {
  it("keeps routine docs and skill workflow guidance on omitted output roots", () => {
    const cliDocs = readProjectFile("docs/CLI.md");
    const surfaceReference = readProjectFile("docs/SURFACE_REFERENCE.md");
    const bestPracticesSkill = readProjectFile("skills/opendevbrowser-best-practices/SKILL.md");
    const workflowRouter = readProjectFile("skills/opendevbrowser-best-practices/scripts/odb-workflow.sh");

    const cliProductVideoSection = extractSection(
      cliDocs,
      "#### Product presentation asset (`product-video run`)",
      "#### Inspiredesign (`inspiredesign run`) and `inspiredesign harvest`"
    );
    const cliInspiredesignSection = extractSection(
      cliDocs,
      "#### Inspiredesign (`inspiredesign run`) and `inspiredesign harvest`",
      "Wrapper behavior:"
    );
    const cliWrapperBehaviorSection = extractSection(
      cliDocs,
      "Wrapper behavior:",
      "### Artifact lifecycle cleanup"
    );
    const surfaceWorkflowSection = extractSection(
      surfaceReference,
      "### Transport flags",
      "For complete argument and flag coverage by command, see `docs/CLI.md`."
    );
    const skillInspiredesignSection = extractSection(
      bestPracticesSkill,
      "4. Design-contract synthesis with repeated public references.",
      "## Agent Sync Targets"
    );
    const routerPinterestGuidance = extractSection(
      workflowRouter,
      "print_pinterest_multi_pin_harvest_guidance() {",
      "print_help() {"
    );

    const checkedSections = [
      ["docs/CLI.md product-video workflow section", cliProductVideoSection],
      ["docs/CLI.md inspiredesign workflow section", cliInspiredesignSection],
      ["docs/CLI.md wrapper behavior section", cliWrapperBehaviorSection],
      ["docs/SURFACE_REFERENCE.md workflow output section", surfaceWorkflowSection],
      ["best-practices skill inspiredesign section", skillInspiredesignSection],
      ["best-practices workflow router Pinterest guidance", routerPinterestGuidance]
    ] as const;

    for (const [label, content] of checkedSections) {
      expectNoRoutineCustomRoots(label, content);
    }

    expect(cliProductVideoSection).toContain("Omit it for routine runs");
    expect(cliProductVideoSection).toContain("prefer `--output-dir .opendevbrowser`");
    expect(cliInspiredesignSection).toContain("Omit it for routine runs");
    expect(cliInspiredesignSection).toContain("prefer `--output-dir .opendevbrowser`");
    expect(cliWrapperBehaviorSection).toContain("Prefer omitting `--output-dir`");
    expect(cliWrapperBehaviorSection).toContain("artifact_path");
    expect(cliWrapperBehaviorSection).toContain("--output-dir .opendevbrowser");
    expect(surfaceWorkflowSection).toContain("Prefer omitted output roots for routine workflow bundles");
    expect(surfaceWorkflowSection).toContain("prefer `.opendevbrowser`");
    expect(skillInspiredesignSection).toContain("omitted `--output-dir`");
    expect(skillInspiredesignSection).toContain("artifact_path");
    expect(routerPinterestGuidance).toContain("omit --output-dir");
    expect(routerPinterestGuidance).toContain("artifact_path");
    expect(routerPinterestGuidance).toContain(".opendevbrowser/inspiredesign/<runId>");
  });

  it("preserves intentional external-output exception examples", () => {
    const cliDocs = readProjectFile("docs/CLI.md");
    const surfaceReference = readProjectFile("docs/SURFACE_REFERENCE.md");
    const publicSurfaceSource = readProjectFile("src/public-surface/source.ts");
    const bestPracticesSkill = readProjectFile("skills/opendevbrowser-best-practices/SKILL.md");
    const workflowRouter = readProjectFile("skills/opendevbrowser-best-practices/scripts/odb-workflow.sh");

    const cliReleaseProofSnippet = extractSection(
      cliDocs,
      "Published npm consumer proof is a separate release gate:",
      "### Skill discovery order"
    );
    const cliCleanupSection = extractSection(
      cliDocs,
      "### Artifact lifecycle cleanup",
      "### Run (single-shot script)"
    );
    const cliScreencastStartSection = extractSection(
      cliDocs,
      "### Screencast start",
      "### Screencast stop"
    );
    const surfaceScreenshotExamples = extractSection(
      publicSurfaceSource,
      "  screenshot: [",
      "  dialog: ["
    );
    const surfaceCleanupSnippet = extractSection(
      surfaceReference,
      "- `artifacts cleanup --expired-only` without `--output-dir`",
      "- Browser evidence omitted outputs"
    );
    const skillQaDebugSection = extractSection(
      bestPracticesSkill,
      "### QA Debug Workflow",
      "### Read-Only Social Validation Workflow"
    );
    const routerReleaseProofSnippet = extractSection(
      workflowRouter,
      "  release-direct-gates)",
      "  skill-runtime-audit)"
    );

    expect(cliCleanupSection).toContain("--output-dir /tmp/opendevbrowser");
    expect(surfaceCleanupSnippet).toContain("--output-dir /tmp/opendevbrowser");
    expect(cliScreencastStartSection).toContain("--output-dir ./artifacts/replay");
    expect(surfaceScreenshotExamples).toContain("--path ./artifacts/page.png");
    expect(skillQaDebugSection).toContain("outputDir=\"./artifacts/qa-replay\"");
    expect(cliReleaseProofSnippet).toContain("artifacts/release/vX.Y.Z/registry-consumer-smoke.json");
    expect(routerReleaseProofSnippet).toContain("artifacts/release/vX.Y.Z/provider-direct-runs.json");
  });
});
