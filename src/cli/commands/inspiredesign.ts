import type { ParsedArgs } from "../args";
import { callDaemon } from "../client";
import { createUsageError } from "../errors";
import { DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS } from "../transport-timeouts";
import {
  parseBooleanFlag,
  parseNumberFlag,
  parseOptionalStringFlag,
  parseRepeatedStringFlag
} from "../utils/parse";
import { buildWorkflowCompletionMessage } from "../utils/workflow-message";
import { isChallengeAutomationMode, type ChallengeAutomationMode } from "../../challenges/types";
import { resolveInspiredesignCaptureMode } from "../../inspiredesign/capture-mode";
import type { WorkflowBrowserMode } from "../../providers/types";

type InspiredesignCommandArgs = {
  brief?: string;
  urls?: string[];
  captureMode?: "off" | "deep";
  includePrototypeGuidance?: boolean;
  mode?: "compact" | "json" | "md" | "context" | "path";
  timeoutMs?: number;
  outputDir?: string;
  ttlHours?: number;
  browserMode?: WorkflowBrowserMode;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: "off" | "auto" | "required";
};

const MODE_VALUES = new Set(["compact", "json", "md", "context", "path"]);
const CAPTURE_MODE_VALUES = new Set(["off", "deep"]);
const COOKIE_POLICY_VALUES = new Set(["off", "auto", "required"]);
const BROWSER_MODE_VALUES = new Set(["auto", "extension", "managed"]);

const requireValue = (rawArgs: string[], index: number, flag: string): string => {
  const value = rawArgs[index + 1];
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const parseInspiredesignRunArgs = (rawArgs: string[]): InspiredesignCommandArgs => {
  const parsed: InspiredesignCommandArgs = {
    brief: parseOptionalStringFlag(rawArgs, "--brief"),
    urls: parseRepeatedStringFlag(rawArgs, "--url")
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--brief" || arg === "--url") {
      index += 1;
      continue;
    }
    if (arg?.startsWith("--brief=") || arg?.startsWith("--url=")) {
      continue;
    }

    if (arg === "--capture-mode") {
      const value = requireValue(rawArgs, index, "--capture-mode").toLowerCase();
      if (!CAPTURE_MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --capture-mode: ${value}`);
      }
      parsed.captureMode = value as InspiredesignCommandArgs["captureMode"];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--capture-mode=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!CAPTURE_MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --capture-mode: ${value}`);
      }
      parsed.captureMode = value as InspiredesignCommandArgs["captureMode"];
      continue;
    }

    if (arg === "--include-prototype-guidance") {
      parsed.includePrototypeGuidance = true;
      continue;
    }
    if (arg?.startsWith("--include-prototype-guidance=")) {
      parsed.includePrototypeGuidance = parseBooleanFlag(arg.split("=", 2)[1] ?? "", "--include-prototype-guidance");
      continue;
    }

    if (arg === "--mode") {
      const value = requireValue(rawArgs, index, "--mode").toLowerCase();
      if (!MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --mode: ${value}`);
      }
      parsed.mode = value as InspiredesignCommandArgs["mode"];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--mode=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --mode: ${value}`);
      }
      parsed.mode = value as InspiredesignCommandArgs["mode"];
      continue;
    }

    if (arg === "--timeout-ms") {
      parsed.timeoutMs = parseNumberFlag(requireValue(rawArgs, index, "--timeout-ms"), "--timeout-ms", { min: 1 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = parseNumberFlag(arg.split("=", 2)[1] ?? "", "--timeout-ms", { min: 1 });
      continue;
    }

    if (arg === "--output-dir") {
      parsed.outputDir = requireValue(rawArgs, index, "--output-dir");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--output-dir=")) {
      parsed.outputDir = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--ttl-hours") {
      parsed.ttlHours = parseNumberFlag(requireValue(rawArgs, index, "--ttl-hours"), "--ttl-hours", { min: 1, max: 168 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--ttl-hours=")) {
      parsed.ttlHours = parseNumberFlag(arg.split("=", 2)[1] ?? "", "--ttl-hours", { min: 1, max: 168 });
      continue;
    }

    if (arg === "--browser-mode") {
      const value = requireValue(rawArgs, index, "--browser-mode").toLowerCase();
      if (!BROWSER_MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --browser-mode: ${value}`);
      }
      parsed.browserMode = value as WorkflowBrowserMode;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--browser-mode=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!BROWSER_MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --browser-mode: ${value}`);
      }
      parsed.browserMode = value as WorkflowBrowserMode;
      continue;
    }

    if (arg === "--use-cookies") {
      parsed.useCookies = true;
      continue;
    }
    if (arg?.startsWith("--use-cookies=")) {
      parsed.useCookies = parseBooleanFlag(arg.split("=", 2)[1] ?? "", "--use-cookies");
      continue;
    }

    if (arg === "--challenge-automation-mode") {
      const value = requireValue(rawArgs, index, "--challenge-automation-mode");
      if (!isChallengeAutomationMode(value)) {
        throw createUsageError(`Invalid --challenge-automation-mode: ${value}`);
      }
      parsed.challengeAutomationMode = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--challenge-automation-mode=")) {
      const value = arg.split("=", 2)[1] ?? "";
      if (!isChallengeAutomationMode(value)) {
        throw createUsageError(`Invalid --challenge-automation-mode: ${value}`);
      }
      parsed.challengeAutomationMode = value;
      continue;
    }

    if (arg === "--cookie-policy-override" || arg === "--cookie-policy") {
      const value = requireValue(rawArgs, index, arg).toLowerCase();
      if (!COOKIE_POLICY_VALUES.has(value)) {
        throw createUsageError(`Invalid ${arg}: ${value}`);
      }
      parsed.cookiePolicyOverride = value as InspiredesignCommandArgs["cookiePolicyOverride"];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cookie-policy-override=") || arg?.startsWith("--cookie-policy=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!COOKIE_POLICY_VALUES.has(value)) {
        throw createUsageError(`Invalid --cookie-policy-override: ${value}`);
      }
      parsed.cookiePolicyOverride = value as InspiredesignCommandArgs["cookiePolicyOverride"];
    }
  }

  return parsed;
};

export async function runInspiredesignCommand(args: ParsedArgs) {
  const [subcommand, ...rest] = args.rawArgs;
  if (subcommand !== "run") {
    throw createUsageError("Usage: opendevbrowser inspiredesign run --brief <value> [--url <url>] [options]");
  }

  const parsed = parseInspiredesignRunArgs(rest);
  if (!parsed.brief?.trim()) {
    throw createUsageError("Missing --brief");
  }
  const captureMode = resolveInspiredesignCaptureMode(parsed.captureMode, parsed.urls);

  const data = await callDaemon("inspiredesign.run", {
    brief: parsed.brief,
    urls: parsed.urls,
    captureMode,
    includePrototypeGuidance: parsed.includePrototypeGuidance,
    mode: parsed.mode ?? "compact",
    timeoutMs: parsed.timeoutMs ?? DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS,
    outputDir: parsed.outputDir,
    ttlHours: parsed.ttlHours,
    browserMode: parsed.browserMode,
    useCookies: parsed.useCookies,
    challengeAutomationMode: parsed.challengeAutomationMode,
    cookiePolicyOverride: parsed.cookiePolicyOverride
  });

  return {
    success: true,
    message: buildWorkflowCompletionMessage("Inspiredesign workflow", data),
    data
  };
}

export const __test__ = {
  parseInspiredesignRunArgs
};
