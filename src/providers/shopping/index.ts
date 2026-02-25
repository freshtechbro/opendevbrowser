import { ProviderRuntimeError, normalizeProviderReasonCode, toProviderError } from "../errors";
import { normalizeRecord, normalizeRecords } from "../normalize";
import { providerRequestHeaders } from "../shared/request-headers";
import { canonicalizeUrl } from "../web/crawler";
import { extractStructuredContent, toSnippet } from "../web/extract";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderContext,
  ProviderErrorCode,
  ProviderFetchInput,
  ProviderHealth,
  ProviderReasonCode,
  ProviderSearchInput
} from "../types";

const SHOPPING_SOURCE = "shopping" as const;
const DEFAULT_CURRENCY = "USD";

export type ShoppingProviderName =
  | "amazon"
  | "walmart"
  | "bestbuy"
  | "ebay"
  | "target"
  | "costco"
  | "macys"
  | "aliexpress"
  | "temu"
  | "newegg"
  | "others";

export type ShoppingProviderId = `shopping/${ShoppingProviderName}`;

export interface ShoppingProviderProfile {
  name: ShoppingProviderName;
  id: ShoppingProviderId;
  displayName: string;
  domains: string[];
  tier: "tier1" | "tier2";
  extractionFocus: string;
  legalReview: ProviderLegalReviewChecklist;
  searchPath: (query: string) => string;
}

export interface ProviderLegalReviewChecklist {
  providerId: string;
  termsReviewDate: string;
  allowedExtractionSurfaces: string[];
  prohibitedFlows: string[];
  reviewer: string;
  approvalExpiryDate: string;
  signedOff: boolean;
}

export type LegalReviewReasonCode =
  | "missing_checklist"
  | "provider_mismatch"
  | "missing_terms_review_date"
  | "invalid_terms_review_date"
  | "missing_allowed_surfaces"
  | "missing_prohibited_flows"
  | "missing_reviewer"
  | "missing_approval_expiry"
  | "invalid_approval_expiry"
  | "approval_expired"
  | "not_signed_off";

export interface LegalReviewValidationResult {
  valid: boolean;
  reasonCode?: LegalReviewReasonCode;
}

export interface ShoppingSearchRecord {
  url: string;
  title?: string;
  content?: string;
  confidence?: number;
  attributes?: Record<string, JsonValue>;
}

interface ShoppingFetchRecord {
  status: number;
  url: string;
  html: string;
}

export type ShoppingFetcher = (args: {
  url: string;
  signal?: AbortSignal;
  provider: string;
  operation: "search" | "fetch";
  context?: ProviderContext;
}) => Promise<ShoppingFetchRecord>;

export interface ShoppingProviderOptions {
  id?: string;
  search?: (input: ProviderSearchInput, context: ProviderContext) => Promise<ShoppingSearchRecord[]>;
  fetch?: (input: ProviderFetchInput, context: ProviderContext) => Promise<ShoppingSearchRecord>;
  fetcher?: ShoppingFetcher;
}

export type ShoppingProvidersOptions = Partial<Record<ShoppingProviderName, ShoppingProviderOptions>>;

const DEFAULT_ALLOWED_SURFACES = [
  "public search result pages",
  "public product detail pages",
  "public metadata tags"
];

const DEFAULT_PROHIBITED_FLOWS = [
  "checkout workflows",
  "account/profile pages",
  "authenticated purchase APIs"
];

const DEFAULT_REVIEWER = "opendevbrowser-compliance";
const DEFAULT_TERMS_REVIEW_DATE = "2026-02-16";
const DEFAULT_APPROVAL_EXPIRY = "2030-12-31T00:00:00.000Z";

const createLegalReviewChecklist = (
  providerId: ShoppingProviderId,
  termsReviewDate = DEFAULT_TERMS_REVIEW_DATE,
  approvalExpiryDate = DEFAULT_APPROVAL_EXPIRY
): ProviderLegalReviewChecklist => ({
  providerId,
  termsReviewDate,
  allowedExtractionSurfaces: [...DEFAULT_ALLOWED_SURFACES],
  prohibitedFlows: [...DEFAULT_PROHIBITED_FLOWS],
  reviewer: DEFAULT_REVIEWER,
  approvalExpiryDate,
  signedOff: true
});

