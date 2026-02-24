export type ProviderSource = "web" | "community" | "social" | "shopping";
export type ProviderSelection = "auto" | ProviderSource | "all";
export type ProviderOperation = "search" | "fetch" | "crawl" | "post";
export type ProviderTier = "A" | "B" | "C";

export type ProviderTierReasonCode =
  | "default_tier"
  | "operator_override"
  | "restricted_safe_forced"
  | "challenge_pressure"
  | "high_friction_target"
  | "hybrid_eligible"
  | "hybrid_unhealthy"
  | "hybrid_risk_threshold"
  | "hybrid_latency_budget"
  | "hybrid_error_budget"
  | "policy_restricted_safe"
  | "restricted_safe_recovered"
  | "hybrid_disabled"
  | "restricted_safe_disabled"
  | "fallback_to_tier_a";

export type ProviderReasonCode =
  | "ip_blocked"
  | "token_required"
  | "auth_required"
  | "challenge_detected"
  | "rate_limited"
  | "caption_missing"
  | "env_limited"
  | "transcript_unavailable"
  | "policy_blocked"
  | "cooldown_active"
  | "strategy_unapproved";

export type ProviderCookiePolicy = "off" | "auto" | "required";

export type ProviderCookieImportRecord = {
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

export type ProviderCookieSourceConfig =
  | {
    type: "file";
    value: string;
  }
  | {
    type: "env";
    value: string;
  }
  | {
    type: "inline";
    value: ProviderCookieImportRecord[];
  };

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type BlockerType =
  | "auth_required"
  | "anti_bot_challenge"
  | "rate_limited"
  | "upstream_block"
  | "restricted_target"
  | "env_limited"
  | "unknown";

export type BlockerSource =
  | "navigation"
  | "network"
  | "console"
  | "runtime_fetch"
  | "macro_execution";

export type BlockerActionHintId =
  | "manual_login"
  | "manual_challenge"
  | "retry_after_backoff"
  | "switch_managed_headed"
  | "switch_extension_mode"
  | "collect_debug_trace";

export interface BlockerEvidence {
  url?: string;
  finalUrl?: string;
  title?: string;
  status?: number;
  providerErrorCode?: string;
  matchedPatterns: string[];
  networkHosts: string[];
  traceRequestId?: string;
}

export interface BlockerActionHint {
  id: BlockerActionHintId;
  reason: string;
  priority: 1 | 2 | 3;
}

export interface BlockerSanitationDiagnostics {
  entries: number;
  quarantinedSegments: number;
}

export interface BlockerSignalV1 {
  schemaVersion: "1.0";
  type: BlockerType;
  source: BlockerSource;
  reasonCode?: ProviderReasonCode;
  confidence: number;
  retryable: boolean;
  detectedAt: string;
  evidence: BlockerEvidence;
  actionHints: BlockerActionHint[];
  sanitation?: BlockerSanitationDiagnostics;
}

export interface BlockerArtifactCaps {
  maxNetworkEvents: number;
  maxConsoleEvents: number;
  maxExceptionEvents: number;
  maxHosts: number;
  maxTextLength: number;
}

export interface BlockerArtifactsV1 {
  schemaVersion: "1.0";
  network: Array<Record<string, JsonValue>>;
  console: Array<Record<string, JsonValue>>;
  exception: Array<Record<string, JsonValue>>;
  hosts: string[];
  sanitation: BlockerSanitationDiagnostics;
}

export type ProviderErrorCode =
  | "invalid_input"
  | "timeout"
  | "network"
  | "rate_limited"
  | "auth"
  | "upstream"
  | "not_supported"
  | "policy_blocked"
  | "circuit_open"
  | "unavailable"
  | "internal";

export interface TraceContext {
  requestId: string;
  sessionId?: string;
  targetId?: string;
  provider?: string;
  ts: string;
}

export interface NormalizedRecord {
  id: string;
  source: ProviderSource;
  provider: string;
  url?: string;
  title?: string;
  content?: string;
  timestamp: string;
  confidence: number;
  attributes: Record<string, JsonValue>;
}

export interface ProviderSearchInput {
  query: string;
  limit?: number;
  filters?: Record<string, JsonValue>;
}

export interface ProviderFetchInput {
  url: string;
  filters?: Record<string, JsonValue>;
}

export type CrawlStrategy = "bfs" | "dfs";

export interface ProviderCrawlInput {
  seedUrls: string[];
  strategy?: CrawlStrategy;
  maxDepth?: number;
  maxPages?: number;
  maxPerDomain?: number;
  filters?: Record<string, JsonValue>;
}

export interface ProviderPostInput {
  target: string;
  content: string;
  mediaUrls?: string[];
  confirm?: boolean;
  riskAccepted?: boolean;
  metadata?: Record<string, JsonValue>;
}

export type ProviderInput =
  | ProviderSearchInput
  | ProviderFetchInput
  | ProviderCrawlInput
  | ProviderPostInput;

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  reasonCode?: ProviderReasonCode;
  provider?: string;
  source?: ProviderSource;
  details?: Record<string, JsonValue>;
}

export interface ProviderContext {
  trace: TraceContext;
  timeoutMs: number;
  attempt: number;
  signal?: AbortSignal;
  useCookies?: boolean;
  cookiePolicyOverride?: ProviderCookiePolicy;
  browserFallbackPort?: BrowserFallbackPort;
}

export interface ProviderHealth {
  status: "healthy" | "degraded" | "unhealthy";
  updatedAt: string;
  reason?: string;
  latencyMs?: number;
}

export interface ProviderCapability {
  op: ProviderOperation;
  supported: boolean;
  description?: string;
  metadata?: Record<string, JsonValue>;
}

