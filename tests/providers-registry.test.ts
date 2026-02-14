import { describe, expect, it } from "vitest";
import { normalizeRecord } from "../src/providers/normalize";
import { createProviderError } from "../src/providers/errors";
import { selectProviders } from "../src/providers/policy";
import { ProviderRegistry } from "../src/providers/registry";
import { ProviderRuntime } from "../src/providers";
import type { ProviderAdapter } from "../src/providers/types";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeWebProvider = (
  id: string,
  search: ProviderAdapter["search"]
): ProviderAdapter => ({
  id,
  source: "web",
  search,
  capabilities: () => ({
    providerId: id,
    source: "web",
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

describe("provider registry + runtime", () => {
  it("registers providers and exposes capabilities", () => {
    const registry = new ProviderRegistry();
    registry.register(makeWebProvider("web/a", async () => []));

    expect(registry.list()).toHaveLength(1);
    expect(registry.capabilities()).toHaveLength(1);
    expect(() => registry.register(makeWebProvider("web/a", async () => []))).toThrow("already registered");
  });

  it("selects providers by health-aware source policy", () => {
    const registry = new ProviderRegistry();
    registry.register(makeWebProvider("web/a", async () => []));
    registry.register(makeWebProvider("web/b", async () => []));
    registry.setHealth("web/a", { status: "unhealthy", updatedAt: new Date().toISOString() });

    const selected = selectProviders(registry, "search", "auto");
    expect(selected.map((provider) => provider.id)).toEqual(["web/b", "web/a"]);
  });

  it("isolates failures and falls back to healthy providers", async () => {
    let failingCalls = 0;
    let healthyCalls = 0;

    const runtime = new ProviderRuntime({
      budgets: {
        retries: { read: 0, write: 0 },
        circuitBreaker: { failureThreshold: 1, cooldownMs: 50 }
      }
    });

    runtime.register(makeWebProvider("web/failing", async () => {
      failingCalls += 1;
      throw new Error("ECONNRESET");
    }));
    runtime.register(makeWebProvider("web/healthy", async () => {
      healthyCalls += 1;
      return [normalizeRecord("web/healthy", "web", {
        url: "https://example.com",
        title: "ok",
        content: "healthy"
      })];
    }));

    const first = await runtime.search({ query: "x" }, { source: "all" });
    expect(first.ok).toBe(true);
    expect(first.partial).toBe(true);
    expect(first.failures).toHaveLength(1);
    expect(first.failures[0]?.provider).toBe("web/failing");

    const second = await runtime.search({ query: "y" }, { source: "all" });
    expect(second.ok).toBe(true);
    expect(second.failures[0]?.error.code).toBe("circuit_open");
    expect(failingCalls).toBe(1);
    expect(healthyCalls).toBe(2);

    await wait(60);
    await runtime.search({ query: "z" }, { source: "all" });
    expect(failingCalls).toBe(2);
  });

  it("applies timeout + retry budgets per provider", async () => {
    let attempts = 0;

    const runtime = new ProviderRuntime({
      budgets: {
        timeoutMs: { search: 10, fetch: 50, crawl: 50, post: 50 },
        retries: { read: 1, write: 0 },
        circuitBreaker: { failureThreshold: 99, cooldownMs: 1000 }
      }
    });

    runtime.register(makeWebProvider("web/slow", async () => {
      attempts += 1;
      await wait(30);
      return [normalizeRecord("web/slow", "web", { url: "https://example.com" })];
    }));

    const result = await runtime.search({ query: "slow" }, { source: "all" });
    expect(result.ok).toBe(false);
    expect(result.failures[0]?.error.code).toBe("timeout");
    expect(attempts).toBe(2);
  });

  it("enforces global concurrency budgets for all-source fanout", async () => {
    let active = 0;
    let maxActive = 0;

    const delayedProvider = (id: string): ProviderAdapter => makeWebProvider(id, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await wait(20);
      active -= 1;
      return [normalizeRecord(id, "web", { url: `https://example.com/${id}` })];
    });

    const runtime = new ProviderRuntime({
      budgets: {
        concurrency: { global: 1, perProvider: 1 },
        retries: { read: 0, write: 0 }
      }
    });

    runtime.register(delayedProvider("web/a"));
    runtime.register(delayedProvider("web/b"));
    runtime.register(delayedProvider("web/c"));

    const result = await runtime.search({ query: "budget" }, { source: "all" });
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(3);
    expect(maxActive).toBe(1);
  });

  it("keeps degraded state after circuit cooldown when health was manually set", () => {
    const registry = new ProviderRegistry();
    registry.register(makeWebProvider("web/edge", async () => []));

    const preFailure = registry.getCircuitError("web/edge");
    expect(preFailure.details?.lastErrorCode).toBeNull();

    registry.markFailure("web/edge", createProviderError("timeout", "slow"), {
      failureThreshold: 1,
      cooldownMs: 10
    });
    registry.setHealth("web/edge", {
      status: "degraded",
      updatedAt: new Date().toISOString(),
      reason: "manual"
    });

    expect(registry.isCircuitOpen("web/edge", Date.now() + 20)).toBe(false);
    expect(registry.getHealth("web/edge")).toMatchObject({
      status: "degraded",
      reason: "manual"
    });
  });
});
