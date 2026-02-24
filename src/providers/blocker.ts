import { redactSensitive } from "../core/logging";
import { sanitizePromptGuardText } from "./safety/prompt-guard";
import type {
  BlockerActionHint,
  BlockerArtifactCaps,
  BlockerArtifactsV1,
  BlockerSignalV1,
  BlockerType,
  JsonValue,
  ProviderReasonCode
} from "./types";

const AUTH_URL_PATTERNS: Array<{ id: string; regex: RegExp; confidence: number }> = [
  { id: "redirect_login_flow", regex: /\/i\/flow\/login/i, confidence: 0.97 },
  { id: "auth_login_path", regex: /\/(login|signin|sign-in|auth)(\/|\?|$)/i, confidence: 0.9 }
];

const AUTH_TITLE_PATTERNS: Array<{ id: string; regex: RegExp; confidence: number }> = [
  { id: "title_login", regex: /\b(log in|sign in)\b/i, confidence: 0.92 },
  { id: "title_auth_required", regex: /authentication required/i, confidence: 0.9 }
];

const CHALLENGE_PATTERNS: Array<{ id: string; regex: RegExp; confidence: number }> = [
  { id: "challenge_keyword", regex: /\b(challenge|captcha|verify|interstitial|cf_chl|bot)\b/i, confidence: 0.88 },
  { id: "prove_humanity", regex: /prove your humanity/i, confidence: 0.96 }
];

const RECAPTCHA_HOST_PATTERNS = [/recaptcha/i, /hcaptcha/i, /challenges\.cloudflare\.com/i];
const STATIC_BLOCK_HOST_PATTERNS = [/redditstatic\.com$/i, /abs\.twimg\.com$/i, /twimg\.com$/i];

const ENV_LIMITED_PATTERNS = [
  /extension not connected/i,
  /connect the extension/i,
  /manual interaction/i,
  /timed out/i,
  /not available in this environment/i
];

const RESTRICTED_TARGET_PATTERNS = [/^chrome:\/\//i, /^chrome-extension:\/\//i, /^about:blank$/i, /^devtools:\/\//i];

export const DEFAULT_BLOCKER_ARTIFACT_CAPS: BlockerArtifactCaps = {
  maxNetworkEvents: 20,
  maxConsoleEvents: 20,
  maxExceptionEvents: 10,
  maxHosts: 10,
  maxTextLength: 512
};

export interface BlockerClassificationInput {
  source: BlockerSignalV1["source"];
  url?: string;
  finalUrl?: string;
  title?: string;
  status?: number;
  providerErrorCode?: string;
  message?: string;
  matchedPatterns?: string[];
  networkHosts?: string[];
  traceRequestId?: string;
  retryable?: boolean;
  envLimited?: boolean;
  restrictedTarget?: boolean;
  promptGuardEnabled?: boolean;
  threshold?: number;
  detectedAt?: string;
}

export interface BlockerArtifactInput {
  networkEvents?: unknown[];
  consoleEvents?: unknown[];
  exceptionEvents?: unknown[];
  promptGuardEnabled?: boolean;
  caps?: Partial<BlockerArtifactCaps>;
}

const toLower = (value: string): string => value.trim().toLowerCase();

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const clampBlockerConfidence = (value: number): number => {
  return clampNumber(value, 0, 1);
};

const clampThreshold = (value: number | undefined): number => {
  if (typeof value !== "number") return 0.7;
  return clampNumber(value, 0, 1);
};

export const clampText = (value: string | undefined, maxLength: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (maxLength <= 0) return "";
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
};

export const boundedUniqueList = (
  values: readonly string[] | undefined,
  maxLength: number
): string[] => {
  if (!values || values.length === 0 || maxLength <= 0) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(normalized);
    if (list.length >= maxLength) break;
  }
  return list;
};

const extractHost = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    return toLower(new URL(value).hostname);
  } catch {
    return null;
  }
};

