import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

const waitUntilSchema = z.enum(["domcontentloaded", "load", "networkidle"]);

export function createGotoTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Navigate the active target to a URL.",
    args: {
      sessionId: z.string().describe("Session id"),
      url: z.string().describe("URL to navigate to"),
      waitUntil: waitUntilSchema.optional().describe("Load state to wait for"),
      timeoutMs: z.number().int().optional().describe("Timeout in milliseconds")
    },
    async execute(args) {
      try {
        const result = await deps.manager.goto(
          args.sessionId,
          args.url,
          args.waitUntil ?? "load",
          args.timeoutMs ?? 30000
        );
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "goto_failed");
      }
    }
  });
}
