import { mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import type {
  BrowserManagerLike,
  BrowserPinterestPinMediaResult
} from "../browser/manager-types";
import { redactSensitive } from "../core/logging";
import type { ChallengeAutomationMode } from "../challenges/types";
import { readCookiesFromSource } from "../providers/cookie-source";
import type { ProviderCookiePolicy, ProviderCookieSourceConfig } from "../providers/types";
import type {
  InspiredesignVisualEvidenceMode,
  InspiredesignVisualEvidenceRuntimeMetadata
} from "./visual-evidence";
import type { InspiredesignMotionEvidenceRuntimeMetadata } from "./motion-evidence";
import type { InspiredesignPinterestPinMediaRuntimeMetadata } from "./pinterest-pin-media-evidence";
import type { WorkflowBrowserMode } from "../providers/types";
import type {
  InspiredesignCaptureAttemptEvidence,
  InspiredesignCaptureAttemptStatus,
  InspiredesignCaptureAttempts,
  InspiredesignCaptureEvidence
} from "./contract";
import {
  classifyPinterestCandidate,
  type PinterestSourcePageQuality
} from "./pinterest-media-classification";

type InspiredesignCaptureManagerBase = Pick<
  BrowserManagerLike,
  | "launch"
  | "cookieImport"
  | "cookieList"
  | "goto"
  | "waitForLoad"
  | "snapshot"
  | "clonePage"
  | "disconnect"
  | "clonePageHtmlWithOptions"
>;

type InspiredesignCaptureManagerLike = Omit<
  InspiredesignCaptureManagerBase,
  "launch" | "cookieImport" | "cookieList" | "snapshot" | "clonePage" | "clonePageHtmlWithOptions"
> & {
  launch: (
    options: Parameters<BrowserManagerLike["launch"]>[0],
    timeoutMs?: number
  ) => ReturnType<BrowserManagerLike["launch"]>;
  cookieImport: (
    sessionId: string,
    cookies: Parameters<BrowserManagerLike["cookieImport"]>[1],
    strict?: boolean,
    requestId?: string,
    timeoutMs?: number
  ) => ReturnType<BrowserManagerLike["cookieImport"]>;
  cookieList: (
    sessionId: string,
    urls?: string[],
    requestId?: string,
    timeoutMs?: number
  ) => ReturnType<BrowserManagerLike["cookieList"]>;
  snapshot: (
    sessionId: string,
    mode: "outline" | "actionables",
    maxChars: number,
    cursor?: string,
    targetId?: string | null,
    timeoutMs?: number
  ) => ReturnType<BrowserManagerLike["snapshot"]>;
  clonePage: (
    sessionId: string,
    targetId?: string | null,
    timeoutMs?: number
  ) => ReturnType<BrowserManagerLike["clonePage"]>;
  clonePageHtmlWithOptions?: (
    sessionId: string,
    targetId?: string | null,
    options?: Parameters<NonNullable<BrowserManagerLike["clonePageHtmlWithOptions"]>>[2],
    timeoutMs?: number
  ) => ReturnType<NonNullable<BrowserManagerLike["clonePageHtmlWithOptions"]>>;
  screenshot?: (
    sessionId: string,
    options?: Parameters<BrowserManagerLike["screenshot"]>[1]
  ) => ReturnType<BrowserManagerLike["screenshot"]>;
  startScreencast?: BrowserManagerLike["startScreencast"];
  stopScreencast?: BrowserManagerLike["stopScreencast"];
  capturePinterestPinMedia?: BrowserManagerLike["capturePinterestPinMedia"];
  setSessionChallengeAutomationMode?: (sessionId: string, mode?: ChallengeAutomationMode) => void;
};

export type InspiredesignCaptureOptions = {
  timeoutMs?: number;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
  cookieSource?: ProviderCookieSourceConfig;
  visualEvidence?: InspiredesignVisualEvidenceMode;
  visualEvidencePath?: string;
};

type InspiredesignPrimaryCaptureCookieOptions = {
  useCookies?: boolean;
  cookiePolicyOverride?: ProviderCookiePolicy;
  cookieSource?: ProviderCookieSourceConfig;
};

export type InspiredesignPrimaryVisualCaptureOptions = InspiredesignPrimaryCaptureCookieOptions & {
  timeoutMs?: number;
  browserMode?: WorkflowBrowserMode;
  challengeAutomationMode?: ChallengeAutomationMode;
  visualEvidencePath: string;
};

export type InspiredesignPrimaryMotionCaptureOptions = InspiredesignPrimaryCaptureCookieOptions & {
  timeoutMs?: number;
  browserMode?: WorkflowBrowserMode;
  challengeAutomationMode?: ChallengeAutomationMode;
  outputDir: string;
};

export type InspiredesignPrimaryPinMediaCaptureOptions = InspiredesignPrimaryCaptureCookieOptions & {
  timeoutMs?: number;
  browserMode?: WorkflowBrowserMode;
  challengeAutomationMode?: ChallengeAutomationMode;
  referenceId: string;
  pinMediaEvidencePath: string;
  pinterestPageQuality?: PinterestSourcePageQuality;
};

type CaptureCookieImportState = {
  sourceConfigured: boolean;
  sourceAvailable: boolean;
  sourceMessage?: string;
};

const INSPIREDESIGN_CAPTURE_TIMEOUT_MS = 30_000;
const INSPIREDESIGN_CAPTURE_MAX_CHARS = 12_000;
const INSPIREDESIGN_MOTION_INTERVAL_MS = 500;
const INSPIREDESIGN_MOTION_MAX_FRAMES = 3;
const INSPIREDESIGN_LATE_SCREENCAST_STOP_TIMEOUT_MS = 1_000;
const ACTIVE_SESSION_COOKIE_REUSE_UNAVAILABLE_MESSAGE = "Deep capture only honors configured provider cookie sources; active session cookies are not reused.";
const DOM_CAPTURE_HELPER_UNAVAILABLE_MESSAGE = "DOM capture helper unavailable in this execution lane.";
const VISUAL_CAPTURE_HELPER_UNAVAILABLE_MESSAGE = "Visual evidence screenshot helper unavailable in this execution lane.";
const VISUAL_CAPTURE_PATH_UNAVAILABLE_MESSAGE = "Visual evidence path was not configured for screenshot capture.";
const VISUAL_CAPTURE_EMPTY_MESSAGE = "Visual evidence screenshot did not return a file path.";
const PIN_MEDIA_CAPTURE_HELPER_UNAVAILABLE_MESSAGE = "Pinterest pin media capture helper unavailable in this execution lane.";
const PIN_MEDIA_CAPTURE_PATH_UNAVAILABLE_MESSAGE = "Pinterest pin media evidence path was not configured.";
const PIN_MEDIA_CAPTURE_NOT_FOUND_MESSAGE = "Pinterest pin media capture did not find a primary media candidate.";
const PIN_MEDIA_CAPTURE_PATH_MISMATCH_MESSAGE = "Pinterest pin media evidence temp path did not match the requested artifact path.";
const PRIMARY_CAPTURE_SESSION_UNAVAILABLE_MESSAGE = "Primary media capture session helper unavailable in this execution lane.";
const VISUAL_VIEWPORT_PROBE_FAILED_WARNING = "viewport_url_unverified";
const PINTEREST_VIEWPORT_LOGIN_WARNING = "login_or_challenge_state";
const PINTEREST_VIEWPORT_CHROME_WARNING = "interface_chrome_shell";
const SNAPSHOT_CAPTURE_EMPTY_MESSAGE = "Snapshot capture returned empty content.";
const CLONE_CAPTURE_EMPTY_MESSAGE = "Clone capture returned empty component and CSS previews.";
const DOM_CAPTURE_EMPTY_MESSAGE = "DOM capture returned empty HTML.";
const SKIPPED_AFTER_TRANSPORT_TIMEOUT_SUFFIX = "transport timeout.";
const PINTEREST_VIEWPORT_MEDIA_PROBE_MAX_NODES = 400;

type ViewportSourceProbe = {
  sourceUrl?: string;
  warnings: string[];
  pinterestPageQuality?: PinterestSourcePageQuality;
};

const createRemainingCaptureTimeout = (timeoutMs: number): (() => number) => {
  const startedAtMs = Date.now();
  let firstRead = true;
  return () => {
    if (firstRead) {
      firstRead = false;
      return timeoutMs;
    }
    return Math.max(1, timeoutMs - Math.max(0, Date.now() - startedAtMs));
  };
};

const clampInspiredesignCaptureTimeout = (timeoutMs?: number): number => {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) return INSPIREDESIGN_CAPTURE_TIMEOUT_MS;
  return Math.max(1, Math.min(timeoutMs, INSPIREDESIGN_CAPTURE_TIMEOUT_MS));
};

