import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createScreenshotTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Capture a screenshot of the active page.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      path: z.string().optional().describe("Optional output file path")
    },
    async execute(args) {
      try {
        const result = await deps.manager.screenshot(args.sessionId, args.path);
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "screenshot_failed");
      }
    }
  });
}
