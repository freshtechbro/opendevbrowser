import { createUsageError } from "../../errors";
import { parseNumberFlag, parseOptionalStringFlag } from "../../utils/parse";

export type PointerButton = "left" | "middle" | "right";

const POINTER_BUTTONS = new Set<PointerButton>(["left", "middle", "right"]);

function requireFlagValue(rawArgs: string[], flag: string): string {
  const value = parseOptionalStringFlag(rawArgs, flag);
  if (!value) {
    throw createUsageError(`Missing ${flag}`);
  }
  return value;
}

export function requirePointerCoordinate(rawArgs: string[], flag: string): number {
  return parseNumberFlag(requireFlagValue(rawArgs, flag), flag, { integer: false });
}

export function parsePointerSteps(rawArgs: string[]): number | undefined {
  const value = parseOptionalStringFlag(rawArgs, "--steps");
  return value ? parseNumberFlag(value, "--steps", { min: 1 }) : undefined;
}

export function parsePointerClickCount(rawArgs: string[]): number | undefined {
  const value = parseOptionalStringFlag(rawArgs, "--click-count");
  return value ? parseNumberFlag(value, "--click-count", { min: 1 }) : undefined;
}

export function parsePointerButton(rawArgs: string[]): PointerButton | undefined {
  const value = parseOptionalStringFlag(rawArgs, "--button");
  if (!value) {
    return undefined;
  }
  if (!POINTER_BUTTONS.has(value as PointerButton)) {
    throw createUsageError(`Invalid --button: ${value}`);
  }
  return value as PointerButton;
}
