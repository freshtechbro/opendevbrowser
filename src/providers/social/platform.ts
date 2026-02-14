import { ProviderRuntimeError } from "../errors";
import { normalizeRecords } from "../normalize";
import { assertPostPolicy, type PostPolicyHook } from "../shared/post-policy";
import { isLikelyDocumentUrl } from "../shared/traversal-url";
import { canonicalizeUrl } from "../web/crawler";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderContext,
  ProviderFetchInput,
  ProviderPostInput,
  ProviderSearchInput
} from "../types";

const SOCIAL_SOURCE = "social" as const;

export interface SocialSearchRecord {
  url: string;
  title?: string;
  content?: string;
  confidence?: number;
  attributes?: Record<string, JsonValue>;
}

type SocialFetchRecord = {
  url?: string;
  title?: string;
  content?: string;
  attributes?: Record<string, JsonValue>;
};

interface SocialTraversalNode {
  url: string;
  page: number;
  hop: number;
  parent: string;
}

export interface SocialTraversalBudget {
  pageLimit: number;
  hopLimit: number;
  expansionPerRecord: number;
  maxRecords: number;
}

export interface SocialProviderOptions {
  id?: string;
  search?: (input: ProviderSearchInput, context: ProviderContext) => Promise<SocialSearchRecord[]>;
  fetch?: (input: ProviderFetchInput, context: ProviderContext) => Promise<SocialFetchRecord>;
  post?: (input: ProviderPostInput, context: ProviderContext) => Promise<SocialFetchRecord>;
  postPolicyHooks?: PostPolicyHook[];
  defaultTraversal?: Partial<SocialTraversalBudget>;
}

export interface SocialPlatformProfile {
  platform: "x" | "reddit" | "bluesky" | "linkedin" | "instagram" | "tiktok" | "threads";
  displayName: string;
  baseUrl: string;
  maxPostLength: number;
  supportsMedia: boolean;
  supportsThreads: boolean;
}

const DEFAULT_TRAVERSAL: SocialTraversalBudget = {
  pageLimit: 2,
  hopLimit: 1,
  expansionPerRecord: 4,
  maxRecords: 20
};

