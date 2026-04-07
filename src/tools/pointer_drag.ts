import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createPointerDragTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Drag the pointer between two viewport coordinates.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      targetId: z.string().optional().describe("Optional target id"),
      fromX: z.number().describe("Start x coordinate"),
      fromY: z.number().describe("Start y coordinate"),
      toX: z.number().describe("End x coordinate"),
      toY: z.number().describe("End y coordinate"),
      steps: z.number().int().positive().optional().describe("Optional drag interpolation step count")
    },
    async execute(args) {
      try {
        const result = await deps.manager.drag(
          args.sessionId,
          { x: args.fromX, y: args.fromY },
          { x: args.toX, y: args.toY },
          args.targetId,
          args.steps
        );
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "pointer_drag_failed");
      }
    }
  });
}
