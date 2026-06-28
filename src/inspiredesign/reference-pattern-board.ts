import { isAllowedPinterestReferenceHost, normalizePinterestReferenceUrl } from "../guidance/recipes/pinterest";
import { classifyPinterestCandidate, isCanonicalPinterestPinUrl } from "./pinterest-media-classification";
import type { InspiredesignEvidenceAuthority } from "./product-readiness";
import {
  MIN_MOTION_PREVIEW_BYTES,
  MIN_MOTION_REPLAY_BYTES,
  MOTION_EVIDENCE_SHA256_HEX_PATTERN,
  persistInspiredesignMotionEvidence,
  type InspiredesignMotionEvidenceRuntimeMetadata,
  type InspiredesignPersistedMotionEvidence
} from "./motion-evidence";
import {
  INSPIREDESIGN_PIN_MEDIA_EVIDENCE_CONTENT_TYPES,
  INSPIREDESIGN_PIN_MEDIA_EVIDENCE_KINDS,
  MIN_PIN_MEDIA_EVIDENCE_BYTES,
  PINTEREST_PIN_MEDIA_SHA256_HEX_PATTERN,
  hasPinterestPinMediaEvidenceMinimumDimensions,
  hasPinterestPinMediaAuthorityBlockingWarning,
  isFirstPartyPinterestPinMediaUrl,
  persistInspiredesignPinterestPinMediaEvidence,
  type InspiredesignPinterestPinMediaIndexEntry,
  type InspiredesignPersistedPinterestPinMediaEvidence,
  type InspiredesignPinterestPinMediaRuntimeMetadata
} from "./pinterest-pin-media-evidence";
import type { InspiredesignBriefFormat } from "./brief-expansion";
import {
  confidenceLabel,
  type InspiredesignMediaAnalysis,
  type InspiredesignMediaAnalysisReference,
  type InspiredesignMediaKind
} from "./media-analysis";

type ReferenceStatus = "captured" | "failed" | "skipped";

type ReferenceInput = {
  id: string;
  url: string;
  title?: string;
  excerpt?: string;
  fetchStatus: ReferenceStatus;
  captureStatus: "off" | "captured" | "failed";
  capture?: {
    title?: string;
    snapshot?: {
      content: string;
    };
    dom?: {
      outerHTML: string;
    };
    clone?: {
      componentPreview: string;
      cssPreview: string;
    };
    visual?: {
      status: "captured" | "skipped" | "failed";
      sourceUrl?: string;
      pinterestPageQuality?: "pin_media" | "pin_grid_media" | "search_shell" | "chrome_only" | "login_challenge" | "unknown" | "invalid";
      path?: string;
      sha256?: string;
      bytes?: number;
      failure?: string;
      warnings: string[];
    };
    motion?: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence;
    pinMedia?: InspiredesignPinterestPinMediaRuntimeMetadata | InspiredesignPersistedPinterestPinMediaEvidence;
  } | null;
};

export type InspiredesignReferenceQualitySummary = {
  rankedReferenceCount: number;
  rejectedReferenceCount: number;
  topReferenceScore?: number;
  topReferenceConfidence?: number;
  topReferenceIntentMatched?: boolean;
  failedCaptureCount: number;
  missingScreenshotCount: number;
  attemptedReferenceCount: number;
  allAttemptFailedCaptureCount: number;
  allAttemptMissingScreenshotCount: number;
  allAttemptVisualFailureCount: number;
  allAttemptMotionFailureCount: number;
  diagnosticOnlyReasons: string[];
};

export type InspiredesignReferencePatternBoard = {
  briefId: string;
  targetSurface: string;
  qualitySummary: InspiredesignReferenceQualitySummary;
  references: Array<{
    id: string;
    rank: number;
    score: number;
    confidence: number;
    name: string;
    url: string;
    surfaceType: string;
    capturedVia: string[];
    evidenceAuthority: InspiredesignEvidenceAuthority;
    intentMatched: boolean;
    selectionReason: string;
    visualStrengths: string[];
    visualRisks: string[];
    layoutRecipe: string;
    contentHierarchy: string[];
    componentFamilies: string[];
    motionPosture: string[];
    tokenNotes: string[];
    patternsToBorrow: string[];
    patternsToReject: string[];
    whyItWorks: string;
    mediaAnalysisBacked?: boolean;
    mediaAnalysisSource?: {
      referenceId: string;
      mediaPath: string;
      sourceUrl?: string;
      mediaUrl?: string;
      hash?: string;
      kind: string;
      contentType?: string;
      claimLevels: InspiredesignMediaAnalysisReference["claimLevels"];
    };
    mediaArtifactPath?: string;
  }>;
  rejectedReferences: Array<{
    id: string;
    url: string;
    reason: string;
    fetchStatus: ReferenceStatus;
    captureStatus: "off" | "captured" | "failed";
    captured?: true;
    diagnosticReasons?: string[];
    capturedButRejectedReason?: string;
    evidenceGap?: string;
  }>;
  synthesis: {
    dominantDirection: string;
    sharedStrengths: string[];
    sharedFailuresToAvoid: string[];
    contractDeltas: string[];
  };
};

export type InspiredesignDesignVectors = {
  sourcePriority: "reference-evidence-first" | "brief-only";
  directionLabel: string;
  surfaceIntent: string;
  compositionModel: string[];
  premiumPosture: string[];
  motionPosture: string[];
  sectionArchitecture: string[];
  typographyPosture: string[];
  imageryPosture: string[];
  interactionDensity: string;
  interactionMoments: string[];
  materialEffects: string[];
  advancedMotionAdvisory: string[];
  referenceInfluence: string[];
  patternsToBorrow: string[];
  patternsToReject: string[];
  guardrails: string[];
  antiPatterns: string[];
};

type InspiredesignRankedReference = InspiredesignReferencePatternBoard["references"][number];

const SIGNAL_LIMIT = 5;
const SIGNAL_CLIP = 180;
const PATTERN_LIMIT = 6;
const MEDIA_ANALYSIS_STRENGTH_LIMIT = 4;
const MEDIA_ANALYSIS_RISK_LIMIT = 4;
const SCORE_FETCH_CAPTURED = 20;
const SCORE_CAPTURE_CAPTURED = 20;
const SCORE_VISUAL_CAPTURED = 30;
const SCORE_SNAPSHOT = 10;
const SCORE_CLONE = 8;
const SCORE_DOM = 8;
const SCORE_PUBLIC_LANDING = 6;
const SCORE_SIGNAL_CAP = 12;
const SCORE_INTENT_MISMATCH_PENALTY = 55;
const MAX_REFERENCE_SCORE = 100;
const MIN_READY_REFERENCE_SCORE = 50;
const MIN_READY_REFERENCE_CONFIDENCE = 0.5;
const SNAPSHOT_READY_VISUAL_ARTIFACT_PATH_PATTERN =
  /^visual-evidence\/[A-Za-z0-9._-]+\/viewport\.png$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const MIN_SNAPSHOT_READY_VISUAL_BYTES = 1024;
const PINTEREST_PIN_MEDIA_PAGE_QUALITY = "pin_media";
const SNAPSHOT_BLOCKING_WARNING_MARKERS = [
  "blank",
  "empty",
  "tiny",
  "small_media",
  "login",
  "challenge",
  "captcha",
  "search_shell",
  "interface_chrome",
  "chrome_only",
  "controls_only"
] as const;
const PINTEREST_LOGIN_BLOCKING_MARKERS = [
  "log in",
  "login",
  "sign in",
  "sign up",
  "continue with",
  "captcha",
  "verification",
  "challenge"
] as const;
const PINTEREST_CHROME_BLOCKING_MARKERS = [
  "search results for",
  "related searches",
  "when autocomplete results are available",
  "pin card",
  "your profile",
  "updates",
  "messages",
  "settings & support"
] as const;
const ADVANCED_MOTION_FIELDS = [
  "Advisory shader-style gradients: specify effect type, uniforms, static fallback, and reduced-motion replacement as design language only.",
  "Advisory WebGL-style depth cues: describe layered depth, camera-like parallax, and spatial hierarchy without requiring WebGL runtime.",
  "Advisory Spline-style staging: describe object-like hero composition, scene count, camera posture, depth model, asset source, and spatial sequencing as implementation guidance only.",
  "Advanced motion performance policy: define frame budget, lazy loading, offscreen pause behavior, and vestibular risk before implementation.",
  "Runtime boundary: implement with approved CSS and Canvas-safe primitives unless explicit source-owned runtime support is added later."
] as const;

const trimText = (value: string): string => value.trim().replace(/\s+/g, " ");

const clipText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const textFromHtml = (html: string | undefined): string | undefined => {
  return html ? trimText(html.replace(/<[^>]+>/g, " ")) : undefined;
};

const stripActionRefs = (value: string): string => (
  value
    .replace(/\[r\d+\]\s+(?:link|button|combobox|textbox|option)\s+/gi, "")
    .replace(/\[r\d+\]\s+/gi, "")
    .replace(/\bvalue=/gi, "")
);

