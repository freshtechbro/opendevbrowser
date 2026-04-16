import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { requireAutomationCoordinator } from "./automation-shared";

const z = tool.schema;

export function createReviewDesktopTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Capture desktop-assisted browser review with read-only desktop evidence and browser-owned verification.",
    args: {
      sessionId: z.string().describe("Session id"),
      targetId: z.string().optional().describe("Optional target id"),
      reason: z.string().optional().describe("Optional audit reason"),
      maxChars: z.number().int().optional().describe("Max characters for review output"),
      cursor: z.string().optional().describe("Cursor for paging")
    },
    async execute(args) {
      try {
        const coordinator = requireAutomationCoordinator(deps);
        if (typeof coordinator === "string") {
          return coordinator;
        }
        const result = await coordinator.reviewDesktop({
          browserSessionId: args.sessionId,
          targetId: args.targetId,
          reason: args.reason,
          maxChars: args.maxChars,
          cursor: args.cursor
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "review_desktop_failed");
      }
    }
  });
}
