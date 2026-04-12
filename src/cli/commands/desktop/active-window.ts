import type { ParsedArgs } from "../../args";
import { callDesktopCommand, desktopCommandResult, parseDesktopReasonArgs } from "./shared";

export async function runDesktopActiveWindow(args: ParsedArgs) {
  const { reason, timeoutMs } = parseDesktopReasonArgs(args.rawArgs);
  const result = await callDesktopCommand("desktop.window.active", {
    ...(typeof reason === "string" ? { reason } : {})
  }, timeoutMs);
  return desktopCommandResult("Active desktop window captured.", result);
}
