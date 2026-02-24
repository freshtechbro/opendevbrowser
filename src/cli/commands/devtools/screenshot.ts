import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag } from "../../utils/parse";

type ScreenshotArgs = {
  sessionId?: string;
  path?: string;
  timeoutMs?: number;
};

const requireValue = (value: string | undefined, flag: string): string => {
  if (!value) throw createUsageError(`Missing value for ${flag}`);
  return value;
};

function parseScreenshotArgs(rawArgs: string[]): ScreenshotArgs {
  const parsed: ScreenshotArgs = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--session-id") {
      parsed.sessionId = requireValue(rawArgs[i + 1], "--session-id");
      i += 1;
      continue;
    }
    if (arg?.startsWith("--session-id=")) {
      parsed.sessionId = requireValue(arg.split("=", 2)[1], "--session-id");
      continue;
    }
    if (arg === "--path") {
      parsed.path = requireValue(rawArgs[i + 1], "--path");
      i += 1;
      continue;
    }
    if (arg?.startsWith("--path=")) {
      parsed.path = requireValue(arg.split("=", 2)[1], "--path");
      continue;
    }
    if (arg === "--timeout-ms") {
      parsed.timeoutMs = parseNumberFlag(requireValue(rawArgs[i + 1], "--timeout-ms"), "--timeout-ms", { min: 1 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = parseNumberFlag(requireValue(arg.split("=", 2)[1], "--timeout-ms"), "--timeout-ms", { min: 1 });
      continue;
    }
  }
  return parsed;
}

export async function runScreenshot(args: ParsedArgs) {
  const { sessionId, path, timeoutMs } = parseScreenshotArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  const params = { sessionId, path };
  const result = typeof timeoutMs === "number"
    ? await callDaemon("page.screenshot", params, { timeoutMs })
    : await callDaemon("page.screenshot", params);
  return { success: true, message: "Screenshot captured.", data: result };
}

export const __test__ = {
  parseScreenshotArgs
};
