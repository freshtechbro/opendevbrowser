import type { ParsedArgs } from "../args";
import { callDaemon } from "../client";
import { createUsageError } from "../errors";
import { parseNumberFlag } from "../utils/parse";
import { buildWorkflowCompletionMessage } from "../utils/workflow-message";
import { DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS } from "../transport-timeouts";
import { isChallengeAutomationMode, type ChallengeAutomationMode } from "../../challenges/types";
import type { WorkflowBrowserMode } from "../../providers/types";

type ShoppingCommandArgs = {
  query?: string;
  providers?: string[];
  budget?: number;
  region?: string;
  browserMode?: WorkflowBrowserMode;
  sort?: "best_deal" | "lowest_price" | "highest_rating" | "fastest_shipping";
  mode?: "compact" | "json" | "md" | "context" | "path";
  timeoutMs?: number;
  outputDir?: string;
  ttlHours?: number;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: "off" | "auto" | "required";
};

const SORT_VALUES = new Set(["best_deal", "lowest_price", "highest_rating", "fastest_shipping"]);
const MODE_VALUES = new Set(["compact", "json", "md", "context", "path"]);
const COOKIE_POLICY_VALUES = new Set(["off", "auto", "required"]);
const BROWSER_MODE_VALUES = new Set(["auto", "extension", "managed"]);
const SHOPPING_TRANSPORT_TIMEOUT_BUFFER_MS = 60_000;
const MAX_SHOPPING_TRANSPORT_TIMEOUT_MS = 300_000;

const deriveShoppingTransportTimeoutMs = (timeoutMs: number): number => {
  return Math.min(
    MAX_SHOPPING_TRANSPORT_TIMEOUT_MS,
    Math.max(DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS, timeoutMs + SHOPPING_TRANSPORT_TIMEOUT_BUFFER_MS)
  );
};

const requireValue = (rawArgs: string[], index: number, flag: string): string => {
  const value = rawArgs[index + 1];
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const parseBoolean = (value: string, flag: string): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw createUsageError(`Invalid ${flag}: ${value}`);
};

const parseProviders = (raw: string): string[] => {
  const providers = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (providers.length === 0) {
    throw createUsageError("--providers requires at least one provider");
  }
  return [...new Set(providers)];
};

const parseShoppingRunArgs = (rawArgs: string[]): ShoppingCommandArgs => {
  const parsed: ShoppingCommandArgs = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--query") {
      parsed.query = requireValue(rawArgs, index, "--query");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--query=")) {
      parsed.query = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--providers") {
      parsed.providers = parseProviders(requireValue(rawArgs, index, "--providers"));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--providers=")) {
      parsed.providers = parseProviders(arg.split("=", 2)[1] ?? "");
      continue;
    }

    if (arg === "--budget") {
      parsed.budget = parseNumberFlag(requireValue(rawArgs, index, "--budget"), "--budget", { min: 1, integer: false });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--budget=")) {
      parsed.budget = parseNumberFlag(arg.split("=", 2)[1] ?? "", "--budget", { min: 1, integer: false });
      continue;
    }

    if (arg === "--region") {
      parsed.region = requireValue(rawArgs, index, "--region");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--region=")) {
      parsed.region = arg.split("=", 2)[1];
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

    if (arg === "--sort") {
      const value = requireValue(rawArgs, index, "--sort").toLowerCase();
      if (!SORT_VALUES.has(value)) {
        throw createUsageError(`Invalid --sort: ${value}`);
      }
      parsed.sort = value as ShoppingCommandArgs["sort"];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--sort=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!SORT_VALUES.has(value)) {
        throw createUsageError(`Invalid --sort: ${value}`);
      }
      parsed.sort = value as ShoppingCommandArgs["sort"];
      continue;
    }

    if (arg === "--mode") {
      const value = requireValue(rawArgs, index, "--mode").toLowerCase();
      if (!MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --mode: ${value}`);
      }
      parsed.mode = value as ShoppingCommandArgs["mode"];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--mode=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --mode: ${value}`);
      }
      parsed.mode = value as ShoppingCommandArgs["mode"];
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

    if (arg === "--use-cookies") {
      parsed.useCookies = true;
      continue;
    }
    if (arg?.startsWith("--use-cookies=")) {
      parsed.useCookies = parseBoolean(arg.split("=", 2)[1] ?? "", "--use-cookies");
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
      parsed.cookiePolicyOverride = value as ShoppingCommandArgs["cookiePolicyOverride"];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cookie-policy-override=") || arg?.startsWith("--cookie-policy=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!COOKIE_POLICY_VALUES.has(value)) {
        throw createUsageError(`Invalid --cookie-policy-override: ${value}`);
      }
      parsed.cookiePolicyOverride = value as ShoppingCommandArgs["cookiePolicyOverride"];
      continue;
    }
  }

  return parsed;
};

export async function runShoppingCommand(args: ParsedArgs) {
  const [subcommand, ...rest] = args.rawArgs;
  if (subcommand !== "run") {
    throw createUsageError("Usage: opendevbrowser shopping run --query <value> [options]");
  }

  const parsed = parseShoppingRunArgs(rest);
  if (!parsed.query?.trim()) {
    throw createUsageError("Missing --query");
  }

  const payload = {
    query: parsed.query,
    providers: parsed.providers,
    budget: parsed.budget,
    region: parsed.region,
    browserMode: parsed.browserMode,
    sort: parsed.sort,
    mode: parsed.mode ?? "compact",
    timeoutMs: parsed.timeoutMs ?? DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS,
    outputDir: parsed.outputDir,
    ttlHours: parsed.ttlHours,
    useCookies: parsed.useCookies,
    challengeAutomationMode: parsed.challengeAutomationMode,
    cookiePolicyOverride: parsed.cookiePolicyOverride
  };

  const data = await callDaemon("shopping.run", payload, {
    timeoutMs: deriveShoppingTransportTimeoutMs(payload.timeoutMs)
  });

  return {
    success: true,
    message: buildWorkflowCompletionMessage("Shopping workflow", data),
    data
  };
}

export const __test__ = {
  parseShoppingRunArgs,
  parseProviders,
  deriveShoppingTransportTimeoutMs
};
