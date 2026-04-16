import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { buildCorrelatedAuditBundle } from "../browser/session-inspector";
import { CHALLENGE_AUTOMATION_MODES } from "../challenges/types";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import {
  requireAutomationCoordinator,
  requireSessionInspectorHandle
} from "./automation-shared";

const z = tool.schema;
const challengeAutomationModeSchema = z.enum(CHALLENGE_AUTOMATION_MODES);

export function createSessionInspectorAuditTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Capture a correlated audit bundle across desktop evidence, browser review, and policy state.",
    args: {
      sessionId: z.string().describe("Session id"),
      targetId: z.string().optional().describe("Optional target id"),
      reason: z.string().optional().describe("Optional audit reason"),
      maxChars: z.number().int().optional().describe("Max characters for review output"),
      cursor: z.string().optional().describe("Cursor for paging"),
      includeUrls: z.boolean().optional().describe("Include target URLs in the targets summary"),
      sinceConsoleSeq: z.number().int().optional().describe("Resume cursor for console events"),
      sinceNetworkSeq: z.number().int().optional().describe("Resume cursor for network events"),
      sinceExceptionSeq: z.number().int().optional().describe("Resume cursor for exception events"),
      max: z.number().int().optional().describe("Max events per diagnostics channel"),
      requestId: z.string().optional().describe("Optional trace request id"),
      challengeAutomationMode: challengeAutomationModeSchema.optional().describe("Optional browser-scoped computer-use mode override")
    },
    async execute(args) {
      try {
        const coordinator = requireAutomationCoordinator(deps);
        if (typeof coordinator === "string") {
          return coordinator;
        }
        const inspector = requireSessionInspectorHandle(deps);
        if (typeof inspector === "string") {
          return inspector;
        }
        await deps.relay?.refresh?.().catch(() => undefined);
        const review = await coordinator.reviewDesktop({
          browserSessionId: args.sessionId,
          targetId: args.targetId,
          reason: args.reason,
          maxChars: args.maxChars,
          cursor: args.cursor
        });
        const challengePlan = await coordinator.inspectChallengePlan({
          browserSessionId: args.sessionId,
          targetId: args.targetId,
          runMode: args.challengeAutomationMode
        });
        const result = await buildCorrelatedAuditBundle({
          handle: inspector,
          browserSessionId: args.sessionId,
          targetId: args.targetId,
          observation: review.observation,
          review: review.verification,
          challengePlan,
          includeUrls: args.includeUrls,
          sinceConsoleSeq: args.sinceConsoleSeq,
          sinceNetworkSeq: args.sinceNetworkSeq,
          sinceExceptionSeq: args.sinceExceptionSeq,
          max: args.max,
          requestId: args.requestId,
          relayStatus: deps.relay?.status?.() ?? null
        });
        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "session_inspector_audit_failed");
      }
    }
  });
}
