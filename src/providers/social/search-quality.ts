import type { SocialPlatform } from "./index";

export type SocialSearchShellCode =
  | "social_render_shell"
  | "social_js_required_shell"
  | "social_first_party_help_shell"
  | "social_verification_wall";

const TARGETED_PLATFORMS = new Set<SocialPlatform>(["x", "bluesky", "reddit", "facebook", "threads"]);
const SOCIAL_JS_REQUIRED_RE = /\b(?:javascript (?:is not available|required|is disabled(?: in this browser)?)|you need to enable javascript|please enable javascript)\b/i;
const BLUESKY_LOGGED_OUT_SEARCH_RE = /\bsearch is currently unavailable when logged out\b/i;
const BLUESKY_EMPTY_SEARCH_SHELL_RE = /\b(?:follow 10 people to get started|find people to follow)\b/i;
const REDDIT_VERIFICATION_WALL_RE = /\b(?:please wait for verification|verify (?:you(?:'re| are) human|that you(?:'re| are) human)|security check)\b/i;
const FACEBOOK_SEARCH_RESULTS_HEADING_RE = /\bsearch results\b/i;
const FACEBOOK_SEARCH_RESULT_MARKERS = [
  /\bshared with public\b/i,
  /\bopen reel in reels viewer\b/i,
  /\bcomment as\b/i
] as const;
const REDDIT_BLOCKED_EXPANSION_HOSTS = ["accounts.google.com", "ads.reddit.com"] as const;
const REDDIT_BLOCKED_FIRST_SEGMENTS = new Set(["account", "ads", "notifications", "submit", "verification"]);

type SocialSearchLinkEvidence = {
  usableLinks: string[];
  usableFirstPartyLinks: string[];
  usableContentLinks: string[];
  blockedLinks: string[];
};

const FIRST_PARTY_HELP_HOSTS: Partial<Record<SocialPlatform, string[]>> = {
  x: [
    "help.x.com",
    "developer.x.com",
    "business.x.com",
    "business.twitter.com",
    "legal.x.com",
    "legal.twitter.com",
    "support.x.com",
    "support.twitter.com",
    "t.co"
  ],
  bluesky: ["atproto.com", "docs.bsky.app", "bsky.social", "blueskyweb.zendesk.com", "go.bsky.app"],
  reddit: ["support.reddithelp.com", "reddithelp.com", "redditinc.com"]
};

const normalizeText = (value: string | undefined): string => (
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : ""
);

