import { describe, expect, it } from "vitest";
import { createProviderRuntime, createWebProvider } from "../src/providers";
import { mapBounded } from "../src/providers/bounded-map";
import type { ProviderAggregateResult } from "../src/providers";
import { runResearchWorkflow, type ProviderExecutor } from "../src/providers/workflows";
import { normalizeRecord } from "../src/providers/normalize";
import type {
  NormalizedRecord,
  ProviderAdapter,
  ProviderFailureEntry
} from "../src/providers/types";

type FixturePage = {
  html: string;
  status: number;
};

type ProviderInvocationTracker = {
  active: number;
  maxActive: number;
};

const percent = (values: number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
};

const wait = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pageHtml = (title: string, links: string[]): string => {
  const anchors = links.map((link) => `<a href="${link}">${link}</a>`).join("");
  return `<!doctype html><html><head><title>${title}</title></head><body><main>${title}</main>${anchors}</body></html>`;
};

const FIXTURE_GRAPH = new Map<string, FixturePage>([
  [
    "https://perf.local/root",
    {
      html: pageHtml("root", [
        "https://perf.local/a",
        "https://perf.local/b",
        "https://perf.local/c"
      ]),
      status: 200
    }
  ],
  ["https://perf.local/a", { html: pageHtml("a", ["https://perf.local/b"]), status: 200 }],
  ["https://perf.local/b", { html: pageHtml("b", ["https://perf.local/c"]), status: 200 }],
  ["https://perf.local/c", { html: pageHtml("c", []), status: 200 }]
]);

const fixtureFetcher = async (url: string): Promise<{ html: string; status: number }> => {
  const row = FIXTURE_GRAPH.get(url);
  if (!row) {
    throw new Error(`fixture_not_found:${url}`);
  }
  return row;
};

