import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseOptionalStringFlag } from "../../utils/parse";
import {
  parsePointerButton,
  parsePointerClickCount,
  requirePointerCoordinate
} from "./pointer-shared";

export async function runPointerUp(args: ParsedArgs) {
  const sessionId = parseOptionalStringFlag(args.rawArgs, "--session-id");
  const targetId = parseOptionalStringFlag(args.rawArgs, "--target-id");
  const x = requirePointerCoordinate(args.rawArgs, "--x");
  const y = requirePointerCoordinate(args.rawArgs, "--y");
  const button = parsePointerButton(args.rawArgs);
  const clickCount = parsePointerClickCount(args.rawArgs);

  if (!sessionId) {
    throw createUsageError("Missing --session-id");
  }

  const result = await callDaemon("pointer.up", {
    sessionId,
    x,
    y,
    ...(typeof button === "string" ? { button } : {}),
    ...(typeof clickCount === "number" ? { clickCount } : {}),
    ...(typeof targetId === "string" ? { targetId } : {})
  });
  return { success: true, message: "Pointer up complete.", data: result };
}
