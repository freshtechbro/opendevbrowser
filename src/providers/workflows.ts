import { createHash } from "crypto";
import { createArtifactBundle, type ArtifactFile } from "./artifacts";
import { summarizePrimaryProviderIssue } from "./constraint";
import { enrichResearchRecords, type ResearchRecord } from "./enrichment";
import { renderResearch, renderShopping, type RenderMode, type ShoppingOffer } from "./renderer";
import {
  LOOKS_LIKE_URL_RE,
  asNumber,
  extractBrandFromTitle,
  extractShoppingOffer,
  inferBrandFromUrl,
  isLikelyOfferRecord,
  normalizePlainText,
  parsePriceFromContent,
  sanitizeFeatureList,
  stripBrandSuffix,
  trimProductCopy,
  postprocessShoppingWorkflow
} from "./shopping-postprocess";
import { enforceShoppingLegalReviewGate } from "./shopping-workflow";
import { compileShoppingExecutionPlan, type ShoppingWorkflowExecutionStep } from "./shopping-compiler";
import { executeShoppingWorkflowPlan } from "./shopping-executor";
import {
  PRODUCT_VIDEO_STEP_IDS,
  compileProductVideoExecutionPlan,
  serializeProductVideoCheckpointState,
  type ProductVideoWorkflowCheckpointState,
  type ProductVideoWorkflowExecutionStep
} from "./product-video-compiler";
import { filterByTimebox } from "./timebox";
import {
  SHOPPING_PROVIDER_IDS,
  SHOPPING_PROVIDER_PROFILES
} from "./shopping";
import { createLogger, redactSensitive } from "../core/logging";
import { normalizeProviderReasonCode } from "./errors";
import type { ChallengeAutomationMode } from "../challenges/types";
import { providerRequestHeaders } from "./shared/request-headers";
import { canonicalizeUrl } from "./web/crawler";
import { extractStructuredContent, toSnippet } from "./web/extract";
import type { ProviderAntiBotSnapshot } from "./registry";
import { compileResearchExecutionPlan, type ResearchWorkflowExecutionStep } from "./research-compiler";
import { executeResearchWorkflowPlan } from "./research-executor";
import {
  buildWorkflowResumeEnvelope,
  isWorkflowResumeEnvelope,
  type WorkflowCheckpoint,
  type WorkflowKind,
  type WorkflowResumeEnvelope,
  type WorkflowTraceEntry
} from "./workflow-contracts";
import type {
  BrowserFallbackMode,
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderCallResultByOperation,
  ProviderCookiePolicy,
  ProviderError,
  ProviderFailureEntry,
  ProviderReasonCode,
  ProviderRunOptions,
  ProviderRuntimePolicyInput,
  ProviderSelection,
  ProviderSource,
  WorkflowSuspendedIntentKind,
  WorkflowBrowserMode
} from "./types";

