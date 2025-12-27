import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createClonePageTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Export the active page as a React component and CSS bundle.",
    args: {
      sessionId: z.string().describe("Active browser session id")
    },
    async execute(args) {
      try {
        const result = await deps.manager.clonePage(args.sessionId);
        return ok({ component: result.component, css: result.css });
      } catch (error) {
        return failure(serializeError(error).message, "clone_page_failed");
      }
    }
  });
}
