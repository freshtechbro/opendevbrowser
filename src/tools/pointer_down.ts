import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createPointerDownTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Move to viewport coordinates and press a mouse button.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      targetId: z.string().optional().describe("Optional target id"),
      x: z.number().describe("Viewport x coordinate"),
      y: z.number().describe("Viewport y coordinate"),
      button: z.enum(["left", "middle", "right"]).optional().describe("Mouse button to press"),
      clickCount: z.number().int().positive().optional().describe("Associated click count")
    },
    async execute(args) {
      try {
        const result = await deps.manager.pointerDown(
          args.sessionId,
          args.x,
          args.y,
          args.targetId,
          args.button,
          args.clickCount
        );
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "pointer_down_failed");
      }
    }
  });
}