export interface ProviderCapabilities {
  providerId: string;
  source: ProviderSource;
  operations: Record<ProviderOperation, ProviderCapability>;
  policy: {
    posting: "unsupported" | "gated" | "open";
    riskNoticeRequired: boolean;
    confirmationRequired: boolean;
  };
  metadata: Record<string, JsonValue>;
}

export interface ProviderTierMetadata {
  selected: ProviderTier;
  reasonCode: ProviderTierReasonCode;
}

export interface ProviderProvenanceMetadata {
  provider: string;
  retrievalPath: string;
  retrievedAt: string;
}

export interface ProviderExecutionMetadata {
  tier: ProviderTierMetadata;
  provenance: ProviderProvenanceMetadata;
  blocker?: BlockerSignalV1;
}

export interface AdaptiveConcurrencyDiagnostics {
  enabled: boolean;
  scope: string;
  global: {
    limit: number;
    min: number;
    max: number;
  };
  scoped: {
    limit: number;
    min: number;
    max: number;
  };
}

export interface PromptGuardAudit {
  enabled: boolean;
  quarantinedSegments: number;
  entries: number;
}

export interface RealismDiagnostics {
  violations: number;
  patterns: string[];
}

export interface ProviderRuntimeDiagnostics {
  adaptiveConcurrency: AdaptiveConcurrencyDiagnostics;
  promptGuard: PromptGuardAudit;
  realism: RealismDiagnostics;
}

export interface ProviderOperationSuccess {
  ok: true;
  records: NormalizedRecord[];
  trace: TraceContext;
  provider: string;
  source: ProviderSource;
  latencyMs: number;
  attempts: number;
  retries: number;
  meta?: ProviderExecutionMetadata;
  provenance?: Record<string, JsonValue>;
  diagnostics?: ProviderRuntimeDiagnostics;
}

export interface ProviderOperationFailure {
  ok: false;
  error: ProviderError;
  trace: TraceContext;
  provider: string;
  source: ProviderSource;
  latencyMs: number;
  attempts: number;
  retries: number;
  meta?: ProviderExecutionMetadata;
  diagnostics?: ProviderRuntimeDiagnostics;
}

export type ProviderOperationResult = ProviderOperationSuccess | ProviderOperationFailure;

export interface ProviderFailureEntry {
  provider: string;
  source: ProviderSource;
  error: ProviderError;
}

export interface ProviderAggregateResult {
  ok: boolean;
  records: NormalizedRecord[];
  trace: TraceContext;
  partial: boolean;
  failures: ProviderFailureEntry[];
  metrics: {
    attempted: number;
    succeeded: number;
    failed: number;
    retries: number;
    latencyMs: number;
  };
  sourceSelection: ProviderSelection;
  providerOrder: string[];
  meta?: ProviderExecutionMetadata;
  diagnostics?: ProviderRuntimeDiagnostics;
  error?: ProviderError;
}

export interface ProviderAdapter {
  id: string;
  source: ProviderSource;
  search?: (input: ProviderSearchInput, context: ProviderContext) => Promise<NormalizedRecord[]>;
  fetch?: (input: ProviderFetchInput, context: ProviderContext) => Promise<NormalizedRecord[]>;
  crawl?: (input: ProviderCrawlInput, context: ProviderContext) => Promise<NormalizedRecord[]>;
  post?: (input: ProviderPostInput, context: ProviderContext) => Promise<NormalizedRecord[]>;
  health?: (context: Omit<ProviderContext, "attempt">) => Promise<ProviderHealth>;
  capabilities: () => ProviderCapabilities;
}

export interface ProviderRuntimeBudgets {
  timeoutMs: Record<ProviderOperation, number>;
  retries: {
    read: number;
    write: number;
  };
  concurrency: {
    global: number;
    perProvider: number;
    perDomain?: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    cooldownMs: number;
  };
}

export interface ProviderRunOptions {
  source?: ProviderSelection;
  providerIds?: string[];
  timeoutMs?: number;
  trace?: Partial<TraceContext>;
  useCookies?: boolean;
  cookiePolicyOverride?: ProviderCookiePolicy;
  tier?: {
    preferred?: ProviderTier;
    forceRestrictedSafe?: boolean;
    challengePressure?: number;
    highFrictionTarget?: boolean;
    riskScore?: number;
    hybridHealthy?: boolean;
    policyRestrictedSafe?: boolean;
    latencyBudgetExceeded?: boolean;
    errorBudgetExceeded?: boolean;
    recoveryStableForMs?: number;
    policyAllowsRecovery?: boolean;
  };
}

export type BrowserFallbackMode = "managed_headed" | "extension";

export interface BrowserFallbackRequest {
  provider: string;
  source: ProviderSource;
  operation: ProviderOperation;
  reasonCode: ProviderReasonCode;
  trace: TraceContext;
  url?: string;
  details?: Record<string, JsonValue>;
  preferredModes?: BrowserFallbackMode[];
  useCookies?: boolean;
  cookiePolicyOverride?: ProviderCookiePolicy;
}

export interface BrowserFallbackResponse {
  ok: boolean;
  reasonCode: ProviderReasonCode;
  mode?: BrowserFallbackMode;
  output?: Record<string, JsonValue>;
  details?: Record<string, JsonValue>;
}

export interface BrowserFallbackPort {
  resolve: (request: BrowserFallbackRequest) => Promise<BrowserFallbackResponse>;
}

export type ProviderCallResultByOperation = {
  search: ProviderSearchInput;
  fetch: ProviderFetchInput;
  crawl: ProviderCrawlInput;
  post: ProviderPostInput;
};

declare module "./web/crawler" {
  interface CrawlOptions {
    workerThreads?: number;
    queueMax?: number;
    forceInlineParse?: boolean;
  }
}
