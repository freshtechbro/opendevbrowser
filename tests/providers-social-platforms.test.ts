import { describe, expect, it, vi } from "vitest";
import { createSocialProvider, createSocialProviders, type SocialPlatform } from "../src/providers/social";
import { createDefaultRuntime } from "../src/providers";
import { ProviderRuntimeError } from "../src/providers/errors";
import type { ProviderAdapter } from "../src/providers/types";

const providers: ProviderAdapter[] = createSocialProviders();
const platforms: SocialPlatform[] = ["x", "reddit", "bluesky", "linkedin", "instagram", "tiktok", "threads", "youtube"];

const context = (requestId: string) => ({
  trace: { requestId, ts: new Date().toISOString() },
  timeoutMs: 50,
  attempt: 1 as const
});

describe("social platform adapters", () => {
  it("uses real retrieval defaults in createDefaultRuntime social path", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      return {
        status: 200,
        url,
        text: async () => `<html><body><main>social content ${url}</main><a href="https://x.com/acct/post/2">post</a></body></html>`
      };
    }) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "release", limit: 3 },
        { source: "social", providerIds: ["social/x"] }
      );

      expect(result.ok).toBe(true);
      expect(result.records.length).toBeGreaterThan(0);
      expect(result.failures).toHaveLength(0);
      expect(result.records[0]?.provider).toBe("social/x");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exposes normalized capability metadata for all configured platforms", () => {
    expect(providers).toHaveLength(8);

    for (const provider of providers) {
      const caps = provider.capabilities();
      expect(caps.source).toBe("social");
      expect(caps.providerId).toBe(provider.id);
      expect(caps.policy.posting).toBe("gated");
      expect(caps.operations.search.supported).toBe(true);
      expect(caps.operations.fetch.supported).toBe(true);
      expect(caps.operations.post.supported).toBe(true);
      expect(caps.operations.crawl.supported).toBe(false);
      expect(typeof caps.metadata.platform).toBe("string");
      expect(typeof caps.metadata.maxPostLength).toBe("number");
      expect(typeof caps.metadata.supportsMedia).toBe("boolean");
      expect(typeof caps.metadata.supportsThreads).toBe("boolean");
    }
  });

  it("returns structured unavailable errors for unconfigured default retrieval/post paths", async () => {
    for (const provider of providers) {
      await expect(provider.search?.({ query: "release" }, context(`s-${provider.id}`)))
        .rejects.toMatchObject({ code: "unavailable" });
      await expect(provider.fetch?.({ url: "https://example.com/post/1" }, context(`f-${provider.id}`)))
        .rejects.toMatchObject({ code: "unavailable" });
      await expect(provider.post?.({
        target: "handle",
        content: "hello",
        confirm: true,
        riskAccepted: true
      }, context(`p-${provider.id}`))).rejects.toMatchObject({ code: "unavailable" });
    }
  });

  it("applies bounded pagination/thread expansion with deterministic dedupe", async () => {
    const provider = createSocialProvider("threads", {
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
            url: "https://threads.net/@acct/post/1",
            title: "root",
            attributes: {
              links: ["https://threads.net/@acct/post/2"]
            }
          }];
        }
        return [{
          url: "https://threads.net/@acct/post/3",
          title: "page-two"
        }];
      },
      fetch: async (input) => {
        if (input.url.endsWith("/post/2")) {
          return {
            title: "expanded-2",
            content: "details-2",
            attributes: {
              links: ["https://threads.net/@acct/post/4"]
            }
          };
        }
        if (input.url.endsWith("/post/4")) {
          return {
            title: "expanded-4",
            content: "details-4"
          };
        }
        return {
          title: "fallback",
          content: "fallback"
        };
      }
    });

    const result = await provider.search?.({ query: "release", limit: 8 }, context("threads-traverse"));
    expect(result?.map((record) => record.url)).toEqual([
      "https://threads.net/@acct/post/1",
      "https://threads.net/@acct/post/3",
      "https://threads.net/@acct/post/2",
      "https://threads.net/@acct/post/4"
    ]);
    expect(result?.every((record) => typeof record.attributes.extractionQuality === "object")).toBe(true);
  });

  it("skips non-document social expansion links and tolerates recoverable expansion failures", async () => {
    const expansionFetches: string[] = [];
    const provider = createSocialProvider("x", {
      search: async () => [{
        url: "https://x.com/acct/root",
        title: "root",
        attributes: {
          links: [
            "https://abs.twimg.com/responsive-web/client-web/main.js",
            "https://x.com/acct/two",
            "https://x.com/acct/three"
          ]
        }
      }],
      fetch: async (input) => {
        expansionFetches.push(input.url);
        if (input.url.endsWith("/two")) {
          throw new ProviderRuntimeError("unavailable", `Retrieval failed for ${input.url}`, {
            provider: "social/x",
            source: "social",
            retryable: true
          });
        }
        return {
          url: input.url,
          title: "expanded",
          content: "expanded content"
        };
      }
    });

    const records = await provider.search?.({
      query: "openai",
      limit: 5,
      filters: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 5
      }
    }, context("social-expansion-skip"));

    expect(expansionFetches).toHaveLength(2);
    expect(expansionFetches).toEqual(expect.arrayContaining([
      "https://x.com/acct/two",
      "https://x.com/acct/three"
    ]));
    expect(records?.map((record) => record.url)).toEqual([
      "https://x.com/acct/root",
      "https://x.com/acct/three"
    ]);
  });

  it("propagates non-recoverable social expansion failures", async () => {
    const provider = createSocialProvider("x", {
      search: async () => [{
        url: "https://x.com/acct/root",
        title: "root",
        attributes: {
          links: ["https://x.com/acct/two"]
        }
      }],
      fetch: async (input) => {
        if (input.url.endsWith("/two")) {
          throw new ProviderRuntimeError("invalid_input", `Invalid expansion for ${input.url}`, {
            provider: "social/x",
            source: "social",
            retryable: false
          });
        }
        return {
          url: input.url,
          title: "ok",
          content: "ok"
        };
      }
    });

    await expect(provider.search?.({
      query: "openai",
      filters: {
        pageLimit: 1,
        hopLimit: 1,
        expansionPerRecord: 1
      }
    }, context("social-expansion-fail"))).rejects.toMatchObject({
      code: "invalid_input"
    });
  });

  it("maps platform names through createSocialProvider switch", () => {
    for (const platform of platforms) {
      const provider = createSocialProvider(platform);
      expect(provider.id).toBe(`social/${platform}`);
      expect(provider.capabilities().metadata.platform).toBe(platform);
    }
  });

  it("applies option mapping in createSocialProviders", () => {
    const mapped = createSocialProviders({
      x: { id: "social/custom-x" },
      reddit: { id: "social/custom-reddit" },
      tiktok: { id: "social/custom-tiktok" }
    });

    const ids = mapped.map((provider) => provider.id);
    expect(ids).toContain("social/custom-x");
    expect(ids).toContain("social/custom-reddit");
    expect(ids).toContain("social/custom-tiktok");
  });

  it("rejects over-length posts according to adapter metadata", async () => {
    const xProvider = createSocialProvider("x");
    const max = Number(xProvider.capabilities().metadata.maxPostLength);

    await expect(xProvider.post?.({
      target: "me",
      content: "x".repeat(max + 1),
      confirm: true,
      riskAccepted: true
    }, context("over-limit"))).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("coerces traversal filters, skips invalid urls, and expands bounded links", async () => {
    const provider = createSocialProvider("x", {
      defaultTraversal: {
        pageLimit: 2,
        hopLimit: 2,
        expansionPerRecord: 3,
        maxRecords: 6
      },
      search: async () => ([
        {
          url: "notaurl",
          title: "skip"
        },
        {
          url: "https://x.com/acct/same",
          title: "z-title",
          attributes: {
            links: ["https://x.com/acct/one", 3],
            relatedUrls: ["https://x.com/acct/two"]
          }
        },
        {
          url: "https://x.com/acct/same",
          title: "a-title",
          attributes: {
            links: ["https://x.com/acct/one"],
            relatedUrls: ["https://x.com/acct/two"]
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
      query: "macro",
      limit: 4,
      filters: {
        pageLimit: "1",
        hopLimit: "1",
        expansionPerRecord: "2",
        maxRecords: "20"
      }
    }, context("social-coerce"));

    expect(records?.map((record) => record.url)).toEqual([
      "https://x.com/acct/same",
      "https://x.com/acct/one",
      "https://x.com/acct/two"
    ]);
    expect(records?.every((record) => typeof record.attributes.extractionQuality === "object")).toBe(true);
  });

  it("returns unavailable when post policy passes but transport is missing", async () => {
    const provider = createSocialProvider("reddit", {
      postPolicyHooks: [async () => ({ allow: true })]
    });

    await expect(provider.post?.({
      target: "example",
      content: "policy ok",
      confirm: true,
      riskAccepted: true
    }, context("post-unavailable"))).rejects.toMatchObject({
      code: "unavailable"
    });
  });

  it("covers malformed traversal filters, fallback attributes, and health branches", async () => {
    const provider = createSocialProvider("x", {
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
              url: "https://x.com/acct/root",
              title: "root",
              content: "self https://x.com/acct/root and child https://x.com/acct/child",
              attributes: {
                links: ["https://x.com/acct/dup", "mailto:nope@example.com"]
              }
            },
            {
              url: "https://x.com/acct/dup",
              title: "dup"
            }
          ];
        }
        return [
          {
            url: "https://x.com/acct/page-two",
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
          content: "https://x.com/acct/dup https://x.com/acct/new"
        };
      },
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
    }, context("social-coverage"));

    expect(searched?.map((record) => record.url)).toEqual([
      "https://x.com/acct/dup",
      "https://x.com/acct/root",
      "https://x.com/acct/page-two"
    ]);
    expect(searched?.every((record) => typeof record.attributes.extractionQuality === "object")).toBe(true);

    const fetched = await provider.fetch?.({ url: "https://x.com/acct/fetch" }, context("social-fetch"));
    expect(typeof fetched?.[0]?.attributes.extractionQuality).toBe("object");

    const posted = await provider.post?.({
      target: "acct",
      content: "hello social",
      confirm: true,
      riskAccepted: true
    }, context("social-post"));
    expect(typeof posted?.[0]?.attributes.auditHash).toBe("string");

    const healthy = await provider.health?.({
      trace: { requestId: "social-health", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(healthy?.status).toBe("healthy");

    const degradedProvider = createSocialProvider("x");
    const degraded = await degradedProvider.health?.({
      trace: { requestId: "social-health-degraded", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(degraded).toMatchObject({
      status: "degraded",
      reason: "Retrieval not configured"
    });
  });

  it("covers social traversal tie-break, hop-limit skip, max-record break, and seen-link guard", async () => {
    const tieAndBreak = createSocialProvider("x", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 0,
        expansionPerRecord: 2,
        maxRecords: 5
      },
      search: async () => ([
        { url: "https://x.com/acct/same", title: "z-title", content: "z" },
        { url: "https://x.com/acct/same", title: "a-title", content: "a" },
        { url: "https://x.com/acct/first", title: "first", attributes: { links: ["https://x.com/acct/child"] } },
        { url: "https://x.com/acct/second", title: "second" }
      ]),
      fetch: async () => ({
        title: "should-not-run",
        content: "no-fetch"
      })
    });

    const maxRecordCut = await tieAndBreak.search?.({
      query: "tie",
      limit: 1
    }, context("social-tie-break"));
    expect(maxRecordCut?.map((record) => record.url)).toEqual(["https://x.com/acct/first"]);

    const hopSkipped = await tieAndBreak.search?.({
      query: "hop",
      filters: { hopLimit: 0, maxRecords: 4 }
    }, context("social-hop-skip"));
    expect(hopSkipped?.map((record) => record.url)).toContain("https://x.com/acct/first");

    const expandAndSeen = createSocialProvider("x", {
      defaultTraversal: {
        pageLimit: 1,
        hopLimit: 2,
        expansionPerRecord: 2,
        maxRecords: 4
      },
      search: async () => ([
        {
          url: "https://x.com/acct/root",
          title: "root",
          attributes: { links: ["https://x.com/acct/child"] }
        }
      ]),
      fetch: async (input) => ({
        url: input.url,
        title: "expanded",
        content: "expanded",
        attributes: {
          links: ["https://x.com/acct/root"]
        }
      })
    });

    const expanded = await expandAndSeen.search?.({ query: "expand" }, context("social-expand-seen"));
    expect(expanded?.map((record) => record.url)).toEqual([
      "https://x.com/acct/root",
      "https://x.com/acct/child"
    ]);
  });
});
