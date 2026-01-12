import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseSnapshotArgs(rawArgs: string[]): { sessionId?: string; mode?: string; maxChars?: number; cursor?: string } {
  const parsed: { sessionId?: string; mode?: string; maxChars?: number; cursor?: string } = {};
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
    if (arg === "--mode") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --mode");
      parsed.mode = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--mode=")) {
      parsed.mode = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--max-chars") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --max-chars");
      parsed.maxChars = Number(value);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--max-chars=")) {
      parsed.maxChars = Number(arg.split("=", 2)[1]);
      continue;
    }
    if (arg === "--cursor") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --cursor");
      parsed.cursor = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--cursor=")) {
      parsed.cursor = arg.split("=", 2)[1];
      continue;
    }
  }
  return parsed;
}

export async function runSnapshot(args: ParsedArgs) {
  const { sessionId, mode, maxChars, cursor } = parseSnapshotArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  const result = await callDaemon("nav.snapshot", { sessionId, mode, maxChars, cursor });
  return { success: true, message: "Snapshot captured.", data: result };
}
