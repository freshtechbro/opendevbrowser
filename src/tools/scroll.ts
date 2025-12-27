import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createScrollTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Scroll the page or a referenced element.",
    args: {
      sessionId: z.string().describe("Session id"),
      dy: z.number().describe("Scroll delta in pixels"),
      ref: z.string().optional().describe("Optional element ref to scroll")
    },
    async execute(args) {
      try {
        await deps.manager.scroll(args.sessionId, args.dy, args.ref);
        return ok({});
      } catch (error) {
        return failure(serializeError(error).message, "scroll_failed");
      }
    }
  });
}
