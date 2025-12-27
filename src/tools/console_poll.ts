import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createConsolePollTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Poll console events for the active target.",
    args: {
      sessionId: z.string().describe("Session id"),
      sinceSeq: z.number().int().optional().describe("Sequence to resume from"),
      max: z.number().int().optional().describe("Max events to return")
    },
    async execute(args) {
      try {
        const result = deps.manager.consolePoll(
          args.sessionId,
          args.sinceSeq,
          args.max ?? 50
        );
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "console_poll_failed");
      }
    }
  });
}
