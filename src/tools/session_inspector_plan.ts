import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { CHALLENGE_AUTOMATION_MODES } from "../challenges/types";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { requireAutomationCoordinator } from "./automation-shared";

const z = tool.schema;
const challengeAutomationModeSchema = z.enum(CHALLENGE_AUTOMATION_MODES);

export function createSessionInspectorPlanTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Inspect browser-scoped computer-use policy, eligibility, and safe suggested steps.",
    args: {
      sessionId: z.string().describe("Session id"),
      targetId: z.string().optional().describe("Optional target id"),
      challengeAutomationMode: challengeAutomationModeSchema.optional().describe("Optional browser-scoped computer-use mode override")
    },
    async execute(args) {
      try {
        const coordinator = requireAutomationCoordinator(deps);
        if (typeof coordinator === "string") {
          return coordinator;
        }
        const result = await coordinator.inspectChallengePlan({
          browserSessionId: args.sessionId,
          targetId: args.targetId,
          runMode: args.challengeAutomationMode
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "session_inspector_plan_failed");
      }
    }
  });
}
