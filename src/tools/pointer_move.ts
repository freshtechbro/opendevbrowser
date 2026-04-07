import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createPointerMoveTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Move the pointer to viewport coordinates.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      targetId: z.string().optional().describe("Optional target id"),
      x: z.number().describe("Viewport x coordinate"),
      y: z.number().describe("Viewport y coordinate"),
      steps: z.number().int().positive().optional().describe("Optional move interpolation step count")
    },
    async execute(args) {
      try {
        const result = await deps.manager.pointerMove(args.sessionId, args.x, args.y, args.targetId, args.steps);
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "pointer_move_failed");
      }
    }
  });
}
