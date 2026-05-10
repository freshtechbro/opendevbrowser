const STATIC_HOST_PATTERNS = [
  /(^|\.)analytics\.google\.com$/i,
  /(^|\.)fonts\.googleapis\.com$/i,
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)googleadservices\.com$/i,
  /(^|\.)googletagmanager\.com$/i,
  /(^|\.)googlesyndication\.com$/i,
  /(^|\.)gstatic\.com$/i,
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)redditstatic\.com$/i,
  /(^|\.)twimg\.com$/i,
  /(^|\.)static\.licdn\.com$/i,
  /(^|\.)ytimg\.com$/i,
  /(^|\.)fbcdn\.net$/i,
  /(^|\.)cdninstagram\.com$/i
];

const STATIC_PATH_EXT_RE = /\.(?:avif|bmp|css|csv|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|pdf|png|svg|txt|wav|webm|webp|woff2?|xml|zip)$/i;
export type ResearchDestinationRejectionReason =
  | "login_shell"
  | "privacy_preference_shell"
  | "research_dead_end_shell"
  | "search_results_shell";

const RESEARCH_DEAD_END_LOGIN_SEGMENTS = new Set([
  "account",
  "accounts",
  "login",
  "sign-in",
  "signin",
  "submit"
]);
const RESEARCH_DEAD_END_PRIVACY_ROOT_SEGMENTS = new Set([
  "choice",
  "choices",
  "consent",
  "cookie",
  "cookie-policy",
  "cookie-preferences",
  "cookies",
  "legal",
  "policies",
  "policy",
  "privacy",
  "privacy-policy",
  "prefs",
  "preferences",
  "terms",
  "terms-of-service"
]);
const RESEARCH_DEAD_END_SEARCH_ROOT_SEGMENTS = new Set(["find", "results", "search"]);
const RESEARCH_DEAD_END_OTHER_ROOT_SEGMENTS = new Set(["settings", "verification"]);
const RESEARCH_DEAD_END_PATHS = new Set([
  "/legal/privacy",
  "/policies",
  "/privacy",
  "/privacy-policy",
  "/privacy/choices",
  "/privacychoices",
  "/privacychoices/"
]);

const isPrivacyDeadEndPath = (segments: string[]): boolean => {
  const [first, second] = segments;
  if (!first || !RESEARCH_DEAD_END_PRIVACY_ROOT_SEGMENTS.has(first)) return false;
  if (segments.length === 1) return true;
  return (
    (first === "consent" && second === "manage")
    || (first === "privacy" && second === "choices")
    || (first === "prefs" && second === "privacy")
    || (first === "preferences" && second === "privacy")
    || (first === "legal" && (second === "privacy" || second === "terms"))
    || (first === "policies" && second === "privacy-policy")
  );
};

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

export const isLikelyResearchDestinationUrl = (value: string): boolean => {
  return classifyResearchDestinationRejection(value) === null;
};

export const classifyResearchDestinationRejection = (value: string): ResearchDestinationRejectionReason | null => {
  if (!isLikelyDocumentUrl(value)) return "research_dead_end_shell";
  const parsed = new URL(value);
  const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (RESEARCH_DEAD_END_PATHS.has(pathname)) return "privacy_preference_shell";
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0] ?? "";
  if (segments.some((segment) => RESEARCH_DEAD_END_LOGIN_SEGMENTS.has(segment))) return "login_shell";
  if (RESEARCH_DEAD_END_SEARCH_ROOT_SEGMENTS.has(firstSegment)) return "search_results_shell";
  if (RESEARCH_DEAD_END_OTHER_ROOT_SEGMENTS.has(firstSegment)) return "research_dead_end_shell";
  if (isPrivacyDeadEndPath(segments)) return "privacy_preference_shell";
  return null;
};
