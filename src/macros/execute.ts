import type {
  JsonValue,
  ProviderAggregateResult,
  ProviderCallResultByOperation,
  ProviderExecutionMetadata,
  ProviderOperation,
  ProviderRunOptions,
  ProviderSelection
} from "../providers/types";

export type MacroResolution = {
  action: {
    source: ProviderSelection;
    operation: ProviderOperation;
    input: Record<string, unknown>;
  };
  provenance: {
    macro: string;
    provider: string;
    resolvedQuery: string;
    pack: string;
    args: {
      positional: string[];
      named: Record<string, string>;
    };
  };
};

export type MacroRuntimeExecutor = {
  search: (
    input: ProviderCallResultByOperation["search"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  fetch: (
    input: ProviderCallResultByOperation["fetch"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  crawl: (
    input: ProviderCallResultByOperation["crawl"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
  post: (
    input: ProviderCallResultByOperation["post"],
    options?: ProviderRunOptions
  ) => Promise<ProviderAggregateResult>;
};

export type MacroExecutionPayload = {
  records: ProviderAggregateResult["records"];
  failures: ProviderAggregateResult["failures"];
  metrics: ProviderAggregateResult["metrics"];
  meta: {
    ok: ProviderAggregateResult["ok"];
    partial: ProviderAggregateResult["partial"];
    sourceSelection: ProviderAggregateResult["sourceSelection"];
    providerOrder: ProviderAggregateResult["providerOrder"];
    trace: ProviderAggregateResult["trace"];
    tier?: ProviderExecutionMetadata["tier"];
    provenance?: ProviderExecutionMetadata["provenance"];
    error?: ProviderAggregateResult["error"];
  };
  diagnostics?: ProviderAggregateResult["diagnostics"];
};

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requireMacroString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Macro action missing ${label}`);
  }
  return value;
};

const optionalPositiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;

const optionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const optionalJsonRecord = (value: unknown): Record<string, JsonValue> | undefined =>
  isRecordValue(value) ? value as Record<string, JsonValue> : undefined;

const optionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : undefined;
};

const normalizeSearchInput = (input: Record<string, unknown>): ProviderCallResultByOperation["search"] => {
  const query = requireMacroString(input.query, "search.query");
  const limit = optionalPositiveInteger(input.limit);
  const filters = optionalJsonRecord(input.filters);
  return {
    query,
    ...(limit !== undefined ? { limit } : {}),
    ...(filters ? { filters } : {})
  };
};

const normalizeFetchInput = (input: Record<string, unknown>): ProviderCallResultByOperation["fetch"] => {
  const url = requireMacroString(input.url, "fetch.url");
  const filters = optionalJsonRecord(input.filters);
  return {
    url,
    ...(filters ? { filters } : {})
  };
};

const normalizeCrawlInput = (input: Record<string, unknown>): ProviderCallResultByOperation["crawl"] => {
  const seedUrls = optionalStringArray(input.seedUrls);
  if (!seedUrls || seedUrls.length === 0) {
    throw new Error("Macro action missing crawl.seedUrls");
  }

  const strategy = input.strategy === "bfs" || input.strategy === "dfs"
    ? input.strategy
    : undefined;
  const maxDepth = optionalPositiveInteger(input.maxDepth);
  const maxPages = optionalPositiveInteger(input.maxPages);
  const maxPerDomain = optionalPositiveInteger(input.maxPerDomain);
  const filters = optionalJsonRecord(input.filters);

  return {
    seedUrls,
    ...(strategy ? { strategy } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(maxPages !== undefined ? { maxPages } : {}),
    ...(maxPerDomain !== undefined ? { maxPerDomain } : {}),
    ...(filters ? { filters } : {})
  };
};

const normalizePostInput = (input: Record<string, unknown>): ProviderCallResultByOperation["post"] => {
  const target = requireMacroString(input.target, "post.target");
  const content = requireMacroString(input.content, "post.content");
  const mediaUrls = optionalStringArray(input.mediaUrls);
  const confirm = optionalBoolean(input.confirm);
  const riskAccepted = optionalBoolean(input.riskAccepted);
  const metadata = optionalJsonRecord(input.metadata);

  return {
    target,
    content,
    ...(mediaUrls ? { mediaUrls } : {}),
    ...(confirm !== undefined ? { confirm } : {}),
    ...(riskAccepted !== undefined ? { riskAccepted } : {}),
    ...(metadata ? { metadata } : {})
  };
};

const buildRunOptions = (resolution: MacroResolution): ProviderRunOptions => {
  const source = resolution.action.source;
  const providerId = typeof resolution.action.input.providerId === "string"
    && resolution.action.input.providerId.trim()
    ? resolution.action.input.providerId.trim()
    : undefined;
  return {
    source,
    ...(providerId ? { providerIds: [providerId] } : {})
  };
};

export const executeMacroResolution = async (
  resolution: MacroResolution,
  runtime: MacroRuntimeExecutor
): Promise<ProviderAggregateResult> => {
  const { operation, input } = resolution.action;
  if (!isRecordValue(input)) {
    throw new Error("Macro action input is invalid");
  }

  const options = buildRunOptions(resolution);
  switch (operation) {
    case "search":
      return runtime.search(normalizeSearchInput(input), options);
    case "fetch":
      return runtime.fetch(normalizeFetchInput(input), options);
    case "crawl":
      return runtime.crawl(normalizeCrawlInput(input), options);
    case "post":
      return runtime.post(normalizePostInput(input), options);
    default:
      throw new Error(`Macro operation is not supported: ${operation}`);
  }
};

export const shapeExecutionPayload = (result: ProviderAggregateResult): MacroExecutionPayload => {
  return {
    records: result.records,
    failures: result.failures,
    metrics: result.metrics,
    meta: {
      ok: result.ok,
      partial: result.partial,
      sourceSelection: result.sourceSelection,
      providerOrder: result.providerOrder,
      trace: result.trace,
      ...(result.meta?.tier ? { tier: result.meta.tier } : {}),
      ...(result.meta?.provenance ? { provenance: result.meta.provenance } : {}),
      ...(result.error ? { error: result.error } : {})
    },
    ...(result.diagnostics ? { diagnostics: result.diagnostics } : {})
  };
};
