import { describe, expect, it } from "vitest";
import { createProviderRuntime, createWebProvider } from "../src/providers";
import type { ProviderAggregateResult } from "../src/providers";
import { normalizeRecord } from "../src/providers/normalize";
import type { ProviderAdapter } from "../src/providers/types";

type FixturePage = {
  html: string;
  status: number;
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
    runtime.register(createWebProvider({ id: "web/perf-gate", fetcher: fixtureFetcher }));

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
    runtime.register(createWebProvider({ id: "web/perf-gate", fetcher: fixtureFetcher }));

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
  });

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
      await wait(30);
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
      workerThreads: 2,
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
    expect(parallelP50).toBeLessThanOrEqual(sequentialP50 * 0.8);
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
});
