import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import onboardingMetadata from "../cli/onboarding-metadata.json";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createPromptingGuideTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: `Start here for first-contact OpenDevBrowser guidance, including ${onboardingMetadata.skillName} ${onboardingMetadata.skillTopic}.`,
    args: {
      topic: z.string().optional().describe("Optional topic for guidance")
    },
    async execute(args) {
      try {
        const guide = await deps.skills.loadBestPractices(args.topic);
        return ok({ guide });
      } catch (error) {
        return failure(serializeError(error).message, "prompting_guide_failed");
      }
    }
  });
}
