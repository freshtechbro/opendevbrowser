import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseTargetsListArgs(rawArgs: string[]): { sessionId?: string; includeUrls?: boolean } {
  const parsed: { sessionId?: string; includeUrls?: boolean } = {};
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
    if (arg === "--include-urls") {
      parsed.includeUrls = true;
    }
  }
  return parsed;
}

export async function runTargetsList(args: ParsedArgs) {
  const { sessionId, includeUrls } = parseTargetsListArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  const result = await callDaemon("targets.list", { sessionId, includeUrls });
  return { success: true, message: `Targets listed for session: ${sessionId}`, data: result };
}
