import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseSelectArgs(rawArgs: string[]): { sessionId?: string; ref?: string; values?: string[] } {
  const parsed: { sessionId?: string; ref?: string; values?: string[] } = {};
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
    if (arg === "--values") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --values");
      parsed.values = value.split(",").map((entry) => entry.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--values=")) {
      parsed.values = arg.split("=", 2)[1].split(",").map((entry) => entry.trim()).filter(Boolean);
      continue;
    }
  }
  return parsed;
}

export async function runSelect(args: ParsedArgs) {
  const { sessionId, ref, values } = parseSelectArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!ref) throw createUsageError("Missing --ref");
  if (!values || values.length === 0) throw createUsageError("Missing --values");
  const result = await callDaemon("interact.select", { sessionId, ref, values });
  return { success: true, message: "Select complete.", data: result };
}
