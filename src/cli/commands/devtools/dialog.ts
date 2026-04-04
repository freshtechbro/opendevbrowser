import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { DEFAULT_DIALOG_TRANSPORT_TIMEOUT_MS } from "../../transport-timeouts";
import { parseOptionalStringFlag, parseNumberFlag } from "../../utils/parse";

type DialogArgs = {
  sessionId?: string;
  targetId?: string;
  action: "status" | "accept" | "dismiss";
  promptText?: string;
  timeoutMs?: number;
};

function parseDialogAction(value: string | undefined): "status" | "accept" | "dismiss" {
  if (!value) {
    return "status";
  }
  if (value === "status" || value === "accept" || value === "dismiss") {
    return value;
  }
  throw createUsageError(`Invalid --action: ${value}`);
}

function parseDialogArgs(rawArgs: string[]): DialogArgs {
  const timeoutValue = parseOptionalStringFlag(rawArgs, "--timeout-ms");
  const parsed: DialogArgs = {
    sessionId: parseOptionalStringFlag(rawArgs, "--session-id"),
    targetId: parseOptionalStringFlag(rawArgs, "--target-id"),
    action: parseDialogAction(parseOptionalStringFlag(rawArgs, "--action")),
    promptText: parseOptionalStringFlag(rawArgs, "--prompt-text"),
    timeoutMs: typeof timeoutValue === "string"
      ? parseNumberFlag(timeoutValue, "--timeout-ms", { min: 1 })
      : undefined
  };
  if (parsed.promptText && parsed.action !== "accept") {
    throw createUsageError("--prompt-text is only valid with --action accept");
  }
  return parsed;
}

export async function runDialog(args: ParsedArgs) {
  const { sessionId, targetId, action, promptText, timeoutMs } = parseDialogArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");
  const params = {
    sessionId,
    action,
    ...(typeof targetId === "string" ? { targetId } : {}),
    ...(typeof promptText === "string" ? { promptText } : {})
  };
  const result = await callDaemon("page.dialog", params, {
    timeoutMs: timeoutMs ?? DEFAULT_DIALOG_TRANSPORT_TIMEOUT_MS
  });
  return { success: true, message: "Dialog request complete.", data: result };
}

export const __test__ = {
  parseDialogArgs
};
