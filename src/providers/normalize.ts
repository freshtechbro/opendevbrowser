import { createHash, randomUUID } from "crypto";
import { createProviderError, toProviderError } from "./errors";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderExecutionMetadata,
  ProviderError,
  ProviderOperationFailure,
  ProviderOperationSuccess,
  ProviderSource,
  ProviderTierMetadata,
  TraceContext
} from "./types";

export interface NormalizeRecordInput {
  id?: string;
  url?: string;
  title?: string;
  content?: string;
  timestamp?: string;
  confidence?: number;
  attributes?: Record<string, JsonValue>;
}

export const createTraceContext = (
  seed: Partial<TraceContext> = {},
  provider?: string
): TraceContext => {
  return {
    requestId: seed.requestId ?? randomUUID(),
    ...(seed.sessionId ? { sessionId: seed.sessionId } : {}),
    ...(seed.targetId ? { targetId: seed.targetId } : {}),
    ...(provider ?? seed.provider ? { provider: provider ?? seed.provider } : {}),
    ts: seed.ts ?? new Date().toISOString()
  };
};

export const clampConfidence = (value: number | undefined): number => {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

export const createStableRecordId = (
  provider: string,
  source: ProviderSource,
  value: NormalizeRecordInput
): string => {
  const payload = stableStringify({
    provider,
    source,
    url: value.url ?? "",
    title: value.title ?? "",
    content: value.content ?? "",
    attributes: value.attributes ?? {}
  });

  return createHash("sha1").update(payload).digest("hex").slice(0, 16);
};

export const normalizeRecord = (
  provider: string,
  source: ProviderSource,
  value: NormalizeRecordInput
): NormalizedRecord => {
  const id = value.id ?? createStableRecordId(provider, source, value);
  const timestamp = value.timestamp ?? new Date().toISOString();

  return {
    id,
    source,
    provider,
    ...(value.url ? { url: value.url } : {}),
    ...(value.title ? { title: value.title } : {}),
    ...(value.content ? { content: value.content } : {}),
    timestamp,
    confidence: clampConfidence(value.confidence),
    attributes: value.attributes ?? {}
  };
};

export const normalizeRecords = (
  provider: string,
  source: ProviderSource,
  records: NormalizeRecordInput[]
): NormalizedRecord[] => {
  return records.map((record) => normalizeRecord(provider, source, record));
};

export const normalizeSuccess = (
  provider: string,
  source: ProviderSource,
  records: NormalizeRecordInput[],
  options: {
    trace?: Partial<TraceContext>;
    startedAtMs?: number;
    attempts?: number;
    retries?: number;
    meta?: ProviderExecutionMetadata;
    provenance?: Record<string, JsonValue>;
  } = {}
): ProviderOperationSuccess => {
  const trace = createTraceContext(options.trace, provider);
  const startedAtMs = options.startedAtMs ?? Date.now();

  return {
    ok: true,
    provider,
    source,
    trace,
    records: normalizeRecords(provider, source, records),
    latencyMs: Math.max(0, Date.now() - startedAtMs),
    attempts: options.attempts ?? 1,
    retries: options.retries ?? Math.max(0, (options.attempts ?? 1) - 1),
    ...(options.meta ? { meta: options.meta } : {}),
    ...(options.provenance ? { provenance: options.provenance } : {})
  };
};

export const normalizeFailure = (
  provider: string,
  source: ProviderSource,
  error: unknown,
  options: {
    trace?: Partial<TraceContext>;
    startedAtMs?: number;
    attempts?: number;
    retries?: number;
    meta?: ProviderExecutionMetadata;
    defaultMessage?: string;
    defaultErrorCode?: ProviderError["code"];
  } = {}
): ProviderOperationFailure => {
  const trace = createTraceContext(options.trace, provider);
  const startedAtMs = options.startedAtMs ?? Date.now();
  const mapped = isProviderError(error)
    ? error
    : toProviderError(error, {
      provider,
      source,
      defaultCode: options.defaultErrorCode
    });
  const resolvedError = mapped.message
    ? mapped
    : createProviderError(mapped.code, options.defaultMessage ?? "Provider request failed", {
      retryable: mapped.retryable,
      provider,
      source
    });

  return {
    ok: false,
    provider,
    source,
    trace,
    error: resolvedError,
    latencyMs: Math.max(0, Date.now() - startedAtMs),
    attempts: options.attempts ?? 1,
    retries: options.retries ?? Math.max(0, (options.attempts ?? 1) - 1),
    ...(options.meta ? { meta: options.meta } : {})
  };
};

export const createExecutionMetadata = (params: {
  tier: ProviderTierMetadata;
  provider: string;
  retrievalPath: string;
  retrievedAt?: string;
}): ProviderExecutionMetadata => {
  return {
    tier: params.tier,
    provenance: {
      provider: params.provider,
      retrievalPath: params.retrievalPath,
      retrievedAt: params.retrievedAt ?? new Date().toISOString()
    }
  };
};

const isProviderError = (value: unknown): value is ProviderError => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string"
    && typeof candidate.message === "string"
    && typeof candidate.retryable === "boolean";
};

const stableStringify = (value: JsonValue | Record<string, unknown>): string => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue as JsonValue | Record<string, unknown>)}`);
  return `{${entries.join(",")}}`;
};
