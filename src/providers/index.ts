import { ProviderRuntimeError, toProviderError } from "./errors";
import { createExecutionMetadata, normalizeFailure, normalizeSuccess, createTraceContext } from "./normalize";
import { selectProviders } from "./policy";
import { ProviderRegistry } from "./registry";
import { AdaptiveConcurrencyController } from "./adaptive-concurrency";
import { applyPromptGuard } from "./safety/prompt-guard";
import { fallbackTierMetadata, selectTierRoute, shouldFallbackToTierA } from "./tier-router";
import { createLogger } from "../core/logging";
import { createCommunityProvider, type CommunityProviderOptions } from "./community";
import { createSocialProviders, type SocialPlatform, type SocialProviderOptions, type SocialProvidersOptions } from "./social";
import { isLikelyDocumentUrl } from "./shared/traversal-url";
import { createWebProvider, type WebProviderOptions } from "./web";
import { classifyBlockerSignal } from "./blocker";
import { canonicalizeUrl } from "./web/crawler";
import { extractStructuredContent, toSnippet } from "./web/extract";
import type {
  AdaptiveConcurrencyDiagnostics,
  BlockerSignalV1,
  JsonValue,
  NormalizedRecord,
  ProviderAdapter,
  ProviderAggregateResult,
  ProviderCallResultByOperation,
  ProviderContext,
  ProviderExecutionMetadata,
  ProviderOperation,
  ProviderOperationResult,
  ProviderRunOptions,
  ProviderRuntimeBudgets,
  ProviderRuntimeDiagnostics,
  ProviderSelection,
  ProviderTierMetadata,
  TraceContext
} from "./types";

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private limit: number) {}

  setLimit(limit: number): void {
    this.limit = Math.max(1, Math.floor(limit));
    this.drain();
  }

  snapshot(): { limit: number; active: number; queued: number } {
    return {
      limit: this.limit,
      active: this.active,
      queued: this.queue.length
    };
  }

  async use<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.limit <= 0) return;
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    if (this.limit <= 0) return;
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  private drain(): void {
    if (this.limit <= 0) return;
    while (this.active < this.limit) {
      const next = this.queue.shift();
      if (!next) return;
      next();
    }
  }
}

export const DEFAULT_PROVIDER_BUDGETS: ProviderRuntimeBudgets = {
  timeoutMs: {
    search: 12000,
    fetch: 12000,
    crawl: 20000,
    post: 15000
  },
  retries: {
    read: 1,
    write: 0
  },
  concurrency: {
    global: 4,
    perProvider: 2,
    perDomain: 2
  },
  circuitBreaker: {
    failureThreshold: 3,
    cooldownMs: 30000
  }
};

const isReadOperation = (operation: ProviderOperation): boolean => operation !== "post";

type RuntimeTierConfig = {
  defaultTier: "A" | "B" | "C";
  enableHybrid: boolean;
  enableRestrictedSafe: boolean;
  hybridRiskThreshold: number;
  restrictedSafeRecoveryIntervalMs: number;
};

const DEFAULT_TIER_CONFIG = {
  defaultTier: "A",
  enableHybrid: false,
  enableRestrictedSafe: false,
  hybridRiskThreshold: 0.6,
  restrictedSafeRecoveryIntervalMs: 60000
} satisfies RuntimeTierConfig;

const PLACEHOLDER_PATTERNS: Array<{ code: string; regex: RegExp }> = [
  { code: "placeholder_local_url", regex: /https?:\/\/(?:placeholder|synthetic|example)\.local(?:\/|$)/i },
  { code: "placeholder_token", regex: /\b(?:todo|placeholder|lorem ipsum)\b/i },
  { code: "echo_input", regex: /\b(?:seed url|query):\s*["'`].{1,120}["'`]/i }
];

const RUNTIME_FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "opendevbrowser/1.0"
} as const;

const SOCIAL_SEARCH_ENDPOINTS: Record<SocialPlatform, (query: string, page: number) => string> = {
  x: (query, page) => `https://x.com/search?q=${encodeURIComponent(query)}&f=live&page=${page}`,
  reddit: (query, page) => `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=relevance&t=all&page=${page}`,
  bluesky: (query, page) => `https://bsky.app/search?q=${encodeURIComponent(query)}&page=${page}`,
  linkedin: (query, page) => `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&page=${page}`,
  instagram: (query, page) => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}&page=${page}`,
  tiktok: (query, page) => `https://www.tiktok.com/search?q=${encodeURIComponent(query)}&page=${page}`,
  threads: (query, page) => `https://www.threads.net/search?q=${encodeURIComponent(query)}&page=${page}`
};

type RuntimeFetchSource = "web" | "community" | "social";

type RuntimeFetchedDocument = {
  url: string;
  status: number;
  html: string;
  text: string;
  links: string[];
};

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.floor(parsed));
    }
  }
  return fallback;
};

const clampBlockerThreshold = (value: number | undefined): number => {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.7;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const stripUrls = (value: string): string => {
  return value.replace(/https?:\/\/[^\s]+/gi, " ").replace(/\s+/g, " ").trim();
};

const normalizeHttpLink = (candidate: string, baseUrl: string): string | null => {
  try {
    const resolved = new URL(candidate, baseUrl).toString();
    if (!isHttpUrl(resolved)) return null;
    return canonicalizeUrl(resolved);
  } catch {
    return null;
  }
};

const dedupeLinks = (links: string[], baseUrl: string, limit: number): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const candidate of links) {
    const normalized = normalizeHttpLink(candidate, baseUrl);
    if (!normalized || !isLikelyDocumentUrl(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= limit) break;
  }
  return deduped;
};

