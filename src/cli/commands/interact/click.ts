import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { DEFAULT_CLICK_TRANSPORT_TIMEOUT_MS } from "../../transport-timeouts";
import { parseNumberFlag, parseOptionalStringFlag } from "../../utils/parse";

type ClickArgs = {
  sessionId?: string;
  ref?: string;
  timeoutMs?: number;
};

function parseClickArgs(rawArgs: string[]): ClickArgs {
  const timeoutValue = parseOptionalStringFlag(rawArgs, "--timeout-ms");
  const parsed: ClickArgs = {
    timeoutMs: typeof timeoutValue === "string"
      ? parseNumberFlag(timeoutValue, "--timeout-ms", { min: 1 })
      : undefined
  };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--session-id") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --session-id");
      parsed.sessionId = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--session-id=")) {
      parsed.sessionId = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--ref") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --ref");
      parsed.ref = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--ref=")) {
      parsed.ref = arg.split("=", 2)[1];
      continue;
    }
  }
  return parsed;
}

export async function runClick(args: ParsedArgs) {
  const { sessionId, ref, timeoutMs } = parseClickArgs(args.rawArgs);
  const targetId = parseOptionalStringFlag(args.rawArgs, "--target-id");
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!ref) throw createUsageError("Missing --ref");
  const params = {
    sessionId,
    ref,
    ...(typeof targetId === "string" ? { targetId } : {})
  };
  const result = await callDaemon("interact.click", params, {
    timeoutMs: timeoutMs ?? DEFAULT_CLICK_TRANSPORT_TIMEOUT_MS
  });
  return { success: true, message: "Click complete.", data: result };
}