export interface ProviderExecutor {
  search: (
    input: ProviderCallResultByOperation["search"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  fetch: (
    input: ProviderCallResultByOperation["fetch"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  getAntiBotSnapshots?: (providerIds?: string[]) => ProviderAntiBotSnapshot[];
}

export interface ResearchRunInput {
  topic: string;
  days?: number;
  from?: string;
  to?: string;
  sourceSelection?: ProviderSelection;
  sources?: ProviderSource[];
  mode: RenderMode;
  includeEngagement?: boolean;
  limitPerSource?: number;
  timeoutMs?: number;
  outputDir?: string;
  ttlHours?: number;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
}

export interface ShoppingRunInput {
  query: string;
  providers?: string[];
  budget?: number;
  region?: string;
  browserMode?: WorkflowBrowserMode;
  sort?: "best_deal" | "lowest_price" | "highest_rating" | "fastest_shipping";
  mode: RenderMode;
  timeoutMs?: number;
  outputDir?: string;
  ttlHours?: number;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
}

export interface ProductVideoRunInput {
  product_url?: string;
  product_name?: string;
  provider_hint?: string;
  include_screenshots?: boolean;
  include_all_images?: boolean;
  include_copy?: boolean;
  output_dir?: string;
  ttl_hours?: number;
  timeoutMs?: number;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
}

export interface ProductVideoWorkflowOptions {
  captureScreenshot?: (url: string, timeoutMs?: number) => Promise<Buffer | null>;
}

type ProviderSignal = "ok" | "anti_bot_challenge" | "rate_limited" | "transcript_unavailable";
type TrackedSignal = Exclude<ProviderSignal, "ok">;
type AlertState = "none" | "warning" | "degraded";

type ProviderSignalState = {
  entries: ProviderSignal[];
  previousWindowRates: Record<TrackedSignal, number>;
  signalState: Record<TrackedSignal, AlertState>;
  healthyWindows: Record<TrackedSignal, number>;
};

const SIGNAL_WINDOW = 50;
const RECOVERY_WINDOWS_REQUIRED = 2;
const providerSignalMap = new Map<string, ProviderSignalState>();
const workflowLogger = createLogger("provider-workflows");

const detectSignal = (error: ProviderError): ProviderSignal | null => {
  const reasonCode = error.reasonCode
    ?? normalizeProviderReasonCode({
      code: error.code,
      message: error.message,
      details: error.details
    });
  if (reasonCode === "rate_limited") return "rate_limited";
  if (reasonCode === "challenge_detected" || /captcha|challenge|anti.?bot|cf_chl/i.test(error.message)) {
    return "anti_bot_challenge";
  }
  if (reasonCode === "transcript_unavailable" || reasonCode === "caption_missing") {
    return "transcript_unavailable";
  }
  return null;
};

const trackProviderSignals = (result: ProviderAggregateResult): void => {
  const failureByProvider = new Map<string, ProviderFailureEntry>();
  for (const failure of result.failures) {
    failureByProvider.set(failure.provider, failure);
  }

  for (const providerId of result.providerOrder) {
    const failure = failureByProvider.get(providerId);
    const signal = failure ? detectSignal(failure.error) ?? "ok" : "ok";
    const state = providerSignalMap.get(providerId) ?? {
      entries: [],
      previousWindowRates: {
        anti_bot_challenge: 0,
        rate_limited: 0,
        transcript_unavailable: 0
      },
      signalState: {
        anti_bot_challenge: "none",
        rate_limited: "none",
        transcript_unavailable: "none"
      },
      healthyWindows: {
        anti_bot_challenge: 0,
        rate_limited: 0,
        transcript_unavailable: 0
      }
    };
    state.entries.push(signal);
    if (state.entries.length > SIGNAL_WINDOW) {
      state.entries.splice(0, state.entries.length - SIGNAL_WINDOW);
    }
    providerSignalMap.set(providerId, state);
  }
};

const isStagedAutoExclusionCandidate = (providerId: string): boolean => {
  return providerId === "social/youtube" || providerId.startsWith("shopping/");
};

const nextSignalState = (
  previous: AlertState,
  warning: boolean,
  degraded: boolean,
  healthyWindows: number
): { state: AlertState; healthyWindows: number } => {
  if (degraded) {
    return { state: "degraded", healthyWindows: 0 };
  }
  if (warning) {
    return { state: "warning", healthyWindows: 0 };
  }

  const nextHealthyWindows = healthyWindows + 1;
  if (previous === "degraded" && nextHealthyWindows < RECOVERY_WINDOWS_REQUIRED) {
    return { state: "degraded", healthyWindows: nextHealthyWindows };
  }
  return { state: "none", healthyWindows: nextHealthyWindows };
};

const buildAlerts = (): Array<Record<string, JsonValue>> => {
  const alerts: Array<Record<string, JsonValue>> = [];

  for (const [provider, state] of providerSignalMap.entries()) {
    const total = state.entries.length;
    if (total === 0) continue;

    for (const signal of ["anti_bot_challenge", "rate_limited", "transcript_unavailable"] as const) {
      const signalCount = state.entries.filter((entry) => entry === signal).length;
      const ratio = signalCount / total;

      let consecutive = 0;
      for (let index = state.entries.length - 1; index >= 0; index -= 1) {
        if (state.entries[index] !== signal) break;
        consecutive += 1;
      }

      const warning = ratio >= 0.15 || consecutive >= 3;
      const degraded = ratio >= 0.25 && state.previousWindowRates[signal] >= 0.25;
      state.previousWindowRates[signal] = ratio;

      const previousState = state.signalState[signal];
      const nextState = nextSignalState(previousState, warning, degraded, state.healthyWindows[signal]);
      state.signalState[signal] = nextState.state;
      state.healthyWindows[signal] = nextState.healthyWindows;

      if (
        (nextState.state === "warning" || nextState.state === "degraded")
        && nextState.state !== previousState
      ) {
        const transitionReason = degraded
          ? "signal ratio >= 25% for two consecutive windows"
          : consecutive >= 3
            ? "3 consecutive events detected"
            : "signal ratio >= 15%";
        workflowLogger.warn("provider.signal.transition", {
          data: {
            provider,
            signal,
            previous_state: previousState,
            next_state: nextState.state,
            window_total: total,
            signal_count: signalCount,
            ratio: Number(ratio.toFixed(4)),
            consecutive,
            reason: transitionReason
          }
        });
      }

      if (nextState.state === "none") continue;

      alerts.push({
        provider,
        signal,
        reasonCode: signal === "anti_bot_challenge"
          ? "challenge_detected"
          : signal === "rate_limited"
            ? "rate_limited"
            : "transcript_unavailable",
        state: nextState.state,
        window_total: total,
        signal_count: signalCount,
        ratio: Number(ratio.toFixed(4)),
        consecutive,
        reason: nextState.state === "degraded" && !degraded
          ? `waiting for ${RECOVERY_WINDOWS_REQUIRED} healthy windows before recovery`
          : degraded
            ? "signal ratio >= 25% for two consecutive windows"
            : consecutive >= 3
              ? "3 consecutive events detected"
              : "signal ratio >= 15%"
      });
    }
  }

  return alerts;
};

const getRuntimeAntiBotSnapshots = (
  runtime: ProviderExecutor,
  providerIds?: string[]
): ProviderAntiBotSnapshot[] => {
  if (typeof runtime.getAntiBotSnapshots !== "function") {
    return [];
  }
  return runtime.getAntiBotSnapshots(providerIds);
};

const buildRuntimePressureAlerts = (
  snapshots: ProviderAntiBotSnapshot[]
): Array<Record<string, JsonValue>> => {
  const nowMs = Date.now();
  const alerts: Array<Record<string, JsonValue>> = [];

  for (const snapshot of snapshots) {
    if (snapshot.activeChallenges > 0 || snapshot.recentChallengeRatio >= 0.15) {
      const degraded = snapshot.activeChallenges > 0 || snapshot.recentChallengeRatio >= 0.25;
      alerts.push({
        provider: snapshot.providerId,
        signal: "anti_bot_challenge",
        reasonCode: "challenge_detected",
        state: degraded ? "degraded" : "warning",
        ratio: Number(snapshot.recentChallengeRatio.toFixed(4)),
        reason: snapshot.activeChallenges > 0
          ? "preserved challenge session is still active"
          : degraded
            ? "signal ratio >= 25%"
            : "signal ratio >= 15%"
      });
    }

    if (snapshot.cooldownUntilMs > nowMs || snapshot.recentRateLimitRatio >= 0.15) {
      const degraded = snapshot.cooldownUntilMs > nowMs || snapshot.recentRateLimitRatio >= 0.25;
      alerts.push({
        provider: snapshot.providerId,
        signal: "rate_limited",
        reasonCode: "rate_limited",
        state: degraded ? "degraded" : "warning",
        ratio: Number(snapshot.recentRateLimitRatio.toFixed(4)),
        reason: snapshot.cooldownUntilMs > nowMs
          ? "cooldown active"
          : degraded
            ? "signal ratio >= 25%"
            : "signal ratio >= 15%"
      });
    }
  }

  return alerts;
};

const buildTranscriptAlertsFromFailures = (
  failures: ProviderFailureEntry[]
): Array<Record<string, JsonValue>> => {
  const seen = new Set<string>();
  const alerts: Array<Record<string, JsonValue>> = [];

  for (const failure of failures) {
    const signal = detectSignal(failure.error);
    if (signal !== "transcript_unavailable") {
      continue;
    }
    const key = `${failure.provider}:${signal}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    alerts.push({
      provider: failure.provider,
      signal,
      reasonCode: "transcript_unavailable",
      state: "warning",
      reason: "transcript retrieval remains unavailable in the current run"
    });
  }

  return alerts;
};

const buildWorkflowAlerts = (
  runtime: ProviderExecutor,
  failures: ProviderFailureEntry[],
  providerIds?: string[]
): Array<Record<string, JsonValue>> => {
  const snapshots = getRuntimeAntiBotSnapshots(runtime, providerIds);
  if (snapshots.length === 0) {
    return buildAlerts();
  }
  return [
    ...buildRuntimePressureAlerts(snapshots),
    ...buildTranscriptAlertsFromFailures(failures)
  ];
};

const getDegradedProviders = (): Set<string> => {
  const degradedProviders = new Set<string>();
  for (const [provider, state] of providerSignalMap.entries()) {
    if (!isStagedAutoExclusionCandidate(provider)) continue;
    if (state.signalState.anti_bot_challenge === "degraded" || state.signalState.rate_limited === "degraded") {
      degradedProviders.add(provider);
    }
  }
  return degradedProviders;
};

const getRuntimeDegradedProviders = (
  runtime: ProviderExecutor,
  providerIds?: string[]
): Set<string> => {
  const snapshots = getRuntimeAntiBotSnapshots(runtime, providerIds);
  if (snapshots.length === 0) {
    return getDegradedProviders();
  }
  const degradedProviders = new Set<string>();
  for (const alert of buildRuntimePressureAlerts(snapshots)) {
    if (alert.state !== "degraded") continue;
    if (typeof alert.provider === "string" && isStagedAutoExclusionCandidate(alert.provider)) {
      degradedProviders.add(alert.provider);
    }
  }
  return degradedProviders;
};

const toProviderSource = (providerId: string): ProviderSource | null => {
  if (providerId.startsWith("web/")) return "web";
  if (providerId.startsWith("community/")) return "community";
  if (providerId.startsWith("social/")) return "social";
  if (providerId.startsWith("shopping/")) return "shopping";
  return null;
};

const observeWorkflowSignals = (
  runtime: ProviderExecutor,
  result: ProviderAggregateResult
): void => {
  if (typeof runtime.getAntiBotSnapshots === "function") {
    return;
  }
  trackProviderSignals(result);
};

const removeExcludedProviders = <T extends { provider: string }>(
  items: T[],
  excludedProviders: Set<string>
): T[] => {
  if (excludedProviders.size === 0) return items;
  return items.filter((item) => !excludedProviders.has(item.provider));
};

const redactRawCapture = (record: Record<string, unknown>): Record<string, unknown> => {
  const redacted = redactSensitive(record);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
    return {};
  }
  return redacted as Record<string, unknown>;
};

const withExcludedProviders = (
  selection: { source_selection: ProviderSelection; resolved_sources: ProviderSource[] },
  excludedProviders: string[]
): { source_selection: ProviderSelection; resolved_sources: ProviderSource[]; excluded_providers?: string[] } => {
  if (excludedProviders.length === 0) return selection;
  return {
    ...selection,
    excluded_providers: excludedProviders
  };
};

const withPrimaryConstraintMeta = (
  meta: Record<string, unknown>,
  failures: ProviderFailureEntry[]
): Record<string, unknown> => {
  const primaryIssue = summarizePrimaryProviderIssue(failures);
  return primaryIssue
    ? {
      ...meta,
      primary_constraint: primaryIssue,
      primaryConstraint: primaryIssue,
      primaryConstraintSummary: primaryIssue.summary
    }
    : meta;
};

const selectResearchPrimaryConstraintFailures = (
  failures: ProviderFailureEntry[]
): ProviderFailureEntry[] => failures.filter((failure) => failure.error.code !== "timeout");

const mergeRuntimePolicyInput = (
  options: ProviderRunOptions,
  input: Partial<ProviderRuntimePolicyInput>
): ProviderRunOptions => {
  const runtimePolicy: ProviderRuntimePolicyInput = {
    ...(options.runtimePolicy ?? {}),
    ...input
  };
  return {
    ...options,
    runtimePolicy
  };
};

const withCookieOverrides = (
  options: ProviderRunOptions,
  input: { useCookies?: boolean; cookiePolicyOverride?: ProviderCookiePolicy }
): ProviderRunOptions => {
  return mergeRuntimePolicyInput(options, {
    ...(typeof input.useCookies === "boolean" ? { useCookies: input.useCookies } : {}),
    ...(input.cookiePolicyOverride ? { cookiePolicyOverride: input.cookiePolicyOverride } : {})
  });
};

const withChallengeAutomationOverride = (
  options: ProviderRunOptions,
  input: { challengeAutomationMode?: ChallengeAutomationMode }
): ProviderRunOptions => {
  return mergeRuntimePolicyInput(options, {
    ...(input.challengeAutomationMode ? { challengeAutomationMode: input.challengeAutomationMode } : {})
  });
};

const withBrowserModeOverride = (
  options: ProviderRunOptions,
  input: { browserMode?: WorkflowBrowserMode }
): ProviderRunOptions => {
  return mergeRuntimePolicyInput(options, {
    ...(input.browserMode ? { browserMode: input.browserMode } : {})
  });
};

const WORKFLOW_KIND_BY_SUSPENDED_INTENT_KIND: Record<WorkflowSuspendedIntentKind, WorkflowKind> = {
  "workflow.research": "research",
  "workflow.shopping": "shopping",
  "workflow.product_video": "product_video"
};

const buildWorkflowResumePayload = (
  kind: WorkflowSuspendedIntentKind,
  input: JsonValue | WorkflowResumeEnvelope
): { workflow: ReturnType<typeof buildWorkflowResumeEnvelope> } => ({
  workflow: isWorkflowResumeEnvelope(input as JsonValue)
    ? input as WorkflowResumeEnvelope
    : buildWorkflowResumeEnvelope(WORKFLOW_KIND_BY_SUSPENDED_INTENT_KIND[kind], input)
});

const withWorkflowResumeEnvelopeIntent = (
  options: ProviderRunOptions,
  kind: WorkflowSuspendedIntentKind,
  envelope: WorkflowResumeEnvelope
): ProviderRunOptions => ({
  ...options,
  suspendedIntent: {
    kind,
    input: buildWorkflowResumePayload(kind, envelope)
  }
});

const detectFailureReasonCode = (failure: ProviderFailureEntry): ProviderReasonCode | undefined => {
  return failure.error.reasonCode
    ?? normalizeProviderReasonCode({
      code: failure.error.code,
      message: failure.error.message,
      details: failure.error.details
    });
};

const summarizeReasonCodeDistribution = (failures: ProviderFailureEntry[]): Record<string, number> => {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    const reasonCode = detectFailureReasonCode(failure);
    if (!reasonCode) continue;
    counts.set(reasonCode, (counts.get(reasonCode) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
};

const summarizeTranscriptStrategyFailures = (failures: ProviderFailureEntry[]): Record<string, number> => {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    const attemptChain = failure.error.details?.attemptChain;
    if (!Array.isArray(attemptChain)) continue;
    for (const item of attemptChain) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const strategy = (item as Record<string, unknown>).strategy;
      const reasonCode = (item as Record<string, unknown>).reasonCode;
      if (typeof strategy !== "string" || typeof reasonCode !== "string") continue;
      const key = `${strategy}:${reasonCode}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
};

const summarizeTranscriptStrategyDetailDistribution = (records: NormalizedRecord[]): Record<string, number> => {
  const counts = new Map<string, number>();
  for (const record of records) {
    const strategyDetail = record.attributes.transcript_strategy_detail;
    const transcriptStrategy = record.attributes.transcript_strategy;
    const resolved = typeof strategyDetail === "string" && strategyDetail.trim().length > 0
      ? strategyDetail
      : typeof transcriptStrategy === "string" && transcriptStrategy.trim().length > 0
        ? transcriptStrategy
        : null;
    if (!resolved) continue;
    counts.set(resolved, (counts.get(resolved) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
};

const TRANSCRIPT_REASON_CODES = new Set<ProviderReasonCode>([
  "caption_missing",
  "transcript_unavailable",
  "strategy_unapproved"
]);

const ANTI_BOT_REASON_CODES = new Set<ProviderReasonCode>([
  "ip_blocked",
  "token_required",
  "auth_required",
  "challenge_detected",
  "rate_limited",
  "cooldown_active"
]);

const summarizeCookieDiagnostics = (
  failures: ProviderFailureEntry[],
  records: NormalizedRecord[]
): Array<Record<string, JsonValue>> => {
  const diagnostics: Array<Record<string, JsonValue>> = [];
  for (const failure of failures) {
    const candidate = failure.error.details?.cookieDiagnostics;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    diagnostics.push({
      provider: failure.provider,
      source: failure.source,
      ...(detectFailureReasonCode(failure) ? { reasonCode: detectFailureReasonCode(failure) as JsonValue } : {}),
      ...(candidate as Record<string, JsonValue>)
    });
  }

  for (const record of records) {
    const candidate = record.attributes.browser_fallback_cookie_diagnostics;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    diagnostics.push({
      provider: record.provider,
      source: record.source,
      ...(candidate as Record<string, JsonValue>)
    });
  }

  for (const record of records) {
    const attemptChain = record.attributes.attempt_chain;
    if (!Array.isArray(attemptChain)) continue;
    for (const attempt of attemptChain) {
      if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) continue;
      const cookieDiagnostics = (attempt as Record<string, unknown>).cookieDiagnostics;
      if (!cookieDiagnostics || typeof cookieDiagnostics !== "object" || Array.isArray(cookieDiagnostics)) continue;
      diagnostics.push({
        provider: record.provider,
        source: record.source,
        ...(cookieDiagnostics as Record<string, JsonValue>)
      });
    }
  }
  return diagnostics;
};

const summarizeChallengeOrchestration = (
  failures: ProviderFailureEntry[],
  records: NormalizedRecord[]
): Array<Record<string, JsonValue>> => {
  const diagnostics: Array<Record<string, JsonValue>> = [];

  for (const failure of failures) {
    const candidate = failure.error.details?.challengeOrchestration;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    diagnostics.push({
      provider: failure.provider,
      source: failure.source,
      ...(detectFailureReasonCode(failure) ? { reasonCode: detectFailureReasonCode(failure) as JsonValue } : {}),
      ...(typeof failure.error.details?.browserFallbackReasonCode === "string"
        ? { browserFallbackReasonCode: failure.error.details.browserFallbackReasonCode }
        : {}),
      ...(typeof failure.error.details?.browserFallbackMode === "string"
        ? { browserFallbackMode: failure.error.details.browserFallbackMode }
        : {}),
      ...(candidate as Record<string, JsonValue>)
    });
  }

  for (const record of records) {
    const candidate = record.attributes.browser_fallback_challenge_orchestration;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    diagnostics.push({
      provider: record.provider,
      source: record.source,
      ...(typeof record.attributes.browser_fallback_reason_code === "string"
        ? { browserFallbackReasonCode: record.attributes.browser_fallback_reason_code }
        : {}),
      ...(typeof record.attributes.browser_fallback_mode === "string"
        ? { browserFallbackMode: record.attributes.browser_fallback_mode }
        : {}),
      ...(candidate as Record<string, JsonValue>)
    });
  }

  return diagnostics;
};

const summarizeBrowserFallbackModes = (
  failures: ProviderFailureEntry[],
  records: NormalizedRecord[]
): BrowserFallbackMode[] => {
  const observed = new Set<BrowserFallbackMode>();

  for (const failure of failures) {
    const mode = failure.error.details?.browserFallbackMode;
    if (mode === "extension" || mode === "managed_headed") {
      observed.add(mode);
    }
  }

  for (const record of records) {
    const mode = record.attributes.browser_fallback_mode;
    if (mode === "extension" || mode === "managed_headed") {
      observed.add(mode);
    }
  }

  return [...observed];
};

const hasTranscriptSuccess = (record: NormalizedRecord): boolean => {
  const transcriptAvailable = record.attributes.transcript_available;
  if (transcriptAvailable === true) return true;
  const transcriptStrategy = record.attributes.transcript_strategy;
  return typeof transcriptStrategy === "string" && transcriptStrategy.trim().length > 0;
};

const summarizeTranscriptDurability = (
  records: NormalizedRecord[],
  failures: ProviderFailureEntry[]
): {
  attempted: number;
  successful: number;
  failed: number;
  success_rate: number;
} => {
  const successful = records.filter((record) => hasTranscriptSuccess(record)).length;
  const failed = failures.filter((failure) => {
    const reasonCode = detectFailureReasonCode(failure);
    if (reasonCode && TRANSCRIPT_REASON_CODES.has(reasonCode)) return true;
    return Array.isArray(failure.error.details?.attemptChain);
  }).length;
  const attempted = successful + failed;
  return {
    attempted,
    successful,
    failed,
    success_rate: attempted > 0 ? Number((successful / attempted).toFixed(4)) : 0
  };
};

const summarizeAntiBotPressure = (failures: ProviderFailureEntry[]): {
  total_failures: number;
  anti_bot_failures: number;
  anti_bot_failure_ratio: number;
} => {
  const totalFailures = failures.length;
  const antiBotFailures = failures.filter((failure) => {
    const reasonCode = detectFailureReasonCode(failure);
    return Boolean(reasonCode && ANTI_BOT_REASON_CODES.has(reasonCode));
  }).length;
  return {
    total_failures: totalFailures,
    anti_bot_failures: antiBotFailures,
    anti_bot_failure_ratio: totalFailures > 0 ? Number((antiBotFailures / totalFailures).toFixed(4)) : 0
  };
};

export const workflowTestUtils = {
  resetProviderSignalState: (): void => {
    providerSignalMap.clear();
  },
  getDegradedProviders: (): string[] => [...getDegradedProviders()],
  nextSignalState: (
    previous: "none" | "warning" | "degraded",
    warning: boolean,
    degraded: boolean,
    healthyWindows: number
  ): { state: "none" | "warning" | "degraded"; healthyWindows: number } =>
    nextSignalState(previous, warning, degraded, healthyWindows),
  redactRawCapture: (record: unknown): Record<string, unknown> =>
    redactRawCapture(record as Record<string, unknown>),
  toProviderSource: (providerId: string): ProviderSource | null => toProviderSource(providerId),
  resolveShoppingProviderIdForUrl: (url: string): string | null => resolveShoppingProviderIdForUrl(url),
  hasTranscriptSuccess: (record: NormalizedRecord): boolean => hasTranscriptSuccess(record),
  sanitizeFeatureList: (values: string[]): string[] => sanitizeFeatureList(values),
  parsePriceFromContent: (content: string | undefined): { amount: number; currency: string } =>
    parsePriceFromContent(content),
  inferBrandFromUrl: (url: string | undefined): string | undefined => inferBrandFromUrl(url),
  inferBrandFromContent: (content: string | undefined): string | undefined => inferBrandFromContent(content),
  isLikelyOfferRecord: (record: NormalizedRecord): boolean => isLikelyOfferRecord(record),
  needsProductMetadataRefresh: (record: NormalizedRecord, productUrl: string): boolean =>
    needsProductMetadataRefresh(record, productUrl),
  fetchBinary: (url: string, timeoutMs?: number): Promise<Buffer | null> => fetchBinary(url, timeoutMs),
  rankResearchRecords: (records: ResearchRecord[]): ResearchRecord[] => rankResearchRecords(records),
  isValidHttpUrl: (url: string): boolean => isValidHttpUrl(url),
  buildWorkflowResumePayload: (
    kind: WorkflowSuspendedIntentKind,
    input: JsonValue | WorkflowResumeEnvelope
  ): { workflow: ReturnType<typeof buildWorkflowResumeEnvelope> } => buildWorkflowResumePayload(kind, input)
};

const PRODUCT_ASSET_FETCH_TIMEOUT_MS = 15_000;

const resolveAuxiliaryFetchTimeoutMs = (timeoutMs?: number): number => {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return PRODUCT_ASSET_FETCH_TIMEOUT_MS;
  }
  return Math.max(1, Math.min(timeoutMs, PRODUCT_ASSET_FETCH_TIMEOUT_MS));
};

const buildAuxiliaryFetchSignal = (timeoutMs?: number): AbortSignal | undefined => {
  return AbortSignal.timeout(resolveAuxiliaryFetchTimeoutMs(timeoutMs));
};

const toDedupeKey = (record: { url?: string; title?: string }): string => {
  const url = record.url ? canonicalizeUrl(record.url) : "";
  const title = (record.title ?? "").trim().toLowerCase();
  return `${url}::${title}`;
};

const dedupeResearchRecords = (records: ResearchRecord[]): ResearchRecord[] => {
  const deduped = new Map<string, ResearchRecord>();
  for (const record of records) {
    const key = toDedupeKey(record);
    if (!deduped.has(key)) {
      deduped.set(key, record);
      continue;
    }

    const existing = deduped.get(key)!;
    const existingScore = (existing.date_confidence.score * 2) + existing.confidence - existing.recency.age_hours * 0.001;
    const nextScore = (record.date_confidence.score * 2) + record.confidence - record.recency.age_hours * 0.001;
    if (nextScore > existingScore) {
      deduped.set(key, record);
    }
  }
  return [...deduped.values()];
};

const rankResearchRecords = (records: ResearchRecord[]): ResearchRecord[] => {
  return [...records].sort((left, right) => {
    if (left.recency.within_timebox !== right.recency.within_timebox) {
      return left.recency.within_timebox ? -1 : 1;
    }
    if (left.date_confidence.score !== right.date_confidence.score) {
      return right.date_confidence.score - left.date_confidence.score;
    }
    if (left.recency.age_hours !== right.recency.age_hours) {
      return left.recency.age_hours - right.recency.age_hours;
    }
    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }
    return left.id.localeCompare(right.id);
  });
};

const hash = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 16);

const RESEARCH_ALWAYS_SANITIZED_PATHS = new Set<string>([
  "community:search:index",
  "social:search:index"
]);
const RESEARCH_CONDITIONAL_SANITIZED_PATHS = new Set<string>([
  "community:fetch:url",
  "social:fetch:url",
  "web:search:index"
]);
const RESEARCH_LOGIN_SHELL_RE = /\b(?:log in|login|sign in|sign-in|please log in|continue with google|continue with apple)\b/i;
const RESEARCH_JS_REQUIRED_RE = /\b(?:enable javascript|javascript required|javascript is not available|javascript is disabled|you need to enable javascript)\b/i;
const RESEARCH_GENERIC_SHELL_RE = /\b(?:skip to main content|the heart of the internet|open navigation|get the app|view in app|please wait for verification|verify you are human|security check)\b/i;
const RESEARCH_NOT_FOUND_SHELL_RE = /\b(?:error 404|page not found|not found|can['’]t seem to find the page)\b/i;
const RESEARCH_SEARCH_SHELL_RE = /\b(?:duckduckgo|search results|all posts|communities|comments|try another search|no relevant content found|unable to load answer|search page)\b/i;
const isDuckDuckGoResearchShellUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    return (host === "duckduckgo.com" && (pathname === "/l" || pathname === "/l/"))
      || (host === "html.duckduckgo.com" && pathname.startsWith("/html"));
  } catch {
    return false;
  }
};
const PRODUCT_TARGET_NOT_FOUND_RE = /\b(?:error 404|page not found|not found|we can['’]t seem to find the page|can['’]t seem to find the page|return to homepage)\b/i;
const resolveShoppingProviderIdForUrl = (url: string): string | null => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const profile of SHOPPING_PROVIDER_PROFILES) {
      if (profile.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        return profile.id;
      }
    }
    return "shopping/others";
  } catch {
    return null;
  }
};

const IMAGE_ASSET_RE = /\.(?:png|jpg|jpeg|webp|gif)(?:[?#].*)?$/i;

const isHttpAssetUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const extractImageUrls = (record: NormalizedRecord): string[] => {
  const structured = Array.isArray(record.attributes.image_urls)
    ? record.attributes.image_urls.filter((entry): entry is string => typeof entry === "string" && isHttpAssetUrl(entry))
    : [];
  const links = Array.isArray(record.attributes.links)
    ? record.attributes.links.filter((entry): entry is string => typeof entry === "string")
    : [];

  const imageLinks = [
    ...structured.map((entry) => entry.trim()),
    ...links.filter((link) => IMAGE_ASSET_RE.test(link))
  ];
  return [...new Set(imageLinks.map((link) => canonicalizeUrl(link)))].slice(0, 50);
};

const mergeImageUrls = (record: NormalizedRecord, extra: string[] = []): string[] => {
  return [...new Set([
    ...extractImageUrls(record),
    ...extra.map((link) => canonicalizeUrl(link))
  ])].slice(0, 50);
};

const MARKETPLACE_COPY_RE = /\b(?:amazon\.com|walmart\.com|free delivery possible on eligible purchases|continue to site|see current price, availability, shipping cost|buy .* - amazon\.com|shipper\s*\/\s*seller|main content|about this item|buying options|compare with similar items)\b/i;
const MARKETPLACE_OVERLAY_RE = /\b(?:shipper \/ seller|returns \/ exchanges handled by|continue to site|see current price, availability, shipping cost|deliver to canada)\b/i;
const WALMART_TITLE_PREFIX_RE = /^(?:free shipping!?\s*)+/i;
const WALMART_TITLE_TAIL_RE = /\s*[-|:]\s*Walmart\.com\b.*$/i;
const WALMART_TITLE_CHROME_RE = /\b(?:Walmart\.com|Skip to Main Content|Pickup or delivery\?|How do you want your item\?|Departments Services)\b/i;
const WALMART_BRAND_COLOR_RE = /\bColor\s+[A-Z0-9][A-Za-z0-9 /-]*(?=\s+(?:View full specifications|Current price is|Skip to Main Content|Pickup or delivery\?|How do you want your item\?|Sold and shipped by|Seller Rating|Free shipping|Arrives\b|Shipping\b|Delivery\b|Pickup\b|Departments Services|More details|Add to cart)|$)/i;
const WALMART_BRAND_CHROME_TAIL_RE = /\b(?:View full specifications|Current price is|Skip to Main Content|Pickup or delivery\?|How do you want your item\?|Sold and shipped by|Seller Rating|Free shipping|Arrives\b|Shipping\b|Delivery\b|Pickup\b|Departments Services|More details|Add to cart)\b.*$/i;
const WALMART_BRAND_CHROME_RE = /\b(?:Walmart\.com|Skip to Main Content|Pickup or delivery\?|How do you want your item\?|Sold and shipped by|Seller Rating|View full specifications|Current price is|Free shipping|Departments Services)\b/i;
const PRODUCT_FEATURE_SECTION_MARKERS = [
  "about this item",
  "key item features",
  "about this product"
] as const;
const PRODUCT_FEATURE_SECTION_STOP_RE = /\b(?:report an issue|check compatibility|technical details|technical specifications|product information|customer reviews|compare [a-z0-9 ]+|top brand:|from the brand|from the manufacturer|questions|reviews|your recently viewed|back to top|view all item details|view full specifications|generated by ai|reviews summary|was this summary helpful|current price is|price when purchased online|all listings for this product|ratings and reviews|best selling in)\b/i;
const PRODUCT_FEATURE_CAPS_TOKEN = "[A-Z0-9][A-Z0-9'()+/&.,]*(?:-[A-Z0-9][A-Z0-9'()+/&.,]*)*";
const PRODUCT_FEATURE_TITLE_TOKEN = "[A-Z][A-Za-z0-9'()+/&.,]*(?:-[A-Z0-9][A-Za-z0-9'()+/&.,]*)*";
const PRODUCT_FEATURE_PATTERNS = [
  new RegExp(
    `(${PRODUCT_FEATURE_CAPS_TOKEN}(?:\\s+${PRODUCT_FEATURE_CAPS_TOKEN}){0,11})\\s+[\\u2013\\u2014-]\\s+(.+?)(?=(?:${PRODUCT_FEATURE_CAPS_TOKEN}(?:\\s+${PRODUCT_FEATURE_CAPS_TOKEN}){0,11})\\s+[\\u2013\\u2014-]\\s+|$)`,
    "g"
  ),
  new RegExp(
    `(${PRODUCT_FEATURE_TITLE_TOKEN}(?:\\s+${PRODUCT_FEATURE_TITLE_TOKEN}){0,11})\\s*:\\s+(.+?)(?=(?:${PRODUCT_FEATURE_TITLE_TOKEN}(?:\\s+${PRODUCT_FEATURE_TITLE_TOKEN}){0,11})\\s*:\\s+|$)`,
    "g"
  )
] as const;
const HOST_DEFAULT_CURRENCY: Array<[RegExp, string]> = [
  [/amazon\.ca$/i, "CAD"],
  [/amazon\.(?:co\.uk|uk)$/i, "GBP"],
  [/amazon\.(?:de|fr|es|it)$/i, "EUR"],
  [/(?:amazon\.com|walmart\.com|bestbuy\.com|target\.com|ebay\.com)$/i, "USD"]
];

const fetchBinary = async (url: string, timeoutMs?: number): Promise<Buffer | null> => {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "image/*,*/*;q=0.8",
        ...providerRequestHeaders
      },
      redirect: "follow",
      signal: buildAuxiliaryFetchSignal(timeoutMs)
    });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes);
  } catch {
    return null;
  }
};

