import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createDomGetHtmlTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Get outerHTML for a referenced element.",
    args: {
      sessionId: z.string().describe("Session id"),
      ref: z.string().describe("Element ref"),
      maxChars: z.number().int().optional().describe("Max characters")
    },
    async execute(args) {
      try {
        const result = await deps.manager.domGetHtml(
          args.sessionId,
          args.ref,
          args.maxChars ?? 8000
        );
        return ok({
          ref: args.ref,
          outerHTML: result.outerHTML,
          truncated: result.truncated
        });
      } catch (error) {
        return failure(serializeError(error).message, "dom_get_html_failed");
      }
    }
  });
}
