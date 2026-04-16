import type { ParsedArgs } from "../args";
import { callDaemon } from "../client";
import { DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS } from "../transport-timeouts";
import { parseOptionalStringFlag, parseNumberFlag } from "../utils/parse";
import { parseOptionalChallengeAutomationMode } from "./challenge-automation-mode";

function parseOptionalTimeoutMs(rawArgs: string[]): number | undefined {
  const value = parseOptionalStringFlag(rawArgs, "--timeout-ms");
  return typeof value === "string"
    ? parseNumberFlag(value, "--timeout-ms", { min: 1 })
    : undefined;
}

export async function runStatusCapabilities(args: ParsedArgs) {
  const sessionId = parseOptionalStringFlag(args.rawArgs, "--session-id");
  const targetId = parseOptionalStringFlag(args.rawArgs, "--target-id");
  const challengeAutomationMode = parseOptionalChallengeAutomationMode(args.rawArgs);
  const timeoutMs = parseOptionalTimeoutMs(args.rawArgs);
  const result = await callDaemon("status.capabilities", {
    ...(typeof sessionId === "string" ? { sessionId } : {}),
    ...(typeof targetId === "string" ? { targetId } : {}),
    ...(challengeAutomationMode ? { challengeAutomationMode } : {})
  }, {
    timeoutMs: timeoutMs ?? DEFAULT_REVIEW_TRANSPORT_TIMEOUT_MS
  });
  return {
    success: true,
    message: "Capability discovery captured.",
    data: result
  };
}
