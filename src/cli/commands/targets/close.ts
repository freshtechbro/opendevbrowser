import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseTargetCloseArgs(rawArgs: string[]): { sessionId?: string; targetId?: string } {
  const parsed: { sessionId?: string; targetId?: string } = {};
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
    if (arg === "--target-id") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --target-id");
      parsed.targetId = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--target-id=")) {
      parsed.targetId = arg.split("=", 2)[1];
      continue;
    }
  }
  return parsed;
}

export async function runTargetClose(args: ParsedArgs) {
  const { sessionId, targetId } = parseTargetCloseArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!targetId) throw createUsageError("Missing --target-id");
  await callDaemon("targets.close", { sessionId, targetId });
  return { success: true, message: `Target closed: ${targetId}` };
}
