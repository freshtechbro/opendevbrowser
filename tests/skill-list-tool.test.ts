import { describe, expect, it } from "vitest";
import { createSkillListTool } from "../src/tools/skill_list";

describe("createSkillListTool", () => {
  it("describes the tool as a first-contact local skill lane", () => {
    const tool = createSkillListTool({
      skills: {
        listSkills: async () => []
      }
    } as never);

    expect(tool.description).toBe(
      "List bundled and discovered skill packs before choosing a local onboarding or workflow lane."
    );
  });

  it("returns discovered skills and count only", async () => {
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
      skills: [
        {
          name: "opendevbrowser-research",
          description: "Research workflow",
          version: "1.0.0"
        },
        {
          name: "opendevbrowser-shopping",
          description: "Shopping workflow",
          version: "1.0.0"
        }
      ]
    });
  });
});
