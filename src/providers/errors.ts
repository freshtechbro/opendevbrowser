import type {
  JsonValue,
  ProviderError,
  ProviderErrorCode,
  ProviderReasonCode,
  ProviderSource
} from "./types";

const NETWORK_MESSAGE_RE = /(ECONNRESET|EAI_AGAIN|ENOTFOUND|socket hang up|network)/i;
const RATE_LIMIT_RE = /(rate limit|too many requests|429)/i;
const AUTH_RE = /(unauthorized|forbidden|401|403|auth)/i;
const TIMEOUT_RE = /(timeout|timed out|abort)/i;
const CHALLENGE_RE = /(captcha|challenge|anti.?bot|cf_chl|hcaptcha|recaptcha|interstitial)/i;
const IP_BLOCK_RE = /(ip blocked|ip ban|access denied from your ip|geo.?blocked)/i;
const CAPTION_MISSING_RE = /(caption|subtitle).*(missing|not found|unavailable)|no captions/i;
const TRANSCRIPT_RE = /transcript.*(missing|unavailable|not found)|no transcript/i;
const ENV_LIMITED_RE = /(extension not connected|manual interaction|environment|not available in this environment)/i;

const PROVIDER_REASON_CODES: ProviderReasonCode[] = [
  "ip_blocked",
  "token_required",
  "auth_required",
  "challenge_detected",
  "rate_limited",
  "caption_missing",
  "env_limited",
  "transcript_unavailable",
  "policy_blocked",
  "cooldown_active",
  "strategy_unapproved"
];

const reasonCodeSet = new Set<string>(PROVIDER_REASON_CODES);

export const isProviderReasonCode = (value: unknown): value is ProviderReasonCode => {
  return typeof value === "string" && reasonCodeSet.has(value);
};

const pickStatus = (details: Record<string, JsonValue> | undefined): number | undefined => {
  const status = details?.status;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
};

const readReasonFromDetails = (
  details: Record<string, JsonValue> | undefined
): ProviderReasonCode | undefined => {
  const candidate = details?.reasonCode;
  return isProviderReasonCode(candidate) ? candidate : undefined;
};

export const normalizeProviderReasonCode = (params: {
  code: ProviderErrorCode;
  message?: string;
  status?: number;
  details?: Record<string, JsonValue>;
}): ProviderReasonCode | undefined => {
  const fromDetails = readReasonFromDetails(params.details);
  if (fromDetails) return fromDetails;

  const message = params.message ?? "";
  const status = params.status ?? pickStatus(params.details);

  if (params.code === "policy_blocked") return "policy_blocked";
  if (params.code === "rate_limited" || status === 429 || RATE_LIMIT_RE.test(message)) return "rate_limited";
  if (params.code === "auth" || status === 401 || AUTH_RE.test(message)) return "token_required";
  if (CHALLENGE_RE.test(message)) return "challenge_detected";
  if (IP_BLOCK_RE.test(message)) return "ip_blocked";
  if (CAPTION_MISSING_RE.test(message)) return "caption_missing";
  if (TRANSCRIPT_RE.test(message)) return "transcript_unavailable";
  if (ENV_LIMITED_RE.test(message)) return "env_limited";
  return undefined;
};

export const providerErrorCodeFromReasonCode = (
  reasonCode: ProviderReasonCode | undefined
): ProviderErrorCode => {
  switch (reasonCode) {
    case "rate_limited":
      return "rate_limited";
    case "token_required":
    case "auth_required":
      return "auth";
    case "policy_blocked":
    case "strategy_unapproved":
      return "policy_blocked";
    case "ip_blocked":
      return "upstream";
    case "caption_missing":
    case "transcript_unavailable":
    case "env_limited":
    case "cooldown_active":
    case "challenge_detected":
      return "unavailable";
    default:
      return "unavailable";
  }
};

const withReasonCodeDetails = (
  details: Record<string, JsonValue> | undefined,
  reasonCode: ProviderReasonCode | undefined
): Record<string, JsonValue> | undefined => {
  if (!reasonCode) return details;
  if (details && typeof details.reasonCode === "string") {
    return details;
  }
  return {
    ...(details ?? {}),
    reasonCode
  };
};

export class ProviderRuntimeError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly reasonCode?: ProviderReasonCode;
  readonly provider?: string;
  readonly source?: ProviderSource;
  readonly details?: Record<string, JsonValue>;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      reasonCode?: ProviderReasonCode;
      provider?: string;
      source?: ProviderSource;
      details?: Record<string, JsonValue>;
      cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderRuntimeError";
    this.code = code;
    this.retryable = options.retryable ?? isRetryableByCode(code);
    this.reasonCode = options.reasonCode;
    this.provider = options.provider;
    this.source = options.source;
    this.details = withReasonCodeDetails(options.details, options.reasonCode);
  }
}

export const isRetryableByCode = (code: ProviderErrorCode): boolean => {
  return code === "timeout"
    || code === "network"
    || code === "rate_limited"
    || code === "upstream"
    || code === "unavailable";
};

export const isProviderRuntimeError = (value: unknown): value is ProviderRuntimeError => {
  return value instanceof ProviderRuntimeError;
};

export const createProviderError = (
  code: ProviderErrorCode,
  message: string,
  options: {
    retryable?: boolean;
    reasonCode?: ProviderReasonCode;
    provider?: string;
    source?: ProviderSource;
    details?: Record<string, JsonValue>;
  } = {}
): ProviderError => {
  const reasonCode = options.reasonCode ?? readReasonFromDetails(options.details);
  return {
    code,
    message,
    retryable: options.retryable ?? isRetryableByCode(code),
    ...(reasonCode ? { reasonCode } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.source ? { source: options.source } : {}),
    ...(withReasonCodeDetails(options.details, reasonCode)
      ? { details: withReasonCodeDetails(options.details, reasonCode) }
      : {})
  };
};

export const toProviderError = (
  error: unknown,
  options: {
    provider?: string;
    source?: ProviderSource;
    defaultCode?: ProviderErrorCode;
    details?: Record<string, JsonValue>;
  } = {}
): ProviderError => {
  if (isProviderRuntimeError(error)) {
    const reasonCode = error.reasonCode
      ?? normalizeProviderReasonCode({
        code: error.code,
        message: error.message,
        details: error.details
      });
    return createProviderError(error.code, error.message, {
      retryable: error.retryable,
      reasonCode,
      provider: error.provider ?? options.provider,
      source: error.source ?? options.source,
      details: error.details ?? options.details
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = classifyErrorCode(message, options.defaultCode ?? "internal");
  const reasonCode = normalizeProviderReasonCode({
    code,
    message,
    details: options.details
  });

  return createProviderError(code, message || "Unknown provider failure", {
    reasonCode,
    provider: options.provider,
    source: options.source,
    details: options.details
  });
};

const classifyErrorCode = (message: string, fallback: ProviderErrorCode): ProviderErrorCode => {
  if (!message) return fallback;
  if (TIMEOUT_RE.test(message)) return "timeout";
  if (RATE_LIMIT_RE.test(message)) return "rate_limited";
  if (AUTH_RE.test(message)) return "auth";
  if (NETWORK_MESSAGE_RE.test(message)) return "network";
  if (/not supported|unsupported|not implemented/i.test(message)) return "not_supported";
  if (/unavailable|service down|temporarily unavailable/i.test(message)) return "unavailable";
  return fallback;
};