function sanitizeInspiredesignCaptureText(value: string): string;
function sanitizeInspiredesignCaptureText(value: string | undefined): string | undefined;
function sanitizeInspiredesignCaptureText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const redacted = redactSensitive(value);
  return typeof redacted === "string" ? redacted : value;
}

const buildCaptureAttempt = (
  status: InspiredesignCaptureAttemptStatus,
  detail?: string
): InspiredesignCaptureAttemptEvidence => {
  const sanitizedDetail = sanitizeInspiredesignCaptureText(detail);
  return sanitizedDetail ? { status, detail: sanitizedDetail } : { status };
};

const detailFromCaptureError = (error: unknown, fallback: string): string => {
  return error instanceof Error ? error.message : fallback;
};

const isTransportTimeoutError = (
  error: unknown,
  detail: string
): boolean => {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (error.name === "TimeoutError" || code === "ETIMEDOUT" || code === "ERR_HTTP_REQUEST_TIMEOUT") {
      return true;
    }
  }
  return /\btimed out after \d+ms\b/i.test(detail)
    || /exceeded timeout budget\./i.test(detail);
};

const isIgnorableNetworkIdleWaitError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /timed out|timeout/i.test(error.message);
};

const buildSkippedAfterTransportTimeoutAttempt = (
  label: string
): InspiredesignCaptureAttemptEvidence => {
  return buildCaptureAttempt("skipped", `Skipped after ${label} ${SKIPPED_AFTER_TRANSPORT_TIMEOUT_SUFFIX}`);
};

const hasUsableCaptureText = (value: string | undefined): boolean => {
  return typeof value === "string" && value.trim().length > 0;
};

const isPinterestUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "pinterest.com" || hostname.endsWith(".pinterest.com");
  } catch {
    return false;
  }
};

const pinterestViewportClassification = (args: {
  url?: string;
  title?: string;
  content?: string;
  html?: string;
  warnings?: readonly string[];
}): ReturnType<typeof classifyPinterestCandidate> | undefined => {
  if (!isPinterestUrl(args.url)) return undefined;
  return classifyPinterestCandidate({
    url: args.url,
    title: args.title,
    content: [
      args.content,
      ...(args.warnings ?? [])
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" "),
    html: args.html
  });
};

const pinterestViewportWarnings = (args: {
  url?: string;
  title?: string;
  content?: string;
  warnings?: readonly string[];
}): string[] => {
  const quality = pinterestViewportClassification(args)?.sourcePageQuality;
  if (quality === "login_challenge") return [PINTEREST_VIEWPORT_LOGIN_WARNING];
  if (quality === "search_shell" || quality === "chrome_only") return [PINTEREST_VIEWPORT_CHROME_WARNING];
  return [];
};

const pinterestViewportPageQuality = (args: {
  url?: string;
  title?: string;
  content?: string;
  html?: string;
  warnings?: readonly string[];
}): PinterestSourcePageQuality | undefined => {
  return pinterestViewportClassification(args)?.sourcePageQuality;
};

const normalizeMotionSourceUrlForComparison = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
};

