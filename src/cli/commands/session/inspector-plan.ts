import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS } from "../../transport-timeouts";
import { parseOptionalStringFlag, parseNumberFlag } from "../../utils/parse";
import { buildNextStepMessage, readSuggestedStepReason } from "../../utils/workflow-message";
import { parseOptionalChallengeAutomationMode } from "../challenge-automation-mode";

function parseOptionalTimeoutMs(rawArgs: string[]): number | undefined {
  const value = parseOptionalStringFlag(rawArgs, "--timeout-ms");
  return typeof value === "string"
    ? parseNumberFlag(value, "--timeout-ms", { min: 1 })
    : undefined;
}

export async function runSessionInspectorPlan(args: ParsedArgs) {
  const sessionId = parseOptionalStringFlag(args.rawArgs, "--session-id");
  const targetId = parseOptionalStringFlag(args.rawArgs, "--target-id");
  const challengeAutomationMode = parseOptionalChallengeAutomationMode(args.rawArgs);
  const timeoutMs = parseOptionalTimeoutMs(args.rawArgs);
  if (!sessionId) {
    throw createUsageError("Missing --session-id");
  }
  const result = await callDaemon("session.inspectPlan", {
    sessionId,
    ...(typeof targetId === "string" ? { targetId } : {}),
    ...(challengeAutomationMode ? { challengeAutomationMode } : {})
  }, {
    timeoutMs: timeoutMs ?? DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS
  });
  return {
    success: true,
    message: buildNextStepMessage(
      "Challenge inspect plan captured.",
      readSuggestedStepReason(result)
    ),
    data: result
  };
}