const inferBrandFromContent = (content: string | undefined): string | undefined => {
  const normalized = normalizePlainText(content);
  if (!normalized) return undefined;
  const storeMatch = /\bVisit the ([A-Z][A-Za-z0-9&+' -]{1,60}) Store\b/i.exec(normalized);
  if (storeMatch?.[1]) {
    return storeMatch[1].trim();
  }
  const topBrandMatch = /\bTop Brand:\s*([A-Z][A-Za-z0-9&+' -]{1,60})\b/i.exec(normalized);
  if (topBrandMatch?.[1]) {
    return topBrandMatch[1].trim();
  }
  const productIdentifiersBrandMatch = /\bProduct Identifiers\s+Brand\s+([A-Z][A-Za-z0-9&+' -]{1,60}?)(?=\s+(?:MPN|UPC|Model)\b|$)/i.exec(normalized);
  if (productIdentifiersBrandMatch?.[1]) {
    return productIdentifiersBrandMatch[1].trim();
  }
  const brandMatch = /\bBrand ([A-Z][A-Za-z0-9&+' -]{1,60})\b/i.exec(normalized);
  if (brandMatch?.[1]) {
    return brandMatch[1].trim();
  }
  return undefined;
};

const inferTitleFromContent = (content: string | undefined): string | undefined => {
  const normalized = normalizePlainText(content);
  if (!normalized) return undefined;
  const storeMatch = /\bVisit the [A-Z][A-Za-z0-9&+' -]{1,60} Store\s+(.+?)(?=\s+(?:Brand [A-Z]|About this item|Key item features|Current price is|Actual Color|[0-9]+(?:\.[0-9]+)? stars out of|Best seller\b))/i.exec(normalized);
  const candidate = normalizePlainText(storeMatch?.[1]);
  if (!candidate || candidate.length < 20 || LOOKS_LIKE_URL_RE.test(candidate)) {
    return undefined;
  }
  return candidate;
};

const sanitizeProductBrandCandidate = (candidate: string | undefined, productUrl: string): string | undefined => {
  const normalized = normalizePlainText(candidate);
  if (!normalized) return undefined;
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
    if (!host.includes("walmart.")) {
      return normalized;
    }
    const cleaned = normalized
      .replace(/^Brand\s+/i, "")
      .replace(/\bVisit the ([A-Z][A-Za-z0-9&+' -]{1,60}) Store\b/i, "$1")
      .replace(WALMART_BRAND_COLOR_RE, "")
      .replace(WALMART_BRAND_CHROME_TAIL_RE, "")
      .replace(/\bWalmart\.com\b.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (
      !cleaned
      || WALMART_BRAND_CHROME_RE.test(cleaned)
      || LOOKS_LIKE_URL_RE.test(cleaned)
      || /[.!?]/.test(cleaned)
      || cleaned.split(/\s+/).length > 5
    ) {
      return undefined;
    }
    return cleaned;
  } catch {
    return normalized;
  }
};

const stripMarketplaceTitleFraming = (title: string, productUrl: string): string => {
  let cleaned = normalizePlainText(title);
  if (!cleaned) return "";
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
    if (host.includes("amazon.")) {
      cleaned = cleaned
        .replace(/^Amazon\.com:\s*/i, "")
        .replace(/\s*:\s*Electronics\s*$/i, "")
        .trim();
    }
    if (host.includes("ebay.")) {
      cleaned = cleaned
        .replace(/\s+for sale online\s*\|\s*eBay.*$/i, "")
        .replace(/\s*\|\s*eBay.*$/i, "")
        .trim();
    }
    if (host.includes("walmart.")) {
      cleaned = cleaned
        .replace(WALMART_TITLE_PREFIX_RE, "")
        .replace(WALMART_TITLE_TAIL_RE, "")
        .replace(/\bWalmart\.com\b.*$/i, "")
        .replace(/\b(?:Skip to Main Content|Pickup or delivery\?|How do you want your item\?|Departments Services)\b.*$/i, "")
        .trim();
    }
    const hostBrand = normalizePlainText(inferBrandFromUrl(productUrl)).replace(/\.com\b/gi, "").trim();
    if (hostBrand) {
      const escapedHostBrand = hostBrand.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      cleaned = cleaned.replace(new RegExp(`\\s*[-|:]\\s*${escapedHostBrand}(?:\\.com)?\\s*$`, "i"), "").trim();
    }
  } catch {
    return cleaned;
  }
  return cleaned;
};

const isMarketplaceTitleChrome = (title: string, productUrl: string): boolean => {
  const cleaned = normalizePlainText(title);
  if (!cleaned) return true;
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
    return host.includes("walmart.") && WALMART_TITLE_CHROME_RE.test(cleaned);
  } catch {
    return false;
  }
};

const collectMarkerIndexes = (value: string, marker: string): number[] => {
  const indexes: number[] = [];
  const lowerValue = value.toLowerCase();
  const lowerMarker = marker.toLowerCase();
  let cursor = lowerValue.indexOf(lowerMarker);
  while (cursor >= 0) {
    indexes.push(cursor);
    cursor = lowerValue.indexOf(lowerMarker, cursor + lowerMarker.length);
  }
  return indexes;
};

const extractProductFeatureSection = (content: string | undefined): string => {
  const normalized = normalizePlainText(content);
  if (!normalized) return "";
  let bestSection = "";
  let bestScore = -1;
  for (const marker of PRODUCT_FEATURE_SECTION_MARKERS) {
    const markerIndexes = collectMarkerIndexes(normalized, marker);
    for (const markerIndex of markerIndexes) {
      let section = normalized.slice(markerIndex + marker.length).trim();
      const stopIndex = section.search(PRODUCT_FEATURE_SECTION_STOP_RE);
      if (stopIndex >= 0) {
        section = section.slice(0, stopIndex).trim();
      }
      section = section
        .replace(/\bAbout this item\b/gi, " ")
        .replace(/\bKey item features\b/gi, " ")
        .replace(/\bSee more product details\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!section) {
        continue;
      }
      const labeledFeatureCount = extractLabeledProductFeatures(section).length;
      const sentenceFeatureCount = sanitizeFeatureList(section.split(/(?<=[.!?])\s+/)).length;
      const score = (labeledFeatureCount * 10) + (sentenceFeatureCount * 5) + Math.min(section.length, 500) / 100;
      if (score > bestScore) {
        bestSection = section;
        bestScore = score;
      }
    }
  }

  return bestSection;
};

const extractLabeledProductFeatures = (section: string): string[] => {
  let best: string[] = [];
  for (const pattern of PRODUCT_FEATURE_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = [...section.matchAll(pattern)]
      .map((match) => normalizePlainText(match[2]))
      .filter(Boolean);
    const cleaned = sanitizeFeatureList(matches);
    if (cleaned.length > best.length) {
      best = cleaned;
    }
  }
  return best;
};

const extractAboutItemFeatures = (content: string | undefined): string[] => {
  const section = extractProductFeatureSection(content);
  if (!section) return [];
  const cleanedLabeledFeatures = extractLabeledProductFeatures(section);
  if (cleanedLabeledFeatures.length > 0) {
    return cleanedLabeledFeatures;
  }
  return sanitizeFeatureList(section.split(/(?<=[.!?])\s+/));
};

const extractMarketplaceSummaryCopy = (content: string | undefined, productUrl: string): string => {
  const normalized = normalizePlainText(content);
  if (!normalized) return "";
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
    if (host.includes("ebay.")) {
      return normalizePlainText(/\bCondition:\s+[A-Za-z-]+\s+[A-Za-z-]+\s+(.+?)\s+Buy It Now\b/i.exec(normalized)?.[1]);
    }
  } catch {
    return "";
  }
  return "";
};

const extractMarketplaceSummaryFeatures = (content: string | undefined, productUrl: string): string[] => {
  const summary = extractMarketplaceSummaryCopy(content, productUrl);
  if (!summary) return [];
  return sanitizeFeatureList(summary.split(/(?<=[.!?])\s+/));
};

const inferHostDefaultCurrency = (productUrl: string): string | undefined => {
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
    const match = HOST_DEFAULT_CURRENCY.find(([pattern]) => pattern.test(host));
    return match?.[1];
  } catch {
    return undefined;
  }
};

const shouldSuppressMarketplacePrice = (
  record: NormalizedRecord,
  productUrl: string,
  price: { amount: number; currency: string }
): boolean => {
  if (price.amount <= 0) return false;
  const expectedCurrency = inferHostDefaultCurrency(productUrl);
  if (!expectedCurrency) return false;
  if (!MARKETPLACE_OVERLAY_RE.test(normalizePlainText(record.content))) return false;
  return price.currency.trim().toUpperCase() !== expectedCurrency;
};

const resolvePreferredProductPrice = (
  record: NormalizedRecord,
  productUrl: string,
  refreshedPrice: { amount: number; currency: string } | undefined,
  primaryOffer: ShoppingOffer
): { amount: number; currency: string; retrieved_at: string } => {
  if (refreshedPrice && refreshedPrice.amount > 0) {
    return {
      amount: refreshedPrice.amount,
      currency: refreshedPrice.currency,
      retrieved_at: primaryOffer.price.retrieved_at
    };
  }
  if (primaryOffer.price.amount > 0) {
    return {
      amount: primaryOffer.price.amount,
      currency: primaryOffer.price.currency,
      retrieved_at: primaryOffer.price.retrieved_at
    };
  }
  if (!requiresManualMarketplacePriceFollowUp(productUrl)) {
    const fallbackPrice = parsePriceFromContent(record.content);
    if (fallbackPrice.amount > 0) {
      return {
        amount: fallbackPrice.amount,
        currency: fallbackPrice.currency,
        retrieved_at: primaryOffer.price.retrieved_at
      };
    }
  }
  return {
    amount: primaryOffer.price.amount,
    currency: primaryOffer.price.currency,
    retrieved_at: primaryOffer.price.retrieved_at
  };
};

const resolveProductPrice = (
  record: NormalizedRecord,
  productUrl: string,
  refreshedPrice: { amount: number; currency: string } | undefined,
  primaryOffer: ShoppingOffer
): { amount: number; currency: string; retrieved_at: string } => {
  const preferred = resolvePreferredProductPrice(record, productUrl, refreshedPrice, primaryOffer);
  if (shouldSuppressMarketplacePrice(record, productUrl, preferred)) {
    return {
      amount: 0,
      currency: inferHostDefaultCurrency(productUrl) ?? preferred.currency,
      retrieved_at: preferred.retrieved_at
    };
  }
  return preferred;
};

const requiresManualMarketplacePriceFollowUp = (productUrl: string): boolean => {
  const providerId = resolveShoppingProviderIdForUrl(productUrl);
  return providerId !== null && providerId !== "shopping/others";
};

const buildManualProductPriceFollowUpMessage = (productUrl: string): string => {
  const provider = normalizePlainText(inferBrandFromUrl(productUrl)) || "Product page";
  return `${provider} requires manual browser follow-up; this run did not determine a reliable PDP price.`;
};

const deriveFeatureList = (record: NormalizedRecord, productUrl: string, fallbackFeatures: string[] = []): string[] => {
  const structured = Array.isArray(record.attributes.features)
    ? record.attributes.features.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const structuredFeatures = sanitizeFeatureList(structured);
  if (structuredFeatures.length > 0) {
    return structuredFeatures;
  }

  const marketplaceSummaryFeatures = extractMarketplaceSummaryFeatures(record.content, productUrl);
  if (marketplaceSummaryFeatures.length > 0) {
    return marketplaceSummaryFeatures;
  }

  const aboutItemFeatures = extractAboutItemFeatures(record.content);
  if (aboutItemFeatures.length > 0) {
    return aboutItemFeatures;
  }

  const fallbackFeatureList = sanitizeFeatureList(fallbackFeatures);
  if (fallbackFeatureList.length > 0) {
    return fallbackFeatureList;
  }

  if (!record.content) return [];
  const candidates = trimProductCopy(record.content)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim());
  return sanitizeFeatureList(candidates);
};

const hasStructuredShoppingPrice = (record: NormalizedRecord): boolean => {
  const nested = record.attributes.shopping_offer;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return false;
  const price = (nested as Record<string, unknown>).price;
  if (!price || typeof price !== "object" || Array.isArray(price)) return false;
  return asNumber((price as Record<string, unknown>).amount) > 0;
};

const needsProductMetadataRefresh = (record: NormalizedRecord, productUrl: string): boolean => {
  if (!/^https?:/i.test(productUrl)) return false;
  const title = normalizePlainText(record.title);
  const brand = typeof record.attributes.brand === "string" ? normalizePlainText(record.attributes.brand) : "";
  return !title || title === canonicalizeUrl(productUrl) || LOOKS_LIKE_URL_RE.test(title) || !brand || brand === "unknown" || !hasStructuredShoppingPrice(record);
};

const refreshProductMetadata = async (
  productUrl: string,
  timeoutMs?: number
): Promise<ReturnType<typeof extractStructuredContent>["metadata"] | null> => {
  try {
    const response = await fetch(productUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...providerRequestHeaders
      },
      redirect: "follow",
      signal: buildAuxiliaryFetchSignal(timeoutMs)
    });
    if (!response.ok) return null;
    const html = await response.text();
    return extractStructuredContent(html, response.url || productUrl).metadata;
  } catch {
    return null;
  }
};

const resolveProductBrand = (
  record: NormalizedRecord,
  productUrl: string,
  refreshedBrand: string | undefined
): string => {
  const canonicalHostBrand = normalizePlainText(inferBrandFromUrl(productUrl))
    .replace(/\.com\b/gi, "")
    .toLowerCase();
  const rejectRetailerBrand = (candidate: string | undefined): string | undefined => {
    const normalized = normalizePlainText(candidate);
    if (!normalized) return undefined;
    const canonicalCandidate = normalized.replace(/\.com\b/gi, "").toLowerCase();
    return canonicalHostBrand && canonicalCandidate === canonicalHostBrand ? undefined : normalized;
  };
  const nested = record.attributes.shopping_offer;
  const nestedProvider = nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>).provider
    : undefined;
  const providerBrand = typeof nestedProvider === "string"
    ? SHOPPING_PROVIDER_PROFILES.find((entry) => entry.id === nestedProvider)?.displayName
    : undefined;
  const candidates = [
    inferBrandFromContent(record.content),
    rejectRetailerBrand(refreshedBrand),
    rejectRetailerBrand(typeof record.attributes.brand === "string" ? record.attributes.brand : undefined),
    rejectRetailerBrand(typeof record.attributes.site_name === "string" ? record.attributes.site_name : undefined),
    rejectRetailerBrand(providerBrand && providerBrand !== "Others" ? providerBrand : undefined),
    extractBrandFromTitle(record.title),
    inferBrandFromUrl(productUrl)
  ]
    .map((entry) => sanitizeProductBrandCandidate(entry, productUrl))
    .filter(Boolean);
  return candidates[0] || "unknown";
};

const resolveProductTitle = (
  record: NormalizedRecord,
  productUrl: string,
  brand: string,
  refreshedTitle: string | undefined
): string => {
  const nested = record.attributes.shopping_offer;
  const nestedTitle = nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>).title
    : undefined;
  const candidates = [
    refreshedTitle,
    inferTitleFromContent(record.content),
    record.title,
    typeof nestedTitle === "string" ? nestedTitle : undefined,
    typeof record.attributes.description === "string" ? record.attributes.description.split(/(?<=[.!?])\s+/)[0] : undefined,
    trimProductCopy(record.content ?? "").split(/(?<=[.!?])\s+/)[0]
  ]
    .map((entry) => stripBrandSuffix(stripMarketplaceTitleFraming(normalizePlainText(entry), productUrl), brand))
    .filter((entry) =>
      entry.length > 0
      && !LOOKS_LIKE_URL_RE.test(entry)
      && entry !== canonicalizeUrl(productUrl)
      && !isMarketplaceTitleChrome(entry, productUrl)
    );
  return candidates[0] || productUrl;
};

const resolveProductCopy = (
  record: NormalizedRecord,
  productUrl: string,
  refreshedDescription: string | undefined,
  featureList: string[]
): string => {
  const preferred = normalizePlainText(refreshedDescription)
    || normalizePlainText(typeof record.attributes.description === "string" ? record.attributes.description : undefined);
  const marketplacePromoCopy = (() => {
    if (!preferred) return false;
    try {
      const host = new URL(productUrl).hostname.toLowerCase();
      return host.includes("walmart.") && /\bfree shipping!?/i.test(preferred);
    } catch {
      return false;
    }
  })();
  if (preferred && !MARKETPLACE_COPY_RE.test(preferred) && !marketplacePromoCopy) {
    return toSnippet(preferred, 8000);
  }
  const marketplaceSummaryCopy = extractMarketplaceSummaryCopy(record.content, productUrl);
  if (marketplaceSummaryCopy) {
    return toSnippet(marketplaceSummaryCopy, 8000);
  }
  if (featureList.length > 0) {
    return toSnippet(featureList.slice(0, 2).join(" "), 8000);
  }
  const featureSectionCopy = normalizePlainText(extractProductFeatureSection(record.content));
  if (featureSectionCopy) {
    return toSnippet(featureSectionCopy, 8000);
  }
  if (preferred) {
    return toSnippet(preferred, 8000);
  }
  return toSnippet(trimProductCopy(record.content ?? ""), 8000);
};

const resolveShoppingSourceForUrl = (url: string): ProviderSource => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = SHOPPING_PROVIDER_PROFILES.some((profile) => profile.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)));
    return match ? "shopping" : "web";
  } catch {
    return "web";
  }
};

