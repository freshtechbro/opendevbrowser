import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

function parseDomAttrArgs(rawArgs: string[]): { sessionId?: string; ref?: string; attr?: string } {
  const parsed: { sessionId?: string; ref?: string; attr?: string } = {};
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
    if (arg === "--attr") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --attr");
      parsed.attr = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--attr=")) {
      parsed.attr = arg.split("=", 2)[1];
      continue;
    }
  }
  return parsed;
}

export async function runDomAttr(args: ParsedArgs) {
  const { sessionId, ref, attr } = parseDomAttrArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  if (!ref) throw createUsageError("Missing --ref");
  if (!attr) throw createUsageError("Missing --attr");
  const result = await callDaemon("dom.getAttr", { sessionId, ref, name: attr });
  return { success: true, message: "DOM attribute captured.", data: result };
}
