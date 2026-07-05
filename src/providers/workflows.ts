import { createHash } from "crypto";
import { constants as fsConstants } from "fs";
import { lstat, mkdtemp, open, readFile, readdir, realpath, rm, type FileHandle } from "fs/promises";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { createArtifactBundle, type ArtifactFile } from "./artifacts";
import { resolveWorkflowArtifactRoot } from "./workflow-output-root";
import {
  readProviderIssueHintFromRecord,
  summarizePrimaryProviderIssue,
  type ProviderIssueHint,
  type ProviderNextStepGuidance
} from "./constraint";
import { enrichResearchRecords, type ResearchRecord } from "./enrichment";
import {
  renderInspiredesign,
  renderResearch,
  renderShopping,
  type RenderMode,
  type ShoppingOffer
} from "./renderer";
import {
  buildInspiredesignPacket,
  formatInspiredesignCaptureAttemptSummary,
  hasInspiredesignCaptureArtifacts,
  INSPIREDESIGN_CAPTURE_ATTEMPT_KEYS,
  type InspiredesignCaptureAttemptKey,
  type InspiredesignCaptureAttemptStatus,
  type InspiredesignCaptureEvidence,
  type InspiredesignFollowthrough,
  normalizeInspiredesignCaptureEvidence,
	type InspiredesignMotionEvidenceJson,
  type InspiredesignScreenshotIndexEntry,
  type InspiredesignReferenceEvidence
} from "../inspiredesign/contract";
import { INSPIREDESIGN_HANDOFF_FILES } from "../inspiredesign/handoff";
import {
  buildInspiredesignRankedArtifactPatternBoard,
  hasInspiredesignUsableReferenceEvidence,
	isInspiredesignReadyReference,
  summarizeInspiredesignReferenceQuality,
  type InspiredesignReferencePatternBoard
} from "../inspiredesign/reference-pattern-board";
import {
  createInspiredesignGuidanceContext,
  renderWorkflowCompatibility,
  routeNextStepGuidance,
  type InspiredesignGuidanceSource,
  type NextStepGuidance,
  type SiteRecipe
} from "../guidance";
import {
  isNonCanonicalPinterestLikeUrl,
  requiresProviderUrlSiteRecipeCompatibility,
  validateProviderScopedUrlCanonicality,
  validateProviderUrlSiteRecipeCompatibility
} from "../guidance/recipes/site-recipe-validation";
import { resolveSiteRecipeForProvider, resolveSiteRecipeForUrl } from "../guidance/recipes/site-registry";
import {
  mergeInspiredesignReferenceUrls,
  normalizeInspiredesignDiscoveryRecords,
  normalizeInspiredesignProviders,
  sanitizeRejectedInspiredesignDiscoveryUrl,
  type InspiredesignDiscoveryResult
} from "../inspiredesign/reference-discovery";
import {
  buildVisualEvidenceArtifactPath,
  hashVisualEvidenceBuffer,
  isInspiredesignVisualEvidenceKind,
  isInspiredesignVisualEvidenceMode,
  persistInspiredesignVisualEvidence,
  type InspiredesignPersistedVisualEvidence,
  type InspiredesignVisualEvidenceRuntimeMetadata,
  type InspiredesignVisualEvidenceMode
} from "../inspiredesign/visual-evidence";
import {
  decideInspiredesignVisualCapturePolicy,
  type InspiredesignVisualPolicyDecision
} from "../inspiredesign/visual-policy";
import {
  normalizeInspiredesignBriefText,
  expandInspiredesignBrief,
  INSPIREDESIGN_BRIEF_TEMPLATE_VERSION,
  type InspiredesignBriefExpansion,
  type InspiredesignBriefFormat
} from "../inspiredesign/brief-expansion";
import {
  CANVAS_NAVIGATION_MODELS,
  CANVAS_THEME_STRATEGIES,
  CANVAS_VISUAL_DIRECTION_PROFILES
} from "../canvas/types";
import {
  buildProductVideoSuccessHandoff,
  buildResearchSuccessHandoff,
  buildShoppingSuccessHandoff,
  type WorkflowSuccessHandoff
} from "./workflow-handoff";
import type { InspiredesignCaptureOptions } from "../inspiredesign/capture";
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
  postprocessShoppingWorkflow,
  type ShoppingOfferFilterDiagnostic
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
import {
  buildProductVideoPresentation,
  type ProductVideoCandidateSummary,
  type ProductVideoEvidenceReference,
  type ProductVideoPresentation,
  type ProductVideoPresentationMetadata,
  type ProductVideoPresentationSourceRecord,
  type ProductVideoPromotedClaim
} from "./product-video-presentation";
import { filterByTimebox } from "./timebox";
import {
  SHOPPING_PROVIDER_IDS,
  SHOPPING_PROVIDER_PROFILES
} from "./shopping";
import { createLogger, redactSensitive } from "../core/logging";
import { normalizeProviderReasonCode } from "./errors";
import {
  isChallengeAutomationMode,
  type ChallengeAutomationMode
} from "../challenges/types";
import { providerRequestHeaders } from "./shared/request-headers";
import {
  classifyResearchDestinationRejection,
  isLikelyResearchDestinationUrl
} from "./shared/traversal-url";
import { canonicalizeUrl } from "./web/crawler";
import { extractStructuredContent, toSnippet, type ExtractedMetadata } from "./web/extract";
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
import { resolveInspiredesignHarvestCaptureMode } from "../inspiredesign/capture-mode";
import {
  classifyPinterestCandidate,
  isCanonicalPinterestPinUrl,
  resolvePinterestPrimaryCaptureStrategy,
  type PinterestMediaClassification
} from "../inspiredesign/pinterest-media-classification";
import {
  buildMotionEvidenceArtifactPath,
  MIN_MOTION_PREVIEW_BYTES,
  MIN_MOTION_REPLAY_BYTES,
  MOTION_EVIDENCE_SHA256_HEX_PATTERN,
  persistInspiredesignMotionEvidence,
  type InspiredesignMotionEvidenceRuntimeMetadata,
  type InspiredesignPersistedMotionEvidence
} from "../inspiredesign/motion-evidence";
import {
  buildInspiredesignPinterestPinMediaIndexEntry,
  buildPinterestPinMediaEvidenceArtifactPath,
  extensionForPinterestPinMediaContentType,
  inspectPinterestPinMediaBuffer,
  persistInspiredesignPinterestPinMediaEvidence,
  sanitizeInspiredesignPinterestPinMediaReferenceId,
  verifyPinterestPinMediaPersistedBytes,
  type InspiredesignPinterestPinMediaIndexEntry,
  type InspiredesignPersistedPinterestPinMediaEvidence,
  type InspiredesignPinterestPinMediaRuntimeMetadata
} from "../inspiredesign/pinterest-pin-media-evidence";
import {
  INSPIREDESIGN_MEDIA_ANALYSIS_BINARY_PROBE_TIMEOUT_MS,
  INSPIREDESIGN_MEDIA_ANALYSIS_DETERMINISTIC_GENERATED_AT,
  INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS,
  INSPIREDESIGN_MEDIA_ANALYSIS_VERSION,
  analyzeInspiredesignMediaArtifacts,
  resolveInspiredesignMediaAnalysisBinaries,
  type InspiredesignMediaAnalysis,
  type InspiredesignMediaAnalysisBinaryPathsConfig,
  type InspiredesignMediaAnalysisBinaryResolution,
  type InspiredesignMediaAnalysisInput,
  type InspiredesignMediaAnalyzerOptions,
  type InspiredesignMediaKind
} from "../inspiredesign/media-analysis";
import {
  buildInspiredesignProductReadinessFields,
  countInspiredesignArtifactBackedEvidenceAuthorities,
  countInspiredesignAuthoritativePinterestReferences,
  hasActiveInspiredesignCanvasDoNotProceedBlocker,
  isInspiredesignAuthoritativeRankedReference,
  isInspiredesignPinterestPinReferenceUrl
} from "../inspiredesign/product-readiness";
import { runBrowserNativeDiscovery, type BrowserNativeDiscoveryResult } from "./browser-native-discovery";
import { resolveProviderRuntimePolicy } from "./runtime-policy";
import type {
  BrowserFallbackMode,
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderCallResultByOperation,
  ProviderCookiePolicy,
	ProviderCookieSourceConfig,
  ProviderError,
  ProviderFailureEntry,
  ProviderReasonCode,
  ProviderRunOptions,
  ProviderRuntimePolicyInput,
  ProviderSelection,
  ProviderSource,
  ProviderTrustedProfileProvenance,
  WorkflowSuspendedIntentKind,
  WorkflowBrowserMode,
  InspiredesignCaptureMode
} from "./types";

export interface ReferenceRetrievalPort {
  fetch: (
    input: ProviderCallResultByOperation["fetch"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  search?: (
    input: ProviderCallResultByOperation["search"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  getAntiBotSnapshots?: (providerIds?: string[]) => ProviderAntiBotSnapshot[];
}

export interface ProviderExecutor extends ReferenceRetrievalPort {
  search: (
    input: ProviderCallResultByOperation["search"],
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
  mode?: RenderMode;
  includeEngagement?: boolean;
  limitPerSource?: number;
  timeoutMs?: number;
  outputDir?: string;
  ttlHours?: number;
  browserMode?: WorkflowBrowserMode;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
  profile?: string;
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
  profile?: string;
}

export interface InspiredesignRunInput {
  brief: string;
  briefExpansion?: InspiredesignBriefExpansion;
  harvest?: boolean;
  query?: string;
  providers?: string[];
  maxReferences?: number;
  visualEvidence?: InspiredesignVisualEvidenceMode;
  urls?: string[];
  captureMode?: InspiredesignCaptureMode;
  includePrototypeGuidance?: boolean;
  mode?: RenderMode;
  timeoutMs?: number;
  outputDir?: string;
  ttlHours?: number;
  browserMode?: WorkflowBrowserMode;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
  profile?: string;
  cookieSource?: ProviderCookieSourceConfig;
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
  browserMode?: WorkflowBrowserMode;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
  profile?: string;
}

export interface ProductVideoWorkflowOptions {
  captureScreenshot?: (url: string, timeoutMs?: number) => Promise<Buffer | null>;
}

export type InspiredesignWorkflowVisualCaptureOptions = {
  visualEvidencePath: string;
  timeoutMs?: number;
  browserMode?: WorkflowBrowserMode;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
  profile?: string;
  cookieSource?: ProviderCookieSourceConfig;
};

export type InspiredesignWorkflowMotionCaptureOptions = {
  outputDir: string;
  timeoutMs?: number;
  browserMode?: WorkflowBrowserMode;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
  profile?: string;
  cookieSource?: ProviderCookieSourceConfig;
};

export type InspiredesignWorkflowPinMediaCaptureOptions = {
  referenceId: string;
  pinMediaEvidencePath: string;
  timeoutMs?: number;
  browserMode?: WorkflowBrowserMode;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
  profile?: string;
  cookieSource?: ProviderCookieSourceConfig;
  pinterestPageQuality?: PinterestMediaClassification["sourcePageQuality"];
};

export interface InspiredesignWorkflowOptions {
  captureReference?: (
    url: string,
    options?: InspiredesignCaptureOptions
  ) => Promise<InspiredesignCaptureEvidence | null>;
  captureVisualEvidence?: (
    url: string,
    options: InspiredesignWorkflowVisualCaptureOptions
  ) => Promise<InspiredesignVisualEvidenceRuntimeMetadata | undefined>;
  captureMotionEvidence?: (
    url: string,
    options: InspiredesignWorkflowMotionCaptureOptions
  ) => Promise<InspiredesignMotionEvidenceRuntimeMetadata | undefined>;
  capturePinMediaEvidence?: (
    url: string,
    options: InspiredesignWorkflowPinMediaCaptureOptions
  ) => Promise<InspiredesignPinterestPinMediaRuntimeMetadata | undefined>;
  analyzeMediaArtifacts?: (
    inputs: readonly InspiredesignMediaAnalysisInput[],
    options?: InspiredesignMediaAnalyzerOptions
  ) => Promise<InspiredesignMediaAnalysis>;
  mediaAnalysisConfig?: InspiredesignMediaAnalysisBinaryPathsConfig;
  resolveMediaAnalysisBinaries?: (options?: { timeoutMs?: number }) => Promise<InspiredesignMediaAnalysisBinaryResolution>;
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

const withFollowthroughMeta = (
  meta: Record<string, unknown>,
  handoff: WorkflowSuccessHandoff
): Record<string, unknown> => ({
  ...meta,
  followthroughSummary: handoff.followthroughSummary
});

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
  runtime: ReferenceRetrievalPort,
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
  runtime: ReferenceRetrievalPort,
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
  runtime: ReferenceRetrievalPort,
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
  runtime: ReferenceRetrievalPort,
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
      primaryConstraint: primaryIssue,
      primaryConstraintSummary: primaryIssue.summary
    }
    : meta;
};

const withCamelCasePrimaryConstraintMeta = withPrimaryConstraintMeta;

const readPrimaryConstraintGuidance = (
  constraint: Record<string, unknown>
): ProviderNextStepGuidance | undefined => {
  const guidance = constraint.guidance;
  if (!guidance || typeof guidance !== "object" || Array.isArray(guidance)) return undefined;
  const record = guidance as Record<string, unknown>;
  if (typeof record.reason !== "string") return undefined;
  if (!Array.isArray(record.recommendedNextCommands)) return undefined;
  if (!record.recommendedNextCommands.every((command) => typeof command === "string")) return undefined;
  return {
    reason: record.reason,
    recommendedNextCommands: record.recommendedNextCommands
  };
};

const withPrimaryConstraintSummaryOverride = (
  meta: Record<string, unknown>,
  summary: string,
  guidance?: ProviderNextStepGuidance
): Record<string, unknown> => {
  const currentPrimaryConstraint = meta.primaryConstraint;
  const baseConstraint = (
    currentPrimaryConstraint
    && typeof currentPrimaryConstraint === "object"
    && !Array.isArray(currentPrimaryConstraint)
  )
    ? currentPrimaryConstraint as Record<string, unknown>
    : { reasonCode: "env_limited" };
  const existingGuidance = readPrimaryConstraintGuidance(baseConstraint);
  const { guidance: _existingGuidance, ...nextPrimaryConstraintBase } = baseConstraint;
  const nextGuidance = guidance ?? existingGuidance;
  const nextPrimaryConstraint = (
    nextGuidance
      ? {
        ...nextPrimaryConstraintBase,
        summary,
        guidance: nextGuidance
      }
      : {
        ...nextPrimaryConstraintBase,
        summary
      }
  );

  return {
    ...meta,
    primaryConstraint: nextPrimaryConstraint,
    primaryConstraintSummary: summary
  };
};

const withReasonCodeDistributionMeta = (
  meta: Record<string, unknown>,
  reasonCodeDistribution: Record<string, number>
): Record<string, unknown> => {
  const metrics = meta.metrics;
  const nextMetrics = metrics && typeof metrics === "object" && !Array.isArray(metrics)
    ? {
      ...metrics,
      reasonCodeDistribution
    }
    : { reasonCodeDistribution };
  return {
    ...meta,
    metrics: nextMetrics,
    reasonCodeDistribution
  };
};

const incrementReasonCodeDistribution = (
  reasonCodeDistribution: Record<string, number>,
  reasonCode: ProviderReasonCode,
  count: number
): Record<string, number> => {
  if (count <= 0) return reasonCodeDistribution;
  return Object.fromEntries(Object.entries({
    ...reasonCodeDistribution,
    [reasonCode]: (reasonCodeDistribution[reasonCode] ?? 0) + count
  }).sort(([left], [right]) => left.localeCompare(right)));
};

const summarizeShoppingOfferFilterConstraint = (args: {
  diagnostics: ShoppingOfferFilterDiagnostic[];
  budget?: number;
  region?: string;
  regionEnforced: boolean;
  failures: ProviderFailureEntry[];
}): string | null => {
  const primaryIssue = summarizePrimaryProviderIssue(args.failures);
  if (
    primaryIssue
    && (primaryIssue.reasonCode !== "env_limited" || primaryIssue.constraint || primaryIssue.blockerType === "anti_bot_challenge")
  ) {
    return null;
  }

  const candidateOffers = args.diagnostics.reduce((sum, entry) => sum + entry.candidateOffers, 0);
  const pricedOffers = args.diagnostics.reduce((sum, entry) => sum + entry.pricedOffers, 0);
  const regionMatchedOffers = args.diagnostics.reduce((sum, entry) => sum + entry.regionMatchedOffers, 0);
  const finalOffers = args.diagnostics.reduce((sum, entry) => sum + entry.finalOffers, 0);
  const zeroPriceExcluded = args.diagnostics.reduce((sum, entry) => sum + entry.zeroPriceExcluded, 0);
  const regionCurrencyExcluded = args.diagnostics.reduce((sum, entry) => sum + entry.regionCurrencyExcluded, 0);
  const budgetExcluded = args.diagnostics.reduce((sum, entry) => sum + entry.budgetExcluded, 0);
  const requestedRegion = args.diagnostics.find((entry) => typeof entry.requestedRegion === "string")?.requestedRegion ?? args.region;
  const expectedCurrency = args.diagnostics.find((entry) => typeof entry.expectedCurrency === "string")?.expectedCurrency;

  if (candidateOffers === 0 || finalOffers > 0) {
    return null;
  }

  if (pricedOffers > 0 && regionMatchedOffers === 0 && regionCurrencyExcluded > 0 && requestedRegion && !args.regionEnforced) {
    return `Requested region ${requestedRegion} was not enforced by the selected providers, and all candidate offers were filtered by the ${expectedCurrency ?? "requested"} currency heuristic.`;
  }

  if (typeof args.budget === "number" && regionMatchedOffers > 0 && budgetExcluded > 0 && finalOffers === 0) {
    const budgetLabel = expectedCurrency ? `${expectedCurrency} ${args.budget.toFixed(2)}` : args.budget.toFixed(2);
    return `All candidate offers exceeded the requested budget of ${budgetLabel}.`;
  }

  if (candidateOffers > 0 && zeroPriceExcluded === candidateOffers) {
    return "Selected providers returned only zero-price or missing-price offers, so this run could not determine a trustworthy deal price.";
  }

  return null;
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

const withProfileOverride = (
  options: ProviderRunOptions,
  input: { profile?: string; browserMode?: WorkflowBrowserMode }
): ProviderRunOptions => {
  const profile = input.profile?.trim();
  return mergeRuntimePolicyInput(options, {
    ...(profile ? { profile, profileMode: "managed" } : {}),
    ...(profile && !input.browserMode ? { browserMode: "managed" } : {})
  });
};

const resolveManagedWorkflowTrustedProfile = (
  input: { profile?: string; browserMode?: WorkflowBrowserMode }
): ProviderTrustedProfileProvenance | undefined => {
  const profile = input.profile?.trim();
  if (!profile) {
    return undefined;
  }
  if (input.browserMode && input.browserMode !== "managed") {
    return undefined;
  }
  return { profile, profileMode: "managed" };
};

const WORKFLOW_KIND_BY_SUSPENDED_INTENT_KIND: Record<WorkflowSuspendedIntentKind, WorkflowKind> = {
  "workflow.research": "research",
  "workflow.shopping": "shopping",
  "workflow.inspiredesign": "inspiredesign",
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
  trackProviderSignals: (result: ProviderAggregateResult): void => trackProviderSignals(result),
  buildAlerts: (): Array<Record<string, JsonValue>> => buildAlerts(),
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
  resolveShoppingSourceForUrl: (url: string): ProviderSource => resolveShoppingSourceForUrl(url),
  resolveProductCopy: (
    record: NormalizedRecord,
    productUrl: string,
    refreshedDescription: string | undefined,
    featureList: string[]
  ): string => resolveProductCopy(record, productUrl, refreshedDescription, featureList),
  resolveProductTitle: (
    record: NormalizedRecord,
    productUrl: string,
    brand: string,
    refreshedTitle: string | undefined
  ): string => resolveProductTitle(record, productUrl, brand, refreshedTitle),
  inferTitleFromContent: (content: string | undefined, productUrl?: string): string | undefined =>
    inferTitleFromContent(content, productUrl),
  getRequiredProductVideoExecutionStep: <
    TStepId extends ProductVideoWorkflowExecutionStep["id"]
  >(
    steps: ProductVideoWorkflowExecutionStep[],
    stepId: TStepId
  ): Extract<ProductVideoWorkflowExecutionStep, { id: TStepId }> =>
    getRequiredProductVideoExecutionStep(steps, stepId),
  normalizeProductVideoProviderHint: (
    productUrl: string,
    providerHint?: string,
    fallbackProvider?: string
  ): string | undefined => normalizeProductVideoProviderHint(productUrl, providerHint, fallbackProvider),
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
  ): { workflow: ReturnType<typeof buildWorkflowResumeEnvelope> } => buildWorkflowResumePayload(kind, input),
  withPrimaryConstraintSummaryOverride: (
    meta: Record<string, unknown>,
    summary: string,
    guidance?: ProviderNextStepGuidance
  ): Record<string, unknown> => withPrimaryConstraintSummaryOverride(meta, summary, guidance),
  withReasonCodeDistributionMeta: (
    meta: Record<string, unknown>,
    reasonCodeDistribution: Record<string, number>
  ): Record<string, unknown> => withReasonCodeDistributionMeta(meta, reasonCodeDistribution),
  incrementReasonCodeDistribution: (
    reasonCodeDistribution: Record<string, number>,
    reasonCode: ProviderReasonCode,
    count: number
  ): Record<string, number> => incrementReasonCodeDistribution(reasonCodeDistribution, reasonCode, count),
  summarizeShoppingOfferFilterConstraint: (args: {
    diagnostics: ShoppingOfferFilterDiagnostic[];
    budget?: number;
    region?: string;
    regionEnforced: boolean;
    failures: ProviderFailureEntry[];
  }): string | null => summarizeShoppingOfferFilterConstraint(args),
  selectProductVideoPresentationRecord: (
    records: readonly NormalizedRecord[],
    productUrl: string,
    includeCopy: boolean
  ): ProductVideoRecordSelection => selectProductVideoPresentationRecord(records, productUrl, includeCopy),
  updateProductVideoSelectedCandidateSummary: (
    summaries: readonly ProductVideoCandidateSummary[],
    selectedRecord: NormalizedRecord,
    presentation: ProductVideoPresentation
  ): ProductVideoCandidateSummary[] =>
    updateProductVideoSelectedCandidateSummary(summaries, selectedRecord, presentation),
  sanitizeResearchRecords: (records: NormalizedRecord[]): {
    records: NormalizedRecord[];
    sanitizedCount: number;
    reasonDistribution: Record<string, number>;
    rejectedCandidates: ResearchRejectedCandidate[];
  } => sanitizeResearchRecords(records),
  rejectedCandidatesFromFailures: (failures: ProviderFailureEntry[]): ResearchRejectedCandidate[] =>
    rejectedCandidatesFromFailures(failures),
  parseInspiredesignEnvelopeInput: (input: WorkflowResumeEnvelope["input"]): InspiredesignRunInput =>
    parseInspiredesignEnvelopeInput(input),
  buildInspiredesignFetchOptions: (
    workflowInput: InspiredesignResolvedInput,
    envelope: WorkflowResumeEnvelope,
    timeoutMs?: number
  ): ProviderRunOptions => buildInspiredesignFetchOptions(workflowInput, envelope, timeoutMs),
  buildInspiredesignReferenceFetchOptions: (
    workflowInput: InspiredesignResolvedInput,
    envelope: WorkflowResumeEnvelope,
    url: string,
    timeoutMs?: number
  ): ProviderRunOptions => buildInspiredesignReferenceFetchOptions(workflowInput, envelope, url, timeoutMs),
  emptyInspiredesignDiscoveryDiagnostics: (
    workflowInput: InspiredesignResolvedInput,
    searchAvailable: boolean,
    failure?: string
  ): InspiredesignDiscoveryDiagnostics => emptyInspiredesignDiscoveryDiagnostics(workflowInput, searchAvailable, failure),
  normalizeSiteRecipeFetchFailures: (
    siteRecipe: SiteRecipe,
    failures: ProviderFailureEntry[]
  ): ProviderFailureEntry[] => normalizeSiteRecipeFetchFailures(siteRecipe, failures),
  capMixedInspiredesignDiscovery: (
    siteDiscovery: InspiredesignDiscoveryResult,
    standardDiscovery: InspiredesignDiscoveryResult,
    maxReferences: number
  ): InspiredesignDiscoveryResult => capMixedInspiredesignDiscovery(siteDiscovery, standardDiscovery, maxReferences),
  filterStandardDiscoveryForSiteRecipe: (
    siteRecipe: SiteRecipe,
    discovery: InspiredesignDiscoveryResult
  ): InspiredesignDiscoveryResult => filterStandardDiscoveryForSiteRecipe(siteRecipe, discovery),
  captureWorkflowVisualEvidence: (
    url: string,
    workflowInput: InspiredesignResolvedInput,
    captureVisualEvidence: InspiredesignWorkflowOptions["captureVisualEvidence"],
    visualPlan: InspiredesignVisualCapturePlan,
    timeoutMs?: number
  ): Promise<InspiredesignVisualEvidenceRuntimeMetadata | undefined> =>
    captureWorkflowVisualEvidence(url, workflowInput, captureVisualEvidence, visualPlan, timeoutMs),
  captureWorkflowMotionEvidence: (
    url: string,
    workflowInput: InspiredesignResolvedInput,
    captureMotionEvidence: InspiredesignWorkflowOptions["captureMotionEvidence"],
    referenceId: string,
    motionEvidenceTempDir: string | undefined,
    timeoutMs?: number
  ): Promise<InspiredesignMotionEvidenceRuntimeMetadata | undefined> =>
    captureWorkflowMotionEvidence(url, workflowInput, captureMotionEvidence, referenceId, motionEvidenceTempDir, timeoutMs),
  captureWorkflowPinMediaEvidence: (
    url: string,
    workflowInput: InspiredesignResolvedInput,
    capturePinMediaEvidence: InspiredesignWorkflowOptions["capturePinMediaEvidence"],
    referenceId: string,
    pinMediaEvidenceTempDir: string | undefined,
    classification: PinterestMediaClassification,
    timeoutMs?: number
  ): Promise<InspiredesignPinterestPinMediaRuntimeMetadata | undefined> =>
    captureWorkflowPinMediaEvidence(
      url,
      workflowInput,
      capturePinMediaEvidence,
      referenceId,
      pinMediaEvidenceTempDir,
      classification,
      timeoutMs
    ),
  failureFromInspiredesignDiscoveryError: (
    workflowInput: InspiredesignResolvedInput,
    error: ProviderError | undefined
  ): ProviderFailureEntry[] => failureFromInspiredesignDiscoveryError(workflowInput, error),
  failureFromInspiredesignFetchError: (
    result: ProviderAggregateResult
  ): ProviderFailureEntry[] => failureFromInspiredesignFetchError(result),
  mergeCaptureVisualEvidence: (
    capture: InspiredesignCaptureEvidence | null | undefined,
    visual: InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence | undefined
  ): InspiredesignCaptureEvidence | null | undefined => mergeCaptureVisualEvidence(capture, visual),
  mergeCaptureMotionEvidence: (
    capture: InspiredesignCaptureEvidence | null | undefined,
    motion: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence | undefined
  ): InspiredesignCaptureEvidence | null | undefined => mergeCaptureMotionEvidence(capture, motion),
  mergeCapturePinMediaEvidence: (
    capture: InspiredesignCaptureEvidence | null | undefined,
    pinMedia: InspiredesignPinterestPinMediaRuntimeMetadata | InspiredesignPersistedPinterestPinMediaEvidence | undefined
  ): InspiredesignCaptureEvidence | null | undefined => mergeCapturePinMediaEvidence(capture, pinMedia),
  mergeCaptureEvidence: (
    base: InspiredesignCaptureEvidence | null | undefined,
    addon: InspiredesignCaptureEvidence | null | undefined
  ): InspiredesignCaptureEvidence | null | undefined => mergeCaptureEvidence(base, addon),
  getRequiredVisualEvidenceFailure: (
    workflowInput: InspiredesignResolvedInput,
    visualPlan: InspiredesignVisualCapturePlan,
    capture: InspiredesignCaptureEvidence | null | undefined,
    missingFailure?: string
  ): string | undefined => getRequiredVisualEvidenceFailure(workflowInput, visualPlan, capture, missingFailure),
  addRequiredVisualEvidenceFailure: (
    capture: InspiredesignCaptureEvidence | null | undefined,
    visualPlan: InspiredesignVisualCapturePlan | undefined,
    failure: string,
    forceRequiredWarning?: boolean
  ): InspiredesignCaptureEvidence | null | undefined =>
    addRequiredVisualEvidenceFailure(capture, visualPlan, failure, forceRequiredWarning),
  hasWorkflowProvisionalPinMediaEvidence: (capture: InspiredesignCaptureEvidence | null | undefined): boolean =>
    hasWorkflowProvisionalPinMediaEvidence(capture),
  hasWorkflowProvisionalNonVisualEvidence: (capture: InspiredesignCaptureEvidence | null | undefined): boolean =>
    hasWorkflowProvisionalNonVisualEvidence(capture),
  hasWorkflowProvisionalPrimaryEvidence: (capture: InspiredesignCaptureEvidence | null | undefined): boolean =>
    hasWorkflowProvisionalPrimaryEvidence(capture),
  buildInspiredesignMediaAnalyzerBinaryOptions: (
    binaries: InspiredesignMediaAnalysisBinaryResolution | undefined
  ): Pick<
    InspiredesignMediaAnalyzerOptions,
    "ffmpegBinaryPath" | "ffprobeBinaryPath" | "ffmpegUnavailableLimitation" | "ffprobeUnavailableLimitation"
  > => buildInspiredesignMediaAnalyzerBinaryOptions(binaries),
  shouldResolveInspiredesignMediaAnalysisBinaries: (options: InspiredesignWorkflowOptions): boolean =>
    shouldResolveInspiredesignMediaAnalysisBinaries(options),
  isPinterestWorkflowReferenceUrl: (value: string): boolean => isPinterestWorkflowReferenceUrl(value),
  buildPinMediaTempCapturePath: (pinMediaTempRoot: string, referenceId: string): string =>
    buildPinMediaTempCapturePath(pinMediaTempRoot, referenceId),
  trustedPinMediaTempPath: (
    pinMediaTempRoot: string | undefined,
    referenceId: string,
    tempPath: string | undefined
  ): Promise<string | undefined> => trustedPinMediaTempPath(pinMediaTempRoot, referenceId, tempPath),
	createPinMediaAnalysisTempDir: (pinMediaTempRoot: string, referenceId: string): Promise<string> =>
	createPinMediaAnalysisTempDir(pinMediaTempRoot, referenceId),
	readTrustedPinMediaRuntimeFile: (pinMediaTempRoot: string, absolutePath: string): Promise<Buffer> =>
	readTrustedPinMediaRuntimeFile(pinMediaTempRoot, absolutePath),
  sanitizeProductBrandCandidate: (candidate: string | undefined, productUrl: string): string | undefined =>
    sanitizeProductBrandCandidate(candidate, productUrl),
  extractProductBrandFromTitle: (title: string | undefined, productUrl: string): string | undefined =>
    extractProductBrandFromTitle(title, productUrl)
};

const PRODUCT_ASSET_FETCH_TIMEOUT_MS = 15_000;
const RESEARCH_PROVIDER_STEP_TIMEOUT_MS = 30_000;

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
  "community:search:url",
  "social:search:index",
  "social:search:url",
  "social:youtube:search:url",
  "web:search:url",
]);
const RESEARCH_CONDITIONAL_SANITIZED_PATHS = new Set<string>([
  "community:fetch:url",
  "social:fetch:url",
  "web:search:index"
]);
const RESEARCH_LOGIN_SHELL_RE = /\b(?:log in|login|sign in|sign-in|please log in|continue with google|continue with apple)\b/i;
const RESEARCH_LOGIN_SHELL_MAX_CONTENT_CHARS = 600;
const RESEARCH_LOGIN_REQUIRED_RE = /\b(?:log in to continue|sign in to continue|authentication required|please log in|continue with google|continue with apple)\b/i;
const RESEARCH_JS_REQUIRED_RE = /\b(?:enable javascript|javascript required|javascript is not available|javascript is disabled|you need to enable javascript)\b/i;
const RESEARCH_GENERIC_SHELL_RE = /\b(?:skip to main content|the heart of the internet|open navigation|get the app|view in app|please wait for verification|verify you are human|security check)\b/i;
const RESEARCH_NOT_FOUND_SHELL_RE = /\b(?:error 404|page not found|not found|can['’]t seem to find the page)\b/i;
const RESEARCH_PRIVACY_PREFERENCE_SHELL_RE = /\b(?:select your cookie preferences|customize cookie preferences|unable to save cookie preferences|your privacy choices|manage consent preferences|privacy opt[- ]out|do not sell or share my personal information)\b/i;
const RESEARCH_PRIVACY_RECOVERED_CONTENT_RE = /\b(?:blogs? home|permalink|comments|article)\b/i;
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
const BESTBUY_PDP_ERROR_SHELL_RE = /\b(?:something went wrong|use our search bar|pick a category below|typed in a url|check it for errors)\b/i;
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

const normalizeProductVideoProviderHint = (
  productUrl: string,
  providerHint?: string,
  fallbackProvider?: string
): string | undefined => {
  if (fallbackProvider?.includes("/")) return fallbackProvider;
  if (providerHint?.includes("/")) return providerHint;
  const shoppingProviderId = resolveShoppingProviderIdForUrl(productUrl);
  if (shoppingProviderId) {
    return providerHint ? `shopping/${providerHint}` : fallbackProvider ?? shoppingProviderId;
  }
  return fallbackProvider ?? providerHint;
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
const EBAY_TITLE_BRAND_PREFIX_RE = /^(?:new|used|pre-owned|preowned|open box|refurbished|renewed|genuine|authentic)\s+/i;
const EBAY_KNOWN_MULTI_TOKEN_BRANDS = [
  "3M",
  "Bang & Olufsen",
  "Bowers & Wilkins",
  "Hewlett-Packard",
  "iRobot",
  "New Balance"
] as const;
const EBAY_KNOWN_SINGLE_TOKEN_BRANDS = new Map([
  ["apple", "Apple"],
  ["bose", "Bose"],
  ["canon", "Canon"],
  ["dell", "Dell"],
  ["dyson", "Dyson"],
  ["google", "Google"],
  ["jbl", "JBL"],
  ["lenovo", "Lenovo"],
  ["lg", "LG"],
  ["microsoft", "Microsoft"],
  ["nikon", "Nikon"],
  ["nintendo", "Nintendo"],
  ["panasonic", "Panasonic"],
  ["philips", "Philips"],
  ["samsung", "Samsung"],
  ["sony", "Sony"]
]);
const EBAY_TITLE_BRAND_STOP_WORDS = new Set([
  "bluetooth",
  "case",
  "ergonomic",
  "gaming",
  "headphones",
  "keyboard",
  "leather",
  "noise",
  "portable",
  "rechargeable",
  "speaker",
  "vertical",
  "wireless"
]);
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

const createRemainingTimeoutResolver = (timeoutMs?: number): (() => number | undefined) => {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return () => undefined;
  }
  const startedAtMs = Date.now();
  let firstRead = true;
  return () => {
    if (firstRead) {
      firstRead = false;
      return timeoutMs;
    }
    return Math.max(1, timeoutMs - Math.max(0, Date.now() - startedAtMs));
  };
};

const resolveInspiredesignReferenceBudgetMs = (
  workflowRemainingTimeoutMs: number | undefined,
  remainingReferenceCount: number
): number | undefined => {
  if (typeof workflowRemainingTimeoutMs !== "number" || !Number.isFinite(workflowRemainingTimeoutMs) || workflowRemainingTimeoutMs <= 0) {
    return undefined;
  }
  return Math.max(1, Math.ceil(workflowRemainingTimeoutMs / Math.max(1, remainingReferenceCount)));
};

const isInspiredesignWorkflowDeadlineExhausted = (
  workflowRemainingTimeoutMs: number | undefined
): boolean => typeof workflowRemainingTimeoutMs === "number" && workflowRemainingTimeoutMs <= 1;

const resolveResearchProviderStepTimeoutMs = (timeoutMs?: number): number | undefined => {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }
  return Math.max(1, Math.min(timeoutMs, RESEARCH_PROVIDER_STEP_TIMEOUT_MS));
};

type InspiredesignResolvedInput = Omit<InspiredesignRunInput, "brief" | "urls" | "captureMode" | "query" | "providers" | "maxReferences" | "visualEvidence"> & {
  brief: string;
  briefExpansion: InspiredesignBriefExpansion;
  query?: string;
  providers: string[];
  maxReferences: number;
  referenceLimit?: number;
  visualEvidence: InspiredesignVisualEvidenceMode;
  urls: string[];
  captureMode: InspiredesignCaptureMode;
  mode: RenderMode;
};

const INSPIREDESIGN_RENDER_MODES = new Set<RenderMode>(["compact", "json", "md", "context", "path"]);
const INSPIREDESIGN_CAPTURE_MODES = new Set<InspiredesignCaptureMode>(["off", "deep"]);
const INSPIREDESIGN_COOKIE_POLICIES = new Set<ProviderCookiePolicy>(["off", "auto", "required"]);
const WORKFLOW_BROWSER_MODES = new Set<WorkflowBrowserMode>(["auto", "extension", "managed"]);
const INSPIREDESIGN_DEFAULT_MAX_REFERENCES = 5;
const INSPIREDESIGN_MAX_REFERENCES_LIMIT = 10;

const isJsonRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

type InspiredesignCaptureOutcome = {
  captureStatus: InspiredesignReferenceEvidence["captureStatus"];
  capture?: InspiredesignCaptureEvidence | null;
  captureFailure?: string;
};

type InspiredesignVisualCapturePlan = {
  policy: InspiredesignVisualPolicyDecision;
  referenceId: string;
  tempPath?: string;
};

type InspiredesignVisualArtifactCollation = {
  references: InspiredesignReferenceEvidence[];
  files: ArtifactFile[];
};

type InspiredesignMotionArtifactCollation = {
  references: InspiredesignReferenceEvidence[];
  files: ArtifactFile[];
};

type InspiredesignPinMediaArtifactCollation = {
  references: InspiredesignReferenceEvidence[];
  files: ArtifactFile[];
};

const INSPIREDESIGN_CAPTURE_UNAVAILABLE_FAILURE =
  "Deep capture requested, but browser capture is unavailable in this execution lane.";
const REQUIRED_VISUAL_EVIDENCE_MISSING_FAILURE = "Required visual evidence was not captured.";
const INSPIREDESIGN_VISUAL_POLICY_BLOCKER_REASONS = new Set<InspiredesignVisualPolicyDecision["reason"]>([
  "policy_blocked",
  "auth_required",
  "challenge_detected",
  "rate_limited"
]);
type InspiredesignCaptureAttemptCounts = Record<
  InspiredesignCaptureAttemptKey,
  Record<InspiredesignCaptureAttemptStatus, number>
>;

const isCanvasVisualDirectionProfile = (
  value: string
): value is InspiredesignBriefFormat["route"]["profile"] => {
  return (CANVAS_VISUAL_DIRECTION_PROFILES as readonly string[]).includes(value);
};

const isCanvasThemeStrategy = (
  value: string
): value is InspiredesignBriefFormat["route"]["themeStrategy"] => {
  return (CANVAS_THEME_STRATEGIES as readonly string[]).includes(value);
};

const isCanvasNavigationModel = (
  value: string
): value is InspiredesignBriefFormat["route"]["navigationModel"] => {
  return (CANVAS_NAVIGATION_MODELS as readonly string[]).includes(value);
};

const serializeInspiredesignBriefExpansion = (
  expansion: InspiredesignBriefExpansion
): Record<string, JsonValue> => structuredClone(expansion) as Record<string, JsonValue>;

const serializeInspiredesignRunInput = (input: InspiredesignResolvedInput): Record<string, JsonValue> => ({
  brief: input.brief,
  briefExpansion: serializeInspiredesignBriefExpansion(input.briefExpansion),
  ...(input.harvest === true ? { harvest: true } : {}),
  ...(input.query ? { query: input.query } : {}),
  ...(input.providers.length > 0 ? { providers: input.providers } : {}),
  ...(input.referenceLimit !== undefined ? { maxReferences: input.maxReferences } : {}),
  visualEvidence: input.visualEvidence,
  urls: input.urls,
  captureMode: input.captureMode,
  mode: input.mode,
  ...(input.includePrototypeGuidance !== undefined ? { includePrototypeGuidance: input.includePrototypeGuidance } : {}),
  ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
  ...(input.outputDir ? { outputDir: input.outputDir } : {}),
  ...(typeof input.ttlHours === "number" ? { ttlHours: input.ttlHours } : {}),
  ...(input.browserMode ? { browserMode: input.browserMode } : {}),
  ...(input.profile ? { profile: input.profile } : {}),
  ...(typeof input.useCookies === "boolean" ? { useCookies: input.useCookies } : {}),
  ...(input.challengeAutomationMode ? { challengeAutomationMode: input.challengeAutomationMode } : {}),
  ...(input.cookiePolicyOverride ? { cookiePolicyOverride: input.cookiePolicyOverride } : {})
});

const isStringArray = (value: JsonValue | undefined): value is string[] => (
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
);

const parseInspiredesignBriefFormatRoute = (
  value: JsonValue | undefined
): InspiredesignBriefFormat["route"] | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const profile = typeof value.profile === "string" && isCanvasVisualDirectionProfile(value.profile)
    ? value.profile
    : undefined;
  const themeStrategy = typeof value.themeStrategy === "string" && isCanvasThemeStrategy(value.themeStrategy)
    ? value.themeStrategy
    : undefined;
  const navigationModel = typeof value.navigationModel === "string" && isCanvasNavigationModel(value.navigationModel)
    ? value.navigationModel
    : undefined;
  if (!profile || !themeStrategy || !navigationModel || typeof value.layoutApproach !== "string") {
    return undefined;
  }
  return {
    profile,
    themeStrategy,
    navigationModel,
    layoutApproach: value.layoutApproach
  };
};

const parseInspiredesignBriefFormat = (
  value: JsonValue | undefined
): InspiredesignBriefFormat | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const route = parseInspiredesignBriefFormatRoute(value.route);
  if (
    typeof value.id !== "string"
    || typeof value.label !== "string"
    || !isStringArray(value.bestFor)
    || !isStringArray(value.businessFocus)
    || !isStringArray(value.keywords)
    || typeof value.archetype !== "string"
    || typeof value.layoutArchetype !== "string"
    || typeof value.typographySystem !== "string"
    || typeof value.surfaceTreatment !== "string"
    || typeof value.shapeLanguage !== "string"
    || typeof value.componentGrammar !== "string"
    || typeof value.motionGrammar !== "string"
    || typeof value.paletteIntent !== "string"
    || typeof value.visualDensity !== "string"
    || typeof value.designVariance !== "string"
    || !isStringArray(value.responsiveCollapseRules)
    || !isStringArray(value.guardrails)
    || !isStringArray(value.antiPatterns)
    || !isStringArray(value.deliverables)
    || !route
  ) {
    return undefined;
  }
  return {
    id: value.id,
    label: value.label,
    bestFor: [...value.bestFor],
    businessFocus: [...value.businessFocus],
    keywords: [...value.keywords],
    archetype: value.archetype,
    layoutArchetype: value.layoutArchetype,
    typographySystem: value.typographySystem,
    surfaceTreatment: value.surfaceTreatment,
    shapeLanguage: value.shapeLanguage,
    componentGrammar: value.componentGrammar,
    motionGrammar: value.motionGrammar,
    paletteIntent: value.paletteIntent,
    visualDensity: value.visualDensity,
    designVariance: value.designVariance,
    responsiveCollapseRules: [...value.responsiveCollapseRules],
    guardrails: [...value.guardrails],
    antiPatterns: [...value.antiPatterns],
    deliverables: [...value.deliverables],
    route
  };
};

const parseInspiredesignBriefExpansion = (
  value: JsonValue | undefined
): InspiredesignBriefExpansion | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const format = parseInspiredesignBriefFormat(value.format);
  if (
    typeof value.sourceBrief !== "string"
    || typeof value.advancedBrief !== "string"
    || typeof value.templateVersion !== "string"
    || !format
  ) {
    return undefined;
  }
  return {
    sourceBrief: value.sourceBrief,
    advancedBrief: value.advancedBrief,
    templateVersion: value.templateVersion,
    format
  };
};