const makeTrackedSearchProvider = (
  id: string,
  tracker: ProviderInvocationTracker
): ProviderAdapter => ({
  id,
  source: "web",
  search: async () => {
    tracker.active += 1;
    tracker.maxActive = Math.max(tracker.maxActive, tracker.active);
    try {
      await wait(30);
      return [normalizeRecord(id, "web", {
        url: `https://bounded.test/${id}`,
        title: id,
        content: `Measured bounded provider ${id}`
      })];
    } finally {
      tracker.active -= 1;
    }
  },
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

const extractCrawlMetrics = (result: ProviderAggregateResult): { pagesPerMinute: number; p50LatencyMs: number; p95LatencyMs: number; elapsedMs: number } => {
  const first = result.records[0];
  const attrs = first?.attributes;
  const crawlMetrics = attrs?.crawlMetrics;
  if (!crawlMetrics || typeof crawlMetrics !== "object" || Array.isArray(crawlMetrics)) {
    throw new Error("crawl_metrics_missing");
  }
  const pagesPerMinute = Number((crawlMetrics as Record<string, unknown>).pagesPerMinute ?? 0);
  const p50LatencyMs = Number((crawlMetrics as Record<string, unknown>).p50LatencyMs ?? 0);
  const p95LatencyMs = Number((crawlMetrics as Record<string, unknown>).p95LatencyMs ?? 0);
  const elapsedMs = Number((crawlMetrics as Record<string, unknown>).elapsedMs ?? 0);
  return { pagesPerMinute, p50LatencyMs, p95LatencyMs, elapsedMs };
};

describe("provider performance release gate", () => {
  it("meets p50/p95 latency baseline for search and fetch fixture runs", async () => {
    const runtime = createProviderRuntime();
    runtime.register(createWebProvider({
      id: "web/perf-gate",
      fetcher: fixtureFetcher,
      workerThreads: 0,
      defaultPipeline: {
        fetchConcurrency: 4,
        queueMax: 32,
        frontierMax: 32
      }
    }));

    const searchLatencies: number[] = [];
    const fetchLatencies: number[] = [];
    const iterations = 20;

    for (let index = 0; index < iterations; index += 1) {
      const searchStart = Date.now();
      const searchResult = await runtime.search(
        { query: "https://perf.local/root", limit: 5 },
        { source: "web", providerIds: ["web/perf-gate"] }
      );
      searchLatencies.push(Math.max(0, Date.now() - searchStart));
      expect(searchResult.ok).toBe(true);

      const fetchStart = Date.now();
      const fetchResult = await runtime.fetch(
        { url: "https://perf.local/root" },
        { source: "web", providerIds: ["web/perf-gate"] }
      );
      fetchLatencies.push(Math.max(0, Date.now() - fetchStart));
      expect(fetchResult.ok).toBe(true);
    }

    expect(percent(searchLatencies, 0.5)).toBeLessThanOrEqual(1200);
    expect(percent(searchLatencies, 0.95)).toBeLessThanOrEqual(3500);
    expect(percent(fetchLatencies, 0.5)).toBeLessThanOrEqual(1200);
    expect(percent(fetchLatencies, 0.95)).toBeLessThanOrEqual(3500);
  });

  it("meets crawl throughput and extraction success baseline", async () => {
    const runtime = createProviderRuntime();
    runtime.register(createWebProvider({
      id: "web/perf-gate",
      fetcher: fixtureFetcher,
      workerThreads: 0,
      defaultPipeline: {
        fetchConcurrency: 4,
        queueMax: 32,
        frontierMax: 32
      }
    }));

    const throughput: number[] = [];
    const p95Latencies: number[] = [];
    const successRatios: number[] = [];
    const iterations = 15;
    const expectedPages = 4;

    for (let index = 0; index < iterations; index += 1) {
      const result = await runtime.crawl(
        {
          seedUrls: ["https://perf.local/root"],
          maxDepth: 2,
          maxPages: 10,
          maxPerDomain: 10
        },
        { source: "web", providerIds: ["web/perf-gate"] }
      );

      expect(result.ok).toBe(true);
      const metrics = extractCrawlMetrics(result);
      throughput.push(metrics.pagesPerMinute);
      p95Latencies.push(metrics.p95LatencyMs);
      successRatios.push(result.records.length / expectedPages);
    }

    expect(percent(throughput, 0.5)).toBeGreaterThanOrEqual(25);
    expect(percent(successRatios, 0.5)).toBeGreaterThanOrEqual(0.95);
    expect(percent(p95Latencies, 0.95)).toBeLessThanOrEqual(3500);
  }, 12000);

  it("improves crawl throughput versus sequential baseline fixture", async () => {
    const fanoutLinks = Array.from({ length: 12 }, (_, index) => `https://perf.local/node-${index + 1}`);
    const fanoutGraph = new Map<string, FixturePage>([
      [
        "https://perf.local/root",
        {
          html: pageHtml("root", fanoutLinks),
          status: 200
        }
      ],
      ...fanoutLinks.map((url, index) => [url, { html: pageHtml(`node-${index + 1}`, []), status: 200 }] as const)
    ]);

    const delayedFetcher = async (url: string): Promise<{ html: string; status: number }> => {
      // Slightly longer synthetic I/O delay reduces scheduler noise and keeps the
      // parallel-vs-sequential throughput assertion stable across CI runners.
      await wait(45);
      const row = fanoutGraph.get(url);
      if (!row) {
        throw new Error(`fixture_not_found:${url}`);
      }
      return row;
    };

    const runtime = createProviderRuntime();
    runtime.register(createWebProvider({
      id: "web/perf-parallel",
      fetcher: delayedFetcher,
      workerThreads: 0,
      defaultPipeline: {
        fetchConcurrency: 4,
        queueMax: 64,
        frontierMax: 64
      }
    }));
    runtime.register(createWebProvider({
      id: "web/perf-sequential",
      fetcher: delayedFetcher,
      workerThreads: 0,
      defaultPipeline: {
        fetchConcurrency: 1,
        queueMax: 64,
        frontierMax: 64
      }
    }));

    const parallelElapsed: number[] = [];
    const sequentialElapsed: number[] = [];

    for (let index = 0; index < 6; index += 1) {
      const parallel = await runtime.crawl(
        {
          seedUrls: ["https://perf.local/root"],
          maxDepth: 1,
          maxPages: 20,
          maxPerDomain: 20
        },
        { source: "web", providerIds: ["web/perf-parallel"] }
      );
      const sequential = await runtime.crawl(
        {
          seedUrls: ["https://perf.local/root"],
          maxDepth: 1,
          maxPages: 20,
          maxPerDomain: 20
        },
        { source: "web", providerIds: ["web/perf-sequential"] }
      );

      expect(parallel.ok).toBe(true);
      expect(sequential.ok).toBe(true);
      parallelElapsed.push(extractCrawlMetrics(parallel).elapsedMs);
      sequentialElapsed.push(extractCrawlMetrics(sequential).elapsedMs);
    }

    const parallelP50 = percent(parallelElapsed, 0.5);
    const sequentialP50 = percent(sequentialElapsed, 0.5);
    expect(parallelP50).toBeLessThan(sequentialP50);
    expect(parallelP50).toBeLessThanOrEqual(sequentialP50 * 0.9);
  }, 16_000);

  it("bounds aggregate provider fanout and preserves selected provider order", async () => {
    const tracker: ProviderInvocationTracker = { active: 0, maxActive: 0 };
    const ids = ["web/gamma", "web/alpha", "web/epsilon", "web/beta", "web/delta"];
    const runtime = createProviderRuntime({
      budgets: { concurrency: { global: 2, perProvider: 5, perDomain: 5 } }
    });

    for (const id of ids) {
      runtime.register(makeTrackedSearchProvider(id, tracker));
    }

    const expectedOrder = [...ids].sort((left, right) => left.localeCompare(right));
    const result = await runtime.search({ query: "bounded provider fanout" }, { source: "all" });

    expect(result.ok).toBe(true);
    expect(tracker.maxActive).toBeLessThanOrEqual(2);
    expect(result.providerOrder).toEqual(expectedOrder);
    expect(result.records.map((record) => record.provider)).toEqual(expectedOrder);
    expect(result.metrics.attempted).toBe(ids.length);
  });

  it("bounds the provider fanout scheduler before provider-level semaphores", async () => {
    const tracker: ProviderInvocationTracker = { active: 0, maxActive: 0 };
    const ids = ["web/gamma", "web/alpha", "web/epsilon", "web/beta", "web/delta"];
    const results = await mapBounded(ids, 2, async (id) => {
      tracker.active += 1;
      tracker.maxActive = Math.max(tracker.maxActive, tracker.active);
      try {
        await wait(20);
        return id;
      } finally {
        tracker.active -= 1;
      }
    });

    expect(tracker.maxActive).toBe(2);
    expect(results).toEqual(ids);
  });

  it("keeps undefined scheduler items instead of treating them as queue sentinels", async () => {
    const inputs: Array<string | undefined> = ["first", undefined, "third"];
    const visited: Array<number> = [];
    const results = await mapBounded(inputs, 1, async (item, index) => {
      visited.push(index);
      return item ?? `missing-${index}`;
    });

    expect(visited).toEqual([0, 1, 2]);
    expect(results).toEqual(["first", "missing-1", "third"]);
  });

  it("keeps scheduler behavior explicit for empty inputs, non-finite limits, and task failures", async () => {
    await expect(mapBounded([], Number.NaN, async (item) => item)).resolves.toEqual([]);
    await expect(mapBounded(["finite"], Number.POSITIVE_INFINITY, async (item) => item)).resolves.toEqual(["finite"]);
    await expect(mapBounded(["reject"], 1, async () => {
      throw new Error("scheduler_task_failed");
    })).rejects.toThrow("scheduler_task_failed");
  });

  it("stops scheduling new items after the first task failure", async () => {
    const visited: number[] = [];
    await expect(mapBounded([0, 1, 2, 3], 2, async (_item, index) => {
      visited.push(index);
      if (index === 0) {
        await wait(20);
        return index;
      }
      throw new Error("scheduler_task_failed");
    })).rejects.toThrow("scheduler_task_failed");

    await wait(30);
    expect(visited).toEqual([0, 1]);
  });

  it("preserves the first scheduler task failure", async () => {
    const result = mapBounded([0, 1, 2], 2, async (_item, index) => {
      if (index === 0) {
        await wait(5);
        throw new Error("first_scheduler_failure");
      }
      if (index === 1) {
        await wait(20);
        throw new Error("second_scheduler_failure");
      }
      return index;
    });

    await expect(result).rejects.toThrow("first_scheduler_failure");
  });

  it("waits for already-started scheduler tasks before rejecting", async () => {
    const settled: number[] = [];
    const result = mapBounded([0, 1, 2], 2, async (_item, index) => {
      if (index === 0) {
        await wait(20);
        settled.push(index);
        return index;
      }
      if (index === 1) {
        settled.push(index);
        throw new Error("scheduler_task_failed");
      }
      settled.push(index);
      return index;
    });

    await expect(result).rejects.toThrow("scheduler_task_failed");
    expect(settled).toEqual([1, 0]);
  });

  it("enforces realism detection diagnostics for placeholder outputs", async () => {
    const runtime = createProviderRuntime();
    const placeholderProvider: ProviderAdapter = {
      id: "web/placeholder-fixture",
      source: "web",
      search: async () => [normalizeRecord("web/placeholder-fixture", "web", {
        url: "https://placeholder.local/fake",
        content: "placeholder payload"
      })],
      capabilities: () => ({
        providerId: "web/placeholder-fixture",
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
    };

    runtime.register(placeholderProvider);
    const result = await runtime.search(
      { query: "placeholder realism gate" },
      { source: "web", providerIds: ["web/placeholder-fixture"] }
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics?.realism.violations).toBeGreaterThan(0);
    expect(result.diagnostics?.realism.patterns).toContain("placeholder_local_url");
  });

  it("enforces transcript durability and anti-bot pressure promotion thresholds", async () => {
    const timestamp = new Date().toISOString();
    const records: NormalizedRecord[] = Array.from({ length: 9 }, (_, index) => ({
      id: `yt-success-${index + 1}`,
      source: "social",
      provider: "social/youtube",
      url: `https://www.youtube.com/watch?v=durability${index + 1}`,
      title: `durability-${index + 1}`,
      content: "transcript content",
      timestamp,
      confidence: 0.9,
      attributes: {
        transcript_available: true,
        transcript_strategy: "native_caption_parse",
        transcript_strategy_detail: "native_caption_parse"
      }
    }));
    const failures: ProviderFailureEntry[] = [{
      provider: "social/youtube",
      source: "social",
      error: {
        code: "unavailable",
        message: "YouTube transcript unavailable",
        retryable: false,
        reasonCode: "transcript_unavailable",
        details: {
          attemptChain: [
            {
              strategy: "native_caption_parse",
              reasonCode: "caption_missing"
            }
          ]
        }
      }
    }];
    const aggregate: ProviderAggregateResult = {
      ok: true,
      records,
      trace: { requestId: "perf-transcript-durability", ts: timestamp },
      partial: true,
      failures,
      metrics: {
        attempted: 1,
        succeeded: 1,
        failed: 0,
        retries: 0,
        latencyMs: 5
      },
      sourceSelection: "social",
      providerOrder: ["social/youtube"]
    };
    const runtime: ProviderExecutor = {
      search: async () => aggregate,
      fetch: async () => aggregate
    };

    const output = await runResearchWorkflow(runtime, {
      topic: "transcript durability gate",
      sourceSelection: "social",
      days: 1,
      mode: "json"
    });

    const metrics = (output.meta as {
      metrics: {
        reasonCodeDistribution: Record<string, number>;
        transcriptStrategyFailures: Record<string, number>;
        transcriptStrategyDetailFailures: Record<string, number>;
        transcriptStrategyDetailDistribution: Record<string, number>;
        transcriptDurability: { success_rate: number; attempted: number; successful: number; failed: number };
        antiBotPressure: { anti_bot_failure_ratio: number };
      };
    }).metrics;

    expect(metrics.reasonCodeDistribution.transcript_unavailable).toBe(1);
    expect(metrics).not.toHaveProperty("reason_code_distribution");
    expect(metrics.transcriptStrategyFailures["native_caption_parse:caption_missing"]).toBe(1);
    expect(metrics.transcriptStrategyDetailFailures).toEqual(metrics.transcriptStrategyFailures);
    expect(metrics.transcriptStrategyDetailDistribution).toEqual({
      native_caption_parse: 9
    });
    expect(metrics.transcriptDurability).toEqual({
      attempted: 10,
      successful: 9,
      failed: 1,
      success_rate: 0.9
    });
    expect(metrics.transcriptDurability.success_rate).toBeGreaterThanOrEqual(0.85);
    expect(metrics.antiBotPressure.anti_bot_failure_ratio).toBeLessThanOrEqual(0.15);
  });
});
