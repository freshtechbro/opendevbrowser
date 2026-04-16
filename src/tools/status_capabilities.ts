import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { CHALLENGE_AUTOMATION_MODES } from "../challenges/types";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { requireAutomationCoordinator } from "./automation-shared";

const z = tool.schema;
const challengeAutomationModeSchema = z.enum(CHALLENGE_AUTOMATION_MODES);

export function createStatusCapabilitiesTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Inspect runtime capability discovery for the host and an optional session.",
    args: {
      sessionId: z.string().optional().describe("Optional session id"),
      targetId: z.string().optional().describe("Optional target id"),
      challengeAutomationMode: challengeAutomationModeSchema.optional().describe("Optional browser-scoped computer-use mode override")
    },
    async execute(args) {
      try {
        const coordinator = requireAutomationCoordinator(deps);
        if (typeof coordinator === "string") {
          return coordinator;
        }
        const result = await coordinator.statusCapabilities({
          browserSessionId: args.sessionId,
          targetId: args.targetId,
          runMode: args.challengeAutomationMode
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "status_capabilities_failed");
      }
    }
  });
}
