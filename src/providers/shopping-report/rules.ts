import type { ShoppingOffer } from "../renderer";
import type {
  ShoppingDuplicateGroup,
  ShoppingFreshnessEvidence,
  ShoppingMarketBaseline,
  ShoppingMoneyEvidence,
  ShoppingPriceValidity,
  ShoppingQueryRelevance,
  ShoppingReportMetaView,
  ShoppingReportOfferEvidence,
  ShoppingTitleQuality
} from "./types";

export const DEFAULT_SHOPPING_ARTIFACT_FILES = [
  "deals.md",
  "offers.json",
  "comparison.csv",
  "meta.json",
  "deals-context.json"
] as const;

export const DEFAULT_STALE_PRICE_AFTER_DAYS = 7;
export const DEFAULT_MARKET_BASELINE_MIN_SAMPLE = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONEY_EPSILON = 0.001;
const FUTURE_FRESHNESS_TOLERANCE_DAYS = 1 / 24;

const QUERY_STOPWORDS = new Set([
  "and",
  "best",
  "buy",
  "deal",
  "deals",
  "for",
  "from",
  "good",
  "new",
  "sale",
  "shopping",
  "the",
  "under",
  "with"
]);

const PRODUCT_NOUNS = new Set([
  "adapter",
  "airpods",
  "cable",
  "case",
  "charger",
  "dock",
  "display",
  "earbud",
  "earbuds",
  "headphone",
  "headphones",
  "hub",
  "keyboard",
  "laptop",
  "microphone",
  "monitor",
  "mouse",
  "mice",
  "phone",
  "speaker",
  "stand",
  "tablet",
  "webcam"
]);

const SOFT_DESCRIPTOR_TOKENS = new Set([
  "inch",
  "usb",
  "wireless"
]);

const BUDGET_PRICE_TOKEN_PATTERN = /\b(?:under|below|less than|no more than|max(?:imum)?|budget|up to)\s+(?:[$\u20ac\u00a3\u00a5]\s*)?(\d+(?:[.,]\d+)?)(?:\s*(?:usd|cad|eur|gbp))?\b|[$\u20ac\u00a3\u00a5]\s*(\d+(?:[.,]\d+)?)/gi;

const PRODUCT_EVIDENCE_ATTRIBUTE_KEYS = new Set([
  "brand",
  "category",
  "description",
  "features",
  "model",
  "model_number",
  "product_type",
  "specs",
  "style"
]);

const normalizeToken = (token: string): string => {
  if (token === "ergo") return "ergonomic";
  if (token === "mic" || token === "microphones") return "microphone";
  if (token === "mice") return "mouse";
  if (token === "earbuds") return "earbud";
  if (token === "headphones") return "headphone";
  if (token === "monitors") return "monitor";
  if (token === "speakers") return "speaker";
  if (token === "webcams") return "webcam";
  return token;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const recordField = (record: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = record[key];
  return isRecord(value) ? value : {};
};

const recordArrayField = (record: Record<string, unknown>, key: string): Array<Record<string, unknown>> => {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
};

const stringField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const numberField = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const booleanField = (record: Record<string, unknown>, key: string): boolean | undefined => {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
};

const stringArrayField = (record: Record<string, unknown>, key: string): string[] => {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
};

const hasPositiveNumberField = (record: Record<string, unknown>, key: string): boolean => {
  const value = numberField(record, key);
  return value !== undefined && value > 0;
};

const hasTrueBooleanField = (record: Record<string, unknown>, key: string): boolean => booleanField(record, key) === true;

const isConstraintBearingFilterDiagnostic = (record: Record<string, unknown>): boolean => (
  hasPositiveNumberField(record, "zeroPriceExcluded")
  || hasPositiveNumberField(record, "regionCurrencyExcluded")
  || hasPositiveNumberField(record, "budgetExcluded")
  || hasTrueBooleanField(record, "allCandidateOffersDroppedByZeroPrice")
  || hasTrueBooleanField(record, "allCandidateOffersDroppedByRegionCurrency")
  || hasTrueBooleanField(record, "allCandidateOffersDroppedByBudget")
  || stringField(record, "reasonCode") !== undefined
  || stringField(record, "reason_code") !== undefined
  || stringField(record, "filterReason") !== undefined
  || stringField(record, "blockerType") !== undefined
);

const productEvidenceTextValues = (record: Record<string, unknown>): string[] => {
  const textValues: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!PRODUCT_EVIDENCE_ATTRIBUTE_KEYS.has(key)) continue;
    if (typeof value === "string" && !/^https?:\/\//i.test(value)) textValues.push(value);
    if (typeof value === "number" && Number.isFinite(value)) textValues.push(String(value));
  }
  return textValues;
};

