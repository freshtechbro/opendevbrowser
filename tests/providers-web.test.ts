import { describe, expect, it, vi } from "vitest";
import { createDefaultRuntime } from "../src/providers";
import { canonicalizeUrl, crawlWeb } from "../src/providers/web/crawler";
import { createWebProvider } from "../src/providers/web";
import { extractLinks, extractSelectors, extractText, toSnippet } from "../src/providers/web/extract";
import { evaluateWebCrawlPolicy } from "../src/providers/web/policy";

const pages: Record<string, string> = {
  "https://example.com": `
    <html>
      <body>
        <h1>Home</h1>
        <a href="/a?utm_source=test#top">A</a>
        <a href="/b">B</a>
      </body>
    </html>
  `,
  "https://example.com/a": `
    <html>
      <body>
        <article id="main">Article A</article>
        <a href="https://example.com/b">B again</a>
      </body>
    </html>
  `,
  "https://example.com/b": `
    <html>
      <body>
        <p class="text">Article B</p>
      </body>
    </html>
  `
};

const fetcher = async (url: string) => {
  const html = pages[url];
  if (!html) {
    throw new Error("not found");
  }
  return { status: 200, html };
};

const context = (requestId: string) => ({
  trace: { requestId, ts: new Date().toISOString() },
  timeoutMs: 50,
  attempt: 1 as const
});

