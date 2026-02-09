import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag } from "../../utils/parse";

function parseGotoArgs(rawArgs: string[]): { sessionId?: string; url?: string; waitUntil?: string; timeoutMs?: number } {
  const parsed: { sessionId?: string; url?: string; waitUntil?: string; timeoutMs?: number } = {};
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
    if (arg === "--wait-until") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --wait-until");
      parsed.waitUntil = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--wait-until=")) {
      parsed.waitUntil = arg.split("=", 2)[1];
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
      continue;
    }
  }
  return parsed;
}

export async function runGoto(args: ParsedArgs) {
  const { sessionId, url, waitUntil, timeoutMs } = parseGotoArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!url) throw createUsageError("Missing --url");
  const result = await callDaemon("nav.goto", { sessionId, url, waitUntil, timeoutMs });
  return { success: true, message: `Navigated: ${url}`, data: result };
}
