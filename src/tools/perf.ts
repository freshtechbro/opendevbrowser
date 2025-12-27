import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createPerfTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Fetch lightweight performance metrics from the active page.",
    args: {
      sessionId: z.string().describe("Active browser session id")
    },
    async execute(args) {
      try {
        const result = await deps.manager.perfMetrics(args.sessionId);
        return ok({ metrics: result.metrics });
      } catch (error) {
        return failure(serializeError(error).message, "perf_failed");
      }
    }
  });
}
