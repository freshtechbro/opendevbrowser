import type { BrowserManagerLike, ChallengeRuntimeHandle } from "../browser/manager-types";
import { isOpsRequestTimeoutError } from "../browser/ops-client";
import type {
  OpenDevBrowserConfig,
  ProvidersChallengeOrchestrationConfig
} from "../config";
import { ChallengeOrchestrator, resolveChallengeAutomationPolicy, type ChallengeAutomationMode } from "../challenges";
import { createDefaultRuntime, type RuntimeDefaults, type RuntimeInit } from "./index";
import { classifyBlockerSignal } from "./blocker";
import { cookieSourceRef, readCookiesFromSource } from "./cookie-source";
import { ProviderRuntimeError } from "./errors";
import { resolveProviderRuntimePolicy } from "./runtime-policy";
import { canonicalizeUrl } from "./web/crawler";
import { toSnippet, extractStructuredContent } from "./web/extract";
import type {
  BrowserFallbackMode,
  BrowserFallbackPort,
  BrowserFallbackDisposition,
  BrowserFallbackResponse,
  JsonValue,
  ProviderCookieImportRecord,
  ProviderCookiePolicy,
  ProviderCookieSourceConfig,
  SessionChallengeSummary
} from "./types";

type RuntimeConfig = Pick<OpenDevBrowserConfig, "blockerDetectionThreshold" | "security" | "providers">;
type BrowserFallbackRequest = Parameters<NonNullable<BrowserFallbackPort>["resolve"]>[0];

type BrowserFallbackCookieConfig = {
  policy: ProviderCookiePolicy;
  source: ProviderCookieSourceConfig;
};

type BrowserFallbackTransportConfig = {
  extensionWsEndpoint?: string;
};

type BrowserFallbackCookieDiagnostics = {
  policy: ProviderCookiePolicy;
  source: ProviderCookieSourceConfig["type"];
  sourceRef: string;
  attempted: boolean;
  available: boolean;
  loaded: number;
  injected: number;
  rejected: number;
  verifiedCount: number;
  strict: boolean;
  reasonCode?: BrowserFallbackResponse["reasonCode"];
  message?: string;
};

export const resolveEffectiveChallengeConfig = (
  config: RuntimeConfig | undefined,
  challengeConfig?: ProvidersChallengeOrchestrationConfig
): ProvidersChallengeOrchestrationConfig | undefined => {
  return challengeConfig ?? config?.providers?.challengeOrchestration;
};