const isCodeOrCssPreview = (value: string): boolean => {
  const lower = value.toLowerCase();
  return lower.includes("dangerouslysetinnerhtml")
    || lower.includes("opendevbrowser-root")
    || lower.includes("--gestalt-")
    || lower.includes("align-content:")
    || lower.startsWith(":root")
    || lower.startsWith("import ")
    || /^[.#][a-z0-9_-]+\s*\{/.test(lower)
    || (lower.includes("{") && /[a-z-]+:\s*[^;]+;/.test(lower));
};

const RAW_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const BARE_SOURCE_HOST_PATTERN =
  /(?<![@\w.-])(?:www\.)?(?:[a-z0-9-]+\.)+(?:design|studio|com|app|art|dev|net|org|ai|io|it|uk|co)(?:\/[^\s"'<>)}\]]*)?(?=$|[\s"'<>)}\],.;:!?])/gi;

const cleanEvidenceText = (value: string): string => {
  return trimText(stripActionRefs(value)
    .replace(RAW_URL_PATTERN, " ")
    .replace(BARE_SOURCE_HOST_PATTERN, " ")
    .replace(/[{};]/g, " "));
};

const DIAGNOSTIC_TEXT_MARKERS = [
  "authentication required",
  "sign in",
  "login required",
  "challenge page",
  "access denied",
  "browser capture unavailable",
  "404",
  "page not found",
  "not found",
  "unavailable page",
  "accept all cookies",
  "cookie consent",
  "cookie preferences",
  "privacy settings",
  "consent modal",
  "javascript required",
  "javascript is required",
  "captcha",
  "verification challenge",
  "enable cookies",
  "checking if the site connection is secure",
  "complete the verification",
  "blocked reference"
] as const;

const SEARCH_OR_LISTING_SHELL_MARKERS = [
  "search results for",
  "related searches",
  "sort by",
  "filter by"
] as const;

const MARKETPLACE_CHROME_MARKERS = [
  "add to cart",
  "marketplace",
  "envato",
  "etsy",
  "template kits"
] as const;

const HARD_DIAGNOSTIC_PAGE_MARKERS = [
  "404",
  "page not found",
  "this page is unavailable",
  "accept all cookies",
  "manage cookies",
  "cookie consent",
  "sign in to continue",
  "log in to continue",
  "captcha",
  "verification challenge"
] as const;

const INTERFACE_CHROME_TEXT_MARKERS = [
  "your profile",
  "your boards",
  "remove search input",
  "settings & support",
  "pin card",
  "voice search",
  "lens",
  "back to home page",
  "toggle mobile menu",
  "facebook",
  "instagram",
  "updates",
  "messages",
  "when autocomplete results are available",
  "touch device users"
] as const;

const PUBLIC_LANDING_TEXT_MARKERS = [
  "church",
  "landing page",
  "homepage",
  "home page",
  "consulting",
  "advisory",
  "bcg",
  "ai consulting",
  "enterprise ai",
  "transformation",
  "client services",
  "business services",
  "case studies",
  "clients",
  "industries",
  "worship",
  "locations",
  "gallery",
  "atelier",
  "fashion"
] as const;

const PUBLIC_LANDING_SUPPORT_MARKERS = [
  "online",
  "events",
  "studio",
  "website",
  "full-bleed",
  "hero",
  "story",
  "stories",
  "services",
  "service",
  "cta",
] as const;

const isDiagnosticText = (value: string): boolean => {
  const lower = value.toLowerCase();
  return DIAGNOSTIC_TEXT_MARKERS.some((marker) => lower.includes(marker));
};

const diagnosticPageReasons = (value: string): string[] => {
  const lower = value.toLowerCase();
  const reasons: string[] = [];
  if (["404", "page not found", "this page is unavailable"].some((marker) => lower.includes(marker))) {
    reasons.push("unavailable_page");
  }
  if (["accept all cookies", "manage cookies", "cookie consent", "privacy settings", "enable cookies"].some((marker) => lower.includes(marker))) {
    reasons.push("cookie_or_consent_modal");
  }
  if ([
    "sign in to continue",
    "log in to continue",
    "authentication required",
    "access denied",
    "captcha",
    "verification challenge",
    "complete the verification"
  ].some((marker) => lower.includes(marker))) {
    reasons.push("login_or_challenge_state");
  }
  const searchShellCount = SEARCH_OR_LISTING_SHELL_MARKERS.filter((marker) => lower.includes(marker)).length;
  if (searchShellCount >= 2 || lower.includes("search results for") || lower.includes("related searches")) {
    reasons.push("search_or_listing_shell");
  }
  const marketplaceChromeCount = MARKETPLACE_CHROME_MARKERS.filter((marker) => lower.includes(marker)).length;
  if (
    marketplaceChromeCount >= 2
    || ((lower.includes("envato") || lower.includes("etsy")) && (lower.includes("template kits") || searchShellCount > 0))
  ) {
    reasons.push("marketplace_or_template_chrome");
  }
  if (isInterfaceChromeText(value)) {
    reasons.push("interface_chrome_shell");
  }
  return [...new Set(reasons)];
};

const isDiagnosticPageText = (value: string): boolean => {
  const lower = value.toLowerCase();
  return HARD_DIAGNOSTIC_PAGE_MARKERS.some((marker) => lower.includes(marker))
    || diagnosticPageReasons(value).length > 0;
};

const isInterfaceChromeText = (value: string): boolean => {
  const lower = value.toLowerCase();
  const actionRefCount = countActionRefs(value);
  const markerCount = INTERFACE_CHROME_TEXT_MARKERS.filter((marker) => lower.includes(marker)).length;
  if (
    lower === "your profile"
    || lower === "adobe, inc."
    || lower === "dribbble: the community for graphic design"
    || /^https?:\/\/\S+$/.test(lower)
    || (lower.includes("when autocomplete results are available") && lower.includes("touch device users"))
    || (actionRefCount >= 3 && markerCount >= 2)
    || (lower.includes("get 20%") && lower.includes("dribbble: the community for graphic design"))
    || (lower.includes("our free wordpress themes are downloaded") && lower.includes("get them now"))
  ) {
    return true;
  }
  return markerCount >= 3 || (lower.includes("pin card") && lower.includes("your profile"));
};

const countActionRefs = (value: string): number => (
  (value.match(/\[r\d+\]\s+(?:link|button|combobox|textbox|option)\s+/gi) ?? []).length
);

const hasPublicLandingSignal = (value: string): boolean => {
  const lower = value.toLowerCase();
  const strongCount = PUBLIC_LANDING_TEXT_MARKERS.filter((marker) => lower.includes(marker)).length;
  const supportCount = PUBLIC_LANDING_SUPPORT_MARKERS.filter((marker) => lower.includes(marker)).length;
  const visualLandingCombo = lower.includes("hero")
    && (lower.includes("full-bleed") || lower.includes("cta") || lower.includes("website"));
  return visualLandingCombo || strongCount >= 2 || (strongCount >= 1 && strongCount + supportCount >= 2);
};

const pushSignal = (signals: string[], value: string | undefined): void => {
  if (!value || isCodeOrCssPreview(value)) return;
  const text = cleanEvidenceText(value);
  if (isCodeOrCssPreview(text) || isDiagnosticText(text) || isInterfaceChromeText(text)) return;
  if (text.length > 0 && !signals.includes(text)) {
    signals.push(text);
  }
};

export const getInspiredesignReferenceSignals = (reference: ReferenceInput): string[] => {
  const signals: string[] = [];
  pushSignal(signals, reference.title);
  pushSignal(signals, reference.excerpt);
  pushSignal(signals, reference.capture?.title);
  pushSignal(signals, reference.capture?.snapshot?.content);
  pushSignal(signals, textFromHtml(reference.capture?.clone?.componentPreview));
  pushSignal(signals, reference.capture?.clone?.cssPreview);
  pushSignal(signals, textFromHtml(reference.capture?.dom?.outerHTML));
  return signals.map((signal) => clipText(signal, SIGNAL_CLIP)).slice(0, SIGNAL_LIMIT);
};

const hasCleanSignal = (value: string | undefined): boolean => {
  if (!value || isCodeOrCssPreview(value)) return false;
  const text = cleanEvidenceText(value);
  return text.length > 0
    && !isCodeOrCssPreview(text)
    && !isDiagnosticText(text)
    && !isDiagnosticPageText(text)
    && !isInterfaceChromeText(text);
};

const hasUsableCloneCreativeEvidence = (reference: ReferenceInput): boolean => (
  hasCleanSignal(reference.capture?.clone?.componentPreview)
);

const hasUsableRecoveredCreativeEvidence = (reference: ReferenceInput): boolean => (
  hasUsableCloneCreativeEvidence(reference)
  || hasCleanSignal(textFromHtml(reference.capture?.dom?.outerHTML))
);

const isPinterestVisualReferenceUrl = (value: string): boolean => normalizePinterestReferenceUrl(value) !== null;

const normalizePinterestReferenceForEvidenceMatch = (value: string): string | null => {
  const normalized = normalizePinterestReferenceUrl(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "pin") {
      url.hostname = "www.pinterest.com";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return normalized.replace(/\/$/, "");
  }
};

const isPinterestProductCandidateReferenceUrl = (value: string): boolean => isCanonicalPinterestPinUrl(value);

const pinterestHostnameFromUrl = (value: string): string | null => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const isPinterestOwnedReferenceUrl = (value: string): boolean => {
  const hostname = pinterestHostnameFromUrl(value);
  return hostname !== null && (hostname === "pinterest.com" || hostname.endsWith(".pinterest.com"));
};

const isUnapprovedPinterestReferenceUrl = (value: string): boolean => {
  const hostname = pinterestHostnameFromUrl(value);
  return hostname !== null && isPinterestOwnedReferenceUrl(value) && !isAllowedPinterestReferenceHost(hostname);
};

const visualEvidencePathIsSnapshotReady = (value: unknown): boolean => (
  typeof value === "string" && SNAPSHOT_READY_VISUAL_ARTIFACT_PATH_PATTERN.test(value)
);

const hasBlockingSnapshotWarning = (warnings: readonly string[] | undefined): boolean => {
  const text = (warnings ?? []).join(" ").toLowerCase();
  return SNAPSHOT_BLOCKING_WARNING_MARKERS.some((marker) => text.includes(marker));
};

const visualEvidenceSourceMatchesReference = (reference: ReferenceInput): boolean => {
  const referenceUrl = normalizePinterestReferenceForEvidenceMatch(reference.url);
  const sourceUrl = normalizePinterestReferenceForEvidenceMatch(reference.capture?.visual?.sourceUrl ?? "");
  return Boolean(referenceUrl && sourceUrl && referenceUrl === sourceUrl);
};

const motionEvidenceSourceMatchesReference = (
  reference: ReferenceInput,
  motion: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence
): boolean => {
  const referenceUrl = normalizePinterestReferenceForEvidenceMatch(reference.url);
  const sourceUrl = normalizePinterestReferenceForEvidenceMatch(motion.sourceUrl ?? "");
  const startedSourceUrl = normalizePinterestReferenceForEvidenceMatch(motion.startedSourceUrl ?? "");
  const endedSourceUrl = normalizePinterestReferenceForEvidenceMatch(motion.endedSourceUrl ?? "");
  return Boolean(
    referenceUrl
    && sourceUrl === referenceUrl
    && startedSourceUrl === referenceUrl
    && endedSourceUrl === referenceUrl
  );
};

const hasPinterestPinMediaPageQuality = (value: unknown): boolean => value === PINTEREST_PIN_MEDIA_PAGE_QUALITY;

const motionEvidenceHasPinMediaPageQuality = (
  motion: InspiredesignMotionEvidenceRuntimeMetadata | InspiredesignPersistedMotionEvidence
): boolean => (
  hasPinterestPinMediaPageQuality(motion.pinterestPageQuality)
  && hasPinterestPinMediaPageQuality(motion.startedPinterestPageQuality)
  && hasPinterestPinMediaPageQuality(motion.endedPinterestPageQuality)
);

const hasSnapshotReadyPinterestVisualProof = (
  reference: ReferenceInput
): boolean => (
  isPinterestProductCandidateReferenceUrl(reference.url)
  && reference.captureStatus === "captured"
  && reference.capture?.visual?.status === "captured"
  && visualEvidenceSourceMatchesReference(reference)
  && hasPinterestPinMediaPageQuality(reference.capture.visual.pinterestPageQuality)
  && visualEvidencePathIsSnapshotReady(reference.capture.visual.path)
  && typeof reference.capture.visual.sha256 === "string"
  && SHA256_HEX_PATTERN.test(reference.capture.visual.sha256)
  && typeof reference.capture.visual.bytes === "number"
  && Number.isFinite(reference.capture.visual.bytes)
  && reference.capture.visual.bytes >= MIN_SNAPSHOT_READY_VISUAL_BYTES
  && !reference.capture.visual.failure
  && !hasBlockingSnapshotWarning(reference.capture.visual.warnings)
);

const hasSnapshotReadyPinterestVisualEvidence = (
  reference: ReferenceInput,
  diagnosticReasons: readonly string[]
): boolean => (
  hasSnapshotReadyPinterestVisualProof(reference)
  && diagnosticReasons.length === 0
);

const motionFileHasAuthority = (
  file: { path?: string; sha256?: string; bytes?: number } | undefined,
  pathPattern: RegExp,
  minBytes: number
): boolean => (
  typeof file?.path === "string"
  && pathPattern.test(file.path)
  && typeof file.sha256 === "string"
  && MOTION_EVIDENCE_SHA256_HEX_PATTERN.test(file.sha256)
  && typeof file.bytes === "number"
  && Number.isFinite(file.bytes)
  && file.bytes >= minBytes
);

const MOTION_READY_REPLAY_PATH_PATTERN = /^motion-evidence\/[A-Za-z0-9._-]+\/replay\.json$/;
const MOTION_READY_PREVIEW_PATH_PATTERN = /^motion-evidence\/[A-Za-z0-9._-]+\/preview\.png$/;
const PIN_MEDIA_ARTIFACT_PATH_PATTERN = /^pin-media-evidence\/[A-Za-z0-9._-]+\/(?:main|poster|video)\.(?:avif|gif|jpe?g|mp4|png|webp)$/i;
const PIN_MEDIA_MAIN_ARTIFACT_PATH_PATTERN = /^pin-media-evidence\/[A-Za-z0-9._-]+\/main\.(?:avif|gif|jpe?g|png|webp)$/i;
const PIN_MEDIA_POSTER_ARTIFACT_PATH_PATTERN = /^pin-media-evidence\/[A-Za-z0-9._-]+\/poster\.(?:avif|gif|jpe?g|png|webp)$/i;
const PIN_MEDIA_VIDEO_ARTIFACT_PATH_PATTERN = /^pin-media-evidence\/[A-Za-z0-9._-]+\/video\.mp4$/i;

const hasMotionReadyPinterestEvidence = (
  reference: ReferenceInput,
  diagnosticReasons: readonly string[]
): boolean => {
  if (!isPinterestProductCandidateReferenceUrl(reference.url)) return false;
  if (reference.captureStatus !== "captured") return false;
  const motion = reference.capture?.motion;
  if (motion?.status !== "captured") return false;
  const persistedMotion = persistInspiredesignMotionEvidence(motion);
  return diagnosticReasons.length === 0
    && persistedMotion.authority === "design_evidence"
    && !persistedMotion.diagnostic
    && motionEvidenceSourceMatchesReference(reference, persistedMotion)
    && motionEvidenceHasPinMediaPageQuality(persistedMotion)
    && motionFileHasAuthority(
      persistedMotion.replay,
      MOTION_READY_REPLAY_PATH_PATTERN,
      MIN_MOTION_REPLAY_BYTES
    )
    && motionFileHasAuthority(
      persistedMotion.preview,
      MOTION_READY_PREVIEW_PATH_PATTERN,
      MIN_MOTION_PREVIEW_BYTES
    );
};

const pinMediaEvidenceSourceMatchesReference = (
  reference: ReferenceInput,
  pinMedia: InspiredesignPersistedPinterestPinMediaEvidence
): boolean => {
  const referenceUrl = normalizePinterestReferenceForEvidenceMatch(reference.url);
  const sourceUrl = normalizePinterestReferenceForEvidenceMatch(pinMedia.sourceUrl ?? "");
  return Boolean(referenceUrl && sourceUrl === referenceUrl);
};

const normalizeMediaUrlForMatch = (value: string | undefined): string | undefined => {
	if (!value) return undefined;
	try {
	return new URL(value).href;
	} catch {
	return undefined;
	}
};

const pinMediaIndexEntryMatchesEvidence = (
	pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
	entry: InspiredesignPinterestPinMediaIndexEntry
): boolean => {
	const pinMediaSourceUrl = pinMedia.firstPartyProvenance.canonicalSourceUrl ?? pinMedia.sourceUrl;
	const persistedSourceUrl = normalizePinterestReferenceForEvidenceMatch(pinMediaSourceUrl ?? "");
	const indexSourceUrl = normalizePinterestReferenceForEvidenceMatch(entry.sourceUrl);
	return entry.referenceId === pinMedia.referenceId
		&& entry.path === pinMedia.path
		&& entry.sha256 === pinMedia.sha256
		&& entry.kind === pinMedia.kind
		&& entry.contentType === pinMedia.contentType
		&& entry.bytes === pinMedia.bytes
		&& entry.width === pinMedia.width
		&& entry.height === pinMedia.height
		&& Boolean(persistedSourceUrl && indexSourceUrl && persistedSourceUrl === indexSourceUrl)
		&& normalizeMediaUrlForMatch(entry.mediaUrl) === normalizeMediaUrlForMatch(pinMedia.mediaUrl);
};

const pinMediaIndexMatchesEvidence = (
	pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
	pinMediaIndex: readonly InspiredesignPinterestPinMediaIndexEntry[] | undefined
): boolean => (
	Boolean(pinMediaIndex?.some((entry) => pinMediaIndexEntryMatchesEvidence(pinMedia, entry)))
);

const pinMediaArtifactPathHasAuthority = (pinMedia: InspiredesignPersistedPinterestPinMediaEvidence): boolean => {
  if (typeof pinMedia.path !== "string") return false;
  if (pinMedia.kind === "image") return PIN_MEDIA_MAIN_ARTIFACT_PATH_PATTERN.test(pinMedia.path);
  if (pinMedia.kind === "video") return PIN_MEDIA_VIDEO_ARTIFACT_PATH_PATTERN.test(pinMedia.path);
  if (pinMedia.kind === "video_poster") return PIN_MEDIA_POSTER_ARTIFACT_PATH_PATTERN.test(pinMedia.path);
  return PIN_MEDIA_ARTIFACT_PATH_PATTERN.test(pinMedia.path);
};

const pinMediaContentTypeMatchesKind = (pinMedia: InspiredesignPersistedPinterestPinMediaEvidence): boolean => {
  if (pinMedia.kind === "video") return pinMedia.contentType === "video/mp4";
  return typeof pinMedia.contentType === "string" && pinMedia.contentType.startsWith("image/");
};

const readPersistedPinterestPinMediaEvidence = (
  pinMedia: InspiredesignPinterestPinMediaRuntimeMetadata | InspiredesignPersistedPinterestPinMediaEvidence
): InspiredesignPersistedPinterestPinMediaEvidence => {
  return persistInspiredesignPinterestPinMediaEvidence(pinMedia);
};

const hasPinMediaReadyPinterestEvidence = (
	reference: ReferenceInput,
	diagnosticReasons: readonly string[],
	pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): boolean => {
	if (!isPinterestProductCandidateReferenceUrl(reference.url)) return false;
	if (diagnosticReasons.some((reason) => reason !== "login_or_challenge_state")) return false;
	if (reference.captureStatus !== "captured") return false;
	const pinMedia = reference.capture?.pinMedia;
	if (pinMedia?.status !== "captured") return false;
	const persistedPinMedia = readPersistedPinterestPinMediaEvidence(pinMedia);
	return persistedPinMedia.authority === "design_evidence"
		&& pinMediaIndexMatchesEvidence(persistedPinMedia, pinMediaIndex)
		&& pinMediaEvidenceSourceMatchesReference(reference, persistedPinMedia)
		&& hasPinterestPinMediaPageQuality(persistedPinMedia.pinterestPageQuality)
    && typeof persistedPinMedia.mediaUrl === "string"
    && isFirstPartyPinterestPinMediaUrl(persistedPinMedia.mediaUrl)
    && pinMediaArtifactPathHasAuthority(persistedPinMedia)
    && typeof persistedPinMedia.sha256 === "string"
    && PINTEREST_PIN_MEDIA_SHA256_HEX_PATTERN.test(persistedPinMedia.sha256)
    && typeof persistedPinMedia.bytes === "number"
    && Number.isFinite(persistedPinMedia.bytes)
    && persistedPinMedia.bytes >= MIN_PIN_MEDIA_EVIDENCE_BYTES
    && hasPinterestPinMediaEvidenceMinimumDimensions(
      persistedPinMedia.kind,
      persistedPinMedia.width,
      persistedPinMedia.height
    )
    && typeof persistedPinMedia.contentType === "string"
    && (INSPIREDESIGN_PIN_MEDIA_EVIDENCE_CONTENT_TYPES as readonly string[]).includes(persistedPinMedia.contentType)
    && (INSPIREDESIGN_PIN_MEDIA_EVIDENCE_KINDS as readonly string[]).includes(persistedPinMedia.kind)
    && pinMediaContentTypeMatchesKind(persistedPinMedia)
    && !persistedPinMedia.failure
    && persistedPinMedia.rejectionReasons.length === 0
    && !hasPinterestPinMediaAuthorityBlockingWarning(persistedPinMedia)
    && persistedPinMedia.firstPartyProvenance.referenceUrlCanonical
    && persistedPinMedia.firstPartyProvenance.sourceUrlMatchesReference
    && persistedPinMedia.firstPartyProvenance.mediaUrlFirstParty;
};

const mediaAnalysisLookupKey = (referenceId: string, mediaPath: string): string => `${referenceId}\u0000${mediaPath}`;

const buildTrustedMediaAnalysisLookup = (
  mediaAnalysis?: InspiredesignMediaAnalysis
): Map<string, InspiredesignMediaAnalysisReference[]> => {
  const lookup = new Map<string, InspiredesignMediaAnalysisReference[]>();
  for (const reference of mediaAnalysis?.references ?? []) {
	if (reference.authority === "design_evidence" && reference.referenceId.trim().length > 0 && reference.mediaPath.trim().length > 0) {
		const key = mediaAnalysisLookupKey(reference.referenceId, reference.mediaPath);
		lookup.set(key, [...(lookup.get(key) ?? []), reference]);
    }
  }
  return lookup;
};

const mediaAnalysisSourceUrlMatches = (
	pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
	mediaReference: InspiredesignMediaAnalysisReference
): boolean => {
	const pinMediaSourceUrl = pinMedia.firstPartyProvenance.canonicalSourceUrl ?? pinMedia.sourceUrl;
	const persistedSourceUrl = normalizePinterestReferenceForEvidenceMatch(pinMediaSourceUrl ?? "");
	const mediaSourceUrl = normalizePinterestReferenceForEvidenceMatch(mediaReference.sourceUrl ?? "");
	return Boolean(persistedSourceUrl && mediaSourceUrl && persistedSourceUrl === mediaSourceUrl);
};

const mediaAnalysisMediaUrlMatches = (
	pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
	mediaReference: InspiredesignMediaAnalysisReference
): boolean => {
	const persistedMediaUrl = normalizeMediaUrlForMatch(pinMedia.mediaUrl);
	const mediaUrl = normalizeMediaUrlForMatch(mediaReference.mediaUrl);
	return Boolean(persistedMediaUrl && mediaUrl && persistedMediaUrl === mediaUrl);
};

const expectedMediaAnalysisKindForPinMedia = (
	pinMedia: Pick<InspiredesignPersistedPinterestPinMediaEvidence, "kind" | "contentType">
): InspiredesignMediaKind => {
	if (pinMedia.contentType === "image/gif") return "gif";
	return pinMedia.kind;
};

const pinMediaDimensionsMatchMediaAnalysis = (
	pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
	mediaReference: InspiredesignMediaAnalysisReference
): boolean => (
	typeof pinMedia.width === "number"
	&& typeof pinMedia.height === "number"
	&& mediaReference.dimensions?.width === pinMedia.width
	&& mediaReference.dimensions.height === pinMedia.height
);

const pinMediaMatchesMediaAnalysisReference = (
	pinMedia: InspiredesignPersistedPinterestPinMediaEvidence,
	mediaReference: InspiredesignMediaAnalysisReference
): boolean => (
	mediaReference.authority === "design_evidence"
	&& mediaReference.referenceId === pinMedia.referenceId
	&& mediaReference.mediaPath === pinMedia.path
	&& mediaReference.hash === pinMedia.sha256
	&& mediaReference.kind === expectedMediaAnalysisKindForPinMedia(pinMedia)
	&& mediaReference.contentType === pinMedia.contentType
	&& mediaReference.bytes === pinMedia.bytes
	&& pinMediaDimensionsMatchMediaAnalysis(pinMedia, mediaReference)
	&& mediaAnalysisSourceUrlMatches(pinMedia, mediaReference)
	&& mediaAnalysisMediaUrlMatches(pinMedia, mediaReference)
);

const getTrustedMediaAnalysisForReference = (
  reference: ReferenceInput,
  mediaReferences: readonly InspiredesignMediaAnalysisReference[] | undefined,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): InspiredesignMediaAnalysisReference | undefined => {
  if (!mediaReferences || mediaReferences.length === 0) return undefined;
  const diagnosticReasons = referenceDiagnosticReasons(reference);
  if (!hasPinMediaReadyPinterestEvidence(reference, diagnosticReasons, pinMediaIndex)) return undefined;
  const persistedPinMedia = readPersistedPinterestPinMediaEvidence(reference.capture!.pinMedia!);
	return mediaReferences.find((mediaReference) => pinMediaMatchesMediaAnalysisReference(persistedPinMedia, mediaReference));
};

const hasAuthoritativePinterestMediaEvidence = (
  reference: ReferenceInput,
  diagnosticReasons: readonly string[],
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): boolean => (
  hasSnapshotReadyPinterestVisualEvidence(reference, diagnosticReasons)
  || hasMotionReadyPinterestEvidence(reference, diagnosticReasons)
  || hasPinMediaReadyPinterestEvidence(reference, diagnosticReasons, pinMediaIndex)
);

const hasUsableCaptureEvidence = (reference: ReferenceInput): boolean => (
  hasCleanSignal(reference.capture?.snapshot?.content)
  || hasUsableCloneCreativeEvidence(reference)
  || hasCleanSignal(textFromHtml(reference.capture?.dom?.outerHTML))
);

const hasFirstPartyPinterestPinMediaProof = (reference: ReferenceInput): boolean => {
  const visual = reference.capture?.visual;
  if (
    isPinterestProductCandidateReferenceUrl(reference.url)
    && visual?.status === "captured"
    && visualEvidenceSourceMatchesReference(reference)
    && hasPinterestPinMediaPageQuality(visual.pinterestPageQuality)
    && !visual.failure
    && !hasBlockingSnapshotWarning(visual.warnings)
  ) return true;
  const pinMedia = reference.capture?.pinMedia;
  const persistedPinMedia = pinMedia?.status === "captured"
    ? readPersistedPinterestPinMediaEvidence(pinMedia)
    : undefined;
  if (
    isPinterestProductCandidateReferenceUrl(reference.url)
    && persistedPinMedia
    && persistedPinMedia.authority === "design_evidence"
    && pinMediaEvidenceSourceMatchesReference(reference, persistedPinMedia)
    && hasPinterestPinMediaPageQuality(persistedPinMedia.pinterestPageQuality)
    && persistedPinMedia.firstPartyProvenance.mediaUrlFirstParty
  ) return true;
  const motion = reference.capture?.motion;
  const persistedMotion = motion?.status === "captured" ? persistInspiredesignMotionEvidence(motion) : undefined;
  return Boolean(
    isPinterestProductCandidateReferenceUrl(reference.url)
    && persistedMotion
    && persistedMotion.authority === "design_evidence"
    && !persistedMotion.diagnostic
    && motionEvidenceSourceMatchesReference(reference, persistedMotion)
    && motionEvidenceHasPinMediaPageQuality(persistedMotion)
  );
};

const referenceDiagnosticReasons = (reference: ReferenceInput): string[] => {
  const text = [
    reference.title,
    reference.excerpt,
    reference.capture?.title,
    reference.capture?.snapshot?.content,
    textFromHtml(reference.capture?.clone?.componentPreview),
    reference.capture?.clone?.cssPreview,
    textFromHtml(reference.capture?.dom?.outerHTML),
    reference.capture?.visual?.failure,
    ...(reference.capture?.visual?.warnings ?? []),
    reference.capture?.motion?.failure,
    ...(reference.capture?.motion?.warnings ?? []),
    ...(reference.capture?.motion?.diagnosticReasons ?? [])
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ");
  const lowerText = text.toLowerCase();
  const pinterestChromeMarkerCount = PINTEREST_CHROME_BLOCKING_MARKERS
    .filter((marker) => lowerText.includes(marker)).length;
  const hasPinMediaLoginProof = hasFirstPartyPinterestPinMediaProof(reference);
  const hasSnapshotInterfaceChromeProof = hasSnapshotReadyPinterestVisualProof(reference)
    && !lowerText.includes("search results for")
    && !lowerText.includes("related searches");
  const pinterestTextBlockers = [
    ...(!hasPinMediaLoginProof && PINTEREST_LOGIN_BLOCKING_MARKERS.some((marker) => lowerText.includes(marker))
      ? ["login_or_challenge_state"]
      : []),
    ...(!hasPinMediaLoginProof
      && !hasSnapshotInterfaceChromeProof
      && (lowerText.includes("search results for") || lowerText.includes("related searches") || pinterestChromeMarkerCount >= 3)
      ? ["interface_chrome_shell"]
      : [])
  ];
  const pinterestBlockers = isPinterestOwnedReferenceUrl(reference.url)
    ? [
      ...classifyPinterestCandidate({
        url: reference.url,
        title: reference.title ?? reference.capture?.title,
        content: text
      }).diagnosticBlockers.filter((reason) => (
        reason !== "pin_media_type_unproven"
        && (!hasPinMediaLoginProof || reason !== "login_or_challenge_blocks_reference_extraction")
        && (!hasPinMediaLoginProof || reason !== "interface_chrome_shell")
        && (!hasPinMediaLoginProof || reason !== "search_shell_without_media_signals")
        && (!hasSnapshotInterfaceChromeProof || reason !== "interface_chrome_shell")
        && (!hasSnapshotInterfaceChromeProof || reason !== "search_shell_without_media_signals")
      )),
      ...pinterestTextBlockers
    ]
    : [];
  const pageReasons = diagnosticPageReasons(text).filter((reason) => (
    (
      !hasPinMediaLoginProof
      || reason !== "login_or_challenge_state"
    )
    && (
      !hasSnapshotInterfaceChromeProof
      || reason !== "interface_chrome_shell"
    )
    && (
      !hasPinMediaLoginProof
      || reason !== "interface_chrome_shell"
    )
    && (
      !hasPinMediaLoginProof
      || reason !== "search_or_listing_shell"
    )
  ));
  return [...new Set([...pageReasons, ...pinterestBlockers])];
};

const hasBlockingDiagnosticReason = (reasons: string[]): boolean => (
  reasons.some((reason) => reason !== "login_or_challenge_state")
);

const evidenceAuthorityForReference = (
  reference: ReferenceInput,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): InspiredesignEvidenceAuthority => {
  const diagnosticReasons = referenceDiagnosticReasons(reference);
  if (hasMotionReadyPinterestEvidence(reference, diagnosticReasons)) return "motion_ready";
  if (hasPinMediaReadyPinterestEvidence(reference, diagnosticReasons, pinMediaIndex)) return "pin_media_ready";
  if (hasSnapshotReadyPinterestVisualEvidence(reference, diagnosticReasons)) return "snapshot_ready";
  if (!isPinterestOwnedReferenceUrl(reference.url)) return "ranked_reference";
  return "diagnostic_only";
};

export const hasInspiredesignUsableReferenceEvidence = (
  reference: ReferenceInput,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): boolean => {
  if (isUnapprovedPinterestReferenceUrl(reference.url)) return false;
  const diagnosticReasons = referenceDiagnosticReasons(reference);
  if (isPinterestOwnedReferenceUrl(reference.url)) {
    return isPinterestProductCandidateReferenceUrl(reference.url)
      && hasAuthoritativePinterestMediaEvidence(reference, diagnosticReasons, pinMediaIndex);
  }
  if (hasBlockingDiagnosticReason(diagnosticReasons)) return false;
  if (diagnosticReasons.includes("login_or_challenge_state") && !hasUsableRecoveredCreativeEvidence(reference)) {
    return false;
  }
  if (reference.captureStatus === "captured" && hasUsableCaptureEvidence(reference)) return true;
  return reference.fetchStatus === "captured"
    && diagnosticReasons.length === 0
    && (hasCleanSignal(reference.title) || hasCleanSignal(reference.excerpt));
};

const firstSignal = (reference: ReferenceInput): string => {
  const preferred = [
    reference.capture?.title,
    reference.capture?.snapshot?.content,
    textFromHtml(reference.capture?.clone?.componentPreview),
    textFromHtml(reference.capture?.dom?.outerHTML),
    reference.excerpt,
    reference.title
  ].map((value) => value ? cleanEvidenceText(value) : "").find((value) => (
    value.length > 0 && !isCodeOrCssPreview(value) && !isDiagnosticText(value) && !isInterfaceChromeText(value)
  ));
  return preferred ? clipText(preferred, SIGNAL_CLIP) : reference.url;
};

const displayNameForReference = (reference: ReferenceInput, primarySignal: string): string => {
  const title = reference.title ? cleanEvidenceText(reference.title) : "";
  if (title && !isDiagnosticText(title) && !isInterfaceChromeText(title)) {
    return clipText(title, SIGNAL_CLIP);
  }
  return primarySignal !== reference.url ? primarySignal : reference.url;
};

type ReferencePatternRule = {
  summary: string;
  matches: readonly string[];
};

const REFERENCE_PATTERN_RULES: readonly ReferencePatternRule[] = [
  {
    summary: "location-first church discovery with regional pathways",
    matches: ["find a church", "church locations", "location", "city or postcode", "current location"]
  },
  {
    summary: "worship and music content as atmosphere and ministry proof",
    matches: ["music", "worship", "united", "young & free", "chapel", "instrumentals"]
  },
  {
    summary: "global region navigation with online participation path",
    matches: ["asia pacific", "europe", "north america", "latin america", "africa", "middle east", "online"]
  },
  {
    summary: "story-led editorial pathway after the primary church action",
    matches: ["stories", "blog", "start reading", "newsroom"]
  },
  {
    summary: "ministry ecosystem pathways for college, conferences, and events",
    matches: ["college", "conference", "tours", "events"]
  },
  {
    summary: "multilingual/global audience affordance",
    matches: ["language", "\"en\"", "\"fr\"", "\"es\"", "\"pt\"", "\"de\""]
  },
  {
    summary: "full-bleed hero with restrained CTA rail",
    matches: ["full-bleed", "hero", "cta rail", "primary cta"]
  },
  {
    summary: "premium consulting public landing page with service narrative, client proof, and conversion CTAs",
    matches: ["consulting", "advisory", "bcg", "enterprise ai", "transformation", "client services", "case studies", "industries"]
  }
];

const ruleMatches = (text: string, rule: ReferencePatternRule): boolean => {
  const lower = text.toLowerCase();
  return rule.matches.some((match) => lower.includes(match));
};

const derivePatternSummaries = (signals: string[], fallback: string): string[] => {
  const text = signals.join(" ");
  const matches = REFERENCE_PATTERN_RULES
    .filter((rule) => ruleMatches(text, rule))
    .map((rule) => rule.summary);
  return matches.length > 0 ? matches.slice(0, PATTERN_LIMIT) : [fallback];
};

const appendSourceDetail = (patterns: string[], primarySignal: string): string[] => {
  if (patterns.some((pattern) => primarySignal.toLowerCase().includes(pattern.toLowerCase()))) {
    return patterns;
  }
  return [...patterns, `source detail: ${primarySignal}`].slice(0, PATTERN_LIMIT);
};

const deriveCapturedVia = (
  reference: ReferenceInput,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): string[] => {
  const methods: string[] = [];
  const diagnosticReasons = referenceDiagnosticReasons(reference);
  const hasSnapshotReadyEvidence = hasSnapshotReadyPinterestVisualEvidence(reference, diagnosticReasons);
  const hasMotionReadyEvidence = hasMotionReadyPinterestEvidence(reference, diagnosticReasons);
  const hasPinMediaReadyEvidence = hasPinMediaReadyPinterestEvidence(reference, diagnosticReasons, pinMediaIndex);
  if (reference.fetchStatus === "captured") methods.push("fetch");
  if (hasCleanSignal(reference.capture?.snapshot?.content)) methods.push("snapshot");
  if (hasUsableCloneCreativeEvidence(reference)) {
    methods.push("clone");
  }
  if (hasCleanSignal(textFromHtml(reference.capture?.dom?.outerHTML))) methods.push("dom");
  if (
    reference.capture?.visual?.status === "captured"
    && (hasUsableCaptureEvidence(reference) || hasSnapshotReadyEvidence)
  ) methods.push("visual");
  if (hasSnapshotReadyEvidence) methods.push("snapshot_ready");
  if (reference.capture?.pinMedia?.status === "captured" && hasPinMediaReadyEvidence) methods.push("pin_media");
  if (hasPinMediaReadyEvidence) methods.push("pin_media_ready");
  if (reference.capture?.motion?.status === "captured" && hasMotionReadyEvidence) methods.push("motion");
  if (hasMotionReadyEvidence) methods.push("motion_ready");
  return methods;
};

const scoreReference = (
  reference: ReferenceInput,
  signals: string[],
  isPublicLanding: boolean,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): number => {
  let score = 0;
  const diagnosticReasons = referenceDiagnosticReasons(reference);
  const hasSnapshotReadyEvidence = hasSnapshotReadyPinterestVisualEvidence(reference, diagnosticReasons);
  const hasMotionReadyEvidence = hasMotionReadyPinterestEvidence(reference, diagnosticReasons);
  const hasPinMediaReadyEvidence = hasPinMediaReadyPinterestEvidence(reference, diagnosticReasons, pinMediaIndex);
  if (reference.fetchStatus === "captured") score += SCORE_FETCH_CAPTURED;
  if (
    reference.captureStatus === "captured"
    && (
      hasUsableCaptureEvidence(reference)
      || hasSnapshotReadyEvidence
      || hasMotionReadyEvidence
      || hasPinMediaReadyEvidence
    )
  ) {
    score += SCORE_CAPTURE_CAPTURED;
  }
  if (
    reference.capture?.visual?.status === "captured"
    && (hasUsableCaptureEvidence(reference) || hasSnapshotReadyEvidence)
  ) score += SCORE_VISUAL_CAPTURED;
  if (hasMotionReadyEvidence) score += SCORE_VISUAL_CAPTURED;
  if (hasPinMediaReadyEvidence) score += SCORE_VISUAL_CAPTURED;
  if (hasSnapshotReadyEvidence || hasPinMediaReadyEvidence || hasCleanSignal(reference.capture?.snapshot?.content)) score += SCORE_SNAPSHOT;
  if (hasUsableCloneCreativeEvidence(reference)) score += SCORE_CLONE;
  if (hasCleanSignal(textFromHtml(reference.capture?.dom?.outerHTML))) score += SCORE_DOM;
  if (isPublicLanding) score += SCORE_PUBLIC_LANDING;
  score += Math.min(SCORE_SIGNAL_CAP, signals.length * 2);
  return Math.min(MAX_REFERENCE_SCORE, score);
};

const confidenceFromScore = (score: number): number => (
  Number((score / MAX_REFERENCE_SCORE).toFixed(2))
);

const cleanGuidanceEntries = (entries: readonly string[]): string[] => (
  entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
);

const MEASURED_MEDIA_ANALYSIS_CLAIM_LEVELS: ReadonlySet<InspiredesignMediaAnalysisReference["claimLevels"][number]> = new Set([
  "pixel_stats",
  "palette_quantized",
  "layout_heuristic",
  "typography_structure",
  "text_region_layout",
  "motion_sampled"
]);

const hasMeasuredMediaAnalysisDesignFacts = (
  mediaReference: InspiredesignMediaAnalysisReference
): boolean => mediaReference.claimLevels.some((claimLevel) => MEASURED_MEDIA_ANALYSIS_CLAIM_LEVELS.has(claimLevel));

const mediaAnalysisVisualStrengths = (
  mediaReference: InspiredesignMediaAnalysisReference
): string[] => {
  const confidence = `Media-analysis confidence is ${confidenceLabel(mediaReference.confidence)} (${mediaReference.confidence.toFixed(2)}).`;
  if (!hasMeasuredMediaAnalysisDesignFacts(mediaReference)) {
    return [
      `Media analysis confirmed persisted ${mediaReference.kind} metadata only; inspect saved pin media before making palette, layout, typography, or motion claims.`,
      confidence
    ];
  }
  return cleanGuidanceEntries([
    ...mediaReference.designGuidance.visualStrengths,
    confidence
  ]).slice(0, MEDIA_ANALYSIS_STRENGTH_LIMIT);
};

const mediaAnalysisVisualRisks = (
  mediaReference: InspiredesignMediaAnalysisReference
): string[] => cleanGuidanceEntries([
  ...mediaReference.designGuidance.visualRisks,
  ...mediaReference.limitations.map((limitation) => `Media-analysis limitation: ${limitation}`)
]).slice(0, MEDIA_ANALYSIS_RISK_LIMIT);

const mergeMediaGuidance = (
  mediaGuidance: readonly string[] | undefined,
  fallback: readonly string[]
): string[] => {
  const mediaEntries = cleanGuidanceEntries(mediaGuidance ?? []);
  if (mediaEntries.length === 0) return [...fallback].slice(0, PATTERN_LIMIT);
  return [...mediaEntries, ...fallback].slice(0, PATTERN_LIMIT);
};

const mediaLayoutRecipe = (
  mediaReference: InspiredesignMediaAnalysisReference | undefined,
  fallback: string
): string => {
  const recipe = mediaReference?.designGuidance.layoutRecipe.trim();
  return recipe && recipe.length > 0 ? recipe : fallback;
};

const pinMediaVisualStrengths = (
  hasPinMediaReadyEvidence: boolean,
  measuredMediaStrengths: readonly string[]
): string[] => {
  if (!hasPinMediaReadyEvidence) return [];
  if (measuredMediaStrengths.length > 0) return [...measuredMediaStrengths];
  return ["Manifest-ready Pinterest pin media artifact is available for still-image direction."];
};

const referenceWhyItWorks = (
  reference: ReferenceInput,
  mediaReference: InspiredesignMediaAnalysisReference | undefined
): string => {
  if (mediaReference) {
    if (!hasMeasuredMediaAnalysisDesignFacts(mediaReference)) {
      return "Trusted media-analysis metadata confirms persisted pin media provenance, but palette, layout, typography, and motion claims still require measured facts or direct media inspection.";
    }
    return "Trusted media-analysis facts provide palette, tone, layout, typography-structure, and motion guidance without exact text claims.";
  }
  if (reference.captureStatus === "captured") {
    return "Captured reference evidence provides reusable hierarchy, rhythm, and component cues.";
  }
  return "Available reference text provides directional content and hierarchy cues.";
};

const deriveVisualStrengths = (
  reference: ReferenceInput,
  patterns: string[],
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[],
  mediaReference?: InspiredesignMediaAnalysisReference
): string[] => {
  const diagnosticReasons = referenceDiagnosticReasons(reference);
  const hasPinMediaReadyEvidence = hasPinMediaReadyPinterestEvidence(reference, diagnosticReasons, pinMediaIndex);
  const measuredMediaStrengths = mediaReference ? mediaAnalysisVisualStrengths(mediaReference) : [];
  const strengths = [
    ...(reference.capture?.visual?.status === "captured"
      ? ["Screenshot artifact is available for direct visual inspection."]
      : []),
    ...pinMediaVisualStrengths(hasPinMediaReadyEvidence, measuredMediaStrengths),
    ...(reference.capture?.snapshot?.content.trim()
      ? ["Snapshot text confirms visible hierarchy and interaction targets."]
      : []),
    ...(hasUsableCloneCreativeEvidence(reference)
      ? ["Clone preview exposes reusable component and styling cues."]
      : []),
    ...patterns.slice(0, 2).map((pattern) => `Reusable visual cue: ${pattern}.`)
  ];
  return strengths.slice(0, PATTERN_LIMIT);
};

const deriveVisualRisks = (
  reference: ReferenceInput,
  mediaReference?: InspiredesignMediaAnalysisReference
): string[] => {
  const mediaRisks = mediaReference ? mediaAnalysisVisualRisks(mediaReference) : [];
  const risks = [
    ...mediaRisks,
    ...(reference.capture?.visual?.status !== "captured"
      ? ["No finalized screenshot artifact, so visual claims must stay conservative."]
      : []),
    ...(reference.capture?.visual?.status === "failed" && reference.capture.visual.failure
      ? [`Screenshot failure: ${reference.capture.visual.failure}.`]
      : []),
    ...(reference.capture?.visual?.warnings ?? []).map((warning) => `Screenshot warning: ${warning}.`),
    ...(isPinterestProductCandidateReferenceUrl(reference.url) && reference.capture?.pinMedia?.status !== "captured"
      ? ["No finalized Pinterest pin media artifact, so pin-media claims must stay conservative."]
      : []),
    ...(reference.capture?.pinMedia?.status === "failed" && reference.capture.pinMedia.failure
      ? [`Pinterest pin media failure: ${reference.capture.pinMedia.failure}.`]
      : []),
    ...(reference.capture?.pinMedia?.warnings ?? []).map((warning) => `Pinterest pin media warning: ${warning}.`),
    ...(reference.fetchStatus !== "captured"
      ? ["Fetch evidence failed or was skipped, so use browser capture cautiously."]
      : [])
  ];
  return risks.length > 0
    ? risks.slice(0, PATTERN_LIMIT)
    : ["No major visual evidence risk detected in the captured reference."];
};

const selectionReasonForScore = (score: number, capturedVia: string[]): string => {
  if (capturedVia.includes("motion_ready")) {
    return `Ranked for motion-ready Pinterest screencast evidence plus ${capturedVia.join(", ")} capture.`;
  }
  if (capturedVia.includes("pin_media_ready")) {
    return `Ranked for manifest-ready Pinterest pin media evidence plus ${capturedVia.join(", ")} capture.`;
  }
  if (capturedVia.includes("snapshot_ready")) {
    return `Ranked for snapshot-ready Pinterest screenshot evidence plus ${capturedVia.join(", ")} capture.`;
  }
  if (capturedVia.includes("visual")) {
    return `Ranked for screenshot-backed visual evidence plus ${capturedVia.join(", ")} capture.`;
  }
  if (score >= 50) {
    return `Ranked for strong text and structural evidence from ${capturedVia.join(", ") || "reference metadata"}.`;
  }
  return "Ranked for limited but usable reference cues.";
};

const deriveComponentFamilies = (
  format: InspiredesignBriefFormat,
  patterns: string[],
  isPublicLanding: boolean
): string[] => {
  const base = isPublicLanding
    ? "hero composition, proof bands, narrative pathways, service or story sections, conversion CTA, and footer"
    : format.componentGrammar;
  return [base, ...patterns.slice(0, 3)];
};

const hasReferencePublicLandingEvidence = (
  reference: InspiredesignReferencePatternBoard["references"][number]
): boolean => {
  const text = [
    reference.surfaceType,
    reference.layoutRecipe,
    ...reference.contentHierarchy,
    ...reference.patternsToBorrow
  ].join(" ");
  return hasPublicLandingSignal(text);
};

const hasBoardPublicLandingEvidence = (board: InspiredesignReferencePatternBoard): boolean => (
  board.references.some(hasReferencePublicLandingEvidence)
);

const boardEvidenceText = (board: InspiredesignReferencePatternBoard): string => (
  board.references.map((reference) => [
    reference.layoutRecipe,
    ...reference.contentHierarchy,
    ...reference.componentFamilies,
    ...reference.motionPosture,
    ...reference.patternsToBorrow
  ].join(" ")).join(" ").toLowerCase()
);

const hasEvidenceCue = (text: string, matches: readonly string[]): boolean => (
  matches.some((match) => text.includes(match))
);

const INTENT_STOP_WORDS = new Set([
  "and",
  "cinematic",
  "dark",
  "digital",
  "for",
  "from",
  "landing",
  "light",
  "microinteractions",
  "motion",
  "page",
  "parallax",
  "premium",
  "reveal",
  "site",
  "scroll",
  "theme",
  "with",
  "design",
  "website"
]);

const tokenizeIntent = (value: string): string[] => (
  value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []
).filter((token) => !INTENT_STOP_WORDS.has(token));

const formatIntentTokens = (format: InspiredesignBriefFormat): string[] => [
  ...format.keywords,
  ...format.businessFocus,
  ...format.bestFor,
  ...(format.focusAreas ?? []),
  format.archetype,
  format.layoutArchetype,
  format.surfaceTreatment,
  format.motionGrammar,
  format.paletteIntent
].flatMap(tokenizeIntent);

const intentTokenVariants = (token: string): string[] => {
  if (token === "photo" || token === "photos" || token === "photography" || token === "photographer" || token === "photographic") {
    return ["photo", "photos", "photography", "photographer", "photographic"];
  }
  return [token];
};

const countMatchedIntentTokens = (signals: string[], intentTokens: string[]): number => {
  const evidenceTokens = new Set(signals.flatMap(tokenizeIntent));
  return intentTokens.filter((token) => intentTokenVariants(token).some((variant) => evidenceTokens.has(variant))).length;
};

const hasBriefIntentMatch = (
  signals: string[],
  format: InspiredesignBriefFormat,
  briefText: string
): boolean => {
  const briefTokens = tokenizeIntent(briefText);
  const hasBriefIntentTokens = briefTokens.length > 0;
  const intentTokens = [...new Set(hasBriefIntentTokens ? briefTokens : formatIntentTokens(format))];
  if (intentTokens.length === 0) return true;
  const matchCount = countMatchedIntentTokens(signals, intentTokens);
  if (!hasBriefIntentTokens) return matchCount > 0;
  return matchCount >= Math.min(2, intentTokens.length);
};

const mediaAnalysisSourceForReference = (
  mediaReference: InspiredesignMediaAnalysisReference
): NonNullable<InspiredesignReferencePatternBoard["references"][number]["mediaAnalysisSource"]> => ({
  referenceId: mediaReference.referenceId,
  mediaPath: mediaReference.mediaPath,
  ...(mediaReference.sourceUrl ? { sourceUrl: mediaReference.sourceUrl } : {}),
  ...(mediaReference.mediaUrl ? { mediaUrl: mediaReference.mediaUrl } : {}),
  ...(mediaReference.hash ? { hash: mediaReference.hash } : {}),
  kind: mediaReference.kind,
  ...(mediaReference.contentType ? { contentType: mediaReference.contentType } : {}),
  claimLevels: [...mediaReference.claimLevels]
});

const persistedPinMediaPathForReference = (reference: ReferenceInput): string | undefined => {
  const pinMedia = reference.capture?.pinMedia;
  if (pinMedia?.status !== "captured") return undefined;
  return readPersistedPinterestPinMediaEvidence(pinMedia).path;
};

const boardReferenceKey = (reference: { id: string; url: string; mediaArtifactPath?: string }): string => (
  `${reference.id}\u0000${reference.url}\u0000${reference.mediaArtifactPath ?? ""}`
);

const sourceReferenceBoardKey = (reference: ReferenceInput): string => (
  boardReferenceKey({
    id: reference.id,
    url: reference.url,
    mediaArtifactPath: persistedPinMediaPathForReference(reference)
  })
);

const deriveReferenceEntry = (
  reference: ReferenceInput,
  format: InspiredesignBriefFormat,
  briefText: string,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[],
  mediaReference?: InspiredesignMediaAnalysisReference
): Omit<InspiredesignReferencePatternBoard["references"][number], "rank"> => {
  const signals = getInspiredesignReferenceSignals(reference);
  const primarySignal = firstSignal(reference);
  const patterns = appendSourceDetail(derivePatternSummaries(signals, primarySignal), primarySignal);
  const isPublicLanding = signals.some(hasPublicLandingSignal);
  const capturedVia = deriveCapturedVia(reference, pinMediaIndex);
  const evidenceAuthority = evidenceAuthorityForReference(reference, pinMediaIndex);
  const hasPinterestEvidenceAuthority = evidenceAuthority === "snapshot_ready"
    || evidenceAuthority === "motion_ready"
    || evidenceAuthority === "pin_media_ready";
  const intentMatched = hasPinterestEvidenceAuthority
    || hasBriefIntentMatch(signals, format, briefText);
  const rawScore = scoreReference(reference, signals, isPublicLanding, pinMediaIndex);
  const score = intentMatched ? rawScore : Math.max(0, rawScore - SCORE_INTENT_MISMATCH_PENALTY);
  const fallbackLayoutRecipe = patterns.join("; ");
  const fallbackComponentFamilies = deriveComponentFamilies(format, patterns, isPublicLanding);
  const hasMeasuredMediaReference = mediaReference ? hasMeasuredMediaAnalysisDesignFacts(mediaReference) : false;
  const mediaGuidance = hasMeasuredMediaReference ? mediaReference?.designGuidance : undefined;
  const mediaArtifactPath = persistedPinMediaPathForReference(reference);
  return {
    id: reference.id,
    score,
    confidence: confidenceFromScore(score),
    name: displayNameForReference(reference, primarySignal),
    url: reference.url,
    surfaceType: isPublicLanding ? "public landing page" : format.archetype,
    capturedVia,
    evidenceAuthority,
    intentMatched,
    selectionReason: intentMatched
      ? selectionReasonForScore(score, capturedVia)
      : `${selectionReasonForScore(score, capturedVia)} Intent overlap with the brief is weak, so the score was downgraded.`,
    visualStrengths: deriveVisualStrengths(reference, patterns, pinMediaIndex, mediaReference),
    visualRisks: deriveVisualRisks(reference, mediaReference),
	    layoutRecipe: mediaLayoutRecipe(hasMeasuredMediaReference ? mediaReference : undefined, fallbackLayoutRecipe),
    contentHierarchy: mergeMediaGuidance(mediaGuidance?.contentHierarchy, patterns.slice(0, 4)),
    componentFamilies: mergeMediaGuidance(mediaGuidance?.componentFamilies, fallbackComponentFamilies),
    motionPosture: mergeMediaGuidance(mediaGuidance ? [mediaGuidance.motionPosture] : [], [
      format.motionGrammar,
      "Plan hero reveal, scroll reveal, CTA feedback, and reduced-motion behavior."
    ]),
    tokenNotes: mergeMediaGuidance(mediaGuidance?.tokenNotes, [format.paletteIntent, format.typographySystem, format.surfaceTreatment]),
    patternsToBorrow: mergeMediaGuidance(mediaGuidance?.patternsToBorrow, [...patterns, ...signals.slice(0, 2)]),
    patternsToReject: mergeMediaGuidance(mediaGuidance?.patternsToReject, [...format.antiPatterns]),
    whyItWorks: referenceWhyItWorks(reference, mediaReference),
		...(hasMeasuredMediaReference && mediaReference ? {
			mediaAnalysisBacked: true,
			mediaAnalysisSource: mediaAnalysisSourceForReference(mediaReference)
		} : {}),
    ...(mediaArtifactPath ? { mediaArtifactPath } : {})
  };
};

const sortReferenceEntries = (
  entries: Array<Omit<InspiredesignReferencePatternBoard["references"][number], "rank">>
): Array<InspiredesignReferencePatternBoard["references"][number]> => entries
  .slice()
  .sort((left, right) => (
    right.score - left.score
      || left.id.localeCompare(right.id)
      || left.url.localeCompare(right.url)
  ))
  .map((entry, index) => ({
    rank: index + 1,
    ...entry
  }));

const rejectionReasonForReference = (reference: ReferenceInput): string => {
  if (isUnapprovedPinterestReferenceUrl(reference.url)) {
    return "Pinterest reference host is not approved for creative synthesis.";
  }
  const diagnosticReasons = referenceDiagnosticReasons(reference);
  if (diagnosticReasons.length > 0) {
    return `Reference evidence is diagnostic-only: ${diagnosticReasons.join(", ")}.`;
  }
  if (reference.fetchStatus === "failed" && reference.captureStatus === "failed") {
    return "Fetch and capture did not produce usable creative evidence.";
  }
  if (reference.captureStatus === "failed") {
    return "Capture did not produce usable creative evidence.";
  }
  if (reference.fetchStatus === "failed") {
    return "Fetch did not produce usable creative evidence.";
  }
  return "Reference evidence was diagnostic, empty, or too weak for creative synthesis.";
};

const hasCapturedEvidence = (reference: ReferenceInput): boolean => (
  reference.captureStatus === "captured"
  || reference.capture?.visual?.status === "captured"
  || reference.capture?.motion?.status === "captured"
  || reference.capture?.pinMedia?.status === "captured"
);

const capturedButRejectedReason = (
  reference: ReferenceInput,
  diagnosticReasons: string[],
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): string => {
  if (diagnosticReasons.length > 0) {
    return `Captured browser evidence was rejected because it only exposed diagnostic signals: ${diagnosticReasons.join(", ")}.`;
  }
  if (isPinterestProductCandidateReferenceUrl(reference.url) && !hasAuthoritativePinterestMediaEvidence(reference, diagnosticReasons, pinMediaIndex)) {
    return "Captured Pinterest media was rejected because it lacks snapshot-ready, pin-media-ready, or motion-ready evidence.";
  }
  return "Captured browser evidence was rejected because it did not contain usable creative reference evidence.";
};

const buildRejectedReferences = (
  references: ReferenceInput[],
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): InspiredesignReferencePatternBoard["rejectedReferences"] => references
  .filter((reference) => !hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex))
  .map((reference) => {
    const diagnosticReasons = referenceDiagnosticReasons(reference);
    const captured = hasCapturedEvidence(reference);
    return {
      id: reference.id,
      url: reference.url,
      reason: rejectionReasonForReference(reference),
      fetchStatus: reference.fetchStatus,
      captureStatus: reference.captureStatus,
      ...(captured ? { captured: true as const } : {}),
      ...(diagnosticReasons.length > 0 ? { diagnosticReasons } : {}),
      ...(captured ? {
        capturedButRejectedReason: capturedButRejectedReason(reference, diagnosticReasons, pinMediaIndex),
        evidenceGap: "Design-facing artifacts require creative layout evidence; diagnostic browser chrome is kept only as rejection metadata."
      } : {})
    };
  });

const isVideoPinReference = (reference: ReferenceInput): boolean => (
  classifyPinterestCandidate({ url: reference.url, title: reference.title, content: reference.excerpt }).kind === "video_pin"
);

const hasMotionReadyReferenceEvidence = (reference: ReferenceInput): boolean => (
  hasMotionReadyPinterestEvidence(reference, referenceDiagnosticReasons(reference))
);

const hasPinMediaReadyReferenceEvidence = (
  reference: ReferenceInput,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): boolean => (
  hasPinMediaReadyPinterestEvidence(reference, referenceDiagnosticReasons(reference), pinMediaIndex)
);

const isMissingRequiredScreenshotAttempt = (
  reference: ReferenceInput,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): boolean => (
  !isVideoPinReference(reference)
  && !hasMotionReadyReferenceEvidence(reference)
  && !hasPinMediaReadyReferenceEvidence(reference, pinMediaIndex)
  && reference.capture?.visual?.status !== "captured"
);

const hasVisualFailureAttempt = (
  reference: ReferenceInput,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): boolean => (
  reference.capture?.visual?.status === "failed" || isMissingRequiredScreenshotAttempt(reference, pinMediaIndex)
);

const hasMotionFailureAttempt = (reference: ReferenceInput): boolean => {
  const motion = reference.capture?.motion;
  if (!motion) return isVideoPinReference(reference);
  return motion.status === "failed" || persistInspiredesignMotionEvidence(motion).diagnostic;
};

const buildQualitySummary = (
  references: ReferenceInput[],
  rankedEntries: InspiredesignReferencePatternBoard["references"],
  rejectedReferences: InspiredesignReferencePatternBoard["rejectedReferences"],
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): InspiredesignReferenceQualitySummary => {
  const diagnosticOnlyReasons = [...new Set(references.flatMap(referenceDiagnosticReasons))];
  const rankedReferenceKeys = new Set(rankedEntries.map(boardReferenceKey));
  const rankedReferences = references.filter((reference) => rankedReferenceKeys.has(sourceReferenceBoardKey(reference)));
  const failedCaptureCount = rankedReferences.filter((reference) => reference.captureStatus === "failed").length;
  const missingScreenshotCount = rankedReferences.filter((reference) => (
    isMissingRequiredScreenshotAttempt(reference, pinMediaIndex)
  )).length;
  const topReference = rankedEntries[0];
  return {
    rankedReferenceCount: rankedEntries.length,
    rejectedReferenceCount: rejectedReferences.length,
    failedCaptureCount,
    missingScreenshotCount,
    attemptedReferenceCount: references.length,
    allAttemptFailedCaptureCount: references.filter((reference) => reference.captureStatus === "failed").length,
    allAttemptMissingScreenshotCount: references.filter((reference) => (
      isMissingRequiredScreenshotAttempt(reference, pinMediaIndex)
    )).length,
    allAttemptVisualFailureCount: references.filter((reference) => (
      hasVisualFailureAttempt(reference, pinMediaIndex)
    )).length,
    allAttemptMotionFailureCount: references.filter(hasMotionFailureAttempt).length,
    diagnosticOnlyReasons,
    ...(topReference
      ? {
        topReferenceScore: topReference.score,
        topReferenceConfidence: topReference.confidence,
        topReferenceIntentMatched: topReference.intentMatched
      }
      : {})
  };
};

export const summarizeInspiredesignReferenceQuality = (
  board: InspiredesignReferencePatternBoard
): InspiredesignReferenceQualitySummary => ({ ...board.qualitySummary });

export const isInspiredesignReadyReference = (
  reference: InspiredesignReferencePatternBoard["references"][number]
): boolean => (
  reference.intentMatched
  && reference.score >= MIN_READY_REFERENCE_SCORE
  && reference.confidence >= MIN_READY_REFERENCE_CONFIDENCE
);

export const isInspiredesignDesignReference = (
  reference: InspiredesignReferencePatternBoard["references"][number]
): boolean => (
  !isPinterestOwnedReferenceUrl(reference.url) || (
    isPinterestProductCandidateReferenceUrl(reference.url)
    && isInspiredesignReadyReference(reference)
    && reference.evidenceAuthority !== "diagnostic_only"
  )
);

const buildNotReadyRejectedReference = (
  reference: InspiredesignReferencePatternBoard["references"][number]
): InspiredesignReferencePatternBoard["rejectedReferences"][number] => {
  const captured = reference.capturedVia.length > 0;
  return {
    id: reference.id,
    url: reference.url,
    reason: reference.intentMatched
      ? "Reference evidence did not meet the design-ready ranking threshold."
      : "Reference evidence did not match the requested design intent.",
    fetchStatus: reference.capturedVia.includes("fetch") ? "captured" : "skipped",
    captureStatus: reference.capturedVia.some((method) => method !== "fetch") ? "captured" : "off",
    ...(captured ? {
      captured: true as const,
      capturedButRejectedReason: "Captured reference evidence did not satisfy design-ready ranking gates.",
      evidenceGap: "Design-facing artifacts require design-ready creative evidence; non-ready captures are kept only as rejection metadata."
    } : {})
  };
};

const mergeRejectedReferences = (
  rejectedReferences: InspiredesignReferencePatternBoard["rejectedReferences"]
): InspiredesignReferencePatternBoard["rejectedReferences"] => {
  const seen = new Set<string>();
  return rejectedReferences.filter((reference) => {
    const key = boardReferenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const hasDesignReferenceVisualOrMotionEvidence = (
  reference: InspiredesignReferencePatternBoard["references"][number]
): boolean => (
  reference.capturedVia.includes("visual")
  || reference.capturedVia.includes("pin_media_ready")
  || reference.capturedVia.includes("motion_ready")
  || reference.evidenceAuthority === "pin_media_ready"
  || reference.evidenceAuthority === "motion_ready"
);

export const buildInspiredesignRankedArtifactPatternBoard = (
  designBoard: InspiredesignReferencePatternBoard,
  sourceBoard: InspiredesignReferencePatternBoard
): InspiredesignReferencePatternBoard => {
  const designReferenceKeys = new Set(designBoard.references.map(boardReferenceKey));
  const notReadyReferences = sourceBoard.references
    .filter((reference) => !designReferenceKeys.has(boardReferenceKey(reference)))
    .map(buildNotReadyRejectedReference);
  return {
    ...designBoard,
    rejectedReferences: mergeRejectedReferences([
      ...sourceBoard.rejectedReferences,
      ...notReadyReferences
    ])
  };
};

export const buildInspiredesignDesignReferencePatternBoard = (
  board: InspiredesignReferencePatternBoard,
  designVectors: InspiredesignDesignVectors
): InspiredesignReferencePatternBoard => {
  const references = board.references.filter(isInspiredesignDesignReference);
  const notReadyCount = board.references.length - references.length;
  const topReference = references[0];
  const missingScreenshotCount = references.filter((reference) => (
    !hasDesignReferenceVisualOrMotionEvidence(reference)
  )).length;
  const qualitySummary: InspiredesignReferenceQualitySummary = {
    rankedReferenceCount: references.length,
    rejectedReferenceCount: board.rejectedReferences.length + notReadyCount,
    failedCaptureCount: 0,
    missingScreenshotCount,
    attemptedReferenceCount: board.qualitySummary.attemptedReferenceCount,
    allAttemptFailedCaptureCount: board.qualitySummary.allAttemptFailedCaptureCount,
    allAttemptMissingScreenshotCount: board.qualitySummary.allAttemptMissingScreenshotCount,
    allAttemptVisualFailureCount: board.qualitySummary.allAttemptVisualFailureCount,
    allAttemptMotionFailureCount: board.qualitySummary.allAttemptMotionFailureCount,
    diagnosticOnlyReasons: [...board.qualitySummary.diagnosticOnlyReasons],
    ...(topReference
      ? {
        topReferenceScore: topReference.score,
        topReferenceConfidence: topReference.confidence,
        topReferenceIntentMatched: topReference.intentMatched
      }
      : {})
  };
  return {
    ...board,
    targetSurface: designVectors.surfaceIntent,
    qualitySummary,
    references,
    rejectedReferences: [],
    synthesis: {
      dominantDirection: designVectors.directionLabel,
      sharedStrengths: [...designVectors.patternsToBorrow],
      sharedFailuresToAvoid: [...designVectors.patternsToReject],
      contractDeltas: references.length > 0
        ? [...board.synthesis.contractDeltas]
        : ["No ready reference evidence is available; keep implementation anchored to the source brief."]
    }
  };
};

export const buildInspiredesignReferencePatternBoard = (
  briefId: string,
  format: InspiredesignBriefFormat,
  references: ReferenceInput[],
  briefText = "",
  mediaAnalysis?: InspiredesignMediaAnalysis,
  pinMediaIndex?: readonly InspiredesignPinterestPinMediaIndexEntry[]
): InspiredesignReferencePatternBoard => {
  const mediaAnalysisLookup = buildTrustedMediaAnalysisLookup(mediaAnalysis);
  const entries = references
    .filter((reference) => hasInspiredesignUsableReferenceEvidence(reference, pinMediaIndex))
    .map((reference) => deriveReferenceEntry(
      reference,
      format,
      briefText,
      pinMediaIndex,
      getTrustedMediaAnalysisForReference(
        reference,
        (() => {
          const mediaArtifactPath = persistedPinMediaPathForReference(reference);
          return mediaArtifactPath ? mediaAnalysisLookup.get(mediaAnalysisLookupKey(reference.id, mediaArtifactPath)) : undefined;
        })(),
        pinMediaIndex
      )
    ));
  const rankedEntries = sortReferenceEntries(entries);
  const rejectedReferences = buildRejectedReferences(references, pinMediaIndex);
  const sharedStrengths = rankedEntries.flatMap((entry) => entry.patternsToBorrow).slice(0, 6);
  const targetSurface = rankedEntries.some((entry) => entry.surfaceType === "public landing page")
    ? "reference-led public landing page"
    : format.layoutArchetype;
  return {
    briefId,
    targetSurface,
    qualitySummary: buildQualitySummary(references, rankedEntries, rejectedReferences, pinMediaIndex),
    references: rankedEntries,
    rejectedReferences,
    synthesis: {
      dominantDirection: rankedEntries[0]?.layoutRecipe ?? format.archetype,
      sharedStrengths,
      sharedFailuresToAvoid: [...format.antiPatterns],
      contractDeltas: [
        "Selected prompt format supplies route defaults and guardrails, not the creative source of truth.",
        "Use captured reference hierarchy before generic profile defaults when URL evidence exists."
      ]
    }
  };
};

const buildInteractionDensity = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): string => {
  if (hasBoardPublicLandingEvidence(board)) {
    return "low-to-medium; prioritize confident public-page CTAs over app-shell controls.";
  }
  if (format.route.navigationModel === "sidebar") {
    return "medium-to-high; prioritize command surfaces, state clarity, and durable workspace controls.";
  }
  if (format.route.profile === "documentation") {
    return "low-to-medium; prioritize visual overview, proof scanning, and a small number of clear action paths.";
  }
  if (format.route.profile === "auth-focused") {
    return "low; prioritize one confident first action with clear feedback and trust cues.";
  }
  return "low-to-medium; prioritize confident public-page CTAs over app-shell controls.";
};

const buildImageryPosture = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): string[] => {
  if (hasBoardPublicLandingEvidence(board)) {
    return [format.surfaceTreatment, "Use dominant atmospheric imagery as the visual anchor."];
  }
  if (format.route.navigationModel === "sidebar") {
    return [format.surfaceTreatment, "Use product state, data hierarchy, and workspace continuity as the visual anchor."];
  }
  return [format.surfaceTreatment, "Use dominant atmospheric imagery as the visual anchor."];
};

const buildInteractionMoments = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): string[] => {
  const evidenceText = boardEvidenceText(board);
  const publicLanding = hasBoardPublicLandingEvidence(board);
  const referenceBacked = board.references.length > 0;
  const cursorScope = publicLanding
    ? "hero CTA, media reveals, and primary navigation moments"
    : "high-value actions and selected command surfaces";
  const moments = [
    "Microinteractions: define hover effects, visible focus rings, pressed states, loading states, and confirmation feedback for every primary action.",
    `Animation choreography: sequence ${format.motionGrammar}, hover feedback, active feedback, and page transitions through one timing system.`
  ];
  const cursorBacked = hasEvidenceCue(evidenceText, ["cursor", "magnetic", "follow-cursor", "pointer"]);
  const cursorPolicy = cursorBacked
    ? `Cursor effects: reference evidence supports premium pointer affordances for ${cursorScope}; keep default cursor behavior for reading surfaces.`
    : `Cursor effects policy: consider magnetic or follow-cursor affordances only when reference evidence supports ${cursorScope}.`;
  return referenceBacked ? [...moments, cursorPolicy] : moments;
};

const uniqueReferenceValues = (values: string[]): string[] => (
  [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].slice(0, PATTERN_LIMIT)
);

const collectReferenceValues = (
  references: readonly InspiredesignRankedReference[],
  selectValues: (reference: InspiredesignRankedReference) => readonly string[]
): string[] => uniqueReferenceValues(references.flatMap((reference) => [...selectValues(reference)]));

const hasMediaAnalysisGuidance = (reference: InspiredesignRankedReference): boolean => reference.mediaAnalysisBacked === true;

const collectMediaReferenceValues = (
	references: readonly InspiredesignRankedReference[],
	selectValues: (reference: InspiredesignRankedReference) => readonly string[]
): string[] => collectReferenceValues(references.filter(hasMediaAnalysisGuidance), selectValues);

const buildMediaTypographyPosture = (references: readonly InspiredesignRankedReference[]): string[] => collectMediaReferenceValues(
  references,
  (reference) => reference.contentHierarchy
);

const buildMediaImageryPosture = (references: readonly InspiredesignRankedReference[]): string[] => collectMediaReferenceValues(
  references,
	(reference) => [...reference.patternsToBorrow, ...reference.visualStrengths, ...reference.tokenNotes]
);

const buildMediaInteractionMoments = (references: readonly InspiredesignRankedReference[]): string[] => collectMediaReferenceValues(
  references,
  (reference) => reference.componentFamilies.map((family) => `Media-derived component family: ${family}.`)
);

const buildMediaMaterialEffects = (references: readonly InspiredesignRankedReference[]): string[] => collectMediaReferenceValues(
  references,
  (reference) => reference.tokenNotes.map((note) => `Media-derived token note: ${note}`)
);

const buildMaterialEffects = (board: InspiredesignReferencePatternBoard): string[] => {
  if (board.references.length === 0) {
    return [
      "Material effects: define elevation, shadows, surface contrast, and reduced-motion-safe depth from the brief.",
      "Reduced-motion material fallback: preserve hierarchy and CTA clarity without transform-based depth."
    ];
  }
  const evidenceText = boardEvidenceText(board);
  const publicLanding = hasBoardPublicLandingEvidence(board);
  const glassScope = publicLanding
    ? "navigation overlays, hero scrims, and atmospheric CTA surfaces"
    : "focused overlays, inspectors, or state containers";
  const parallaxBacked = hasEvidenceCue(evidenceText, ["parallax", "depth", "layered", "immersive", "full-bleed"]);
  const glassBacked = hasEvidenceCue(evidenceText, ["glass", "frosted", "blur", "translucent", "scrim", "overlay"]);
  const parallax = parallaxBacked
    ? "Depth language: reference evidence supports restrained parallax, layered shadows, and atmospheric depth where it reinforces hierarchy."
    : "Depth language policy: use parallax only when reference evidence supports layered depth; otherwise use spacing, scale, and shadow hierarchy.";
  const glass = glassBacked
    ? `Glassmorphism/translucency: reference evidence supports frosted or translucent surfaces for ${glassScope}; never use glass as generic decoration.`
    : `Glassmorphism/translucency policy: use frosted or translucent surfaces only when reference evidence supports ${glassScope}.`;
  return [
    parallax,
    glass,
    "Reduced-motion material fallback: remove parallax and cursor-follow transforms while preserving hierarchy, depth, and CTA clarity."
  ];
};

const buildSectionArchitecture = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): string[] => {
  if (hasBoardPublicLandingEvidence(board)) {
    return [
      "Use 8 to 12 primary landing-page sections unless the user explicitly asks for a microsite.",
      "Build a clear sequence from hero, proof, story, service pathways, impact, conversion CTA, and footer."
    ];
  }
  if (format.route.profile === "documentation") {
    return [
      "Use a text-light overview sequence for purpose, proof, examples, action paths, and footer.",
      "Keep long-form reference depth, citation modules, annotation rails, and methodology blocks out of the primary visual route."
    ];
  }
  if (format.route.profile === "auth-focused") {
    return [
      "Use a screen sequence for value, trust, input, confirmation, and first-action transition.",
      "Keep the flow compact instead of expanding into marketing section sprawl."
    ];
  }
  if (format.route.navigationModel === "immersive") {
    return [
      "Use cinematic scene beats for hero, product reveal, proof, detail, and decisive CTA.",
      "Keep each scroll beat focused on one visual idea."
    ];
  }
  if (format.route.navigationModel === "sidebar") {
    return [
      "Use workspace shell zones for navigation, command surfaces, primary work area, detail panels, and state feedback.",
      "Prioritize task continuity over marketing-section cadence."
    ];
  }
  return [
    "Use 8 to 12 primary landing-page sections unless the user explicitly asks for a microsite.",
    "Build a clear sequence from hero, proof, story, service pathways, impact, conversion CTA, and footer."
  ];
};

export const buildInspiredesignDesignVectors = (
  format: InspiredesignBriefFormat,
  board: InspiredesignReferencePatternBoard
): InspiredesignDesignVectors => {
  const designReferences = board.references.filter(isInspiredesignDesignReference);
  const designStrengths = designReferences.flatMap((entry) => entry.patternsToBorrow).slice(0, 6);
  const influence = designStrengths.length > 0
    ? designStrengths
    : [format.archetype];
  const designBoard = { ...board, references: designReferences };
  const publicLandingEvidence = hasBoardPublicLandingEvidence(designBoard);
	const mediaPremiumPosture = collectMediaReferenceValues(designReferences, (entry) => entry.visualStrengths);
	const mediaMotionPosture = collectMediaReferenceValues(designReferences, (entry) => entry.motionPosture);
  const mediaTypographyPosture = buildMediaTypographyPosture(designReferences);
  const mediaImageryPosture = buildMediaImageryPosture(designReferences);
  const mediaInteractionMoments = buildMediaInteractionMoments(designReferences);
  const mediaMaterialEffects = buildMediaMaterialEffects(designReferences);
  const surfaceIntent = publicLandingEvidence
    ? "reference-led public landing page"
    : format.archetype;
  const compositionModel = publicLandingEvidence
    ? ["full-bleed hero with narrative section cadence", ...designReferences.map((entry) => entry.layoutRecipe)]
    : [format.layoutArchetype, ...designReferences.map((entry) => entry.layoutRecipe)];
  return {
    sourcePriority: designReferences.length > 0 ? "reference-evidence-first" : "brief-only",
    directionLabel: designReferences[0]?.layoutRecipe ?? format.archetype,
    surfaceIntent,
    compositionModel: compositionModel.slice(0, 5),
    premiumPosture: [
      ...mediaPremiumPosture,
      "premium visual hierarchy, refined spacing, and editorial image treatment.",
      "Premium typography, spacing, visual hierarchy, palette, and image treatment must lead the page.",
      format.surfaceTreatment,
      format.paletteIntent
    ].slice(0, PATTERN_LIMIT),
    motionPosture: [
      ...mediaMotionPosture,
      "Use a hero entrance reveal, section scroll reveal, and CTA/focus feedback.",
      "Respect reduced-motion preference with static hierarchy preserved.",
      format.motionGrammar
    ].slice(0, PATTERN_LIMIT),
    sectionArchitecture: buildSectionArchitecture(format, designBoard),
    typographyPosture: [...mediaTypographyPosture, format.typographySystem].slice(0, PATTERN_LIMIT),
    imageryPosture: [...mediaImageryPosture, ...buildImageryPosture(format, designBoard)].slice(0, PATTERN_LIMIT),
    interactionDensity: buildInteractionDensity(format, designBoard),
    interactionMoments: [...mediaInteractionMoments, ...buildInteractionMoments(format, designBoard)].slice(0, PATTERN_LIMIT),
    materialEffects: [...mediaMaterialEffects, ...buildMaterialEffects(designBoard)].slice(0, PATTERN_LIMIT),
    advancedMotionAdvisory: [...ADVANCED_MOTION_FIELDS],
    referenceInfluence: influence,
    patternsToBorrow: designReferences.flatMap((entry) => entry.patternsToBorrow).slice(0, 8),
    patternsToReject: designReferences.flatMap((entry) => entry.patternsToReject).slice(0, 8),
    guardrails: [...format.guardrails],
    antiPatterns: [...format.antiPatterns]
  };
};