const scorePatternMatches = (
  text: string,
  patterns: Array<{ id: string; regex: RegExp; confidence: number }>
): { matched: string[]; confidence: number } => {
  const matched: string[] = [];
  let confidence = 0;
  for (const pattern of patterns) {
    if (!pattern.regex.test(text)) continue;
    matched.push(pattern.id);
    confidence = Math.max(confidence, pattern.confidence);
  }
  return { matched, confidence };
};

const hasAnyPattern = (value: string, patterns: RegExp[]): boolean => {
  return patterns.some((pattern) => pattern.test(value));
};

const isLoopbackHost = (value: string): boolean => {
  const normalized = toLower(value).replace(/^\[|\]$/g, "");
  if (!normalized) return false;
  if (normalized === "localhost" || normalized === "::1") return true;
  if (normalized === "127.0.0.1" || normalized.startsWith("127.")) return true;
  return /^::ffff:127\.\d+\.\d+\.\d+$/.test(normalized);
};

const buildHints = (type: BlockerType): BlockerActionHint[] => {
  switch (type) {
    case "auth_required":
      return [
        { id: "manual_login", reason: "Authentication flow requires interactive login.", priority: 1 },
        { id: "switch_managed_headed", reason: "Headed mode can complete login and persist session state.", priority: 2 },
        { id: "switch_extension_mode", reason: "Extension mode can reuse an already logged-in browser profile.", priority: 3 }
      ];
    case "anti_bot_challenge":
      return [
        { id: "manual_challenge", reason: "Challenge page requires manual completion.", priority: 1 },
        { id: "switch_managed_headed", reason: "Headed mode improves challenge completion reliability.", priority: 2 },
        { id: "collect_debug_trace", reason: "Collect trace artifacts to compare challenge indicators before and after manual action.", priority: 3 }
      ];
    case "rate_limited":
      return [
        { id: "retry_after_backoff", reason: "Rate-limited responses should be retried after a bounded delay.", priority: 1 },
        { id: "collect_debug_trace", reason: "Trace data can confirm cooldown and request pacing behavior.", priority: 2 }
      ];
    case "upstream_block":
      return [
        { id: "retry_after_backoff", reason: "Upstream blocks may clear after network or host recovery.", priority: 1 },
        { id: "switch_managed_headed", reason: "Browser-assisted retrieval may bypass runtime fetch limitations.", priority: 2 },
        { id: "collect_debug_trace", reason: "Trace host evidence helps confirm blocked upstream dependencies.", priority: 3 }
      ];
    case "restricted_target":
      return [
        { id: "switch_managed_headed", reason: "Restricted internal targets require navigation to a normal http(s) tab.", priority: 1 },
        { id: "collect_debug_trace", reason: "Trace confirms blocked scheme or tab restriction source.", priority: 2 }
      ];
    case "env_limited":
      return [
        { id: "switch_extension_mode", reason: "Extension relay availability is required for this operation.", priority: 1 },
        { id: "switch_managed_headed", reason: "Managed headed mode is a deterministic fallback when extension is unavailable.", priority: 2 },
        { id: "collect_debug_trace", reason: "Diagnostics can confirm environment capability gaps.", priority: 3 }
      ];
    case "unknown":
      return [{ id: "collect_debug_trace", reason: "Additional trace evidence is required for reliable classification.", priority: 1 }];
  }
};