const normalizeText = (text: string): string => (
  text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
);

const tokenize = (text: string): string[] => {
  const tokens = normalizeText(text).split(" ").filter((token) => (
    token.length >= 3 || (token.length >= 2 && /\d/.test(token))
  ));
  return Array.from(new Set(tokens.map(normalizeToken).filter((token) => !QUERY_STOPWORDS.has(token))));
};

const budgetPriceTokens = (query: string): Set<string> => {
  const tokens: string[] = [];
  for (const match of query.matchAll(BUDGET_PRICE_TOKEN_PATTERN)) {
    const amount = match[1] ?? match[2];
    if (amount) tokens.push(...tokenize(amount));
  }
  return new Set(tokens);
};

const tokenizeQuery = (query: string): string[] => {
  const priceTokens = budgetPriceTokens(query);
  return tokenize(query).filter((token) => !priceTokens.has(token));
};

export const normalizeShoppingReportText = (text: string): string => normalizeText(text);

const parseTimeMs = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const freshnessAgeDays = (observedMs: number, referenceIso: string | undefined): number | undefined => {
  const referenceMs = parseTimeMs(referenceIso);
  if (referenceMs === undefined) return undefined;
  return (referenceMs - observedMs) / MS_PER_DAY;
};

const classifyObservedFreshness = (args: {
  observedIso: string;
  observedMs: number;
  source: string;
  referenceIso?: string;
  staleAfterDays: number;
}): ShoppingFreshnessEvidence => {
  const ageDays = freshnessAgeDays(args.observedMs, args.referenceIso);
  if (ageDays === undefined) {
    return {
      status: "inferred",
      label: "observed timestamp cannot be aged without a freshness reference",
      source: args.source,
      retrievedAt: args.observedIso
    };
  }
  if (ageDays < -FUTURE_FRESHNESS_TOLERANCE_DAYS) {
    return {
      status: "future",
      label: "future-dated observed price timestamp",
      source: args.source,
      retrievedAt: args.observedIso,
      ageDays
    };
  }
  const stale = ageDays > args.staleAfterDays;
  return {
    status: stale ? "stale" : "observed",
    label: stale ? "stale observed price timestamp" : "observed price timestamp",
    source: args.source,
    retrievedAt: args.observedIso,
    ageDays
  };
};

const classifyFreshness = (args: {
  offerRetrievedAt?: string;
  nestedPrice: Record<string, unknown>;
  nestedOffer: Record<string, unknown>;
  referenceIso?: string;
  staleAfterDays: number;
}): ShoppingFreshnessEvidence => {
  const nestedRetrievedAt = stringField(args.nestedPrice, "retrieved_at");
  const captureTimestamp = stringField(args.nestedOffer, "capture_timestamp");
  const observedIso = nestedRetrievedAt ?? captureTimestamp;
  const observedMs = parseTimeMs(observedIso);
  if (observedIso && observedMs !== undefined) {
    return classifyObservedFreshness({
      observedIso,
      observedMs,
      source: nestedRetrievedAt ? "attributes.shopping_offer.price.retrieved_at" : "attributes.shopping_offer.capture_timestamp",
      referenceIso: args.referenceIso,
      staleAfterDays: args.staleAfterDays
    });
  }
  const fallbackMs = parseTimeMs(args.offerRetrievedAt);
  if (fallbackMs !== undefined && args.offerRetrievedAt) {
    return {
      status: "inferred",
      label: "inferred from normalized offer timestamp",
      source: "price.retrieved_at"
    };
  }
  return {
    status: "missing",
    label: "missing price freshness evidence",
    source: "missing"
  };
};