type ResearchSanitizeReason =
  | "js_required_shell"
  | "login_shell"
  | "not_found_shell"
  | "search_index_shell"
  | "search_results_shell";

const classifyResearchShellRecord = (record: NormalizedRecord): ResearchSanitizeReason | null => {
  const retrievalPath = typeof record.attributes.retrievalPath === "string"
    ? record.attributes.retrievalPath
    : "";

  const url = typeof record.url === "string" ? record.url.trim().toLowerCase() : "";
  const title = normalizePlainText(record.title).toLowerCase();
  const content = normalizePlainText(record.content).toLowerCase();
  const combined = `${title} ${content}`.trim();

  if (RESEARCH_LOGIN_SHELL_RE.test(combined) || url.includes("/login")) {
    return "login_shell";
  }
  if (RESEARCH_JS_REQUIRED_RE.test(combined)) {
    return "js_required_shell";
  }
  if (RESEARCH_NOT_FOUND_SHELL_RE.test(combined)) {
    return "not_found_shell";
  }
  if (!retrievalPath) {
    return null;
  }
  if (RESEARCH_ALWAYS_SANITIZED_PATHS.has(retrievalPath)) {
    return "search_index_shell";
  }
  if (!RESEARCH_CONDITIONAL_SANITIZED_PATHS.has(retrievalPath)) {
    return null;
  }
  if (retrievalPath === "web:search:index" && (/duckduckgo\.com/.test(url) || LOOKS_LIKE_URL_RE.test(title))) {
    return "search_index_shell";
  }
  if (LOOKS_LIKE_URL_RE.test(title) && RESEARCH_GENERIC_SHELL_RE.test(combined)) {
    return "search_results_shell";
  }
  if (
    RESEARCH_SEARCH_SHELL_RE.test(combined)
    || url.includes("/search")
    || isDuckDuckGoResearchShellUrl(url)
  ) {
    return "search_results_shell";
  }
  return null;
};