const classifyFromInputs = (
  input: BlockerClassificationInput,
  normalizedHosts: string[],
  matchedPatterns: string[]
): { type: BlockerType; reasonCode?: ProviderReasonCode; confidence: number; retryable: boolean; matches: string[] } | null => {
  const status = input.status;
  const code = toLower(input.providerErrorCode ?? "");
  const url = input.url ?? "";
  const finalUrl = input.finalUrl ?? "";
  const title = input.title ?? "";
  const message = input.message ?? "";
  const challengeText = `${title} ${message}`;
  const urlSignals = `${url} ${finalUrl}`;
  const isUpstreamCode = code === "upstream" || code === "network" || code === "unavailable";
  const hasStaticBlockHost = normalizedHosts.some((host) => hasAnyPattern(host, STATIC_BLOCK_HOST_PATTERNS));
  const isLoopbackContext = [
    extractHost(url),
    extractHost(finalUrl),
    ...normalizedHosts
  ].some((host): host is string => typeof host === "string" && isLoopbackHost(host));

  const authMatches: string[] = [];
  let authConfidence = 0;
  if (status === 401 || status === 403) {
    authMatches.push(`status:${status}`);
    authConfidence = Math.max(authConfidence, status === 401 ? 0.94 : 0.9);
  }
  if (code === "auth") {
    authMatches.push("provider_code:auth");
    authConfidence = Math.max(authConfidence, 0.9);
  }
  const authPathMatches = scorePatternMatches(`${url} ${finalUrl}`, AUTH_URL_PATTERNS);
  authMatches.push(...authPathMatches.matched);
  authConfidence = Math.max(authConfidence, authPathMatches.confidence);
  const authTitleMatches = scorePatternMatches(title, AUTH_TITLE_PATTERNS);
  authMatches.push(...authTitleMatches.matched);
  authConfidence = Math.max(authConfidence, authTitleMatches.confidence);
  if (authConfidence > 0) {
    return {
      type: "auth_required",
      reasonCode: "token_required",
      confidence: authConfidence,
      retryable: false,
      matches: boundedUniqueList([...matchedPatterns, ...authMatches], 16)
    };
  }

  if (!isLoopbackContext) {
    const challengeMatches: string[] = [];
    let challengeConfidence = 0;
    const challengePatternMatches = scorePatternMatches(challengeText, CHALLENGE_PATTERNS);
    challengeMatches.push(...challengePatternMatches.matched);
    challengeConfidence = Math.max(challengeConfidence, challengePatternMatches.confidence);
    if (/(captcha|cf_chl|hcaptcha|recaptcha|interstitial)/i.test(urlSignals)) {
      challengeMatches.push("url:challenge_token");
      challengeConfidence = Math.max(challengeConfidence, 0.9);
    }
    if (hasAnyPattern(title, CHALLENGE_PATTERNS.map((entry) => entry.regex)) && status === 200) {
      challengeMatches.push("status:200_challenge_title");
      challengeConfidence = Math.max(challengeConfidence, 0.92);
    }
    if (normalizedHosts.some((host) => hasAnyPattern(host, RECAPTCHA_HOST_PATTERNS))) {
      challengeMatches.push("network:challenge_host");
      challengeConfidence = Math.max(challengeConfidence, 0.96);
    }
    if (challengeConfidence > 0) {
      return {
        type: "anti_bot_challenge",
        reasonCode: "challenge_detected",
        confidence: challengeConfidence,
        retryable: false,
        matches: boundedUniqueList([...matchedPatterns, ...challengeMatches], 16)
      };
    }
  }

  if (status === 429 || code === "rate_limited") {
    return {
      type: "rate_limited",
      reasonCode: "rate_limited",
      confidence: 0.95,
      retryable: true,
      matches: boundedUniqueList([...matchedPatterns, status === 429 ? "status:429" : "provider_code:rate_limited"], 16)
    };
  }

  if (isUpstreamCode && (hasStaticBlockHost || /retrieval failed/i.test(message) || (typeof status === "number" && status >= 500))) {
    return {
      type: "upstream_block",
      reasonCode: "ip_blocked",
      confidence: hasStaticBlockHost ? 0.9 : 0.8,
      retryable: input.retryable ?? true,
      matches: boundedUniqueList(
        [
          ...matchedPatterns,
          `provider_code:${code}`,
          ...(hasStaticBlockHost ? ["network:blocked_static_host"] : [])
        ],
        16
      )
    };
  }

  if (
    input.restrictedTarget
    || RESTRICTED_TARGET_PATTERNS.some((pattern) => pattern.test(url))
    || RESTRICTED_TARGET_PATTERNS.some((pattern) => pattern.test(finalUrl))
  ) {
    return {
      type: "restricted_target",
      confidence: 0.92,
      retryable: false,
      matches: boundedUniqueList([...matchedPatterns, "restricted_target"], 16)
    };
  }

  if (input.envLimited || (code === "unavailable" && ENV_LIMITED_PATTERNS.some((pattern) => pattern.test(message)))) {
    return {
      type: "env_limited",
      reasonCode: "env_limited",
      confidence: input.envLimited ? 0.9 : 0.78,
      retryable: true,
      matches: boundedUniqueList([...matchedPatterns, "env_limited"], 16)
    };
  }

  if (status || code || title || message || normalizedHosts.length > 0) {
    return {
      type: "unknown",
      confidence: 0.5,
      retryable: input.retryable ?? false,
      matches: boundedUniqueList(matchedPatterns, 16)
    };
  }

  return null;
};

