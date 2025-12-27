import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createTypeTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Type text into a referenced input.",
    args: {
      sessionId: z.string().describe("Session id"),
      ref: z.string().describe("Element ref"),
      text: z.string().describe("Text to type"),
      clear: z.boolean().optional().describe("Clear before typing"),
      submit: z.boolean().optional().describe("Press Enter after typing")
    },
    async execute(args) {
      try {
        const result = await deps.manager.type(
          args.sessionId,
          args.ref,
          args.text,
          Boolean(args.clear),
          Boolean(args.submit)
        );
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "type_failed");
      }
    }
  });
}
