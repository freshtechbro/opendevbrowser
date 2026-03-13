import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createCanvasTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Execute a typed design-canvas command such as canvas.session.open or canvas.document.patch.",
    args: {
      command: z.string().min(1).describe("Canvas command name"),
      params: z.record(z.string(), z.unknown()).optional().describe("Canvas command payload")
    },
    async execute(args) {
      if (!deps.canvasManager) {
        return failure("Canvas manager unavailable.", "canvas_unavailable");
      }
      try {
        if (!args.command.startsWith("canvas.")) {
          return failure("Canvas commands must start with 'canvas.'.", "canvas_invalid_command");
        }
        const result = await deps.canvasManager.execute(args.command, args.params ?? {});
        if (result && typeof result === "object" && !Array.isArray(result)) {
          return ok(result as Record<string, unknown>);
        }
        return ok({ result });
      } catch (error) {
        const serialized = serializeError(error);
        return failure(serialized.message, serialized.code ?? "canvas_failed", serialized.details);
      }
    }
  });
}
