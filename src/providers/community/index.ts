import { ProviderRuntimeError } from "../errors";
import { normalizeRecord, normalizeRecords } from "../normalize";
import { assertPostPolicy, type PostPolicyHook } from "../shared/post-policy";
import { isLikelyDocumentUrl } from "../shared/traversal-url";
import { canonicalizeUrl } from "../web/crawler";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderContext,
  ProviderCrawlInput,
  ProviderFetchInput,
  ProviderPostInput,
  ProviderSearchInput
} from "../types";

const COMMUNITY_SOURCE = "community" as const;

type CommunityRow = {
  url: string;
  title?: string;
  content?: string;
  confidence?: number;
  attributes?: Record<string, JsonValue>;
};

type CommunityFetchRow = {
  url?: string;
  title?: string;
  content?: string;
  attributes?: Record<string, JsonValue>;
};

interface TraversalNode {
  url: string;
  hop: number;
  page: number;
  parent: string;
}

export interface CommunityTraversalBudget {
  pageLimit: number;
  hopLimit: number;
  expansionPerRecord: number;
  maxRecords: number;
}

export interface CommunityProviderOptions {
  id?: string;
  platform?: string;
  search?: (input: ProviderSearchInput, context: ProviderContext) => Promise<CommunityRow[]>;
  fetch?: (input: ProviderFetchInput, context: ProviderContext) => Promise<CommunityFetchRow>;
  crawl?: (input: ProviderCrawlInput, context: ProviderContext) => Promise<Array<{ url: string; title?: string; content?: string; attributes?: Record<string, JsonValue> }>>;
  post?: (input: ProviderPostInput, context: ProviderContext) => Promise<{ url?: string; title?: string; content?: string; attributes?: Record<string, JsonValue> }>;
  postPolicyHooks?: PostPolicyHook[];
  defaultTraversal?: Partial<CommunityTraversalBudget>;
}

const DEFAULT_TRAVERSAL: CommunityTraversalBudget = {
  pageLimit: 2,
  hopLimit: 1,
  expansionPerRecord: 5,
  maxRecords: 25
};

const LINK_RE = /https?:\/\/[^\s"'<>]+/g;

const createCapabilities = (id: string, platform: string): ProviderCapabilities => ({
  providerId: id,
  source: COMMUNITY_SOURCE,
  operations: {
    search: { op: "search", supported: true, description: "Search community threads" },
    fetch: { op: "fetch", supported: true, description: "Fetch a community thread or post" },
    crawl: { op: "crawl", supported: true, description: "Crawl linked community discussions" },
    post: { op: "post", supported: true, description: "Create a community post with policy gates" }
  },
  policy: {
    posting: "gated",
    riskNoticeRequired: true,
    confirmationRequired: true
  },
  metadata: {
    platform,
    source: COMMUNITY_SOURCE
  }
});

const asNumber = (value: JsonValue | undefined): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const toPositiveInt = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(1, Math.floor(value));
};

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const coerceStringArray = (value: JsonValue | undefined): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
};

const extractLinks = (
  row: { attributes?: Record<string, JsonValue>; content?: string },
  fallbackUrl: string
): string[] => {
  const attributeLinks = [
    ...coerceStringArray(row.attributes?.links),
    ...coerceStringArray(row.attributes?.threadLinks),
    ...coerceStringArray(row.attributes?.replyLinks),
    ...coerceStringArray(row.attributes?.relatedUrls)
  ];
  const contentLinks = [...(row.content?.match(LINK_RE) ?? [])];
  const deduped = new Set<string>();
  for (const candidate of [...attributeLinks, ...contentLinks]) {
    const canonical = canonicalizeUrl(candidate);
    if (!isHttpUrl(canonical) || canonical === fallbackUrl || !isLikelyDocumentUrl(canonical)) continue;
    deduped.add(canonical);
  }
  return [...deduped].sort((left, right) => left.localeCompare(right));
};

const qualityFlags = (args: {
  url: string;
  title?: string;
  content?: string;
  page: number;
  hop: number;
  expandedLinks: number;
}): Record<string, JsonValue> => ({
  hasUrl: args.url.length > 0,
  hasTitle: typeof args.title === "string" && args.title.length > 0,
  hasContent: typeof args.content === "string" && args.content.length > 0,
  contentChars: args.content?.length ?? 0,
  page: args.page,
  hop: args.hop,
  expanded: args.hop > 0,
  expandedLinks: args.expandedLinks
});

const mergedTraversal = (
  options: CommunityProviderOptions,
  input: { limit?: number; filters?: Record<string, JsonValue> }
): CommunityTraversalBudget => {
  const filters = input.filters ?? {};
  return {
    pageLimit: toPositiveInt(
      asNumber(filters.pageLimit) ?? options.defaultTraversal?.pageLimit,
      DEFAULT_TRAVERSAL.pageLimit
    ),
    hopLimit: toPositiveInt(
      asNumber(filters.hopLimit) ?? options.defaultTraversal?.hopLimit,
      DEFAULT_TRAVERSAL.hopLimit
    ),
    expansionPerRecord: toPositiveInt(
      asNumber(filters.expansionPerRecord) ?? options.defaultTraversal?.expansionPerRecord,
      DEFAULT_TRAVERSAL.expansionPerRecord
    ),
    maxRecords: toPositiveInt(
      input.limit ?? asNumber(filters.maxRecords) ?? options.defaultTraversal?.maxRecords,
      DEFAULT_TRAVERSAL.maxRecords
    )
  };
};

