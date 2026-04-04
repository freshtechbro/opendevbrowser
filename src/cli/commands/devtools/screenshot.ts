import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag, parseOptionalStringFlag } from "../../utils/parse";

type ScreenshotArgs = {
  sessionId?: string;
  targetId?: string;
  path?: string;
  ref?: string;
  fullPage?: boolean;
  timeoutMs?: number;
};

function parseScreenshotArgs(rawArgs: string[]): ScreenshotArgs {
  const timeoutValue = parseOptionalStringFlag(rawArgs, "--timeout-ms");
  const parsed: ScreenshotArgs = {
    sessionId: parseOptionalStringFlag(rawArgs, "--session-id"),
    targetId: parseOptionalStringFlag(rawArgs, "--target-id"),
    path: parseOptionalStringFlag(rawArgs, "--path"),
    ref: parseOptionalStringFlag(rawArgs, "--ref"),
    fullPage: rawArgs.includes("--full-page"),
    timeoutMs: typeof timeoutValue === "string"
      ? parseNumberFlag(timeoutValue, "--timeout-ms", { min: 1 })
      : undefined
  };
  if (parsed.ref && parsed.fullPage) {
    throw createUsageError("Choose either --ref or --full-page.");
  }
  return parsed;
}

export async function runScreenshot(args: ParsedArgs) {
  const { sessionId, targetId, path, ref, fullPage, timeoutMs } = parseScreenshotArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  const params = {
    sessionId,
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof targetId === "string" ? { targetId } : {}),
    ...(typeof ref === "string" ? { ref } : {}),
    ...(fullPage === true ? { fullPage: true } : {})
  };
  const result = typeof timeoutMs === "number"
    ? await callDaemon("page.screenshot", params, { timeoutMs })
    : await callDaemon("page.screenshot", params);
  return { success: true, message: "Screenshot captured.", data: result };
}

export const __test__ = {
  parseScreenshotArgs
};
