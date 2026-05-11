import { classifyBlockerSignal } from "../blocker";
import {
  browserFallbackObservationDetails,
  browserFallbackObservationAttributes,
  readFallbackString,
  resolveProviderBrowserFallback,
  toBrowserFallbackObservation,
  toCompletedFallbackOutputError,
  toProviderFallbackError
} from "../browser-fallback";
import { applyProviderIssueHint, classifyProviderIssue, readProviderIssueHint } from "../constraint";
import { providerErrorCodeFromReasonCode, ProviderRuntimeError, toProviderError } from "../errors";
import { normalizeRecord, normalizeRecords } from "../normalize";
import { providerRequestHeaders } from "../shared/request-headers";
import { canonicalizeUrl } from "../web/crawler";
import { extractStructuredContent, extractText, toSnippet } from "../web/extract";
import type { ProviderIssueHint } from "../constraint";
import type { ExtractedContent } from "../web/extract";
import type {
  BrowserFallbackMode,
  BrowserFallbackObservation,
  BrowserFallbackResponse,
  JsonValue,
  NormalizedRecord,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderContext,
  ProviderErrorCode,
  ProviderFetchInput,
  ProviderHealth,
  ProviderRecoveryHints,
  ProviderReasonCode,
  ProviderSearchInput
} from "../types";

const SHOPPING_SOURCE = "shopping" as const;
const DEFAULT_CURRENCY = "USD";
const DEFAULT_RECOVERABLE_SHOPPING_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_SHOPPING_FALLBACK_MODES: BrowserFallbackMode[] = ["extension", "managed_headed"];

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

export interface ShoppingRegionSupportDiagnostic {
  provider: string;
  requestedRegion: string;
  enforced: boolean;
  strategy: "default_storefront";
  storefrontDomain: string | null;
  reason: "provider_search_path_ignores_region";
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
  browserFallback?: BrowserFallbackObservation;
}

interface ShoppingSearchCandidate {
  url: string;
  title: string;
  text: string;
  brand?: string;
  imageUrl?: string;
  price?: ResolvedShoppingPrice;
  rating?: number;
  reviews?: number;
  availability?: "in_stock" | "limited" | "out_of_stock" | "unknown";
}

type ShoppingPriceSource =
  | "structured_metadata"
  | "search_card_context"
  | "search_title_inline"
  | "unresolved";

