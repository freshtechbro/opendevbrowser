import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createPressTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Press a keyboard key, optionally focusing a ref first.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      key: z.string().describe("Keyboard key to press, e.g. Enter or ArrowDown"),
      ref: z.string().optional().describe("Optional element ref to focus first")
    },
    async execute(args) {
      try {
        const result = await deps.manager.press(args.sessionId, args.key, args.ref);
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "press_failed");
      }
    }
  });
}
