import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createTargetUseTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Set the active target (tab).",
    args: {
      sessionId: z.string().describe("Session id"),
      targetId: z.string().describe("Target id")
    },
    async execute(args) {
      try {
        const result = await deps.manager.useTarget(args.sessionId, args.targetId);
        return ok({
          activeTargetId: result.activeTargetId,
          url: result.url,
          title: result.title
        });
      } catch (error) {
        return failure(serializeError(error).message, "target_use_failed");
      }
    }
  });
}
