import { createHash, randomUUID } from "crypto";
import { execFileSync, spawn } from "node:child_process";
import { constants as fsConstants } from "fs";
import { access, mkdir, open, readFile, rm, unlink, writeFile } from "fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "path";
import { freemem, homedir, totalmem } from "os";
import type { Browser, BrowserContext, CDPSession, Dialog, Page } from "playwright-core";
import { Mutex } from "async-mutex";
import { requireChallengeOrchestrationConfig, type OpenDevBrowserConfig } from "../config";
import { resolveCachePaths, type CachePaths } from "../cache/paths";
import { findChromeExecutable } from "../cache/chrome-locator";
import { downloadChromeForTesting } from "../cache/downloader";
import { createLogger, createRequestId } from "../core/logging";
import { DEFAULT_GOOGLE_AUTH_INTENT, type GoogleAuthIntent } from "../core/auth-intent";
import { ConsoleTracker } from "../devtools/console-tracker";
import { ExceptionTracker } from "../devtools/exception-tracker";
import { NetworkTracker } from "../devtools/network-tracker";
import { captureDom, type DomCapture } from "../export/dom-capture";
import { extractCss } from "../export/css-extract";
import { emitReactComponent, type ReactExport } from "../export/react-emitter";
import { RefStore } from "../snapshot/refs";
import { Snapshotter } from "../snapshot/snapshotter";
import { resolveRelayEndpoint, sanitizeWsEndpoint } from "../relay/relay-endpoints";
import type { RelayStatus } from "../relay/relay-server";
import { ensureLocalEndpoint } from "../utils/endpoint-validation";
import { buildBlockerArtifacts, classifyBlockerSignal } from "../providers/blocker";
import {
  BROWSER_SCREENSHOT_ARTIFACT_NAMESPACE,
  createBrowserOutputArtifactDirectory
} from "../providers/browser-output-artifacts";
import {
  ChallengeOrchestrator,
  inspectChallengePlanFromRuntime,
  resolveChallengeAutomationPolicy,
  type ChallengeAutomationMode
} from "../challenges";
import {
  inspectPinterestPinMediaBuffer,
  isPinterestPinMediaEvidenceContentType
} from "../inspiredesign/pinterest-pin-media-evidence";
import type {
  BlockerSignalV1,
  ChallengeOwnerSurface,
  ResumeMode,
  SessionChallengeSummary,
  SuspendedIntentSummary
} from "../providers/types";
import type {
  BrowserClonePageOptions,
  BrowserAuthProvenanceDiagnostics,
  BrowserAuthSessionOptions,
  BrowserCookieImportResult,
  BrowserProviderCookieImportProvenance,
  BrowserSessionDiagnostics,
  BrowserDialogInput,
  BrowserDialogResult,
  BrowserDialogState,
  BrowserPinterestPinMediaKind,
  BrowserPinterestPinMediaOptions,
  BrowserPinterestPinMediaRect,
  BrowserPinterestPinMediaRejectedCandidate,
  BrowserPinterestPinMediaResult,
  BrowserResponseMeta,
  BrowserScreencastResult,
  BrowserScreencastSession,
  BrowserScreencastStartOptions,
  BrowserScreenshotOptions,
  BrowserScreenshotResult,
  BrowserUploadInput,
  BrowserUploadResult,
  ChallengeRuntimeHandle,
  SessionInspectorHandle
} from "./manager-types";
import { SCREENCAST_RETENTION_MS } from "./manager-types";
import {
  evaluateTier1Coherence,
  formatTier1Warnings,
  type Tier1CoherenceResult
} from "./fingerprint/tier1-coherence";
import {
  applyTier2NetworkEvent,
  createTier2RuntimeState,
  type Tier2RuntimeState
} from "./fingerprint/tier2-runtime";
import {
  createTier3RuntimeState,
  evaluateTier3Adaptive,
  type Tier3RuntimeState
} from "./fingerprint/tier3-adaptive";
import { SessionStore, type BrowserMode } from "./session-store";
import { TargetManager, type TargetInfo } from "./target-manager";
import {
  buildSafeTargetUrlSummary,
  CdpTargetOwnershipGraph,
  inferTargetPopupKind,
  metadataFromCdpTargetEntry,
  type CdpTargetOwnershipEntry,
  type CdpTargetOwnershipSession,
  type TargetOwnershipMetadata
} from "./cdp-target-ownership";
import {
  createGovernorState,
  evaluateGovernor,
  rssUsagePercent,
  type ParallelModeVariant,
  type ParallelismGovernorSnapshot,
  type ParallelismGovernorState
} from "./parallelism-governor";
import {
  applyRuntimePreviewBridge as runRuntimePreviewBridge,
  type RuntimePreviewBridgeInput,
  type RuntimePreviewBridgeResult
} from "./canvas-runtime-preview-bridge";
import { loadChromium } from "./playwright-runtime";
import { loadSystemChromeCookies } from "./system-chrome-cookies";
import { GlobalChallengeCoordinator } from "./global-challenge-coordinator";
import { BrowserScreencastRecorder } from "./screencast-recorder";
import { sanitizeProviderCookieImportProvenance } from "./auth-provenance";
import {
  createSessionProfileRegistry,
  sanitizeSessionProfileId,
  type SessionProfileEndpoint,
  type SessionProfileLease,
  type SessionProfileRecord,
  type SessionProfileSummary
} from "./session-profile-registry";
import { findUnsafeExplicitCdpProfileFlag } from "./explicit-cdp-profile-flags";

export type LaunchOptions = {
  profile?: string;
  headless?: boolean;
  startUrl?: string;
  chromePath?: string;
  flags?: string[];
  persistProfile?: boolean;
  // Used by hub/daemon callers to force managed launch when routing through relay.
  noExtension?: boolean;
} & BrowserAuthSessionOptions;

export type ConnectOptions = {
  wsEndpoint?: string;
  host?: string;
  port?: number;
  profile?: string;
  startUrl?: string;
} & BrowserAuthSessionOptions;

export type ExplicitCdpProfileStartOptions = {
  profile: string;
  port?: number;
  startUrl?: string;
  chromePath?: string;
  flags?: string[];
  readinessTimeoutMs?: number;
};

export type ExplicitCdpProfileResult = {
  profile: SessionProfileSummary;
  pid?: number;
  port?: number;
  warnings: string[];
};

type ResolvedExplicitCdpProfile = {
  readonly record: SessionProfileRecord;
  readonly wsEndpoint: string;
};

type BrowserSessionStartResult = {
  sessionId: string;
  mode: BrowserMode;
  activeTargetId: string | null;
  warnings: string[];
  diagnostics?: BrowserSessionDiagnostics;
  wsEndpoint?: string;
  leaseId?: string;
};

const CDP_PROFILE_START_TIMEOUT_MS = 10_000;
const CDP_PROFILE_START_POLL_MS = 100;
const CDP_PROFILE_STOP_TIMEOUT_MS = 5_000;
const CDP_PROFILE_STOP_POLL_MS = 100;
const CDP_PROFILE_LAUNCH_TOKEN_FILE = ".opendevbrowser-cdp-launch-token.json";
const CDP_CONNECT_ERROR_URL_PATTERN = /\b(?:wss?|https?):\/\/[^\s)'"<>]+/gi;
const CDP_CONNECT_ERROR_SECRET_PATTERN = /\b(token|pairingToken|access_token|auth|session|sid)=\S+/gi;
const PROFILE_LOCK_MESSAGE_PATH_HASH_LENGTH = 16;
const RESERVED_CDP_PROFILE_IDS = new Set(["default"]);

export type ManagedSession = {
  sessionId: string;
  mode: BrowserMode;
  headless: boolean;
  extensionLegacy: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  relayWsEndpoint?: string;
  browser: Browser;
  context: BrowserContext;
  profileDir: string;
  persistProfile: boolean;
  targets: TargetManager;
  refStore: RefStore;
  snapshotter: Snapshotter;
  consoleTracker: ConsoleTracker;
  exceptionTracker: ExceptionTracker;
  networkTracker: NetworkTracker;
  fingerprint: {
    tier1: Tier1CoherenceResult;
    tier2: Tier2RuntimeState;
    tier3: Tier3RuntimeState;
    lastAppliedNetworkSeq: number;
  };
  authProvenance: BrowserAuthProvenanceDiagnostics;
  cdpTargetOwnership?: CdpTargetOwnershipGraph;
};

type ExplicitCdpLaunchTokenProof = {
  version: 1;
  profileId: string;
  launchTokenId: string;
  port: number;
  pid?: number;
  createdAt: string;
};

type BackpressureErrorInfo = {
  code: "parallelism_backpressure";
  classification: "timeout";
  sessionId: string;
  targetId: string;
  modeVariant: ParallelModeVariant;
  effectiveParallelCap: number;
  inFlight: number;
  waitQueueDepth: number;
  waitQueueAgeMs: number;
  pressure: "healthy" | "medium" | "high" | "critical";
  timeoutMs: number;
};

type ParallelWaiter = {
  targetId: string;
  enqueuedAt: number;
  timeoutMs: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
};

type SessionParallelState = {
  structural: Mutex;
  inflight: number;
  waiters: ParallelWaiter[];
  waitingByTarget: Map<string, number[]>;
  governor: ParallelismGovernorState;
  lastSnapshot: ParallelismGovernorSnapshot;
};

type FingerprintSignalApplyOptions = {
  applyTier2?: boolean;
  applyTier3?: boolean;
  source?: "debug-trace" | "continuous";
};

type CookieImportRecord = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

type CookieListRecord = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

function getCookieHost(cookie: CookieImportRecord): string | null {
  if (typeof cookie.domain === "string" && cookie.domain.trim().length > 0) {
    return cookie.domain.trim().toLowerCase().replace(/^\./, "");
  }
  if (typeof cookie.url === "string" && cookie.url.trim().length > 0) {
    try {
      return new URL(cookie.url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

function isGoogleSensitiveCookie(cookie: CookieImportRecord): boolean {
  if (!GOOGLE_SENSITIVE_COOKIE_NAMES.has(cookie.name)) {
    return false;
  }
  const host = getCookieHost(cookie);
  return typeof host === "string" && GOOGLE_SENSITIVE_COOKIE_DOMAINS.some((domain) => (
    host === domain || host.endsWith(`.${domain}`)
  ));
}

const LEGACY_EXTENSION_OPERATION_TIMEOUT_MS = 5000;
const GOOGLE_SENSITIVE_COOKIE_POLICY_SKIP = "skip" as const;
const GOOGLE_SENSITIVE_COOKIE_POLICY_INCLUDE = "include" as const;
const GOOGLE_SENSITIVE_COOKIE_DOMAINS = [
  "accounts.google.com",
  "google.com",
  "youtube.com"
] as const;
const GOOGLE_SENSITIVE_COOKIE_NAMES = new Set<string>([
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "LSID",
  "OSID",
  "SIDCC",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PSIDCC",
  "__Secure-3PSIDCC",
  "__Secure-1PSIDTS",
  "__Secure-3PSIDTS",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
  "__Host-1PLSID",
  "__Host-3PLSID"
]);
const PINTEREST_PIN_MEDIA_DEFAULT_TIMEOUT_MS = 5000;
const PINTEREST_PIN_MEDIA_DOM_INSPECTION_MAX_TIMEOUT_MS = 10_000;
const PINTEREST_PIN_MEDIA_CDP_SESSION_MAX_TIMEOUT_MS = 5_000;
const PINTEREST_PIN_MEDIA_CDP_DETACH_MAX_TIMEOUT_MS = 1_000;
const PINTEREST_PIN_MEDIA_FETCH_MAX_TIMEOUT_MS = 20_000;
const PINTEREST_PIN_MEDIA_MAX_BYTES = 20_000_000;
const PINTEREST_PIN_MEDIA_MAX_REDIRECTS = 3;
const PINTEREST_PIN_MEDIA_MIN_EDGE_PX = 160;
const PINTEREST_PIN_MEDIA_REJECTION_LIMIT = 12;
const PINTEREST_PIN_IMAGE_MEDIA_HOST = "i.pinimg.com";
const PINTEREST_PIN_VIDEO_MEDIA_HOST = "v.pinimg.com";
const PINTEREST_PIN_VIDEO_MEDIA_HOST_PATTERN = /^v\d+(?:-[a-z]+)?\.pinimg\.com$/i;
const PINTEREST_PIN_MEDIA_VIDEO_CONTENT_TYPE = "video/mp4";
const PINTEREST_PIN_MEDIA_GENERIC_BINARY_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/x-binary",
  "binary/octet-stream"
]);
const MP4_FILE_TYPE_BOX_MIN_BYTES = 12;
const MP4_FILE_TYPE_BOX_MARKER_START = 4;
const MP4_FILE_TYPE_BOX_MARKER_END = 8;
const MP4_FILE_TYPE_BOX_MARKER = "ftyp";
const HTTP_REDIRECT_STATUS_MIN = 300;
const HTTP_REDIRECT_STATUS_MAX_EXCLUSIVE = 400;
const PINTEREST_PIN_MEDIA_NOFOLLOW_FLAG = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
const PINTEREST_PIN_MEDIA_OUTPUT_OPEN_FLAGS = fsConstants.O_WRONLY
  | fsConstants.O_CREAT
  | fsConstants.O_EXCL
  | PINTEREST_PIN_MEDIA_NOFOLLOW_FLAG;

type PinterestPinMediaDomCandidate = {
  kind: BrowserPinterestPinMediaKind;
  mediaUrl?: string;
  poster?: string;
  srcset?: string;
  candidateSelector?: string;
  candidateRole?: string;
  alt?: string;
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  rect?: BrowserPinterestPinMediaRect;
  visible: boolean;
  ancestry: string[];
  linkedPinId?: string;
  positiveSignals: string[];
  noiseSignals: string[];
  insideCanonicalMainPinMediaContainer: boolean;
  score: number;
};

type PinterestPinMediaDomExtraction = {
  sourceUrl: string;
  candidates: PinterestPinMediaDomCandidate[];
};

type PinterestPinMediaCdpEvaluationResult = {
  result?: {
    value?: unknown;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
    };
  };
};

type PinterestPinMediaSelection = {
  selected?: PinterestPinMediaDomCandidate;
  acceptedCandidates: PinterestPinMediaDomCandidate[];
  rejectedCandidates: BrowserPinterestPinMediaRejectedCandidate[];
};

function pinterestPinSourceChanged(
  pageUrl: string,
  extractedSourceUrl: string
): boolean {
  const pagePinId = extractPinterestPinId(pageUrl);
  const extractedPinId = extractPinterestPinId(extractedSourceUrl);
  return Boolean(pagePinId && extractedPinId && pagePinId !== extractedPinId);
}

function readAuthoritativePinterestSourceUrl(
  pageUrl: string,
  extractedSourceUrl: string
): string {
  return extractPinterestPinId(extractedSourceUrl) ? extractedSourceUrl : pageUrl;
}

function extractPinterestPinId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/\/pin\/(\d+)/i);
  return match?.[1];
}

function isFirstPartyPinterestMediaUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && (
      hostname === PINTEREST_PIN_IMAGE_MEDIA_HOST
      || hostname === PINTEREST_PIN_VIDEO_MEDIA_HOST
      || PINTEREST_PIN_VIDEO_MEDIA_HOST_PATTERN.test(hostname)
    );
  } catch {
    return false;
  }
}

function isFirstPartyPinterestVideoMediaUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:"
      && parsed.pathname.toLowerCase().endsWith(".mp4")
      && (
        hostname === PINTEREST_PIN_VIDEO_MEDIA_HOST
        || PINTEREST_PIN_VIDEO_MEDIA_HOST_PATTERN.test(hostname)
      );
  } catch {
    return false;
  }
}

function normalizePinterestResponseContentType(contentType: string | undefined): string | undefined {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isLikelyMp4Bytes(bytes: Buffer): boolean {
  return bytes.length >= MP4_FILE_TYPE_BOX_MIN_BYTES
    && bytes.subarray(MP4_FILE_TYPE_BOX_MARKER_START, MP4_FILE_TYPE_BOX_MARKER_END).toString("ascii") === MP4_FILE_TYPE_BOX_MARKER;
}

function isCompatiblePinterestVideoContentType(contentType: string | undefined): boolean {
  return !contentType
    || contentType === PINTEREST_PIN_MEDIA_VIDEO_CONTENT_TYPE
    || PINTEREST_PIN_MEDIA_GENERIC_BINARY_CONTENT_TYPES.has(contentType);
}

function isCompatiblePinterestImageContentType(contentType: string | undefined): boolean {
  return !contentType
    || PINTEREST_PIN_MEDIA_GENERIC_BINARY_CONTENT_TYPES.has(contentType)
    || (isPinterestPinMediaEvidenceContentType(contentType) && contentType.startsWith("image/"));
}

function assertFetchedPinterestCandidateMatchesKind(
  candidate: PinterestPinMediaDomCandidate,
  fetched: { bytes: Buffer; finalUrl: string; contentType?: string }
): void {
  const contentType = normalizePinterestResponseContentType(fetched.contentType);
  if (candidate.kind === "video") {
    if (!isFirstPartyPinterestVideoMediaUrl(fetched.finalUrl)) {
      throw new Error("Pinterest pin media video fetch returned a non-MP4 final URL.");
    }
    if (!isCompatiblePinterestVideoContentType(contentType)) {
      throw new Error("Pinterest pin media video fetch returned non-MP4 content.");
    }
    if (!isLikelyMp4Bytes(fetched.bytes)) {
      throw new Error("Pinterest pin media video fetch returned bytes without an MP4 file type box.");
    }
    return;
  }
  if (!isCompatiblePinterestImageContentType(contentType)) {
    throw new Error("Pinterest pin media image fetch returned non-image content.");
  }
  const byteInspection = inspectPinterestPinMediaBuffer(fetched.bytes);
  if (!byteInspection.contentType?.startsWith("image/")) {
    throw new Error("Pinterest pin media image fetch returned bytes without an image signature.");
  }
  if (contentType && !PINTEREST_PIN_MEDIA_GENERIC_BINARY_CONTENT_TYPES.has(contentType) && contentType !== byteInspection.contentType) {
    throw new Error("Pinterest pin media image fetch returned bytes that do not match the response content type.");
  }
}

function pinterestCandidateArea(candidate: PinterestPinMediaDomCandidate): number {
  const width = candidate.width ?? candidate.naturalWidth ?? candidate.rect?.width ?? 0;
  const height = candidate.height ?? candidate.naturalHeight ?? candidate.rect?.height ?? 0;
  return width * height;
}

function summarizeRejectedPinterestCandidate(
  candidate: PinterestPinMediaDomCandidate,
  reasons: string[]
): BrowserPinterestPinMediaRejectedCandidate {
  return {
    kind: candidate.kind,
    ...(candidate.mediaUrl ? { mediaUrl: candidate.mediaUrl } : {}),
    ...(candidate.candidateSelector ? { candidateSelector: candidate.candidateSelector } : {}),
    ...(candidate.candidateRole ? { candidateRole: candidate.candidateRole } : {}),
    ...(candidate.alt ? { alt: candidate.alt } : {}),
    ...(candidate.width ? { width: candidate.width } : {}),
    ...(candidate.height ? { height: candidate.height } : {}),
    ...(candidate.rect ? { rect: candidate.rect } : {}),
    ancestry: candidate.ancestry.slice(0, 6),
    reasons
  };
}

function rejectionReasonsForPinterestCandidate(
  candidate: PinterestPinMediaDomCandidate,
  sourcePinId: string | undefined
): string[] {
  const reasons: string[] = [];
  if (!isFirstPartyPinterestMediaUrl(candidate.mediaUrl)) {
    reasons.push("non_first_party_media_url");
  }
  if (!candidate.visible) {
    reasons.push("not_visible");
  }
  const width = candidate.width ?? candidate.naturalWidth ?? candidate.rect?.width ?? 0;
  const height = candidate.height ?? candidate.naturalHeight ?? candidate.rect?.height ?? 0;
  if (width < PINTEREST_PIN_MEDIA_MIN_EDGE_PX || height < PINTEREST_PIN_MEDIA_MIN_EDGE_PX) {
    reasons.push("media_too_small");
  }
  if (!sourcePinId) {
    reasons.push("missing_source_pin_id");
  }
  if (sourcePinId && candidate.linkedPinId && candidate.linkedPinId !== sourcePinId) {
    reasons.push("linked_to_different_pin");
  }
  if (sourcePinId && !candidate.linkedPinId && !candidate.insideCanonicalMainPinMediaContainer) {
    reasons.push("missing_pin_source_proof");
  }
  const noiseHasCanonicalSourceProof = Boolean(
    candidate.insideCanonicalMainPinMediaContainer
    && sourcePinId
    && (!candidate.linkedPinId || candidate.linkedPinId === sourcePinId)
  );
  if (candidate.noiseSignals.length > 0 && !noiseHasCanonicalSourceProof) {
    reasons.push(`noise_ancestry:${candidate.noiseSignals[0]}`);
  }
  return reasons;
}

function selectPinterestPinMediaCandidate(
  extraction: PinterestPinMediaDomExtraction,
  pageUrl: string
): PinterestPinMediaSelection {
  const sourcePinId = extractPinterestPinId(pageUrl);
  const accepted: PinterestPinMediaDomCandidate[] = [];
  const rejected: BrowserPinterestPinMediaRejectedCandidate[] = [];
  for (const candidate of extraction.candidates) {
    const reasons = rejectionReasonsForPinterestCandidate(candidate, sourcePinId);
    if (reasons.length === 0) {
      accepted.push(candidate);
    } else if (rejected.length < PINTEREST_PIN_MEDIA_REJECTION_LIMIT) {
      rejected.push(summarizeRejectedPinterestCandidate(candidate, reasons));
    }
  }
  accepted.sort((left, right) => {
    const scoreDelta = right.score - left.score;
    return scoreDelta !== 0 ? scoreDelta : pinterestCandidateArea(right) - pinterestCandidateArea(left);
  });
  return { selected: accepted[0], acceptedCandidates: accepted, rejectedCandidates: rejected };
}

function warningsForSelectedPinterestCandidate(candidate: PinterestPinMediaDomCandidate): string[] {
  const warnings = new Set<string>();
  for (const signal of candidate.noiseSignals) {
    warnings.add(signal === "shopping" ? "pin_media_noise:ad_shopping" : `pin_media_noise:${signal}`);
  }
  return Array.from(warnings);
}

function pinterestCandidateCaptureFailureReason(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "selected_candidate_fetch_failed:aborted";
  return "selected_candidate_fetch_failed";
}

function clampPinterestPinMediaOperationTimeout(timeoutMs: number, maxTimeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return maxTimeoutMs;
  }
  return Math.max(1, Math.min(timeoutMs, maxTimeoutMs));
}

function isPinterestPinMediaDomInspectionTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Pinterest pin media DOM inspection timed out");
}

function parsePinterestPinMediaCdpExtraction(
  result: PinterestPinMediaCdpEvaluationResult
): PinterestPinMediaDomExtraction {
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(detail ?? "Pinterest pin media CDP inspection failed.");
  }
  const value = result.result?.value as PinterestPinMediaDomExtraction | undefined;
  if (!value || typeof value.sourceUrl !== "string" || !Array.isArray(value.candidates)) {
    throw new Error("Pinterest pin media CDP inspection returned an invalid result.");
  }
  return value;
}

async function withBrowserOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function withPinterestPinMediaOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return await withBrowserOperationTimeout(operation, timeoutMs, message);
}

function createPinterestPinMediaRemainingTimeout(timeoutMs: number | undefined): () => number {
  const budgetMs = typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
    ? Math.max(1, timeoutMs)
    : PINTEREST_PIN_MEDIA_DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let firstRead = true;
  return () => {
    if (firstRead) {
      firstRead = false;
      return budgetMs;
    }
    return Math.max(1, budgetMs - Math.max(0, Date.now() - startedAt));
  };
}

function detachPinterestPinMediaCdpSession(session: CDPSession): void {
  void withPinterestPinMediaOperationTimeout(
    session.detach(),
    PINTEREST_PIN_MEDIA_CDP_DETACH_MAX_TIMEOUT_MS,
    `Pinterest pin media CDP session detach timed out after ${PINTEREST_PIN_MEDIA_CDP_DETACH_MAX_TIMEOUT_MS}ms.`
  ).catch(() => undefined);
}