const parseInspiredesignEnvelopeInput = (input: WorkflowResumeEnvelope["input"]): InspiredesignRunInput => {
  const briefExpansion = parseInspiredesignBriefExpansion(input.briefExpansion);
  return {
    brief: typeof input.brief === "string" ? input.brief : "",
    mode: typeof input.mode === "string" && INSPIREDESIGN_RENDER_MODES.has(input.mode as RenderMode)
      ? (input.mode as RenderMode)
      : "compact",
    ...(typeof input.harvest === "boolean" ? { harvest: input.harvest } : {}),
    ...(typeof input.query === "string" && input.query.trim().length > 0 ? { query: input.query.trim() } : {}),
    ...(Array.isArray(input.providers) ? { providers: input.providers.filter((provider): provider is string => typeof provider === "string") } : {}),
    ...(typeof input.maxReferences === "number" ? { maxReferences: input.maxReferences } : {}),
    ...(isInspiredesignVisualEvidenceMode(input.visualEvidence) ? { visualEvidence: input.visualEvidence } : {}),
    ...(briefExpansion ? { briefExpansion } : {}),
    ...(Array.isArray(input.urls) ? { urls: input.urls.filter((url): url is string => typeof url === "string") } : {}),
    ...(typeof input.captureMode === "string" && INSPIREDESIGN_CAPTURE_MODES.has(input.captureMode as InspiredesignCaptureMode)
      ? { captureMode: input.captureMode as InspiredesignCaptureMode }
      : {}),
    ...(typeof input.includePrototypeGuidance === "boolean" ? { includePrototypeGuidance: input.includePrototypeGuidance } : {}),
    ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
    ...(typeof input.outputDir === "string" ? { outputDir: input.outputDir } : {}),
    ...(typeof input.ttlHours === "number" ? { ttlHours: input.ttlHours } : {}),
	    ...(typeof input.browserMode === "string" && WORKFLOW_BROWSER_MODES.has(input.browserMode as WorkflowBrowserMode)
	      ? { browserMode: input.browserMode as WorkflowBrowserMode }
	      : {}),
    ...(typeof input.profile === "string" && input.profile.trim().length > 0
      ? { profile: input.profile.trim() }
      : {}),
	    ...(typeof input.useCookies === "boolean" ? { useCookies: input.useCookies } : {}),
    ...(isChallengeAutomationMode(input.challengeAutomationMode)
      ? { challengeAutomationMode: input.challengeAutomationMode }
      : {}),
    ...(typeof input.cookiePolicyOverride === "string" && INSPIREDESIGN_COOKIE_POLICIES.has(input.cookiePolicyOverride as ProviderCookiePolicy)
      ? { cookiePolicyOverride: input.cookiePolicyOverride as ProviderCookiePolicy }
      : {})
  };
};

const normalizeInspiredesignUrls = (urls: string[] | undefined): string[] => {
  if (!urls || urls.length === 0) return [];
  const normalized = urls
    .map((url) => url.trim())
    .filter(Boolean);
  const invalid = normalized.find((url) => !LOOKS_LIKE_URL_RE.test(url));
  if (invalid) {
    throw new Error(`Inspiredesign workflow received an invalid URL: ${invalid}`);
  }
  return [...new Set(normalized.map((url) => canonicalizeUrl(url)))];
};

const normalizeInspiredesignMaxReferences = (
  value: number | undefined,
  fallbackCount: number
): number => {
  if (typeof value === "undefined") {
    return Math.max(1, Math.min(Math.max(fallbackCount, 1), INSPIREDESIGN_MAX_REFERENCES_LIMIT));
  }
  if (!Number.isInteger(value) || value < 1 || value > INSPIREDESIGN_MAX_REFERENCES_LIMIT) {
    throw new Error("Inspiredesign workflow maxReferences must be an integer from 1 to 10.");
  }
  return value;
};

const normalizeInspiredesignVisualEvidenceMode = (
  value: unknown,
  harvest: boolean | undefined
): InspiredesignVisualEvidenceMode => {
  if (typeof value === "undefined") {
    return harvest === true ? "required" : "off";
  }
  if (!isInspiredesignVisualEvidenceMode(value)) {
    throw new Error("Inspiredesign workflow visualEvidence must be one of off, auto, or required.");
  }
  return value;
};

const hasValidInspiredesignBriefRoute = (route: InspiredesignBriefFormat["route"]): boolean => {
  return isCanvasVisualDirectionProfile(route.profile)
    && isCanvasThemeStrategy(route.themeStrategy)
    && isCanvasNavigationModel(route.navigationModel);
};

const shouldReuseInspiredesignBriefExpansion = (
  briefExpansion: InspiredesignBriefExpansion | undefined,
  normalizedBrief: string
): briefExpansion is InspiredesignBriefExpansion => {
  if (!briefExpansion) {
    return false;
  }
  if (normalizeInspiredesignBriefText(briefExpansion.sourceBrief) !== normalizedBrief) {
    return false;
  }
  if (briefExpansion.templateVersion !== INSPIREDESIGN_BRIEF_TEMPLATE_VERSION) {
    return false;
  }
  return hasValidInspiredesignBriefRoute(briefExpansion.format.route);
};

const normalizeInspiredesignInput = (input: InspiredesignRunInput): InspiredesignResolvedInput => {
  const brief = input.brief.trim();
  if (!brief) {
    throw new Error("Inspiredesign workflow requires a non-empty brief.");
  }
  const urls = normalizeInspiredesignUrls(input.urls);
  const query = typeof input.query === "string" && input.query.trim().length > 0 ? input.query.trim() : undefined;
  const providers = normalizeInspiredesignProviders(input.providers);
  const hasExplicitMaxReferences = typeof input.maxReferences !== "undefined";
  if (query && input.harvest !== true) {
    throw new Error("Inspiredesign workflow query is only supported when harvest is true.");
  }
  const canonicality = validateProviderScopedUrlCanonicality({ providers, urls });
  if (!canonicality.ok) {
    throw new Error(`Inspiredesign workflow ${canonicality.message}`);
  }
  if (requiresProviderUrlSiteRecipeCompatibility({ providers, urls, query })) {
    if (input.harvest !== true) {
      throw new Error("Inspiredesign workflow providers require query unless harvest uses compatible URL recovery.");
    }
    const compatibility = validateProviderUrlSiteRecipeCompatibility({ providers, urls });
    if (!compatibility.ok) {
      throw new Error(`Inspiredesign workflow ${compatibility.message}`);
    }
  }
  if (input.harvest === true && !query && urls.length === 0) {
    throw new Error("Inspiredesign harvest requires query or URL references.");
  }
  const visualEvidence = normalizeInspiredesignVisualEvidenceMode(
    (input as { visualEvidence?: unknown }).visualEvidence,
    input.harvest
  );
  const maxReferencesFallback = query || input.harvest === true
    ? INSPIREDESIGN_DEFAULT_MAX_REFERENCES
    : urls.length;
  const normalizedBrief = normalizeInspiredesignBriefText(brief);
  const preferredFormatId = shouldReuseInspiredesignBriefExpansion(input.briefExpansion, normalizedBrief)
    ? input.briefExpansion.format.id
    : undefined;
  const briefExpansion = expandInspiredesignBrief(brief, preferredFormatId);
  return {
    ...input,
    brief,
    briefExpansion,
    ...(query ? { query } : {}),
    providers,
    maxReferences: normalizeInspiredesignMaxReferences(input.maxReferences, maxReferencesFallback),
    ...(query || input.harvest === true || hasExplicitMaxReferences
      ? { referenceLimit: normalizeInspiredesignMaxReferences(input.maxReferences, maxReferencesFallback) }
      : {}),
    visualEvidence,
    urls,
    captureMode: resolveInspiredesignHarvestCaptureMode({
      requested: input.captureMode,
      urls,
      harvest: input.harvest === true,
      providers
    }),
    mode: input.mode ?? (input.harvest === true ? "path" : "compact")
  };
};

const isInspiredesignWorkflowEnvelopeInput = (
  input: InspiredesignRunInput | WorkflowResumeEnvelope
): input is WorkflowResumeEnvelope => {
  return "kind" in input && "input" in input;
};

const buildInspiredesignEnvelope = (
  input: InspiredesignRunInput | WorkflowResumeEnvelope
): { envelope: WorkflowResumeEnvelope; workflowInput: InspiredesignResolvedInput } => {
  if (isInspiredesignWorkflowEnvelopeInput(input)) {
    if (!isWorkflowResumeEnvelope(input as JsonValue)) {
      throw new Error("Inspiredesign workflow envelope is invalid.");
    }
    if (input.kind !== "inspiredesign") {
      throw new Error(`Inspiredesign workflow envelope kind mismatch. Expected inspiredesign but received ${input.kind}.`);
    }
    return {
      envelope: input,
      workflowInput: normalizeInspiredesignInput(parseInspiredesignEnvelopeInput(input.input))
    };
  }
  const workflowInput = normalizeInspiredesignInput(input);
  return {
    envelope: buildWorkflowResumeEnvelope("inspiredesign", serializeInspiredesignRunInput(workflowInput)),
    workflowInput
  };
};

const appendWorkflowTrace = (
  trace: WorkflowTraceEntry[],
  stage: WorkflowTraceEntry["stage"],
  event: string,
  details: Record<string, JsonValue>
): WorkflowTraceEntry[] => [
  ...trace,
  {
    at: new Date().toISOString(),
    stage,
    event,
    details
  }
];

const buildInspiredesignStepEnvelope = (
  workflowInput: InspiredesignResolvedInput,
  trace: WorkflowTraceEntry[],
  stepIndex: number,
  url: string
): WorkflowResumeEnvelope => buildWorkflowResumeEnvelope(
  "inspiredesign",
  serializeInspiredesignRunInput(workflowInput),
  {
    checkpoint: {
      stage: "execute",
      stepId: "fetch_reference",
      stepIndex,
      state: { url },
      updatedAt: new Date().toISOString()
    },
    trace
  }
);

const buildInspiredesignFetchOptionsWithScope = (
  workflowInput: InspiredesignResolvedInput,
  envelope: WorkflowResumeEnvelope,
  providerScope: Pick<ProviderRunOptions, "source" | "providerIds">,
  timeoutMs?: number
): ProviderRunOptions => (
  withWorkflowResumeEnvelopeIntent(
    withProfileOverride(
      withBrowserModeOverride(
        withChallengeAutomationOverride(
          withCookieOverrides({
            ...providerScope,
            ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
          }, workflowInput),
          workflowInput
        ),
        workflowInput
      ),
      workflowInput
    ),
    "workflow.inspiredesign",
    envelope
  )
);

const buildInspiredesignFetchOptions = (
  workflowInput: InspiredesignResolvedInput,
  envelope: WorkflowResumeEnvelope,
  timeoutMs?: number
): ProviderRunOptions => {
  const siteRecipeProviderIds = new Set(
    workflowInput.providers.filter((providerId) => resolveSiteRecipeForProvider(providerId) !== undefined)
  );
  const standardProviderIds = workflowInput.providers.filter((providerId) => !siteRecipeProviderIds.has(providerId));
  let providerScope: Pick<ProviderRunOptions, "source" | "providerIds"> = {};
  if (workflowInput.providers.length > 0 && standardProviderIds.length === 0) {
    providerScope = { source: "web" };
  } else if (standardProviderIds.length > 0) {
    providerScope = { providerIds: standardProviderIds };
  }
  return buildInspiredesignFetchOptionsWithScope(workflowInput, envelope, providerScope, timeoutMs);
};

const buildInspiredesignSiteRecipeFetchOptions = (
  workflowInput: InspiredesignResolvedInput,
  envelope: WorkflowResumeEnvelope,
  timeoutMs?: number
): ProviderRunOptions => buildInspiredesignFetchOptionsWithScope(
  workflowInput,
  envelope,
  { source: "web" },
  timeoutMs
);

const buildInspiredesignReferenceFetchOptions = (
  workflowInput: InspiredesignResolvedInput,
  envelope: WorkflowResumeEnvelope,
  url: string,
  timeoutMs?: number
): ProviderRunOptions => (
  resolveSiteRecipeForUrl(url)
    ? buildInspiredesignSiteRecipeFetchOptions(workflowInput, envelope, timeoutMs)
    : buildInspiredesignFetchOptions(workflowInput, envelope, timeoutMs)
);

type InspiredesignAcceptedDiscoveryProvenance = {
  url: string;
  provider: string;
  source: ProviderSource;
  rank: number;
  siteRecipeId: string;
  discoveryMode: "browser_native_extracted_reference";
  sourcePageQuality?: PinterestMediaClassification["sourcePageQuality"];
};

type InspiredesignDiscoveryDiagnostics = {
  requested: boolean;
  searchAvailable: boolean;
  query?: string;
  providers: string[];
  acceptedUrls: string[];
  acceptedReferences?: InspiredesignAcceptedDiscoveryProvenance[];
  rejected: InspiredesignDiscoveryResult["rejected"];
  failures: ProviderFailureEntry[];
  failure?: string;
  siteRecipeId?: string;
  browserNativeDiagnostics?: Record<string, JsonValue>;
};

type InspiredesignRejectedDiscoveryDiagnostic = Omit<InspiredesignDiscoveryResult["rejected"][number], "rawUrl"> & {
  rawUrl?: string;
};

type InspiredesignDiscoveryDiagnosticsMeta = Omit<InspiredesignDiscoveryDiagnostics, "rejected"> & {
  rejected: InspiredesignRejectedDiscoveryDiagnostic[];
};

const isProviderSourceValue = (value: JsonValue | undefined): value is ProviderSource => (
  value === "web" || value === "community" || value === "social" || value === "shopping"
);

const readAcceptedDiscoveryProvenance = (
  value: JsonValue | undefined
): InspiredesignAcceptedDiscoveryProvenance[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isJsonRecord(entry)) return [];
    if (entry.discoveryMode !== "browser_native_extracted_reference") return [];
    if (typeof entry.url !== "string" || typeof entry.provider !== "string") return [];
    if (!isProviderSourceValue(entry.source) || typeof entry.siteRecipeId !== "string") return [];
    const rank = typeof entry.rank === "number" && Number.isInteger(entry.rank) && entry.rank > 0 ? entry.rank : 1;
    return [{
      url: entry.url,
      provider: entry.provider,
      source: entry.source,
      rank,
      siteRecipeId: entry.siteRecipeId,
      discoveryMode: "browser_native_extracted_reference" as const,
      ...(isPinterestSourcePageQualityValue(entry.sourcePageQuality) ? { sourcePageQuality: entry.sourcePageQuality } : {})
    }];
  });
};

const emptyInspiredesignDiscoveryDiagnostics = (
  workflowInput: InspiredesignResolvedInput,
  searchAvailable: boolean,
  failure?: string
): InspiredesignDiscoveryDiagnostics => ({
  requested: Boolean(workflowInput.query),
  searchAvailable,
  ...(workflowInput.query ? { query: workflowInput.query } : {}),
  providers: workflowInput.providers,
  acceptedUrls: [],
  rejected: [],
  failures: [],
  ...(failure ? { failure } : {})
});

const providerFromInspiredesignDiscoveryFailure = (
  workflowInput: InspiredesignResolvedInput,
  error: ProviderError
): { provider: string; source: ProviderSource } | undefined => {
  const provider = error.provider ?? workflowInput.providers[0];
  const source = error.source ?? (provider ? toProviderSource(provider) : null);
  return provider && source ? { provider, source } : undefined;
};

const failureFromInspiredesignDiscoveryError = (
  workflowInput: InspiredesignResolvedInput,
  error: ProviderError | undefined
): ProviderFailureEntry[] => {
  if (!error) return [];
  const provider = providerFromInspiredesignDiscoveryFailure(workflowInput, error);
  if (!provider) return [];
  return [{
    provider: provider.provider,
    source: provider.source,
    error
  }];
};

const providerFromInspiredesignFetchFailure = (
  result: ProviderAggregateResult
): { provider: string; source: ProviderSource } | undefined => {
  const provider = result.error?.provider ?? result.providerOrder[0];
  const source = result.error?.source ?? (provider ? toProviderSource(provider) : null);
  return provider && source ? { provider, source } : undefined;
};

const failureFromInspiredesignFetchError = (
  result: ProviderAggregateResult
): ProviderFailureEntry[] => {
  if (!result.error || result.failures.length > 0) return [];
  const provider = providerFromInspiredesignFetchFailure(result);
  if (!provider) return [];
  return [{
    provider: provider.provider,
    source: provider.source,
    error: result.error
  }];
};

const normalizeSiteRecipeFetchFailures = (
  siteRecipe: SiteRecipe,
  failures: ProviderFailureEntry[]
): ProviderFailureEntry[] => {
  const source = toProviderSource(siteRecipe.id) ?? "web";
  return failures.map((failure) => ({
    provider: siteRecipe.id,
    source,
    error: {
      ...failure.error,
      provider: siteRecipe.id,
      source,
      details: {
        ...(failure.error.details ?? {}),
        upstreamProvider: failure.provider,
        upstreamSource: failure.source
      }
    }
  }));
};

type InspiredesignAcceptedDiscovery = InspiredesignDiscoveryResult["accepted"][number];