describe("web provider + crawler", () => {
  it("uses real retrieval defaults in createDefaultRuntime web path", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      return {
        status: 200,
        url,
        text: async () => `<html><body><main>web content ${url}</main><a href="https://example.com/b">B</a></body></html>`
      };
    }) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "open dev browser", limit: 3 },
        { source: "web", providerIds: ["web/default"] }
      );

      expect(result.ok).toBe(true);
      expect(result.records.length).toBeGreaterThan(0);
      expect(result.failures).toHaveLength(0);
      expect(result.records[0]?.provider).toBe("web/default");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("covers adaptive crawl pipeline overrides and invalid numeric filter coercion", async () => {
    const overridePages: Record<string, string> = {
      "https://override.example": `
        <html><body>
          <a href="https://override.example/a">A</a>
        </body></html>
      `,
      "https://override.example/a": "<html><body><p>A</p></body></html>"
    };
    const overrideFetcher = async (url: string) => {
      const normalized = url.endsWith("/") ? url.slice(0, -1) : url;
      const html = overridePages[normalized];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const provider = createWebProvider({
      fetcher: overrideFetcher,
      queueMax: 8
    });

    const withOverrides = await provider.crawl?.({
      seedUrls: ["https://override.example"],
      filters: {
        fetchConcurrency: 3,
        frontierMax: 4
      }
    }, context("crawl-overrides"));
    expect(withOverrides).toBeDefined();

    const withInvalidOverrides = await provider.crawl?.({
      seedUrls: ["https://override.example"],
      filters: {
        fetchConcurrency: Number.POSITIVE_INFINITY,
        frontierMax: 0
      }
    }, context("crawl-invalid-overrides"));
    expect(withInvalidOverrides).toBeDefined();
  });

  it("covers fallback search URL validation and extraction-quality defaults", async () => {
    const fallbackProvider = createWebProvider({ fetcher });
    await expect(fallbackProvider.search?.({ query: "keyword" }, context("search-url-required")))
      .rejects.toMatchObject({ code: "invalid_input" });

    const indexedProvider = createWebProvider({
      searchIndex: async () => [{
        url: "https://example.com/indexed",
        title: "indexed result"
      }]
    });
    const records = await indexedProvider.search?.({ query: "indexed" }, context("search-indexed"));
    expect(records).toHaveLength(1);
    expect(records?.[0]?.attributes.extractionQuality).toMatchObject({
      hasContent: false,
      contentChars: 0,
      linkCount: 0
    });
  });

  it("canonicalizes URLs for dedupe", () => {
    expect(canonicalizeUrl("https://EXAMPLE.com/a/?utm_source=ad&b=2&a=1#hash"))
      .toBe("https://example.com/a?a=1&b=2");
    expect(canonicalizeUrl("https://example.com:443/path/"))
      .toBe("https://example.com/path");
    expect(canonicalizeUrl("  :::not-a-url:::  "))
      .toBe(":::not-a-url:::");
  });

  it("canonicalizes root urls and strips default http ports", () => {
    expect(canonicalizeUrl("HTTP://Example.com:80/?utm_source=ad&keep=1#hash"))
      .toBe("http://example.com?keep=1");
    expect(canonicalizeUrl("https://EXAMPLE.com/#top"))
      .toBe("https://example.com");
  });

  it("extracts text, links, and selectors", () => {
    const html = `
      <html><body>
        <h1>Heading</h1>
        <a href="/next">Next</a>
        <div id="hero">Hero text</div>
        <p class="lead">Lead text</p>
      </body></html>
    `;

    expect(extractText(html)).toContain("Heading");
    expect(extractLinks(html, "https://example.com")).toEqual(["https://example.com/next"]);
    expect(extractSelectors(html, ["#hero", ".lead", "h1"])).toEqual({
      "#hero": ["Hero text"],
      ".lead": ["Lead text"],
      h1: ["Heading"]
    });
  });

  it("handles empty href/selectors and snippet boundaries", () => {
    const html = `
      <html><body>
        <a href="   ">Blank</a>
        <a href="/ok">OK</a>
        <div class="empty"></div>
      </body></html>
    `;

    expect(extractLinks(html, "https://example.com")).toEqual(["https://example.com/ok"]);
    expect(extractSelectors(html, [".empty"])).toEqual({
      ".empty": []
    });
    expect(toSnippet("abcdef", 5)).toBe("abcd…");
    expect(toSnippet("abc", 5)).toBe("abc");
  });

  it("enforces crawl budgets with dedupe + policy", async () => {
    const result = await crawlWeb({
      fetcher,
      strategy: "bfs",
      seeds: ["https://example.com"],
      budget: { maxDepth: 1, maxPages: 2, maxPerDomain: 2 },
      policy: { robotsMode: "warn", robotsBlockedDomains: ["example.com"] }
    });

    expect(result.pages).toHaveLength(2);
    expect(result.metrics.visited).toBe(2);
    expect(result.metrics.deduped).toBeGreaterThanOrEqual(0);
    expect(result.metrics.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.p95LatencyMs).toBeGreaterThanOrEqual(result.metrics.p50LatencyMs);
    expect(result.warnings.some((warning) =>
      warning.includes("per-domain")
      || warning.includes("fetch failed")
      || warning.includes("robots policy")
    )).toBe(true);
  });

  it("supports dfs strategy, default budgets, and duplicate-seed dedupe", async () => {
    const dfsPages: Record<string, string> = {
      "https://dfs.example": `
        <html><body>
          <a href="https://dfs.example/left">Left</a>
          <a href="https://dfs.example/right">Right</a>
        </body></html>
      `,
      "https://dfs.example/left": "<html><body><p>Left</p></body></html>",
      "https://dfs.example/right": "<html><body><p>Right</p></body></html>"
    };

    const dfsFetcher = async (url: string) => {
      const html = dfsPages[url];
      if (!html) throw new Error("not found");
      return { html };
    };

    const result = await crawlWeb({
      fetcher: dfsFetcher,
      strategy: "dfs",
      seeds: ["https://dfs.example", "https://dfs.example"]
    });

    expect(result.pages[0]?.status).toBe(200);
    expect(result.pages.map((page) => page.url)).toContain("https://dfs.example");
    expect(result.metrics.deduped).toBeGreaterThan(0);
  });

  it("supports strict robots policy + normalized provider outputs", async () => {
    const strict = evaluateWebCrawlPolicy("https://example.com", {
      robotsMode: "strict",
      robotsBlockedDomains: ["example.com"]
    });
    expect(strict.allowed).toBe(false);

    const provider = createWebProvider({
      fetcher,
      policy: { robotsMode: "off" },
      searchIndex: async (input) => [{
        url: "https://example.com/a",
        title: `Result ${input.query}`,
        content: "indexed"
      }]
    });

    const search = await provider.search?.({ query: "abc" }, {
      trace: { requestId: "r1", ts: new Date().toISOString() },
      timeoutMs: 50,
      attempt: 1
    });
    expect(search).toHaveLength(1);
    expect(search?.[0]?.provider).toBe("web/default");

    const fetched = await provider.fetch?.({ url: "https://example.com/a" }, {
      trace: { requestId: "r2", ts: new Date().toISOString() },
      timeoutMs: 50,
      attempt: 1
    });
    expect(fetched?.[0]?.attributes.status).toBe(200);

    const crawled = await provider.crawl?.({ seedUrls: ["https://example.com"], maxPages: 2 }, {
      trace: { requestId: "r3", ts: new Date().toISOString() },
      timeoutMs: 50,
      attempt: 1
    });
    expect(crawled?.length).toBe(2);

    const caps = provider.capabilities();
    expect(caps.operations.crawl.supported).toBe(true);
    expect(caps.operations.post.supported).toBe(false);
  });

  it("covers web crawl policy mapping branches", () => {
    expect(evaluateWebCrawlPolicy("not-a-url")).toMatchObject({
      allowed: false,
      reason: "Invalid URL"
    });

    expect(evaluateWebCrawlPolicy("https://blocked.example", {
      denyDomains: ["blocked.example"]
    })).toMatchObject({
      allowed: false,
      reason: "Domain denied by policy"
    });

    expect(evaluateWebCrawlPolicy("https://outside.example", {
      allowDomains: ["allowed.example"]
    })).toMatchObject({
      allowed: false,
      reason: "Domain not in allow list"
    });

    expect(evaluateWebCrawlPolicy("https://robots.example", {
      robotsMode: "off",
      robotsBlockedDomains: ["robots.example"]
    })).toEqual({
      allowed: true,
      warnings: []
    });
  });

  it("handles unavailable web operations and degraded health without fetcher", async () => {
    const provider = createWebProvider();
    await expect(provider.search?.({ query: "https://example.com/a" }, context("nf-search")))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.fetch?.({ url: "https://example.com/a" }, context("nf-fetch")))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.crawl?.({ seedUrls: ["https://example.com/a"] }, context("nf-crawl")))
      .rejects.toMatchObject({ code: "unavailable" });

    const health = await provider.health?.({
      trace: { requestId: "nf-health", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(health).toMatchObject({
      status: "degraded",
      reason: "Fetcher not configured"
    });

    const withFetcher = createWebProvider({ fetcher });
    await expect(withFetcher.crawl?.({ seedUrls: [] }, context("empty-seeds")))
      .rejects.toMatchObject({ code: "invalid_input" });
  });

  it("covers provider search/fetch/crawl fallback paths", async () => {
    const noFetcherProvider = createWebProvider();
    await expect(noFetcherProvider.search?.({ query: "https://example.com/a" }, context("no-fetcher-search")))
      .rejects.toMatchObject({ code: "unavailable" });

    const noStatusFetcher = async (url: string) => {
      const html = pages[url];
      if (!html) throw new Error("not found");
      return { html };
    };

    const provider = createWebProvider({
      fetcher: noStatusFetcher,
      defaultBudget: { maxPages: 1 }
    });

    const fetched = await provider.fetch?.({ url: "https://example.com/a" }, context("no-status-fetch"));
    expect(fetched?.[0]?.attributes.status).toBe(200);

    const crawled = await provider.crawl?.({ seedUrls: ["https://example.com"] }, context("default-budget-crawl"));
    expect(crawled).toHaveLength(1);
  });

  it("validates search input and supports fallback search via fetcher", async () => {
    const provider = createWebProvider({ fetcher });

    await expect(provider.search?.({ query: "   " }, context("search-invalid")))
      .rejects.toMatchObject({ code: "invalid_input" });

    const records = await provider.search?.({ query: "https://example.com/a" }, context("search-fetcher"));
    expect(records).toHaveLength(1);
    expect(records?.[0]?.attributes.status).toBe(200);
    expect(typeof records?.[0]?.content).toBe("string");

    const health = await provider.health?.({
      trace: { requestId: "search-health", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(health?.status).toBe("healthy");
  });

  it("filters invalid links and blocks denied links while crawling", async () => {
    const edgePages: Record<string, string> = {
      "https://edge.example": `
        <html><body>
          <a href="http://">broken</a>
          <a href="mailto:test@example.com">mail</a>
          <a href="https://blocked.example/private">blocked</a>
          <a href="https://edge.example/next">next</a>
        </body></html>
      `,
      "https://edge.example/next": "<html><body><p>Next</p></body></html>"
    };

    const edgeFetcher = async (url: string) => {
      const html = edgePages[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const result = await crawlWeb({
      fetcher: edgeFetcher,
      seeds: ["https://edge.example"],
      budget: { maxDepth: 1, maxPages: 3, maxPerDomain: 3 },
      policy: { denyDomains: ["blocked.example"] }
    });

    expect(result.pages[0]?.links).toContain("https://edge.example/next");
    expect(result.pages[0]?.links.some((link) => link.startsWith("mailto:"))).toBe(false);
    expect(result.warnings.some((warning) =>
      warning.includes("blocked.example")
      && warning.includes("Domain denied by policy")
    )).toBe(true);
  });

  it("records per-domain budget and fetch-failure warnings", async () => {
    const seedPages: Record<string, string> = {
      "https://same.example/one": "<html><body><a href=\"https://same.example/two\">Two</a></body></html>",
      "https://same.example/two": "<html><body><p>Two</p></body></html>"
    };

    const flakyFetcher = async (url: string) => {
      const html = seedPages[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const result = await crawlWeb({
      fetcher: flakyFetcher,
      seeds: ["https://same.example/one", "https://same.example/two", "https://missing.example/start"],
      budget: { maxDepth: 0, maxPages: 5, maxPerDomain: 1 }
    });

    expect(result.warnings.some((warning) => warning.includes("per-domain budget exceeded"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("fetch failed"))).toBe(true);
  });

  it("keeps latency percentiles at zero when policy blocks all seeds", async () => {
    let fetchCalled = false;

    const result = await crawlWeb({
      fetcher: async () => {
        fetchCalled = true;
        return { html: "<html></html>" };
      },
      seeds: ["https://blocked-seed.example"],
      policy: { denyDomains: ["blocked-seed.example"] }
    });

    expect(fetchCalled).toBe(false);
    expect(result.pages).toHaveLength(0);
    expect(result.metrics.p50LatencyMs).toBe(0);
    expect(result.metrics.p95LatencyMs).toBe(0);
  });

  it("produces deterministic crawl order with worker and non-worker pipelines", async () => {
    const deterministicPages: Record<string, string> = {
      "https://det.example/root": `
        <html><body>
          <a href="https://det.example/a">A</a>
          <a href="https://det.example/b">B</a>
        </body></html>
      `,
      "https://det.example/a": `
        <html><body>
          <a href="https://det.example/c">C</a>
          <p>A</p>
        </body></html>
      `,
      "https://det.example/b": "<html><body><p>B</p></body></html>",
      "https://det.example/c": "<html><body><p>C</p></body></html>"
    };

    const deterministicFetcher = async (url: string) => {
      const html = deterministicPages[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const withWorkersA = await crawlWeb({
      fetcher: deterministicFetcher,
      seeds: ["https://det.example/root"],
      pipeline: { workerThreads: 2, fetchConcurrency: 3, queueMax: 16, frontierMax: 16 }
    });
    const withWorkersB = await crawlWeb({
      fetcher: deterministicFetcher,
      seeds: ["https://det.example/root"],
      pipeline: { workerThreads: 2, fetchConcurrency: 3, queueMax: 16, frontierMax: 16 }
    });
    const noWorkers = await crawlWeb({
      fetcher: deterministicFetcher,
      seeds: ["https://det.example/root"],
      pipeline: { workerThreads: 0, fetchConcurrency: 3, queueMax: 16, frontierMax: 16 }
    });

    const workerOrderA = withWorkersA.pages.map((page) => page.url);
    const workerOrderB = withWorkersB.pages.map((page) => page.url);
    const noWorkerOrder = noWorkers.pages.map((page) => page.url);

    expect(workerOrderA).toEqual(workerOrderB);
    expect(workerOrderA).toEqual(noWorkerOrder);
  });

  it("falls back when worker queue is saturated and keeps crawl results", async () => {
    const saturatedPages: Record<string, string> = {
      "https://queue.example/root": `
        <html><body>
          <a href="https://queue.example/a">A</a>
          <a href="https://queue.example/b">B</a>
        </body></html>
      `,
      "https://queue.example/a": "<html><body><p>A</p></body></html>",
      "https://queue.example/b": "<html><body><p>B</p></body></html>"
    };

    const queueFetcher = async (url: string) => {
      const html = saturatedPages[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const result = await crawlWeb({
      fetcher: queueFetcher,
      seeds: ["https://queue.example/root"],
      pipeline: { workerThreads: 1, fetchConcurrency: 3, queueMax: 1, frontierMax: 8 }
    });

    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes("worker queue saturated"))).toBe(true);
  });

  it("warns when crawl frontier reaches the configured saturation limit", async () => {
    const pagesWithFanout: Record<string, string> = {
      "https://fanout.example/root": `
        <html><body>
          <a href="https://fanout.example/a">A</a>
          <a href="https://fanout.example/b">B</a>
          <a href="https://fanout.example/c">C</a>
        </body></html>
      `
    };

    const fetchFanout = async (url: string) => {
      const html = pagesWithFanout[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const result = await crawlWeb({
      fetcher: fetchFanout,
      seeds: ["https://fanout.example/root"],
      budget: { maxDepth: 2, maxPages: 4, maxPerDomain: 10 },
      pipeline: { frontierMax: 0, fetchConcurrency: 1, workerThreads: 0, queueMax: 4 }
    });

    expect(result.pages).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes("crawl frontier saturated"))).toBe(true);
  });
});
