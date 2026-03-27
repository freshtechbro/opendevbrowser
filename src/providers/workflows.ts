import { createHash } from "crypto";
import { createArtifactBundle, type ArtifactFile } from "./artifacts";
import { classifyBlockerSignal } from "./blocker";
import { applyProviderIssueHint, readProviderIssueHintFromRecord, summarizePrimaryProviderIssue } from "./constraint";
import { enrichResearchRecords, type ResearchRecord } from "./enrichment";
import { renderResearch, renderShopping, type RenderMode, type ShoppingOffer } from "./renderer";
import { filterByTimebox, resolveTimebox } from "./timebox";
import {
  SHOPPING_PROVIDER_IDS,
  SHOPPING_PROVIDER_PROFILES,
  getShoppingRegionSupportDiagnostics,
  validateShoppingLegalReviewChecklist
} from "./shopping";
import { createLogger, redactSensitive } from "../core/logging";
import { normalizeProviderReasonCode } from "./errors";
import type { ChallengeAutomationMode } from "../challenges/types";
import { providerRequestHeaders } from "./shared/request-headers";
import { canonicalizeUrl } from "./web/crawler";
import { extractStructuredContent, extractText, toSnippet } from "./web/extract";
import type { ProviderAntiBotSnapshot } from "./registry";
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

const resolveAutoExcludedProviders = (
  runtime: ProviderExecutor,
  sourceSelection: ProviderSelection,
  resolvedSources: ProviderSource[]
): string[] => {
  if (sourceSelection !== "auto") return [];
  const sourceSet = new Set(resolvedSources);
  return [...getRuntimeDegradedProviders(runtime)]
    .filter((provider) => {
      const source = toProviderSource(provider);
      return source !== null && sourceSet.has(source);
    })
    .sort((left, right) => left.localeCompare(right));
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
      primary_constraint_summary: primaryIssue.summary,
      primaryConstraintSummary: primaryIssue.summary
    }
    : meta;
};

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

