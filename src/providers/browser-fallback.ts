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
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const REDACTED_FALLBACK_URL = "redacted_url";
const REDACTED_FALLBACK_SECRET = "[REDACTED]";
const URL_TEXT_PATTERN = /\b(?:https?:\/\/|chrome-extension:\/\/|data:|about:)[^\s"'<>]+/gi;
const EMAIL_TEXT_PATTERN = /[^\s"'<>@/?#]+@[^\s"'<>@/?#]+/g;
const SENSITIVE_ASSIGNMENT_PATTERN = /(?<![?&])\b(login_hint|loginHint|email|access_token|accessToken|id_token|idToken|refresh_token|refreshToken|client_secret|clientSecret|authorization|token|code|state)(["']?\s*[:=]\s*["']?)(Bearer\s+)?[^\s"'<>},&]+/gi;
const ALWAYS_SENSITIVE_URL_PARAM_NAMES = [
  "login_hint",
  "email",
  "access_token",
  "id_token",
  "refresh_token",
  "client_secret"
] as const;
const OAUTH_CONTEXT_URL_PARAM_NAMES = [
  "code",
  "state"
] as const;
const OAUTH_URL_CONTEXT_MARKERS = [
  "accounts.google.com",
  "oauth",
  "openid",
  "client_id=",
  "redirect_uri=",
  "response_type=",
  "scope="
] as const;
const SENSITIVE_URL_PARAM_NAMES = [
  ...ALWAYS_SENSITIVE_URL_PARAM_NAMES,
  ...OAUTH_CONTEXT_URL_PARAM_NAMES
] as const;
const ALWAYS_SENSITIVE_URL_MARKERS = ALWAYS_SENSITIVE_URL_PARAM_NAMES.map((name) => `${name}=`);
const OAUTH_CONTEXT_URL_MARKERS = OAUTH_CONTEXT_URL_PARAM_NAMES.map((name) => `${name}=`);
const EMAIL_TEXT_DETECTION_PATTERN = /[^\s"'<>@/?#]+@[^\s"'<>@/?#]+/;
const SENSITIVE_JSON_KEYS = new Set([
  "accesstoken",
  "authorization",
  "clientsecret",
  "code",
  "email",
  "idtoken",
  "loginhint",
  "refreshtoken",
  "state",
  "token"
]);
const GOOGLE_AUTH_HOSTS = new Set(["accounts.google.com", "oauth2.googleapis.com"]);

const hasOAuthUrlContext = (lower: string): boolean => {
  return OAUTH_URL_CONTEXT_MARKERS.some((marker) => lower.includes(marker));
};

const hasSensitiveUrlMarker = (value: string): boolean => {
  const lower = value.toLowerCase();
  return ALWAYS_SENSITIVE_URL_MARKERS.some((marker) => lower.includes(marker))
    || (hasOAuthUrlContext(lower) && OAUTH_CONTEXT_URL_MARKERS.some((marker) => lower.includes(marker)));
};

const isGoogleAuthHost = (hostname: string): boolean => GOOGLE_AUTH_HOSTS.has(hostname.toLowerCase());

type FallbackSanitizerContext = {
  rawUrl: string;
  publicUrl: string;
  sensitiveValues: readonly string[];
};

const normalizedSensitiveKey = (key: string): string => key.replace(/[-_\s]/g, "").toLowerCase();

const isSensitiveJsonKey = (key: string | undefined): boolean => (
  typeof key === "string" && SENSITIVE_JSON_KEYS.has(normalizedSensitiveKey(key))
);

const sensitiveUrlParamNames = (rawUrl: string): readonly string[] => {
  return hasOAuthUrlContext(rawUrl.toLowerCase())
    ? SENSITIVE_URL_PARAM_NAMES
    : ALWAYS_SENSITIVE_URL_PARAM_NAMES;
};

const sensitiveParamValuesFromUrl = (rawUrl: string): string[] => {
  try {
    const parsed = new URL(rawUrl);
    const values: string[] = [];
    for (const key of sensitiveUrlParamNames(rawUrl)) {
      values.push(...parsed.searchParams.getAll(key).filter((entry) => entry.length > 0));
    }
    return values;
  } catch {
    return [];
  }
};

const sensitiveParamValues = (rawText: string): string[] => {
  const directValues = sensitiveParamValuesFromUrl(rawText.trim());
  const urlValues = (rawText.match(URL_TEXT_PATTERN) ?? [])
    .flatMap((candidate) => sensitiveParamValuesFromUrl(candidate));
  return [...directValues, ...urlValues];
};

const collectJsonStrings = (value: JsonValue | undefined): string[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJsonStrings(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) => collectJsonStrings(entry));
  }
  return [];
};

const uniqueSensitiveValues = (values: readonly string[]): string[] => {
  return [...new Set(values.filter((value) => value.length > 0))];
};

const buildFallbackSanitizerContext = (
  rawUrl: string,
  publicUrl: string,
  candidates: readonly JsonValue[] = []
): FallbackSanitizerContext => {
  const rawStrings = [rawUrl, publicUrl, ...candidates.flatMap((candidate) => collectJsonStrings(candidate))];
  return {
    rawUrl,
    publicUrl,
    sensitiveValues: uniqueSensitiveValues(rawStrings.flatMap((value) => sensitiveParamValues(value)))
  };
};

const publicSensitiveUrl = (value: string): string => {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (
      !isGoogleAuthHost(parsed.hostname)
      && !hasSensitiveUrlMarker(trimmed)
      && !EMAIL_TEXT_DETECTION_PATTERN.test(trimmed)
    ) {
      return value;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const path = parsed.pathname.replace(EMAIL_TEXT_PATTERN, REDACTED_FALLBACK_SECRET);
      return isGoogleAuthHost(parsed.hostname)
        ? `${parsed.protocol}//${parsed.hostname}/`
        : `${parsed.origin}${path}`;
    }
    if (parsed.protocol === "about:") {
      return `about:${REDACTED_FALLBACK_URL}`;
    }
    return `${parsed.protocol}${REDACTED_FALLBACK_URL}`;
  } catch {
    if (hasSensitiveUrlMarker(trimmed)) {
      return REDACTED_FALLBACK_URL;
    }
    return EMAIL_TEXT_DETECTION_PATTERN.test(trimmed)
      ? value.replace(EMAIL_TEXT_PATTERN, REDACTED_FALLBACK_SECRET)
      : value;
  }
};

