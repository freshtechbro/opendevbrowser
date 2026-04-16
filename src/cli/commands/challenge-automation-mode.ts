import { createUsageError } from "../errors";
import { parseOptionalStringFlag } from "../utils/parse";
import { isChallengeAutomationMode, type ChallengeAutomationMode } from "../../challenges/types";

export function parseOptionalChallengeAutomationMode(
  rawArgs: string[]
): ChallengeAutomationMode | undefined {
  const value = parseOptionalStringFlag(rawArgs, "--challenge-automation-mode");
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!isChallengeAutomationMode(value)) {
    throw createUsageError(`Invalid --challenge-automation-mode: ${value}`);
  }
  return value;
}