const DEFAULT_COOKIE_POLICY: ProviderCookiePolicy = "auto";
const DEFAULT_COOKIE_SOURCE: ProviderCookieSourceConfig = {
  type: "file",
  value: "~/.config/opencode/opendevbrowser.provider-cookies.json"
};
const DEFAULT_FALLBACK_NAVIGATION_TIMEOUT_MS = 45000;
const DEFAULT_FALLBACK_SHOPPING_SETTLE_TIMEOUT_MS = 15000;
const DEFAULT_FALLBACK_DEFAULT_SETTLE_TIMEOUT_MS = 5000;
const DEFAULT_FALLBACK_SHOPPING_CAPTURE_DELAY_MS = 2000;
const DEFAULT_FALLBACK_SOCIAL_CAPTURE_DELAY_MS = 2000;
const DEFAULT_FALLBACK_DEFAULT_CAPTURE_DELAY_MS = 500;
const DEFAULT_FALLBACK_SHOPPING_CLONE_MAX_NODES = 5000;
const DEFAULT_FALLBACK_SOCIAL_CLONE_MAX_NODES = 15000;
const DEFAULT_FALLBACK_MAX_CAPTURE_ATTEMPTS = 3;
const DEFAULT_FALLBACK_RECAPTURE_DELAY_MS = 250;
const SOCIAL_EXTENSION_RETRY_DELAY_MS = 500;
const FALLBACK_CAPTURE_MIN_CONTENT_BUDGET_MS = 250;
const FALLBACK_CAPTURE_HTML_STABILITY_THRESHOLD = 256;
const FALLBACK_CAPTURE_TEXT_STABILITY_THRESHOLD = 64;
const SHOPPING_FALLBACK_FLAGS = ["--disable-http2"];
const SHOPPING_INTERSTITIAL_DIALOG_RE = /\b(?:role\s*=\s*["'](?:dialog|alertdialog)["']|aria-modal\s*=\s*["']true["'])/i;
const SHOPPING_INTERSTITIAL_TEXT_RE = /\b(?:choose where (?:you(?:'|’)d|you would|to) like to shop|how do you want your items|set your location|confirm your location|choose a store)\b/i;

const toFallbackMode = (mode: unknown): BrowserFallbackMode => {
  return mode === "extension" ? "extension" : "managed_headed";
};

const isExplicitShoppingExtensionRequest = (request: BrowserFallbackRequest): boolean => {
  const preferredModes = request.runtimePolicy?.browser.preferredModes ?? request.preferredModes;
  return request.source === "shopping"
    && preferredModes?.length === 1
    && preferredModes[0] === "extension";
};

const shouldAttachExtensionStartUrl = (request: BrowserFallbackRequest): boolean => (
  request.source === "social"
  || request.source === "shopping"
);

const SOCIAL_EXTENSION_MODE_ATTEMPTS = 3;

const resolveSocialExtensionModeAttempts = (
  request: BrowserFallbackRequest,
  preferredMode: string
): number => preferredMode === "extension" && request.source === "social"
  ? SOCIAL_EXTENSION_MODE_ATTEMPTS
  : 1;

const waitForSocialExtensionRetryGap = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, SOCIAL_EXTENSION_RETRY_DELAY_MS));
};

const resolveFallbackNavigationWaitUntil = (
  source: BrowserFallbackRequest["source"],
  mode: "extension" | "managed_headed"
): "load" | "domcontentloaded" => source === "shopping" && mode === "managed_headed"
  ? "domcontentloaded"
  : "load";

const normalizeExtensionAttachUrl = (value?: string): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const didExtensionAttachReachRequestUrl = (
  requestUrl: string,
  attachedUrl?: string
): boolean => {
  const normalizedAttachedUrl = normalizeExtensionAttachUrl(attachedUrl);
  return typeof normalizedAttachedUrl === "string"
    && canonicalizeUrl(requestUrl) === canonicalizeUrl(normalizedAttachedUrl);
};

const isRestrictedExtensionAttachUrl = (value?: string): boolean => {
  const normalizedUrl = normalizeExtensionAttachUrl(value);
  if (!normalizedUrl) {
    return true;
  }
  const normalized = normalizedUrl.toLowerCase();
  if (normalized === "about:blank") {
    return true;
  }
  if (
    normalized.startsWith("chrome://")
    || normalized.startsWith("chrome-extension://")
    || normalized.startsWith("devtools://")
  ) {
    return true;
  }
  try {
    const parsed = new URL(normalizedUrl);
    return parsed.protocol !== "http:" && parsed.protocol !== "https:";
  } catch {
    return true;
  }
};

type BrowserManagerWithResolveRefPoint = BrowserManagerLike & {
  resolveRefPoint?: ChallengeRuntimeHandle["resolveRefPoint"];
};

const createFallbackChallengeRuntimeHandle = (manager: BrowserManagerLike): ChallengeRuntimeHandle => {
  const createdHandle = manager.createChallengeRuntimeHandle?.();
  if (createdHandle) {
    return createdHandle;
  }
  const resolveRefPoint = (manager as BrowserManagerWithResolveRefPoint).resolveRefPoint;
  if (typeof resolveRefPoint !== "function") {
    throw new Error("Challenge runtime handle is unavailable for browser fallback orchestration.");
  }
  return {
    status: manager.status.bind(manager),
    goto: manager.goto.bind(manager),
    waitForLoad: manager.waitForLoad.bind(manager),
    snapshot: manager.snapshot.bind(manager),
    click: manager.click.bind(manager),
    hover: manager.hover.bind(manager),
    press: manager.press.bind(manager),
    type: manager.type.bind(manager),
    select: manager.select.bind(manager),
    scroll: manager.scroll.bind(manager),
    pointerMove: manager.pointerMove.bind(manager),
    pointerDown: manager.pointerDown.bind(manager),
    pointerUp: manager.pointerUp.bind(manager),
    drag: manager.drag.bind(manager),
    cookieList: manager.cookieList.bind(manager),
    cookieImport: manager.cookieImport.bind(manager),
    debugTraceSnapshot: manager.debugTraceSnapshot.bind(manager),
    resolveRefPoint: resolveRefPoint.bind(manager)
  };
};

const reconnectExplicitShoppingExtensionSession = async (args: {
  manager: BrowserManagerLike;
  sessionId: string;
  extensionWsEndpoint: string;
  requestUrl: string;
}): Promise<{ sessionId: string; navigatedDuringAttach: boolean }> => {
  await args.manager.disconnect(args.sessionId, true).catch(() => {
    // Best effort cleanup before reconnecting a fresh extension attach session.
  });
  const attached = await args.manager.connectRelay(args.extensionWsEndpoint, { startUrl: args.requestUrl });
  const attachedUrl = (await args.manager.status(attached.sessionId)).url;
  return {
    sessionId: attached.sessionId,
    navigatedDuringAttach: didExtensionAttachReachRequestUrl(args.requestUrl, attachedUrl)
  };
};

const baseCookieDiagnostics = (
  policy: ProviderCookiePolicy,
  source: ProviderCookieSourceConfig
): BrowserFallbackCookieDiagnostics => ({
  policy,
  source: source.type,
  sourceRef: cookieSourceRef(source),
  attempted: false,
  available: false,
  loaded: 0,
  injected: 0,
  rejected: 0,
  verifiedCount: 0,
  strict: false
});

const fallbackFailure = (
  reasonCode: BrowserFallbackResponse["reasonCode"],
  message: string,
  cookieDiagnostics?: BrowserFallbackCookieDiagnostics,
  challengeOrchestration?: Record<string, JsonValue>,
  runtimePolicy?: Record<string, JsonValue>,
  options: {
    mode?: BrowserFallbackMode;
    details?: Record<string, JsonValue>;
  } = {}
): BrowserFallbackResponse => ({
  ok: false,
  reasonCode,
  disposition: reasonCode === "env_limited" ? "deferred" : "failed",
  ...(options.mode ? { mode: options.mode } : {}),
  details: {
    message,
    ...(cookieDiagnostics ? { cookieDiagnostics: toJsonRecord(cookieDiagnostics) } : {}),
    ...(challengeOrchestration ? { challengeOrchestration } : {}),
    ...(runtimePolicy ? { runtimePolicy } : {}),
    ...(options.details ? options.details : {})
  }
});

const toJsonValue = (value: unknown): JsonValue | undefined => {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => toJsonValue(entry))
      .filter((entry): entry is JsonValue => typeof entry !== "undefined");
    return entries;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = toJsonValue(entry);
    if (typeof normalized !== "undefined") {
      record[key] = normalized;
    }
  }
  return record;
};