const moneyFromRecord = (record: Record<string, unknown>, fallbackCurrency: string): ShoppingMoneyEvidence | undefined => {
  const amount = numberField(record, "amount");
  if (amount === undefined || amount <= 0) return undefined;
  const currency = stringField(record, "currency") ?? fallbackCurrency;
  return { amount, currency: currency.toUpperCase() };
};

const moneyFromValue = (value: unknown, fallbackCurrency: string): ShoppingMoneyEvidence | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return { amount: value, currency: fallbackCurrency.toUpperCase() };
  }
  return isRecord(value) ? moneyFromRecord(value, fallbackCurrency) : undefined;
};

const assessPriceValidity = (args: {
  itemAmount: number;
  shippingAmount: number;
  totalAmount: number;
}): ShoppingPriceValidity => {
  const reasons: string[] = [];
  if (!Number.isFinite(args.itemAmount)) reasons.push("item price is not finite");
  if (Number.isFinite(args.itemAmount) && args.itemAmount <= MONEY_EPSILON) reasons.push("item price must be positive");
  if (!Number.isFinite(args.shippingAmount)) reasons.push("shipping price is not finite");
  if (Number.isFinite(args.shippingAmount) && args.shippingAmount < 0) reasons.push("shipping price cannot be negative");
  if (!Number.isFinite(args.totalAmount)) reasons.push("total price is not finite");
  return { status: reasons.length > 0 ? "invalid" : "valid", reasons };
};

const readAnchorPrice = (
  nestedOffer: Record<string, unknown>,
  attributes: Record<string, unknown>,
  fallbackCurrency: string
): ShoppingMoneyEvidence | undefined => {
  const keys = ["anchor_price", "list_price", "original_price", "msrp"];
  for (const key of keys) {
    const money = moneyFromValue(nestedOffer[key] ?? attributes[key], fallbackCurrency);
    if (money) return money;
  }
  return undefined;
};

const assessFreshness = (args: {
  offer: ShoppingOffer;
  nestedPrice: Record<string, unknown>;
  nestedOffer: Record<string, unknown>;
  referenceIso?: string;
  staleAfterDays: number;
}): ShoppingFreshnessEvidence => classifyFreshness({
  offerRetrievedAt: args.offer.price.retrieved_at,
  nestedPrice: args.nestedPrice,
  nestedOffer: args.nestedOffer,
  referenceIso: args.referenceIso,
  staleAfterDays: args.staleAfterDays
});

export const assessTitleQuality = (title: string): ShoppingTitleQuality => {
  const normalized = normalizeText(title);
  const reasons: string[] = [];
  if (normalized.length < 8) reasons.push("title is too short to verify a product");
  if (/^https?\b|www\b|\.com\b/.test(normalized)) reasons.push("title looks like a URL");
  if (/^\$?\d+(?:\.\d{2})?$/.test(title.trim())) reasons.push("title is price-only");
  if (/\bout of 5 stars\b|\breviews?\b|\bratings?\b/.test(normalized)) reasons.push("title looks like rating or review text");
  if (/^(item|product|shop now|view details)$/.test(normalized)) reasons.push("title is generic interface text");
  return {
    status: reasons.length > 0 ? "suspicious" : "usable",
    reasons
  };
};

