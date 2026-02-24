import * as path from "path";
import * as os from "os";
import { readFile } from "fs/promises";
import type { BrowserManagerLike } from "../browser/manager-types";
import type { OpenDevBrowserConfig } from "../config";
import { createDefaultRuntime, type RuntimeDefaults, type RuntimeInit } from "./index";
import type {
  BrowserFallbackMode,
  BrowserFallbackPort,
  BrowserFallbackResponse,
  ProviderCookieImportRecord,
  ProviderCookiePolicy,
  ProviderCookieSourceConfig
} from "./types";

type RuntimeConfig = Pick<OpenDevBrowserConfig, "blockerDetectionThreshold" | "security" | "providers">;

type BrowserFallbackCookieConfig = {
  policy: ProviderCookiePolicy;
  source: ProviderCookieSourceConfig;
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
  details: {
    message,
    ...(cookieDiagnostics ? { cookieDiagnostics } : {})
  }
});

export const createBrowserFallbackPort = (
  manager: BrowserManagerLike | undefined,
  cookieDefaults: Partial<BrowserFallbackCookieConfig> = {}
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

      let sessionId: string | null = null;
      const policy = resolveEffectiveCookiePolicy(defaults, request);
      const cookieDiagnostics = baseCookieDiagnostics(policy, defaults.source);
      try {
        const launched = await manager.launch({
          // Force managed fallback so retrieval recovery is not coupled to extension relay state.
          noExtension: true,
          headless: false,
          startUrl: "about:blank",
          // Browser fallback sessions are transient and should not contend for persisted profile locks.
          persistProfile: false
        });
        sessionId = launched.sessionId;

        if (policy !== "off") {
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
              return fallbackFailure("auth_required", reasonMessage, cookieDiagnostics);
            }
          }
        }

        await manager.goto(sessionId, requestUrl, "load", 45000);
        const html = await manager.withPage(sessionId, null, async (page: unknown) => {
          const candidate = page as { content?: () => Promise<string> };
          if (typeof candidate.content !== "function") return "";
          return await candidate.content();
        });
        const status = await manager.status(sessionId);

        return {
          ok: true,
          reasonCode: request.reasonCode,
          mode: toFallbackMode(status.mode),
          output: {
            html,
            url: status.url ?? requestUrl
          },
          details: {
            provider: request.provider,
            operation: request.operation,
            cookieDiagnostics
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fallbackFailure("env_limited", message, cookieDiagnostics);
      } finally {
        if (sessionId) {
          await manager.disconnect(sessionId, true).catch(() => {
            // Best effort cleanup for fallback sessions.
          });
        }
      }
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
