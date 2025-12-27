import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

const stepSchema = z.object({
  action: z.string().describe("Action name"),
  args: z.record(z.string(), z.unknown()).optional().describe("Action arguments")
});

export function createRunTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Run multiple actions in a single tool call.",
    args: {
      sessionId: z.string().describe("Session id"),
      steps: z.array(stepSchema).describe("Steps to execute"),
      stopOnError: z.boolean().optional().describe("Stop when a step fails"),
      maxSnapshotChars: z.number().int().optional().describe("Default maxChars for snapshot steps")
    },
    async execute(args) {
      try {
        const steps = normalizeSteps(args.steps, args.maxSnapshotChars);
        const result = await deps.runner.run(
          args.sessionId,
          steps,
          args.stopOnError ?? true
        );
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "run_failed");
      }
    }
  });
}

function normalizeSteps(
  steps: Array<{ action: string; args?: Record<string, unknown> }>,
  maxSnapshotChars?: number
): Array<{ action: string; args?: Record<string, unknown> }> {
  if (!maxSnapshotChars) return steps;

  return steps.map((step) => {
    if (step.action !== "snapshot") return step;
    if (step.args && typeof step.args.maxChars === "number") return step;
    return {
      ...step,
      args: {
        ...step.args,
        maxChars: maxSnapshotChars
      }
    };
  });
}