function readPinterestPinMediaCandidatesInPage(): PinterestPinMediaDomExtraction {
  const maxCandidates = 30;
  const ancestryLimit = 6;
  const selectors = [
    "img.closeup-image-main-MainPinImage",
    "img[class*='closeup-image-main-MainPinImage']",
    "img[elementtiming='closeup-image-main-MainPinImage']",
    "img[elementtiming='StoryPinImageBlock-MainPinImage']",
    "img.StoryPinImageBlock-MainPinImage",
    "img[class*='StoryPinImageBlock-MainPinImage']",
    "[data-test-id='closeup-image-main'] img",
    "[data-test-id='closeup-image'] img",
    "[id^='closeup-image-container-'] img",
    "[class*='closeup-image-main-MainPinImage'] img",
    "[class*='StoryPinImageBlock-MainPinImage'] img",
    "video",
    "video[poster]",
    "[data-test-id*='pin'] video",
    "[data-test-id*='pin'] video[poster]",
    "[data-test-id*='closeup'] video",
    "[data-test-id*='closeup'] video[poster]"
  ];
  const elements: Element[] = [];
  const seen = new Set<Element>();
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll(selector))) {
      if (!seen.has(element) && elements.length < maxCandidates) {
        seen.add(element);
        elements.push(element);
      }
    }
  }
  const describeElement = (element: Element): string => {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id.slice(0, 48)}` : "";
    const classes = Array.from(element.classList).slice(0, 4).map((value) => `.${value.slice(0, 48)}`).join("");
    const testId = element.getAttribute("data-test-id");
    const role = element.getAttribute("role");
    return [tag + id + classes, testId ? `data-test-id=${testId.slice(0, 80)}` : "", role ? `role=${role}` : ""]
      .filter(Boolean)
      .join(" ");
  };
  const ancestryFor = (element: Element): { ancestry: string[]; combined: string } => {
    const ancestry: string[] = [];
    let current: Element | null = element;
    while (current && ancestry.length < ancestryLimit) {
      ancestry.push(describeElement(current));
      current = current.parentElement;
    }
    return { ancestry, combined: ancestry.join(" ").toLowerCase() };
  };
  const readPinId = (element: Element): string | undefined => {
    const link = element.closest("a[href*='/pin/']");
    const href = link?.getAttribute("href") ?? "";
    const match = href.match(/\/pin\/(\d+)/i);
    return match?.[1];
  };
  const mainPinMediaContainerSelector = [
      "[data-test-id='pin-closeup']",
      "[data-test-id='story-pin']",
      "[data-test-id='story-pin-image-block']",
      "[data-test-id='story-pin-video-block']",
      "[data-test-id='closeup-layout']",
      "[data-test-id='closeup-image']",
      "[data-test-id='closeup-image-main']",
      "[data-test-id='pdp-container']",
      "[data-test-id='pin-closeup-image']",
      "[data-test-id='pin-closeup-image-container']",
      "[data-test-id='visual-content-container']"
    ].join(",");
  const storyPinBlockSelector = [
    "[data-test-id='story-pin-image-block']",
    "[data-test-id='story-pin-video-block']"
  ].join(",");
  const strongMainPinRootSelector = [
    "[data-test-id='pin-closeup']",
    "[data-test-id='story-pin']",
    "[data-test-id='closeup-layout']",
    "[data-test-id='pdp-container']",
    "[data-test-id='visual-content-container']"
  ].join(",");
  const hasNoisyWrapperBeforeStrongPinRoot = (container: Element): boolean => {
    let current = container.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      if (current.matches(strongMainPinRootSelector)) return false;
      if (readNoiseSignals(describeElement(current).toLowerCase()).length > 0) return true;
      current = current.parentElement;
    }
    return false;
  };
  const isInsideCanonicalMainPinMediaContainer = (element: Element): boolean => {
    const container = element.closest(mainPinMediaContainerSelector);
    if (!container) {
      return false;
    }
    if (container.matches(storyPinBlockSelector) && hasNoisyWrapperBeforeStrongPinRoot(container)) {
      return false;
    }
    let current: Element | null = element;
    while (current && current !== container) {
      if (readNoiseSignals(describeElement(current).toLowerCase()).length > 0) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  };
  const hasDelimitedNoiseToken = (combined: string, token: string): boolean => (
    new RegExp(`(^|[^a-z0-9])${token}($|[^a-z0-9])`).test(combined)
  );
  const readNoiseSignals = (combined: string): string[] => {
    const signals: string[] = [];
    const checks = [
      [(value: string) => value.includes("related"), "related"],
      [(value: string) => value.includes("recommend"), "recommendation"],
      [(value: string) => value.includes("rail"), "rail"],
      [(value: string) => value.includes("carousel"), "carousel"],
      [(value: string) => value.includes("grid"), "grid"],
      [(value: string) => value.includes("search"), "search"],
      [(value: string) => value.includes("avatar"), "avatar"],
      [(value: string) => value.includes("profile"), "profile"],
      [(value: string) => value.includes("comment"), "comment"],
      [(value: string) => hasDelimitedNoiseToken(value, "ad") || hasDelimitedNoiseToken(value, "ads"), "ad"],
      [(value: string) => value.includes("promoted"), "ad"],
      [(value: string) => value.includes("sponsor"), "ad"],
      [(value: string) => value.includes("shopping"), "shopping"],
      [(value: string) => value.includes("shop"), "shopping"],
      [(value: string) => value.includes("thumbnail"), "thumbnail"],
      [(value: string) => value.includes("thumb"), "thumbnail"]
    ] as const;
    for (const [matches, signal] of checks) {
      if (matches(combined) && !signals.includes(signal)) {
        signals.push(signal);
      }
    }
    return signals;
  };
  const readRect = (element: Element): BrowserPinterestPinMediaRect => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const isVisible = (element: Element, rect: BrowserPinterestPinMediaRect): boolean => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };
  const pickSrcsetUrl = (srcset: string): string | undefined => {
    const entries = srcset.split(",").map((entry) => entry.trim()).filter(Boolean);
    const last = entries.at(-1);
    return last?.split(/\s+/)[0];
  };
  const isFirstPartyPinterestVideoHost = (hostname: string): boolean => (
    hostname === "v.pinimg.com" || /^v\d+(?:-[a-z]+)?\.pinimg\.com$/i.test(hostname)
  );
  const isFirstPartyPinterestVideoUrl = (value: string | undefined): boolean => {
    if (!value) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:"
        && isFirstPartyPinterestVideoHost(parsed.hostname.toLowerCase())
        && parsed.pathname.toLowerCase().endsWith(".mp4");
    } catch {
      return false;
    }
  };
  const derivePinterestMp4UrlFromHls = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    try {
      const parsed = new URL(value);
      const hostname = parsed.hostname.toLowerCase();
      if (parsed.protocol !== "https:" || !isFirstPartyPinterestVideoHost(hostname)) {
        return undefined;
      }
      const match = parsed.pathname.match(/^\/videos\/([^/]+)\/hls\/([a-f0-9]{2})\/([a-f0-9]{2})\/([a-f0-9]{2})\/([a-f0-9]{16,})(?=$|[._/])/i);
      if (!match) return undefined;
      const [, lane, first, second, third, digest] = match;
      parsed.pathname = `/videos/${lane}/720p/${first}/${second}/${third}/${digest}.mp4`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return undefined;
    }
  };
  const readPinterestVideoUrl = (value: string | undefined): string | undefined => (
    isFirstPartyPinterestVideoUrl(value) ? value : derivePinterestMp4UrlFromHls(value)
  );
  const readPinterestVideoDigest = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    try {
      const parsed = new URL(value);
      const match = parsed.pathname.match(/\/videos\/[^/]+\/(?:720p|hls|expMp4)\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{16,})(?:_\d+w)?/i);
      return match?.[1]?.toLowerCase();
    } catch {
      return undefined;
    }
  };
  const posterReferencesVideoDigest = (poster: string | undefined, digest: string | undefined): boolean => {
    if (!poster || !digest) return false;
    try {
      const parsed = new URL(poster);
      const posterPath = parsed.pathname.toLowerCase().replace(/[^a-f0-9]/g, "");
      return posterPath.includes(digest);
    } catch {
      return false;
    }
  };
  const readVideoSignature = (video: HTMLVideoElement): string | undefined => (
    video.closest("[data-video-signature]")?.getAttribute("data-video-signature")?.toLowerCase()
  );
  const videoSignatureMatchesDigest = (video: HTMLVideoElement, digest: string | undefined): boolean => (
    Boolean(digest && readVideoSignature(video) === digest)
  );
  const readVideoObjectPosterUrl = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.find((entry): entry is string => typeof entry === "string");
    }
    return undefined;
  };
  const readVideoObjectDimension = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return undefined;
    const match = value.match(/\d+(?:\.\d+)?/u);
    const parsed = match ? Number(match[0]) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const isStructuredVideoObject = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const type = (value as Record<string, unknown>)["@type"];
    return type === "VideoObject" || (Array.isArray(type) && type.includes("VideoObject"));
  };
  const collectStructuredVideoObjects = (
    value: unknown,
    videoObjects: Array<Record<string, unknown>>,
    depth = 0
  ): void => {
    if (depth > 4) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        collectStructuredVideoObjects(entry, videoObjects, depth + 1);
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    if (isStructuredVideoObject(value)) {
      videoObjects.push(value);
      return;
    }
    const graph = (value as Record<string, unknown>)["@graph"];
    if (graph) {
      collectStructuredVideoObjects(graph, videoObjects, depth + 1);
    }
  };
  const readStructuredVideoObjects = (): Array<Record<string, unknown>> => {
    const videoObjects: Array<Record<string, unknown>> = [];
    for (const script of Array.from(document.querySelectorAll("script[type='application/ld+json']"))) {
      try {
        const parsed = JSON.parse(script.textContent ?? "");
        collectStructuredVideoObjects(parsed, videoObjects);
      } catch {
        // Ignore non-JSON or partially rendered structured data.
      }
    }
    return videoObjects;
  };
  const findUnambiguousVideoElementForDigest = (digest: string | undefined): HTMLVideoElement | undefined => {
    const matches = Array.from(document.querySelectorAll("video"))
      .filter((video) => {
        const poster = video.poster || video.getAttribute("poster") || undefined;
        return isVisible(video, readRect(video))
          && isInsideCanonicalMainPinMediaContainer(video)
          && (posterReferencesVideoDigest(poster, digest) || videoSignatureMatchesDigest(video, digest));
      });
    return matches.length === 1 ? matches[0] : undefined;
  };
  const buildScriptVideoCandidate = (
    mediaUrl: string,
    matchedVideo: HTMLVideoElement,
    poster: string | undefined,
    candidateSelector: string,
    positiveSignal: string,
    baseScore: number,
    dimensions?: { width?: number; height?: number }
  ): PinterestPinMediaDomCandidate => {
    const rect = readRect(matchedVideo);
    const { ancestry, combined } = ancestryFor(matchedVideo);
    return {
      kind: "video",
      mediaUrl,
      poster,
      candidateSelector,
      candidateRole: matchedVideo.getAttribute("role") ?? matchedVideo.closest("[role]")?.getAttribute("role") ?? undefined,
      width: dimensions?.width ?? matchedVideo.videoWidth ?? rect.width,
      height: dimensions?.height ?? matchedVideo.videoHeight ?? rect.height,
      rect,
      visible: isVisible(matchedVideo, rect),
      ancestry,
      linkedPinId: readPinId(matchedVideo),
      positiveSignals: [positiveSignal],
      noiseSignals: readNoiseSignals(combined),
      insideCanonicalMainPinMediaContainer: isInsideCanonicalMainPinMediaContainer(matchedVideo),
      score: baseScore + rect.width * rect.height / 10000
    };
  };
  const readStructuredVideoCandidates = (): PinterestPinMediaDomCandidate[] => (
    readStructuredVideoObjects().flatMap((videoObject): PinterestPinMediaDomCandidate[] => {
      const contentUrl = typeof videoObject.contentUrl === "string" ? videoObject.contentUrl : undefined;
      const mediaUrl = readPinterestVideoUrl(contentUrl);
      const digest = readPinterestVideoDigest(mediaUrl);
      const metadataPoster = readVideoObjectPosterUrl(videoObject.thumbnailUrl);
      const matchedVideo = findUnambiguousVideoElementForDigest(digest);
      if (!mediaUrl || !digest || !matchedVideo) return [];
      const poster = metadataPoster || matchedVideo.poster || matchedVideo.getAttribute("poster") || undefined;
      return [buildScriptVideoCandidate(
        mediaUrl,
        matchedVideo,
        poster,
        "script[type='application/ld+json'][VideoObject]",
        "video[structured-data]",
        260,
        {
          width: readVideoObjectDimension(videoObject.width),
          height: readVideoObjectDimension(videoObject.height)
        }
      )];
    })
  );
  const embeddedVideoScriptKeyPattern = /videoUrls|videoDataV2|videoList720P|videoList|v720P/iu;
  const embeddedVideoScriptKeySearchPattern = /videoUrls|videoDataV2|videoList720P|videoList|v720P/giu;
  const embeddedVideoUrlPattern = /https:\/\/v\d*(?:-[a-z]+)?\.pinimg\.com\/videos\/[^"'<>\s\\]+?(?:\.mp4|\.m3u8)(?:\?[^"'<>\s\\]*)?/giu;
  const embeddedVideoScriptMaxCount = 16;
  const embeddedVideoScriptMaxChars = 180000;
  const embeddedVideoScriptWindowChars = 20000;
  const readBoundedEmbeddedVideoScriptText = (scriptText: string): string => {
    if (scriptText.length <= embeddedVideoScriptMaxChars) return scriptText;
    const chunks: string[] = [];
    let totalChars = 0;
    for (const match of scriptText.matchAll(embeddedVideoScriptKeySearchPattern)) {
      const center = match.index ?? 0;
      const start = Math.max(0, center - embeddedVideoScriptWindowChars);
      const end = Math.min(scriptText.length, center + embeddedVideoScriptWindowChars);
      const remainingChars = embeddedVideoScriptMaxChars - totalChars;
      if (remainingChars <= 0) break;
      const chunk = scriptText.slice(start, end).slice(0, remainingChars);
      chunks.push(chunk);
      totalChars += chunk.length;
    }
    return chunks.join("\n");
  };
  const normalizeEmbeddedVideoScriptText = (scriptText: string): string => (
    scriptText
      .replace(new RegExp("\\\\u003[aA]", "g"), ":")
      .replace(new RegExp("\\\\u002[fF]", "g"), "/")
      .replace(new RegExp("\\\\/", "g"), "/")
  );
  const readEmbeddedVideoUrls = (): string[] => {
    const urls: string[] = [];
    const scripts = Array.from(document.querySelectorAll("script:not([src])"));
    let inspectedScriptCount = 0;
    for (const script of scripts) {
      const scriptText = script.textContent ?? "";
      if (!embeddedVideoScriptKeyPattern.test(scriptText)) continue;
      inspectedScriptCount += 1;
      if (inspectedScriptCount > embeddedVideoScriptMaxCount) break;
      const boundedText = normalizeEmbeddedVideoScriptText(readBoundedEmbeddedVideoScriptText(scriptText));
      for (const match of boundedText.matchAll(embeddedVideoUrlPattern)) {
        const mediaUrl = readPinterestVideoUrl(match[0]);
        if (mediaUrl) urls.push(mediaUrl);
      }
    }
    const seen = new Set<string>();
    return urls.filter((mediaUrl) => {
      if (seen.has(mediaUrl)) return false;
      seen.add(mediaUrl);
      return true;
    });
  };
  const readEmbeddedVideoCandidates = (): PinterestPinMediaDomCandidate[] => (
    readEmbeddedVideoUrls().flatMap((mediaUrl): PinterestPinMediaDomCandidate[] => {
      const digest = readPinterestVideoDigest(mediaUrl);
      const video = findUnambiguousVideoElementForDigest(digest);
      if (!digest || !video) return [];
      const poster = video.poster || video.getAttribute("poster") || undefined;
      if (!posterReferencesVideoDigest(poster, digest) && !videoSignatureMatchesDigest(video, digest)) return [];
      return [buildScriptVideoCandidate(
        mediaUrl,
        video,
        poster,
        "script[pinterest-video-json]",
        "video[embedded-data]",
        255
      )];
    })
  );
  const readResourceVideoUrls = (): string[] => {
    const entries = window.performance?.getEntriesByType?.("resource") ?? [];
    const urls = entries
      .map((entry) => readPinterestVideoUrl("name" in entry ? String(entry.name) : undefined))
      .filter((value): value is string => Boolean(value));
    return Array.from(new Set(urls));
  };
  const isBlobBackedVisibleCanonicalVideo = (video: HTMLVideoElement): boolean => {
    const mediaSourceUrl = video.currentSrc || video.src;
    return mediaSourceUrl.startsWith(`blob:${window.location.origin}`)
      && isVisible(video, readRect(video))
      && isInsideCanonicalMainPinMediaContainer(video);
  };
  const hasUniqueBlobBackedVideoSignatureMatch = (digest: string | undefined): boolean => (
    Boolean(digest) && Array.from(document.querySelectorAll("video"))
      .filter((candidate) => isBlobBackedVisibleCanonicalVideo(candidate)
        && videoSignatureMatchesDigest(candidate, digest)).length === 1
  );
  const readScopedResourceVideoUrl = (video: HTMLVideoElement): string | undefined => {
    if (!isBlobBackedVisibleCanonicalVideo(video)) return undefined;
    const urls = readResourceVideoUrls();
    const posterMatchedUrls = urls.filter((value) => posterReferencesVideoDigest(video.poster, readPinterestVideoDigest(value)));
    if (posterMatchedUrls.length === 1) return posterMatchedUrls[0];
    const signatureMatchedUrls = urls.filter((value) => {
      const digest = readPinterestVideoDigest(value);
      return videoSignatureMatchesDigest(video, digest) && hasUniqueBlobBackedVideoSignatureMatch(digest);
    });
    if (signatureMatchedUrls.length === 1) return signatureMatchedUrls[0];
    return undefined;
  };
  const readVideoSourceUrl = (video: HTMLVideoElement): string | undefined => {
    const candidateUrls = [video.currentSrc, video.src];
    for (const source of Array.from(video.querySelectorAll("source"))) {
      const sourceUrl = source.src || source.getAttribute("src");
      candidateUrls.push(sourceUrl ?? "");
    }
    const firstPartyDirectUrl = candidateUrls.map(readPinterestVideoUrl).find(Boolean);
    if (firstPartyDirectUrl) return firstPartyDirectUrl;
    return candidateUrls.find(Boolean);
  };
  const candidates = elements.flatMap((element): PinterestPinMediaDomCandidate[] => {
    const tag = element.tagName.toLowerCase();
    const rect = readRect(element);
    const { ancestry, combined } = ancestryFor(element);
    const classText = (element.getAttribute("class") ?? "").toLowerCase();
    const positiveSignals = [
      classText.includes("closeup-image-main-mainpinimage") ? "closeup-image-main-MainPinImage" : "",
      element.getAttribute("elementtiming") === "closeup-image-main-MainPinImage" ? "closeup-image-main-MainPinImage" : "",
      classText.includes("storypinimageblock-mainpinimage") ? "StoryPinImageBlock-MainPinImage" : "",
      element.getAttribute("elementtiming") === "StoryPinImageBlock-MainPinImage" ? "StoryPinImageBlock-MainPinImage" : "",
      tag === "video" ? "video" : "",
      tag === "video" && element.hasAttribute("poster") ? "video[poster]" : ""
    ].filter(Boolean);
    if (tag === "video") {
      const video = element as HTMLVideoElement;
      const sharedVideoCandidate = {
        poster: video.poster || undefined,
        candidateRole: element.getAttribute("role") ?? element.closest("[role]")?.getAttribute("role") ?? undefined,
        width: video.videoWidth || rect.width,
        height: video.videoHeight || rect.height,
        rect,
        visible: isVisible(element, rect),
        ancestry,
        linkedPinId: readPinId(element),
        noiseSignals: readNoiseSignals(combined),
        insideCanonicalMainPinMediaContainer: isInsideCanonicalMainPinMediaContainer(element)
      };
      const videoCandidates: PinterestPinMediaDomCandidate[] = [];
      const videoSourceUrl = readVideoSourceUrl(video);
      const videoSourceIsDirect = videoSourceUrl ? Boolean(readPinterestVideoUrl(videoSourceUrl)) : false;
      const scopedResourceVideoUrl = !videoSourceIsDirect
        && sharedVideoCandidate.visible
        && sharedVideoCandidate.insideCanonicalMainPinMediaContainer
        ? readScopedResourceVideoUrl(video)
        : undefined;
      if (scopedResourceVideoUrl) {
        videoCandidates.push({
          ...sharedVideoCandidate,
          kind: "video",
          mediaUrl: scopedResourceVideoUrl,
          candidateSelector: "video[resource]",
          positiveSignals: [...positiveSignals, "video[resource]"],
          score: positiveSignals.length * 100 + 245 + rect.width * rect.height / 10000
        });
      }
      if (videoSourceUrl) {
        videoCandidates.push({
          ...sharedVideoCandidate,
          kind: "video",
          mediaUrl: videoSourceUrl,
          candidateSelector: "video",
          positiveSignals: [...positiveSignals, "video[source]"],
          score: positiveSignals.length * 100 + 250 + rect.width * rect.height / 10000
        });
      }
      if (video.poster) {
        videoCandidates.push({
          ...sharedVideoCandidate,
          kind: "video_poster",
          mediaUrl: video.poster,
          candidateSelector: "video[poster]",
          positiveSignals,
          score: positiveSignals.length * 100 + rect.width * rect.height / 10000
        });
      }
      return videoCandidates;
    }
    const image = tag === "img" ? element as HTMLImageElement : element.querySelector("img");
    if (!image) {
      return [];
    }
    const imageRect = tag === "img" ? rect : readRect(image);
    const srcset = image.getAttribute("srcset") ?? undefined;
    const mediaUrl = image.currentSrc || image.src || pickSrcsetUrl(srcset ?? "");
    return [{
      kind: "image",
      mediaUrl,
      srcset,
      candidateSelector: positiveSignals[0] ?? describeElement(image),
      candidateRole: image.getAttribute("role") ?? image.closest("[role]")?.getAttribute("role") ?? undefined,
      alt: image.getAttribute("alt") ?? undefined,
      width: image.naturalWidth || imageRect.width,
      height: image.naturalHeight || imageRect.height,
      naturalWidth: image.naturalWidth || undefined,
      naturalHeight: image.naturalHeight || undefined,
      rect: imageRect,
      visible: isVisible(image, imageRect),
      ancestry,
      linkedPinId: readPinId(image),
      positiveSignals,
      noiseSignals: readNoiseSignals(combined),
      insideCanonicalMainPinMediaContainer: isInsideCanonicalMainPinMediaContainer(image),
      score: positiveSignals.length * 100 + imageRect.width * imageRect.height / 10000
    }];
  });
  return {
    sourceUrl: document.URL,
    candidates: [
      ...readStructuredVideoCandidates(),
      ...readEmbeddedVideoCandidates(),
      ...candidates
    ]
  };
}

const DOM_GET_ATTR_DECLARATION = `
  function(name) {
    /* odb-dom-get-attr */
    if (!(this instanceof Element)) return null;
    const value = this.getAttribute(name);
    return value === null ? null : String(value);
  }
`;

const DOM_GET_VALUE_DECLARATION = `
  function() {
    /* odb-dom-get-value */
    if (
      this instanceof HTMLInputElement
      || this instanceof HTMLTextAreaElement
      || this instanceof HTMLSelectElement
    ) {
      return this.value;
    }
    const value = this instanceof Element ? this.getAttribute("value") : null;
    return typeof value === "string" ? value : "";
  }
