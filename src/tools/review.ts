import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { buildBrowserReviewResult } from "../browser/review-surface";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createReviewTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Capture a first-class review payload with status and actionables.",
    args: {
      sessionId: z.string().describe("Session id"),
      targetId: z.string().optional().describe("Optional target id"),
      maxChars: z.number().int().optional().describe("Max characters for review output"),
      cursor: z.string().optional().describe("Cursor for paging")
    },
    async execute(args) {
      try {
        const config = deps.config.get();
        const result = await buildBrowserReviewResult({
          manager: deps.manager,
          sessionId: args.sessionId,
          targetId: args.targetId,
          maxChars: args.maxChars ?? config.snapshot.maxChars,
          cursor: args.cursor
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "review_failed");
      }
    }
  });
}
