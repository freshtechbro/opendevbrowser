import { createHash } from "crypto";
import { createArtifactBundle, type ArtifactFile } from "./artifacts";
import { enrichResearchRecords, type ResearchRecord } from "./enrichment";
import { renderResearch, renderShopping, type RenderMode, type ShoppingOffer } from "./renderer";
import { filterByTimebox, resolveTimebox } from "./timebox";
import {
  SHOPPING_PROVIDER_IDS,
  SHOPPING_PROVIDER_PROFILES,
  validateShoppingLegalReviewChecklist
} from "./shopping";
import { createLogger, redactSensitive } from "../core/logging";
import { normalizeProviderReasonCode } from "./errors";
import { providerRequestHeaders } from "./shared/request-headers";
import { canonicalizeUrl } from "./web/crawler";
import { toSnippet } from "./web/extract";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderCallResultByOperation,
  ProviderCookiePolicy,
  ProviderError,
  ProviderFailureEntry,
  ProviderReasonCode,
  ProviderRunOptions,
  ProviderSelection,
  ProviderSource
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
  cookiePolicyOverride?: ProviderCookiePolicy;
}

export interface ShoppingRunInput {
  query: string;
  providers?: string[];
  budget?: number;
  region?: string;
  sort?: "best_deal" | "lowest_price" | "highest_rating" | "fastest_shipping";
  mode: RenderMode;
  timeoutMs?: number;
  outputDir?: string;
  ttlHours?: number;
  useCookies?: boolean;
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
  useCookies?: boolean;
  cookiePolicyOverride?: ProviderCookiePolicy;
}

export interface ProductVideoWorkflowOptions {
  captureScreenshot?: (url: string) => Promise<Buffer | null>;
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

const toProviderSource = (providerId: string): ProviderSource | null => {
  if (providerId.startsWith("web/")) return "web";
  if (providerId.startsWith("community/")) return "community";
  if (providerId.startsWith("social/")) return "social";
  if (providerId.startsWith("shopping/")) return "shopping";
  return null;
};

const resolveAutoExcludedProviders = (
  sourceSelection: ProviderSelection,
  resolvedSources: ProviderSource[]
): string[] => {
  if (sourceSelection !== "auto") return [];
  const sourceSet = new Set(resolvedSources);
  return [...getDegradedProviders()]
    .filter((provider) => {
      const source = toProviderSource(provider);
      return source !== null && sourceSet.has(source);
    })
    .sort((left, right) => left.localeCompare(right));
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

const withCookieOverrides = (
  options: ProviderRunOptions,
  input: { useCookies?: boolean; cookiePolicyOverride?: ProviderCookiePolicy }
): ProviderRunOptions => {
  return {
    ...options,
    ...(typeof input.useCookies === "boolean" ? { useCookies: input.useCookies } : {}),
    ...(input.cookiePolicyOverride ? { cookiePolicyOverride: input.cookiePolicyOverride } : {})
  };
};

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
  fetchBinary: (url: string): Promise<Buffer | null> => fetchBinary(url),
  rankResearchRecords: (records: ResearchRecord[]): ResearchRecord[] => rankResearchRecords(records)
};

const RESEARCH_AUTO_SOURCES: ProviderSource[] = ["web", "community", "social"];
const RESEARCH_ALL_SOURCES: ProviderSource[] = ["web", "community", "social", "shopping"];

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

    const existing = deduped.get(key);
    if (!existing) continue;
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

const asNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const parsePriceFromContent = (content: string | undefined): { amount: number; currency: string } => {
  if (!content) return { amount: 0, currency: "USD" };
  const match = content.match(/([$€£])\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/);
  if (!match) return { amount: 0, currency: "USD" };
  const currency = match[1] === "€" ? "EUR" : match[1] === "£" ? "GBP" : "USD";
  const amount = Number((match[2] ?? "0").replace(/,/g, ""));
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currency
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
  const priceScore = total > 0 ? 1 / (1 + total / 100) : 0.5;
  const availabilityScore = availabilityRank(offer.availability);
  const ratingScore = Math.max(0, Math.min(1, offer.rating / 5));
  const recencyHours = Math.max(0, (now.getTime() - new Date(offer.price.retrieved_at).getTime()) / (60 * 60 * 1000));
  const recencyScore = 1 / (1 + recencyHours / 24);
  const score = (priceScore * 0.55) + (availabilityScore * 0.2) + (ratingScore * 0.15) + (recencyScore * 0.1);
  return Number(score.toFixed(6));
};

const resolveShoppingProviders = (providers?: string[]): string[] => {
  if (!providers || providers.length === 0) {
    return [...SHOPPING_PROVIDER_IDS];
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
  sort: ShoppingRunInput["sort"]
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
      return ordered.sort((left, right) => right.deal_score - left.deal_score || (left.price.amount + left.shipping.amount) - (right.price.amount + right.shipping.amount));
  }
};

const extractImageUrls = (record: NormalizedRecord): string[] => {
  const links = Array.isArray(record.attributes.links)
    ? record.attributes.links.filter((entry): entry is string => typeof entry === "string")
    : [];

  const imageLinks = links.filter((link) => /\.(?:png|jpg|jpeg|webp|gif)(?:[?#].*)?$/i.test(link));
  return [...new Set(imageLinks.map((link) => canonicalizeUrl(link)))].slice(0, 50);
};

const fetchBinary = async (url: string): Promise<Buffer | null> => {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "image/*,*/*;q=0.8",
        ...providerRequestHeaders
      },
      redirect: "follow"
    });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes);
  } catch {
    return null;
  }
};

