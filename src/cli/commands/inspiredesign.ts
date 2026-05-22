import type { ParsedArgs } from "../args";
import { callDaemon } from "../client";
import { createUsageError } from "../errors";
import { DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS } from "../transport-timeouts";
import {
  parseBooleanFlag,
  parseNumberFlag,
  parseOptionalStringFlag,
  parseRepeatedStringFlag,
  readInlineFlagValue
} from "../utils/parse";
import { buildWorkflowCompletionMessage } from "../utils/workflow-message";
import { isChallengeAutomationMode, type ChallengeAutomationMode } from "../../challenges/types";
import {
  requiresProviderUrlSiteRecipeCompatibility,
  validateProviderScopedUrlCanonicality,
  validateProviderUrlSiteRecipeCompatibility
} from "../../guidance/recipes/site-recipe-validation";
import { resolveInspiredesignCaptureMode } from "../../inspiredesign/capture-mode";
import type { InspiredesignVisualEvidenceMode } from "../../inspiredesign/visual-evidence";
import type { WorkflowBrowserMode } from "../../providers/types";
import { resolveWorkflowOutputDirFlag } from "./workflow-output";

type InspiredesignCommandArgs = {
  brief?: string;
  query?: string;
  providers?: string[];
  maxReferences?: number;
  visualEvidence?: InspiredesignVisualEvidenceMode;
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
const VISUAL_EVIDENCE_VALUES = new Set(["off", "auto", "required"]);
const HARVEST_DEFAULT_MAX_REFERENCES = 5;
const MAX_REFERENCES_LIMIT = 10;

const readInspiredesignReadiness = (data: unknown): string | undefined => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const meta = (data as Record<string, unknown>).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const nextStepGuidance = (meta as Record<string, unknown>).nextStepGuidance;
  if (!nextStepGuidance || typeof nextStepGuidance !== "object" || Array.isArray(nextStepGuidance)) return undefined;
  const readiness = (nextStepGuidance as Record<string, unknown>).readiness;
  return typeof readiness === "string" && readiness.length > 0 ? readiness : undefined;
};

const buildInspiredesignCompletionMessage = (data: unknown): string => {
  const baseMessage = buildWorkflowCompletionMessage("Inspiredesign workflow", data);
  const readiness = readInspiredesignReadiness(data);
  return readiness ? `${baseMessage} readiness=${readiness}` : baseMessage;
};

