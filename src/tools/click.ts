import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createClickTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Click a referenced element.",
    args: {
      sessionId: z.string().describe("Session id"),
      ref: z.string().describe("Element ref")
    },
    async execute(args) {
      try {
        const result = await deps.manager.click(args.sessionId, args.ref);
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "click_failed");
      }
    }
  });
}
