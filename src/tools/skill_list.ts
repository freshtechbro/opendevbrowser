import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { ok } from "./response";

export function createSkillListTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "List available skills from OpenCode skill directories (compatibility wrapper)",
    args: {},
    async execute() {
      const skills = await deps.skills.listSkills();
      const skillList = skills.map((s) => ({
        name: s.name,
        description: s.description,
        version: s.version
      }));
      return ok({ skills: skillList, count: skillList.length });
    }
  });
}
