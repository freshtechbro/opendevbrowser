import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createListTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "List named pages in the current session.",
    args: {
      sessionId: z.string().describe("Active browser session id")
    },
    async execute(args) {
      try {
        const result = await deps.manager.listPages(args.sessionId);
        return ok({ pages: result.pages });
      } catch (error) {
        return failure(serializeError(error).message, "list_failed");
      }
    }
  });
}