const withWorkflowResumeIntent = (
  options: ProviderRunOptions,
  kind: "workflow.research" | "workflow.shopping" | "workflow.product_video",
  input: JsonValue
): ProviderRunOptions => ({
  ...options,
  suspendedIntent: {
    kind,
    input
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
  isLikelyOfferRecord: (record: NormalizedRecord): boolean => isLikelyOfferRecord(record),
  needsProductMetadataRefresh: (record: NormalizedRecord, productUrl: string): boolean =>
    needsProductMetadataRefresh(record, productUrl),
  fetchBinary: (url: string, timeoutMs?: number): Promise<Buffer | null> => fetchBinary(url, timeoutMs),
  rankResearchRecords: (records: ResearchRecord[]): ResearchRecord[] => rankResearchRecords(records)
};

const RESEARCH_AUTO_SOURCES: ProviderSource[] = ["web", "community", "social"];
const RESEARCH_ALL_SOURCES: ProviderSource[] = ["web", "community", "social", "shopping"];
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

const resolveResearchSources = (input: ResearchRunInput): { sourceSelection: ProviderSelection; resolved: ProviderSource[] } => {
  if (input.sources && input.sources.length > 0) {
    const deduped = [...new Set(input.sources)];
    return {
      sourceSelection: input.sourceSelection ?? "auto",
      resolved: deduped
    };
  }

  const selection = input.sourceSelection ?? "auto";
  if (selection === "all") {
    return { sourceSelection: selection, resolved: RESEARCH_ALL_SOURCES };
  }
  if (selection === "auto") {
    return { sourceSelection: selection, resolved: RESEARCH_AUTO_SOURCES };
  }
  return {
    sourceSelection: selection,
    resolved: [selection]
  };
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

const LOOKS_LIKE_URL_RE = /^https?:\/\/\S+$/i;
const PRICE_SCAN_RE = /([$€£])\s*([0-9]{1,4}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/g;
const PRODUCT_COPY_CUTOFF_PATTERNS = [
  /frequently asked questions/i,
  /footer footnotes/i,
  /which [a-z0-9 ]+ is right for you/i,
  /compare all [a-z0-9 ]+ models/i,
  /more ways to shop/i,
  /privacy policy/i,
  /terms of use/i
] as const;
const PRODUCT_FEATURE_NOISE_RE = /\b(?:frequently asked questions|footnote|carrier deals|connect to any carrier later|at&t|t-mobile|verizon|boost mobile|applecare|privacy policy|terms of use|returns?|refunds?|bill credits?|trade[- ]?in|required|monthly|\/mo\b|deductible|service fee|more ways to shop)\b/i;
const PRODUCT_PRICE_NEGATIVE_CONTEXT_RE = /\b(?:save(?: up to)?|trade[- ]?in|bill credits?|credit|credits|off\b|monthly|per month|\/mo\b|deductible|service fee|activation fee)\b/i;
const PRODUCT_PRICE_POSITIVE_CONTEXT_RE = /\b(?:starting at|starts at|starting from|from|connect to any carrier later|buy now|buy for|unlocked)\b/i;
const SHOPPING_INTENT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "best",
  "buy",
  "deal",
  "deals",
  "for",
  "from",
  "new",
  "on",
  "sale",
  "shop",
  "shopping",
  "the",
  "to",
  "with"
]);
const SHOPPING_ACCESSORY_KEYWORDS = new Set([
  "accessory",
  "adapter",
  "adapters",
  "bag",
  "bags",
  "cable",
  "cables",
  "case",
  "cases",
  "charger",
  "chargers",
  "cover",
  "covers",
  "dock",
  "docks",
  "hub",
  "hubs",
  "keyboard",
  "protector",
  "protectors",
  "screenprotector",
  "skin",
  "skins",
  "sleeve",
  "sleeves",
  "stand",
  "stands"
]);
const RESEARCH_ALWAYS_SANITIZED_PATHS = new Set<string>([
  "community:search:index",
  "social:search:index"
]);
const RESEARCH_CONDITIONAL_SANITIZED_PATHS = new Set<string>([
  "community:fetch:url",
  "social:fetch:url",
  "web:search:index"
]);
const RESEARCH_WEB_SEARCH_FETCH_PATHS = new Set<string>([
  "web:search:index",
  "web:search:url"
]);
const RESEARCH_WEB_SEARCH_FETCH_LIMIT = 3;
const RESEARCH_LOGIN_SHELL_RE = /\b(?:log in|login|sign in|sign-in|please log in|continue with google|continue with apple)\b/i;
const RESEARCH_JS_REQUIRED_RE = /\b(?:enable javascript|javascript required|javascript is not available|javascript is disabled|you need to enable javascript)\b/i;
const RESEARCH_GENERIC_SHELL_RE = /\b(?:skip to main content|the heart of the internet|open navigation|get the app|view in app|please wait for verification|verify you are human|security check)\b/i;
const RESEARCH_NOT_FOUND_SHELL_RE = /\b(?:error 404|page not found|not found|can['’]t seem to find the page)\b/i;
const RESEARCH_SEARCH_SHELL_RE = /\b(?:duckduckgo|search results|all posts|communities|comments|try another search|no relevant content found|unable to load answer|search page)\b/i;
const PRODUCT_TARGET_NOT_FOUND_RE = /\b(?:error 404|page not found|not found|we can['’]t seem to find the page|can['’]t seem to find the page|return to homepage)\b/i;
const DEFAULT_SHOPPING_PROVIDER_IDS = SHOPPING_PROVIDER_PROFILES
  .filter((profile) => profile.tier === "tier1")
  .map((profile) => profile.id);
const KNOWN_BRAND_BY_HOST_SUFFIX: Record<string, string> = {
  "aliexpress.com": "AliExpress",
  "amazon.com": "Amazon",
  "apple.com": "Apple",
  "bestbuy.com": "Best Buy",
  "costco.com": "Costco",
  "ebay.com": "eBay",
  "macys.com": "Macy's",
  "newegg.com": "Newegg",
  "target.com": "Target",
  "temu.com": "Temu",
  "walmart.com": "Walmart"
};

const normalizePlainText = (value: string | undefined): string => {
  if (!value) return "";
  return extractText(value).replace(/\s+/g, " ").trim();
};

const normalizeShoppingIntentText = (value: string | undefined): string => {
  return normalizePlainText(value)
    .toLowerCase()
    .replace(/(\d+)\s+(gb|tb|inch|in)\b/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const tokenizeShoppingIntent = (value: string | undefined): string[] => {
  const normalized = normalizeShoppingIntentText(value);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !SHOPPING_INTENT_STOP_WORDS.has(token));
};

const hasAccessoryMarker = (value: string | undefined): boolean => {
  return tokenizeShoppingIntent(value).some((token) => SHOPPING_ACCESSORY_KEYWORDS.has(token));
};

const isAccessoryQuery = (query: string): boolean => hasAccessoryMarker(query);

const normalizeFeatureEntry = (value: string): string | null => {
  const normalized = normalizePlainText(value);
  if (normalized.length < 8 || normalized.length > 160) return null;
  if (!/[a-z]/i.test(normalized)) return null;
  if (PRODUCT_FEATURE_NOISE_RE.test(normalized)) return null;
  if (/\$[0-9]/.test(normalized)) return null;
  if (/\b(?:can i|will my|when i|what resources|learn more)\b/i.test(normalized)) return null;
  return normalized;
};

const sanitizeFeatureList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const cleaned = normalizeFeatureEntry(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
    if (normalized.length >= 12) break;
  }
  return normalized;
};

const trimProductCopy = (value: string): string => {
  let trimmed = normalizePlainText(value);
  if (!trimmed) return "";
  let cutoff = trimmed.length;
  for (const pattern of PRODUCT_COPY_CUTOFF_PATTERNS) {
    const matchIndex = trimmed.search(pattern);
    if (matchIndex >= 0) {
      cutoff = Math.min(cutoff, matchIndex);
    }
  }
  trimmed = trimmed.slice(0, cutoff).trim();
  return trimmed.replace(/\bFootnote\b\s*[0-9†‡§∆◊※±]*/gi, " ").replace(/\s+/g, " ").trim();
};

const stripBrandSuffix = (title: string, brand: string | undefined): string => {
  if (!brand) return title;
  return title.replace(new RegExp(`\\s*[-|:]\\s*${brand.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*$`, "i"), "").trim();
};

const inferBrandFromUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [suffix, brand] of Object.entries(KNOWN_BRAND_BY_HOST_SUFFIX)) {
      if (host === suffix || host.endsWith(`.${suffix}`)) {
        return brand;
      }
    }
    const profile = SHOPPING_PROVIDER_PROFILES.find((entry) => entry.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)));
    if (profile) return profile.displayName;
    return undefined;
  } catch {
    return undefined;
  }
};

