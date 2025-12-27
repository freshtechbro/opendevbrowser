import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createTargetCloseTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Close a target (tab).",
    args: {
      sessionId: z.string().describe("Session id"),
      targetId: z.string().describe("Target id")
    },
    async execute(args) {
      try {
        await deps.manager.closeTarget(args.sessionId, args.targetId);
        return ok({});
      } catch (error) {
        return failure(serializeError(error).message, "target_close_failed");
      }
    }
  });
}
