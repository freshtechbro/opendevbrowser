import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { ok, failure } from "./response";

const z = tool.schema;

export function createSkillLoadTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Load a specific browser automation skill by name for specialized guidance on tasks like login automation, form testing, or data extraction",
    args: {
      name: z.string().describe("Name of the skill to load (e.g., 'login-automation', 'form-testing')"),
      topic: z.string().optional().describe("Optional topic to filter the skill content")
    },
    async execute(args) {
      try {
        const content = await deps.skills.loadSkill(args.name, args.topic);
        return ok({ skill: args.name, topic: args.topic, content });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure(`Failed to load skill '${args.name}': ${message}`, "SKILL_NOT_FOUND");
      }
    }
  });
}