const motionSourceDiagnosticReasons = (
  startedProbe: ViewportSourceProbe,
  endedProbe: ViewportSourceProbe
): string[] => {
  const startedUrl = normalizeMotionSourceUrlForComparison(startedProbe.sourceUrl);
  const endedUrl = normalizeMotionSourceUrlForComparison(endedProbe.sourceUrl);
  if (!startedUrl || !endedUrl) return ["motion_source_unverified"];
  return startedUrl === endedUrl ? [] : ["motion_source_changed"];
};

const motionPageQualityDiagnosticReasons = (
  startedProbe: ViewportSourceProbe,
  endedProbe: ViewportSourceProbe
): string[] => {
  const qualities = [
    { sourceUrl: startedProbe.sourceUrl, quality: startedProbe.pinterestPageQuality },
    { sourceUrl: endedProbe.sourceUrl, quality: endedProbe.pinterestPageQuality }
  ];
  return qualities.some((entry) => (
    isPinterestUrl(entry.sourceUrl) && entry.quality !== "pin_media"
  ))
    ? ["motion_source_page_quality_not_pin_media"]
    : [];
};

const resolveInspiredesignCaptureCookiePolicy = (
  options: InspiredesignCaptureOptions
): ProviderCookiePolicy => {
  if (options.cookiePolicyOverride) return options.cookiePolicyOverride;
  return options.useCookies === false ? "off" : "auto";
};

const withCaptureDeadline = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  let clearDeadline = () => {};
  const timeoutPromise = new Promise<T>((_, reject) => {
    const handle = setTimeout(() => reject(new Error(`Deep capture ${label} exceeded timeout budget.`)), timeoutMs);
    clearDeadline = () => clearTimeout(handle);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearDeadline();
  }
};

const verifyRequiredCaptureCookies = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  url: string,
  importState: CaptureCookieImportState,
  timeoutMs: number
): Promise<void> => {
  const cookies = await withCaptureDeadline(
    manager.cookieList(sessionId, [url], undefined, timeoutMs),
    timeoutMs,
    "cookie verification"
  );
  if (cookies.count > 0) return;
  if (!importState.sourceConfigured) {
    throw new Error(ACTIVE_SESSION_COOKIE_REUSE_UNAVAILABLE_MESSAGE);
  }
  const sourceDetail = importState.sourceMessage ? ` ${importState.sourceMessage}` : "";
  throw new Error(`Deep capture requires observable cookies from the configured provider cookie source for the requested URL.${sourceDetail}`);
};

const importConfiguredCaptureCookies = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  source: ProviderCookieSourceConfig | undefined,
  timeoutMs: number
): Promise<CaptureCookieImportState> => {
  if (!source || typeof manager.cookieImport !== "function") {
    return {
      sourceConfigured: Boolean(source),
      sourceAvailable: false
    };
  }
  const loaded = await readCookiesFromSource(source);
  if (loaded.cookies.length === 0) {
    return {
      sourceConfigured: true,
      sourceAvailable: loaded.available,
      sourceMessage: loaded.message
      };
  }
  await withCaptureDeadline(
    manager.cookieImport(sessionId, loaded.cookies, false, undefined, timeoutMs),
    timeoutMs,
    "cookie import"
  );
  return {
    sourceConfigured: true,
    sourceAvailable: loaded.available,
    sourceMessage: loaded.message
  };
};

type CaptureArtifactResult = {
  attempt: InspiredesignCaptureAttemptEvidence;
  transportTimedOut?: boolean;
  snapshot?: InspiredesignCaptureEvidence["snapshot"];
  clone?: InspiredesignCaptureEvidence["clone"];
  dom?: InspiredesignCaptureEvidence["dom"];
  visual?: InspiredesignVisualEvidenceRuntimeMetadata;
};

const captureSnapshotArtifact = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  remainingTimeoutMs: () => number
): Promise<CaptureArtifactResult> => {
  try {
    const snapshot = await withCaptureDeadline(
      manager.snapshot(
        sessionId,
        "actionables",
        INSPIREDESIGN_CAPTURE_MAX_CHARS,
        undefined,
        undefined,
        remainingTimeoutMs()
      ),
      remainingTimeoutMs(),
      "snapshot capture"
    );
    const content = sanitizeInspiredesignCaptureText(snapshot.content) ?? "";
    if (!hasUsableCaptureText(content)) {
      return {
        attempt: buildCaptureAttempt("failed", SNAPSHOT_CAPTURE_EMPTY_MESSAGE)
      };
    }
    return {
      attempt: buildCaptureAttempt("captured"),
      snapshot: {
        content,
        refCount: snapshot.refCount,
        warnings: snapshot.warnings ?? []
      }
    };
  } catch (error) {
    const detail = detailFromCaptureError(error, "Snapshot capture failed.");
    return {
      attempt: buildCaptureAttempt("failed", detail),
      ...(isTransportTimeoutError(error, detail) ? { transportTimedOut: true } : {})
    };
  }
};

const captureCloneArtifact = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  remainingTimeoutMs: () => number
): Promise<CaptureArtifactResult> => {
  try {
    const clone = await withCaptureDeadline(
      manager.clonePage(sessionId, undefined, remainingTimeoutMs()),
      remainingTimeoutMs(),
      "clone capture"
    );
    const componentPreview = sanitizeInspiredesignCaptureText(clone.component) ?? "";
    const cssPreview = sanitizeInspiredesignCaptureText(clone.css) ?? "";
    if (!hasUsableCaptureText(componentPreview) && !hasUsableCaptureText(cssPreview)) {
      return {
        attempt: buildCaptureAttempt("failed", CLONE_CAPTURE_EMPTY_MESSAGE)
      };
    }
    return {
      attempt: buildCaptureAttempt("captured"),
      clone: {
        componentPreview,
        cssPreview,
        warnings: clone.warnings ?? []
      }
    };
  } catch (error) {
    const detail = detailFromCaptureError(error, "Clone capture failed.");
    return {
      attempt: buildCaptureAttempt("failed", detail),
      ...(isTransportTimeoutError(error, detail) ? { transportTimedOut: true } : {})
    };
  }
};

