import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createTargetsListTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "List targets (tabs) in the current session.",
    args: {
      sessionId: z.string().describe("Session id"),
      includeUrls: z.boolean().optional().describe("Include target URLs")
    },
    async execute(args) {
      try {
        const result = await deps.manager.listTargets(args.sessionId, Boolean(args.includeUrls));
        return ok({
          activeTargetId: result.activeTargetId,
          targets: result.targets
        });
      } catch (error) {
        return failure(serializeError(error).message, "targets_list_failed");
      }
    }
  });
}
