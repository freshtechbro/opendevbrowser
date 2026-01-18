import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parsePageOpenArgs(rawArgs: string[]): { sessionId?: string; name?: string; url?: string } {
  const parsed: { sessionId?: string; name?: string; url?: string } = {};
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
    if (arg === "--url") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --url");
      parsed.url = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--url=")) {
      parsed.url = arg.split("=", 2)[1];
      continue;
    }
  }
  return parsed;
}

export async function runPageOpen(args: ParsedArgs) {
  const { sessionId, name, url } = parsePageOpenArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!name) throw createUsageError("Missing --name");
  const result = await callDaemon("page.open", { sessionId, name, url });
  return { success: true, message: `Page ready: ${name}`, data: result };
}