const toJsonRecord = (value: unknown): Record<string, JsonValue> => {
  const normalized = toJsonValue(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized
    : {};
};

const shouldEmitFallbackChallengeOrchestration = (
  reasonCode: BrowserFallbackResponse["reasonCode"]
): boolean => {
  return reasonCode === "auth_required"
    || reasonCode === "token_required"
    || reasonCode === "challenge_detected"
    || reasonCode === "env_limited";
};

const resolveFallbackHelperEligibility = (args: {
  mode: ChallengeAutomationMode;
  helperBridgeEnabled: boolean;
}): Record<string, JsonValue> => {
  if (args.mode === "off") {
    return {
      allowed: false,
      reason: "Challenge automation mode is off; detection and reporting remain active.",
      standDownReason: "challenge_automation_off"
    };
  }
  if (args.mode === "browser") {
    return {
      allowed: false,
      reason: "Browser mode keeps the optional helper bridge disabled.",
      standDownReason: "helper_disabled_for_browser_mode"
    };
  }
  if (!args.helperBridgeEnabled) {
    return {
      allowed: false,
      reason: "Optional computer-use bridge is disabled by policy.",
      standDownReason: "helper_disabled_by_policy"
    };
  }
  return {
    allowed: true,
    reason: "Optional helper bridge remains eligible after mode resolution."
  };
};

const buildFallbackChallengeOrchestration = (args: {
  manager: BrowserManagerLike;
  request: Parameters<NonNullable<BrowserFallbackPort>["resolve"]>[0];
  sessionId?: string | null;
  runtimePolicy: ReturnType<typeof resolveProviderRuntimePolicy>;
  helperBridgeEnabled: boolean;
  invoked: boolean;
  reason: string;
}): Record<string, JsonValue> | undefined => {
  if (!shouldEmitFallbackChallengeOrchestration(args.request.reasonCode)) {
    return undefined;
  }
  const policy = args.runtimePolicy.challenge;
  return toJsonRecord({
    mode: policy.mode,
    source: policy.source,
    ...(policy.standDownReason ? { standDownReason: policy.standDownReason } : {}),
    helperEligibility: resolveFallbackHelperEligibility({
      mode: policy.mode,
      helperBridgeEnabled: args.helperBridgeEnabled
    }),
    invoked: args.invoked,
    reason: args.reason
  });
};

const isPreserveEligibleBlocker = (
  blocker: { type: string } | null
): blocker is { type: "auth_required" | "anti_bot_challenge" } => {
  return blocker?.type === "auth_required" || blocker?.type === "anti_bot_challenge";
};

const createChallengeSummaryForFallback = (args: {
  existing?: SessionChallengeSummary;
  blockerType: "auth_required" | "anti_bot_challenge";
  reasonCode: BrowserFallbackResponse["reasonCode"];
  request: Parameters<NonNullable<BrowserFallbackPort>["resolve"]>[0];
  sessionId: string;
  targetId?: string | null;
  now?: Date;
}): SessionChallengeSummary => {
  const now = args.now ?? new Date();
  const summary = args.existing;
  return {
    ...(summary ?? {
      challengeId: `fallback-${now.getTime()}`,
      blockerType: args.blockerType,
      status: "active",
      updatedAt: now.toISOString()
    }),
    blockerType: args.blockerType,
    reasonCode: args.reasonCode,
    ownerSurface: args.request.ownerSurface ?? "provider_fallback",
    ...(args.request.ownerLeaseId ? { ownerLeaseId: args.request.ownerLeaseId } : {}),
    resumeMode: args.request.resumeMode ?? "auto",
    ...(args.request.suspendedIntent ? { suspendedIntent: args.request.suspendedIntent } : {}),
    preservedSessionId: args.sessionId,
    ...(args.targetId ? { preservedTargetId: args.targetId } : {}),
    status: summary?.status ?? "active",
    updatedAt: now.toISOString(),
    ...(summary?.preserveUntil ? { preserveUntil: summary.preserveUntil } : {}),
    ...(summary?.verifyUntil ? { verifyUntil: summary.verifyUntil } : {}),
    ...(summary?.timeline ? { timeline: summary.timeline } : {})
  };
};

const resolveFallbackDisposition = (args: {
  blocker: ReturnType<typeof detectFallbackPageBlocker>;
  reasonCode: BrowserFallbackResponse["reasonCode"];
}): BrowserFallbackDisposition => {
  if (isPreserveEligibleBlocker(args.blocker)) {
    return "challenge_preserved";
  }
  return args.reasonCode === "env_limited" ? "deferred" : "failed";
};

const resolveFallbackSettleTimeoutMs = (source: "social" | "shopping" | "web" | "community"): number => {
  return source === "shopping"
    ? DEFAULT_FALLBACK_SHOPPING_SETTLE_TIMEOUT_MS
    : DEFAULT_FALLBACK_DEFAULT_SETTLE_TIMEOUT_MS;
};

const resolveFallbackCaptureDelayMs = (source: "social" | "shopping" | "web" | "community"): number => {
  return source === "shopping"
    ? DEFAULT_FALLBACK_SHOPPING_CAPTURE_DELAY_MS
    : source === "social"
      ? DEFAULT_FALLBACK_SOCIAL_CAPTURE_DELAY_MS
    : DEFAULT_FALLBACK_DEFAULT_CAPTURE_DELAY_MS;
};

const sanitizeFallbackDelayMs = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
};

