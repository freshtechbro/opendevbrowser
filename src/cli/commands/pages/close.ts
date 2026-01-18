import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parsePageCloseArgs(rawArgs: string[]): { sessionId?: string; name?: string } {
  const parsed: { sessionId?: string; name?: string } = {};
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
    if (arg === "--name") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --name");
      parsed.name = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--name=")) {
      parsed.name = arg.split("=", 2)[1];
      continue;
    }
  }
  return parsed;
}

export async function runPageClose(args: ParsedArgs) {
  const { sessionId, name } = parsePageCloseArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!name) throw createUsageError("Missing --name");
  await callDaemon("page.close", { sessionId, name });
  return { success: true, message: `Page closed: ${name}` };
}
