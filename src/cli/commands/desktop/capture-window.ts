import type { ParsedArgs } from "../../args";
import {
  callDesktopCommand,
  desktopCommandResult,
  parseDesktopWindowReasonArgs,
  requireDesktopReason,
  requireDesktopWindowId
} from "./shared";

export async function runDesktopCaptureWindow(args: ParsedArgs) {
  const { windowId, reason, timeoutMs } = parseDesktopWindowReasonArgs(args.rawArgs);
  const result = await callDesktopCommand("desktop.capture.window", {
    windowId: requireDesktopWindowId(windowId),
    reason: requireDesktopReason(reason)
  }, timeoutMs);
  return desktopCommandResult("Desktop window captured.", result);
}
