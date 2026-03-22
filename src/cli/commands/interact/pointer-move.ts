import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseOptionalStringFlag } from "../../utils/parse";
import { parsePointerSteps, requirePointerCoordinate } from "./pointer-shared";

export async function runPointerMove(args: ParsedArgs) {
  const sessionId = parseOptionalStringFlag(args.rawArgs, "--session-id");
  const targetId = parseOptionalStringFlag(args.rawArgs, "--target-id");
  const x = requirePointerCoordinate(args.rawArgs, "--x");
  const y = requirePointerCoordinate(args.rawArgs, "--y");
  const steps = parsePointerSteps(args.rawArgs);

  if (!sessionId) {
    throw createUsageError("Missing --session-id");
  }

  const result = await callDaemon("pointer.move", {
    sessionId,
    x,
    y,
    ...(typeof steps === "number" ? { steps } : {}),
    ...(typeof targetId === "string" ? { targetId } : {})
  });
  return { success: true, message: "Pointer move complete.", data: result };
}
