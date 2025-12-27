import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createDomGetTextTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Get inner text for a referenced element.",
    args: {
      sessionId: z.string().describe("Session id"),
      ref: z.string().describe("Element ref"),
      maxChars: z.number().int().optional().describe("Max characters")
    },
    async execute(args) {
      try {
        const result = await deps.manager.domGetText(
          args.sessionId,
          args.ref,
          args.maxChars ?? 8000
        );
        return ok({
          ref: args.ref,
          text: result.text,
          truncated: result.truncated
        });
      } catch (error) {
        return failure(serializeError(error).message, "dom_get_text_failed");
      }
    }
  });
}