const appendNextUniqueDiscoveryCandidate = (
  queue: InspiredesignAcceptedDiscovery[],
  cursor: number,
  seen: Set<string>,
  accepted: InspiredesignAcceptedDiscovery[]
): number => {
  let nextCursor = cursor;
  while (nextCursor < queue.length) {
    const candidate = queue[nextCursor];
    nextCursor += 1;
    if (!candidate || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    accepted.push(candidate);
    return nextCursor;
  }
  return nextCursor;
};

const capMixedInspiredesignDiscovery = (
  siteDiscovery: InspiredesignDiscoveryResult,
  standardDiscovery: InspiredesignDiscoveryResult,
  maxReferences: number
): InspiredesignDiscoveryResult => {
  const accepted: InspiredesignDiscoveryResult["accepted"] = [];
  const seen = new Set<string>();
  let siteCursor = 0;
  let standardCursor = 0;
  while (
    accepted.length < maxReferences
    && (siteCursor < siteDiscovery.accepted.length || standardCursor < standardDiscovery.accepted.length)
  ) {
    siteCursor = appendNextUniqueDiscoveryCandidate(siteDiscovery.accepted, siteCursor, seen, accepted);
    if (accepted.length >= maxReferences) break;
    standardCursor = appendNextUniqueDiscoveryCandidate(standardDiscovery.accepted, standardCursor, seen, accepted);
  }
  return {
    accepted,
    rejected: [...siteDiscovery.rejected, ...standardDiscovery.rejected]
  };
};

const filterStandardDiscoveryForSiteRecipe = (
  siteRecipe: SiteRecipe,
  discovery: InspiredesignDiscoveryResult
): InspiredesignDiscoveryResult => {
  if (siteRecipe.id !== "social/pinterest") return discovery;

  const accepted: InspiredesignDiscoveryResult["accepted"] = [];
  const rejected: InspiredesignDiscoveryResult["rejected"] = [...discovery.rejected];
  discovery.accepted.forEach((candidate) => {
    if (!isNonCanonicalPinterestLikeUrl(candidate.url)) {
      accepted.push(candidate);
      return;
    }
    const safeRawUrl = sanitizeRejectedInspiredesignDiscoveryUrl(candidate.url);
    rejected.push({
      status: "rejected",
      reason: "invalid_url",
      ...(safeRawUrl ? { rawUrl: safeRawUrl } : {}),
      ...(candidate.title ? { title: candidate.title } : {}),
      source: candidate.source,
      provider: candidate.provider,
      rank: candidate.rank
    });
  });
  return { accepted, rejected };
};

const discoverInspiredesignReferences = async (
  runtime: ReferenceRetrievalPort,
  workflowInput: InspiredesignResolvedInput,
  envelope: WorkflowResumeEnvelope,
  timeoutMs?: number
): Promise<InspiredesignDiscoveryDiagnostics> => {
  if (!workflowInput.query) {
    return emptyInspiredesignDiscoveryDiagnostics(workflowInput, typeof runtime.search === "function");
  }
  const query = workflowInput.query;
  const siteRecipe = workflowInput.providers
    .map((providerId) => resolveSiteRecipeForProvider(providerId))
    .find((recipe) => recipe !== undefined);
  const siteRecipeProviderIds = new Set(
    workflowInput.providers.filter((providerId) => resolveSiteRecipeForProvider(providerId) !== undefined)
  );
  const standardProviderIds = workflowInput.providers.filter((providerId) => !siteRecipeProviderIds.has(providerId));
  if (siteRecipe) {
	    const runSiteRecipeDiscovery = async (): Promise<BrowserNativeDiscoveryResult> => runBrowserNativeDiscovery({
	      recipe: siteRecipe,
	      query,
	      maxReferences: workflowInput.referenceLimit ?? workflowInput.maxReferences,
	      ...(workflowInput.browserMode ? { browserMode: workflowInput.browserMode } : {}),
	      ...(typeof workflowInput.useCookies === "boolean" ? { useCookies: workflowInput.useCookies } : {}),
	      ...(workflowInput.cookiePolicyOverride ? { cookiePolicy: workflowInput.cookiePolicyOverride } : {}),
      auth: resolveProviderRuntimePolicy({
        source: toProviderSource(siteRecipe.id) ?? "web",
        trustedProfile: resolveManagedWorkflowTrustedProfile(workflowInput),
        runtimePolicy: {
          ...(workflowInput.browserMode ? { browserMode: workflowInput.browserMode } : {}),
          ...(workflowInput.profile ? { profile: workflowInput.profile, profileMode: "managed" } : {}),
          ...(typeof workflowInput.useCookies === "boolean" ? { useCookies: workflowInput.useCookies } : {}),
          ...(workflowInput.challengeAutomationMode ? { challengeAutomationMode: workflowInput.challengeAutomationMode } : {}),
          ...(workflowInput.cookiePolicyOverride ? { cookiePolicyOverride: workflowInput.cookiePolicyOverride } : {})
        }
      }).auth,
	      fetchSearchPage: async (url) => {
        const result = normalizeInspiredesignFetchResult(await runtime.fetch(
          { url },
          buildInspiredesignSiteRecipeFetchOptions(workflowInput, envelope, timeoutMs)
        ));
        const failures = result.failures.length > 0 ? result.failures : failureFromInspiredesignFetchError(result);
        return {
          records: result.records,
          failures: normalizeSiteRecipeFetchFailures(siteRecipe, failures),
          ...(result.error?.message ? { errorMessage: result.error.message } : {})
        };
      }
    });
    if (standardProviderIds.length > 0 && typeof runtime.search === "function") {
      try {
        const searchResult = await runtime.search(
          {
            query,
            limit: workflowInput.maxReferences
          },
          {
            ...buildInspiredesignFetchOptions(workflowInput, envelope, timeoutMs),
            providerIds: standardProviderIds
          }
        );
        const searchFailures = searchResult.failures.length > 0
          ? searchResult.failures
          : failureFromInspiredesignDiscoveryError({ ...workflowInput, providers: standardProviderIds }, searchResult.error);
        const discovery = filterStandardDiscoveryForSiteRecipe(
          siteRecipe,
          normalizeInspiredesignDiscoveryRecords(searchResult.records)
        );
        const siteResult = await runSiteRecipeDiscovery();
        const siteDiscovery = normalizeInspiredesignDiscoveryRecords(siteResult.records);
        const siteAcceptedReferences = readAcceptedDiscoveryProvenance(siteResult.diagnostics.acceptedReferences);
        const combinedDiscovery = capMixedInspiredesignDiscovery(
          siteDiscovery,
          discovery,
          workflowInput.referenceLimit ?? workflowInput.maxReferences
        );
        const combinedAcceptedUrls = new Set(combinedDiscovery.accepted.map((candidate) => candidate.url));
        const failures = [...searchFailures, ...siteResult.failures];
        return {
          requested: true,
          searchAvailable: true,
          query,
          providers: workflowInput.providers,
          acceptedUrls: combinedDiscovery.accepted.map((candidate) => candidate.url),
          acceptedReferences: siteAcceptedReferences.filter((entry) => combinedAcceptedUrls.has(entry.url)),
          rejected: combinedDiscovery.rejected,
          failures,
          ...(failures[0]?.error.message ? { failure: failures[0].error.message } : {}),
          siteRecipeId: siteRecipe.id,
          browserNativeDiagnostics: {
            ...siteResult.diagnostics,
            standardAcceptedCount: discovery.accepted.length,
            standardRejectedCount: discovery.rejected.length,
            siteAcceptedCount: siteDiscovery.accepted.length,
            cappedAcceptedCount: combinedDiscovery.accepted.length
          }
        };
      } catch (error) {
        const siteResult = await runSiteRecipeDiscovery();
        const discovery = normalizeInspiredesignDiscoveryRecords(siteResult.records);
        return {
          requested: true,
          searchAvailable: true,
          query,
          providers: workflowInput.providers,
          acceptedUrls: discovery.accepted.map((candidate) => candidate.url),
          acceptedReferences: readAcceptedDiscoveryProvenance(siteResult.diagnostics.acceptedReferences),
          rejected: discovery.rejected,
          failures: siteResult.failures,
          failure: error instanceof Error ? error.message : "Reference discovery failed.",
          siteRecipeId: siteRecipe.id,
          browserNativeDiagnostics: siteResult.diagnostics
        };
      }
    }
    const siteResult = await runSiteRecipeDiscovery();
    const discovery = normalizeInspiredesignDiscoveryRecords(siteResult.records);
    return {
      requested: true,
      searchAvailable: true,
      query,
      providers: workflowInput.providers,
      acceptedUrls: discovery.accepted.map((candidate) => candidate.url),
      acceptedReferences: readAcceptedDiscoveryProvenance(siteResult.diagnostics.acceptedReferences),
      rejected: discovery.rejected,
      failures: siteResult.failures,
      ...(siteResult.failures[0]?.error.message ? { failure: siteResult.failures[0].error.message } : {}),
      siteRecipeId: siteRecipe.id,
      browserNativeDiagnostics: siteResult.diagnostics
    };
  }
  if (typeof runtime.search !== "function") {
    return emptyInspiredesignDiscoveryDiagnostics(
      workflowInput,
      false,
      "Reference discovery requested, but provider search is unavailable in this execution lane."
    );
  }
  let searchResult: ProviderAggregateResult;
  try {
    searchResult = await runtime.search(
      {
        query: workflowInput.query,
        limit: workflowInput.maxReferences
      },
      {
        ...buildInspiredesignFetchOptions(workflowInput, envelope, timeoutMs),
        ...(workflowInput.providers.length > 0 ? { providerIds: workflowInput.providers } : {})
      }
    );
  } catch (error) {
    return emptyInspiredesignDiscoveryDiagnostics(
      workflowInput,
      true,
      error instanceof Error ? error.message : "Reference discovery failed."
    );
  }
  const discovery = normalizeInspiredesignDiscoveryRecords(searchResult.records);
  const discoveryFailures = searchResult.failures.length > 0
    ? searchResult.failures
    : failureFromInspiredesignDiscoveryError(workflowInput, searchResult.error);
  return {
    requested: true,
    searchAvailable: true,
    query: workflowInput.query,
    providers: workflowInput.providers,
    acceptedUrls: discovery.accepted.map((candidate) => candidate.url),
    rejected: discovery.rejected,
    failures: discoveryFailures,
    ...(searchResult.error?.message ? { failure: searchResult.error.message } : {})
  };
};

const buildEmptyInspiredesignCaptureAttemptCounts = (): InspiredesignCaptureAttemptCounts => ({
  snapshot: { captured: 0, failed: 0, skipped: 0 },
  clone: { captured: 0, failed: 0, skipped: 0 },
  dom: { captured: 0, failed: 0, skipped: 0 }
});

const buildUnavailableInspiredesignCaptureEvidence = (): InspiredesignCaptureEvidence => ({
  attempts: {
    snapshot: { status: "skipped", detail: INSPIREDESIGN_CAPTURE_UNAVAILABLE_FAILURE },
    clone: { status: "skipped", detail: INSPIREDESIGN_CAPTURE_UNAVAILABLE_FAILURE },
    dom: { status: "skipped", detail: INSPIREDESIGN_CAPTURE_UNAVAILABLE_FAILURE }
  }
});

const getInspiredesignReferenceId = (url: string): string => (
  createHash("sha256").update(url).digest("hex").slice(0, 12)
);

const buildVisualPolicyMetadata = (
  decision: InspiredesignVisualPolicyDecision
): InspiredesignVisualEvidenceRuntimeMetadata | undefined => {
  if (decision.status === "allowed") return undefined;
  return {
    status: decision.status,
    kind: "viewport",
    fullPage: false,
    capturedAt: new Date().toISOString(),
    warnings: [`policy:${decision.reason}`],
    failure: decision.message
  };
};

const mergeCaptureVisualEvidence = (
  capture: InspiredesignCaptureEvidence | null | undefined,
  visual: InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence | undefined
): InspiredesignCaptureEvidence | null | undefined => {
  if (!visual) return capture;
  return {
    ...(capture ?? {}),
    visual
  };
};

const mergeCaptureMotionEvidence = (
  capture: InspiredesignCaptureEvidence | null | undefined,
  motion: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence | undefined
): InspiredesignCaptureEvidence | null | undefined => {
  if (!motion) return capture;
  return {
    ...(capture ?? {}),
    motion
  };
};

const mergeCapturePinMediaEvidence = (
  capture: InspiredesignCaptureEvidence | null | undefined,
  pinMedia: InspiredesignPinterestPinMediaRuntimeMetadata | InspiredesignPersistedPinterestPinMediaEvidence | undefined
): InspiredesignCaptureEvidence | null | undefined => {
  if (!pinMedia) return capture;
  return {
    ...(capture ?? {}),
    pinMedia
  };
};

const isCapturedCaptureVisual = (
  visual: InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence | undefined
): boolean => visual?.status === "captured";

const selectMergedCaptureVisual = (
  base: InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence | undefined,
  addon: InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence | undefined
): InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence | undefined => {
  if (isCapturedCaptureVisual(addon)) return addon;
  if (isCapturedCaptureVisual(base)) return base;
  return addon ?? base;
};

const mergeCaptureEvidence = (
  base: InspiredesignCaptureEvidence | null | undefined,
  addon: InspiredesignCaptureEvidence | null | undefined
): InspiredesignCaptureEvidence | null | undefined => {
  if (!base) return addon;
  if (!addon) return base;
  return {
    ...base,
    ...addon,
    attempts: addon.attempts ?? base.attempts,
    visual: selectMergedCaptureVisual(base.visual, addon.visual),
    motion: addon.motion ?? base.motion,
    pinMedia: addon.pinMedia ?? base.pinMedia
  };
};

const isVisualPolicyBlockerDecision = (decision: InspiredesignVisualPolicyDecision): boolean => (
  INSPIREDESIGN_VISUAL_POLICY_BLOCKER_REASONS.has(decision.reason)
);

const buildMissingRequiredVisualEvidence = (
  failure: string,
  _visualPlan?: InspiredesignVisualCapturePlan
): InspiredesignVisualEvidenceRuntimeMetadata => ({
  status: "failed",
  kind: "viewport",
  fullPage: false,
  capturedAt: new Date().toISOString(),
  warnings: ["required_visual_evidence_missing"],
  failure
});

const detailFromWorkflowCaptureError = (
  error: unknown,
  fallback: string
): string => {
  const rawMessage = error instanceof Error && error.message.trim() ? error.message : fallback;
  const redacted = redactSensitive(rawMessage);
  return typeof redacted === "string" && redacted.trim().length > 0 ? redacted : fallback;
};

const buildFailedWorkflowPrimaryVisualEvidence = (
  failure: string
): InspiredesignVisualEvidenceRuntimeMetadata => ({
  status: "failed",
  kind: "viewport",
  fullPage: false,
  capturedAt: new Date().toISOString(),
  warnings: ["primary_visual_capture_failed"],
  failure
});

const buildFailedWorkflowPrimaryMotionEvidence = (
  failure: string
): InspiredesignMotionEvidenceRuntimeMetadata => ({
  status: "failed",
  kind: "screencast",
  capturedAt: new Date().toISOString(),
  frameCount: 0,
  warnings: ["primary_motion_capture_failed"],
  failure,
  diagnostic: true,
  diagnosticReasons: ["primary_motion_capture_failed"]
});

const buildFailedWorkflowPrimaryPinMediaEvidence = (
	referenceId: string,
	url: string,
	failure: string
): InspiredesignPinterestPinMediaRuntimeMetadata => ({
	status: "failed",
	kind: "image",
	capturedAt: new Date().toISOString(),
	referenceId,
	url,
	warnings: ["primary_pin_media_capture_failed"],
	failure,
	rejectionReasons: ["primary_pin_media_capture_failed"]
});

const getRequiredVisualEvidenceFailure = (
  workflowInput: InspiredesignResolvedInput,
  visualPlan: InspiredesignVisualCapturePlan,
  capture: InspiredesignCaptureEvidence | null | undefined,
  missingFailure = REQUIRED_VISUAL_EVIDENCE_MISSING_FAILURE
): string | undefined => {
  if (workflowInput.visualEvidence !== "required" || visualPlan.policy.status !== "allowed") return undefined;
  const visual = normalizeInspiredesignCaptureEvidence(capture)?.visual;
  if (visual?.status === "captured") return undefined;
  if (hasWorkflowProvisionalNonVisualEvidence(capture)) return undefined;
  if (!visual) return missingFailure;
  return visual.failure ?? missingFailure;
};

const addRequiredVisualEvidenceFailure = (
  capture: InspiredesignCaptureEvidence | null | undefined,
  visualPlan: InspiredesignVisualCapturePlan | undefined,
  failure: string,
  forceRequiredWarning = false
): InspiredesignCaptureEvidence | null | undefined => {
  const visual = normalizeInspiredesignCaptureEvidence(capture)?.visual;
  if (visual?.status === "captured") return capture;
  const missingVisual = buildMissingRequiredVisualEvidence(failure, visualPlan);
  if (!visual) return mergeCaptureVisualEvidence(capture, missingVisual);
  if (visual.status === "failed" && visual.failure && !forceRequiredWarning) {
    return capture;
  }
  if (visual.status === "failed" && visual.failure && visual.warnings.includes("required_visual_evidence_missing")) {
    return capture;
  }
  return mergeCaptureVisualEvidence(capture, {
    ...visual,
    status: "failed",
    failure: visual.failure ?? missingVisual.failure,
    warnings: Array.from(new Set([...visual.warnings, ...missingVisual.warnings]))
  });
};

const VISUAL_TEMP_PATH_MISMATCH_FAILURE =
  "Visual evidence temp path did not match the workflow capture plan.";
const VISUAL_KIND_MISMATCH_FAILURE =
  "Visual evidence kind did not match the workflow capture contract.";

const hasTrustedVisualTempPath = (
  visual: InspiredesignVisualEvidenceRuntimeMetadata,
  visualPlan: InspiredesignVisualCapturePlan
): boolean => {
  if (visual.status === "captured" && !visual.tempPath) return false;
  if (!visual.tempPath) return true;
  if (!visualPlan.tempPath) return false;
  return resolve(visual.tempPath) === resolve(visualPlan.tempPath);
};

const hasTrustedVisualKind = (
  visual: InspiredesignVisualEvidenceRuntimeMetadata
): boolean => isInspiredesignVisualEvidenceKind((visual as { kind?: unknown }).kind);

const readRuntimeVisualWarnings = (
  visual: InspiredesignVisualEvidenceRuntimeMetadata
): string[] => {
  const warnings = (visual as { warnings?: unknown }).warnings;
  return Array.isArray(warnings) ? warnings.filter((warning): warning is string => typeof warning === "string") : [];
};

const failMismatchedVisualTempPath = (
  visual: InspiredesignVisualEvidenceRuntimeMetadata,
  failure = VISUAL_TEMP_PATH_MISMATCH_FAILURE,
  warning = "visual_temp_path_mismatch"
): InspiredesignVisualEvidenceRuntimeMetadata => ({
  status: "failed",
  kind: hasTrustedVisualKind(visual) ? visual.kind : "viewport",
  fullPage: visual.fullPage,
  capturedAt: visual.capturedAt,
  warnings: [...readRuntimeVisualWarnings(visual), warning],
  failure
});

const trustRuntimeVisualEvidence = (
  visual: InspiredesignVisualEvidenceRuntimeMetadata | undefined,
  visualPlan: InspiredesignVisualCapturePlan
): InspiredesignVisualEvidenceRuntimeMetadata | undefined => {
  if (!visual) return undefined;
  if (!hasTrustedVisualKind(visual)) {
    return failMismatchedVisualTempPath(
      visual,
      VISUAL_KIND_MISMATCH_FAILURE,
      "visual_kind_mismatch"
    );
  }
  return hasTrustedVisualTempPath(visual, visualPlan)
    ? visual
    : failMismatchedVisualTempPath(visual);
};

const PRE_ARTIFACT_CAPTURE_SKIP_MESSAGE =
  "Skipped after deep capture failed before artifact capture started.";

const buildFailedInspiredesignCaptureEvidence = (
  detail: string
): InspiredesignCaptureEvidence => ({
  attempts: {
    snapshot: { status: "failed", detail },
    clone: { status: "skipped", detail: PRE_ARTIFACT_CAPTURE_SKIP_MESSAGE },
    dom: { status: "skipped", detail: PRE_ARTIFACT_CAPTURE_SKIP_MESSAGE }
  }
});

const buildSkippedDeepDiagnosticsEvidence = (detail: string): InspiredesignCaptureEvidence => ({
  attempts: {
    snapshot: { status: "skipped", detail },
    clone: { status: "skipped", detail },
    dom: { status: "skipped", detail }
  }
});

const describeInspiredesignCaptureAttempts = (
  key: InspiredesignCaptureAttemptKey,
  counts: Record<InspiredesignCaptureAttemptStatus, number>,
  statuses: InspiredesignCaptureAttemptStatus[]
): string | null => {
  const parts = statuses
    .filter((status) => counts[status] > 0)
    .map((status) => `${status} ${counts[status]}`);
  if (parts.length === 0) return null;
  return `${key} (${parts.join(", ")})`;
};

const summarizeInspiredesignCaptureAttempts = (
  references: InspiredesignReferenceEvidence[]
): {
  counts: InspiredesignCaptureAttemptCounts;
  worked: string[];
  didNotWork: string[];
  summary: string;
} | undefined => {
  const counts = buildEmptyInspiredesignCaptureAttemptCounts();
  let hasAttempts = false;
  for (const reference of references) {
    const attempts = normalizeInspiredesignCaptureEvidence(reference.capture)?.attempts;
    if (!attempts) continue;
    hasAttempts = true;
    for (const key of INSPIREDESIGN_CAPTURE_ATTEMPT_KEYS) {
      counts[key][attempts[key].status] += 1;
    }
  }
  if (!hasAttempts) return undefined;
  const worked = INSPIREDESIGN_CAPTURE_ATTEMPT_KEYS
    .map((key) => describeInspiredesignCaptureAttempts(key, counts[key], ["captured"]))
    .filter((value): value is string => value !== null);
  const didNotWork = INSPIREDESIGN_CAPTURE_ATTEMPT_KEYS
    .map((key) => describeInspiredesignCaptureAttempts(key, counts[key], ["failed", "skipped"]))
    .filter((value): value is string => value !== null);
  return {
    counts,
    worked,
    didNotWork,
    summary: formatInspiredesignCaptureAttemptSummary({ worked, didNotWork })
  };
};

const isPinterestVisualFirstStrategy = (classification: PinterestMediaClassification): boolean => (
  classification.kind === "image_pin"
);

const isPinterestMotionFirstStrategy = (classification: PinterestMediaClassification): boolean => (
  classification.kind === "video_pin"
);

const PINTEREST_PIN_MEDIA_CAPTURE_PAGE_QUALITIES = new Set<PinterestMediaClassification["sourcePageQuality"]>([
	"chrome_only",
	"login_challenge",
	"pin_media",
	"search_shell",
	"unknown"
]);

const PINTEREST_PIN_MEDIA_CAPTURE_KINDS = new Set<PinterestMediaClassification["kind"]>([
	"image_pin",
	"login_challenge",
	"shell",
	"video_pin",
	"unknown_pin"
]);

const shouldCapturePinterestPinMedia = (
	url: string,
	classification: PinterestMediaClassification
): boolean => (
	isCanonicalPinterestPinUrl(url)
	&& PINTEREST_PIN_MEDIA_CAPTURE_KINDS.has(classification.kind)
	&& PINTEREST_PIN_MEDIA_CAPTURE_PAGE_QUALITIES.has(classification.sourcePageQuality)
);

const PINTEREST_VISUAL_AFTER_PIN_MEDIA_BLOCKED_QUALITIES = new Set<PinterestMediaClassification["sourcePageQuality"]>([
  "chrome_only",
  "login_challenge",
  "search_shell"
]);

const hasCapturedPinterestPinMediaMetadata = (
  pinMedia: InspiredesignPinterestPinMediaRuntimeMetadata | undefined
): boolean => (
  pinMedia?.status === "captured"
  && pinMedia.pinterestPageQuality === "pin_media"
);

const shouldCapturePinterestVisualAfterPinMedia = (args: {
  visualEvidence: InspiredesignVisualEvidenceMode;
  visualFirst: boolean;
  classification: PinterestMediaClassification;
  pinMedia: InspiredesignPinterestPinMediaRuntimeMetadata | undefined;
}): boolean => (
  args.visualEvidence === "required"
  && !args.visualFirst
  && hasCapturedPinterestPinMediaMetadata(args.pinMedia)
  && !PINTEREST_VISUAL_AFTER_PIN_MEDIA_BLOCKED_QUALITIES.has(args.classification.sourcePageQuality)
);

const PINTEREST_MEDIA_KINDS = new Set<PinterestMediaClassification["kind"]>([
  "image_pin",
  "video_pin",
  "unknown_pin",
  "board",
  "idea_page",
  "source_page",
  "shell",
  "login_challenge",
  "invalid"
]);

const PINTEREST_SOURCE_PAGE_QUALITIES = new Set<PinterestMediaClassification["sourcePageQuality"]>([
  "pin_media",
  "pin_grid_media",
  "search_shell",
  "chrome_only",
  "login_challenge",
  "unknown",
  "invalid"
]);

const isPinterestMediaKindValue = (value: JsonValue | undefined): value is PinterestMediaClassification["kind"] => (
  typeof value === "string" && PINTEREST_MEDIA_KINDS.has(value as PinterestMediaClassification["kind"])
);

const isPinterestSourcePageQualityValue = (
  value: JsonValue | undefined
): value is PinterestMediaClassification["sourcePageQuality"] => (
  typeof value === "string" && PINTEREST_SOURCE_PAGE_QUALITIES.has(value as PinterestMediaClassification["sourcePageQuality"])
);

const readPinterestClassificationStrings = (value: JsonValue | undefined): string[] => (
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
);

const readBrowserNativePinterestClassification = (
  primary: ReturnType<typeof getInspiredesignPrimaryRecord>
): PinterestMediaClassification | undefined => {
  const classification = isJsonRecord(primary?.attributes.pinterestMediaClassification)
    ? primary.attributes.pinterestMediaClassification
    : undefined;
  if (!classification) return undefined;
  if (!isPinterestMediaKindValue(classification.kind)) return undefined;
  if (!isPinterestSourcePageQualityValue(classification.sourcePageQuality)) return undefined;
  return {
    kind: classification.kind,
    confidence: typeof classification.confidence === "number" && Number.isFinite(classification.confidence)
      ? classification.confidence
      : 0.66,
    productCandidate: classification.kind === "image_pin" || classification.kind === "video_pin",
    sourcePageQuality: classification.sourcePageQuality,
    reasons: readPinterestClassificationStrings(classification.reasons),
    diagnosticBlockers: readPinterestClassificationStrings(classification.diagnosticBlockers)
  };
};

const classifyPinterestReference = (
  url: string,
  result: ProviderAggregateResult
): PinterestMediaClassification => {
  const primary = getInspiredesignPrimaryRecord(result, url);
  return readBrowserNativePinterestClassification(primary) ?? classifyPinterestCandidate({
    url,
    title: primary?.title,
    content: primary?.content,
    html: primary?.content
  });
};

const captureWorkflowVisualEvidence = async (
  url: string,
  workflowInput: InspiredesignResolvedInput,
  captureVisualEvidence: InspiredesignWorkflowOptions["captureVisualEvidence"],
  visualPlan: InspiredesignVisualCapturePlan,
  timeoutMs?: number
): Promise<InspiredesignVisualEvidenceRuntimeMetadata | undefined> => {
  if (visualPlan.policy.status !== "allowed" || !visualPlan.tempPath || !captureVisualEvidence) return undefined;
  try {
    return await captureVisualEvidence(url, {
	      visualEvidencePath: visualPlan.tempPath,
	      timeoutMs,
	      browserMode: workflowInput.browserMode,
      profile: workflowInput.profile,
	      useCookies: workflowInput.useCookies,
      challengeAutomationMode: workflowInput.challengeAutomationMode,
      cookiePolicyOverride: workflowInput.cookiePolicyOverride,
      cookieSource: workflowInput.cookieSource
    });
  } catch (error) {
    return buildFailedWorkflowPrimaryVisualEvidence(
      detailFromWorkflowCaptureError(error, "Primary visual evidence capture failed.")
    );
  }
};

const captureWorkflowMotionEvidence = async (
  url: string,
  workflowInput: InspiredesignResolvedInput,
  captureMotionEvidence: InspiredesignWorkflowOptions["captureMotionEvidence"],
  referenceId: string,
  motionEvidenceTempDir: string | undefined,
  timeoutMs?: number
): Promise<InspiredesignMotionEvidenceRuntimeMetadata | undefined> => {
  if (!captureMotionEvidence || !motionEvidenceTempDir) return undefined;
  try {
    return await captureMotionEvidence(url, {
	      outputDir: join(motionEvidenceTempDir, referenceId),
	      timeoutMs,
	      browserMode: workflowInput.browserMode,
      profile: workflowInput.profile,
	      useCookies: workflowInput.useCookies,
      challengeAutomationMode: workflowInput.challengeAutomationMode,
      cookiePolicyOverride: workflowInput.cookiePolicyOverride,
      cookieSource: workflowInput.cookieSource
    });
  } catch (error) {
    return buildFailedWorkflowPrimaryMotionEvidence(
      detailFromWorkflowCaptureError(error, "Primary motion evidence capture failed.")
    );
  }
};

const captureWorkflowPinMediaEvidence = async (
	url: string,
	workflowInput: InspiredesignResolvedInput,
	capturePinMediaEvidence: InspiredesignWorkflowOptions["capturePinMediaEvidence"],
	referenceId: string,
	pinMediaEvidenceTempDir: string | undefined,
	classification: PinterestMediaClassification,
	timeoutMs?: number
): Promise<InspiredesignPinterestPinMediaRuntimeMetadata | undefined> => {
	if (!capturePinMediaEvidence || !pinMediaEvidenceTempDir) return undefined;
	try {
		const pinMediaEvidencePath = buildPinMediaTempCapturePath(pinMediaEvidenceTempDir, referenceId);
		const metadata = await capturePinMediaEvidence(url, {
			referenceId,
			pinMediaEvidencePath,
			timeoutMs,
			browserMode: workflowInput.browserMode,
			profile: workflowInput.profile,
			useCookies: workflowInput.useCookies,
		challengeAutomationMode: workflowInput.challengeAutomationMode,
		cookiePolicyOverride: workflowInput.cookiePolicyOverride,
		cookieSource: workflowInput.cookieSource,
		pinterestPageQuality: classification.sourcePageQuality
	});
	if (!metadata) return undefined;
	return {
		...metadata,
		referenceId,
		url,
		pinterestPageQuality: metadata.pinterestPageQuality ?? classification.sourcePageQuality
	};
	} catch (error) {
	return buildFailedWorkflowPrimaryPinMediaEvidence(
		referenceId,
		url,
		detailFromWorkflowCaptureError(error, "Primary Pinterest pin media evidence capture failed.")
	);
	}
};

const WORKFLOW_MOTION_REPLAY_ARTIFACT_PATH_PATTERN = /^motion-evidence\/[A-Za-z0-9._-]+\/replay\.json$/;
const WORKFLOW_MOTION_PREVIEW_ARTIFACT_PATH_PATTERN = /^motion-evidence\/[A-Za-z0-9._-]+\/preview\.png$/;

const hasWorkflowPersistedMotionFileAuthority = (
  file: { path?: string; sha256?: string; bytes?: number } | undefined,
  pathPattern: RegExp,
  minBytes: number
): boolean => (
  typeof file?.path === "string"
  && pathPattern.test(file.path)
  && typeof file.sha256 === "string"
  && MOTION_EVIDENCE_SHA256_HEX_PATTERN.test(file.sha256)
  && typeof file.bytes === "number"
  && Number.isFinite(file.bytes)
  && file.bytes >= minBytes
);

const hasWorkflowPrimaryMotionDesignEvidence = (
  reference: InspiredesignReferenceEvidence
): boolean => {
  const motion = reference.capture?.motion;
  if (!motion || motion.status !== "captured") return false;
  const persistedMotion = persistInspiredesignMotionEvidence(motion);
  const hasReviewableFiles = persistedMotion.authority === "design_evidence"
    && persistedMotion.diagnostic === false
    && persistedMotion.frameCount > 0
    && typeof persistedMotion.failure !== "string"
    && hasWorkflowPersistedMotionFileAuthority(
      persistedMotion.replay,
      WORKFLOW_MOTION_REPLAY_ARTIFACT_PATH_PATTERN,
      MIN_MOTION_REPLAY_BYTES
    )
    && hasWorkflowPersistedMotionFileAuthority(
      persistedMotion.preview,
      WORKFLOW_MOTION_PREVIEW_ARTIFACT_PATH_PATTERN,
      MIN_MOTION_PREVIEW_BYTES
    );
  if (!hasReviewableFiles) return false;
  return isInspiredesignAuthoritativeRankedReference(
    {
      id: reference.id,
      url: reference.url,
      evidenceAuthority: "motion_ready"
    },
    {
      motions: [{
        referenceId: reference.id,
        url: reference.url,
        motion: persistedMotion
      }]
    }
  );
};

const hasWorkflowProvisionalMotionEvidence = (
  capture: InspiredesignCaptureEvidence | null | undefined
): boolean => {
  const motion = capture?.motion;
  if (motion?.status !== "captured") return false;
  return motion.diagnostic !== true
    && motion.frameCount > 0
    && motion.diagnosticReasons.length === 0;
};

const hasWorkflowCapturedMotionEvidence = (
  capture: InspiredesignCaptureEvidence | null | undefined
): boolean => capture?.motion?.status === "captured";

const hasWorkflowProvisionalPinMediaEvidence = (
	capture: InspiredesignCaptureEvidence | null | undefined
): boolean => {
	const pinMedia = capture?.pinMedia;
	if (pinMedia?.status !== "captured") return false;
	return "tempPath" in pinMedia
		&& typeof pinMedia.tempPath === "string"
		&& pinMedia.tempPath.trim().length > 0
		&& pinMedia.rejectionReasons.length === 0
		&& !pinMedia.failure;
};

const hasWorkflowPrimaryPinMediaDesignEvidence = (
	reference: InspiredesignReferenceEvidence
): boolean => {
	const pinMedia = reference.capture?.pinMedia;
	if (!pinMedia || pinMedia.status !== "captured") return false;
	const persistedPinMedia = persistInspiredesignPinterestPinMediaEvidence(pinMedia);
	const pinMediaIndexEntry = buildInspiredesignPinterestPinMediaIndexEntry(persistedPinMedia);
	if (!pinMediaIndexEntry) return false;
	return isInspiredesignAuthoritativeRankedReference(
		{
		id: reference.id,
		url: reference.url,
		evidenceAuthority: "pin_media_ready"
		},
		{ pinMedia: [pinMediaIndexEntry] }
	);
};

const PIN_MEDIA_FINALIZATION_FAILURE_REASONS = new Set([
	"pin_media_temp_path_missing",
	"pin_media_temp_path_mismatch",
	"pin_media_temp_file_unavailable",
	"pin_media_temp_file_too_large",
	"unsupported_byte_signature",
	"unsupported_declared_content_type"
]);

const hasWorkflowPinMediaFinalizationFailure = (
	reference: InspiredesignReferenceEvidence
): boolean => {
	const pinMedia = reference.capture?.pinMedia;
	if (!pinMedia || pinMedia.status !== "failed") return false;
	return pinMedia.rejectionReasons.some((reason) => PIN_MEDIA_FINALIZATION_FAILURE_REASONS.has(reason));
};

const hasWorkflowProvisionalNonVisualEvidence = (
	capture: InspiredesignCaptureEvidence | null | undefined
): boolean => (
	hasWorkflowProvisionalMotionEvidence(capture)
	|| hasWorkflowProvisionalPinMediaEvidence(capture)
);

const hasWorkflowProvisionalPrimaryEvidence = (
  capture: InspiredesignCaptureEvidence | null | undefined
): boolean => {
  const visual = capture?.visual;
	const pinMedia = capture?.pinMedia;
	return visual?.status === "captured"
	|| pinMedia?.status === "captured"
	|| hasWorkflowProvisionalNonVisualEvidence(capture);
};

const shouldFailRequiredVisualEvidence = (
  reference: InspiredesignReferenceEvidence,
  persistedVisual: InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence
): boolean => (
  !isPolicySkippedVisualEvidence(persistedVisual)
  && reference.captureStatus !== "off"
  && !hasWorkflowCapturedMotionEvidence(reference.capture)
  && !hasWorkflowPrimaryMotionDesignEvidence(reference)
  && !hasWorkflowPrimaryPinMediaDesignEvidence(reference)
);

const captureInspiredesignReference = async (
  url: string,
  captureMode: InspiredesignCaptureMode,
  workflowInput: InspiredesignResolvedInput,
  captureReference: InspiredesignWorkflowOptions["captureReference"],
  visualPlan: InspiredesignVisualCapturePlan,
  timeoutMs?: number,
  primaryCapture?: InspiredesignCaptureEvidence | null
): Promise<InspiredesignCaptureOutcome> => {
  const visualPolicyMetadata = buildVisualPolicyMetadata(visualPlan.policy);
  if (captureMode === "off") {
    const captureWithPolicy = mergeCaptureVisualEvidence(primaryCapture, visualPolicyMetadata);
    return hasWorkflowProvisionalPrimaryEvidence(captureWithPolicy)
      ? { captureStatus: "captured", capture: captureWithPolicy }
      : visualPolicyMetadata
        ? { captureStatus: "off", capture: { visual: visualPolicyMetadata } }
        : { captureStatus: "off", ...(primaryCapture ? { capture: primaryCapture } : {}) };
  }
  if (visualPolicyMetadata && isVisualPolicyBlockerDecision(visualPlan.policy)) {
    const captureStatus = visualPlan.policy.status === "failed" ? "failed" : "off";
    return {
      captureStatus,
      ...(captureStatus === "failed" ? { captureFailure: visualPlan.policy.message } : {}),
      capture: { visual: visualPolicyMetadata }
    };
  }
  if (!captureReference) {
    const unavailableCapture = mergeCaptureEvidence(
      primaryCapture,
      mergeCaptureVisualEvidence(buildUnavailableInspiredesignCaptureEvidence(), visualPolicyMetadata)
    );
    const requiredVisualFailure = getRequiredVisualEvidenceFailure(
      workflowInput,
      visualPlan,
      unavailableCapture,
      INSPIREDESIGN_CAPTURE_UNAVAILABLE_FAILURE
    );
    const capture = requiredVisualFailure
      ? addRequiredVisualEvidenceFailure(unavailableCapture, visualPlan, requiredVisualFailure)
      : unavailableCapture;
    return hasWorkflowProvisionalPrimaryEvidence(capture) || hasWorkflowCapturedMotionEvidence(capture)
      ? { captureStatus: "captured", capture }
      : {
        captureStatus: "failed",
        captureFailure: INSPIREDESIGN_CAPTURE_UNAVAILABLE_FAILURE,
        capture
      };
  }
  try {
    const rawCapture = await captureReference(url, {
      timeoutMs,
      useCookies: workflowInput.useCookies,
      challengeAutomationMode: workflowInput.challengeAutomationMode,
      cookiePolicyOverride: workflowInput.cookiePolicyOverride,
      visualEvidence: visualPlan.policy.status === "allowed" ? workflowInput.visualEvidence : "off",
      visualEvidencePath: visualPlan.policy.status === "allowed" ? visualPlan.tempPath : undefined
    });
    const capture = normalizeInspiredesignCaptureEvidence(rawCapture);
    const runtimeVisual = rawCapture?.visual as InspiredesignVisualEvidenceRuntimeMetadata | undefined;
    const trustedRuntimeVisual = trustRuntimeVisualEvidence(runtimeVisual, visualPlan);
    const captureWithRuntimeVisual = trustedRuntimeVisual
      ? mergeCaptureVisualEvidence(capture, trustedRuntimeVisual)
      : capture;
    const captureWithPrimary = mergeCaptureEvidence(primaryCapture, captureWithRuntimeVisual);
    const captureWithVisualPolicy = trustedRuntimeVisual
      ? captureWithPrimary
      : mergeCaptureVisualEvidence(captureWithPrimary, visualPolicyMetadata);
    const requiredVisualFailure = getRequiredVisualEvidenceFailure(workflowInput, visualPlan, captureWithVisualPolicy);
    const captureWithRequiredVisual = requiredVisualFailure
      ? addRequiredVisualEvidenceFailure(captureWithVisualPolicy, visualPlan, requiredVisualFailure)
      : captureWithVisualPolicy;
    if (!hasInspiredesignCaptureArtifacts(capture) && !hasWorkflowProvisionalPrimaryEvidence(captureWithRequiredVisual)) {
      return {
        captureStatus: "failed",
        captureFailure: "Deep capture did not return usable snapshot, DOM, or clone evidence.",
        ...(captureWithRequiredVisual ? { capture: captureWithRequiredVisual } : {})
      };
    }
    if (requiredVisualFailure) {
      return {
        captureStatus: "failed",
        captureFailure: requiredVisualFailure,
        ...(captureWithRequiredVisual ? { capture: captureWithRequiredVisual } : {})
      };
    }
    return {
      captureStatus: "captured",
      ...(captureWithRequiredVisual ? { capture: captureWithRequiredVisual } : {})
    };
  } catch (error) {
    const captureFailure = error instanceof Error && error.message.trim()
      ? error.message
      : "Deep capture failed.";
    const visualFailureMetadata = visualPolicyMetadata
      ?? (workflowInput.visualEvidence === "required"
        && visualPlan.policy.status === "allowed"
        && !hasWorkflowProvisionalNonVisualEvidence(primaryCapture)
        ? buildMissingRequiredVisualEvidence(captureFailure, visualPlan)
        : undefined);
    const failedDeepCapture = mergeCaptureVisualEvidence(
      buildFailedInspiredesignCaptureEvidence(captureFailure),
      primaryCapture?.visual ? undefined : visualFailureMetadata
    );
    const capture = mergeCaptureEvidence(primaryCapture, failedDeepCapture);
    return hasWorkflowProvisionalPrimaryEvidence(capture)
      ? { captureStatus: "captured", capture }
      : {
        captureStatus: "failed",
        captureFailure,
        capture
      };
  }
};

const getInspiredesignPrimaryRecord = (
  result: ProviderAggregateResult,
  url: string
): NormalizedRecord | undefined => {
  const canonicalUrl = canonicalizeUrl(url);
  return result.records.find((record) => record.url && canonicalizeUrl(record.url) === canonicalUrl) ?? result.records[0];
};

const summarizeInspiredesignIssueSnippet = (record: NormalizedRecord): string | undefined => {
  const content = normalizePlainText(record.content);
  if (!content) return undefined;
  return toSnippet(content, 240);
};

const scoreInspiredesignIssueHint = (hint: ProviderIssueHint): number => {
  if (hint.reasonCode === "token_required" || hint.reasonCode === "auth_required") return 3;
  if (hint.reasonCode === "challenge_detected") return 2;
  if (hint.constraint?.kind === "render_required") return 1;
  return 0;
};

const toInspiredesignIssueFailure = (
  record: NormalizedRecord,
  hint: ProviderIssueHint
): ProviderFailureEntry => {
  const issueSnippet = summarizeInspiredesignIssueSnippet(record);
  const details: Record<string, JsonValue> = {
    reasonCode: hint.reasonCode,
    ...(record.url ? { url: record.url } : {}),
    ...(record.title ? { title: record.title } : {}),
    ...(issueSnippet ? { message: issueSnippet } : {}),
    ...(typeof record.attributes.providerShell === "string"
      ? { providerShell: record.attributes.providerShell }
      : {}),
    ...(record.attributes.browserRequired === true ? { browserRequired: true } : {}),
    ...(hint.blockerType ? { blockerType: hint.blockerType } : {}),
    ...(hint.constraint ? { constraint: hint.constraint } : {})
  };

  return {
    provider: record.provider,
    source: record.source,
    error: {
      code: hint.reasonCode === "token_required" || hint.reasonCode === "auth_required"
        ? "auth"
        : "unavailable",
      message: issueSnippet ?? record.title ?? "Fetched reference content was not usable inspiration evidence.",
      retryable: false,
      reasonCode: hint.reasonCode,
      details
    }
  };
};

const normalizeInspiredesignFetchResult = (
  result: ProviderAggregateResult
): ProviderAggregateResult => {
  if (result.records.length === 0) {
    const synthesizedFailures = failureFromInspiredesignFetchError(result);
    return synthesizedFailures.length > 0
      ? {
        ...result,
        failures: synthesizedFailures
      }
      : result;
  }

  const usableRecords: NormalizedRecord[] = [];
  const unusableRecords: Array<{ record: NormalizedRecord; hint: ProviderIssueHint }> = [];

  for (const record of result.records) {
    const hint = readProviderIssueHintFromRecord(record);
    if (hint) {
      unusableRecords.push({ record, hint });
      continue;
    }
    usableRecords.push(record);
  }

  if (unusableRecords.length === 0) {
    return result;
  }

  if (usableRecords.length > 0) {
    return {
      ...result,
      records: usableRecords
    };
  }

  const topUnusableRecord = unusableRecords
    .slice()
    .sort((left, right) => scoreInspiredesignIssueHint(right.hint) - scoreInspiredesignIssueHint(left.hint))[0];
  const hasPrimaryIssue = Boolean(summarizePrimaryProviderIssue(result.failures));
  const synthesizedFailure = !hasPrimaryIssue && topUnusableRecord
    ? toInspiredesignIssueFailure(topUnusableRecord.record, topUnusableRecord.hint)
    : undefined;

  return {
    ...result,
    ok: false,
    records: [],
    failures: synthesizedFailure ? [...result.failures, synthesizedFailure] : result.failures,
    ...(result.error ? {} : synthesizedFailure ? { error: synthesizedFailure.error } : {})
  };
};

const summarizeInspiredesignFetchFailure = (result: ProviderAggregateResult): string | undefined => {
  return summarizePrimaryProviderIssue(result.failures)?.summary
    ?? result.error?.message;
};

const excerptFromInspiredesignRecord = (record: NormalizedRecord | undefined): string | undefined => {
  const content = normalizePlainText(record?.content);
  if (!content) return undefined;
  return toSnippet(content, 240);
};

const captureSnippet = (
  value: string | undefined,
  maxLength: number
): string | undefined => {
  const content = normalizePlainText(value);
  if (!content) return undefined;
  return toSnippet(content, maxLength);
};

const titleFromInspiredesignCapture = (
  capture: InspiredesignCaptureEvidence | null | undefined
): string | undefined => {
  return captureSnippet(capture?.title, 120)
    ?? captureSnippet(capture?.snapshot?.content, 120)
    ?? captureSnippet(capture?.dom?.outerHTML, 120)
    ?? captureSnippet(capture?.clone?.componentPreview, 120)
    ?? captureSnippet(capture?.clone?.cssPreview, 120);
};

const excerptFromInspiredesignCapture = (
  capture: InspiredesignCaptureEvidence | null | undefined
): string | undefined => {
  return captureSnippet(capture?.snapshot?.content, 240)
    ?? captureSnippet(capture?.dom?.outerHTML, 240)
    ?? captureSnippet(capture?.clone?.componentPreview, 240)
    ?? captureSnippet(capture?.clone?.cssPreview, 240);
};

const isInspiredesignFetchRecovered = (
  reference: InspiredesignReferenceEvidence
): boolean => {
  return reference.fetchStatus === "failed"
    && reference.captureStatus === "captured"
    && hasInspiredesignUsableReferenceEvidence(reference);
};

type InspiredesignRecoveredFetchTelemetry = {
  url: string;
  fetchFailure?: string;
};

const summarizeInspiredesignRecoveredFetches = (
  references: InspiredesignReferenceEvidence[]
): InspiredesignRecoveredFetchTelemetry[] => references
  .filter(isInspiredesignFetchRecovered)
  .map((reference) => ({
    url: reference.url,
    ...(reference.fetchFailure ? { fetchFailure: reference.fetchFailure } : {})
  }));

const buildInspiredesignReference = (
  url: string,
  result: ProviderAggregateResult,
  capture: InspiredesignCaptureOutcome
): InspiredesignReferenceEvidence => {
  const primary = getInspiredesignPrimaryRecord(result, url);
  const baseCapture = normalizeInspiredesignCaptureEvidence(capture.capture);
  const runtimeVisual = capture.capture?.visual as InspiredesignVisualEvidenceRuntimeMetadata | undefined;
  const captureWithRuntimeVisual = runtimeVisual?.tempPath
    ? mergeCaptureVisualEvidence(baseCapture, runtimeVisual)
    : baseCapture;
  const runtimeMotion = capture.capture?.motion as InspiredesignMotionEvidenceRuntimeMetadata | undefined;
	const captureWithRuntimeMotion = runtimeMotion?.outputDir
    ? mergeCaptureMotionEvidence(captureWithRuntimeVisual, runtimeMotion)
    : captureWithRuntimeVisual;
	const runtimePinMedia = capture.capture?.pinMedia as InspiredesignPinterestPinMediaRuntimeMetadata | undefined;
	const normalizedCapture = runtimePinMedia?.tempPath
	? mergeCapturePinMediaEvidence(captureWithRuntimeMotion, runtimePinMedia)
	: captureWithRuntimeMotion;
  const title = normalizePlainText(primary?.title) || titleFromInspiredesignCapture(normalizedCapture);
  const excerpt = excerptFromInspiredesignRecord(primary)
    ?? excerptFromInspiredesignCapture(normalizedCapture);
  const fetchStatus: InspiredesignReferenceEvidence["fetchStatus"] = result.records.length > 0 ? "captured" : "failed";
  return {
    id: getInspiredesignReferenceId(url),
    url,
    ...(title ? { title } : {}),
    ...(excerpt ? { excerpt } : {}),
    fetchStatus,
    captureStatus: capture.captureStatus,
    ...(fetchStatus === "failed" && summarizeInspiredesignFetchFailure(result)
      ? { fetchFailure: summarizeInspiredesignFetchFailure(result) }
      : {}),
    ...(capture.captureFailure ? { captureFailure: capture.captureFailure } : {}),
    ...(normalizedCapture ? { capture: normalizedCapture } : {})
  };
};

const failReferenceForRequiredVisualEvidence = (
  reference: InspiredesignReferenceEvidence,
  failure: string,
  visualEvidence: InspiredesignVisualEvidenceMode,
  shouldFail = true
): InspiredesignReferenceEvidence => {
  if (visualEvidence !== "required" || !shouldFail) return reference;
  return {
    ...reference,
    captureStatus: "failed",
    captureFailure: reference.captureFailure ?? failure
  };
};

const isPolicySkippedVisualEvidence = (
  visual: InspiredesignVisualEvidenceRuntimeMetadata | InspiredesignPersistedVisualEvidence
): boolean => visual.status === "skipped" && visual.warnings.some((warning) => warning.startsWith("policy:"));

const finalizeInspiredesignReferenceVisual = async (
  reference: InspiredesignReferenceEvidence,
  visualEvidence: InspiredesignVisualEvidenceMode
): Promise<{ reference: InspiredesignReferenceEvidence; file?: ArtifactFile }> => {
  const visual = reference.capture?.visual;
  if (!visual) {
    if (visualEvidence !== "required") return { reference };
    if (reference.captureStatus === "off") return { reference };
    const missingVisual = buildMissingRequiredVisualEvidence(REQUIRED_VISUAL_EVIDENCE_MISSING_FAILURE);
    const referenceWithMissingVisual = {
      ...reference,
      capture: mergeCaptureVisualEvidence(reference.capture, missingVisual)
    };
    return {
      reference: failReferenceForRequiredVisualEvidence(
        referenceWithMissingVisual,
        REQUIRED_VISUAL_EVIDENCE_MISSING_FAILURE,
        visualEvidence,
        !hasWorkflowPrimaryMotionDesignEvidence(referenceWithMissingVisual)
          && !hasWorkflowPrimaryPinMediaDesignEvidence(referenceWithMissingVisual)
      )
    };
  }
  const runtimeVisual = visual as InspiredesignVisualEvidenceRuntimeMetadata;
  if (visual.status !== "captured" || !runtimeVisual.tempPath) {
    const persisted = persistInspiredesignVisualEvidence(visual);
    const initialReferenceWithPersistedVisual = {
      ...reference,
      capture: mergeCaptureVisualEvidence(reference.capture, persisted)
    };
    const shouldFail = shouldFailRequiredVisualEvidence(initialReferenceWithPersistedVisual, persisted);
    const forceRequiredWarning = hasWorkflowPinMediaFinalizationFailure(initialReferenceWithPersistedVisual);
    const referenceWithPersistedVisual = shouldFail
      ? {
        ...initialReferenceWithPersistedVisual,
        capture: addRequiredVisualEvidenceFailure(
          initialReferenceWithPersistedVisual.capture,
          undefined,
          REQUIRED_VISUAL_EVIDENCE_MISSING_FAILURE,
          forceRequiredWarning
        )
      }
      : initialReferenceWithPersistedVisual;
    return {
      reference: failReferenceForRequiredVisualEvidence(
        referenceWithPersistedVisual,
        persisted.failure ?? REQUIRED_VISUAL_EVIDENCE_MISSING_FAILURE,
        visualEvidence,
        shouldFail
      )
    };
  }
  const artifactPath = buildVisualEvidenceArtifactPath(reference.id, visual.kind);
  try {
    const buffer = await readFile(runtimeVisual.tempPath);
    if (buffer.byteLength === 0) {
      throw new Error("Visual evidence screenshot file was empty.");
    }
    const persisted = persistInspiredesignVisualEvidence(visual, {
      artifactPath,
      sha256: hashVisualEvidenceBuffer(buffer),
      bytes: buffer.byteLength
    });
    return {
      reference: {
        ...reference,
        capture: mergeCaptureVisualEvidence(reference.capture, persisted)
      },
      file: {
        path: artifactPath,
        content: buffer
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message.trim() : "";
    const failure = errorMessage === "Visual evidence screenshot file was empty."
      ? errorMessage
      : "Visual evidence screenshot file was unavailable.";
    const persisted = persistInspiredesignVisualEvidence({
      ...visual,
      status: "failed",
      warnings: [...readRuntimeVisualWarnings(runtimeVisual), "finalize_failed"],
      failure
    });
    const initialReferenceWithPersistedVisual = {
      ...reference,
      capture: mergeCaptureVisualEvidence(reference.capture, persisted)
    };
    const shouldFail = shouldFailRequiredVisualEvidence(initialReferenceWithPersistedVisual, persisted);
    const forceRequiredWarning = hasWorkflowPinMediaFinalizationFailure(initialReferenceWithPersistedVisual);
    const referenceWithPersistedVisual = shouldFail
      ? {
        ...initialReferenceWithPersistedVisual,
        capture: addRequiredVisualEvidenceFailure(
          initialReferenceWithPersistedVisual.capture,
          undefined,
          failure,
          forceRequiredWarning
        )
      }
      : initialReferenceWithPersistedVisual;
    return {
      reference: failReferenceForRequiredVisualEvidence(
        referenceWithPersistedVisual,
        failure,
        visualEvidence,
        shouldFail
      )
    };
  }
};

const finalizeInspiredesignVisualArtifacts = async (
  references: InspiredesignReferenceEvidence[],
  visualEvidence: InspiredesignVisualEvidenceMode
): Promise<InspiredesignVisualArtifactCollation> => {
  const finalized = await Promise.all(
    references.map((reference) => finalizeInspiredesignReferenceVisual(reference, visualEvidence))
  );
  return {
    references: finalized.map((entry) => entry.reference),
    files: finalized.map((entry) => entry.file).filter((file): file is ArtifactFile => Boolean(file))
  };
};

const PIN_MEDIA_RUNTIME_OPEN_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
const PIN_MEDIA_RUNTIME_MAX_BYTES = 20_000_000;
const PIN_MEDIA_RUNTIME_READ_CHUNK_BYTES = 65_536;
const PIN_MEDIA_RUNTIME_TOO_LARGE_REASON = "pin_media_temp_file_too_large";
const PIN_MEDIA_ANALYSIS_TEMP_FILE_MODE = 0o600;
const PIN_MEDIA_ANALYSIS_TEMP_OPEN_FLAGS = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW;

export type PinMediaRuntimeReadableFile = {
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null
  ) => Promise<{ bytesRead: number; buffer: Buffer }>;
};

const assertPinMediaRuntimeFileSize = (size: number): void => {
  if (size > PIN_MEDIA_RUNTIME_MAX_BYTES) {
    throw new Error(PIN_MEDIA_RUNTIME_TOO_LARGE_REASON);
  }
};

const trustedPinMediaTempPath = async (
	pinMediaTempRoot: string | undefined,
  referenceId: string,
  tempPath: string | undefined
): Promise<string | undefined> => {
	if (!tempPath || !pinMediaTempRoot) return undefined;
	const expectedPath = buildPinMediaTempCapturePath(pinMediaTempRoot, referenceId);
  const absolutePath = resolve(tempPath);
	if (absolutePath !== expectedPath || !isPathInsideRoot(pinMediaTempRoot, absolutePath)) return undefined;
	return await hasTrustedPinMediaTempParent(pinMediaTempRoot, absolutePath)
    ? absolutePath
    : undefined;
};

const hasTrustedPinMediaTempParent = async (
  pinMediaTempRoot: string,
  absolutePath: string
): Promise<boolean> => {
  const [currentRoot, currentParent] = await Promise.all([
    realpath(pinMediaTempRoot).catch(() => undefined),
    realpath(dirname(absolutePath)).catch(() => undefined)
  ]);
  return currentRoot === pinMediaTempRoot && currentParent === pinMediaTempRoot;
};

const buildPinMediaTempCapturePath = (
  pinMediaTempRoot: string,
  referenceId: string
): string => {
  const safeReferenceId = sanitizeInspiredesignPinterestPinMediaReferenceId(referenceId);
  const absolutePath = resolve(pinMediaTempRoot, `${safeReferenceId}-pin-media`);
  if (!isPathInsideRoot(pinMediaTempRoot, absolutePath)) {
    throw new Error("Pinterest pin media temp path escaped the workflow temp root.");
  }
  return absolutePath;
};

const createPinMediaAnalysisTempDir = async (
  pinMediaTempRoot: string,
  referenceId: string
): Promise<string> => {
  const safeReferenceId = sanitizeInspiredesignPinterestPinMediaReferenceId(referenceId);
  const tempDirPrefix = resolve(pinMediaTempRoot, `${safeReferenceId}-media-analysis-`);
  if (!isPathInsideRoot(pinMediaTempRoot, tempDirPrefix)) {
    throw new Error("Pinterest pin media analysis temp path escaped the workflow temp root.");
  }
	const tempDir = await mkdtemp(tempDirPrefix);
  const absoluteTempDir = resolve(tempDir);
  if (!isPathInsideRoot(pinMediaTempRoot, absoluteTempDir)) {
    throw new Error("Pinterest pin media analysis temp path escaped the workflow temp root.");
  }
  const [tempRoot, parent, tempDirStat] = await Promise.all([
    realpath(pinMediaTempRoot).catch(() => undefined),
    realpath(dirname(absoluteTempDir)).catch(() => undefined),
    lstat(absoluteTempDir)
  ]);
  if (tempRoot !== pinMediaTempRoot || parent !== pinMediaTempRoot || !tempDirStat.isDirectory()) {
    throw new Error("Pinterest pin media analysis temp path parent was not trusted.");
  }
  return absoluteTempDir;
};

export const readBoundedPinMediaRuntimeFile = async (file: PinMediaRuntimeReadableFile): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const remainingBytes = PIN_MEDIA_RUNTIME_MAX_BYTES + 1 - totalBytes;
    const readLength = Math.min(PIN_MEDIA_RUNTIME_READ_CHUNK_BYTES, remainingBytes);
    const chunk = Buffer.allocUnsafe(readLength);
    const { bytesRead } = await file.read(chunk, 0, readLength, null);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > PIN_MEDIA_RUNTIME_MAX_BYTES) {
      throw new Error(PIN_MEDIA_RUNTIME_TOO_LARGE_REASON);
    }
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, totalBytes);
};