const sanitizeResearchRecords = (
  records: NormalizedRecord[]
): {
  records: NormalizedRecord[];
  sanitizedCount: number;
  reasonDistribution: Record<string, number>;
} => {
  const reasonDistribution: Record<string, number> = {};
  const sanitizedRecords = records.filter((record) => {
    const reason = classifyResearchShellRecord(record);
    if (!reason) return true;
    reasonDistribution[reason] = (reasonDistribution[reason] ?? 0) + 1;
    return false;
  });

  return {
    records: sanitizedRecords,
    sanitizedCount: records.length - sanitizedRecords.length,
    reasonDistribution
  };
};

const isValidHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const classifyInvalidProductTarget = (
  record: NormalizedRecord
): { reason: "http_status" | "not_found_shell"; message: string } | null => {
  const status = asNumber(record.attributes.status);
  if (status === 404 || status === 410) {
    return {
      reason: "http_status",
      message: "Product target appears to be a not-found page"
    };
  }

  const title = normalizePlainText(record.title);
  const content = normalizePlainText(record.content);
  const combined = `${title} ${content}`.trim();
  if ((/\b404\b/i.test(title) || /\bnot found\b/i.test(title) || /\b404\b/i.test(content)) && PRODUCT_TARGET_NOT_FOUND_RE.test(combined)) {
    return {
      reason: "not_found_shell",
      message: "Product target appears to be a not-found page"
    };
  }
  return null;
};