`;

const DOM_IS_VISIBLE_DECLARATION = `
  function() {
    /* odb-dom-is-visible */
    if (!(this instanceof Element)) return false;
    const style = window.getComputedStyle(this);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = this.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
`;

const DOM_IS_ENABLED_DECLARATION = `
  function() {
    /* odb-dom-is-enabled */
    if (!(this instanceof Element)) return false;
    if (this.hasAttribute("disabled")) return false;
    if (this.getAttribute("aria-disabled") === "true") return false;
    return true;
  }
`;

const DOM_IS_CHECKED_DECLARATION = `
  function() {
    /* odb-dom-is-checked */
    if (this instanceof HTMLInputElement && (this.type === "checkbox" || this.type === "radio")) {
      return this.checked;
    }
    if (!(this instanceof Element)) return false;
    return this.getAttribute("aria-checked") === "true";
  }
`;

const DOM_SELECTOR_STATE_DECLARATION = `
  function() {
    /* odb-dom-selector-state */
    if (!(this instanceof Element)) {
      return { attached: false, visible: false };
    }
    const style = window.getComputedStyle(this);
    const rect = this.getBoundingClientRect();
    return {
      attached: true,
      visible: Boolean(style && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0)
    };
  }
`;

const DOM_OUTER_HTML_DECLARATION = `
  function() {
    /* odb-dom-outer-html */
    if (!(this instanceof Element)) return "";
    return this.outerHTML;
  }
`;

const DOM_INNER_TEXT_DECLARATION = `
  function() {
    /* odb-dom-inner-text */
    if (!(this instanceof Element)) return "";
    return this instanceof HTMLElement ? (this.innerText || this.textContent || "") : (this.textContent || "");
  }
`;

const DOM_HOVER_DECLARATION = `
  function() {
    /* odb-dom-hover */
    if (!(this instanceof Element)) return;
    const init = { bubbles: true, cancelable: true, view: window };
    this.dispatchEvent(new MouseEvent("mouseenter", init));
    this.dispatchEvent(new MouseEvent("mouseover", init));
    this.dispatchEvent(new MouseEvent("mousemove", init));
  }
`;

const DOM_FOCUS_DECLARATION = `
  function() {
    /* odb-dom-focus */
    if (this instanceof HTMLElement) {
      this.focus();
    }
  }
`;

const DOM_SET_CHECKED_DECLARATION = `
  function(checked) {
    /* odb-dom-set-checked */
    if (this instanceof HTMLInputElement && (this.type === "checkbox" || this.type === "radio")) {
      this.checked = Boolean(checked);
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (this instanceof Element) {
      this.setAttribute("aria-checked", checked ? "true" : "false");
    }
  }
`;

const DOM_TYPE_DECLARATION = `
  function(value, clear, submit) {
    /* odb-dom-type */
    if (!(this instanceof Element)) return;
    if (this instanceof HTMLElement) {
      this.focus();
    }
    if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
      this.value = clear ? "" : this.value;
      this.value = String(value);
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      if (submit) {
        this.form?.requestSubmit?.();
      }
      return;
    }
    if (this instanceof HTMLSelectElement) {
      this.value = String(value);
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
`;

const DOM_SELECT_DECLARATION = `
  function(values) {
    /* odb-dom-select */
    if (!(this instanceof HTMLSelectElement)) return;
    const nextValues = Array.isArray(values) ? values.map((value) => String(value)) : [];
    for (const option of Array.from(this.options)) {
      option.selected = nextValues.includes(option.value);
    }
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }
`;

const DOM_SCROLL_BY_DECLARATION = `
  function(dy) {
    /* odb-dom-scroll-by */
    if (this instanceof HTMLElement) {
      this.scrollBy(0, Number(dy) || 0);
    }
  }
`;

const DOM_SCROLL_INTO_VIEW_DECLARATION = `
  function() {
    /* odb-dom-scroll-into-view */
    if (this instanceof Element) {
      this.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    }
  }
`;

const DOM_REF_POINT_DECLARATION = `
  function() {
    /* odb-dom-ref-point */
    if (!(this instanceof Element)) return null;
    const rect = this.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }
`;

const DOM_SCREENSHOT_CLIP_DECLARATION = `
  function() {
    /* odb-dom-screenshot-clip */
    if (!(this instanceof Element)) return null;
    const rect = this.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    };
  }
`;

const DOM_FILE_INPUT_INFO_DECLARATION = `
  function() {
    /* odb-dom-file-input-info */
    const isFileInput = this instanceof HTMLInputElement && this.type === "file";
    return {
      isFileInput,
      disabled: isFileInput ? this.disabled : false
    };
  }
`;

type ResolvedManagedRef = {
  targetId: string;
  ref: string;
  selector: string;
  backendNodeId: number;
  snapshotId: string;
  frameId?: string;
};

type PendingManagedDialog = {
  dialog: Dialog;
  state: BrowserDialogState;
};

type PendingManagedClick = {
  dialogOpened: boolean;
  dialogHandled: Promise<void>;
  resolveDialogHandled: () => void;
  completed: Promise<void>;
  resolveCompleted: () => void;
};

const assertPinterestPinMediaByteLimit = (byteLength: number): void => {
  if (byteLength > PINTEREST_PIN_MEDIA_MAX_BYTES) {
    throw new Error(`Pinterest pin media fetch exceeded ${PINTEREST_PIN_MEDIA_MAX_BYTES} bytes.`);
  }
};

const readPinterestPinMediaContentLength = (headers: Headers): number | undefined => {
  const value = headers.get("content-length");
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const isPinterestPinMediaRedirectStatus = (status: number): boolean => (
  status >= HTTP_REDIRECT_STATUS_MIN && status < HTTP_REDIRECT_STATUS_MAX_EXCLUSIVE
);

const readFirstPartyPinterestPinMediaRedirect = (baseUrl: string, location: string | null): string => {
  if (!location) {
    throw new Error("Pinterest pin media fetch redirected without a location header.");
  }
  let redirectedUrl: string;
  try {
    redirectedUrl = new URL(location, baseUrl).href;
  } catch {
    throw new Error("Pinterest pin media fetch redirected to an invalid media URL.");
  }
  if (!isFirstPartyPinterestMediaUrl(redirectedUrl)) {
    throw new Error("Pinterest pin media fetch redirected outside first-party media.");
  }
  return redirectedUrl;
};

const discardPinterestPinMediaResponseBody = async (response: Response): Promise<void> => {
  await response.body?.cancel().catch(() => undefined);
};

const fetchPinterestPinMediaResponse = async (
  mediaUrl: string,
  signal: AbortSignal
): Promise<{ response: Response; finalUrl: string }> => {
  let nextUrl = mediaUrl;
  for (let redirectCount = 0; redirectCount <= PINTEREST_PIN_MEDIA_MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(nextUrl, { signal, redirect: "manual" });
    if (!isPinterestPinMediaRedirectStatus(response.status)) {
      const finalUrl = response.url || nextUrl;
      if (!isFirstPartyPinterestMediaUrl(finalUrl)) {
        await discardPinterestPinMediaResponseBody(response);
        throw new Error("Pinterest pin media fetch redirected outside first-party media.");
      }
      return { response, finalUrl };
    }
    let redirectedUrl: string;
    try {
      redirectedUrl = readFirstPartyPinterestPinMediaRedirect(nextUrl, response.headers.get("location"));
    } catch (error) {
      await discardPinterestPinMediaResponseBody(response);
      throw error;
    }
    nextUrl = redirectedUrl;
    await discardPinterestPinMediaResponseBody(response);
  }
  throw new Error("Pinterest pin media fetch exceeded the first-party redirect limit.");
};

const readBoundedPinterestPinMediaBytes = async (response: Response): Promise<Buffer> => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Pinterest pin media fetch returned an empty media body.");
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      assertPinterestPinMediaByteLimit(totalBytes);
      chunks.push(Buffer.from(value));
    }
    if (totalBytes === 0) {
      throw new Error("Pinterest pin media fetch returned an empty media body.");
    }
    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
};

const writePinterestPinMediaOutput = async (path: string, bytes: Buffer): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let createdOutput = false;
  let writeFailed = false;
  try {
    handle = await open(path, PINTEREST_PIN_MEDIA_OUTPUT_OPEN_FLAGS, 0o600);
    createdOutput = true;
    await handle.writeFile(bytes);
  } catch {
    writeFailed = createdOutput;
    throw new Error("Pinterest pin media output path could not be opened as a new non-symlink file.");
  } finally {
    await handle?.close().catch(() => undefined);
    if (writeFailed) {
      await unlink(path).catch(() => undefined);
    }
  }
};

export class BrowserManager {
  private store = new SessionStore();
  private sessions = new Map<string, ManagedSession>();
  private sessionParallel = new Map<string, SessionParallelState>();
  private targetQueues = new Map<string, Promise<void>>();
  private dialogSerializers = new Map<string, Mutex>();
  private networkSignalSubscriptions = new Map<string, () => void>();
  private worktree: string;
  private config: OpenDevBrowserConfig;
  private pageListeners = new WeakMap<Page, () => void>();
  private pendingDialogs = new Map<string, PendingManagedDialog>();
  private pendingManagedClicks = new Map<string, PendingManagedClick>();
  private logger = createLogger("browser-manager");
  private readonly challengeCoordinator = new GlobalChallengeCoordinator();
  private challengeOrchestrator?: ChallengeOrchestrator;
  private readonly challengeAutomationSuppression = new Map<string, number>();
  private readonly activeScreencasts = new Map<string, BrowserScreencastRecorder>();
  private readonly completedScreencasts = new Map<string, BrowserScreencastResult>();
  private readonly completedScreencastCleanupTimers = new Map<string, NodeJS.Timeout>();
  private readonly screencastCompletionListeners = new Map<string, Set<(result: BrowserScreencastResult) => void>>();
  private readonly screencastIdsBySession = new Map<string, Set<string>>();
  private readonly screencastIdsByTarget = new Map<string, string>();

  constructor(worktree: string, config: OpenDevBrowserConfig) {
    this.worktree = worktree;
    this.config = config;
  }

  setChallengeOrchestrator(orchestrator?: ChallengeOrchestrator): void {
    this.challengeOrchestrator = orchestrator;
  }

  getSessionChallengeAutomationMode(sessionId: string): ChallengeAutomationMode | undefined {
    return this.sessions.get(sessionId)?.challengeAutomationMode;
  }

  setSessionChallengeAutomationMode(sessionId: string, mode?: ChallengeAutomationMode): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.challengeAutomationMode = mode;
  }

  async inspectChallengePlan(input: {
    sessionId: string;
    targetId?: string | null;
    runMode?: ChallengeAutomationMode;
  }) {
    const challengeConfig = requireChallengeOrchestrationConfig(this.config);
    return inspectChallengePlanFromRuntime({
      handle: this.createChallengeRuntimeHandle(),
      sessionId: input.sessionId,
      targetId: input.targetId,
      config: challengeConfig,
      runMode: input.runMode,
      sessionMode: this.getSessionChallengeAutomationMode(input.sessionId),
      canImportCookies: true
    });
  }

  createChallengeRuntimeHandle(): ChallengeRuntimeHandle {
    return {
      status: (sessionId) => this.withChallengeAutomationSuppressed(sessionId, () => this.status(sessionId)),
      goto: (sessionId, url, waitUntil, timeoutMs, sessionOverride, targetId) => (
        this.withChallengeAutomationSuppressed(
          sessionId,
          () => this.goto(sessionId, url, waitUntil, timeoutMs, sessionOverride, targetId)
        )
      ),
      waitForLoad: (sessionId, until, timeoutMs, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.waitForLoad(sessionId, until, timeoutMs, targetId))
      ),
      snapshot: (sessionId, mode, maxChars, cursor, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.snapshot(sessionId, mode, maxChars, cursor, targetId))
      ),
      click: (sessionId, ref, targetId) => this.withChallengeAutomationSuppressed(sessionId, () => this.click(sessionId, ref, targetId)),
      hover: (sessionId, ref, targetId) => this.withChallengeAutomationSuppressed(sessionId, () => this.hover(sessionId, ref, targetId)),
      press: (sessionId, key, ref, targetId) => this.withChallengeAutomationSuppressed(sessionId, () => this.press(sessionId, key, ref, targetId)),
      type: (sessionId, ref, text, clear, submit, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.type(sessionId, ref, text, clear, submit, targetId))
      ),
      select: (sessionId, ref, values, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.select(sessionId, ref, values, targetId))
      ),
      scroll: (sessionId, dy, ref, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.scroll(sessionId, dy, ref, targetId))
      ),
      pointerMove: (sessionId, x, y, targetId, steps) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.pointerMove(sessionId, x, y, targetId, steps))
      ),
      pointerDown: (sessionId, x, y, targetId, button, clickCount) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.pointerDown(sessionId, x, y, targetId, button, clickCount))
      ),
      pointerUp: (sessionId, x, y, targetId, button, clickCount) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.pointerUp(sessionId, x, y, targetId, button, clickCount))
      ),
      drag: (sessionId, from, to, targetId, steps) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.drag(sessionId, from, to, targetId, steps))
      ),
      resolveRefPoint: (sessionId, ref, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.resolveRefPoint(sessionId, ref, targetId))
      ),
      cookieList: (sessionId, urls) => this.withChallengeAutomationSuppressed(sessionId, () => this.cookieList(sessionId, urls)),
      cookieImport: (sessionId, cookies, replaceExisting) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.cookieImport(sessionId, cookies, replaceExisting))
      ),
      debugTraceSnapshot: (sessionId, options) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.debugTraceSnapshot(sessionId, options))
      )
    };
  }

  createSessionInspector(): SessionInspectorHandle {
    return {
      status: (sessionId) => this.status(sessionId),
      listTargets: (sessionId, includeUrls) => this.listTargets(sessionId, includeUrls),
      consolePoll: (sessionId, sinceSeq, max) => this.consolePoll(sessionId, sinceSeq, max),
      networkPoll: (sessionId, sinceSeq, max) => this.networkPoll(sessionId, sinceSeq, max),
      debugTraceSnapshot: (sessionId, options) => this.debugTraceSnapshot(sessionId, options)
    };
  }

  private async withChallengeAutomationSuppressed<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const current = this.challengeAutomationSuppression.get(sessionId) ?? 0;
    this.challengeAutomationSuppression.set(sessionId, current + 1);
    try {
      return await action();
    } finally {
      const next = (this.challengeAutomationSuppression.get(sessionId) ?? 1) - 1;
      if (next <= 0) {
        this.challengeAutomationSuppression.delete(sessionId);
      } else {
        this.challengeAutomationSuppression.set(sessionId, next);
      }
    }
  }

  private isChallengeAutomationSuppressed(sessionId: string): boolean {
    return (this.challengeAutomationSuppression.get(sessionId) ?? 0) > 0;
  }

  private getParallelState(sessionId: string): SessionParallelState {
    let state = this.sessionParallel.get(sessionId);
    if (state) {
      return state;
    }
    const managed = this.getManaged(sessionId);
    const modeVariant = this.resolveModeVariant(managed);
    const governor = createGovernorState(this.config.parallelism, modeVariant);
    const snapshot: ParallelismGovernorSnapshot = {
      state: governor,
      pressure: "healthy",
      targetCap: governor.effectiveCap,
      waitQueueDepth: 0,
      waitQueueAgeMs: 0
    };
    state = {
      structural: new Mutex(),
      inflight: 0,
      waiters: [],
      waitingByTarget: new Map(),
      governor,
      lastSnapshot: snapshot
    };
    this.sessionParallel.set(sessionId, state);
    return state;
  }

  updateConfig(config: OpenDevBrowserConfig): void {
    this.config = config;
    for (const managed of this.sessions.values()) {
      managed.consoleTracker.setOptions({ showFullConsole: config.devtools.showFullConsole });
      managed.networkTracker.setOptions({ showFullUrls: config.devtools.showFullUrls });
      managed.fingerprint.tier2.enabled = config.fingerprint.tier2.enabled;
      managed.fingerprint.tier2.mode = config.fingerprint.tier2.mode;
      managed.fingerprint.tier3.enabled = config.fingerprint.tier3.enabled;
      managed.fingerprint.tier3.fallbackTier = config.fingerprint.tier3.fallbackTier;
      const state = this.sessionParallel.get(managed.sessionId);
      if (!state) {
        continue;
      }
      const modeVariant = this.resolveModeVariant(managed);
      const next = createGovernorState(config.parallelism, modeVariant);
      state.governor = {
        ...next,
        effectiveCap: Math.max(
          config.parallelism.floor,
          Math.min(state.governor.effectiveCap, next.staticCap)
        ),
        healthyWindows: 0,
        lastSampleAt: 0,
        lastPressure: state.governor.lastPressure
      };
      state.lastSnapshot = {
        state: state.governor,
        pressure: state.governor.lastPressure,
        targetCap: state.governor.effectiveCap,
        waitQueueDepth: state.waiters.length,
        waitQueueAgeMs: 0
      };
      this.wakeWaiters(managed.sessionId);
    }
  }

  async launch(options: LaunchOptions): Promise<BrowserSessionStartResult> {
    this.assertGoogleAuthIntentAllowedForMode("managed", options.googleAuthIntent);
    const resolvedProfile = options.profile ?? this.config.profile;
    const resolvedProfileId = sanitizeSessionProfileId(resolvedProfile);
    const resolvedHeadless = options.headless ?? this.config.headless;
    const persistProfile = options.persistProfile ?? (resolvedHeadless ? false : this.config.persistProfile);
    const cachePaths = await resolveCachePaths(this.worktree, resolvedProfileId);
    const executable = await findChromeExecutable(options.chromePath ?? this.config.chromePath);
    const warnings: string[] = [];

    let executablePath = executable;
    if (!executablePath) {
      const download = await downloadChromeForTesting(cachePaths.chromeDir);
      warnings.push("System Chrome not found. Downloaded Chrome for Testing.");
      executablePath = download.executablePath;
    }

    const profileDir = persistProfile
      ? cachePaths.profileDir
      : join(cachePaths.projectRoot, "temp-profiles", randomUUID());

    await mkdir(profileDir, { recursive: true });

    let context: BrowserContext | null = null;
    const sessionId = randomUUID();
    const profileRegistry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
    const managedLease = persistProfile
      ? profileRegistry.acquireLease(resolvedProfileId, {
        pid: process.pid,
        launchTokenId: sessionId,
        acquiredAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString()
      })
      : undefined;

    try {
      const chromium = await loadChromium();
      context = await chromium.launchPersistentContext(profileDir, {
        headless: resolvedHeadless,
        executablePath: executablePath ?? undefined,
        args: options.flags ?? this.config.flags,
        viewport: null
      });

      const browser = context.browser();
      if (!browser) {
        throw new Error("Browser instance unavailable");
      }
      const sessionProfile = this.createManagedSessionProfileSummary({
        cachePaths,
        profileName: resolvedProfile,
        profileDir,
        persistProfile,
        headless: resolvedHeadless,
        lease: managedLease ?? {
          launchTokenId: sessionId,
          acquiredAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString()
        }
      });
      const authProvenance = this.createInitialAuthProvenance(
        "managed_profile",
        options.googleAuthIntent,
        sessionProfile
      );
      const targets = new TargetManager();
      const pages = context.pages();

      if (pages.length === 0) {
        const page = await context.newPage();
        targets.registerPage(page);
      } else {
        targets.registerExistingPages(pages);
      }

      const initialActiveTargetId = targets.getActiveTargetId();

      const refStore = new RefStore();
      const snapshotter = new Snapshotter(refStore);
      const consoleTracker = new ConsoleTracker(200, { showFullConsole: this.config.devtools.showFullConsole });
      const exceptionTracker = new ExceptionTracker(200);
      const networkTracker = new NetworkTracker(300, { showFullUrls: this.config.devtools.showFullUrls });
      const fingerprint = this.initializeFingerprintState(
        sessionId,
        resolvedProfile,
        options.flags ?? this.config.flags
      );
      warnings.push(...formatTier1Warnings(fingerprint.tier1));

      const managed: ManagedSession = {
        sessionId,
        mode: "managed",
        headless: resolvedHeadless,
        extensionLegacy: false,
        browser,
        context,
        profileDir,
        persistProfile,
        targets,
        refStore,
        snapshotter,
        consoleTracker,
        exceptionTracker,
        networkTracker,
        fingerprint,
        authProvenance
      };

      warnings.push(...await this.bootstrapSystemChromeCookies(managed, {
        executablePath,
        disabled: options.disableSystemCookieBootstrap === true,
        allowGoogleCookieBootstrap: options.allowGoogleCookieBootstrap === true
      }));

      if (options.startUrl && initialActiveTargetId) {
        await this.goto(sessionId, options.startUrl, "load", 30000, { browser, context, targets });
      }

      this.store.add({ id: sessionId, mode: "managed", browser, context });
      this.sessions.set(sessionId, managed);

      this.attachContinuousFingerprintSignals(managed);
      this.attachTrackers(managed);
      this.attachRefInvalidation(managed);
      await this.attachCdpTargetOwnership(managed);

      const wsEndpointProvider = browser as unknown as { wsEndpoint?: () => string };
      const wsEndpoint = typeof wsEndpointProvider.wsEndpoint === "function"
        ? wsEndpointProvider.wsEndpoint()
        : undefined;

      if (!fingerprint.tier1.ok) {
        this.logger.warn("fingerprint.tier1.mismatch", {
          sessionId,
          data: { issues: fingerprint.tier1.issues }
        });
      }

      return {
        sessionId,
        mode: "managed",
        activeTargetId: targets.getActiveTargetId(),
        warnings,
        diagnostics: { authProvenance: managed.authProvenance },
        wsEndpoint: wsEndpoint || undefined
      };
    } catch (error) {
      const launchMessage = error instanceof Error ? error.message : "Unknown error";
      const profileLockMessage = this.buildProfileLockLaunchMessage(launchMessage, profileDir);
      const cleanupErrors: unknown[] = [];

      if (context) {
        try {
          await context.close();
        } catch (closeError) {
          cleanupErrors.push(closeError);
        }
      }

      if (!persistProfile) {
        try {
          await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }

      if (managedLease) {
        try {
          profileRegistry.releaseLease(resolvedProfileId, managedLease.launchTokenId);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }

      if (cleanupErrors.length > 0) {
        const message = profileLockMessage ?? `Failed to launch browser context: ${launchMessage}`;
        throw new AggregateError(
          [error, ...cleanupErrors],
          `${message}. Cleanup failed.`
        );
      }

      if (profileLockMessage) {
        throw new Error(profileLockMessage, { cause: error });
      }

      throw new Error(`Failed to launch browser context: ${launchMessage}`, { cause: error });
    }
  }

  async connect(options: ConnectOptions): Promise<BrowserSessionStartResult> {
    this.assertGoogleAuthIntentAllowedForMode("cdpConnect", options.googleAuthIntent);
    const explicitProfile = options.profile
      ? await this.resolveExplicitCdpProfile(options.profile)
      : undefined;
    const wsEndpoint = explicitProfile?.wsEndpoint ?? await this.resolveWsEndpoint(options);
    const result = await this.connectWithEndpoint(wsEndpoint, "cdpConnect", undefined, undefined, {
      googleAuthIntent: options.googleAuthIntent,
      disableSystemCookieBootstrap: options.disableSystemCookieBootstrap,
      allowGoogleCookieBootstrap: options.allowGoogleCookieBootstrap
    }, explicitProfile?.record);
    const startUrl = options.startUrl?.trim();
    if (startUrl && result.activeTargetId) {
      await this.goto(result.sessionId, startUrl);
      return { ...result, activeTargetId: this.getManaged(result.sessionId).targets.getActiveTargetId() };
    }
    return result;
  }

  async connectRelay(
    wsEndpoint: string,
    options?: { startUrl?: string } & BrowserAuthSessionOptions
  ): Promise<BrowserSessionStartResult> {
    ensureLocalEndpoint(wsEndpoint, this.config.security.allowNonLocalCdp);
    if (options?.googleAuthIntent === "user_owned_google") {
      throw new Error("Google user-owned auth requires the extension /ops relay.");
    }
    const { connectEndpoint, reportedEndpoint, relayPort } = await this.resolveRelayEndpoints(wsEndpoint);
    const result = await this.connectWithEndpoint(connectEndpoint, "extension", reportedEndpoint, relayPort, options);
    const startUrl = options?.startUrl?.trim();
    if (startUrl && result.activeTargetId) {
      await this.goto(result.sessionId, startUrl);
      return { ...result, activeTargetId: this.getManaged(result.sessionId).targets.getActiveTargetId() };
    }
    return result;
  }

  async startExplicitCdpProfile(
    options: ExplicitCdpProfileStartOptions
  ): Promise<ExplicitCdpProfileResult> {
    const profileId = this.requireExplicitCdpProfileId(options.profile);
    const cachePaths = await resolveCachePaths(this.worktree, profileId);
    const registry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
    await this.recoverOrRejectExplicitCdpLease(registry, registry.read(profileId), profileId);
    const executable = await findChromeExecutable(options.chromePath ?? this.config.chromePath);
    const warnings: string[] = [];
    let executablePath = executable;
    if (!executablePath) {
      const download = await downloadChromeForTesting(cachePaths.chromeDir);
      warnings.push("System Chrome not found. Downloaded Chrome for Testing.");
      executablePath = download.executablePath;
    }
    const port = options.port ?? await reserveLocalPort();
    const occupiedEndpoint = await probeCdpWsEndpoint(port);
    if (occupiedEndpoint) {
      throw new Error(`Port ${port} already exposes a Chrome DevTools endpoint; choose another --cdp-port or stop the existing browser first.`);
    }
    const launchTokenId = randomUUID();
    const profileDir = cachePaths.profileDir;
    await mkdir(profileDir, { recursive: true });
    const flags = options.flags ?? this.config.flags;
    const unsafeFlag = findUnsafeExplicitCdpProfileFlag(flags);
    if (unsafeFlag) {
      throw new Error(`Refusing explicit CDP profile start with unsafe Chrome flag ${unsafeFlag}; OpenDevBrowser manages profile and CDP endpoint flags.`);
    }
    const args = [
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...flags,
      options.startUrl?.trim() || "about:blank"
    ];
    const lease = registry.acquireLease(profileId, {
      port,
      launchTokenId,
      acquiredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    const child = spawn(executablePath, args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    try {
      await waitForCdpWsEndpoint(
        port,
        options.readinessTimeoutMs ?? CDP_PROFILE_START_TIMEOUT_MS
      );
      const now = new Date().toISOString();
      await this.writeExplicitCdpLaunchToken(profileDir, {
        version: 1,
        profileId,
        launchTokenId,
        port,
        ...(child.pid ? { pid: child.pid } : {}),
        createdAt: now
      });
      const record = registry.upsert({
        profileId,
        displayName: options.profile,
        kind: "explicit_cdp_profile",
        scope: "explicit_local_cdp",
        browserFamily: "chrome",
        persistent: true,
        headless: false,
        pathForHash: profileDir,
        authCapability: "explicit_cdp_profile",
        authProof: "profile_declared",
        endpoint: { host: "127.0.0.1", port },
        lease: {
          ...lease,
          ...(child.pid ? { pid: child.pid } : {}),
          lastSeenAt: now
        }
      });
      return {
        profile: registry.summarize(record),
        ...(child.pid ? { pid: child.pid } : {}),
        port,
        warnings
      };
    } catch (error) {
      await terminateProcessBestEffort(child.pid, CDP_PROFILE_STOP_TIMEOUT_MS);
      registry.releaseLease(profileId, launchTokenId);
      await this.deleteExplicitCdpLaunchToken(profileDir);
      throw error;
    }
  }

  async statusExplicitCdpProfile(profile: string): Promise<ExplicitCdpProfileResult> {
    const record = await this.readExplicitCdpProfile(profile);
    if (!record) {
      throw new Error(`No OpenDevBrowser CDP profile record exists for profile "${sanitizeSessionProfileId(profile)}".`);
    }
    const registry = createSessionProfileRegistry((await resolveCachePaths(this.worktree, record.profileId)).profileRegistryDir);
    const staleRecord = record.lease?.pid && !isProcessAlive(record.lease.pid)
      ? registry.releaseLease(record.profileId, record.lease.launchTokenId) ?? record
      : record;
    return {
      profile: registry.summarize(staleRecord),
      ...(staleRecord.lease?.pid ? { pid: staleRecord.lease.pid } : {}),
      ...(staleRecord.endpoint?.port ? { port: staleRecord.endpoint.port } : {}),
      warnings: staleRecord === record ? [] : ["Recorded CDP browser process had exited; released stale profile lease."]
    };
  }

  async stopExplicitCdpProfile(profile: string): Promise<ExplicitCdpProfileResult> {
    const record = await this.readExplicitCdpProfile(profile);
    if (!record) {
      throw new Error(`No OpenDevBrowser CDP profile record exists for profile "${sanitizeSessionProfileId(profile)}".`);
    }
    if (record.kind !== "explicit_cdp_profile" || record.scope !== "explicit_local_cdp") {
      throw new Error("Refusing to stop a browser without an OpenDevBrowser-owned explicit CDP profile record.");
    }
    if (!record.lease?.pid) {
      throw new Error("No OpenDevBrowser-owned CDP browser process is recorded for this profile.");
    }
    const pid = record.lease.pid;
    const cachePaths = await resolveCachePaths(this.worktree, record.profileId);
    const registry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
    if (!isProcessAlive(pid)) {
      const released = registry.releaseLease(record.profileId, record.lease.launchTokenId) ?? record;
      await this.deleteExplicitCdpLaunchToken(cachePaths.profileDir);
      return {
        profile: registry.summarize(released),
        ...(released.endpoint?.port ? { port: released.endpoint.port } : {}),
        warnings: ["Recorded CDP browser process was already stopped; released stale profile lease."]
      };
    }
    await this.requireLiveExplicitCdpProfileEndpoint(record);
    await this.requireExplicitCdpLaunchToken(record, cachePaths.profileDir);
    const leasePort = record.lease.port;
    if (!leasePort) {
      throw new Error("Explicit CDP profile lease is missing a recorded port. Run cdp-profile start again.");
    }
    if (!isExplicitCdpProcessOwnedByProfile(pid, cachePaths.profileDir, leasePort)) {
      const released = registry.releaseLease(record.profileId, record.lease.launchTokenId) ?? record;
      await this.deleteExplicitCdpLaunchToken(cachePaths.profileDir);
      return {
        profile: registry.summarize(released),
        ...(released.endpoint?.port ? { port: released.endpoint.port } : {}),
        warnings: ["Recorded CDP browser PID could not be verified as OpenDevBrowser-owned; released the stale profile lease without stopping the process."]
      };
    }
    process.kill(pid, "SIGTERM");
    await waitForProcessExit(pid, CDP_PROFILE_STOP_TIMEOUT_MS);
    const released = registry.releaseLease(record.profileId, record.lease.launchTokenId) ?? record;
    await this.deleteExplicitCdpLaunchToken(cachePaths.profileDir);
    return {
      profile: registry.summarize(released),
      ...(released.endpoint?.port ? { port: released.endpoint.port } : {}),
      warnings: []
    };
  }

  async closeAll(): Promise<void> {
    const sessions = Array.from(this.sessions.keys());
    await Promise.allSettled(sessions.map(id => this.disconnect(id, true)));
  }

  async disconnect(sessionId: string, closeBrowser = false): Promise<void> {
    const managed = this.getManaged(sessionId);
    const cleanupErrors: unknown[] = [];

    try {
      try {
        await this.finalizeSessionScreencasts(sessionId);
      } catch (error) {
        cleanupErrors.push(error);
      }
      for (const entry of managed.targets.listPageEntries()) {
        const cleanup = this.pageListeners.get(entry.page);
        if (cleanup) {
          try {
            cleanup();
          } catch (error) {
            cleanupErrors.push(error);
          }
          this.pageListeners.delete(entry.page);
        }
      }

      try {
        const unsubscribeSignals = this.networkSignalSubscriptions.get(sessionId);
        if (unsubscribeSignals) {
          unsubscribeSignals();
          this.networkSignalSubscriptions.delete(sessionId);
        }
      } catch (error) {
        cleanupErrors.push(error);
      }

      this.clearSessionDialogs(sessionId);
      this.clearSessionManagedClicks(sessionId);

      try {
        await managed.cdpTargetOwnership?.close();
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        const shouldCloseBrowser = closeBrowser || managed.mode !== "managed";
        if (shouldCloseBrowser) {
          if (managed.mode !== "managed") {
            const closePromise = managed.browser.close();
            const result = await Promise.race([
              closePromise.then(() => "closed"),
              delay(5000).then(() => "timeout")
            ]);
            if (result === "timeout") {
              closePromise.catch(() => {});
              console.warn("BrowserManager.disconnect: timed out closing CDP connection; continuing cleanup.");
            }
          } else {
            await managed.browser.close();
          }
        } else {
          await managed.context.close();
        }
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        managed.consoleTracker.detach();
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        managed.exceptionTracker.detach();
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        managed.networkTracker.detach();
      } catch (error) {
        cleanupErrors.push(error);
      }

      if (!managed.persistProfile && managed.profileDir) {
        try {
          await rm(managed.profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      try {
        await this.releaseManagedSessionProfileLease(managed);
      } catch (error) {
        cleanupErrors.push(error);
      }
    } finally {
      this.challengeCoordinator.release(sessionId);
      this.sessions.delete(sessionId);
      this.clearSessionParallelState(sessionId);
      this.store.delete(sessionId);
    }

    if (cleanupErrors.length === 1) {
      throw cleanupErrors[0];
    }
    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, "Failed to disconnect browser session.");
    }
  }

  async status(sessionId: string): Promise<{
    mode: BrowserMode;
    activeTargetId: string | null;
    url?: string;
    title?: string;
    meta?: BrowserResponseMeta;
    diagnostics?: BrowserSessionDiagnostics;
  }> {
    const managed = this.getManaged(sessionId);
    const activeTargetId = managed.targets.getActiveTargetId();
    const page = activeTargetId ? managed.targets.getPage(activeTargetId) : null;
    const title = await this.safeManagedPageTitle(managed, page, "BrowserManager.status");
    const url = this.safePageUrl(page, "BrowserManager.status");
    const summary = this.store.getBlockerSummary(sessionId);
    const dialog = this.getDialogState(sessionId, activeTargetId);

    const meta = this.syncChallengeMeta(sessionId, {
      blockerState: summary.state,
      ...(summary.blocker ? { blocker: summary.blocker } : {}),
      ...(summary.updatedAt ? { blockerUpdatedAt: summary.updatedAt } : {}),
      ...(summary.resolution ? { blockerResolution: summary.resolution } : {}),
      ...(dialog ? { dialog } : {})
    }, {
      ownerSurface: "direct_browser",
      resumeMode: "manual",
      preservedSessionId: sessionId,
      preservedTargetId: activeTargetId ?? undefined
    });

    return {
      mode: managed.mode,
      activeTargetId,
      url,
      title,
      ...(meta ? { meta } : {}),
      diagnostics: { authProvenance: managed.authProvenance }
    };
  }

  async withPage<T>(
    sessionId: string,
    targetId: string | null,
    fn: (page: Page) => Promise<T>
  ): Promise<T> {
    const managed = this.getManaged(sessionId);
    let page = targetId ? managed.targets.getPage(targetId) : managed.targets.getActivePage();
    const ensureActiveExtensionPage = async (): Promise<Page> => {
      const nextPage = await this.createExtensionPage(managed, "withPage");
      const nextTargetId = managed.targets.registerPage(nextPage);
      managed.targets.setActiveTarget(nextTargetId);
      this.attachRefInvalidationForPage(managed, nextTargetId, nextPage);
      this.attachTrackers(managed);
      try {
        await this.waitForExtensionTargetReady(nextPage, "withPage", 5000);
      } catch (error) {
        if (!this.isExtensionTargetReadyTimeout(error)) {
          throw error;
        }
      }
      return nextPage;
    };
    const recoverPage = async (error: unknown): Promise<Page> => {
      if (this.isDetachedFrameError(error)) {
        try {
          return await ensureActiveExtensionPage();
        } catch (retryError) {
          if (!this.isTargetNotAllowedError(retryError)) {
            throw retryError;
          }
        }
      }
      const recovered = await this.recoverLegacyExtensionPage(managed, 5000, ensureActiveExtensionPage, page);
      return recovered ?? page;
    };
    if (managed.mode === "extension") {
      if (page.isClosed()) {
        page = await recoverPage(new Error("Target page, context or browser has been closed"));
      }
      try {
        await this.waitForExtensionTargetReady(page, "withPage");
      } catch (error) {
        if (!this.isDetachedFrameError(error) && !this.isLegacyClosedTargetError(managed, error)) {
          throw error;
        }
        page = await recoverPage(error);
      }
    }
    try {
      return await fn(page);
    } catch (error) {
      if (managed.mode !== "extension") {
        throw error;
      }
      if (!this.isDetachedFrameError(error) && !this.isLegacyClosedTargetError(managed, error)) {
        throw error;
      }
      const recovered = await recoverPage(error);
      if (recovered === page) {
        throw error;
      }
      return await fn(recovered);
    }
  }

  async applyRuntimePreviewBridge(
    sessionId: string,
    targetId: string | null,
    input: RuntimePreviewBridgeInput
  ): Promise<RuntimePreviewBridgeResult> {
    return await this.withPage(sessionId, targetId, async (page) => {
      return await runRuntimePreviewBridge(page as {
        evaluate: <TArg, TResult>(
          pageFunction: (arg: TArg) => TResult | Promise<TResult>,
          arg: TArg
        ) => Promise<TResult>;
      }, input);
    });
  }

  async listTargets(sessionId: string, includeUrls = false): Promise<{ activeTargetId: string | null; targets: TargetInfo[] }> {
    return this.runStructural(sessionId, async () => {
      const managed = this.getManaged(sessionId);
      try {
        managed.targets.syncPages(managed.context.pages());
        this.reconcileCdpTargetOwnership(managed);
      } catch {
        // Best-effort sync only.
      }
      const targets = await Promise.all(managed.targets.listPageEntries().map(async ({ targetId, page }) => {
        const url = includeUrls ? this.safePageUrl(page, "BrowserManager.listTargets") : undefined;
        const title = await this.safeManagedPageTitle(managed, page, "BrowserManager.listTargets");
        const metadata = managed.targets.getTargetMetadata(targetId);
        const safeUrlSummary = includeUrls
          ? metadata?.safeUrlSummary ?? buildSafeTargetUrlSummary(url)
          : undefined;
        return {
          targetId,
          ...(typeof title === "string" ? { title } : {}),
          ...(includeUrls && typeof url === "string" ? { url } : {}),
          ...(metadata?.cdpTargetId ? { cdpTargetId: metadata.cdpTargetId } : {}),
          ...(metadata?.openerCdpTargetId ? { openerCdpTargetId: metadata.openerCdpTargetId } : {}),
          ...(metadata?.openerTargetId ? { openerTargetId: metadata.openerTargetId } : {}),
          ...(metadata?.lifecycleState ? { lifecycleState: metadata.lifecycleState } : {}),
          ...(metadata?.popupKind ? { popupKind: metadata.popupKind } : {}),
          ...(metadata?.ownershipSource ? { ownershipSource: metadata.ownershipSource } : {}),
          ...(safeUrlSummary ? { safeUrlSummary } : {}),
          type: "page" as const
        };
      }));
      return {
        activeTargetId: managed.targets.getActiveTargetId(),
        targets
      };
    });
  }

  async page(sessionId: string, name: string, url?: string): Promise<{ targetId: string; created: boolean; url?: string; title?: string }> {
    return this.runStructural(sessionId, async () => {
      const managed = this.getManaged(sessionId);
      const existingTargetId = managed.targets.getTargetIdByName(name);
      let targetId = existingTargetId;
      let created = false;

      if (targetId) {
        managed.targets.setActiveTarget(targetId);
      } else if (managed.mode === "extension") {
        try {
          const page = await this.createExtensionPage(managed, "page");
          targetId = managed.targets.registerPage(page, name);
          managed.targets.setActiveTarget(targetId);
          this.attachRefInvalidationForPage(managed, targetId, page);
          created = true;
        } catch (error) {
          if (!this.isDetachedFrameError(error) && !this.isLegacyClosedTargetError(managed, error)) {
            throw error;
          }
          if (this.isDetachedFrameError(error)) {
            const activeTargetId = managed.targets.getActiveTargetId();
            if (!activeTargetId) {
              throw error;
            }
            managed.targets.setName(activeTargetId, name);
            targetId = activeTargetId;
            created = true;
          } else {
            const fallback = this.selectExistingExtensionEntry(managed);
            if (!fallback) {
              throw error;
            }
            managed.targets.setName(fallback.targetId, name);
            targetId = fallback.targetId;
            created = true;
          }
        }
      } else {
        const page = await managed.context.newPage();
        targetId = managed.targets.registerPage(page, name);
        managed.targets.setActiveTarget(targetId);
        this.attachRefInvalidationForPage(managed, targetId, page);
        created = true;
      }

      this.attachTrackers(managed);

      if (url) {
        await this.goto(sessionId, url, "load", 30000, undefined, targetId);
      }

      const page = managed.targets.getPage(targetId);
      const title = await this.safeManagedPageTitle(managed, page, "BrowserManager.page");
      const finalUrl = this.safePageUrl(page, "BrowserManager.page");

      return { targetId, created, url: finalUrl, title };
    });
  }

  async listPages(sessionId: string): Promise<{ pages: Array<{ name: string; targetId: string; url?: string; title?: string }> }> {
    return this.runStructural(sessionId, async () => {
      const managed = this.getManaged(sessionId);
      const named = managed.targets.listNamedTargets();
      const pages: Array<{ name: string; targetId: string; url?: string; title?: string }> = [];

      for (const entry of named) {
        const page = managed.targets.getPage(entry.targetId);
        const title = await this.safeManagedPageTitle(managed, page, "BrowserManager.listPages");
        const url = this.safePageUrl(page, "BrowserManager.listPages");
        pages.push({ name: entry.name, targetId: entry.targetId, url, title });
      }

      return { pages };
    });
  }

  async closePage(sessionId: string, name: string): Promise<void> {
    await this.runStructural(sessionId, async () => {
      const managed = this.getManaged(sessionId);
      const targetId = managed.targets.getTargetIdByName(name);
      if (!targetId) {
        throw new Error(`Unknown page name: ${name}`);
      }
      if (managed.mode === "extension") {
        const entries = managed.targets.listPageEntries();
        if (entries.length <= 1) {
          managed.targets.removeName(name);
          managed.refStore.clearTarget(targetId);
          return;
        }
      }
      await managed.targets.closeTarget(targetId);
      managed.refStore.clearTarget(targetId);
      this.attachTrackers(managed);
    });
  }

  async useTarget(sessionId: string, targetId: string): Promise<{ activeTargetId: string; url?: string; title?: string }> {
    return this.runStructural(sessionId, async () => {
      const managed = this.getManaged(sessionId);
      managed.targets.setActiveTarget(targetId);
      this.attachTrackers(managed);

      const page = managed.targets.getPage(targetId);
      const title = await this.safeManagedPageTitle(managed, page, "BrowserManager.useTarget");

      return {
        activeTargetId: targetId,
        url: this.safePageUrl(page, "BrowserManager.useTarget"),
        title
      };
    });
  }

  async newTarget(sessionId: string, url?: string): Promise<{ targetId: string }> {
    return this.runStructural(sessionId, async () => {
      const managed = this.getManaged(sessionId);
      if (managed.mode === "extension") {
        const previousTargetId = managed.targets.getActiveTargetId();
        let createdTargetId: string | null = null;
        try {
          const page = await this.createExtensionPage(managed, "target-new");
          const targetId = managed.targets.registerPage(page);
          createdTargetId = targetId;
          this.attachRefInvalidationForPage(managed, targetId, page);
          if (url) {
            await this.waitForExtensionTargetReady(page, "target-new");
            try {
              await page.goto(url, { waitUntil: "load" });
            } catch (error) {
              if (!this.isDetachedFrameError(error)) {
                throw error;
              }
              await delay(200);
              await this.waitForExtensionTargetReady(page, "target-new");
              await page.goto(url, { waitUntil: "load" });
            }
          }
          managed.targets.setActiveTarget(targetId);
          this.attachTrackers(managed);
          return { targetId };
        } catch (error) {
          const detached = this.isDetachedFrameError(error);
          const legacyClosed = this.isLegacyClosedTargetError(managed, error);
          if (!detached && !legacyClosed) {
            throw error;
          }
          if (createdTargetId) {
            try {
              await managed.targets.closeTarget(createdTargetId);
            } catch {
              // Best-effort cleanup; fall back to the existing tab.
            }
          }
          let fallbackTargetId = previousTargetId ?? managed.targets.getActiveTargetId();
          let page: Page;
          if (fallbackTargetId) {
            managed.targets.setActiveTarget(fallbackTargetId);
            page = managed.targets.getPage(fallbackTargetId);
          } else {
            if (!legacyClosed) {
              throw error;
            }
            const fallback = this.selectExistingExtensionEntry(managed, previousTargetId ?? managed.targets.getActiveTargetId());
            if (!fallback) {
              throw error;
            }
            fallbackTargetId = fallback.targetId;
            page = fallback.page;
          }
          if (url) {
            try {
              await page.goto(url, { waitUntil: "load" });
            } catch (retryError) {
              if (this.isDetachedFrameError(retryError)) {
                await delay(200);
                await page.goto(url, { waitUntil: "load" });
              } else if (this.isLegacyClosedTargetError(managed, retryError)) {
                const retryFallback = this.selectExistingExtensionEntry(managed, fallbackTargetId)?.page;
                if (!retryFallback) {
                  throw retryError;
                }
                page = retryFallback;
                await page.goto(url, { waitUntil: "load" });
              } else {
                throw retryError;
              }
            }
          }
          this.attachTrackers(managed);
          return { targetId: fallbackTargetId };
        }
      }

      const page = await managed.context.newPage();
      const targetId = managed.targets.registerPage(page);
      managed.targets.setActiveTarget(targetId);
      this.attachRefInvalidationForPage(managed, targetId, page);
      if (url) {
        await page.goto(url, { waitUntil: "load" });
      }
      this.attachTrackers(managed);
      return { targetId };
    });
  }

  async closeTarget(sessionId: string, targetId: string): Promise<void> {
    await this.runStructural(sessionId, async () => {
      const managed = this.getManaged(sessionId);
      if (managed.mode === "extension") {
        const entries = managed.targets.listPageEntries();
        if (entries.length <= 1) {
          managed.refStore.clearTarget(targetId);
          return;
        }
      }
      await managed.targets.closeTarget(targetId);
      managed.refStore.clearTarget(targetId);
      this.attachTrackers(managed);
    });
  }

  async goto(
    sessionId: string,
    url: string,
    waitUntil: "domcontentloaded" | "load" | "networkidle" = "load",
    timeoutMs = 30000,
    sessionOverride?: { browser: Browser; context: BrowserContext; targets: TargetManager },
    targetId?: string | null
  ): Promise<{
    finalUrl?: string;
    status?: number;
    timingMs: number;
    meta?: BrowserResponseMeta;
  }> {
    if (!sessionOverride && targetId) {
      return this.runTargetScoped(sessionId, targetId, async ({ managed, page, targetId: resolvedTargetId }) => {
        const startTime = Date.now();
        try {
          let activePage = page;
          const attemptNavigation = async () => {
            if (managed.mode === "extension") {
              await this.waitForExtensionTargetReady(activePage, "goto", Math.min(timeoutMs, 5000));
            }
            return await this.navigatePage(activePage, url, waitUntil, timeoutMs, managed);
          };

          let navigation;
          try {
            navigation = await attemptNavigation();
          } catch (error) {
            if (!this.isLegacyClosedTargetError(managed, error)) {
              throw error;
            }
            const recoveredPage = await this.recoverAndRebindLegacyTarget(
              managed,
              resolvedTargetId,
              timeoutMs,
              activePage
            );
            if (!recoveredPage) {
              throw error;
            }
            activePage = recoveredPage;
            navigation = await attemptNavigation();
          }

          const finalUrl = navigation.finalUrl ?? this.safePageUrl(activePage, "BrowserManager.goto");
          const status = navigation.response?.status();
          const title = await this.safeManagedPageTitle(managed, activePage, "BrowserManager.goto");
          const blockerMeta = this.reconcileSessionBlocker(sessionId, managed, {
            source: "navigation",
            url,
            finalUrl,
            title,
            status,
            verifier: true
          });
          const challengeMeta = await this.maybeOrchestrateChallenge(sessionId, resolvedTargetId, blockerMeta);
          return {
            finalUrl,
            ...(typeof status === "number" ? { status } : {}),
            timingMs: Date.now() - startTime,
            ...(challengeMeta ? { meta: challengeMeta } : {})
          };
        } catch (error) {
          this.markVerifierFailure(sessionId, error);
          throw error;
        }
      }, timeoutMs);
    }

    const startTime = Date.now();
    try {
      const managed = sessionOverride ? this.buildOverrideSession(sessionOverride) : this.getManaged(sessionId);
      let page = managed.targets.getActivePage();
      const selectStableExtensionPage = (preferredTargetId?: string | null): Page | null => (
        this.selectStableExtensionEntry(managed, preferredTargetId)?.page ?? null
      );
      const selectFallbackExtensionPage = (preferredTargetId?: string | null): Page | null => (
        this.selectExistingExtensionEntry(managed, preferredTargetId)?.page ?? null
      );
      const ensureActiveExtensionPage = async (): Promise<Page> => {
        const newPage = await this.createExtensionPage(managed, "goto");
        const targetId = managed.targets.registerPage(newPage);
        managed.targets.setActiveTarget(targetId);
        this.attachRefInvalidationForPage(managed, targetId, newPage);
        this.attachTrackers(managed);
        try {
          await this.waitForExtensionTargetReady(newPage, "goto", Math.min(timeoutMs, 5000));
        } catch (error) {
          if (!this.isExtensionTargetReadyTimeout(error)) {
            throw error;
          }
          console.warn("BrowserManager.goto: extension target readiness timed out; continuing.");
        }
        return newPage;
      };

      if (managed.mode === "extension") {
        try {
          const currentUrl = page.url();
          if (!currentUrl || currentUrl === "about:blank" || currentUrl.startsWith("chrome://") || currentUrl.startsWith("chrome-extension://")) {
            const stable = selectStableExtensionPage();
            if (stable) {
              page = stable;
            } else if (currentUrl === "about:blank") {
              page = selectFallbackExtensionPage(managed.targets.getActiveTargetId()) ?? page;
            } else {
              try {
                page = await ensureActiveExtensionPage();
              } catch (error) {
                if (this.isLegacyClosedTargetError(managed, error)) {
                  page = selectFallbackExtensionPage() ?? page;
                } else if (!this.isTargetNotAllowedError(error)) {
                  throw error;
                }
              }
            }
          }
        } catch (error) {
          if (this.isLegacyClosedTargetError(managed, error)) {
            const stable = selectStableExtensionPage();
            if (stable) {
              page = stable;
            } else {
              page = await this.recoverLegacyExtensionPage(managed, timeoutMs, ensureActiveExtensionPage, page) ?? page;
            }
          } else {
            try {
              page = await ensureActiveExtensionPage();
            } catch (retryError) {
              if (!this.isTargetNotAllowedError(retryError)) {
                throw retryError;
              }
            }
          }
        }
        try {
          await this.waitForExtensionTargetReady(page, "goto", Math.min(timeoutMs, 5000));
        } catch (error) {
          if (this.isDetachedFrameError(error)) {
            try {
              page = await ensureActiveExtensionPage();
            } catch (retryError) {
              if (!this.isTargetNotAllowedError(retryError)) {
                throw retryError;
              }
              page = selectFallbackExtensionPage() ?? page;
            }
          } else if (this.isLegacyClosedTargetError(managed, error)) {
            page = await this.recoverLegacyExtensionPage(managed, timeoutMs, ensureActiveExtensionPage, page) ?? page;
          } else if (this.isExtensionTargetReadyTimeout(error)) {
            page = selectFallbackExtensionPage() ?? page;
          } else {
            throw error;
          }
        }
      }

      let response;
      let navigatedFinalUrl: string | undefined;
      if (managed.mode === "extension") {
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const navigation = await this.navigatePage(page, url, waitUntil, timeoutMs, managed);
            response = navigation.response;
            navigatedFinalUrl = navigation.finalUrl;
            lastError = null;
            break;
          } catch (error) {
            if (this.isDetachedFrameError(error)) {
              lastError = error;
              try {
                page = await ensureActiveExtensionPage();
              } catch (retryError) {
                if (!this.isTargetNotAllowedError(retryError)) {
                  throw retryError;
                }
                page = selectFallbackExtensionPage() ?? page;
              }
              continue;
            }
            if (!this.isLegacyClosedTargetError(managed, error)) {
              throw error;
            }
            lastError = error;
            page = await this.recoverLegacyExtensionPage(managed, timeoutMs, ensureActiveExtensionPage, page) ?? page;
          }
        }
        if (lastError) {
          throw lastError;
        }
      } else {
        const navigation = await this.navigatePage(page, url, waitUntil, timeoutMs, managed);
        response = navigation.response;
        navigatedFinalUrl = navigation.finalUrl;
      }

      const finalUrl = navigatedFinalUrl ?? this.safePageUrl(page, "BrowserManager.goto");
      const status = response?.status();
      const title = await this.safeManagedPageTitle(managed, page, "BrowserManager.goto");
      const blockerMeta = sessionOverride
        ? undefined
        : this.reconcileSessionBlocker(sessionId, managed, {
          source: "navigation",
          url,
          finalUrl,
          title,
          status,
          verifier: true
        });
      const challengeMeta = sessionOverride
        ? blockerMeta
        : await this.maybeOrchestrateChallenge(sessionId, managed.targets.getActiveTargetId(), blockerMeta);

      return {
        finalUrl,
        ...(typeof status === "number" ? { status } : {}),
        timingMs: Date.now() - startTime,
        ...(challengeMeta ? { meta: challengeMeta } : {})
      };
    } catch (error) {
      if (!sessionOverride) {
        this.markVerifierFailure(sessionId, error);
      }
      throw error;
    }
  }

  async waitForLoad(
    sessionId: string,
    until: "domcontentloaded" | "load" | "networkidle",
    timeoutMs = 30000,
    targetId?: string | null
  ): Promise<{
    timingMs: number;
    meta?: BrowserResponseMeta;
  }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, page }) => {
      const startTime = Date.now();
      try {
        await page.waitForLoadState(until, { timeout: timeoutMs });
        const blockerMeta = this.reconcileSessionBlocker(sessionId, managed, {
          source: "navigation",
          finalUrl: this.safePageUrl(page, "BrowserManager.waitForLoad"),
          title: await this.safeManagedPageTitle(managed, page, "BrowserManager.waitForLoad"),
          verifier: true
        });
        const challengeMeta = await this.maybeOrchestrateChallenge(sessionId, managed.targets.getActiveTargetId(), blockerMeta);
        return {
          timingMs: Date.now() - startTime,
          ...(challengeMeta ? { meta: challengeMeta } : {})
        };
      } catch (error) {
        this.markVerifierFailure(sessionId, error);
        throw error;
      }
    }, timeoutMs);
  }

  async waitForRef(
    sessionId: string,
    ref: string,
    state: "attached" | "visible" | "hidden" = "attached",
    timeoutMs = 30000,
    targetId?: string | null
  ): Promise<{
    timingMs: number;
    meta?: BrowserResponseMeta;
  }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, page, targetId: resolvedTargetId }) => {
      const startTime = Date.now();
      try {
        await this.waitForResolvedRefState(managed, ref, state, timeoutMs, resolvedTargetId);
        const blockerMeta = this.reconcileSessionBlocker(sessionId, managed, {
          source: "navigation",
          finalUrl: this.safePageUrl(page, "BrowserManager.waitForRef"),
          title: await this.safeManagedPageTitle(managed, page, "BrowserManager.waitForRef"),
          verifier: true
        });
        const challengeMeta = await this.maybeOrchestrateChallenge(sessionId, resolvedTargetId, blockerMeta);
        return {
          timingMs: Date.now() - startTime,
          ...(challengeMeta ? { meta: challengeMeta } : {})
        };
      } catch (error) {
        this.markVerifierFailure(sessionId, error);
        throw error;
      }
    }, timeoutMs);
  }

  async snapshot(
    sessionId: string,
    mode: "outline" | "actionables",
    maxChars: number,
    cursor?: string,
    targetId?: string | null
  ): ReturnType<Snapshotter["snapshot"]> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, page, targetId: resolvedTargetId }) => {
      return managed.snapshotter.snapshot(page, resolvedTargetId, {
        mode,
        maxChars,
        cursor,
        maxNodes: this.config.snapshot.maxNodes
      });
    });
  }

  async click(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number; navigated: boolean }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, page, targetId: resolvedTargetId }) => {
      const startTime = Date.now();
      const previousUrl = page.url();
      await this.clickResolvedRef(managed, page, ref, resolvedTargetId);
      this.syncTargetsAfterAction(managed, resolvedTargetId);
      const navigated = page.url() !== previousUrl;
      return { timingMs: Date.now() - startTime, navigated };
    });
  }

  async hover(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      const startTime = Date.now();
      await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_SCROLL_INTO_VIEW_DECLARATION, [], resolvedTargetId);
      await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_HOVER_DECLARATION, [], resolvedTargetId);
      return { timingMs: Date.now() - startTime };
    });
  }

  async press(sessionId: string, key: string, ref?: string, targetId?: string | null): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, page, targetId: resolvedTargetId }) => {
      const startTime = Date.now();
      if (ref) {
        await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_SCROLL_INTO_VIEW_DECLARATION, [], resolvedTargetId);
        await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_FOCUS_DECLARATION, [], resolvedTargetId);
      }
      await page.keyboard.press(key);
      return { timingMs: Date.now() - startTime };
    });
  }

  async check(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      const startTime = Date.now();
      await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_SCROLL_INTO_VIEW_DECLARATION, [], resolvedTargetId);
      await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_SET_CHECKED_DECLARATION, [true], resolvedTargetId);
      return { timingMs: Date.now() - startTime };
    });
  }

  async uncheck(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      const startTime = Date.now();
      await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_SCROLL_INTO_VIEW_DECLARATION, [], resolvedTargetId);
      await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_SET_CHECKED_DECLARATION, [false], resolvedTargetId);
      return { timingMs: Date.now() - startTime };
    });
  }

  async type(
    sessionId: string,
    ref: string,
    text: string,
    clear = false,
    submit = false,
    targetId?: string | null
  ): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      const startTime = Date.now();
      await this.callFunctionOnResolvedRef<void>(
        managed,
        ref,
        DOM_TYPE_DECLARATION,
        [text, clear, submit],
        resolvedTargetId
      );
      return { timingMs: Date.now() - startTime };
    });
  }

  async select(sessionId: string, ref: string, values: string[], targetId?: string | null): Promise<void> {
    await this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      await this.callFunctionOnResolvedRef<void>(
        managed,
        ref,
        DOM_SELECT_DECLARATION,
        [values],
        resolvedTargetId
      );
    });
  }

  async scroll(sessionId: string, dy: number, ref?: string, targetId?: string | null): Promise<void> {
    await this.runTargetScoped(sessionId, targetId, async ({ managed, page, targetId: resolvedTargetId }) => {
      if (ref) {
        await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_SCROLL_BY_DECLARATION, [dy], resolvedTargetId);
      } else {
        await page.mouse.wheel(0, dy);
      }
    });
  }

  async pointerMove(
    sessionId: string,
    x: number,
    y: number,
    targetId?: string | null,
    steps?: number
  ): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ page }) => {
      const startedAt = Date.now();
      await page.mouse.move(x, y, { ...(typeof steps === "number" ? { steps } : {}) });
      return { timingMs: Date.now() - startedAt };
    });
  }

  async pointerDown(
    sessionId: string,
    x: number,
    y: number,
    targetId?: string | null,
    button: "left" | "middle" | "right" = "left",
    clickCount = 1
  ): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ page }) => {
      const startedAt = Date.now();
      await page.mouse.move(x, y);
      await page.mouse.down({ button, clickCount });
      return { timingMs: Date.now() - startedAt };
    });
  }

  async pointerUp(
    sessionId: string,
    x: number,
    y: number,
    targetId?: string | null,
    button: "left" | "middle" | "right" = "left",
    clickCount = 1
  ): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ page }) => {
      const startedAt = Date.now();
      await page.mouse.move(x, y);
      await page.mouse.up({ button, clickCount });
      return { timingMs: Date.now() - startedAt };
    });
  }

  async drag(
    sessionId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    targetId?: string | null,
    steps?: number
  ): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ page }) => {
      const startedAt = Date.now();
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { ...(typeof steps === "number" ? { steps } : {}) });
      await page.mouse.up();
      return { timingMs: Date.now() - startedAt };
    });
  }

  async resolveRefPoint(
    sessionId: string,
    ref: string,
    targetId?: string | null
  ): Promise<{ x: number; y: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      return await this.resolveRefPointForTarget(managed, ref, resolvedTargetId);
    });
  }

  async scrollIntoView(sessionId: string, ref: string, targetId?: string | null): Promise<{ timingMs: number }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      const startTime = Date.now();
      await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_SCROLL_INTO_VIEW_DECLARATION, [], resolvedTargetId);
      return { timingMs: Date.now() - startTime };
    });
  }

  async domGetHtml(
    sessionId: string,
    ref: string,
    maxChars = 8000,
    targetId?: string | null
  ): Promise<{ outerHTML: string; truncated: boolean }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      const html = await this.callFunctionOnResolvedRef<string>(
        managed,
        ref,
        DOM_OUTER_HTML_DECLARATION,
        [],
        resolvedTargetId
      );
      return truncateHtml(html, maxChars);
    });
  }

  async domGetText(
    sessionId: string,
    ref: string,
    maxChars = 8000,
    targetId?: string | null
  ): Promise<{ text: string; truncated: boolean }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      const text = await this.callFunctionOnResolvedRef<string>(
        managed,
        ref,
        DOM_INNER_TEXT_DECLARATION,
        [],
        resolvedTargetId
      );
      return truncateText(text, maxChars);
    });
  }

  async domGetAttr(
    sessionId: string,
    ref: string,
    name: string,
    targetId?: string | null
  ): Promise<{ value: string | null }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      let value: string | null;
      try {
        value = await this.evaluateDomStateByBackendNode<string | null>(
          managed,
          ref,
          DOM_GET_ATTR_DECLARATION,
          [name],
          resolvedTargetId
        );
      } catch (error) {
        if (this.isSnapshotStaleError(error)) {
          throw error;
        }
        const selector = this.resolveSelector(managed, ref, resolvedTargetId);
        const page = managed.targets.getPage(resolvedTargetId);
        value = await page.locator(selector).getAttribute(name);
      }
      return { value: typeof value === "string" ? value : null };
    });
  }

  async domGetValue(sessionId: string, ref: string, targetId?: string | null): Promise<{ value: string }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      let value: string | null;
      try {
        value = await this.evaluateDomStateByBackendNode<string | null>(
          managed,
          ref,
          DOM_GET_VALUE_DECLARATION,
          [],
          resolvedTargetId
        );
      } catch (error) {
        if (this.isSnapshotStaleError(error)) {
          throw error;
        }
        const selector = this.resolveSelector(managed, ref, resolvedTargetId);
        const page = managed.targets.getPage(resolvedTargetId);
        value = await page.locator(selector).inputValue();
      }
      return { value: typeof value === "string" ? value : "" };
    });
  }

  async domIsVisible(sessionId: string, ref: string, targetId?: string | null): Promise<{ value: boolean }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      let value: boolean;
      try {
        value = await this.evaluateDomStateByBackendNode<boolean>(
          managed,
          ref,
          DOM_IS_VISIBLE_DECLARATION,
          [],
          resolvedTargetId
        );
      } catch (error) {
        if (this.isSnapshotStaleError(error)) {
          throw error;
        }
        const selector = this.resolveSelector(managed, ref, resolvedTargetId);
        const page = managed.targets.getPage(resolvedTargetId);
        value = await page.locator(selector).isVisible();
      }
      return { value: value === true };
    });
  }

  async domIsEnabled(sessionId: string, ref: string, targetId?: string | null): Promise<{ value: boolean }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      let value: boolean;
      try {
        value = await this.evaluateDomStateByBackendNode<boolean>(
          managed,
          ref,
          DOM_IS_ENABLED_DECLARATION,
          [],
          resolvedTargetId
        );
      } catch (error) {
        if (this.isSnapshotStaleError(error)) {
          throw error;
        }
        const selector = this.resolveSelector(managed, ref, resolvedTargetId);
        const page = managed.targets.getPage(resolvedTargetId);
        value = await page.locator(selector).isEnabled();
      }
      return { value: value === true };
    });
  }

  async domIsChecked(sessionId: string, ref: string, targetId?: string | null): Promise<{ value: boolean }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId }) => {
      let value: boolean;
      try {
        value = await this.evaluateDomStateByBackendNode<boolean>(
          managed,
          ref,
          DOM_IS_CHECKED_DECLARATION,
          [],
          resolvedTargetId
        );
      } catch (error) {
        if (this.isSnapshotStaleError(error)) {
          throw error;
        }
        const selector = this.resolveSelector(managed, ref, resolvedTargetId);
        const page = managed.targets.getPage(resolvedTargetId);
        value = await page.locator(selector).isChecked();
      }
      return { value: value === true };
    });
  }

  async clonePageWithOptions(
    sessionId: string,
    targetId?: string | null,
    options: BrowserClonePageOptions = {}
  ): Promise<ReactExport> {
    const allowUnsafeExport = this.config.security.allowUnsafeExport;
    const capture = await this.capturePageCloneWithOptions(sessionId, targetId, options);
    const css = extractCss(capture);
    return emitReactComponent(capture, css, { allowUnsafeExport });
  }

  async clonePage(sessionId: string, targetId?: string | null): Promise<ReactExport> {
    return await this.clonePageWithOptions(sessionId, targetId);
  }

  async clonePageHtmlWithOptions(
    sessionId: string,
    targetId?: string | null,
    options: BrowserClonePageOptions = {}
  ): Promise<{ html: string; warnings?: string[] }> {
    const capture = await this.capturePageCloneWithOptions(sessionId, targetId, options);
    return {
      html: capture.html,
      ...(capture.warnings ? { warnings: [...capture.warnings] } : {})
    };
  }

  async cloneComponent(sessionId: string, ref: string, targetId?: string | null): Promise<ReactExport> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, page, targetId: resolvedTargetId }) => {
      const selector = this.resolveSelector(managed, ref, resolvedTargetId);
      const allowUnsafeExport = this.config.security.allowUnsafeExport;
      const exportConfig = this.config.export;
      const capture = await captureDom(page, selector, {
        sanitize: !allowUnsafeExport,
        maxNodes: exportConfig.maxNodes,
        inlineStyles: exportConfig.inlineStyles
      });
      const css = extractCss(capture);
      return emitReactComponent(capture, css, { allowUnsafeExport });
    });
  }

  async perfMetrics(sessionId: string, targetId?: string | null): Promise<{ metrics: Array<{ name: string; value: number }> }> {
    return this.runTargetScoped(sessionId, targetId, async ({ managed, page }) => {
      const session = await managed.context.newCDPSession(page);
      try {
        const result = await this.withLegacyExtensionOperationTimeout(
          managed,
          session.send("Performance.getMetrics") as Promise<{ metrics?: Array<{ name: string; value: number }> }>,
          `Performance.getMetrics: Timeout ${LEGACY_EXTENSION_OPERATION_TIMEOUT_MS}ms exceeded.`
        );
        const metrics = Array.isArray(result.metrics) ? result.metrics : [];
        return { metrics };
      } catch (error) {
        if (managed.extensionLegacy) {
          return { metrics: [] };
        }
        throw error;
      } finally {
        await session.detach().catch(() => undefined);
      }
    });
  }

  private async capturePageCloneWithOptions(
    sessionId: string,
    targetId: string | null | undefined,
    options: BrowserClonePageOptions = {}
  ): Promise<DomCapture> {
    return await this.runTargetScoped(sessionId, targetId, async ({ page }) => {
      const allowUnsafeExport = this.config.security.allowUnsafeExport;
      const exportConfig = this.config.export;
      return await captureDom(page, "body", {
        sanitize: !allowUnsafeExport,
        maxNodes: options.maxNodes ?? exportConfig.maxNodes,
        inlineStyles: options.inlineStyles ?? exportConfig.inlineStyles
      });
    });
  }

  async screenshot(
    sessionId: string,
    options: BrowserScreenshotOptions = {}
  ): Promise<BrowserScreenshotResult> {
    if (options.ref && options.fullPage) {
      throw new Error("Screenshot ref and fullPage options are mutually exclusive.");
    }
    return this.runTargetScoped(sessionId, options.targetId, async ({ managed, page, targetId: resolvedTargetId }) => {
      let artifact: ReturnType<typeof createBrowserOutputArtifactDirectory> | undefined;
      let outputPath = options.path;
      if (typeof outputPath !== "string") {
        artifact = createBrowserOutputArtifactDirectory({
          workspaceRoot: this.worktree,
          namespace: BROWSER_SCREENSHOT_ARTIFACT_NAMESPACE
        });
        outputPath = join(artifact.artifactPath, "capture.png");
      }
      const screenshotOptions: {
        type: "png";
        path: string;
        fullPage?: boolean;
        clip?: { x: number; y: number; width: number; height: number };
      } = {
        type: "png",
        path: outputPath
      };

      if (options.ref) {
        await this.callFunctionOnResolvedRef<void>(managed, options.ref, DOM_SCROLL_INTO_VIEW_DECLARATION, [], resolvedTargetId);
        const clip = await this.callFunctionOnResolvedRef<{
          x?: unknown;
          y?: unknown;
          width?: unknown;
          height?: unknown;
        } | null>(managed, options.ref, DOM_SCREENSHOT_CLIP_DECLARATION, [], resolvedTargetId);
        screenshotOptions.clip = this.normalizeScreenshotClip(clip, options.ref);
      } else if (options.fullPage) {
        screenshotOptions.fullPage = true;
      }

      try {
        await this.withLegacyExtensionOperationTimeout(
          managed,
          page.screenshot(screenshotOptions),
          `page.screenshot: Timeout ${LEGACY_EXTENSION_OPERATION_TIMEOUT_MS}ms exceeded.`
        );
        return {
          path: outputPath,
          ...(artifact ? { artifact_path: artifact.artifactPath } : {})
        };
      } catch (error) {
        const fallback = await this.captureScreenshotViaCdp(managed, page, error, options);
        if (!fallback) {
          throw error;
        }
        await writeFile(outputPath, Buffer.from(fallback.base64, "base64"));
        return {
          path: outputPath,
          ...(artifact ? { artifact_path: artifact.artifactPath } : {}),
          ...(fallback.warnings ? { warnings: fallback.warnings } : {})
        };
      }
    });
  }

  async capturePinterestPinMedia(
    sessionId: string,
    options: BrowserPinterestPinMediaOptions
  ): Promise<BrowserPinterestPinMediaResult> {
    if (!options.path) {
      throw new Error("Pinterest pin media capture requires an output path.");
    }
    const remainingTimeoutMs = createPinterestPinMediaRemainingTimeout(options.timeoutMs);
    const targetScopeTimeoutMs = clampPinterestPinMediaOperationTimeout(
      remainingTimeoutMs(),
      options.timeoutMs ?? PINTEREST_PIN_MEDIA_DEFAULT_TIMEOUT_MS
    );
    return this.runTargetScoped(sessionId, options.targetId, async ({ managed, page, targetId }) => {
      const pageSourceUrl = this.safePageUrl(page, "BrowserManager.capturePinterestPinMedia") ?? "";
      const extraction = await this.evaluatePinterestPinMediaCandidates(managed, page, remainingTimeoutMs());
      const sourceUrl = readAuthoritativePinterestSourceUrl(pageSourceUrl, extraction.sourceUrl);
      if (pinterestPinSourceChanged(pageSourceUrl, extraction.sourceUrl)) {
        return {
          status: "not_found",
          sourceUrl,
          targetId,
          rejectedCandidates: extraction.candidates
            .slice(0, PINTEREST_PIN_MEDIA_REJECTION_LIMIT)
            .map((candidate) => summarizeRejectedPinterestCandidate(candidate, ["source_url_changed"]))
        };
      }
      const selection = selectPinterestPinMediaCandidate(extraction, sourceUrl);
      if (!selection.selected) {
        return {
          status: "not_found",
          sourceUrl,
          targetId,
          rejectedCandidates: selection.rejectedCandidates
        };
      }
      const rejectedCandidates = [...selection.rejectedCandidates];
      let lastFailure: unknown;
      for (const candidate of selection.acceptedCandidates) {
        try {
          const fetchTimeoutMs = clampPinterestPinMediaOperationTimeout(
            remainingTimeoutMs(),
            PINTEREST_PIN_MEDIA_FETCH_MAX_TIMEOUT_MS
          );
          const fetched = await this.fetchPinterestPinMediaBytes(candidate.mediaUrl ?? "", fetchTimeoutMs);
          assertFetchedPinterestCandidateMatchesKind(candidate, fetched);
          await writePinterestPinMediaOutput(options.path, fetched.bytes);
          return this.buildPinterestPinMediaResult(
            candidate,
            rejectedCandidates,
            {
              contentType: fetched.contentType,
              byteLength: fetched.bytes.byteLength,
              path: options.path,
              sourceUrl,
              targetId,
              mediaUrl: fetched.finalUrl
            }
          );
        } catch (error) {
          lastFailure = error;
          if (rejectedCandidates.length < PINTEREST_PIN_MEDIA_REJECTION_LIMIT) {
            rejectedCandidates.push(summarizeRejectedPinterestCandidate(
              candidate,
              [pinterestCandidateCaptureFailureReason(error)]
            ));
          }
        }
      }
      throw lastFailure instanceof Error ? lastFailure : new Error("Pinterest pin media capture failed.");
    }, targetScopeTimeoutMs);
  }

  private async evaluatePinterestPinMediaCandidates(
    managed: ManagedSession,
    page: Page,
    timeoutMs = PINTEREST_PIN_MEDIA_DEFAULT_TIMEOUT_MS
  ): Promise<PinterestPinMediaDomExtraction> {
    const inspectionTimeoutMs = clampPinterestPinMediaOperationTimeout(
      timeoutMs,
      PINTEREST_PIN_MEDIA_DOM_INSPECTION_MAX_TIMEOUT_MS
    );
    try {
      return await withPinterestPinMediaOperationTimeout(
        page.evaluate(readPinterestPinMediaCandidatesInPage),
        inspectionTimeoutMs,
        `Pinterest pin media DOM inspection timed out after ${inspectionTimeoutMs}ms.`
      );
    } catch (error) {
      if (!isPinterestPinMediaDomInspectionTimeout(error)) {
        throw error;
      }
      return await this.evaluatePinterestPinMediaCandidatesViaCdp(managed, page, inspectionTimeoutMs, error);
    }
  }

  private async evaluatePinterestPinMediaCandidatesViaCdp(
    managed: ManagedSession,
    page: Page,
    timeoutMs: number,
    originalError: unknown
  ): Promise<PinterestPinMediaDomExtraction> {
    const sessionTimeoutMs = clampPinterestPinMediaOperationTimeout(
      timeoutMs,
      PINTEREST_PIN_MEDIA_CDP_SESSION_MAX_TIMEOUT_MS
    );
    const session = await withPinterestPinMediaOperationTimeout(
      managed.context.newCDPSession(page),
      sessionTimeoutMs,
      `Pinterest pin media CDP session attach timed out after ${sessionTimeoutMs}ms.`
    );
    try {
      const result = await withPinterestPinMediaOperationTimeout(
        session.send("Runtime.evaluate", {
          expression: `(${readPinterestPinMediaCandidatesInPage.toString()})()`,
          awaitPromise: true,
          returnByValue: true
        }) as Promise<PinterestPinMediaCdpEvaluationResult>,
        timeoutMs,
        `Pinterest pin media CDP inspection timed out after ${timeoutMs}ms.`
      );
      return parsePinterestPinMediaCdpExtraction(result);
    } catch {
      throw originalError;
    } finally {
      detachPinterestPinMediaCdpSession(session);
    }
  }

  private async fetchPinterestPinMediaBytes(
    mediaUrl: string,
    timeoutMs = PINTEREST_PIN_MEDIA_DEFAULT_TIMEOUT_MS
  ): Promise<{ bytes: Buffer; finalUrl: string; contentType?: string }> {
    if (!isFirstPartyPinterestMediaUrl(mediaUrl)) {
      throw new Error("Pinterest pin media fetch rejected a non-first-party media URL.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { response, finalUrl } = await fetchPinterestPinMediaResponse(mediaUrl, controller.signal);
      if (!response.ok) {
        await discardPinterestPinMediaResponseBody(response);
        throw new Error(`Pinterest pin media fetch failed with status ${response.status}.`);
      }
      const contentLength = readPinterestPinMediaContentLength(response.headers);
      if (contentLength !== undefined) {
        try {
          assertPinterestPinMediaByteLimit(contentLength);
        } catch (error) {
          await discardPinterestPinMediaResponseBody(response);
          throw error;
        }
      }
      const bytes = await readBoundedPinterestPinMediaBytes(response);
      const contentType = response.headers.get("content-type") ?? undefined;
      return { bytes, finalUrl, ...(contentType ? { contentType } : {}) };
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPinterestPinMediaResult(
    candidate: PinterestPinMediaDomCandidate,
    rejectedCandidates: BrowserPinterestPinMediaRejectedCandidate[],
    metadata: {
      contentType?: string;
      byteLength: number;
      path: string;
      sourceUrl: string;
      targetId: string;
      mediaUrl: string;
    }
  ): BrowserPinterestPinMediaResult {
    const contentType = candidate.kind === "video"
      ? PINTEREST_PIN_MEDIA_VIDEO_CONTENT_TYPE
      : normalizePinterestResponseContentType(metadata.contentType);
    return {
      status: "captured",
      sourceUrl: metadata.sourceUrl,
      targetId: metadata.targetId,
      kind: candidate.kind,
      path: metadata.path,
      mediaUrl: metadata.mediaUrl,
      bytes: metadata.byteLength,
      ...(contentType ? { contentType } : {}),
      ...(candidate.candidateSelector ? { candidateSelector: candidate.candidateSelector } : {}),
      ...(candidate.candidateRole ? { candidateRole: candidate.candidateRole } : {}),
      ...(candidate.alt ? { alt: candidate.alt } : {}),
      ...(candidate.srcset ? { srcset: candidate.srcset } : {}),
      ...(candidate.width ? { width: candidate.width } : {}),
      ...(candidate.height ? { height: candidate.height } : {}),
      ...(candidate.naturalWidth ? { naturalWidth: candidate.naturalWidth } : {}),
      ...(candidate.naturalHeight ? { naturalHeight: candidate.naturalHeight } : {}),
      ...(candidate.poster ? { poster: candidate.poster } : {}),
      ...(candidate.rect ? { rect: candidate.rect } : {}),
      ancestry: candidate.ancestry.slice(0, 6),
      rejectedCandidates,
      ...(warningsForSelectedPinterestCandidate(candidate).length > 0
        ? { warnings: warningsForSelectedPinterestCandidate(candidate) }
        : {})
    };
  }

  async startScreencast(
    sessionId: string,
    options: BrowserScreencastStartOptions = {}
  ): Promise<BrowserScreencastSession> {
    return await this.runStructural(sessionId, async () => {
      const managed = this.getManaged(sessionId);
      const { targetId } = this.resolveTargetContext(managed, options.targetId);
      this.assertNoActiveScreencast(sessionId, targetId);
      const recorder = new BrowserScreencastRecorder({
        worktree: this.worktree,
        sessionId,
        targetId,
        options,
        captureFrame: async (path) => await this.captureScreencastFrame(sessionId, targetId, path)
      });
      this.trackScreencast(recorder);
      try {
        const screencast = await recorder.start();
        if (recorder.isComplete()) {
          this.storeCompletedScreencast(await recorder.resultPromise);
        } else {
          this.observeTrackedScreencast(recorder);
        }
        return screencast;
      } catch (error) {
        this.clearTrackedScreencast(recorder.screencastId);
        throw error;
      }
    });
  }

  async stopScreencast(sessionId: string, screencastId: string): Promise<BrowserScreencastResult> {
    const active = this.activeScreencasts.get(screencastId);
    if (active) {
      if (active.sessionId !== sessionId) {
        throw new Error(`[invalid_screencast] Screencast ${screencastId} does not belong to session ${sessionId}`);
      }
      const result = await active.stop("stopped");
      this.storeCompletedScreencast(result);
      return result;
    }
    const completed = this.completedScreencasts.get(screencastId);
    if (!completed) {
      throw new Error(`[invalid_screencast] Unknown screencastId: ${screencastId}`);
    }
    if (completed.sessionId !== sessionId) {
      throw new Error(`[invalid_screencast] Screencast ${screencastId} does not belong to session ${sessionId}`);
    }
    return completed;
  }

  monitorScreencastCompletion(
    screencastId: string,
    listener: (result: BrowserScreencastResult) => void
  ): () => void {
    const completed = this.completedScreencasts.get(screencastId);
    if (completed) {
      listener(completed);
      return () => {};
    }
    const listeners = this.screencastCompletionListeners.get(screencastId) ?? new Set();
    listeners.add(listener);
    this.screencastCompletionListeners.set(screencastId, listeners);
    return () => {
      const registered = this.screencastCompletionListeners.get(screencastId);
      if (!registered) {
        return;
      }
      registered.delete(listener);
      if (registered.size === 0) {
        this.screencastCompletionListeners.delete(screencastId);
      }
    };
  }

  private async captureScreencastFrame(
    sessionId: string,
    targetId: string,
    path: string
  ): Promise<{ url?: string; title?: string; warnings?: string[] }> {
    return await this.runTargetScoped(sessionId, targetId, async ({ managed, targetId: resolvedTargetId, page }) => {
      let activePage = page;
      try {
        managed.targets.syncPages(managed.context.pages());
        activePage = managed.targets.getPage(resolvedTargetId);
      } catch {
        activePage = page;
      }

      let warnings: string[] | undefined;
      try {
        await this.withLegacyExtensionOperationTimeout(
          managed,
          activePage.screenshot({ type: "png", path }),
          `page.screenshot: Timeout ${LEGACY_EXTENSION_OPERATION_TIMEOUT_MS}ms exceeded.`
        );
      } catch (error) {
        const fallback = await this.captureScreenshotViaCdp(managed, activePage, error, { path });
        if (!fallback) {
          throw error;
        }
        await writeFile(path, Buffer.from(fallback.base64, "base64"));
        warnings = fallback.warnings;
      }

      const url = this.safePageUrl(activePage, "BrowserManager.captureScreencastFrame");
      const title = await this.safeManagedPageTitle(managed, activePage, "BrowserManager.captureScreencastFrame");
      return {
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
        ...(warnings ? { warnings } : {})
      };
    });
  }

  async upload(sessionId: string, input: BrowserUploadInput): Promise<BrowserUploadResult> {
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new Error("Upload requires at least one file.");
    }
    await Promise.all(input.files.map(async (filePath) => {
      await access(filePath);
    }));
    return this.runTargetScoped(sessionId, input.targetId, async ({ managed, page, targetId: resolvedTargetId }) => {
      const info = await this.callFunctionOnResolvedRef<{
        isFileInput?: unknown;
        disabled?: unknown;
      }>(managed, input.ref, DOM_FILE_INPUT_INFO_DECLARATION, [], resolvedTargetId);
      if (info?.disabled === true) {
        throw new Error(`Cannot upload files to disabled ref: ${input.ref}`);
      }

      if (info?.isFileInput === true) {
        const resolved = this.resolveRefEntryForTarget(managed, input.ref, resolvedTargetId);
        await this.withResolvedRefSession(managed, resolved, async (session) => {
          await session.send("DOM.setFileInputFiles", {
            backendNodeId: resolved.backendNodeId,
            files: input.files
          });
        });
        return {
          targetId: resolvedTargetId,
          fileCount: input.files.length,
          mode: "direct_input"
        };
      }

      const chooserPromise = page.waitForEvent("filechooser", { timeout: LEGACY_EXTENSION_OPERATION_TIMEOUT_MS });
      await this.clickResolvedRef(managed, page, input.ref, resolvedTargetId);
      const chooser = await chooserPromise;
      await chooser.setFiles(input.files);
      return {
        targetId: resolvedTargetId,
        fileCount: input.files.length,
        mode: "file_chooser"
      };
    });
  }

  async dialog(sessionId: string, input: BrowserDialogInput = {}): Promise<BrowserDialogResult> {
    const action = input.action ?? "status";
    return this.runDialogScoped(sessionId, input.targetId, async ({ targetId: resolvedTargetId }) => {
      const pending = this.getPendingDialog(sessionId, resolvedTargetId);
      if (!pending) {
        return {
          dialog: { open: false, targetId: resolvedTargetId },
          ...(action === "status" ? {} : { handled: false })
        };
      }
      if (action === "status") {
        return { dialog: pending.state };
      }
      if (action === "accept") {
        await pending.dialog.accept(input.promptText);
      } else {
        await pending.dialog.dismiss();
      }
      const pendingClick = this.getPendingManagedClick(sessionId, resolvedTargetId);
      if (pendingClick?.dialogOpened) {
        pendingClick.resolveDialogHandled();
        await pendingClick.completed;
      }
      this.clearPendingDialog(sessionId, resolvedTargetId);
      return {
        dialog: { open: false, targetId: resolvedTargetId },
        handled: true
      };
    });
  }

  private async withLegacyExtensionOperationTimeout<T>(
    managed: Pick<ManagedSession, "extensionLegacy">,
    operation: Promise<T>,
    timeoutMessage: string,
    timeoutMs = LEGACY_EXTENSION_OPERATION_TIMEOUT_MS
  ): Promise<T> {
    if (!managed.extensionLegacy) {
      return await operation;
    }
    return await Promise.race([
      operation,
      delay(timeoutMs).then(() => {
        throw new Error(timeoutMessage);
      })
    ]);
  }

  async consolePoll(
    sessionId: string,
    sinceSeq?: number,
    max = 50
  ): Promise<{ events: ReturnType<ConsoleTracker["poll"]>["events"]; nextSeq: number; truncated?: boolean }> {
    const managed = this.getManaged(sessionId);
    return managed.consoleTracker.poll(sinceSeq, max);
  }

  async exceptionPoll(
    sessionId: string,
    sinceSeq?: number,
    max = 50
  ): Promise<{ events: ReturnType<ExceptionTracker["poll"]>["events"]; nextSeq: number; truncated?: boolean }> {
    const managed = this.getManaged(sessionId);
    return managed.exceptionTracker.poll(sinceSeq, max);
  }

  async networkPoll(
    sessionId: string,
    sinceSeq?: number,
    max = 50
  ): Promise<{ events: ReturnType<NetworkTracker["poll"]>["events"]; nextSeq: number; truncated?: boolean }> {
    const managed = this.getManaged(sessionId);
    return managed.networkTracker.poll(sinceSeq, max);
  }

  async debugTraceSnapshot(
    sessionId: string,
    options: {
      sinceConsoleSeq?: number;
      sinceNetworkSeq?: number;
      sinceExceptionSeq?: number;
      max?: number;
      requestId?: string;
    } = {}
  ): Promise<{
    requestId: string;
    generatedAt: string;
    page: { mode: BrowserMode; activeTargetId: string | null; url?: string; title?: string };
    channels: {
      console: {
        events: Array<ReturnType<ConsoleTracker["poll"]>["events"][number] & { requestId: string; sessionId: string }>;
        nextSeq: number;
        truncated?: boolean;
      };
      network: {
        events: Array<ReturnType<NetworkTracker["poll"]>["events"][number] & { requestId: string; sessionId: string }>;
        nextSeq: number;
        truncated?: boolean;
      };
      exception: {
        events: Array<ReturnType<ExceptionTracker["poll"]>["events"][number] & { requestId: string; sessionId: string }>;
        nextSeq: number;
        truncated?: boolean;
      };
    };
    fingerprint: ReturnType<BrowserManager["buildFingerprintSummary"]>;
    meta?: {
      blocker?: BlockerSignalV1;
      blockerState: "clear" | "active" | "resolving";
      blockerUpdatedAt?: string;
      blockerResolution?: {
        status: "resolved" | "unresolved" | "deferred";
        reason: "verifier_passed" | "verification_timeout" | "verifier_failed" | "env_limited" | "manual_clear";
        updatedAt: string;
      };
      blockerArtifacts?: ReturnType<typeof buildBlockerArtifacts>;
      challenge?: SessionChallengeSummary;
    };
  }> {
    const requestId = options.requestId ?? createRequestId();
    try {
      const managed = this.getManaged(sessionId);
      const max = options.max ?? 500;
      const status = await this.status(sessionId);
      const consoleChannel = managed.consoleTracker.poll(options.sinceConsoleSeq, max);
      const networkChannel = managed.networkTracker.poll(options.sinceNetworkSeq, max);
      const exceptionChannel = managed.exceptionTracker.poll(options.sinceExceptionSeq, max);

      this.applyFingerprintSignals(managed, networkChannel.events, requestId, { source: "debug-trace" });

      const annotateTraceContext = <T extends Record<string, unknown>>(events: T[]) => (
        events.map((event) => ({
          ...event,
          requestId,
          sessionId
        }))
      );

      const blockerMeta = this.reconcileSessionBlocker(sessionId, managed, {
        source: "network",
        url: status.url,
        finalUrl: status.url,
        title: status.title,
        status: this.latestStatus(networkChannel.events),
        traceRequestId: requestId,
        networkEvents: networkChannel.events,
        consoleEvents: consoleChannel.events,
        exceptionEvents: exceptionChannel.events,
        verifier: true,
        includeArtifacts: true
      });

      return {
        requestId,
        generatedAt: new Date().toISOString(),
        page: status,
        channels: {
          console: {
            nextSeq: consoleChannel.nextSeq,
            truncated: consoleChannel.truncated,
            events: annotateTraceContext(consoleChannel.events)
          },
          network: {
            nextSeq: networkChannel.nextSeq,
            truncated: networkChannel.truncated,
            events: annotateTraceContext(networkChannel.events)
          },
          exception: {
            nextSeq: exceptionChannel.nextSeq,
            truncated: exceptionChannel.truncated,
            events: annotateTraceContext(exceptionChannel.events)
          }
        },
        fingerprint: this.buildFingerprintSummary(managed),
        ...(blockerMeta ? { meta: blockerMeta } : {})
      };
    } catch (error) {
      this.markVerifierFailure(sessionId, error);
      throw error;
    }
  }

  async cookieImport(
    sessionId: string,
    cookies: CookieImportRecord[],
    strict = true,
    requestId = createRequestId()
  ): Promise<BrowserCookieImportResult> {
    const managed = this.getManaged(sessionId);
    this.markExplicitCookieImportAttempted(managed);
    const normalized: CookieImportRecord[] = [];
    const rejected: Array<{ index: number; reason: string }> = [];

    cookies.forEach((cookie, index) => {
      const validation = this.validateCookieRecord(cookie);
      if (!validation.valid) {
        rejected.push({ index, reason: validation.reason });
        return;
      }
      normalized.push(validation.cookie);
    });

    if (strict && rejected.length > 0) {
      throw new Error(`Cookie import rejected ${rejected.length} entries.`);
    }

    if (normalized.length > 0) {
      await managed.context.addCookies(normalized);
    }

    this.logger.audit("session.cookie_import", {
      requestId,
      sessionId,
      data: {
        imported: normalized.length,
        rejected
      }
    });

    return {
      requestId,
      imported: normalized.length,
      rejected,
      diagnostics: { authProvenance: managed.authProvenance }
    };
  }

  async cookieList(
    sessionId: string,
    urls?: string[],
    requestId = createRequestId()
  ): Promise<{ requestId: string; cookies: CookieListRecord[]; count: number }> {
    const managed = this.getManaged(sessionId);
    const normalizedUrls = this.normalizeCookieListUrls(urls);
    const listed = normalizedUrls
      ? await managed.context.cookies(normalizedUrls)
      : await managed.context.cookies();

    const cookies: CookieListRecord[] = listed.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
    }));

    this.logger.audit("session.cookie_list", {
      requestId,
      sessionId,
      data: {
        count: cookies.length,
        filteredByUrlCount: normalizedUrls?.length ?? 0
      }
    });

    return {
      requestId,
      cookies,
      count: cookies.length
    };
  }

  private createInitialAuthProvenance(
    profileSource: BrowserAuthProvenanceDiagnostics["profileSource"],
    googleAuthIntent: GoogleAuthIntent = DEFAULT_GOOGLE_AUTH_INTENT,
    profile?: SessionProfileSummary
  ): BrowserAuthProvenanceDiagnostics {
    return {
      googleAuthIntent,
      profileSource,
      ...(profile ? { profile } : {}),
      cookieBootstrap: {
        attempted: false,
        disabled: false,
        importedCount: 0,
        rejectedCount: 0
      }
    };
  }

  private async releaseManagedSessionProfileLease(managed: ManagedSession): Promise<void> {
    if (managed.mode !== "managed" || !managed.persistProfile) {
      return;
    }
    const profile = managed.authProvenance.profile;
    if (!profile?.profileId) {
      return;
    }
    const cachePaths = await resolveCachePaths(this.worktree, profile.profileId);
    const registry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
    const launchTokenId = registry.read(profile.profileId)?.lease?.launchTokenId;
    if (!launchTokenId) {
      return;
    }
    registry.releaseLease(profile.profileId, launchTokenId);
  }

  private createManagedSessionProfileSummary(input: {
    cachePaths: CachePaths;
    profileName: string;
    profileDir: string;
    persistProfile: boolean;
    headless: boolean;
    lease: SessionProfileLease;
  }): SessionProfileSummary {
    const registry = createSessionProfileRegistry(input.cachePaths.profileRegistryDir);
    const profileContinuity = input.persistProfile && !input.headless;
    const record = registry.upsert({
      profileId: input.profileName,
      displayName: input.profileName,
      kind: input.persistProfile ? "managed_persistent" : "managed_temporary",
      scope: input.persistProfile ? "opendevbrowser_owned" : "temporary",
      browserFamily: "chromium",
      persistent: input.persistProfile,
      headless: input.headless,
      pathForHash: input.profileDir,
      authCapability: profileContinuity ? "profile_continuity" : "public",
      authProof: profileContinuity ? "profile_declared" : "none",
      lease: input.lease
    });
    return registry.summarize(record);
  }

  private createConnectedSessionProfileSummary(input: {
    cachePaths: CachePaths;
    mode: BrowserMode;
    wsEndpoint: string;
    launchTokenId: string;
    explicitCdpProfile?: SessionProfileRecord;
  }): SessionProfileSummary {
    const registry = createSessionProfileRegistry(input.cachePaths.profileRegistryDir);
    if (input.explicitCdpProfile) {
      const now = new Date().toISOString();
      const record = registry.upsert({
        ...input.explicitCdpProfile,
        authCapability: "explicit_cdp_profile",
        authProof: "profile_declared",
        updatedAt: now,
        ...(input.explicitCdpProfile.lease ? { lease: {
          ...input.explicitCdpProfile.lease,
          lastSeenAt: now
        } } : {})
      });
      return registry.summarize(record);
    }
    const endpoint = this.parseSessionProfileEndpoint(input.wsEndpoint);
    const extensionMode = input.mode === "extension";
    const now = new Date().toISOString();
    const record = registry.upsert({
      profileId: extensionMode
        ? "extension-live"
        : endpoint
          ? `raw-cdp-${endpoint.host}-${endpoint.port}`
          : "raw-cdp-unknown",
      displayName: extensionMode ? "Extension live profile" : "Raw CDP profile",
      kind: extensionMode ? "extension_live" : "raw_cdp_unknown",
      scope: extensionMode ? "live_extension" : "unknown",
      browserFamily: "unknown",
      persistent: true,
      headless: false,
      authCapability: extensionMode ? "live_extension" : "public",
      authProof: extensionMode ? "live_extension" : "none",
      ...(endpoint ? { endpoint } : {}),
      lease: {
        launchTokenId: input.launchTokenId,
        acquiredAt: now,
        lastSeenAt: now
      }
    });
    return registry.summarize(record);
  }

  private parseSessionProfileEndpoint(wsEndpoint: string): SessionProfileEndpoint | undefined {
    try {
      const url = new URL(wsEndpoint);
      const host = this.normalizeSessionProfileEndpointHost(url.hostname);
      const port = Number.parseInt(url.port, 10);
      if (!host || !Number.isInteger(port) || port <= 0) {
        return undefined;
      }
      return { host, port };
    } catch {
      return undefined;
    }
  }

  private normalizeSessionProfileEndpointHost(hostname: string): SessionProfileEndpoint["host"] | null {
    const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    if (normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1") {
      return normalized;
    }
    return null;
  }

  private updateCookieBootstrapProvenance(
    managed: ManagedSession,
    input: BrowserAuthProvenanceDiagnostics["cookieBootstrap"]
  ): void {
    managed.authProvenance = {
      ...managed.authProvenance,
      cookieBootstrap: input
    };
  }

  private markExplicitCookieImportAttempted(managed: ManagedSession): void {
    managed.authProvenance = {
      ...managed.authProvenance,
      explicitCookieImportAttempted: true
    };
  }

  recordProviderCookieImportProvenance(
    sessionId: string,
    input: BrowserProviderCookieImportProvenance
  ): BrowserAuthProvenanceDiagnostics {
    const managed = this.getManaged(sessionId);
    const sanitized = sanitizeProviderCookieImportProvenance(input);
    managed.authProvenance = {
      ...managed.authProvenance,
      providerCookieImport: sanitized
    };
    return managed.authProvenance;
  }

  private assertGoogleAuthIntentAllowedForMode(
    mode: BrowserMode,
    googleAuthIntent: GoogleAuthIntent | undefined
  ): void {
    if (googleAuthIntent === "user_owned_google" && mode !== "extension") {
      throw new Error("Google user-owned auth requires the extension /ops relay.");
    }
  }

  private async bootstrapSystemChromeCookies(
    managed: ManagedSession,
    options?: {
      executablePath?: string | null;
      disabled?: boolean;
      allowGoogleCookieBootstrap?: boolean;
    }
  ): Promise<string[]> {
    if (managed.mode === "extension") {
      return [];
    }

    const warnings: string[] = [];
    if (options?.disabled === true) {
      this.updateCookieBootstrapProvenance(managed, {
        attempted: false,
        disabled: true,
        importedCount: 0,
        rejectedCount: 0
      });
      return ["System Chrome cookie bootstrap disabled for this run."];
    }

    let bootstrapExecutable = options?.executablePath ?? null;
    if (!bootstrapExecutable) {
      const resolved = await this.resolveSystemChromeBootstrapExecutable();
      bootstrapExecutable = resolved.executablePath;
      warnings.push(...resolved.warnings);
    }

    const result = await loadSystemChromeCookies(bootstrapExecutable);
    warnings.push(...result.warnings);

    const acceptedCookies: CookieImportRecord[] = [];
    let rejectedCookies = 0;
    let skippedGoogleSensitive = 0;
    const googleSensitiveCookiePolicy = options?.allowGoogleCookieBootstrap === true
      ? GOOGLE_SENSITIVE_COOKIE_POLICY_INCLUDE
      : GOOGLE_SENSITIVE_COOKIE_POLICY_SKIP;
    for (const cookie of result.cookies) {
      const validation = this.validateCookieRecord(cookie);
      if (!validation.valid) {
        rejectedCookies += 1;
        continue;
      }
      if (
        googleSensitiveCookiePolicy === GOOGLE_SENSITIVE_COOKIE_POLICY_SKIP
        && isGoogleSensitiveCookie(validation.cookie)
      ) {
        skippedGoogleSensitive += 1;
        continue;
      }
      acceptedCookies.push(validation.cookie);
    }
    if (rejectedCookies > 0) {
      warnings.push(`System Chrome cookie bootstrap skipped ${rejectedCookies} invalid cookies.`);
    }
    if (skippedGoogleSensitive > 0) {
      warnings.push(`System Chrome cookie bootstrap skipped ${skippedGoogleSensitive} Google-sensitive cookies.`);
    }

    if (acceptedCookies.length > 0) {
      await managed.context.addCookies(acceptedCookies);
    }

    this.updateCookieBootstrapProvenance(managed, {
      attempted: true,
      disabled: false,
      importedCount: acceptedCookies.length,
      rejectedCount: rejectedCookies,
      skippedGoogleSensitiveCount: skippedGoogleSensitive,
      googleSensitiveCookiePolicy,
      ...(result.source?.browserName ? { sourceBrowserName: result.source.browserName } : {})
    });

    if (acceptedCookies.length > 0 || warnings.length > 0) {
      this.logger.audit("session.system_cookie_bootstrap", {
        sessionId: managed.sessionId,
        data: {
          mode: managed.mode,
          imported: acceptedCookies.length,
          skippedGoogleSensitive,
          warnings,
          source: result.source
            ? {
              browserName: result.source.browserName
            }
            : null
        }
      });
    }

    return warnings;
  }

  private async resolveSystemChromeBootstrapExecutable(): Promise<{ executablePath: string | null; warnings: string[] }> {
    const warnings: string[] = [];
    let executablePath = await findChromeExecutable(this.config.chromePath);
    if (executablePath) {
      return { executablePath, warnings };
    }

    try {
      const cachePaths = await resolveCachePaths(this.worktree, this.config.profile);
      const download = await downloadChromeForTesting(cachePaths.chromeDir);
      executablePath = download.executablePath;
      warnings.push("System Chrome not found. Downloaded Chrome for Testing for cookie bootstrap.");
    } catch (error) {
      warnings.push(`Chrome cookie bootstrap executable unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { executablePath, warnings };
  }

  private initializeFingerprintState(
    sessionId: string,
    profileName: string,
    flags: string[]
  ): ManagedSession["fingerprint"] {
    const tier1Config = this.config.fingerprint.tier1;
    const languageFlag = readFlagValue(flags, "--lang");
    const timezoneFlag = readFlagValue(flags, "--timezone") ?? readFlagValue(flags, "--timezone-for-testing");
    const proxyFlag = readFlagValue(flags, "--proxy-server");

    const tier1 = evaluateTier1Coherence(
      {
        enabled: tier1Config.enabled,
        warnOnly: tier1Config.warnOnly,
        expectedLocale: tier1Config.locale,
        expectedTimezone: tier1Config.timezone,
        expectedLanguages: tier1Config.languages,
        requireProxy: tier1Config.requireProxy,
        geolocationRequired: tier1Config.geolocationRequired
      },
      {
        locale: tier1Config.locale ?? languageFlag,
        timezone: tier1Config.timezone ?? timezoneFlag,
        languages: tier1Config.languages.length > 0
          ? tier1Config.languages
          : languageFlag
            ? [languageFlag]
            : [],
        proxy: proxyFlag,
        geolocation: tier1Config.geolocation
          ? {
            latitude: tier1Config.geolocation.latitude,
            longitude: tier1Config.geolocation.longitude,
            accuracy: tier1Config.geolocation.accuracy
          }
          : undefined
      }
    );

    const tier2 = createTier2RuntimeState(
      {
        enabled: this.config.fingerprint.tier2.enabled,
        mode: this.config.fingerprint.tier2.mode,
        rotationIntervalMs: this.config.fingerprint.tier2.rotationIntervalMs,
        challengePatterns: this.config.fingerprint.tier2.challengePatterns,
        maxChallengeEvents: this.config.fingerprint.tier2.maxChallengeEvents,
        scorePenalty: this.config.fingerprint.tier2.scorePenalty,
        scoreRecovery: this.config.fingerprint.tier2.scoreRecovery,
        rotationHealthThreshold: this.config.fingerprint.tier2.rotationHealthThreshold
      },
      sessionId,
      profileName
    );

    const tier3 = createTier3RuntimeState({
      enabled: this.config.fingerprint.tier3.enabled,
      fallbackTier: this.config.fingerprint.tier3.fallbackTier,
      canary: {
        windowSize: this.config.fingerprint.tier3.canary.windowSize,
        minSamples: this.config.fingerprint.tier3.canary.minSamples,
        promoteThreshold: this.config.fingerprint.tier3.canary.promoteThreshold,
        rollbackThreshold: this.config.fingerprint.tier3.canary.rollbackThreshold
      }
    });

    return {
      tier1,
      tier2,
      tier3,
      lastAppliedNetworkSeq: 0
    };
  }

  private applyFingerprintSignals(
    managed: ManagedSession,
    events: ReturnType<NetworkTracker["poll"]>["events"],
    requestId: string,
    options: FingerprintSignalApplyOptions = {}
  ): void {
    const applyTier2 = options.applyTier2 ?? true;
    const applyTier3 = options.applyTier3 ?? true;
    if (!applyTier2 && !applyTier3) {
      return;
    }

    const pendingEvents = events.filter((event) => event.seq > managed.fingerprint.lastAppliedNetworkSeq);
    if (pendingEvents.length === 0) {
      return;
    }

    let tier2 = managed.fingerprint.tier2;
    let tier3 = managed.fingerprint.tier3;
    const tier2Config = this.config.fingerprint.tier2;
    const tier3Config = this.config.fingerprint.tier3;
    const signalSource = options.source ?? "debug-trace";

    for (const event of pendingEvents) {
      const evaluationTs = event.ts ?? Date.now();
      let hasChallenge = false;

      if (applyTier2) {
        const tier2Result = applyTier2NetworkEvent(
          tier2,
          {
            enabled: tier2Config.enabled,
            mode: tier2Config.mode,
            rotationIntervalMs: tier2Config.rotationIntervalMs,
            challengePatterns: tier2Config.challengePatterns,
            maxChallengeEvents: tier2Config.maxChallengeEvents,
            scorePenalty: tier2Config.scorePenalty,
            scoreRecovery: tier2Config.scoreRecovery,
            rotationHealthThreshold: tier2Config.rotationHealthThreshold
          },
          {
            url: event.url,
            status: event.status,
            ts: evaluationTs
          },
          evaluationTs
        );
        tier2 = tier2Result.state;
        hasChallenge = Boolean(tier2Result.challenge);

        if (tier2Result.challenge) {
          this.logger.warn("fingerprint.tier2.challenge", {
            requestId,
            sessionId: managed.sessionId,
            data: {
              event: tier2Result.challenge,
              score: tier2.profile.healthScore
            }
          });
        }

        if (tier2Result.rotated) {
          this.logger.info("fingerprint.tier2.rotate", {
            requestId,
            sessionId: managed.sessionId,
            data: {
              reason: tier2Result.reason,
              profileId: tier2.profile.id,
              rotationCount: tier2.profile.rotationCount
            }
          });
        }
      }

      if (!applyTier3) {
        continue;
      }

      const tier3Result = evaluateTier3Adaptive(
        tier3,
        {
          enabled: tier3Config.enabled,
          fallbackTier: tier3Config.fallbackTier,
          canary: {
            windowSize: tier3Config.canary.windowSize,
            minSamples: tier3Config.canary.minSamples,
            promoteThreshold: tier3Config.canary.promoteThreshold,
            rollbackThreshold: tier3Config.canary.rollbackThreshold
          }
        },
        {
          hasChallenge,
          healthScore: tier2.profile.healthScore,
          challengeCount: tier2.profile.challengeCount,
          rotationCount: tier2.profile.rotationCount,
          metadata: {
            url: event.url,
            status: event.status
          }
        },
        undefined,
        evaluationTs
      );

      tier3 = tier3Result.state;
      const targetClass = this.resolveCanaryTargetClass(event.url, event.status);
      const scoreWindow = this.buildCanaryScoreWindow(tier3.canary.samples);
      const thresholdComparison = {
        promoteDelta: tier3Result.decision.score - tier3Config.canary.promoteThreshold,
        rollbackDelta: tier3Result.decision.score - tier3Config.canary.rollbackThreshold
      };

      if (tier3Result.action === "rollback") {
        this.logger.warn("fingerprint.tier3.rollback", {
          requestId,
          sessionId: managed.sessionId,
          data: {
            action: tier3Result.action,
            reason: tier3Result.decision.reason,
            score: tier3Result.decision.score,
            threshold: {
              windowSize: tier3Config.canary.windowSize,
              minSamples: tier3Config.canary.minSamples,
              promoteThreshold: tier3Config.canary.promoteThreshold,
              rollbackThreshold: tier3Config.canary.rollbackThreshold
            },
            canary: {
              level: tier3.canary.level,
              averageScore: tier3.canary.averageScore,
              sampleCount: tier3.canary.samples.length
            },
            targetClass,
            scoreWindow,
            thresholdComparison,
            fallbackTier: tier3.fallbackTier,
            status: tier3.status,
            source: signalSource
          }
        });
      } else if (tier3Result.action === "promote") {
        this.logger.info("fingerprint.tier3.promote", {
          requestId,
          sessionId: managed.sessionId,
          data: {
            action: tier3Result.action,
            reason: tier3Result.decision.reason,
            score: tier3Result.decision.score,
            threshold: {
              windowSize: tier3Config.canary.windowSize,
              minSamples: tier3Config.canary.minSamples,
              promoteThreshold: tier3Config.canary.promoteThreshold,
              rollbackThreshold: tier3Config.canary.rollbackThreshold
            },
            canary: {
              level: tier3.canary.level,
              averageScore: tier3.canary.averageScore,
              sampleCount: tier3.canary.samples.length
            },
            targetClass,
            scoreWindow,
            thresholdComparison,
            source: signalSource
          }
        });
      }
    }

    managed.fingerprint.tier2 = tier2;
    managed.fingerprint.tier3 = tier3;
    managed.fingerprint.lastAppliedNetworkSeq = pendingEvents[pendingEvents.length - 1]?.seq ?? managed.fingerprint.lastAppliedNetworkSeq;

    if (tier3.enabled && tier3.status === "fallback") {
      managed.fingerprint.tier2 = {
        ...tier2,
        enabled: resolveTier3FallbackTarget(tier3.fallbackTier) === "tier2"
      };
    }
  }

  private attachContinuousFingerprintSignals(managed: ManagedSession): void {
    if (this.networkSignalSubscriptions.has(managed.sessionId)) {
      return;
    }

    const unsubscribe = managed.networkTracker.subscribe((event) => {
      const applyTier2 = this.isContinuousSignalsEnabled(this.config.fingerprint.tier2)
        && this.config.fingerprint.tier2.enabled;
      const applyTier3 = this.isContinuousSignalsEnabled(this.config.fingerprint.tier3)
        && this.config.fingerprint.tier3.enabled
        && applyTier2;
      if (!applyTier2 && !applyTier3) {
        return;
      }

      this.applyFingerprintSignals(managed, [event], createRequestId(), {
        applyTier2,
        applyTier3,
        source: "continuous"
      });
    });

    this.networkSignalSubscriptions.set(managed.sessionId, unsubscribe);
  }

  private isContinuousSignalsEnabled(config: { enabled: boolean }): boolean {
    const runtimeConfig = config as { continuousSignals?: unknown };
    if (typeof runtimeConfig.continuousSignals === "boolean") {
      return runtimeConfig.continuousSignals;
    }
    return true;
  }

  private resolveCanaryTargetClass(url: string, status?: number): string {
    if (!this.config.canary?.targets?.enabled) {
      return "disabled";
    }
    if (typeof status === "number" && status >= 400) {
      return "error_surface";
    }

    const lowered = url.toLowerCase();
    if (/(captcha|challenge|auth|login|verify|cf_chl)/.test(lowered)) {
      return "high_friction";
    }
    return "standard";
  }

  private buildCanaryScoreWindow(
    samples: Tier3RuntimeState["canary"]["samples"]
  ): {
    sampleCount: number;
    averageScore: number;
    minScore: number;
    maxScore: number;
    latestScore: number | null;
  } {
    if (samples.length === 0) {
      return {
        sampleCount: 0,
        averageScore: 0,
        minScore: 0,
        maxScore: 0,
        latestScore: null
      };
    }

    let minScore = Number.POSITIVE_INFINITY;
    let maxScore = Number.NEGATIVE_INFINITY;
    let totalScore = 0;
    for (const sample of samples) {
      totalScore += sample.score;
      minScore = Math.min(minScore, sample.score);
      maxScore = Math.max(maxScore, sample.score);
    }

    return {
      sampleCount: samples.length,
      averageScore: totalScore / samples.length,
      minScore: Number.isFinite(minScore) ? minScore : 0,
      maxScore: Number.isFinite(maxScore) ? maxScore : 0,
      latestScore: samples[samples.length - 1]?.score ?? null
    };
  }

  private buildFingerprintSummary(managed: ManagedSession): {
    tier1: {
      ok: boolean;
      warnings: string[];
      issues: Tier1CoherenceResult["issues"];
    };
    tier2: {
      enabled: boolean;
      mode: Tier2RuntimeState["mode"];
      profileId: string;
      healthScore: number;
      challengeCount: number;
      rotationCount: number;
      lastRotationTs: number;
      lastAppliedNetworkSeq: number;
      recentChallenges: Tier2RuntimeState["challengeEvents"];
    };
    tier3: {
      enabled: boolean;
      status: Tier3RuntimeState["status"];
      adapterName: string;
      fallbackTier: Tier3RuntimeState["fallbackTier"];
      fallbackReason?: string;
      canary: {
        level: number;
        averageScore: number;
        lastAction: string;
        sampleCount: number;
      };
    };
  } {
    return {
      tier1: {
        ok: managed.fingerprint.tier1.ok,
        warnings: managed.fingerprint.tier1.warnings,
        issues: managed.fingerprint.tier1.issues
      },
      tier2: {
        enabled: managed.fingerprint.tier2.enabled,
        mode: managed.fingerprint.tier2.mode,
        profileId: managed.fingerprint.tier2.profile.id,
        healthScore: managed.fingerprint.tier2.profile.healthScore,
        challengeCount: managed.fingerprint.tier2.profile.challengeCount,
        rotationCount: managed.fingerprint.tier2.profile.rotationCount,
        lastRotationTs: managed.fingerprint.tier2.lastRotationTs,
        lastAppliedNetworkSeq: managed.fingerprint.lastAppliedNetworkSeq,
        recentChallenges: managed.fingerprint.tier2.challengeEvents.slice(-5)
      },
      tier3: {
        enabled: managed.fingerprint.tier3.enabled,
        status: managed.fingerprint.tier3.status,
        adapterName: managed.fingerprint.tier3.adapterName,
        fallbackTier: managed.fingerprint.tier3.fallbackTier,
        ...(managed.fingerprint.tier3.fallbackReason
          ? { fallbackReason: managed.fingerprint.tier3.fallbackReason }
          : {}),
        canary: {
          level: managed.fingerprint.tier3.canary.level,
          averageScore: managed.fingerprint.tier3.canary.averageScore,
          lastAction: managed.fingerprint.tier3.canary.lastAction,
          sampleCount: managed.fingerprint.tier3.canary.samples.length
        }
      }
    };
  }

  private latestStatus(
    events: Array<{ status?: number }>
  ): number | undefined {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const status = events[index]?.status;
      if (typeof status === "number") {
        return status;
      }
    }
    return undefined;
  }

  private recentNetworkEvents(managed: ManagedSession): ReturnType<NetworkTracker["poll"]>["events"] {
    const max = this.config.blockerArtifactCaps.maxNetworkEvents;
    return managed.networkTracker.poll(undefined, max).events;
  }

  private extractNetworkHosts(events: Array<{ url?: string }>): string[] {
    const hosts: string[] = [];
    const seen = new Set<string>();
    for (const event of events) {
      if (typeof event.url !== "string") continue;
      try {
        const host = new URL(event.url).hostname.toLowerCase();
        if (!host || seen.has(host)) continue;
        seen.add(host);
        hosts.push(host);
        if (hosts.length >= this.config.blockerArtifactCaps.maxHosts) break;
      } catch {
        // Ignore invalid/partial URLs in debug events.
      }
    }
    return hosts;
  }

  private buildTargetKey(managed: ManagedSession, url?: string): string {
    const targetId = managed.targets.getActiveTargetId() ?? "unknown";
    const host = (() => {
      if (!url) return "";
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    return `${targetId}:${host}`;
  }

  private isEnvLimitedVerifierError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /extension not connected|connect the extension|not available in this environment|operation not permitted|eperm/i.test(message);
  }

  private isTimeoutVerifierError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /timed out|timeout/i.test(message);
  }

  private markVerifierFailure(sessionId: string, error: unknown): void {
    if (!this.store.has(sessionId)) {
      return;
    }
    const next = this.store.markVerificationFailure(sessionId, {
      envLimited: this.isEnvLimitedVerifierError(error),
      timedOut: this.isTimeoutVerifierError(error)
    });
    if (next?.resolution?.status === "deferred") {
      this.challengeCoordinator.defer(sessionId);
    }
  }

  reserveExternalBlockerSlot(sessionId: string): void {
    this.store.reserveBlockerSlot(sessionId);
  }

  releaseExternalBlockerSlot(sessionId: string): void {
    this.challengeCoordinator.release(sessionId);
    this.store.releaseBlockerSlot(sessionId);
  }

  reconcileExternalBlockerMeta(
    sessionId: string,
    input: {
      source: "navigation" | "network";
      url?: string;
      finalUrl?: string;
      title?: string;
      status?: number;
      message?: string;
      traceRequestId?: string;
      networkEvents?: Array<{ url?: string; status?: number }>;
      consoleEvents?: unknown[];
      exceptionEvents?: unknown[];
      verifier?: boolean;
      includeArtifacts?: boolean;
      envLimited?: boolean;
      ownerLeaseId?: string;
      suspendedIntent?: SuspendedIntentSummary;
      targetKey?: string;
    }
  ): (BrowserResponseMeta & {
    blockerArtifacts?: ReturnType<typeof buildBlockerArtifacts>;
  }) | undefined {
    if (!this.store.hasBlockerSlot(sessionId)) {
      return undefined;
    }
    const now = Date.now();
    if (input.verifier) {
      this.store.startResolving(sessionId, now);
    }
    const networkEvents = input.networkEvents ?? [];
    const blocker = classifyBlockerSignal({
      source: input.source,
      url: input.url,
      finalUrl: input.finalUrl,
      title: input.title,
      status: input.status,
      message: input.message,
      matchedPatterns: this.config.fingerprint.tier2.challengePatterns,
      networkHosts: this.extractNetworkHosts(networkEvents),
      traceRequestId: input.traceRequestId,
      envLimited: input.envLimited,
      promptGuardEnabled: this.config.security.promptInjectionGuard?.enabled ?? true,
      threshold: this.config.blockerDetectionThreshold
    });
    this.store.reconcileBlocker(sessionId, blocker, {
      timeoutMs: this.config.blockerResolutionTimeoutMs,
      verifier: input.verifier,
      targetKey: input.targetKey,
      nowMs: now
    });
    const summary = this.store.getBlockerSummary(sessionId);
    const artifacts = input.includeArtifacts && summary.state !== "clear"
      ? buildBlockerArtifacts({
        networkEvents: networkEvents as unknown[],
        consoleEvents: input.consoleEvents,
        exceptionEvents: input.exceptionEvents,
        promptGuardEnabled: this.config.security.promptInjectionGuard?.enabled ?? true,
        caps: this.config.blockerArtifactCaps
      })
      : undefined;
    return this.syncChallengeMeta(sessionId, {
      blockerState: summary.state,
      ...(summary.blocker ? { blocker: summary.blocker } : {}),
      ...(summary.updatedAt ? { blockerUpdatedAt: summary.updatedAt } : {}),
      ...(summary.resolution ? { blockerResolution: summary.resolution } : {}),
      ...(artifacts ? { blockerArtifacts: artifacts } : {})
    }, {
      ownerSurface: "ops",
      ownerLeaseId: input.ownerLeaseId,
      resumeMode: "manual",
      suspendedIntent: input.suspendedIntent,
      preservedSessionId: sessionId,
      preservedTargetId: input.targetKey
    });
  }

  private isChallengeLifecycleBlocker(
    blocker: BlockerSignalV1 | undefined
  ): blocker is BlockerSignalV1 & { type: "auth_required" | "anti_bot_challenge" } {
    return blocker?.type === "auth_required" || blocker?.type === "anti_bot_challenge";
  }

  private syncChallengeMeta(
    sessionId: string,
    meta: BrowserResponseMeta | undefined,
    context: {
      ownerSurface: ChallengeOwnerSurface;
      ownerLeaseId?: string;
      resumeMode: ResumeMode;
      suspendedIntent?: SuspendedIntentSummary;
      preservedSessionId?: string;
      preservedTargetId?: string;
    }
  ): BrowserResponseMeta | undefined {
    if (!meta) {
      return undefined;
    }
    if (this.isChallengeLifecycleBlocker(meta.blocker) && meta.blockerState !== "clear") {
      const challenge = this.challengeCoordinator.claimOrRefresh({
        sessionId,
        blockerType: meta.blocker.type,
        reasonCode: meta.blocker.reasonCode,
        ownerSurface: context.ownerSurface,
        ownerLeaseId: context.ownerLeaseId,
        resumeMode: context.resumeMode,
        suspendedIntent: context.suspendedIntent,
        preservedSessionId: context.preservedSessionId,
        preservedTargetId: context.preservedTargetId
      });
      return {
        ...meta,
        challenge
      };
    }

    if (meta.blockerResolution?.status === "deferred") {
      const challenge = this.challengeCoordinator.defer(sessionId);
      return challenge ? { ...meta, challenge } : meta;
    }

    if (meta.blockerResolution?.status === "resolved") {
      const resolved = this.challengeCoordinator.resolve(sessionId) ?? this.challengeCoordinator.getSummary(sessionId);
      const released = this.challengeCoordinator.release(sessionId) ?? resolved;
      return released ? { ...meta, challenge: released } : meta;
    }

    if (meta.blockerState === "clear") {
      const released = this.challengeCoordinator.release(sessionId);
      return released ? { ...meta, challenge: released } : meta;
    }

    const challenge = this.challengeCoordinator.getSummary(sessionId);
    return challenge ? { ...meta, challenge } : meta;
  }

  private reconcileSessionBlocker(
    sessionId: string,
    managed: ManagedSession,
    input: {
      source: "navigation" | "network";
      url?: string;
      finalUrl?: string;
      title?: string;
      status?: number;
      message?: string;
      providerErrorCode?: string;
      traceRequestId?: string;
      networkEvents?: Array<{ url?: string; status?: number }>;
      consoleEvents?: unknown[];
      exceptionEvents?: unknown[];
      verifier?: boolean;
      includeArtifacts?: boolean;
      envLimited?: boolean;
      restrictedTarget?: boolean;
      ownerSurface?: ChallengeOwnerSurface;
      ownerLeaseId?: string;
      resumeMode?: ResumeMode;
      suspendedIntent?: SuspendedIntentSummary;
    }
  ): (BrowserResponseMeta & {
    blockerArtifacts?: ReturnType<typeof buildBlockerArtifacts>;
  }) | undefined {
    if (!this.store.hasBlockerSlot(sessionId)) {
      return undefined;
    }

    const now = Date.now();
    if (input.verifier) {
      this.store.startResolving(sessionId, now);
    }

    const networkEvents = input.networkEvents ?? this.recentNetworkEvents(managed);
    const blocker = classifyBlockerSignal({
      source: input.source,
      url: input.url,
      finalUrl: input.finalUrl,
      title: input.title,
      status: input.status,
      providerErrorCode: input.providerErrorCode,
      message: input.message,
      matchedPatterns: this.config.fingerprint.tier2.challengePatterns,
      networkHosts: this.extractNetworkHosts(networkEvents),
      traceRequestId: input.traceRequestId,
      envLimited: input.envLimited,
      restrictedTarget: input.restrictedTarget,
      promptGuardEnabled: this.config.security.promptInjectionGuard?.enabled ?? true,
      threshold: this.config.blockerDetectionThreshold
    });

    this.store.reconcileBlocker(sessionId, blocker, {
      timeoutMs: this.config.blockerResolutionTimeoutMs,
      verifier: input.verifier,
      targetKey: this.buildTargetKey(managed, input.finalUrl ?? input.url),
      nowMs: now
    });

    const summary = this.store.getBlockerSummary(sessionId);
    const artifacts = input.includeArtifacts && summary.state !== "clear"
      ? buildBlockerArtifacts({
        networkEvents: networkEvents as unknown[],
        consoleEvents: input.consoleEvents,
        exceptionEvents: input.exceptionEvents,
        promptGuardEnabled: this.config.security.promptInjectionGuard?.enabled ?? true,
        caps: this.config.blockerArtifactCaps
      })
      : undefined;

    const meta = this.syncChallengeMeta(sessionId, {
      blockerState: summary.state,
      ...(summary.blocker ? { blocker: summary.blocker } : {}),
      ...(summary.updatedAt ? { blockerUpdatedAt: summary.updatedAt } : {}),
      ...(summary.resolution ? { blockerResolution: summary.resolution } : {}),
      ...(artifacts ? { blockerArtifacts: artifacts } : {})
    }, {
      ownerSurface: input.ownerSurface ?? "direct_browser",
      ownerLeaseId: input.ownerLeaseId,
      resumeMode: input.resumeMode ?? "manual",
      suspendedIntent: input.suspendedIntent,
      preservedSessionId: sessionId,
      preservedTargetId: managed.targets.getActiveTargetId() ?? undefined
    });

    return meta;
  }

  private async maybeOrchestrateChallenge(
    sessionId: string,
    targetId: string | null | undefined,
    meta: BrowserResponseMeta | undefined
  ): Promise<BrowserResponseMeta | undefined> {
    if (!meta || !meta.challenge || meta.blockerState === "clear") {
      return meta;
    }
    if (!this.challengeOrchestrator) {
      return meta;
    }
    const policy = resolveChallengeAutomationPolicy({
      sessionMode: this.getSessionChallengeAutomationMode(sessionId),
      configMode: this.config.providers?.challengeOrchestration.mode ?? "browser_with_helper"
    });
    if (this.isChallengeAutomationSuppressed(sessionId)) {
      return {
        ...meta,
        challengeOrchestration: {
          challengeId: meta.challenge.challengeId,
          classification: meta.blocker?.type === "auth_required"
            ? "auth_required"
            : "unsupported_third_party_challenge",
          mode: policy.mode,
          source: policy.source,
          lane: "defer",
          status: "deferred",
          reason: "Challenge automation is suppressed while a bounded challenge action is already in progress.",
          attempts: 0,
          reusedExistingSession: false,
          reusedCookies: false,
          standDownReason: "suppressed_by_manager",
          helperEligibility: {
            allowed: false,
            reason: "Challenge automation is currently suppressed by the manager guard.",
            standDownReason: "suppressed_by_manager"
          },
          verification: {
            status: "still_blocked",
            blockerState: meta.blockerState,
            blocker: meta.blocker,
            challenge: meta.challenge,
            changed: false,
            reason: "Challenge automation is currently suppressed by the manager guard.",
            url: undefined,
            title: undefined
          },
          evidence: {
            loginRefs: [],
            humanVerificationRefs: [],
            checkpointRefs: []
          }
        }
      };
    }
    try {
      const result = await this.challengeOrchestrator.orchestrate({
        handle: this.createChallengeRuntimeHandle(),
        sessionId,
        targetId,
        policy,
        canImportCookies: true
      });
      const verification = result.action.verification;
      return {
        ...meta,
        blocker: verification.blocker,
        blockerState: verification.blockerState,
        blockerResolution: verification.bundle?.blockerResolution ?? meta.blockerResolution,
        challenge: verification.challenge ?? verification.bundle?.challenge ?? meta.challenge,
        challengeOrchestration: result.outcome
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("challenge.orchestration.failed", {
        requestId: "challenge-orchestration",
        sessionId,
        data: { message }
      });
      return meta;
    }
  }

  private validateCookieRecord(cookie: CookieImportRecord): {
    valid: boolean;
    reason: string;
    cookie: CookieImportRecord;
  } {
    const name = cookie.name?.trim();
    if (!name) {
      return { valid: false, reason: "Cookie name is required.", cookie };
    }
    if (!/^[^\s;=]+$/.test(name)) {
      return { valid: false, reason: `Invalid cookie name: ${cookie.name}.`, cookie };
    }

    if (typeof cookie.value !== "string") {
      return { valid: false, reason: `Invalid cookie value for ${name}.`, cookie };
    }

    const value = cookie.value;
    if (/[\u0000-\u001F\u007F\uFFFD;]/.test(value)) {
      return { valid: false, reason: `Invalid cookie value for ${name}.`, cookie };
    }

    const hasUrl = typeof cookie.url === "string" && cookie.url.trim().length > 0;
    const hasDomain = typeof cookie.domain === "string" && cookie.domain.trim().length > 0;
    if (!hasUrl && !hasDomain) {
      return { valid: false, reason: `Cookie ${name} requires url or domain.`, cookie };
    }

    let normalizedUrl: string | undefined;
    if (hasUrl) {
      try {
        const parsedUrl = new URL(cookie.url as string);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          return { valid: false, reason: `Cookie ${name} url must be http(s).`, cookie };
        }
        normalizedUrl = parsedUrl.toString();
      } catch {
        return { valid: false, reason: `Cookie ${name} has invalid url.`, cookie };
      }
    }

    let normalizedDomain: string | undefined;
    if (hasDomain) {
      normalizedDomain = String(cookie.domain).trim().toLowerCase();
      if (!/^\.?[a-z0-9.-]+$/.test(normalizedDomain)) {
        return { valid: false, reason: `Cookie ${name} has invalid domain.`, cookie };
      }
      if (normalizedDomain.includes("..")) {
        return { valid: false, reason: `Cookie ${name} has invalid domain.`, cookie };
      }
    }

    const normalizedPath = typeof cookie.path === "string" ? cookie.path.trim() : undefined;
    if (typeof normalizedPath === "string" && !normalizedPath.startsWith("/")) {
      return { valid: false, reason: `Cookie ${name} path must start with '/'.`, cookie };
    }

    if (typeof cookie.expires !== "undefined") {
      if (!Number.isFinite(cookie.expires)) {
        return { valid: false, reason: `Cookie ${name} has invalid expires.`, cookie };
      }
      if ((cookie.expires as number) < -1) {
        return { valid: false, reason: `Cookie ${name} has invalid expires.`, cookie };
      }
    }

    if (cookie.sameSite === "None" && cookie.secure !== true) {
      return { valid: false, reason: `Cookie ${name} with SameSite=None must set secure=true.`, cookie };
    }

    // Playwright expects either URL-form cookies or domain+path cookies.
    // For URL-form cookies, avoid forcing a synthetic path to preserve runtime compatibility.
    const normalizedCookie: CookieImportRecord = {
      name,
      value,
      ...(typeof cookie.expires === "number" ? { expires: cookie.expires } : {}),
      ...(typeof cookie.httpOnly === "boolean" ? { httpOnly: cookie.httpOnly } : {}),
      ...(typeof cookie.secure === "boolean" ? { secure: cookie.secure } : {}),
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
    };

    if (normalizedDomain) {
      normalizedCookie.domain = normalizedDomain;
      normalizedCookie.path = normalizedPath ?? "/";
    } else if (normalizedUrl) {
      normalizedCookie.url = normalizedUrl;
    }

    return {
      valid: true,
      reason: "",
      cookie: normalizedCookie
    };
  }

  private normalizeCookieListUrls(urls?: string[]): string[] | undefined {
    if (!urls || urls.length === 0) {
      return undefined;
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const input of urls) {
      const trimmed = input.trim();
      if (!trimmed) {
        throw new Error("Cookie list urls must be non-empty strings.");
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmed);
      } catch {
        throw new Error(`Cookie list url is invalid: ${trimmed}`);
      }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error(`Cookie list url must be http(s): ${trimmed}`);
      }

      const normalizedUrl = parsedUrl.toString();
      if (seen.has(normalizedUrl)) {
        continue;
      }
      seen.add(normalizedUrl);
      normalized.push(normalizedUrl);
    }

    return normalized.length > 0 ? normalized : undefined;
  }

  private buildOverrideSession(input: { browser: Browser; context: BrowserContext; targets: TargetManager }): ManagedSession {
    const refStore = new RefStore();
    const fingerprint = this.initializeFingerprintState("override", this.config.profile, this.config.flags);
    return {
      sessionId: "override",
      mode: "managed",
      headless: true,
      extensionLegacy: false,
      browser: input.browser,
      context: input.context,
      profileDir: "",
      persistProfile: true,
      targets: input.targets,
      refStore,
      snapshotter: new Snapshotter(refStore),
      consoleTracker: new ConsoleTracker(200, { showFullConsole: this.config.devtools.showFullConsole }),
      exceptionTracker: new ExceptionTracker(200),
      networkTracker: new NetworkTracker(300, { showFullUrls: this.config.devtools.showFullUrls }),
      fingerprint,
      authProvenance: this.createInitialAuthProvenance("managed_profile")
    };
  }

  private getManaged(sessionId: string): ManagedSession {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new Error(`[invalid_session] Unknown sessionId: ${sessionId}`);
    }
    return managed;
  }

  private resolveModeVariant(managed: ManagedSession): ParallelModeVariant {
    if (managed.mode === "managed") {
      return managed.headless ? "managedHeadless" : "managedHeaded";
    }
    if (managed.mode === "cdpConnect") {
      return managed.headless ? "cdpConnectHeadless" : "cdpConnectHeaded";
    }
    return managed.extensionLegacy ? "extensionLegacyCdpHeaded" : "extensionOpsHeaded";
  }

  private clearSessionParallelState(sessionId: string): void {
    const state = this.sessionParallel.get(sessionId);
    if (state) {
      for (const waiter of state.waiters) {
        if (waiter.timer) {
          clearTimeout(waiter.timer);
          waiter.timer = null;
        }
        waiter.reject(new Error("Session closed while waiting for parallelism slot."));
      }
      state.waiters.length = 0;
      state.waitingByTarget.clear();
      this.sessionParallel.delete(sessionId);
    }
    for (const key of this.targetQueues.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.targetQueues.delete(key);
      }
    }
  }

  private screencastTargetKey(sessionId: string, targetId: string): string {
    return `${sessionId}:${targetId}`;
  }

  private assertNoActiveScreencast(sessionId: string, targetId: string): void {
    if (this.screencastIdsByTarget.has(this.screencastTargetKey(sessionId, targetId))) {
      throw new Error(`Screencast already active for target ${targetId}.`);
    }
  }

  private trackScreencast(recorder: BrowserScreencastRecorder): void {
    const { screencastId, sessionId, targetId } = recorder;
    this.activeScreencasts.set(screencastId, recorder);
    this.screencastIdsByTarget.set(this.screencastTargetKey(sessionId, targetId), screencastId);
    const sessionScreencasts = this.screencastIdsBySession.get(sessionId) ?? new Set<string>();
    sessionScreencasts.add(screencastId);
    this.screencastIdsBySession.set(sessionId, sessionScreencasts);
  }

  private observeTrackedScreencast(recorder: BrowserScreencastRecorder): void {
    const { screencastId, sessionId, targetId } = recorder;
    void recorder.resultPromise.then((result) => {
      this.storeCompletedScreencast(result);
    }).catch((error: unknown) => {
      this.logger.warn("screencast.result.failed", {
        sessionId,
        data: {
          screencastId,
          targetId,
          error: error instanceof Error ? error.message : String(error)
        }
      });
      this.clearTrackedScreencast(screencastId);
    });
  }

  private storeCompletedScreencast(result: BrowserScreencastResult): void {
    this.completedScreencasts.set(result.screencastId, result);
    this.scheduleCompletedScreencastCleanup(result);
    const listeners = this.screencastCompletionListeners.get(result.screencastId);
    if (listeners) {
      for (const listener of listeners) {
        listener(result);
      }
      this.screencastCompletionListeners.delete(result.screencastId);
    }
    this.clearTrackedScreencast(result.screencastId);
  }

  private scheduleCompletedScreencastCleanup(result: BrowserScreencastResult): void {
    this.clearCompletedScreencastCleanup(result.screencastId);
    const timer = setTimeout(() => {
      if (this.completedScreencasts.get(result.screencastId) === result) {
        this.completedScreencasts.delete(result.screencastId);
      }
      this.completedScreencastCleanupTimers.delete(result.screencastId);
    }, SCREENCAST_RETENTION_MS);
    timer.unref?.();
    this.completedScreencastCleanupTimers.set(result.screencastId, timer);
  }

  private clearCompletedScreencastCleanup(screencastId: string): void {
    const timer = this.completedScreencastCleanupTimers.get(screencastId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.completedScreencastCleanupTimers.delete(screencastId);
  }

  private evictCompletedScreencast(screencastId: string): void {
    this.clearCompletedScreencastCleanup(screencastId);
    this.completedScreencasts.delete(screencastId);
  }

  private clearTrackedScreencast(screencastId: string): void {
    const recorder = this.activeScreencasts.get(screencastId);
    if (!recorder) {
      return;
    }
    this.activeScreencasts.delete(screencastId);
    this.screencastIdsByTarget.delete(this.screencastTargetKey(recorder.sessionId, recorder.targetId));
    const sessionScreencasts = this.screencastIdsBySession.get(recorder.sessionId);
    if (!sessionScreencasts) {
      return;
    }
    sessionScreencasts.delete(screencastId);
    if (sessionScreencasts.size === 0) {
      this.screencastIdsBySession.delete(recorder.sessionId);
    }
  }

  private async finalizeSessionScreencasts(sessionId: string): Promise<void> {
    const ids = [...(this.screencastIdsBySession.get(sessionId) ?? [])];
    const results = await Promise.allSettled(ids.map(async (screencastId) => {
      const recorder = this.activeScreencasts.get(screencastId);
      if (!recorder) {
        return;
      }
      this.storeCompletedScreencast(await recorder.stop("session_closed"));
    }));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      throw failure.reason;
    }
  }

  private async finalizeTargetScreencast(sessionId: string, targetId: string): Promise<void> {
    const screencastId = this.screencastIdsByTarget.get(this.screencastTargetKey(sessionId, targetId));
    if (!screencastId) {
      return;
    }
    const recorder = this.activeScreencasts.get(screencastId);
    if (!recorder) {
      this.screencastIdsByTarget.delete(this.screencastTargetKey(sessionId, targetId));
      return;
    }
    this.storeCompletedScreencast(await recorder.stop("target_closed"));
  }

  private resolveTargetId(
    managed: ManagedSession,
    targetId: string | null | undefined
  ): string {
    const resolvedTargetId = targetId ?? managed.targets.getActiveTargetId();
    if (!resolvedTargetId) {
      throw new Error("No active target");
    }
    return resolvedTargetId;
  }

  private resolveTargetContext(
    managed: ManagedSession,
    targetId: string | null | undefined
  ): { targetId: string; page: Page } {
    const resolvedTargetId = this.resolveTargetId(managed, targetId);
    return {
      targetId: resolvedTargetId,
      page: managed.targets.getPage(resolvedTargetId)
    };
  }

  private refreshGovernorSnapshot(sessionId: string): ParallelismGovernorSnapshot {
    const state = this.getParallelState(sessionId);
    const now = Date.now();
    const oldestWaiter = state.waiters[0];
    const queueAgeMs = oldestWaiter ? Math.max(0, now - oldestWaiter.enqueuedAt) : 0;
    const queueDepth = state.waiters.length;
    const lastSampleAt = state.governor.lastSampleAt;
    const sampleIntervalMs = this.config.parallelism.sampleIntervalMs;
    if (lastSampleAt > 0 && now - lastSampleAt < sampleIntervalMs) {
      state.lastSnapshot = {
        ...state.lastSnapshot,
        waitQueueAgeMs: queueAgeMs,
        waitQueueDepth: queueDepth
      };
      return state.lastSnapshot;
    }

    const hostTotal = totalmem();
    const hostFreePct = hostTotal > 0 ? (freemem() / hostTotal) * 100 : 100;
    const rssPct = rssUsagePercent(process.memoryUsage().rss, this.config.parallelism.rssBudgetMb);
    const snapshot = evaluateGovernor(
      this.config.parallelism,
      state.governor,
      {
        hostFreeMemPct: hostFreePct,
        rssUsagePct: rssPct,
        queueAgeMs,
        queueDepth
      },
      now
    );
    state.governor = snapshot.state;
    state.lastSnapshot = snapshot;
    return snapshot;
  }

  private createBackpressureError(
    sessionId: string,
    targetId: string,
    timeoutMs: number,
    snapshot: ParallelismGovernorSnapshot,
    inflight: number
  ): Error {
    const info: BackpressureErrorInfo = {
      code: "parallelism_backpressure",
      classification: "timeout",
      sessionId,
      targetId,
      modeVariant: snapshot.state.modeVariant,
      effectiveParallelCap: snapshot.state.effectiveCap,
      inFlight: inflight,
      waitQueueDepth: snapshot.waitQueueDepth,
      waitQueueAgeMs: snapshot.waitQueueAgeMs,
      pressure: snapshot.pressure,
      timeoutMs
    };
    const error = new Error(`Parallelism cap reached for target ${targetId}; retry later.`);
    (error as Error & { code: string; details: BackpressureErrorInfo }).code = info.code;
    (error as Error & { code: string; details: BackpressureErrorInfo }).details = info;
    return error;
  }

  private wakeWaiters(sessionId: string): void {
    const state = this.sessionParallel.get(sessionId);
    if (!state) {
      return;
    }
    this.refreshGovernorSnapshot(sessionId);
    while (state.waiters.length > 0 && state.inflight < state.governor.effectiveCap) {
      const waiter = state.waiters.shift();
      if (!waiter) {
        break;
      }
      const queueForTarget = state.waitingByTarget.get(waiter.targetId);
      if (queueForTarget && queueForTarget.length > 0) {
        queueForTarget.shift();
        if (queueForTarget.length === 0) {
          state.waitingByTarget.delete(waiter.targetId);
        }
      }
      if (waiter.timer) {
        clearTimeout(waiter.timer);
        waiter.timer = null;
      }
      state.inflight += 1;
      waiter.resolve();
    }
  }

  private async acquireParallelSlot(sessionId: string, targetId: string, timeoutMs: number): Promise<void> {
    const state = this.getParallelState(sessionId);
    this.refreshGovernorSnapshot(sessionId);
    if (state.inflight < state.governor.effectiveCap && state.waiters.length === 0) {
      state.inflight += 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const enqueuedAt = Date.now();
      const waiter: ParallelWaiter = {
        targetId,
        enqueuedAt,
        timeoutMs,
        resolve,
        reject,
        timer: null
      };
      const byTarget = state.waitingByTarget.get(targetId) ?? [];
      byTarget.push(enqueuedAt);
      state.waitingByTarget.set(targetId, byTarget);
      waiter.timer = setTimeout(() => {
        const index = state.waiters.indexOf(waiter);
        if (index >= 0) {
          state.waiters.splice(index, 1);
        }
        const queueForTarget = state.waitingByTarget.get(targetId);
        if (queueForTarget && queueForTarget.length > 0) {
          queueForTarget.shift();
          if (queueForTarget.length === 0) {
            state.waitingByTarget.delete(targetId);
          }
        }
        const snapshot = this.refreshGovernorSnapshot(sessionId);
        reject(this.createBackpressureError(sessionId, targetId, timeoutMs, snapshot, state.inflight));
      }, timeoutMs);
      state.waiters.push(waiter);
      this.refreshGovernorSnapshot(sessionId);
      this.wakeWaiters(sessionId);
    });
  }

  private releaseParallelSlot(sessionId: string): void {
    const state = this.sessionParallel.get(sessionId);
    if (!state) {
      return;
    }
    state.inflight = Math.max(0, state.inflight - 1);
    this.wakeWaiters(sessionId);
  }

  private targetQueueKey(sessionId: string, targetId: string): string {
    return `${sessionId}:${targetId}`;
  }

  private async runTargetScoped<T>(
    sessionId: string,
    targetId: string | null | undefined,
    execute: (ctx: { managed: ManagedSession; targetId: string; page: Page }) => Promise<T>,
    timeoutMs = this.config.parallelism.backpressureTimeoutMs
  ): Promise<T> {
    const managed = this.getManaged(sessionId);
    const resolvedTargetId = this.resolveTargetId(managed, targetId);
    const queueKey = this.targetQueueKey(sessionId, resolvedTargetId);
    const previous = this.targetQueues.get(queueKey) ?? Promise.resolve();
    let releaseQueue: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const tail = previous.then(() => gate, () => gate);
    this.targetQueues.set(queueKey, tail);

    let slotAcquired = false;
    try {
      await withBrowserOperationTimeout(
        previous,
        timeoutMs,
        `Target operation queue wait timed out after ${timeoutMs}ms.`
      );
      await this.acquireParallelSlot(sessionId, resolvedTargetId, timeoutMs);
      slotAcquired = true;
      const resolved = this.resolveTargetContext(managed, resolvedTargetId);
      return await execute({
        managed,
        targetId: resolved.targetId,
        page: resolved.page
      });
    } finally {
      if (slotAcquired) {
        this.releaseParallelSlot(sessionId);
      }
      releaseQueue();
      void tail.finally(() => {
        if (this.targetQueues.get(queueKey) === tail) {
          this.targetQueues.delete(queueKey);
        }
      });
    }
  }

  private async runDialogScoped<T>(
    sessionId: string,
    targetId: string | null | undefined,
    execute: (ctx: { managed: ManagedSession; targetId: string; page: Page }) => Promise<T>
  ): Promise<T> {
    const managed = this.getManaged(sessionId);
    const resolved = this.resolveTargetContext(managed, targetId);
    const key = this.dialogKey(sessionId, resolved.targetId);
    const serializer = this.dialogSerializers.get(key) ?? new Mutex();
    this.dialogSerializers.set(key, serializer);
    return await serializer.runExclusive(async () => await execute({
      managed,
      targetId: resolved.targetId,
      page: resolved.page
    }));
  }

  private async runStructural<T>(sessionId: string, execute: () => Promise<T>): Promise<T> {
    const state = this.getParallelState(sessionId);
    return state.structural.runExclusive(execute);
  }

  private resolveRefEntry(managed: ManagedSession, ref: string): ResolvedManagedRef {
    const targetId = managed.targets.getActiveTargetId();
    if (!targetId) {
      throw new Error("No active target for ref resolution");
    }
    return this.resolveRefEntryForTarget(managed, ref, targetId);
  }

  private resolveRefEntryForTarget(
    managed: ManagedSession,
    ref: string,
    targetId: string
  ): ResolvedManagedRef {
    const entry = managed.refStore.resolve(targetId, ref);
    if (!entry) {
      throw this.buildStaleSnapshotError(ref);
    }
    return {
      targetId,
      ref,
      selector: entry.selector,
      backendNodeId: entry.backendNodeId,
      snapshotId: entry.snapshotId,
      ...(entry.frameId ? { frameId: entry.frameId } : {})
    };
  }

  private resolveSelector(managed: ManagedSession, ref: string, targetId?: string): string {
    if (targetId) {
      return this.resolveRefEntryForTarget(managed, ref, targetId).selector;
    }
    return this.resolveRefEntry(managed, ref).selector;
  }

  private buildStaleSnapshotError(ref: string): Error {
    return new Error(`Unknown ref: ${ref}. Take a new snapshot first.`);
  }

  private isSnapshotStaleError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (message.includes("Take a new snapshot first.")) {
      return true;
    }
    const normalized = message.toLowerCase();
    return (
      normalized.includes("no node with given id")
      || normalized.includes("could not find node with given id")
      || normalized.includes("cannot find object with id")
      || normalized.includes("cannot find context with specified id")
      || normalized.includes("execution context was destroyed")
      || normalized.includes("inspected target navigated or closed")
    );
  }

  private async withResolvedRefSession<T>(
    managed: ManagedSession,
    resolved: ResolvedManagedRef,
    execute: (session: CDPSession) => Promise<T>
  ): Promise<T> {
    const page = managed.targets.getPage(resolved.targetId);
    const session = await managed.context.newCDPSession(page);
    try {
      return await execute(session);
    } catch (error) {
      if (this.isSnapshotStaleError(error)) {
        throw this.buildStaleSnapshotError(resolved.ref);
      }
      throw error;
    } finally {
      try {
        await session.detach();
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  private async callFunctionOnResolvedRef<T>(
    managed: ManagedSession,
    ref: string,
    functionDeclaration: string,
    args: unknown[] = [],
    targetId?: string
  ): Promise<T> {
    const resolvedTargetId = targetId ?? managed.targets.getActiveTargetId();
    if (!resolvedTargetId) {
      throw new Error("No active target for ref resolution");
    }
    const resolved = this.resolveRefEntryForTarget(managed, ref, resolvedTargetId);
    return await this.withResolvedRefSession(
      managed,
      resolved,
      async (session) => await this.callFunctionOnRefContextWithSession<T>(session, resolved, functionDeclaration, args)
    );
  }

  private async evaluateDomStateByBackendNode<T>(
    managed: ManagedSession,
    ref: string,
    functionDeclaration: string,
    args: unknown[] = [],
    targetId?: string
  ): Promise<T> {
    return await this.callFunctionOnResolvedRef<T>(managed, ref, functionDeclaration, args, targetId);
  }

  private async callFunctionOnRefContextWithSession<T>(
    session: CDPSession,
    resolved: ResolvedManagedRef,
    functionDeclaration: string,
    args: unknown[] = []
  ): Promise<T> {
    const node = await session.send("DOM.resolveNode", {
      backendNodeId: resolved.backendNodeId
    }) as { object?: { objectId?: string } };
    const objectId = node.object?.objectId;
    if (!objectId) {
      throw this.buildStaleSnapshotError(resolved.ref);
    }

    const evaluated = await session.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true
    }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };

    if (evaluated.exceptionDetails) {
      const message = typeof evaluated.exceptionDetails.text === "string"
        ? evaluated.exceptionDetails.text
        : "Runtime.callFunctionOn failed";
      throw new Error(message);
    }

    return evaluated.result?.value as T;
  }

  private async waitForResolvedRefState(
    managed: ManagedSession,
    ref: string,
    state: "attached" | "visible" | "hidden",
    timeoutMs: number,
    targetId?: string
  ): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const snapshot = await this.callFunctionOnResolvedRef<{ attached?: unknown; visible?: unknown }>(
        managed,
        ref,
        DOM_SELECTOR_STATE_DECLARATION,
        [],
        targetId
      );
      const attached = snapshot?.attached === true;
      const visible = snapshot?.visible === true;
      if (state === "attached" && attached) {
        return;
      }
      if (state === "visible" && visible) {
        return;
      }
      if (state === "hidden" && (!attached || !visible)) {
        return;
      }
      await delay(200);
    }
    throw new Error("Wait for selector timed out");
  }

  private async resolveRefPointForTarget(
    managed: ManagedSession,
    ref: string,
    targetId?: string
  ): Promise<{ x: number; y: number }> {
    const resolvedTargetId = targetId ?? managed.targets.getActiveTargetId();
    if (!resolvedTargetId) {
      throw new Error("No active target for ref resolution");
    }
    const resolved = this.resolveRefEntryForTarget(managed, ref, resolvedTargetId);
    return await this.withResolvedRefSession(managed, resolved, async (session) => {
      try {
        const boxModel = await session.send("DOM.getBoxModel", {
          backendNodeId: resolved.backendNodeId
        }) as { model?: { content?: number[]; border?: number[] } };
        const quad = Array.isArray(boxModel.model?.content) && boxModel.model.content.length >= 8
          ? boxModel.model.content
          : (Array.isArray(boxModel.model?.border) && boxModel.model.border.length >= 8
            ? boxModel.model.border
            : null);
        if (quad) {
          const [x1, y1, x2, y2, x3, y3, x4, y4] = quad;
          const coordinates = [x1, y1, x2, y2, x3, y3, x4, y4];
          if (coordinates.every((value): value is number => typeof value === "number" && Number.isFinite(value))) {
            const xs: [number, number, number, number] = [coordinates[0]!, coordinates[2]!, coordinates[4]!, coordinates[6]!];
            const ys: [number, number, number, number] = [coordinates[1]!, coordinates[3]!, coordinates[5]!, coordinates[7]!];
            return {
              x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
              y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2)
            };
          }
        }
      } catch (error) {
        if (this.isSnapshotStaleError(error)) {
          throw this.buildStaleSnapshotError(ref);
        }
      }

      const point = await this.callFunctionOnRefContextWithSession<{ x?: unknown; y?: unknown }>(
        session,
        resolved,
        DOM_REF_POINT_DECLARATION
      );
      const x = typeof point?.x === "number" && Number.isFinite(point.x) ? Math.round(point.x) : null;
      const y = typeof point?.y === "number" && Number.isFinite(point.y) ? Math.round(point.y) : null;
      if (x === null || y === null) {
        throw new Error(`Could not resolve a clickable point for ref: ${ref}`);
      }
      return { x, y };
    });
  }

  private async clickResolvedRef(
    managed: ManagedSession,
    page: Page,
    ref: string,
    targetId: string
  ): Promise<void> {
    await this.callFunctionOnResolvedRef<void>(managed, ref, DOM_SCROLL_INTO_VIEW_DECLARATION, [], targetId);
    const point = await this.resolveRefPointForTarget(managed, ref, targetId);
    let resolveDialogHandled: () => void = () => {};
    let resolveCompleted: () => void = () => {};
    const pendingClick: PendingManagedClick = {
      dialogOpened: false,
      dialogHandled: new Promise<void>((resolve) => {
        resolveDialogHandled = resolve;
      }),
      resolveDialogHandled: () => {
        resolveDialogHandled();
      },
      completed: new Promise<void>((resolve) => {
        resolveCompleted = resolve;
      }),
      resolveCompleted: () => {
        resolveCompleted();
      }
    };
    this.pendingManagedClicks.set(this.dialogKey(managed.sessionId, targetId), pendingClick);
    try {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down({ button: "left", clickCount: 1 });
      const mouseUpPromise = page.mouse.up({ button: "left", clickCount: 1 });
      await this.waitForManagedClickCompletion(mouseUpPromise, pendingClick);
    } finally {
      pendingClick.resolveCompleted();
      this.clearPendingManagedClick(managed.sessionId, targetId);
    }
  }

  private async waitForManagedClickCompletion(
    mouseUpPromise: Promise<void>,
    pendingClick: PendingManagedClick
  ): Promise<void> {
    const completion = await Promise.race([
      mouseUpPromise.then(() => "mouse_up" as const),
      pendingClick.dialogHandled.then(() => "dialog_handled" as const)
    ]);
    if (completion === "dialog_handled") {
      await mouseUpPromise;
    }
  }

  private normalizeScreenshotClip(
    value: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null,
    ref: string
  ): { x: number; y: number; width: number; height: number } {
    const x = typeof value?.x === "number" && Number.isFinite(value.x) ? value.x : null;
    const y = typeof value?.y === "number" && Number.isFinite(value.y) ? value.y : null;
    const width = typeof value?.width === "number" && Number.isFinite(value.width) ? value.width : null;
    const height = typeof value?.height === "number" && Number.isFinite(value.height) ? value.height : null;
    if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
      throw new Error(`Could not resolve screenshot bounds for ref: ${ref}`);
    }
    return { x, y, width, height };
  }

  private dialogKey(sessionId: string, targetId: string): string {
    return `${sessionId}:${targetId}`;
  }

  private getPendingManagedClick(sessionId: string, targetId: string): PendingManagedClick | null {
    return this.pendingManagedClicks.get(this.dialogKey(sessionId, targetId)) ?? null;
  }

  private getPendingDialog(sessionId: string, targetId: string): PendingManagedDialog | null {
    return this.pendingDialogs.get(this.dialogKey(sessionId, targetId)) ?? null;
  }

  private getDialogState(sessionId: string, targetId?: string | null): BrowserDialogState | undefined {
    if (!targetId) {
      return undefined;
    }
    return this.getPendingDialog(sessionId, targetId)?.state ?? { open: false, targetId };
  }

  private clearPendingDialog(sessionId: string, targetId: string): void {
    const key = this.dialogKey(sessionId, targetId);
    this.pendingDialogs.delete(key);
    this.dialogSerializers.delete(key);
  }

  private clearPendingManagedClick(sessionId: string, targetId: string): void {
    this.pendingManagedClicks.delete(this.dialogKey(sessionId, targetId));
  }

  private clearSessionDialogs(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.pendingDialogs.keys()) {
      if (key.startsWith(prefix)) {
        this.pendingDialogs.delete(key);
      }
    }
    for (const key of this.dialogSerializers.keys()) {
      if (key.startsWith(prefix)) {
        this.dialogSerializers.delete(key);
      }
    }
  }

  private clearSessionManagedClicks(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const [key, pendingClick] of this.pendingManagedClicks.entries()) {
      if (key.startsWith(prefix)) {
        pendingClick.resolveDialogHandled();
        pendingClick.resolveCompleted();
        this.pendingManagedClicks.delete(key);
      }
    }
  }

  private buildProfileLockLaunchMessage(launchMessage: string, profileDir: string): string | null {
    const normalized = launchMessage.toLowerCase();
    const profileLock = normalized.includes("singletonlock")
      || normalized.includes("processsingleton")
      || normalized.includes("profile in use")
      || normalized.includes("already in use")
      || normalized.includes("user data directory is already in use");
    if (!profileLock) {
      return null;
    }
    const sanitizedLaunchMessage = this.sanitizeProfileLockLaunchMessage(launchMessage, profileDir);
    return [
      "Failed to launch browser context: browser profile is locked by another process.",
      `Profile path hash: ${this.hashProfilePathForMessage(profileDir)}.`,
      "Retry with a unique profile (--profile <name>) or disable persistence (--persist-profile false).",
      `Original error: ${sanitizedLaunchMessage}`
    ].join(" ");
  }

  private hashProfilePathForMessage(profileDir: string): string {
    return createHash("sha256")
      .update(profileDir)
      .digest("hex")
      .slice(0, PROFILE_LOCK_MESSAGE_PATH_HASH_LENGTH);
  }

  private sanitizeProfileLockLaunchMessage(launchMessage: string, profileDir: string): string {
    const profileRedacted = launchMessage.split(profileDir).join("[profile-path-redacted]");
    const homeRedacted = profileRedacted.split(homedir()).join("[home-path-redacted]");
    return homeRedacted
      .replace(/\/Users\/[^)\s'"]+/g, "[path-redacted]")
      .replace(/\/private\/tmp\/[^)\s'"]+/g, "[path-redacted]")
      .replace(/\/var\/folders\/[^)\s'"]+/g, "[path-redacted]")
      .replace(/[A-Za-z]:\\Users\\[^)\s'"]+/g, "[path-redacted]");
  }

  private async safeManagedPageTitle(
    managed: Pick<ManagedSession, "extensionLegacy"> | undefined,
    page: Page | null,
    context: string
  ): Promise<string | undefined> {
    if (this.shouldSkipPageTitleProbe(managed, page)) {
      return undefined;
    }
    return await this.safePageTitle(page, context);
  }

  private async safePageTitle(page: Page | null, context: string): Promise<string | undefined> {
    if (!page || page.isClosed()) return undefined;
    try {
      const titleAttempt = page.title()
        .then((value) => ({ status: "ok" as const, value }))
        .catch(() => ({ status: "error" as const }));
      const result = await Promise.race([
        titleAttempt,
        delay(2000).then(() => ({ status: "timeout" as const }))
      ]);
      if (result.status === "timeout") {
        console.warn(`${context}: timed out reading page title`);
        return undefined;
      }
      if (result.status === "error") {
        console.warn(`${context}: failed to read page title`);
        return undefined;
      }
      return result.value;
    } catch {
      console.warn(`${context}: failed to read page title`);
      return undefined;
    }
  }

  private shouldSkipPageTitleProbe(
    managed: Pick<ManagedSession, "extensionLegacy"> | undefined,
    page: Page | null
  ): boolean {
    if (!page || page.isClosed()) {
      return false;
    }
    return managed?.extensionLegacy ?? false;
  }

  private safePageUrl(page: Page | null, context: string): string | undefined {
    if (!page) return undefined;
    try {
      return page.url();
    } catch {
      console.warn(`${context}: failed to read page url`);
      return undefined;
    }
  }

  private async recoverAndRebindLegacyTarget(
    managed: ManagedSession,
    targetId: string,
    timeoutMs: number,
    failedPage?: Page
  ): Promise<Page | null> {
    const replacementPage = await this.recoverLegacyExtensionPage(
      managed,
      timeoutMs,
      async () => {
        const nextPage = await this.createExtensionPage(managed, "goto");
        try {
          await this.waitForExtensionTargetReady(nextPage, "goto", Math.min(timeoutMs, 5000));
        } catch (error) {
          if (
            !this.isExtensionTargetReadyTimeout(error)
            && !this.isLegacyClosedTargetError(managed, error)
          ) {
            throw error;
          }
        }
        return nextPage;
      },
      failedPage
    );
    if (!replacementPage) {
      return null;
    }

    let previousPage: Page | null = null;
    try {
      previousPage = managed.targets.getPage(targetId);
    } catch {
      previousPage = null;
    }
    if (previousPage && previousPage !== replacementPage) {
      const cleanup = this.pageListeners.get(previousPage);
      if (cleanup) {
        cleanup();
        this.pageListeners.delete(previousPage);
      }
    }

    const replacementCleanup = this.pageListeners.get(replacementPage);
    if (replacementCleanup) {
      replacementCleanup();
      this.pageListeners.delete(replacementPage);
    }

    managed.refStore.clearTarget(targetId);
    managed.targets.replacePage(targetId, replacementPage);
    managed.targets.setActiveTarget(targetId);
    this.attachRefInvalidationForPage(managed, targetId, replacementPage);
    this.attachTrackers(managed);
    return replacementPage;
  }

  private async recoverLegacyExtensionPage(
    managed: ManagedSession,
    timeoutMs: number,
    createExtensionPage: () => Promise<Page>,
    failedPage?: Page
  ): Promise<Page | null> {
    const stable = this.selectExistingExtensionEntry(managed, undefined, failedPage)?.page;
    if (stable) {
      return stable;
    }

    const replacementPage = await waitForPage(managed.context, Math.min(timeoutMs, 3000));
    if (replacementPage && !replacementPage.isClosed()) {
      try {
        managed.targets.syncPages(managed.context.pages());
      } catch {
        // Best-effort sync only.
      }
      const synced = this.selectExistingExtensionEntry(managed, undefined, failedPage)?.page;
      if (synced) {
        this.attachRefInvalidation(managed);
        this.attachTrackers(managed);
        return synced;
      }
    }

    const reconnectedPage = await this.reconnectLegacyExtensionSession(managed, timeoutMs);
    if (reconnectedPage) {
      return reconnectedPage;
    }

    try {
      return await createExtensionPage();
    } catch (error) {
      if (!this.isTargetNotAllowedError(error) && !this.isLegacyClosedTargetError(managed, error)) {
        throw error;
      }
    }

    return await this.reconnectLegacyExtensionSession(managed, timeoutMs);
  }

  private async reconnectLegacyExtensionSession(managed: ManagedSession, timeoutMs: number): Promise<Page | null> {
    if (!managed.extensionLegacy || !managed.relayWsEndpoint) {
      return null;
    }

    let browser: Browser | null = null;
    const previousBrowser = managed.browser;
    try {
      const chromium = await loadChromium();
      const { connectEndpoint, relayPort } = await this.resolveRelayEndpoints(managed.relayWsEndpoint);
      await previousBrowser.close().catch(() => {});
      await this.waitForRelayCdpSlot(managed.relayWsEndpoint, relayPort, Math.min(timeoutMs, 5000));
      browser = await chromium.connectOverCDP(connectEndpoint);
      const context = browser.contexts()[0] ?? null;
      if (!context) {
        return null;
      }
      const page = await waitForPage(context, Math.min(timeoutMs, 5000));
      if (!page) {
        return null;
      }

      for (const entry of managed.targets.listPageEntries()) {
        const cleanup = this.pageListeners.get(entry.page);
        if (cleanup) {
          cleanup();
          this.pageListeners.delete(entry.page);
        }
        managed.refStore.clearTarget(entry.targetId);
      }
      managed.consoleTracker.detach();
      managed.exceptionTracker.detach();
      managed.networkTracker.detach();

      const targets = new TargetManager();
      const pages = context.pages();
      if (pages.length > 0) {
        targets.registerExistingPages(pages);
      } else {
        targets.registerPage(page);
      }
      for (const entry of targets.listPageEntries()) {
        try {
          const currentUrl = entry.page.url();
          if (currentUrl.startsWith("http://") || currentUrl.startsWith("https://")) {
            targets.setActiveTarget(entry.targetId);
            break;
          }
        } catch {
          // Ignore pages that cannot report a URL.
        }
      }

      managed.browser = browser;
      managed.context = context;
      managed.targets = targets;
      this.attachRefInvalidation(managed);
      this.attachTrackers(managed);

      return managed.targets.getActivePage();
    } catch {
      if (browser) {
        await browser.close().catch(() => {});
      }
      return null;
    }
  }

  private async createExtensionPage(managed: ManagedSession, context: string): Promise<Page> {
    try {
      return await managed.context.newPage();
    } catch (error) {
      if (managed.mode !== "extension" || !this.isDetachedFrameError(error)) {
        throw error;
      }
    }

    await delay(200);

    try {
      return await managed.context.newPage();
    } catch (error) {
      throw this.describeExtensionFailure(context, error, managed);
    }
  }

  private async navigatePage(
    page: Page,
    url: string,
    waitUntil: "domcontentloaded" | "load" | "networkidle",
    timeoutMs: number,
    managed?: ManagedSession
  ): Promise<{ response: Awaited<ReturnType<Page["goto"]>> | undefined; finalUrl?: string }> {
    try {
      return { response: await page.goto(url, { waitUntil, timeout: timeoutMs }) };
    } catch (error) {
      const html = this.decodeHtmlDataUrl(url);
      if (!html || !(this.isNavigationAbortError(error) || this.isNavigationTimeoutError(error))) {
        throw error;
      }
      // Some Chrome relay targets abort `data:text/html` navigations even though the HTML is valid.
      // Falling back to `setContent` keeps preview rendering on the same canonical payload.
      await this.resetPageForHtmlFallback(page, timeoutMs);
      try {
        await page.setContent(html, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 5000) });
      } catch {
        await this.resetPageForHtmlFallback(page, timeoutMs);
        await this.writeHtmlDocument(managed, page, html);
      }
      if (waitUntil !== "domcontentloaded") {
        await page.waitForLoadState(waitUntil, { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);
      }
      return { response: undefined, finalUrl: url };
    }
  }

  private async resetPageForHtmlFallback(page: Page, timeoutMs: number): Promise<void> {
    await page.goto("about:blank", {
      waitUntil: "domcontentloaded",
      timeout: Math.min(timeoutMs, 5000)
    }).catch(() => undefined);
  }

  private async writeHtmlDocument(managed: ManagedSession | undefined, page: Page, html: string): Promise<void> {
    if (managed) {
      const session = await managed.context.newCDPSession(page);
      try {
        const tree = await session.send("Page.getFrameTree") as { frameTree?: { frame?: { id?: string } } };
        const frameId = tree.frameTree?.frame?.id;
        if (typeof frameId === "string" && frameId.length > 0) {
          await session.send("Page.setDocumentContent", { frameId, html });
          return;
        }
      } catch {
        // Fall through to the runtime write fallback.
      } finally {
        await session.detach().catch(() => undefined);
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await page.evaluate((nextHtml) => {
          document.open();
          document.write(nextHtml);
          document.close();
        }, html);
        return;
      } catch (error) {
        if (!this.isExecutionContextDestroyedError(error) || attempt === 4) {
          throw error;
        }
        await delay(250);
      }
    }
  }

  private async waitForExtensionTargetReady(page: Page, context: string, timeoutMs = 5000): Promise<void> {
    const currentUrl = this.safePageUrl(page, `BrowserManager.${context}`);
    if (currentUrl && currentUrl !== "about:blank" && !currentUrl.startsWith("chrome://") && !currentUrl.startsWith("chrome-extension://")) {
      return;
    }
    const deadline = Date.now() + timeoutMs;
    let lastError: string | null = null;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new Error(`EXTENSION_TARGET_READY_CLOSED: ${context} page closed before navigation.`);
      }
      try {
        const frame = page.mainFrame();
        if (!frame.isDetached()) {
          const remaining = Math.max(250, Math.min(750, deadline - Date.now()));
          await frame.waitForLoadState("domcontentloaded", { timeout: remaining });
          return;
        }
      } catch (error) {
        if (this.isDetachedFrameError(error)) {
          lastError = error instanceof Error ? error.message : String(error);
        } else if (error instanceof Error && error.name === "TimeoutError") {
          // Continue polling until deadline.
        } else {
          throw error;
        }
      }
      await delay(100);
    }

    const detail = lastError ? ` Last error: ${lastError}` : "";
    throw new Error(`EXTENSION_TARGET_READY_TIMEOUT: ${context} exceeded ${timeoutMs}ms.${detail}`);
  }

  private isDetachedFrameError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Frame has been detached");
  }

  private isClosedTargetError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Target page, context or browser has been closed");
  }

  private isNavigationAbortError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("ERR_ABORTED");
  }

  private isNavigationTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("page.goto: Timeout");
  }

  private isExecutionContextDestroyedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Execution context was destroyed")
      || message.includes("Cannot find context with specified id");
  }

  private isScreenshotTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("page.screenshot: Timeout");
  }

  private isLegacyUnknownSessionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Unknown sessionId:");
  }

  private isLegacyClosedTargetError(managed: ManagedSession, error: unknown): boolean {
    return managed.extensionLegacy && (
      this.isClosedTargetError(error)
      || this.isLegacyUnknownSessionError(error)
      || this.isExtensionTargetReadyClosed(error)
    );
  }

  private isTargetNotAllowedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Target.createTarget") && message.includes("Not allowed");
  }

  private isExtensionTargetReadyTimeout(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.startsWith("EXTENSION_TARGET_READY_TIMEOUT");
  }

  private isExtensionTargetReadyClosed(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.startsWith("EXTENSION_TARGET_READY_CLOSED");
  }

  private describeExtensionFailure(context: string, error: unknown, managed: ManagedSession): Error {
    const message = error instanceof Error ? error.message : String(error);
    let url: string | undefined;
    try {
      url = this.safePageUrl(managed.targets.getActivePage(), `BrowserManager.${context}`);
    } catch {
      url = undefined;
    }
    const urlInfo = url ? ` Active tab: ${url}.` : "";
    return new Error(`Extension mode ${context} failed. Focus a stable http(s) tab and retry.${urlInfo} ${message}`);
  }

  private decodeHtmlDataUrl(url: string): string | null {
    if (!url.startsWith("data:text/html")) {
      return null;
    }
    const separator = url.indexOf(",");
    if (separator < 0) {
      return null;
    }
    const metadata = url.slice(0, separator).toLowerCase();
    const payload = url.slice(separator + 1);
    try {
      return metadata.includes(";base64")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
    } catch {
      return null;
    }
  }

  private selectExistingExtensionEntry(
    managed: ManagedSession,
    preferredTargetId?: string | null,
    failedPage?: Page
  ): { targetId: string; page: Page } | null {
    try {
      managed.targets.syncPages(managed.context.pages());
    } catch {
      // Best-effort sync only.
    }

    const entries = managed.targets.listPageEntries().filter((entry) => !entry.page.isClosed() && entry.page !== failedPage);
    if (entries.length === 0) {
      return null;
    }

    if (preferredTargetId) {
      const preferred = entries.find((entry) => entry.targetId === preferredTargetId);
      if (preferred) {
        managed.targets.setActiveTarget(preferred.targetId);
        return preferred;
      }
    }

    const stable = entries.find((entry) => {
      try {
        const candidateUrl = entry.page.url();
        return candidateUrl.startsWith("http://") || candidateUrl.startsWith("https://");
      } catch {
        return false;
      }
    }) ?? entries[0]!;

    managed.targets.setActiveTarget(stable.targetId);
    return stable;
  }

  private syncTargetsAfterAction(managed: ManagedSession, openerTargetId: string): void {
    try {
      const existingPages = new Set(managed.targets.listPageEntries().map((entry) => entry.page));
      managed.targets.syncPages(managed.context.pages(), {
        newTargetMetadataForPage: (candidatePage): TargetOwnershipMetadata | undefined => {
          if (existingPages.has(candidatePage)) {
            return undefined;
          }
          const url = this.safePageUrl(candidatePage, "BrowserManager.syncTargetsAfterAction");
          return {
            openerTargetId,
            lifecycleState: "open",
            popupKind: inferTargetPopupKind({ url }),
            ownershipSource: "action_sync",
            ...(url ? { safeUrlSummary: buildSafeTargetUrlSummary(url) } : {})
          };
        }
      });
    } catch (error) {
      this.logger.warn("targets.action_sync.failed", {
        sessionId: managed.sessionId,
        data: {
          message: error instanceof Error ? error.message : "Unknown target sync failure"
        }
      });
    }
  }

  private async captureScreenshotViaCdp(
    managed: ManagedSession,
    page: Page,
    error: unknown,
    options: BrowserScreenshotOptions
  ): Promise<{ base64: string; warnings?: string[] } | null> {
    if (!managed.extensionLegacy || !this.isScreenshotTimeoutError(error) || options.fullPage || options.ref) {
      return null;
    }
    const session = await managed.context.newCDPSession(page);
    try {
      const result = await session.send("Page.captureScreenshot", { format: "png" }) as { data?: string };
      if (typeof result.data !== "string" || result.data.length === 0) {
        return null;
      }
      return {
        base64: result.data,
        warnings: ["cdp_capture_fallback"]
      };
    } catch {
      return null;
    } finally {
      await session.detach().catch(() => undefined);
    }
  }

  private selectStableExtensionEntry(
    managed: ManagedSession,
    preferredTargetId?: string | null
  ): { targetId: string; page: Page } | null {
    try {
      managed.targets.syncPages(managed.context.pages());
    } catch {
      // Best-effort sync only.
    }

    const entries = managed.targets.listPageEntries().filter((entry) => !entry.page.isClosed());
    if (entries.length === 0) {
      return null;
    }

    if (preferredTargetId) {
      const preferred = entries.find((entry) => entry.targetId === preferredTargetId);
      if (preferred) {
        try {
          const candidateUrl = preferred.page.url();
          if (candidateUrl.startsWith("http://") || candidateUrl.startsWith("https://")) {
            managed.targets.setActiveTarget(preferred.targetId);
            return preferred;
          }
        } catch {
          // Ignore pages that cannot report a URL.
        }
      }
    }

    const stable = entries.find((entry) => {
      try {
        const candidateUrl = entry.page.url();
        return candidateUrl.startsWith("http://") || candidateUrl.startsWith("https://");
      } catch {
        return false;
      }
    }) ?? null;

    if (!stable) {
      return null;
    }

    managed.targets.setActiveTarget(stable.targetId);
    return stable;
  }

  private attachTrackers(managed: ManagedSession): void {
    const activeTargetId = managed.targets.getActiveTargetId();
    if (!activeTargetId) return;
    const page = managed.targets.getActivePage();
    managed.consoleTracker.attach(page);
    managed.exceptionTracker.attach(page);
    managed.networkTracker.attach(page);
  }

  private attachRefInvalidation(managed: ManagedSession): void {
    const entries = managed.targets.listPageEntries();
    for (const entry of entries) {
      this.attachRefInvalidationForPage(managed, entry.targetId, entry.page);
    }
  }

  private attachRefInvalidationForPage(managed: ManagedSession, targetId: string, page: Page): void {
    if (this.pageListeners.has(page)) return;

    const clearTargetRefs = () => {
      managed.refStore.clearTarget(targetId);
    };

    const clearTargetDialog = () => {
      this.clearPendingDialog(managed.sessionId, targetId);
    };

    const onNavigate = (frame?: { parentFrame?: () => unknown }) => {
      if (typeof frame?.parentFrame === "function" && frame.parentFrame()) {
        return;
      }
      clearTargetRefs();
      clearTargetDialog();
    };

    const onClose = () => {
      clearTargetRefs();
      clearTargetDialog();
      void this.finalizeTargetScreencast(managed.sessionId, targetId).catch((error: unknown) => {
        this.logger.warn("screencast.target_close.failed", {
          sessionId: managed.sessionId,
          data: {
            screencastId: this.screencastIdsByTarget.get(this.screencastTargetKey(managed.sessionId, targetId)),
            targetId,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      });
    };

    const onFrameDetached = (frame?: { parentFrame?: () => unknown }) => {
      if (typeof frame?.parentFrame === "function" && frame.parentFrame()) {
        return;
      }
      clearTargetRefs();
      clearTargetDialog();
    };

    const onDialog = (dialog: Dialog) => {
      const pendingClick = this.getPendingManagedClick(managed.sessionId, targetId);
      if (pendingClick) {
        pendingClick.dialogOpened = true;
      }
      this.pendingDialogs.set(this.dialogKey(managed.sessionId, targetId), {
        dialog,
        state: {
          open: true,
          targetId,
          type: dialog.type() as BrowserDialogState["type"],
          message: dialog.message(),
          defaultPrompt: dialog.defaultValue(),
          url: this.safePageUrl(page, "BrowserManager.dialog"),
          openedAt: new Date().toISOString()
        }
      });
    };

    page.on("framenavigated", onNavigate);
    page.on("framedetached", onFrameDetached);
    page.on("close", onClose);
    page.on("dialog", onDialog);

    this.pageListeners.set(page, () => {
      page.off("framenavigated", onNavigate);
      page.off("framedetached", onFrameDetached);
      page.off("close", onClose);
      page.off("dialog", onDialog);
    });
  }

  private requireExplicitCdpProfileId(profile: string): string {
    const profileId = sanitizeSessionProfileId(profile);
    if (RESERVED_CDP_PROFILE_IDS.has(profileId)) {
      throw new Error("Explicit CDP profiles must use a named non-default OpenDevBrowser profile.");
    }
    return profileId;
  }

  private async readExplicitCdpProfile(profile: string): Promise<SessionProfileRecord | null> {
    const profileId = sanitizeSessionProfileId(profile);
    const cachePaths = await resolveCachePaths(this.worktree, profileId);
    const registry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
    return registry.read(profileId);
  }

  private async resolveExplicitCdpProfile(profile: string): Promise<ResolvedExplicitCdpProfile> {
    const profileId = this.requireExplicitCdpProfileId(profile);
    const cachePaths = await resolveCachePaths(this.worktree, profileId);
    const registry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
    const record = registry.read(profileId);
    if (!record) {
      throw new Error(`No OpenDevBrowser CDP profile record exists for profile "${profileId}". Run cdp-profile start first.`);
    }
    const wsEndpoint = await this.requireLiveExplicitCdpProfileEndpoint(record);
    await this.requireExplicitCdpLaunchToken(record, cachePaths.profileDir);
    const lease = record.lease;
    if (!lease?.pid || !lease.port) {
      throw new Error("Explicit CDP profile record is missing a live OpenDevBrowser lease. Run cdp-profile start again.");
    }
    if (!isExplicitCdpProcessOwnedByProfile(lease.pid, cachePaths.profileDir, lease.port)) {
      throw new Error("Recorded OpenDevBrowser CDP profile process could not be verified as profile-owned. Run cdp-profile start again.");
    }
    return { record, wsEndpoint };
  }

  private async requireLiveExplicitCdpProfileEndpoint(record: SessionProfileRecord): Promise<string> {
    if (record.kind !== "explicit_cdp_profile" || record.scope !== "explicit_local_cdp") {
      throw new Error("Refusing CDP profile attach because the registry record is not an explicit local CDP profile.");
    }
    const endpoint = record.endpoint;
    const lease = record.lease;
    if (!endpoint || !lease?.pid || !lease.port) {
      throw new Error("Explicit CDP profile record is missing a live OpenDevBrowser lease. Run cdp-profile start again.");
    }
    if (lease.port !== endpoint.port) {
      throw new Error("Explicit CDP profile lease does not match the recorded endpoint. Run cdp-profile start again.");
    }
    if (!isProcessAlive(lease.pid)) {
      throw new Error("Recorded OpenDevBrowser CDP profile process is no longer running. Run cdp-profile start again.");
    }
    const currentEndpoint = await probeCdpWsEndpoint(endpoint.port);
    if (!currentEndpoint) {
      throw new Error("Recorded OpenDevBrowser CDP profile endpoint is not live. Run cdp-profile start again.");
    }
    ensureLocalEndpoint(currentEndpoint, this.config.security.allowNonLocalCdp);
    return currentEndpoint;
  }

  private explicitCdpLaunchTokenPath(profileDir: string): string {
    return join(profileDir, CDP_PROFILE_LAUNCH_TOKEN_FILE);
  }

  private async writeExplicitCdpLaunchToken(
    profileDir: string,
    token: ExplicitCdpLaunchTokenProof
  ): Promise<void> {
    await writeFile(
      this.explicitCdpLaunchTokenPath(profileDir),
      `${JSON.stringify(token, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
  }

  private async deleteExplicitCdpLaunchToken(profileDir: string): Promise<void> {
    try {
      await unlink(this.explicitCdpLaunchTokenPath(profileDir));
    } catch (error) {
      if (isNodeErrno(error, "ENOENT")) {
        return;
      }
      this.logger.warn("cdp.profile_launch_token.cleanup_failed", {
        data: {
          errorCode: isNodeErrnoWithCode(error) ? error.code : "unknown"
        }
      });
    }
  }

  private async requireExplicitCdpLaunchToken(
    record: SessionProfileRecord,
    profileDir: string
  ): Promise<void> {
    const token = await this.readExplicitCdpLaunchToken(profileDir);
    if (!token || !this.explicitCdpLaunchTokenMatches(record, token)) {
      throw new Error("Recorded OpenDevBrowser CDP profile launch token does not match the live lease. Refusing to trust this browser.");
    }
  }

  private async readExplicitCdpLaunchToken(profileDir: string): Promise<ExplicitCdpLaunchTokenProof | null> {
    try {
      const raw = await readFile(this.explicitCdpLaunchTokenPath(profileDir), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return this.isExplicitCdpLaunchTokenProof(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private explicitCdpLaunchTokenMatches(
    record: SessionProfileRecord,
    token: ExplicitCdpLaunchTokenProof
  ): boolean {
    const lease = record.lease;
    const endpoint = record.endpoint;
    if (!lease || !endpoint) {
      return false;
    }
    return token.profileId === record.profileId
      && token.launchTokenId === lease.launchTokenId
      && token.port === lease.port
      && token.port === endpoint.port
      && (typeof lease.pid !== "number" || token.pid === lease.pid);
  }

  private isExplicitCdpLaunchTokenProof(value: unknown): value is ExplicitCdpLaunchTokenProof {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return candidate.version === 1
      && typeof candidate.profileId === "string"
      && typeof candidate.launchTokenId === "string"
      && typeof candidate.port === "number"
      && Number.isInteger(candidate.port)
      && candidate.port > 0
      && (candidate.pid === undefined || typeof candidate.pid === "number")
      && typeof candidate.createdAt === "string";
  }

  private async attachCdpTargetOwnership(managed: ManagedSession): Promise<void> {
    const browserWithSession = managed.browser as unknown as {
      newBrowserCDPSession?: () => Promise<CdpTargetOwnershipSession>;
    };
    if (typeof browserWithSession.newBrowserCDPSession !== "function") {
      return;
    }
    try {
      const session = await browserWithSession.newBrowserCDPSession.call(managed.browser);
      const graph = new CdpTargetOwnershipGraph(session, () => {
        this.reconcileCdpTargetOwnership(managed);
      });
      await graph.start();
      managed.cdpTargetOwnership = graph;
      this.reconcileCdpTargetOwnership(managed);
    } catch (error) {
      this.logger.warn("cdp.target_ownership.unavailable", {
        sessionId: managed.sessionId,
        data: {
          error: error instanceof Error ? error.message : "Unknown CDP Target ownership setup failure"
        }
      });
    }
  }

  private reconcileCdpTargetOwnership(managed: ManagedSession): void {
    const graph = managed.cdpTargetOwnership;
    if (!graph) {
      return;
    }
    const entries = graph.entries().filter((entry) => entry.lifecycleState === "open");
    const cdpToTarget = this.mapCdpTargetIds(managed);
    for (const target of managed.targets.listPageEntries()) {
      const current = managed.targets.getTargetMetadata(target.targetId);
      const entry = this.findCdpTargetEntryForPage(target.page, current, entries, cdpToTarget);
      if (!entry) {
        continue;
      }
      const openerTargetId = entry.openerCdpTargetId ? cdpToTarget.get(entry.openerCdpTargetId) : undefined;
      managed.targets.mergeTargetMetadata(target.targetId, metadataFromCdpTargetEntry(entry, openerTargetId));
      cdpToTarget.set(entry.cdpTargetId, target.targetId);
    }
  }

  private mapCdpTargetIds(managed: ManagedSession): Map<string, string> {
    const cdpToTarget = new Map<string, string>();
    for (const target of managed.targets.listPageEntries()) {
      const metadata = managed.targets.getTargetMetadata(target.targetId);
      if (metadata?.cdpTargetId) {
        cdpToTarget.set(metadata.cdpTargetId, target.targetId);
      }
    }
    return cdpToTarget;
  }

  private findCdpTargetEntryForPage(
    page: Page,
    metadata: TargetOwnershipMetadata | null,
    entries: CdpTargetOwnershipEntry[],
    cdpToTarget: Map<string, string>
  ): CdpTargetOwnershipEntry | null {
    if (metadata?.cdpTargetId) {
      return entries.find((entry) => entry.cdpTargetId === metadata.cdpTargetId) ?? null;
    }
    const url = this.safePageUrl(page, "BrowserManager.reconcileCdpTargetOwnership");
    if (!url) {
      return null;
    }
    const matches = entries.filter((entry) => (
      entry.type === "page"
      && entry.url === url
      && !cdpToTarget.has(entry.cdpTargetId)
    ));
    return matches.length === 1 ? matches[0] ?? null : null;
  }

  private async recoverOrRejectExplicitCdpLease(
    registry: ReturnType<typeof createSessionProfileRegistry>,
    record: SessionProfileRecord | null,
    profileId?: string
  ): Promise<void> {
    const lease = record?.lease ?? (profileId ? registry.readLease(profileId) : null);
    const safeProfileId = record?.profileId ?? profileId;
    if (!lease || !safeProfileId) {
      return;
    }
    const pidAlive = typeof lease.pid === "number" && isProcessAlive(lease.pid);
    const portAlive = typeof lease.port === "number"
      && await probeCdpWsEndpoint(lease.port) !== null;
    if (pidAlive || portAlive) {
      throw new Error(`CDP profile "${safeProfileId}" is already running. Use cdp-profile status or cdp-profile stop before starting it again.`);
    }
    registry.releaseLease(safeProfileId, lease.launchTokenId);
  }

  private async resolveWsEndpoint(options: ConnectOptions): Promise<string> {
    if (options.wsEndpoint) {
      ensureLocalEndpoint(options.wsEndpoint, this.config.security.allowNonLocalCdp);
      return options.wsEndpoint;
    }

    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 9222;
    const url = `http://${host}:${port}/json/version`;
    ensureLocalEndpoint(url, this.config.security.allowNonLocalCdp);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch CDP endpoint from ${url}`);
    }

    const data = await response.json() as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error("webSocketDebuggerUrl missing from /json/version response");
    }

    ensureLocalEndpoint(data.webSocketDebuggerUrl, this.config.security.allowNonLocalCdp);

    return data.webSocketDebuggerUrl;
  }

  private async connectWithEndpoint(
    connectWsEndpoint: string,
    mode: BrowserMode,
    reportedWsEndpoint?: string,
    relayPort?: number,
    authOptions?: BrowserAuthSessionOptions,
    explicitCdpProfile?: SessionProfileRecord
  ): Promise<BrowserSessionStartResult> {
    this.assertGoogleAuthIntentAllowedForMode(mode, authOptions?.googleAuthIntent);
    let browser: Browser | null = null;
    const connectAttempts = mode === "extension" ? 3 : 1;
    const sanitizedEndpoint = this.sanitizeWsEndpointForOutput(connectWsEndpoint);
    const connectionLabel = mode === "extension" ? "Relay /cdp" : "Direct CDP";
    const chromium = await loadChromium();
    for (let attempt = 1; attempt <= connectAttempts; attempt += 1) {
      const connectStart = Date.now();
      try {
        browser = await chromium.connectOverCDP(connectWsEndpoint);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const safeMessage = sanitizeCdpConnectErrorMessage(message);
        if (message.includes("401") || message.toLowerCase().includes("unauthorized")) {
          throw new Error(`${connectionLabel} rejected the connection (unauthorized). Check relayToken configuration and ensure clients use the current token.`);
        }
        const staleExtensionTab = mode === "extension" && isExtensionStaleTabAttachError(message);
        const reconnectableExtensionDisconnect = mode === "extension" && isExtensionRelayDisconnectError(message);
        const busyLegacyCdpSlot = mode === "extension" && isExtensionRelaySingleClientError(message);
        if ((staleExtensionTab || reconnectableExtensionDisconnect || busyLegacyCdpSlot) && attempt < connectAttempts) {
          if (relayPort) {
            await this.waitForRelayCdpSlot(reportedWsEndpoint ?? connectWsEndpoint, relayPort);
          } else {
            await delay(attempt * 250);
          }
          continue;
        }
        throw new Error(
          `${connectionLabel} connectOverCDP failed after ${Date.now() - connectStart}ms (mode=${mode}, endpoint=${sanitizedEndpoint}): ${safeMessage}`,
          { cause: error }
        );
      }
    }
    if (!browser) {
      throw new Error(`${connectionLabel} connectOverCDP failed (mode=${mode}, endpoint=${sanitizedEndpoint}).`);
    }
    try {
      const contexts = browser.contexts();
      let context = contexts[0] ?? null;
      if (!context) {
        if (mode === "extension") {
          throw new Error("Extension relay did not expose a browser context. Ensure a normal tab is active and retry.");
        }
        context = await browser.newContext();
      }

      const sessionId = randomUUID();
      const cachePaths = await resolveCachePaths(this.worktree, this.config.profile);
      const targets = new TargetManager();
      const pages = context.pages();

      if (pages.length === 0) {
        if (mode === "extension") {
          const page = await waitForPage(context, 8000);
          if (!page) {
            throw new Error("Extension relay connected but no page was detected. Focus a normal tab and retry.");
          }
          targets.registerPage(page);
        } else {
          const page = await context.newPage();
          targets.registerPage(page);
        }
      } else {
        targets.registerExistingPages(pages);
        const entries = targets.listPageEntries();
        let selected = false;
        for (const entry of entries) {
          try {
            const url = entry.page.url();
            if (url.startsWith("http://") || url.startsWith("https://")) {
              targets.setActiveTarget(entry.targetId);
              selected = true;
              break;
            }
          } catch {
            // Skip pages that cannot report a URL.
          }
        }
        if (!selected && mode === "extension") {
          const newest = entries.at(-1);
          if (newest) {
            targets.setActiveTarget(newest.targetId);
          }
        }
      }

      const refStore = new RefStore();
      const snapshotter = new Snapshotter(refStore);
      const consoleTracker = new ConsoleTracker(200, { showFullConsole: this.config.devtools.showFullConsole });
      const exceptionTracker = new ExceptionTracker(200);
      const networkTracker = new NetworkTracker(300, { showFullUrls: this.config.devtools.showFullUrls });
      const fingerprint = this.initializeFingerprintState(
        sessionId,
        this.config.profile,
        this.config.flags
      );
      const warnings = formatTier1Warnings(fingerprint.tier1);
      const sessionProfile = this.createConnectedSessionProfileSummary({
        cachePaths,
        mode,
        wsEndpoint: reportedWsEndpoint ?? connectWsEndpoint,
        launchTokenId: sessionId,
        explicitCdpProfile
      });
      const authProvenance = this.createInitialAuthProvenance(
        mode === "extension" ? "live_extension_profile" : "cdp_connected_profile",
        authOptions?.googleAuthIntent,
        sessionProfile
      );

      const managed: ManagedSession = {
        sessionId,
        mode,
        headless: false,
        extensionLegacy: mode === "extension",
        relayWsEndpoint: reportedWsEndpoint ?? connectWsEndpoint,
        browser,
        context,
        profileDir: "",
        persistProfile: true,
        targets,
        refStore,
        snapshotter,
        consoleTracker,
        exceptionTracker,
        networkTracker,
        fingerprint,
        authProvenance
      };

      warnings.push(...await this.bootstrapSystemChromeCookies(managed, {
        disabled: authOptions?.disableSystemCookieBootstrap === true,
        allowGoogleCookieBootstrap: authOptions?.allowGoogleCookieBootstrap === true
      }));

      this.store.add({ id: sessionId, mode, browser, context });
      this.sessions.set(sessionId, managed);
      this.attachContinuousFingerprintSignals(managed);
      this.attachTrackers(managed);
      this.attachRefInvalidation(managed);
      await this.attachCdpTargetOwnership(managed);

      if (!fingerprint.tier1.ok) {
        this.logger.warn("fingerprint.tier1.mismatch", {
          sessionId,
          data: { issues: fingerprint.tier1.issues, mode }
        });
      }

      const wsEndpoint = reportedWsEndpoint ?? connectWsEndpoint;
      return {
        sessionId,
        mode,
        activeTargetId: targets.getActiveTargetId(),
        warnings,
        diagnostics: { authProvenance: managed.authProvenance },
        wsEndpoint
      };
    } catch (error) {
      try {
        await browser.close();
      } catch {
        // Best-effort cleanup to avoid orphaned /cdp connections.
      }
      throw error;
    }
  }

  private async resolveRelayEndpoints(wsEndpoint: string): Promise<{ connectEndpoint: string; reportedEndpoint: string; relayPort: number }> {
    const result = await resolveRelayEndpoint({ wsEndpoint, path: "cdp", config: this.config });
    return {
      connectEndpoint: result.connectEndpoint,
      reportedEndpoint: result.reportedEndpoint,
      relayPort: result.relayPort
    };
  }

  private async waitForRelayCdpSlot(wsEndpoint: string, relayPort: number, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.readRelayStatus(wsEndpoint, relayPort);
      if (!status?.cdpConnected) {
        return;
      }
      await delay(100);
    }
  }

  private async readRelayStatus(
    wsEndpoint: string,
    relayPort: number
  ): Promise<Pick<RelayStatus, "opsConnected" | "cdpConnected"> | null> {
    type RelayStatusResponse = {
      ok?: boolean;
      json?: () => Promise<unknown>;
    };

    try {
      const baseUrl = new URL(wsEndpoint);
      const httpProtocol = baseUrl.protocol === "wss:" ? "https:" : "http:";
      const statusUrl = new URL("/status", `${httpProtocol}//${baseUrl.hostname}:${relayPort}`);
      ensureLocalEndpoint(statusUrl.toString(), this.config.security.allowNonLocalCdp);

      const relayToken = typeof this.config.relayToken === "string" ? this.config.relayToken.trim() : "";
      const headers: Record<string, string> = { Accept: "application/json" };
      if (relayToken) {
        headers.Authorization = `Bearer ${relayToken}`;
      }

      const response = await fetch(statusUrl.toString(), { headers }) as unknown as RelayStatusResponse | null | undefined;
      if (response?.ok !== true || typeof response.json !== "function") {
        return null;
      }

      const payload = await response.json() as Partial<RelayStatus>;
      if (typeof payload.opsConnected !== "boolean") {
        return null;
      }
      return {
        opsConnected: payload.opsConnected,
        cdpConnected: payload.cdpConnected === true
      };
    } catch {
      return null;
    }
  }

  private sanitizeWsEndpointForOutput(wsEndpoint: string): string {
    return sanitizeWsEndpoint(wsEndpoint);
  }
}

const waitForPage = async (context: BrowserContext, timeoutMs: number): Promise<Page | null> => {
  const existing = context.pages()[0];
  if (existing) return existing;
  try {
    return await context.waitForEvent("page", { timeout: timeoutMs });
  } catch {
    return context.pages()[0] ?? null;
  }
};

function truncateHtml(value: string, maxChars: number): { outerHTML: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { outerHTML: value, truncated: false };
  }
  return { outerHTML: value.slice(0, maxChars), truncated: true };
}

function readFlagValue(flags: string[], key: string): string | undefined {
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (!flag) continue;
    if (flag === key) {
      const next = flags[index + 1];
      if (next && !next.startsWith("--")) {
        return next;
      }
      continue;
    }
    if (flag.startsWith(`${key}=`)) {
      const value = flag.slice(key.length + 1);
      return value || undefined;
    }
  }
  return undefined;
}