export const assessQueryRelevance = (
  query: string,
  titleText: string,
  structuredAttributeText = ""
): ShoppingQueryRelevance => {
  const queryTokens = tokenizeQuery(query);
  const titleTokens = new Set(tokenize(titleText));
  const attributeTokens = tokenize(structuredAttributeText);
  const evidenceTokens = new Set([...titleTokens, ...attributeTokens]);
  const matchedTokens = queryTokens.filter((token) => evidenceTokens.has(token));
  const missingTokens = queryTokens.filter((token) => !evidenceTokens.has(token));
  const queryProductNouns = queryTokens.filter((token) => PRODUCT_NOUNS.has(token));
  const matchedTitleProductNouns = queryProductNouns.filter((token) => titleTokens.has(token));
  const descriptorMissing = missingTokens.filter((token) => !PRODUCT_NOUNS.has(token) && !SOFT_DESCRIPTOR_TOKENS.has(token));
  const productNounMissing = queryProductNouns.length > 0 && matchedTitleProductNouns.length === 0;
  const score = queryTokens.length > 0 ? matchedTokens.length / queryTokens.length : 1;
  let status: ShoppingQueryRelevance["status"] = "adequate";
  if (productNounMissing || descriptorMissing.length > 0) status = "weak";
  if (status !== "weak" && score >= 0.66) status = "strong";
  const reasons = status === "weak" ? [`missing title or structured-attribute query terms: ${missingTokens.join(", ")}`] : [];
  return { status, score, matchedTokens, missingTokens, reasons };
};

const hasStringEvidence = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[]
): boolean => records.some((record) => keys.some((key) => stringField(record, key) !== undefined));

const hasNumberEvidence = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[]
): boolean => records.some((record) => keys.some((key) => numberField(record, key) !== undefined));

const hasBooleanEvidence = (
  records: readonly Record<string, unknown>[],
  keys: readonly string[]
): boolean => records.some((record) => keys.some((key) => booleanField(record, key) !== undefined));

const buyerLimitations = (args: {
  attributes: Record<string, unknown>;
  nestedOffer: Record<string, unknown>;
  nestedShipping: Record<string, unknown>;
}): string[] => {
  const records = [args.nestedOffer, args.attributes];
  const limitations: string[] = [];
  if (!hasStringEvidence(records, ["seller", "seller_name", "merchant", "sold_by", "seller_trust", "seller_reputation"])
    && !hasNumberEvidence(records, ["seller_rating", "seller_score"])) {
    limitations.push("seller trust not reported");
  }
  if (!hasStringEvidence(records, ["return_policy", "returns_policy", "returns", "return_window"])) {
    limitations.push("return policy not reported");
  }
  if (!hasStringEvidence(records, ["warranty", "warranty_terms", "protection_plan"])) {
    limitations.push("warranty coverage not reported");
  }
  if (!hasStringEvidence(records, ["condition", "item_condition"])) {
    limitations.push("item condition not reported");
  }
  if (!hasStringEvidence([args.nestedShipping, args.nestedOffer, args.attributes], [
    "carrier",
    "delivery",
    "delivery_estimate",
    "eta",
    "service_level",
    "shipping_service",
    "shipping_time"
  ]) && !hasBooleanEvidence([args.nestedShipping, args.nestedOffer, args.attributes], ["checkout_verified", "shipping_verified"])) {
    limitations.push("shipping certainty not reported");
  }
  return limitations;
};

export const buildShoppingReportMetaView = (meta: Record<string, unknown>): ShoppingReportMetaView => {
  const selection = recordField(meta, "selection");
  const metrics = recordField(meta, "metrics");
  const requestedRegion = stringField(selection, "requested_region");
  const authoritative = booleanField(selection, "region_authoritative") === true;
  const constraintFilterDiagnostics = recordArrayField(meta, "offerFilterDiagnostics")
    .filter(isConstraintBearingFilterDiagnostic);
  const selectedProviders = stringArrayField(selection, "providers").length > 0
    ? stringArrayField(selection, "providers")
    : stringArrayField(meta, "providers");
  return {
    selectedProviders,
    ...(stringField(meta, "primaryConstraintSummary") ? { primaryConstraintSummary: stringField(meta, "primaryConstraintSummary") } : {}),
    ...(requestedRegion ? { requestedRegion } : {}),
    regionAuthority: requestedRegion ? (authoritative ? "authoritative" : "advisory") : "missing",
    ...(numberField(metrics, "total_offers") !== undefined ? { totalOffers: numberField(metrics, "total_offers") } : {}),
    ...(numberField(metrics, "candidate_offers") !== undefined ? { candidateOffers: numberField(metrics, "candidate_offers") } : {}),
    failedProviders: stringArrayField(metrics, "failed_providers"),
    alerts: recordArrayField(meta, "alerts"),
    failures: recordArrayField(meta, "failures"),
    offerFilterDiagnostics: constraintFilterDiagnostics,
    malformedMetadata: []
  };
};

