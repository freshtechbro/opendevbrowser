import * as path from "path";
import * as os from "os";
import { readFile } from "fs/promises";
import type { BrowserManagerLike } from "../browser/manager-types";
import type { OpenDevBrowserConfig } from "../config";
import { createDefaultRuntime, type RuntimeDefaults, type RuntimeInit } from "./index";
import { classifyBlockerSignal } from "./blocker";
import { ProviderRuntimeError } from "./errors";
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

const DEFAULT_COOKIE_POLICY: ProviderCookiePolicy = "auto";
const DEFAULT_COOKIE_SOURCE: ProviderCookieSourceConfig = {
  type: "file",
  value: "~/.config/opencode/opendevbrowser.provider-cookies.json"
};
const DEFAULT_FALLBACK_NAVIGATION_TIMEOUT_MS = 45000;
const DEFAULT_FALLBACK_SHOPPING_SETTLE_TIMEOUT_MS = 15000;
const DEFAULT_FALLBACK_DEFAULT_SETTLE_TIMEOUT_MS = 5000;
const DEFAULT_FALLBACK_SHOPPING_CAPTURE_DELAY_MS = 2000;
const DEFAULT_FALLBACK_DEFAULT_CAPTURE_DELAY_MS = 500;
const SHOPPING_FALLBACK_FLAGS = ["--disable-http2"];

const toFallbackMode = (mode: unknown): BrowserFallbackMode => {
  return mode === "extension" ? "extension" : "managed_headed";
};

const expandHomePath = (filePath: string): string => {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
};

const cookieSourceRef = (source: ProviderCookieSourceConfig): string => {
  if (source.type === "file") {
    return expandHomePath(source.value);
  }
  if (source.type === "env") {
    return source.value;
  }
  return "inline";
};

const parseCookieArray = (payload: string): ProviderCookieImportRecord[] => {
  const parsed = JSON.parse(payload);
  if (!Array.isArray(parsed)) {
    throw new Error("Cookie payload must be a JSON array.");
  }
  return parsed as ProviderCookieImportRecord[];
};

const readCookiesFromSource = async (
  source: ProviderCookieSourceConfig
): Promise<{ cookies: ProviderCookieImportRecord[]; available: boolean; message?: string }> => {
  if (source.type === "inline") {
    return {
      cookies: source.value,
      available: source.value.length > 0,
      ...(source.value.length === 0 ? { message: "Inline cookie source is empty." } : {})
    };
  }

  if (source.type === "env") {
    const envValue = process.env[source.value];
    if (!envValue || envValue.trim().length === 0) {
      return {
        cookies: [],
        available: false,
        message: `Cookie env ${source.value} is not set.`
      };
    }
    try {
      const cookies = parseCookieArray(envValue);
      return { cookies, available: cookies.length > 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        cookies: [],
        available: false,
        message: `Cookie env ${source.value} is invalid JSON: ${message}`
      };
    }
  }

  const resolvedPath = expandHomePath(source.value);
  try {
    const payload = await readFile(resolvedPath, "utf8");
    const cookies = parseCookieArray(payload);
    return { cookies, available: cookies.length > 0 };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return {
        cookies: [],
        available: false,
        message: `Cookie file not found: ${resolvedPath}`
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      cookies: [],
      available: false,
      message: `Cookie file read failed: ${message}`
    };
  }
};

