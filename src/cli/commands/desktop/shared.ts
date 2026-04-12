import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS } from "../../transport-timeouts";
import { parseNumberFlag, parseOptionalStringFlag } from "../../utils/parse";
import type { CommandResult } from "../types";

type DesktopTimeoutArgs = {
  timeoutMs?: number;
};

export type DesktopReasonArgs = DesktopTimeoutArgs & {
  reason?: string;
};

export type DesktopWindowReasonArgs = DesktopReasonArgs & {
  windowId?: string;
};

export function parseDesktopTimeoutArgs(rawArgs: string[]): DesktopTimeoutArgs {
  const timeoutValue = parseOptionalStringFlag(rawArgs, "--timeout-ms");
  return {
    timeoutMs: typeof timeoutValue === "string"
      ? parseNumberFlag(timeoutValue, "--timeout-ms", { min: 1 })
      : undefined
  };
}

export function parseDesktopReasonArgs(rawArgs: string[]): DesktopReasonArgs {
  return {
    ...parseDesktopTimeoutArgs(rawArgs),
    reason: parseOptionalStringFlag(rawArgs, "--reason")
  };
}

export function parseDesktopWindowReasonArgs(rawArgs: string[]): DesktopWindowReasonArgs {
  return {
    ...parseDesktopReasonArgs(rawArgs),
    windowId: parseOptionalStringFlag(rawArgs, "--window-id")
  };
}

export function requireDesktopReason(reason?: string): string {
  if (!reason) {
    throw createUsageError("Missing --reason");
  }
  return reason;
}

export function requireDesktopWindowId(windowId?: string): string {
  if (!windowId) {
    throw createUsageError("Missing --window-id");
  }
  return windowId;
}

export async function callDesktopCommand(
  name: string,
  params: Record<string, unknown>,
  timeoutMs?: number
): Promise<unknown> {
  return callDaemon(name, params, {
    timeoutMs: timeoutMs ?? DEFAULT_SCREENSHOT_TRANSPORT_TIMEOUT_MS
  });
}

export function desktopCommandResult(message: string, data: unknown): CommandResult {
  return { success: true, message, data };
}
