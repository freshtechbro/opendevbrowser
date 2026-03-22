export interface ExtractedPrice {
  amount: number;
  currency: string;
  source: string;
}

export interface ExtractedMetadata {
  title?: string;
  description?: string;
  brand?: string;
  siteName?: string;
  imageUrls: string[];
  features: string[];
  price?: ExtractedPrice;
}

export interface ExtractedContent {
  text: string;
  links: string[];
  selectors: Record<string, string[]>;
  metadata: ExtractedMetadata;
}

const SCRIPT_STYLE_RE = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;
const SPACE_RE = /\s+/g;
const HREF_RE = /href\s*=\s*(["'])(.*?)\1/gi;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_TAG_RE = /<meta\b[^>]*>/gi;
const JSON_LD_RE = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const LIST_ITEM_RE = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const FEATURE_BLOCK_RE = /<(?:div|p|span)[^>]*class=(["'])[^"'<>]*(?:feature|highlight|benefit|bullet|spec)[^"'<>]*\1[^>]*>([\s\S]*?)<\/(?:div|p|span)>/gi;
const IMAGE_TAG_RE = /<(?:img|source)\b[^>]*>/gi;
const DEFAULT_CURRENCY = "USD";
const REJECT_IMAGE_URL_RE = /(?:^|[/?#_.-])(logo|icon|sprite|badge|avatar|placeholder|pixel|tracking|favicon)(?:[/?#_.-]|$)|\.(?:svg|ico)(?:$|[?#])/i;

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\""
};

const FEATURE_REJECT_RE = /^(quick view|compare|add to cart|previous page|next page|home)$/i;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const decodeHtmlEntities = (value: string): string => {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower in HTML_ENTITY_MAP) {
      return HTML_ENTITY_MAP[lower] ?? match;
    }
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return match;
  });
};

const normalizeWhitespace = (value: string): string => {
  return value.replace(SPACE_RE, " ").trim();
};

const normalizeText = (value: string): string => {
  return normalizeWhitespace(decodeHtmlEntities(value));
};

export const extractText = (html: string): string => {
  return normalizeText(
    html
      .replace(SCRIPT_STYLE_RE, " ")
      .replace(TAG_RE, " ")
  );
};

const normalizeLink = (href: string, baseUrl: string): string | null => {
  if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return null;
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
};

export const extractLinks = (html: string, baseUrl: string): string[] => {
  const links = new Set<string>();
  for (const match of html.matchAll(HREF_RE)) {
    const raw = match[2]?.trim();
    if (!raw) continue;
    const normalized = normalizeLink(raw, baseUrl);
    if (!normalized) continue;
    links.add(normalized);
  }
  return [...links];
};

const readAttribute = (tag: string, name: string): string | undefined => {
  const quoted = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  if (quoted?.[2]) return normalizeText(quoted[2]);
  const unquoted = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
  if (unquoted?.[1]) return normalizeText(unquoted[1]);
  return undefined;
};

const readMetaContent = (html: string, keys: string[]): string | undefined => {
  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  for (const match of html.matchAll(META_TAG_RE)) {
    const tag = match[0];
    const name = readAttribute(tag, "name")?.toLowerCase();
    const property = readAttribute(tag, "property")?.toLowerCase();
    const content = readAttribute(tag, "content");
    if (!content) continue;
    if ((name && keySet.has(name)) || (property && keySet.has(property))) {
      return content;
    }
  }
  return undefined;
};

const readSrcsetUrls = (value: string): string[] => {
  return value
    .split(",")
    .map((entry) => entry.trim().split(/\s+/, 1)[0] ?? "")
    .filter((entry) => entry.length > 0);
};

const readImageTagUrls = (html: string, baseUrl: string): string[] => {
  const urls = new Set<string>();
  for (const match of html.matchAll(IMAGE_TAG_RE)) {
    const tag = match[0];
    const directValues = [
      readAttribute(tag, "src"),
      readAttribute(tag, "data-src"),
      readAttribute(tag, "data-lazy-src"),
      readAttribute(tag, "data-image")
    ];
    for (const directValue of directValues) {
      const normalized = directValue ? normalizeLink(directValue, baseUrl) : null;
      if (!normalized || REJECT_IMAGE_URL_RE.test(normalized)) continue;
      urls.add(normalized);
    }

    const srcsetValues = [
      readAttribute(tag, "srcset"),
      readAttribute(tag, "data-srcset")
    ];
    for (const srcsetValue of srcsetValues) {
      if (!srcsetValue) continue;
      for (const entry of readSrcsetUrls(srcsetValue)) {
        const normalized = normalizeLink(entry, baseUrl);
        if (!normalized || REJECT_IMAGE_URL_RE.test(normalized)) continue;
        urls.add(normalized);
      }
    }
  }
  return [...urls];
};

const flattenJsonLdNodes = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenJsonLdNodes(entry));
  }
  if (!isRecord(value)) {
    return [];
  }
  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    return [value, ...graph.flatMap((entry) => flattenJsonLdNodes(entry))];
  }
  return [value];
};

const readSchemaTypes = (node: Record<string, unknown>): string[] => {
  const typeValue = node["@type"];
  if (typeof typeValue === "string") return [typeValue];
  if (Array.isArray(typeValue)) {
    return typeValue.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
};

const readString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : undefined;
};

const readNestedString = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  return readString(value[key]);
};

const toStringArray = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (isRecord(value)) {
    const nested = readString(value.url);
    return nested ? [nested] : [];
  }
  return [];
};

const readNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const readPriceFromOfferNode = (value: unknown): ExtractedPrice | undefined => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const price = readPriceFromOfferNode(entry);
      if (price) return price;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const currency = readString(value.priceCurrency) ?? DEFAULT_CURRENCY;
  const exactPrice = readNumber(value.price);
  if (exactPrice !== undefined && exactPrice > 0) {
    return {
      amount: exactPrice,
      currency,
      source: "jsonld:price"
    };
  }
  const lowPrice = readNumber(value.lowPrice);
  if (lowPrice !== undefined && lowPrice > 0) {
    return {
      amount: lowPrice,
      currency,
      source: "jsonld:lowPrice"
    };
  }
  return readPriceFromOfferNode(value.priceSpecification);
};

const readJsonLdMetadata = (html: string, baseUrl: string): Partial<ExtractedMetadata> => {
  const metadata: Partial<ExtractedMetadata> = {};
  const imageUrls = new Set<string>();

  for (const match of html.matchAll(JSON_LD_RE)) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const nodes = flattenJsonLdNodes(parsed);
    for (const node of nodes) {
      const types = readSchemaTypes(node).map((entry) => entry.toLowerCase());
      const isProduct = types.includes("product");
      const isOffer = types.includes("offer") || types.includes("aggregateoffer");

      if (!metadata.title && isProduct) {
        metadata.title = readString(node.name);
      }
      if (!metadata.description && isProduct) {
        metadata.description = readString(node.description);
      }
      if (!metadata.brand && isProduct) {
        metadata.brand = readString(node.brand) ?? readNestedString(node.brand, "name");
      }
      if (metadata.price === undefined && (isProduct || isOffer)) {
        metadata.price = readPriceFromOfferNode(node.offers) ?? readPriceFromOfferNode(node);
      }
      if (isProduct) {
        for (const imageValue of toStringArray(node.image)) {
          const normalized = normalizeLink(imageValue, baseUrl);
          if (normalized) imageUrls.add(normalized);
        }
      }
    }
  }

  if (imageUrls.size > 0) {
    metadata.imageUrls = [...imageUrls];
  }
  return metadata;
};

const isLikelyFeature = (value: string): boolean => {
  if (value.length < 8 || value.length > 180) return false;
  if (!/[a-z]/i.test(value)) return false;
  if (FEATURE_REJECT_RE.test(value)) return false;
  if (value.endsWith("?")) return false;
  if (/\$(?:\d|[€£])/.test(value)) return false;
  if (/learn more|free shipping|returns? & orders|select address/i.test(value)) return false;
  return true;
};

const pushFeature = (target: string[], value: string): void => {
  const normalized = normalizeText(value);
  if (!isLikelyFeature(normalized)) return;
  if (!target.includes(normalized)) {
    target.push(normalized);
  }
};

const extractFeatureCandidates = (html: string): string[] => {
  const features: string[] = [];

  for (const match of html.matchAll(FEATURE_BLOCK_RE)) {
    pushFeature(features, extractText(match[2] ?? ""));
    if (features.length >= 12) return features;
  }

  for (const match of html.matchAll(LIST_ITEM_RE)) {
    pushFeature(features, extractText(match[1] ?? ""));
    if (features.length >= 12) return features;
  }

  return features;
};

export const extractMetadata = (html: string, baseUrl: string): ExtractedMetadata => {
  const jsonLd = readJsonLdMetadata(html, baseUrl);
  const title = readMetaContent(html, ["og:title", "twitter:title"])
    ?? jsonLd.title
    ?? (() => {
      const match = TITLE_RE.exec(html);
      return match?.[1] ? normalizeText(match[1]) : undefined;
    })();
  const description = readMetaContent(html, ["description", "og:description", "twitter:description"])
    ?? jsonLd.description;
  const siteName = readMetaContent(html, ["og:site_name", "application-name"]);
  const brand = jsonLd.brand
    ?? readMetaContent(html, ["product:brand", "brand"])
    ?? siteName;

  const imageUrls = new Set<string>(jsonLd.imageUrls ?? []);
  const metaImages = [
    readMetaContent(html, ["og:image"]),
    readMetaContent(html, ["twitter:image"])
  ].filter((entry): entry is string => Boolean(entry));
  for (const imageUrl of metaImages) {
    const normalized = normalizeLink(imageUrl, baseUrl);
    if (normalized) imageUrls.add(normalized);
  }
  for (const imageUrl of readImageTagUrls(html, baseUrl)) {
    imageUrls.add(imageUrl);
  }

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(brand ? { brand } : {}),
    ...(siteName ? { siteName } : {}),
    imageUrls: [...imageUrls],
    features: extractFeatureCandidates(html),
    ...(jsonLd.price ? { price: jsonLd.price } : {})
  };
};

const selectorRegex = (selector: string): RegExp => {
  const safe = selector.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  if (selector.startsWith("#")) {
    const id = selector.slice(1).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`<([a-z0-9-]+)[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  }
  if (selector.startsWith(".")) {
    const className = selector.slice(1).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`<([a-z0-9-]+)[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  }
  return new RegExp(`<${safe}[^>]*>([\\s\\S]*?)<\\/${safe}>`, "gi");
};

export const extractSelectors = (html: string, selectors: string[] = []): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const selector of selectors) {
    const values: string[] = [];
    for (const match of html.matchAll(selectorRegex(selector))) {
      const text = extractText(match[2] ?? match[1] ?? "");
      if (text) {
        values.push(text);
      }
    }
    out[selector] = values;
  }
  return out;
};

export const extractStructuredContent = (
  html: string,
  baseUrl: string,
  selectors: string[] = []
): ExtractedContent => {
  return {
    text: extractText(html),
    links: extractLinks(html, baseUrl),
    selectors: extractSelectors(html, selectors),
    metadata: extractMetadata(html, baseUrl)
  };
};

export const toSnippet = (text: string, maxChars = 280): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};
