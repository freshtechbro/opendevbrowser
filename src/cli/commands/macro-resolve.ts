import type { ParsedArgs } from "../args";
import { callDaemon } from "../client";
import { createUsageError } from "../errors";

type MacroResolveArgs = {
  expression?: string;
  defaultProvider?: string;
  includeCatalog?: boolean;
  execute?: boolean;
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
  }

  return parsed;
};

export async function runMacroResolve(args: ParsedArgs) {
  const parsed = parseMacroResolveArgs(args.rawArgs);
  if (!parsed.expression) {
    throw createUsageError("Missing --expression");
  }

  const result = await callDaemon("macro.resolve", {
    expression: parsed.expression,
    defaultProvider: parsed.defaultProvider,
    includeCatalog: parsed.includeCatalog ?? false,
    execute: parsed.execute ?? false
  });

  return {
    success: true,
    message: parsed.execute ? "Macro resolved and executed." : "Macro resolved.",
    data: result
  };
}

export const __test__ = {
  parseMacroResolveArgs
};
