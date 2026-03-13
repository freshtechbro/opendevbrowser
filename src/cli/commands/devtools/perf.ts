import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseOptionalStringFlag } from "../../utils/parse";

function parsePerfArgs(rawArgs: string[]): { sessionId?: string } {
  const parsed: { sessionId?: string } = {};
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
  }
  return parsed;
}

export async function runPerf(args: ParsedArgs) {
  const { sessionId } = parsePerfArgs(args.rawArgs);
  const targetId = parseOptionalStringFlag(args.rawArgs, "--target-id");
  if (!sessionId) throw createUsageError("Missing --session-id");
  const result = await callDaemon("devtools.perf", {
    sessionId,
    ...(typeof targetId === "string" ? { targetId } : {})
  });
  return { success: true, message: "Performance metrics captured.", data: result };
}
