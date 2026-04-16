import { parseOptionalStringFlag, parseNumberFlag } from "../../utils/parse";

type NumberOptions = {
  min?: number;
  max?: number;
  integer?: boolean;
};

function parseOptionalNumberFlag(
  rawArgs: string[],
  flag: string,
  options?: NumberOptions
): number | undefined {
  const value = parseOptionalStringFlag(rawArgs, flag);
  return typeof value === "string"
    ? parseNumberFlag(value, flag, options)
    : undefined;
}

export type ReviewCommandArgs = {
  sessionId?: string;
  targetId?: string;
  reason?: string;
  maxChars?: number;
  cursor?: string;
  timeoutMs?: number;
};

export function parseReviewCommandArgs(rawArgs: string[]): ReviewCommandArgs {
  return {
    sessionId: parseOptionalStringFlag(rawArgs, "--session-id"),
    targetId: parseOptionalStringFlag(rawArgs, "--target-id"),
    reason: parseOptionalStringFlag(rawArgs, "--reason"),
    maxChars: parseOptionalNumberFlag(rawArgs, "--max-chars", { min: 1 }),
    cursor: parseOptionalStringFlag(rawArgs, "--cursor"),
    timeoutMs: parseOptionalNumberFlag(rawArgs, "--timeout-ms", { min: 1 })
  };
}
