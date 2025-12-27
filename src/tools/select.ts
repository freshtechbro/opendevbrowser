import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createSelectTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Select options in a referenced select element.",
    args: {
      sessionId: z.string().describe("Session id"),
      ref: z.string().describe("Element ref"),
      values: z.array(z.string()).describe("Values to select")
    },
    async execute(args) {
      try {
        await deps.manager.select(args.sessionId, args.ref, args.values);
        return ok({});
      } catch (error) {
        return failure(serializeError(error).message, "select_failed");
      }
    }
  });
}
