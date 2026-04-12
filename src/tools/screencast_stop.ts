import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createScreencastStopTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Stop a browser screencast replay capture.",
    args: {
      sessionId: z.string().describe("Browser session id that owns the screencast"),
      screencastId: z.string().describe("Active screencast id")
    },
    async execute(args) {
      try {
        const result = await deps.manager.stopScreencast(args.sessionId, args.screencastId);
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "screencast_stop_failed");
      }
    }
  });
}
