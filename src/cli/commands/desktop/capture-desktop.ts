import type { ParsedArgs } from "../../args";
import {
  callDesktopCommand,
  desktopCommandResult,
  parseDesktopReasonArgs,
  requireDesktopReason
} from "./shared";

export async function runDesktopCaptureDesktop(args: ParsedArgs) {
  const { reason, timeoutMs } = parseDesktopReasonArgs(args.rawArgs);
  const result = await callDesktopCommand("desktop.capture.desktop", {
    reason: requireDesktopReason(reason)
  }, timeoutMs);
  return desktopCommandResult("Desktop captured.", result);
}
