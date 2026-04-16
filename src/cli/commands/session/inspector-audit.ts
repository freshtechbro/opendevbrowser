import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS } from "../../transport-timeouts";
import { parseOptionalStringFlag, parseNumberFlag } from "../../utils/parse";
import { parseOptionalChallengeAutomationMode } from "../challenge-automation-mode";
import { parseReviewCommandArgs } from "../nav/review-shared";
import { parseSessionInspectorArgs } from "./inspector-shared";

function parseOptionalTimeoutMs(rawArgs: string[]): number | undefined {
  const value = parseOptionalStringFlag(rawArgs, "--timeout-ms");
  return typeof value === "string"
    ? parseNumberFlag(value, "--timeout-ms", { min: 1 })
    : undefined;
}

export async function runSessionInspectorAudit(args: ParsedArgs) {
  const reviewArgs = parseReviewCommandArgs(args.rawArgs);
  const inspectorArgs = parseSessionInspectorArgs(args.rawArgs);
  const challengeAutomationMode = parseOptionalChallengeAutomationMode(args.rawArgs);
  const timeoutMs = parseOptionalTimeoutMs(args.rawArgs);
  const sessionId = reviewArgs.sessionId ?? inspectorArgs.sessionId;
  if (!sessionId) {
    throw createUsageError("Missing --session-id");
  }
  const result = await callDaemon("session.inspectAudit", {
    sessionId,
    ...(typeof reviewArgs.targetId === "string" ? { targetId: reviewArgs.targetId } : {}),
    ...(typeof reviewArgs.reason === "string" ? { reason: reviewArgs.reason } : {}),
    ...(typeof reviewArgs.maxChars === "number" ? { maxChars: reviewArgs.maxChars } : {}),
    ...(typeof reviewArgs.cursor === "string" ? { cursor: reviewArgs.cursor } : {}),
    ...(typeof inspectorArgs.includeUrls === "boolean" ? { includeUrls: inspectorArgs.includeUrls } : {}),
    ...(typeof inspectorArgs.sinceConsoleSeq === "number" ? { sinceConsoleSeq: inspectorArgs.sinceConsoleSeq } : {}),
    ...(typeof inspectorArgs.sinceNetworkSeq === "number" ? { sinceNetworkSeq: inspectorArgs.sinceNetworkSeq } : {}),
    ...(typeof inspectorArgs.sinceExceptionSeq === "number" ? { sinceExceptionSeq: inspectorArgs.sinceExceptionSeq } : {}),
    ...(typeof inspectorArgs.max === "number" ? { max: inspectorArgs.max } : {}),
    ...(typeof inspectorArgs.requestId === "string" ? { requestId: inspectorArgs.requestId } : {}),
    ...(challengeAutomationMode ? { challengeAutomationMode } : {})
  }, {
    timeoutMs: timeoutMs ?? DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS
  });
  return {
    success: true,
    message: "Correlated audit bundle captured.",
    data: result
  };
}
