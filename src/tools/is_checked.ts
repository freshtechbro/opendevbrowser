import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createIsCheckedTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Check if an element is checked by ref.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      ref: z.string().describe("Element ref from snapshot")
    },
    async execute(args) {
      try {
        const result = await deps.manager.domIsChecked(args.sessionId, args.ref);
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "is_checked_failed");
      }
    }
  });
}
