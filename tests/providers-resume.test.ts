import { describe, expect, it, vi } from "vitest";
import { ProviderRuntime } from "../src/providers";
import { normalizeRecord } from "../src/providers/normalize";
import type { ProviderAdapter, ProviderContext, ProviderSource, SessionChallengeSummary } from "../src/providers/types";

type WorkflowKind = "research" | "shopping" | "product_video" | "inspiredesign";
type InspiredesignResumeMeta = {
  selection: {
    capture_mode: string;
  };
  metrics: {
    failed_captures: number;
  };
};

type InspiredesignResumeEvidence = {
  references: Array<{
    url: string;
    fetchStatus: string;
    captureStatus: string;
    captureFailure?: string;
  }>;
};

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

const workflowResumeInput = (
  kind: WorkflowKind,
  input: Record<string, unknown>,
  options: {
    checkpoint?: Record<string, unknown>;
    trace?: Array<Record<string, unknown>>;
  } = {}
): { workflow: { kind: WorkflowKind; input: Record<string, unknown> } } => ({
  workflow: {
    kind,
    input,
    ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}),
    ...(options.trace ? { trace: options.trace } : {})
  }
});

const expectWorkflowSuspendedIntent = (
  kind: WorkflowKind,
  input: Record<string, unknown>
) => expect.objectContaining({
  kind: `workflow.${kind}`,
  input: {
    workflow: expect.objectContaining({
      kind,
      input: expect.objectContaining(input)
    })
  }
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
        input: workflowResumeInput("research", {
          topic: "resume topic",
          mode: "json",
          sources: ["web"],
          limitPerSource: 1
        })
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
        suspendedIntent: expectWorkflowSuspendedIntent("research", {
          topic: "resume topic"
        })
      })
    );
    expect(seenContext?.suspendedIntent?.kind).toBe("workflow.research");
  });

  it("resumes workflow research from checkpoint state without replaying completed source searches", async () => {
    let communityContext: ProviderContext | undefined;
    let fetchContext: ProviderContext | undefined;
    const webSearch = vi.fn(async () => [normalizeRecord("web/research", "web", {
      url: "https://example.com/unexpected-web-replay",
      title: "unexpected web replay"
    })]);
    const communitySearch = vi.fn(async (input, context) => {
      communityContext = context;
      return [normalizeRecord("community/research", "community", {
        url: "https://community.example.com/resume-topic",
        title: input.query,
        attributes: {
          retrievalPath: "community:post:url"
        }
      })];
    });
    const fetch = vi.fn(async (input, context) => {
      fetchContext = context;
      return [normalizeRecord("web/research", "web", {
        url: input.url,
        title: "checkpointed follow-up",
        content: "checkpointed follow-up content",
        attributes: {
          retrievalPath: "web:fetch:url"
        }
      })];
    });
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("web/research", "web", { search: webSearch, fetch }),
        makeProvider("community/research", "community", { search: communitySearch })
      ]
    });

    const checkpointedWebSearchResult = {
      ok: true,
      records: [normalizeRecord("web/research", "web", {
        url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fresume-follow-up",
        title: "resume search shell",
        content: "resume topic",
        attributes: {
          retrievalPath: "web:search:index"
        }
      })],
      trace: { requestId: "research-checkpoint", ts: "2026-03-30T23:15:00.000Z" },
      partial: false,
      failures: [],
      metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
      sourceSelection: "web" as const,
      providerOrder: ["web/research"]
    };

    const result = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.research",
        input: workflowResumeInput("research", {
          topic: "resume topic",
          mode: "json",
          sources: ["web", "community"],
          limitPerSource: 1
        }, {
          checkpoint: {
            stage: "execute",
            stepId: "search:web",
            stepIndex: 0,
            state: {
              completed_step_ids: ["search:web"],
              step_results_by_id: {
                "search:web": checkpointedWebSearchResult
              }
            },
            updatedAt: "2026-03-30T23:15:00.000Z"
          },
          trace: [{
            at: "2026-03-30T23:15:00.000Z",
            stage: "compile",
            event: "compile_completed"
          }]
        })
      }
    }));

    expect(webSearch).not.toHaveBeenCalled();
    expect(communitySearch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/resume-follow-up" },
      expect.objectContaining({
        suspendedIntent: expect.objectContaining({
          kind: "workflow.research",
          input: expect.objectContaining({
            workflow: expect.objectContaining({
              checkpoint: expect.objectContaining({
                state: expect.objectContaining({
                  completed_step_ids: ["search:web", "search:community"]
                })
              })
            })
          })
        })
      })
    );
    expect(communityContext?.suspendedIntent).toMatchObject({
      kind: "workflow.research",
      input: {
        workflow: {
          kind: "research",
          checkpoint: {
            state: {
              completed_step_ids: ["search:web"]
            }
          }
        }
      }
    });
    expect(fetchContext?.suspendedIntent?.kind).toBe("workflow.research");
    expect((result.records as Array<{ url: string }>).map((record) => record.url)).toEqual(
      expect.arrayContaining([
        "https://example.com/resume-follow-up",
        "https://community.example.com/resume-topic"
      ])
    );
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
        input: workflowResumeInput("shopping", {
          query: "workflow shopping item",
          providers: ["shopping/amazon"],
          mode: "json"
        })
      }
    }));
    expect((shopping.offers as Array<{ provider: string }>)[0]?.provider).toBe("shopping/amazon");
    expect(shoppingContext?.suspendedIntent?.kind).toBe("workflow.shopping");

    const productVideo = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.product_video",
        input: workflowResumeInput("product_video", {
          product_url: "https://www.amazon.com/dp/WORKFLOWVIDEO001",
          include_screenshots: false,
          include_all_images: false,
          include_copy: false
        }, {
          checkpoint: {
            stage: "resume",
            stepId: "workflow.product_video:resume",
            stepIndex: 0,
            state: {
              completed_step_ids: []
            },
            updatedAt: "2026-03-22T12:00:00.000Z"
          },
          trace: [{
            at: "2026-03-22T12:00:00.000Z",
            stage: "resume",
            event: "resume_seed"
          }]
        })
      }
    }));
    expect((productVideo.product as { provider: string }).provider).toBe("shopping/amazon");
    expect(productVideoContext?.suspendedIntent?.kind).toBe("workflow.product_video");
    expect(productVideoContext?.suspendedIntent?.input).toMatchObject({
      workflow: {
        kind: "product_video",
        checkpoint: {
          stage: "execute",
          stepId: "product_video:fetch_product_detail",
          state: {
            completed_step_ids: ["product_video:normalize_input"]
          }
        }
      }
    });
    const productVideoTrace = (productVideoContext?.suspendedIntent?.input as {
      workflow: {
        trace: Array<{ event: string }>;
      };
    }).workflow.trace;
    expect(productVideoTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "resume_seed" }),
      expect.objectContaining({ event: "compile_started" }),
      expect.objectContaining({ event: "compile_completed" }),
      expect.objectContaining({ event: "pre_suspend_checkpoint" })
    ]));
  });

  it("replays workflow inspiredesign intents through the shared runtime without synthetic capture failures", async () => {
    let inspiredesignContext: ProviderContext | undefined;
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("web/inspiredesign", "web", {
          fetch: async (input, context) => {
            inspiredesignContext = context;
            return [normalizeRecord("web/inspiredesign", "web", {
              url: input.url,
              title: "Inspiredesign reference",
              content: "Design reference content"
            })];
          }
        })
      ]
    });

    const output = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.inspiredesign",
        input: workflowResumeInput("inspiredesign", {
          brief: "Create a reusable design contract",
          urls: ["https://example.com/inspiration"],
          captureMode: "off",
          mode: "json"
        })
      }
    }));

    expect(output).toMatchObject({
      designContract: expect.objectContaining({
        intent: expect.objectContaining({
          task: "Create a reusable design contract"
        })
      }),
      meta: expect.objectContaining({
        selection: expect.objectContaining({
          capture_mode: "deep"
        }),
        metrics: expect.objectContaining({
          failed_captures: 1
        }),
        primaryConstraintSummary: "Deep capture was unavailable for 1 reference in this execution lane."
      })
    });
    expect(inspiredesignContext?.suspendedIntent).toMatchObject({
      kind: "workflow.inspiredesign",
      input: {
        workflow: {
          kind: "inspiredesign"
        }
      }
    });
    const evidence = output.evidence as InspiredesignResumeEvidence;
    const meta = output.meta as InspiredesignResumeMeta;
    expect(meta.selection.capture_mode).toBe("deep");
    expect(evidence.references[0]).toMatchObject({
      url: "https://example.com/inspiration",
      fetchStatus: "captured",
      captureStatus: "failed",
      captureFailure: "Deep capture requested, but browser capture is unavailable in this execution lane."
    });
  });

  it("resumes workflow shopping from checkpoint state without replaying completed provider searches", async () => {
    let walmartContext: ProviderContext | undefined;
    const amazonSearch = vi.fn(async () => [normalizeRecord("shopping/amazon", "shopping", {
      url: "https://www.amazon.com/dp/WORKFLOWCHECKPOINT001",
      title: "checkpointed amazon result",
      content: "$19.99",
      attributes: {
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "WORKFLOWCHECKPOINT001",
          title: "checkpointed amazon result",
          url: "https://www.amazon.com/dp/WORKFLOWCHECKPOINT001",
          price: { amount: 19.99, currency: "USD", retrieved_at: "2026-03-30T22:00:00.000Z" },
          shipping: { amount: 0, currency: "USD", notes: "free" },
          availability: "in_stock",
          rating: 4.7,
          reviews_count: 12
        }
      }
    })]);
    const walmartSearch = vi.fn(async (input, context) => {
      walmartContext = context;
      return [normalizeRecord("shopping/walmart", "shopping", {
        url: "https://www.walmart.com/ip/WORKFLOWCHECKPOINT002",
        title: input.query,
        content: "$24.99",
        attributes: {
          shopping_offer: {
            provider: "shopping/walmart",
            product_id: "WORKFLOWCHECKPOINT002",
            title: input.query,
            url: "https://www.walmart.com/ip/WORKFLOWCHECKPOINT002",
            price: { amount: 24.99, currency: "USD", retrieved_at: "2026-03-30T22:00:00.000Z" },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.4,
            reviews_count: 9
          }
        }
      })];
    });
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("shopping/amazon", "shopping", { search: amazonSearch }),
        makeProvider("shopping/walmart", "shopping", { search: walmartSearch })
      ]
    });

    const checkpointedAmazonResult = {
      ok: true,
      records: [normalizeRecord("shopping/amazon", "shopping", {
        url: "https://www.amazon.com/dp/WORKFLOWCHECKPOINT001",
        title: "checkpointed amazon result",
        content: "$19.99",
        attributes: {
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "WORKFLOWCHECKPOINT001",
            title: "checkpointed amazon result",
            url: "https://www.amazon.com/dp/WORKFLOWCHECKPOINT001",
            price: { amount: 19.99, currency: "USD", retrieved_at: "2026-03-30T22:00:00.000Z" },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.7,
            reviews_count: 12
          }
        }
      })],
      trace: { requestId: "shopping-checkpoint", ts: "2026-03-30T22:00:00.000Z" },
      partial: false,
      failures: [],
      metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
      sourceSelection: "shopping" as const,
      providerOrder: ["shopping/amazon"]
    };

    const shopping = await runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.shopping",
        input: workflowResumeInput("shopping", {
          query: "workflow shopping resume",
          providers: ["shopping/amazon", "shopping/walmart"],
          mode: "json"
        }, {
          checkpoint: {
            stage: "execute",
            stepId: "search:shopping/amazon",
            stepIndex: 0,
            state: {
              completed_step_ids: ["search:shopping/amazon"],
              step_results_by_id: {
                "search:shopping/amazon": checkpointedAmazonResult
              }
            },
            updatedAt: "2026-03-30T22:00:00.000Z"
          },
          trace: [{
            at: "2026-03-30T22:00:00.000Z",
            stage: "compile",
            event: "compile_completed"
          }]
        })
      }
    }));

    expect(amazonSearch).not.toHaveBeenCalled();
    expect(walmartSearch).toHaveBeenCalledTimes(1);
    expect((shopping.offers as Array<{ provider: string }>).map((offer) => offer.provider)).toEqual(
      expect.arrayContaining(["shopping/amazon", "shopping/walmart"])
    );
    expect(walmartContext?.suspendedIntent).toMatchObject({
      kind: "workflow.shopping",
      input: {
        workflow: {
          kind: "shopping",
          checkpoint: {
            state: {
              completed_step_ids: ["search:shopping/amazon"]
            }
          }
        }
      }
    });
  });

  it("rejects legacy raw workflow payloads after the phase-1 migration seam collapses", async () => {
    const runtime = new ProviderRuntime({
      providers: [
        makeProvider("web/research", "web", {
          search: async () => [normalizeRecord("web/research", "web", {
            url: "https://example.com/raw-workflow",
            title: "raw workflow"
          })]
        })
      ]
    });

    await expect(runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.research",
        input: {
          topic: "raw workflow payload",
          mode: "json",
          sources: ["web"],
          limitPerSource: 1
        }
      }
    }))).rejects.toMatchObject({
      code: "invalid_input",
      message: "Workflow resume payload is missing or malformed."
    });
  });

  it("rejects workflow resume envelopes whose kind does not match the suspended intent", async () => {
    const runtime = new ProviderRuntime();

    await expect(runtime.resumeChallengeIntent(makeChallenge({
      suspendedIntent: {
        kind: "workflow.research",
        input: workflowResumeInput("shopping", {
          query: "wireless mouse",
          mode: "json",
          providers: ["shopping/amazon"]
        })
      }
    }))).rejects.toMatchObject({
      code: "invalid_input",
      message: "Workflow resume payload kind mismatch. Expected research but received shopping."
    });
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