export const buildShoppingOfferEvidence = (args: {
  query: string;
  offer: ShoppingOffer;
  referenceIso?: string;
  staleAfterDays: number;
}): ShoppingReportOfferEvidence => {
  const attributes = args.offer.attributes;
  const nestedOffer = recordField(attributes, "shopping_offer");
  const nestedPrice = recordField(nestedOffer, "price");
  const nestedShipping = recordField(nestedOffer, "shipping");
  const priceTrustRaw = booleanField(nestedOffer, "price_is_trustworthy");
  const itemCurrency = args.offer.price.currency.toUpperCase();
  const shippingCurrency = args.offer.shipping.currency.toUpperCase();
  const totalCurrency = itemCurrency || shippingCurrency;
  const totalAmount = args.offer.price.amount + args.offer.shipping.amount;
  const structuredAttributeText = productEvidenceTextValues(attributes).join(" ");
  return {
    offer: args.offer,
    offerId: args.offer.offer_id,
    productId: args.offer.product_id,
    provider: args.offer.provider,
    title: args.offer.title.trim(),
    url: args.offer.url,
    canonicalUrl: stringField(attributes, "canonicalUrl") ?? args.offer.url,
    itemPrice: { amount: args.offer.price.amount, currency: itemCurrency },
    shippingPrice: { amount: args.offer.shipping.amount, currency: shippingCurrency || itemCurrency },
    totalPrice: { amount: totalAmount, currency: totalCurrency },
    currencyMismatch: itemCurrency !== (shippingCurrency || itemCurrency),
    availability: args.offer.availability,
    rating: args.offer.rating,
    reviewsCount: args.offer.reviews_count,
    dealScore: args.offer.deal_score,
    ...(stringField(attributes, "retrievalPath") ? { retrievalPath: stringField(attributes, "retrievalPath") } : {}),
    ...(stringField(nestedOffer, "price_source") ? { priceSource: stringField(nestedOffer, "price_source") } : {}),
    priceTrust: priceTrustRaw === true ? "trusted" : priceTrustRaw === false ? "untrusted" : "unknown",
    ...(stringField(attributes, "brand") ? { brand: stringField(attributes, "brand") } : {}),
    ...(readAnchorPrice(nestedOffer, attributes, itemCurrency) ? { anchorPrice: readAnchorPrice(nestedOffer, attributes, itemCurrency) } : {}),
    freshness: assessFreshness({
      offer: args.offer,
      nestedPrice,
      nestedOffer,
      referenceIso: args.referenceIso,
      staleAfterDays: args.staleAfterDays
    }),
    queryRelevance: assessQueryRelevance(args.query, args.offer.title, structuredAttributeText),
    titleQuality: assessTitleQuality(args.offer.title),
    priceValidity: assessPriceValidity({
      itemAmount: args.offer.price.amount,
      shippingAmount: args.offer.shipping.amount,
      totalAmount
    }),
    buyerLimitations: buyerLimitations({ attributes, nestedOffer, nestedShipping })
  };
};

const duplicateGroupFromEntries = (args: {
  groupId: string;
  reason: ShoppingDuplicateGroup["reason"];
  title: string;
  entries: ShoppingReportOfferEvidence[];
}): ShoppingDuplicateGroup | undefined => {
  const urls = Array.from(new Set(args.entries.map((entry) => entry.canonicalUrl)));
  if (args.entries.length < 2) return undefined;
  return {
    groupId: args.groupId,
    reason: args.reason,
    title: args.title,
    offerIds: args.entries.map((entry) => entry.offerId),
    urls
  };
};

