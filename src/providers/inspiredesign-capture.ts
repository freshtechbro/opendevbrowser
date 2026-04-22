import type { BrowserManagerLike } from "../browser/manager-types";
import { redactSensitive } from "../core/logging";
import type { ChallengeAutomationMode } from "../challenges/types";
import { readCookiesFromSource } from "./cookie-source";
import type { ProviderCookiePolicy, ProviderCookieSourceConfig } from "./types";
import type {
  InspiredesignCaptureAttemptEvidence,
  InspiredesignCaptureAttemptStatus,
  InspiredesignCaptureAttempts,
  InspiredesignCaptureEvidence
} from "./inspiredesign-contract";

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
  setSessionChallengeAutomationMode?: (sessionId: string, mode?: ChallengeAutomationMode) => void;
};

export type InspiredesignCaptureOptions = {
  timeoutMs?: number;
  useCookies?: boolean;
  challengeAutomationMode?: ChallengeAutomationMode;
  cookiePolicyOverride?: ProviderCookiePolicy;
  cookieSource?: ProviderCookieSourceConfig;
};

type CaptureCookieImportState = {
  sourceConfigured: boolean;
  sourceAvailable: boolean;
  sourceMessage?: string;
};

const INSPIREDESIGN_CAPTURE_TIMEOUT_MS = 30_000;
const INSPIREDESIGN_CAPTURE_MAX_CHARS = 12_000;
const ACTIVE_SESSION_COOKIE_REUSE_UNAVAILABLE_MESSAGE = "Deep capture only honors configured provider cookie sources; active session cookies are not reused.";
const DOM_CAPTURE_HELPER_UNAVAILABLE_MESSAGE = "DOM capture helper unavailable in this execution lane.";
const SNAPSHOT_CAPTURE_EMPTY_MESSAGE = "Snapshot capture returned empty content.";
const CLONE_CAPTURE_EMPTY_MESSAGE = "Clone capture returned empty component and CSS previews.";
const DOM_CAPTURE_EMPTY_MESSAGE = "DOM capture returned empty HTML.";
const SKIPPED_AFTER_TRANSPORT_TIMEOUT_SUFFIX = "transport timeout.";

const createRemainingCaptureTimeout = (timeoutMs: number): (() => number) => {
  const startedAtMs = Date.now();
  return () => Math.max(1, timeoutMs - Math.max(0, Date.now() - startedAtMs));
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

const isTransportTimeoutMessage = (detail: string): boolean => {
  return detail.startsWith("Request timed out after ");
};

const buildSkippedAfterTransportTimeoutAttempt = (
  label: string
): InspiredesignCaptureAttemptEvidence => {
  return buildCaptureAttempt("skipped", `Skipped after ${label} ${SKIPPED_AFTER_TRANSPORT_TIMEOUT_SUFFIX}`);
};

const hasUsableCaptureText = (value: string | undefined): boolean => {
  return typeof value === "string" && value.trim().length > 0;
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
      ...(isTransportTimeoutMessage(detail) ? { transportTimedOut: true } : {})
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
      ...(isTransportTimeoutMessage(detail) ? { transportTimedOut: true } : {})
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
      ...(isTransportTimeoutMessage(detail) ? { transportTimedOut: true } : {})
    };
  }
};

const buildCaptureEvidence = (
  snapshot: CaptureArtifactResult,
  clone: CaptureArtifactResult,
  dom: CaptureArtifactResult
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
  remainingTimeoutMs: () => number
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
  return buildCaptureEvidence(snapshot, clone, dom);
};

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
    await withCaptureDeadline(
      manager.waitForLoad(session.sessionId, "networkidle", waitTimeoutMs).catch(() => undefined),
      waitTimeoutMs,
      "network idle wait"
    );
    return await captureInspiredesignArtifacts(manager, session.sessionId, remainingTimeoutMs);
  } finally {
    await manager.disconnect(session.sessionId, true).catch(() => undefined);
  }
}
