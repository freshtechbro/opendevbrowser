import type { ProviderAggregateResult, ProviderError, ProviderFailureEntry, TraceContext } from "../src/providers/types";
import type { ProviderRuntimeLike } from "../src/tools/deps";

const TRACE_TS = "2026-03-09T00:00:00.000Z";
const RETRIEVED_AT = "2026-03-09T00:00:01.000Z";

const createTrace = (provider: string): TraceContext => ({
  requestId: `trace:${provider}`,
  provider,
  ts: TRACE_TS
});

const createBaseResult = (provider: string, ok: boolean): ProviderAggregateResult => ({
  ok,
  records: [],
  trace: createTrace(provider),
  partial: false,
  failures: [],
  metrics: {
    attempted: 1,
    succeeded: ok ? 1 : 0,
    failed: ok ? 0 : 1,
    retries: 0,
    latencyMs: 1
  },
  sourceSelection: "web",
  providerOrder: [provider],
  meta: {
    tier: {
      selected: "A",
      reasonCode: "default_tier"
    },
    provenance: {
      provider,
      retrievalPath: "test://provider-runtime-mock",
      retrievedAt: RETRIEVED_AT
    }
  }
});

const createFailure = (provider: string): ProviderFailureEntry => ({
  provider,
  source: "web",
  error: {
    code: "auth",
    message: "auth required",
    retryable: false,
    reasonCode: "auth_required",
    provider,
    source: "web"
  } satisfies ProviderError
});

export const createMockProviderRuntime = (): ProviderRuntimeLike => ({
  async search(input, options) {
    const provider = options?.providerIds?.[0] ?? "web/mock-search";
    return {
      ...createBaseResult(provider, true),
      sourceSelection: options?.source ?? "web",
      records: [
        {
          id: "record:search:1",
          source: "web",
          provider,
          url: `https://example.com/search?q=${encodeURIComponent(input.query)}`,
          title: `Result for ${input.query}`,
          content: `Search result for ${input.query}`,
          timestamp: RETRIEVED_AT,
          confidence: 0.98,
          attributes: {
            query: input.query,
            kind: "search"
          }
        }
      ]
    };
  },
  async fetch(input, options) {
    const provider = options?.providerIds?.[0] ?? "web/mock-fetch";
    if (input.url.includes("/i/flow/login")) {
      return {
        ...createBaseResult(provider, false),
        sourceSelection: options?.source ?? "web",
        failures: [createFailure(provider)],
        meta: {
          ...createBaseResult(provider, false).meta,
          blocker: {
            schemaVersion: "1.0",
            type: "auth_required",
            source: "macro_execution",
            reasonCode: "auth_required",
            confidence: 0.95,
            retryable: false,
            detectedAt: RETRIEVED_AT,
            evidence: {
              url: input.url,
              finalUrl: input.url,
              status: 403,
              matchedPatterns: ["redirect_login_flow"],
              networkHosts: ["x.com"]
            },
            actionHints: [{ id: "manual_login", reason: "login required", priority: 1 }]
          }
        },
        error: createFailure(provider).error
      };
    }
    return {
      ...createBaseResult(provider, true),
      sourceSelection: options?.source ?? "web",
      records: [
        {
          id: "record:fetch:1",
          source: "web",
          provider,
          url: input.url,
          title: "Fetched document",
          content: `Fetched ${input.url}`,
          timestamp: RETRIEVED_AT,
          confidence: 0.97,
          attributes: {
            kind: "fetch"
          }
        }
      ]
    };
  },
  async crawl(input, options) {
    const provider = options?.providerIds?.[0] ?? "web/mock-crawl";
    return {
      ...createBaseResult(provider, true),
      sourceSelection: options?.source ?? "web",
      records: input.seedUrls.map((url, index) => ({
        id: `record:crawl:${index + 1}`,
        source: "web",
        provider,
        url,
        title: `Crawl result ${index + 1}`,
        content: `Crawled ${url}`,
        timestamp: RETRIEVED_AT,
        confidence: 0.96,
        attributes: {
          kind: "crawl"
        }
      }))
    };
  },
  async post(input, options) {
    const provider = options?.providerIds?.[0] ?? "web/mock-post";
    return {
      ...createBaseResult(provider, true),
      sourceSelection: options?.source ?? "web",
      records: [
        {
          id: "record:post:1",
          source: "web",
          provider,
          title: `Posted to ${input.target}`,
          content: input.content,
          timestamp: RETRIEVED_AT,
          confidence: 0.99,
          attributes: {
            kind: "post"
          }
        }
      ]
    };
  }
});
