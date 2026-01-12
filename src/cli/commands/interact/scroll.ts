import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseScrollArgs(rawArgs: string[]): { sessionId?: string; ref?: string; dy?: number } {
  const parsed: { sessionId?: string; ref?: string; dy?: number } = {};
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
    if (arg === "--dy") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --dy");
      parsed.dy = Number(value);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--dy=")) {
      parsed.dy = Number(arg.split("=", 2)[1]);
      continue;
    }
  }
  return parsed;
}

export async function runScroll(args: ParsedArgs) {
  const { sessionId, ref, dy } = parseScrollArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (typeof dy !== "number" || Number.isNaN(dy)) throw createUsageError("Missing --dy");
  const result = await callDaemon("interact.scroll", { sessionId, ref, dy });
  return { success: true, message: "Scroll complete.", data: result };
}
