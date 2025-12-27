import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createDisconnectTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Disconnect a browser session.",
    args: {
      sessionId: z.string().describe("Session id returned from launch/connect"),
      closeBrowser: z.boolean().optional().describe("Close the underlying browser process")
    },
    async execute(args) {
      try {
        await deps.manager.disconnect(args.sessionId, Boolean(args.closeBrowser));
        return ok({});
      } catch (error) {
        return failure(serializeError(error).message, "disconnect_failed");
      }
    }
  });
}
