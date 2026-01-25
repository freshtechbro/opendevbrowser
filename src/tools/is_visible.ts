import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createIsVisibleTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Check if an element is visible by ref.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      ref: z.string().describe("Element ref from snapshot")
    },
    async execute(args) {
      try {
        const result = await deps.manager.domIsVisible(args.sessionId, args.ref);
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "is_visible_failed");
      }
    }
  });
}