const readClonePageHtml = (component: string): string | null => {
  try {
    const match = component.match(/__html:\s*("(?:\\.|[^"])*")\s*}}/s);
    if (!match?.[1]) {
      return null;
    }
    const parsed = JSON.parse(match[1]) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
};

const waitForFallbackCaptureDelay = async (
  delayMs: number,
  waitForTimeout?: (ms: number) => Promise<void>
): Promise<void> => {
  if (delayMs <= 0) return;
  if (typeof waitForTimeout === "function") {
    await waitForTimeout(delayMs);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const waitForFallbackPageToSettle = async (
  manager: BrowserManagerLike,
  sessionId: string,
  _source: "social" | "shopping" | "web" | "community",
  timeoutMs: number
): Promise<void> => {
  if (typeof manager.waitForLoad !== "function") return;
  const loadTimeoutMs = timeoutMs > 1 ? Math.max(1, Math.floor(timeoutMs / 3)) : timeoutMs;
  const networkIdleTimeoutMs = timeoutMs > 1
    ? Math.max(1, timeoutMs - loadTimeoutMs)
    : timeoutMs;
  for (const [waitUntil, stepTimeoutMs] of [
    ["load", loadTimeoutMs] as const,
    ["networkidle", networkIdleTimeoutMs] as const
  ]) {
    try {
      await manager.waitForLoad(sessionId, waitUntil, stepTimeoutMs);
    } catch {
      // Some sites never reach a clean load state. Fall through to
      // best-effort DOM capture instead of failing the entire recovery path.
    }
  }
};

const captureFallbackHtml = async (
  manager: BrowserManagerLike,
  sessionId: string,
  source: "social" | "shopping" | "web" | "community",
  captureDelayMs: number
): Promise<string> => {
  const cloneOptions = source === "shopping"
    ? { maxNodes: DEFAULT_FALLBACK_SHOPPING_CLONE_MAX_NODES, inlineStyles: false }
    : source === "social"
      ? { maxNodes: DEFAULT_FALLBACK_SOCIAL_CLONE_MAX_NODES, inlineStyles: false }
      : { inlineStyles: false };
  try {
    return await manager.withPage(sessionId, null, async (page: unknown) => {
      const candidate = page as {
        waitForTimeout?: (ms: number) => Promise<void>;
        content?: () => Promise<string>;
      };
      await waitForFallbackCaptureDelay(captureDelayMs, candidate.waitForTimeout);
      if (typeof candidate.content !== "function") return "";
      return await candidate.content();
    });
  } catch (error) {
    if (typeof manager.clonePage !== "function") {
      throw error;
    }
    await waitForFallbackCaptureDelay(captureDelayMs);
    if (typeof manager.clonePageHtmlWithOptions === "function") {
      const fallbackHtml = await manager.clonePageHtmlWithOptions(
        sessionId,
        null,
        cloneOptions
      );
      return fallbackHtml.html;
    }
    const fallbackExport = source !== "web" && source !== "community" && typeof manager.clonePageWithOptions === "function"
      ? await manager.clonePageWithOptions(sessionId, null, cloneOptions)
      : await manager.clonePage(sessionId, null);
    const html = readClonePageHtml(fallbackExport.component);
    if (html !== null) {
      return html;
    }
    throw error;
  }
};

const detectFallbackPageBlocker = (
  source: "social" | "shopping" | "web" | "community",
  html: string,
  url: string
) => {
  const htmlLower = html.toLowerCase();
  const urlLower = url.toLowerCase();
  if (
    /\/(login|signin|sign-in|auth)(?:[./?]|$)/i.test(urlLower)
    || /<title[^>]*>[^<]*\b(log ?in|sign ?in|login|signin)\b/i.test(html)
    || htmlLower.includes("please log in")
    || htmlLower.includes("please sign in")
  ) {
    return {
      type: "auth_required" as const,
      reasonCode: "token_required" as const
    };
  }
  if (
    htmlLower.includes("security verification")
    || htmlLower.includes("verify you're human")
    || htmlLower.includes("verify that you're human")
    || htmlLower.includes("checking your browser")
    || (htmlLower.includes("challenge") && /function _0x[a-z0-9]+\(/i.test(html))
  ) {
    return {
      type: "anti_bot_challenge" as const,
      reasonCode: "challenge_detected" as const
    };
  }
  if (
    source === "shopping"
    && SHOPPING_INTERSTITIAL_DIALOG_RE.test(html)
    && SHOPPING_INTERSTITIAL_TEXT_RE.test(htmlLower)
  ) {
    return {
      type: "anti_bot_challenge" as const,
      reasonCode: "challenge_detected" as const
    };
  }

  const extracted = extractStructuredContent(html, url);
  const message = toSnippet(
    [
      extracted.metadata.title,
      extracted.metadata.description,
      extracted.text
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" "),
    800
  );
  const blocker = classifyBlockerSignal({
    source: "runtime_fetch",
    url,
    finalUrl: url,
    title: typeof extracted.metadata.title === "string" ? extracted.metadata.title : undefined,
    message,
    status: 200,
    providerErrorCode: "unavailable",
    retryable: true
  });
  if (!blocker || blocker.type === "unknown" || blocker.type === "env_limited") {
    return null;
  }
  return blocker;
};

const readStatusChallengeBlocker = (
  status: Awaited<ReturnType<BrowserManagerLike["status"]>>
): (
  | { type: "auth_required"; reasonCode: "token_required" }
  | { type: "anti_bot_challenge"; reasonCode: "challenge_detected" }
  | null
) => {
  const meta = status.meta;
  const challenge = meta?.challenge;
  if (!meta || meta.blockerState === "clear" || !challenge) {
    return null;
  }
  if (challenge.status === "resolved" || challenge.status === "expired") {
    return null;
  }
  if (challenge.blockerType === "auth_required") {
    return {
      type: "auth_required",
      reasonCode: "token_required"
    };
  }
  if (challenge.blockerType === "anti_bot_challenge") {
    return {
      type: "anti_bot_challenge",
      reasonCode: "challenge_detected"
    };
  }
  return null;
};

type FallbackCaptureSnapshot = {
  html: string;
  htmlLength: number;
  textLength: number;
  linkCount: number;
};

type FallbackCaptureResult = {
  html: string;
  blocker: ReturnType<typeof detectFallbackPageBlocker>;
  snapshot: FallbackCaptureSnapshot;
  diagnostics: Record<string, JsonValue>;
};

const summarizeFallbackCapture = (
  html: string,
  url: string
): FallbackCaptureSnapshot => {
  const extracted = extractStructuredContent(html, url);
  return {
    html,
    htmlLength: html.length,
    textLength: extracted.text.trim().length,
    linkCount: extracted.links.length
  };
};

const isFallbackCaptureStable = (
  previous: FallbackCaptureSnapshot | null,
  current: FallbackCaptureSnapshot
): boolean => {
  if (!previous) return false;
  if (previous.html === current.html) return true;
  return Math.abs(current.htmlLength - previous.htmlLength) <= FALLBACK_CAPTURE_HTML_STABILITY_THRESHOLD
    && Math.abs(current.textLength - previous.textLength) <= FALLBACK_CAPTURE_TEXT_STABILITY_THRESHOLD
    && current.linkCount === previous.linkCount;
};

const createFallbackCaptureDiagnostics = (
  snapshot: FallbackCaptureSnapshot,
  attempts: number,
  stabilized: boolean
): Record<string, JsonValue> => ({
  attempts,
  stabilized,
  finalHtmlLength: snapshot.htmlLength,
  finalTextLength: snapshot.textLength,
  finalLinkCount: snapshot.linkCount
});

const captureStableFallbackHtml = async (args: {
  source: BrowserFallbackRequest["source"];
  url: string;
  initialDelayMs: number;
  capture: (delayMs: number) => Promise<string>;
  resolveNextDelayMs: () => number | null;
}): Promise<FallbackCaptureResult> => {
  let attempts = 0;
  let stabilized = false;
  let previous: FallbackCaptureSnapshot | null = null;
  let nextDelayMs = args.initialDelayMs;
  let finalHtml = "";
  let finalBlocker: ReturnType<typeof detectFallbackPageBlocker> = null;
  let finalSnapshot = summarizeFallbackCapture("", args.url);

  while (attempts < DEFAULT_FALLBACK_MAX_CAPTURE_ATTEMPTS) {
    finalHtml = await args.capture(nextDelayMs);
    finalSnapshot = summarizeFallbackCapture(finalHtml, args.url);
    finalBlocker = detectFallbackPageBlocker(args.source, finalHtml, args.url);
    attempts += 1;
    if (finalBlocker) break;
    if (isFallbackCaptureStable(previous, finalSnapshot)) {
      stabilized = true;
      break;
    }
    if (attempts >= DEFAULT_FALLBACK_MAX_CAPTURE_ATTEMPTS) {
      break;
    }
    const recaptureDelayMs = args.resolveNextDelayMs();
    if (recaptureDelayMs === null) {
      break;
    }
    previous = finalSnapshot;
    nextDelayMs = recaptureDelayMs;
  }

  return {
    html: finalHtml,
    blocker: finalBlocker,
    snapshot: finalSnapshot,
    diagnostics: createFallbackCaptureDiagnostics(finalSnapshot, attempts, stabilized)
  };
};

export const createBrowserFallbackPort = (
  manager: BrowserManagerLike | undefined,
  cookieDefaults: Partial<BrowserFallbackCookieConfig> = {},
  transportDefaults: BrowserFallbackTransportConfig = {},
  challengeOrchestrator?: ChallengeOrchestrator,
  challengeModeDefault: ChallengeAutomationMode = "browser_with_helper",
  helperBridgeEnabled = true
): BrowserFallbackPort | undefined => {
  if (!manager) return undefined;
  const disconnectFallbackSession = (sessionId: string) => {
    void manager.disconnect(sessionId, true).catch(() => {
      // Best effort cleanup for fallback sessions.
    });
  };
  const defaults: BrowserFallbackCookieConfig = {
    policy: cookieDefaults.policy ?? DEFAULT_COOKIE_POLICY,
    source: cookieDefaults.source ?? DEFAULT_COOKIE_SOURCE
  };
  return {
    resolve: async (request) => {
      const requestUrl = request.url;
      if (!requestUrl) {
        return fallbackFailure("env_limited", "Browser fallback requires a URL.");
      }
      const fallbackDeadlineMs = typeof request.timeoutMs === "number" && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
        ? Date.now() + request.timeoutMs
        : null;
      const createTimeoutError = (stage: string): ProviderRuntimeError => {
        return new ProviderRuntimeError("timeout", `Browser fallback timed out after ${request.timeoutMs}ms`, {
          provider: request.provider,
          source: request.source,
          retryable: true,
          details: {
            stage,
            ...(typeof request.timeoutMs === "number" ? { timeoutMs: request.timeoutMs } : {})
          }
        });
      };
      const ensureNotAborted = (stage: string): void => {
        if (request.signal?.aborted) {
          throw createTimeoutError(stage);
        }
      };
      const clampStepTimeoutMs = (requestedMs: number, stage: string): number => {
        ensureNotAborted(stage);
        if (fallbackDeadlineMs === null) {
          return requestedMs;
        }
        const remainingMs = Math.floor(fallbackDeadlineMs - Date.now());
        if (remainingMs <= 0) {
          throw createTimeoutError(stage);
        }
        return Math.max(1, Math.min(requestedMs, remainingMs));
      };
      const resolveRemainingFallbackBudgetMs = (stage: string): number | null => {
        ensureNotAborted(stage);
        if (fallbackDeadlineMs === null) {
          return null;
        }
        const remainingMs = Math.floor(fallbackDeadlineMs - Date.now());
        if (remainingMs <= 0) {
          throw createTimeoutError(stage);
        }
        return remainingMs;
      };
      const resolveEffectiveFallbackCaptureDelayMs = (
        source: BrowserFallbackRequest["source"],
        requestedDelayMs: number | undefined,
        stage: string
      ): number => {
        const requested = sanitizeFallbackDelayMs(
          requestedDelayMs,
          resolveFallbackCaptureDelayMs(source)
        );
        const remainingMs = resolveRemainingFallbackBudgetMs(stage);
        if (remainingMs === null) {
          return requested;
        }
        if (remainingMs <= FALLBACK_CAPTURE_MIN_CONTENT_BUDGET_MS) {
          return 0;
        }
        return Math.max(
          0,
          Math.min(requested, remainingMs - FALLBACK_CAPTURE_MIN_CONTENT_BUDGET_MS)
        );
      };
      const resolveFallbackRecaptureDelayMs = (
        source: BrowserFallbackRequest["source"],
        stage: string
      ): number | null => {
        const remainingMs = resolveRemainingFallbackBudgetMs(stage);
        if (remainingMs !== null && remainingMs <= FALLBACK_CAPTURE_MIN_CONTENT_BUDGET_MS) {
          return null;
        }
        return resolveEffectiveFallbackCaptureDelayMs(
          source,
          DEFAULT_FALLBACK_RECAPTURE_DELAY_MS,
          stage
        );
      };
      const runWithinFallbackDeadline = async <T>(
        stage: string,
        task: () => Promise<T>
      ): Promise<T> => {
        ensureNotAborted(stage);

        const taskPromise = Promise.resolve().then(task);
        void taskPromise.catch(() => {
          // Keep late follow-on failures from surfacing after the deadline winner settles.
        });
        const racers: Array<Promise<T>> = [taskPromise];
        const cleanup: Array<() => void> = [];

        if (fallbackDeadlineMs !== null) {
          const remainingMs = Math.floor(fallbackDeadlineMs - Date.now());
          if (remainingMs <= 0) {
            throw createTimeoutError(stage);
          }
          racers.push(new Promise<T>((_resolve, reject) => {
            const timer = setTimeout(() => {
              reject(createTimeoutError(stage));
            }, remainingMs);
            cleanup.push(() => clearTimeout(timer));
          }));
        }

        if (request.signal) {
          const signal = request.signal;
          racers.push(new Promise<T>((_resolve, reject) => {
            if (signal.aborted) {
              reject(createTimeoutError(stage));
              return;
            }
            const onAbort = () => {
              reject(createTimeoutError(stage));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            cleanup.push(() => {
              signal.removeEventListener("abort", onAbort);
            });
          }));
        }

        try {
          return await Promise.race(racers);
        } finally {
          for (const dispose of cleanup) {
            dispose();
          }
        }
      };

      const resolveFallbackRuntimePolicy = (sessionChallengeAutomationMode?: ChallengeAutomationMode) => (
        request.runtimePolicy ?? resolveProviderRuntimePolicy({
          source: request.source,
          preferredFallbackModes: request.preferredModes,
          sessionChallengeAutomationMode,
          configChallengeAutomationMode: challengeModeDefault,
          configCookiePolicy: defaults.policy
        })
      );
      const baseRuntimePolicy = resolveFallbackRuntimePolicy();
      const baseRuntimePolicyRecord = toJsonRecord(baseRuntimePolicy);
      const preferredModes = baseRuntimePolicy.browser.preferredModes.length
        ? baseRuntimePolicy.browser.preferredModes
        : ["managed_headed"];
      let lastFailure: BrowserFallbackResponse = fallbackFailure(
        "env_limited",
        "Browser fallback exhausted all preferred modes.",
        undefined,
        undefined,
        baseRuntimePolicyRecord
      );

      for (const preferredMode of preferredModes) {
        const maxModeAttempts = resolveSocialExtensionModeAttempts(request, preferredMode);
        for (let modeAttempt = 1; modeAttempt <= maxModeAttempts; modeAttempt += 1) {
        let sessionId: string | null = null;
        let preserveSession = false;
        let navigatedDuringAttach = false;
        let attachedUrl: string | undefined;
        let runtimePolicy = baseRuntimePolicy;
        let runtimePolicyRecord = baseRuntimePolicyRecord;
        let policy = runtimePolicy.cookies.policy;
        const cookieDiagnostics = baseCookieDiagnostics(policy, defaults.source);
        let retryModeAttempt = false;
        const abortListener = () => {
          if (sessionId) {
            disconnectFallbackSession(sessionId);
          }
        };
        request.signal?.addEventListener("abort", abortListener, { once: true });
        try {
          ensureNotAborted("mode_start");
          if (preferredMode === "extension") {
            if (!transportDefaults.extensionWsEndpoint) {
              lastFailure = fallbackFailure("env_limited", "Extension fallback requires a relay endpoint.", cookieDiagnostics, undefined, runtimePolicyRecord);
              continue;
            }
            const attachOptions = shouldAttachExtensionStartUrl(request)
              ? { startUrl: requestUrl }
              : undefined;
            const attached = await manager.connectRelay(transportDefaults.extensionWsEndpoint, attachOptions);
            sessionId = attached.sessionId;
            if (isExplicitShoppingExtensionRequest(request)) {
              attachedUrl = (await manager.status(sessionId)).url;
              navigatedDuringAttach = didExtensionAttachReachRequestUrl(requestUrl, attachedUrl);
              if (isRestrictedExtensionAttachUrl(attachedUrl)) {
                const recovered = await reconnectExplicitShoppingExtensionSession({
                  manager,
                  sessionId,
                  extensionWsEndpoint: transportDefaults.extensionWsEndpoint,
                  requestUrl
                });
                sessionId = recovered.sessionId;
                navigatedDuringAttach = recovered.navigatedDuringAttach;
              }
            } else {
              navigatedDuringAttach = Boolean(attachOptions?.startUrl);
            }
          } else {
            const launched = await manager.launch({
              noExtension: true,
              headless: false,
              startUrl: "about:blank",
              persistProfile: false,
              ...(request.source === "shopping" ? { flags: SHOPPING_FALLBACK_FLAGS } : {})
            });
            sessionId = launched.sessionId;
          }
          if (sessionId) {
            if (!request.runtimePolicy) {
              runtimePolicy = resolveFallbackRuntimePolicy(
                manager.getSessionChallengeAutomationMode?.(sessionId)
              );
              runtimePolicyRecord = toJsonRecord(runtimePolicy);
              policy = runtimePolicy.cookies.policy;
            }
            manager.setSessionChallengeAutomationMode?.(sessionId, runtimePolicy.challenge.mode);
          }
          ensureNotAborted("session_ready");

          if (policy !== "off" && preferredMode !== "extension") {
            const loaded = await readCookiesFromSource(defaults.source);
            cookieDiagnostics.available = loaded.available;
            cookieDiagnostics.loaded = loaded.cookies.length;
            if (loaded.message) {
              cookieDiagnostics.message = loaded.message;
            }

            if (loaded.cookies.length > 0) {
              cookieDiagnostics.attempted = true;
              const imported = await manager.cookieImport(sessionId, loaded.cookies, false);
              cookieDiagnostics.injected = imported.imported;
              cookieDiagnostics.rejected = imported.rejected.length;

              const verified = await manager.cookieList(sessionId, [requestUrl]);
              cookieDiagnostics.verifiedCount = verified.count;
            }
            ensureNotAborted("cookies_ready");

            if (policy === "required") {
              const reasonMessage = cookieDiagnostics.message
                ?? (
                  cookieDiagnostics.loaded === 0
                    ? "Required provider cookies are missing."
                    : cookieDiagnostics.injected === 0
                      ? "Provider cookie injection imported 0 entries."
                      : cookieDiagnostics.verifiedCount === 0
                        ? "Provider cookies were not observable after injection."
                        : undefined
                );
              if (reasonMessage) {
                cookieDiagnostics.reasonCode = "auth_required";
                cookieDiagnostics.message = reasonMessage;
                lastFailure = fallbackFailure("auth_required", reasonMessage, cookieDiagnostics, undefined, runtimePolicyRecord);
                continue;
              }
            }
          }

          if (sessionId === null) {
            lastFailure = fallbackFailure(
              "env_limited",
              "Browser fallback session was not established.",
              cookieDiagnostics,
              undefined,
              runtimePolicyRecord,
              {
                mode: toFallbackMode(preferredMode)
              }
            );
            continue;
          }
          const activeSessionId = sessionId;

          if (!navigatedDuringAttach) {
            await manager.goto(
              activeSessionId,
              requestUrl,
              resolveFallbackNavigationWaitUntil(request.source, toFallbackMode(preferredMode)),
              clampStepTimeoutMs(DEFAULT_FALLBACK_NAVIGATION_TIMEOUT_MS, "goto")
            );
          }
          await waitForFallbackPageToSettle(
            manager,
            activeSessionId,
            request.source,
            clampStepTimeoutMs(
              sanitizeFallbackDelayMs(
                request.settleTimeoutMs,
                resolveFallbackSettleTimeoutMs(request.source)
              ),
              "settle"
            )
          );
          if (
            preferredMode === "extension"
            && isExplicitShoppingExtensionRequest(request)
          ) {
            const resolvedAttachStatus = await runWithinFallbackDeadline("status", async () => manager.status(activeSessionId));
            const observedUrl = normalizeExtensionAttachUrl(resolvedAttachStatus.url);
            if (!didExtensionAttachReachRequestUrl(requestUrl, resolvedAttachStatus.url)) {
              lastFailure = fallbackFailure(
                "env_limited",
                "Extension fallback did not reach the requested shopping URL.",
                cookieDiagnostics,
                undefined,
                runtimePolicyRecord,
                {
                  mode: "extension",
                  details: {
                    requestedUrl: requestUrl,
                    ...(observedUrl ? { observedUrl } : {})
                  }
                }
              );
              continue;
            }
          }
          if (policy !== "off" && preferredMode === "extension") {
            const verified = await manager.cookieList(activeSessionId, [requestUrl]);
            cookieDiagnostics.available = verified.count > 0;
            cookieDiagnostics.verifiedCount = verified.count;
            if (policy === "required" && verified.count === 0) {
              const reasonMessage = "Provider cookies were not observable in the live extension session.";
              cookieDiagnostics.reasonCode = "auth_required";
              cookieDiagnostics.message = reasonMessage;
              lastFailure = fallbackFailure("auth_required", reasonMessage, cookieDiagnostics, undefined, runtimePolicyRecord);
              continue;
            }
          }

          const captured = await captureStableFallbackHtml({
            source: request.source,
            url: requestUrl,
            initialDelayMs: resolveEffectiveFallbackCaptureDelayMs(
              request.source,
              request.captureDelayMs,
              "capture"
            ),
            capture: async (delayMs) => runWithinFallbackDeadline("capture", async () => captureFallbackHtml(
              manager,
              activeSessionId,
              request.source,
              delayMs
            )),
            resolveNextDelayMs: () => resolveFallbackRecaptureDelayMs(request.source, "capture")
          });
          const status = await runWithinFallbackDeadline("status", async () => manager.status(activeSessionId));
          const resolvedUrl = status.url ?? requestUrl;
          const captureDiagnostics = toJsonRecord(captured.diagnostics);
          const html = captured.html;
          const blocker = detectFallbackPageBlocker(request.source, html, resolvedUrl)
            ?? captured.blocker
            ?? readStatusChallengeBlocker(status);
          if (blocker) {
            const reasonCode = blocker.reasonCode ?? request.reasonCode;
            cookieDiagnostics.reasonCode = reasonCode;
            const disposition = resolveFallbackDisposition({ blocker, reasonCode });
            if (isPreserveEligibleBlocker(blocker)) {
              preserveSession = true;
              const existingChallenge = (
                status.meta?.challenge
                && typeof status.meta.challenge === "object"
                && !Array.isArray(status.meta.challenge)
              )
                ? status.meta.challenge
                : undefined;
              let challengeOrchestrationRecord = buildFallbackChallengeOrchestration({
                manager,
                request,
                sessionId: activeSessionId,
                runtimePolicy,
                helperBridgeEnabled,
                invoked: false,
                reason: "Fallback reached a preserve-eligible blocker before challenge orchestration ran."
              });
              if (challengeOrchestrator) {
                const orchestration = await runWithinFallbackDeadline("challenge_orchestration", async () => challengeOrchestrator.orchestrate({
                  handle: createFallbackChallengeRuntimeHandle(manager),
                  sessionId: activeSessionId,
                  targetId: status.activeTargetId ?? undefined,
                  policy: runtimePolicy.challenge,
                  canImportCookies: runtimePolicy.challenge.mode !== "off",
                  fallbackDisposition: disposition
                }));
                challengeOrchestrationRecord = {
                  ...(buildFallbackChallengeOrchestration({
                    manager,
                    request,
                    sessionId: activeSessionId,
                    runtimePolicy,
                    helperBridgeEnabled,
                    invoked: true,
                    reason: "Fallback invoked challenge orchestration after reaching a preserve-eligible blocker."
                  }) ?? {}),
                  ...toJsonRecord(orchestration.outcome)
                };
                const verifiedBundle = orchestration.action.verification.bundle;
                if (verifiedBundle?.blockerState === "clear") {
                  const refreshedStatus = await runWithinFallbackDeadline("status_refresh", async () => manager.status(activeSessionId));
                  const refreshedUrl = refreshedStatus.url ?? resolvedUrl;
                  const refreshedCapture = await captureStableFallbackHtml({
                    source: request.source,
                    url: refreshedUrl,
                    initialDelayMs: resolveEffectiveFallbackCaptureDelayMs(
                      request.source,
                      request.captureDelayMs,
                      "capture_refresh"
                    ),
                    capture: async (delayMs) => runWithinFallbackDeadline("capture_refresh", async () => captureFallbackHtml(
                      manager,
                      activeSessionId,
                      request.source,
                      delayMs
                    )),
                    resolveNextDelayMs: () => resolveFallbackRecaptureDelayMs(
                      request.source,
                      "capture_refresh"
                    )
                  });
                  return {
                    ok: true,
                    reasonCode,
                    disposition: "completed",
                    mode: toFallbackMode(refreshedStatus.mode),
                    output: {
                      html: refreshedCapture.html,
                      url: refreshedUrl
                    },
                    details: {
                      provider: request.provider,
                      operation: request.operation,
                      message: `Browser fallback resumed after bounded challenge orchestration at ${refreshedUrl}.`,
                      captureDiagnostics: toJsonRecord(refreshedCapture.diagnostics),
                      cookieDiagnostics: toJsonRecord(cookieDiagnostics),
                      challengeOrchestration: challengeOrchestrationRecord,
                      runtimePolicy: runtimePolicyRecord
                    }
                  };
                }
              }
              return {
                ok: false,
                reasonCode,
                disposition,
                mode: toFallbackMode(status.mode),
                output: {
                  html,
                  url: resolvedUrl
                },
                challenge: createChallengeSummaryForFallback({
                  existing: existingChallenge,
                  blockerType: blocker.type,
                  reasonCode,
                  request,
                  sessionId,
                  targetId: status.activeTargetId
                }),
                preservedSessionId: sessionId,
                ...(status.activeTargetId ? { preservedTargetId: status.activeTargetId } : {}),
                details: {
                  provider: request.provider,
                  operation: request.operation,
                  message: `Browser fallback preserved ${blocker.type} session at ${resolvedUrl}.`,
                  captureDiagnostics,
                  cookieDiagnostics: toJsonRecord(cookieDiagnostics),
                  ...(challengeOrchestrationRecord ? { challengeOrchestration: challengeOrchestrationRecord } : {}),
                  runtimePolicy: runtimePolicyRecord
                }
              };
            }
            lastFailure = fallbackFailure(
              reasonCode,
              `Browser fallback reached ${blocker.type} page at ${resolvedUrl}.`,
              cookieDiagnostics,
              buildFallbackChallengeOrchestration({
                manager,
                request,
                sessionId,
                runtimePolicy,
                helperBridgeEnabled,
                invoked: false,
                reason: "Fallback ended on a non-preserve-eligible blocker, so challenge orchestration was not invoked."
              }),
              runtimePolicyRecord,
              {
                mode: toFallbackMode(status.mode),
                details: {
                  captureDiagnostics
                }
              }
            );
            continue;
          }

          const challengeOrchestrationRecord = buildFallbackChallengeOrchestration({
            manager,
            request,
            sessionId,
            runtimePolicy,
            helperBridgeEnabled,
            invoked: false,
            reason: "Fallback capture cleared without an auth or challenge blocker, so challenge orchestration was not invoked."
          });
          return {
            ok: true,
            reasonCode: request.reasonCode,
            disposition: "completed",
            mode: toFallbackMode(status.mode),
            output: {
              html,
              url: resolvedUrl
            },
            details: {
              provider: request.provider,
              operation: request.operation,
              captureDiagnostics,
              cookieDiagnostics: toJsonRecord(cookieDiagnostics),
              ...(challengeOrchestrationRecord ? { challengeOrchestration: challengeOrchestrationRecord } : {}),
              runtimePolicy: runtimePolicyRecord
            }
          };
        } catch (error) {
          if (request.signal?.aborted) {
            throw createTimeoutError("abort");
          }
          if (error instanceof ProviderRuntimeError && error.code === "timeout") {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          const timeoutDetails = isOpsRequestTimeoutError(error)
            ? {
              opsTimeoutCommand: error.details.command,
              opsTimeoutMs: error.details.timeoutMs,
              opsTimeoutRequestId: error.details.requestId,
              ...(error.details.opsSessionId ? { opsSessionId: error.details.opsSessionId } : {}),
              ...(error.details.leaseId ? { leaseId: error.details.leaseId } : {}),
              ...(error.details.stage ? { stage: error.details.stage } : {})
            }
            : undefined;
          retryModeAttempt = preferredMode === "extension"
            && request.source === "social"
            && modeAttempt < maxModeAttempts;
          if (!retryModeAttempt) {
            lastFailure = fallbackFailure(
              "env_limited",
              message,
              cookieDiagnostics,
              undefined,
              runtimePolicyRecord,
              {
                mode: toFallbackMode(preferredMode),
                ...(timeoutDetails ? { details: timeoutDetails } : {})
              }
            );
          }
        } finally {
          request.signal?.removeEventListener("abort", abortListener);
          if (sessionId && !preserveSession) {
            disconnectFallbackSession(sessionId);
          }
        }
          if (retryModeAttempt) {
            await waitForSocialExtensionRetryGap();
            continue;
          }
          break;
        }
      }

      return lastFailure;
    }
  };
};

export const buildRuntimeInitFromConfig = (
  config: RuntimeConfig | undefined,
  browserFallbackPort?: BrowserFallbackPort,
  challengeConfig?: ProvidersChallengeOrchestrationConfig
): Omit<RuntimeInit, "providers"> => {
  const providers = config?.providers;
  const effectiveChallengeConfig = resolveEffectiveChallengeConfig(config, challengeConfig);
  return {
    ...(typeof config?.blockerDetectionThreshold === "number"
      ? { blockerDetectionThreshold: config.blockerDetectionThreshold }
      : {}),
    promptInjectionGuard: {
      enabled: config?.security.promptInjectionGuard?.enabled ?? true
    },
    ...(providers?.tiers
      ? {
        tiers: {
          defaultTier: providers.tiers.default,
          enableHybrid: providers.tiers.enableHybrid,
          enableRestrictedSafe: providers.tiers.enableRestrictedSafe,
          hybridRiskThreshold: providers.tiers.hybridRiskThreshold,
          restrictedSafeRecoveryIntervalMs: providers.tiers.restrictedSafeRecoveryIntervalMs
        }
      }
      : {}),
    ...(providers?.adaptiveConcurrency
      ? {
        adaptiveConcurrency: {
          enabled: providers.adaptiveConcurrency.enabled,
          maxGlobal: providers.adaptiveConcurrency.maxGlobal,
          maxPerDomain: providers.adaptiveConcurrency.maxPerDomain
        }
      }
      : {}),
    ...(providers?.antiBotPolicy
      ? {
        antiBotPolicy: {
          enabled: providers.antiBotPolicy.enabled,
          cooldownMs: providers.antiBotPolicy.cooldownMs,
          maxChallengeRetries: providers.antiBotPolicy.maxChallengeRetries,
          proxyHint: providers.antiBotPolicy.proxyHint,
          sessionHint: providers.antiBotPolicy.sessionHint,
          allowBrowserEscalation: providers.antiBotPolicy.allowBrowserEscalation
        }
      }
      : {}),
    ...(providers?.transcript
      ? {
        transcript: {
          modeDefault: providers.transcript.modeDefault,
          strategyOrder: providers.transcript.strategyOrder,
          enableYtdlp: providers.transcript.enableYtdlp,
          enableAsr: providers.transcript.enableAsr,
          enableYtdlpAudioAsr: providers.transcript.enableYtdlpAudioAsr,
          enableApify: providers.transcript.enableApify,
          apifyActorId: providers.transcript.apifyActorId,
          enableBrowserFallback: providers.transcript.enableBrowserFallback,
          ytdlpTimeoutMs: providers.transcript.ytdlpTimeoutMs
        }
      }
      : {}),
    ...(providers?.cookiePolicy || providers?.cookieSource
      ? {
        cookies: {
          ...(providers.cookiePolicy ? { policy: providers.cookiePolicy } : {}),
          ...(providers.cookieSource ? { source: providers.cookieSource } : {})
        }
      }
      : {}),
    ...(effectiveChallengeConfig?.mode
      ? { challengeAutomationModeDefault: effectiveChallengeConfig.mode }
      : {}),
    ...(browserFallbackPort ? { browserFallbackPort } : {})
  };
};

export const createConfiguredProviderRuntime = (args: {
  config?: RuntimeConfig;
  defaults?: RuntimeDefaults;
  manager?: BrowserManagerLike;
  browserFallbackPort?: BrowserFallbackPort;
  challengeConfig?: ProvidersChallengeOrchestrationConfig;
  challengeOrchestrator?: ChallengeOrchestrator;
  init?: Omit<RuntimeInit, "providers">;
}) => {
  const effectiveChallengeConfig = resolveEffectiveChallengeConfig(args.config, args.challengeConfig);
  const challengeOrchestrator = args.challengeOrchestrator
    ?? (effectiveChallengeConfig
      ? new ChallengeOrchestrator(effectiveChallengeConfig)
      : undefined);
  if (challengeOrchestrator && typeof (args.manager as { setChallengeOrchestrator?: (value?: ChallengeOrchestrator) => void } | undefined)?.setChallengeOrchestrator === "function") {
    (args.manager as { setChallengeOrchestrator?: (value?: ChallengeOrchestrator) => void }).setChallengeOrchestrator?.(challengeOrchestrator);
  }
  const fallbackPort = args.browserFallbackPort ?? createBrowserFallbackPort(args.manager, {
    policy: args.config?.providers?.cookiePolicy,
    source: args.config?.providers?.cookieSource
  }, {}, challengeOrchestrator, effectiveChallengeConfig?.mode ?? "browser_with_helper", effectiveChallengeConfig?.optionalComputerUseBridge.enabled ?? true);
  const runtimeInit = {
    ...buildRuntimeInitFromConfig(args.config, fallbackPort, effectiveChallengeConfig),
    ...(args.init ?? {})
  };
  return createDefaultRuntime(args.defaults ?? {}, runtimeInit);
};