const coerceJsonValue = (
  value: unknown,
  maxTextLength: number,
  promptGuardEnabled: boolean,
  diagnostics: { entries: number; quarantinedSegments: number },
  seen: WeakSet<object>
): JsonValue => {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const sanitized = sanitizePromptGuardText(value, promptGuardEnabled);
    diagnostics.entries += sanitized.diagnostics.entries;
    diagnostics.quarantinedSegments += sanitized.diagnostics.quarantinedSegments;
    const redacted = redactSensitive(sanitized.text);
    const asString = typeof redacted === "string" ? redacted : String(redacted);
    return clampText(asString, maxTextLength) ?? "";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => coerceJsonValue(entry, maxTextLength, promptGuardEnabled, diagnostics, seen));
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  const objectValue = value as Record<string, unknown>;
  const entries = Object.entries(objectValue).slice(0, 30);
  const output: Record<string, JsonValue> = {};
  for (const [key, entryValue] of entries) {
    output[key] = coerceJsonValue(entryValue, maxTextLength, promptGuardEnabled, diagnostics, seen);
  }
  return output;
};

const coerceEventList = (
  values: unknown[] | undefined,
  maxItems: number,
  maxTextLength: number,
  promptGuardEnabled: boolean,
  diagnostics: { entries: number; quarantinedSegments: number }
): Array<Record<string, JsonValue>> => {
  if (!Array.isArray(values) || maxItems <= 0) return [];
  return values.slice(-maxItems).map((entry) => {
    const sanitized = coerceJsonValue(
      redactSensitive(entry),
      maxTextLength,
      promptGuardEnabled,
      diagnostics,
      new WeakSet<object>()
    );
    if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
      return { value: sanitized };
    }
    return sanitized as Record<string, JsonValue>;
  });
};

export const resolveBlockerArtifactCaps = (
  partial: Partial<BlockerArtifactCaps> | undefined
): BlockerArtifactCaps => {
  return {
    maxNetworkEvents: clampNumber(partial?.maxNetworkEvents ?? DEFAULT_BLOCKER_ARTIFACT_CAPS.maxNetworkEvents, 1, 500),
    maxConsoleEvents: clampNumber(partial?.maxConsoleEvents ?? DEFAULT_BLOCKER_ARTIFACT_CAPS.maxConsoleEvents, 1, 500),
    maxExceptionEvents: clampNumber(partial?.maxExceptionEvents ?? DEFAULT_BLOCKER_ARTIFACT_CAPS.maxExceptionEvents, 1, 200),
    maxHosts: clampNumber(partial?.maxHosts ?? DEFAULT_BLOCKER_ARTIFACT_CAPS.maxHosts, 1, 200),
    maxTextLength: clampNumber(partial?.maxTextLength ?? DEFAULT_BLOCKER_ARTIFACT_CAPS.maxTextLength, 32, 4096)
  };
};