interface ResolvedShoppingPrice {
  amount: number;
  currency: string;
  source: ShoppingPriceSource;
  trustworthy: boolean;
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
    searchPath: (query) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(query)}&intl=nosplash`
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
    searchPath: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${query} buy`)}`
  }
];

export const SHOPPING_PROVIDER_IDS = SHOPPING_PROVIDER_PROFILES.map((profile) => profile.id);

export const getShoppingRegionSupportDiagnostics = (
  providerIds: string[],
  region: string
): ShoppingRegionSupportDiagnostic[] => {
  const requestedRegion = region.trim().toLowerCase();
  if (!requestedRegion) {
    return [];
  }
  return providerIds.map((providerId) => {
    const profile = SHOPPING_PROVIDER_PROFILES.find((entry) => entry.id === providerId);
    return {
      provider: providerId,
      requestedRegion,
      enforced: false,
      strategy: "default_storefront",
      storefrontDomain: profile?.domains[0] ?? null,
      reason: "provider_search_path_ignores_region"
    };
  });
};

const hasValues = (values: string[]): boolean => values.some((value) => value.trim().length > 0);
const FALLBACK_HEAD_RE = /<head\b[^>]*>[\s\S]*?<\/head>/i;
const FALLBACK_BODY_RE = /<body\b[^>]*>([\s\S]*?)<\/body>/i;
const SHOPPING_FALLBACK_EVIDENCE_LIMIT = 1;

const extractShoppingFallbackBodyText = (html: string): string => {
  const body = FALLBACK_BODY_RE.exec(html)?.[1];
  return extractText(body ?? html.replace(FALLBACK_HEAD_RE, " "));
};

const hasShoppingMetadataEvidence = (extracted: ExtractedContent): boolean => {
  return extracted.metadata.price !== undefined;
};

const hasShoppingOfferTextEvidence = (text: string): boolean => {
  const price = parsePrice(text);
  if (price.amount <= 0) return false;
  return parseRating(text) > 0
    || parseReviews(text) > 0
    || parseAvailability(text) !== "unknown"
    || /\b(?:add to cart|buy now|shipping|pickup|deal|save)\b/i.test(text);
};

const hasShoppingBlockingPageEvidence = (
  url: string,
  extracted: ExtractedContent
): boolean => {
  const blocker = classifyBlockerSignal({
    source: "runtime_fetch",
    url,
    finalUrl: url,
    title: typeof extracted.metadata.title === "string" ? extracted.metadata.title : undefined,
    message: extracted.text,
    status: 200,
    providerErrorCode: "unavailable",
    retryable: true
  });
  return blocker?.type === "auth_required" || blocker?.type === "anti_bot_challenge";
};

const hasShoppingFallbackEvidence = (args: {
  html: string,
  url: string,
  extracted: ExtractedContent,
  profile: ShoppingProviderProfile
}): boolean => {
  return args.extracted.links.some((link) => isLikelyProductUrl(canonicalizeUrl(link), args.profile))
    || extractSearchCandidates(args.html, args.url, args.profile, SHOPPING_FALLBACK_EVIDENCE_LIMIT).length > 0
    || hasShoppingMetadataEvidence(args.extracted)
    || hasShoppingOfferTextEvidence(extractShoppingFallbackBodyText(args.html))
    || hasShoppingBlockingPageEvidence(args.url, args.extracted);
};

const toFallbackShellIssueError = (args: {
  provider: string;
  url: string;
  html: string;
  fallback: BrowserFallbackResponse;
  profile: ShoppingProviderProfile;
  requirement: { reason: string; title?: string; message?: string };
}): ProviderRuntimeError => {
  const issue = classifyProviderIssue({
    url: args.url,
    title: args.requirement.title,
    message: args.requirement.message,
    providerShell: args.requirement.reason,
    browserRequired: true,
    status: 200
  });
  const reasonCode = issue?.reasonCode ?? "env_limited";
  const extracted = extractStructuredContent(args.html, args.url);
  return new ProviderRuntimeError(
    providerErrorCodeFromReasonCode(reasonCode),
    reasonCode === "challenge_detected"
      ? `Detected anti-bot challenge while retrieving ${args.url}`
      : `Browser assistance required for ${args.url}`,
    {
      provider: args.provider,
      source: SHOPPING_SOURCE,
      retryable: reasonCode === "env_limited",
      reasonCode,
      details: {
        ...applyProviderIssueHint({
          status: 200,
          url: args.url,
          ...(args.requirement.title ? { title: args.requirement.title } : {}),
          ...(args.requirement.message ? { message: args.requirement.message } : {}),
          providerShell: args.requirement.reason,
          browserRequired: true,
          extractionFocus: args.profile.extractionFocus,
          extractedTextLength: extracted.text.length,
          extractedLinkCount: extracted.links.length
        }, issue),
        ...browserFallbackObservationDetails(toBrowserFallbackObservation(args.fallback))
      }
    }
  );
};

const parseIsoDate = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? NaN : parsed;
};

const fallbackReasonCodeForError = (error: {
  reasonCode?: ProviderReasonCode;
}): ProviderReasonCode => {
  if (error.reasonCode) return error.reasonCode;
  // resolveBrowserFallback is only reached from the default fetcher's recoverable paths.
  // auth/rate_limited carry explicit reason codes above; the remaining cases are env-limited.
  return "env_limited";
};

const resolveRecoverableFetchTimeoutMs = (context?: ProviderContext): number | undefined => {
  if (!context?.browserFallbackPort) return undefined;
  if (typeof context.timeoutMs !== "number" || !Number.isFinite(context.timeoutMs) || context.timeoutMs <= 0) {
    return DEFAULT_RECOVERABLE_SHOPPING_FETCH_TIMEOUT_MS;
  }
  return Math.max(1, Math.min(context.timeoutMs, DEFAULT_RECOVERABLE_SHOPPING_FETCH_TIMEOUT_MS));
};

const bindRecoverableFetchSignal = (
  signal: AbortSignal | undefined,
  timeoutMs?: number
): { signal?: AbortSignal; didTimeout: () => boolean; dispose: () => void } => {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      signal,
      didTimeout: () => false,
      dispose: () => undefined
    };
  }

  let timedOut = false;
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) {
    abortFromParent();
  } else {
    signal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort("timeout");
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortFromParent);
    }
  };
};

const buildShoppingRecoveryHints = (profile: ShoppingProviderProfile): ProviderRecoveryHints => ({
  preferredFallbackModes: DEFAULT_SHOPPING_FALLBACK_MODES,
  highFrictionTarget: profile.name === "temu" || profile.name === "target",
  challengeProne: profile.name === "temu" || profile.name === "target" || profile.name === "bestbuy",
  settleTimeoutMs: 15000,
  captureDelayMs: 2000
});

const resolveBrowserFallback = async (args: {
  error: ProviderRuntimeError;
  url: string;
  provider: string;
  profile: ShoppingProviderProfile;
  operation: "search" | "fetch";
  recoveryHints: ProviderRecoveryHints;
  context?: ProviderContext;
}): Promise<{
  record: ShoppingFetchRecord | null;
  failure?: ProviderRuntimeError;
}> => {
  const normalized = toProviderError(args.error, {
    provider: args.provider,
    source: SHOPPING_SOURCE
  });
  const reasonCode = fallbackReasonCodeForError(normalized);
  const fallbackIssue = readProviderIssueHint({
    reasonCode: normalized.reasonCode,
    code: normalized.code,
    message: normalized.message,
    details: normalized.details
  });
  const createTimedOutFallbackIssue = (timeoutError: ProviderRuntimeError): ProviderRuntimeError | null => {
    if (!fallbackIssue) return null;
    if (
      fallbackIssue.reasonCode !== "token_required"
      && fallbackIssue.reasonCode !== "challenge_detected"
      && !fallbackIssue.constraint
    ) {
      return null;
    }
    const message = fallbackIssue.reasonCode === "token_required"
      ? `Authentication required for ${args.url}`
      : fallbackIssue.reasonCode === "challenge_detected"
        ? `Detected anti-bot challenge while retrieving ${args.url}`
        : `Browser assistance required for ${args.url}`;
    return new ProviderRuntimeError(
      providerErrorCodeFromReasonCode(fallbackIssue.reasonCode),
      message,
      {
        provider: args.provider,
        source: SHOPPING_SOURCE,
        retryable: fallbackIssue.reasonCode === "env_limited",
        reasonCode: fallbackIssue.reasonCode,
        details: applyProviderIssueHint({
          url: args.url,
          fallbackTimeout: true,
          fallbackTimeoutMessage: timeoutError.message,
          ...(normalized.details ?? {}),
          ...(timeoutError.details ?? {})
        }, fallbackIssue)
      }
    );
  };

  let fallback;
  try {
    fallback = await resolveProviderBrowserFallback({
      browserFallbackPort: args.context?.browserFallbackPort,
      provider: args.provider,
      source: SHOPPING_SOURCE,
      operation: args.operation,
      reasonCode,
      url: args.url,
      context: args.context,
      details: {
        errorCode: normalized.code,
        message: normalized.message,
        ...(normalized.details ?? {})
      },
      recoveryHints: args.recoveryHints
    });
  } catch (error) {
    if (error instanceof ProviderRuntimeError && error.code === "timeout") {
      throw createTimedOutFallbackIssue(error) ?? error;
    }
    throw error;
  }
  if (!fallback) {
    return { record: null };
  }
  if (fallback.disposition !== "completed") {
    const failure = toProviderFallbackError({
      provider: args.provider,
      source: SHOPPING_SOURCE,
      url: args.url,
      fallback
    });
    if (fallback.reasonCode !== "env_limited") {
      throw failure;
    }
    return {
      record: null,
      failure
    };
  }

  const resolvedUrl = canonicalizeUrl(readFallbackString(fallback.output, "url") ?? args.url);
  const html = readFallbackString(fallback.output, "html");
  if (!html) {
    throw toCompletedFallbackOutputError({
      provider: args.provider,
      source: SHOPPING_SOURCE,
      url: resolvedUrl,
      fallback,
      outputReason: "missing_or_empty_html"
    });
  }
  const extracted = extractStructuredContent(html, resolvedUrl);
  const browserRequirement = requiresBrowserAssistance(args.profile, resolvedUrl, html);
  if (browserRequirement) {
    throw toFallbackShellIssueError({
      provider: args.provider,
      url: resolvedUrl,
      html,
      fallback,
      profile: args.profile,
      requirement: browserRequirement
    });
  }
  if (!hasShoppingFallbackEvidence({
    html,
    url: resolvedUrl,
    extracted,
    profile: args.profile
  })) {
    throw toCompletedFallbackOutputError({
      provider: args.provider,
      source: SHOPPING_SOURCE,
      url: resolvedUrl,
      fallback,
      outputReason: "empty_extracted_content"
    });
  }
  return {
    record: {
      status: 200,
      url: resolvedUrl,
      html,
      browserFallback: toBrowserFallbackObservation(fallback)
    }
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
  const profile = getShoppingProviderProfile(providerId) ?? SHOPPING_PROVIDER_PROFILES.at(-1)!;
  const recoveryHints = buildShoppingRecoveryHints(profile);
  const buildSurfaceIssueError = (
    responseUrl: string,
    issue: ReturnType<typeof classifyProviderIssue>,
    details: Record<string, JsonValue>,
    browserFallback?: BrowserFallbackObservation
  ): ProviderRuntimeError => {
    /* c8 ignore next -- browser-assistance classification always returns a reasonCode when issue is present */
    const reasonCode = issue?.reasonCode ?? "env_limited";
    const message = reasonCode === "token_required"
      ? `Authentication required for ${responseUrl}`
      : reasonCode === "challenge_detected"
        ? `Detected anti-bot challenge while retrieving ${responseUrl}`
        : `Browser assistance required for ${responseUrl}`;
    return new ProviderRuntimeError(
      providerErrorCodeFromReasonCode(reasonCode),
      message,
      {
        provider: providerId,
        source: SHOPPING_SOURCE,
        retryable: reasonCode === "env_limited",
        reasonCode,
        details: {
          ...applyProviderIssueHint(details, issue),
          ...browserFallbackObservationDetails(browserFallback)
        }
      }
    );
  };
  const detectFetchedPageError = (
    responseUrl: string,
    status: number,
    html: string,
    browserFallback?: BrowserFallbackObservation
  ): ProviderRuntimeError | null => {
    const extracted = extractStructuredContent(html, responseUrl);
    const message = toSnippet(
      [
        extracted.metadata.title,
        extracted.metadata.description,
        extracted.text
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" "),
      800
    );
    const blocker = classifyBlockerSignal({
      source: "runtime_fetch",
      url: responseUrl,
      finalUrl: responseUrl,
      title: typeof extracted.metadata.title === "string" ? extracted.metadata.title : undefined,
      message,
      status,
      providerErrorCode: "unavailable",
      retryable: true
    });
    if (blocker && blocker.type !== "unknown" && blocker.type !== "env_limited") {
      return new ProviderRuntimeError("unavailable", `Detected ${blocker.type} while retrieving ${responseUrl}`, {
        provider: providerId,
        source: SHOPPING_SOURCE,
        retryable: blocker.retryable,
        reasonCode: blocker.reasonCode ?? "env_limited",
        details: {
          status,
          url: responseUrl,
          blockerType: blocker.type,
          blockerConfidence: blocker.confidence,
          ...(typeof extracted.metadata.title === "string" ? { title: extracted.metadata.title } : {}),
          reasonCode: blocker.reasonCode ?? "env_limited",
          ...browserFallbackObservationDetails(browserFallback)
        }
      });
    }

    const requirement = requiresBrowserAssistance(profile, responseUrl, html);
    if (!requirement) return null;

    const issue = classifyProviderIssue({
      url: responseUrl,
      title: requirement.title,
      message: requirement.message,
      providerShell: requirement.reason,
      browserRequired: true,
      status,
      providerErrorCode: "unavailable",
      retryable: true
    });
    return buildSurfaceIssueError(responseUrl, issue, {
      status,
      url: responseUrl,
      browserRequired: true,
      providerShell: requirement.reason,
      ...(requirement.title ? { title: requirement.title } : {}),
      ...(requirement.message ? { message: requirement.message } : {})
    }, browserFallback);
  };
  const resolveFallbackOrThrow = async (
    error: ProviderRuntimeError,
    options?: { preserveFallbackFailure?: boolean }
  ): Promise<ShoppingFetchRecord> => {
    const fallback = await resolveBrowserFallback({
      error,
      url,
      provider: providerId,
      profile,
      operation,
      recoveryHints,
      context
    });
    if (fallback.record) {
      const fallbackError = detectFetchedPageError(
        fallback.record.url,
        fallback.record.status,
        fallback.record.html,
        fallback.record.browserFallback
      );
      if (fallbackError) {
        throw fallbackError;
      }
      return fallback.record;
    }
    if (options?.preserveFallbackFailure && fallback.failure) {
      throw fallback.failure;
    }
    throw error;
  };

  if (context?.runtimePolicy?.browser.forceTransport) {
    return resolveFallbackOrThrow(
      new ProviderRuntimeError(
        "unavailable",
        `Explicit browser transport requested for ${url}`,
        {
          provider: providerId,
          source: SHOPPING_SOURCE,
          retryable: true,
          reasonCode: "env_limited",
          details: {
            url,
            stage: `${operation}:forced_browser_transport`
          }
        }
      ),
      { preserveFallbackFailure: true }
    );
  }

  let response: Response;
  const rawFetchSignal = bindRecoverableFetchSignal(signal, resolveRecoverableFetchTimeoutMs(context));
  try {
    response = await fetch(url, {
      signal: rawFetchSignal.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...providerRequestHeaders
      },
      redirect: "follow"
    });
  } catch (error) {
    const runtimeError = new ProviderRuntimeError(
      rawFetchSignal.didTimeout() ? "timeout" : "network",
      rawFetchSignal.didTimeout() ? `Timed out retrieving ${url}` : `Failed to retrieve ${url}`,
      {
        provider: providerId,
        source: SHOPPING_SOURCE,
        retryable: true,
        cause: error,
        ...(rawFetchSignal.didTimeout()
          ? {
            details: {
              url,
              stage: `${operation}:raw_fetch_timeout`
            }
          }
          : {})
      }
    );
    return resolveFallbackOrThrow(runtimeError);
  } finally {
    rawFetchSignal.dispose();
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

  const html = await response.text();
  const responseUrl = response.url || url;
  const fetchedPageError = detectFetchedPageError(responseUrl, response.status, html);
  if (fetchedPageError) {
    return await resolveFallbackOrThrow(fetchedPageError);
  }

  return {
    status: response.status,
    url: responseUrl,
    html
  };
};

const PRICE_SYMBOL_RE = /([$€£])\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/;
const PRICE_CODE_RE = /\b(USD|CAD|EUR|GBP)\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/i;
const RATING_RE = /([0-5](?:\.[0-9])?)\s*(?:out of 5|\/5)/i;
const REVIEWS_RE = /([0-9][0-9,]*)\s*(?:ratings|reviews)/i;
const FETCH_TEXT_PRICE_TOKEN_RE = /(?:\b(?:USD|CAD|EUR|GBP)\s*[0-9]{1,4}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?|[$€£]\s*[0-9]{1,4}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/gi;
const FETCH_TEXT_PRICE_NEGATIVE_PREFIX_RE = /\b(?:customer review|reviews?|ratings?|stars?)\b/i;
const FETCH_TEXT_PRICE_MAX_PREFIX_CHARS = 180;
const ANCHOR_RE = /<a\b([^>]*?)href\s*=\s*(?:(["'])(.*?)\2|([^\s>]+))([^>]*)>([\s\S]*?)<\/a>/gi;
const AMAZON_CARD_RE = /<div\b(?=[^>]*\bdata-component-type=(["'])s-search-result\1)(?=[^>]*\bclass=(["'])[^"']*\bs-result-item\b[^"']*\2)[^>]*>[\s\S]*?(?=<div\b(?=[^>]*\bdata-component-type=(["'])s-search-result\3)(?=[^>]*\bclass=(["'])[^"']*\bs-result-item\b[^"']*\4)|$)/gi;
const COSTCO_CARD_RE = /<div\b(?=[^>]*\bdata-testid=(["'])ProductTile_[^"']+\1)[^>]*>[\s\S]*?(?=<div\b(?=[^>]*\bdata-testid=(["'])ProductTile_[^"']+\2)|$)/gi;
const NEWEGG_CARD_RE = /<div class="item-cell"[\s\S]*?(?=<div class="item-cell"|$)/gi;
const EBAY_CARD_RE = /<li\b[^>]*class=(["'])[^"']*\bs-card\b[^"']*\1[^>]*>[\s\S]*?<\/li>/gi;
const GENERIC_NOISE_TITLE_RE = /^(quick view|previous page|next page|home|compare|\([0-9][0-9,]*\))$/i;
const GENERIC_NOISE_URL_RE = /(?:\/(?:p\/pl|s(?:earch)?|signin|login|orders|cart|promotions|clearance|brandstore)\b|#IsFeedbackTab\b|\/Product\/RSS\b|[?&](?:page|k|d|n)=)/i;
const DEFAULT_PRODUCT_URL_HINT_RE = /(?:\/dp\/|\/gp\/product\/|\/p\/[a-z0-9-]+|\/product(?:s)?\/|\/item(?:[/?-]|$)|\/sku\/)/i;
const PROVIDER_PRODUCT_URL_HINT_RE: Partial<Record<ShoppingProviderName, RegExp>> = {
  walmart: /\/ip(?:\/|$)/i,
  bestbuy: /\/site\/[^?#]*\/\d+\.p(?:[?#]|$)/i,
  ebay: /\/itm(?:\/|$)/i,
  costco: /(?:\/|\.)(?:product|warehouse)\.[^?#]+\.html(?:[?#]|$)|[?&](?:prodid|itemnumber)=/i,
  macys: /\/shop\/product\/[^?#]+(?:[?#]|$)/i,
  aliexpress: /\/(?:item|i)\/[^?#]+/i,
  temu: /\/(?:goods\.html|g-[^/?#]+\.html)(?:[?#]|$)/i,
  others: /(?:\/ip(?:\/|$)|\/itm(?:\/|$)|\/product(?:s)?\/|\/sku\/|\/site\/[^?#]*\/\d+\.p(?:[?#]|$)|(?:\/|\.)(?:product|warehouse)\.[^?#]+\.html(?:[?#]|$))/i
};
const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const readAttribute = (tag: string, name: string): string | undefined => {
  const quoted = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  if (quoted?.[2]) return extractText(quoted[2]);
  const unquoted = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
  if (unquoted?.[1]) return extractText(unquoted[1]);
  return undefined;
};

const readAnchorHref = (match: RegExpMatchArray): string | undefined => {
  const quotedHref = match[3];
  if (quotedHref) return quotedHref;
  return match[4];
};

const readAnchorTag = (match: RegExpMatchArray): string => {
  return `<a${match[1] ? ` ${match[1]}` : ""}${match[5] ? ` ${match[5]}` : ""}>`;
};

const readAnchorInnerHtml = (match: RegExpMatchArray): string => {
  return match[6] as string;
};

const hasClassToken = (value: string | undefined, token: string): boolean => {
  if (!value) return false;
  return new RegExp(`(?:^|\\s)${token}(?:\\s|$)`, "i").test(value);
};

const findAnchorByClass = (
  html: string,
  token: string
): { href: string; innerHtml: string; tag: string } | null => {
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = readAnchorHref(match);
    if (!href) continue;
    const tag = readAnchorTag(match);
    if (!hasClassToken(readAttribute(tag, "class"), token)) continue;
    return {
      href,
      innerHtml: readAnchorInnerHtml(match),
      tag
    };
  }
  return null;
};

const resolveCardProductAnchor = (
  html: string,
  baseUrl: string,
  profile: ShoppingProviderProfile
): { url: string; title: string; innerHtml: string } | null => {
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = readAnchorHref(match);
    if (!href) continue;
    const url = normalizeCandidateUrl(href, baseUrl, profile);
    if (!url || !isLikelyProductUrl(url, profile)) continue;
    const tag = readAnchorTag(match);
    const title = extractText(readAnchorInnerHtml(match))
      || readAttribute(tag, "aria-label")
      || readAttribute(tag, "title");
    if (!title || title.length < 20 || GENERIC_NOISE_TITLE_RE.test(title) || isPriceOnlyTitle(title)) continue;
    return {
      url,
      title,
      innerHtml: readAnchorInnerHtml(match)
    };
  }
  return null;
};

const normalizePriceText = (text: string): string => {
  return text
    .replace(/([$€£])\s+/g, "$1")
    .replace(/\b(USD|CAD|EUR|GBP)\s+/gi, (_match, code: string) => `${code.toUpperCase()} `)
    .replace(/(\d)\s*([.,])\s*(\d{2})/g, "$1$2$3");
};

const parsePrice = (text: string): { amount: number; currency: string } => {
  const normalized = normalizePriceText(text);
  const codeMatch = normalized.match(PRICE_CODE_RE);
  if (codeMatch) {
    const amount = Number(codeMatch[2]!.replace(/,/g, ""));
    return {
      amount: Number.isFinite(amount) ? amount : 0,
      currency: codeMatch[1]!.toUpperCase()
    };
  }

  const symbolMatch = normalized.match(PRICE_SYMBOL_RE);
  if (!symbolMatch) {
    return { amount: 0, currency: DEFAULT_CURRENCY };
  }

  const currencySymbol = symbolMatch[1];
  const amount = Number(symbolMatch[2]!.replace(/,/g, ""));
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

const resolveFetchTextPrice = (text: string): ResolvedShoppingPrice | undefined => {
  const normalized = normalizePriceText(text);
  for (const match of normalized.matchAll(FETCH_TEXT_PRICE_TOKEN_RE)) {
    const token = match[0]?.trim();
    const index = match.index ?? -1;
    if (!token || index < 0 || index > FETCH_TEXT_PRICE_MAX_PREFIX_CHARS) {
      continue;
    }
    if (FETCH_TEXT_PRICE_NEGATIVE_PREFIX_RE.test(normalized.slice(0, index))) {
      continue;
    }
    const price = parsePrice(token);
    if (price.amount <= 0) {
      continue;
    }
    return {
      ...price,
      source: "search_card_context",
      trustworthy: false
    };
  }
  return undefined;
};

const resolvePrice = (
  primaryText: string,
  ...fallbackTexts: string[]
): ResolvedShoppingPrice => {
  const primary = parsePrice(primaryText);
  if (primary.amount > 0) {
    return {
      ...primary,
      source: "search_card_context",
      trustworthy: true
    };
  }
  for (const fallbackText of fallbackTexts) {
    const fallback = parsePrice(fallbackText);
    if (fallback.amount > 0) {
      return {
        ...fallback,
        source: "search_title_inline",
        trustworthy: true
      };
    }
  }
  return {
    ...primary,
    source: "unresolved",
    trustworthy: false
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
  if (/in stock|available now|ships|add to cart|free shipping/.test(lower)) return "in_stock";
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

const stripPriceScaffold = (title: string): string => {
  return normalizePriceText(title)
    .replace(/(?:USD|CAD|EUR|GBP)\s*(?=[0-9])/gi, " ")
    .replace(/\b(?:USD|CAD|EUR|GBP|list|price|now|sale|deal|from)\b/gi, " ")
    .replace(/[$€£]/g, " ")
    .replace(/[0-9]+(?:[.,][0-9]+)*/g, " ")
    .replace(/[():/.,-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const RATING_ONLY_TITLE_RE = /^(?:rating\s*)?[0-5](?:\.[0-9])?\s*out of 5 stars?(?:\s*with\s*[0-9][0-9,]*\s*reviews?)?(?:\s*\([0-9][0-9,]*\))?$/i;

const isPriceOnlyTitle = (title: string): boolean => {
  const stripped = stripPriceScaffold(title);
  return stripped.length < 8 || !/[a-z]{4,}/i.test(stripped);
};

const isRatingOnlyTitle = (title: string): boolean => {
  return RATING_ONLY_TITLE_RE.test(title.trim());
};

const TRACKING_DESTINATION_PARAM_KEYS = [
  "uddg",
  "rd",
  "url",
  "u",
  "dest",
  "destination",
  "redirect",
  "redirect_url",
  "target",
  "to"
] as const;

const decodeTrackingDestination = (value: string): string | null => {
  let current = value.trim();
  if (!current) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
};

const decodeHrefValue = (value: string): string => {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/gi, "/");
};

const requiresBrowserAssistance = (
  profile: ShoppingProviderProfile,
  responseUrl: string,
  html: string
): { reason: string; title?: string; message?: string } | null => {
  const extracted = extractStructuredContent(html, responseUrl);
  const title = typeof extracted.metadata.title === "string" ? extracted.metadata.title.trim() : "";
  const text = extracted.text.trim();
  const titleLower = title.toLowerCase();
  const textLower = text.toLowerCase();

  if (profile.name === "bestbuy") {
    const hasInternationalGate = titleLower.includes("best buy international")
      || textLower.includes("best buy international")
      || textLower.includes("select your country")
      || textLower.includes("choose a country");
    if (hasInternationalGate) {
      return {
        reason: "bestbuy_international_gate",
        ...(title ? { title } : {}),
        ...(text ? { message: toSnippet(text, 400) } : {})
      };
    }
    const hasPdpErrorShell = textLower.includes("something went wrong")
      && (
        textLower.includes("use our search bar")
        || textLower.includes("pick a category below")
        || textLower.includes("typed in a url")
      );
    if (hasPdpErrorShell) {
      return {
        reason: "bestbuy_pdp_error_shell",
        ...(title ? { title } : {}),
        ...(text ? { message: toSnippet(text, 400) } : {})
      };
    }
  }

  if (profile.name === "target") {
    const isShellPage = /:\s*target$/i.test(title)
      && textLower.includes("skip to main content")
      && textLower.includes("skip to footer");
    const isNextProductGridShell = /:\s*target$/i.test(title)
      && (html.includes("WEB-search-product-grid-default") || html.includes("__TGT_DATA__"))
      && !/href=(["'])[^"']*\/p\/[^"']+\1/i.test(html);
    if (isShellPage || isNextProductGridShell) {
      return {
        reason: "target_shell_page",
        ...(title ? { title } : {}),
        message: toSnippet(text, 400)
      };
    }
  }

  if (profile.name === "macys") {
    const hasAccessDeniedHeading = titleLower.includes("access denied") || textLower.includes("access denied");
    const isAccessDeniedShell = hasAccessDeniedHeading
      && textLower.includes("you don't have permission to access")
      && (textLower.includes("on this server") || textLower.includes("reference #"));
    if (isAccessDeniedShell) {
      return {
        reason: "macys_access_denied_shell",
        ...(title ? { title } : {}),
        message: toSnippet(text, 400)
      };
    }
  }

  if (profile.name === "temu") {
    const htmlLower = html.toLowerCase();
    const hasChallengeShell = /static(?:-\d+)?\.kwcdn\.com/i.test(html)
      && (html.includes("/upload-static/assets/chl/js/") || textLower.includes("challenge"));
    const hasObfuscatedChallengeShell = htmlLower.includes("challenge")
      && html.length < 12000
      && /function _0x[a-f0-9]+\(/i.test(html);
    if (hasChallengeShell || hasObfuscatedChallengeShell) {
      return {
        reason: "temu_challenge_shell",
        ...(title ? { title } : {}),
        message: "Temu returned a challenge shell that requires a live browser session."
      };
    }
    if (text.length === 0) {
      return {
        reason: "temu_empty_shell",
        ...(title ? { title } : {}),
        message: "Temu returned an empty shell page."
      };
    }
  }

  if (profile.name === "others" && textLower.includes("redirected to the non-javascript site")) {
    return {
      reason: "duckduckgo_non_js_redirect",
      ...(title ? { title } : {}),
      message: toSnippet(text, 400)
    };
  }

  return null;
};

const classifySearchPageIssue = (
  profile: ShoppingProviderProfile,
  fetched: ShoppingFetchRecord,
  extracted: ExtractedContent,
  content: string,
  providerShell: ReturnType<typeof requiresBrowserAssistance> = requiresBrowserAssistance(profile, fetched.url, fetched.html)
): ProviderIssueHint | null => {
  return classifyProviderIssue({
    url: fetched.url,
    title: providerShell?.title ?? (typeof extracted.metadata.title === "string" ? extracted.metadata.title : undefined),
    message: providerShell?.message ?? content,
    providerShell: providerShell?.reason,
    browserRequired: providerShell ? true : undefined,
    status: fetched.status,
    providerErrorCode: "unavailable",
    retryable: true
  });
};

const toExplicitProviderShellIssue = (
  providerShell: NonNullable<ReturnType<typeof requiresBrowserAssistance>>,
  content: string
): ProviderIssueHint => ({
  reasonCode: "env_limited",
  blockerType: "env_limited",
  constraint: {
    kind: "render_required",
    evidenceCode: providerShell.reason,
    providerShell: providerShell.reason,
    ...(content ? { message: content } : {})
  }
});

const ensureProviderShellIssue = (
  issue: ProviderIssueHint | null,
  providerShell: NonNullable<ReturnType<typeof requiresBrowserAssistance>>,
  content: string
): ProviderIssueHint => {
  if (!issue || (issue.reasonCode === "env_limited" && !issue.constraint)) {
    return toExplicitProviderShellIssue(providerShell, content);
  }
  return issue;
};

const toShoppingPageIssueMessage = (reasonCode: ProviderReasonCode, url: string): string => {
  if (reasonCode === "token_required") return `Authentication required for ${url}`;
  if (reasonCode === "env_limited") return `Browser assistance required for ${url}`;
  return `Detected anti-bot challenge while retrieving ${url}`;
};

const throwShoppingPageIssue = (args: {
  providerId: string;
  fetched: ShoppingFetchRecord;
  extracted: ExtractedContent;
  content: string;
  pageIssue: ProviderIssueHint;
  providerShell: ReturnType<typeof requiresBrowserAssistance>;
}): never => {
  const reasonCode = args.pageIssue.reasonCode;
  throw new ProviderRuntimeError(
    providerErrorCodeFromReasonCode(reasonCode),
    toShoppingPageIssueMessage(reasonCode, args.fetched.url),
    {
      provider: args.providerId,
      source: SHOPPING_SOURCE,
      retryable: reasonCode === "env_limited",
      reasonCode,
      details: {
        ...applyProviderIssueHint({
          status: args.fetched.status,
          url: args.fetched.url,
          ...(typeof args.extracted.metadata.title === "string" ? { title: args.extracted.metadata.title } : {}),
          ...(args.content ? { message: args.content } : {}),
          ...(args.providerShell?.reason ? { providerShell: args.providerShell.reason } : {})
        }, args.pageIssue),
        ...(args.providerShell?.reason ? { browserRequired: true } : {}),
        ...browserFallbackObservationDetails(args.fetched.browserFallback)
      }
    }
  );
};

const unwrapTrackingUrl = (url: string, profile: ShoppingProviderProfile): string => {
  const normalizedUrl = decodeHrefValue(url);
  try {
    const parsed = new URL(normalizedUrl);
    for (const key of TRACKING_DESTINATION_PARAM_KEYS) {
      const rawValue = parsed.searchParams.get(key);
      if (!rawValue) continue;
      const decoded = decodeTrackingDestination(rawValue);
      if (!decoded) continue;
      const candidate = canonicalizeUrl(decoded);
      if (isKnownProviderDomain(candidate, profile) && !GENERIC_NOISE_URL_RE.test(candidate) && hasProductUrlHint(candidate, profile)) {
        return candidate;
      }
    }
  } catch {
    // ignore malformed tracking wrappers and continue with string-based recovery
  }

  const schemeIndex = normalizedUrl.indexOf("://");
  const searchFrom = schemeIndex >= 0 ? schemeIndex + 3 : 0;
  const nestedSchemes = [
    normalizedUrl.indexOf("https://", searchFrom),
    normalizedUrl.indexOf("http://", searchFrom)
  ].filter((index) => index >= 0).sort((left, right) => left - right);
  const nestedIndex = nestedSchemes[0];
  if (typeof nestedIndex === "number" && nestedIndex >= 0) {
    const candidate = canonicalizeUrl(normalizedUrl.slice(nestedIndex));
    if (isKnownProviderDomain(candidate, profile) && !GENERIC_NOISE_URL_RE.test(candidate) && hasProductUrlHint(candidate, profile)) {
      return candidate;
    }
  }

  return normalizedUrl;
};

const normalizeCandidateUrl = (href: string, baseUrl: string, profile: ShoppingProviderProfile): string | null => {
  try {
    const resolved = canonicalizeUrl(new URL(decodeHrefValue(href), baseUrl).toString());
    return unwrapTrackingUrl(resolved, profile);
  } catch {
    return null;
  }
};

const isKnownProviderDomain = (url: string, profile: ShoppingProviderProfile): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return profile.domains.length === 0 || profile.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
};

const hasProductUrlHint = (url: string, profile: ShoppingProviderProfile): boolean => {
  const providerHint = PROVIDER_PRODUCT_URL_HINT_RE[profile.name];
  return providerHint?.test(url) === true || DEFAULT_PRODUCT_URL_HINT_RE.test(url);
};

const isLikelyProductUrl = (url: string, profile: ShoppingProviderProfile): boolean => {
  if (!isHttpUrl(url)) return false;
  if (!isKnownProviderDomain(url, profile)) return false;
  if (/\.(?:png|jpe?g|gif|webp|svg|ico|css|js)(?:$|\?)/i.test(url)) return false;
  if (GENERIC_NOISE_URL_RE.test(url)) return false;
  return hasProductUrlHint(url, profile);
};

const candidateUrlKey = (url: string): string => {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/ref=[^/]+$/i, "");
  const amazonDpMatch = parsed.pathname.match(/^(\/[^/]+\/(?:dp|gp\/product)\/[A-Z0-9]+)/i);
  if (amazonDpMatch?.[1]) {
    parsed.pathname = amazonDpMatch[1];
  }
  return canonicalizeUrl(parsed.toString());
};

const scoreCandidate = (candidate: ShoppingSearchCandidate): number => {
  let score = Math.min(candidate.title.length, 180) / 180;
  if (candidate.brand) score += 1;
  if (candidate.price && candidate.price.amount > 0) score += 2;
  if (candidate.rating && candidate.rating > 0) score += 1;
  if (candidate.reviews && candidate.reviews > 0) score += 1;
  if (candidate.availability === "in_stock" || candidate.availability === "limited") score += 0.5;
  if (isPriceOnlyTitle(candidate.title)) score -= 5;
  return score;
};

const dedupeCandidates = (candidates: ShoppingSearchCandidate[], limit: number): ShoppingSearchCandidate[] => {
  const deduped = new Map<string, ShoppingSearchCandidate>();
  for (const candidate of candidates) {
    const key = candidateUrlKey(candidate.url);
    const existing = deduped.get(key);
    if (!existing || scoreCandidate(candidate) > scoreCandidate(existing)) {
      deduped.set(key, candidate);
    }
    if (deduped.size >= limit) break;
  }
  return [...deduped.values()];
};

const toSearchCandidatePrice = (
  price: { amount: number; currency: string },
  source: ShoppingPriceSource = "search_card_context"
): ResolvedShoppingPrice => ({
  ...price,
  source,
  trustworthy: price.amount > 0
});

const extractNeweggSearchCandidates = (
  html: string,
  baseUrl: string,
  profile: ShoppingProviderProfile,
  limit: number
): ShoppingSearchCandidate[] => {
  const candidates: ShoppingSearchCandidate[] = [];
  for (const match of html.matchAll(NEWEGG_CARD_RE)) {
    const cardHtml = match[0];
    const titleAnchor = findAnchorByClass(cardHtml, "item-title");
    if (!titleAnchor?.href) continue;
    const url = normalizeCandidateUrl(titleAnchor.href, baseUrl, profile);
    if (!url || !isLikelyProductUrl(url, profile)) continue;

    const title = extractText(titleAnchor.innerHtml)
      || readAttribute(titleAnchor.tag, "aria-label")
      || readAttribute(titleAnchor.tag, "title");
    if (!title || GENERIC_NOISE_TITLE_RE.test(title)) continue;

    const priceFragment = /<li\b[^>]*class=["'][^"']*price-current[^"']*["'][^>]*>([\s\S]*?)<\/li>/i.exec(cardHtml)?.[1] ?? "";
    const ratingFragment = /aria-label=["']rated ([0-9.]+) out of 5["']/i.exec(cardHtml)?.[1]
      ?? /title=["']Rating \+ ([0-9.]+)["']/i.exec(cardHtml)?.[1];
    const reviewsFragment = /<span\b[^>]*class=["'][^"']*item-rating-num[^"']*["'][^>]*>\(([0-9][0-9,]*)/i.exec(cardHtml)?.[1];
    const brandAnchor = findAnchorByClass(cardHtml, "item-brand");
    const imageAnchor = findAnchorByClass(cardHtml, "item-img");
    const brand = /<li>\s*<strong>\s*Brand:\s*<\/strong>\s*([^<]+)/i.exec(cardHtml)?.[1]
      ?? readAttribute(cardHtml, "data-brand")
      ?? (brandAnchor ? /<img\b[^>]*(?:alt|title)=(["'])(.*?)\1/i.exec(brandAnchor.innerHtml)?.[2] : undefined);
    const imageUrl = imageAnchor ? /<img\b[^>]*src=(["'])(.*?)\1/i.exec(imageAnchor.innerHtml)?.[2] : undefined;
    const text = toSnippet(extractText(cardHtml), 2000);
    const price = parsePrice(priceFragment || text);
    const rating = ratingFragment ? Number(ratingFragment) : parseRating(text);
    const reviews = reviewsFragment ? Number(reviewsFragment.replace(/,/g, "")) : parseReviews(text);
    const availability = parseAvailability(text);

    candidates.push({
      url,
      title,
      text,
      ...(brand ? { brand: extractText(brand) } : {}),
      ...(imageUrl ? { imageUrl: normalizeCandidateUrl(imageUrl, baseUrl, profile) ?? imageUrl } : {}),
      ...(price.amount > 0 ? { price: toSearchCandidatePrice(price) } : {}),
      ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
      ...(Number.isFinite(reviews) && reviews > 0 ? { reviews } : {}),
      availability
    });
    if (candidates.length >= limit) break;
  }
  return dedupeCandidates(candidates, limit);
};

const extractEbaySearchCandidates = (
  html: string,
  baseUrl: string,
  profile: ShoppingProviderProfile,
  limit: number
): ShoppingSearchCandidate[] => {
  const candidates: ShoppingSearchCandidate[] = [];
  for (const match of html.matchAll(EBAY_CARD_RE)) {
    const cardHtml = match[0];
    const linkAnchor = findAnchorByClass(cardHtml, "s-card__link");
    if (!linkAnchor?.href) continue;

    const url = normalizeCandidateUrl(linkAnchor.href, baseUrl, profile);
    if (!url || !isLikelyProductUrl(url, profile)) continue;

    const titleHtml = /<(?:div|span)\b[^>]*class=(["'])[^"']*\bs-card__title\b[^"']*\1[^>]*>([\s\S]*?)<\/(?:div|span)>/i.exec(cardHtml)?.[2]
      ?? linkAnchor.innerHtml;
    const title = extractText(titleHtml).replace(/\bOpens in a new window or tab\b/gi, "").trim()
      || readAttribute(linkAnchor.tag, "aria-label")
      || readAttribute(linkAnchor.tag, "title");
    if (!title || title.length < 20 || GENERIC_NOISE_TITLE_RE.test(title) || isPriceOnlyTitle(title)) continue;

    const text = toSnippet(extractText(cardHtml), 2000);
    const priceFragment = /<(?:div|span)\b[^>]*class=(["'])[^"']*\bs-card__price\b[^"']*\1[^>]*>([\s\S]*?)<\/(?:div|span)>/i.exec(cardHtml)?.[2]
      ?? text;
    const price = parsePrice(priceFragment);
    const rating = parseRating(text);
    const reviews = parseReviews(text);
    const imageUrl = /<img\b[^>]*class=(["'])[^"']*\bs-card__image\b[^"']*\1[^>]*src=(["'])(.*?)\2/i.exec(cardHtml)?.[3]
      ?? /<img\b[^>]*src=(["'])(.*?)\1/i.exec(cardHtml)?.[2];
    const availability = parseAvailability(text);

    candidates.push({
      url,
      title,
      text,
      ...(imageUrl ? { imageUrl: normalizeCandidateUrl(imageUrl, baseUrl, profile) ?? imageUrl } : {}),
      ...(price.amount > 0 ? { price: toSearchCandidatePrice(price) } : {}),
      ...(rating > 0 ? { rating } : {}),
      ...(reviews > 0 ? { reviews } : {}),
      availability
    });
    if (candidates.length >= limit) break;
  }
  return dedupeCandidates(candidates, limit);
};

const extractAmazonSearchCandidates = (
  html: string,
  baseUrl: string,
  profile: ShoppingProviderProfile,
  limit: number
): ShoppingSearchCandidate[] => {
  const candidates: ShoppingSearchCandidate[] = [];
  for (const match of html.matchAll(AMAZON_CARD_RE)) {
    const cardHtml = match[0];
    const anchor = resolveCardProductAnchor(cardHtml, baseUrl, profile);
    if (!anchor) continue;

    const cardText = extractText(cardHtml);
    const text = toSnippet(cardText, 2000);
    const price = resolvePrice(cardText, anchor.title);
    const rating = parseRating(cardText);
    const reviews = parseReviews(cardText);
    const imageUrl = /<img\b[^>]*(?:data-old-hires|data-src|src)=([\"'])(.*?)\1/i.exec(cardHtml)?.[2]
      ?? /<img\b[^>]*(?:data-old-hires|data-src|src)=([^\s>]+)/i.exec(cardHtml)?.[1];
    const availability = parseAvailability(cardText);

    candidates.push({
      url: anchor.url,
      title: anchor.title,
      text,
      ...(imageUrl ? { imageUrl: normalizeCandidateUrl(imageUrl, baseUrl, profile) ?? imageUrl } : {}),
      ...(price.amount > 0 ? { price } : {}),
      ...(rating > 0 ? { rating } : {}),
      ...(reviews > 0 ? { reviews } : {}),
      availability
    });
    if (candidates.length >= limit) break;
  }
  return dedupeCandidates(candidates, limit);
};

const extractCostcoSearchCandidates = (
  html: string,
  baseUrl: string,
  profile: ShoppingProviderProfile,
  limit: number
): ShoppingSearchCandidate[] => {
  const candidates: ShoppingSearchCandidate[] = [];
  for (const match of html.matchAll(COSTCO_CARD_RE)) {
    const cardHtml = match[0];
    const anchor = resolveCardProductAnchor(cardHtml, baseUrl, profile);
    if (!anchor) continue;

    const cardText = extractText(cardHtml);
    const ratingLabel = [...cardHtml.matchAll(/aria-label=(["'])(.*?)\1/gi)]
      .map((match) => match[2]?.trim() ?? "")
      .find((value) => value.includes("out of 5"))
      ?? "";
    const ratingText = `${cardText} ${ratingLabel}`.trim();
    const text = toSnippet(cardText, 2000);
    const price = resolvePrice(cardText, anchor.title);
    const rating = parseRating(ratingText);
    const reviews = parseReviews(ratingText);
    const imageUrl = /<img\b[^>]*src=(["'])(.*?)\1/i.exec(cardHtml)?.[2];
    const availability = parseAvailability(cardText);

    candidates.push({
      url: anchor.url,
      title: anchor.title,
      text,
      ...(imageUrl ? { imageUrl: normalizeCandidateUrl(imageUrl, baseUrl, profile) ?? imageUrl } : {}),
      ...(price.amount > 0 ? { price } : {}),
      ...(rating > 0 ? { rating } : {}),
      ...(reviews > 0 ? { reviews } : {}),
      availability
    });
    if (candidates.length >= limit) break;
  }
  return dedupeCandidates(candidates, limit);
};

const extractGenericSearchCandidates = (
  html: string,
  baseUrl: string,
  profile: ShoppingProviderProfile,
  limit: number
): ShoppingSearchCandidate[] => {
  const candidates: ShoppingSearchCandidate[] = [];
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = readAnchorHref(match);
    if (!href) continue;
    const url = normalizeCandidateUrl(href, baseUrl, profile);
    if (!url || !isLikelyProductUrl(url, profile)) continue;

    const anchorTag = readAnchorTag(match);
    const inner = readAnchorInnerHtml(match);
    const title = extractText(inner)
      || readAttribute(anchorTag, "aria-label")
      || readAttribute(anchorTag, "title");
    if (!title || title.length < 20 || GENERIC_NOISE_TITLE_RE.test(title) || isPriceOnlyTitle(title) || isRatingOnlyTitle(title)) continue;

    const matchIndex = match.index as number;
    const start = Math.max(0, matchIndex - 400);
    const end = Math.min(html.length, matchIndex + inner.length + 1800);
    const context = toSnippet(extractText(html.slice(start, end)), 1800);
    const price = resolvePrice(context, title);
    const rating = parseRating(context);
    const reviews = parseReviews(context);
    const imageUrl = /<img\b[^>]*src=(["'])(.*?)\1/i.exec(inner)?.[2];
    const availability = parseAvailability(context);

    candidates.push({
      url,
      title,
      text: context,
      ...(imageUrl ? { imageUrl: normalizeCandidateUrl(imageUrl, baseUrl, profile) ?? imageUrl } : {}),
      ...(price.amount > 0 ? { price } : {}),
      ...(rating > 0 ? { rating } : {}),
      ...(reviews > 0 ? { reviews } : {}),
      availability
    });
    if (candidates.length >= limit) break;
  }
  return dedupeCandidates(candidates, limit);
};

const extractSearchCandidates = (
  html: string,
  baseUrl: string,
  profile: ShoppingProviderProfile,
  limit: number
): ShoppingSearchCandidate[] => {
  if (profile.name === "amazon") {
    const amazon = extractAmazonSearchCandidates(html, baseUrl, profile, limit);
    if (amazon.length > 0) return amazon;
  }
  if (profile.name === "costco") {
    const costco = extractCostcoSearchCandidates(html, baseUrl, profile, limit);
    if (costco.length > 0) return costco;
  }
  if (profile.name === "ebay") {
    const ebay = extractEbaySearchCandidates(html, baseUrl, profile, limit);
    if (ebay.length > 0) return ebay;
  }
  if (profile.name === "newegg") {
    const newegg = extractNeweggSearchCandidates(html, baseUrl, profile, limit);
    if (newegg.length > 0) return newegg;
  }
  return extractGenericSearchCandidates(html, baseUrl, profile, limit);
};

const compactImageUrls = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const compacted: string[] = [];
  for (const value of values) {
    const candidate = typeof value === "string" ? value.trim() : "";
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    compacted.push(candidate);
  }
  return compacted;
};

const deriveOfferAttributes = (args: {
  profile: ShoppingProviderProfile;
  url: string;
  title: string;
  text: string;
  rank: number;
  brand?: string;
  imageUrl?: string;
  imageUrls?: string[];
  price?: {
    amount: number;
    currency: string;
  };
  priceSource?: ShoppingPriceSource;
  priceIsTrustworthy?: boolean;
  rating?: number;
  reviews?: number;
  availability?: "in_stock" | "limited" | "out_of_stock" | "unknown";
  allowTextPriceFallback?: boolean;
}): Record<string, JsonValue> => {
  const nowIso = new Date().toISOString();
  const fallbackPrice = args.allowTextPriceFallback === false ? { amount: 0, currency: DEFAULT_CURRENCY } : parsePrice(args.text);
  const price = args.price ?? fallbackPrice;
  const priceSource = price.amount > 0
    ? (args.priceSource ?? (args.price ? "structured_metadata" : "search_card_context"))
    : "unresolved";
  const priceIsTrustworthy = args.priceIsTrustworthy ?? Boolean(args.price);
  const rating = args.rating ?? parseRating(args.text);
  const reviews = args.reviews ?? parseReviews(args.text);
  const availability = args.availability ?? parseAvailability(args.text);
  const imageUrls = compactImageUrls([
    ...(Array.isArray(args.imageUrls) ? args.imageUrls : []),
    args.imageUrl
  ]);

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
      price_source: priceSource,
      price_is_trustworthy: priceIsTrustworthy,
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
    ...(args.brand ? { brand: args.brand } : {}),
    ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
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
  const providerShell = requiresBrowserAssistance(profile, fetched.url, fetched.html);

  const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
  const links = dedupeLinks(
    extracted.links.filter((link) => isLikelyProductUrl(canonicalizeUrl(link), profile)),
    limit
  );
  const content = toSnippet(extracted.text, 2000);
  const candidates = extractSearchCandidates(fetched.html, fetched.url, profile, limit);
  const pageIssue = providerShell
    ? classifySearchPageIssue(profile, fetched, extracted, content, providerShell)
    : candidates.length === 0
      ? classifySearchPageIssue(profile, fetched, extracted, content, providerShell)
      : null;

  if (providerShell) {
    throwShoppingPageIssue({
      providerId,
      fetched,
      extracted,
      content,
      pageIssue: ensureProviderShellIssue(pageIssue, providerShell, content),
      providerShell
    });
  }

  if (candidates.length > 0) {
    return candidates.map((candidate, index) => ({
      url: candidate.url,
      title: candidate.title,
      content: candidate.text,
      confidence: Math.max(0.55, 0.88 - index * 0.04),
      attributes: {
        ...deriveOfferAttributes({
          profile,
          url: candidate.url,
          title: candidate.title,
          text: candidate.text,
          rank: index + 1,
          ...(candidate.brand ? { brand: candidate.brand } : {}),
          ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
          ...(candidate.price ? {
            price: {
              amount: candidate.price.amount,
              currency: candidate.price.currency
            },
            priceSource: candidate.price.source,
            priceIsTrustworthy: candidate.price.trustworthy
          } : {}),
          ...(candidate.rating ? { rating: candidate.rating } : {}),
          ...(candidate.reviews ? { reviews: candidate.reviews } : {}),
          availability: candidate.availability ?? "unknown"
        }),
        rank: index + 1,
        retrievalPath: "shopping:search:result-card",
        ...browserFallbackObservationAttributes(fetched.browserFallback)
      }
    }));
  }

  if (pageIssue && (pageIssue.reasonCode !== "env_limited" || pageIssue.constraint)) {
    throwShoppingPageIssue({ providerId, fetched, extracted, content, pageIssue, providerShell });
  }

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
        retrievalPath: isHttpUrl(query) ? "shopping:search:url" : "shopping:search:index",
        ...(pageIssue ? { reasonCode: pageIssue.reasonCode } : {}),
        ...(pageIssue?.blockerType ? { blockerType: pageIssue.blockerType } : {}),
        ...browserFallbackObservationAttributes(fetched.browserFallback)
      }
    }
  ];

  return rows.slice(0, 1);
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
  const content = toSnippet(extracted.text, 2000);
  const providerShell = requiresBrowserAssistance(profile, fetched.url, fetched.html);
  if (providerShell) {
    const pageIssue = classifySearchPageIssue(profile, fetched, extracted, content, providerShell);
    throwShoppingPageIssue({
      providerId,
      fetched,
      extracted,
      content,
      pageIssue: ensureProviderShellIssue(pageIssue, providerShell, content),
      providerShell
    });
  }
  const title = toSnippet(extracted.text, 120) || fetched.url;
  const extractedPrice = extracted.metadata.price
    ? {
      amount: extracted.metadata.price.amount,
      currency: extracted.metadata.price.currency,
      source: "structured_metadata" as const,
      trustworthy: true
    }
    : resolveFetchTextPrice(extracted.text);

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
        rank: 1,
        ...(extracted.metadata.brand ? { brand: extracted.metadata.brand } : {}),
        ...(extracted.metadata.imageUrls.length > 0 ? { imageUrls: extracted.metadata.imageUrls } : {}),
        ...(extractedPrice ? {
          price: {
            amount: extractedPrice.amount,
            currency: extractedPrice.currency
          },
          priceSource: extractedPrice.source,
          priceIsTrustworthy: extractedPrice.trustworthy
        } : {
          priceSource: "unresolved" as const,
          priceIsTrustworthy: false
        }),
        allowTextPriceFallback: false
      }),
      status: fetched.status,
      links: dedupeLinks(extracted.links, 30),
      selectors: extracted.selectors,
      retrievalPath: "shopping:fetch:url",
      ...browserFallbackObservationAttributes(fetched.browserFallback)
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
    recoveryHints: () => buildShoppingRecoveryHints(profile),
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
