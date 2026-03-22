import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseOptionalStringFlag } from "../../utils/parse";
import { parsePointerSteps, requirePointerCoordinate } from "./pointer-shared";

export async function runPointerDrag(args: ParsedArgs) {
  const sessionId = parseOptionalStringFlag(args.rawArgs, "--session-id");
  const targetId = parseOptionalStringFlag(args.rawArgs, "--target-id");
  const fromX = requirePointerCoordinate(args.rawArgs, "--from-x");
  const fromY = requirePointerCoordinate(args.rawArgs, "--from-y");
  const toX = requirePointerCoordinate(args.rawArgs, "--to-x");
  const toY = requirePointerCoordinate(args.rawArgs, "--to-y");
  const steps = parsePointerSteps(args.rawArgs);

  if (!sessionId) {
    throw createUsageError("Missing --session-id");
  }

  const result = await callDaemon("pointer.drag", {
    sessionId,
    from: { x: fromX, y: fromY },
    to: { x: toX, y: toY },
    ...(typeof steps === "number" ? { steps } : {}),
    ...(typeof targetId === "string" ? { targetId } : {})
  });
  return { success: true, message: "Pointer drag complete.", data: result };
}
