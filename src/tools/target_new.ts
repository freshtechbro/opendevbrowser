import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createTargetNewTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Open a new target (tab).",
    args: {
      sessionId: z.string().describe("Session id"),
      url: z.string().optional().describe("Optional URL to open")
    },
    async execute(args) {
      try {
        const result = await deps.manager.newTarget(args.sessionId, args.url);
        return ok({ targetId: result.targetId });
      } catch (error) {
        return failure(serializeError(error).message, "target_new_failed");
      }
    }
  });
}
