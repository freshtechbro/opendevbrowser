import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS } from "../../transport-timeouts";
import { parseReviewCommandArgs } from "./review-shared";

export async function runReview(args: ParsedArgs) {
  const { sessionId, targetId, maxChars, cursor, timeoutMs } = parseReviewCommandArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  const payload = {
    sessionId,
    maxChars,
    cursor,
    ...(typeof targetId === "string" ? { targetId } : {})
  };
  const result = await callDaemon("nav.review", payload, {
    timeoutMs: timeoutMs ?? DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS
  });
  return { success: true, message: "Review captured.", data: result };
}
