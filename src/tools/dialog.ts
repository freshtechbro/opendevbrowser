import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createDialogTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Inspect or handle a JavaScript dialog.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      targetId: z.string().optional().describe("Optional target id"),
      action: z.enum(["status", "accept", "dismiss"]).optional().describe("Dialog action"),
      promptText: z.string().optional().describe("Prompt text to submit when accepting a prompt dialog")
    },
    async execute(args) {
      try {
        const result = await deps.manager.dialog(args.sessionId, {
          targetId: args.targetId,
          action: args.action,
          promptText: args.promptText
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "dialog_failed");
      }
    }
  });
}