const readTrustedPinMediaRuntimeFile = async (
  pinMediaTempRoot: string,
  absolutePath: string
): Promise<Buffer> => {
  if (!await hasTrustedPinMediaTempParent(pinMediaTempRoot, absolutePath)) {
    throw new Error("Pinterest pin media temp path parent was not trusted.");
  }
  const before = await lstat(absolutePath);
  if (!before.isFile()) throw new Error("Pinterest pin media temp path was not a file.");
  assertPinMediaRuntimeFileSize(before.size);
  const file = await open(absolutePath, PIN_MEDIA_RUNTIME_OPEN_FLAGS);
  try {
    const opened = await file.stat();
    if (!sameRuntimeFileIdentity(before, opened)) {
      throw new Error("Pinterest pin media temp file identity changed before read.");
    }
    if (!await hasTrustedPinMediaTempParent(pinMediaTempRoot, absolutePath)) {
      throw new Error("Pinterest pin media temp path parent changed before read.");
    }
    const currentPathStat = await lstat(absolutePath);
    if (!sameRuntimeFileIdentity(opened, currentPathStat)) {
      throw new Error("Pinterest pin media temp file path changed before read.");
    }
    assertPinMediaRuntimeFileSize(opened.size);
    const buffer = await readBoundedPinMediaRuntimeFile(file);
    const after = await file.stat();
    if (!sameRuntimeFileIdentity(opened, after)) {
      throw new Error("Pinterest pin media temp file identity changed after read.");
    }
    const finalPathStat = await lstat(absolutePath);
    if (!sameRuntimeFileIdentity(after, finalPathStat)) {
      throw new Error("Pinterest pin media temp file path changed after read.");
    }
    if (!await hasTrustedPinMediaTempParent(pinMediaTempRoot, absolutePath)) {
      throw new Error("Pinterest pin media temp path parent changed after read.");
    }
    assertPinMediaRuntimeFileSize(after.size);
    return buffer;
  } finally {
    await file.close();
  }
};

const failReferencePinMediaFinalization = (
	reference: InspiredesignReferenceEvidence,
	pinMedia: InspiredesignPinterestPinMediaRuntimeMetadata | InspiredesignPersistedPinterestPinMediaEvidence,
	failure: string,
	reason: string
): InspiredesignReferenceEvidence => {
	const persisted = persistInspiredesignPinterestPinMediaEvidence({
	...pinMedia,
	status: "failed",
	warnings: [...pinMedia.warnings, reason],
	failure,
	rejectionReasons: [...pinMedia.rejectionReasons, reason]
	});
	return {
	...reference,
	capture: mergeCapturePinMediaEvidence(reference.capture, persisted)
	};
};