const groupedEntries = (
  evidence: readonly ShoppingReportOfferEvidence[],
  keyForEntry: (entry: ShoppingReportOfferEvidence) => string
): Map<string, ShoppingReportOfferEvidence[]> => {
  const groups = new Map<string, ShoppingReportOfferEvidence[]>();
  for (const entry of evidence) {
    const key = keyForEntry(entry);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return groups;
};

export const buildDuplicateGroups = (evidence: readonly ShoppingReportOfferEvidence[]): ShoppingDuplicateGroup[] => {
  const urlGroups = groupedEntries(evidence, (entry) => entry.canonicalUrl.trim().toLowerCase());
  const titleGroups = groupedEntries(evidence, (entry) => normalizeText(entry.title));
  const productGroups = groupedEntries(evidence, (entry) => entry.productId.trim().toLowerCase());
  const groups: ShoppingDuplicateGroup[] = [];
  for (const [url, entries] of urlGroups) {
    const group = duplicateGroupFromEntries({ groupId: `url:${url}`, reason: "same_url", title: entries[0]?.title ?? url, entries });
    if (group) groups.push(group);
  }
  for (const [title, entries] of titleGroups) {
    const group = duplicateGroupFromEntries({ groupId: `title:${title}`, reason: "same_title", title, entries });
    if (group) groups.push(group);
  }
  for (const [productId, entries] of productGroups) {
    const group = duplicateGroupFromEntries({ groupId: `product:${productId}`, reason: "same_product", title: entries[0]?.title ?? productId, entries });
    if (group) groups.push(group);
  }
  return groups;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const upper = sorted[midpoint] ?? 0;
  const lower = sorted[midpoint - 1] ?? upper;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
};

const average = (values: readonly number[]): number => (
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
);

const currencyGroupEntries = (
  evidence: readonly ShoppingReportOfferEvidence[]
): Array<{ currency: string; entries: ShoppingReportOfferEvidence[] }> => {
  const groups = groupedEntries(evidence, (entry) => entry.totalPrice.currency.toUpperCase());
  return Array.from(groups.entries()).map(([currency, entries]) => ({ currency, entries }));
};

const isMarketBaselineEligible = (entry: ShoppingReportOfferEvidence): boolean => (
  (entry.availability === "in_stock" || entry.availability === "limited")
  && entry.queryRelevance.status !== "weak"
  && entry.titleQuality.status !== "suspicious"
  && entry.freshness.status === "observed"
  && entry.priceTrust === "trusted"
  && entry.priceValidity.status === "valid"
  && entry.itemPrice.amount > MONEY_EPSILON
  && entry.shippingPrice.amount >= 0
  && entry.totalPrice.amount > MONEY_EPSILON
  && !entry.currencyMismatch
);

const marketBaselineCanonicalKey = (entry: ShoppingReportOfferEvidence): string => entry.canonicalUrl.trim().toLowerCase();
const marketBaselineTitleKey = (entry: ShoppingReportOfferEvidence): string => normalizeText(entry.title);
const marketBaselineProductKey = (entry: ShoppingReportOfferEvidence): string => entry.productId.trim().toLowerCase();

const betterBaselineRepresentative = (
  current: ShoppingReportOfferEvidence,
  candidate: ShoppingReportOfferEvidence
): ShoppingReportOfferEvidence => {
  if (candidate.totalPrice.amount < current.totalPrice.amount) return candidate;
  if (candidate.totalPrice.amount > current.totalPrice.amount) return current;
  return candidate.dealScore > current.dealScore ? candidate : current;
};

const findDuplicateRoot = (parents: Map<string, string>, key: string): string => {
  const parent = parents.get(key);
  if (!parent || parent === key) return key;
  const root = findDuplicateRoot(parents, parent);
  parents.set(key, root);
  return root;
};

const unionDuplicateKeys = (parents: Map<string, string>, left: string, right: string): void => {
  const leftRoot = findDuplicateRoot(parents, left);
  const rightRoot = findDuplicateRoot(parents, right);
  if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
};

const baselineDuplicateKeys = (entry: ShoppingReportOfferEvidence): string[] => {
  const keys = [
    `url:${marketBaselineCanonicalKey(entry)}`,
    `title:${marketBaselineTitleKey(entry)}`,
    `product:${marketBaselineProductKey(entry)}`
  ];
  return keys.filter((key) => !key.endsWith(":"));
};

const dedupeMarketBaselineEvidence = (
  eligibleEvidence: readonly ShoppingReportOfferEvidence[],
  allEvidence: readonly ShoppingReportOfferEvidence[]
): ShoppingReportOfferEvidence[] => {
  const parents = new Map<string, string>();
  for (const entry of allEvidence) {
    const keys = baselineDuplicateKeys(entry);
    for (const key of keys) parents.set(key, parents.get(key) ?? key);
    const firstKey = keys[0];
    if (!firstKey) continue;
    for (const key of keys.slice(1)) unionDuplicateKeys(parents, firstKey, key);
  }

  const components = new Map<string, ShoppingReportOfferEvidence>();
  for (const entry of eligibleEvidence) {
    const firstKey = baselineDuplicateKeys(entry)[0] ?? `offer:${entry.offerId}`;
    const root = findDuplicateRoot(parents, firstKey);
    const current = components.get(root);
    components.set(root, current ? betterBaselineRepresentative(current, entry) : entry);
  }
  return Array.from(components.values());
};

export const buildMarketBaseline = (
  evidence: readonly ShoppingReportOfferEvidence[],
  minSample: number
): ShoppingMarketBaseline => {
  const eligibleEvidence = evidence.filter(isMarketBaselineEligible);
  const dedupedEligibleEvidence = dedupeMarketBaselineEvidence(eligibleEvidence, evidence);
  const sortedGroups = currencyGroupEntries(dedupedEligibleEvidence).sort((left, right) => right.entries.length - left.entries.length);
  const group = sortedGroups.find((entry) => entry.entries.length >= minSample);
  if (!group) {
    return {
      status: "unavailable",
      reason: `market baseline unavailable because no quality-eligible same-currency sample reached ${minSample} offers`,
      minSample,
      sampleCount: sortedGroups[0]?.entries.length ?? 0,
      offerIds: [],
      excludedDifferentCurrencyCount: Math.max(0, dedupedEligibleEvidence.length - (sortedGroups[0]?.entries.length ?? 0)),
      anchorEvidenceCount: dedupedEligibleEvidence.filter((entry) => entry.anchorPrice !== undefined).length
    };
  }
  const totals = group.entries.map((entry) => entry.totalPrice.amount);
  return {
    status: "computed",
    reason: "computed from quality-eligible same-currency offer evidence only",
    minSample,
    currency: group.currency,
    sampleCount: group.entries.length,
    averageTotal: average(totals),
    medianTotal: median(totals),
    lowestTotal: Math.min(...totals),
    offerIds: group.entries.map((entry) => entry.offerId),
    excludedDifferentCurrencyCount: dedupedEligibleEvidence.length - group.entries.length,
    anchorEvidenceCount: group.entries.filter((entry) => entry.anchorPrice?.currency === group.currency).length
  };
};

export const anchorDiscountForOffer = (evidence: ShoppingReportOfferEvidence): { amount: number; percent: number } | undefined => {
  if (!evidence.anchorPrice || evidence.anchorPrice.currency !== evidence.totalPrice.currency) return undefined;
  const amount = evidence.anchorPrice.amount - evidence.totalPrice.amount;
  if (amount <= MONEY_EPSILON) return undefined;
  return { amount, percent: (amount / evidence.anchorPrice.amount) * 100 };
};