const captureDomArtifact = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  remainingTimeoutMs: () => number
): Promise<CaptureArtifactResult> => {
  if (typeof manager.clonePageHtmlWithOptions !== "function") {
    return {
      attempt: buildCaptureAttempt("skipped", DOM_CAPTURE_HELPER_UNAVAILABLE_MESSAGE)
    };
  }
  try {
    const dom = await withCaptureDeadline(
      manager.clonePageHtmlWithOptions(sessionId, undefined, undefined, remainingTimeoutMs()),
      remainingTimeoutMs(),
      "DOM capture"
    );
    const outerHTML = sanitizeInspiredesignCaptureText(dom.html) ?? "";
    if (!hasUsableCaptureText(outerHTML)) {
      return {
        attempt: buildCaptureAttempt("failed", DOM_CAPTURE_EMPTY_MESSAGE)
      };
    }
    return {
      attempt: buildCaptureAttempt("captured"),
      dom: {
        outerHTML,
        truncated: false
      }
    };
  } catch (error) {
    const detail = detailFromCaptureError(error, "DOM capture failed.");
    return {
      attempt: buildCaptureAttempt("failed", detail),
      ...(isTransportTimeoutError(error, detail) ? { transportTimedOut: true } : {})
    };
  }
};

const buildVisualEvidenceMetadata = (
  status: InspiredesignVisualEvidenceRuntimeMetadata["status"],
  detail?: string,
  warnings: string[] = [],
  tempPath?: string,
  sourceUrl?: string,
  pinterestPageQuality?: PinterestSourcePageQuality
): InspiredesignVisualEvidenceRuntimeMetadata => ({
  status,
  kind: "viewport",
  fullPage: false,
  capturedAt: new Date().toISOString(),
  ...(sourceUrl ? { sourceUrl } : {}),
  ...(pinterestPageQuality ? { pinterestPageQuality } : {}),
  ...(tempPath ? { tempPath } : {}),
  warnings,
  ...(detail ? { failure: sanitizeInspiredesignCaptureText(detail) } : {})
});

const collectPinterestPinMediaNotFoundReasons = (
	result: BrowserPinterestPinMediaResult
): string[] => {
	const reasons = result.rejectedCandidates.flatMap((candidate) => candidate.reasons);
	return [...new Set(reasons.length > 0 ? reasons : ["pin_media_candidate_not_found"])]
	.map((reason) => sanitizeInspiredesignCaptureText(reason))
	.filter((reason): reason is string => Boolean(reason));
};

const buildPinMediaEvidenceMetadata = (
	status: InspiredesignPinterestPinMediaRuntimeMetadata["status"],
	referenceId: string,
	url: string,
	detail?: string,
	options: {
	kind?: InspiredesignPinterestPinMediaRuntimeMetadata["kind"] | undefined;
	tempPath?: string | undefined;
	sourceUrl?: string | undefined;
	startedSourceUrl?: string | undefined;
	endedSourceUrl?: string | undefined;
	pinterestPageQuality?: PinterestSourcePageQuality | undefined;
	mediaUrl?: string | undefined;
	candidateSelector?: string | undefined;
	candidateRole?: string | undefined;
	candidateAlt?: string | undefined;
	width?: number | undefined;
	height?: number | undefined;
	contentType?: string | undefined;
	warnings?: string[] | undefined;
	rejectionReasons?: string[] | undefined;
	} = {}
): InspiredesignPinterestPinMediaRuntimeMetadata => ({
	status,
	kind: options.kind ?? "image",
	capturedAt: new Date().toISOString(),
	referenceId,
	url,
	...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
	...(options.startedSourceUrl ? { startedSourceUrl: options.startedSourceUrl } : {}),
	...(options.endedSourceUrl ? { endedSourceUrl: options.endedSourceUrl } : {}),
	...(options.pinterestPageQuality ? { pinterestPageQuality: options.pinterestPageQuality } : {}),
	...(options.mediaUrl ? { mediaUrl: options.mediaUrl } : {}),
	...(options.candidateSelector ? { candidateSelector: options.candidateSelector } : {}),
	...(options.candidateRole ? { candidateRole: options.candidateRole } : {}),
	...(options.candidateAlt ? { candidateAlt: options.candidateAlt } : {}),
	...(options.width ? { width: options.width } : {}),
	...(options.height ? { height: options.height } : {}),
	...(options.contentType ? { contentType: options.contentType } : {}),
	...(options.tempPath ? { tempPath: options.tempPath } : {}),
	warnings: options.warnings ?? [],
	...(detail ? { failure: sanitizeInspiredesignCaptureText(detail) } : {}),
	rejectionReasons: options.rejectionReasons ?? []
});

const mergePinMediaWarnings = (
	viewportProbe: ViewportSourceProbe,
	result: BrowserPinterestPinMediaResult
): string[] => [...viewportProbe.warnings, ...(result.warnings ?? [])];

const hasCapturedPinMediaDirectProof = (
	result: BrowserPinterestPinMediaResult,
	sourceUrl: string | undefined
): boolean => Boolean(sourceUrl && result.mediaUrl && result.path);

const buildCapturedPinMediaMetadata = (
	result: BrowserPinterestPinMediaResult,
	referenceId: string,
	url: string,
	requestedPath: string,
	viewportProbe: ViewportSourceProbe,
	fallbackPageQuality?: PinterestSourcePageQuality
): InspiredesignPinterestPinMediaRuntimeMetadata => {
	const sourceUrl = result.sourceUrl || viewportProbe.sourceUrl;
	if (!result.path || resolve(result.path) !== resolve(requestedPath)) {
	return buildPinMediaEvidenceMetadata(
		"failed",
		referenceId,
		url,
		PIN_MEDIA_CAPTURE_PATH_MISMATCH_MESSAGE,
		{
		kind: result.kind ?? "image",
		sourceUrl,
		endedSourceUrl: sourceUrl,
		pinterestPageQuality: viewportProbe.pinterestPageQuality ?? fallbackPageQuality,
		warnings: [...mergePinMediaWarnings(viewportProbe, result), "pin_media_temp_path_mismatch"],
		rejectionReasons: ["pin_media_temp_path_mismatch"]
		}
	);
	}
	const pinterestPageQuality = hasCapturedPinMediaDirectProof(result, sourceUrl)
		? "pin_media"
		: viewportProbe.pinterestPageQuality ?? fallbackPageQuality ?? "unknown";
	return buildPinMediaEvidenceMetadata("captured", referenceId, url, undefined, {
	kind: result.kind ?? "image",
	tempPath: requestedPath,
	sourceUrl,
	endedSourceUrl: sourceUrl,
	pinterestPageQuality,
	mediaUrl: result.mediaUrl,
	candidateSelector: result.candidateSelector,
	candidateRole: result.candidateRole,
	candidateAlt: result.alt,
		width: result.naturalWidth ?? result.width,
		height: result.naturalHeight ?? result.height,
		contentType: result.contentType,
		warnings: mergePinMediaWarnings(viewportProbe, result)
		});
};

