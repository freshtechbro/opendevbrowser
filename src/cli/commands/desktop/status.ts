import type { ParsedArgs } from "../../args";
import { callDesktopCommand, desktopCommandResult, parseDesktopTimeoutArgs } from "./shared";

export async function runDesktopStatus(args: ParsedArgs) {
  const { timeoutMs } = parseDesktopTimeoutArgs(args.rawArgs);
  const result = await callDesktopCommand("desktop.status", {}, timeoutMs);
  return desktopCommandResult("Desktop status captured.", result);
}
