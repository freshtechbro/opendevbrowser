import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseSessionInspectorArgs } from "./inspector-shared";

export async function runSessionInspector(args: ParsedArgs) {
  const parsed = parseSessionInspectorArgs(args.rawArgs);
  if (!parsed.sessionId) {
    throw createUsageError("Missing --session-id");
  }

  const result = await callDaemon("session.inspect", {
    sessionId: parsed.sessionId,
    ...(typeof parsed.includeUrls === "boolean" ? { includeUrls: parsed.includeUrls } : {}),
    sinceConsoleSeq: parsed.sinceConsoleSeq,
    sinceNetworkSeq: parsed.sinceNetworkSeq,
    sinceExceptionSeq: parsed.sinceExceptionSeq,
    max: parsed.max,
    requestId: parsed.requestId
  });

  return {
    success: true,
    message: "Session inspector snapshot captured.",
    data: result
  };
}

export const __test__ = {
  parseSessionInspectorArgs
};