const fetchRuntimeDocument = async (args: {
  url: string;
  provider: string;
  source: RuntimeFetchSource;
  signal?: AbortSignal;
}): Promise<RuntimeFetchedDocument> => {
  if (!isHttpUrl(args.url)) {
    throw new ProviderRuntimeError("invalid_input", "Retrieval URL must be an HTTP(S) URL", {
      provider: args.provider,
      source: args.source,
      retryable: false,
      details: { url: args.url }
    });
  }

  let response: Response;
  try {
    response = await fetch(args.url, {
      headers: RUNTIME_FETCH_HEADERS,
      redirect: "follow",
      signal: args.signal
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("abort")) {
      throw new ProviderRuntimeError("timeout", `Timed out retrieving ${args.url}`, {
        provider: args.provider,
        source: args.source,
        retryable: true,
        cause: error
      });
    }
    throw new ProviderRuntimeError("network", `Failed to retrieve ${args.url}`, {
      provider: args.provider,
      source: args.source,
      retryable: true,
      cause: error
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderRuntimeError("auth", `Authentication required for ${args.url}`, {
      provider: args.provider,
      source: args.source,
      retryable: false
    });
  }
  if (response.status === 429) {
    throw new ProviderRuntimeError("rate_limited", `Rate limited while retrieving ${args.url}`, {
      provider: args.provider,
      source: args.source,
      retryable: true
    });
  }
  if (response.status >= 500) {
    throw new ProviderRuntimeError("upstream", `Upstream failed while retrieving ${args.url}`, {
      provider: args.provider,
      source: args.source,
      retryable: true
    });
  }
  if (response.status >= 400) {
    throw new ProviderRuntimeError("unavailable", `Retrieval failed for ${args.url}`, {
      provider: args.provider,
      source: args.source,
      retryable: false
    });
  }

  const resolvedUrl = canonicalizeUrl(response.url || args.url);
  const html = await response.text();
  const extracted = extractStructuredContent(html, resolvedUrl);
  return {
    url: resolvedUrl,
    status: response.status,
    html,
    text: extracted.text,
    links: extracted.links
  };
};

export interface RuntimeInit {
  budgets?: Partial<ProviderRuntimeBudgets>;
  providers?: ProviderAdapter[];
  tiers?: Partial<RuntimeTierConfig>;
  adaptiveConcurrency?: {
    enabled?: boolean;
    maxGlobal?: number;
    maxPerDomain?: number;
  };
  blockerDetectionThreshold?: number;
  promptInjectionGuard?: {
    enabled?: boolean;
  };
}

export interface RuntimeDefaults {
  web?: WebProviderOptions;
  community?: CommunityProviderOptions;
  social?: SocialProvidersOptions;
}

export class ProviderRuntime {
  readonly registry: ProviderRegistry;
  private readonly logger = createLogger("provider-runtime");
  private budgets: ProviderRuntimeBudgets;
  private globalSemaphore: Semaphore;
  private readonly scopedSemaphores = new Map<string, Semaphore>();
  private readonly tierConfig: RuntimeTierConfig;
  private readonly promptGuardEnabled: boolean;
  private readonly blockerDetectionThreshold: number;
  private readonly adaptiveConfig: Required<NonNullable<RuntimeInit["adaptiveConcurrency"]>>;
  private adaptiveConcurrency: AdaptiveConcurrencyController;

  constructor(init: RuntimeInit = {}) {
    this.registry = new ProviderRegistry();
    this.budgets = mergeBudgets(DEFAULT_PROVIDER_BUDGETS, init.budgets);
    this.globalSemaphore = new Semaphore(this.budgets.concurrency.global);
    this.tierConfig = {
      ...DEFAULT_TIER_CONFIG,
      ...(init.tiers ?? {})
    };
    this.promptGuardEnabled = init.promptInjectionGuard?.enabled ?? true;
    this.blockerDetectionThreshold = clampBlockerThreshold(init.blockerDetectionThreshold);
    this.adaptiveConfig = {
      enabled: init.adaptiveConcurrency?.enabled ?? false,
      maxGlobal: Math.max(this.budgets.concurrency.global, init.adaptiveConcurrency?.maxGlobal ?? this.budgets.concurrency.global),
      maxPerDomain: Math.max(
        this.budgets.concurrency.perDomain ?? this.budgets.concurrency.perProvider,
        init.adaptiveConcurrency?.maxPerDomain ?? (this.budgets.concurrency.perDomain ?? this.budgets.concurrency.perProvider)
      )
    };
    this.adaptiveConcurrency = this.createAdaptiveConcurrencyController();

    for (const provider of init.providers ?? []) {
      this.register(provider);
    }
  }

  register(provider: ProviderAdapter): void {
    this.registry.register(provider);
    this.scopedSemaphores.set(provider.id, new Semaphore(this.budgets.concurrency.perProvider));
  }

  listProviders(): ProviderAdapter[] {
    return this.registry.list();
  }

  listCapabilities() {
    return this.registry.capabilities();
  }

  getHealth(providerId: string) {
    return this.registry.getHealth(providerId);
  }

  updateBudgets(partial: Partial<ProviderRuntimeBudgets>): ProviderRuntimeBudgets {
    this.budgets = mergeBudgets(this.budgets, partial);
    this.globalSemaphore = new Semaphore(this.budgets.concurrency.global);
    this.scopedSemaphores.clear();
    for (const provider of this.registry.list()) {
      this.scopedSemaphores.set(provider.id, new Semaphore(this.budgets.concurrency.perProvider));
    }
    this.adaptiveConcurrency = this.createAdaptiveConcurrencyController();
    return this.budgets;
  }

  getBudgets(): ProviderRuntimeBudgets {
    return this.budgets;
  }

  async search(input: ProviderCallResultByOperation["search"], options: ProviderRunOptions = {}): Promise<ProviderAggregateResult> {
    return this.execute("search", input, options);
  }

  async fetch(input: ProviderCallResultByOperation["fetch"], options: ProviderRunOptions = {}): Promise<ProviderAggregateResult> {
    return this.execute("fetch", input, options);
  }

  async crawl(input: ProviderCallResultByOperation["crawl"], options: ProviderRunOptions = {}): Promise<ProviderAggregateResult> {
    return this.execute("crawl", input, options);
  }

  async post(input: ProviderCallResultByOperation["post"], options: ProviderRunOptions = {}): Promise<ProviderAggregateResult> {
    return this.execute("post", input, options);
  }

  async execute<Operation extends ProviderOperation>(
    operation: Operation,
    input: ProviderCallResultByOperation[Operation],
    options: ProviderRunOptions = {}
  ): Promise<ProviderAggregateResult> {
    const startedAt = Date.now();
    const selection = options.source ?? "auto";
    const trace = createTraceContext(options.trace);

    const selectedProviders = selectProviders(this.registry, operation, selection)
      .filter((provider) => (options.providerIds?.length ?? 0) === 0 || options.providerIds?.includes(provider.id));
    const challengePressure = options.tier?.challengePressure ?? this.calculateChallengePressure(selectedProviders);
    const tierRoute = selectTierRoute(this.tierConfig, {
      hybridEligible: this.isHybridEligible(selectedProviders),
      preferredTier: options.tier?.preferred,
      forceRestrictedSafe: options.tier?.forceRestrictedSafe,
      challengePressure,
      highFrictionTarget: options.tier?.highFrictionTarget,
      riskScore: options.tier?.riskScore ?? this.calculateRiskScore(selectedProviders, challengePressure),
      hybridHealthy: options.tier?.hybridHealthy ?? this.isHybridHealthy(selectedProviders),
      policyRestrictedSafe: options.tier?.policyRestrictedSafe ?? false,
      latencyBudgetExceeded: options.tier?.latencyBudgetExceeded ?? this.isLatencyBudgetExceeded(selectedProviders, operation),
      errorBudgetExceeded: options.tier?.errorBudgetExceeded ?? this.isErrorBudgetExceeded(selectedProviders),
      recoveryStableForMs: options.tier?.recoveryStableForMs,
      policyAllowsRecovery: options.tier?.policyAllowsRecovery
    });
    const tierMetadata = tierRoute.tier;

    this.logger.info("provider.tier.selected", {
      requestId: trace.requestId,
      sessionId: trace.sessionId,
      data: {
        selected: tierMetadata.selected,
        reasonCode: tierMetadata.reasonCode,
        operation,
        selection
      }
    });

    if (selectedProviders.length === 0) {
      const meta = createExecutionMetadata({
        tier: tierMetadata,
        provider: "runtime",
        retrievalPath: `${operation}:${selection}:unavailable`
      });
      const failure = normalizeFailure("runtime", "web", new ProviderRuntimeError("unavailable", "No providers available", {
        retryable: false,
        details: {
          operation,
          selection
        }
      }), {
        trace,
        startedAtMs: startedAt,
        meta
      });

      return {
        ok: false,
        records: [],
        trace: failure.trace,
        partial: false,
        failures: [{ provider: failure.provider, source: failure.source, error: failure.error }],
        metrics: {
          attempted: 0,
          succeeded: 0,
          failed: 1,
          retries: 0,
          latencyMs: failure.latencyMs
        },
        sourceSelection: selection,
        providerOrder: [],
        meta,
        diagnostics: this.buildDiagnostics({
          enabled: false,
          scope: "runtime",
          global: { limit: this.budgets.concurrency.global, min: 1, max: this.budgets.concurrency.global },
          scoped: { limit: this.budgets.concurrency.perProvider, min: 1, max: this.budgets.concurrency.perProvider }
        }, { enabled: this.promptGuardEnabled, quarantinedSegments: 0, entries: 0 }, []),
        error: failure.error
      };
    }

    const timeout = options.timeoutMs ?? this.budgets.timeoutMs[operation];
    if (selection === "all") {
      return this.executeAll(selectedProviders, operation, input, trace, timeout, selection, startedAt, tierMetadata, options.providerIds);
    }

    return this.executeSequential(selectedProviders, operation, input, trace, timeout, selection, startedAt, tierMetadata, options.providerIds);
  }

  private async executeSequential<Operation extends ProviderOperation>(
    providers: ProviderAdapter[],
    operation: Operation,
    input: ProviderCallResultByOperation[Operation],
    trace: TraceContext,
    timeoutMs: number,
    selection: ProviderSelection,
    startedAt: number,
    tierMetadata: ProviderTierMetadata,
    providerIds?: string[]
  ): Promise<ProviderAggregateResult> {
    const failures: ProviderAggregateResult["failures"] = [];
    let retries = 0;
    const attemptedOrder: string[] = [];
    let diagnostics: ProviderRuntimeDiagnostics | undefined;
    let blocker: BlockerSignalV1 | undefined;

    for (const provider of providers) {
      attemptedOrder.push(provider.id);
      const result = await this.invokeProvider(provider, operation, input, trace, timeoutMs, tierMetadata);
      retries += result.retries;
      diagnostics = result.diagnostics ?? diagnostics;
      blocker = result.meta?.blocker ?? blocker;
      if (result.ok) {
        return {
          ok: true,
          records: result.records,
          trace: result.trace,
          partial: failures.length > 0,
          failures,
          metrics: {
            attempted: failures.length + 1,
            succeeded: 1,
            failed: failures.length,
            retries,
            latencyMs: Math.max(0, Date.now() - startedAt)
          },
          sourceSelection: selection,
          providerOrder: providers.map((candidate) => candidate.id),
          ...(result.meta ? { meta: result.meta } : {}),
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {})
        };
      }
      failures.push({
        provider: result.provider,
        source: result.source,
        error: result.error
      });
    }

    if (shouldFallbackToTierA(tierMetadata.selected)) {
      const fallbackProviders = this.selectTierAProviders(operation, providerIds, attemptedOrder);
      if (fallbackProviders.length > 0) {
        this.logger.warn("provider.tier.transition", {
          requestId: trace.requestId,
          sessionId: trace.sessionId,
          data: {
            previousTier: tierMetadata.selected,
            nextTier: "A",
            reasonCode: "fallback_to_tier_a"
          }
        });
      }

      const fallbackTier = fallbackTierMetadata();
      for (const provider of fallbackProviders) {
        attemptedOrder.push(provider.id);
        const fallback = await this.invokeProvider(provider, operation, input, trace, timeoutMs, fallbackTier);
        retries += fallback.retries;
        diagnostics = fallback.diagnostics ?? diagnostics;
        blocker = fallback.meta?.blocker ?? blocker;
        if (fallback.ok) {
          return {
            ok: true,
            records: fallback.records,
            trace: fallback.trace,
            partial: failures.length > 0,
            failures,
            metrics: {
              attempted: failures.length + 1,
              succeeded: 1,
              failed: failures.length,
              retries,
              latencyMs: Math.max(0, Date.now() - startedAt)
            },
            sourceSelection: selection,
            providerOrder: [...providers, ...fallbackProviders].map((candidate) => candidate.id),
            ...(fallback.meta ? { meta: fallback.meta } : {}),
            ...(fallback.diagnostics ? { diagnostics: fallback.diagnostics } : {})
          };
        }
        failures.push({
          provider: fallback.provider,
          source: fallback.source,
          error: fallback.error
        });
      }
    }

    const error = failures.at(-1)?.error;
    const meta = failures.length > 0
      ? createExecutionMetadata({
        tier: tierMetadata,
        provider: failures.at(-1)?.provider ?? "runtime",
        retrievalPath: `${operation}:${selection}:failure`
      })
      : undefined;
    if (meta && blocker) {
      meta.blocker = blocker;
    }
    return {
      ok: false,
      records: [],
      trace,
      partial: false,
      failures,
      metrics: {
        attempted: failures.length,
        succeeded: 0,
        failed: failures.length,
        retries,
        latencyMs: Math.max(0, Date.now() - startedAt)
      },
      sourceSelection: selection,
      providerOrder: attemptedOrder.length > 0 ? attemptedOrder : providers.map((provider) => provider.id),
      ...(meta ? { meta } : {}),
      ...(diagnostics ? { diagnostics } : {}),
      ...(error ? { error } : {})
    };
  }

  private async executeAll<Operation extends ProviderOperation>(
    providers: ProviderAdapter[],
    operation: Operation,
    input: ProviderCallResultByOperation[Operation],
    trace: TraceContext,
    timeoutMs: number,
    selection: ProviderSelection,
    startedAt: number,
    tierMetadata: ProviderTierMetadata,
    providerIds?: string[]
  ): Promise<ProviderAggregateResult> {
    const results = await Promise.all(
      providers.map((provider) => this.invokeProvider(provider, operation, input, trace, timeoutMs, tierMetadata))
    );

    const records: NormalizedRecord[] = [];
    const failures: ProviderAggregateResult["failures"] = [];
    let retries = 0;
    let attempted = results.length;
    let meta: ProviderExecutionMetadata | undefined;
    let diagnostics: ProviderRuntimeDiagnostics | undefined;
    let fallbackProviderIds: string[] = [];
    let blocker: BlockerSignalV1 | undefined;

    for (const result of results) {
      retries += result.retries;
      if (result.ok) {
        records.push(...result.records);
        meta = result.meta ?? meta;
        blocker = result.meta?.blocker ?? blocker;
        diagnostics = result.diagnostics ?? diagnostics;
        continue;
      }
      failures.push({
        provider: result.provider,
        source: result.source,
        error: result.error
      });
      diagnostics = result.diagnostics ?? diagnostics;
      meta = result.meta ?? meta;
      blocker = result.meta?.blocker ?? blocker;
    }

    if (records.length === 0 && shouldFallbackToTierA(tierMetadata.selected)) {
      const fallbackTier = fallbackTierMetadata();
      const fallbackProviders = this.selectTierAProviders(operation, providerIds, providers.map((provider) => provider.id));
      fallbackProviderIds = fallbackProviders.map((provider) => provider.id);
      if (fallbackProviders.length > 0) {
        this.logger.warn("provider.tier.transition", {
          requestId: trace.requestId,
          sessionId: trace.sessionId,
          data: {
            previousTier: tierMetadata.selected,
            nextTier: "A",
            reasonCode: "fallback_to_tier_a"
          }
        });
      }

      const fallbackResults = await Promise.all(
        fallbackProviders.map((provider) => this.invokeProvider(provider, operation, input, trace, timeoutMs, fallbackTier))
      );

      for (const result of fallbackResults) {
        attempted += 1;
        retries += result.retries;
        diagnostics = result.diagnostics ?? diagnostics;
        meta = result.meta ?? meta;
        blocker = result.meta?.blocker ?? blocker;
        if (result.ok) {
          records.push(...result.records);
          continue;
        }
        failures.push({
          provider: result.provider,
          source: result.source,
          error: result.error
        });
      }
    }

    const ok = records.length > 0;
    const attemptedProviders = [
      ...providers.map((provider) => provider.id),
      ...fallbackProviderIds
    ];
    if (meta && blocker) {
      meta.blocker = blocker;
    }
    return {
      ok,
      records,
      trace,
      partial: ok && failures.length > 0,
      failures,
      metrics: {
        attempted,
        succeeded: attempted - failures.length,
        failed: failures.length,
        retries,
        latencyMs: Math.max(0, Date.now() - startedAt)
      },
      sourceSelection: selection,
      providerOrder: attemptedProviders,
      ...(meta ? { meta } : {}),
      ...(diagnostics ? { diagnostics } : {}),
      ...(!ok && failures[0] ? { error: failures[0].error } : {})
    };
  }

  private async invokeProvider<Operation extends ProviderOperation>(
    provider: ProviderAdapter,
    operation: Operation,
    input: ProviderCallResultByOperation[Operation],
    trace: TraceContext,
    timeoutMs: number,
    tierMetadata: ProviderTierMetadata
  ): Promise<ProviderOperationResult> {
    const startedAt = Date.now();
    const scopeKey = this.resolveScopeKey(provider.id, operation, input);
    const initialAdaptive = this.adaptiveConcurrency.snapshot(scopeKey);

    if (this.registry.isCircuitOpen(provider.id)) {
      const failure = normalizeFailure(provider.id, provider.source, this.registry.getCircuitError(provider.id), {
        trace,
        startedAtMs: startedAt,
        attempts: 1,
        retries: 0,
        meta: createExecutionMetadata({
          tier: tierMetadata,
          provider: provider.id,
          retrievalPath: `${operation}:${scopeKey}:circuit_open`
        })
      });
      failure.diagnostics = this.buildDiagnostics(initialAdaptive, {
        enabled: this.promptGuardEnabled,
        quarantinedSegments: 0,
        entries: 0
      }, []);
      return failure;
    }

    const retries = isReadOperation(operation)
      ? this.budgets.retries.read
      : this.budgets.retries.write;
    const maxAttempts = Math.max(1, retries + 1);
    const preparedInput = this.applyAdaptiveOperationInput(provider, operation, input, initialAdaptive);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const records = await this.withProviderConcurrency(provider.id, scopeKey, async () => {
          return this.withTimeout(timeoutMs, async (signal) => {
            const context: ProviderContext = {
              trace: createTraceContext(trace, provider.id),
              timeoutMs,
              attempt,
              signal
            };
            return this.callOperation(provider, operation, preparedInput, context);
          });
        });
        const guarded = applyPromptGuard(records, this.promptGuardEnabled);
        if (guarded.audit.entries.length > 0) {
          this.logger.audit("provider.prompt_guard", {
            requestId: trace.requestId,
            sessionId: trace.sessionId,
            data: {
              provider: provider.id,
              operation,
              entries: guarded.audit.entries.length,
              quarantinedSegments: guarded.audit.quarantinedSegments
            }
          });
        }
        const realismPatterns = this.detectRealismViolations(guarded.records);
        if (realismPatterns.length > 0) {
          this.logger.warn("provider.realism.violation", {
            requestId: trace.requestId,
            sessionId: trace.sessionId,
            data: {
              provider: provider.id,
              operation,
              patterns: realismPatterns
            }
          });
        }

        const meta = createExecutionMetadata({
          tier: tierMetadata,
          provider: provider.id,
          retrievalPath: `${operation}:${scopeKey}`
        });

        const success = normalizeSuccess(provider.id, provider.source, guarded.records, {
          trace,
          startedAtMs: startedAt,
          attempts: attempt,
          retries: attempt - 1,
          meta,
          provenance: {
            provider: provider.id,
            source: provider.source,
            operation,
            retrievalPath: meta.provenance.retrievalPath,
            retrievedAt: meta.provenance.retrievedAt
          }
        });
        this.adaptiveConcurrency.observe(scopeKey, {
          latencyMs: success.latencyMs,
          queuePressure: this.queuePressure(scopeKey)
        });
        const adaptive = this.adaptiveConcurrency.snapshot(scopeKey);
        success.diagnostics = this.buildDiagnostics(adaptive, {
          enabled: guarded.audit.enabled,
          quarantinedSegments: guarded.audit.quarantinedSegments,
          entries: guarded.audit.entries.length
        }, realismPatterns);
        if (operation === "post") {
          this.logger.audit("provider.post", {
            requestId: trace.requestId,
            sessionId: trace.sessionId,
            data: {
              provider: provider.id,
              source: provider.source,
              operation,
              decision: "allow",
              recordCount: success.records.length,
              payloadHashes: success.records
                .map((record) => record.attributes?.auditHash)
                .filter((hash): hash is string => typeof hash === "string")
            }
          });
        }
        this.registry.markSuccess(provider.id, success.latencyMs);
        return success;
      } catch (error) {
        const normalizedError = toProviderError(error, {
          provider: provider.id,
          source: provider.source
        });
        this.adaptiveConcurrency.observe(scopeKey, {
          latencyMs: Math.max(0, Date.now() - startedAt),
          timeout: normalizedError.code === "timeout",
          challenge: this.isChallengeError(normalizedError.message),
          http4xx: this.isClientError(normalizedError.code, normalizedError.message),
          http5xx: this.isServerError(normalizedError.code, normalizedError.message),
          queuePressure: this.queuePressure(scopeKey)
        });
        this.registry.markFailure(provider.id, normalizedError, this.budgets.circuitBreaker);

        if (attempt < maxAttempts && normalizedError.retryable) {
          continue;
        }

        const meta = createExecutionMetadata({
          tier: tierMetadata,
          provider: provider.id,
          retrievalPath: `${operation}:${scopeKey}:failure`
        });
        const blocker = this.detectRuntimeBlocker({
          operation,
          code: normalizedError.code,
          message: normalizedError.message,
          details: normalizedError.details,
          retryable: normalizedError.retryable,
          trace
        });
        if (blocker) {
          meta.blocker = blocker;
        }
        const failure = normalizeFailure(provider.id, provider.source, normalizedError, {
          trace,
          startedAtMs: startedAt,
          attempts: attempt,
          retries: attempt - 1,
          meta
        });
        failure.diagnostics = this.buildDiagnostics(this.adaptiveConcurrency.snapshot(scopeKey), {
          enabled: this.promptGuardEnabled,
          quarantinedSegments: 0,
          entries: 0
        }, []);
        if (operation === "post") {
          this.logger.audit("provider.post", {
            requestId: trace.requestId,
            sessionId: trace.sessionId,
            data: {
              provider: provider.id,
              source: provider.source,
              operation,
              decision: "deny",
              error: failure.error.code
            }
          });
        }
        return failure;
      }
    }

    const exhausted = normalizeFailure(provider.id, provider.source, new ProviderRuntimeError("internal", "Provider invocation exhausted attempts", {
      provider: provider.id,
      source: provider.source
    }), {
      trace,
      startedAtMs: startedAt,
      attempts: maxAttempts,
      retries: Math.max(0, maxAttempts - 1),
      meta: createExecutionMetadata({
        tier: tierMetadata,
        provider: provider.id,
        retrievalPath: `${operation}:${scopeKey}:exhausted`
      })
    });
    exhausted.diagnostics = this.buildDiagnostics(this.adaptiveConcurrency.snapshot(scopeKey), {
      enabled: this.promptGuardEnabled,
      quarantinedSegments: 0,
      entries: 0
    }, []);
    return exhausted;
  }

  private async callOperation<Operation extends ProviderOperation>(
    provider: ProviderAdapter,
    operation: Operation,
    input: ProviderCallResultByOperation[Operation],
    context: ProviderContext
  ): Promise<NormalizedRecord[]> {
    switch (operation) {
      case "search":
        if (!provider.search) {
          throw new ProviderRuntimeError("not_supported", "Search operation is not supported", {
            provider: provider.id,
            source: provider.source,
            retryable: false
          });
        }
        return provider.search(input as ProviderCallResultByOperation["search"], context);
      case "fetch":
        if (!provider.fetch) {
          throw new ProviderRuntimeError("not_supported", "Fetch operation is not supported", {
            provider: provider.id,
            source: provider.source,
            retryable: false
          });
        }
        return provider.fetch(input as ProviderCallResultByOperation["fetch"], context);
      case "crawl":
        if (!provider.crawl) {
          throw new ProviderRuntimeError("not_supported", "Crawl operation is not supported", {
            provider: provider.id,
            source: provider.source,
            retryable: false
          });
        }
        return provider.crawl(input as ProviderCallResultByOperation["crawl"], context);
      case "post":
        if (!provider.post) {
          throw new ProviderRuntimeError("not_supported", "Post operation is not supported", {
            provider: provider.id,
            source: provider.source,
            retryable: false
          });
        }
        return provider.post(input as ProviderCallResultByOperation["post"], context);
    }
  }

  private async withProviderConcurrency<T>(providerId: string, scopeKey: string, task: () => Promise<T>): Promise<T> {
    const adaptive = this.adaptiveConcurrency.snapshot(scopeKey);
    this.globalSemaphore.setLimit(adaptive.global.limit);
    const scopedSemaphore = this.scopedSemaphores.get(scopeKey)
      ?? this.scopedSemaphores.get(providerId)
      ?? new Semaphore(adaptive.scoped.limit);
    scopedSemaphore.setLimit(adaptive.scoped.limit);
    this.scopedSemaphores.set(scopeKey, scopedSemaphore);

    return this.globalSemaphore.use(async () => scopedSemaphore.use(task));
  }

  private createAdaptiveConcurrencyController(): AdaptiveConcurrencyController {
    return new AdaptiveConcurrencyController({
      enabled: this.adaptiveConfig.enabled,
      baselineGlobal: this.budgets.concurrency.global,
      baselineScoped: this.budgets.concurrency.perDomain ?? this.budgets.concurrency.perProvider,
      maxGlobal: this.adaptiveConfig.maxGlobal,
      maxScoped: this.adaptiveConfig.maxPerDomain
    });
  }

  private selectTierAProviders(
    operation: ProviderOperation,
    providerIds: string[] | undefined,
    excludeProviderIds: string[] = []
  ): ProviderAdapter[] {
    return selectProviders(this.registry, operation, "web")
      .filter((provider) => !excludeProviderIds.includes(provider.id))
      .filter((provider) => (providerIds?.length ?? 0) === 0 || providerIds?.includes(provider.id));
  }

  private calculateChallengePressure(providers: ProviderAdapter[]): number {
    if (providers.length === 0) return 0;
    let total = 0;
    for (const provider of providers) {
      const status = this.registry.getHealth(provider.id).status;
      if (status === "unhealthy") total += 1;
      else if (status === "degraded") total += 0.5;
    }
    return total / providers.length;
  }

  private calculateRiskScore(providers: ProviderAdapter[], challengePressure: number): number {
    if (providers.length === 0) return Math.max(0, Math.min(1, challengePressure));
    let unhealthy = 0;
    let degraded = 0;
    for (const provider of providers) {
      const health = this.registry.getHealth(provider.id);
      if (health.status === "unhealthy") unhealthy += 1;
      else if (health.status === "degraded") degraded += 1;
    }
    const healthPressure = (unhealthy + degraded * 0.5) / providers.length;
    return Math.max(0, Math.min(1, Math.max(challengePressure, healthPressure)));
  }

  private isHybridHealthy(providers: ProviderAdapter[]): boolean {
    const hybridProviders = providers.filter((provider) => provider.source !== "web");
    if (hybridProviders.length === 0) return false;
    return hybridProviders.some((provider) => {
      const health = this.registry.getHealth(provider.id);
      return health.status !== "unhealthy" && !this.registry.isCircuitOpen(provider.id);
    });
  }

  private isLatencyBudgetExceeded(
    providers: ProviderAdapter[],
    operation: ProviderOperation
  ): boolean {
    const timeoutBudget = this.budgets.timeoutMs[operation];
    return providers.some((provider) => {
      if (provider.source === "web") return false;
      const latency = this.registry.getHealth(provider.id).latencyMs;
      return typeof latency === "number" && latency > timeoutBudget;
    });
  }

  private isErrorBudgetExceeded(providers: ProviderAdapter[]): boolean {
    if (providers.length === 0) return false;
    let violations = 0;
    for (const provider of providers) {
      const status = this.registry.getHealth(provider.id).status;
      if (status === "unhealthy") {
        violations += 1;
      }
    }
    return violations / providers.length >= 0.5;
  }

  private isHybridEligible(providers: ProviderAdapter[]): boolean {
    return providers.some((provider) => provider.source !== "web");
  }

  private resolveScopeKey<Operation extends ProviderOperation>(
    providerId: string,
    operation: Operation,
    input: ProviderCallResultByOperation[Operation]
  ): string {
    const extractHost = (value: string | undefined): string | null => {
      if (!value) return null;
      try {
        return new URL(value).hostname.toLowerCase();
      } catch {
        return null;
      }
    };

    if (operation === "fetch") {
      return extractHost((input as ProviderCallResultByOperation["fetch"]).url) ?? providerId;
    }
    if (operation === "crawl") {
      const first = (input as ProviderCallResultByOperation["crawl"]).seedUrls[0];
      return extractHost(first) ?? providerId;
    }
    if (operation === "search") {
      return extractHost((input as ProviderCallResultByOperation["search"]).query) ?? providerId;
    }
    return providerId;
  }

  private queuePressure(scopeKey: string): number {
    const global = this.globalSemaphore.snapshot();
    const scoped = this.scopedSemaphores.get(scopeKey)?.snapshot();
    const globalPressure = global.limit <= 0 ? 0 : Math.min(1, (global.active + global.queued) / global.limit);
    const scopedPressure = !scoped || scoped.limit <= 0
      ? 0
      : Math.min(1, (scoped.active + scoped.queued) / scoped.limit);
    return Math.max(globalPressure, scopedPressure);
  }

  private detectRealismViolations(records: NormalizedRecord[]): string[] {
    const matched = new Set<string>();
    for (const record of records) {
      const haystacks = [record.url ?? "", record.title ?? "", record.content ?? ""];
      for (const pattern of PLACEHOLDER_PATTERNS) {
        if (haystacks.some((value) => pattern.regex.test(value))) {
          matched.add(pattern.code);
        }
      }
    }
    return [...matched];
  }

  private applyAdaptiveOperationInput<Operation extends ProviderOperation>(
    provider: ProviderAdapter,
    operation: Operation,
    input: ProviderCallResultByOperation[Operation],
    adaptive: AdaptiveConcurrencyDiagnostics
  ): ProviderCallResultByOperation[Operation] {
    if (!adaptive.enabled || operation !== "crawl" || provider.source !== "web") {
      return input;
    }

    const crawlInput = input as ProviderCallResultByOperation["crawl"];
    const scopedLimit = Math.max(1, Math.floor(adaptive.scoped.limit));
    const currentMaxPerDomain = typeof crawlInput.maxPerDomain === "number"
      ? Math.max(1, Math.floor(crawlInput.maxPerDomain))
      : undefined;
    const currentFetchConcurrency = toPositiveInt(crawlInput.filters?.fetchConcurrency, scopedLimit);
    const nextMaxPerDomain = currentMaxPerDomain !== undefined
      ? Math.min(currentMaxPerDomain, scopedLimit)
      : scopedLimit;
    const nextFetchConcurrency = Math.min(currentFetchConcurrency, scopedLimit);

    if (currentMaxPerDomain === nextMaxPerDomain && currentFetchConcurrency === nextFetchConcurrency) {
      return input;
    }

    return {
      ...crawlInput,
      maxPerDomain: nextMaxPerDomain,
      filters: {
        ...(crawlInput.filters ?? {}),
        fetchConcurrency: nextFetchConcurrency as JsonValue
      }
    } as unknown as ProviderCallResultByOperation[Operation];
  }

  private isChallengeError(message: string): boolean {
    return /captcha|challenge|cf_chl|interstitial|bot/i.test(message);
  }

  private isClientError(code: string, message: string): boolean {
    return code === "auth"
      || code === "invalid_input"
      || code === "policy_blocked"
      || /\b4\d{2}\b/.test(message);
  }

  private isServerError(code: string, message: string): boolean {
    return code === "upstream"
      || code === "unavailable"
      || /\b5\d{2}\b/.test(message);
  }

  private buildDiagnostics(
    adaptive: AdaptiveConcurrencyDiagnostics,
    promptGuard: { enabled: boolean; quarantinedSegments: number; entries: number },
    realismPatterns: string[]
  ): ProviderRuntimeDiagnostics {
    return {
      adaptiveConcurrency: adaptive,
      promptGuard,
      realism: {
        violations: realismPatterns.length,
        patterns: realismPatterns
      }
    };
  }

  private detectRuntimeBlocker(params: {
    operation: ProviderOperation;
    code: string;
    message: string;
    details?: Record<string, JsonValue>;
    retryable: boolean;
    trace: TraceContext;
  }): BlockerSignalV1 | undefined {
    const details = params.details;
    const url = typeof details?.url === "string"
      ? details.url
      : undefined;
    const hostFromUrl = (() => {
      if (!url) return null;
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return null;
      }
    })();
    const status = typeof details?.status === "number" ? details.status : undefined;
    const envLimited = params.code === "unavailable"
      && /extension not connected|not available in this environment|manual interaction/i.test(params.message);
    const blocker = classifyBlockerSignal({
      source: params.operation === "post" ? "macro_execution" : "runtime_fetch",
      ...(url ? { url } : {}),
      ...(status !== undefined ? { status } : {}),
      providerErrorCode: params.code,
      message: params.message,
      networkHosts: hostFromUrl ? [hostFromUrl] : undefined,
      traceRequestId: params.trace.requestId,
      retryable: params.retryable,
      envLimited,
      promptGuardEnabled: this.promptGuardEnabled,
      threshold: this.blockerDetectionThreshold
    });
    return blocker ?? undefined;
  }

  private async withTimeout<T>(
    timeoutMs: number,
    task: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort("timeout");
    }, timeoutMs);

    try {
      const result = await task(controller.signal);
      if (controller.signal.aborted) {
        throw new ProviderRuntimeError("timeout", `Provider request timed out after ${timeoutMs}ms`);
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderRuntimeError("timeout", `Provider request timed out after ${timeoutMs}ms`, {
          retryable: true,
          cause: error
        });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const createProviderRuntime = (init: RuntimeInit = {}): ProviderRuntime => {
  return new ProviderRuntime(init);
};

const withDefaultWebOptions = (options: WebProviderOptions | undefined): WebProviderOptions => {
  const providerId = options?.id ?? "web/default";
  return {
    ...options,
    fetcher: options?.fetcher ?? (async (url: string) => {
      const document = await fetchRuntimeDocument({
        url,
        provider: providerId,
        source: "web"
      });
      return {
        url: document.url,
        status: document.status,
        html: document.html
      };
    }),
    searchIndex: options?.searchIndex ?? (async (input, context) => {
      const query = input.query.trim();
      const lookupUrl = isHttpUrl(query)
        ? query
        : `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&ia=web`;
      const document = await fetchRuntimeDocument({
        url: lookupUrl,
        provider: providerId,
        source: "web",
        signal: context.signal
      });

      const limit = Math.max(1, Math.min(input.limit ?? 5, 10));
      const links = dedupeLinks(document.links, document.url, limit);
      const searchPath = isHttpUrl(query) ? "web:search:url" : "web:search:index";
      if (links.length === 0) {
        return [{
          url: document.url,
          title: document.url,
          content: toSnippet(stripUrls(document.text), 1500),
          confidence: isHttpUrl(query) ? 0.75 : 0.55,
          attributes: {
            query,
            status: document.status,
            retrievalPath: searchPath
          }
        }];
      }

      return links.map((url, index) => ({
        url,
        title: url,
        ...(index === 0 ? { content: toSnippet(stripUrls(document.text), 700) } : {}),
        confidence: Math.max(0.35, 0.75 - index * 0.05),
        attributes: {
          query,
          rank: index + 1,
          status: document.status,
          retrievalPath: searchPath
        }
      }));
    })
  };
};

const withDefaultCommunityOptions = (options: CommunityProviderOptions | undefined): CommunityProviderOptions => {
  const providerId = options?.id ?? "community/default";
  return {
    ...options,
    search: options?.search ?? (async (input, context) => {
      const query = input.query.trim();
      const page = toPositiveInt(input.filters?.page, 1);
      const lookupUrl = isHttpUrl(query)
        ? query
        : `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=relevance&t=all&page=${page}`;
      const document = await fetchRuntimeDocument({
        url: lookupUrl,
        provider: providerId,
        source: "community",
        signal: context.signal
      });
      const links = dedupeLinks(document.links, document.url, 20);

      return [{
        url: document.url,
        title: isHttpUrl(query) ? document.url : `Community search: ${query}`,
        content: toSnippet(stripUrls(document.text), 1800),
        confidence: isHttpUrl(query) ? 0.75 : 0.6,
        attributes: {
          query,
          page,
          status: document.status,
          links,
          retrievalPath: isHttpUrl(query) ? "community:search:url" : "community:search:index"
        }
      }];
    }),
    fetch: options?.fetch ?? (async (input, context) => {
      const document = await fetchRuntimeDocument({
        url: input.url,
        provider: providerId,
        source: "community",
        signal: context.signal
      });
      const links = dedupeLinks(document.links, document.url, 20);
      return {
        url: document.url,
        title: document.url,
        content: document.text,
        attributes: {
          status: document.status,
          links,
          retrievalPath: "community:fetch:url"
        }
      };
    })
  };
};

const withDefaultSocialPlatformOptions = (
  platform: SocialPlatform,
  options: SocialProviderOptions | undefined
): SocialProviderOptions => {
  const providerId = options?.id ?? `social/${platform}`;
  return {
    ...options,
    search: options?.search ?? (async (input, context) => {
      const query = input.query.trim();
      const page = toPositiveInt(input.filters?.page, 1);
      const lookupUrl = isHttpUrl(query)
        ? query
        : SOCIAL_SEARCH_ENDPOINTS[platform](query, page);
      const document = await fetchRuntimeDocument({
        url: lookupUrl,
        provider: providerId,
        source: "social",
        signal: context.signal
      });
      const links = dedupeLinks(document.links, document.url, 20);

      return [{
        url: document.url,
        title: isHttpUrl(query) ? document.url : `${platform} search: ${query}`,
        content: toSnippet(stripUrls(document.text), 1600),
        confidence: isHttpUrl(query) ? 0.72 : 0.58,
        attributes: {
          platform,
          query,
          page,
          status: document.status,
          links,
          retrievalPath: isHttpUrl(query) ? "social:search:url" : "social:search:index"
        }
      }];
    }),
    fetch: options?.fetch ?? (async (input, context) => {
      const document = await fetchRuntimeDocument({
        url: input.url,
        provider: providerId,
        source: "social",
        signal: context.signal
      });
      const links = dedupeLinks(document.links, document.url, 20);
      return {
        url: document.url,
        title: document.url,
        content: document.text,
        attributes: {
          platform,
          status: document.status,
          links,
          retrievalPath: "social:fetch:url"
        }
      };
    })
  };
};

const withDefaultSocialOptions = (options: SocialProvidersOptions | undefined): SocialProvidersOptions => ({
  x: withDefaultSocialPlatformOptions("x", options?.x),
  reddit: withDefaultSocialPlatformOptions("reddit", options?.reddit),
  bluesky: withDefaultSocialPlatformOptions("bluesky", options?.bluesky),
  linkedin: withDefaultSocialPlatformOptions("linkedin", options?.linkedin),
  instagram: withDefaultSocialPlatformOptions("instagram", options?.instagram),
  tiktok: withDefaultSocialPlatformOptions("tiktok", options?.tiktok),
  threads: withDefaultSocialPlatformOptions("threads", options?.threads)
});

export const createDefaultRuntime = (
  defaults: RuntimeDefaults = {},
  init: Omit<RuntimeInit, "providers"> = {}
): ProviderRuntime => {
  const runtime = new ProviderRuntime(init);
  runtime.register(createWebProvider(withDefaultWebOptions(defaults.web)));
  runtime.register(createCommunityProvider(withDefaultCommunityOptions(defaults.community)));
  for (const provider of createSocialProviders(withDefaultSocialOptions(defaults.social))) {
    runtime.register(provider);
  }
  return runtime;
};

const mergeBudgets = (
  base: ProviderRuntimeBudgets,
  partial: Partial<ProviderRuntimeBudgets> | undefined
): ProviderRuntimeBudgets => {
  if (!partial) return base;

  return {
    timeoutMs: {
      ...base.timeoutMs,
      ...(partial.timeoutMs ?? {})
    },
    retries: {
      ...base.retries,
      ...(partial.retries ?? {})
    },
    concurrency: {
      ...base.concurrency,
      ...(partial.concurrency ?? {})
    },
    circuitBreaker: {
      ...base.circuitBreaker,
      ...(partial.circuitBreaker ?? {})
    }
  };
};

export { ProviderRegistry } from "./registry";
export { selectProviders } from "./policy";
export { createWebProvider } from "./web";
export { createCommunityProvider } from "./community";
export { createSocialProvider, createSocialProviders } from "./social";
export * from "./types";
export * from "./errors";
export * from "./normalize";
export * from "./tier-router";
export * from "./adaptive-concurrency";
export * from "./blocker";
