import { buildProviderIssueGuidance, readProviderIssueHint } from "./constraint";
import { ProviderRuntimeError, providerErrorCodeFromReasonCode } from "./errors";
import {
  resolveProviderFallbackModes,
  resolveProviderRuntimePolicy
} from "./runtime-policy";
import type {
  BrowserFallbackObservation,
  BrowserFallbackMode,
  BrowserFallbackPort,
  BrowserFallbackResponse,
  JsonValue,
  ProviderContext,
  ProviderOperation,
  ProviderRecoveryHints,
  ProviderReasonCode,
  ProviderSource,
  SuspendedIntentKind,
  SuspendedIntentSummary
} from "./types";

export { resolveProviderFallbackModes } from "./runtime-policy";

const DEFAULT_SUSPENDED_INTENT_KIND: Record<ProviderOperation, SuspendedIntentKind> = {
  search: "provider.search",
  fetch: "provider.fetch",
  crawl: "provider.crawl",
  post: "provider.post"
};

const toJsonValue = (value: unknown): JsonValue | undefined => {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => toJsonValue(entry))
      .filter((entry): entry is JsonValue => typeof entry !== "undefined");
    return entries;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = toJsonValue(entry);
    if (typeof normalized !== "undefined") {
      record[key] = normalized;
    }
  }
  return record;
};

