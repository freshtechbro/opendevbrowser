import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createNetworkPollTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Poll network events for the active target.",
    args: {
      sessionId: z.string().describe("Session id"),
      sinceSeq: z.number().int().optional().describe("Sequence to resume from"),
      max: z.number().int().optional().describe("Max events to return")
    },
    async execute(args) {
      try {
        const result = await deps.manager.networkPoll(
          args.sessionId,
          args.sinceSeq,
          args.max ?? 50
        );
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "network_poll_failed");
      }
    }
  });
}