const finalizeInspiredesignReferencePinMedia = async (
	reference: InspiredesignReferenceEvidence,
	pinMediaTempRoot: string | undefined
): Promise<{ reference: InspiredesignReferenceEvidence; file?: ArtifactFile }> => {
	const pinMedia = reference.capture?.pinMedia;
	if (!pinMedia) return { reference };
	const runtimePinMedia = pinMedia as InspiredesignPinterestPinMediaRuntimeMetadata;
	if (pinMedia.status !== "captured") {
	return {
		reference: {
		...reference,
		capture: mergeCapturePinMediaEvidence(
			reference.capture,
			persistInspiredesignPinterestPinMediaEvidence(pinMedia)
		)
		}
	};
	}
	if (!runtimePinMedia.tempPath) {
	return {
		reference: failReferencePinMediaFinalization(
		reference,
		runtimePinMedia,
		"Pinterest pin media temp path was not provided by the capture runtime.",
		"pin_media_temp_path_missing"
		)
	};
	}
		const trustedTempPath = await trustedPinMediaTempPath(pinMediaTempRoot, reference.id, runtimePinMedia.tempPath);
		if (!pinMediaTempRoot || !trustedTempPath) {
	return {
		reference: failReferencePinMediaFinalization(
		reference,
		runtimePinMedia,
		"Pinterest pin media temp path did not match the workflow capture plan.",
		"pin_media_temp_path_mismatch"
		)
	};
	}
	try {
	const buffer = await readTrustedPinMediaRuntimeFile(pinMediaTempRoot, trustedTempPath);
	const byteInspection = inspectPinterestPinMediaBuffer(buffer);
	if (!byteInspection.contentType) {
		return {
			reference: failReferencePinMediaFinalization(
			reference,
			runtimePinMedia,
			"Pinterest pin media bytes did not match a supported media format.",
			byteInspection.reasons[0] ?? "unsupported_byte_signature"
			)
		};
	}
	const artifactPath = buildPinterestPinMediaEvidenceArtifactPath(
	reference.id,
	runtimePinMedia.kind,
	extensionForPinterestPinMediaContentType(byteInspection.contentType)
	);
	const byteBackedPinMedia = {
		...runtimePinMedia,
		...(byteInspection.width ? { width: byteInspection.width } : {}),
		...(byteInspection.height ? { height: byteInspection.height } : {})
	};
	const persisted = persistInspiredesignPinterestPinMediaEvidence(byteBackedPinMedia, {
		artifactPath,
		buffer
	});
	const verification = verifyPinterestPinMediaPersistedBytes(persisted, buffer);
	const verified = verification.ok
		? persisted
		: persistInspiredesignPinterestPinMediaEvidence({
		...persisted,
		rejectionReasons: [...persisted.rejectionReasons, ...verification.reasons]
		}, {
		artifactPath,
		sha256: verification.sha256,
		bytes: verification.bytes
		});
	const file = verified.authority === "design_evidence" && verified.rejectionReasons.length === 0
		? { path: artifactPath, content: buffer }
		: undefined;
	return {
		reference: {
		...reference,
		capture: mergeCapturePinMediaEvidence(reference.capture, verified)
		},
		...(file ? { file } : {})
	};
	} catch (error) {
	const tempFileTooLarge = error instanceof Error && error.message === PIN_MEDIA_RUNTIME_TOO_LARGE_REASON;
	return {
		reference: failReferencePinMediaFinalization(
		reference,
		runtimePinMedia,
		tempFileTooLarge
			? `Pinterest pin media temp file exceeded ${PIN_MEDIA_RUNTIME_MAX_BYTES} bytes.`
			: "Pinterest pin media temp file was unavailable.",
		tempFileTooLarge ? PIN_MEDIA_RUNTIME_TOO_LARGE_REASON : "pin_media_temp_file_unavailable"
		)
	};
	}
};

const finalizeInspiredesignPinMediaArtifacts = async (
	references: InspiredesignReferenceEvidence[],
	pinMediaTempRoot: string | undefined
): Promise<InspiredesignPinMediaArtifactCollation> => {
	const finalized = await Promise.all(references.map((reference) => (
	finalizeInspiredesignReferencePinMedia(reference, pinMediaTempRoot)
	)));
	return {
	references: finalized.map((entry) => entry.reference),
	files: finalized.map((entry) => entry.file).filter((file): file is ArtifactFile => Boolean(file))
	};
};

const mediaAnalysisKindFromPinMedia = (
	pinMedia: Pick<InspiredesignPersistedPinterestPinMediaEvidence, "kind" | "contentType">
): InspiredesignMediaKind => {
	if (pinMedia.contentType === "image/gif") return "gif";
	return pinMedia.kind;
};

const pinMediaAnalysisHash = (buffer: Buffer): string => createHash("sha256").update(buffer).digest("hex");

const findScheduledPinMediaArtifact = (
	filesByPath: ReadonlyMap<string, ArtifactFile>,
	path: string | undefined
): ArtifactFile | undefined => {
	if (!path) return undefined;
	const file = filesByPath.get(path);
	return file && Buffer.isBuffer(file.content) ? file : undefined;
};

type PinMediaAnalysisSourceFile = {
	filePath: string;
	tempDir: string;
};

const cleanupPinMediaAnalysisTempDirs = async (tempDirs: readonly string[]): Promise<void> => {
	await Promise.all(tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true }).catch(() => undefined)));
};

const assertPinMediaAnalysisTempWriteDeadline = (timeoutMs: number | undefined): void => {
	if (typeof timeoutMs === "number" && timeoutMs <= 1) {
		throw new Error("Pinterest pin media analysis temp write deadline was exhausted.");
	}
};

const writePinMediaAnalysisSourceFile = async (
	pinMediaTempRoot: string,
	referenceId: string,
	buffer: Buffer,
	timeoutMs: number | undefined
): Promise<PinMediaAnalysisSourceFile> => {
	assertPinMediaAnalysisTempWriteDeadline(timeoutMs);
	let tempDir: string | undefined;
	let file: FileHandle | undefined;
	try {
		tempDir = await createPinMediaAnalysisTempDir(pinMediaTempRoot, referenceId);
		assertPinMediaAnalysisTempWriteDeadline(timeoutMs);
		const filePath = resolve(tempDir, "source-media");
		if (!isPathInsideRoot(pinMediaTempRoot, filePath)) {
			throw new Error("Pinterest pin media analysis temp path escaped the workflow temp root.");
		}
		assertPinMediaAnalysisTempWriteDeadline(timeoutMs);
		file = await open(filePath, PIN_MEDIA_ANALYSIS_TEMP_OPEN_FLAGS, PIN_MEDIA_ANALYSIS_TEMP_FILE_MODE);
		assertPinMediaAnalysisTempWriteDeadline(timeoutMs);
		await file.writeFile(buffer);
		return { filePath, tempDir };
	} catch (error) {
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
		}
		throw error;
	} finally {
		await file?.close().catch(() => undefined);
	}
};

const buildTrustedInspiredesignMediaAnalysisInputs = async (args: {
	references: InspiredesignReferenceEvidence[];
	pinMediaFiles: readonly ArtifactFile[];
	pinMediaTempRoot: string | undefined;
	stagedTempDirs: string[];
	remainingTimeoutMs: () => number | undefined;
}): Promise<InspiredesignMediaAnalysisInput[]> => {
	if (!args.pinMediaTempRoot) return [];
	const filesByPath = new Map(args.pinMediaFiles.map((file) => [file.path, file]));
	const inputs: InspiredesignMediaAnalysisInput[] = [];
	for (const reference of args.references) {
		const pinMedia = reference.capture?.pinMedia;
		if (pinMedia?.status !== "captured") continue;
		const persisted = persistInspiredesignPinterestPinMediaEvidence(pinMedia);
		if (persisted.authority !== "design_evidence") continue;
		if (persisted.referenceId !== reference.id) continue;
		const mediaPath = persisted.path;
		if (!mediaPath) continue;
		const scheduledFile = findScheduledPinMediaArtifact(filesByPath, mediaPath);
		if (!scheduledFile || !Buffer.isBuffer(scheduledFile.content)) continue;
		if (persisted.bytes !== scheduledFile.content.length) continue;
		if (persisted.sha256 !== pinMediaAnalysisHash(scheduledFile.content)) continue;
		const sourceFile = await writePinMediaAnalysisSourceFile(
			args.pinMediaTempRoot,
			reference.id,
			scheduledFile.content,
			args.remainingTimeoutMs()
		);
		args.stagedTempDirs.push(sourceFile.tempDir);
		inputs.push({
			referenceId: reference.id,
			mediaPath,
			filePath: sourceFile.filePath,
			sourceUrl: persisted.sourceUrl,
			mediaUrl: persisted.mediaUrl,
			kind: mediaAnalysisKindFromPinMedia(persisted),
			contentType: persisted.contentType,
			bytes: persisted.bytes,
			hash: persisted.sha256,
			width: persisted.width,
			height: persisted.height,
			authority: "design_evidence",
			scheduledForBundle: true
		});
	}
	return inputs;
};

const buildDiagnosticInspiredesignMediaAnalysis = (): InspiredesignMediaAnalysis => ({
	version: INSPIREDESIGN_MEDIA_ANALYSIS_VERSION,
	generatedAt: INSPIREDESIGN_MEDIA_ANALYSIS_DETERMINISTIC_GENERATED_AT,
	nonGoals: INSPIREDESIGN_MEDIA_ANALYSIS_NON_GOALS,
	references: []
});

const hasExplicitInspiredesignMediaAnalysisConfig = (
	config: InspiredesignMediaAnalysisBinaryPathsConfig | undefined
): boolean => Boolean(config?.ffmpegPath || config?.ffprobePath);

const shouldResolveInspiredesignMediaAnalysisBinaries = (
	options: InspiredesignWorkflowOptions
): boolean => Boolean(
	options.resolveMediaAnalysisBinaries
	|| !options.analyzeMediaArtifacts
	|| hasExplicitInspiredesignMediaAnalysisConfig(options.mediaAnalysisConfig)
);

const buildInspiredesignMediaAnalyzerBinaryOptions = (
	binaries: InspiredesignMediaAnalysisBinaryResolution | undefined
): Pick<
	InspiredesignMediaAnalyzerOptions,
	"ffmpegBinaryPath" | "ffprobeBinaryPath" | "ffmpegUnavailableLimitation" | "ffprobeUnavailableLimitation"
> => ({
	...(binaries?.ffmpeg.available && binaries.ffmpeg.resolvedPath ? { ffmpegBinaryPath: binaries.ffmpeg.resolvedPath } : {}),
	...(binaries?.ffprobe.available && binaries.ffprobe.resolvedPath ? { ffprobeBinaryPath: binaries.ffprobe.resolvedPath } : {}),
	...(!binaries?.ffmpeg.available && binaries?.ffmpeg.limitation ? { ffmpegUnavailableLimitation: binaries.ffmpeg.limitation } : {}),
	...(!binaries?.ffprobe.available && binaries?.ffprobe.limitation ? { ffprobeUnavailableLimitation: binaries.ffprobe.limitation } : {})
});

const resolveInspiredesignMediaAnalyzerBinaryOptions = async (
  options: InspiredesignWorkflowOptions,
  timeoutMs: number | undefined
): Promise<Partial<InspiredesignMediaAnalyzerOptions>> => {
  if (!shouldResolveInspiredesignMediaAnalysisBinaries(options)) return {};
  const probeTimeoutMs = typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(timeoutMs, INSPIREDESIGN_MEDIA_ANALYSIS_BINARY_PROBE_TIMEOUT_MS))
    : INSPIREDESIGN_MEDIA_ANALYSIS_BINARY_PROBE_TIMEOUT_MS;
  const binaries = await (options.resolveMediaAnalysisBinaries
    ? options.resolveMediaAnalysisBinaries({ timeoutMs: probeTimeoutMs })
    : resolveInspiredesignMediaAnalysisBinaries({
      config: options.mediaAnalysisConfig,
      timeoutMs: probeTimeoutMs
    }));
  return buildInspiredesignMediaAnalyzerBinaryOptions(binaries);
};

const mediaAnalysisFailureMessage = (error: unknown): string => (
	error instanceof Error ? error.message : "Media analysis failed."
);

type SavedMediaMotionNotice = {
  kind: "saved_media_motion_without_browser_replay";
  sampledMotionCount: number;
  mediaPaths: string[];
  message: string;
};

const buildSavedMediaMotionNotice = (args: {
  mediaAnalysis: InspiredesignMediaAnalysis;
  motionEvidence: readonly InspiredesignMotionEvidenceJson[];
}): SavedMediaMotionNotice | undefined => {
  const sampledReferences = args.mediaAnalysis.references.filter((reference) => (
    reference.claimLevels.includes("motion_sampled")
  ));
  if (sampledReferences.length === 0) return undefined;
  const browserReplayCount = args.motionEvidence.filter((entry) => (
    entry.motion.kind === "screencast" && entry.motion.authority === "design_evidence"
  )).length;
  if (browserReplayCount > 0) return undefined;
  const mediaPaths = sampledReferences.map((reference) => reference.mediaPath).sort();
  return {
    kind: "saved_media_motion_without_browser_replay",
    sampledMotionCount: sampledReferences.length,
    mediaPaths,
    message: "Saved GIF or video media was sampled in media-analysis.json, but no authoritative browser replay screencast was captured in motion-evidence.json."
  };
};

type VisualEvidenceAfterPinMediaStatus = "captured" | "failed" | "skipped";

type VisualEvidenceAfterPinMediaReference = {
  referenceId: string;
  url: string;
  status: VisualEvidenceAfterPinMediaStatus;
  reason: "screenshot_captured_after_pin_media" | "screenshot_failed_after_pin_media" | "screenshot_not_attempted_after_pin_media";
  pinMediaPath: string;
  screenshotPath?: string;
  failure?: string;
  warnings: string[];
};

type VisualEvidenceAfterPinMediaNotice = {
  status: VisualEvidenceAfterPinMediaStatus;
  authority: "pin_media_ready";
  message: string;
  references: VisualEvidenceAfterPinMediaReference[];
};

type StillImageMotionCaptureNotice = {
  status: "not_applicable";
  reason: "still_image_pin_media";
  authority: "motion_evidence_browser_replay_only";
  message: string;
  references: Array<{
    referenceId: string;
    url: string;
    status: "not_applicable";
    reason: "still_image_pin_media";
    pinMediaPath: string;
  }>;
};

const pinMediaIndexByReferenceId = (
  pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[]
): Map<string, InspiredesignPinterestPinMediaIndexEntry> => new Map(
  pinMediaIndex.map((entry) => [entry.referenceId, entry])
);

const screenshotIndexByReferenceId = (
  screenshotIndex: readonly InspiredesignScreenshotIndexEntry[]
): Map<string, InspiredesignScreenshotIndexEntry> => new Map(
  screenshotIndex.map((entry) => [entry.referenceId, entry])
);

const motionReferenceIds = (
  motionEvidence: readonly InspiredesignMotionEvidenceJson[]
): Set<string> => new Set(motionEvidence.map((entry) => entry.referenceId));

const visualAfterPinMediaReference = (
  reference: InspiredesignReferenceEvidence,
  pinMedia: InspiredesignPinterestPinMediaIndexEntry,
  screenshot: InspiredesignScreenshotIndexEntry | undefined
): VisualEvidenceAfterPinMediaReference => {
  const visual = normalizeInspiredesignCaptureEvidence(reference.capture)?.visual;
  if (screenshot) {
    return {
      referenceId: reference.id,
      url: reference.url,
      status: "captured",
      reason: "screenshot_captured_after_pin_media",
      pinMediaPath: pinMedia.path,
      screenshotPath: screenshot.path,
      warnings: screenshot.warnings
    };
  }
  const failed = visual?.status === "failed";
  return {
    referenceId: reference.id,
    url: reference.url,
    status: failed ? "failed" : "skipped",
    reason: failed ? "screenshot_failed_after_pin_media" : "screenshot_not_attempted_after_pin_media",
    pinMediaPath: pinMedia.path,
    ...(visual?.failure ? { failure: visual.failure } : {}),
    warnings: visual?.warnings ?? []
  };
};

const aggregateVisualAfterPinMediaStatus = (
  references: readonly VisualEvidenceAfterPinMediaReference[]
): VisualEvidenceAfterPinMediaStatus => {
  if (references.some((reference) => reference.status === "failed")) return "failed";
  if (references.every((reference) => reference.status === "captured")) return "captured";
  return "skipped";
};

const buildVisualEvidenceAfterPinMediaNotice = (args: {
  references: readonly InspiredesignReferenceEvidence[];
  pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[];
  screenshotIndex: readonly InspiredesignScreenshotIndexEntry[];
}): VisualEvidenceAfterPinMediaNotice | undefined => {
  const pinMediaByReference = pinMediaIndexByReferenceId(args.pinMediaIndex);
  const screenshotByReference = screenshotIndexByReferenceId(args.screenshotIndex);
  const references = args.references.flatMap((reference) => {
    const pinMedia = pinMediaByReference.get(reference.id);
    return pinMedia ? [visualAfterPinMediaReference(reference, pinMedia, screenshotByReference.get(reference.id))] : [];
  });
  if (references.length === 0) return undefined;
  return {
    status: aggregateVisualAfterPinMediaStatus(references),
    authority: "pin_media_ready",
    message: "Pinterest pin-media bytes remain the readiness authority; screenshot evidence is an additional non-blocking visual lane.",
    references
  };
};

const buildStillImageMotionCaptureNotice = (args: {
  pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[];
  motionEvidence: readonly InspiredesignMotionEvidenceJson[];
}): StillImageMotionCaptureNotice | undefined => {
  const motionIds = motionReferenceIds(args.motionEvidence);
  const references = args.pinMediaIndex.flatMap((pinMedia) => (
    pinMedia.kind === "image" && !motionIds.has(pinMedia.referenceId)
      ? [{
        referenceId: pinMedia.referenceId,
        url: pinMedia.sourceUrl,
        status: "not_applicable" as const,
        reason: "still_image_pin_media" as const,
        pinMediaPath: pinMedia.path
      }]
      : []
  ));
  if (references.length === 0) return undefined;
  return {
    status: "not_applicable",
    reason: "still_image_pin_media",
    authority: "motion_evidence_browser_replay_only",
    message: "Still Pinterest image pin media does not imply browser motion; motion-evidence.json remains the only browser replay authority.",
    references
  };
};


type InspiredesignMotionRuntimeFileCollection = {
  files: ArtifactFile[];
  valid: boolean;
  failure?: string;
};

const MOTION_RUNTIME_ARTIFACT_PATH_PATTERN = /^(?:replay\.json|replay\.html|preview\.png|frames\/[A-Za-z0-9._-]+\.png)$/;
const MOTION_RUNTIME_MAX_FRAME_FILES = 3;
const MOTION_RUNTIME_MAX_TOTAL_BYTES = 20_000_000;
const MOTION_RUNTIME_MAX_DIRECTORY_ENTRIES = 128;
const MOTION_RUNTIME_MAX_DIRECTORY_DEPTH = 1;
const MOTION_RUNTIME_OPEN_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;

const isPathInsideRoot = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
};

const sameRuntimeFileIdentity = (
  before: { dev: number; ino: number; size: number },
  after: { dev: number; ino: number; size: number }
): boolean => before.dev === after.dev && before.ino === after.ino && before.size === after.size;

const readMotionRuntimeFile = async (
  absolutePath: string,
  expectedStat: { dev: number; ino: number; size: number }
): Promise<Buffer | undefined> => {
  let handle: FileHandle | undefined;
  try {
    handle = await open(absolutePath, MOTION_RUNTIME_OPEN_FLAGS);
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || !sameRuntimeFileIdentity(expectedStat, openedStat)) return undefined;
    return await handle.readFile();
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

type MotionRuntimeWalkState = {
  files: ArtifactFile[];
  frameFileCount: number;
  totalBytes: number;
  entryCount: number;
  reviewArtifactRelativePaths: Set<string>;
};

type MotionRuntimeReviewArtifactRelativePath = "replay.json" | "replay.html" | "preview.png";

const MOTION_RUNTIME_REVIEW_ARTIFACT_RELATIVE_PATHS = new Set<MotionRuntimeReviewArtifactRelativePath>([
  "replay.json",
  "replay.html",
  "preview.png"
]);

const isMotionRuntimeReviewArtifactPath = (
  relativePath: string
): relativePath is MotionRuntimeReviewArtifactRelativePath => (
  MOTION_RUNTIME_REVIEW_ARTIFACT_RELATIVE_PATHS.has(relativePath as MotionRuntimeReviewArtifactRelativePath)
);

const readMotionRuntimeTempPath = (
  file: InspiredesignMotionEvidenceRuntimeMetadata["replay"] | InspiredesignPersistedMotionEvidence["replay"] | undefined
): string | undefined => (
  file && "tempPath" in file && typeof file.tempPath === "string" ? file.tempPath : undefined
);

const motionRuntimeRelativeTempPath = (
  root: string,
  file: InspiredesignMotionEvidenceRuntimeMetadata["replay"] | InspiredesignPersistedMotionEvidence["replay"] | undefined,
  expectedRelativePath: MotionRuntimeReviewArtifactRelativePath
): MotionRuntimeReviewArtifactRelativePath | undefined => {
  const tempPath = readMotionRuntimeTempPath(file);
  if (!tempPath) return undefined;
  const absolutePath = resolve(tempPath);
  if (!isPathInsideRoot(root, absolutePath)) return undefined;
  const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
  return relativePath === expectedRelativePath ? expectedRelativePath : undefined;
};

const collectMotionRuntimeReviewArtifactPaths = (
  root: string,
  motion: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence
): Set<string> => new Set([
  motionRuntimeRelativeTempPath(root, motion.replay, "replay.json"),
  motionRuntimeRelativeTempPath(root, motion.replayHtml, "replay.html"),
  motionRuntimeRelativeTempPath(root, motion.preview, "preview.png")
].filter((relativePath): relativePath is MotionRuntimeReviewArtifactRelativePath => Boolean(relativePath)));

const addMotionRuntimeFile = async (
  referenceId: string,
  root: string,
  absolutePath: string,
  relativePath: string,
  state: MotionRuntimeWalkState
): Promise<string | undefined> => {
  if (!MOTION_RUNTIME_ARTIFACT_PATH_PATTERN.test(relativePath)) return undefined;
  if (!isPathInsideRoot(root, absolutePath)) return undefined;
  if (isMotionRuntimeReviewArtifactPath(relativePath) && !state.reviewArtifactRelativePaths.has(relativePath)) {
    return undefined;
  }
  const entryStat = await lstat(absolutePath).catch(() => null);
  if (!entryStat?.isFile() || entryStat.isSymbolicLink()) return undefined;
  if (relativePath.startsWith("frames/")) {
    state.frameFileCount += 1;
    if (state.frameFileCount > MOTION_RUNTIME_MAX_FRAME_FILES) {
      return "Motion evidence artifact finalization exceeded the frame file limit.";
    }
  }
  state.totalBytes += entryStat.size;
  if (state.totalBytes > MOTION_RUNTIME_MAX_TOTAL_BYTES) {
    return "Motion evidence artifact finalization exceeded the byte limit.";
  }
  const content = await readMotionRuntimeFile(absolutePath, entryStat);
  if (!content) return "Motion evidence artifact finalization encountered an unstable runtime file.";
  state.totalBytes = state.totalBytes - entryStat.size + content.byteLength;
  if (state.totalBytes > MOTION_RUNTIME_MAX_TOTAL_BYTES) {
    return "Motion evidence artifact finalization exceeded the byte limit.";
  }
  state.files.push({
    path: buildMotionEvidenceArtifactPath(referenceId, relativePath),
    content
  });
  return undefined;
};

const walkMotionRuntimeDirectory = async (
  referenceId: string,
  root: string,
  directory: string,
  depth: number,
  state: MotionRuntimeWalkState
): Promise<string | undefined> => {
  if (depth > MOTION_RUNTIME_MAX_DIRECTORY_DEPTH) {
    return "Motion evidence artifact finalization exceeded the directory depth limit.";
  }
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null);
  if (!entries) return "Motion evidence artifact finalization could not inspect the output directory.";
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of sortedEntries) {
    state.entryCount += 1;
    if (state.entryCount > MOTION_RUNTIME_MAX_DIRECTORY_ENTRIES) {
      return "Motion evidence artifact finalization exceeded the directory entry limit.";
    }
    const absolutePath = resolve(directory, entry.name);
    if (!isPathInsideRoot(root, absolutePath) || entry.isSymbolicLink()) continue;
    const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (relativePath === "frames") {
        const failure = await walkMotionRuntimeDirectory(referenceId, root, absolutePath, depth + 1, state);
        if (failure) return failure;
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const failure = await addMotionRuntimeFile(referenceId, root, absolutePath, relativePath, state);
    if (failure) return failure;
  }
  return undefined;
};

const collectMotionEvidenceRuntimeFiles = async (
  referenceId: string,
  outputDir: string | undefined,
  expectedOutputDir: string | undefined,
  motion: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence
): Promise<InspiredesignMotionRuntimeFileCollection> => {
  if (!outputDir) return { files: [], valid: true };
  if (!expectedOutputDir) {
    return { files: [], valid: false, failure: "Motion evidence output directory was not planned by the workflow." };
  }
  const root = resolve(outputDir);
  const expectedRoot = resolve(expectedOutputDir);
  if (root !== expectedRoot) {
    return { files: [], valid: false, failure: "Motion evidence output directory did not match the workflow capture plan." };
  }
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    return { files: [], valid: false, failure: "Motion evidence output directory was unavailable." };
  }
  const state: MotionRuntimeWalkState = {
    files: [],
    frameFileCount: 0,
    totalBytes: 0,
    entryCount: 0,
    reviewArtifactRelativePaths: collectMotionRuntimeReviewArtifactPaths(root, motion)
  };
  const failure = await walkMotionRuntimeDirectory(referenceId, root, root, 0, state);
  return failure
    ? { files: [], valid: false, failure }
    : { files: state.files, valid: true };
};

const findMotionArtifactPath = (
  files: ArtifactFile[],
  referenceId: string,
  fileName: "replay.json" | "replay.html" | "preview.png"
): string | undefined => files.find((file) => file.path === buildMotionEvidenceArtifactPath(referenceId, fileName))?.path;

const findMotionArtifactFile = (
  files: ArtifactFile[],
  referenceId: string,
  relativePath: "replay.json" | "preview.png"
): ArtifactFile | undefined => files.find((file) => file.path === buildMotionEvidenceArtifactPath(referenceId, relativePath));

const motionArtifactContentBuffer = (file: ArtifactFile | undefined): Buffer | undefined => {
  if (!file) return undefined;
  if (Buffer.isBuffer(file.content)) return file.content;
  if (typeof file.content === "string") return Buffer.from(file.content);
  return undefined;
};

const hasMotionReviewArtifactFile = (
  files: ArtifactFile[],
  referenceId: string,
  relativePath: "replay.json" | "preview.png",
  minBytes: number
): boolean => (
  (motionArtifactContentBuffer(findMotionArtifactFile(files, referenceId, relativePath))?.byteLength ?? 0) >= minBytes
);

const hasCollectedMotionDesignEvidenceFiles = (files: ArtifactFile[], referenceId: string): boolean => (
  hasMotionReviewArtifactFile(files, referenceId, "replay.json", MIN_MOTION_REPLAY_BYTES)
  && hasMotionReviewArtifactFile(files, referenceId, "preview.png", MIN_MOTION_PREVIEW_BYTES)
);

const hashMotionArtifactBuffer = (buffer: Buffer): string => createHash("sha256").update(buffer).digest("hex");

const hasWorkflowNonMotionCaptureEvidence = (
  capture: InspiredesignCaptureEvidence | null | undefined
): boolean => {
  if (hasInspiredesignCaptureArtifacts(capture)) return true;
  const visualCapture = capture as { visual?: { status?: string } } | null | undefined;
  return visualCapture?.visual?.status === "captured";
};

const failReferenceMotionFinalization = (
  reference: InspiredesignReferenceEvidence,
  motion: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence,
  failure: string,
  diagnosticReason: string
): InspiredesignReferenceEvidence => {
  const persistedFailure = persistInspiredesignMotionEvidence({
    ...motion,
    status: "failed",
    frameCount: 0,
    warnings: [...motion.warnings, diagnosticReason],
    failure,
    diagnostic: true,
    diagnosticReasons: [...motion.diagnosticReasons, diagnosticReason]
  });
  const capture = mergeCaptureMotionEvidence(reference.capture, persistedFailure);
  return hasWorkflowNonMotionCaptureEvidence(reference.capture)
    ? {
      ...reference,
      capture
    }
    : {
      ...reference,
      captureStatus: "failed",
      captureFailure: reference.captureFailure ?? failure,
      capture
    };
};

const finalizeInspiredesignReferenceMotion = async (
  reference: InspiredesignReferenceEvidence,
  motionEvidenceTempDir: string | undefined
): Promise<{ reference: InspiredesignReferenceEvidence; files: ArtifactFile[] }> => {
  const motion = reference.capture?.motion;
  if (!motion) return { reference, files: [] };
  const runtimeMotion = motion as InspiredesignMotionEvidenceRuntimeMetadata;
  const expectedOutputDir = motionEvidenceTempDir ? join(motionEvidenceTempDir, reference.id) : undefined;
  const collection = await collectMotionEvidenceRuntimeFiles(reference.id, runtimeMotion.outputDir, expectedOutputDir, motion);
  if (!collection.valid) {
    return {
      reference: failReferenceMotionFinalization(
        reference,
        motion,
        collection.failure ?? "Motion evidence artifact finalization failed.",
        "motion_artifact_finalization_failed"
      ),
      files: []
    };
  }
  const files = collection.files;
  if (motion.status === "captured" && motion.diagnostic !== true && motion.frameCount > 0 && !hasCollectedMotionDesignEvidenceFiles(files, reference.id)) {
    return {
      reference: failReferenceMotionFinalization(
        reference,
        motion,
        "Motion evidence artifacts were not available for design review.",
        "motion_artifacts_missing"
      ),
      files
    };
  }
  const replayFile = findMotionArtifactFile(files, reference.id, "replay.json");
  const previewFile = findMotionArtifactFile(files, reference.id, "preview.png");
  const replayBuffer = motionArtifactContentBuffer(replayFile);
  const previewBuffer = motionArtifactContentBuffer(previewFile);
  const persisted = persistInspiredesignMotionEvidence(motion, {
    replayPath: findMotionArtifactPath(files, reference.id, "replay.json"),
    replayHtmlPath: findMotionArtifactPath(files, reference.id, "replay.html"),
    previewPath: findMotionArtifactPath(files, reference.id, "preview.png"),
    replaySha256: replayBuffer ? hashMotionArtifactBuffer(replayBuffer) : undefined,
    replayBytes: replayBuffer?.byteLength,
    previewSha256: previewBuffer ? hashMotionArtifactBuffer(previewBuffer) : undefined,
    previewBytes: previewBuffer?.byteLength
  });
  const referenceWithPersistedMotion = {
    ...reference,
    capture: mergeCaptureMotionEvidence(reference.capture, persisted)
  };
  if (hasWorkflowPrimaryMotionDesignEvidence(referenceWithPersistedMotion)) {
    const { captureFailure: _captureFailure, ...referenceWithoutCaptureFailure } = referenceWithPersistedMotion;
    return {
      reference: {
        ...referenceWithoutCaptureFailure,
        captureStatus: "captured"
      },
      files
    };
  }
  return { reference: referenceWithPersistedMotion, files };
};

