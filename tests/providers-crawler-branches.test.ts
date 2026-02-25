import { afterEach, describe, expect, it, vi } from "vitest";

import { __test__, canonicalizeUrl } from "../src/providers/web/crawler";

afterEach(() => {
  vi.doUnmock("../src/providers/web/policy");
  vi.doUnmock("../src/providers/web/crawl-worker");
  vi.resetModules();
});

describe("crawler helper branches", () => {
  it("covers percentile/dequeue/comparator helper branches", async () => {
    expect(__test__.percentile([], 0.95)).toBe(0);
    expect(__test__.percentile([undefined as unknown as number], 0.95)).toBe(0);

    expect(__test__.isHttpUrl("https://example.com")).toBe(true);
    expect(__test__.isHttpUrl("notaurl")).toBe(false);

    const left = { url: "https://a.example", depth: 0, sequence: 1, firstSeenOrder: 1, sourcePriority: 1 };
    const right = { url: "https://b.example", depth: 1, sequence: 2, firstSeenOrder: 2, sourcePriority: 0 };

    expect(__test__.compareFrontierNodes(left, right, "bfs")).toBeLessThan(0);
    expect(__test__.compareFrontierNodes(left, right, "dfs")).toBeGreaterThan(0);

    const sameDepthA = { url: "https://a.example", depth: 1, sequence: 1, firstSeenOrder: 1, sourcePriority: 1 };
    const sameDepthB = { url: "https://b.example", depth: 1, sequence: 2, firstSeenOrder: 1, sourcePriority: 0 };
    expect(__test__.compareFrontierNodes(sameDepthA, sameDepthB, "bfs")).toBeGreaterThan(0);

    const samePriorityA = { url: "https://a.example", depth: 1, sequence: 10, firstSeenOrder: 1, sourcePriority: 0 };
    const samePriorityB = { url: "https://b.example", depth: 1, sequence: 20, firstSeenOrder: 1, sourcePriority: 0 };
    expect(__test__.compareFrontierNodes(samePriorityA, samePriorityB, "bfs")).toBeLessThan(0);
    expect(__test__.compareFrontierNodes(samePriorityA, samePriorityB, "dfs")).toBeGreaterThan(0);
    expect(__test__.compareFrontierNodes(
      { ...samePriorityA, sequence: 20 },
      { ...samePriorityB, sequence: 20 },
      "bfs"
    )).toBeLessThan(0);

    const frontier = [right, left];
    expect(__test__.dequeueNode(frontier, "bfs")?.url).toBe("https://a.example");
    expect(__test__.dequeueNode([], "bfs")).toBeUndefined();

    const waitMap = new Map<number, Promise<{ sequence: number; warnings: string[]; links: string[]; latencyMs: number; page: null }>>();
    waitMap.set(1, Promise.resolve({ sequence: 1, warnings: [], links: [], latencyMs: 0, page: null }));
    await expect(__test__.waitForNextTask(waitMap)).resolves.toMatchObject({ sequence: 1 });
  });

  it("covers frontier domain helpers and deterministic page-entry sort branches", () => {
    expect(__test__.resolveFrontierDomain("https://A.Example/path")).toBe("a.example");
    expect(__test__.resolveFrontierDomain("not-a-url")).toBe("__invalid__");
    expect(canonicalizeUrl("HTTP://EXAMPLE.com:80/path/?utm_source=ad")).toBe("http://example.com/path");

    const makeNode = (overrides: Record<string, unknown>) => ({
      url: "https://example.com",
      depth: 0,
      sequence: 1,
      firstSeenOrder: 1,
      firstSeenAtMs: 1,
      sourcePriority: 0,
      stableRecordId: "https://example.com",
      ...overrides
    });

    const frontier = new Map<string, Array<Record<string, unknown>>>();
    __test__.enqueueFrontierNode(frontier as never, makeNode({ url: "https://b.example/1", sequence: 1, firstSeenOrder: 1 }));
    __test__.enqueueFrontierNode(frontier as never, makeNode({ url: "https://a.example/1", sequence: 2, firstSeenOrder: 0 }));
    frontier.set("empty.example", []);
    expect(__test__.frontierSize(frontier as never)).toBe(2);

    const first = __test__.dequeueFrontierByDomain(frontier as never, "bfs");
    expect(first?.url).toBe("https://a.example/1");
    expect(__test__.dequeueFrontierByDomain(frontier as never, "bfs")?.url).toBe("https://b.example/1");
    expect(__test__.dequeueFrontierByDomain(frontier as never, "bfs")).toBeUndefined();

    const malformed = new Map<string, Array<Record<string, unknown>>>([
      ["bad.example", [undefined as unknown as Record<string, unknown>]]
    ]);
    expect(__test__.dequeueFrontierByDomain(malformed as never, "bfs")).toBeUndefined();

    const unstableFrontier = {
      entries: () => new Map<string, Array<Record<string, unknown>>>([
        ["gone.example", [makeNode({ url: "https://gone.example/1", sequence: 9 })]]
      ]).entries(),
      get: () => undefined
    };
    expect(__test__.dequeueFrontierByDomain(unstableFrontier as never, "bfs")).toBeUndefined();

    const sorted = __test__.sortPageEntries([
      {
        page: { url: "https://z.example", canonicalUrl: "https://z.example", depth: 0, status: 200, text: "", links: [], selectors: {}, warnings: [] },
        firstSeenAtMs: 1,
        sourcePriority: 1,
        stableRecordId: "z",
        sequence: 3
      },
      {
        page: { url: "https://a.example", canonicalUrl: "https://a.example", depth: 0, status: 200, text: "", links: [], selectors: {}, warnings: [] },
        firstSeenAtMs: 1,
        sourcePriority: 0,
        stableRecordId: "b",
        sequence: 2
      },
      {
        page: { url: "https://b.example", canonicalUrl: "https://b.example", depth: 0, status: 200, text: "", links: [], selectors: {}, warnings: [] },
        firstSeenAtMs: 1,
        sourcePriority: 0,
        stableRecordId: "a",
        sequence: 1
      },
      {
        page: { url: "https://c.example", canonicalUrl: "https://c.example", depth: 0, status: 200, text: "", links: [], selectors: {}, warnings: [] },
        firstSeenAtMs: 1,
        sourcePriority: 0,
        stableRecordId: "a",
        sequence: 0
      }
    ]);
    expect(sorted.map((page) => page.url)).toEqual([
      "https://c.example",
      "https://b.example",
      "https://a.example",
      "https://z.example"
    ]);
  });

  it("uses default blocked reason when policy omits a reason for seed and link decisions", async () => {
    vi.doMock("../src/providers/web/policy", () => ({
      evaluateWebCrawlPolicy: (url: string) => {
        if (url.endsWith("/root")) {
          return { allowed: true, warnings: [] };
        }
        return { allowed: false, warnings: [], reason: undefined };
      }
    }));

    const { crawlWeb } = await import("../src/providers/web/crawler");
    const result = await crawlWeb({
      seeds: ["https://blocked.example/root"],
      fetcher: async (url: string) => ({
        status: 200,
        html: url.endsWith("/root")
          ? "<html><body><a href='https://blocked.example/child'>child</a></body></html>"
          : "<html><body>child</body></html>"
      }),
      workerThreads: 0,
      queueMax: 2,
      budget: { maxDepth: 1, maxPages: 2, maxPerDomain: 2 }
    });

    expect(result.warnings.some((warning) => warning.includes("blocked.example/child: blocked"))).toBe(true);
  });

  it("falls back on non-Error worker extraction failures and keeps canonicalization rules", async () => {
    vi.doMock("../src/providers/web/crawl-worker", () => ({
      createCrawlWorkerPool: () => ({
        extract: async () => {
          throw "plain-failure";
        },
        close: async () => undefined
      }),
      extractCrawlContentInline: (input: { html: string }) => ({ text: input.html, links: [], selectors: {} })
    }));

    const { crawlWeb } = await import("../src/providers/web/crawler");
    const result = await crawlWeb({
      seeds: ["https://fallback.example/root"],
      fetcher: async () => ({ status: 200, html: "<html><body>ok</body></html>" }),
      workerThreads: 1,
      queueMax: 1
    });

    expect(result.warnings.some((warning) => warning.includes("worker extraction fallback"))).toBe(true);
    expect(canonicalizeUrl("https://EXAMPLE.com:443/path/?utm_source=test")).toBe("https://example.com/path");
  });
});
