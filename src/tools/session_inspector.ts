import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { inspectSession } from "../browser/session-inspector";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { requireSessionInspectorHandle } from "./automation-shared";

const z = tool.schema;

export function createSessionInspectorTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action.",
    args: {
      sessionId: z.string().describe("Session id"),
      includeUrls: z.boolean().optional().describe("Include target URLs in the targets summary"),
      sinceConsoleSeq: z.number().int().optional().describe("Resume cursor for console events"),
      sinceNetworkSeq: z.number().int().optional().describe("Resume cursor for network events"),
      sinceExceptionSeq: z.number().int().optional().describe("Resume cursor for exception events"),
      max: z.number().int().optional().describe("Max events per diagnostics channel"),
      requestId: z.string().optional().describe("Optional trace request id")
    },
    async execute(args) {
      try {
        const inspector = requireSessionInspectorHandle(deps);
        if (typeof inspector === "string") {
          return inspector;
        }

        await deps.relay?.refresh?.().catch(() => undefined);
        const relayStatus = deps.relay?.status?.() ?? null;
        const result = await inspectSession(inspector, {
          sessionId: args.sessionId,
          includeUrls: args.includeUrls,
          sinceConsoleSeq: args.sinceConsoleSeq,
          sinceNetworkSeq: args.sinceNetworkSeq,
          sinceExceptionSeq: args.sinceExceptionSeq,
          max: args.max,
          requestId: args.requestId,
          relayStatus
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "session_inspector_failed");
      }
    }
  });
}
