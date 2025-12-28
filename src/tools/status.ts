import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createStatusTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Get status of a browser session.",
    args: {
      sessionId: z.string().describe("Session id")
    },
    async execute(args) {
      try {
        const status = await deps.manager.status(args.sessionId);
        const extensionPath = deps.getExtensionPath?.() ?? null;
        
        return ok({
          mode: status.mode,
          activeTargetId: status.activeTargetId,
          url: status.url,
          title: status.title,
          extensionPath: extensionPath ?? undefined
        });
      } catch (error) {
        return failure(serializeError(error).message, "status_failed");
      }
    }
  });
}