const requireValue = (rawArgs: string[], index: number, flag: string): string => {
  const value = rawArgs[index + 1];
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const parseInspiredesignArgs = (rawArgs: string[]): InspiredesignCommandArgs => {
  const parsed: InspiredesignCommandArgs = {
    brief: parseOptionalStringFlag(rawArgs, "--brief"),
    query: parseOptionalStringFlag(rawArgs, "--query"),
    providers: parseRepeatedStringFlag(rawArgs, "--provider"),
    urls: parseRepeatedStringFlag(rawArgs, "--url")
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--brief" || arg === "--query" || arg === "--provider" || arg === "--url") {
      index += 1;
      continue;
    }
    if (
      arg?.startsWith("--brief=")
      || arg?.startsWith("--query=")
      || arg?.startsWith("--provider=")
      || arg?.startsWith("--url=")
    ) {
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
      const value = (readInlineFlagValue(arg, "--capture-mode") ?? "").toLowerCase();
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
      parsed.includePrototypeGuidance = parseBooleanFlag(
        readInlineFlagValue(arg, "--include-prototype-guidance") ?? "",
        "--include-prototype-guidance"
      );
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
      const value = (readInlineFlagValue(arg, "--mode") ?? "").toLowerCase();
      if (!MODE_VALUES.has(value)) {
        throw createUsageError(`Invalid --mode: ${value}`);
      }
      parsed.mode = value as InspiredesignCommandArgs["mode"];
      continue;
    }

    if (arg === "--max-references") {
      parsed.maxReferences = parseNumberFlag(requireValue(rawArgs, index, "--max-references"), "--max-references", {
        min: 1,
        max: MAX_REFERENCES_LIMIT
      });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--max-references=")) {
      parsed.maxReferences = parseNumberFlag(
        readInlineFlagValue(arg, "--max-references") ?? "",
        "--max-references",
        {
          min: 1,
          max: MAX_REFERENCES_LIMIT
        }
      );
      continue;
    }

    if (arg === "--visual-evidence") {
      const value = requireValue(rawArgs, index, "--visual-evidence").toLowerCase();
      if (!VISUAL_EVIDENCE_VALUES.has(value)) {
        throw createUsageError(`Invalid --visual-evidence: ${value}`);
      }
      parsed.visualEvidence = value as InspiredesignVisualEvidenceMode;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--visual-evidence=")) {
      const value = (readInlineFlagValue(arg, "--visual-evidence") ?? "").toLowerCase();
      if (!VISUAL_EVIDENCE_VALUES.has(value)) {
        throw createUsageError(`Invalid --visual-evidence: ${value}`);
      }
      parsed.visualEvidence = value as InspiredesignVisualEvidenceMode;
      continue;
    }

    if (arg === "--timeout-ms") {
      parsed.timeoutMs = parseNumberFlag(requireValue(rawArgs, index, "--timeout-ms"), "--timeout-ms", { min: 1 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = parseNumberFlag(
        readInlineFlagValue(arg, "--timeout-ms") ?? "",
        "--timeout-ms",
        { min: 1 }
      );
      continue;
    }

    if (arg === "--output-dir") {
      parsed.outputDir = resolveWorkflowOutputDirFlag(requireValue(rawArgs, index, "--output-dir"));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--output-dir=")) {
      parsed.outputDir = resolveWorkflowOutputDirFlag(readInlineFlagValue(arg, "--output-dir"));
      continue;
    }

    if (arg === "--ttl-hours") {
      parsed.ttlHours = parseNumberFlag(requireValue(rawArgs, index, "--ttl-hours"), "--ttl-hours", { min: 1, max: 168 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--ttl-hours=")) {
      parsed.ttlHours = parseNumberFlag(
        readInlineFlagValue(arg, "--ttl-hours") ?? "",
        "--ttl-hours",
        { min: 1, max: 168 }
      );
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
      const value = (readInlineFlagValue(arg, "--browser-mode") ?? "").toLowerCase();
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
      parsed.useCookies = parseBooleanFlag(readInlineFlagValue(arg, "--use-cookies") ?? "", "--use-cookies");
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
      const value = readInlineFlagValue(arg, "--challenge-automation-mode") ?? "";
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
      const flag = arg.startsWith("--cookie-policy-override=") ? "--cookie-policy-override" : "--cookie-policy";
      const value = (readInlineFlagValue(arg, flag) ?? "").toLowerCase();
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
  if (subcommand !== "run" && subcommand !== "harvest") {
    throw createUsageError("Usage: opendevbrowser inspiredesign <run|harvest> --brief <value> [--url <url>] [options]");
  }

  const parsed = parseInspiredesignArgs(rest);
  if (!parsed.brief?.trim()) {
    throw createUsageError("Missing --brief");
  }
  if (subcommand === "run" && parsed.query) {
    throw createUsageError("--query is only supported by inspiredesign harvest");
  }
  const isHarvest = subcommand === "harvest";
  const providers = parsed.providers ?? [];
  const urls = parsed.urls ?? [];
  const canonicality = validateProviderScopedUrlCanonicality({ providers, urls });
  if (!canonicality.ok) {
    throw createUsageError(canonicality.message);
  }
  if (requiresProviderUrlSiteRecipeCompatibility({
    providers,
    urls,
    query: parsed.query
  })) {
    if (!isHarvest) {
      throw createUsageError("--provider requires --query or compatible harvest --url recovery");
    }
    const compatibility = validateProviderUrlSiteRecipeCompatibility({
      providers,
      urls
    });
    if (!compatibility.ok) {
      throw createUsageError(compatibility.message);
    }
  }
  if (isHarvest && !parsed.query && (!parsed.urls || parsed.urls.length === 0)) {
    throw createUsageError("inspiredesign harvest requires --query or --url");
  }
  const captureMode = resolveInspiredesignCaptureMode(parsed.captureMode, parsed.urls);

  const data = await callDaemon("inspiredesign.run", {
    brief: parsed.brief,
    harvest: isHarvest,
    query: parsed.query,
    providers: parsed.providers,
    maxReferences: parsed.maxReferences ?? (isHarvest ? HARVEST_DEFAULT_MAX_REFERENCES : undefined),
    visualEvidence: parsed.visualEvidence ?? (isHarvest ? "required" : "off"),
    urls: parsed.urls,
    captureMode,
    includePrototypeGuidance: parsed.includePrototypeGuidance,
    mode: parsed.mode ?? (isHarvest ? "path" : "compact"),
    timeoutMs: parsed.timeoutMs ?? DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS,
    outputDir: resolveWorkflowOutputDirFlag(parsed.outputDir),
    ttlHours: parsed.ttlHours,
    browserMode: parsed.browserMode,
    useCookies: parsed.useCookies,
    challengeAutomationMode: parsed.challengeAutomationMode,
    cookiePolicyOverride: parsed.cookiePolicyOverride
  });

  return {
    success: true,
    message: buildInspiredesignCompletionMessage(data),
    data
  };
}

export const __test__ = {
  parseInspiredesignArgs
};
