import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

export function createUploadTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Upload files to an input or chooser by ref.",
    args: {
      sessionId: z.string().describe("Active browser session id"),
      targetId: z.string().optional().describe("Optional target id"),
      ref: z.string().describe("Element ref"),
      files: z.array(z.string()).min(1).describe("Local host file paths")
    },
    async execute(args) {
      try {
        const result = await deps.manager.upload(args.sessionId, {
          targetId: args.targetId,
          ref: args.ref,
          files: args.files
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "upload_failed");
      }
    }
  });
}