const sanitizeFallbackText = (value: string, context: FallbackSanitizerContext): string => {
  const replacedRawUrl = context.rawUrl === context.publicUrl
    ? value
    : value.split(context.rawUrl).join(context.publicUrl);
  const replacedSensitiveValues = context.sensitiveValues.reduce(
    (text, sensitiveValue) => text.split(sensitiveValue).join(REDACTED_FALLBACK_SECRET),
    replacedRawUrl
  );
  return replacedSensitiveValues
    .replace(URL_TEXT_PATTERN, (candidate) => publicSensitiveUrl(candidate))
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key: string, separator: string, bearer: string | undefined) => {
      return `${key}${separator}${bearer ?? ""}${REDACTED_FALLBACK_SECRET}`;
    })
    .replace(EMAIL_TEXT_PATTERN, REDACTED_FALLBACK_SECRET);
};

const sanitizeFallbackJsonValue = (
  value: JsonValue,
  context: FallbackSanitizerContext,
  key?: string,
  sensitiveParent = false
): JsonValue => {
  const sensitiveValue = sensitiveParent || isSensitiveJsonKey(key);
  if (typeof value === "string") {
    return sensitiveValue ? REDACTED_FALLBACK_SECRET : sanitizeFallbackText(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeFallbackJsonValue(entry, context, key, sensitiveValue));
  }
  if (value && typeof value === "object") {
    const record: Record<string, JsonValue> = {};
    for (const [entryKey, entry] of Object.entries(value)) {
      record[entryKey] = sanitizeFallbackJsonValue(entry, context, entryKey, sensitiveValue);
    }
    return record;
  }
  return sensitiveValue ? REDACTED_FALLBACK_SECRET : value;
};

const sanitizeFallbackRecord = (
  value: Record<string, JsonValue>,
  context: FallbackSanitizerContext
): Record<string, JsonValue> => {
  const sanitized = sanitizeFallbackJsonValue(value, context);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized
    : {};
};

