import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag } from "../../utils/parse";

function parseWaitArgs(rawArgs: string[]): { sessionId?: string; ref?: string; state?: string; until?: string; timeoutMs?: number } {
  const parsed: { sessionId?: string; ref?: string; state?: string; until?: string; timeoutMs?: number } = {};
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
    if (arg === "--state") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --state");
      parsed.state = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--state=")) {
      parsed.state = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--until") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --until");
      parsed.until = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--until=")) {
      parsed.until = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --timeout-ms");
      parsed.timeoutMs = parseNumberFlag(value, "--timeout-ms", { min: 1 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = parseNumberFlag(arg.split("=", 2)[1], "--timeout-ms", { min: 1 });
      continue;
    }
  }
  return parsed;
}

export async function runWait(args: ParsedArgs) {
  const { sessionId, ref, state, until, timeoutMs } = parseWaitArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  const result = await callDaemon("nav.wait", { sessionId, ref, state, until, timeoutMs });
  return { success: true, message: "Wait complete.", data: result };
}
