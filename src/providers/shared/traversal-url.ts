const STATIC_HOST_PATTERNS = [
  /(^|\.)redditstatic\.com$/i,
  /(^|\.)twimg\.com$/i
];

const STATIC_PATH_EXT_RE = /\.(?:avif|bmp|css|csv|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|pdf|png|svg|txt|wav|webm|webp|woff2?|xml|zip)$/i;

export const isLikelyDocumentUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return false;

    if (STATIC_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
      return false;
    }

    return !STATIC_PATH_EXT_RE.test(parsed.pathname);
  } catch {
    return false;
  }
};