export const fallbackDispositionMessage = (
  fallback: BrowserFallbackResponse,
  url: string,
  rawUrl = url
): string => {
  const context = buildFallbackSanitizerContext(rawUrl, url, [
    toJsonRecord(fallback.details ?? {}),
    toJsonRecord(fallback.challenge),
    toJsonRecord(fallback.output)
  ]);
  if (typeof fallback.details?.message === "string" && fallback.details.message.trim().length > 0) {
    return sanitizeFallbackText(fallback.details.message, context);
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

const fallbackPublicUrl = (args: {
  url: string;
}): string => {
  return publicSensitiveUrl(args.url);
};

const fallbackErrorDetails = (args: {
  url: string;
  rawUrl: string;
  fallback: BrowserFallbackResponse;
  extra?: Record<string, JsonValue>;
}): Record<string, JsonValue> => {
  const rawDetails = toJsonRecord(args.fallback.details ?? {});
  const rawExtra = args.extra ?? {};
  const rawChallenge = args.fallback.challenge ? toJsonRecord(args.fallback.challenge) : undefined;
  const context = buildFallbackSanitizerContext(args.rawUrl, args.url, [
    rawDetails,
    rawExtra,
    ...(rawChallenge ? [rawChallenge] : []),
    toJsonRecord(args.fallback.output)
  ]);
  const details = sanitizeFallbackRecord(rawDetails, context);
  const extra = sanitizeFallbackRecord(rawExtra, context);
  const challenge = rawChallenge
    ? sanitizeFallbackRecord(rawChallenge, context)
    : undefined;
  return {
    ...details,
    ...extra,
    url: args.url,
    disposition: args.fallback.disposition,
    ...(args.fallback.mode ? { browserFallbackMode: args.fallback.mode } : {}),
    ...(challenge ? { challenge } : {}),
    ...(args.fallback.preservedSessionId ? { preservedSessionId: args.fallback.preservedSessionId } : {}),
    ...(args.fallback.preservedTargetId ? { preservedTargetId: args.fallback.preservedTargetId } : {})
  };
};

const addProviderIssueGuidance = (args: {
  provider: string;
  reasonCode: ProviderReasonCode;
  details: Record<string, JsonValue>;
  includeCompleted?: boolean;
}): Record<string, JsonValue> => {
  const hint = readProviderIssueHint({
    reasonCode: args.reasonCode,
    details: args.details as Record<string, unknown>
  });
  const guidanceDetails = args.includeCompleted
    ? { ...args.details, disposition: "failed" }
    : args.details;
  const guidance = hint
    ? buildProviderIssueGuidance({ provider: args.provider, hint, details: guidanceDetails })
    : undefined;
  return guidance ? { ...args.details, guidance } : args.details;
};

export const toProviderFallbackError = (args: {
  provider: string;
  source: ProviderSource;
  url: string;
  fallback: BrowserFallbackResponse;
}): ProviderRuntimeError => {
  const { fallback } = args;
  const reasonCode = fallback.reasonCode;
  const publicUrl = fallbackPublicUrl({ url: args.url });
  const details = fallbackErrorDetails({ url: publicUrl, rawUrl: args.url, fallback });
  return new ProviderRuntimeError(
    providerErrorCodeFromReasonCode(reasonCode),
    fallbackDispositionMessage(fallback, publicUrl, args.url),
    {
      provider: args.provider,
      source: args.source,
      retryable: reasonCode === "rate_limited",
      reasonCode,
      details: addProviderIssueGuidance({
        provider: args.provider,
        reasonCode,
        details
      })
    }
  );
};

export const toCompletedFallbackOutputError = (args: {
  provider: string;
  source: ProviderSource;
  url: string;
  fallback: BrowserFallbackResponse;
  outputReason: string;
}): ProviderRuntimeError => {
  const { fallback } = args;
  const reasonCode = fallback.reasonCode;
  const publicUrl = fallbackPublicUrl({ url: args.url });
  const details = fallbackErrorDetails({
    url: publicUrl,
    rawUrl: args.url,
    fallback,
    extra: { fallbackOutputReason: args.outputReason }
  });
  return new ProviderRuntimeError(
    providerErrorCodeFromReasonCode(reasonCode),
    `Browser fallback completed for ${publicUrl} without usable HTML content.`,
    {
      provider: args.provider,
      source: args.source,
      retryable: reasonCode === "rate_limited",
      reasonCode,
      details: addProviderIssueGuidance({
        provider: args.provider,
        reasonCode,
        details,
        includeCompleted: true
      })
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
