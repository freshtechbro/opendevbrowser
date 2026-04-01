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

export function parseBooleanFlag(value: string, flag: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw createUsageError(`Invalid ${flag}: ${value}`);
}

export function parseOptionalStringFlag(rawArgs: string[], flag: string): string | undefined {
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === flag) {
      const value = rawArgs[i + 1];
      if (!value) {
        throw createUsageError(`Missing value for ${flag}`);
      }
      return value;
    }
    if (arg?.startsWith(`${flag}=`)) {
      const value = arg.split("=", 2)[1];
      if (!value) {
        throw createUsageError(`Missing value for ${flag}`);
      }
      return value;
    }
  }
  return undefined;
}
