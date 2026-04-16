import { describe, expect, it, vi } from "vitest";

async function loadDocsDriftModule() {
  vi.resetModules();
  vi.unmock("fs");
  vi.unmock("node:fs");
  return import("../scripts/docs-drift-check.mjs");
}

describe("docs-drift-check", () => {
  it("loads source surface counts", async () => {
    const { getSurfaceCounts } = await loadDocsDriftModule();
    const counts = getSurfaceCounts();
    expect(counts.commandCount).toBe(77);
    expect(counts.toolCount).toBe(70);
    expect(counts.opsCommandCount).toBeGreaterThan(0);
    expect(counts.commandNames).toHaveLength(counts.commandCount);
    expect(counts.toolNames).toHaveLength(counts.toolCount);
  });

  it("loads docs drift checks", async () => {
    const { runDocsDriftChecks } = await loadDocsDriftModule();
    const result = runDocsDriftChecks();
    const byId = new Map(result.checks.map((check) => [check.id, check]));
    for (const id of [
      "doc.readme.command_count_matches_source",
      "doc.readme.tool_count_matches_source",
      "doc.cli.inspiredesign_workflow_documented",
      "doc.workflow_surface_map.inspiredesign_documented",
      "doc.cli.no_stale_help_inventory_counts",
      "doc.cli.onboarding_help_path_documented",
      "doc.release_runbook.registry_consumer_smoke_documented",
      "doc.distribution.registry_consumer_smoke_documented",
      "doc.onboarding.help_led_quick_start_documented",
      "doc.readme.onboarding_owner_boundaries_documented",
      "doc.readme.computer_use_entry_documented",
      "doc.architecture.onboarding_owner_documented",
      "doc.architecture.onboarding_proof_lane_documented",
      "doc.readme.challenge_override_contract_documented",
      "doc.readme.browser_replay_and_desktop_observation_documented",
      "doc.readme.desktop_observation_swift_prerequisite_documented",
      "doc.readme.skill_discovery_fallback_documented",
      "doc.readme.skill_inventory_split_documented",
      "doc.cli.challenge_override_contract_documented",
      "doc.cli.computer_use_entry_documented",
      "doc.cli.browser_replay_and_desktop_observation_documented",
      "doc.cli.desktop_observation_swift_prerequisite_documented",
      "doc.cli.skill_discovery_fallback_documented",
      "doc.cli.skill_inventory_split_documented",
      "doc.cli.workflow_key_contract_documented",
      "doc.cli.canvas_plan_guidance_documented",
      "doc.architecture.challenge_override_contract_documented",
      "doc.architecture.desktop_observation_vs_desktop_agent_documented",
      "doc.architecture.canvas_plan_guidance_documented",
      "doc.design_canvas_spec.plan_guidance_documented",
      "doc.surface.challenge_override_contract_documented",
      "doc.surface.desktop_observation_public_plane_documented",
      "doc.surface.workflow_key_contract_documented",
      "doc.surface.canvas_plan_guidance_documented",
      "doc.troubleshooting.workflow_key_contract_documented",
      "doc.troubleshooting.desktop_observation_swift_prerequisite_documented",
      "doc.privacy.challenge_override_boundary_documented",
      "doc.privacy.desktop_observation_boundary_documented",
      "doc.dependencies.challenge_override_config_audit_documented",
      "doc.cutover.challenge_override_sync_documented",
      "skill.best_practices.canvas_plan_guidance_documented",
      "skill.command_channel_reference.canvas_and_annotation_markers_documented",
      "skill.parity_gates.replay_and_desktop_observation_documented",
      "skill.design_agent.canvas_validation_markers_documented",
      "skill.surface_audit_checklist.replay_and_desktop_observation_documented",
      "skill.continuity_ledger.core_markers_documented",
      "skill.data_extraction.core_markers_documented",
      "skill.product_presentation_asset.core_markers_documented"
    ]) {
      expect(byId.get(id)?.ok).toBe(true);
    }
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.failed.length).toBeGreaterThanOrEqual(0);
  });
});
