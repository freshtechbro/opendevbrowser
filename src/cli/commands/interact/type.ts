import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseTypeArgs(rawArgs: string[]): { sessionId?: string; ref?: string; text?: string; clear?: boolean; submit?: boolean } {
  const parsed: { sessionId?: string; ref?: string; text?: string; clear?: boolean; submit?: boolean } = {};
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
    if (arg === "--text") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --text");
      parsed.text = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--text=")) {
      parsed.text = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--clear") {
      parsed.clear = true;
      continue;
    }
    if (arg === "--submit") {
      parsed.submit = true;
      continue;
    }
  }
  return parsed;
}

export async function runType(args: ParsedArgs) {
  const { sessionId, ref, text, clear, submit } = parseTypeArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!ref) throw createUsageError("Missing --ref");
  if (!text) throw createUsageError("Missing --text");
  const result = await callDaemon("interact.type", { sessionId, ref, text, clear, submit });
  return { success: true, message: "Type complete.", data: result };
}
