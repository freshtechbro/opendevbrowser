import { createHash } from "crypto";
import { classifyBlockerSignal } from "./blocker";
import { applyProviderIssueHint, readProviderIssueHintFromRecord } from "./constraint";
import { normalizeProviderReasonCode } from "./errors";
import { renderShopping, type ShoppingOffer } from "./renderer";
import { SHOPPING_PROVIDER_PROFILES } from "./shopping";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderFailureEntry,
  ProviderReasonCode
} from "./types";
import { canonicalizeUrl } from "./web/crawler";
import { extractText, toSnippet } from "./web/extract";
import type { CompiledShoppingWorkflow, ShoppingWorkflowRun } from "./shopping-workflow";

export const LOOKS_LIKE_URL_RE = /^https?:\/\/\S+$/i;
const PRICE_TOKEN_RE = /((?:US\$|CA\$|C\$|USD|CAD|EUR|GBP|[$€£]))\s*([0-9]{1,4}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/gi;
const CONTEXTUAL_PRICE_TOKEN_RE = /(?:connect to any carrier later|starting at|starts at|starting from|from|buy now for|buy for)\s*((?:US\$|CA\$|C\$|USD|CAD|EUR|GBP|[$€£]))\s*([0-9]{1,4}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)/gi;
const PRODUCT_COPY_CUTOFF_PATTERNS = [
  /frequently asked questions/i,
  /footer footnotes/i,
  /which [a-z0-9 ]+ is right for you/i,
  /compare all [a-z0-9 ]+ models/i,
  /more ways to shop/i,
  /privacy policy/i,
  /terms of use/i
] as const;
const PRODUCT_FEATURE_NOISE_RE = /\b(?:frequently asked questions|footnote|carrier deals|connect to any carrier later|at&t|t-mobile|verizon|boost mobile|applecare|privacy policy|terms of use|returns?|refunds?|bill credits?|trade[- ]?in|required|monthly|\/mo\b|deductible|service fee|more ways to shop|shipper\s*\/\s*seller|main content|about this item|buying options|compare with similar items|search opt|cart shift|home shift|orders shift|add to cart shift|show\/hide shortcuts|image unavailable|brief content visible|full content visible|see more product details)\b/i;
const PRODUCT_PRICE_NEGATIVE_CONTEXT_RE = /\b(?:save(?: up to)?|trade[- ]?in|bill credits?|credit|credits|off\b|monthly|per month|payments?|\/mo\b|deductible|service fee|activation fee|finance options?|learn more|view your offers)\b/i;
const PRODUCT_PRICE_POSITIVE_CONTEXT_RE = /\b(?:starting at|starts at|starting from|from|connect to any carrier later|buy now|buy for|unlocked)\b/i;
const SHOPPING_INTENT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "best",
  "buy",
  "deal",
  "deals",
  "for",
  "from",
  "new",
  "on",
  "sale",
  "shop",
  "shopping",
  "the",
  "to",
  "with"
]);
const SHOPPING_ACCESSORY_KEYWORDS = new Set([
  "accessory",
  "adapter",
  "adapters",
  "bag",
  "bags",
  "cable",
  "cables",
  "case",
  "cases",
  "charger",
  "chargers",
  "cover",
  "covers",
  "dock",
  "docks",
  "hub",
  "hubs",
  "keyboard",
  "protector",
  "protectors",
  "screenprotector",
  "skin",
  "skins",
  "sleeve",
  "sleeves",
  "stand",
  "stands"
]);
const USED_INVENTORY_QUERY_RE = /\b(?:used|pre owned|preowned|refurbished|renewed|open box|openbox)\b/i;
const USED_INVENTORY_URL_RE = /\b(?:conditiongroupcode=3|used|pre-?owned|refurbished|renewed|open-?box)\b/i;
const KNOWN_BRAND_BY_HOST_SUFFIX: Record<string, string> = {
  "aliexpress.com": "AliExpress",
  "amazon.com": "Amazon",
  "apple.com": "Apple",
  "bestbuy.com": "Best Buy",
  "costco.com": "Costco",
  "ebay.com": "eBay",
  "macys.com": "Macy's",
  "newegg.com": "Newegg",
  "target.com": "Target",
  "temu.com": "Temu",
  "walmart.com": "Walmart"
};
const REGION_CURRENCY_BY_REGION: Record<string, string> = {
  us: "USD",
  ca: "CAD",
  gb: "GBP",
  uk: "GBP",
  eu: "EUR"
};