function resolveTier3FallbackTarget(tier: "tier1" | "tier2"): "tier1" | "tier2" {
  return tier;
}

function isExtensionStaleTabAttachError(detail: string): boolean {
  const message = detail.toLowerCase();
  return message.includes("target.setautoattach") && message.includes("no tab with given id");
}

function isExtensionRelayDisconnectError(detail: string): boolean {
  const message = detail.toLowerCase();
  return message.includes("target page, context or browser has been closed")
    && message.includes("extension disconnected");
}

function isExtensionRelaySingleClientError(detail: string): boolean {
  return detail.toLowerCase().includes("only one cdp client supported");
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function reserveLocalPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (port <= 0) {
          reject(new Error("Failed to reserve a local CDP port."));
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function waitForCdpWsEndpoint(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const endpoint = await probeCdpWsEndpoint(port);
    if (endpoint) {
      return endpoint;
    }
    await delay(CDP_PROFILE_START_POLL_MS);
  }
  throw new Error("Timed out waiting for explicit CDP profile remote debugging endpoint.");
}

async function probeCdpWsEndpoint(port: number): Promise<string | null> {
  let data: { webSocketDebuggerUrl?: string };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) {
      return null;
    }
    data = await response.json() as { webSocketDebuggerUrl?: string };
  } catch {
    return null;
  }
  if (!data.webSocketDebuggerUrl) {
    return null;
  }
  ensureLocalEndpoint(data.webSocketDebuggerUrl, false);
  return data.webSocketDebuggerUrl;
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await delay(CDP_PROFILE_STOP_POLL_MS);
  }
  throw new Error("Timed out waiting for OpenDevBrowser-owned CDP browser process to exit.");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeErrno(error, "ESRCH")) {
      return false;
    }
    if (isNodeErrno(error, "EPERM")) {
      return true;
    }
    throw error;
  }
}