const deriveFeatureList = (content: string | undefined): string[] => {
  if (!content) return [];
  const candidates = content
    .split(/[\n.]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
    .filter((line) => /[a-z]/i.test(line));
  return [...new Set(candidates)].slice(0, 12);
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
  const excludedProviders = resolveAutoExcludedProviders(sourceSelection, resolved);
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
    }, withCookieOverrides({
      source
    }, input));
    trackProviderSignals(result);
    return {
      source,
      result
    };
  }));

  const mergedRecords = removeExcludedProviders(
    runs.flatMap((run) => run.result.records),
    excludedProviderSet
  );
  const mergedFailures = removeExcludedProviders(
    runs.flatMap((run) => run.result.failures),
    excludedProviderSet
  );
  const reasonCodeDistribution = summarizeReasonCodeDistribution(mergedFailures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(mergedFailures);
  const evaluationNow = new Date();
  const withinTimebox = filterByTimebox(mergedRecords, timebox, evaluationNow);
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

  const meta = {
    timebox: resolvedTimebox,
    selection: withExcludedProviders({
      source_selection: sourceSelection,
      resolved_sources: resolved
    }, excludedProviders),
    metrics: {
      total_records: mergedRecords.length,
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
    alerts: buildAlerts()
  } as Record<string, unknown>;

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
  const degradedProviders = getDegradedProviders();
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
    }, withCookieOverrides({
      source: "shopping",
      providerIds: [providerId],
      ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {})
    }, input));
    trackProviderSignals(result);
    return {
      providerId,
      result
    };
  }));

  const offers = rankOffers(
    dedupeOffers(
      runs
        .flatMap((run) => run.result.records)
        .map((record) => extractShoppingOffer(record, now))
    ),
    input.sort ?? "best_deal"
  );

  const failures = runs.flatMap((run) => run.result.failures);
  const records = runs.flatMap((run) => run.result.records);
  const reasonCodeDistribution = summarizeReasonCodeDistribution(failures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(failures);
  const transcriptStrategyDetailDistribution = summarizeTranscriptStrategyDetailDistribution(records);
  const transcriptDurability = summarizeTranscriptDurability(records, failures);
  const cookieDiagnostics = summarizeCookieDiagnostics(failures, records);
  const antiBotPressure = summarizeAntiBotPressure(failures);
  const meta = {
    selection: {
      providers: effectiveProviderIds,
      ...(autoExcludedProviders.length > 0 ? { excluded_providers: autoExcludedProviders } : {})
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
      anti_bot_pressure: antiBotPressure,
      antiBotPressure
    },
    failures,
    alerts: buildAlerts()
  } as Record<string, unknown>;

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
  const includeScreenshots = input.include_screenshots ?? true;
  const includeAllImages = input.include_all_images ?? true;
  const includeCopy = input.include_copy ?? true;

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
      useCookies: input.useCookies,
      cookiePolicyOverride: input.cookiePolicyOverride
    });

    const offers = Array.isArray(shoppingResult.offers)
      ? shoppingResult.offers as ShoppingOffer[]
      : [];
    if (offers.length === 0) {
      throw new Error("Unable to resolve product URL from product_name");
    }
    productUrl = offers[0]?.url;
    providerHint = offers[0]?.provider;
  }

  if (!productUrl) {
    throw new Error("Unable to resolve product URL");
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
    withCookieOverrides({
      source,
      providerIds: shoppingProviderId ? [shoppingProviderId] : undefined
    }, input)
  );
  trackProviderSignals(details);

  if (!details.ok || details.records.length === 0) {
    const reason = details.error?.message ?? "Product details unavailable";
    throw new Error(reason);
  }

  const primary = details.records[0] as NormalizedRecord;
  const primaryOffer = extractShoppingOffer(primary, new Date());

  const featureList = deriveFeatureList(primary.content);
  const imageUrls = extractImageUrls(primary);
  const selectedImageUrls = includeAllImages ? imageUrls : imageUrls.slice(0, 1);

  const files: ArtifactFile[] = [];
  const imagePaths: string[] = [];
  for (let index = 0; index < selectedImageUrls.length; index += 1) {
    const imageUrl = selectedImageUrls[index];
    if (!imageUrl) continue;
    const imageContent = await fetchBinary(imageUrl);
    if (!imageContent) continue;
    const extension = imageUrl.match(/\.(png|jpg|jpeg|webp|gif)(?:[?#].*)?$/i)?.[1]?.toLowerCase() ?? "jpg";
    const relativePath = `images/image-${String(index + 1).padStart(2, "0")}.${extension}`;
    files.push({ path: relativePath, content: imageContent });
    imagePaths.push(relativePath);
  }

  const screenshotPaths: string[] = [];
  if (includeScreenshots) {
    const screenshotBuffer = options.captureScreenshot ? await options.captureScreenshot(productUrl) : null;
    if (screenshotBuffer) {
      const screenshotPath = "screenshots/screenshot-01.png";
      files.push({ path: screenshotPath, content: screenshotBuffer });
      screenshotPaths.push(screenshotPath);
    } else if (imagePaths[0]) {
      const firstImage = files.find((entry) => entry.path === imagePaths[0]);
      if (firstImage) {
        const fallbackPath = "screenshots/screenshot-01.png";
        files.push({ path: fallbackPath, content: firstImage.content });
        screenshotPaths.push(fallbackPath);
      }
    }
  }

  const copyText = includeCopy ? toSnippet(primary.content ?? "", 8000) : "";
  const pricing = {
    amount: primaryOffer.price.amount,
    currency: primaryOffer.price.currency,
    retrieved_at: primaryOffer.price.retrieved_at
  };

  const productPayload = {
    title: primary.title ?? primaryOffer.title,
    brand: typeof primary.attributes.brand === "string" ? primary.attributes.brand : "unknown",
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
      alerts: buildAlerts(),
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
