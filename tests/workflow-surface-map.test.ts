import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildWorkflowInventory } from "../scripts/shared/workflow-inventory.mjs";
import { renderWorkflowSurfaceMapMarkdown } from "../scripts/workflow-inventory-report.mjs";

const normalizeWorkflowSurfaceMap = (source: string): string => {
  return source.trim().replace(/^Last updated: .+$/m, "Last updated: <normalized-date>");
};

describe("workflow surface map", () => {
  it("matches the generated workflow inventory output aside from the date stamp", () => {
    const documented = readFileSync(new URL("../docs/WORKFLOW_SURFACE_MAP.md", import.meta.url), "utf8");
    const rendered = renderWorkflowSurfaceMapMarkdown(buildWorkflowInventory());

    expect(normalizeWorkflowSurfaceMap(documented)).toBe(
      normalizeWorkflowSurfaceMap(rendered)
    );
  });
});
