import { isAllowedPinterestReferenceHost, normalizePinterestReferenceUrl } from "../guidance/recipes/pinterest";

export type PinterestMediaKind =
  | "image_pin"
  | "video_pin"
  | "unknown_pin"
  | "board"
  | "idea_page"
  | "source_page"
  | "shell"
  | "login_challenge"
  | "invalid";

export type PinterestSourcePageQuality =
  | "pin_media"
  | "pin_grid_media"
  | "search_shell"
  | "chrome_only"
  | "login_challenge"
  | "unknown"
  | "invalid";

export type PinterestPrimaryCaptureStrategy =
  | "capture_off"
  | "deep_diagnostics"
  | "visual_first"
  | "motion_first"
  | "visual_first_with_deep_diagnostics"
  | "motion_first_with_deep_diagnostics"
  | "source_diagnostic";

export type PinterestCandidateInput = {
  url?: string;
  title?: string;
  content?: string;
  html?: string;
  links?: readonly string[];
  allowPinMediaPageQuality?: boolean;
};

export type PinterestMediaClassification = {
  kind: PinterestMediaKind;
  confidence: number;
  productCandidate: boolean;
  sourcePageQuality: PinterestSourcePageQuality;
  reasons: string[];
  diagnosticBlockers: string[];
};

const PIN_ID_PATTERN = /^\d+$/;
const STRUCTURAL_VIDEO_MARKERS = ["<video", "aria-label=\"video", "aria-label='video", "data-test-id=\"video"];
const STRUCTURAL_IMAGE_MARKERS = [
  "pinrep-image",
  "data-test-id=\"closeup-image",
  "data-test-id='closeup-image",
  "data-test-id=\"pinrep-image",
  "data-test-id='pinrep-image"
];
const STRUCTURAL_PIN_MEDIA_MARKERS = [...STRUCTURAL_VIDEO_MARKERS, ...STRUCTURAL_IMAGE_MARKERS];
const MEDIA_GRID_MARKERS = ["data-grid", "data-test-id=\"pinwrapper", "data-test-id='pinwrapper"];
const SEARCH_RESULT_CONTEXT_MARKERS = [
  "data-grid=\"search-results",
  "data-grid='search-results",
  "aria-label=\"search results",
  "aria-label='search results"
];
const SEARCH_SHELL_MARKERS = [
  "search results for",
  "related searches",
  "when autocomplete results are available",
  "pin card"
];
const CHROME_MARKERS = ["your profile", "updates", "messages", "settings & support", "accounts"];
const CHROME_ONLY_URL_PATHS = new Set(["account", "accounts", "settings"]);
const LOGIN_CHALLENGE_MARKERS = ["log in", "login", "sign in", "sign up", "continue with", "captcha", "verification", "challenge"];
const PIN_REFERENCE_TEXT_PATTERN = /(?:https?:\/\/(?:(?:www|[a-z]{2})\.)?pinterest\.com)?\/pin\/\d+\/?(?=[?#\s"'<>)]|$)/g;

const textForCandidate = (input: PinterestCandidateInput): string => (
  [
    input.url,
    input.title,
    input.content,
    input.html,
    ...(input.links ?? [])
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ").toLowerCase()
);

const structuralTextForCandidate = (input: PinterestCandidateInput): string => (
  typeof input.html === "string" && input.html.trim().length > 0 ? input.html.toLowerCase() : ""
);

const pathSegmentsForUrl = (value: string | undefined): string[] => {
  if (!value) return [];
  try {
    return new URL(value).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
};

const isPinterestHost = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return isAllowedPinterestReferenceHost(hostname);
  } catch {
    return false;
  }
};

const isPinterestSearchResultPageUrl = (value: string | undefined): boolean => {
  const segments = pathSegmentsForUrl(value);
  return isPinterestHost(value) && segments[0] === "search" && segments[1] === "pins";
};

const isPinterestChromeOnlyPageUrl = (value: string | undefined): boolean => {
  const [firstSegment] = pathSegmentsForUrl(value);
  return isPinterestHost(value) && CHROME_ONLY_URL_PATHS.has(firstSegment ?? "");
};

const includesAny = (text: string, markers: readonly string[]): boolean => markers.some((marker) => text.includes(marker));

export const hasPinterestChromeMarkers = (input: PinterestCandidateInput): boolean => includesAny(
  textForCandidate(input),
  CHROME_MARKERS
);

export const isCanonicalPinterestPinUrl = (value: string | undefined): boolean => {
  const segments = pathSegmentsForUrl(value);
  return isPinterestHost(value)
    && segments.length === 2
    && segments[0] === "pin"
    && PIN_ID_PATTERN.test(segments[1] ?? "");
};

const hasCanonicalPinterestPinReference = (input: PinterestCandidateInput): boolean => {
  const values = [input.url, input.content, input.html, ...(input.links ?? [])]
    .filter((value): value is string => typeof value === "string");
  return values.some((value) => {
    const normalized = normalizePinterestReferenceUrl(value);
    if (isCanonicalPinterestPinUrl(normalized ?? undefined)) return true;
    return (value.match(PIN_REFERENCE_TEXT_PATTERN) ?? [])
      .some((match) => isCanonicalPinterestPinUrl(normalizePinterestReferenceUrl(match) ?? undefined));
  });
};

const hasSearchResultContext = (input: PinterestCandidateInput): boolean => {
  if (isPinterestSearchResultPageUrl(input.url)) return true;
  if (hasPinterestChromeMarkers(input)) return false;
  return includesAny(structuralTextForCandidate(input), SEARCH_RESULT_CONTEXT_MARKERS);
};

const hasRenderedResultSignals = (input: PinterestCandidateInput, text: string): boolean => (
  hasSearchResultContext(input)
  && hasCanonicalPinterestPinReference(input)
  && (
    includesAny(text, SEARCH_SHELL_MARKERS)
    || includesAny(text, MEDIA_GRID_MARKERS)
  )
);

const hardBlockerQualityForCandidate = (input: PinterestCandidateInput, text: string): PinterestSourcePageQuality | undefined => {
  if (includesAny(text, LOGIN_CHALLENGE_MARKERS)) return "login_challenge";
  if (isPinterestChromeOnlyPageUrl(input.url)) return "chrome_only";
  if (includesAny(text, CHROME_MARKERS) && !hasRenderedResultSignals(input, text)) return "chrome_only";
  if (includesAny(text, SEARCH_SHELL_MARKERS)) return "search_shell";
  return undefined;
};

const qualityForSourceText = (input: PinterestCandidateInput, text: string): PinterestSourcePageQuality => {
  const hardBlockerQuality = hardBlockerQualityForCandidate(input, text);
  if (hardBlockerQuality) return hardBlockerQuality;
  if (includesAny(text, MEDIA_GRID_MARKERS)) return "pin_grid_media";
  return isPinterestHost(input.url) ? "unknown" : "invalid";
};

const qualityForPinCandidate = (input: PinterestCandidateInput, text: string): PinterestSourcePageQuality => {
  const hardBlockerQuality = hardBlockerQualityForCandidate(input, text);
  if (hardBlockerQuality) return hardBlockerQuality;
  if (input.allowPinMediaPageQuality !== false && includesAny(structuralTextForCandidate(input), STRUCTURAL_PIN_MEDIA_MARKERS)) {
    return "pin_media";
  }
  if (includesAny(text, MEDIA_GRID_MARKERS)) return "pin_grid_media";
  return "unknown";
};

const blockersForKind = (kind: PinterestMediaKind): string[] => {
  if (kind === "unknown_pin") return ["pin_media_type_unproven"];
  if (kind === "board") return ["board_requires_concrete_media_extraction"];
  if (kind === "idea_page") return ["idea_page_requires_concrete_media_extraction"];
  if (kind === "shell") return ["search_shell_without_media_signals"];
  if (kind === "source_page") return ["source_page_requires_concrete_pin_extraction"];
  if (kind === "login_challenge") return ["login_or_challenge_blocks_reference_extraction"];
  if (kind === "invalid") return ["invalid_pinterest_candidate"];
  return [];
};

const kindForCandidate = (input: PinterestCandidateInput, text: string): PinterestMediaKind => {
  const normalized = normalizePinterestReferenceUrl(input.url ?? "");
  const segments = pathSegmentsForUrl(input.url);
  const hardBlockerQuality = hardBlockerQualityForCandidate(input, text);
  if (hardBlockerQuality === "login_challenge") return "login_challenge";
  if (hardBlockerQuality) return "shell";
  if (isCanonicalPinterestPinUrl(input.url)) {
    const structuralText = structuralTextForCandidate(input);
    if (includesAny(structuralText, STRUCTURAL_VIDEO_MARKERS)) return "video_pin";
    if (includesAny(structuralText, STRUCTURAL_IMAGE_MARKERS)) return "image_pin";
    return "unknown_pin";
  }
  if (isPinterestHost(input.url) && segments[0] === "ideas") return "idea_page";
  if (isPinterestHost(input.url) && segments[0] === "source") return "source_page";
  if (normalized) return "board";
  if (!isPinterestHost(input.url)) return "invalid";
  return "source_page";
};

export const classifyPinterestCandidate = (input: PinterestCandidateInput): PinterestMediaClassification => {
  const text = textForCandidate(input);
  const kind = kindForCandidate(input, text);
  const sourcePageQuality = kind === "image_pin" || kind === "video_pin" || kind === "unknown_pin"
    ? qualityForPinCandidate(input, text)
    : qualityForSourceText(input, text);
  const productCandidate = kind === "image_pin" || kind === "video_pin";
  const diagnosticBlockers = blockersForKind(kind);
  return {
    kind,
    confidence: productCandidate ? 0.9 : 0.66,
    productCandidate,
    sourcePageQuality,
    reasons: [
      `classified_as_${kind}`,
      `source_quality_${sourcePageQuality}`
    ],
    diagnosticBlockers
  };
};

export const classifyPinterestSourcePage = (records: readonly PinterestCandidateInput[]): PinterestMediaClassification => {
  const classifications = records.map((record) => classifyPinterestCandidate({
    ...record,
    allowPinMediaPageQuality: false
  }));
  const firstBlocker = classifications.find((item) => item.kind === "login_challenge")
    ?? classifications.find((item) => item.sourcePageQuality === "chrome_only")
    ?? classifications.find((item) => item.sourcePageQuality === "search_shell")
    ?? classifications.find((item) => item.sourcePageQuality === "pin_grid_media")
    ?? classifications[0];
  return firstBlocker ?? classifyPinterestCandidate({ url: "" });
};

export const shouldBlockPinterestSourceExtraction = (classification: PinterestMediaClassification): boolean => (
  classification.sourcePageQuality === "search_shell"
  || classification.sourcePageQuality === "chrome_only"
  || classification.sourcePageQuality === "login_challenge"
);

export const summarizePinterestClassifications = (
  classifications: readonly PinterestMediaClassification[]
): Record<PinterestMediaKind, number> => classifications.reduce<Record<PinterestMediaKind, number>>((counts, item) => ({
  ...counts,
  [item.kind]: counts[item.kind] + 1
}), {
  image_pin: 0,
  video_pin: 0,
  unknown_pin: 0,
  board: 0,
  idea_page: 0,
  source_page: 0,
  shell: 0,
  login_challenge: 0,
  invalid: 0
});

export const resolvePinterestPrimaryCaptureStrategy = (
  urls: readonly string[],
  captureMode: "off" | "deep"
): PinterestPrimaryCaptureStrategy => {
  const classifications = urls.map((url) => classifyPinterestCandidate({ url }));
  if (classifications.length === 0) return captureMode === "deep" ? "deep_diagnostics" : "capture_off";
  const hasPinterestCandidate = classifications.some((item) => item.kind !== "invalid");
  if (!hasPinterestCandidate) return captureMode === "deep" ? "deep_diagnostics" : "capture_off";
  const hasVideoPin = classifications.some((item) => item.kind === "video_pin");
  const hasImagePin = classifications.some((item) => item.kind === "image_pin");
  if (hasVideoPin) return captureMode === "deep" ? "motion_first_with_deep_diagnostics" : "motion_first";
  if (hasImagePin) return captureMode === "deep" ? "visual_first_with_deep_diagnostics" : "visual_first";
  return "source_diagnostic";
};
