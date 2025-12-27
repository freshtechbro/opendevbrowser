import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createPageTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Open or focus a named page, optionally navigating to a URL.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      name: z.string().describe("Stable page name"),
      url: z.string().optional().describe("Optional URL to open")
    },
    async execute(args) {
      try {
        const result = await deps.manager.page(args.sessionId, args.name, args.url);
        return ok({
          targetId: result.targetId,
          created: result.created,
          url: result.url,
          title: result.title
        });
      } catch (error) {
        return failure(serializeError(error).message, "page_failed");
      }
    }
  });
}
