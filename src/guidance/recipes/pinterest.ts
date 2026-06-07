import type { NextStepGuidance, SiteRecipe, SiteRecipeReferenceCandidate } from "../types";

const pinterestGuidance: NextStepGuidance = {
  id: "inspiredesign.harvest.browser_native_site_search.pinterest",
  recipeType: "site_navigation",
  workflow: "inspiredesign",
  severity: "warning",
  readiness: "needs_recovery",
  reasonCode: "pinterest_browser_native_recovery",
  primaryAction: {
    id: "pinterest_browser_native_discovery",
    label: "Use Pinterest browser-native discovery",
    summary: "Use a user-authorized signed-in Pinterest browser session when required, search Pinterest naturally, recover authenticated canonical pin media evidence for concrete pins, and reject full login walls, challenges, boards, source pages, empty grids, unrelated providers, and search-shell pages."
  },
  commands: [{
    id: "pinterest-authenticated-harvest",
    label: "Run an authenticated Pinterest harvest",
    command: "npx opendevbrowser inspiredesign harvest --brief \"Digital photography studio landing page\" --query \"cinematic photography studio landing page inspiration\" --provider social/pinterest --max-references 5 --visual-evidence required --browser-mode extension --use-cookies --cookie-policy required --challenge-automation-mode browser_with_helper --mode json --output-format json"
  }],
  paramsExamples: [{
    id: "pinterest-harvest-input",
    label: "Pinterest discovery input",
    params: {
      provider: "social/pinterest",
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      visualEvidence: "required"
    }
  }],
  fieldExamples: [],
  artifactInputs: [
    { path: "ranked-references.json", purpose: "Confirm accepted references are concrete Pinterest pins with snapshot_ready, motion_ready, or pin_media_ready authority before Canvas continuation.", required: true },
    { path: "visual-evidence.json", purpose: "Reject login, challenge, empty-grid, and search-shell screenshots.", required: true },
    { path: "screenshot-index.json", purpose: "Confirm screenshot paths exist when snapshot_ready evidence is claimed.", required: true },
    { path: "motion-evidence.json", purpose: "Confirm screencast replay and preview paths exist when motion_ready evidence is claimed.", required: true },
    { path: "pin-media-evidence.json", purpose: "Inspect persisted first-party Pinterest pin image, GIF, video, or video-poster metadata for canonical pins; remote media URLs alone are not proof.", required: true },
    { path: "pin-media-index.json", purpose: "Confirm pin_media_ready entries are manifest-backed before treating pin media as design evidence.", required: true }
  ],
  validationChecks: [
    { id: "pinterest-hosts", description: "Accepted URLs stay on Pinterest hosts.", assertion: "acceptedUrls.every(url => { const host = new URL(url).hostname; return host === \"pinterest.com\" || host.endsWith(\".pinterest.com\"); })" },
    { id: "pinterest-canonical-pin-media", description: "Canonical pins continue only with manifest-backed screenshot, screencast, or first-party pin-media artifacts, not search shells, boards, source pages, or URL-only media." },
    { id: "pinterest-visual-grid", description: "Screenshots show usable visual pin content, not blocked UI or unrelated provider pages." }
  ],
  fallbackPolicy: {
    allowed: false,
    requiresUserConfirmation: true,
    reason: "Do not switch a Pinterest-scoped request to unrelated web providers without user confirmation."
  },
  doNotProceedIf: [
    "Pinterest is logged out when cookies are required or protected by a challenge",
    "The signed-in Pinterest session was not explicitly authorized by the user",
    "Captured page is only a search shell, login wall, board, source page, unrelated provider, or empty grid",
    "Pin-media evidence only records remote media URLs without persisted first-party bytes in pin-media-index.json",
    "No ranked Pinterest references remain after scoring"
  ]
};

const PINTEREST_PIN_ID_PATTERN = /^\d+$/;
const RESERVED_PINTEREST_BOARD_PATHS = new Set([
  "about",
  "ads",
  "board",
  "business",
  "careers",
  "contact",
  "create",
  "developers",
  "explore",
  "help",
  "ideas",
  "login",
  "messages",
  "notifications",
  "pin",
  "search",
  "settings",
  "shopping",
  "terms",
  "today"
]);
const RESERVED_PINTEREST_IDEA_PATHS = new Set(["create", "edit", "search"]);
const RESERVED_PINTEREST_PROFILE_TABS = new Set([
  "activity",
  "boards",
  "comments",
  "created",
  "followers",
  "following",
  "likes",
  "pins",
  "saved",
  "tried"
]);

export const isAllowedPinterestReferenceHost = (hostname: string): boolean => (
  hostname === "pinterest.com"
  || hostname === "www.pinterest.com"
  || /^[a-z]{2}\.pinterest\.com$/.test(hostname)
);