const toJsonRecord = (value: unknown): Record<string, JsonValue> => {
  const normalized = toJsonValue(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized
    : {};
};

const readFallbackRecord = (
  details: Record<string, JsonValue> | undefined,
  key: string
): Record<string, JsonValue> | undefined => {
  const candidate = details?.[key];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate
    : undefined;
};

export const readFallbackString = (
  output: Record<string, JsonValue> | undefined,
  key: "html" | "url"
): string | undefined => {
  const value = output?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

export const fallbackDispositionMessage = (
  fallback: BrowserFallbackResponse,
  url: string
): string => {
  if (typeof fallback.details?.message === "string" && fallback.details.message.trim().length > 0) {
    return fallback.details.message;
  }
  switch (fallback.disposition) {
    case "challenge_preserved":
      return `Browser fallback preserved a challenge session for ${url}`;
    case "deferred":
      return `Browser fallback deferred recovery for ${url}`;
    default:
      return `Browser fallback failed for ${url}`;
  }
};

export const toProviderFallbackError = (args: {
  provider: string;
  source: ProviderSource;
  url: string;
  fallback: BrowserFallbackResponse;
}): ProviderRuntimeError => {
  const { fallback } = args;
  const reasonCode = fallback.reasonCode;
  const details: Record<string, JsonValue> = {
    url: args.url,
    disposition: fallback.disposition,
    ...(fallback.mode ? { browserFallbackMode: fallback.mode } : {}),
    ...(fallback.challenge ? { challenge: toJsonRecord(fallback.challenge) } : {}),
    ...(fallback.preservedSessionId ? { preservedSessionId: fallback.preservedSessionId } : {}),
    ...(fallback.preservedTargetId ? { preservedTargetId: fallback.preservedTargetId } : {}),
    ...toJsonRecord(fallback.details ?? {})
  };
  const hint = readProviderIssueHint({
    reasonCode,
    details: details as Record<string, unknown>
  });
  const guidance = hint
    ? buildProviderIssueGuidance({ provider: args.provider, hint, details })
    : undefined;
  return new ProviderRuntimeError(
    providerErrorCodeFromReasonCode(reasonCode),
    fallbackDispositionMessage(fallback, args.url),
    {
      provider: args.provider,
      source: args.source,
      retryable: reasonCode === "rate_limited",
      reasonCode,
      details: guidance
        ? { ...details, guidance }
        : details
    }
  );
};

export const toBrowserFallbackObservation = (
  fallback: Pick<BrowserFallbackResponse, "reasonCode" | "mode" | "details">
): BrowserFallbackObservation => ({
  reasonCode: fallback.reasonCode,
  ...(fallback.mode ? { mode: fallback.mode } : {}),
  ...(readFallbackRecord(fallback.details, "cookieDiagnostics")
    ? { cookieDiagnostics: readFallbackRecord(fallback.details, "cookieDiagnostics") }
    : {}),
  ...(readFallbackRecord(fallback.details, "challengeOrchestration")
    ? { challengeOrchestration: readFallbackRecord(fallback.details, "challengeOrchestration") }
    : {})
});

export const browserFallbackObservationDetails = (
  observation: BrowserFallbackObservation | undefined
): Record<string, JsonValue> => (
  observation
    ? {
      browserFallbackReasonCode: observation.reasonCode,
      ...(observation.mode ? { browserFallbackMode: observation.mode } : {}),
      ...(observation.cookieDiagnostics ? { cookieDiagnostics: observation.cookieDiagnostics } : {}),
      ...(observation.challengeOrchestration ? { challengeOrchestration: observation.challengeOrchestration } : {})
    }
    : {}
);

export const browserFallbackObservationAttributes = (
  observation: BrowserFallbackObservation | undefined
): Record<string, JsonValue> => (
  observation
    ? {
      browser_fallback_reason_code: observation.reasonCode,
      ...(observation.mode ? { browser_fallback_mode: observation.mode } : {}),
      ...(observation.cookieDiagnostics
        ? { browser_fallback_cookie_diagnostics: observation.cookieDiagnostics }
        : {}),
      ...(observation.challengeOrchestration
        ? { browser_fallback_challenge_orchestration: observation.challengeOrchestration }
        : {})
    }
    : {}
);

const buildSuspendedIntentSummary = (args: {
  provider: string;
  source: ProviderSource;
  operation: ProviderOperation;
  suspendedIntent?: SuspendedIntentSummary;
  input?: JsonValue;
}): SuspendedIntentSummary => {
  if (args.suspendedIntent) {
    return typeof args.suspendedIntent.input === "undefined" && typeof args.input !== "undefined"
      ? {
        ...args.suspendedIntent,
        input: args.input
      }
      : args.suspendedIntent;
  }
  return {
    kind: DEFAULT_SUSPENDED_INTENT_KIND[args.operation],
    provider: args.provider,
    source: args.source,
    operation: args.operation,
    ...(typeof args.input !== "undefined" ? { input: args.input } : {})
  };
};

export const resolveProviderBrowserFallback = async (args: {
  browserFallbackPort?: BrowserFallbackPort;
  allowEscalation?: boolean;
  provider: string;
  source: ProviderSource;
  operation: ProviderOperation;
  reasonCode: ProviderReasonCode;
  url?: string;
  context?: ProviderContext;
  details?: Record<string, JsonValue>;
  recoveryHints?: ProviderRecoveryHints;
  preferredModes?: BrowserFallbackMode[];
  suspendedIntent?: SuspendedIntentSummary;
  intentInput?: JsonValue;
}): Promise<BrowserFallbackResponse | null> => {
  if (!args.browserFallbackPort || args.allowEscalation === false) {
    return null;
  }

  const runtimePolicy = args.context?.runtimePolicy ?? resolveProviderRuntimePolicy({
    source: args.source,
    recoveryHints: args.recoveryHints
  });

  const fallback = await args.browserFallbackPort.resolve({
    provider: args.provider,
    source: args.source,
    operation: args.operation,
    reasonCode: args.reasonCode,
    trace: args.context?.trace ?? {
      requestId: `provider-fallback-${Date.now()}`,
      provider: args.provider,
      ts: new Date().toISOString()
    },
    ...(args.url ? { url: args.url } : {}),
    ...(typeof args.context?.timeoutMs === "number" ? { timeoutMs: args.context.timeoutMs } : {}),
    ...(args.context?.signal ? { signal: args.context.signal } : {}),
    ...(args.details ? { details: args.details } : {}),
    runtimePolicy,
    ...(args.preferredModes?.length
      ? {
        preferredModes: resolveProviderFallbackModes({
          source: args.source,
          recoveryHints: args.recoveryHints,
          preferredModes: args.preferredModes
        })
      }
      : {}),
    ownerSurface: "provider_fallback",
    resumeMode: "auto",
    suspendedIntent: buildSuspendedIntentSummary({
      provider: args.provider,
      source: args.source,
      operation: args.operation,
      suspendedIntent: args.suspendedIntent ?? args.context?.suspendedIntent,
      input: args.intentInput ?? args.context?.suspendedIntent?.input
    }),
    ...(typeof args.recoveryHints?.settleTimeoutMs === "number"
      ? { settleTimeoutMs: args.recoveryHints.settleTimeoutMs }
      : {}),
    ...(typeof args.recoveryHints?.captureDelayMs === "number"
      ? { captureDelayMs: args.recoveryHints.captureDelayMs }
      : {})
  });

  return {
    ...fallback,
    disposition: fallback.disposition ?? (
      fallback.ok
        ? "completed"
        : fallback.reasonCode === "env_limited"
          ? "deferred"
          : "failed"
    )
  };
};
