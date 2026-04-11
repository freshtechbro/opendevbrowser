import type { ParsedArgs } from "../../args";
import {
  callDesktopCommand,
  desktopCommandResult,
  parseDesktopWindowReasonArgs,
  requireDesktopReason
} from "./shared";

export async function runDesktopAccessibilitySnapshot(args: ParsedArgs) {
  const { windowId, reason, timeoutMs } = parseDesktopWindowReasonArgs(args.rawArgs);
  const result = await callDesktopCommand("desktop.accessibility.snapshot", {
    reason: requireDesktopReason(reason),
    ...(typeof windowId === "string" ? { windowId } : {})
  }, timeoutMs);
  return desktopCommandResult("Desktop accessibility snapshot captured.", result);
}
