import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parsePressArgs(rawArgs: string[]): { sessionId?: string; key?: string; ref?: string } {
  const parsed: { sessionId?: string; key?: string; ref?: string } = {};
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
    if (arg === "--key") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --key");
      parsed.key = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--key=")) {
      parsed.key = arg.split("=", 2)[1];
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

export async function runPress(args: ParsedArgs) {
  const { sessionId, key, ref } = parsePressArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!key) throw createUsageError("Missing --key");
  const result = await callDaemon("interact.press", { sessionId, key, ref });
  return { success: true, message: "Key press complete.", data: result };
}