const capturePinterestViewportHtml = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  sourceUrl: string | undefined,
  remainingTimeoutMs: () => number
): Promise<string | undefined> => {
  if (!isPinterestUrl(sourceUrl) || typeof manager.clonePageHtmlWithOptions !== "function") return undefined;
  const timeoutMs = remainingTimeoutMs();
  if (timeoutMs <= 1) return undefined;
  try {
    const clone = await withCaptureDeadline(
      manager.clonePageHtmlWithOptions(
        sessionId,
        undefined,
        {
          maxNodes: PINTEREST_VIEWPORT_MEDIA_PROBE_MAX_NODES,
          inlineStyles: false
        },
        timeoutMs
      ),
      timeoutMs,
      "Pinterest viewport media probe"
    );
    return sanitizeInspiredesignCaptureText(clone.html);
  } catch {
    return undefined;
  }
};

const captureViewportSourceUrl = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  remainingTimeoutMs: () => number
): Promise<ViewportSourceProbe> => {
  try {
    const snapshot = await withCaptureDeadline(
      manager.snapshot(sessionId, "outline", 1_000, undefined, undefined, remainingTimeoutMs()),
      remainingTimeoutMs(),
      "visual evidence viewport probe"
    );
	    const warnings = [
	      ...(snapshot.url ? [] : [VISUAL_VIEWPORT_PROBE_FAILED_WARNING]),
	      ...pinterestViewportWarnings({
	        url: snapshot.url,
	        title: snapshot.title,
	        content: snapshot.content,
	        warnings: snapshot.warnings
	      })
	    ];
	    const html = await capturePinterestViewportHtml(
	      manager,
	      sessionId,
	      snapshot.url,
	      remainingTimeoutMs
	    );
	    const pinterestPageQuality = pinterestViewportPageQuality({
	      url: snapshot.url,
	      title: snapshot.title,
	      content: snapshot.content,
	      html,
	      warnings: snapshot.warnings
	    });
	    return {
	      ...(snapshot.url ? { sourceUrl: snapshot.url } : {}),
	      ...(pinterestPageQuality ? { pinterestPageQuality } : {}),
	      warnings
	    };
  } catch {
    return { warnings: [VISUAL_VIEWPORT_PROBE_FAILED_WARNING] };
  }
};

const captureVisualEvidenceArtifact = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  options: InspiredesignCaptureOptions,
  remainingTimeoutMs: () => number
): Promise<InspiredesignVisualEvidenceRuntimeMetadata | undefined> => {
  const visualEvidence = options.visualEvidence ?? "off";
  if (visualEvidence === "off") return undefined;
  if (!options.visualEvidencePath) {
    return buildVisualEvidenceMetadata(
      visualEvidence === "required" ? "failed" : "skipped",
      VISUAL_CAPTURE_PATH_UNAVAILABLE_MESSAGE
    );
  }
  if (typeof manager.screenshot !== "function") {
    return buildVisualEvidenceMetadata(
      visualEvidence === "required" ? "failed" : "skipped",
      VISUAL_CAPTURE_HELPER_UNAVAILABLE_MESSAGE
    );
  }
  try {
    await mkdir(dirname(options.visualEvidencePath), { recursive: true });
    const viewportProbe = await captureViewportSourceUrl(manager, sessionId, remainingTimeoutMs);
    const screenshot = await withCaptureDeadline(
      manager.screenshot(sessionId, {
        path: options.visualEvidencePath,
        fullPage: false
      }),
      remainingTimeoutMs(),
      "visual evidence screenshot"
    );
    if (!screenshot.path) {
      return buildVisualEvidenceMetadata("failed", VISUAL_CAPTURE_EMPTY_MESSAGE);
    }
    if (resolve(screenshot.path) !== resolve(options.visualEvidencePath)) {
      return buildVisualEvidenceMetadata("failed", "Visual evidence screenshot path did not match the requested artifact path.");
    }
    return buildVisualEvidenceMetadata(
      "captured",
      undefined,
	      [...viewportProbe.warnings, ...(screenshot.warnings ?? [])],
	      options.visualEvidencePath,
	      viewportProbe.sourceUrl,
	      viewportProbe.pinterestPageQuality
	    );
  } catch (error) {
    return buildVisualEvidenceMetadata(
      "failed",
      detailFromCaptureError(error, "Visual evidence screenshot failed.")
    );
  }
};

const buildCaptureEvidence = (
  snapshot: CaptureArtifactResult,
  clone: CaptureArtifactResult,
  dom: CaptureArtifactResult,
  visual?: InspiredesignVisualEvidenceRuntimeMetadata
): InspiredesignCaptureEvidence => {
  const attempts: InspiredesignCaptureAttempts = {
    snapshot: snapshot.attempt,
    clone: clone.attempt,
    dom: dom.attempt
  };
  return {
    ...(snapshot.snapshot ? { snapshot: snapshot.snapshot } : {}),
    ...(dom.dom ? { dom: dom.dom } : {}),
    ...(clone.clone ? { clone: clone.clone } : {}),
    ...(visual ? { visual } : {}),
    attempts
  };
};