export const classifyBlockerSignal = (
  input: BlockerClassificationInput
): BlockerSignalV1 | null => {
  const promptGuardEnabled = input.promptGuardEnabled ?? true;
  const titleSanitized = sanitizePromptGuardText(input.title ?? "", promptGuardEnabled);
  const messageSanitized = sanitizePromptGuardText(input.message ?? "", promptGuardEnabled);
  const matchedPatterns = boundedUniqueList(input.matchedPatterns, 16);
  const normalizedHosts = boundedUniqueList(input.networkHosts?.map(toLower), 20);

  const classification = classifyFromInputs({
    ...input,
    title: titleSanitized.text,
    message: messageSanitized.text
  }, normalizedHosts, matchedPatterns);
  if (!classification) {
    return null;
  }

  const threshold = clampThreshold(input.threshold);
  const confidence = clampBlockerConfidence(classification.confidence);
  if (confidence < threshold) {
    return null;
  }

  const evidence = {
    ...(input.url ? { url: clampText(input.url, 512) } : {}),
    ...(input.finalUrl ? { finalUrl: clampText(input.finalUrl, 512) } : {}),
    ...(titleSanitized.text ? { title: clampText(titleSanitized.text, 512) } : {}),
    ...(typeof input.status === "number" ? { status: input.status } : {}),
    ...(input.providerErrorCode ? { providerErrorCode: input.providerErrorCode } : {}),
    matchedPatterns: boundedUniqueList(classification.matches, 16),
    networkHosts: boundedUniqueList(normalizedHosts, 10),
    ...(input.traceRequestId ? { traceRequestId: input.traceRequestId } : {})
  };

  const sanitationEntries = titleSanitized.diagnostics.entries + messageSanitized.diagnostics.entries;
  const sanitationQuarantined = titleSanitized.diagnostics.quarantinedSegments + messageSanitized.diagnostics.quarantinedSegments;

  return {
    schemaVersion: "1.0",
    type: classification.type,
    source: input.source,
    ...(classification.reasonCode ? { reasonCode: classification.reasonCode } : {}),
    confidence,
    retryable: classification.retryable,
    detectedAt: input.detectedAt ?? new Date().toISOString(),
    evidence,
    actionHints: buildHints(classification.type),
    ...(sanitationEntries > 0 || sanitationQuarantined > 0
      ? {
        sanitation: {
          entries: sanitationEntries,
          quarantinedSegments: sanitationQuarantined
        }
      }
      : {})
  };
};

export const buildBlockerArtifacts = (input: BlockerArtifactInput): BlockerArtifactsV1 => {
  const caps = resolveBlockerArtifactCaps(input.caps);
  const promptGuardEnabled = input.promptGuardEnabled ?? true;
  const diagnostics = {
    entries: 0,
    quarantinedSegments: 0
  };

  const network = coerceEventList(
    input.networkEvents,
    caps.maxNetworkEvents,
    caps.maxTextLength,
    promptGuardEnabled,
    diagnostics
  );
  const console = coerceEventList(
    input.consoleEvents,
    caps.maxConsoleEvents,
    caps.maxTextLength,
    promptGuardEnabled,
    diagnostics
  );
  const exception = coerceEventList(
    input.exceptionEvents,
    caps.maxExceptionEvents,
    caps.maxTextLength,
    promptGuardEnabled,
    diagnostics
  );

  const hosts = boundedUniqueList(
    network
      .map((event) => (typeof event.url === "string" ? extractHost(event.url) : null))
      .filter((host): host is string => typeof host === "string"),
    caps.maxHosts
  );

  return {
    schemaVersion: "1.0",
    network,
    console,
    exception,
    hosts,
    sanitation: diagnostics
  };
};

export const __test__ = {
  classifyFromInputs,
  extractHost,
  hasAnyPattern,
  clampThreshold,
  isLoopbackHost
};
