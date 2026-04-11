import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS } from "../../transport-timeouts";
import { parseNumberFlag, parseOptionalStringFlag } from "../../utils/parse";

type ScreencastStopArgs = {
  screencastId?: string;
  timeoutMs?: number;
};

function parseScreencastStopArgs(rawArgs: string[]): ScreencastStopArgs {
  const timeoutValue = parseOptionalStringFlag(rawArgs, "--timeout-ms");
  return {
    screencastId: parseOptionalStringFlag(rawArgs, "--screencast-id"),
    timeoutMs: typeof timeoutValue === "string"
      ? parseNumberFlag(timeoutValue, "--timeout-ms", { min: 1 })
      : undefined
  };
}

export async function runScreencastStop(args: ParsedArgs) {
  const { screencastId, timeoutMs } = parseScreencastStopArgs(args.rawArgs);
  if (!screencastId) {
    throw createUsageError("Missing --screencast-id");
  }
  const result = await callDaemon("page.screencast.stop", { screencastId }, {
    timeoutMs: timeoutMs ?? DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS
  });
  return { success: true, message: "Screencast stopped.", data: result };
}

export const __test__ = {
  parseScreencastStopArgs
};
