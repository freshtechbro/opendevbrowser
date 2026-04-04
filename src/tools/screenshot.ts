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
      targetId: z.string().optional().describe("Optional target id"),
      path: z.string().optional().describe("Optional output file path"),
      ref: z.string().optional().describe("Optional snapshot ref for an element capture"),
      fullPage: z.boolean().optional().describe("Capture the full scrollable page")
    },
    async execute(args) {
      try {
        const result = await deps.manager.screenshot(args.sessionId, {
          targetId: args.targetId,
          path: args.path,
          ref: args.ref,
          fullPage: args.fullPage
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "screenshot_failed");
      }
    }
  });
}
