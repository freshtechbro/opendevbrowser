import type { BrowserManagerLike } from "../browser/manager-types";
import type { ChallengeAutomationMode } from "../challenges";
import type { BundledProviderRuntime, ProviderRuntimeBundleConfig } from "../providers/runtime-bundle";
import { resolveBundledProviderRuntime } from "../providers/runtime-bundle";
import type { BrowserFallbackPort } from "../providers/types";
import type { RuntimeInit } from "../providers";
import {
  executeMacroResolution,
  shapeExecutionPayload,
  type MacroExecutionPayload,
  type MacroResolution,
  type MacroRuntimeExecutor
} from "./execute";

const MACRO_TIMEOUT_MIN_MS = 1_000;
const MACRO_TIMEOUT_MAX_MS = 300_000;

export const clampMacroRuntimeTimeout = (timeoutMs: number | undefined): number | null => {
  if (!Number.isFinite(timeoutMs ?? NaN)) {
    return null;
  }
  const parsed = Math.floor(timeoutMs as number);
  return Math.max(MACRO_TIMEOUT_MIN_MS, Math.min(MACRO_TIMEOUT_MAX_MS, parsed));
};

export const buildMacroRuntimeInit = (
  timeoutMs: number | undefined
): Omit<RuntimeInit, "providers"> | undefined => {
  const macroTimeoutMs = clampMacroRuntimeTimeout(timeoutMs);
  if (macroTimeoutMs === null) {
    return undefined;
  }

  return {
    budgets: {
      timeoutMs: {
        search: macroTimeoutMs,
        fetch: macroTimeoutMs,
        crawl: macroTimeoutMs,
        post: macroTimeoutMs
      }
    }
  };
};

export const executeMacroWithRuntime = async (args: {
  resolution: MacroResolution;
  runtime?: MacroRuntimeExecutor;
  existingRuntime?: BundledProviderRuntime;
  config?: ProviderRuntimeBundleConfig;
  manager?: BrowserManagerLike;
  browserFallbackPort?: BrowserFallbackPort;
  timeoutMs?: number;
  challengeAutomationMode?: ChallengeAutomationMode;
}): Promise<MacroExecutionPayload> => {
  const runtime = args.runtime ?? resolveBundledProviderRuntime({
    existingRuntime: args.existingRuntime,
    config: args.config,
    manager: args.manager,
    browserFallbackPort: args.browserFallbackPort,
    init: buildMacroRuntimeInit(args.timeoutMs)
  });

  return shapeExecutionPayload(
    await executeMacroResolution(
      args.resolution,
      runtime,
      args.challengeAutomationMode
        ? { challengeAutomationMode: args.challengeAutomationMode }
        : undefined
    )
  );
};
