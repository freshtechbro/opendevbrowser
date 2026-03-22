import { describe, expect, it, vi } from "vitest";
import { ProviderRuntime } from "../src/providers";
import { normalizeRecord } from "../src/providers/normalize";
import type { ProviderAdapter, ProviderContext, ProviderSource, SessionChallengeSummary } from "../src/providers/types";

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

const makeChallenge = (
  overrides: Partial<SessionChallengeSummary> = {}
): SessionChallengeSummary => ({
  challengeId: "challenge-1",
  blockerType: "anti_bot_challenge",
  ownerSurface: "provider_fallback",
  resumeMode: "auto",
  status: "resolved",
  updatedAt: "2026-03-22T12:00:00.000Z",
  suspendedIntent: {
    kind: "provider.search",
    provider: "web/resume",
    source: "web",
    operation: "search",
    input: {
      query: "resume"
    }
  },
  ...overrides
});

describe("provider runtime resume", () => {
  it("fills missing suspended intent input during live provider execution and preserves explicit input", async () => {
    const seenContexts: ProviderContext[] = [];
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("web/fetch-live", "web", {
          fetch: async (input, context) => {
            seenContexts.push(context);
            return [normalizeRecord("web/fetch-live", "web", {
              url: input.url,
              title: "live suspended intent"
            })];
          }
        })
      ]
    });

    await runtime.fetch(
      { url: "https://example.com/live" },
      {
        source: "web",
        providerIds: ["web/fetch-live"],
        suspendedIntent: {
          kind: "provider.fetch",
          provider: "web/fetch-live",
          source: "web",
          operation: "fetch"
        }
      }
    );

    await runtime.fetch(
      { url: "https://example.com/ignored" },
      {
        source: "web",
        providerIds: ["web/fetch-live"],
        suspendedIntent: {
          kind: "provider.fetch",
          provider: "web/fetch-live",
          source: "web",
          operation: "fetch",
          input: {
            url: "https://example.com/preserved"
          }
        }
      }
    );

    expect(seenContexts[0]?.suspendedIntent).toMatchObject({
      kind: "provider.fetch",
      input: {
        url: "https://example.com/live"
      }
    });
    expect(seenContexts[1]?.suspendedIntent).toMatchObject({
      kind: "provider.fetch",
      input: {
        url: "https://example.com/preserved"
      }
    });
  });

  it("replays preserved provider intents through shared runtime", async () => {
    let seenContext: ProviderContext | undefined;
    const search = vi.fn(async (input, context) => {
      seenContext = context;
      return [normalizeRecord("web/resume", "web", {
        url: `https://example.com/${input.query}`,
        title: "resumed provider result"
      })];
    });
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("web/resume", "web", { search })
      ]
    });

    const result = await runtime.resumeChallengeIntent(makeChallenge());

    expect(result).toMatchObject({
      ok: true,
      records: [expect.objectContaining({
        provider: "web/resume",
        url: "https://example.com/resume"
      })]
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "resume" }),
      expect.objectContaining({
        suspendedIntent: expect.objectContaining({
          kind: "provider.search",
          provider: "web/resume",
          input: {
            query: "resume"
          }
        })
      })
    );
    expect(seenContext?.suspendedIntent?.kind).toBe("provider.search");
  });

  it("replays provider fetch, crawl, post, and youtube transcript intents with the intended provider routing", async () => {
    let fetchContext: ProviderContext | undefined;
    let crawlContext: ProviderContext | undefined;
    let postContext: ProviderContext | undefined;
    let youtubeContext: ProviderContext | undefined;
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("web/fetch-resume", "web", {
          fetch: async (input, context) => {
            fetchContext = context;
            return [normalizeRecord("web/fetch-resume", "web", {
              url: input.url,
              title: "resumed fetch"
            })];
          }
        }),
        makeProvider("community/crawl-resume", "community", {
          crawl: async (input, context) => {
            crawlContext = context;
            return [normalizeRecord("community/crawl-resume", "community", {
              url: input.seedUrls[0],
              title: "resumed crawl"
            })];
          }
        }),
        makeProvider("community/post-resume", "community", {
          post: async (input, context) => {
            postContext = context;
            return [normalizeRecord("community/post-resume", "community", {
              url: `https://community.local/${input.target}`,
              title: input.content
            })];
          }
        }),
        makeProvider("social/youtube", "social", {
          fetch: async (input, context) => {
            youtubeContext = context;
            return [normalizeRecord("social/youtube", "social", {
              url: input.url,
              title: "youtube transcript"
            })];
          }
        })
      ]
    });

    const fetched = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "provider.fetch",
        provider: "web/fetch-resume",
        source: "web",
        operation: "fetch",
        input: {
          url: "https://example.com/fetch"
        }
      }
    }));
    expect(fetched.records[0]?.provider).toBe("web/fetch-resume");
    expect(fetchContext?.suspendedIntent?.kind).toBe("provider.fetch");

    const crawled = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "provider.crawl",
        operation: "crawl",
        input: {
          seedUrls: ["https://community.local/thread/1"]
        }
      }
    }), {
      source: "community",
      providerIds: ["community/crawl-resume"]
    });
    expect(crawled.records[0]?.provider).toBe("community/crawl-resume");
    expect(crawlContext?.suspendedIntent?.kind).toBe("provider.crawl");

    const posted = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "provider.post",
        operation: "post",
        input: {
          target: "post-resume",
          content: "resume content"
        }
      }
    }), {
      source: "community",
      providerIds: ["community/post-resume"]
    });
    expect(posted.records[0]?.provider).toBe("community/post-resume");
    expect(postContext?.suspendedIntent?.kind).toBe("provider.post");

    const transcript = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "youtube.transcript",
        input: {
          url: "https://www.youtube.com/watch?v=resume"
        }
      }
    }), {
      providerIds: ["social/youtube"]
    });
    expect(transcript.records[0]?.provider).toBe("social/youtube");
    expect(youtubeContext?.suspendedIntent?.kind).toBe("provider.fetch");
  });

  it("replays suspended intents when routing falls back to options, provider hints, and default auto selection", async () => {
    const search = vi.fn(async (input) => [normalizeRecord("web/search-options", "web", {
      url: `https://example.com/${input.query}`,
      title: "search options replay"
    })]);
    const fetch = vi.fn(async (input) => [normalizeRecord("web/fetch-auto", "web", {
      url: input.url,
      title: "fetch auto replay"
    })]);
    const crawl = vi.fn(async (input) => [normalizeRecord("community/crawl-intent", "community", {
      url: input.seedUrls[0],
      title: "crawl provider replay"
    })]);
    const post = vi.fn(async (input) => [normalizeRecord("community/post-intent", "community", {
      url: `https://community.local/${input.target}`,
      title: input.content
    })]);
    const youtubeFetch = vi.fn(async (input) => [normalizeRecord("social/youtube-intent", "social", {
      url: input.url,
      title: "youtube provider replay"
    })]);
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("web/search-options", "web", { search }),
        makeProvider("web/fetch-auto", "web", { fetch }),
        makeProvider("community/crawl-intent", "community", { crawl }),
        makeProvider("community/post-intent", "community", { post }),
        makeProvider("social/youtube-intent", "social", { fetch: youtubeFetch })
      ]
    });

    const searchedViaOptions = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "provider.search",
        operation: "search",
        input: {
          query: "search-via-options"
        }
      }
    }), {
      source: "web",
      providerIds: ["web/search-options"]
    });
    expect(searchedViaOptions.records[0]?.provider).toBe("web/search-options");

    const searchedViaAuto = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "provider.search",
        operation: "search",
        input: {
          query: "search-via-auto"
        }
      }
    }));
    expect(searchedViaAuto.records[0]?.provider).toBe("web/search-options");

    const fetchedViaAuto = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "provider.fetch",
        operation: "fetch",
        input: {
          url: "https://example.com/fetch-via-auto"
        }
      }
    }));
    expect(fetchedViaAuto.records[0]?.provider).toBe("web/fetch-auto");

    const crawledViaProvider = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "provider.crawl",
        provider: "community/crawl-intent",
        operation: "crawl",
        input: {
          seedUrls: ["https://community.local/crawl-via-provider"]
        }
      }
    }));
    expect(crawledViaProvider.records[0]?.provider).toBe("community/crawl-intent");

    const postedViaProvider = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "provider.post",
        provider: "community/post-intent",
        operation: "post",
        input: {
          target: "post-via-provider",
          content: "resume post route"
        }
      }
    }));
    expect(postedViaProvider.records[0]?.provider).toBe("community/post-intent");

    const transcriptViaProvider = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "youtube.transcript",
        provider: "social/youtube-intent",
        input: {
          url: "https://www.youtube.com/watch?v=resume-provider-route"
        }
      }
    }));
    expect(transcriptViaProvider.records[0]?.provider).toBe("social/youtube-intent");

    expect(search).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(crawl).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(youtubeFetch).toHaveBeenCalledTimes(1);
  });

  it("replays workflow intents and keeps workflow-level suspended metadata", async () => {
    let seenContext: ProviderContext | undefined;
    const search = vi.fn(async (input, context) => {
      seenContext = context;
      return [normalizeRecord("web/research", "web", {
        url: `https://example.com/${input.query}`,
        title: "workflow replay"
      })];
    });
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("web/research", "web", { search })
      ]
    });

    const result = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.research",
        input: {
          topic: "resume topic",
          mode: "json",
          sources: ["web"],
          limitPerSource: 1
        }
      }
    }));

    expect(result).toMatchObject({
      records: [expect.objectContaining({
        provider: "web/research",
        url: "https://example.com/resume topic"
      })]
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "resume topic", limit: 1 }),
      expect.objectContaining({
        suspendedIntent: expect.objectContaining({
          kind: "workflow.research",
          input: expect.objectContaining({
            topic: "resume topic"
          })
        })
      })
    );
    expect(seenContext?.suspendedIntent?.kind).toBe("workflow.research");
  });

  it("replays workflow shopping and product-video intents through the shared runtime", async () => {
    let shoppingContext: ProviderContext | undefined;
    let productVideoContext: ProviderContext | undefined;
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("shopping/amazon", "shopping", {
          search: async (input, context) => {
            shoppingContext = context;
            return [normalizeRecord("shopping/amazon", "shopping", {
              url: "https://www.amazon.com/dp/WORKFLOWSHOP001",
              title: input.query,
              content: "$19.99",
              attributes: {
                shopping_offer: {
                  provider: "shopping/amazon",
                  product_id: "WORKFLOWSHOP001",
                  title: input.query,
                  url: "https://www.amazon.com/dp/WORKFLOWSHOP001",
                  price: { amount: 19.99, currency: "USD", retrieved_at: "2026-03-22T12:00:00.000Z" },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 4.7,
                  reviews_count: 12
                }
              }
            })];
          },
          fetch: async (input, context) => {
            productVideoContext = context;
            return [normalizeRecord("shopping/amazon", "shopping", {
              url: input.url,
              title: "workflow product video",
              content: "Feature alpha. Feature beta.",
              attributes: {
                links: [],
                shopping_offer: {
                  provider: "shopping/amazon",
                  product_id: "WORKFLOWVIDEO001",
                  title: "workflow product video",
                  url: input.url,
                  price: { amount: 29.99, currency: "USD", retrieved_at: "2026-03-22T12:00:00.000Z" },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 4.8,
                  reviews_count: 20
                }
              }
            })];
          }
        })
      ]
    });

    const shopping = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.shopping",
        input: {
          query: "workflow shopping item",
          providers: ["shopping/amazon"],
          mode: "json"
        }
      }
    }));
    expect((shopping.offers as Array<{ provider: string }>)[0]?.provider).toBe("shopping/amazon");
    expect(shoppingContext?.suspendedIntent?.kind).toBe("workflow.shopping");

    const productVideo = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.product_video",
        input: {
          product_url: "https://www.amazon.com/dp/WORKFLOWVIDEO001",
          include_screenshots: false,
          include_all_images: false,
          include_copy: false
        }
      }
    }));
    expect((productVideo.product as { provider: string }).provider).toBe("shopping/amazon");
    expect(productVideoContext?.suspendedIntent?.kind).toBe("workflow.product_video");
  });

  it("rejects manual or unresolved challenges before replay", async () => {
    const runtime = new ProviderRuntime();

    await expect(runtime.resumeChallengeIntent(makeChallenge({
      resumeMode: "manual"
    }))).rejects.toMatchObject({
      code: "policy_blocked"
    });

    await expect(runtime.resumeChallengeIntent(makeChallenge({
      status: "active"
    }))).rejects.toMatchObject({
      code: "policy_blocked"
    });

    await expect(runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: undefined
    }))).rejects.toMatchObject({
      code: "invalid_input"
    });

    await expect(runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "provider.fetch",
        provider: "web/resume",
        source: "web",
        operation: "fetch",
        input: "not-an-object" as unknown as SessionChallengeSummary["suspendedIntent"]["input"]
      }
    }))).rejects.toMatchObject({
      code: "invalid_input"
    });
  });

  it("rejects unsupported suspended intents", async () => {
    const runtime = new ProviderRuntime();

    await expect(runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.unknown" as unknown as SessionChallengeSummary["suspendedIntent"]["kind"],
        input: {
          query: "unsupported"
        }
      }
    }))).rejects.toMatchObject({
      code: "not_supported"
    });
  });
});
