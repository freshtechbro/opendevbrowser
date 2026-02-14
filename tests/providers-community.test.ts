import { describe, expect, it, vi } from "vitest";
import { createCommunityProvider } from "../src/providers/community";
import { createDefaultRuntime } from "../src/providers";

const context = (requestId: string) => ({
  trace: { requestId, ts: new Date().toISOString() },
  timeoutMs: 50,
  attempt: 1 as const
});

describe("community provider", () => {
  it("uses real retrieval defaults in createDefaultRuntime community path", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      return {
        status: 200,
        url,
        text: async () => `<html><body><main>community content ${url}</main><a href="https://forums.local/thread/2">thread</a></body></html>`
      };
    }) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "release notes", limit: 3 },
        { source: "community", providerIds: ["community/default"] }
      );

      expect(result.ok).toBe(true);
      expect(result.records.length).toBeGreaterThan(0);
      expect(result.failures).toHaveLength(0);
      expect(result.records[0]?.provider).toBe("community/default");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns structured unavailable errors when retrieval is not configured", async () => {
    const provider = createCommunityProvider({ platform: "forums" });

    await expect(provider.search?.({ query: "release notes" }, context("r1")))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.fetch?.({ url: "https://forums.local/post/1" }, context("r2")))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.crawl?.({ seedUrls: ["https://forums.local/thread/1"] }, context("r3")))
      .rejects.toMatchObject({ code: "unavailable" });

    const capabilities = provider.capabilities();
    expect(capabilities.operations.post.supported).toBe(true);
    expect(capabilities.policy.posting).toBe("gated");
    expect(capabilities.metadata.platform).toBe("forums");

    const health = await provider.health?.({
      trace: { requestId: "r4", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(health).toMatchObject({
      status: "degraded",
      reason: "Retrieval not configured"
    });
  });

  it("applies bounded pagination/hop traversal with deterministic dedupe and quality flags", async () => {
    const provider = createCommunityProvider({
      platform: "forums",
      defaultTraversal: {
        pageLimit: 2,
        hopLimit: 2,
        expansionPerRecord: 2,
        maxRecords: 8
      },
      search: async (input) => {
        const page = Number(input.filters?.page ?? 1);
        if (page === 1) {
          return [{
            url: "https://forums.local/thread/1",
            title: "thread-one",
            content: "seed",
            attributes: {
              links: ["https://forums.local/thread/2"]
            }
          }];
        }
        return [{
          url: "https://forums.local/thread/3",
          title: "thread-three",
          content: "next page"
        }];
      },
      fetch: async (input) => {
        if (input.url.endsWith("/thread/2")) {
          return {
            title: "thread-two",
            content: "expanded",
            attributes: {
              links: ["https://forums.local/thread/4"]
            }
          };
        }
        if (input.url.endsWith("/thread/4")) {
          return {
            title: "thread-four",
            content: "deep"
          };
        }
        return {
          title: "seed-fetch",
          content: "seed-fetch-content",
          attributes: {
            links: ["https://forums.local/thread/2"]
          }
        };
      }
    });

    const search = await provider.search?.({
      query: "release notes",
      limit: 8
    }, context("r5"));
    const searchUrls = search?.map((record) => record.url);
    expect(searchUrls).toEqual([
      "https://forums.local/thread/1",
      "https://forums.local/thread/3",
      "https://forums.local/thread/2",
      "https://forums.local/thread/4"
    ]);
    expect(search?.every((record) => typeof record.attributes.extractionQuality === "object")).toBe(true);

    const crawled = await provider.crawl?.({
      seedUrls: ["https://forums.local/thread/1"],
      maxDepth: 1,
      maxPages: 5
    }, context("r6"));
    expect(crawled?.map((record) => record.url)).toEqual([
      "https://forums.local/thread/1",
      "https://forums.local/thread/2"
    ]);
    expect(crawled?.[0]?.attributes.traversal).toMatchObject({ depth: 0 });
    expect(crawled?.[1]?.attributes.traversal).toMatchObject({ depth: 1 });
  });

  it("enforces posting policy gates and hook decisions", async () => {
    const provider = createCommunityProvider({
      postPolicyHooks: [
        async (state) => {
          if (state.payload.content.includes("blocked")) {
            return {
              allow: false,
              reason: "Blocked content"
            };
          }
          return { allow: true };
        }
      ],
      post: async (input) => ({
        url: `https://forums.local/post/${encodeURIComponent(input.target)}`,
        attributes: { mapper: "post" }
      })
    });

    await expect(provider.post?.({
      target: "general",
      content: "hello",
      confirm: false,
      riskAccepted: false
    }, context("r7"))).rejects.toMatchObject({
      code: "policy_blocked"
    });

    await expect(provider.post?.({
      target: "general",
      content: "blocked term",
      confirm: true,
      riskAccepted: true
    }, context("r8"))).rejects.toMatchObject({
      code: "policy_blocked"
    });

    const allowed = await provider.post?.({
      target: "general",
      content: "safe content",
      confirm: true,
      riskAccepted: true
    }, context("r9"));

    expect(allowed).toHaveLength(1);
    expect(allowed?.[0]?.url).toBe("https://forums.local/post/general");
    expect(allowed?.[0]?.attributes.mapper).toBe("post");
    const attributes = allowed?.[0]?.attributes;
    expect(typeof attributes?.auditHash).toBe("string");
    expect(attributes?.auditHash).toHaveLength(64);
    expect(String(attributes?.auditHash)).not.toContain("safe content");
  });

  it("uses custom crawl/search/fetch mappers and exposes healthy status", async () => {
    const provider = createCommunityProvider({
      id: "community/custom",
      platform: "forums",
      search: async () => [{
        url: "https://forums.local/custom/search",
        title: "custom-search",
        content: "custom result"
      }],
      fetch: async () => ({
        title: "custom-fetch",
        content: "custom payload",
        attributes: { mapper: "fetch" }
      }),
      crawl: async () => [{
        url: "https://forums.local/thread/custom",
        title: "Custom crawl",
        content: "from custom crawler",
        attributes: { mapper: "crawl" }
      }],
      post: async () => ({
        url: "https://forums.local/post/custom",
        attributes: { mapper: "post" }
      })
    });

    const search = await provider.search?.({ query: "custom" }, context("r10"));
    expect(search?.[0]?.title).toBe("custom-search");

    const fetched = await provider.fetch?.({ url: "https://forums.local/custom/fetch" }, context("r11"));
    expect(fetched?.[0]?.title).toBe("custom-fetch");
    expect(fetched?.[0]?.attributes.mapper).toBe("fetch");

    const crawled = await provider.crawl?.({
      seedUrls: ["https://forums.local/thread/start"],
      maxDepth: 2
    }, context("r12"));
    expect(crawled?.[0]?.attributes.mapper).toBe("crawl");

    const posted = await provider.post?.({
      target: "announcements",
      content: "ship update",
      confirm: true,
      riskAccepted: true
    }, context("r13"));
    expect(posted?.[0]?.url).toBe("https://forums.local/post/custom");
    expect(posted?.[0]?.attributes.mapper).toBe("post");

    const health = await provider.health?.({
      trace: { requestId: "r14", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(health?.status).toBe("healthy");
  });

  it("rejects empty search queries", async () => {
    const provider = createCommunityProvider();
    await expect(provider.search?.({ query: "   " }, context("r15"))).rejects.toMatchObject({
      code: "invalid_input"
    });
  });

  it("coerces traversal filters, sorts ties, and skips invalid urls", async () => {
    const provider = createCommunityProvider({
      defaultTraversal: {
        pageLimit: 2,
        hopLimit: 2,
        expansionPerRecord: 3,
        maxRecords: 5
      },
      search: async () => ([
        {
          url: "notaurl",
          title: "bad-row",
          content: "skip me"
        },
        {
          url: "https://forums.local/thread/same",
          title: "z-title",
          content: "dup-z"
        },
        {
          url: "https://forums.local/thread/same",
          title: "a-title",
          content: "dup-a"
        },
        {
          url: "https://forums.local/thread/alpha",
          title: "alpha",
          content: "ok",
          attributes: {
            links: ["https://forums.local/thread/beta", 10],
            relatedUrls: ["https://forums.local/thread/gamma"],
            threadLinks: "not-an-array",
            replyLinks: []
          }
        }
      ]),
      fetch: async (input) => ({
        url: input.url,
        title: "expanded",
        content: "expanded"
      })
    });

    const records = await provider.search?.({
      query: "coerce",
      filters: {
        pageLimit: "1",
        hopLimit: "1",
        expansionPerRecord: "2",
        maxRecords: "4"
      }
    }, context("r16"));

    expect(records?.map((record) => record.url)).toEqual([
      "https://forums.local/thread/alpha",
      "https://forums.local/thread/same",
      "https://forums.local/thread/beta",
      "https://forums.local/thread/gamma"
    ]);
    expect(records?.every((record) => typeof record.attributes.extractionQuality === "object")).toBe(true);
  });

  it("returns unavailable for post transport when policy passes but mapper is missing", async () => {
    const provider = createCommunityProvider({
      postPolicyHooks: [async () => ({ allow: true })]
    });

    await expect(provider.post?.({
      target: "general",
      content: "policy-ok",
      confirm: true,
      riskAccepted: true
    }, context("r17"))).rejects.toMatchObject({
      code: "unavailable"
    });
  });

  it("covers malformed traversal filters, fallback attributes, and crawl/post branch guards", async () => {
    const provider = createCommunityProvider({
      defaultTraversal: {
        pageLimit: 2,
        hopLimit: 1,
        expansionPerRecord: 2,
        maxRecords: 5
      },
      search: async (input) => {
        const page = Number(input.filters?.page ?? 1);
        if (page === 1) {
          return [
            {
              url: "https://forums.local/root",
              title: "root",
              content: "self https://forums.local/root and child https://forums.local/child",
              attributes: {
                links: ["https://forums.local/dup", "ftp://invalid"]
              }
            },
            {
              url: "https://forums.local/dup",
              title: "dup"
            }
          ];
        }
        return [
          {
            url: "https://forums.local/page-two",
            title: "two"
          }
        ];
      },
      fetch: async (input) => {
        if (input.url.endsWith("/child")) {
          return {
            url: "notaurl",
            title: "bad-child"
          };
        }
        return {
          url: input.url,
          title: "expanded",
          content: "https://forums.local/dup https://forums.local/new"
        };
      },
      crawl: async () => [
        {
          url: "https://forums.local/custom-crawl",
          title: "custom-crawl"
        }
      ],
      post: async () => ({})
    });

    const searched = await provider.search?.({
      query: "coverage",
      filters: {
        pageLimit: "NaN",
        hopLimit: "1",
        expansionPerRecord: "2",
        maxRecords: 10
      }
    }, context("r18"));

    expect(searched?.map((record) => record.url)).toEqual([
      "https://forums.local/dup",
      "https://forums.local/root",
      "https://forums.local/page-two"
    ]);

    const fetched = await provider.fetch?.({ url: "https://forums.local/fetch" }, context("r19"));
    expect(typeof fetched?.[0]?.attributes.extractionQuality).toBe("object");

    const customCrawl = await provider.crawl?.({
      seedUrls: ["https://forums.local/custom-crawl"]
    }, context("r20"));
    expect(typeof customCrawl?.[0]?.attributes.extractionQuality).toBe("object");

    const posted = await provider.post?.({
      target: "general",
      content: "ship update",
      confirm: true,
      riskAccepted: true
    }, context("r21"));
    expect("url" in (posted?.[0] ?? {})).toBe(false);
    expect(typeof posted?.[0]?.attributes.auditHash).toBe("string");

    const defaultCrawler = createCommunityProvider({
      fetch: async (input) => {
        if (input.url.endsWith("/root")) {
          return {
            title: "root",
            content: "https://forums.local/root https://forums.local/child https://forums.local/child"
          };
        }
        return {
          title: "child",
          content: "https://forums.local/root"
        };
      }
    });

    const crawled = await defaultCrawler.crawl?.({
      seedUrls: ["notaurl", "https://forums.local/root"]
    }, context("r22"));

    expect(crawled?.map((record) => record.url)).toEqual([
      "https://forums.local/root",
      "https://forums.local/child"
    ]);
    expect(crawled?.[0]?.attributes.traversal).toMatchObject({ depth: 0 });
  });

  it("covers traversal tie-break, hop-limit skip, max-record break, and crawl dedupe guards", async () => {
    const tieAndBreakProvider = createCommunityProvider({
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 0,
        expansionPerRecord: 2,
        maxRecords: 5
      },
      search: async () => ([
        { url: "https://forums.local/same", title: "z-title", content: "z" },
        { url: "https://forums.local/same", title: "a-title", content: "a" },
        { url: "https://forums.local/first", title: "first", content: "first", attributes: { links: ["https://forums.local/child"] } },
        { url: "https://forums.local/second", title: "second", content: "second" }
      ]),
      fetch: async () => ({
        title: "should-not-run",
        content: "no-fetch"
      })
    });

    const tieSorted = await tieAndBreakProvider.search?.({
      query: "tie",
      limit: 1
    }, context("r23"));
    expect(tieSorted?.map((record) => record.url)).toEqual(["https://forums.local/first"]);

    const hopGuarded = await tieAndBreakProvider.search?.({
      query: "hop-guard",
      filters: { hopLimit: 0, maxRecords: 4 }
    }, context("r24"));
    expect(hopGuarded?.map((record) => record.url)).toContain("https://forums.local/first");

    const expansionProvider = createCommunityProvider({
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 2,
        expansionPerRecord: 2,
        maxRecords: 4
      },
      search: async () => ([
        {
          url: "https://forums.local/root",
          title: "root",
          content: "root",
          attributes: { links: ["https://forums.local/child"] }
        }
      ]),
      fetch: async (input) => ({
        url: input.url,
        title: "child",
        content: "child",
        attributes: {
          links: ["https://forums.local/root"]
        }
      })
    });

    const expanded = await expansionProvider.search?.({ query: "expand" }, context("r25"));
    expect(expanded?.map((record) => record.url)).toEqual([
      "https://forums.local/root",
      "https://forums.local/child"
    ]);

    const crawlGuardProvider = createCommunityProvider({
      fetch: async (input) => {
        if (input.url.endsWith("/root")) {
          return {
            url: input.url,
            title: "root",
            content: "root",
            attributes: {
              links: ["https://forums.local/root", "https://forums.local/child"]
            }
          };
        }
        return {
          url: input.url,
          title: "child",
          content: "child",
          attributes: {
            links: ["https://forums.local/root"]
          }
        };
      }
    });

    const crawled = await crawlGuardProvider.crawl?.({
      seedUrls: ["https://forums.local/root"],
      maxDepth: 0,
      maxPages: 5
    }, context("r26"));

    expect(crawled?.map((record) => record.url)).toEqual(["https://forums.local/root"]);
  });
});
