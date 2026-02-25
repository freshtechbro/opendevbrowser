import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag } from "../../utils/parse";

type DebugTraceSnapshotArgs = {
  sessionId?: string;
  sinceConsoleSeq?: number;
  sinceNetworkSeq?: number;
  sinceExceptionSeq?: number;
  max?: number;
  requestId?: string;
};

function parseDebugTraceSnapshotArgs(rawArgs: string[]): DebugTraceSnapshotArgs {
  const parsed: DebugTraceSnapshotArgs = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--session-id") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --session-id");
      parsed.sessionId = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--session-id=")) {
      parsed.sessionId = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--since-console-seq") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --since-console-seq");
      parsed.sinceConsoleSeq = parseNumberFlag(value, "--since-console-seq", { min: 0 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--since-console-seq=")) {
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --since-console-seq");
      parsed.sinceConsoleSeq = parseNumberFlag(value, "--since-console-seq", { min: 0 });
      continue;
    }

    if (arg === "--since-network-seq") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --since-network-seq");
      parsed.sinceNetworkSeq = parseNumberFlag(value, "--since-network-seq", { min: 0 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--since-network-seq=")) {
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --since-network-seq");
      parsed.sinceNetworkSeq = parseNumberFlag(value, "--since-network-seq", { min: 0 });
      continue;
    }

    if (arg === "--since-exception-seq") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --since-exception-seq");
      parsed.sinceExceptionSeq = parseNumberFlag(value, "--since-exception-seq", { min: 0 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--since-exception-seq=")) {
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --since-exception-seq");
      parsed.sinceExceptionSeq = parseNumberFlag(value, "--since-exception-seq", { min: 0 });
      continue;
    }

    if (arg === "--max") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --max");
      parsed.max = parseNumberFlag(value, "--max", { min: 1 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--max=")) {
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --max");
      parsed.max = parseNumberFlag(value, "--max", { min: 1 });
      continue;
    }

    if (arg === "--request-id") {
      const value = rawArgs[index + 1];
      if (!value) throw createUsageError("Missing value for --request-id");
      parsed.requestId = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--request-id=")) {
      const value = arg.split("=", 2)[1];
      if (!value) throw createUsageError("Missing value for --request-id");
      parsed.requestId = value;
      continue;
    }
  }

  return parsed;
}

export async function runDebugTraceSnapshot(args: ParsedArgs) {
  const parsed = parseDebugTraceSnapshotArgs(args.rawArgs);
  if (!parsed.sessionId) {
    throw createUsageError("Missing --session-id");
  }

  const result = await callDaemon("devtools.debugTraceSnapshot", {
    sessionId: parsed.sessionId,
    sinceConsoleSeq: parsed.sinceConsoleSeq,
    sinceNetworkSeq: parsed.sinceNetworkSeq,
    sinceExceptionSeq: parsed.sinceExceptionSeq,
    max: parsed.max,
    requestId: parsed.requestId
  });

  return {
    success: true,
    message: "Debug trace snapshot captured.",
    data: result
  };
}

export const __test__ = {
  parseDebugTraceSnapshotArgs
};