const LINK_RE = /https?:\/\/[^\s"'<>]+/g;

const capabilitiesForProfile = (providerId: string, profile: SocialPlatformProfile): ProviderCapabilities => ({
  providerId,
  source: SOCIAL_SOURCE,
  operations: {
    search: {
      op: "search",
      supported: true,
      description: `Search ${profile.displayName}`,
      metadata: {
        platform: profile.platform,
        supportsMedia: profile.supportsMedia
      }
    },
    fetch: {
      op: "fetch",
      supported: true,
      description: `Fetch ${profile.displayName} item`
    },
    crawl: {
      op: "crawl",
      supported: false,
      description: "Social crawl is intentionally disabled"
    },
    post: {
      op: "post",
      supported: true,
      description: `Post to ${profile.displayName} with policy confirmation`,
      metadata: {
        maxPostLength: profile.maxPostLength,
        supportsMedia: profile.supportsMedia,
        supportsThreads: profile.supportsThreads
      }
    }
  },
  policy: {
    posting: "gated",
    riskNoticeRequired: true,
    confirmationRequired: true
  },
  metadata: {
    platform: profile.platform,
    displayName: profile.displayName,
    source: SOCIAL_SOURCE,
    maxPostLength: profile.maxPostLength,
    supportsMedia: profile.supportsMedia,
    supportsThreads: profile.supportsThreads
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

const unavailable = (providerId: string, message: string): ProviderRuntimeError => {
  return new ProviderRuntimeError("unavailable", message, {
    provider: providerId,
    source: SOCIAL_SOURCE
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

const mergedTraversal = (
  input: ProviderSearchInput,
  options: SocialProviderOptions
): SocialTraversalBudget => {
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

const normalizeSocialRows = (
  providerId: string,
  profile: SocialPlatformProfile,
  rows: Array<{
    url: string;
    title?: string;
    content?: string;
    confidence?: number;
    attributes?: Record<string, JsonValue>;
  }>
): NormalizedRecord[] => {
  return normalizeRecords(providerId, SOCIAL_SOURCE, rows.map((row) => ({
    url: row.url,
    title: row.title,
    content: row.content,
    confidence: row.confidence,
    attributes: {
      platform: profile.platform,
      ...(row.attributes ?? {})
    }
  })));
};

export const createSocialPlatformProvider = (
  profile: SocialPlatformProfile,
  options: SocialProviderOptions = {}
): ProviderAdapter => {
  const providerId = options.id ?? `social/${profile.platform}`;

  const search = async (input: ProviderSearchInput, context: ProviderContext): Promise<NormalizedRecord[]> => {
    if (!input.query.trim()) {
      throw new ProviderRuntimeError("invalid_input", `${profile.displayName} search query is required`, {
        provider: providerId,
        source: SOCIAL_SOURCE,
        retryable: false
      });
    }
    if (!options.search) {
      throw unavailable(providerId, `${profile.displayName} search retrieval is not configured`);
    }

    const traversal = mergedTraversal(input, options);
    const seen = new Set<string>();
    const queue: SocialTraversalNode[] = [];
    const rows: Array<{
      url: string;
      title?: string;
      content?: string;
      confidence?: number;
      attributes?: Record<string, JsonValue>;
    }> = [];

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
          queue.push({
            url: link,
            page,
            hop: 1,
            parent: canonical
          });
        }
      }
    }

    while (options.fetch && queue.length > 0 && rows.length < traversal.maxRecords) {
      const next = queue.shift();
      if (!next || next.hop > traversal.hopLimit) continue;
      const canonical = canonicalizeUrl(next.url);
      if (seen.has(canonical)) continue;

      let fetched: SocialFetchRecord;
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
          queue.push({
            url: link,
            page: next.page,
            hop: next.hop + 1,
            parent: resolvedUrl
          });
        }
      }
    }

    return normalizeSocialRows(providerId, profile, rows.slice(0, traversal.maxRecords));
  };

  const fetch = async (input: ProviderFetchInput, context: ProviderContext): Promise<NormalizedRecord[]> => {
    if (!options.fetch) {
      throw unavailable(providerId, `${profile.displayName} fetch retrieval is not configured`);
    }
    const row = await options.fetch(input, context);
    const resolvedUrl = canonicalizeUrl(row.url ?? input.url);
    const links = extractLinks(row, resolvedUrl);
    return normalizeSocialRows(providerId, profile, [{
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
    }]);
  };

  const post = async (input: ProviderPostInput, context: ProviderContext): Promise<NormalizedRecord[]> => {
    if (input.content.length > profile.maxPostLength) {
      throw new ProviderRuntimeError("invalid_input", `${profile.displayName} post exceeds max length`, {
        provider: providerId,
        source: SOCIAL_SOURCE,
        retryable: false,
        details: {
          maxPostLength: profile.maxPostLength,
          contentLength: input.content.length
        }
      });
    }

    const audit = await assertPostPolicy({
      providerId,
      source: SOCIAL_SOURCE,
      payload: input,
      trace: context.trace
    }, options.postPolicyHooks);

    if (!options.post) {
      throw unavailable(providerId, `${profile.displayName} posting transport is not configured`);
    }

    const row = await options.post(input, context);
    return normalizeSocialRows(providerId, profile, [{
      url: canonicalizeUrl(row.url ?? `${profile.baseUrl}/${encodeURIComponent(input.target)}`),
      title: row.title ?? `${profile.displayName} post`,
      content: row.content ?? input.content,
      confidence: 1,
      attributes: {
        ...(row.attributes ?? {}),
        auditHash: audit.payloadHash,
        decision: audit.decision
      }
    }]);
  };

  return {
    id: providerId,
    source: SOCIAL_SOURCE,
    search,
    fetch,
    post,
    health: async () => ({
      status: options.search || options.fetch || options.post ? "healthy" : "degraded",
      updatedAt: new Date().toISOString(),
      ...(options.search || options.fetch || options.post ? {} : { reason: "Retrieval not configured" })
    }),
    capabilities: () => capabilitiesForProfile(providerId, profile)
  };
};