const resolveEffectiveCookiePolicy = (
  defaults: BrowserFallbackCookieConfig,
  request: { useCookies?: boolean; cookiePolicyOverride?: ProviderCookiePolicy }
): ProviderCookiePolicy => {
  if (request.cookiePolicyOverride) {
    return request.cookiePolicyOverride;
  }
  if (request.useCookies === false) {
    return "off";
  }
  if (request.useCookies === true && defaults.policy === "off") {
    return "auto";
  }
  return defaults.policy;
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
  cookieDiagnostics?: BrowserFallbackCookieDiagnostics
): BrowserFallbackResponse => ({
  ok: false,
  reasonCode,
  disposition: reasonCode === "env_limited" ? "deferred" : "failed",
  details: {
    message,
    ...(cookieDiagnostics ? { cookieDiagnostics: toJsonRecord(cookieDiagnostics) } : {})
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
    : DEFAULT_FALLBACK_DEFAULT_CAPTURE_DELAY_MS;
};

const sanitizeFallbackDelayMs = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
};

const waitForFallbackPageToSettle = async (
  manager: BrowserManagerLike,
  sessionId: string,
  source: "social" | "shopping" | "web" | "community",
  timeoutMs?: number
): Promise<void> => {
  if (typeof manager.waitForLoad !== "function") return;
  const networkIdleTimeoutMs = timeoutMs ?? resolveFallbackSettleTimeoutMs(source);
  try {
    await manager.waitForLoad(sessionId, "networkidle", networkIdleTimeoutMs);
  } catch {
    // Some sites never reach a clean networkidle state. Fall through to
    // best-effort DOM capture instead of failing the entire recovery path.
  }
};

const captureFallbackHtml = async (
  manager: BrowserManagerLike,
  sessionId: string,
  source: "social" | "shopping" | "web" | "community",
  captureDelayMs?: number
): Promise<string> => {
  return await manager.withPage(sessionId, null, async (page: unknown) => {
    const candidate = page as {
      waitForTimeout?: (ms: number) => Promise<void>;
      content?: () => Promise<string>;
    };
    if (typeof candidate.waitForTimeout === "function") {
      await candidate.waitForTimeout(captureDelayMs ?? resolveFallbackCaptureDelayMs(source));
    }
    if (typeof candidate.content !== "function") return "";
    return await candidate.content();
  });
};

const detectFallbackPageBlocker = (
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

export const createBrowserFallbackPort = (
  manager: BrowserManagerLike | undefined,
  cookieDefaults: Partial<BrowserFallbackCookieConfig> = {},
  transportDefaults: BrowserFallbackTransportConfig = {}
): BrowserFallbackPort | undefined => {
  if (!manager) return undefined;
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

      const preferredModes = request.preferredModes?.length
        ? [...new Set(request.preferredModes)]
        : ["managed_headed"];
      let lastFailure: BrowserFallbackResponse | null = null;

      for (const preferredMode of preferredModes) {
        let sessionId: string | null = null;
        let preserveSession = false;
        const policy = resolveEffectiveCookiePolicy(defaults, request);
        const cookieDiagnostics = baseCookieDiagnostics(policy, defaults.source);
        const abortListener = () => {
          if (sessionId) {
            void manager.disconnect(sessionId, true).catch(() => {
              // Best effort abort cleanup for fallback sessions.
            });
          }
        };
        request.signal?.addEventListener("abort", abortListener, { once: true });
        try {
          ensureNotAborted("mode_start");
          if (preferredMode === "extension") {
            if (!transportDefaults.extensionWsEndpoint) {
              lastFailure = fallbackFailure("env_limited", "Extension fallback requires a relay endpoint.", cookieDiagnostics);
              continue;
            }
            const attached = await manager.connectRelay(transportDefaults.extensionWsEndpoint);
            sessionId = attached.sessionId;
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
                lastFailure = fallbackFailure("auth_required", reasonMessage, cookieDiagnostics);
                continue;
              }
            }
          }

          await manager.goto(
            sessionId,
            requestUrl,
            "load",
            clampStepTimeoutMs(DEFAULT_FALLBACK_NAVIGATION_TIMEOUT_MS, "goto")
          );
          await waitForFallbackPageToSettle(
            manager,
            sessionId,
            request.source,
            clampStepTimeoutMs(
              sanitizeFallbackDelayMs(
                request.settleTimeoutMs,
                resolveFallbackSettleTimeoutMs(request.source)
              ),
              "settle"
            )
          );
          if (policy !== "off" && preferredMode === "extension") {
            const verified = await manager.cookieList(sessionId, [requestUrl]);
            cookieDiagnostics.available = verified.count > 0;
            cookieDiagnostics.verifiedCount = verified.count;
            if (policy === "required" && verified.count === 0) {
              const reasonMessage = "Provider cookies were not observable in the live extension session.";
              cookieDiagnostics.reasonCode = "auth_required";
              cookieDiagnostics.message = reasonMessage;
              lastFailure = fallbackFailure("auth_required", reasonMessage, cookieDiagnostics);
              continue;
            }
          }

          const html = await captureFallbackHtml(
            manager,
            sessionId,
            request.source,
            clampStepTimeoutMs(
              sanitizeFallbackDelayMs(
                request.captureDelayMs,
                resolveFallbackCaptureDelayMs(request.source)
              ),
              "capture"
            )
          );
          const status = await manager.status(sessionId);
          ensureNotAborted("status");
          const resolvedUrl = status.url ?? requestUrl;
          const blocker = detectFallbackPageBlocker(html, resolvedUrl);
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
                  cookieDiagnostics: toJsonRecord(cookieDiagnostics)
                }
              };
            }
            lastFailure = fallbackFailure(
              reasonCode,
              `Browser fallback reached ${blocker.type} page at ${resolvedUrl}.`,
              cookieDiagnostics
            );
            continue;
          }

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
              cookieDiagnostics: toJsonRecord(cookieDiagnostics)
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
          lastFailure = fallbackFailure("env_limited", message, cookieDiagnostics);
        } finally {
          request.signal?.removeEventListener("abort", abortListener);
          if (sessionId && !preserveSession) {
            await manager.disconnect(sessionId, true).catch(() => {
              // Best effort cleanup for fallback sessions.
            });
          }
        }
      }

      return lastFailure ?? fallbackFailure("env_limited", "Browser fallback exhausted all preferred modes.");
    }
  };
};

export const buildRuntimeInitFromConfig = (
  config: RuntimeConfig | undefined,
  browserFallbackPort?: BrowserFallbackPort
): Omit<RuntimeInit, "providers"> => {
  const providers = config?.providers;
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
    ...(browserFallbackPort ? { browserFallbackPort } : {})
  };
};

export const createConfiguredProviderRuntime = (args: {
  config?: RuntimeConfig;
  defaults?: RuntimeDefaults;
  manager?: BrowserManagerLike;
  browserFallbackPort?: BrowserFallbackPort;
  init?: Omit<RuntimeInit, "providers">;
}) => {
  const fallbackPort = args.browserFallbackPort ?? createBrowserFallbackPort(args.manager, {
    policy: args.config?.providers?.cookiePolicy,
    source: args.config?.providers?.cookieSource
  });
  const runtimeInit = {
    ...buildRuntimeInitFromConfig(args.config, fallbackPort),
    ...(args.init ?? {})
  };
  return createDefaultRuntime(args.defaults ?? {}, runtimeInit);
};