const buildTransportTimeoutCaptureEvidence = (
  snapshot: CaptureArtifactResult,
  clone: CaptureArtifactResult | undefined,
  label: string
): InspiredesignCaptureEvidence => {
  const attempts: InspiredesignCaptureAttempts = {
    snapshot: snapshot.attempt,
    clone: clone?.attempt ?? buildSkippedAfterTransportTimeoutAttempt(label),
    dom: buildSkippedAfterTransportTimeoutAttempt(label)
  };
  return {
    ...(snapshot.snapshot ? { snapshot: snapshot.snapshot } : {}),
    ...(clone?.clone ? { clone: clone.clone } : {}),
    attempts
  };
};

const captureInspiredesignArtifacts = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  remainingTimeoutMs: () => number,
  options: InspiredesignCaptureOptions
): Promise<InspiredesignCaptureEvidence> => {
  const snapshot = await captureSnapshotArtifact(manager, sessionId, remainingTimeoutMs);
  if (snapshot.transportTimedOut) {
    return buildTransportTimeoutCaptureEvidence(snapshot, undefined, "snapshot capture");
  }
  const clone = await captureCloneArtifact(manager, sessionId, remainingTimeoutMs);
  if (clone.transportTimedOut) {
    return buildTransportTimeoutCaptureEvidence(snapshot, clone, "clone capture");
  }
  const dom = await captureDomArtifact(manager, sessionId, remainingTimeoutMs);
  const visual = await captureVisualEvidenceArtifact(manager, sessionId, options, remainingTimeoutMs);
  return buildCaptureEvidence(snapshot, clone, dom, visual);
};

const delay = (ms: number): Promise<void> => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

const shouldForceManagedPrimaryCapture = (browserMode: WorkflowBrowserMode | undefined): boolean => (
  browserMode === "managed"
);

const launchPrimaryCaptureSession = async (
  manager: InspiredesignCaptureManagerLike,
  url: string,
  remainingTimeoutMs: () => number,
  options: InspiredesignPrimaryCaptureCookieOptions & {
    browserMode?: WorkflowBrowserMode;
    challengeAutomationMode?: ChallengeAutomationMode;
  }
): Promise<{ sessionId: string }> => {
  const cookiePolicy = resolveInspiredesignCaptureCookiePolicy(options);
  const launchTimeoutMs = remainingTimeoutMs();
  const session = await withCaptureDeadline(
    manager.launch({
      headless: options.browserMode !== "extension",
      startUrl: "about:blank",
      persistProfile: false,
      noExtension: shouldForceManagedPrimaryCapture(options.browserMode)
    }, launchTimeoutMs),
    launchTimeoutMs,
    "primary media capture session launch"
  );
  try {
    const importState = cookiePolicy === "off"
      ? { sourceConfigured: false, sourceAvailable: false }
      : await importConfiguredCaptureCookies(
        manager,
        session.sessionId,
        options.cookieSource,
        remainingTimeoutMs()
      );
    if (cookiePolicy === "required") {
      await verifyRequiredCaptureCookies(
        manager,
        session.sessionId,
        url,
        importState,
        remainingTimeoutMs()
      );
    }
    manager.setSessionChallengeAutomationMode?.(session.sessionId, options.challengeAutomationMode);
    const gotoTimeoutMs = remainingTimeoutMs();
    await withCaptureDeadline(
      manager.goto(session.sessionId, url, "load", gotoTimeoutMs),
      gotoTimeoutMs,
      "primary media capture navigation"
    );
    const waitTimeoutMs = remainingTimeoutMs();
    try {
      await withCaptureDeadline(
        manager.waitForLoad(session.sessionId, "networkidle", waitTimeoutMs),
        waitTimeoutMs,
        "primary media capture network idle wait"
      );
    } catch (error) {
      if (!isIgnorableNetworkIdleWaitError(error)) throw error;
    }
  } catch (error) {
    await manager.disconnect(session.sessionId, true).catch(() => undefined);
    throw error;
  }
  return session;
};

export async function captureInspiredesignPrimaryVisualEvidenceFromManager(
  manager: InspiredesignCaptureManagerLike,
  url: string,
  options: InspiredesignPrimaryVisualCaptureOptions
): Promise<InspiredesignVisualEvidenceRuntimeMetadata | undefined> {
  if (typeof (manager as { launch?: unknown }).launch !== "function") {
    return buildVisualEvidenceMetadata(
      "failed",
      PRIMARY_CAPTURE_SESSION_UNAVAILABLE_MESSAGE,
      ["primary_capture_session_unavailable"]
    );
  }
  const captureTimeoutMs = clampInspiredesignCaptureTimeout(options.timeoutMs);
  const remainingTimeoutMs = createRemainingCaptureTimeout(captureTimeoutMs);
  let session: { sessionId: string };
  try {
    session = await launchPrimaryCaptureSession(
      manager,
      url,
      remainingTimeoutMs,
      options
    );
  } catch (error) {
    return buildVisualEvidenceMetadata(
      "failed",
      detailFromCaptureError(error, "Primary visual evidence setup failed."),
      ["primary_capture_setup_failed"]
    );
  }
  try {
    return await captureVisualEvidenceArtifact(manager, session.sessionId, {
      visualEvidence: "required",
      visualEvidencePath: options.visualEvidencePath
    }, remainingTimeoutMs);
  } finally {
    await manager.disconnect(session.sessionId, true).catch(() => undefined);
  }
}