const resolveCandidateUrl = (value: string, baseUrl: string): string | null => {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
};

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const matchesHost = (host: string, candidates: readonly string[]): boolean => {
  const normalized = host.toLowerCase();
  return candidates.some((candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`));
};

const firstPathSegment = (pathname: string): string | null => {
  const [firstSegment] = pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  return typeof firstSegment === "string" && firstSegment.length > 0 ? firstSegment : null;
};

const isStaticMetadataPath = (pathname: string): boolean => {
  const normalized = pathname.toLowerCase();
  return normalized.endsWith(".json")
    || normalized.endsWith(".xml")
    || normalized.endsWith(".txt")
    || normalized.endsWith(".webmanifest")
    || normalized.endsWith(".ico");
};

const isTargetedPlatform = (platform: SocialPlatform): boolean => TARGETED_PLATFORMS.has(platform);

const isFirstPartyHelpHost = (platform: SocialPlatform, host: string): boolean => {
  const candidates = FIRST_PARTY_HELP_HOSTS[platform];
  return Array.isArray(candidates) && matchesHost(host, candidates);
};

const isPrimaryRedditHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  return normalized === "www.reddit.com"
    || normalized === "reddit.com"
    || normalized === "old.reddit.com";
};

const isPrimaryFacebookHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  return normalized === "www.facebook.com"
    || normalized === "facebook.com"
    || normalized === "m.facebook.com";
};

const isPrimaryThreadsHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  return normalized === "www.threads.net" || normalized === "threads.net";
};

const isFacebookSearchLikePath = (pathname: string): boolean => (
  pathname === "/watch/search"
  || pathname === "/watch/search/"
  || pathname.startsWith("/watch/explore/")
  || pathname.startsWith("/search/")
  || pathname.startsWith("/public/")
  || pathname.startsWith("/hashtag/")
);

const isBlockedFacebookNonContentUrl = (
  parsed: URL,
  options: { includeSearchRoute: boolean }
): boolean => {
  if (!isPrimaryFacebookHost(parsed.hostname)) {
    return false;
  }
  const pathname = parsed.pathname.toLowerCase();
  if (
    pathname === "/"
    || pathname === "/login"
    || pathname === "/login/"
    || pathname === "/reg"
    || pathname === "/reg/"
    || pathname.startsWith("/recover/")
  ) {
    return true;
  }
  if ((pathname === "/watch" || pathname === "/watch/") && !parsed.searchParams.get("v")) {
    return true;
  }
  if (isStaticMetadataPath(pathname)) {
    return true;
  }
  return options.includeSearchRoute && isFacebookSearchLikePath(pathname);
};

const isBlockedRedditNonContentUrl = (
  parsed: URL,
  options: { includeSearchRoute: boolean }
): boolean => {
  const host = parsed.hostname.toLowerCase();
  if (matchesHost(host, REDDIT_BLOCKED_EXPANSION_HOSTS)) {
    return true;
  }
  if (!isPrimaryRedditHost(host)) {
    return false;
  }
  const pathname = parsed.pathname.toLowerCase();
  if (
    pathname === "/"
    || pathname === "/login"
    || pathname === "/login/"
    || (options.includeSearchRoute && (pathname === "/search" || pathname === "/search/"))
  ) {
    return true;
  }
  const pathSegment = firstPathSegment(pathname);
  return pathSegment !== null && REDDIT_BLOCKED_FIRST_SEGMENTS.has(pathSegment);
};

const isRootShellUrl = (platform: SocialPlatform, parsed: URL): boolean => {
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  switch (platform) {
    case "x":
      return host === "x.com"
        && (pathname === "/" || pathname === "/home" || pathname === "/login" || pathname.startsWith("/i/flow/login"));
    case "bluesky":
      return host === "bsky.app"
        && (pathname === "/" || pathname === "/login");
    case "reddit":
      return isBlockedRedditNonContentUrl(parsed, { includeSearchRoute: false });
    case "facebook":
      return isBlockedFacebookNonContentUrl(parsed, { includeSearchRoute: false });
    case "threads":
      return isPrimaryThreadsHost(host)
        && (pathname === "/" || pathname === "/login" || pathname === "/login/");
    default:
      return false;
  }
};

const isBlockedExpansionPath = (platform: SocialPlatform, parsed: URL): boolean => {
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  switch (platform) {
    case "x":
      return host === "x.com"
        && (
          pathname === "/"
          || pathname === "/home"
          || pathname === "/login"
          || pathname === "/privacy"
          || pathname === "/search"
          || pathname === "/tos"
          || isStaticMetadataPath(pathname)
          || pathname.startsWith("/i/flow/login")
        );
    case "bluesky":
      return host === "bsky.app"
        && (
          pathname === "/"
          || pathname === "/login"
          || pathname === "/search"
          || isStaticMetadataPath(pathname)
          || (/^\/profile\/[^/]+\/feed\/[^/]+$/.test(pathname))
        );
    case "reddit":
      return isBlockedRedditNonContentUrl(parsed, { includeSearchRoute: true });
    case "facebook":
      return isBlockedFacebookNonContentUrl(parsed, { includeSearchRoute: true });
    case "threads":
      return isPrimaryThreadsHost(host)
        && (
          pathname === "/"
          || pathname === "/login"
          || pathname === "/search"
          || pathname === "/search/"
          || isStaticMetadataPath(pathname)
        );
    default:
      return false;
  }
};

const isFirstPartySearchRoute = (platform: SocialPlatform, parsed: URL): boolean => {
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  switch (platform) {
    case "x":
      return host === "x.com" && pathname === "/search";
    case "bluesky":
      return host === "bsky.app" && pathname === "/search";
    case "reddit":
      return isPrimaryRedditHost(host) && (pathname === "/search" || pathname === "/search/");
    case "facebook":
      return isPrimaryFacebookHost(host) && isFacebookSearchLikePath(pathname);
    case "threads":
      return isPrimaryThreadsHost(host) && (pathname === "/search" || pathname === "/search/");
    default:
      return false;
  }
};

const collectSocialSearchLinkEvidence = (
  platform: SocialPlatform,
  baseUrl: string,
  links: readonly string[]
): SocialSearchLinkEvidence => {
  const evidence: SocialSearchLinkEvidence = {
    usableLinks: [],
    usableFirstPartyLinks: [],
    usableContentLinks: [],
    blockedLinks: []
  };

  for (const candidate of links) {
    const resolved = resolveCandidateUrl(candidate, baseUrl);
    if (!resolved) {
      continue;
    }
    if (platform === "x" || platform === "bluesky") {
      if (isUsableFirstPartySearchResultUrl(platform, resolved)) {
        evidence.usableLinks.push(resolved);
        evidence.usableFirstPartyLinks.push(resolved);
        if (isUsableSocialSearchContentUrl(platform, resolved)) {
          evidence.usableContentLinks.push(resolved);
        }
      } else {
        evidence.blockedLinks.push(resolved);
      }
      continue;
    }
    if (isAllowedSocialSearchExpansionUrl(platform, resolved)) {
      evidence.usableLinks.push(resolved);
      if (isUsableSocialSearchContentUrl(platform, resolved)) {
        evidence.usableContentLinks.push(resolved);
      }
    } else {
      evidence.blockedLinks.push(resolved);
    }
  }

  return evidence;
};

const isUsableFirstPartySearchResultUrl = (platform: SocialPlatform, url: string): boolean => {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    (platform === "x" && host !== "x.com")
    || (platform === "bluesky" && host !== "bsky.app")
  ) {
    return false;
  }
  if (isFirstPartyHelpHost(platform, host)) {
    return false;
  }
  return !isBlockedExpansionPath(platform, parsed);
};

const isUsableBlueskySearchEvidenceUrl = (url: string): boolean => {
  const parsed = parseUrl(url);
  return parsed !== null
    && parsed.hostname.toLowerCase() === "bsky.app"
    && /^\/profile\/[^/]+\/post\/[^/]+$/.test(parsed.pathname.toLowerCase());
};

const isUsableXSearchEvidenceUrl = (url: string): boolean => {
  const parsed = parseUrl(url);
  return parsed !== null
    && parsed.hostname.toLowerCase() === "x.com"
    && (
      /^\/[^/]+\/status\/\d+\/?$/.test(parsed.pathname.toLowerCase())
      || /^\/i\/web\/status\/\d+\/?$/.test(parsed.pathname.toLowerCase())
    );
};

const isUsableRedditSearchEvidenceUrl = (url: string): boolean => {
  const parsed = parseUrl(url);
  return parsed !== null
    && isPrimaryRedditHost(parsed.hostname)
    && /^\/r\/[^/]+\/comments\/[^/]+(?:\/|$)/.test(parsed.pathname.toLowerCase());
};

const isUsableFacebookSearchEvidenceUrl = (url: string): boolean => {
  const parsed = parseUrl(url);
  if (parsed === null || !isPrimaryFacebookHost(parsed.hostname)) {
    return false;
  }
  const pathname = parsed.pathname.toLowerCase();
  if ((pathname === "/watch" || pathname === "/watch/") && parsed.searchParams.get("v")) {
    return true;
  }
  return /^\/reel\/[^/]+\/?$/.test(pathname)
    || /^\/groups\/[^/]+\/posts\/[^/]+\/?$/.test(pathname)
    || /^\/[^/]+\/videos\/[^/]+\/?$/.test(pathname)
    || /^\/share\/v\/[^/]+\/?$/.test(pathname)
    || ((pathname === "/permalink.php" || pathname === "/story.php") && parsed.searchParams.has("story_fbid"))
    || (pathname === "/photo/" && parsed.searchParams.has("fbid"));
};

const isUsableThreadsSearchEvidenceUrl = (url: string): boolean => {
  const parsed = parseUrl(url);
  return parsed !== null
    && isPrimaryThreadsHost(parsed.hostname)
    && /^\/@[^/]+\/post\/[^/]+\/?$/.test(parsed.pathname.toLowerCase());
};

const isRetainableFacebookSearchSupportUrl = (url: string): boolean => {
  const parsed = parseUrl(url);
  if (parsed === null || !isPrimaryFacebookHost(parsed.hostname)) {
    return false;
  }
  if (isBlockedFacebookNonContentUrl(parsed, { includeSearchRoute: true })) {
    return false;
  }
  if (isFirstPartySearchRoute("facebook", parsed)) {
    return false;
  }
  return !isUsableFacebookSearchEvidenceUrl(url);
};

const hasFacebookSearchResultSignals = (
  input: { url: string; title?: string; content?: string; links?: readonly string[] }
): boolean => {
  const parsed = parseUrl(input.url);
  if (parsed === null || !isFirstPartySearchRoute("facebook", parsed)) {
    return false;
  }
  const combined = `${normalizeText(input.title)} ${normalizeText(input.content)}`.trim();
  const hasSearchHeading = FACEBOOK_SEARCH_RESULTS_HEADING_RE.test(combined);
  const markerCount = FACEBOOK_SEARCH_RESULT_MARKERS.filter((pattern) => pattern.test(combined)).length;
  const evidence = collectSocialSearchLinkEvidence("facebook", parsed.toString(), Array.isArray(input.links) ? input.links : []);
  const supportLinkCount = evidence.usableLinks.filter(isRetainableFacebookSearchSupportUrl).length;
  if (markerCount >= 2) {
    return true;
  }
  if (!hasSearchHeading) {
    return false;
  }
  if (markerCount >= 1) {
    return true;
  }
  return supportLinkCount >= 2;
};

const isUsableSocialSearchContentUrl = (
  platform: SocialPlatform,
  url: string
): boolean => {
  switch (platform) {
    case "x":
      return isUsableXSearchEvidenceUrl(url);
    case "bluesky":
      return isUsableBlueskySearchEvidenceUrl(url);
    case "reddit":
      return isUsableRedditSearchEvidenceUrl(url);
    case "facebook":
      return isUsableFacebookSearchEvidenceUrl(url);
    case "threads":
      return isUsableThreadsSearchEvidenceUrl(url);
    default:
      return false;
  }
};

const hasUsableFirstPartySearchEvidence = (
  platform: SocialPlatform,
  parsed: URL | null,
  links: readonly string[]
): boolean => (
  parsed !== null
  && isFirstPartySearchRoute(platform, parsed)
  && collectSocialSearchLinkEvidence(platform, parsed.toString(), links).usableContentLinks.length > 0
);

export const isFirstPartySocialSearchRoute = (
  platform: SocialPlatform,
  url: string
): boolean => {
  const parsed = parseUrl(url);
  return parsed !== null && isFirstPartySearchRoute(platform, parsed);
};

export const detectSocialSearchShell = (
  platform: SocialPlatform,
  input: { url: string; title?: string; content?: string; links?: readonly string[] }
): { providerShell: SocialSearchShellCode; browserRequired: true } | null => {
  if (!isTargetedPlatform(platform)) {
    return null;
  }

  const parsed = parseUrl(input.url);
  const combined = `${normalizeText(input.title)} ${normalizeText(input.content)}`.trim();
  const links = Array.isArray(input.links) ? input.links : [];
  if (parsed && isFirstPartyHelpHost(platform, parsed.hostname)) {
    return {
      providerShell: "social_first_party_help_shell",
      browserRequired: true
    };
  }

  if (platform === "reddit" && REDDIT_VERIFICATION_WALL_RE.test(combined)) {
    return {
      providerShell: "social_verification_wall",
      browserRequired: true
    };
  }

  if (
    platform === "bluesky"
    && parsed
    && isFirstPartySearchRoute(platform, parsed)
    && BLUESKY_LOGGED_OUT_SEARCH_RE.test(combined)
  ) {
    return {
      providerShell: "social_js_required_shell",
      browserRequired: true
    };
  }

  if (
    platform === "bluesky"
    && parsed
    && isFirstPartySearchRoute(platform, parsed)
    && BLUESKY_EMPTY_SEARCH_SHELL_RE.test(combined)
  ) {
    return {
      providerShell: "social_render_shell",
      browserRequired: true
    };
  }

  if (
    (platform === "x" || platform === "bluesky")
    && parsed
    && isFirstPartySearchRoute(platform, parsed)
    && SOCIAL_JS_REQUIRED_RE.test(combined)
    && !hasUsableFirstPartySearchEvidence(platform, parsed, links)
  ) {
    return {
      providerShell: "social_js_required_shell",
      browserRequired: true
    };
  }

  if (parsed && isRootShellUrl(platform, parsed)) {
    return {
      providerShell: "social_render_shell",
      browserRequired: true
    };
  }

  if (
    parsed
    && isFirstPartySearchRoute(platform, parsed)
    && platform === "facebook"
    && hasFacebookSearchResultSignals(input)
  ) {
    return null;
  }

  if (
    parsed
    && isFirstPartySearchRoute(platform, parsed)
    && !hasUsableFirstPartySearchEvidence(platform, parsed, links)
  ) {
    return {
      providerShell: "social_render_shell",
      browserRequired: true
    };
  }

  return null;
};

export const isAllowedSocialSearchExpansionUrl = (
  platform: SocialPlatform,
  url: string
): boolean => {
  if (!isTargetedPlatform(platform)) {
    return true;
  }

  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  if (isFirstPartyHelpHost(platform, parsed.hostname)) {
    return false;
  }

  return !isBlockedExpansionPath(platform, parsed);
};

const socialSearchLinkPriority = (
  platform: SocialPlatform,
  candidate: string,
  baseUrl: string
): number => {
  const resolved = resolveCandidateUrl(candidate, baseUrl);
  if (!resolved) {
    return 3;
  }
  if (isUsableSocialSearchContentUrl(platform, resolved)) {
    return 0;
  }
  return isAllowedSocialSearchExpansionUrl(platform, resolved) ? 1 : 2;
};

export const prioritizeSocialSearchLinks = (
  platform: SocialPlatform,
  baseUrl: string,
  links: readonly string[]
): string[] => {
  if (!isTargetedPlatform(platform) || links.length < 2) {
    return [...links];
  }
  return links
    .map((url, index) => ({
      url,
      index,
      priority: socialSearchLinkPriority(platform, url, baseUrl)
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map((entry) => entry.url);
};

export const selectUsableSocialSearchLinks = (
  platform: SocialPlatform,
  baseUrl: string,
  links: readonly string[]
): string[] => {
  if (!isTargetedPlatform(platform)) {
    return [...links];
  }
  const evidence = collectSocialSearchLinkEvidence(platform, baseUrl, links);
  return prioritizeSocialSearchLinks(platform, baseUrl, evidence.usableContentLinks);
};
