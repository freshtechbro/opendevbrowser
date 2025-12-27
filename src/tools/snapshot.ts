import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

const formatSchema = z.enum(["outline", "actionables"]);

export function createSnapshotTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Capture a snapshot of the current page and return refs.",
    args: {
      sessionId: z.string().describe("Session id"),
      format: formatSchema.optional().describe("Snapshot format"),
      maxChars: z.number().int().optional().describe("Max characters for snapshot output"),
      cursor: z.string().optional().describe("Cursor for paging")
    },
    async execute(args) {
      try {
        const config = deps.config.get();
        const result = await deps.manager.snapshot(
          args.sessionId,
          args.format ?? "outline",
          args.maxChars ?? config.snapshot.maxChars,
          args.cursor
        );
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "snapshot_failed");
      }
    }
  });
}