export const runResearchWorkflow = async (
  runtime: ProviderExecutor,
  input: ResearchRunInput | WorkflowResumeEnvelope
): Promise<Record<string, unknown>> => {
  const envelope = isWorkflowResumeEnvelope(input as unknown as JsonValue)
    ? input as WorkflowResumeEnvelope
    : buildWorkflowResumeEnvelope("research", input as unknown as JsonValue);
  if (envelope.kind !== "research") {
    throw new Error(`Research workflow envelope kind mismatch. Expected research but received ${envelope.kind}.`);
  }

  const workflowInput = envelope.input as unknown as ResearchRunInput;
  let trace: WorkflowTraceEntry[] = [
    ...(envelope.trace ?? []),
    {
      at: new Date().toISOString(),
      stage: "compile",
      event: "compile_started",
      details: {
        kind: "research"
      }
    }
  ];
  const plan = compileResearchExecutionPlan({
    input: workflowInput,
    envelope,
    now: new Date(),
    getDegradedProviders: () => getRuntimeDegradedProviders(runtime)
  });
  trace = [
    ...trace,
    {
      at: new Date().toISOString(),
      stage: "compile",
      event: "compile_completed",
      details: {
        searchSteps: plan.plan.steps.length,
        completedSteps: plan.checkpointState.completed_step_ids.length
      }
    }
  ];

  const buildResearchStepOptions = (
    step: ResearchWorkflowExecutionStep,
    stepEnvelope: WorkflowResumeEnvelope
  ): ProviderRunOptions => {
    const stepOptions = withChallengeAutomationOverride(withCookieOverrides({
      source: step.input.source,
      ...(typeof workflowInput.timeoutMs === "number" ? { timeoutMs: workflowInput.timeoutMs } : {})
    }, workflowInput), workflowInput);

    return withWorkflowResumeEnvelopeIntent(
      stepOptions,
      "workflow.research",
      stepEnvelope
    );
  };

  const execution = await executeResearchWorkflowPlan(runtime, plan, {
    trace,
    buildStepOptions: buildResearchStepOptions,
    observeResult: (result) => {
      observeWorkflowSignals(runtime, result);
    }
  });

  const excludedProviderSet = new Set(plan.compiled.autoExcludedProviders);
  const mergedRecords = removeExcludedProviders(
    [
      ...execution.searchRuns.flatMap((run) => run.result.records),
      ...execution.followUpRuns.flatMap((run) => run.result.records)
    ],
    excludedProviderSet
  );
  const sanitizedRecords = sanitizeResearchRecords(mergedRecords);
  const mergedFailures = removeExcludedProviders(
    [
      ...execution.searchRuns.flatMap((run) => run.result.failures),
      ...execution.followUpRuns.flatMap((run) => run.result.failures)
    ],
    excludedProviderSet
  );
  const reasonCodeDistribution = summarizeReasonCodeDistribution(mergedFailures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(mergedFailures);
  const evaluationNow = new Date();
  const withinTimebox = filterByTimebox(sanitizedRecords.records, plan.compiled.timebox, evaluationNow);
  const enriched = enrichResearchRecords(withinTimebox, plan.compiled.timebox, evaluationNow);
  const deduped = dedupeResearchRecords(enriched);
  const ranked = rankResearchRecords(deduped);
  const noUsableResearchRecords = mergedRecords.length > 0
    && mergedFailures.length === 0
    && ranked.length === 0;
  const cookieDiagnostics = summarizeCookieDiagnostics(mergedFailures, mergedRecords);
  const transcriptStrategyDetailDistribution = summarizeTranscriptStrategyDetailDistribution(ranked);
  const transcriptDurability = summarizeTranscriptDurability(ranked, mergedFailures);
  const antiBotPressure = summarizeAntiBotPressure(mergedFailures);
  const resolvedTimebox = plan.compiled.timebox.mode === "days"
    ? {
      ...plan.compiled.timebox,
      to: new Date(Math.max(new Date(plan.compiled.timebox.to).getTime(), evaluationNow.getTime())).toISOString()
    }
    : plan.compiled.timebox;

  if (noUsableResearchRecords && sanitizedRecords.records.length === 0) {
    const sanitizedReasons = Object.entries(sanitizedRecords.reasonDistribution)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(",");
    throw new Error(
      `Research workflow produced only shell records and no usable results (${sanitizedReasons || "sanitized"}).`
    );
  }

  if (noUsableResearchRecords && sanitizedRecords.records.length > 0 && withinTimebox.length === 0) {
    throw new Error("Research workflow produced no usable in-timebox results after sanitization.");
  }

  if (noUsableResearchRecords) {
    throw new Error("Research workflow produced no usable results after post-processing.");
  }

  const primaryConstraintFailures = selectResearchPrimaryConstraintFailures(mergedFailures);
  const meta = withPrimaryConstraintMeta({
    timebox: resolvedTimebox,
    selection: withExcludedProviders({
      source_selection: plan.compiled.sourceSelection,
      resolved_sources: plan.compiled.resolvedSources
    }, plan.compiled.autoExcludedProviders),
    metrics: {
      total_records: mergedRecords.length,
      sanitized_records: sanitizedRecords.sanitizedCount,
      sanitized_reason_distribution: sanitizedRecords.reasonDistribution,
      sanitizedReasonDistribution: sanitizedRecords.reasonDistribution,
      within_timebox: withinTimebox.length,
      final_records: ranked.length,
      failed_sources: execution.searchRuns.filter((run) => !run.result.ok).map((run) => run.source),
      reasonCodeDistribution,
      transcript_strategy_failures: transcriptStrategyFailures,
      transcriptStrategyFailures,
      transcript_strategy_detail_failures: transcriptStrategyFailures,
      transcriptStrategyDetailFailures: transcriptStrategyFailures,
      transcript_strategy_detail_distribution: transcriptStrategyDetailDistribution,
      transcriptStrategyDetailDistribution,
      transcript_durability: transcriptDurability,
      transcriptDurability,
      cookie_diagnostics: cookieDiagnostics,
      cookieDiagnostics,
      anti_bot_pressure: antiBotPressure,
      antiBotPressure
    },
    failures: mergedFailures,
    alerts: buildWorkflowAlerts(runtime, mergedFailures)
  } as Record<string, unknown>, primaryConstraintFailures);

  const rendered = renderResearch({
    mode: workflowInput.mode,
    topic: plan.compiled.topic,
    records: ranked,
    meta
  });

  const bundle = await createArtifactBundle({
    namespace: "research",
    outputDir: workflowInput.outputDir,
    ttlHours: workflowInput.ttlHours,
    files: rendered.files
  });

  if (workflowInput.mode === "path") {
    return {
      ...rendered.response,
      path: bundle.basePath,
      records: ranked,
      meta: {
        ...meta,
        artifact_manifest: bundle.manifest
      }
    };
  }

  return {
    ...rendered.response,
    artifact_path: bundle.basePath,
    records: ranked,
    meta: {
      ...meta,
      artifact_manifest: bundle.manifest
    }
  };
};

export const runShoppingWorkflow = async (
  runtime: ProviderExecutor,
  input: ShoppingRunInput | WorkflowResumeEnvelope
): Promise<Record<string, unknown>> => {
  const envelope = isWorkflowResumeEnvelope(input as unknown as JsonValue)
    ? input as WorkflowResumeEnvelope
    : buildWorkflowResumeEnvelope("shopping", input as unknown as JsonValue);
  if (envelope.kind !== "shopping") {
    throw new Error(`Shopping workflow envelope kind mismatch. Expected shopping but received ${envelope.kind}.`);
  }

  const workflowInput = envelope.input as unknown as ShoppingRunInput;
  let trace: WorkflowTraceEntry[] = [
    ...(envelope.trace ?? []),
    {
      at: new Date().toISOString(),
      stage: "compile",
      event: "compile_started",
      details: {
        kind: "shopping"
      }
    }
  ];
  const plan = compileShoppingExecutionPlan({
    input: workflowInput,
    envelope,
    now: new Date(),
    getDegradedProviders: (providerIds) => getRuntimeDegradedProviders(runtime, providerIds)
  });
  trace = [
    ...trace,
    {
      at: new Date().toISOString(),
      stage: "compile",
      event: "compile_completed",
      details: {
        searchSteps: plan.plan.steps.length,
        completedSteps: plan.checkpointState.completed_step_ids.length
      }
    }
  ];

  const buildShoppingStepOptions = (
    step: ShoppingWorkflowExecutionStep,
    stepEnvelope: WorkflowResumeEnvelope
  ): ProviderRunOptions => {
    const stepOptions = withBrowserModeOverride(
      withChallengeAutomationOverride(
        withCookieOverrides({
          source: "shopping",
          providerIds: [step.input.providerId],
          ...(typeof workflowInput.timeoutMs === "number" ? { timeoutMs: workflowInput.timeoutMs } : {})
        }, workflowInput),
        workflowInput
      ),
      workflowInput
    );

    return withWorkflowResumeEnvelopeIntent(
      stepOptions,
      "workflow.shopping",
      stepEnvelope
    );
  };

  const execution = await executeShoppingWorkflowPlan(runtime, plan, {
    trace,
    buildStepOptions: buildShoppingStepOptions,
    observeResult: (result) => {
      observeWorkflowSignals(runtime, result);
    }
  });

  const {
    offers,
    failures,
    records,
    zeroPriceExcluded
  } = postprocessShoppingWorkflow(plan.compiled, execution.runs);
  const reasonCodeDistribution = summarizeReasonCodeDistribution(failures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(failures);
  const transcriptStrategyDetailDistribution = summarizeTranscriptStrategyDetailDistribution(records);
  const transcriptDurability = summarizeTranscriptDurability(records, failures);
  const cookieDiagnostics = summarizeCookieDiagnostics(failures, records);
  const challengeOrchestration = summarizeChallengeOrchestration(failures, records);
  const browserFallbackModesObserved = summarizeBrowserFallbackModes(failures, records);
  const antiBotPressure = summarizeAntiBotPressure(failures);
  const alerts = buildWorkflowAlerts(runtime, failures, plan.compiled.effectiveProviderIds);
  if (plan.compiled.regionDiagnostics.length > 0) {
    alerts.push({
      signal: "region_unenforced",
      reasonCode: "region_unenforced",
      state: "warning",
      reason: "Default shopping adapters currently use provider default storefronts and do not enforce requested region filters.",
      providers: plan.compiled.regionDiagnostics.map((entry) => entry.provider),
      requested_region: workflowInput.region ?? plan.compiled.regionDiagnostics[0]?.requestedRegion ?? ""
    });
  }
  const meta = withPrimaryConstraintMeta({
    selection: {
      providers: plan.compiled.effectiveProviderIds,
      ...(plan.compiled.autoExcludedProviders.length > 0 ? { excluded_providers: plan.compiled.autoExcludedProviders } : {}),
      ...(workflowInput.browserMode ? { requested_browser_mode: workflowInput.browserMode } : {}),
      ...(workflowInput.region
        ? {
          requested_region: workflowInput.region,
          region_enforced: plan.compiled.regionDiagnostics.every((entry) => entry.enforced),
          region_support: plan.compiled.regionDiagnostics
        }
        : {})
    },
    metrics: {
      total_offers: offers.length,
      failed_providers: failures.map((entry) => entry.provider),
      reasonCodeDistribution,
      transcript_strategy_failures: transcriptStrategyFailures,
      transcriptStrategyFailures,
      transcript_strategy_detail_failures: transcriptStrategyFailures,
      transcriptStrategyDetailFailures: transcriptStrategyFailures,
      transcript_strategy_detail_distribution: transcriptStrategyDetailDistribution,
      transcriptStrategyDetailDistribution,
      transcript_durability: transcriptDurability,
      transcriptDurability,
      cookie_diagnostics: cookieDiagnostics,
      cookieDiagnostics,
      challenge_orchestration: challengeOrchestration,
      challengeOrchestration,
      browser_fallback_modes_observed: browserFallbackModesObserved,
      browserFallbackModesObserved,
      anti_bot_pressure: antiBotPressure,
      antiBotPressure,
      zero_price_excluded: zeroPriceExcluded
    },
    failures,
    alerts
  } as Record<string, unknown>, failures);

  const rendered = renderShopping({
    mode: workflowInput.mode,
    query: plan.compiled.query,
    offers,
    meta
  });

  const bundle = await createArtifactBundle({
    namespace: "shopping",
    outputDir: workflowInput.outputDir,
    ttlHours: workflowInput.ttlHours,
    files: rendered.files
  });

  if (workflowInput.mode === "path") {
    return {
      ...rendered.response,
      path: bundle.basePath,
      offers,
      meta: {
        ...meta,
        artifact_manifest: bundle.manifest
      }
    };
  }

  return {
    ...rendered.response,
    offers,
    artifact_path: bundle.basePath,
    meta: {
      ...meta,
      artifact_manifest: bundle.manifest
    }
  };
};

export const runProductVideoWorkflow = async (
  runtime: ProviderExecutor,
  input: ProductVideoRunInput | WorkflowResumeEnvelope,
  options: ProductVideoWorkflowOptions = {}
): Promise<Record<string, unknown>> => {
  const envelope = isWorkflowResumeEnvelope(input as unknown as JsonValue)
    ? input as WorkflowResumeEnvelope
    : buildWorkflowResumeEnvelope("product_video", input as unknown as JsonValue);
  if (envelope.kind !== "product_video") {
    throw new Error(`Product-video workflow envelope kind mismatch. Expected product_video but received ${envelope.kind}.`);
  }

  let trace: WorkflowTraceEntry[] = [
    ...(envelope.trace ?? []),
    {
      at: new Date().toISOString(),
      stage: "compile",
      event: "compile_started",
      details: {
        kind: "product_video"
      }
    }
  ];
  const plan = compileProductVideoExecutionPlan({
    input: envelope.input as unknown as ProductVideoRunInput,
    envelope
  });
  trace = [
    ...trace,
    {
      at: new Date().toISOString(),
      stage: "compile",
      event: "compile_completed",
      details: {
        steps: plan.plan.steps.length,
        completedSteps: plan.checkpointState.completed_step_ids.length,
        resolutionRequired: plan.compiled.resolutionRequired
      }
    }
  ];

  const workflowInput = plan.input;
  const startedAtMs = Date.now();
  const includeScreenshots = plan.compiled.includeScreenshots;
  const includeAllImages = plan.compiled.includeAllImages;
  const includeCopy = plan.compiled.includeCopy;
  const timeoutOptions = typeof workflowInput.timeoutMs === "number"
    ? { timeoutMs: workflowInput.timeoutMs }
    : {};
  const remainingTimeoutMs = (): number | undefined => {
    if (typeof workflowInput.timeoutMs !== "number" || !Number.isFinite(workflowInput.timeoutMs) || workflowInput.timeoutMs <= 0) {
      return undefined;
    }
    return Math.max(1, workflowInput.timeoutMs - Math.max(0, Date.now() - startedAtMs));
  };
  const appendProductVideoTrace = (
    currentTrace: WorkflowTraceEntry[],
    stage: WorkflowTraceEntry["stage"],
    event: string,
    details?: Record<string, JsonValue>
  ): WorkflowTraceEntry[] => [
    ...currentTrace,
    {
      at: new Date().toISOString(),
      stage,
      event,
      ...(details ? { details } : {})
    }
  ];
  const buildProductVideoCheckpoint = (
    checkpointState: ProductVideoWorkflowCheckpointState,
    step: ProductVideoWorkflowExecutionStep,
    stepIndex: number
  ): WorkflowCheckpoint => ({
    stage: "execute",
    stepId: step.id,
    stepIndex,
    state: serializeProductVideoCheckpointState(checkpointState),
    updatedAt: new Date().toISOString()
  });
  const markProductVideoStepCompleted = (
    checkpointState: ProductVideoWorkflowCheckpointState,
    stepId: string,
    updates: Partial<Omit<ProductVideoWorkflowCheckpointState, "completed_step_ids">> = {}
  ): ProductVideoWorkflowCheckpointState => ({
    ...checkpointState,
    ...updates,
    completed_step_ids: checkpointState.completed_step_ids.includes(stepId)
      ? checkpointState.completed_step_ids
      : [...checkpointState.completed_step_ids, stepId]
  });
  const getRequiredProductVideoStep = <
    TStepId extends ProductVideoWorkflowExecutionStep["id"]
  >(stepId: TStepId): Extract<ProductVideoWorkflowExecutionStep, { id: TStepId }> => {
    const step = plan.plan.steps.find(
      (candidate): candidate is Extract<ProductVideoWorkflowExecutionStep, { id: TStepId }> => candidate.id === stepId
    );
    if (!step) {
      throw new Error(`Product-video workflow plan is missing required step ${stepId}.`);
    }
    return step;
  };

  let checkpointState: ProductVideoWorkflowCheckpointState = {
    ...plan.checkpointState,
    completed_step_ids: [...plan.checkpointState.completed_step_ids]
  };
  let productUrl = checkpointState.resolved_product_url ?? plan.compiled.productUrl;
  let providerHint = checkpointState.resolved_provider_hint ?? plan.compiled.providerHint;
  let stepIndex = 0;

  const normalizeStep = getRequiredProductVideoStep(PRODUCT_VIDEO_STEP_IDS.normalizeInput);
  stepIndex += 1;
  trace = appendProductVideoTrace(trace, "execute", "step_started", {
    stepId: normalizeStep.id,
    stepKind: normalizeStep.kind
  });
  checkpointState = markProductVideoStepCompleted(checkpointState, normalizeStep.id);
  trace = appendProductVideoTrace(trace, "execute", "step_completed", {
    stepId: normalizeStep.id,
    stepKind: normalizeStep.kind,
    resolutionRequired: plan.compiled.resolutionRequired
  });

  const resolveStep = plan.plan.steps.find(
    (step): step is Extract<ProductVideoWorkflowExecutionStep, { id: typeof PRODUCT_VIDEO_STEP_IDS.resolveProductUrl }> => (
      step.id === PRODUCT_VIDEO_STEP_IDS.resolveProductUrl
    )
  );
  if (resolveStep) {
    const currentStepIndex = stepIndex;
    stepIndex += 1;
    if (checkpointState.completed_step_ids.includes(resolveStep.id)) {
      if (!checkpointState.resolved_product_url) {
        throw new Error("Product-video workflow checkpoint is missing resolved_product_url for a completed resolution step.");
      }
      productUrl = checkpointState.resolved_product_url;
      providerHint = checkpointState.resolved_provider_hint ?? providerHint;
      trace = appendProductVideoTrace(trace, "resume", "step_reused", {
        stepId: resolveStep.id,
        stepKind: resolveStep.kind
      });
    } else {
      trace = appendProductVideoTrace(trace, "execute", "step_started", {
        stepId: resolveStep.id,
        stepKind: resolveStep.kind
      });
      const shoppingResult = await runShoppingWorkflow(runtime, {
        query: resolveStep.input.product_name,
        providers: providerHint ? [providerHint] : undefined,
        mode: "json",
        ...timeoutOptions,
        useCookies: workflowInput.useCookies,
        challengeAutomationMode: workflowInput.challengeAutomationMode,
        cookiePolicyOverride: workflowInput.cookiePolicyOverride
      });

      const offers = shoppingResult.offers as ShoppingOffer[];
      const resolutionSummary = (shoppingResult.meta as Record<string, unknown>).primaryConstraintSummary;
      if (offers.length === 0) {
        throw new Error(
          typeof resolutionSummary === "string"
            ? resolutionSummary
            : (
              /* c8 ignore next -- no-offer shopping responses always carry a canonical summary */
              "Unable to resolve product URL from product_name"
            )
        );
      }
      const resolvedOffer = offers.find((offer) => /^https?:\/\//i.test(offer.url)) ?? offers[0];
      productUrl = resolvedOffer?.url;
      providerHint = resolvedOffer?.provider;
      checkpointState = markProductVideoStepCompleted(checkpointState, resolveStep.id, {
        resolved_product_url: productUrl,
        resolved_provider_hint: providerHint
      });
      trace = appendProductVideoTrace(trace, "execute", "step_completed", {
        stepId: resolveStep.id,
        stepKind: resolveStep.kind,
        offers: offers.length,
        ...(productUrl ? { resolvedProductUrl: productUrl } : {})
      });
    }
  }

  if (!productUrl) {
    throw new Error("Unable to resolve product URL");
  }

  const fetchStep = getRequiredProductVideoStep(PRODUCT_VIDEO_STEP_IDS.fetchProductDetail);
  let details: ProviderAggregateResult;
  if (checkpointState.completed_step_ids.includes(fetchStep.id)) {
    if (!checkpointState.detail_result) {
      throw new Error("Product-video workflow checkpoint is missing detail_result for a completed fetch step.");
    }
    details = checkpointState.detail_result;
    trace = appendProductVideoTrace(trace, "resume", "step_reused", {
      stepId: fetchStep.id,
      stepKind: fetchStep.kind,
      productUrl
    });
    stepIndex += 1;
  } else {
    const source = resolveShoppingSourceForUrl(productUrl);
    const shoppingProviderId = source === "shopping"
      ? (
        providerHint
          ? (providerHint.startsWith("shopping/") ? providerHint : `shopping/${providerHint}`)
          : resolveShoppingProviderIdForUrl(productUrl)
      )
      : null;
    if (shoppingProviderId) {
      enforceShoppingLegalReviewGate([shoppingProviderId], new Date());
    }

    const currentStepIndex = stepIndex;
    stepIndex += 1;
    trace = appendProductVideoTrace(trace, "execute", "step_started", {
      stepId: fetchStep.id,
      stepKind: fetchStep.kind,
      productUrl,
      ...(shoppingProviderId ? { providerId: shoppingProviderId } : {})
    });
    const checkpoint = buildProductVideoCheckpoint(checkpointState, fetchStep, currentStepIndex);
    const preSuspendTrace = appendProductVideoTrace(trace, "execute", "pre_suspend_checkpoint", {
      stepId: fetchStep.id,
      stepKind: fetchStep.kind,
      completedSteps: checkpointState.completed_step_ids.length,
      productUrl,
      ...(providerHint ? { providerHint } : {})
    });
    const stepEnvelope = buildWorkflowResumeEnvelope(
      "product_video",
      workflowInput as unknown as JsonValue,
      {
        checkpoint,
        trace: preSuspendTrace
      }
    );
    details = await runtime.fetch(
      { url: productUrl },
      withWorkflowResumeEnvelopeIntent(
        withChallengeAutomationOverride(
          withCookieOverrides({
            source,
            providerIds: shoppingProviderId ? [shoppingProviderId] : undefined,
            ...timeoutOptions
          }, workflowInput),
          workflowInput
        ),
        "workflow.product_video",
        stepEnvelope
      )
    );
    observeWorkflowSignals(runtime, details);
    checkpointState = markProductVideoStepCompleted(checkpointState, PRODUCT_VIDEO_STEP_IDS.fetchProductDetail, {
      resolved_product_url: productUrl,
      resolved_provider_hint: providerHint,
      detail_result: details
    });
    trace = appendProductVideoTrace(preSuspendTrace, "execute", "step_completed", {
      stepId: fetchStep.id,
      stepKind: fetchStep.kind,
      records: details.records.length,
      failures: details.failures.length
    });
  }

  if (details.records.length === 0) {
    const reason = summarizePrimaryProviderIssue(details.failures)?.summary
      ?? details.error?.message
      ?? "Product details unavailable";
    throw new Error(reason);
  }

  const extractStep = getRequiredProductVideoStep(PRODUCT_VIDEO_STEP_IDS.extractProductData);
  trace = appendProductVideoTrace(trace, "execute", "step_started", {
    stepId: extractStep.id,
    stepKind: extractStep.kind
  });
  stepIndex += 1;
  const primary = details.records[0] as NormalizedRecord;
  const invalidTarget = classifyInvalidProductTarget(primary);
  if (invalidTarget) {
    throw new Error(invalidTarget.message);
  }
  const refreshedMetadata = needsProductMetadataRefresh(primary, productUrl)
    ? await refreshProductMetadata(productUrl, remainingTimeoutMs())
    : null;
  const primaryOffer = extractShoppingOffer(primary, new Date());
  const preferredPrice = resolvePreferredProductPrice(primary, productUrl, refreshedMetadata?.price, primaryOffer);

  const resolvedBrand = resolveProductBrand(primary, productUrl, refreshedMetadata?.brand);
  const resolvedTitle = resolveProductTitle(primary, productUrl, resolvedBrand, refreshedMetadata?.title);
  const resolvedPrice = resolveProductPrice(primary, productUrl, refreshedMetadata?.price, primaryOffer);
  if (
    resolvedPrice.amount <= 0
    && (
      shouldSuppressMarketplacePrice(primary, productUrl, preferredPrice)
      || requiresManualMarketplacePriceFollowUp(productUrl)
    )
  ) {
    throw new Error(buildManualProductPriceFollowUpMessage(productUrl));
  }
  const featureList = deriveFeatureList(primary, productUrl, refreshedMetadata?.features ?? []);
  const imageUrls = mergeImageUrls(primary, refreshedMetadata?.imageUrls ?? []);
  const selectedImageUrls = includeAllImages ? imageUrls : imageUrls.slice(0, 1);
  trace = appendProductVideoTrace(trace, "execute", "step_completed", {
    stepId: extractStep.id,
    stepKind: extractStep.kind,
    imageCandidates: imageUrls.length,
    featureCount: featureList.length,
    refreshedMetadata: Boolean(refreshedMetadata)
  });

  const assembleStep = getRequiredProductVideoStep(PRODUCT_VIDEO_STEP_IDS.assembleArtifacts);
  trace = appendProductVideoTrace(trace, "execute", "step_started", {
    stepId: assembleStep.id,
    stepKind: assembleStep.kind
  });
  stepIndex += 1;
  const files: ArtifactFile[] = [];
  const imagePaths: string[] = [];
  const imageContents: Buffer[] = [];
  for (const [index, imageUrl] of selectedImageUrls.entries()) {
    const imageContent = await fetchBinary(imageUrl, remainingTimeoutMs());
    if (!imageContent) continue;
    const extension = imageUrl.match(/\.(png|jpg|jpeg|webp|gif)(?:[?#].*)?$/i)?.[1]?.toLowerCase() ?? "jpg";
    const relativePath = `images/image-${String(index + 1).padStart(2, "0")}.${extension}`;
    files.push({ path: relativePath, content: imageContent });
    imagePaths.push(relativePath);
    imageContents.push(imageContent);
  }

  const screenshotPaths: string[] = [];
  if (includeScreenshots) {
    const screenshotBuffer = options.captureScreenshot
      ? await options.captureScreenshot(productUrl, remainingTimeoutMs())
      : null;
    if (screenshotBuffer) {
      const screenshotPath = "screenshots/screenshot-01.png";
      files.push({ path: screenshotPath, content: screenshotBuffer });
      screenshotPaths.push(screenshotPath);
    } else if (imagePaths[0]) {
      const fallbackPath = "screenshots/screenshot-01.png";
      files.push({ path: fallbackPath, content: imageContents[0]! });
      screenshotPaths.push(fallbackPath);
    }
  }

  const copyText = includeCopy ? resolveProductCopy(primary, productUrl, refreshedMetadata?.description, featureList) : "";
  const pricing = resolvedPrice;

  const productPayload = {
    title: resolvedTitle,
    brand: resolvedBrand,
    provider: providerHint ?? primary.provider,
    url: productUrl,
    features: featureList,
    copy: copyText
  };

  const manifestPayload = {
    run_id: hash(`${productUrl}:${Date.now()}`),
    created_at: new Date().toISOString(),
    source_url: productUrl,
    provider: providerHint ?? primary.provider,
    product: {
      title: productPayload.title,
      brand: productPayload.brand,
      price: pricing,
      features: featureList,
      copy: copyText
    },
    assets: {
      images: imagePaths,
      screenshots: screenshotPaths,
      raw: ["raw/source-record.json"]
    }
  };

  files.push(
    { path: "manifest.json", content: manifestPayload },
    { path: "product.json", content: productPayload },
    { path: "pricing.json", content: pricing },
    { path: "copy.md", content: copyText || "" },
    { path: "features.md", content: featureList.map((feature) => `- ${feature}`).join("\n") },
    {
      path: "raw/source-record.json",
      content: redactRawCapture(JSON.parse(JSON.stringify(primary)) as Record<string, unknown>)
    }
  );
  trace = appendProductVideoTrace(trace, "postprocess", "step_completed", {
    stepId: assembleStep.id,
    stepKind: assembleStep.kind,
    images: imagePaths.length,
    screenshots: screenshotPaths.length,
    files: files.length
  });

  const bundle = await createArtifactBundle({
    namespace: "product-assets",
    outputDir: workflowInput.output_dir,
    ttlHours: workflowInput.ttl_hours,
    files,
    manifestFileName: "bundle-manifest.json"
  });

  const reasonCodeDistribution = summarizeReasonCodeDistribution(details.failures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(details.failures);
  const transcriptStrategyDetailDistribution = summarizeTranscriptStrategyDetailDistribution(details.records);
  const transcriptDurability = summarizeTranscriptDurability(details.records, details.failures);
  const cookieDiagnostics = summarizeCookieDiagnostics(details.failures, details.records);
  const antiBotPressure = summarizeAntiBotPressure(details.failures);
  const primaryIssue = summarizePrimaryProviderIssue(details.failures);

  return {
    path: bundle.basePath,
    manifest: manifestPayload,
    product: productPayload,
    pricing,
    screenshots: screenshotPaths,
    images: imagePaths,
    meta: {
      alerts: buildWorkflowAlerts(runtime, details.failures),
      failures: details.failures,
      ...(primaryIssue ? { primaryConstraintSummary: primaryIssue.summary } : {}),
      reasonCodeDistribution,
      transcript_strategy_failures: transcriptStrategyFailures,
      transcriptStrategyFailures,
      transcript_strategy_detail_failures: transcriptStrategyFailures,
      transcriptStrategyDetailFailures: transcriptStrategyFailures,
      transcript_strategy_detail_distribution: transcriptStrategyDetailDistribution,
      transcriptStrategyDetailDistribution,
      transcript_durability: transcriptDurability,
      transcriptDurability,
      cookie_diagnostics: cookieDiagnostics,
      cookieDiagnostics,
      anti_bot_pressure: antiBotPressure,
      antiBotPressure,
      artifact_manifest: bundle.manifest
    }
  };
};
