import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS } from "../../transport-timeouts";
import { parseNumberFlag, parseOptionalStringFlag } from "../../utils/parse";

type ScreencastStartArgs = {
  sessionId?: string;
  targetId?: string;
  outputDir?: string;
  intervalMs?: number;
  maxFrames?: number;
  timeoutMs?: number;
};

function parseScreencastStartArgs(rawArgs: string[]): ScreencastStartArgs {
  const intervalValue = parseOptionalStringFlag(rawArgs, "--interval-ms");
  const maxFramesValue = parseOptionalStringFlag(rawArgs, "--max-frames");
  const timeoutValue = parseOptionalStringFlag(rawArgs, "--timeout-ms");
  return {
    sessionId: parseOptionalStringFlag(rawArgs, "--session-id"),
    targetId: parseOptionalStringFlag(rawArgs, "--target-id"),
    outputDir: parseOptionalStringFlag(rawArgs, "--output-dir"),
    intervalMs: typeof intervalValue === "string"
      ? parseNumberFlag(intervalValue, "--interval-ms", { min: 250 })
      : undefined,
    maxFrames: typeof maxFramesValue === "string"
      ? parseNumberFlag(maxFramesValue, "--max-frames", { min: 1 })
      : undefined,
    timeoutMs: typeof timeoutValue === "string"
      ? parseNumberFlag(timeoutValue, "--timeout-ms", { min: 1 })
      : undefined
  };
}

export async function runScreencastStart(args: ParsedArgs) {
  const { sessionId, targetId, outputDir, intervalMs, maxFrames, timeoutMs } = parseScreencastStartArgs(args.rawArgs);
  if (!sessionId) {
    throw createUsageError("Missing --session-id");
  }
  const result = await callDaemon("page.screencast.start", {
    sessionId,
    ...(typeof targetId === "string" ? { targetId } : {}),
    ...(typeof outputDir === "string" ? { outputDir } : {}),
    ...(typeof intervalMs === "number" ? { intervalMs } : {}),
    ...(typeof maxFrames === "number" ? { maxFrames } : {})
  }, {
    timeoutMs: timeoutMs ?? DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS
  });
  return { success: true, message: "Screencast started.", data: result };
}

export const __test__ = {
  parseScreencastStartArgs
};
