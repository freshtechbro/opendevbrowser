import type { ParsedArgs } from "../args";
import { callDaemon } from "../client";
import { createUsageError } from "../errors";
import { DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS } from "../transport-timeouts";
import { parseNumberFlag } from "../utils/parse";
import {
  buildNextStepMessage,
  readFollowthroughSummary,
  readWorkflowGuidanceNextStep
} from "../utils/workflow-message";
import { isChallengeAutomationMode, type ChallengeAutomationMode } from "../../challenges/types";
import type { ProviderCookiePolicy, WorkflowBrowserMode } from "../../providers/types";

type MacroResolveArgs = {
  expression?: string;
  defaultProvider?: string;
  includeCatalog?: boolean;
  execute?: boolean;
  timeoutMs?: number;
  browserMode?: WorkflowBrowserMode;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
  cookiePolicyFlag?: "--cookie-policy" | "--cookie-policy-override";
};

const MACRO_TRANSPORT_TIMEOUT_BUFFER_MS = 60_000;
const BROWSER_MODE_VALUES = new Set(["auto", "extension", "managed"]);
const COOKIE_POLICY_VALUES = new Set(["off", "auto", "required"]);

const deriveMacroTransportTimeoutMs = (timeoutMs: number): number => {
  return Math.max(
    DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS,
    timeoutMs + MACRO_TRANSPORT_TIMEOUT_BUFFER_MS
  );
};

const requireValue = (value: string | undefined, flag: string): string => {
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const parseBooleanFlag = (value: string, flag: string): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw createUsageError(`Invalid ${flag}: ${value}`);
};

const parseOptionalBooleanFlag = (
  rawArgs: string[],
  index: number,
  flag: string
): { value: boolean; nextIndex: number } => {
  const next = rawArgs[index + 1];
  if (typeof next !== "string" || next.startsWith("--")) {
    return { value: true, nextIndex: index };
  }
  return {
    value: parseBooleanFlag(next, flag),
    nextIndex: index + 1
  };
};

const splitEqualsFlag = (
  arg: string,
  candidates: readonly ["--cookie-policy-override", "--cookie-policy"]
): { flag: "--cookie-policy" | "--cookie-policy-override"; value: string } => {
  const flag = candidates.find((candidate) => arg.startsWith(`${candidate}=`));
  if (!flag) {
    throw createUsageError(`Unknown option: ${arg}`);
  }
  return {
    flag,
    value: requireValue(arg.slice(flag.length + 1), flag)
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const hasExecutionBlocker = (result: unknown): boolean => {
  const execution = asRecord(asRecord(result)?.execution);
  const meta = asRecord(execution?.meta);
  return asRecord(meta?.blocker) !== null;
};

const buildMacroResolveMessage = (execute: boolean, result: unknown): string => {
  const summary = readFollowthroughSummary(result);
  const nextStep = readWorkflowGuidanceNextStep(result);
  if (summary) {
    return buildNextStepMessage(summary, nextStep);
  }
  if (!execute) {
    return "Macro resolved.";
  }
  if (hasExecutionBlocker(result)) {
    return "Macro resolved, but execution is blocked and needs follow-up.";
  }
  return "Macro resolved and executed.";
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

    if (arg === "--browser-mode") {
      const value = requireValue(rawArgs[index + 1], "--browser-mode").toLowerCase();
      if (!BROWSER_MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --browser-mode: ${value}`);
      }
      parsed.browserMode = value as WorkflowBrowserMode;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--browser-mode=")) {
      const value = requireValue(arg.split("=", 2)[1], "--browser-mode").toLowerCase();
      if (!BROWSER_MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --browser-mode: ${value}`);
      }
      parsed.browserMode = value as WorkflowBrowserMode;
      continue;
    }

    if (arg === "--use-cookies") {
      const parsedFlag = parseOptionalBooleanFlag(rawArgs, index, "--use-cookies");
      parsed.useCookies = parsedFlag.value;
      index = parsedFlag.nextIndex;
      continue;
    }
    if (arg?.startsWith("--use-cookies=")) {
      parsed.useCookies = parseBooleanFlag(arg.split("=", 2)[1] ?? "", "--use-cookies");
      continue;
    }

    if (arg === "--challenge-automation-mode") {
      const value = requireValue(rawArgs[index + 1], "--challenge-automation-mode");
      if (!isChallengeAutomationMode(value)) {
        throw createUsageError(`Invalid --challenge-automation-mode: ${value}`);
      }
      parsed.challengeAutomationMode = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--challenge-automation-mode=")) {
      const value = requireValue(arg.split("=", 2)[1], "--challenge-automation-mode");
      if (!isChallengeAutomationMode(value)) {
        throw createUsageError(`Invalid --challenge-automation-mode: ${value}`);
      }
      parsed.challengeAutomationMode = value;
      continue;
    }

    if (arg === "--cookie-policy-override" || arg === "--cookie-policy") {
      const value = requireValue(rawArgs[index + 1], arg).toLowerCase();
      if (!COOKIE_POLICY_VALUES.has(value)) {
        throw createUsageError(`Invalid ${arg}: ${value}`);
      }
      parsed.cookiePolicyOverride = value as ProviderCookiePolicy;
      parsed.cookiePolicyFlag = arg;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cookie-policy-override=") || arg?.startsWith("--cookie-policy=")) {
      const { flag, value: rawValue } = splitEqualsFlag(arg, ["--cookie-policy-override", "--cookie-policy"]);
      const value = rawValue.toLowerCase();
      if (!COOKIE_POLICY_VALUES.has(value)) {
        throw createUsageError(`Invalid ${flag}: ${value}`);
      }
      parsed.cookiePolicyOverride = value as ProviderCookiePolicy;
      parsed.cookiePolicyFlag = flag;
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
  if (!parsed.execute && parsed.browserMode) {
    throw createUsageError("--browser-mode requires --execute for macro-resolve");
  }
  if (!parsed.execute && typeof parsed.useCookies === "boolean") {
    throw createUsageError("--use-cookies requires --execute for macro-resolve");
  }
  if (!parsed.execute && parsed.challengeAutomationMode) {
    throw createUsageError("--challenge-automation-mode requires --execute for macro-resolve");
  }
  if (!parsed.execute && parsed.cookiePolicyOverride) {
    throw createUsageError(`${parsed.cookiePolicyFlag ?? "--cookie-policy-override"} requires --execute for macro-resolve`);
  }

  const params = {
    expression: parsed.expression,
    defaultProvider: parsed.defaultProvider,
    includeCatalog: parsed.includeCatalog ?? false,
    execute: parsed.execute ?? false,
    ...(typeof parsed.timeoutMs === "number" ? { timeoutMs: parsed.timeoutMs } : {}),
    ...(parsed.browserMode ? { browserMode: parsed.browserMode } : {}),
    ...(typeof parsed.useCookies === "boolean" ? { useCookies: parsed.useCookies } : {}),
    ...(parsed.challengeAutomationMode ? { challengeAutomationMode: parsed.challengeAutomationMode } : {}),
    ...(parsed.cookiePolicyOverride ? { cookiePolicyOverride: parsed.cookiePolicyOverride } : {})
  };
  const result = typeof parsed.timeoutMs === "number"
    ? await callDaemon("macro.resolve", params, {
      timeoutMs: deriveMacroTransportTimeoutMs(parsed.timeoutMs)
    })
    : await callDaemon("macro.resolve", params);

  return {
    success: true,
    message: buildMacroResolveMessage(parsed.execute ?? false, result),
    data: result
  };
}

export const __test__ = {
  parseMacroResolveArgs
};
