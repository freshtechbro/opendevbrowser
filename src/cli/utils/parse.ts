import { createUsageError } from "../errors";

type NumberFlagOptions = {
  min?: number;
  max?: number;
  integer?: boolean;
};

const SIGNED_INTEGER_PATTERN = /^-?\d+$/;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;
const SIGNED_DECIMAL_PATTERN = /^-?(?:\d+|\d+\.\d+|\.\d+)$/;
const UNSIGNED_DECIMAL_PATTERN = /^(?:\d+|\d+\.\d+|\.\d+)$/;

function allowsNegative(options: NumberFlagOptions): boolean {
  return typeof options.min !== "number" || options.min < 0;
}

function decimalPattern(options: NumberFlagOptions): RegExp {
  const signed = allowsNegative(options);
  if (options.integer ?? true) {
    return signed ? SIGNED_INTEGER_PATTERN : UNSIGNED_INTEGER_PATTERN;
  }
  return signed ? SIGNED_DECIMAL_PATTERN : UNSIGNED_DECIMAL_PATTERN;
}

export function parseNumberFlag(value: string, flag: string, options: NumberFlagOptions = {}): number {
  if (value.trim() === "" || value !== value.trim() || !decimalPattern(options).test(value)) {
    throw createUsageError(`Invalid ${flag}: ${value}`);
  }
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

export function parseStringArrayFlag(rawArgs: string[], flag: string): string[] | undefined {
  const value = parseOptionalStringFlag(rawArgs, flag);
  if (typeof value !== "string") {
    return undefined;
  }
  const items = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  if (items.length === 0) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return items;
}

export function parseRepeatedStringFlag(rawArgs: string[], flag: string): string[] | undefined {
  const values: string[] = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === flag) {
      const value = rawArgs[index + 1];
      if (!value) {
        throw createUsageError(`Missing value for ${flag}`);
      }
      values.push(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith(`${flag}=`)) {
      const value = arg.split("=", 2)[1];
      if (!value) {
        throw createUsageError(`Missing value for ${flag}`);
      }
      values.push(value);
    }
  }
  return values.length > 0 ? values : undefined;
}