const finalizeInspiredesignMotionArtifacts = async (
  references: InspiredesignReferenceEvidence[],
  motionEvidenceTempDir: string | undefined
): Promise<InspiredesignMotionArtifactCollation> => {
  const finalized = await Promise.all(references.map((reference) => (
    finalizeInspiredesignReferenceMotion(reference, motionEvidenceTempDir)
  )));
  return {
    references: finalized.map((entry) => entry.reference),
    files: finalized.flatMap((entry) => entry.files)
  };
};

const buildInspiredesignVisualCapturePlan = (
  url: string,
  workflowInput: InspiredesignResolvedInput,
  result: ProviderAggregateResult,
  visualEvidenceTempDir: string | undefined
): InspiredesignVisualCapturePlan => {
  const referenceId = getInspiredesignReferenceId(url);
  const policy = decideInspiredesignVisualCapturePolicy({
    visualEvidence: workflowInput.visualEvidence,
    failures: result.failures,
    topLevelError: result.error,
    cookiePolicy: workflowInput.cookiePolicyOverride,
    hasUsableRecords: result.records.length > 0
  });
  if (policy.status !== "allowed" || !visualEvidenceTempDir) {
    return { policy, referenceId };
  }
  return {
    policy,
    referenceId,
    tempPath: join(visualEvidenceTempDir, `${referenceId}-viewport.png`)
  };
};

const summarizeInspiredesignCaptureConstraint = (
  references: InspiredesignReferenceEvidence[]
): { summary: string; guidance: ProviderNextStepGuidance } | undefined => {
  const failedReferences = references.filter((reference) => reference.captureStatus === "failed");
  if (failedReferences.length === 0) {
    return undefined;
  }
  const unavailableOnly = failedReferences.every((reference) => reference.captureFailure === INSPIREDESIGN_CAPTURE_UNAVAILABLE_FAILURE);
  const summary = unavailableOnly
    ? `Deep capture was unavailable for ${failedReferences.length} ${failedReferences.length === 1 ? "reference" : "references"} in this execution lane.`
    : `Deep capture failed for ${failedReferences.length} ${failedReferences.length === 1 ? "reference" : "references"}.`;
  const retryUrls = failedReferences
    .slice(0, 2)
    .map((reference) => `Retry deep capture for ${reference.url} after restoring the required browser session state.`);
  return {
    summary,
    guidance: {
      reason: summary,
      recommendedNextCommands: unavailableOnly
        ? [
          "Restore browser capture access for this execution lane, then rerun inspiredesign.",
          ...retryUrls
        ]
        : [
          "Rerun inspiredesign after configuring providers.cookieSource for the protected references you need to capture.",
          ...retryUrls
        ]
    }
  };
};

const summarizeInspiredesignFetchConstraint = (
  references: InspiredesignReferenceEvidence[]
): string | undefined => {
  return references.find((reference) => (
    reference.fetchStatus === "failed"
    && !isInspiredesignFetchRecovered(reference)
    && typeof reference.fetchFailure === "string"
    && reference.fetchFailure.trim().length > 0
  ))?.fetchFailure;
};

const hasSurvivingInspiredesignReference = (references: InspiredesignReferenceEvidence[]): boolean => (
  references.some((reference) => reference.fetchStatus === "captured" || reference.captureStatus === "captured")
);

const INSPIREDESIGN_HARD_DISCOVERY_REASON_CODES = new Set<ProviderReasonCode>([
  "auth_required",
  "challenge_detected",
  "policy_blocked",
  "rate_limited",
  "token_required"
]);

const readInspiredesignFailureReasonCode = (failure: ProviderFailureEntry): ProviderReasonCode | undefined => {
  const reasonCode = failure.error.reasonCode ?? failure.error.details?.reasonCode;
  return typeof reasonCode === "string" && INSPIREDESIGN_HARD_DISCOVERY_REASON_CODES.has(reasonCode as ProviderReasonCode)
    ? reasonCode as ProviderReasonCode
    : undefined;
};

const hardInspiredesignDiscoveryReasonCodes = (discovery: InspiredesignDiscoveryDiagnostics): ProviderReasonCode[] => {
  const reasonCodes = discovery.failures
    .map(readInspiredesignFailureReasonCode)
    .filter((reasonCode): reasonCode is ProviderReasonCode => reasonCode !== undefined);
  return [...new Set(reasonCodes)];
};

const hardInspiredesignMetaReasonCodes = (meta: Record<string, unknown>): ProviderReasonCode[] => {
  const distribution = meta.reasonCodeDistribution;
  if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) return [];
  return Object.keys(distribution)
    .filter((reasonCode): reasonCode is ProviderReasonCode => (
      INSPIREDESIGN_HARD_DISCOVERY_REASON_CODES.has(reasonCode as ProviderReasonCode)
    ));
};

const hardInspiredesignGuidanceReasonCodes = (
  discovery: InspiredesignDiscoveryDiagnostics,
  meta: Record<string, unknown>
): ProviderReasonCode[] => [
  ...new Set([
    ...hardInspiredesignDiscoveryReasonCodes(discovery),
    ...hardInspiredesignMetaReasonCodes(meta)
  ])
];

const selectInspiredesignPrimaryConstraintFailures = (
  failures: ProviderFailureEntry[],
  references: InspiredesignReferenceEvidence[],
  discovery: InspiredesignDiscoveryDiagnostics
): ProviderFailureEntry[] => {
  if (!hasSurvivingInspiredesignReference(references)) return failures;
  if (discovery.failures.length === 0) return failures;
  return failures.slice(discovery.failures.length);
};

const readMetaPrimaryConstraint = (
  meta: Record<string, unknown>
): InspiredesignGuidanceSource["primaryConstraint"] => {
  const value = meta.primaryConstraint;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const primaryConstraint = {
    ...(typeof record.reasonCode === "string" ? { reasonCode: record.reasonCode } : {}),
    ...(typeof record.summary === "string" ? { summary: record.summary } : {})
  };
  return Object.keys(primaryConstraint).length > 0 ? primaryConstraint : undefined;
};

const isInspiredesignReferenceEvidenceRequired = (workflowInput: InspiredesignResolvedInput): boolean => (
  workflowInput.harvest === true
  || workflowInput.urls.length > 0
  || workflowInput.providers.length > 0
  || typeof workflowInput.query === "string"
  || workflowInput.visualEvidence === "required"
);

const buildInspiredesignReferenceUrlProvenance = (
	workflowInput: InspiredesignResolvedInput,
	discovery: InspiredesignDiscoveryDiagnostics,
	referencePatternBoard: InspiredesignReferencePatternBoard,
	requestedUrls: readonly string[]
): NonNullable<InspiredesignGuidanceSource["urlProvenance"]> => {
	const requested = new Set(requestedUrls.map(canonicalizeUrl));
	const discovered = new Set(discovery.acceptedUrls.map(canonicalizeUrl));
	const ready = new Set(referencePatternBoard.references.map((reference) => canonicalizeUrl(reference.url)));
	const rejected = new Set(referencePatternBoard.rejectedReferences.map((reference) => canonicalizeUrl(reference.url)));
	const captureFailed = new Set(referencePatternBoard.rejectedReferences
	.filter((reference) => reference.captureStatus === "failed")
	.map((reference) => canonicalizeUrl(reference.url)));
	const weak = new Set(referencePatternBoard.references
	.filter((reference) => !isInspiredesignReadyReference(reference))
	.map((reference) => canonicalizeUrl(reference.url)));
	const shellDerived = new Set(referencePatternBoard.rejectedReferences
	.filter((reference) => (reference.diagnosticReasons ?? []).some((reason) => reason.includes("shell") || reason.includes("chrome")))
	.map((reference) => canonicalizeUrl(reference.url)));
	const urls = [...new Set([
	...workflowInput.urls,
	...discovery.acceptedUrls,
	...referencePatternBoard.references.map((reference) => reference.url),
	...referencePatternBoard.rejectedReferences.map((reference) => reference.url)
	])];
	return urls.map((url) => {
	const canonicalUrl = canonicalizeUrl(url);
	const sources = [
		...(requested.has(canonicalUrl) ? ["user_supplied"] : []),
		...(discovered.has(canonicalUrl) ? ["discovered"] : []),
		...(shellDerived.has(canonicalUrl) ? ["shell_derived"] : [])
	];
	const outcomes = [
		...(ready.has(canonicalUrl) ? ["ready"] : []),
		...(rejected.has(canonicalUrl) ? ["rejected"] : []),
		...(weak.has(canonicalUrl) ? ["weak"] : []),
		...(captureFailed.has(canonicalUrl) ? ["capture_failed"] : [])
	];
	return {
		url,
		sources: sources.length > 0 ? sources : ["unknown"],
		outcomes: outcomes.length > 0 ? outcomes : ["unknown"]
	};
	});
};

const buildInspiredesignGuidanceSource = (
  workflowInput: InspiredesignResolvedInput,
  discovery: InspiredesignDiscoveryDiagnostics,
  meta: Record<string, unknown>,
  referencePatternBoard: InspiredesignReferencePatternBoard,
  requestedUrls: readonly string[],
  authorityCounts?: {
    authoritativeReferenceCount: number;
    snapshotReadyReferenceCount: number;
    motionReadyReferenceCount: number;
    pinMediaReadyReferenceCount: number;
  }
): InspiredesignGuidanceSource => {
  const quality = summarizeInspiredesignReferenceQuality(referencePatternBoard);
  const primaryConstraint = readMetaPrimaryConstraint(meta);
  return {
    brief: workflowInput.brief,
    ...(workflowInput.query ? { query: workflowInput.query } : {}),
    urls: workflowInput.urls,
    requestedProviders: workflowInput.providers,
    ...(workflowInput.browserMode ? { browserMode: workflowInput.browserMode } : {}),
    ...(workflowInput.cookiePolicyOverride ? { cookiePolicy: workflowInput.cookiePolicyOverride } : {}),
    ...(typeof workflowInput.useCookies === "boolean" ? { useCookies: workflowInput.useCookies } : {}),
    discovery: {
      requested: discovery.requested,
      acceptedUrls: discovery.acceptedUrls,
      failures: discovery.failures.length,
      ...(discovery.failure ? { failure: discovery.failure } : {}),
      hardFailureReasonCodes: hardInspiredesignGuidanceReasonCodes(discovery, meta)
    },
    metrics: {
      referenceCount: quality.rankedReferenceCount + quality.rejectedReferenceCount,
      referenceEvidenceRequired: isInspiredesignReferenceEvidenceRequired(workflowInput),
      failedCaptureCount: quality.failedCaptureCount,
      visualEvidenceRequired: workflowInput.visualEvidence === "required"
    },
    quality: {
      rankedReferenceCount: quality.rankedReferenceCount,
      rankedReferenceUrls: referencePatternBoard.references.map((reference) => reference.url),
      ...authorityCounts,
      rejectedReferenceCount: quality.rejectedReferenceCount,
      missingScreenshotCount: quality.missingScreenshotCount,
		allAttemptFailedCaptureCount: quality.allAttemptFailedCaptureCount,
		allAttemptMissingScreenshotCount: quality.allAttemptMissingScreenshotCount,
		allAttemptVisualFailureCount: quality.allAttemptVisualFailureCount,
		allAttemptMotionFailureCount: quality.allAttemptMotionFailureCount,
      diagnosticOnlyReasons: quality.diagnosticOnlyReasons,
      ...(typeof quality.topReferenceScore === "number" ? { topReferenceScore: quality.topReferenceScore } : {}),
      ...(typeof quality.topReferenceConfidence === "number" ? { topReferenceConfidence: quality.topReferenceConfidence } : {}),
      ...(typeof quality.topReferenceIntentMatched === "boolean"
        ? { topReferenceIntentMatched: quality.topReferenceIntentMatched }
        : {})
    },
	urlProvenance: buildInspiredesignReferenceUrlProvenance(workflowInput, discovery, referencePatternBoard, requestedUrls),
    ...(primaryConstraint ? { primaryConstraint } : {})
  };
};

const resolveInspiredesignPrimaryCaptureStrategyForReferences = (
  workflowInput: InspiredesignResolvedInput,
  references: InspiredesignReferenceEvidence[]
): ReturnType<typeof resolvePinterestPrimaryCaptureStrategy> => {
  const hasMotionEvidence = references.some((reference) => Boolean(reference.capture?.motion));
  if (hasMotionEvidence) {
    return workflowInput.captureMode === "deep" ? "motion_first_with_deep_diagnostics" : "motion_first";
  }
  const hasVisualOnlyPinterestEvidence = references.some((reference) => (
	reference.capture?.visual?.status === "captured"
	&& reference.capture.visual.pinterestPageQuality === "pin_media"
  ));
  if (hasVisualOnlyPinterestEvidence) {
    return workflowInput.captureMode === "deep" ? "visual_first_with_deep_diagnostics" : "visual_first";
  }
  return resolvePinterestPrimaryCaptureStrategy(workflowInput.urls, workflowInput.captureMode);
};

const buildInspiredesignMeta = (
  runtime: ReferenceRetrievalPort,
  workflowInput: InspiredesignResolvedInput,
  references: InspiredesignReferenceEvidence[],
  failures: ProviderFailureEntry[],
  followthrough: InspiredesignFollowthrough,
  discovery: InspiredesignDiscoveryDiagnostics
): Record<string, unknown> => {
  const failedCaptures = references.filter((reference) => reference.captureStatus === "failed");
  const captureAttemptReport = summarizeInspiredesignCaptureAttempts(references);
  const recoveredFetches = summarizeInspiredesignRecoveredFetches(references);
  const hasSurvivingReference = hasSurvivingInspiredesignReference(references);
  const primaryConstraintFailures = selectInspiredesignPrimaryConstraintFailures(failures, references, discovery);
  let reasonCodeDistribution = summarizeReasonCodeDistribution(failures);
  const primaryCaptureStrategy = resolveInspiredesignPrimaryCaptureStrategyForReferences(workflowInput, references);
  let meta = withCamelCasePrimaryConstraintMeta(withReasonCodeDistributionMeta({
    selection: {
      urls: workflowInput.urls,
      ...(workflowInput.query ? { query: workflowInput.query } : {}),
      ...(workflowInput.providers.length > 0 ? { providers: workflowInput.providers } : {}),
      ...(workflowInput.referenceLimit !== undefined
        ? { max_references: workflowInput.referenceLimit }
        : {}),
      ...(workflowInput.visualEvidence !== "off" ? { visual_evidence: workflowInput.visualEvidence } : {}),
      capture_mode: workflowInput.captureMode,
      ...(primaryCaptureStrategy !== "capture_off" && primaryCaptureStrategy !== "deep_diagnostics"
        ? { primary_capture_strategy: primaryCaptureStrategy }
        : {}),
      ...(workflowInput.browserMode ? { requested_browser_mode: workflowInput.browserMode } : {}),
      include_prototype_guidance: Boolean(workflowInput.includePrototypeGuidance)
    },
    metrics: {
      reference_count: references.length,
      fetched_references: references.filter((reference) => reference.fetchStatus === "captured").length,
      captured_references: references.filter((reference) => reference.captureStatus === "captured").length,
      failed_fetches: references.filter((reference) => (
        reference.fetchStatus === "failed" && !isInspiredesignFetchRecovered(reference)
      )).length,
      failed_captures: failedCaptures.length,
      ...(recoveredFetches.length > 0
        ? {
          recovered_fetches: recoveredFetches.length,
          recovered_fetch_details: recoveredFetches
        }
        : {}),
      ...(captureAttemptReport ? { capture_attempts: captureAttemptReport.counts } : {})
    },
    alerts: buildWorkflowAlerts(runtime, failures)
  }, reasonCodeDistribution), primaryConstraintFailures);
  if (!meta.primaryConstraint) {
    const fetchConstraint = summarizeInspiredesignFetchConstraint(references);
    if (fetchConstraint) {
      meta = {
        ...meta,
        primaryConstraintSummary: fetchConstraint
      };
    }
  }
  if (!hasSurvivingReference && !meta.primaryConstraint && !meta.primaryConstraintSummary) {
    const discoveryConstraint = summarizeInspiredesignDiscoveryConstraint(discovery);
    if (discoveryConstraint) {
      meta = withPrimaryConstraintSummaryOverride(
        meta,
        discoveryConstraint.summary,
        discoveryConstraint.guidance
      );
    }
  }
  if (!meta.primaryConstraint && !meta.primaryConstraintSummary) {
    const captureConstraint = summarizeInspiredesignCaptureConstraint(references);
    if (captureConstraint) {
      reasonCodeDistribution = incrementReasonCodeDistribution(
        reasonCodeDistribution,
        "env_limited",
        failedCaptures.length
      );
      meta = withReasonCodeDistributionMeta(meta, reasonCodeDistribution);
      meta = withPrimaryConstraintSummaryOverride(meta, captureConstraint.summary, captureConstraint.guidance);
    }
  }
  return {
    ...meta,
    followthroughSummary: followthrough.summary,
    ...(captureAttemptReport
      ? {
        captureAttemptSummary: captureAttemptReport.summary,
        captureAttemptReport: {
          worked: captureAttemptReport.worked,
          didNotWork: captureAttemptReport.didNotWork
        }
      }
      : {}),
    recommendedSkills: followthrough.recommendedSkills,
    deepCaptureRecommendation: followthrough.deepCaptureRecommendation,
    discovery: sanitizeInspiredesignDiscoveryForMeta(discovery),
    contractScope: followthrough.contractScope
  };
};

const buildInspiredesignDiscoveryGuidance = (
  discovery: InspiredesignDiscoveryDiagnostics
): ProviderNextStepGuidance => ({
  reason: discovery.failure ?? "Reference discovery did not produce usable design references.",
  recommendedNextCommands: [
    "Rerun inspiredesign harvest with explicit --url references from usable inspiration pages.",
    "Retry provider discovery in a lane with provider search support and any required authenticated browser session."
  ]
});

const summarizeInspiredesignDiscoveryConstraint = (
  discovery: InspiredesignDiscoveryDiagnostics
): { summary: string; guidance: ProviderNextStepGuidance } | undefined => {
  if (!discovery.requested || discovery.acceptedUrls.length > 0) return undefined;
  const queryDetail = discovery.query ? ` for query "${discovery.query}"` : "";
  const summary = discovery.failure
    ?? `Reference discovery returned no usable references${queryDetail}.`;
  return {
    summary,
    guidance: buildInspiredesignDiscoveryGuidance(discovery)
  };
};

const discoveryString = (value: JsonValue | undefined): string | undefined => (
  typeof value === "string" && value.trim().length > 0 ? value : undefined
);

const discoveryNumber = (value: JsonValue | undefined): number | undefined => (
  typeof value === "number" && Number.isFinite(value) ? value : undefined
);

const discoveryStringArray = (value: JsonValue | undefined): string[] => (
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
);

const sanitizeDiscoveryFailures = (failures: readonly ProviderFailureEntry[]): JsonValue => failures.map((failure) => {
  const message = captureSnippet(failure.error.message, 220);
  return {
    provider: failure.provider,
    source: failure.source,
    reasonCode: detectFailureReasonCode(failure) ?? "env_limited",
    retryable: failure.error.retryable === true,
    ...(message ? { message } : {})
  };
});

const sanitizeDiscoveryRejectedCandidate = (
  candidate: InspiredesignDiscoveryResult["rejected"][number]
): InspiredesignRejectedDiscoveryDiagnostic => {
  const safeRawUrl = candidate.rawUrl ? sanitizeRejectedInspiredesignDiscoveryUrl(candidate.rawUrl) : undefined;
  return {
    status: "rejected",
    reason: candidate.reason,
    source: candidate.source,
    provider: candidate.provider,
    rank: candidate.rank,
    ...(safeRawUrl ? { rawUrl: safeRawUrl } : {})
  };
};

const sanitizeDiscoveryRejected = (
  rejected: InspiredesignDiscoveryDiagnostics["rejected"]
): JsonValue => rejected.map((candidate) => {
  const safeCandidate = sanitizeDiscoveryRejectedCandidate(candidate);
  return {
    reason: safeCandidate.reason,
    provider: safeCandidate.provider,
    source: safeCandidate.source,
    rank: safeCandidate.rank,
    ...(safeCandidate.rawUrl ? { url: safeCandidate.rawUrl } : {})
  };
});

const sanitizeInspiredesignDiscoveryForMeta = (
  discovery: InspiredesignDiscoveryDiagnostics
): InspiredesignDiscoveryDiagnosticsMeta => ({
  ...discovery,
  rejected: discovery.rejected.map(sanitizeDiscoveryRejectedCandidate)
});

const buildPersistedInspiredesignDiscoveryDiagnostics = (
  discovery: InspiredesignDiscoveryDiagnostics
): Record<string, JsonValue> => {
  const browserNative = discovery.browserNativeDiagnostics ?? {};
  return {
    requested: discovery.requested,
    searchAvailable: discovery.searchAvailable,
    providers: discovery.providers,
    acceptedUrls: discovery.acceptedUrls,
	acceptedUrlCount: discovery.acceptedUrls.length,
	rejectedUrlCount: discovery.rejected.length,
	failureCount: discovery.failures.length,
    failures: sanitizeDiscoveryFailures(discovery.failures),
    rejected: sanitizeDiscoveryRejected(discovery.rejected),
    ...(discovery.query ? { query: discovery.query } : {}),
    ...(discovery.siteRecipeId ? { siteRecipeId: discovery.siteRecipeId } : {}),
    ...(discovery.acceptedReferences ? { acceptedReferences: discovery.acceptedReferences as unknown as JsonValue } : {}),
    ...(discovery.failure ? { failure: captureSnippet(discovery.failure, 220) } : {}),
    ...(discoveryString(browserNative.searchUrl) ? { searchUrl: discoveryString(browserNative.searchUrl) } : {}),
    ...(discoveryNumber(browserNative.fetchedRecordCount) !== undefined ? { fetchedRecordCount: discoveryNumber(browserNative.fetchedRecordCount) } : {}),
    ...(discoveryString(browserNative.reason) ? { reason: discoveryString(browserNative.reason) } : {}),
    ...(discoveryString(browserNative.sourcePageQuality) ? { sourcePageQuality: discoveryString(browserNative.sourcePageQuality) } : {}),
    ...(discoveryString(browserNative.badStateId) ? { badStateId: discoveryString(browserNative.badStateId) } : {}),
    ...(discoveryString(browserNative.recoveryAction) ? { recoveryAction: discoveryString(browserNative.recoveryAction) } : {}),
    ...(discoveryStringArray(browserNative.diagnosticBlockers).length > 0
      ? { diagnosticBlockers: discoveryStringArray(browserNative.diagnosticBlockers) }
      : {})
  };
};

const buildInspiredesignDiscoveryEvidenceSummary = (
  diagnostics: Record<string, JsonValue>
): Record<string, JsonValue> => {
	const requested = typeof diagnostics.requested === "boolean" ? diagnostics.requested : false;
	const acceptedUrls = Array.isArray(diagnostics.acceptedUrls) ? diagnostics.acceptedUrls : [];
	const acceptedUrlCount = discoveryNumber(diagnostics.acceptedUrlCount);
	const rejectedUrlCount = discoveryNumber(diagnostics.rejectedUrlCount);
	const failureCount = discoveryNumber(diagnostics.failureCount);
	const reason = discoveryString(diagnostics.reason);
	const sourcePageQuality = discoveryString(diagnostics.sourcePageQuality);
	const badStateId = discoveryString(diagnostics.badStateId);
	return {
	requested,
	acceptedUrls,
	...(acceptedUrlCount !== undefined ? { acceptedUrlCount } : {}),
	...(rejectedUrlCount !== undefined ? { rejectedUrlCount } : {}),
	...(failureCount !== undefined ? { failureCount } : {}),
	...(reason ? { reason } : {}),
	...(sourcePageQuality ? { sourcePageQuality } : {}),
	...(badStateId ? { badStateId } : {})
	};
};

const buildDiscoveryProvenanceByUrl = (
  discovery: InspiredesignDiscoveryDiagnostics
): Map<string, InspiredesignAcceptedDiscoveryProvenance> => new Map(
  (discovery.acceptedReferences ?? []).map((entry) => [entry.url, entry])
);

const attachInspiredesignDiscoveryProvenance = (
  references: InspiredesignReferenceEvidence[],
  provenanceByUrl: ReadonlyMap<string, InspiredesignAcceptedDiscoveryProvenance>
): InspiredesignReferenceEvidence[] => references.map((reference) => {
  const provenance = provenanceByUrl.get(reference.url);
  if (!provenance) return reference;
  return {
    ...reference,
    discovery: provenance as unknown as Record<string, JsonValue>
  };
});

const buildInspiredesignGuidanceFollowthroughSummary = (
  _followthrough: InspiredesignFollowthrough,
  meta: Record<string, unknown>,
  nextStepGuidance: NextStepGuidance
): string => {
  const primaryConstraintSummary = typeof meta.primaryConstraintSummary === "string"
    ? meta.primaryConstraintSummary.trim()
    : "";
  const fallbackSummary = primaryConstraintSummary
    ? `Primary constraint: ${primaryConstraintSummary} ${nextStepGuidance.primaryAction.summary}`
    : undefined;
  return renderWorkflowCompatibility(nextStepGuidance, fallbackSummary).followthroughSummary;
};

const DISCOVERY_DIAGNOSTICS_ARTIFACT_PATH = "discovery-diagnostics.json";
const PRODUCT_READINESS_BLOCKED_SUMMARY = "Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence.";
const INSPIREDESIGN_PRODUCT_READY_ONLY_ARTIFACTS = new Set<string>([
  INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest,
  INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance
]);

const isPinterestWorkflowReferenceUrl = (value: string): boolean => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "pinterest.com" || hostname.endsWith(".pinterest.com");
  } catch {
    return false;
  }
};

const isPinterestWorkflowProvider = (providerId: string): boolean => (
  providerId === "social/pinterest"
  || providerId === "pinterest"
  || resolveSiteRecipeForProvider(providerId)?.id === "social/pinterest"
);

const isPinterestEvidenceRequiredForWorkflow = (
  workflowInput: InspiredesignResolvedInput,
  discovery: InspiredesignDiscoveryDiagnostics
): boolean => (
  workflowInput.providers.some(isPinterestWorkflowProvider)
  || workflowInput.urls.some(isPinterestWorkflowReferenceUrl)
  || discovery.siteRecipeId === "social/pinterest"
  || discovery.acceptedUrls.some(isPinterestWorkflowReferenceUrl)
);

