import { describe, expect, it, vi } from "vitest";
import { ProviderRuntime } from "../src/providers";
import type { ProviderAdapter } from "../src/providers/types";

const trace = {
  requestId: "providers-index-branches",
  ts: "2026-01-01T00:00:00.000Z"
};

const makeProvider = (id: string, source: "web" | "community"): ProviderAdapter => ({
  id,
  source,
  search: async () => [],
  capabilities: () => ({
    providerId: id,
    source,
    operations: {
      search: { op: "search", supported: true },
      fetch: { op: "fetch", supported: false },
      crawl: { op: "crawl", supported: false },
      post: { op: "post", supported: false }
    },
    policy: {
      posting: "unsupported",
      riskNoticeRequired: false,
      confirmationRequired: false
    },
    metadata: {}
  })
});

describe("provider runtime internal branches", () => {
  it("covers zero-limit semaphore paths and scope helpers", async () => {
    const runtime = new ProviderRuntime({
      budgets: {
        concurrency: {
          global: 2,
          perProvider: 1,
          perDomain: undefined as unknown as number
        }
      }
    });

    const semaphore = (runtime as unknown as {
      globalSemaphore: {
        limit: number;
        use: <T>(task: () => Promise<T>) => Promise<T>;
        release: () => void;
        drain: () => void;
      };
      resolveScopeKey: (
        providerId: string,
        operation: "search" | "fetch" | "crawl" | "post",
        input: Record<string, unknown>
      ) => string;
      queuePressure: (scopeKey: string) => number;
      adaptiveConfig: { maxPerDomain: number };
      createAdaptiveConcurrencyController: () => {
        snapshot: (scope: string) => { scoped: { max: number } };
      };
    }).globalSemaphore;

    semaphore.limit = 0;
    await expect(semaphore.use(async () => "ok")).resolves.toBe("ok");
    semaphore.release();
    semaphore.drain();

    const internals = runtime as unknown as {
      resolveScopeKey: (
        providerId: string,
        operation: "search" | "fetch" | "crawl" | "post",
        input: Record<string, unknown>
      ) => string;
      queuePressure: (scopeKey: string) => number;
      adaptiveConfig: { maxPerDomain: number };
      createAdaptiveConcurrencyController: () => {
        snapshot: (scope: string) => { scoped: { max: number } };
      };
    };

    expect(internals.resolveScopeKey("web/default", "fetch", { url: "notaurl" })).toBe("web/default");
    expect(internals.resolveScopeKey("web/default", "crawl", { seedUrls: [] })).toBe("web/default");
    expect(internals.resolveScopeKey("web/default", "search", { query: "notaurl" })).toBe("web/default");
    expect(internals.resolveScopeKey("web/default", "post", { target: "x" })).toBe("web/default");
    expect(internals.queuePressure("missing-scope")).toBe(0);

    expect(internals.adaptiveConfig.maxPerDomain).toBeGreaterThanOrEqual(1);
    expect(internals.createAdaptiveConcurrencyController().snapshot("scope").scoped.max).toBeGreaterThanOrEqual(1);
  });

  it("covers sequential execution branches for success, failure metadata, and tier fallback", async () => {
    const runtime = new ProviderRuntime({
      budgets: {
        retries: { read: 0, write: 0 },
        circuitBreaker: { failureThreshold: 99, cooldownMs: 1000 }
      }
    });

    const community = makeProvider("community/one", "community");
    const webFallback = makeProvider("web/fallback", "web");
    runtime.register(community);
    runtime.register(webFallback);

    const sequential = runtime as unknown as {
      executeSequential: (
        providers: ProviderAdapter[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "community" | "auto",
        startedAt: number,
        tierMetadata: { selected: "A" | "B"; reasonCode: string },
        providerIds?: string[]
      ) => Promise<{
        ok: boolean;
        partial: boolean;
        failures: Array<{ provider: string }>;
        meta?: unknown;
        diagnostics?: unknown;
        providerOrder: string[];
      }>;
      invokeProvider: ReturnType<typeof vi.fn>;
    };

    sequential.invokeProvider = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        provider: "community/one",
        source: "community",
        error: { code: "upstream", message: "down", retryable: false },
        retries: 0,
        trace
      })
      .mockResolvedValueOnce({
        ok: true,
        records: [{ provider: "community/two", url: "https://community.local/two" }],
        retries: 0,
        trace
      });

    const withPartial = await sequential.executeSequential(
      [community, makeProvider("community/two", "community")],
      "search",
      { query: "partial" },
      trace,
      50,
      "auto",
      Date.now(),
      { selected: "A", reasonCode: "default_tier" }
    );

    expect(withPartial.ok).toBe(true);
    expect(withPartial.partial).toBe(true);
    expect(withPartial.meta).toBeUndefined();
    expect(withPartial.diagnostics).toBeUndefined();

    sequential.invokeProvider = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        provider: "community/one",
        source: "community",
        error: { code: "unavailable", message: "fail-1", retryable: false },
        retries: 0,
        trace
      })
      .mockResolvedValueOnce({
        ok: false,
        provider: "web/fallback",
        source: "web",
        error: { code: "unavailable", message: "fail-2", retryable: false },
        retries: 0,
        trace
      });

    const fallbackSuccess = await sequential.executeSequential(
      [community],
      "search",
      { query: "fallback" },
      trace,
      50,
      "community",
      Date.now(),
      { selected: "B", reasonCode: "default_tier" }
    );

    expect(fallbackSuccess.ok).toBe(false);
    expect(fallbackSuccess.providerOrder).toEqual(["community/one", "web/fallback"]);
    expect(fallbackSuccess.failures.map((entry) => entry.provider)).toEqual([
      "community/one",
      "web/fallback"
    ]);
    expect(fallbackSuccess.meta).toBeDefined();
  });

  it("covers all-mode aggregation branches with optional metadata/diagnostics and fallback provider filtering", async () => {
    const runtime = new ProviderRuntime({
      budgets: {
        retries: { read: 0, write: 0 },
        circuitBreaker: { failureThreshold: 99, cooldownMs: 1000 }
      }
    });

    const community = makeProvider("community/all", "community");
    const webA = makeProvider("web/a", "web");
    const webB = makeProvider("web/b", "web");
    runtime.register(community);
    runtime.register(webA);
    runtime.register(webB);

    const allMode = runtime as unknown as {
      executeAll: (
        providers: ProviderAdapter[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "all",
        startedAt: number,
        tierMetadata: { selected: "C" | "A"; reasonCode: string },
        providerIds?: string[]
      ) => Promise<{
        ok: boolean;
        partial: boolean;
        records: Array<{ provider?: string }>;
        failures: Array<{ provider: string }>;
        diagnostics?: unknown;
        providerOrder: string[];
      }>;
      invokeProvider: ReturnType<typeof vi.fn>;
      withProviderConcurrency: (
        providerId: string,
        scopeKey: string,
        task: () => Promise<string>
      ) => Promise<string>;
      selectTierAProviders: (
        operation: "search",
        providerIds: string[] | undefined,
        excludeProviderIds: string[]
      ) => ProviderAdapter[];
    };

    allMode.invokeProvider = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        records: [{ provider: "community/all" }],
        retries: 0,
        trace
      })
      .mockResolvedValueOnce({
        ok: false,
        provider: "web/a",
        source: "web",
        error: { code: "upstream", message: "fail", retryable: false },
        retries: 0,
        trace,
        diagnostics: { source: "web/a" }
      });

    const aggregated = await allMode.executeAll(
      [community, webA],
      "search",
      { query: "all" },
      trace,
      50,
      "all",
      Date.now(),
      { selected: "A", reasonCode: "default_tier" }
    );

    expect(aggregated.ok).toBe(true);
    expect(aggregated.partial).toBe(true);
    expect(aggregated.diagnostics).toEqual({ source: "web/a" });

    allMode.invokeProvider = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        provider: "community/all",
        source: "community",
        error: { code: "unavailable", message: "primary-fail", retryable: false },
        retries: 0,
        trace
      })
      .mockResolvedValueOnce({
        ok: false,
        provider: "web/a",
        source: "web",
        error: { code: "unavailable", message: "fallback-fail", retryable: false },
        retries: 0,
        trace,
        diagnostics: { source: "fallback" }
      });

    const fallbackResult = await allMode.executeAll(
      [community],
      "search",
      { query: "fallback" },
      trace,
      50,
      "all",
      Date.now(),
      { selected: "C", reasonCode: "high_friction_target" },
      ["community/all", "web/a"]
    );

    expect(fallbackResult.ok).toBe(false);
    expect(fallbackResult.providerOrder).toEqual(["community/all", "web/a"]);
    expect(fallbackResult.failures.map((entry) => entry.provider)).toEqual([
      "community/all",
      "web/a"
    ]);

    await expect(allMode.withProviderConcurrency("missing/provider", "unknown.scope", async () => "ok"))
      .resolves.toBe("ok");

    const tierAFiltered = allMode.selectTierAProviders("search", ["web/b"], ["web/a"]);
    expect(tierAFiltered.map((provider) => provider.id)).toEqual(["web/b"]);
  });

  it("covers sequential no-tierA-fallback and internal risk/latency/realism helpers", async () => {
    const runtime = new ProviderRuntime({
      budgets: {
        timeoutMs: {
          search: 25,
          fetch: 50,
          crawl: 50,
          post: 50
        },
        retries: { read: 0, write: 0 },
        circuitBreaker: { failureThreshold: 99, cooldownMs: 1000 }
      }
    });

    const communityOnly = makeProvider("community/only", "community");
    runtime.register(communityOnly);

    const internals = runtime as unknown as {
      executeSequential: (
        providers: ProviderAdapter[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "community",
        startedAt: number,
        tierMetadata: { selected: "B"; reasonCode: string },
        providerIds?: string[]
      ) => Promise<{
        ok: boolean;
        failures: Array<{ provider: string }>;
        providerOrder: string[];
        diagnostics?: unknown;
      }>;
      invokeProvider: ReturnType<typeof vi.fn>;
      calculateRiskScore: (providers: ProviderAdapter[], challengePressure: number) => number;
      isLatencyBudgetExceeded: (providers: ProviderAdapter[], operation: "search") => boolean;
      detectRealismViolations: (records: Array<{ url?: string; title?: string; content?: string }>) => string[];
      registry: {
        setHealth: (providerId: string, health: { status: "healthy" | "degraded" | "unhealthy"; updatedAt: string; latencyMs?: number }) => void;
      };
    };

    internals.invokeProvider = vi.fn().mockResolvedValue({
      ok: false,
      provider: "community/only",
      source: "community",
      error: { code: "unavailable", message: "primary fail", retryable: false },
      retries: 0,
      trace
    });

    const noFallback = await internals.executeSequential(
      [communityOnly],
      "search",
      { query: "no-web-fallback" },
      trace,
      50,
      "community",
      Date.now(),
      { selected: "B", reasonCode: "default_tier" },
      ["community/only"]
    );

    expect(noFallback.ok).toBe(false);
    expect(noFallback.failures).toHaveLength(1);
    expect(noFallback.providerOrder).toEqual(["community/only"]);
    expect(noFallback.diagnostics).toBeUndefined();

    const degraded = makeProvider("community/degraded", "community");
    const unhealthy = makeProvider("community/unhealthy", "community");
    const webHealthy = makeProvider("web/healthy", "web");
    runtime.register(degraded);
    runtime.register(unhealthy);
    runtime.register(webHealthy);

    internals.registry.setHealth("community/degraded", { status: "degraded", updatedAt: trace.ts, latencyMs: 30 });
    internals.registry.setHealth("community/unhealthy", { status: "unhealthy", updatedAt: trace.ts, latencyMs: 80 });
    internals.registry.setHealth("web/healthy", { status: "healthy", updatedAt: trace.ts, latencyMs: 10 });

    const risk = internals.calculateRiskScore([degraded, unhealthy], 0);
    expect(risk).toBeGreaterThan(0.5);

    const exceeded = internals.isLatencyBudgetExceeded([degraded, webHealthy], "search");
    expect(exceeded).toBe(true);

    const realism = internals.detectRealismViolations([
      { url: "https://placeholder.local/item" },
      { title: "todo" },
      { content: "lorem ipsum" },
      {}
    ]);
    expect(realism).toContain("placeholder_local_url");
    expect(realism).toContain("placeholder_token");
  });

  it("covers sequential fallback metadata branches and empty-provider failure envelope", async () => {
    const runtime = new ProviderRuntime({
      budgets: {
        retries: { read: 0, write: 0 },
        circuitBreaker: { failureThreshold: 99, cooldownMs: 1000 }
      }
    });

    const community = makeProvider("community/meta", "community");
    const webFallback = makeProvider("web/meta-fallback", "web");
    runtime.register(community);
    runtime.register(webFallback);

    const internals = runtime as unknown as {
      executeSequential: (
        providers: ProviderAdapter[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "community" | "auto",
        startedAt: number,
        tierMetadata: { selected: "A" | "B"; reasonCode: string },
        providerIds?: string[]
      ) => Promise<{
        ok: boolean;
        partial: boolean;
        failures: Array<{ provider: string }>;
        providerOrder: string[];
        meta?: {
          provenance: {
            provider: string;
          };
        };
        diagnostics?: unknown;
        error?: {
          code: string;
        };
      }>;
      invokeProvider: ReturnType<typeof vi.fn>;
    };

    internals.invokeProvider = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        provider: "community/meta",
        source: "community",
        error: { code: "upstream", message: "primary failed", retryable: false },
        retries: 0,
        trace
      })
      .mockResolvedValueOnce({
        ok: true,
        records: [{ provider: "web/meta-fallback", url: "https://web.example/recovered" }],
        retries: 0,
        trace,
        meta: {
          tier: { selected: "A", reasonCode: "fallback_to_tier_a" },
          provenance: {
            provider: "web/meta-fallback",
            retrievalPath: "search:web:fallback",
            retrievedAt: trace.ts
          }
        },
        diagnostics: {
          adaptiveConcurrency: {
            enabled: true,
            scope: "web.example",
            global: { limit: 2, min: 1, max: 4 },
            scoped: { limit: 1, min: 1, max: 2 }
          },
          promptGuard: { enabled: true, quarantinedSegments: 0, entries: 0 },
          realism: { violations: 0, patterns: [] }
        }
      });

    const recovered = await internals.executeSequential(
      [community],
      "search",
      { query: "recover" },
      trace,
      50,
      "community",
      Date.now(),
      { selected: "B", reasonCode: "default_tier" },
      ["community/meta", "web/meta-fallback"]
    );

    expect(recovered.ok).toBe(true);
    expect(recovered.partial).toBe(true);
    expect(recovered.meta?.provenance.provider).toBe("web/meta-fallback");
    expect(recovered.diagnostics).toBeDefined();

    internals.invokeProvider = vi.fn().mockResolvedValue({
      ok: false,
      provider: undefined as unknown as string,
      source: "community",
      error: { code: "upstream", message: "still failing", retryable: false },
      retries: 0,
      trace
    });

    const failedWithRuntimeMeta = await internals.executeSequential(
      [community],
      "search",
      { query: "runtime-meta" },
      trace,
      50,
      "community",
      Date.now(),
      { selected: "A", reasonCode: "default_tier" },
      ["community/meta"]
    );

    expect(failedWithRuntimeMeta.ok).toBe(false);
    expect(failedWithRuntimeMeta.meta?.provenance.provider).toBe("runtime");
    expect(failedWithRuntimeMeta.error?.code).toBe("upstream");

    const noProviders = await internals.executeSequential(
      [],
      "search",
      { query: "none" },
      trace,
      50,
      "auto",
      Date.now(),
      { selected: "A", reasonCode: "default_tier" }
    );

    expect(noProviders.ok).toBe(false);
    expect(noProviders.failures).toEqual([]);
    expect(noProviders.providerOrder).toEqual([]);
    expect(noProviders.meta).toBeUndefined();
    expect(noProviders.error).toBeUndefined();
  });

  it("covers all-mode fallback diagnostics branches when tier-A candidates are empty or return diagnostics", async () => {
    const runtime = new ProviderRuntime({
      budgets: {
        retries: { read: 0, write: 0 },
        circuitBreaker: { failureThreshold: 99, cooldownMs: 1000 }
      }
    });

    const community = makeProvider("community/all-empty", "community");
    const webFallback = makeProvider("web/all-fallback", "web");
    runtime.register(community);
    runtime.register(webFallback);

    const allMode = runtime as unknown as {
      executeAll: (
        providers: ProviderAdapter[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "all",
        startedAt: number,
        tierMetadata: { selected: "B" | "C"; reasonCode: string },
        providerIds?: string[]
      ) => Promise<{
        ok: boolean;
        providerOrder: string[];
        diagnostics?: unknown;
      }>;
      invokeProvider: ReturnType<typeof vi.fn>;
    };

    allMode.invokeProvider = vi.fn().mockResolvedValue({
      ok: false,
      provider: "community/all-empty",
      source: "community",
      error: { code: "upstream", message: "empty fallback", retryable: false },
      retries: 0,
      trace
    });

    const noTierAFallback = await allMode.executeAll(
      [community],
      "search",
      { query: "no-fallback" },
      trace,
      50,
      "all",
      Date.now(),
      { selected: "B", reasonCode: "default_tier" },
      ["community/all-empty"]
    );

    expect(noTierAFallback.ok).toBe(false);
    expect(noTierAFallback.providerOrder).toEqual(["community/all-empty"]);
    expect(noTierAFallback.diagnostics).toBeUndefined();

    allMode.invokeProvider = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        provider: "community/all-empty",
        source: "community",
        error: { code: "upstream", message: "primary failed", retryable: false },
        retries: 0,
        trace
      })
      .mockResolvedValueOnce({
        ok: false,
        provider: "web/all-fallback",
        source: "web",
        error: { code: "upstream", message: "fallback failed", retryable: false },
        retries: 0,
        trace,
        diagnostics: {
          adaptiveConcurrency: {
            enabled: true,
            scope: "fallback.scope",
            global: { limit: 1, min: 1, max: 4 },
            scoped: { limit: 1, min: 1, max: 2 }
          },
          promptGuard: { enabled: true, quarantinedSegments: 0, entries: 0 },
          realism: { violations: 1, patterns: ["placeholder_token"] }
        }
      });

    const withFallbackDiagnostics = await allMode.executeAll(
      [community],
      "search",
      { query: "with-fallback" },
      trace,
      50,
      "all",
      Date.now(),
      { selected: "C", reasonCode: "high_friction_target" },
      ["community/all-empty", "web/all-fallback"]
    );

    expect(withFallbackDiagnostics.ok).toBe(false);
    expect(withFallbackDiagnostics.providerOrder).toEqual([
      "community/all-empty",
      "web/all-fallback"
    ]);
    expect(withFallbackDiagnostics.diagnostics).toEqual(expect.objectContaining({
      realism: expect.objectContaining({ violations: 1 })
    }));
  });

  it("covers fallback spread branches with and without metadata in sequential/all fallback paths", async () => {
    const runtime = new ProviderRuntime({
      budgets: {
        retries: { read: 0, write: 0 },
        circuitBreaker: { failureThreshold: 99, cooldownMs: 1000 }
      }
    });

    const community = makeProvider("community/spread", "community");
    const webFallback = makeProvider("web/spread", "web");
    runtime.register(community);
    runtime.register(webFallback);

    const internals = runtime as unknown as {
      executeSequential: (
        providers: ProviderAdapter[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "community",
        startedAt: number,
        tierMetadata: { selected: "B"; reasonCode: string },
        providerIds?: string[]
      ) => Promise<{
        ok: boolean;
        meta?: unknown;
        diagnostics?: unknown;
      }>;
      executeAll: (
        providers: ProviderAdapter[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "all",
        startedAt: number,
        tierMetadata: { selected: "C"; reasonCode: string },
        providerIds?: string[]
      ) => Promise<{
        ok: boolean;
        diagnostics?: unknown;
      }>;
      invokeProvider: ReturnType<typeof vi.fn>;
    };

    internals.invokeProvider = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        provider: "community/spread",
        source: "community",
        error: { code: "upstream", message: "primary failed", retryable: false },
        retries: 0,
        trace
      })
      .mockResolvedValueOnce({
        ok: true,
        records: [{ provider: "web/spread", url: "https://web.example/recovered-no-meta" }],
        retries: 0,
        trace
      });

    const recoveredNoMeta = await internals.executeSequential(
      [community],
      "search",
      { query: "no-meta" },
      trace,
      50,
      "community",
      Date.now(),
      { selected: "B", reasonCode: "default_tier" },
      ["community/spread", "web/spread"]
    );
    expect(recoveredNoMeta.ok).toBe(true);
    expect(recoveredNoMeta.meta).toBeUndefined();
    expect(recoveredNoMeta.diagnostics).toBeUndefined();

    internals.invokeProvider = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        provider: "community/spread",
        source: "community",
        error: { code: "upstream", message: "primary failed", retryable: false },
        retries: 0,
        trace
      })
      .mockResolvedValueOnce({
        ok: true,
        records: [{ provider: "web/spread", url: "https://web.example/recovered-with-meta" }],
        retries: 0,
        trace,
        meta: {
          tier: { selected: "A", reasonCode: "fallback_to_tier_a" },
          provenance: {
            provider: "web/spread",
            retrievalPath: "search:web:fallback",
            retrievedAt: trace.ts
          }
        },
        diagnostics: {
          adaptiveConcurrency: {
            enabled: true,
            scope: "web.spread",
            global: { limit: 2, min: 1, max: 4 },
            scoped: { limit: 1, min: 1, max: 2 }
          },
          promptGuard: { enabled: true, quarantinedSegments: 0, entries: 0 },
          realism: { violations: 0, patterns: [] }
        }
      });

    const recoveredWithMeta = await internals.executeSequential(
      [community],
      "search",
      { query: "with-meta" },
      trace,
      50,
      "community",
      Date.now(),
      { selected: "B", reasonCode: "default_tier" },
      ["community/spread", "web/spread"]
    );
    expect(recoveredWithMeta.ok).toBe(true);
    expect(recoveredWithMeta.meta).toBeDefined();
    expect(recoveredWithMeta.diagnostics).toBeDefined();

    const primaryDiagnostics = {
      adaptiveConcurrency: {
        enabled: true,
        scope: "primary.scope",
        global: { limit: 2, min: 1, max: 4 },
        scoped: { limit: 1, min: 1, max: 2 }
      },
      promptGuard: { enabled: true, quarantinedSegments: 0, entries: 0 },
      realism: { violations: 1, patterns: ["placeholder_token"] }
    };

    internals.invokeProvider = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        provider: "community/spread",
        source: "community",
        error: { code: "upstream", message: "primary failed", retryable: false },
        retries: 0,
        trace,
        diagnostics: primaryDiagnostics
      })
      .mockResolvedValueOnce({
        ok: false,
        provider: "web/spread",
        source: "web",
        error: { code: "upstream", message: "fallback failed", retryable: false },
        retries: 0,
        trace
      });

    const fallbackAll = await internals.executeAll(
      [community],
      "search",
      { query: "all-fallback" },
      trace,
      50,
      "all",
      Date.now(),
      { selected: "C", reasonCode: "high_friction_target" },
      ["community/spread", "web/spread"]
    );

    expect(fallbackAll.ok).toBe(false);
    expect(fallbackAll.diagnostics).toEqual(primaryDiagnostics);
  });
});
