import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseConsolePollArgs(rawArgs: string[]): { sessionId?: string; sinceSeq?: number; max?: number } {
  const parsed: { sessionId?: string; sinceSeq?: number; max?: number } = {};
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
    if (arg === "--since-seq") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --since-seq");
      parsed.sinceSeq = Number(value);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--since-seq=")) {
      parsed.sinceSeq = Number(arg.split("=", 2)[1]);
      continue;
    }
    if (arg === "--max") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --max");
      parsed.max = Number(value);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--max=")) {
      parsed.max = Number(arg.split("=", 2)[1]);
      continue;
    }
  }
  return parsed;
}

export async function runConsolePoll(args: ParsedArgs) {
  const { sessionId, sinceSeq, max } = parseConsolePollArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  const result = await callDaemon("devtools.consolePoll", { sessionId, sinceSeq, max });
  return { success: true, message: "Console events polled.", data: result };
}