export async function captureInspiredesignPrimaryPinMediaEvidenceFromManager(
	manager: InspiredesignCaptureManagerLike,
	url: string,
	options: InspiredesignPrimaryPinMediaCaptureOptions
): Promise<InspiredesignPinterestPinMediaRuntimeMetadata | undefined> {
	if (!options.pinMediaEvidencePath) {
	return buildPinMediaEvidenceMetadata(
		"failed",
		options.referenceId,
		url,
		PIN_MEDIA_CAPTURE_PATH_UNAVAILABLE_MESSAGE,
		{ rejectionReasons: ["pin_media_path_unavailable"] }
	);
	}
	if (typeof (manager as { launch?: unknown }).launch !== "function") {
	return buildPinMediaEvidenceMetadata(
		"failed",
		options.referenceId,
		url,
		PRIMARY_CAPTURE_SESSION_UNAVAILABLE_MESSAGE,
		{
		warnings: ["primary_capture_session_unavailable"],
		rejectionReasons: ["primary_capture_session_unavailable"]
		}
	);
	}
	if (typeof manager.capturePinterestPinMedia !== "function") {
	return buildPinMediaEvidenceMetadata(
		"failed",
		options.referenceId,
		url,
		PIN_MEDIA_CAPTURE_HELPER_UNAVAILABLE_MESSAGE,
		{
		warnings: ["pin_media_capture_helper_unavailable"],
		rejectionReasons: ["pin_media_capture_helper_unavailable"]
		}
	);
	}
	const captureTimeoutMs = clampInspiredesignCaptureTimeout(options.timeoutMs);
	const remainingTimeoutMs = createRemainingCaptureTimeout(captureTimeoutMs);
	let session: { sessionId: string };
	try {
	session = await launchPrimaryCaptureSession(
		manager,
		url,
		remainingTimeoutMs,
		options
	);
	} catch (error) {
	return buildPinMediaEvidenceMetadata(
		"failed",
		options.referenceId,
		url,
		detailFromCaptureError(error, "Primary Pinterest pin media evidence setup failed."),
		{
		warnings: ["primary_capture_setup_failed"],
		rejectionReasons: ["primary_capture_setup_failed"]
		}
	);
	}
	try {
	await mkdir(dirname(options.pinMediaEvidencePath), { recursive: true });
	const viewportProbe = await captureViewportSourceUrl(manager, session.sessionId, remainingTimeoutMs);
	const captureTimeout = remainingTimeoutMs();
	const result = await withCaptureDeadline(
		manager.capturePinterestPinMedia(session.sessionId, {
		path: options.pinMediaEvidencePath,
		timeoutMs: captureTimeout
		}),
		captureTimeout,
		"Pinterest pin media evidence capture"
	);
	if (result.status === "not_found") {
		const sourceUrl = result.sourceUrl || viewportProbe.sourceUrl;
		return buildPinMediaEvidenceMetadata(
		"skipped",
		options.referenceId,
		url,
		PIN_MEDIA_CAPTURE_NOT_FOUND_MESSAGE,
		{
			sourceUrl,
			endedSourceUrl: sourceUrl,
			pinterestPageQuality: viewportProbe.pinterestPageQuality ?? options.pinterestPageQuality,
			warnings: mergePinMediaWarnings(viewportProbe, result),
			rejectionReasons: collectPinterestPinMediaNotFoundReasons(result)
		}
		);
	}
	return buildCapturedPinMediaMetadata(
		result,
		options.referenceId,
		url,
		options.pinMediaEvidencePath,
		viewportProbe,
		options.pinterestPageQuality
	);
	} catch (error) {
	return buildPinMediaEvidenceMetadata(
		"failed",
		options.referenceId,
		url,
		detailFromCaptureError(error, "Primary Pinterest pin media evidence capture failed."),
		{
		warnings: ["primary_pin_media_capture_failed"],
		rejectionReasons: ["primary_pin_media_capture_failed"]
		}
	);
	} finally {
	await manager.disconnect(session.sessionId, true).catch(() => undefined);
	}
}

