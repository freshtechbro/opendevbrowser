import { describe, expect, it } from "vitest";
import onboardingMetadata from "../src/cli/onboarding-metadata.json";
import { createSkillListTool } from "../src/tools/skill_list";
import { bundledSkillDirectories } from "../src/skills/bundled-skill-directories";

describe("createSkillListTool", () => {
  it("describes the tool as a first-contact local skill lane", () => {
    const tool = createSkillListTool({
      skills: {
        listSkills: async () => []
      }
    } as never);

    expect(tool.description).toBe(
      "List bundled and discovered skill packs before choosing a local onboarding or workflow lane; research/ and shopping/ stay alias-only this cycle."
    );
  });

  it("reports bundled alias directories separately from discoverable skills", async () => {
    const aliasOnlySkillEntries = bundledSkillDirectories
      .filter((entry) => entry.policy === "aliasOnly")
      .map((entry) => ({
        name: entry.name,
        aliasFor: entry.aliasFor,
        policy: "aliasOnly" as const
      }));

    const tool = createSkillListTool({
      skills: {
        listSkills: async () => [
          {
            name: "opendevbrowser-research",
            description: "Research workflow",
            version: "1.0.0",
            path: "/tmp/opendevbrowser-research/SKILL.md"
          },
          {
            name: "opendevbrowser-shopping",
            description: "Shopping workflow",
            version: "1.0.0",
            path: "/tmp/opendevbrowser-shopping/SKILL.md"
          }
        ]
      }
    } as never);

    const result = JSON.parse(await tool.execute({} as never));
    expect(result).toMatchObject({
      ok: true,
      count: 2,
      aliasCount: aliasOnlySkillEntries.length,
      bundledAliases: aliasOnlySkillEntries,
      notes: {
        aliasOnlyCompatibility: onboardingMetadata.skillDiscovery.aliasOnlyCycleNote,
        shadowRiskPath: onboardingMetadata.skillDiscovery.shadowRiskPath,
        shadowRiskSummary: onboardingMetadata.skillDiscovery.shadowRiskSummary,
        shadowRiskAction: onboardingMetadata.skillDiscovery.shadowRiskAction
      }
    });
  });
});