const unavailable = (id: string, message: string): ProviderRuntimeError => {
  return new ProviderRuntimeError("unavailable", message, {
    provider: id,
    source: COMMUNITY_SOURCE
  });
};

const shouldSkipExpansionError = (error: unknown): boolean => {
  if (!(error instanceof ProviderRuntimeError)) return false;
  return error.code === "auth"
    || error.code === "network"
    || error.code === "rate_limited"
    || error.code === "timeout"
    || error.code === "unavailable"
    || error.code === "upstream";
};

const sortRows = <T extends { url: string; title?: string }>(rows: T[]): T[] => {
  return [...rows].sort((left, right) => {
    const leftUrl = canonicalizeUrl(left.url);
    const rightUrl = canonicalizeUrl(right.url);
    const byUrl = leftUrl.localeCompare(rightUrl);
    if (byUrl !== 0) return byUrl;
    return (left.title ?? "").localeCompare(right.title ?? "");
  });
};

export const createCommunityProvider = (options: CommunityProviderOptions = {}): ProviderAdapter => {
  const id = options.id ?? "community/default";
  const platform = options.platform ?? "community";

  const search = async (input: ProviderSearchInput, context: ProviderContext): Promise<NormalizedRecord[]> => {
    if (!input.query.trim()) {
      throw new ProviderRuntimeError("invalid_input", "Community search query is required", {
        provider: id,
        source: COMMUNITY_SOURCE,
        retryable: false
      });
    }
    if (!options.search) {
      throw unavailable(id, "Community search retrieval is not configured");
    }

    const traversal = mergedTraversal(options, input);
    const seen = new Set<string>();
    const pending: TraversalNode[] = [];
    const rows: CommunityRow[] = [];

    for (let page = 1; page <= traversal.pageLimit && rows.length < traversal.maxRecords; page += 1) {
      const pageRows = await options.search({
        ...input,
        filters: {
          ...(input.filters ?? {}),
          page
        }
      }, context);
      for (const row of sortRows(pageRows)) {
        const canonical = canonicalizeUrl(row.url);
        if (!isHttpUrl(canonical) || seen.has(canonical)) continue;
        seen.add(canonical);
        rows.push({
          ...row,
          url: canonical,
          attributes: {
            ...(row.attributes ?? {}),
            traversal: {
              page,
              hop: 0
            },
            extractionQuality: qualityFlags({
              url: canonical,
              title: row.title,
              content: row.content,
              page,
              hop: 0,
              expandedLinks: 0
            })
          }
        });
        if (rows.length >= traversal.maxRecords) break;

        const links = extractLinks(row, canonical).slice(0, traversal.expansionPerRecord);
        for (const link of links) {
          pending.push({
            url: link,
            hop: 1,
            page,
            parent: canonical
          });
        }
      }
    }

    while (options.fetch && pending.length > 0 && rows.length < traversal.maxRecords) {
      const next = pending.shift();
      if (!next || next.hop > traversal.hopLimit) continue;
      const canonical = canonicalizeUrl(next.url);
      if (seen.has(canonical)) continue;

      let fetched: CommunityFetchRow;
      try {
        fetched = await options.fetch({
          url: canonical,
          filters: {
            ...(input.filters ?? {}),
            hop: next.hop,
            parent: next.parent
          }
        }, context);
      } catch (error) {
        if (shouldSkipExpansionError(error)) continue;
        throw error;
      }
      const resolvedUrl = canonicalizeUrl(fetched.url ?? canonical);
      if (!isHttpUrl(resolvedUrl) || seen.has(resolvedUrl)) continue;
      seen.add(resolvedUrl);

      const links = extractLinks(fetched, resolvedUrl).slice(0, traversal.expansionPerRecord);
      rows.push({
        url: resolvedUrl,
        title: fetched.title,
        content: fetched.content,
        confidence: 0.6,
        attributes: {
          ...(fetched.attributes ?? {}),
          traversal: {
            page: next.page,
            hop: next.hop,
            parent: next.parent
          },
          extractionQuality: qualityFlags({
            url: resolvedUrl,
            title: fetched.title,
            content: fetched.content,
            page: next.page,
            hop: next.hop,
            expandedLinks: links.length
          })
        }
      });

      if (next.hop < traversal.hopLimit) {
        for (const link of links) {
          if (seen.has(link)) continue;
          pending.push({
            url: link,
            hop: next.hop + 1,
            page: next.page,
            parent: resolvedUrl
          });
        }
      }
    }

    return normalizeRecords(id, COMMUNITY_SOURCE, rows.slice(0, traversal.maxRecords).map((row) => ({
      url: row.url,
      title: row.title,
      content: row.content,
      confidence: row.confidence ?? 0.65,
      attributes: row.attributes
    })));
  };

  const fetch = async (input: ProviderFetchInput, context: ProviderContext): Promise<NormalizedRecord[]> => {
    if (!options.fetch) {
      throw unavailable(id, "Community fetch retrieval is not configured");
    }
    const row = await options.fetch(input, context);
    const resolvedUrl = canonicalizeUrl(row.url ?? input.url);
    const links = extractLinks(row, resolvedUrl);
    return [normalizeRecord(id, COMMUNITY_SOURCE, {
      url: resolvedUrl,
      title: row.title,
      content: row.content,
      confidence: 0.7,
      attributes: {
        ...(row.attributes ?? {}),
        extractionQuality: qualityFlags({
          url: resolvedUrl,
          title: row.title,
          content: row.content,
          page: 0,
          hop: 0,
          expandedLinks: links.length
        })
      }
    })];
  };

  const crawl = async (input: ProviderCrawlInput, context: ProviderContext): Promise<NormalizedRecord[]> => {
    if (options.crawl) {
      const rows = await options.crawl(input, context);
      return normalizeRecords(id, COMMUNITY_SOURCE, sortRows(rows).map((row) => ({
        url: canonicalizeUrl(row.url),
        title: row.title,
        content: row.content,
        confidence: 0.6,
        attributes: {
          ...(row.attributes ?? {}),
          extractionQuality: qualityFlags({
            url: canonicalizeUrl(row.url),
            title: row.title,
            content: row.content,
            page: 0,
            hop: 0,
            expandedLinks: 0
          })
        }
      })));
    }
    if (!options.fetch) {
      throw unavailable(id, "Community crawl retrieval is not configured");
    }

    const maxPages = Math.max(1, input.maxPages ?? DEFAULT_TRAVERSAL.maxRecords);
    const maxDepth = Math.max(0, input.maxDepth ?? DEFAULT_TRAVERSAL.hopLimit);
    const expansionPerRecord = mergedTraversal(options, {
      filters: input.filters
    }).expansionPerRecord;

    const records: Array<{
      url: string;
      title?: string;
      content?: string;
      attributes?: Record<string, JsonValue>;
    }> = [];
    const seen = new Set<string>();
    const queue: Array<{ url: string; depth: number; parent?: string }> = input.seedUrls.map((url) => ({
      url: canonicalizeUrl(url),
      depth: 0
    }));

    while (queue.length > 0 && records.length < maxPages) {
      const node = queue.shift();
      if (!node || node.depth > maxDepth) continue;
      const canonical = canonicalizeUrl(node.url);
      if (!isHttpUrl(canonical) || seen.has(canonical)) continue;
      seen.add(canonical);

      const row = await options.fetch({
        url: canonical,
        filters: {
          ...(input.filters ?? {}),
          depth: node.depth,
          parent: node.parent ?? ""
        }
      }, context);
      const resolvedUrl = canonicalizeUrl(row.url ?? canonical);
      const links = extractLinks(row, resolvedUrl).slice(0, expansionPerRecord);

      records.push({
        url: resolvedUrl,
        title: row.title,
        content: row.content,
        attributes: {
          ...(row.attributes ?? {}),
          traversal: {
            depth: node.depth,
            parent: node.parent ?? resolvedUrl
          },
          extractionQuality: qualityFlags({
            url: resolvedUrl,
            title: row.title,
            content: row.content,
            page: 0,
            hop: node.depth,
            expandedLinks: links.length
          })
        }
      });

      if (node.depth >= maxDepth) continue;
      for (const link of links) {
        if (seen.has(link)) continue;
        queue.push({
          url: link,
          depth: node.depth + 1,
          parent: resolvedUrl
        });
      }
    }

    return normalizeRecords(id, COMMUNITY_SOURCE, records.map((row) => ({
      url: row.url,
      title: row.title,
      content: row.content,
      confidence: 0.6,
      attributes: row.attributes
    })));
  };

  const post = async (input: ProviderPostInput, context: ProviderContext): Promise<NormalizedRecord[]> => {
    const audit = await assertPostPolicy({
      providerId: id,
      source: COMMUNITY_SOURCE,
      payload: input,
      trace: context.trace
    }, options.postPolicyHooks);

    if (!options.post) {
      throw unavailable(id, "Community posting transport is not configured");
    }

    const row = await options.post(input, context);
    return [normalizeRecord(id, COMMUNITY_SOURCE, {
      url: row.url ?? "",
      title: row.title ?? `Post to ${input.target}`,
      content: row.content ?? input.content,
      confidence: 1,
      attributes: {
        ...(row.attributes ?? {}),
        auditHash: audit.payloadHash,
        decision: audit.decision
      }
    })];
  };

  return {
    id,
    source: COMMUNITY_SOURCE,
    search,
    fetch,
    crawl,
    post,
    health: async () => ({
      status: options.search || options.fetch ? "healthy" : "degraded",
      updatedAt: new Date().toISOString(),
      ...(options.search || options.fetch ? {} : { reason: "Retrieval not configured" })
    }),
    capabilities: () => createCapabilities(id, platform)
  };
};
