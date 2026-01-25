import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseDomVisibleArgs(rawArgs: string[]): { sessionId?: string; ref?: string } {
  const parsed: { sessionId?: string; ref?: string } = {};
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

export async function runDomVisible(args: ParsedArgs) {
  const { sessionId, ref } = parseDomVisibleArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!ref) throw createUsageError("Missing --ref");
  const result = await callDaemon("dom.isVisible", { sessionId, ref });
  return { success: true, message: "Visibility checked.", data: result };
}
