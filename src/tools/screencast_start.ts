import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createScreencastStartTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Start a browser screencast replay capture.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      targetId: z.string().optional().describe("Optional target id"),
      outputDir: z.string().optional().describe("Optional screencast output directory"),
      intervalMs: z.number().int().min(250).optional().describe("Frame capture interval in milliseconds"),
      maxFrames: z.number().int().min(1).optional().describe("Maximum frame count before auto-stop")
    },
    async execute(args) {
      try {
        const result = await deps.manager.startScreencast(args.sessionId, {
          targetId: args.targetId,
          outputDir: args.outputDir,
          intervalMs: args.intervalMs,
          maxFrames: args.maxFrames
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "screencast_start_failed");
      }
    }
  });
}
