import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag, parseOptionalStringFlag } from "../../utils/parse";

function parseSnapshotArgs(rawArgs: string[]): { sessionId?: string; mode?: string; maxChars?: number; cursor?: string; timeoutMs?: number } {
  const parsed: { sessionId?: string; mode?: string; maxChars?: number; cursor?: string; timeoutMs?: number } = {};
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
    if (arg === "--timeout-ms") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --timeout-ms");
      parsed.timeoutMs = parseNumberFlag(value, "--timeout-ms", { min: 1 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--timeout-ms=")) {
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --timeout-ms");
      parsed.timeoutMs = parseNumberFlag(value, "--timeout-ms", { min: 1 });
    }
  }
  return parsed;
}

export async function runSnapshot(args: ParsedArgs) {
  const { sessionId, mode, maxChars, cursor, timeoutMs } = parseSnapshotArgs(args.rawArgs);
  const targetId = parseOptionalStringFlag(args.rawArgs, "--target-id");
  if (!sessionId) throw createUsageError("Missing --session-id");
  const payload = {
    sessionId,
    mode,
    maxChars,
    cursor,
    ...(typeof targetId === "string" ? { targetId } : {})
  };
  const result = timeoutMs
    ? await callDaemon("nav.snapshot", payload, { timeoutMs })
    : await callDaemon("nav.snapshot", payload);
  return { success: true, message: "Snapshot captured.", data: result };
}
