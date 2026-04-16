import { createUsageError } from "../../errors";
import { parseNumberFlag } from "../../utils/parse";

export type SessionInspectorArgs = {
  sessionId?: string;
  includeUrls?: boolean;
  sinceConsoleSeq?: number;
  sinceNetworkSeq?: number;
  sinceExceptionSeq?: number;
  max?: number;
  requestId?: string;
};

export function parseSessionInspectorArgs(rawArgs: string[]): SessionInspectorArgs {
  const parsed: SessionInspectorArgs = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--include-urls") {
      parsed.includeUrls = true;
      continue;
    }
    if (arg === "--session-id" || arg?.startsWith("--session-id=")) {
      parsed.sessionId = readStringFlag(rawArgs, index, "--session-id");
      index += stepForValue(arg);
      continue;
    }
    if (arg === "--since-console-seq" || arg?.startsWith("--since-console-seq=")) {
      parsed.sinceConsoleSeq = readNumberFlag(rawArgs, index, "--since-console-seq", { min: 0 });
      index += stepForValue(arg);
      continue;
    }
    if (arg === "--since-network-seq" || arg?.startsWith("--since-network-seq=")) {
      parsed.sinceNetworkSeq = readNumberFlag(rawArgs, index, "--since-network-seq", { min: 0 });
      index += stepForValue(arg);
      continue;
    }
    if (arg === "--since-exception-seq" || arg?.startsWith("--since-exception-seq=")) {
      parsed.sinceExceptionSeq = readNumberFlag(rawArgs, index, "--since-exception-seq", { min: 0 });
      index += stepForValue(arg);
      continue;
    }
    if (arg === "--max" || arg?.startsWith("--max=")) {
      parsed.max = readNumberFlag(rawArgs, index, "--max", { min: 1 });
      index += stepForValue(arg);
      continue;
    }
    if (arg === "--request-id" || arg?.startsWith("--request-id=")) {
      parsed.requestId = readStringFlag(rawArgs, index, "--request-id");
      index += stepForValue(arg);
    }
  }

  return parsed;
}

function stepForValue(flag: string): number {
  return flag.includes("=") ? 0 : 1;
}

function readNumberFlag(
  rawArgs: string[],
  index: number,
  flag: string,
  options: { min?: number }
): number {
  return parseNumberFlag(readStringFlag(rawArgs, index, flag), flag, options);
}

function readStringFlag(rawArgs: string[], index: number, flag: string): string {
  const arg = rawArgs[index];
  const value = arg?.includes("=")
    ? arg.split("=", 2)[1]
    : rawArgs[index + 1];
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
}