function isExplicitCdpProcessOwnedByProfile(
  pid: number,
  profileDir: string,
  port: number
): boolean {
  const commandLine = readProcessCommandLine(pid);
  if (!commandLine) {
    return false;
  }
  return commandLineContainsFlag(commandLine, "--remote-debugging-port", String(port))
    && commandLineContainsFlag(commandLine, "--user-data-dir", profileDir);
}

function readProcessCommandLine(pid: number): string | null {
  if (process.platform === "win32") {
    return null;
  }
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 1000,
      maxBuffer: 16_384
    }).trim();
  } catch {
    return null;
  }
}

function commandLineContainsFlag(
  commandLine: string,
  flag: string,
  value: string
): boolean {
  return commandLine.includes(`${flag}=${value}`)
    || commandLine.includes(`${flag} ${value}`)
    || commandLine.includes(`${flag}="${value}"`)
    || commandLine.includes(`${flag}='${value}'`);
}

async function terminateProcessBestEffort(pid: number | undefined, timeoutMs: number): Promise<void> {
  if (!pid || !isProcessAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    await waitForProcessExit(pid, timeoutMs);
  } catch {
    return;
  }
}

function isNodeErrno(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code;
}

function isNodeErrnoWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object"
    && error !== null
    && typeof (error as { code?: unknown }).code === "string";
}

function sanitizeCdpConnectErrorMessage(message: string): string {
  return message
    .replace(CDP_CONNECT_ERROR_URL_PATTERN, (match) => sanitizeWsEndpoint(match))
    .replace(CDP_CONNECT_ERROR_SECRET_PATTERN, (_match, key: string) => `${key}=[REDACTED]`);
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, maxChars), truncated: true };
}
