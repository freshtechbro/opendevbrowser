import type { BrowserManagerLike } from "../browser/manager-types";
import { redactSensitive } from "../core/logging";
import type { ChallengeAutomationMode } from "../challenges/types";
import { readCookiesFromSource } from "./cookie-source";
import type { ProviderCookiePolicy, ProviderCookieSourceConfig } from "./types";
import type { InspiredesignCaptureEvidence } from "./inspiredesign-contract";

type InspiredesignCaptureManagerLike = Pick<
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
> & {
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

const createRemainingCaptureTimeout = (timeoutMs: number): (() => number) => {
  const startedAtMs = Date.now();
  return () => Math.max(1, timeoutMs - Math.max(0, Date.now() - startedAtMs));
};

const clampInspiredesignCaptureTimeout = (timeoutMs?: number): number => {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) return INSPIREDESIGN_CAPTURE_TIMEOUT_MS;
  return Math.max(1, Math.min(timeoutMs, INSPIREDESIGN_CAPTURE_TIMEOUT_MS));
};

const sanitizeInspiredesignCaptureText = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const redacted = redactSensitive(value);
  return typeof redacted === "string" ? redacted : value;
};

const resolveInspiredesignCaptureCookiePolicy = (
  options: InspiredesignCaptureOptions
): ProviderCookiePolicy => {
  if (options.cookiePolicyOverride) return options.cookiePolicyOverride;
  return options.useCookies === false ? "off" : "auto";
};

const verifyRequiredCaptureCookies = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  url: string,
  importState: CaptureCookieImportState
): Promise<void> => {
  const cookies = await manager.cookieList(sessionId, [url]);
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
  source: ProviderCookieSourceConfig | undefined
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
  await manager.cookieImport(sessionId, loaded.cookies, false);
  return {
    sourceConfigured: true,
    sourceAvailable: loaded.available,
    sourceMessage: loaded.message
  };
};

const withCaptureDeadline = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        handle = setTimeout(() => reject(new Error(`Deep capture ${label} exceeded timeout budget.`)), timeoutMs);
      })
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
};

const captureInspiredesignArtifacts = async (
  manager: InspiredesignCaptureManagerLike,
  sessionId: string,
  remainingTimeoutMs: () => number
): Promise<InspiredesignCaptureEvidence> => {
  const snapshotTimeoutMs = remainingTimeoutMs();
  const snapshot = await withCaptureDeadline(
    manager.snapshot(sessionId, "actionables", INSPIREDESIGN_CAPTURE_MAX_CHARS),
    snapshotTimeoutMs,
    "snapshot capture"
  );
  const cloneTimeoutMs = remainingTimeoutMs();
  const clone = await withCaptureDeadline(
    manager.clonePage(sessionId),
    cloneTimeoutMs,
    "clone capture"
  );
  const dom = typeof manager.clonePageHtmlWithOptions === "function"
    ? await withCaptureDeadline(
      manager.clonePageHtmlWithOptions(sessionId),
      remainingTimeoutMs(),
      "DOM capture"
    ).catch(() => null)
    : null;
  return {
    snapshot: {
      content: sanitizeInspiredesignCaptureText(snapshot.content) ?? snapshot.content,
      refCount: snapshot.refCount,
      warnings: snapshot.warnings ?? []
    },
    ...(dom?.html
      ? {
        dom: {
          outerHTML: sanitizeInspiredesignCaptureText(dom.html) ?? dom.html,
          truncated: false
        }
      }
      : {}),
    clone: {
      componentPreview: sanitizeInspiredesignCaptureText(clone.component) ?? clone.component,
      cssPreview: sanitizeInspiredesignCaptureText(clone.css) ?? clone.css,
      warnings: clone.warnings ?? []
    }
  };
};

export async function captureInspiredesignReferenceFromManager(
  manager: InspiredesignCaptureManagerLike,
  url: string,
  options: InspiredesignCaptureOptions = {}
): Promise<InspiredesignCaptureEvidence> {
  const cookiePolicy = resolveInspiredesignCaptureCookiePolicy(options);
  const captureTimeoutMs = clampInspiredesignCaptureTimeout(options.timeoutMs);
  const remainingTimeoutMs = createRemainingCaptureTimeout(captureTimeoutMs);
  const session = await manager.launch({
    headless: true,
    startUrl: "about:blank",
    persistProfile: false
  });
  try {
    const importState = cookiePolicy === "off"
      ? { sourceConfigured: false, sourceAvailable: false }
      : await importConfiguredCaptureCookies(manager, session.sessionId, options.cookieSource);
    if (cookiePolicy === "required") {
      await verifyRequiredCaptureCookies(manager, session.sessionId, url, importState);
    }
    manager.setSessionChallengeAutomationMode?.(session.sessionId, options.challengeAutomationMode);
    await manager.goto(session.sessionId, url, "load", remainingTimeoutMs());
    await manager.waitForLoad(session.sessionId, "networkidle", remainingTimeoutMs()).catch(() => undefined);
    return await captureInspiredesignArtifacts(manager, session.sessionId, remainingTimeoutMs);
  } finally {
    await manager.disconnect(session.sessionId, true).catch(() => undefined);
  }
}
