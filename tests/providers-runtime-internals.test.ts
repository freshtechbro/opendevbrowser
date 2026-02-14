import { describe, expect, it } from "vitest";
import { ProviderRuntime } from "../src/providers";
import { normalizeRecord } from "../src/providers/normalize";
import type { ProviderAdapter, ProviderSource } from "../src/providers/types";

const makeProvider = (
  id: string,
  source: ProviderSource,
  handlers: {
    search?: ProviderAdapter["search"];
    fetch?: ProviderAdapter["fetch"];
    crawl?: ProviderAdapter["crawl"];
    post?: ProviderAdapter["post"];
  }
): ProviderAdapter => ({
  id,
  source,
  ...(handlers.search ? { search: handlers.search } : {}),
  ...(handlers.fetch ? { fetch: handlers.fetch } : {}),
  ...(handlers.crawl ? { crawl: handlers.crawl } : {}),
  ...(handlers.post ? { post: handlers.post } : {}),
  capabilities: () => ({
    providerId: id,
    source,
    operations: {
      search: { op: "search", supported: typeof handlers.search === "function" },
      fetch: { op: "fetch", supported: typeof handlers.fetch === "function" },
      crawl: { op: "crawl", supported: typeof handlers.crawl === "function" },
      post: { op: "post", supported: typeof handlers.post === "function" }
    },
    policy: {
      posting: handlers.post ? "gated" : "unsupported",
      riskNoticeRequired: false,
      confirmationRequired: false
    },
    metadata: {}
  })
});

describe("provider runtime internals", () => {
  it("executes tier-A fallback path in all-mode fanout when primary tier fails", async () => {
    const runtime = new ProviderRuntime({
      budgets: {
        retries: { read: 0, write: 0 },
        circuitBreaker: { failureThreshold: 99, cooldownMs: 1000 }
      }
    });

    const primary = makeProvider("community/primary", "community", {
      search: async () => {
        throw new Error("community down");
      }
    });
    const fallback = makeProvider("web/fallback", "web", {
      search: async () => [normalizeRecord("web/fallback", "web", { url: "https://example.com/fallback" })]
    });

    runtime.register(primary);
    runtime.register(fallback);

    const result = await (runtime as unknown as {
      executeAll: (
        providers: ProviderAdapter[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "all",
        startedAt: number,
        tierMetadata: { selected: "B"; reasonCode: "default_tier" },
        providerIds?: string[]
      ) => Promise<{
        ok: boolean;
        records: Array<{ provider: string; url: string }>;
        failures: Array<{ provider: string }>;
        providerOrder: string[];
        metrics: { attempted: number };
      }>;
    }).executeAll(
      [primary],
      "search",
      { query: "fallback" },
      { requestId: "req-fallback", ts: new Date().toISOString() },
      50,
      "all",
      Date.now(),
      { selected: "B", reasonCode: "default_tier" }
    );

    expect(result.ok).toBe(true);
    expect(result.records[0]?.provider).toBe("web/fallback");
    expect(result.failures[0]?.provider).toBe("community/primary");
    expect(result.providerOrder).toEqual(["community/primary", "web/fallback"]);
    expect(result.metrics.attempted).toBe(2);
  });

  it("records fallback failures in all-mode fanout when tier-A recovery also fails", async () => {
    const runtime = new ProviderRuntime({
      budgets: {
        retries: { read: 0, write: 0 },
        circuitBreaker: { failureThreshold: 99, cooldownMs: 1000 }
      }
    });

    const primary = makeProvider("community/primary-fail", "community", {
      search: async () => {
        throw new Error("community fail");
      }
    });
    const fallback = makeProvider("web/fallback-fail", "web", {
      search: async () => {
        throw new Error("web fail");
      }
    });

    runtime.register(primary);
    runtime.register(fallback);

    const result = await (runtime as unknown as {
      executeAll: (
        providers: ProviderAdapter[],
        operation: "search",
        input: { query: string },
        trace: { requestId: string; ts: string },
        timeoutMs: number,
        selection: "all",
        startedAt: number,
        tierMetadata: { selected: "C"; reasonCode: "high_friction_target" },
        providerIds?: string[]
      ) => Promise<{
        ok: boolean;
        failures: Array<{ provider: string }>;
        records: unknown[];
        metrics: { attempted: number; failed: number };
      }>;
    }).executeAll(
      [primary],
      "search",
      { query: "fallback-fail" },
      { requestId: "req-fallback-fail", ts: new Date().toISOString() },
      50,
      "all",
      Date.now(),
      { selected: "C", reasonCode: "high_friction_target" }
    );

    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.failures.map((entry) => entry.provider)).toEqual([
      "community/primary-fail",
      "web/fallback-fail"
    ]);
    expect(result.metrics.attempted).toBe(2);
    expect(result.metrics.failed).toBe(2);
  });

  it("computes challenge pressure and scope keys across provider states", () => {
    const runtime = new ProviderRuntime();
    const web = makeProvider("web/a", "web", {
      search: async () => [normalizeRecord("web/a", "web", { url: "https://example.com/a" })]
    });
    const community = makeProvider("community/b", "community", {
      search: async () => [normalizeRecord("community/b", "community", { url: "https://community.local/b" })]
    });

    runtime.register(web);
    runtime.register(community);

    runtime.registry.setHealth("web/a", {
      status: "unhealthy",
      updatedAt: new Date().toISOString()
    });
    runtime.registry.setHealth("community/b", {
      status: "degraded",
      updatedAt: new Date().toISOString()
    });

    const pressure = (runtime as unknown as {
      calculateChallengePressure: (providers: ProviderAdapter[]) => number;
      resolveScopeKey: (
        providerId: string,
        operation: "search" | "fetch" | "crawl" | "post",
        input: Record<string, unknown>
      ) => string;
      queuePressure: (scopeKey: string) => number;
    }).calculateChallengePressure([web, community]);

    expect(pressure).toBeCloseTo(0.75, 2);

    const helper = runtime as unknown as {
      resolveScopeKey: (
        providerId: string,
        operation: "search" | "fetch" | "crawl" | "post",
        input: Record<string, unknown>
      ) => string;
      queuePressure: (scopeKey: string) => number;
    };

    expect(helper.resolveScopeKey("web/a", "search", { query: "https://Example.com/path" })).toBe("example.com");
    expect(helper.resolveScopeKey("web/a", "fetch", { url: "bad-url" })).toBe("web/a");
    expect(helper.resolveScopeKey("web/a", "crawl", { seedUrls: ["https://docs.example/start"] })).toBe("docs.example");
    expect(helper.resolveScopeKey("web/a", "post", { target: "x" })).toBe("web/a");
    expect(helper.queuePressure("missing-scope")).toBeGreaterThanOrEqual(0);
  });
});
