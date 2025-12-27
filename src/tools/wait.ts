import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

const waitUntilSchema = z.enum(["domcontentloaded", "load", "networkidle"]);
const waitStateSchema = z.enum(["attached", "visible", "hidden"]);

export function createWaitTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Wait for a load state or a ref state.",
    args: {
      sessionId: z.string().describe("Session id"),
      until: waitUntilSchema.optional().describe("Load state to wait for"),
      ref: z.string().optional().describe("Ref to wait for"),
      state: waitStateSchema.optional().describe("Ref state to wait for"),
      timeoutMs: z.number().int().optional().describe("Timeout in milliseconds")
    },
    async execute(args) {
      try {
        if (args.ref) {
          const result = await deps.manager.waitForRef(
            args.sessionId,
            args.ref,
            args.state ?? "attached",
            args.timeoutMs ?? 30000
          );
          return ok(result);
        }

        if (!args.until) {
          return failure("Provide either ref or until", "wait_invalid");
        }

        const result = await deps.manager.waitForLoad(
          args.sessionId,
          args.until,
          args.timeoutMs ?? 30000
        );
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "wait_failed");
      }
    }
  });
}