export const normalizePinterestReferenceUrl = (value: string): string | null => {
  const trimmed = value.trim();
  const absolute = trimmed.startsWith("/")
    ? `https://www.pinterest.com${trimmed}`
    : trimmed;
  try {
    const url = new URL(absolute);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.protocol = "https:";
    const hostname = url.hostname.toLowerCase();
    if (!isAllowedPinterestReferenceHost(hostname)) return null;
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const isPin = (
      pathSegments[0] === "pin"
      && pathSegments.length === 2
      && PINTEREST_PIN_ID_PATTERN.test(pathSegments[1]!)
    );
    const isIdea = (
      pathSegments[0] === "ideas"
      && pathSegments.length >= 3
      && !RESERVED_PINTEREST_IDEA_PATHS.has(pathSegments[1] ?? "")
      && PINTEREST_PIN_ID_PATTERN.test(pathSegments[pathSegments.length - 1]!)
    );
    const isBoard = pathSegments.length === 2
      && !RESERVED_PINTEREST_BOARD_PATHS.has(pathSegments[0] ?? "")
      && !RESERVED_PINTEREST_PROFILE_TABS.has(pathSegments[1] ?? "")
      && pathSegments.every((segment) => !segment.startsWith("_"));
    if (!isPin && !isIdea && !isBoard) return null;
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
};

const extractPinterestUrlsFromText = (value: string): string[] => {
  const candidates = value.match(/(?:https?:\/\/(?:(?:www|[a-z]{2})\.)?pinterest\.com\/(?:pin\/[a-zA-Z0-9_-]+|ideas\/[a-zA-Z0-9/_-]+|[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)|(?<![A-Za-z0-9.])\/(?:pin\/[a-zA-Z0-9_-]+|ideas\/[a-zA-Z0-9/_-]+|[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+))\/?/g) ?? [];
  return candidates
    .map(normalizePinterestReferenceUrl)
    .filter((url): url is string => url !== null);
};

const buildPinterestSearchUrl = (query: string): string => {
  const params = new URLSearchParams({ q: query });
  return `https://www.pinterest.com/search/pins/?${params.toString()}`;
};

const extractPinterestReferenceUrls = (candidate: SiteRecipeReferenceCandidate): string[] => {
  return [
    normalizePinterestReferenceUrl(candidate.url ?? ""),
    ...(candidate.links ?? []).map(normalizePinterestReferenceUrl),
    ...extractPinterestUrlsFromText(candidate.content ?? ""),
    ...extractPinterestUrlsFromText(candidate.html ?? "")
  ].filter((url): url is string => url !== null);
};

export const pinterestSiteRecipe: SiteRecipe = {
  id: "social/pinterest",
  providerIds: ["social/pinterest", "pinterest"],
  hostnames: ["pinterest.com", "www.pinterest.com", "uk.pinterest.com"],
  authMode: "authenticated_preferred",
  navigationSteps: [
    { id: "open", instruction: "Open Pinterest in the requested browser mode." },
    { id: "verify-session", instruction: "Verify the page is logged in before searching when cookies are required." },
    { id: "search", instruction: "Use the Pinterest search box with the brief-specific visual query." },
    { id: "scroll", instruction: "Scroll enough to collect varied concrete pins for the brief." },
    { id: "collect", instruction: "Collect candidate URLs only from visual result pages, then prefer canonical pin URLs for product-ready evidence." }
  ],
  badStates: [
    { id: "login", markers: ["log in", "sign up", "continue with"], reasonCode: "auth_required", recoveryAction: "Use extension mode with a user-authorized logged-in Pinterest session." },
    { id: "challenge", markers: ["captcha", "verification", "challenge"], reasonCode: "challenge_detected", recoveryAction: "Resolve the browser challenge before rerunning harvest." },
    { id: "search-shell", markers: ["pin card", "your profile", "when autocomplete results are available"], reasonCode: "env_limited", recoveryAction: "Open a concrete canonical pin before capture." }
  ],
  evidenceRequirements: [
    { id: "visual-grid", description: "Candidate shows visual design material, not only Pinterest chrome.", validation: "Screenshot contains concrete pin content when snapshot_ready evidence is claimed." },
    { id: "pin-media-artifact", description: "Canonical pin media is persisted as first-party bytes before it counts as design evidence.", validation: "pin-media-index.json contains the artifact path, hash, dimensions, content type, canonical source URL, and first-party i.pinimg.com provenance." },
    { id: "on-brief", description: "Candidate matches the design brief surface and style intent.", validation: "Reference signals overlap the brief target and are not generic marketplace chrome." }
  ],
  recoverySteps: [
    { id: "authenticate", instruction: "Use extension mode and cookies only from a user-authorized signed-in Pinterest tab." },
    { id: "explicit-url", instruction: "If search is blocked, provide explicit canonical Pinterest pin URLs rather than boards, source pages, or search result URLs." },
    { id: "pin-media-proof", instruction: "Inspect pin-media-evidence.json and pin-media-index.json, then continue only when canonical pins have persisted first-party media bytes or snapshot or motion authority." }
  ],
  browserNativeDiscovery: {
    buildSearchUrl: buildPinterestSearchUrl,
    extractReferenceUrls: extractPinterestReferenceUrls
  },
  guidance: pinterestGuidance
};
