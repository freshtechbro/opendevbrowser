import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseDisconnectArgs(rawArgs: string[]): { sessionId?: string; closeBrowser?: boolean } {
  const parsed: { sessionId?: string; closeBrowser?: boolean } = {};
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
    if (arg === "--close-browser") {
      parsed.closeBrowser = true;
      continue;
    }
  }
  return parsed;
}

export async function runSessionDisconnect(args: ParsedArgs) {
  const { sessionId, closeBrowser } = parseDisconnectArgs(args.rawArgs);
  if (!sessionId) {
    throw createUsageError("Missing --session-id");
  }
  await callDaemon("session.disconnect", { sessionId, closeBrowser });
  return { success: true, message: `Session disconnected: ${sessionId}` };
}
