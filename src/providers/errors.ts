import type { JsonValue, ProviderError, ProviderErrorCode, ProviderSource } from "./types";

const NETWORK_MESSAGE_RE = /(ECONNRESET|EAI_AGAIN|ENOTFOUND|socket hang up|network)/i;
const RATE_LIMIT_RE = /(rate limit|too many requests|429)/i;
const AUTH_RE = /(unauthorized|forbidden|401|403|auth)/i;
const TIMEOUT_RE = /(timeout|timed out|abort)/i;

export class ProviderRuntimeError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly source?: ProviderSource;
  readonly details?: Record<string, JsonValue>;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: {
      retryable?: boolean;
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
    this.provider = options.provider;
    this.source = options.source;
    this.details = options.details;
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
    provider?: string;
    source?: ProviderSource;
    details?: Record<string, JsonValue>;
  } = {}
): ProviderError => {
  return {
    code,
    message,
    retryable: options.retryable ?? isRetryableByCode(code),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.source ? { source: options.source } : {}),
    ...(options.details ? { details: options.details } : {})
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
    return createProviderError(error.code, error.message, {
      retryable: error.retryable,
      provider: error.provider ?? options.provider,
      source: error.source ?? options.source,
      details: error.details ?? options.details
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = classifyErrorCode(message, options.defaultCode ?? "internal");

  return createProviderError(code, message || "Unknown provider failure", {
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
