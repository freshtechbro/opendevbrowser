import { createUsageError } from "../errors";

type NumberFlagOptions = {
  min?: number;
  max?: number;
  integer?: boolean;
};

export function parseNumberFlag(value: string, flag: string, options: NumberFlagOptions = {}): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createUsageError(`Invalid ${flag}: ${value}`);
  }
  const requireInteger = options.integer ?? true;
  if (requireInteger && !Number.isInteger(parsed)) {
    throw createUsageError(`Invalid ${flag}: ${value}`);
  }
  if (typeof options.min === "number" && parsed < options.min) {
    throw createUsageError(`Invalid ${flag}: ${value}`);
  }
  if (typeof options.max === "number" && parsed > options.max) {
    throw createUsageError(`Invalid ${flag}: ${value}`);
  }
  return parsed;
}

