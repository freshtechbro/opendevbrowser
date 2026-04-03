import { describe, expect, it } from "vitest";
import { getSurfaceCounts, runDocsDriftChecks } from "../scripts/docs-drift-check.mjs";

describe("docs-drift-check", () => {
  it("loads source surface counts", () => {
    const counts = getSurfaceCounts();
    expect(counts.commandCount).toBeGreaterThan(0);
    expect(counts.toolCount).toBeGreaterThan(0);
    expect(counts.opsCommandCount).toBeGreaterThan(0);
  });

  it("passes docs drift checks", () => {
    const result = runDocsDriftChecks();
    const byId = new Map(result.checks.map((check) => [check.id, check]));
    for (const id of [
      "doc.readme.challenge_override_contract_documented",
      "doc.readme.skill_discovery_fallback_documented",
      "doc.readme.skill_inventory_split_documented",
      "doc.cli.challenge_override_contract_documented",
      "doc.cli.skill_discovery_fallback_documented",
      "doc.cli.skill_inventory_split_documented",
      "doc.cli.workflow_key_contract_documented",
      "doc.architecture.challenge_override_contract_documented",
      "doc.surface.challenge_override_contract_documented",
      "doc.surface.workflow_key_contract_documented",
      "doc.troubleshooting.workflow_key_contract_documented",
      "doc.privacy.challenge_override_boundary_documented",
      "doc.dependencies.challenge_override_config_audit_documented",
      "doc.cutover.challenge_override_sync_documented",
      "skill.continuity_ledger.core_markers_documented",
      "skill.data_extraction.core_markers_documented",
      "skill.product_presentation_asset.core_markers_documented"
    ]) {
      expect(byId.get(id)?.ok).toBe(true);
    }
    expect(result.ok).toBe(true);
  });
});
