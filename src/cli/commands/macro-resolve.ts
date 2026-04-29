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

type MacroResolveArgs = {
  expression?: string;
  defaultProvider?: string;
  includeCatalog?: boolean;
  execute?: boolean;
  timeoutMs?: number;
  challengeAutomationMode?: ChallengeAutomationMode;
};

const MACRO_TRANSPORT_TIMEOUT_BUFFER_MS = 60_000;

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
    execute: parsed.execute ?? false,
    ...(typeof parsed.timeoutMs === "number" ? { timeoutMs: parsed.timeoutMs } : {}),
    ...(parsed.challengeAutomationMode ? { challengeAutomationMode: parsed.challengeAutomationMode } : {})
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
