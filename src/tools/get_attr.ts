import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createGetAttrTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Get a DOM attribute value by ref.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      ref: z.string().describe("Element ref from snapshot"),
      name: z.string().describe("Attribute name, e.g. href or aria-label")
    },
    async execute(args) {
      try {
        const result = await deps.manager.domGetAttr(args.sessionId, args.ref, args.name);
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "get_attr_failed");
      }
    }
  });
}