export const SHOPPING_PROVIDER_PROFILES: ShoppingProviderProfile[] = [
  {
    name: "amazon",
    id: "shopping/amazon",
    displayName: "Amazon",
    domains: ["amazon.com"],
    tier: "tier1",
    extractionFocus: "PDP title/price/availability, offer blocks, image gallery",
    legalReview: createLegalReviewChecklist("shopping/amazon"),
    searchPath: (query) => `https://www.amazon.com/s?k=${encodeURIComponent(query)}`
  },
  {
    name: "walmart",
    id: "shopping/walmart",
    displayName: "Walmart",
    domains: ["walmart.com"],
    tier: "tier1",
    extractionFocus: "Search cards, PDP price modules, delivery/pickup availability",
    legalReview: createLegalReviewChecklist("shopping/walmart"),
    searchPath: (query) => `https://www.walmart.com/search?q=${encodeURIComponent(query)}`
  },
  {
    name: "bestbuy",
    id: "shopping/bestbuy",
    displayName: "Best Buy",
    domains: ["bestbuy.com"],
    tier: "tier1",
    extractionFocus: "Search results, PDP pricing/condition, fulfillment options",
    legalReview: createLegalReviewChecklist("shopping/bestbuy"),
    searchPath: (query) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(query)}`
  },
  {
    name: "ebay",
    id: "shopping/ebay",
    displayName: "eBay",
    domains: ["ebay.com"],
    tier: "tier1",
    extractionFocus: "Listing cards, seller/condition, buy-it-now vs auction fields",
    legalReview: createLegalReviewChecklist("shopping/ebay"),
    searchPath: (query) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`
  },
  {
    name: "target",
    id: "shopping/target",
    displayName: "Target",
    domains: ["target.com"],
    tier: "tier2",
    extractionFocus: "PDP variants, store/ship availability, promotion blocks",
    legalReview: createLegalReviewChecklist("shopping/target"),
    searchPath: (query) => `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`
  },
  {
    name: "costco",
    id: "shopping/costco",
    displayName: "Costco",
    domains: ["costco.com"],
    tier: "tier2",
    extractionFocus: "Membership-aware price blocks, stock notes, package quantity",
    legalReview: createLegalReviewChecklist("shopping/costco"),
    searchPath: (query) => `https://www.costco.com/CatalogSearch?dept=All&keyword=${encodeURIComponent(query)}`
  },
  {
    name: "macys",
    id: "shopping/macys",
    displayName: "Macy's",
    domains: ["macys.com"],
    tier: "tier2",
    extractionFocus: "Category cards, PDP discounts, variant pricing",
    legalReview: createLegalReviewChecklist("shopping/macys"),
    searchPath: (query) => `https://www.macys.com/shop/featured/${encodeURIComponent(query)}`
  },
  {
    name: "aliexpress",
    id: "shopping/aliexpress",
    displayName: "AliExpress",
    domains: ["aliexpress.com"],
    tier: "tier2",
    extractionFocus: "Listing pricing ranges, shipping estimates, seller signals",
    legalReview: createLegalReviewChecklist("shopping/aliexpress"),
    searchPath: (query) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`
  },
  {
    name: "temu",
    id: "shopping/temu",
    displayName: "Temu",
    domains: ["temu.com"],
    tier: "tier2",
    extractionFocus: "Offer cards, coupon/discount overlays, shipping badges",
    legalReview: createLegalReviewChecklist("shopping/temu"),
    searchPath: (query) => `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query)}`
  },
  {
    name: "newegg",
    id: "shopping/newegg",
    displayName: "Newegg",
    domains: ["newegg.com"],
    tier: "tier2",
    extractionFocus: "Tech catalog cards, seller conditions, shipping price/time",
    legalReview: createLegalReviewChecklist("shopping/newegg"),
    searchPath: (query) => `https://www.newegg.com/p/pl?d=${encodeURIComponent(query)}`
  },
  {
    name: "others",
    id: "shopping/others",
    displayName: "Others",
    domains: [],
    tier: "tier2",
    extractionFocus: "JSON-LD Product/Offer, OpenGraph, common PDP selectors",
    legalReview: createLegalReviewChecklist("shopping/others"),
    searchPath: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(`${query} buy`)}`
  }
];

export const SHOPPING_PROVIDER_IDS = SHOPPING_PROVIDER_PROFILES.map((profile) => profile.id);

const hasValues = (values: string[]): boolean => values.some((value) => value.trim().length > 0);

const parseIsoDate = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? NaN : parsed;
};

const SHOPPING_FALLBACK_ERROR_CODES = new Set<ProviderErrorCode>([
  "auth",
  "rate_limited",
  "timeout",
  "network",
  "upstream",
  "unavailable"
]);

const fallbackReasonCodeForError = (error: {
  code: ProviderErrorCode;
  message: string;
  details?: Record<string, JsonValue>;
  reasonCode?: ProviderReasonCode;
}): ProviderReasonCode | undefined => {
  if (error.reasonCode) return error.reasonCode;
  const normalized = normalizeProviderReasonCode({
    code: error.code,
    message: error.message,
    details: error.details
  });
  if (normalized) return normalized;
  if (error.code === "auth") return "token_required";
  if (error.code === "rate_limited") return "rate_limited";
  if (error.code === "upstream") return "ip_blocked";
  if (error.code === "timeout" || error.code === "network" || error.code === "unavailable") return "env_limited";
  return undefined;
};

const readFallbackString = (output: Record<string, JsonValue> | undefined, key: "html" | "url"): string | undefined => {
  const value = output?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const resolveBrowserFallback = async (args: {
  error: ProviderRuntimeError;
  url: string;
  provider: string;
  operation: "search" | "fetch";
  context?: ProviderContext;
}): Promise<ShoppingFetchRecord | null> => {
  const fallbackPort = args.context?.browserFallbackPort;
  if (!fallbackPort) return null;

  const normalized = toProviderError(args.error, {
    provider: args.provider,
    source: SHOPPING_SOURCE
  });
  if (!SHOPPING_FALLBACK_ERROR_CODES.has(normalized.code)) {
    return null;
  }
  const reasonCode = fallbackReasonCodeForError(normalized) ?? "env_limited";

  const fallback = await fallbackPort.resolve({
    provider: args.provider,
    source: SHOPPING_SOURCE,
    operation: args.operation,
    reasonCode,
    trace: args.context?.trace ?? {
      requestId: `shopping-fallback-${Date.now()}`,
      provider: args.provider,
      ts: new Date().toISOString()
    },
    url: args.url,
    details: {
      errorCode: normalized.code,
      message: normalized.message,
      ...(normalized.details ?? {})
    },
    ...(typeof args.context?.useCookies === "boolean" ? { useCookies: args.context.useCookies } : {}),
    ...(args.context?.cookiePolicyOverride ? { cookiePolicyOverride: args.context.cookiePolicyOverride } : {})
  });
  if (!fallback.ok) {
    return null;
  }

  const resolvedUrl = canonicalizeUrl(readFallbackString(fallback.output, "url") ?? args.url);
  return {
    status: 200,
    url: resolvedUrl,
    html: readFallbackString(fallback.output, "html") ?? ""
  };
};

export const validateLegalReviewChecklist = (
  checklist: ProviderLegalReviewChecklist | undefined,
  expectedProviderId: string,
  now: Date = new Date()
): LegalReviewValidationResult => {
  if (!checklist) return { valid: false, reasonCode: "missing_checklist" };
  if (checklist.providerId !== expectedProviderId) return { valid: false, reasonCode: "provider_mismatch" };
  if (!checklist.termsReviewDate.trim()) return { valid: false, reasonCode: "missing_terms_review_date" };
  if (Number.isNaN(parseIsoDate(checklist.termsReviewDate))) return { valid: false, reasonCode: "invalid_terms_review_date" };
  if (!hasValues(checklist.allowedExtractionSurfaces)) return { valid: false, reasonCode: "missing_allowed_surfaces" };
  if (!hasValues(checklist.prohibitedFlows)) return { valid: false, reasonCode: "missing_prohibited_flows" };
  if (!checklist.reviewer.trim()) return { valid: false, reasonCode: "missing_reviewer" };
  if (!checklist.approvalExpiryDate.trim()) return { valid: false, reasonCode: "missing_approval_expiry" };

  const expiry = parseIsoDate(checklist.approvalExpiryDate);
  if (Number.isNaN(expiry)) return { valid: false, reasonCode: "invalid_approval_expiry" };
  if (expiry <= now.getTime()) return { valid: false, reasonCode: "approval_expired" };
  if (!checklist.signedOff) return { valid: false, reasonCode: "not_signed_off" };
  return { valid: true };
};

export const getShoppingProviderProfile = (providerId: string): ShoppingProviderProfile | null => {
  return SHOPPING_PROVIDER_PROFILES.find((profile) => profile.id === providerId) ?? null;
};

export const validateShoppingLegalReviewChecklist = (
  providerId: string,
  now: Date = new Date()
): LegalReviewValidationResult => {
  const profile = getShoppingProviderProfile(providerId);
  if (!profile) return { valid: false, reasonCode: "missing_checklist" };
  return validateLegalReviewChecklist(profile.legalReview, profile.id, now);
};

const defaultFetcher: ShoppingFetcher = async ({ url, signal, provider, operation, context }) => {
  const providerId = provider;
  const resolveFallbackOrThrow = async (error: ProviderRuntimeError): Promise<ShoppingFetchRecord> => {
    const fallback = await resolveBrowserFallback({
      error,
      url,
      provider: providerId,
      operation,
      context
    });
    if (fallback) return fallback;
    throw error;
  };

  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...providerRequestHeaders
      },
      redirect: "follow"
    });
  } catch (error) {
    const runtimeError = new ProviderRuntimeError("network", `Failed to retrieve ${url}`, {
      provider: providerId,
      source: SHOPPING_SOURCE,
      retryable: true,
      cause: error
    });
    return resolveFallbackOrThrow(runtimeError);
  }

  if (response.status === 401 || response.status === 403) {
    const runtimeError = new ProviderRuntimeError("auth", `Authentication required for ${url}`, {
      provider: providerId,
      source: SHOPPING_SOURCE,
      retryable: false,
      reasonCode: "token_required",
      details: { status: response.status, url, reasonCode: "token_required" }
    });
    return resolveFallbackOrThrow(runtimeError);
  }
  if (response.status === 429) {
    const runtimeError = new ProviderRuntimeError("rate_limited", `Rate limited while retrieving ${url}`, {
      provider: providerId,
      source: SHOPPING_SOURCE,
      retryable: true,
      details: { status: response.status, url }
    });
    return resolveFallbackOrThrow(runtimeError);
  }
  if (response.status >= 400) {
    const runtimeError = new ProviderRuntimeError("unavailable", `Retrieval failed for ${url}`, {
      provider: providerId,
      source: SHOPPING_SOURCE,
      retryable: response.status >= 500,
      details: { status: response.status, url }
    });
    return resolveFallbackOrThrow(runtimeError);
  }

  return {
    status: response.status,
    url: response.url || url,
    html: await response.text()
  };
};

const PRICE_RE = /([$€£])\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/;
const RATING_RE = /([0-5](?:\.[0-9])?)\s*(?:out of 5|\/5)/i;
const REVIEWS_RE = /([0-9][0-9,]*)\s*(?:ratings|reviews)/i;

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const parsePrice = (text: string): { amount: number; currency: string } => {
  const match = text.match(PRICE_RE);
  if (!match) {
    return { amount: 0, currency: DEFAULT_CURRENCY };
  }

  const currencySymbol = match[1];
  const raw = match[2]!.replace(/,/g, "");
  const amount = Number(raw);
  const currency = currencySymbol === "€"
    ? "EUR"
    : currencySymbol === "£"
      ? "GBP"
      : DEFAULT_CURRENCY;

  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currency
  };
};

const parseRating = (text: string): number => {
  const match = text.match(RATING_RE);
  if (!match) return 0;
  return Math.max(0, Math.min(5, Number(match[1])));
};

const parseReviews = (text: string): number => {
  const match = text.match(REVIEWS_RE);
  if (!match) return 0;
  const value = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};

const parseAvailability = (text: string): "in_stock" | "limited" | "out_of_stock" | "unknown" => {
  const lower = text.toLowerCase();
  if (/out of stock|sold out|unavailable/.test(lower)) return "out_of_stock";
  if (/limited|few left|only \d+ left/.test(lower)) return "limited";
  if (/in stock|available now|ships/.test(lower)) return "in_stock";
  return "unknown";
};

const dedupeLinks = (links: string[], limit: number): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const link of links) {
    const url = canonicalizeUrl(link);
    if (!isHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    normalized.push(url);
    if (normalized.length >= limit) break;
  }
  return normalized.sort((left, right) => left.localeCompare(right));
};

const deriveOfferAttributes = (args: {
  profile: ShoppingProviderProfile;
  url: string;
  title: string;
  text: string;
  rank: number;
}): Record<string, JsonValue> => {
  const nowIso = new Date().toISOString();
  const price = parsePrice(args.text);
  const rating = parseRating(args.text);
  const reviews = parseReviews(args.text);
  const availability = parseAvailability(args.text);

  return {
    shopping_offer: {
      provider: args.profile.id,
      product_id: `${args.profile.id}:${args.rank}:${Buffer.from(args.url).toString("base64").slice(0, 8)}`,
      title: args.title,
      url: args.url,
      price: {
        amount: price.amount,
        currency: price.currency,
        retrieved_at: nowIso
      },
      shipping: {
        amount: 0,
        currency: price.currency,
        notes: "unknown"
      },
      availability,
      rating,
      reviews_count: reviews,
      capture_timestamp: nowIso
    },
    extractionQuality: {
      hasUrl: args.url.length > 0,
      hasTitle: args.title.length > 0,
      hasContent: args.text.length > 0,
      contentChars: args.text.length,
      linkCount: 0
    },
    providerTier: args.profile.tier,
    extractionFocus: args.profile.extractionFocus,
    canonicalUrl: canonicalizeUrl(args.url)
  };
};

const buildCapabilities = (profile: ShoppingProviderProfile, providerId: string): ProviderCapabilities => ({
  providerId,
  source: SHOPPING_SOURCE,
  operations: {
    search: {
      op: "search",
      supported: true,
      description: `Search ${profile.displayName}`
    },
    fetch: {
      op: "fetch",
      supported: true,
      description: `Fetch ${profile.displayName} product details`
    },
    crawl: {
      op: "crawl",
      supported: false,
      description: "Shopping crawl is disabled by default"
    },
    post: {
      op: "post",
      supported: false,
      description: "Shopping posting is not supported"
    }
  },
  policy: {
    posting: "unsupported",
    riskNoticeRequired: false,
    confirmationRequired: false
  },
  metadata: {
    provider: profile.displayName,
    domains: profile.domains,
    tier: profile.tier,
    extractionFocus: profile.extractionFocus,
    legalReview: {
      termsReviewDate: profile.legalReview.termsReviewDate,
      approvalExpiryDate: profile.legalReview.approvalExpiryDate,
      reviewer: profile.legalReview.reviewer,
      signedOff: profile.legalReview.signedOff
    }
  }
});

const normalizeRows = (
  providerId: string,
  rows: ShoppingSearchRecord[]
): NormalizedRecord[] => normalizeRecords(providerId, SHOPPING_SOURCE, rows);

const createDefaultSearch = (
  profile: ShoppingProviderProfile,
  providerId: string,
  fetcher: ShoppingFetcher
) => async (input: ProviderSearchInput, context: ProviderContext): Promise<ShoppingSearchRecord[]> => {
  const query = input.query.trim();
  if (!query) {
    throw new ProviderRuntimeError("invalid_input", `${profile.displayName} query is required`, {
      provider: providerId,
      source: SHOPPING_SOURCE,
      retryable: false
    });
  }

  const lookupUrl = isHttpUrl(query)
    ? query
    : profile.searchPath(query);
  const fetched = await fetcher({
    url: lookupUrl,
    signal: context.signal,
    provider: providerId,
    operation: "search",
    context
  });
  const extracted = extractStructuredContent(fetched.html, fetched.url);

  const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
  const links = dedupeLinks(extracted.links, limit);
  const content = toSnippet(extracted.text, 2000);

  const rows: ShoppingSearchRecord[] = [
    {
      url: fetched.url,
      title: `${profile.displayName} search: ${query}`,
      content,
      confidence: 0.68,
      attributes: {
        ...deriveOfferAttributes({
          profile,
          url: fetched.url,
          title: `${profile.displayName} search: ${query}`,
          text: extracted.text,
          rank: 0
        }),
        status: fetched.status,
        links,
        retrievalPath: isHttpUrl(query) ? "shopping:search:url" : "shopping:search:index"
      }
    }
  ];

  links.forEach((link, index) => {
    rows.push({
      url: link,
      title: link,
      content: index === 0 ? content : undefined,
      confidence: Math.max(0.45, 0.72 - index * 0.03),
      attributes: {
        ...deriveOfferAttributes({
          profile,
          url: link,
          title: link,
          text: extracted.text,
          rank: index + 1
        }),
        rank: index + 1,
        retrievalPath: "shopping:search:link"
      }
    });
  });

  return rows.slice(0, limit + 1);
};

const createDefaultFetch = (
  profile: ShoppingProviderProfile,
  providerId: string,
  fetcher: ShoppingFetcher
) => async (input: ProviderFetchInput, context: ProviderContext): Promise<ShoppingSearchRecord> => {
  const fetched = await fetcher({
    url: input.url,
    signal: context.signal,
    provider: providerId,
    operation: "fetch",
    context
  });
  const extracted = extractStructuredContent(fetched.html, fetched.url);
  const title = toSnippet(extracted.text, 120) || fetched.url;

  return {
    url: fetched.url,
    title,
    content: extracted.text,
    attributes: {
      ...deriveOfferAttributes({
        profile,
        url: fetched.url,
        title,
        text: extracted.text,
        rank: 1
      }),
      status: fetched.status,
      links: dedupeLinks(extracted.links, 30),
      selectors: extracted.selectors,
      retrievalPath: "shopping:fetch:url"
    }
  };
};

const resolveHealth = (): ProviderHealth => ({
  status: "healthy",
  updatedAt: new Date().toISOString()
});

export const createShoppingProvider = (
  profile: ShoppingProviderProfile,
  options: ShoppingProviderOptions = {}
): ProviderAdapter => {
  const providerId = options.id ?? profile.id;
  const fetcher = options.fetcher ?? defaultFetcher;
  const search = options.search ?? createDefaultSearch(profile, providerId, fetcher);
  const fetch = options.fetch ?? createDefaultFetch(profile, providerId, fetcher);

  return {
    id: providerId,
    source: SHOPPING_SOURCE,
    search: async (input, context) => normalizeRows(providerId, await search(input, context)),
    fetch: async (input, context) => {
      const row = await fetch(input, context);
      return [normalizeRecord(providerId, SHOPPING_SOURCE, row)];
    },
    health: async () => resolveHealth(),
    capabilities: () => buildCapabilities(profile, providerId)
  };
};

export const createShoppingProviders = (options: ShoppingProvidersOptions = {}): ProviderAdapter[] => {
  return SHOPPING_PROVIDER_PROFILES.map((profile) => createShoppingProvider(profile, options[profile.name]));
};

export const createShoppingProviderById = (
  providerId: string,
  options: ShoppingProviderOptions = {}
): ProviderAdapter => {
  const profile = SHOPPING_PROVIDER_PROFILES.find((entry) => entry.id === providerId || entry.name === providerId.replace(/^shopping\//, ""));
  if (!profile) {
    throw new ProviderRuntimeError("invalid_input", `Unknown shopping provider: ${providerId}`, {
      source: SHOPPING_SOURCE,
      retryable: false,
      details: {
        providerId,
        available: SHOPPING_PROVIDER_IDS
      }
    });
  }
  return createShoppingProvider(profile, options);
};
