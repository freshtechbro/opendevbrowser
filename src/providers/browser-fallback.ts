import { ProviderRuntimeError, providerErrorCodeFromReasonCode } from "./errors";
import type {
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

const DEFAULT_FALLBACK_MODES: Record<ProviderSource, BrowserFallbackMode[]> = {
  web: ["managed_headed"],
  community: ["managed_headed"],
  social: ["managed_headed"],
  shopping: ["managed_headed"]
};

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
  return new ProviderRuntimeError(
    providerErrorCodeFromReasonCode(reasonCode),
    fallbackDispositionMessage(fallback, args.url),
    {
      provider: args.provider,
      source: args.source,
      retryable: reasonCode === "rate_limited",
      reasonCode,
      details: {
        url: args.url,
        disposition: fallback.disposition,
        ...(fallback.challenge ? { challenge: toJsonRecord(fallback.challenge) } : {}),
        ...(fallback.preservedSessionId ? { preservedSessionId: fallback.preservedSessionId } : {}),
        ...(fallback.preservedTargetId ? { preservedTargetId: fallback.preservedTargetId } : {}),
        ...toJsonRecord(fallback.details ?? {})
      }
    }
  );
};

export const resolveProviderFallbackModes = (args: {
  source: ProviderSource;
  recoveryHints?: ProviderRecoveryHints;
  preferredModes?: BrowserFallbackMode[];
}): BrowserFallbackMode[] => {
  const candidates = args.preferredModes?.length
    ? args.preferredModes
    : args.recoveryHints?.preferredFallbackModes?.length
      ? args.recoveryHints.preferredFallbackModes
      : DEFAULT_FALLBACK_MODES[args.source];
  return [...new Set(candidates)];
};

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
    preferredModes: resolveProviderFallbackModes({
      source: args.source,
      recoveryHints: args.recoveryHints,
      preferredModes: args.preferredModes
    }),
    ...(typeof args.context?.useCookies === "boolean" ? { useCookies: args.context.useCookies } : {}),
    ...(args.context?.cookiePolicyOverride ? { cookiePolicyOverride: args.context.cookiePolicyOverride } : {}),
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