const hash = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 16);

export const normalizePlainText = (value: string | undefined): string => {
  if (!value) return "";
  return extractText(value)
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const normalizeShoppingIntentText = (value: string | undefined): string => {
  return normalizePlainText(value)
    .toLowerCase()
    .replace(/(\d+)\s+(gb|tb|inch|in)\b/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const tokenizeShoppingIntent = (value: string | undefined): string[] => {
  const normalized = normalizeShoppingIntentText(value);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !SHOPPING_INTENT_STOP_WORDS.has(token));
};

const hasAccessoryMarker = (value: string | undefined): boolean => {
  return tokenizeShoppingIntent(value).some((token) => SHOPPING_ACCESSORY_KEYWORDS.has(token));
};

const isAccessoryQuery = (query: string): boolean => hasAccessoryMarker(query);

const queryRequestsUsedInventory = (query: string): boolean => USED_INVENTORY_QUERY_RE.test(normalizeShoppingIntentText(query));

const offerLooksUsedInventory = (offer: ShoppingOffer): boolean => {
  const normalizedOffer = normalizeShoppingIntentText(`${offer.title} ${offer.url}`);
  return USED_INVENTORY_QUERY_RE.test(normalizedOffer) || USED_INVENTORY_URL_RE.test(offer.url);
};

const normalizeFeatureEntry = (value: string): string | null => {
  const normalized = normalizePlainText(value);
  if (normalized.length < 8 || normalized.length > 160) return null;
  if (!/[a-z]/i.test(normalized)) return null;
  if (PRODUCT_FEATURE_NOISE_RE.test(normalized)) return null;
  if (/\$[0-9]/.test(normalized)) return null;
  if (/\b(?:can i|will my|when i|what resources|learn more)\b/i.test(normalized)) return null;
  return normalized;
};

export const sanitizeFeatureList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const cleaned = normalizeFeatureEntry(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
    if (normalized.length >= 12) break;
  }
  return normalized;
};

export const trimProductCopy = (value: string): string => {
  let trimmed = normalizePlainText(value);
  if (!trimmed) return "";
  let cutoff = trimmed.length;
  for (const pattern of PRODUCT_COPY_CUTOFF_PATTERNS) {
    const matchIndex = trimmed.search(pattern);
    if (matchIndex >= 0) {
      cutoff = Math.min(cutoff, matchIndex);
    }
  }
  trimmed = trimmed.slice(0, cutoff).trim();
  return trimmed.replace(/\bFootnote\b\s*[0-9†‡§∆◊※±]*/gi, " ").replace(/\s+/g, " ").trim();
};

export const stripBrandSuffix = (title: string, brand: string | undefined): string => {
  if (!brand) return title;
  return title.replace(new RegExp(`\\s*[-|:]\\s*${brand.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*$`, "i"), "").trim();
};

export const inferBrandFromUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [suffix, brand] of Object.entries(KNOWN_BRAND_BY_HOST_SUFFIX)) {
      if (host === suffix || host.endsWith(`.${suffix}`)) {
        return brand;
      }
    }
    const profile = SHOPPING_PROVIDER_PROFILES.find((entry) => entry.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)));
    if (profile) return profile.displayName;
    return undefined;
  } catch {
    return undefined;
  }
};

