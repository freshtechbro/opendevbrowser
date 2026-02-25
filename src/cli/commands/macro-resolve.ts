import type { ParsedArgs } from "../args";
import { callDaemon } from "../client";
import { createUsageError } from "../errors";
import { parseNumberFlag } from "../utils/parse";

type MacroResolveArgs = {
  expression?: string;
  defaultProvider?: string;
  includeCatalog?: boolean;
  execute?: boolean;
  timeoutMs?: number;
};

const requireValue = (value: string | undefined, flag: string): string => {
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const parseMacroResolveArgs = (rawArgs: string[]): MacroResolveArgs => {
  const parsed: MacroResolveArgs = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--expression") {
      parsed.expression = requireValue(rawArgs[index + 1], "--expression");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--expression=")) {
      parsed.expression = requireValue(arg.split("=", 2)[1], "--expression");
      continue;
    }

    if (arg === "--default-provider") {
      parsed.defaultProvider = requireValue(rawArgs[index + 1], "--default-provider");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--default-provider=")) {
      parsed.defaultProvider = requireValue(arg.split("=", 2)[1], "--default-provider");
      continue;
    }

    if (arg === "--include-catalog") {
      parsed.includeCatalog = true;
      continue;
    }

    if (arg === "--execute") {
      parsed.execute = true;
      continue;
    }

    if (arg === "--timeout-ms") {
      const value = requireValue(rawArgs[index + 1], "--timeout-ms");
      parsed.timeoutMs = parseNumberFlag(value, "--timeout-ms", { min: 1 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = parseNumberFlag(requireValue(arg.split("=", 2)[1], "--timeout-ms"), "--timeout-ms", { min: 1 });
      continue;
    }
  }

  return parsed;
};

export async function runMacroResolve(args: ParsedArgs) {
  const parsed = parseMacroResolveArgs(args.rawArgs);
  if (!parsed.expression) {
    throw createUsageError("Missing --expression");
  }

  const params = {
    expression: parsed.expression,
    defaultProvider: parsed.defaultProvider,
    includeCatalog: parsed.includeCatalog ?? false,
    execute: parsed.execute ?? false
  };
  const result = typeof parsed.timeoutMs === "number"
    ? await callDaemon("macro.resolve", params, { timeoutMs: parsed.timeoutMs })
    : await callDaemon("macro.resolve", params);

  return {
    success: true,
    message: parsed.execute ? "Macro resolved and executed." : "Macro resolved.",
    data: result
  };
}

export const __test__ = {
  parseMacroResolveArgs
};
