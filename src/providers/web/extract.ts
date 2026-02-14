export interface ExtractedContent {
  text: string;
  links: string[];
  selectors: Record<string, string[]>;
}

const SCRIPT_STYLE_RE = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;
const SPACE_RE = /\s+/g;
const HREF_RE = /href\s*=\s*(["'])(.*?)\1/gi;

export const extractText = (html: string): string => {
  return html
    .replace(SCRIPT_STYLE_RE, " ")
    .replace(TAG_RE, " ")
    .replace(SPACE_RE, " ")
    .trim();
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
    selectors: extractSelectors(html, selectors)
  };
};

export const toSnippet = (text: string, maxChars = 280): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};