const inferBrandFromContent = (content: string | undefined, productUrl?: string): string | undefined => {
  const normalized = normalizePlainText(content);
  if (!normalized) return undefined;
  const isEbayProduct = productUrl ? resolveShoppingProviderIdForUrl(productUrl) === "shopping/ebay" : false;
  const bestBuyTitle = inferBestBuyTitleFromContent(normalized);
  const bestBuyBrand = inferBestBuyBrandFromTitle(bestBuyTitle) ?? extractBrandFromTitle(bestBuyTitle);
  if (bestBuyBrand) {
    return bestBuyBrand;
  }
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
  const ebayTitle = inferEbayTitleFromContent(normalized);
  const ebayBrand = inferEbayBrandFromTitle(ebayTitle);
  if (ebayBrand) {
    return ebayBrand;
  }
  if (isEbayProduct) {
    return undefined;
  }
  const brandMatch = /\bBrand\s+([A-Z][A-Za-z0-9&+' -]{1,60}?)(?=\s+(?:About this item|Key item features|Condition|Type|Maximum DPI|Connectivity|Features|Model|MPN|Color|Quantity|Seller|Returns|Shipping|Buy It Now|Item Width|Item Height|Number of Buttons)\b|$)/i.exec(normalized);
  if (brandMatch?.[1]) {
    return brandMatch[1].trim();
  }
  return undefined;
};

const inferBestBuyBrandFromTitle = (title: string | undefined): string | undefined => {
  const cleaned = normalizePlainText(title);
  const match = /^([A-Z][A-Za-z0-9&+' ]{1,40})\s+-\s+/.exec(cleaned);
  return match?.[1]?.trim() || undefined;
};

const inferBestBuyTitleFromContent = (normalized: string): string | undefined => {
  const match = /\bMain Content\s+(.+?)(?=\s+Rating [0-9](?:\.[0-9])? out of 5 stars|\s+Model:|\s+SKU:|\s+Back to top\b)/i.exec(normalized);
  const candidate = normalizePlainText(match?.[1]);
  if (!candidate || candidate.length < 20 || LOOKS_LIKE_URL_RE.test(candidate)) {
    return undefined;
  }
  return candidate;
};

const inferEbayTitleFromContent = (normalized: string): string | undefined => {
  const patterns = [
    /\bExpand Cart Loading\.\.\.\s+(.+?)(?:\s+for sale online\s*\|\s*eBay)?\s+Condition:/i,
    /\bBuy It Now\s+(.+?)\s+Sign in to check out\b/i
  ];
  for (const pattern of patterns) {
    const candidate = stripMarketplaceTitleFraming(normalizePlainText(pattern.exec(normalized)?.[1]), "https://www.ebay.com");
    if (
      candidate
      && candidate.length >= 20
      && candidate.length <= 180
      && !candidate.endsWith("...")
      && !LOOKS_LIKE_URL_RE.test(candidate)
    ) {
      return candidate;
    }
  }
  return undefined;
};

const inferKnownEbayBrandFromTitle = (title: string): string | undefined => {
  const normalized = title.toLowerCase();
  return EBAY_KNOWN_MULTI_TOKEN_BRANDS.find((brand) => {
    const candidate = brand.toLowerCase();
    return normalized === candidate || normalized.startsWith(`${candidate} `);
  });
};

const inferKnownSingleEbayBrandFromTitle = (title: string): string | undefined => {
  const firstToken = /^([A-Za-z][A-Za-z0-9&+']{1,30})(?:\s|$)/.exec(title)?.[1];
  return firstToken ? EBAY_KNOWN_SINGLE_TOKEN_BRANDS.get(firstToken.toLowerCase()) : undefined;
};

const inferEbayBrandFromTitle = (title: string | undefined): string | undefined => {
  const framed = normalizePlainText(title).replace(/\s+[-|]\s+[^-|]+$/i, "").trim();
  const knownBrand = inferKnownEbayBrandFromTitle(framed);
  if (knownBrand) return knownBrand;
  const cleaned = framed.replace(EBAY_TITLE_BRAND_PREFIX_RE, "");
  const prefixedBrand = inferKnownEbayBrandFromTitle(cleaned);
  if (prefixedBrand) return prefixedBrand;
  const singleTokenBrand = inferKnownSingleEbayBrandFromTitle(cleaned);
  if (singleTokenBrand) return singleTokenBrand;
  const exactBrand = /^([A-Z][A-Za-z0-9&+']{1,30})$/.exec(cleaned)?.[1];
  if (exactBrand && EBAY_KNOWN_SINGLE_TOKEN_BRANDS.has(exactBrand.toLowerCase())) {
    return exactBrand;
  }
  const match = /^([A-Z][A-Za-z0-9&+']{1,30})\s+([A-Z0-9][A-Za-z0-9&+'().-]+|AirPods)\b/.exec(cleaned);
  const brand = match?.[1]?.trim();
  if (!brand || EBAY_TITLE_BRAND_STOP_WORDS.has(brand.toLowerCase())) {
    return undefined;
  }
  if (EBAY_KNOWN_SINGLE_TOKEN_BRANDS.has(brand.toLowerCase())) {
    return EBAY_KNOWN_SINGLE_TOKEN_BRANDS.get(brand.toLowerCase());
  }
  if (!/[\d-]/.test(match?.[2] ?? "")) {
    return undefined;
  }
  return brand;
};

const productSpecBoundaryIndex = (normalized: string): number => {
  const boundaryIndexes = [
    normalized.search(/\s+(?=(?:Key item features\b|(?:Brand|Condition|Type|Maximum DPI|Connectivity|Features|Model|MPN|Color|Item Width|Item Height|Number of Buttons)\b\s*:))/i),
    normalized.search(/\s+(?=(?:Brand|Condition|Type|Connectivity|Features|Model|MPN|Color|Item Width|Item Height|Number of Buttons)\s+[A-Z0-9]|\bMaximum DPI\s+\d)/)
  ].filter((index) => index >= 0);
  return boundaryIndexes.length > 0 ? Math.min(...boundaryIndexes) : -1;
};

const inferLabeledTitleFromContent = (normalized: string, productUrl?: string): string | undefined => {
  const boundaryIndex = productSpecBoundaryIndex(normalized);
  if (boundaryIndex <= 0) return undefined;
  const framed = normalizePlainText(normalized.slice(0, boundaryIndex))
    .replace(/^(?:(?:Skip to main content|Main content|Product details|About this item|Key item features)\s+)+/i, "")
    .replace(/^Visit the [A-Z][A-Za-z0-9&+' -]{1,60} Store\s+/i, "")
    .trim();
  const candidate = productUrl ? stripMarketplaceTitleFraming(framed, productUrl) : framed;
  if (
    candidate.length < 3
    || candidate.length > 120
    || /^(?:Key item features|Brand|Condition|Type|Maximum DPI|Connectivity|Features|Model|MPN|Color|Item Width|Item Height|Number of Buttons)\b/i.test(candidate)
    || LOOKS_LIKE_URL_RE.test(candidate)
    || (productUrl ? isMarketplaceTitleChrome(candidate, productUrl) : false)
  ) {
    return undefined;
  }
  return candidate;
};

const inferTitleFromContent = (content: string | undefined, productUrl?: string): string | undefined => {
  const normalized = normalizePlainText(content);
  if (!normalized) return undefined;
  const bestBuyTitle = inferBestBuyTitleFromContent(normalized);
  if (bestBuyTitle) {
    return bestBuyTitle;
  }
  if (productUrl && resolveShoppingProviderIdForUrl(productUrl) === "shopping/ebay") {
    const ebayTitle = inferEbayTitleFromContent(normalized);
    if (ebayTitle) {
      return ebayTitle;
    }
  }
  const labeledTitle = inferLabeledTitleFromContent(normalized, productUrl);
  if (labeledTitle) {
    return labeledTitle;
  }
  const storeMatch = /\bVisit the [A-Z][A-Za-z0-9&+' -]{1,60} Store\s+(.+?)(?=\s+(?:Brand [A-Z]|About this item|Key item features|Current price is|Actual Color|[0-9]+(?:\.[0-9]+)? stars out of|Best seller\b))/i.exec(normalized);
  const candidate = normalizePlainText(storeMatch?.[1]);
  if (!candidate || candidate.length < 20 || LOOKS_LIKE_URL_RE.test(candidate)) {
    return undefined;
  }
  return candidate;
};

const trimProductSpecBoundaryTail = (candidate: string): string => {
  const normalized = normalizePlainText(candidate).replace(/^Brand\s*[:\-]?\s+/i, "");
  const boundaryIndex = productSpecBoundaryIndex(normalized);
  return normalizePlainText(boundaryIndex > 0 ? normalized.slice(0, boundaryIndex) : normalized);
};

const sanitizeProductBrandCandidate = (candidate: string | undefined, productUrl: string): string | undefined => {
  const normalized = trimProductSpecBoundaryTail(candidate ?? "");
  if (!normalized) return undefined;
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
    const hostBrand = normalizePlainText(inferBrandFromUrl(productUrl)).replace(/\.com\b/gi, "").toLowerCase();
    const candidateBrand = normalized.replace(/\.com\b/gi, "").toLowerCase();
    if (host.includes("ebay.") && hostBrand && candidateBrand === hostBrand) {
      return undefined;
    }
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
    cleaned = cleaned.replace(/\s*[-|:]\s*(?:seller\s+listing|seller\s+page|marketplace\s+listing|product\s+listing)\s*$/i, "").trim();
  } catch {
    return cleaned;
  }
  return cleaned;
};

const isMarketplaceTitleChrome = (title: string, productUrl: string): boolean => {
  const cleaned = normalizePlainText(title);
  if (!cleaned) return true;
  try {
    const canonicalHostBrand = normalizePlainText(inferBrandFromUrl(productUrl))
      .replace(/\.com\b/gi, "")
      .trim()
      .toLowerCase();
    const canonicalTitle = cleaned
      .replace(/\.com\b/gi, "")
      .trim()
      .toLowerCase();
    if (canonicalHostBrand && canonicalTitle === canonicalHostBrand) {
      return true;
    }
    const host = new URL(productUrl).hostname.toLowerCase();
    if (host.includes("walmart.")) {
      return WALMART_TITLE_CHROME_RE.test(cleaned);
    }
    if (host.includes("bestbuy.")) {
      return /\$\(csi\.user\.businessName\)|\bSkip to content\b|\bGo to Product Search\b/i.test(cleaned);
    }
    return false;
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

const extractProductBrandFromTitle = (title: string | undefined, productUrl: string): string | undefined => {
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
    if (host.includes("ebay.")) {
      return inferEbayBrandFromTitle(title);
    }
  } catch {
    return extractBrandFromTitle(title);
  }
  return extractBrandFromTitle(title);
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

const MANUAL_MARKETPLACE_PRICE_FOLLOW_UP_PROVIDER_IDS = new Set<string>([
  "shopping/amazon"
]);

const requiresManualMarketplacePriceFollowUp = (productUrl: string): boolean => {
  const providerId = resolveShoppingProviderIdForUrl(productUrl);
  return providerId !== null && MANUAL_MARKETPLACE_PRICE_FOLLOW_UP_PROVIDER_IDS.has(providerId);
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
    inferBrandFromContent(record.content, productUrl),
    rejectRetailerBrand(refreshedBrand),
    rejectRetailerBrand(typeof record.attributes.brand === "string" ? record.attributes.brand : undefined),
    rejectRetailerBrand(typeof record.attributes.site_name === "string" ? record.attributes.site_name : undefined),
    rejectRetailerBrand(providerBrand && providerBrand !== "Others" ? providerBrand : undefined),
    extractProductBrandFromTitle(record.title, productUrl),
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
    inferTitleFromContent(record.content, productUrl),
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

const PRODUCT_VIDEO_SELECTION_CLEAN_SPEC_WEIGHT = 10;
const PRODUCT_VIDEO_SELECTION_REJECTION_PENALTY = 2;
const PRODUCT_VIDEO_SELECTION_TITLE_BONUS = 3;
const PRODUCT_VIDEO_SELECTION_PRICE_BONUS = 2;
const PRODUCT_VIDEO_SELECTION_IMAGE_BONUS = 1;
const PRODUCT_VIDEO_SELECTION_PASS_BONUS = 5;
const PRODUCT_VIDEO_SELECTION_PARTIAL_BONUS = 2;
const PRODUCT_VIDEO_READINESS_CANDIDATE_EXCERPT_CHARS = 180;

type ProductVideoRecordCandidate = {
  record: NormalizedRecord;
  presentation: ProductVideoPresentation;
  imageCount: number;
  summary: ProductVideoCandidateSummary;
  score: number;
};

type ProductVideoRecordSelection = {
  selectedRecord: NormalizedRecord;
  originalPrimaryRecord: NormalizedRecord;
  candidateSummaries: ProductVideoCandidateSummary[];
};

const productVideoPresentationSourceRecord = (record: NormalizedRecord): ProductVideoPresentationSourceRecord => ({
  id: record.id,
  provider: record.provider,
  ...(record.url ? { url: record.url } : {}),
  ...(record.title ? { title: record.title } : {}),
  ...(record.content ? { content: record.content } : {}),
  attributes: record.attributes
});

const buildProductVideoPresentationMetadata = (
  record: NormalizedRecord,
  refreshedMetadata: ExtractedMetadata | null,
  featureCandidates: readonly string[]
): ProductVideoPresentationMetadata => {
  const description = normalizePlainText(refreshedMetadata?.description)
    || normalizePlainText(typeof record.attributes.description === "string" ? record.attributes.description : undefined);
  const features = [...new Set([
    ...(refreshedMetadata?.features ?? []),
    ...featureCandidates
  ].map(normalizePlainText).filter(Boolean))];
  return {
    ...(description ? { description } : {}),
    ...(features.length > 0 ? { features } : {})
  };
};

const productVideoReadinessSelectionBonus = (presentation: ProductVideoPresentation): number => {
  if (presentation.presentationReadiness.status === "pass") return PRODUCT_VIDEO_SELECTION_PASS_BONUS;
  if (presentation.presentationReadiness.status === "partial") return PRODUCT_VIDEO_SELECTION_PARTIAL_BONUS;
  return 0;
};

const productVideoRecordShoppingOffer = (record: NormalizedRecord): Record<string, JsonValue> | undefined => {
  const offer = record.attributes.shopping_offer;
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) return undefined;
  return offer as Record<string, JsonValue>;
};

const productVideoRecordProductId = (record: NormalizedRecord): string | undefined => {
  const productId = productVideoRecordShoppingOffer(record)?.product_id;
  return typeof productId === "string" && productId.trim() ? productId.trim().toLowerCase() : undefined;
};

const productVideoRecordOfferUrlIdentity = (record: NormalizedRecord): string | undefined => {
  const offerUrl = productVideoRecordShoppingOffer(record)?.url;
  return typeof offerUrl === "string" && offerUrl.trim() ? canonicalizeUrl(offerUrl) : undefined;
};

const productVideoRecordUrlIdentities = (record: NormalizedRecord): string[] => (
  [...new Set([
    record.url,
    productVideoRecordShoppingOffer(record)?.url
  ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map(canonicalizeUrl))]
);

const hasProductVideoUrlIdentityMatch = (
  candidate: NormalizedRecord,
  originalPrimaryRecord: NormalizedRecord,
  productUrl: string
): boolean => (
  productVideoRecordUrlIdentities(candidate).some((candidateUrl) => (
    candidateUrl === canonicalizeUrl(productUrl)
    || productVideoRecordUrlIdentities(originalPrimaryRecord).includes(candidateUrl)
  ))
);

const hasProductVideoExplicitIdentityConflict = (
  candidate: NormalizedRecord,
  originalPrimaryRecord: NormalizedRecord,
  productUrl: string
): boolean => {
  const candidateOfferUrl = productVideoRecordOfferUrlIdentity(candidate);
  if (
    candidateOfferUrl
    && candidateOfferUrl !== canonicalizeUrl(productUrl)
    && !productVideoRecordUrlIdentities(originalPrimaryRecord).includes(candidateOfferUrl)
  ) {
    return true;
  }
  const candidateProductId = productVideoRecordProductId(candidate);
  const originalProductId = productVideoRecordProductId(originalPrimaryRecord);
  return Boolean(candidateProductId && originalProductId && candidateProductId !== originalProductId);
};

const canSelectProductVideoRecordCandidate = (
  candidate: NormalizedRecord,
  originalPrimaryRecord: NormalizedRecord,
  productUrl: string
): boolean => {
  if (candidate === originalPrimaryRecord) return true;
  if (hasProductVideoExplicitIdentityConflict(candidate, originalPrimaryRecord, productUrl)) return false;
  if (hasProductVideoUrlIdentityMatch(candidate, originalPrimaryRecord, productUrl)) return true;
  const candidateProductId = productVideoRecordProductId(candidate);
  return Boolean(candidateProductId && candidateProductId === productVideoRecordProductId(originalPrimaryRecord));
};

const scoreProductVideoRecordCandidate = (candidate: ProductVideoRecordCandidate): number => (
  (candidate.presentation.promotedClaims.length * PRODUCT_VIDEO_SELECTION_CLEAN_SPEC_WEIGHT)
  - (candidate.presentation.rejectedCandidates.length * PRODUCT_VIDEO_SELECTION_REJECTION_PENALTY)
  + (normalizePlainText(candidate.record.title) ? PRODUCT_VIDEO_SELECTION_TITLE_BONUS : 0)
  + (hasStructuredShoppingPrice(candidate.record) ? PRODUCT_VIDEO_SELECTION_PRICE_BONUS : 0)
  + (candidate.imageCount > 0 ? PRODUCT_VIDEO_SELECTION_IMAGE_BONUS : 0)
  + productVideoReadinessSelectionBonus(candidate.presentation)
);

const buildProductVideoRecordCandidate = (
  record: NormalizedRecord,
  productUrl: string,
  includeCopy: boolean
): ProductVideoRecordCandidate => {
  const recordUrl = record.url ?? productUrl;
  const featureCandidates = deriveFeatureList(record, recordUrl);
  const imageUrls = mergeImageUrls(record);
  const presentation = buildProductVideoPresentation({
    title: normalizePlainText(record.title) || recordUrl,
    provider: record.provider,
    productUrl: recordUrl,
    includeCopy,
    images: imageUrls,
    sourceRecord: productVideoPresentationSourceRecord(record),
    metadata: buildProductVideoPresentationMetadata(record, null, featureCandidates),
    featureCandidates
  });
  const candidate = {
    record,
    presentation,
    imageCount: imageUrls.length,
    summary: {
      recordId: record.id,
      provider: record.provider,
      ...(record.title ? { title: record.title } : {}),
      cleanSpecCount: presentation.promotedClaims.length,
      rejectedCandidateCount: presentation.rejectedCandidates.length
    },
    score: 0
  };
  return { ...candidate, score: scoreProductVideoRecordCandidate(candidate) };
};

const selectProductVideoPresentationRecord = (
  records: readonly NormalizedRecord[],
  productUrl: string,
  includeCopy: boolean
): ProductVideoRecordSelection => {
  const [originalPrimaryRecord, ...remainingRecords] = records;
  if (!originalPrimaryRecord) {
    throw new Error("Product details unavailable");
  }
  const candidates = [
    buildProductVideoRecordCandidate(originalPrimaryRecord, productUrl, includeCopy),
    ...remainingRecords.map((record) => buildProductVideoRecordCandidate(record, productUrl, includeCopy))
  ];
  let selected = candidates[0] as ProductVideoRecordCandidate;
  for (const candidate of candidates.slice(1)) {
    if (
      candidate.score > selected.score
      && canSelectProductVideoRecordCandidate(candidate.record, originalPrimaryRecord, productUrl)
    ) {
      selected = candidate;
    }
  }
  return {
    selectedRecord: selected.record,
    originalPrimaryRecord,
    candidateSummaries: candidates.map((candidate) => candidate.summary)
  };
};

const updateProductVideoSelectedCandidateSummary = (
  summaries: readonly ProductVideoCandidateSummary[],
  selectedRecord: NormalizedRecord,
  presentation: ProductVideoPresentation
): ProductVideoCandidateSummary[] => {
  const selectedSummary = {
    recordId: selectedRecord.id,
    provider: selectedRecord.provider,
    ...(presentation.title ? { title: presentation.title } : {}),
    cleanSpecCount: presentation.promotedClaims.length,
    rejectedCandidateCount: presentation.rejectedCandidates.length
  };
  if (!summaries.some((summary) => summary.recordId === selectedRecord.id)) {
    return [...summaries, selectedSummary];
  }
  return summaries.map((summary) => (summary.recordId === selectedRecord.id ? selectedSummary : summary));
};

const productVideoReadinessEvidenceReferenceSummaries = (
  evidenceReferences: readonly ProductVideoEvidenceReference[]
) => evidenceReferences.map((reference) => ({
  ...reference,
  excerpt: toSnippet(reference.excerpt, PRODUCT_VIDEO_READINESS_CANDIDATE_EXCERPT_CHARS)
}));

const productVideoReadinessCandidateSummaries = (
  candidateSummaries: readonly ProductVideoCandidateSummary[]
) => candidateSummaries.map((summary) => ({
  ...summary,
  ...(summary.title ? { title: toSnippet(summary.title, PRODUCT_VIDEO_READINESS_CANDIDATE_EXCERPT_CHARS) } : {})
}));

const productVideoReadinessPromotedClaimSummaries = (
  promotedClaims: readonly ProductVideoPromotedClaim[]
) => promotedClaims.map((claim) => ({
  ...claim,
  claimHash: hash(claim.claim),
  claimLength: claim.claim.length,
  claim: toSnippet(claim.claim, PRODUCT_VIDEO_READINESS_CANDIDATE_EXCERPT_CHARS),
  specValueHash: hash(claim.specValue),
  specValueLength: claim.specValue.length,
  specValue: toSnippet(claim.specValue, PRODUCT_VIDEO_READINESS_CANDIDATE_EXCERPT_CHARS),
  evidenceReferences: productVideoReadinessEvidenceReferenceSummaries(claim.evidenceReferences)
}));

const productVideoReadinessRejectedCandidateSummaries = (presentation: ProductVideoPresentation) => (
  presentation.rejectedCandidates.map((candidate) => ({
    source: candidate.source,
    reasonCode: candidate.reasonCode,
    reason: candidate.reason,
    candidateHash: hash(candidate.candidate),
    evidenceReferenceCount: candidate.evidenceReferences.length,
    evidenceReferences: candidate.evidenceReferences.map((reference) => ({
      ...(reference.recordId ? { recordId: reference.recordId } : {}),
      ...(reference.provider ? { provider: reference.provider } : {}),
      source: reference.source,
      path: reference.path,
      label: reference.label
    }))
  }))
);

const resolveShoppingSourceForUrl = (url: string): ProviderSource => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = SHOPPING_PROVIDER_PROFILES.some((profile) => profile.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)));
    return match ? "shopping" : "web";
  } catch {
    return "web";
  }
};

const getRequiredProductVideoExecutionStep = <
  TStepId extends ProductVideoWorkflowExecutionStep["id"]
>(
  steps: ProductVideoWorkflowExecutionStep[],
  stepId: TStepId
): Extract<ProductVideoWorkflowExecutionStep, { id: TStepId }> => {
  const step = steps.find(
    (candidate): candidate is Extract<ProductVideoWorkflowExecutionStep, { id: TStepId }> => candidate.id === stepId
  );
  if (!step) {
    throw new Error(`Product-video workflow plan is missing required step ${stepId}.`);
  }
  return step;
};

type ResearchSanitizeReason =
  | "js_required_shell"
  | "login_shell"
  | "not_found_shell"
  | "privacy_preference_shell"
  | "research_dead_end_shell"
  | "search_index_shell"
  | "search_results_shell";

const RESEARCH_REJECTED_CANDIDATE_LIMIT = 25;

type ResearchRejectedCandidate = {
  provider: string;
  source: ProviderSource;
  reason: ResearchSanitizeReason;
  replacement_status: "rejected_before_synthesis";
  retrievalPath?: string;
  title?: string;
  url?: string;
};

const isResearchPrivacyPreferenceShell = (content: string): boolean => {
  const matchIndex = content.slice(0, 400).search(RESEARCH_PRIVACY_PREFERENCE_SHELL_RE);
  return matchIndex >= 0
    && matchIndex <= 80
    && !RESEARCH_PRIVACY_RECOVERED_CONTENT_RE.test(content);
};

const classifyResearchDeadEndUrl = (value: string): ResearchSanitizeReason | null => {
  if (!value) return null;
  return classifyResearchDestinationRejection(value);
};

const isResearchLoginShellRecord = (args: {
  url: string;
  combined: string;
  content: string;
}): boolean => {
  if (args.url.includes("/login")) {
    return true;
  }
  if (!RESEARCH_LOGIN_SHELL_RE.test(args.combined)) {
    return false;
  }
  return args.content.length <= RESEARCH_LOGIN_SHELL_MAX_CONTENT_CHARS
    || RESEARCH_LOGIN_REQUIRED_RE.test(args.combined);
};

const classifyResearchShellRecord = (record: NormalizedRecord): ResearchSanitizeReason | null => {
  const retrievalPath = typeof record.attributes.retrievalPath === "string"
    ? record.attributes.retrievalPath
    : "";

  const url = typeof record.url === "string" ? record.url.trim().toLowerCase() : "";
  const title = normalizePlainText(record.title).toLowerCase();
  const content = normalizePlainText(record.content).toLowerCase();
  const combined = `${title} ${content}`.trim();

  if (isResearchLoginShellRecord({ url, combined, content })) {
    return "login_shell";
  }
  if (RESEARCH_JS_REQUIRED_RE.test(combined)) {
    return "js_required_shell";
  }
  if (RESEARCH_NOT_FOUND_SHELL_RE.test(combined)) {
    return "not_found_shell";
  }
  if (isResearchPrivacyPreferenceShell(content)) {
    return "privacy_preference_shell";
  }
  const deadEndUrlReason = classifyResearchDeadEndUrl(url);
  if (deadEndUrlReason) {
    return deadEndUrlReason;
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
  rejectedCandidates: ResearchRejectedCandidate[];
} => {
  const reasonDistribution: Record<string, number> = {};
  const rejectedCandidates: ResearchRejectedCandidate[] = [];
  const sanitizedRecords = records.filter((record) => {
    const reason = classifyResearchShellRecord(record);
    if (!reason) return true;
    reasonDistribution[reason] = (reasonDistribution[reason] ?? 0) + 1;
    if (rejectedCandidates.length < RESEARCH_REJECTED_CANDIDATE_LIMIT) {
      const retrievalPath = typeof record.attributes.retrievalPath === "string"
        ? record.attributes.retrievalPath
        : undefined;
      rejectedCandidates.push({
        provider: record.provider,
        source: record.source,
        reason,
        replacement_status: "rejected_before_synthesis",
        ...(retrievalPath ? { retrievalPath } : {}),
        ...(record.title ? { title: record.title } : {}),
        ...(record.url ? { url: record.url } : {})
      });
    }
    return false;
  });

  return {
    records: sanitizedRecords,
    sanitizedCount: records.length - sanitizedRecords.length,
    reasonDistribution,
    rejectedCandidates
  };
};

const rejectedCandidateFromFailure = (failure: ProviderFailureEntry): ResearchRejectedCandidate | null => {
  const details = failure.error.details ?? {};
  if (details.fallbackOutputReason !== "research_dead_end_shell") return null;
  const retrievalPath = typeof details.retrievalPath === "string" ? details.retrievalPath : undefined;
  const url = typeof details.url === "string" ? details.url : undefined;
  return {
    provider: failure.provider,
    source: failure.source,
    reason: "research_dead_end_shell",
    replacement_status: "rejected_before_synthesis",
    ...(retrievalPath ? { retrievalPath } : {}),
    ...(url ? { url } : {})
  };
};

const rejectedCandidatesFromFailures = (failures: ProviderFailureEntry[]): ResearchRejectedCandidate[] => (
  failures.map(rejectedCandidateFromFailure).filter((candidate): candidate is ResearchRejectedCandidate => candidate !== null)
);

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
): { reason: "http_status" | "not_found_shell" | "provider_error_shell"; message: string } | null => {
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
  const providerId = resolveShoppingProviderIdForUrl(record.url ?? "");
  if (
    providerId === "shopping/bestbuy"
    && combined.toLowerCase().includes("something went wrong")
    && BESTBUY_PDP_ERROR_SHELL_RE.test(combined)
  ) {
    return {
      reason: "provider_error_shell",
      message: "Best Buy product target returned a generic error shell"
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

  const rawWorkflowInput = envelope.input as unknown as ResearchRunInput;
  const artifactRoot = resolveWorkflowArtifactRoot(rawWorkflowInput.outputDir);
  const workflowInput: ResearchRunInput = { ...rawWorkflowInput, outputDir: artifactRoot };
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
    const timeoutMs = resolveResearchProviderStepTimeoutMs(workflowInput.timeoutMs);
    const stepOptions = withProfileOverride(
      withBrowserModeOverride(
        withChallengeAutomationOverride(
          withCookieOverrides({
            source: step.input.source,
            ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
          }, workflowInput),
          workflowInput
        ),
        workflowInput
      ),
      workflowInput
    );

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
  const rawRecords = [
    ...execution.searchRuns.flatMap((run) => run.result.records),
    ...execution.followUpRuns.flatMap((run) => run.result.records)
  ];
  const rawFailures = [
    ...execution.searchRuns.flatMap((run) => run.result.failures),
    ...execution.followUpRuns.flatMap((run) => run.result.failures)
  ];
  const mergedRecords = removeExcludedProviders(rawRecords, excludedProviderSet);
  const sanitizedRecords = sanitizeResearchRecords(mergedRecords);
  const mergedFailures = removeExcludedProviders(rawFailures, excludedProviderSet);
  const rejectedFailureCandidates = rejectedCandidatesFromFailures(mergedFailures);
  const rejectedCandidates = [
    ...sanitizedRecords.rejectedCandidates,
    ...rejectedFailureCandidates
  ].slice(0, RESEARCH_REJECTED_CANDIDATE_LIMIT);
  const rejectedCandidateCount = sanitizedRecords.sanitizedCount + rejectedFailureCandidates.length;
  const reasonCodeDistribution = summarizeReasonCodeDistribution(mergedFailures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(mergedFailures);
  const evaluationNow = new Date();
  const withinTimebox = filterByTimebox(sanitizedRecords.records, plan.compiled.timebox, evaluationNow);
  const enriched = enrichResearchRecords(withinTimebox, plan.compiled.timebox, evaluationNow);
  const deduped = dedupeResearchRecords(enriched);
  const ranked = rankResearchRecords(deduped);
  const cookieDiagnostics = summarizeCookieDiagnostics(mergedFailures, mergedRecords);
  const challengeOrchestration = summarizeChallengeOrchestration(mergedFailures, mergedRecords);
  const transcriptStrategyDetailDistribution = summarizeTranscriptStrategyDetailDistribution(ranked);
  const transcriptDurability = summarizeTranscriptDurability(ranked, mergedFailures);
  const antiBotPressure = summarizeAntiBotPressure(mergedFailures);
  const resolvedTimebox = plan.compiled.timebox.mode === "days"
    ? {
      ...plan.compiled.timebox,
      to: new Date(Math.max(new Date(plan.compiled.timebox.to).getTime(), evaluationNow.getTime())).toISOString()
    }
    : plan.compiled.timebox;

  if (mergedRecords.length > 0 && sanitizedRecords.records.length === 0) {
    const sanitizedReasons = Object.entries(sanitizedRecords.reasonDistribution)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(",");
    throw new Error(
      `Research workflow produced only shell records and no usable results (${sanitizedReasons || "sanitized"}).`
    );
  }

  if (sanitizedRecords.records.length > 0 && withinTimebox.length === 0) {
    throw new Error("Research workflow produced no usable in-timebox results after sanitization.");
  }

  if (ranked.length === 0) {
    throw new Error("Research workflow produced no usable results after post-processing.");
  }

  const primaryConstraintFailures = selectResearchPrimaryConstraintFailures(mergedFailures);
  const meta = withPrimaryConstraintMeta({
    timebox: resolvedTimebox,
    selection: withExcludedProviders({
      source_selection: plan.compiled.sourceSelection,
      resolved_sources: plan.compiled.resolvedSources,
      ...(workflowInput.browserMode ? { requested_browser_mode: workflowInput.browserMode } : {})
	    }, plan.compiled.autoExcludedProviders),
	    metrics: {
	      total_records: mergedRecords.length,
	      sanitized_records: sanitizedRecords.sanitizedCount,
	      rejected_candidate_count: rejectedCandidateCount,
	      sanitized_reason_distribution: sanitizedRecords.reasonDistribution,
	      sanitizedReasonDistribution: sanitizedRecords.reasonDistribution,
	      rejected_candidate_sample_size: rejectedCandidates.length,
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
      challenge_orchestration: challengeOrchestration,
      challengeOrchestration,
      anti_bot_pressure: antiBotPressure,
      antiBotPressure
    },
	    failures: mergedFailures,
	    rejected_candidates: rejectedCandidates,
	    rejectedCandidates,
	    alerts: buildWorkflowAlerts(runtime, mergedFailures)
  } as Record<string, unknown>, primaryConstraintFailures);
  const handoff = buildResearchSuccessHandoff({
    topic: plan.compiled.topic,
    browserMode: workflowInput.browserMode,
    failures: mergedFailures,
    cookieDiagnostics,
    challengeOrchestration
  });
  const responseMeta = withFollowthroughMeta(meta, handoff);

  const renderMode = workflowInput.mode ?? "compact";
  const rendered = renderResearch({
    mode: renderMode,
    topic: plan.compiled.topic,
    records: ranked,
    meta: responseMeta
  });

  const bundle = await createArtifactBundle({
    namespace: "research",
    outputDir: artifactRoot,
    ttlHours: workflowInput.ttlHours,
    files: rendered.files
  });

  if (renderMode === "path") {
    return {
      ...rendered.response,
      ...handoff,
      artifact_path: bundle.basePath,
      records: ranked,
      meta: {
        ...responseMeta,
        artifact_manifest: bundle.manifest
      }
    };
  }

  return {
    ...rendered.response,
    ...handoff,
    artifact_path: bundle.basePath,
    records: ranked,
    meta: {
      ...responseMeta,
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

  const rawWorkflowInput = envelope.input as unknown as ShoppingRunInput;
  const artifactRoot = resolveWorkflowArtifactRoot(rawWorkflowInput.outputDir);
  const workflowInput: ShoppingRunInput = { ...rawWorkflowInput, outputDir: artifactRoot };
  const remainingTimeoutMs = createRemainingTimeoutResolver(workflowInput.timeoutMs);
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
    const timeoutMs = remainingTimeoutMs();
    const stepOptions = withProfileOverride(
      withBrowserModeOverride(
        withChallengeAutomationOverride(
          withCookieOverrides({
            source: "shopping",
            providerIds: [step.input.providerId],
            ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
          }, workflowInput),
          workflowInput
        ),
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
    zeroPriceExcluded,
    budgetExcluded,
    regionCurrencyExcluded,
    offerFilterDiagnostics
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
  const regionEnforced = plan.compiled.regionDiagnostics.length > 0
    ? plan.compiled.regionDiagnostics.every((entry) => entry.enforced)
    : false;
  if (plan.compiled.regionDiagnostics.length > 0) {
    alerts.push({
      signal: "region_unenforced",
      reasonCode: "region_unenforced",
      state: "warning",
      reason: "Default shopping adapters currently use provider default storefronts, so requested region filters are advisory only and not authoritative.",
      providers: plan.compiled.regionDiagnostics.map((entry) => entry.provider),
      requested_region: workflowInput.region ?? plan.compiled.regionDiagnostics[0]?.requestedRegion ?? ""
    });
  }
  let meta = withPrimaryConstraintMeta({
    selection: {
      providers: plan.compiled.effectiveProviderIds,
      ...(plan.compiled.autoExcludedProviders.length > 0 ? { excluded_providers: plan.compiled.autoExcludedProviders } : {}),
      ...(workflowInput.browserMode ? { requested_browser_mode: workflowInput.browserMode } : {}),
      ...(workflowInput.region
        ? {
          requested_region: workflowInput.region,
          region_enforced: regionEnforced,
          region_authoritative: regionEnforced,
          region_support: plan.compiled.regionDiagnostics
        }
        : {})
    },
    metrics: {
      total_offers: offers.length,
      candidate_offers: offerFilterDiagnostics.reduce((sum, entry) => sum + entry.candidateOffers, 0),
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
      zero_price_excluded: zeroPriceExcluded,
      budget_excluded: budgetExcluded,
      region_currency_excluded: regionCurrencyExcluded
    },
    offerFilterDiagnostics,
    failures,
    alerts
  } as Record<string, unknown>, failures);

  const filterConstraintSummary = summarizeShoppingOfferFilterConstraint({
    diagnostics: offerFilterDiagnostics,
    budget: plan.compiled.budget,
    region: workflowInput.region,
    regionEnforced,
    failures
  });
  if (typeof filterConstraintSummary === "string") {
    meta = withPrimaryConstraintSummaryOverride(meta, filterConstraintSummary);
  }
  const handoff = buildShoppingSuccessHandoff({
    query: plan.compiled.query,
    providers: plan.compiled.providerIds,
    budget: plan.compiled.budget,
    region: workflowInput.region,
    browserMode: workflowInput.browserMode,
    sort: workflowInput.sort
  });
  const responseMeta = withFollowthroughMeta(meta, handoff);
  const renderedAt = new Date().toISOString();

  const rendered = renderShopping({
    mode: workflowInput.mode,
    query: plan.compiled.query,
    offers,
    meta: responseMeta,
    freshnessReferenceIso: renderedAt
  });

  const bundle = await createArtifactBundle({
    namespace: "shopping",
    outputDir: artifactRoot,
    ttlHours: workflowInput.ttlHours,
    files: rendered.files
  });

  if (workflowInput.mode === "path") {
    return {
      ...rendered.response,
      ...handoff,
      artifact_path: bundle.basePath,
      offers,
      meta: {
        ...responseMeta,
        artifact_manifest: bundle.manifest
      }
    };
  }

  return {
    ...rendered.response,
    ...handoff,
    offers,
    artifact_path: bundle.basePath,
    meta: {
      ...responseMeta,
      artifact_manifest: bundle.manifest
    }
  };
};

export const runInspiredesignWorkflow = async (
  runtime: ReferenceRetrievalPort,
  input: InspiredesignRunInput | WorkflowResumeEnvelope,
  options: InspiredesignWorkflowOptions = {}
): Promise<Record<string, unknown>> => {
  const { envelope, workflowInput: rawWorkflowInput } = buildInspiredesignEnvelope(input);
  const artifactRoot = resolveWorkflowArtifactRoot(rawWorkflowInput.outputDir);
  let workflowInput: InspiredesignResolvedInput = { ...rawWorkflowInput, outputDir: artifactRoot };
  const requestedReferenceUrls = [...workflowInput.urls];
  const remainingTimeoutMs = createRemainingTimeoutResolver(workflowInput.timeoutMs);
  // Start the workflow deadline now; reference captures get their own per-reference budgets below.
  remainingTimeoutMs();
  const visualEvidenceTempDir = workflowInput.visualEvidence !== "off"
    ? await mkdtemp(join(tmpdir(), "inspiredesign-visual-"))
    : undefined;
  let motionEvidenceTempDir: string | undefined;
  let pinMediaEvidenceTempDir: string | undefined;
  try {
  const discovery = await discoverInspiredesignReferences(
    runtime,
    workflowInput,
    envelope,
    workflowInput.query ? remainingTimeoutMs() : undefined
  );
  workflowInput = {
    ...workflowInput,
    urls: mergeInspiredesignReferenceUrls(
      workflowInput.urls,
      discovery.acceptedUrls,
      workflowInput.referenceLimit ?? workflowInput.urls.length + discovery.acceptedUrls.length
    ),
    captureMode: resolveInspiredesignHarvestCaptureMode({
      requested: workflowInput.captureMode,
      urls: [
        ...workflowInput.urls,
        ...discovery.acceptedUrls
      ],
      harvest: workflowInput.harvest === true,
      providers: workflowInput.providers
    })
  };
  let trace = appendWorkflowTrace(envelope.trace ?? [], "compile", "compile_started", {
    kind: "inspiredesign"
  });
  trace = appendWorkflowTrace(trace, "compile", "compile_completed", {
    kind: "inspiredesign",
    urlCount: workflowInput.urls.length,
    captureMode: workflowInput.captureMode
  });

  const references: InspiredesignReferenceEvidence[] = [];
  const failures: ProviderFailureEntry[] = [...discovery.failures];
  for (const [index, url] of workflowInput.urls.entries()) {
    const workflowRemainingBudgetMs = remainingTimeoutMs();
    if (isInspiredesignWorkflowDeadlineExhausted(workflowRemainingBudgetMs)) {
      trace = appendWorkflowTrace(trace, "execute", "reference_skipped", {
        stepIndex: index,
        url,
        reason: "workflow_timeout_exhausted"
      });
      break;
    }
    const referenceBudgetMs = resolveInspiredesignReferenceBudgetMs(workflowRemainingBudgetMs, workflowInput.urls.length - index);
    const referenceRemainingTimeoutMs = createRemainingTimeoutResolver(referenceBudgetMs);
    const stepTrace = appendWorkflowTrace(trace, "execute", "reference_started", {
      stepIndex: index,
      url
    });
    const fetchTimeoutMs = referenceRemainingTimeoutMs();
    const fetchResult = await runtime.fetch(
      { url },
      buildInspiredesignReferenceFetchOptions(
        workflowInput,
        buildInspiredesignStepEnvelope(workflowInput, stepTrace, index, url),
        url,
        fetchTimeoutMs
      )
    );
    const result = normalizeInspiredesignFetchResult(fetchResult);
    observeWorkflowSignals(runtime, result);
    const visualPlan = buildInspiredesignVisualCapturePlan(
      url,
      workflowInput,
      result,
      visualEvidenceTempDir
    );
    const classification = classifyPinterestReference(url, result);
    const pinMediaFirst = shouldCapturePinterestPinMedia(url, classification);
    const visualFirst = isPinterestVisualFirstStrategy(classification);
    const motionFirst = isPinterestMotionFirstStrategy(classification);
    if (pinMediaFirst && options.capturePinMediaEvidence && !pinMediaEvidenceTempDir) {
      pinMediaEvidenceTempDir = await realpath(await mkdtemp(join(tmpdir(), "inspiredesign-pin-media-")));
    }
    if (motionFirst && options.captureMotionEvidence && !motionEvidenceTempDir) {
      motionEvidenceTempDir = await mkdtemp(join(tmpdir(), "inspiredesign-motion-"));
    }
    const pinMedia = pinMediaFirst
      ? await captureWorkflowPinMediaEvidence(
        url,
        workflowInput,
        options.capturePinMediaEvidence,
        visualPlan.referenceId,
        pinMediaEvidenceTempDir,
        classification,
        referenceRemainingTimeoutMs()
      )
      : undefined;
    const shouldCaptureVisual = visualFirst || shouldCapturePinterestVisualAfterPinMedia({
      visualEvidence: workflowInput.visualEvidence,
      visualFirst,
      classification,
      pinMedia
    });
    const visual = shouldCaptureVisual
      ? trustRuntimeVisualEvidence(
        await captureWorkflowVisualEvidence(
          url,
          workflowInput,
          options.captureVisualEvidence,
          visualPlan,
          referenceRemainingTimeoutMs()
        ),
        visualPlan
      )
      : undefined;
    const motion = motionFirst
      ? await captureWorkflowMotionEvidence(
        url,
        workflowInput,
        options.captureMotionEvidence,
        visualPlan.referenceId,
        motionEvidenceTempDir,
        referenceRemainingTimeoutMs()
      )
      : undefined;
    const primaryCapture = mergeCapturePinMediaEvidence(
      mergeCaptureMotionEvidence(
        mergeCaptureVisualEvidence(buildSkippedDeepDiagnosticsEvidence("Deep diagnostics did not run before primary media capture."), visual),
        motion
      ),
      pinMedia
    );
    const capture = await captureInspiredesignReference(
      url,
      workflowInput.captureMode,
      workflowInput,
      options.captureReference,
      visualPlan,
      referenceRemainingTimeoutMs(),
      visual || motion || pinMedia ? primaryCapture : undefined
    );
    const reference = buildInspiredesignReference(url, result, capture);
    references.push(reference);
    if (reference.fetchStatus === "failed" && !isInspiredesignFetchRecovered(reference)) {
      const fetchFailures = result.failures.length > 0 ? result.failures : failureFromInspiredesignFetchError(result);
      const siteRecipe = resolveSiteRecipeForUrl(url);
      failures.push(...(siteRecipe ? normalizeSiteRecipeFetchFailures(siteRecipe, fetchFailures) : fetchFailures));
    }
    trace = appendWorkflowTrace(stepTrace, "execute", "reference_completed", {
      stepIndex: index,
      url,
      fetchStatus: result.records.length > 0 ? "captured" : "failed",
      captureStatus: capture.captureStatus
    });
  }
  const motionCollation = await finalizeInspiredesignMotionArtifacts(references, motionEvidenceTempDir);
	const pinMediaCollation = await finalizeInspiredesignPinMediaArtifacts(motionCollation.references, pinMediaEvidenceTempDir);
	const visualCollation = await finalizeInspiredesignVisualArtifacts(pinMediaCollation.references, workflowInput.visualEvidence);
  const finalReferences = attachInspiredesignDiscoveryProvenance(
    visualCollation.references,
    buildDiscoveryProvenanceByUrl(discovery)
  );
	const mediaAnalysisTempDirs: string[] = [];
	let mediaAnalysis = buildDiagnosticInspiredesignMediaAnalysis();
	let mediaAnalysisFailure: string | undefined;
	try {
		const mediaAnalysisInputs = await buildTrustedInspiredesignMediaAnalysisInputs({
			references: finalReferences,
			pinMediaFiles: pinMediaCollation.files,
			pinMediaTempRoot: pinMediaEvidenceTempDir,
			stagedTempDirs: mediaAnalysisTempDirs,
			remainingTimeoutMs
		});
			const binaryPreflightTimeoutMs = remainingTimeoutMs();
			if (typeof binaryPreflightTimeoutMs === "number" && binaryPreflightTimeoutMs <= 1) {
				throw new Error("Pinterest pin media analysis deadline was exhausted.");
			}
			const binaryOptions = mediaAnalysisInputs.length > 0
				? await resolveInspiredesignMediaAnalyzerBinaryOptions(options, binaryPreflightTimeoutMs)
				: {};
			const analyzerTimeoutMs = remainingTimeoutMs();
			if (typeof analyzerTimeoutMs === "number" && analyzerTimeoutMs <= 1) {
				throw new Error("Pinterest pin media analysis deadline was exhausted.");
			}
			mediaAnalysis = await (options.analyzeMediaArtifacts ?? analyzeInspiredesignMediaArtifacts)(mediaAnalysisInputs, {
				generatedAt: INSPIREDESIGN_MEDIA_ANALYSIS_DETERMINISTIC_GENERATED_AT,
				timeoutMs: analyzerTimeoutMs,
			...binaryOptions
		});
	} catch (error) {
		mediaAnalysisFailure = mediaAnalysisFailureMessage(error);
	} finally {
		await cleanupPinMediaAnalysisTempDirs(mediaAnalysisTempDirs);
	}

  const packet = buildInspiredesignPacket({
    brief: workflowInput.brief,
    briefExpansion: workflowInput.briefExpansion,
    urls: workflowInput.urls,
    references: finalReferences,
    mediaAnalysis,
    includePrototypeGuidance: workflowInput.includePrototypeGuidance,
    referenceEvidenceRequired: isInspiredesignReferenceEvidenceRequired(workflowInput)
  });
  const meta = buildInspiredesignMeta(
    runtime,
    workflowInput,
    finalReferences,
    failures,
    packet.followthrough,
    discovery
  );
  const discoveryDiagnosticsArtifact = buildPersistedInspiredesignDiscoveryDiagnostics(discovery);
  packet.evidence.discovery = buildInspiredesignDiscoveryEvidenceSummary(discoveryDiagnosticsArtifact);
  const persistedEvidenceArtifactPaths = new Set([
    ...visualCollation.files,
    ...motionCollation.files,
    ...pinMediaCollation.files
  ].map((file) => file.path));
  const manifestBackedScreenshotIndex = packet.screenshotIndex.filter((screenshot) => (
    typeof screenshot.path === "string" && persistedEvidenceArtifactPaths.has(screenshot.path)
  ));
  const manifestBackedMotionEvidence = packet.motionEvidence.filter((entry) => {
    const motion = entry.motion as { replay?: { path?: string }; preview?: { path?: string } };
    return typeof motion.replay?.path === "string"
      && typeof motion.preview?.path === "string"
      && persistedEvidenceArtifactPaths.has(motion.replay.path)
      && persistedEvidenceArtifactPaths.has(motion.preview.path);
  });
  const manifestBackedPinMediaIndex = packet.pinMediaIndex.filter((pinMedia) => (
    persistedEvidenceArtifactPaths.has(pinMedia.path)
  ));
  const savedMediaMotionNotice = buildSavedMediaMotionNotice({
    mediaAnalysis: packet.mediaAnalysis,
    motionEvidence: manifestBackedMotionEvidence
  });
  const visualEvidenceAfterPinMediaNotice = buildVisualEvidenceAfterPinMediaNotice({
    references: finalReferences,
    pinMediaIndex: manifestBackedPinMediaIndex,
    screenshotIndex: manifestBackedScreenshotIndex
  });
  if (visualEvidenceAfterPinMediaNotice) {
    packet.evidence.visualEvidenceAfterPinMedia = visualEvidenceAfterPinMediaNotice as unknown as JsonValue;
  }
  const stillImageMotionCaptureNotice = buildStillImageMotionCaptureNotice({
    pinMediaIndex: manifestBackedPinMediaIndex,
    motionEvidence: manifestBackedMotionEvidence
  });
  if (stillImageMotionCaptureNotice) {
    packet.evidence.motionCapture = stillImageMotionCaptureNotice as unknown as JsonValue;
  }
  if (savedMediaMotionNotice) {
    packet.evidence.mediaAnalysis = {
      ...(typeof packet.evidence.mediaAnalysis === "object" && packet.evidence.mediaAnalysis !== null && !Array.isArray(packet.evidence.mediaAnalysis)
        ? packet.evidence.mediaAnalysis
        : {}),
      savedMediaMotionNotice
    };
  }
  const rankedPinterestReferenceCount = packet.rankedReferences.filter((reference) => (
    isInspiredesignPinterestPinReferenceUrl(reference.url)
  )).length;
  const pinterestEvidenceRequired = isPinterestEvidenceRequiredForWorkflow(workflowInput, discovery);
  const rankedReferenceAuthorityArtifacts = {
    screenshots: manifestBackedScreenshotIndex,
    motions: manifestBackedMotionEvidence,
    pinMedia: manifestBackedPinMediaIndex
  };
  const rankedEvidenceAuthorityCounts = countInspiredesignArtifactBackedEvidenceAuthorities({
    rankedReferences: packet.rankedReferences,
    screenshots: rankedReferenceAuthorityArtifacts.screenshots,
    motions: rankedReferenceAuthorityArtifacts.motions,
    pinMedia: rankedReferenceAuthorityArtifacts.pinMedia
  });
  const rankedSnapshotReadyReferenceCount = rankedEvidenceAuthorityCounts.snapshotReadyReferenceCount;
  const rankedMotionReadyReferenceCount = rankedEvidenceAuthorityCounts.motionReadyReferenceCount;
  const rankedPinMediaReadyReferenceCount = rankedEvidenceAuthorityCounts.pinMediaReadyReferenceCount;
  const rankedAuthoritativeReferenceCount = packet.rankedReferences.filter((reference) => (
    isInspiredesignAuthoritativeRankedReference(reference, rankedReferenceAuthorityArtifacts)
  )).length;
  const rankedAuthoritativePinterestReferenceCount = countInspiredesignAuthoritativePinterestReferences({
    rankedReferences: packet.rankedReferences,
    screenshots: rankedReferenceAuthorityArtifacts.screenshots,
    motions: rankedReferenceAuthorityArtifacts.motions,
    pinMedia: rankedReferenceAuthorityArtifacts.pinMedia
  });
  const nextStepGuidance = routeNextStepGuidance(createInspiredesignGuidanceContext(
    buildInspiredesignGuidanceSource(
      workflowInput,
      discovery,
      meta,
		packet.referencePatternBoard,
      requestedReferenceUrls,
      {
        authoritativeReferenceCount: rankedAuthoritativeReferenceCount,
        snapshotReadyReferenceCount: rankedSnapshotReadyReferenceCount,
        motionReadyReferenceCount: rankedMotionReadyReferenceCount,
        pinMediaReadyReferenceCount: rankedPinMediaReadyReferenceCount
      }
    )
  ));
  const productReadiness = buildInspiredesignProductReadinessFields(
    nextStepGuidance.readiness,
    packet.rankedReferences.length,
    packet.rankedReferences.length - rankedPinterestReferenceCount,
    rankedPinterestReferenceCount,
    hasActiveInspiredesignCanvasDoNotProceedBlocker(
      nextStepGuidance.doNotProceedIf,
      packet.rankedReferences.length,
      workflowInput.visualEvidence === "required"
        ? packet.referencePatternBoard.qualitySummary.missingScreenshotCount
        : 0
    ),
    rankedSnapshotReadyReferenceCount,
    rankedMotionReadyReferenceCount,
    rankedAuthoritativeReferenceCount,
    pinterestEvidenceRequired,
    rankedPinMediaReadyReferenceCount,
    rankedAuthoritativePinterestReferenceCount
  );
	const quality = packet.referencePatternBoard.qualitySummary;
	const existingMetrics = typeof meta.metrics === "object" && meta.metrics !== null && !Array.isArray(meta.metrics)
	? meta.metrics as Record<string, unknown>
	: {};
  let followthroughSummary = buildInspiredesignGuidanceFollowthroughSummary(
    packet.followthrough,
    meta,
    nextStepGuidance
  );
  if (productReadiness.productSuccess) {
    followthroughSummary = typeof meta.followthroughSummary === "string"
      ? meta.followthroughSummary
      : followthroughSummary;
  } else if (nextStepGuidance.readiness === "ready") {
    followthroughSummary = PRODUCT_READINESS_BLOCKED_SUMMARY;
  }
  const metaWithGuidance = {
    ...meta,
	...(mediaAnalysisFailure ? { mediaAnalysisFailure } : {}),
	metrics: {
		...existingMetrics,
		attempted_reference_count: quality.attemptedReferenceCount,
		missing_screenshot_count: quality.missingScreenshotCount,
		all_attempt_failed_capture_count: quality.allAttemptFailedCaptureCount,
		all_attempt_missing_screenshot_count: quality.allAttemptMissingScreenshotCount,
		all_attempt_visual_failure_count: quality.allAttemptVisualFailureCount,
		all_attempt_motion_failure_count: quality.allAttemptMotionFailureCount
	},
    ...productReadiness,
    pinterestEvidenceRequired,
    followthroughSummary,
    nextStepGuidance
  };
  const rendered = renderInspiredesign({
    mode: workflowInput.mode,
    brief: workflowInput.brief,
    advancedBriefMarkdown: packet.advancedBriefMarkdown,
    urls: workflowInput.urls,
    designContract: packet.designContract,
    canvasPlanRequest: packet.canvasPlanRequest,
    designAgentHandoff: packet.followthrough,
    generationPlan: packet.generationPlan,
    implementationPlan: packet.implementationPlan,
    designMarkdown: packet.designMarkdown,
    implementationPlanMarkdown: packet.implementationPlanMarkdown,
    prototypeGuidanceMarkdown: packet.prototypeGuidanceMarkdown,
	    evidence: packet.evidence,
	    visualEvidence: packet.visualEvidence,
	    screenshotIndex: packet.screenshotIndex,
	    motionEvidence: packet.motionEvidence,
	    authorityScreenshotIndex: manifestBackedScreenshotIndex,
	    authorityMotionEvidence: manifestBackedMotionEvidence,
      pinMediaEvidence: packet.pinMediaEvidence,
      pinMediaIndex: packet.pinMediaIndex,
      authorityPinMediaIndex: manifestBackedPinMediaIndex,
      mediaAnalysis: packet.mediaAnalysis,
	    rankedReferences: packet.rankedReferences,
    referencePatternBoard: buildInspiredesignRankedArtifactPatternBoard(
      packet.generationPlan.referencePatternBoard,
      packet.referencePatternBoard
    ),
    metaPromptMarkdown: packet.metaPromptMarkdown,
	    nextStepGuidance,
	    meta: metaWithGuidance
	  });
	  const renderedProductSuccess = (rendered.response as { productSuccess?: unknown }).productSuccess === true;
	  const finalProductReadiness = renderedProductSuccess && productReadiness.productSuccess
	    ? productReadiness
	    : {
	      ...productReadiness,
	      ready: false,
	      productSuccess: false,
	      artifactAuthority: "diagnostic_only" as const,
	      evidenceAuthority: "diagnostic_only" as const
		    };
	  const renderedFilesForBundle = finalProductReadiness.productSuccess
	    ? rendered.files
	    : rendered.files.filter((file) => !INSPIREDESIGN_PRODUCT_READY_ONLY_ARTIFACTS.has(file.path));
	  const bundle = await createArtifactBundle({
	    namespace: "inspiredesign",
	    outputDir: artifactRoot,
	    ttlHours: workflowInput.ttlHours,
	    files: [
        ...renderedFilesForBundle,
        { path: DISCOVERY_DIAGNOSTICS_ARTIFACT_PATH, content: discoveryDiagnosticsArtifact },
        ...visualCollation.files,
        ...motionCollation.files,
        ...pinMediaCollation.files
      ]
	  });

  if (workflowInput.mode === "path") {
    return {
      ...rendered.response,
      ...finalProductReadiness,
      artifact_path: bundle.basePath,
      meta: {
        ...metaWithGuidance,
        ...finalProductReadiness,
        artifact_manifest: bundle.manifest
      }
    };
  }

  return {
    ...rendered.response,
    ...finalProductReadiness,
    artifact_path: bundle.basePath,
    meta: {
      ...metaWithGuidance,
      ...finalProductReadiness,
      artifact_manifest: bundle.manifest
    }
  };
  } finally {
    if (visualEvidenceTempDir) {
      await rm(visualEvidenceTempDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (motionEvidenceTempDir) {
      await rm(motionEvidenceTempDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (pinMediaEvidenceTempDir) {
      await rm(pinMediaEvidenceTempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
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

  const rawWorkflowInput = plan.input;
  const productVideoArtifactRoot = resolveWorkflowArtifactRoot(rawWorkflowInput.output_dir);
  const workflowInput = { ...rawWorkflowInput, output_dir: productVideoArtifactRoot };
  const includeScreenshots = plan.compiled.includeScreenshots;
  const includeAllImages = plan.compiled.includeAllImages;
  const includeCopy = plan.compiled.includeCopy;
  const timeoutOptions = typeof workflowInput.timeoutMs === "number"
    ? { timeoutMs: workflowInput.timeoutMs }
    : {};
  const remainingTimeoutMs = createRemainingTimeoutResolver(workflowInput.timeoutMs);
  const appendProductVideoTrace = (
    currentTrace: WorkflowTraceEntry[],
    stage: WorkflowTraceEntry["stage"],
    event: string,
    details: Record<string, JsonValue>
  ): WorkflowTraceEntry[] => [
    ...currentTrace,
    {
      at: new Date().toISOString(),
      stage,
      event,
      details
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
  >(stepId: TStepId): Extract<ProductVideoWorkflowExecutionStep, { id: TStepId }> =>
    getRequiredProductVideoExecutionStep(plan.plan.steps, stepId);

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
        outputDir: productVideoArtifactRoot,
        ttlHours: workflowInput.ttl_hours,
        ...timeoutOptions,
        browserMode: workflowInput.browserMode,
        profile: workflowInput.profile,
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
        withProfileOverride(
          withBrowserModeOverride(
            withChallengeAutomationOverride(
              withCookieOverrides({
                source,
                providerIds: shoppingProviderId ? [shoppingProviderId] : undefined,
                ...timeoutOptions
              }, workflowInput),
              workflowInput
            ),
            workflowInput
          ),
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
  const recordSelection = selectProductVideoPresentationRecord(details.records, productUrl, includeCopy);
  const primary = recordSelection.selectedRecord;
  const invalidTarget = classifyInvalidProductTarget(primary);
  if (invalidTarget) {
    throw new Error(invalidTarget.message);
  }
  const refreshedMetadata = needsProductMetadataRefresh(primary, productUrl)
    ? await refreshProductMetadata(productUrl, remainingTimeoutMs())
    : null;
  const primaryOffer = extractShoppingOffer(primary, new Date());
  const preferredPrice = resolvePreferredProductPrice(primary, productUrl, refreshedMetadata?.price, primaryOffer);
  providerHint = normalizeProductVideoProviderHint(productUrl, providerHint, primary.provider);

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
  const legacyFeatureList = deriveFeatureList(primary, productUrl, refreshedMetadata?.features ?? []);
  const imageUrls = mergeImageUrls(primary, refreshedMetadata?.imageUrls ?? []);
  const selectedImageUrls = includeAllImages ? imageUrls : imageUrls.slice(0, 1);
  trace = appendProductVideoTrace(trace, "execute", "step_completed", {
    stepId: extractStep.id,
    stepKind: extractStep.kind,
    imageCandidates: imageUrls.length,
    featureCount: legacyFeatureList.length,
    refreshedMetadata: Boolean(refreshedMetadata),
    selectedRecordId: primary.id,
    originalPrimaryRecordId: recordSelection.originalPrimaryRecord.id,
    selectedRecordChanged: primary.id !== recordSelection.originalPrimaryRecord.id,
    candidateRecords: details.records.length
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

  const pricing = resolvedPrice;
  const legacyCopyText = includeCopy
    ? resolveProductCopy(primary, productUrl, refreshedMetadata?.description, legacyFeatureList)
    : "";
  const presentation = buildProductVideoPresentation({
    title: resolvedTitle,
    brand: resolvedBrand,
    provider: providerHint ?? primary.provider,
    productUrl,
    price: {
      amount: pricing.amount,
      currency: pricing.currency
    },
    includeCopy,
    images: imagePaths,
    screenshots: screenshotPaths,
    sourceRecord: productVideoPresentationSourceRecord(primary),
    metadata: buildProductVideoPresentationMetadata(primary, refreshedMetadata, legacyFeatureList),
    featureCandidates: legacyFeatureList,
    copyCandidates: legacyCopyText ? [legacyCopyText] : [],
    selectedRecordId: primary.id,
    originalPrimaryRecordId: recordSelection.originalPrimaryRecord.id,
    candidateSummaries: recordSelection.candidateSummaries
  });
  const presentationCandidateSummaries = updateProductVideoSelectedCandidateSummary(
    presentation.candidateSummaries,
    primary,
    presentation
  );
  const presentationReadinessPayload = {
    presentationReadiness: presentation.presentationReadiness,
    productVideoReadiness: presentation.productVideoReadiness,
    selectedRecordId: primary.id,
    originalPrimaryRecordId: recordSelection.originalPrimaryRecord.id,
    candidateSummaries: productVideoReadinessCandidateSummaries(presentationCandidateSummaries),
    promotedClaims: productVideoReadinessPromotedClaimSummaries(presentation.promotedClaims),
    rejectedCandidates: productVideoReadinessRejectedCandidateSummaries(presentation),
    evidenceReferences: productVideoReadinessEvidenceReferenceSummaries(presentation.evidenceReferences),
    summary: {
      status: presentation.presentationReadiness.status,
      promotedFeatureCount: presentation.features.length,
      promotedClaimCount: presentation.promotedClaims.length,
      rejectedCandidateCount: presentation.rejectedCandidates.length,
      evidenceReferenceCount: presentation.evidenceReferences.length,
      imageCount: imagePaths.length,
      screenshotCount: screenshotPaths.length
    }
  };

  const productPayload = {
    title: presentation.title,
    brand: presentation.brand ?? "unknown",
    provider: providerHint ?? primary.provider,
    url: productUrl,
    features: presentation.features,
    copy: presentation.copy,
    presentationReadiness: presentation.presentationReadiness,
    productVideoReadiness: presentation.productVideoReadiness
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
      features: presentation.features,
      copy: presentation.copy
    },
    assets: {
      images: imagePaths,
      screenshots: screenshotPaths,
      raw: ["raw/source-record.json"]
    },
    readiness: {
      presentation: presentation.presentationReadiness,
      productVideo: presentation.productVideoReadiness
    }
  };

  files.push(
    { path: "manifest.json", content: manifestPayload },
    { path: "product.json", content: productPayload },
    { path: "pricing.json", content: pricing },
    { path: "copy.md", content: presentation.copyMarkdown },
    { path: "features.md", content: presentation.featuresMarkdown },
    { path: "presentation-readiness.json", content: presentationReadinessPayload },
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
    presentationReadinessStatus: presentation.presentationReadiness.status,
    promotedFeatureCount: presentation.features.length,
    rejectedCandidateCount: presentation.rejectedCandidates.length,
    files: files.length
  });

  const bundle = await createArtifactBundle({
    namespace: "product-video",
    outputDir: productVideoArtifactRoot,
    ttlHours: workflowInput.ttl_hours,
    files
  });

  const reasonCodeDistribution = summarizeReasonCodeDistribution(details.failures);
  const transcriptStrategyFailures = summarizeTranscriptStrategyFailures(details.failures);
  const transcriptStrategyDetailDistribution = summarizeTranscriptStrategyDetailDistribution(details.records);
  const transcriptDurability = summarizeTranscriptDurability(details.records, details.failures);
  const cookieDiagnostics = summarizeCookieDiagnostics(details.failures, details.records);
  const antiBotPressure = summarizeAntiBotPressure(details.failures);
  const primaryIssue = summarizePrimaryProviderIssue(details.failures);
  const handoff = buildProductVideoSuccessHandoff({
    productUrl,
    productName: workflowInput.product_name,
    providerHint,
    browserMode: workflowInput.browserMode,
    includeScreenshots: workflowInput.include_screenshots,
    includeAllImages: workflowInput.include_all_images,
    includeCopy: workflowInput.include_copy,
    presentationReadiness: presentation.presentationReadiness,
    productVideoReadiness: presentation.productVideoReadiness
  });
  const meta = withFollowthroughMeta({
    ...(workflowInput.browserMode
      ? { selection: { requested_browser_mode: workflowInput.browserMode } }
      : {}),
    alerts: buildWorkflowAlerts(runtime, details.failures),
    failures: details.failures,
    ...(primaryIssue ? { primaryConstraint: primaryIssue, primaryConstraintSummary: primaryIssue.summary } : {}),
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
    presentationReadiness: presentation.presentationReadiness,
    productVideoReadiness: presentation.productVideoReadiness,
    artifact_manifest: bundle.manifest
  }, handoff);

  return {
    ...handoff,
    artifact_path: bundle.basePath,
    manifest: manifestPayload,
    product: productPayload,
    pricing,
    screenshots: screenshotPaths,
    images: imagePaths,
    meta
  };
};