const extractBrandFromTitle = (title: string | undefined): string | undefined => {
  if (!title) return undefined;
  const cleaned = normalizePlainText(title);
  const match = /(?:[-|:]\s*)([A-Z][A-Za-z0-9&+' -]{1,40})$/.exec(cleaned);
  return match?.[1]?.trim() || undefined;
};

const parseMatchedPrice = (currencySymbol: string | undefined, rawAmount: string | undefined): {
  amount: number;
  currency: string;
} | null => {
  if (!currencySymbol || !rawAmount) return null;
  const amount = Number(rawAmount.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    amount,
    currency: currencySymbol === "€" ? "EUR" : currencySymbol === "£" ? "GBP" : "USD"
  };
};

const asNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const parsePriceFromContent = (content: string | undefined): { amount: number; currency: string } => {
  const normalized = normalizePlainText(content);
  if (!normalized) return { amount: 0, currency: "USD" };

  const contextualMatches = [...normalized.matchAll(
    /(?:connect to any carrier later|starting at|starts at|starting from|from|buy now for|buy for)\s*([$€£])\s*([0-9]{1,4}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/gi
  )]
    .map((match) => parseMatchedPrice(match[1], match[2]))
    .filter((entry): entry is { amount: number; currency: string } => entry !== null)
    .sort((left, right) => left.amount - right.amount);
  if (contextualMatches.length > 0) {
    return contextualMatches[0]!;
  }

  const candidates = [...normalized.matchAll(PRICE_SCAN_RE)]
    .map((match) => {
      const parsed = parseMatchedPrice(match[1], match[2]);
      if (!parsed) return null;
      const index = match.index as number;
      const context = normalized.slice(Math.max(0, index - 48), Math.min(normalized.length, index + match[0].length + 48));
      let score = 0;
      if (PRODUCT_PRICE_NEGATIVE_CONTEXT_RE.test(context)) score -= 4;
      if (PRODUCT_PRICE_POSITIVE_CONTEXT_RE.test(context)) score += 3;
      if (parsed.amount < 10) score -= 3;
      return {
        ...parsed,
        score,
        index
      };
    })
    .filter((entry): entry is { amount: number; currency: string; score: number; index: number } => entry !== null)
    .sort((left, right) => right.score - left.score || left.amount - right.amount || left.index - right.index);
  if (candidates.length === 0 || candidates[0]!.score < -1) {
    return { amount: 0, currency: "USD" };
  }
  return {
    amount: candidates[0]!.amount,
    currency: candidates[0]!.currency
  };
};

const scoreShoppingOfferIntent = (
  query: string,
  offer: ShoppingOffer
): { intentScore: number; accessoryPenalty: number; directMatch: boolean } => {
  const queryTokens = tokenizeShoppingIntent(query);
  if (queryTokens.length === 0) {
    return {
      intentScore: 0,
      accessoryPenalty: 0,
      directMatch: false
    };
  }

  let offerUrlIntentText = "";
  try {
    const parsed = new URL(offer.url);
    offerUrlIntentText = `${parsed.hostname} ${parsed.pathname}`;
  } catch {
    offerUrlIntentText = "";
  }
  const offerText = `${offer.title} ${offerUrlIntentText}`.trim();
  const offerTokens = new Set(tokenizeShoppingIntent(offerText));
  const normalizedQuery = normalizeShoppingIntentText(query);
  const normalizedOffer = normalizeShoppingIntentText(offerText);
  const matchedTokens = queryTokens.filter((token) => offerTokens.has(token));
  const importantMatches = matchedTokens.filter((token) => token.length > 2 || /\d/.test(token));
  const exactPhrase = normalizedQuery.length > 0 && normalizedOffer.includes(normalizedQuery);
  const directMatch = exactPhrase || importantMatches.length >= Math.min(queryTokens.length, 3);
  const accessoryPenalty = !isAccessoryQuery(query) && hasAccessoryMarker(offerText) ? 6 : 0;
  const intentScore = (importantMatches.length * 3)
    + ((matchedTokens.length - importantMatches.length) * 1.5)
    + (exactPhrase ? 4 : 0)
    + (directMatch ? 2 : 0)
    - accessoryPenalty;

  return {
    intentScore,
    accessoryPenalty,
    directMatch
  };
};

const availabilityRank = (availability: ShoppingOffer["availability"]): number => {
  switch (availability) {
    case "in_stock":
      return 1;
    case "limited":
      return 0.75;
    case "unknown":
      return 0.45;
    case "out_of_stock":
      return 0.1;
  }
};

const computeDealScore = (offer: ShoppingOffer, now: Date): number => {
  const total = Math.max(0, offer.price.amount + offer.shipping.amount);
  const priceScore = total > 0 ? 1 / (1 + total / 100) : 0;
  const availabilityScore = availabilityRank(offer.availability);
  const ratingScore = Math.max(0, Math.min(1, offer.rating / 5));
  const recencyHours = Math.max(0, (now.getTime() - new Date(offer.price.retrieved_at).getTime()) / (60 * 60 * 1000));
  const recencyScore = 1 / (1 + recencyHours / 24);
  const score = (priceScore * 0.55) + (availabilityScore * 0.2) + (ratingScore * 0.15) + (recencyScore * 0.1);
  return Number(score.toFixed(6));
};

const resolveShoppingProviders = (providers?: string[]): string[] => {
  if (!providers || providers.length === 0) {
    return DEFAULT_SHOPPING_PROVIDER_IDS.length > 0
      ? [...DEFAULT_SHOPPING_PROVIDER_IDS]
      : [...SHOPPING_PROVIDER_IDS];
  }

  const normalized = providers
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean)
    .map((provider) => provider.startsWith("shopping/") ? provider : `shopping/${provider}`);

  const deduped = [...new Set(normalized)].filter((provider) => SHOPPING_PROVIDER_IDS.includes(provider as (typeof SHOPPING_PROVIDER_IDS)[number]));
  if (deduped.length === 0) {
    throw new Error("No valid shopping providers were requested");
  }
  return deduped;
};

const enforceShoppingLegalReviewGate = (providerIds: string[], now: Date): void => {
  const blocked = providerIds
    .map((providerId) => ({ providerId, validation: validateShoppingLegalReviewChecklist(providerId, now) }))
    .filter((entry) => !entry.validation.valid);

  if (blocked.length === 0) return;
  const summary = blocked
    .map((entry) => `${entry.providerId}:${entry.validation.reasonCode ?? "missing_checklist"}`)
    .join(", ");
  throw new Error(`Provider legal review checklist invalid or expired: ${summary}`);
};

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

const extractShoppingOffer = (record: NormalizedRecord, now: Date): ShoppingOffer => {
  const nested = (record.attributes.shopping_offer ?? {}) as Record<string, unknown>;
  const nestedPrice = (nested.price ?? {}) as Record<string, unknown>;
  const nestedShipping = (nested.shipping ?? {}) as Record<string, unknown>;

  const fallbackPrice = parsePriceFromContent(record.content);
  const priceAmount = asNumber(nestedPrice.amount) || fallbackPrice.amount;
  const priceCurrency = typeof nestedPrice.currency === "string" && nestedPrice.currency.trim()
    ? nestedPrice.currency
    : fallbackPrice.currency;
  const retrievedAt = typeof nestedPrice.retrieved_at === "string" && nestedPrice.retrieved_at.trim()
    ? nestedPrice.retrieved_at
    : now.toISOString();

  const title = (typeof nested.title === "string" && nested.title.trim())
    ? nested.title
    : record.title ?? record.url ?? record.provider;
  const url = (typeof nested.url === "string" && nested.url.trim())
    ? nested.url
    : record.url ?? "";

  const shippingAmount = asNumber(nestedShipping.amount);
  const shippingCurrency = typeof nestedShipping.currency === "string" && nestedShipping.currency.trim()
    ? nestedShipping.currency
    : priceCurrency;

  const availabilityRaw = typeof nested.availability === "string" ? nested.availability : "unknown";
  const availability: ShoppingOffer["availability"] = availabilityRaw === "in_stock" || availabilityRaw === "limited" || availabilityRaw === "out_of_stock"
    ? availabilityRaw
    : "unknown";

  const offer: ShoppingOffer = {
    offer_id: `${record.provider}:${record.id}`,
    product_id: typeof nested.product_id === "string" && nested.product_id.trim()
      ? nested.product_id
      : hash(`${canonicalizeUrl(url)}::${title.toLowerCase()}`),
    provider: record.provider,
    url,
    title,
    price: {
      amount: priceAmount,
      currency: priceCurrency,
      retrieved_at: retrievedAt
    },
    shipping: {
      amount: shippingAmount,
      currency: shippingCurrency,
      notes: typeof nestedShipping.notes === "string" ? nestedShipping.notes : "unknown"
    },
    availability,
    rating: asNumber(nested.rating),
    reviews_count: asNumber(nested.reviews_count),
    deal_score: 0,
    attributes: {
      ...record.attributes,
      source_record_id: record.id
    }
  };

  offer.deal_score = computeDealScore(offer, now);
  return offer;
};

const dedupeOffers = (offers: ShoppingOffer[]): ShoppingOffer[] => {
  const deduped = new Map<string, ShoppingOffer>();
  for (const offer of offers) {
    const key = `${canonicalizeUrl(offer.url)}::${offer.title.toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || offer.deal_score > existing.deal_score) {
      deduped.set(key, offer);
    }
  }
  return [...deduped.values()];
};

const rankOffers = (
  offers: ShoppingOffer[],
  sort: ShoppingRunInput["sort"],
  query?: string
): ShoppingOffer[] => {
  const ordered = [...offers];
  switch (sort) {
    case "lowest_price":
      return ordered.sort((left, right) => {
        const leftTotal = left.price.amount + left.shipping.amount;
        const rightTotal = right.price.amount + right.shipping.amount;
        return leftTotal - rightTotal;
      });
    case "highest_rating":
      return ordered.sort((left, right) => right.rating - left.rating || right.reviews_count - left.reviews_count);
    case "fastest_shipping":
      return ordered.sort((left, right) => left.shipping.amount - right.shipping.amount || right.deal_score - left.deal_score);
    case "best_deal":
    default:
      return ordered.sort((left, right) => {
        const leftIntent = scoreShoppingOfferIntent(query ?? "", left);
        const rightIntent = scoreShoppingOfferIntent(query ?? "", right);
        if (leftIntent.directMatch !== rightIntent.directMatch) {
          return rightIntent.directMatch ? 1 : -1;
        }
        if (leftIntent.intentScore !== rightIntent.intentScore) {
          return rightIntent.intentScore - leftIntent.intentScore;
        }
        return right.deal_score - left.deal_score
          || (left.price.amount + left.shipping.amount) - (right.price.amount + right.shipping.amount);
      });
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

const deriveFeatureList = (record: NormalizedRecord, fallbackFeatures: string[] = []): string[] => {
  const structured = Array.isArray(record.attributes.features)
    ? record.attributes.features.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const structuredFeatures = sanitizeFeatureList(structured);
  if (structuredFeatures.length > 0) {
    return structuredFeatures;
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

const isLikelyOfferRecord = (record: NormalizedRecord): boolean => {
  const retrievalPath = typeof record.attributes.retrievalPath === "string"
    ? record.attributes.retrievalPath
    : "";
  if (retrievalPath === "shopping:search:index" || retrievalPath === "shopping:search:link") return false;
  if (retrievalPath.startsWith("shopping:search:") && retrievalPath !== "shopping:search:result-card" && retrievalPath !== "shopping:search:url") {
    return false;
  }

  if (!record.url) return true;

  const canonicalUrl = canonicalizeUrl(record.url);
  if (!/^https?:/i.test(canonicalUrl)) return false;
  if (/\.(?:png|jpe?g|gif|webp|svg|ico|css|js)(?:$|\?)/i.test(canonicalUrl)) return false;
  const title = normalizePlainText(record.title);
  if (!title || LOOKS_LIKE_URL_RE.test(title) || title === canonicalUrl) return false;

  const profile = SHOPPING_PROVIDER_PROFILES.find((entry) => entry.id === record.provider);
  if (profile && profile.domains.length > 0 && retrievalPath.startsWith("shopping:search:")) {
    try {
      const host = new URL(canonicalUrl).hostname.toLowerCase();
      const matchesProviderDomain = profile.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
      if (!matchesProviderDomain) return false;
    } catch {
      return false;
    }
  }
  return true;
};

const inferShoppingNoOfferFailure = (
  providerId: string,
  query: string,
  records: NormalizedRecord[]
): ProviderFailureEntry => {
  const issuePriority = (issue: NonNullable<ReturnType<typeof readProviderIssueHintFromRecord>>): number => {
    if (issue.reasonCode === "token_required" || issue.reasonCode === "auth_required") return 3;
    if (issue.reasonCode === "challenge_detected") return 2;
    if (issue.constraint?.kind === "render_required") return 1;
    return 0;
  };
  let primaryRecordIssue:
    | {
      hint: NonNullable<ReturnType<typeof readProviderIssueHintFromRecord>>;
      url?: string;
      title?: string;
      providerShell?: string;
    }
    | null = null;
  for (const record of records) {
    const hint = readProviderIssueHintFromRecord(record);
    if (!hint) continue;
    if (!primaryRecordIssue || issuePriority(hint) > issuePriority(primaryRecordIssue.hint)) {
      primaryRecordIssue = {
        hint,
        ...(typeof record.url === "string" ? { url: canonicalizeUrl(record.url) } : {}),
        ...(normalizePlainText(record.title) ? { title: normalizePlainText(record.title) } : {}),
        ...(typeof record.attributes.providerShell === "string" && record.attributes.providerShell.trim().length > 0
          ? { providerShell: record.attributes.providerShell.trim() }
          : {})
      };
    }
  }

  if (primaryRecordIssue) {
    const reasonCode = primaryRecordIssue.hint.reasonCode;
    return {
      provider: providerId,
      source: "shopping",
      error: {
        code: reasonCode === "token_required" || reasonCode === "auth_required" ? "auth" : "unavailable",
        message: reasonCode === "token_required" || reasonCode === "auth_required"
          ? `Authentication required for provider results for query "${query}".`
          : reasonCode === "challenge_detected"
            ? `Detected anti-bot challenge while retrieving provider results for query "${query}".`
            : `Provider requires browser-rendered results for query "${query}".`,
        retryable: reasonCode === "env_limited",
        reasonCode,
        provider: providerId,
        source: "shopping",
        details: applyProviderIssueHint({
          query,
          recordsCount: records.length,
          noOfferRecords: true,
          ...(primaryRecordIssue.url ? { url: primaryRecordIssue.url } : {}),
          ...(primaryRecordIssue.title ? { title: primaryRecordIssue.title } : {}),
          ...(primaryRecordIssue.providerShell ? { providerShell: primaryRecordIssue.providerShell } : {})
        }, primaryRecordIssue.hint)
      }
    };
  }

  const fallbackFailure: ProviderFailureEntry = {
    provider: providerId,
    source: "shopping",
    error: {
      code: "unavailable",
      message: `Provider returned no usable shopping offers for query "${query}".`,
      retryable: true,
      reasonCode: "env_limited",
      provider: providerId,
      source: "shopping",
      details: {
        query,
        recordsCount: records.length,
        noOfferRecords: true,
        reasonCode: "env_limited"
      }
    }
  };

  for (const record of records) {
    const url = typeof record.url === "string" ? canonicalizeUrl(record.url) : undefined;
    const title = normalizePlainText(record.title) || undefined;
    const message = toSnippet(normalizePlainText(record.content), 800) || undefined;
    const blocker = classifyBlockerSignal({
      source: "runtime_fetch",
      ...(url ? { url, finalUrl: url } : {}),
      ...(title ? { title } : {}),
      ...(message ? { message } : {}),
      providerErrorCode: "unavailable",
      retryable: true
    });
    if (!blocker || blocker.type === "unknown") continue;

    const reasonCode = blocker.reasonCode ?? "env_limited";
    return {
      provider: providerId,
      source: "shopping",
      error: {
        code: "unavailable",
        message: `Provider returned no usable shopping offers for query "${query}".`,
        retryable: blocker.retryable,
        reasonCode,
        provider: providerId,
        source: "shopping",
        details: {
          query,
          recordsCount: records.length,
          noOfferRecords: true,
          reasonCode,
          blockerType: blocker.type,
          blockerConfidence: blocker.confidence,
          ...(url ? { url } : {}),
          ...(title ? { title } : {})
        }
      }
    };
  }

  return fallbackFailure;
};

const createEmptyShoppingResultFailure = (
  providerId: string,
  query: string,
  records: NormalizedRecord[]
): ProviderFailureEntry => inferShoppingNoOfferFailure(providerId, query, records);

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
  const nested = record.attributes.shopping_offer;
  const nestedProvider = nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>).provider
    : undefined;
  const providerBrand = typeof nestedProvider === "string"
    ? SHOPPING_PROVIDER_PROFILES.find((entry) => entry.id === nestedProvider)?.displayName
    : undefined;
  const candidates = [
    refreshedBrand,
    typeof record.attributes.brand === "string" ? record.attributes.brand : undefined,
    typeof record.attributes.site_name === "string" ? record.attributes.site_name : undefined,
    providerBrand && providerBrand !== "Others" ? providerBrand : undefined,
    extractBrandFromTitle(record.title),
    inferBrandFromUrl(productUrl)
  ].map((entry) => normalizePlainText(entry)).filter(Boolean);
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
    record.title,
    typeof nestedTitle === "string" ? nestedTitle : undefined,
    typeof record.attributes.description === "string" ? record.attributes.description.split(/(?<=[.!?])\s+/)[0] : undefined,
    trimProductCopy(record.content ?? "").split(/(?<=[.!?])\s+/)[0]
  ]
    .map((entry) => stripBrandSuffix(normalizePlainText(entry), brand))
    .filter((entry) => entry.length > 0 && !LOOKS_LIKE_URL_RE.test(entry) && entry !== canonicalizeUrl(productUrl));
  return candidates[0] || productUrl;
};

const resolveProductCopy = (
  record: NormalizedRecord,
  refreshedDescription: string | undefined
): string => {
  const preferred = normalizePlainText(refreshedDescription)
    || normalizePlainText(typeof record.attributes.description === "string" ? record.attributes.description : undefined);
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
    || url.includes("duckduckgo.com/l?")
    || url.includes("html.duckduckgo.com/html")
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

const resolveResearchWebFetchCandidates = (
  records: NormalizedRecord[],
  limit: number
): string[] => {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const retrievalPath = typeof record.attributes.retrievalPath === "string"
      ? record.attributes.retrievalPath
      : "";
    if (!RESEARCH_WEB_SEARCH_FETCH_PATHS.has(retrievalPath)) {
      continue;
    }
    const rawUrl = typeof record.url === "string" ? canonicalizeUrl(record.url) : "";
    if (!rawUrl) {
      continue;
    }
    let resolvedUrl = rawUrl;
    try {
      const parsed = new URL(rawUrl);
      if (/duckduckgo\.com$/i.test(parsed.hostname) && parsed.pathname === "/l") {
        const redirect = parsed.searchParams.get("uddg");
        if (typeof redirect === "string" && redirect.length > 0) {
          resolvedUrl = canonicalizeUrl(redirect);
        }
      }
    } catch {
      continue;
    }
    if (!resolvedUrl || !isValidHttpUrl(resolvedUrl) || /duckduckgo\.com/i.test(resolvedUrl) || seen.has(resolvedUrl)) {
      continue;
    }
    seen.add(resolvedUrl);
    candidates.push(resolvedUrl);
    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates;
};

const fetchResearchWebRecords = async (
  runtime: ProviderExecutor,
  input: ResearchRunInput,
  records: NormalizedRecord[]
): Promise<{
  records: NormalizedRecord[];
  failures: ProviderFailureEntry[];
}> => {
  const candidates = resolveResearchWebFetchCandidates(
    records,
    Math.max(1, Math.min(input.limitPerSource ?? 10, RESEARCH_WEB_SEARCH_FETCH_LIMIT))
  );
  if (candidates.length === 0) {
    return {
      records: [],
      failures: []
    };
  }

  const fetchOptions = withWorkflowResumeIntent(
    withChallengeAutomationOverride(
      withCookieOverrides({
        source: "web"
      }, input),
      input
    ),
    "workflow.research",
    input as unknown as JsonValue
  );
  const runs = await Promise.all(candidates.map(async (url) => {
    const result = await runtime.fetch({
      url
    }, fetchOptions);
    observeWorkflowSignals(runtime, result);
    return result;
  }));

  return {
    records: runs.flatMap((run) => run.records),
    failures: runs.flatMap((run) => run.failures)
  };
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
  input: ResearchRunInput
): Promise<Record<string, unknown>> => {
  const topic = input.topic?.trim();
  if (!topic) {
    throw new Error("topic is required");
  }

  const { sourceSelection, resolved } = resolveResearchSources(input);
  const now = new Date();
  const timebox = resolveTimebox({
    days: input.days,
    from: input.from,
    to: input.to,
    now
  });
  if (resolved.includes("shopping")) {
    enforceShoppingLegalReviewGate(SHOPPING_PROVIDER_IDS, now);
  }
  const excludedProviders = resolveAutoExcludedProviders(runtime, sourceSelection, resolved);
  const excludedProviderSet = new Set(excludedProviders);

  const runs = await Promise.all(resolved.map(async (source) => {
    const result = await runtime.search({
      query: topic,
      limit: input.limitPerSource ?? 10,
      filters: {
        include_engagement: input.includeEngagement ?? false,
        timebox_from: timebox.from,
        timebox_to: timebox.to
      }
    }, withWorkflowResumeIntent(withChallengeAutomationOverride(withCookieOverrides({
      source
    }, input), input), "workflow.research", input as unknown as JsonValue));
    observeWorkflowSignals(runtime, result);
    return {
      source,
      result
    };
  }));

  const fetchedWebRecords = await fetchResearchWebRecords(
    runtime,
    input,
    runs.flatMap((run) => run.result.records)
  );
  const mergedRecords = removeExcludedProviders(
    [...runs.flatMap((run) => run.result.records), ...fetchedWebRecords.records],
    excludedProviderSet
  );
  const sanitizedRecords = sanitizeResearchRecords(mergedRecords);
  const mergedFailures = removeExcludedProviders(
    [...runs.flatMap((run) => run.result.failures), ...fetchedWebRecords.failures],
    excludedProviderSet
  );
  const reasonCodeDistribution = summarizeReasonCodeDistribution(mergedFailures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(mergedFailures);
  const evaluationNow = new Date();
  const withinTimebox = filterByTimebox(sanitizedRecords.records, timebox, evaluationNow);
  const enriched = enrichResearchRecords(withinTimebox, timebox, evaluationNow);
  const deduped = dedupeResearchRecords(enriched);
  const ranked = rankResearchRecords(deduped);
  const cookieDiagnostics = summarizeCookieDiagnostics(mergedFailures, mergedRecords);
  const transcriptStrategyDetailDistribution = summarizeTranscriptStrategyDetailDistribution(ranked);
  const transcriptDurability = summarizeTranscriptDurability(ranked, mergedFailures);
  const antiBotPressure = summarizeAntiBotPressure(mergedFailures);
  const resolvedTimebox = timebox.mode === "days"
    ? {
      ...timebox,
      to: new Date(Math.max(new Date(timebox.to).getTime(), evaluationNow.getTime())).toISOString()
    }
    : timebox;

  const meta = withPrimaryConstraintMeta({
    timebox: resolvedTimebox,
    selection: withExcludedProviders({
      source_selection: sourceSelection,
      resolved_sources: resolved
    }, excludedProviders),
    metrics: {
      total_records: mergedRecords.length,
      sanitized_records: sanitizedRecords.sanitizedCount,
      sanitized_reason_distribution: sanitizedRecords.reasonDistribution,
      sanitizedReasonDistribution: sanitizedRecords.reasonDistribution,
      within_timebox: withinTimebox.length,
      final_records: ranked.length,
      failed_sources: runs.filter((run) => !run.result.ok).map((run) => run.source),
      reason_code_distribution: reasonCodeDistribution,
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
  } as Record<string, unknown>, mergedFailures);

  const rendered = renderResearch({
    mode: input.mode,
    topic,
    records: ranked,
    meta
  });

  const bundle = await createArtifactBundle({
    namespace: "research",
    outputDir: input.outputDir,
    ttlHours: input.ttlHours,
    files: rendered.files
  });

  if (input.mode === "path") {
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
  input: ShoppingRunInput
): Promise<Record<string, unknown>> => {
  const query = input.query?.trim();
  if (!query) {
    throw new Error("query is required");
  }

  const providerIds = resolveShoppingProviders(input.providers);
  const hasExplicitProviderSelection = Boolean(input.providers && input.providers.length > 0);
  const degradedProviders = getRuntimeDegradedProviders(runtime, providerIds);
  const autoExcludedProviders = hasExplicitProviderSelection
    ? []
    : providerIds.filter((providerId) => degradedProviders.has(providerId));
  const effectiveProviderIds = hasExplicitProviderSelection
    ? providerIds
    : providerIds.filter((providerId) => !degradedProviders.has(providerId));
  const now = new Date();
  if (effectiveProviderIds.length === 0) {
    throw new Error("All default shopping providers are temporarily excluded due to degraded anti-bot/rate-limit state");
  }
  enforceShoppingLegalReviewGate(effectiveProviderIds, now);

  const runs = await Promise.all(effectiveProviderIds.map(async (providerId) => {
    const result = await runtime.search({
      query,
      limit: 8,
      filters: {
        ...(typeof input.budget === "number" ? { budget: input.budget } : {}),
        ...(input.region ? { region: input.region } : {})
      }
    }, withWorkflowResumeIntent(withBrowserModeOverride(withChallengeAutomationOverride(withCookieOverrides({
      source: "shopping",
      providerIds: [providerId],
      ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {})
    }, input), input), input), "workflow.shopping", input as unknown as JsonValue));
    observeWorkflowSignals(runtime, result);
    return {
      providerId,
      result
    };
  }));

  const runsWithOfferRecords = runs.map((run) => ({
    ...run,
    offerRecords: run.result.records.filter((record) => isLikelyOfferRecord(record))
  }));
  const regionDiagnostics = input.region
    ? getShoppingRegionSupportDiagnostics(effectiveProviderIds, input.region)
    : [];
  const extractedOffers = runsWithOfferRecords
    .flatMap((run) => run.offerRecords)
    .map((record) => extractShoppingOffer(record, now));
  const zeroPriceExcluded = extractedOffers.filter((offer) => offer.price.amount <= 0).length;

  const offers = rankOffers(
    dedupeOffers(extractedOffers.filter((offer) => {
      if (offer.price.amount <= 0) return false;
      if (typeof input.budget !== "number") return true;
      return offer.price.amount <= input.budget;
    })),
    input.sort ?? "best_deal",
    query
  );

  const failures = runsWithOfferRecords.flatMap((run) => {
    if (run.result.failures.length > 0) {
      return run.result.failures;
    }
    if (run.offerRecords.length > 0) {
      return [];
    }
    return [createEmptyShoppingResultFailure(run.providerId, query, run.result.records)];
  });
  const records = runsWithOfferRecords.flatMap((run) => run.result.records);
  const reasonCodeDistribution = summarizeReasonCodeDistribution(failures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(failures);
  const transcriptStrategyDetailDistribution = summarizeTranscriptStrategyDetailDistribution(records);
  const transcriptDurability = summarizeTranscriptDurability(records, failures);
  const cookieDiagnostics = summarizeCookieDiagnostics(failures, records);
  const challengeOrchestration = summarizeChallengeOrchestration(failures, records);
  const browserFallbackModesObserved = summarizeBrowserFallbackModes(failures, records);
  const antiBotPressure = summarizeAntiBotPressure(failures);
  const alerts = buildWorkflowAlerts(runtime, failures, effectiveProviderIds);
  if (regionDiagnostics.length > 0) {
    alerts.push({
      signal: "region_unenforced",
      reasonCode: "region_unenforced",
      state: "warning",
      reason: "Default shopping adapters currently use provider default storefronts and do not enforce requested region filters.",
      providers: regionDiagnostics.map((entry) => entry.provider),
      requested_region: input.region ?? regionDiagnostics[0]?.requestedRegion ?? ""
    });
  }
  const meta = withPrimaryConstraintMeta({
    selection: {
      providers: effectiveProviderIds,
      ...(autoExcludedProviders.length > 0 ? { excluded_providers: autoExcludedProviders } : {}),
      ...(input.browserMode ? { requested_browser_mode: input.browserMode } : {}),
      ...(input.region
        ? {
          requested_region: input.region,
          region_enforced: regionDiagnostics.every((entry) => entry.enforced),
          region_support: regionDiagnostics
        }
        : {})
    },
    metrics: {
      total_offers: offers.length,
      failed_providers: failures.map((entry) => entry.provider),
      reason_code_distribution: reasonCodeDistribution,
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
    mode: input.mode,
    query,
    offers,
    meta
  });

  const bundle = await createArtifactBundle({
    namespace: "shopping",
    outputDir: input.outputDir,
    ttlHours: input.ttlHours,
    files: rendered.files
  });

  if (input.mode === "path") {
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
  input: ProductVideoRunInput,
  options: ProductVideoWorkflowOptions = {}
): Promise<Record<string, unknown>> => {
  const startedAtMs = Date.now();
  const includeScreenshots = input.include_screenshots ?? true;
  const includeAllImages = input.include_all_images ?? true;
  const includeCopy = input.include_copy ?? true;
  const timeoutOptions = typeof input.timeoutMs === "number"
    ? { timeoutMs: input.timeoutMs }
    : {};
  const remainingTimeoutMs = (): number | undefined => {
    if (typeof input.timeoutMs !== "number" || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      return undefined;
    }
    return Math.max(1, input.timeoutMs - Math.max(0, Date.now() - startedAtMs));
  };

  const candidateUrl = input.product_url?.trim();
  const candidateName = input.product_name?.trim();

  if (!candidateUrl && !candidateName) {
    throw new Error("product_url or product_name is required");
  }

  let productUrl = candidateUrl;
  let providerHint = input.provider_hint?.trim();

  if (!productUrl && candidateName) {
    const shoppingResult = await runShoppingWorkflow(runtime, {
      query: candidateName,
      providers: providerHint ? [providerHint] : undefined,
      mode: "json",
      ...timeoutOptions,
      useCookies: input.useCookies,
      challengeAutomationMode: input.challengeAutomationMode,
      cookiePolicyOverride: input.cookiePolicyOverride
    });

    const offers = shoppingResult.offers as ShoppingOffer[];
    const resolutionSummary = (shoppingResult.meta as Record<string, unknown>).primaryConstraintSummary
      ?? (shoppingResult.meta as Record<string, unknown>).primary_constraint_summary;
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
    productUrl = offers[0]?.url;
    providerHint = offers[0]?.provider;
  }

  if (!productUrl) {
    throw new Error("Unable to resolve product URL");
  }
  if (!isValidHttpUrl(productUrl)) {
    throw new Error("product_url must be an http(s) URL");
  }

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
  const details = await runtime.fetch(
    { url: productUrl },
    withWorkflowResumeIntent(withChallengeAutomationOverride(withCookieOverrides({
      source,
      providerIds: shoppingProviderId ? [shoppingProviderId] : undefined,
      ...timeoutOptions
    }, input), input), "workflow.product_video", input as unknown as JsonValue)
  );
  observeWorkflowSignals(runtime, details);

  if (!details.ok || details.records.length === 0) {
    const reason = summarizePrimaryProviderIssue(details.failures)?.summary
      ?? details.error?.message
      ?? "Product details unavailable";
    throw new Error(reason);
  }

  const primary = details.records[0] as NormalizedRecord;
  const invalidTarget = classifyInvalidProductTarget(primary);
  if (invalidTarget) {
    throw new Error(invalidTarget.message);
  }
  const refreshedMetadata = needsProductMetadataRefresh(primary, productUrl)
    ? await refreshProductMetadata(productUrl, remainingTimeoutMs())
    : null;
  const primaryOffer = extractShoppingOffer(primary, new Date());

  const resolvedBrand = resolveProductBrand(primary, productUrl, refreshedMetadata?.brand);
  const resolvedTitle = resolveProductTitle(primary, productUrl, resolvedBrand, refreshedMetadata?.title);
  const resolvedPrice = refreshedMetadata?.price && refreshedMetadata.price.amount > 0
    ? {
      amount: refreshedMetadata.price.amount,
      currency: refreshedMetadata.price.currency,
      retrieved_at: primaryOffer.price.retrieved_at
    }
    : {
      amount: primaryOffer.price.amount,
      currency: primaryOffer.price.currency,
      retrieved_at: primaryOffer.price.retrieved_at
    };
  const featureList = deriveFeatureList(primary, refreshedMetadata?.features ?? []);
  const imageUrls = mergeImageUrls(primary, refreshedMetadata?.imageUrls ?? []);
  const selectedImageUrls = includeAllImages ? imageUrls : imageUrls.slice(0, 1);

  const files: ArtifactFile[] = [];
  const imagePaths: string[] = [];
  for (let index = 0; index < selectedImageUrls.length; index += 1) {
    const imageUrl = selectedImageUrls[index];
    /* c8 ignore next -- mergeImageUrls returns only non-empty strings */
    if (!imageUrl) continue;
    const imageContent = await fetchBinary(imageUrl, remainingTimeoutMs());
    if (!imageContent) continue;
    const extension = imageUrl.match(/\.(png|jpg|jpeg|webp|gif)(?:[?#].*)?$/i)?.[1]?.toLowerCase() ?? "jpg";
    const relativePath = `images/image-${String(index + 1).padStart(2, "0")}.${extension}`;
    files.push({ path: relativePath, content: imageContent });
    imagePaths.push(relativePath);
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
      const firstImage = files.find((entry) => entry.path === imagePaths[0]);
      /* c8 ignore next -- imagePaths entries are pushed from files immediately above */
      if (firstImage) {
        const fallbackPath = "screenshots/screenshot-01.png";
        files.push({ path: fallbackPath, content: firstImage.content });
        screenshotPaths.push(fallbackPath);
      }
    }
  }

  const copyText = includeCopy ? resolveProductCopy(primary, refreshedMetadata?.description) : "";
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

  const bundle = await createArtifactBundle({
    namespace: "product-assets",
    outputDir: input.output_dir,
    ttlHours: input.ttl_hours,
    files,
    manifestFileName: "bundle-manifest.json"
  });

  const reasonCodeDistribution = summarizeReasonCodeDistribution(details.failures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(details.failures);
  const transcriptStrategyDetailDistribution = summarizeTranscriptStrategyDetailDistribution(details.records);
  const transcriptDurability = summarizeTranscriptDurability(details.records, details.failures);
  const cookieDiagnostics = summarizeCookieDiagnostics(details.failures, details.records);
  const antiBotPressure = summarizeAntiBotPressure(details.failures);

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
      reason_code_distribution: reasonCodeDistribution,
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
