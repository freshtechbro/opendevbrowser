import { ProviderRuntimeError } from "../errors";
import { normalizeRecord, normalizeRecords } from "../normalize";
import { crawlWeb, type CrawlBudget, type CrawlFetcher, type CrawlPipelineBudget } from "./crawler";
import { extractStructuredContent, toSnippet } from "./extract";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderContext,
  ProviderCrawlInput,
  ProviderFetchInput,
  ProviderSearchInput
} from "../types";
import type { WebCrawlPolicy } from "./policy";

export interface WebSearchRecord {
  url: string;
  title?: string;
  content?: string;
  confidence?: number;
  attributes?: Record<string, JsonValue>;
}

export interface WebProviderOptions {
  id?: string;
  fetcher?: CrawlFetcher;
  searchIndex?: (input: ProviderSearchInput, context: ProviderContext) => Promise<WebSearchRecord[]>;
  defaultBudget?: Partial<CrawlBudget>;
  defaultPipeline?: Partial<CrawlPipelineBudget>;
  selectors?: string[];
  workerThreads?: number;
  queueMax?: number;
  forceInlineParse?: boolean;
  policy?: WebCrawlPolicy;
}

const WEB_SOURCE = "web" as const;

const capabilities = (id: string, policy: WebCrawlPolicy | undefined): ProviderCapabilities => ({
  providerId: id,
  source: WEB_SOURCE,
  operations: {
    search: { op: "search", supported: true, description: "Query web content" },
    fetch: { op: "fetch", supported: true, description: "Fetch one web document" },
    crawl: { op: "crawl", supported: true, description: "Budgeted web crawl" },
    post: { op: "post", supported: false, description: "Posting is not supported for web provider" }
  },
  policy: {
    posting: "unsupported",
    riskNoticeRequired: false,
    confirmationRequired: false
  },
  metadata: {
    crawler: true,
    robotsMode: policy?.robotsMode ?? "warn"
  }
});

const fetchOne = async (fetcher: CrawlFetcher, url: string): Promise<{ status: number; html: string }> => {
  const result = await fetcher(url);
  return {
    status: result.status ?? 200,
    html: result.html
  };
};

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const toQualityFlags = (value: {
  url?: string;
  title?: string;
  content?: string;
  linkCount?: number;
}): Record<string, JsonValue> => ({
  hasUrl: typeof value.url === "string" && value.url.length > 0,
  hasTitle: typeof value.title === "string" && value.title.length > 0,
  hasContent: typeof value.content === "string" && value.content.length > 0,
  contentChars: value.content?.length ?? 0,
  linkCount: value.linkCount ?? 0
});

const asPositiveInt = (value: JsonValue | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
};