export const extractBrandFromTitle = (title: string | undefined): string | undefined => {
  if (!title) return undefined;
  const cleaned = normalizePlainText(title);
  const match = /(?:[-|:]\s*)([A-Z][A-Za-z0-9&+' -]{1,40})$/.exec(cleaned);
  return match?.[1]?.trim() || undefined;
};

const parseMatchedPrice = (currencySymbol: string, rawAmount: string): {
  amount: number;
  currency: string;
} | null => {
  const amount = Number(rawAmount.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const normalizedCurrency = currencySymbol.trim().toUpperCase();
  const currency = normalizedCurrency === "€"
    ? "EUR"
    : normalizedCurrency === "£"
      ? "GBP"
      : normalizedCurrency === "CAD" || normalizedCurrency === "CA$" || normalizedCurrency === "C$"
        ? "CAD"
        : "USD";
  return {
    amount,
    currency
  };
};

export const asNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

export const parsePriceFromContent = (content: string | undefined): { amount: number; currency: string } => {
  const normalized = normalizePlainText(content)
    .replace(/([$€£])\s+/g, "$1")
    .replace(/\b(?:US\$|CA\$|C\$|USD|CAD|EUR|GBP)\s+/gi, (match) => `${match.trim().toUpperCase()} `)
    .replace(/(\d)\s*([.,])\s*(\d{2})/g, "$1$2$3");
  if (!normalized) return { amount: 0, currency: "USD" };

  const contextualMatches = [...normalized.matchAll(CONTEXTUAL_PRICE_TOKEN_RE)]
    .map((match) => {
      const parsed = parseMatchedPrice(match[1]!, match[2]!);
      if (!parsed) return null;
      const index = match.index as number;
      const context = normalized.slice(Math.max(0, index - 48), Math.min(normalized.length, index + match[0].length + 48));
      return PRODUCT_PRICE_NEGATIVE_CONTEXT_RE.test(context) ? null : parsed;
    })
    .filter((entry): entry is { amount: number; currency: string } => entry !== null)
    .sort((left, right) => left.amount - right.amount);
  if (contextualMatches.length > 0) {
    return contextualMatches[0]!;
  }

  const candidates = [...normalized.matchAll(PRICE_TOKEN_RE)]
    .map((match) => {
      const parsed = parseMatchedPrice(match[1]!, match[2]!);
      if (!parsed) return null;
      const index = match.index as number;
      const context = normalized.slice(Math.max(0, index - 48), Math.min(normalized.length, index + match[0].length + 48));
      let score = 0;
      if (PRODUCT_PRICE_NEGATIVE_CONTEXT_RE.test(context)) score -= 4;
      if (PRODUCT_PRICE_POSITIVE_CONTEXT_RE.test(context)) score += 3;
      if (parsed.amount < 10) score -= 3;
      return {
        ...parsed,
        score,
        index
      };
    })
    .filter((entry): entry is { amount: number; currency: string; score: number; index: number } => entry !== null)
    .sort((left, right) => right.score - left.score || left.amount - right.amount || left.index - right.index);
  if (candidates.length === 0 || candidates[0]!.score < -1) {
    return { amount: 0, currency: "USD" };
  }
  return {
    amount: candidates[0]!.amount,
    currency: candidates[0]!.currency
  };
};

const scoreShoppingOfferIntent = (
  query: string,
  offer: ShoppingOffer
): { intentScore: number; accessoryPenalty: number; usedInventoryPenalty: number; directMatch: boolean } => {
  const queryTokens = tokenizeShoppingIntent(query);
  if (queryTokens.length === 0) {
    return {
      intentScore: 0,
      accessoryPenalty: 0,
      usedInventoryPenalty: 0,
      directMatch: false
    };
  }

  let offerUrlIntentText = "";
  try {
    const parsed = new URL(offer.url);
    offerUrlIntentText = `${parsed.hostname} ${parsed.pathname}`;
  } catch {
    offerUrlIntentText = "";
  }
  const offerText = `${offer.title} ${offerUrlIntentText}`.trim();
  const offerTokens = new Set(tokenizeShoppingIntent(offerText));
  const normalizedQuery = normalizeShoppingIntentText(query);
  const normalizedOffer = normalizeShoppingIntentText(offerText);
  const matchedTokens = queryTokens.filter((token) => offerTokens.has(token));
  const importantMatches = matchedTokens.filter((token) => token.length > 2 || /\d/.test(token));
  const exactPhrase = normalizedQuery.length > 0 && normalizedOffer.includes(normalizedQuery);
  const directMatch = exactPhrase || importantMatches.length >= Math.min(queryTokens.length, 3);
  const accessoryPenalty = !isAccessoryQuery(query) && hasAccessoryMarker(offerText) ? 6 : 0;
  const usedInventoryPenalty = !queryRequestsUsedInventory(query) && offerLooksUsedInventory(offer) ? 10 : 0;
  const intentScore = (importantMatches.length * 3)
    + ((matchedTokens.length - importantMatches.length) * 1.5)
    + (exactPhrase ? 4 : 0)
    + (directMatch ? 2 : 0)
    - accessoryPenalty
    - usedInventoryPenalty;

  return {
    intentScore,
    accessoryPenalty,
    usedInventoryPenalty,
    directMatch
  };
};

const availabilityRank = (availability: ShoppingOffer["availability"]): number => {
  switch (availability) {
    case "in_stock":
      return 1;
    case "limited":
      return 0.75;
    case "unknown":
      return 0.45;
    case "out_of_stock":
      return 0.1;
  }
};

const computeDealScore = (offer: ShoppingOffer, now: Date): number => {
  const total = Math.max(0, offer.price.amount + offer.shipping.amount);
  const priceScore = total > 0 ? 1 / (1 + total / 100) : 0;
  const availabilityScore = availabilityRank(offer.availability);
  const ratingScore = Math.max(0, Math.min(1, offer.rating / 5));
  const recencyHours = Math.max(0, (now.getTime() - new Date(offer.price.retrieved_at).getTime()) / (60 * 60 * 1000));
  const recencyScore = 1 / (1 + recencyHours / 24);
  const score = (priceScore * 0.55) + (availabilityScore * 0.2) + (ratingScore * 0.15) + (recencyScore * 0.1);
  return Number(score.toFixed(6));
};

export const extractShoppingOffer = (record: NormalizedRecord, now: Date): ShoppingOffer => {
  const nested = (record.attributes.shopping_offer ?? {}) as Record<string, unknown>;
  const nestedPrice = (nested.price ?? {}) as Record<string, unknown>;
  const nestedShipping = (nested.shipping ?? {}) as Record<string, unknown>;
  const retrievalPath = typeof record.attributes.retrievalPath === "string"
    ? record.attributes.retrievalPath
    : "";
  const hasNestedPrice = asNumber(nestedPrice.amount) > 0;
  const priceSource = typeof nested.price_source === "string" ? nested.price_source : "unresolved";
  const priceIsTrustworthy = nested.price_is_trustworthy === true;
  const allowContentFallback = retrievalPath === "shopping:search:result-card"
    || retrievalPath === "shopping:search:url"
    || priceIsTrustworthy
    || priceSource === "search_card_context"
    || priceSource === "search_title_inline";
  const fallbackPrice = allowContentFallback ? parsePriceFromContent(record.content) : { amount: 0, currency: "USD" };
  const priceAmount = hasNestedPrice ? asNumber(nestedPrice.amount) : fallbackPrice.amount;
  const priceCurrency = hasNestedPrice && typeof nestedPrice.currency === "string" && nestedPrice.currency.trim()
    ? nestedPrice.currency
    : fallbackPrice.currency;
  const retrievedAt = typeof nestedPrice.retrieved_at === "string" && nestedPrice.retrieved_at.trim()
    ? nestedPrice.retrieved_at
    : now.toISOString();

  const title = (typeof nested.title === "string" && nested.title.trim())
    ? nested.title
    : record.title ?? record.url ?? record.provider;
  const url = (typeof nested.url === "string" && nested.url.trim())
    ? nested.url
    : record.url ?? "";

  const shippingAmount = asNumber(nestedShipping.amount);
  const shippingCurrency = typeof nestedShipping.currency === "string" && nestedShipping.currency.trim()
    ? nestedShipping.currency
    : priceCurrency;

  const availabilityRaw = typeof nested.availability === "string" ? nested.availability : "unknown";
  const availability: ShoppingOffer["availability"] = availabilityRaw === "in_stock" || availabilityRaw === "limited" || availabilityRaw === "out_of_stock"
    ? availabilityRaw
    : "unknown";

  const offer: ShoppingOffer = {
    offer_id: `${record.provider}:${record.id}`,
    product_id: typeof nested.product_id === "string" && nested.product_id.trim()
      ? nested.product_id
      : hash(`${canonicalizeUrl(url)}::${title.toLowerCase()}`),
    provider: record.provider,
    url,
    title,
    price: {
      amount: priceAmount,
      currency: priceCurrency,
      retrieved_at: retrievedAt
    },
    shipping: {
      amount: shippingAmount,
      currency: shippingCurrency,
      notes: typeof nestedShipping.notes === "string" ? nestedShipping.notes : "unknown"
    },
    availability,
    rating: asNumber(nested.rating),
    reviews_count: asNumber(nested.reviews_count),
    deal_score: 0,
    attributes: {
      ...record.attributes,
      source_record_id: record.id
    }
  };

  offer.deal_score = computeDealScore(offer, now);
  return offer;
};

const resolveExpectedCurrencyForRegion = (region: string | undefined): string | null => {
  if (!region) return null;
  return REGION_CURRENCY_BY_REGION[region.trim().toLowerCase()] ?? null;
};

const offerMatchesRegionCurrency = (
  offer: ShoppingOffer,
  expectedCurrency: string | null
): boolean => {
  if (!expectedCurrency) {
    return true;
  }
  return offer.price.currency.trim().toUpperCase() === expectedCurrency;
};

export interface ShoppingOfferFilterDiagnostic {
  providerId: string;
  candidateOffers: number;
  pricedOffers: number;
  regionMatchedOffers: number;
  zeroPriceExcluded: number;
  regionCurrencyExcluded: number;
  budgetExcluded: number;
  finalOffers: number;
  requestedRegion?: string;
  expectedCurrency?: string;
  allCandidateOffersDroppedByZeroPrice: boolean;
  allCandidateOffersDroppedByRegionCurrency: boolean;
  allCandidateOffersDroppedByBudget: boolean;
}

const buildOfferFilterDiagnostic = (
  providerId: string,
  offers: ShoppingOffer[],
  compiled: CompiledShoppingWorkflow,
  expectedCurrency: string | null
): ShoppingOfferFilterDiagnostic => {
  const pricedOffers = offers.filter((offer) => offer.price.amount > 0);
  const regionMatchedOffers = pricedOffers.filter((offer) => offerMatchesRegionCurrency(offer, expectedCurrency));
  const budget = typeof compiled.budget === "number" ? compiled.budget : null;
  const finalOffers = typeof budget === "number"
    ? regionMatchedOffers.filter((offer) => offer.price.amount <= budget)
    : regionMatchedOffers;

  return {
    providerId,
    candidateOffers: offers.length,
    pricedOffers: pricedOffers.length,
    regionMatchedOffers: regionMatchedOffers.length,
    zeroPriceExcluded: offers.length - pricedOffers.length,
    regionCurrencyExcluded: pricedOffers.length - regionMatchedOffers.length,
    budgetExcluded: regionMatchedOffers.length - finalOffers.length,
    finalOffers: finalOffers.length,
    ...(compiled.region ? { requestedRegion: compiled.region } : {}),
    ...(expectedCurrency ? { expectedCurrency } : {}),
    allCandidateOffersDroppedByZeroPrice: offers.length > 0 && pricedOffers.length === 0,
    allCandidateOffersDroppedByRegionCurrency: pricedOffers.length > 0 && regionMatchedOffers.length === 0,
    allCandidateOffersDroppedByBudget: regionMatchedOffers.length > 0 && finalOffers.length === 0
  };
};

const filterShoppingOffers = (
  offers: ShoppingOffer[],
  compiled: CompiledShoppingWorkflow,
  expectedCurrency: string | null
): ShoppingOffer[] => {
  return offers.filter((offer) => {
    if (offer.price.amount <= 0) return false;
    if (!offerMatchesRegionCurrency(offer, expectedCurrency)) return false;
    if (typeof compiled.budget !== "number") return true;
    return offer.price.amount <= compiled.budget;
  });
};

export const dedupeOffers = (offers: ShoppingOffer[]): ShoppingOffer[] => {
  const deduped = new Map<string, ShoppingOffer>();
  for (const offer of offers) {
    const key = `${canonicalizeUrl(offer.url)}::${offer.title.toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || offer.deal_score > existing.deal_score) {
      deduped.set(key, offer);
    }
  }
  return [...deduped.values()];
};

export const rankOffers = (
  offers: ShoppingOffer[],
  sort: CompiledShoppingWorkflow["sort"],
  query: string
): ShoppingOffer[] => {
  const ordered = [...offers];
  switch (sort) {
    case "lowest_price":
      return ordered.sort((left, right) => {
        const leftTotal = left.price.amount + left.shipping.amount;
        const rightTotal = right.price.amount + right.shipping.amount;
        return leftTotal - rightTotal;
      });
    case "highest_rating":
      return ordered.sort((left, right) => right.rating - left.rating || right.reviews_count - left.reviews_count);
    case "fastest_shipping":
      return ordered.sort((left, right) => left.shipping.amount - right.shipping.amount || right.deal_score - left.deal_score);
    case "best_deal":
    default:
      return ordered.sort((left, right) => {
        const leftIntent = scoreShoppingOfferIntent(query, left);
        const rightIntent = scoreShoppingOfferIntent(query, right);
        if (leftIntent.directMatch !== rightIntent.directMatch) {
          return rightIntent.directMatch ? 1 : -1;
        }
        if (leftIntent.intentScore !== rightIntent.intentScore) {
          return rightIntent.intentScore - leftIntent.intentScore;
        }
        return right.deal_score - left.deal_score
          || (left.price.amount + left.shipping.amount) - (right.price.amount + right.shipping.amount);
      });
  }
};

export const isLikelyOfferRecord = (record: NormalizedRecord): boolean => {
  const retrievalPath = typeof record.attributes.retrievalPath === "string"
    ? record.attributes.retrievalPath
    : "";
  if (retrievalPath === "shopping:search:index" || retrievalPath === "shopping:search:link") return false;
  if (retrievalPath.startsWith("shopping:search:") && retrievalPath !== "shopping:search:result-card" && retrievalPath !== "shopping:search:url") {
    return false;
  }

  if (!record.url) return true;

  const canonicalUrl = canonicalizeUrl(record.url);
  if (!/^https?:/i.test(canonicalUrl)) return false;
  if (/\.(?:png|jpe?g|gif|webp|svg|ico|css|js)(?:$|\?)/i.test(canonicalUrl)) return false;
  const title = normalizePlainText(record.title);
  if (!title || LOOKS_LIKE_URL_RE.test(title) || title === canonicalUrl) return false;

  const profile = SHOPPING_PROVIDER_PROFILES.find((entry) => entry.id === record.provider);
  if (profile && profile.domains.length > 0 && retrievalPath.startsWith("shopping:search:")) {
    try {
      const host = new URL(canonicalUrl).hostname.toLowerCase();
      const matchesProviderDomain = profile.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
      if (!matchesProviderDomain) return false;
    } catch {
      return false;
    }
  }
  return true;
};

export const hasShoppingIssueHint = (records: NormalizedRecord[]): boolean => {
  return records.some((record) => readProviderIssueHintFromRecord(record) !== null);
};

const withOfferFilterDiagnosticDetails = (
  details: Record<string, JsonValue>,
  offerFilterDiagnostic?: ShoppingOfferFilterDiagnostic
): Record<string, JsonValue> => {
  if (!offerFilterDiagnostic) {
    return details;
  }

  return {
    ...details,
    candidateOffers: offerFilterDiagnostic.candidateOffers,
    pricedOffers: offerFilterDiagnostic.pricedOffers,
    regionMatchedOffers: offerFilterDiagnostic.regionMatchedOffers,
    zeroPriceExcluded: offerFilterDiagnostic.zeroPriceExcluded,
    regionCurrencyExcluded: offerFilterDiagnostic.regionCurrencyExcluded,
    budgetExcluded: offerFilterDiagnostic.budgetExcluded,
    finalOffers: offerFilterDiagnostic.finalOffers,
    ...(offerFilterDiagnostic.requestedRegion ? { requestedRegion: offerFilterDiagnostic.requestedRegion } : {}),
    ...(offerFilterDiagnostic.expectedCurrency ? { expectedCurrency: offerFilterDiagnostic.expectedCurrency } : {})
  };
};

const inferShoppingNoOfferFailure = (
  providerId: string,
  query: string,
  records: NormalizedRecord[],
  offerFilterDiagnostic?: ShoppingOfferFilterDiagnostic
): ProviderFailureEntry => {
  const issuePriority = (issue: NonNullable<ReturnType<typeof readProviderIssueHintFromRecord>>): number => (
    ({
      token_required: 3,
      auth_required: 3,
      challenge_detected: 2
    } as Partial<Record<typeof issue.reasonCode, number>>)[issue.reasonCode] ?? Number(issue.constraint?.kind === "render_required")
  );
  const primaryRecordIssue = records
    .flatMap((record) => {
      const hint = readProviderIssueHintFromRecord(record);
      if (!hint) return [];
      const title = normalizePlainText(record.title);
      return [{
        hint,
        ...(typeof record.url === "string" ? { url: canonicalizeUrl(record.url) } : {}),
        ...(title ? { title } : {}),
        ...(typeof record.attributes.providerShell === "string" && record.attributes.providerShell.trim().length > 0
          ? { providerShell: record.attributes.providerShell.trim() }
          : {})
      }];
    })
    .sort((left, right) => issuePriority(right.hint) - issuePriority(left.hint))[0] ?? null;

  if (primaryRecordIssue) {
    const reasonCode = primaryRecordIssue.hint.reasonCode;
    return {
      provider: providerId,
      source: "shopping",
      error: {
        code: reasonCode === "token_required" || reasonCode === "auth_required" ? "auth" : "unavailable",
        message: reasonCode === "token_required" || reasonCode === "auth_required"
          ? `Authentication required for provider results for query "${query}".`
          : reasonCode === "challenge_detected"
            ? `Detected anti-bot challenge while retrieving provider results for query "${query}".`
            : `Provider requires browser-rendered results for query "${query}".`,
        retryable: reasonCode === "env_limited",
        reasonCode,
        provider: providerId,
        source: "shopping",
        details: applyProviderIssueHint(withOfferFilterDiagnosticDetails({
          query,
          recordsCount: records.length,
          noOfferRecords: true,
          ...(primaryRecordIssue.url ? { url: primaryRecordIssue.url } : {}),
          ...(primaryRecordIssue.title ? { title: primaryRecordIssue.title } : {}),
          ...(primaryRecordIssue.providerShell ? { providerShell: primaryRecordIssue.providerShell } : {})
        }, offerFilterDiagnostic), primaryRecordIssue.hint)
      }
    };
  }

  if (offerFilterDiagnostic?.candidateOffers) {
    const filterDetails = withOfferFilterDiagnosticDetails({
      query,
      recordsCount: records.length,
      noOfferRecords: true,
      reasonCode: "env_limited"
    }, offerFilterDiagnostic);

    if (offerFilterDiagnostic.allCandidateOffersDroppedByRegionCurrency) {
      return {
        provider: providerId,
        source: "shopping",
        error: {
          code: "unavailable",
          message: `Provider returned priced offers for query "${query}", but all candidate offers were filtered by the ${offerFilterDiagnostic.expectedCurrency ?? "requested"} currency heuristic.`,
          retryable: false,
          reasonCode: "env_limited",
          provider: providerId,
          source: "shopping",
          details: {
            ...filterDetails,
            filterReason: "region_currency"
          }
        }
      };
    }

    if (offerFilterDiagnostic.allCandidateOffersDroppedByBudget) {
      return {
        provider: providerId,
        source: "shopping",
        error: {
          code: "unavailable",
          message: typeof offerFilterDiagnostic.expectedCurrency === "string" && typeof offerFilterDiagnostic.requestedRegion === "string"
            ? `Provider returned priced offers for query "${query}", but all candidate offers exceeded the requested budget after applying the ${offerFilterDiagnostic.expectedCurrency} currency heuristic for region ${offerFilterDiagnostic.requestedRegion}.`
            : `Provider returned priced offers for query "${query}", but all candidate offers exceeded the requested budget.`,
          retryable: false,
          reasonCode: "env_limited",
          provider: providerId,
          source: "shopping",
          details: {
            ...filterDetails,
            filterReason: "budget"
          }
        }
      };
    }

    if (offerFilterDiagnostic.allCandidateOffersDroppedByZeroPrice) {
      return {
        provider: providerId,
        source: "shopping",
        error: {
          code: "unavailable",
          message: `Provider returned candidate offers for query "${query}", but none had a trustworthy non-zero price.`,
          retryable: false,
          reasonCode: "env_limited",
          provider: providerId,
          source: "shopping",
          details: {
            ...filterDetails,
            filterReason: "zero_price"
          }
        }
      };
    }
  }

  const fallbackFailure: ProviderFailureEntry = {
    provider: providerId,
    source: "shopping",
    error: {
      code: "unavailable",
      message: `Provider returned no usable shopping offers for query "${query}".`,
      retryable: true,
      reasonCode: "env_limited",
      provider: providerId,
      source: "shopping",
      details: withOfferFilterDiagnosticDetails({
        query,
        recordsCount: records.length,
        noOfferRecords: true,
        reasonCode: "env_limited"
      }, offerFilterDiagnostic)
    }
  };

  for (const record of records) {
    const url = typeof record.url === "string" ? canonicalizeUrl(record.url) : undefined;
    const title = normalizePlainText(record.title) || undefined;
    const message = toSnippet(normalizePlainText(record.content), 800) || undefined;
    const blocker = classifyBlockerSignal({
      source: "runtime_fetch",
      ...(url ? { url, finalUrl: url } : {}),
      ...(title ? { title } : {}),
      ...(message ? { message } : {}),
      providerErrorCode: "unavailable",
      retryable: true
    });
    if (!blocker || blocker.type === "unknown") continue;

    const reasonCode = blocker.reasonCode ?? "env_limited";
    return {
      provider: providerId,
      source: "shopping",
      error: {
        code: "unavailable",
        message: `Provider returned no usable shopping offers for query "${query}".`,
        retryable: blocker.retryable,
        reasonCode,
        provider: providerId,
        source: "shopping",
        details: withOfferFilterDiagnosticDetails({
          query,
          recordsCount: records.length,
          noOfferRecords: true,
          reasonCode,
          blockerType: blocker.type,
          blockerConfidence: blocker.confidence,
          ...(url ? { url } : {}),
          ...(title ? { title } : {})
        }, offerFilterDiagnostic)
      }
    };
  }

  return fallbackFailure;
};

const createEmptyShoppingResultFailure = (
  providerId: string,
  query: string,
  records: NormalizedRecord[],
  offerFilterDiagnostic?: ShoppingOfferFilterDiagnostic
): ProviderFailureEntry => inferShoppingNoOfferFailure(providerId, query, records, offerFilterDiagnostic);

export interface ShoppingWorkflowPostprocessResult {
  records: NormalizedRecord[];
  failures: ProviderFailureEntry[];
  offers: ShoppingOffer[];
  zeroPriceExcluded: number;
  budgetExcluded: number;
  regionCurrencyExcluded: number;
  offerFilterDiagnostics: ShoppingOfferFilterDiagnostic[];
}

export const postprocessShoppingWorkflow = (
  compiled: CompiledShoppingWorkflow,
  runs: ShoppingWorkflowRun[]
): ShoppingWorkflowPostprocessResult => {
  const runsWithOfferRecords = runs.map((run) => ({
    ...run,
    offerRecords: run.result.records.filter((record) => isLikelyOfferRecord(record))
  }));
  const expectedCurrency = resolveExpectedCurrencyForRegion(compiled.region);
  const runsWithExtractedOffers = runsWithOfferRecords.map((run) => ({
    ...run,
    extractedOffers: run.offerRecords.map((record) => extractShoppingOffer(record, compiled.now))
  }));
  const runsWithOfferDiagnostics = runsWithExtractedOffers.map((run) => {
    const offerFilterDiagnostic = buildOfferFilterDiagnostic(
      run.providerId,
      run.extractedOffers,
      compiled,
      expectedCurrency
    );
    return {
      ...run,
      offerFilterDiagnostic,
      filteredOffers: filterShoppingOffers(run.extractedOffers, compiled, expectedCurrency)
    };
  });
  const zeroPriceExcluded = runsWithOfferDiagnostics.reduce((sum, run) => sum + run.offerFilterDiagnostic.zeroPriceExcluded, 0);
  const budgetExcluded = runsWithOfferDiagnostics.reduce((sum, run) => sum + run.offerFilterDiagnostic.budgetExcluded, 0);
  const regionCurrencyExcluded = runsWithOfferDiagnostics.reduce((sum, run) => sum + run.offerFilterDiagnostic.regionCurrencyExcluded, 0);

  const offers = rankOffers(
    dedupeOffers(runsWithOfferDiagnostics.flatMap((run) => run.filteredOffers)),
    compiled.sort,
    compiled.query
  );

  const failures = runsWithOfferDiagnostics.flatMap((run) => {
    if (run.result.failures.length > 0) {
      return run.result.failures;
    }
    if (run.offerFilterDiagnostic.finalOffers > 0) {
      return [];
    }
    return [createEmptyShoppingResultFailure(
      run.providerId,
      compiled.query,
      run.result.records,
      run.offerFilterDiagnostic
    )];
  });

  return {
    records: runsWithOfferDiagnostics.flatMap((run) => run.result.records),
    failures,
    offers,
    zeroPriceExcluded,
    budgetExcluded,
    regionCurrencyExcluded,
    offerFilterDiagnostics: runsWithOfferDiagnostics.map((run) => run.offerFilterDiagnostic)
  };
};
