import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createCloseTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Close a named page within the current session.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      name: z.string().describe("Named page to close")
    },
    async execute(args) {
      try {
        await deps.manager.closePage(args.sessionId, args.name);
        return ok({});
      } catch (error) {
        return failure(serializeError(error).message, "close_failed");
      }
    }
  });
}