export const createWebProvider = (options: WebProviderOptions = {}): ProviderAdapter => {
  const id = options.id ?? "web/default";

  const search = async (input: ProviderSearchInput, context: ProviderContext): Promise<NormalizedRecord[]> => {
    if (!input.query.trim()) {
      throw new ProviderRuntimeError("invalid_input", "Search query is required", {
        provider: id,
        source: WEB_SOURCE,
        retryable: false
      });
    }

    if (options.searchIndex) {
      const rows = await options.searchIndex(input, context);
      return normalizeRecords(id, WEB_SOURCE, rows.map((row) => ({
        url: row.url,
        title: row.title,
        content: row.content,
        confidence: row.confidence,
        attributes: {
          ...(row.attributes ?? {}),
          extractionQuality: toQualityFlags({
            url: row.url,
            title: row.title,
            content: row.content
          })
        }
      })));
    }

    if (!options.fetcher) {
      throw new ProviderRuntimeError("unavailable", "Web search retrieval is not configured", {
        provider: id,
        source: WEB_SOURCE
      });
    }

    const queryUrl = input.query.trim();
    if (!isHttpUrl(queryUrl)) {
      throw new ProviderRuntimeError("invalid_input", "Web search query must be an HTTP URL when search index is not configured", {
        provider: id,
        source: WEB_SOURCE,
        retryable: false
      });
    }

    const response = await fetchOne(options.fetcher, queryUrl);
    const extracted = extractStructuredContent(response.html, queryUrl);
    return [normalizeRecord(id, WEB_SOURCE, {
      url: queryUrl,
      title: queryUrl,
      content: toSnippet(extracted.text),
      confidence: 0.4,
      attributes: {
        status: response.status,
        links: extracted.links.length,
        extractionQuality: toQualityFlags({
          url: queryUrl,
          title: queryUrl,
          content: extracted.text,
          linkCount: extracted.links.length
        })
      }
    })];
  };

  const fetch = async (input: ProviderFetchInput): Promise<NormalizedRecord[]> => {
    if (!options.fetcher) {
      throw new ProviderRuntimeError("unavailable", "Web fetcher is not configured", {
        provider: id,
        source: WEB_SOURCE
      });
    }

    const response = await fetchOne(options.fetcher, input.url);
    const extracted = extractStructuredContent(response.html, input.url);

    return [normalizeRecord(id, WEB_SOURCE, {
      url: input.url,
      title: input.url,
      content: extracted.text,
      confidence: 0.6,
      attributes: {
        status: response.status,
        links: extracted.links,
        selectors: extracted.selectors,
        extractionQuality: toQualityFlags({
          url: input.url,
          title: input.url,
          content: extracted.text,
          linkCount: extracted.links.length
        })
      }
    })];
  };

  const crawl = async (input: ProviderCrawlInput): Promise<NormalizedRecord[]> => {
    if (!options.fetcher) {
      throw new ProviderRuntimeError("unavailable", "Web crawler fetcher is not configured", {
        provider: id,
        source: WEB_SOURCE
      });
    }

    if (input.seedUrls.length === 0) {
      throw new ProviderRuntimeError("invalid_input", "At least one crawl seed URL is required", {
        provider: id,
        source: WEB_SOURCE,
        retryable: false
      });
    }

    const adaptiveFetchConcurrency = asPositiveInt(input.filters?.fetchConcurrency);
    const adaptiveFrontierMax = asPositiveInt(input.filters?.frontierMax);

    const crawlResult = await crawlWeb({
      fetcher: options.fetcher,
      strategy: input.strategy,
      policy: options.policy,
      selectors: options.selectors,
      seeds: input.seedUrls,
      budget: {
        ...options.defaultBudget,
        maxDepth: input.maxDepth ?? options.defaultBudget?.maxDepth,
        maxPages: input.maxPages ?? options.defaultBudget?.maxPages,
        maxPerDomain: input.maxPerDomain ?? options.defaultBudget?.maxPerDomain
      },
      pipeline: {
        ...(options.defaultPipeline ?? {}),
        ...(adaptiveFetchConcurrency !== undefined ? { fetchConcurrency: adaptiveFetchConcurrency } : {}),
        ...(adaptiveFrontierMax !== undefined ? { frontierMax: adaptiveFrontierMax } : {}),
        ...(typeof options.workerThreads === "number" ? { workerThreads: options.workerThreads } : {}),
        ...(typeof options.queueMax === "number" ? { queueMax: options.queueMax } : {})
      },
      workerThreads: options.workerThreads,
      queueMax: options.queueMax,
      forceInlineParse: options.forceInlineParse
    });

    return crawlResult.pages.map((page) => normalizeRecord(id, WEB_SOURCE, {
      url: page.url,
      title: page.url,
      content: page.text,
      confidence: 0.7,
      attributes: {
        depth: page.depth,
        status: page.status,
        links: page.links,
        warnings: page.warnings,
        crawlWarnings: crawlResult.warnings,
        crawlMetrics: {
          visited: crawlResult.metrics.visited,
          fetched: crawlResult.metrics.fetched,
          deduped: crawlResult.metrics.deduped,
          elapsedMs: crawlResult.metrics.elapsedMs,
          pagesPerMinute: crawlResult.metrics.pagesPerMinute,
          p50LatencyMs: crawlResult.metrics.p50LatencyMs,
          p95LatencyMs: crawlResult.metrics.p95LatencyMs
        },
        extractionQuality: toQualityFlags({
          url: page.url,
          title: page.url,
          content: page.text,
          linkCount: page.links.length
        })
      }
    }));
  };

  return {
    id,
    source: WEB_SOURCE,
    search,
    fetch,
    crawl,
    health: async () => ({
      status: options.fetcher ? "healthy" : "degraded",
      updatedAt: new Date().toISOString(),
      ...(options.fetcher ? {} : { reason: "Fetcher not configured" })
    }),
    capabilities: () => capabilities(id, options.policy)
  };
};