export async function captureInspiredesignPrimaryMotionEvidenceFromManager(
  manager: InspiredesignCaptureManagerLike,
  url: string,
  options: InspiredesignPrimaryMotionCaptureOptions
): Promise<InspiredesignMotionEvidenceRuntimeMetadata | undefined> {
  if (!manager.startScreencast || !manager.stopScreencast) {
    return {
      status: "failed",
      kind: "screencast",
      capturedAt: new Date().toISOString(),
      frameCount: 0,
      warnings: ["screencast_helper_unavailable"],
      failure: "Screencast helper unavailable in this execution lane.",
      diagnostic: true,
      diagnosticReasons: ["screencast_helper_unavailable"]
    };
  }
  if (typeof (manager as { launch?: unknown }).launch !== "function") {
    return {
      status: "failed",
      kind: "screencast",
      capturedAt: new Date().toISOString(),
      frameCount: 0,
      warnings: ["primary_capture_session_unavailable"],
      failure: PRIMARY_CAPTURE_SESSION_UNAVAILABLE_MESSAGE,
      diagnostic: true,
      diagnosticReasons: ["primary_capture_session_unavailable"]
    };
  }
  const captureTimeoutMs = clampInspiredesignCaptureTimeout(options.timeoutMs);
  const remainingTimeoutMs = createRemainingCaptureTimeout(captureTimeoutMs);
  let session: { sessionId: string };
  try {
    session = await launchPrimaryCaptureSession(
      manager,
      url,
      remainingTimeoutMs,
      options
    );
  } catch (error) {
    return {
      status: "failed",
      kind: "screencast",
      capturedAt: new Date().toISOString(),
      frameCount: 0,
      warnings: ["primary_capture_setup_failed"],
      failure: detailFromCaptureError(error, "Primary motion evidence setup failed."),
      diagnostic: true,
      diagnosticReasons: ["primary_capture_setup_failed"]
    };
  }
  try {
    const startedViewportProbe = await captureViewportSourceUrl(manager, session.sessionId, remainingTimeoutMs);
    const startTimeoutMs = remainingTimeoutMs();
    let stopLateStart = false;
    const startScreencast = manager.startScreencast(session.sessionId, {
      outputDir: options.outputDir,
      intervalMs: INSPIREDESIGN_MOTION_INTERVAL_MS,
      maxFrames: INSPIREDESIGN_MOTION_MAX_FRAMES
    });
    startScreencast.then(async (screencast) => {
      if (stopLateStart) {
        const lateStop = manager.stopScreencast?.(session.sessionId, screencast.screencastId);
        if (lateStop) {
          await withCaptureDeadline(
            lateStop,
            INSPIREDESIGN_LATE_SCREENCAST_STOP_TIMEOUT_MS,
            "late primary motion capture stop"
          ).catch(() => undefined);
        }
      }
    }).catch(() => undefined);
    const screencast = await withCaptureDeadline(
      startScreencast.catch((error) => {
        stopLateStart = false;
        throw error;
      }),
      startTimeoutMs,
      "primary motion capture start"
    ).catch((error) => {
      stopLateStart = true;
      throw error;
    });
    let result: Awaited<ReturnType<NonNullable<InspiredesignCaptureManagerLike["stopScreencast"]>>> | undefined;
    try {
      const sampleTimeoutMs = remainingTimeoutMs();
      if (sampleTimeoutMs <= 1) {
        throw new Error("Deep capture primary motion capture sampling exceeded timeout budget.");
      }
      await withCaptureDeadline(
        delay(Math.min(INSPIREDESIGN_MOTION_INTERVAL_MS * INSPIREDESIGN_MOTION_MAX_FRAMES, sampleTimeoutMs)),
        sampleTimeoutMs,
        "primary motion capture sampling"
      );
    } finally {
      const stopTimeoutMs = remainingTimeoutMs();
      result = await withCaptureDeadline(
        manager.stopScreencast(session.sessionId, screencast.screencastId),
        stopTimeoutMs,
        "primary motion capture stop"
      );
    }
    if (!result) {
      throw new Error("Motion evidence screencast did not return stop metadata.");
    }
    const endedViewportProbe = await captureViewportSourceUrl(manager, session.sessionId, remainingTimeoutMs);
    const diagnosticReasons = [
      ...(result.frameCount === 0 ? ["zero_frame_capture"] : []),
      ...motionSourceDiagnosticReasons(startedViewportProbe, endedViewportProbe),
      ...motionPageQualityDiagnosticReasons(startedViewportProbe, endedViewportProbe)
    ];
    const pinterestPageQuality = endedViewportProbe.pinterestPageQuality ?? startedViewportProbe.pinterestPageQuality;
    return {
      status: "captured",
      kind: "screencast",
      capturedAt: result.endedAt,
      replay: { tempPath: result.manifestPath },
      replayHtml: { tempPath: result.replayHtmlPath },
      ...(result.previewPath ? { preview: { tempPath: result.previewPath } } : {}),
      outputDir: result.outputDir,
      frameCount: result.frameCount,
      warnings: [...startedViewportProbe.warnings, ...endedViewportProbe.warnings, ...(result.warnings ?? [])],
      ...(endedViewportProbe.sourceUrl ?? startedViewportProbe.sourceUrl
        ? { sourceUrl: endedViewportProbe.sourceUrl ?? startedViewportProbe.sourceUrl }
        : {}),
      ...(startedViewportProbe.sourceUrl ? { startedSourceUrl: startedViewportProbe.sourceUrl } : {}),
      ...(endedViewportProbe.sourceUrl ? { endedSourceUrl: endedViewportProbe.sourceUrl } : {}),
      ...(pinterestPageQuality ? { pinterestPageQuality } : {}),
      ...(startedViewportProbe.pinterestPageQuality
        ? { startedPinterestPageQuality: startedViewportProbe.pinterestPageQuality }
        : {}),
      ...(endedViewportProbe.pinterestPageQuality
        ? { endedPinterestPageQuality: endedViewportProbe.pinterestPageQuality }
        : {}),
      diagnostic: diagnosticReasons.length > 0,
      diagnosticReasons
    };
  } catch (error) {
    return {
      status: "failed",
      kind: "screencast",
      capturedAt: new Date().toISOString(),
      frameCount: 0,
      warnings: ["motion_capture_failed"],
      failure: detailFromCaptureError(error, "Motion evidence screencast failed."),
      diagnostic: true,
      diagnosticReasons: ["motion_capture_failed"]
    };
  } finally {
    await manager.disconnect(session.sessionId, true).catch(() => undefined);
  }
}

export async function captureInspiredesignReferenceFromManager(
  manager: InspiredesignCaptureManagerLike,
  url: string,
  options: InspiredesignCaptureOptions = {}
): Promise<InspiredesignCaptureEvidence> {
  const cookiePolicy = resolveInspiredesignCaptureCookiePolicy(options);
  const captureTimeoutMs = clampInspiredesignCaptureTimeout(options.timeoutMs);
  const remainingTimeoutMs = createRemainingCaptureTimeout(captureTimeoutMs);
  const launchTimeoutMs = remainingTimeoutMs();
  const session = await withCaptureDeadline(
    manager.launch({
      headless: true,
      startUrl: "about:blank",
      persistProfile: false,
      noExtension: true
    }, launchTimeoutMs),
    launchTimeoutMs,
    "session launch"
  );
  try {
    const importState = cookiePolicy === "off"
      ? { sourceConfigured: false, sourceAvailable: false }
      : await importConfiguredCaptureCookies(
        manager,
        session.sessionId,
        options.cookieSource,
        remainingTimeoutMs()
      );
    if (cookiePolicy === "required") {
      await verifyRequiredCaptureCookies(
        manager,
        session.sessionId,
        url,
        importState,
        remainingTimeoutMs()
      );
    }
    manager.setSessionChallengeAutomationMode?.(session.sessionId, options.challengeAutomationMode);
    const gotoTimeoutMs = remainingTimeoutMs();
    await withCaptureDeadline(
      manager.goto(session.sessionId, url, "load", gotoTimeoutMs),
      gotoTimeoutMs,
      "navigation"
    );
    const waitTimeoutMs = remainingTimeoutMs();
    try {
      await withCaptureDeadline(
        manager.waitForLoad(session.sessionId, "networkidle", waitTimeoutMs),
        waitTimeoutMs,
        "network idle wait"
      );
    } catch (error) {
      if (!isIgnorableNetworkIdleWaitError(error)) {
        throw error;
      }
    }
    return await captureInspiredesignArtifacts(manager, session.sessionId, remainingTimeoutMs, options);
  } finally {
    await manager.disconnect(session.sessionId, true).catch(() => undefined);
  }
}
