import type { ParsedArgs } from "../../args";
import { callDesktopCommand, desktopCommandResult, parseDesktopReasonArgs } from "./shared";

export async function runDesktopWindows(args: ParsedArgs) {
  const { reason, timeoutMs } = parseDesktopReasonArgs(args.rawArgs);
  const result = await callDesktopCommand("desktop.windows.list", {
    ...(typeof reason === "string" ? { reason } : {})
  }, timeoutMs);
  return desktopCommandResult("Desktop windows listed.", result);
}
