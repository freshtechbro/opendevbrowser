import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS } from "../../transport-timeouts";
import { parseReviewCommandArgs } from "./review-shared";

export async function runReviewDesktop(args: ParsedArgs) {
  const { sessionId, targetId, reason, maxChars, cursor, timeoutMs } = parseReviewCommandArgs(args.rawArgs);
  if (!sessionId) {
    throw createUsageError("Missing --session-id");
  }
  const result = await callDaemon("nav.reviewDesktop", {
    sessionId,
    ...(typeof targetId === "string" ? { targetId } : {}),
    ...(typeof reason === "string" ? { reason } : {}),
    ...(typeof maxChars === "number" ? { maxChars } : {}),
    ...(typeof cursor === "string" ? { cursor } : {})
  }, {
    timeoutMs: timeoutMs ?? DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS
  });
  return {
    success: true,
    message: "Desktop-assisted review captured.",
    data: result
  };
}
