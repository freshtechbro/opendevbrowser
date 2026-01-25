import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createScrollIntoViewTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Scroll an element into view by ref.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      ref: z.string().describe("Element ref from snapshot")
    },
    async execute(args) {
      try {
        const result = await deps.manager.scrollIntoView(args.sessionId, args.ref);
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "scroll_into_view_failed");
      }
    }
  });
}
