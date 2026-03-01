import { describe, expect, it } from "vitest";
import { getSurfaceCounts, runDocsDriftChecks } from "../scripts/docs-drift-check.mjs";

describe("docs-drift-check", () => {
  it("loads source surface counts", () => {
    const counts = getSurfaceCounts();
    expect(counts.commandCount).toBeGreaterThan(0);
    expect(counts.toolCount).toBeGreaterThan(0);
  });

  it("passes docs drift checks", () => {
    const result = runDocsDriftChecks();
    expect(result.ok).toBe(true);
  });
});
