import { afterEach, describe, expect, it, vi } from "vitest";
import {
  workflowTestUtils,
  runProductVideoWorkflow,
  runResearchWorkflow,
  runShoppingWorkflow,
  type ProviderExecutor
} from "../src/providers/workflows";
import type { ResearchRecord } from "../src/providers/enrichment";
import { SHOPPING_PROVIDER_IDS } from "../src/providers/shopping";
import type {
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderError,
  ProviderFailureEntry,
  ProviderSource
} from "../src/providers/types";

const isoHoursAgo = (hours: number): string => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
const isoHoursAhead = (hours: number): string => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const makeRecord = (overrides: Partial<NormalizedRecord> = {}): NormalizedRecord => ({
  id: "rec-1",
  source: "web",
  provider: "web/default",
  url: "https://example.com/product",
  title: "Example Product",
  content: "Feature one with enough length for extraction. Feature two also has enough detail for extraction.",
  timestamp: isoHoursAgo(4),
  confidence: 0.7,
  attributes: {},
  ...overrides
});

const makeFailure = (
  provider: string,
  source: ProviderSource,
  error: Partial<ProviderError> = {}
): ProviderFailureEntry => ({
  provider,
  source,
  error: {
    code: "unavailable",
    message: "provider failed",
    retryable: false,
    ...error
  }
});

const makeAggregate = (overrides: Partial<ProviderAggregateResult> = {}): ProviderAggregateResult => ({
  ok: true,
  records: [],
  trace: { requestId: "workflow-branch-test", ts: new Date().toISOString() },
  partial: false,
  failures: [],
  metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
  sourceSelection: "web",
  providerOrder: ["web/default"],
  ...overrides
});

const toRuntime = (handlers: {
  search?: ProviderExecutor["search"];
  fetch?: ProviderExecutor["fetch"];
}): ProviderExecutor => ({
  search: handlers.search ?? (async () => makeAggregate()),
  fetch: handlers.fetch ?? (async () => makeAggregate())
});

describe("workflow branch coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    workflowTestUtils.resetProviderSignalState();
  });

  it("validates required research topic", async () => {
    const runtime = toRuntime({});
    await expect(runResearchWorkflow(runtime, {
      topic: "   ",
      mode: "json"
    })).rejects.toThrow("topic is required");
  });

  it("dedupes explicit research sources and keeps the strongest duplicate record", async () => {
    const search = vi.fn(async (_input, options) => {
      const source = (options?.source ?? "web") as ProviderSource;
      if (source === "web") {
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [
            makeRecord({
              id: "duplicate-low-score",
              source,
              provider: "web/default",
              url: "https://example.com/product",
              title: "Same Product",
              confidence: 0.6,
              timestamp: isoHoursAgo(20)
            }),
            makeRecord({
              id: "outside-timebox",
              source,
              provider: "web/default",
              url: "https://example.com/old",
              title: "Old",
              timestamp: isoHoursAgo(2000)
            })
          ]
        });
      }

      return makeAggregate({
        sourceSelection: "social",
        providerOrder: ["social/youtube"],
        records: [
          makeRecord({
            id: "duplicate-high-score",
            source,
            provider: "social/youtube",
            url: "https://example.com/product",
            title: "Same Product",
            confidence: 0.95,
            timestamp: isoHoursAgo(2),
            attributes: {
              engagement: { likes: 10, comments: 2, views: 100, upvotes: 3 }
            }
          })
        ]
      });
    });

    const output = await runResearchWorkflow(toRuntime({ search }), {
      topic: "agentic browser",
      sources: ["web", "web", "social"],
      sourceSelection: "all",
      from: isoHoursAgo(72),
      to: isoHoursAhead(1),
      mode: "path",
      includeEngagement: true,
      limitPerSource: 5
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(output).toMatchObject({ mode: "path", path: expect.any(String) });

    const records = output.records as Array<{ id: string }>;
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("duplicate-high-score");

    const meta = output.meta as {
      selection: { source_selection: string; resolved_sources: string[] };
      metrics: { total_records: number; within_timebox: number; final_records: number };
    };
    expect(meta.selection).toEqual({
      source_selection: "all",
      resolved_sources: ["web", "social"]
    });
    expect(meta.metrics.total_records).toBe(3);
    expect(meta.metrics.within_timebox).toBe(2);
    expect(meta.metrics.final_records).toBe(1);
  });

  it("promotes provider alerts from warning to degraded across windows", async () => {
    const unstableProvider = "web/unstable-coverage";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "web",
        providerOrder: [unstableProvider],
        failures: [makeFailure(unstableProvider, "web", {
          code: "rate_limited",
          message: "rate limited",
          retryable: true
        })],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    const first = await runResearchWorkflow(runtime, {
      topic: "unstable source",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });
    const firstAlerts = ((first.meta as { alerts: Array<{ state: string }> }).alerts ?? []);
    expect(firstAlerts.some((alert) => alert.state === "warning")).toBe(true);

    const second = await runResearchWorkflow(runtime, {
      topic: "unstable source",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });

    const secondMeta = second.meta as {
      alerts: Array<{ state: string }>;
      metrics: { failed_sources: string[] };
    };
    expect(secondMeta.metrics.failed_sources).toEqual(["web"]);
    expect(secondMeta.alerts.some((alert) => alert.state === "degraded")).toBe(true);
    expect(
      warnSpy.mock.calls.some((call) => String(call[0]).includes("\"event\":\"provider.signal.transition\""))
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("orders research records by timebox status and date confidence", () => {
    const records: ResearchRecord[] = [
      {
        id: "inside-explicit",
        source: "web",
        provider: "web/default",
        timestamp: isoHoursAgo(1),
        confidence: 0.8,
        engagement: { likes: 0, comments: 0, views: 0, upvotes: 0 },
        recency: { within_timebox: true, age_hours: 1 },
        date_confidence: { score: 1, source: "explicit" },
        attributes: {}
      },
      {
        id: "outside-inferred",
        source: "web",
        provider: "web/default",
        timestamp: "invalid-date",
        confidence: 0.7,
        engagement: { likes: 0, comments: 0, views: 0, upvotes: 0 },
        recency: { within_timebox: false, age_hours: Number.POSITIVE_INFINITY },
        date_confidence: { score: 0.6, source: "inferred" },
        attributes: {}
      },
      {
        id: "outside-missing",
        source: "web",
        provider: "web/default",
        timestamp: "invalid-date-two",
        confidence: 0.6,
        engagement: { likes: 0, comments: 0, views: 0, upvotes: 0 },
        recency: { within_timebox: false, age_hours: Number.POSITIVE_INFINITY },
        date_confidence: { score: 0, source: "missing" },
        attributes: {}
      }
    ];

    const ranked = workflowTestUtils.rankResearchRecords(records);
    expect(ranked.map((record) => record.id)).toEqual([
      "inside-explicit",
      "outside-inferred",
      "outside-missing"
    ]);
  });

  it("tracks anti-bot consecutive warnings across a rolling signal window", async () => {
    const provider = "web/captcha-window";
    let callCount = 0;
    const runtime = toRuntime({
      search: async () => {
        callCount += 1;
        if (callCount <= 52) {
          return makeAggregate({
            ok: true,
            sourceSelection: "web",
            providerOrder: [provider],
            records: [makeRecord({ id: `ok-${callCount}`, provider, source: "web" })]
          });
        }
        return makeAggregate({
          ok: false,
          sourceSelection: "web",
          providerOrder: [provider],
          failures: [makeFailure(provider, "web", {
            code: "unavailable",
            message: "captcha challenge triggered",
            retryable: true
          })],
          metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
        });
      }
    });

    let finalMeta: { alerts: Array<{ reason: string; signal: string }> } | null = null;
    for (let index = 0; index < 55; index += 1) {
      const output = await runResearchWorkflow(runtime, {
        topic: "rolling-alerts",
        sourceSelection: "web",
        days: 1,
        mode: "json"
      });
      finalMeta = output.meta as { alerts: Array<{ reason: string; signal: string }> };
    }

    expect(callCount).toBe(55);
    expect(finalMeta?.alerts.some((alert) => alert.signal === "anti_bot_challenge")).toBe(true);
    expect(finalMeta?.alerts.some((alert) => alert.reason.includes("3 consecutive events detected"))).toBe(true);
  });

  it("excludes degraded youtube provider from default auto research routing", async () => {
    const seedRuntime = toRuntime({
      search: async (_input, options) => {
        const source = (options?.source ?? "web") as ProviderSource;
        if (source !== "social") {
          return makeAggregate({
            sourceSelection: source,
            providerOrder: [`${source}/default`],
            records: [makeRecord({ id: `${source}-ok`, source, provider: `${source}/default` })]
          });
        }
        return makeAggregate({
          ok: false,
          sourceSelection: "social",
          providerOrder: ["social/youtube"],
          failures: [makeFailure("social/youtube", "social", {
            code: "rate_limited",
            message: "rate limited",
            retryable: true
          })],
          metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
        });
      }
    });

    await runResearchWorkflow(seedRuntime, {
      topic: "seed-youtube-degraded-1",
      sourceSelection: "social",
      days: 1,
      mode: "json"
    });
    await runResearchWorkflow(seedRuntime, {
      topic: "seed-youtube-degraded-2",
      sourceSelection: "social",
      days: 1,
      mode: "json"
    });

    expect(workflowTestUtils.getDegradedProviders()).toContain("social/youtube");

    const autoRuntime = toRuntime({
      search: async (_input, options) => {
        const source = (options?.source ?? "web") as ProviderSource;
        const provider = source === "social" ? "social/youtube" : `${source}/default`;
        return makeAggregate({
          sourceSelection: source,
          providerOrder: [provider],
          records: [makeRecord({
            id: `${source}-auto-record`,
            source,
            provider
          })]
        });
      }
    });

    const output = await runResearchWorkflow(autoRuntime, {
      topic: "auto-routing-after-degrade",
      sourceSelection: "auto",
      days: 1,
      mode: "json"
    });

    const providers = (output.records as Array<{ provider: string }>).map((record) => record.provider);
    expect(providers).not.toContain("social/youtube");
    expect((output.meta as {
      selection: { excluded_providers?: string[] };
    }).selection.excluded_providers).toContain("social/youtube");
  });

  it("excludes degraded shopping providers from default provider routing but allows explicit override", async () => {
    const seedRuntime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/amazon";
        return makeAggregate({
          ok: false,
          sourceSelection: "shopping",
          providerOrder: [providerId],
          failures: [makeFailure(providerId, "shopping", {
            code: "rate_limited",
            message: "rate limited",
            retryable: true
          })],
          metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
        });
      }
    });

    await runShoppingWorkflow(seedRuntime, {
      query: "seed-shopping-degraded-1",
      providers: ["shopping/amazon"],
      mode: "json"
    });
    await runShoppingWorkflow(seedRuntime, {
      query: "seed-shopping-degraded-2",
      providers: ["shopping/amazon"],
      mode: "json"
    });

    expect(workflowTestUtils.getDegradedProviders()).toContain("shopping/amazon");

    const calledProviders: string[] = [];
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/others";
        calledProviders.push(providerId);
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [makeRecord({
            id: `offer-${providerId}`,
            source: "shopping",
            provider: providerId,
            url: `https://shop.example/${providerId}`,
            title: `Offer ${providerId}`,
            content: "$10.00",
            attributes: {
              shopping_offer: {
                provider: providerId,
                product_id: `${providerId}-p`,
                title: `Offer ${providerId}`,
                url: `https://shop.example/${providerId}`,
                price: { amount: 10, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4,
                reviews_count: 1
              }
            }
          })]
        });
      }
    });

    const autoOutput = await runShoppingWorkflow(runtime, {
      query: "default-routing",
      mode: "json"
    });

    expect(calledProviders.length).toBeGreaterThan(0);
    expect(calledProviders).not.toContain("shopping/amazon");
    expect((autoOutput.meta as {
      selection: { excluded_providers?: string[] };
    }).selection.excluded_providers).toContain("shopping/amazon");

    calledProviders.length = 0;
    const explicitOutput = await runShoppingWorkflow(runtime, {
      query: "explicit-routing",
      providers: ["shopping/amazon"],
      mode: "json"
    });

    expect(calledProviders).toEqual(["shopping/amazon"]);
    expect((explicitOutput.meta as { selection: { providers: string[] } }).selection.providers).toEqual(["shopping/amazon"]);
  });

  it("returns shopping provider ids for known/unknown/invalid URLs", () => {
    expect(workflowTestUtils.resolveShoppingProviderIdForUrl("https://www.amazon.com/dp/example")).toBe("shopping/amazon");
    expect(workflowTestUtils.resolveShoppingProviderIdForUrl("https://store.example.com/item")).toBe("shopping/others");
    expect(workflowTestUtils.resolveShoppingProviderIdForUrl("not-a-url")).toBeNull();
  });

  it("covers provider source mapping branches for auto exclusion routing", () => {
    expect(workflowTestUtils.toProviderSource("web/default")).toBe("web");
    expect(workflowTestUtils.toProviderSource("community/reddit")).toBe("community");
    expect(workflowTestUtils.toProviderSource("social/youtube")).toBe("social");
    expect(workflowTestUtils.toProviderSource("shopping/amazon")).toBe("shopping");
    expect(workflowTestUtils.toProviderSource("custom/unknown")).toBeNull();
  });

  it("covers signal recovery helper branches across degraded cooldown windows", () => {
    expect(workflowTestUtils.nextSignalState("degraded", true, false, 0)).toEqual({
      state: "warning",
      healthyWindows: 0
    });
    expect(workflowTestUtils.nextSignalState("degraded", false, false, 0)).toEqual({
      state: "degraded",
      healthyWindows: 1
    });
    expect(workflowTestUtils.nextSignalState("degraded", false, false, 1)).toEqual({
      state: "none",
      healthyWindows: 2
    });
    expect(workflowTestUtils.nextSignalState("warning", false, true, 5)).toEqual({
      state: "degraded",
      healthyWindows: 0
    });
  });

  it("returns an empty object when redaction output is not a plain object", () => {
    expect(workflowTestUtils.redactRawCapture(["authorization=Bearer token"])).toEqual({});
  });

  it("returns null when image fetch throws in workflow fetchBinary helper", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);
    await expect(workflowTestUtils.fetchBinary("https://cdn.example.com/image.jpg")).resolves.toBeNull();
  });

  it("fails default shopping routing when every default provider is in degraded exclusion state", async () => {
    const seedRuntime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/others";
        return makeAggregate({
          ok: false,
          sourceSelection: "shopping",
          providerOrder: [providerId],
          failures: [makeFailure(providerId, "shopping", {
            code: "rate_limited",
            message: "rate limited",
            retryable: true
          })],
          metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
        });
      }
    });

    for (const providerId of SHOPPING_PROVIDER_IDS) {
      await runShoppingWorkflow(seedRuntime, {
        query: `seed-${providerId}-1`,
        providers: [providerId],
        mode: "json"
      });
      await runShoppingWorkflow(seedRuntime, {
        query: `seed-${providerId}-2`,
        providers: [providerId],
        mode: "json"
      });
    }

    await expect(runShoppingWorkflow(seedRuntime, {
      query: "all-degraded-default",
      mode: "json"
    })).rejects.toThrow("All default shopping providers are temporarily excluded");
  });

  it("resolves explicit single-source research selection", async () => {
    const runtime = toRuntime({
      search: async (_input, _options) => makeAggregate({
        sourceSelection: "social",
        providerOrder: ["social/default"],
        records: [makeRecord({ source: "social", provider: "social/default", id: "social-record" })]
      })
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "single-source",
      sourceSelection: "social",
      mode: "json",
      days: 7
    });

    const meta = output.meta as { selection: { source_selection: string; resolved_sources: string[] } };
    expect(meta.selection).toEqual({
      source_selection: "social",
      resolved_sources: ["social"]
    });
  });

  it("falls back to auto source selection when no selection is provided", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => makeAggregate({
        sourceSelection: (options?.source ?? "web") as ProviderSource,
        providerOrder: ["web/default"],
        records: [makeRecord({ id: "auto-selection", provider: "web/default", source: "web" })]
      })
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "implicit auto selection",
      days: 7,
      mode: "json"
    });

    const meta = output.meta as { selection: { source_selection: string; resolved_sources: string[] } };
    expect(meta.selection).toEqual({
      source_selection: "auto",
      resolved_sources: ["web", "community", "social"]
    });
  });

  it("threads cookie overrides and aggregates cookie diagnostics across failures, records, and attempt chains", async () => {
    const search = vi.fn(async (_input, options) => {
      expect(options).toMatchObject({
        source: "web",
        useCookies: true,
        cookiePolicyOverride: "required"
      });

      return makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [
          makeRecord({
            id: "cookie-record-object",
            source: "web",
            provider: "web/default",
            url: "https://example.com/cookie-object",
            title: "Cookie Object",
            timestamp: isoHoursAgo(2),
            attributes: {
              transcript_strategy_detail: "detail_strategy",
              browser_fallback_cookie_diagnostics: {
                policy: "required",
                source: "file",
                injected: 1
              },
              attempt_chain: [
                null,
                "bad",
                [],
                {},
                { cookieDiagnostics: null },
                { cookieDiagnostics: [] },
                { cookieDiagnostics: "invalid" },
                { cookieDiagnostics: { policy: "required", verifiedCount: 2 } }
              ]
            }
          }),
          makeRecord({
            id: "cookie-record-string",
            source: "web",
            provider: "web/default",
            url: "https://example.com/cookie-string",
            title: "Cookie String",
            timestamp: isoHoursAgo(1),
            attributes: {
              transcript_strategy: "fallback_strategy",
              browser_fallback_cookie_diagnostics: "invalid-shape",
              attempt_chain: "not-an-array"
            }
          }),
          makeRecord({
            id: "cookie-record-array",
            source: "web",
            provider: "web/default",
            timestamp: isoHoursAgo(3),
            attributes: {
              browser_fallback_cookie_diagnostics: []
            }
          }),
          makeRecord({
            id: "cookie-record-null",
            source: "web",
            provider: "web/default",
            timestamp: isoHoursAgo(4),
            attributes: {
              browser_fallback_cookie_diagnostics: null
            }
          })
        ],
        failures: [
          makeFailure("web/default", "web", {
            code: "unavailable",
            message: "auth required",
            reasonCode: "auth_required",
            details: {
              cookieDiagnostics: {
                policy: "required",
                source: "env",
                available: false
              }
            }
          }),
          makeFailure("web/default", "web", {
            code: "internal",
            message: "opaque provider failure with object diagnostics",
            details: {
              cookieDiagnostics: {
                policy: "auto",
                source: "inline"
              }
            }
          }),
          makeFailure("web/default", "web", {
            code: "internal",
            message: "opaque provider failure",
            details: {
              cookieDiagnostics: "bad-shape"
            }
          }),
          makeFailure("web/default", "web", {
            code: "unavailable",
            message: "array diagnostics",
            details: {
              cookieDiagnostics: []
            }
          }),
          makeFailure("web/default", "web", {
            code: "unavailable",
            message: "null diagnostics",
            details: {
              cookieDiagnostics: null
            }
          })
        ]
      });
    });

    const output = await runResearchWorkflow(toRuntime({ search }), {
      topic: "cookie diagnostics",
      sourceSelection: "web",
      days: 1,
      mode: "json",
      useCookies: true,
      cookiePolicyOverride: "required"
    });

    const metrics = (output.meta as {
      metrics: {
        cookie_diagnostics: Array<Record<string, unknown>>;
        cookieDiagnostics: Array<Record<string, unknown>>;
        transcript_strategy_detail_distribution: Record<string, number>;
        transcriptStrategyDetailDistribution: Record<string, number>;
        transcript_durability: {
          attempted: number;
          successful: number;
          failed: number;
          success_rate: number;
        };
      };
    }).metrics;

    expect(metrics.cookie_diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "web/default",
        source: "env",
        reasonCode: "auth_required",
        policy: "required"
      }),
      expect.objectContaining({
        provider: "web/default",
        source: "file",
        policy: "required",
        injected: 1
      }),
      expect.objectContaining({
        provider: "web/default",
        source: "web",
        policy: "required",
        verifiedCount: 2
      })
    ]));
    expect(metrics.cookieDiagnostics).toEqual(metrics.cookie_diagnostics);
    expect(metrics.transcript_strategy_detail_distribution).toEqual({
      detail_strategy: 1,
      fallback_strategy: 1
    });
    expect(metrics.transcriptStrategyDetailDistribution).toEqual(metrics.transcript_strategy_detail_distribution);
    expect(metrics.transcript_durability).toMatchObject({
      successful: 1
    });
  });

  it("ranks records correctly when an outside-timebox item is compared first", () => {
    const records: ResearchRecord[] = [
      {
        id: "outside-first",
        source: "web",
        provider: "web/default",
        timestamp: "invalid-date",
        confidence: 0.7,
        engagement: { likes: 0, comments: 0, views: 0, upvotes: 0 },
        recency: { within_timebox: false, age_hours: Number.POSITIVE_INFINITY },
        date_confidence: { score: 0, source: "missing" },
        attributes: {}
      },
      {
        id: "inside-second",
        source: "web",
        provider: "web/default",
        timestamp: isoHoursAgo(1),
        confidence: 0.6,
        engagement: { likes: 0, comments: 0, views: 0, upvotes: 0 },
        recency: { within_timebox: true, age_hours: 1 },
        date_confidence: { score: 1, source: "explicit" },
        attributes: {}
      }
    ];

    const ranked = workflowTestUtils.rankResearchRecords(records);
    expect(ranked.map((record) => record.id)).toEqual(["inside-second", "outside-first"]);
  });

  it("covers source resolution defaults and research ranking tie-break branches", async () => {
    const rankingRuntime = toRuntime({
      search: async (_input, options) => {
        const source = options?.source ?? "web";
        if (source !== "web") {
          return makeAggregate({
            sourceSelection: source as ProviderSource,
            providerOrder: [`${source}/default`],
            records: []
          });
        }
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [
            makeRecord({
              id: "within-younger",
              source: "web",
              provider: "web/default",
              url: "https://example.com/rank-1",
              title: "Rank 1",
              timestamp: isoHoursAgo(1),
              confidence: 0.7
            }),
            makeRecord({
              id: "within-confidence-high",
              source: "web",
              provider: "web/default",
              url: "https://example.com/rank-2",
              title: "Rank 2",
              timestamp: isoHoursAgo(2),
              confidence: 0.9
            }),
            makeRecord({
              id: "within-confidence-low-a",
              source: "web",
              provider: "web/default",
              url: "https://example.com/rank-3",
              title: "Rank 3",
              timestamp: isoHoursAgo(2),
              confidence: 0.4
            }),
            makeRecord({
              id: "within-confidence-low-b",
              source: "web",
              provider: "web/default",
              url: "https://example.com/rank-4",
              title: "Rank 4",
              timestamp: isoHoursAgo(2),
              confidence: 0.4
            }),
            makeRecord({
              id: "blank-key-low",
              source: "web",
              provider: "web/default",
              url: undefined,
              title: undefined,
              timestamp: isoHoursAgo(3),
              confidence: 0.2
            }),
            makeRecord({
              id: "blank-key-high",
              source: "web",
              provider: "web/default",
              url: undefined,
              title: undefined,
              timestamp: isoHoursAgo(2),
              confidence: 0.95
            }),
            makeRecord({
              id: "blank-key-lower-2",
              source: "web",
              provider: "web/default",
              url: undefined,
              title: undefined,
              timestamp: isoHoursAgo(6),
              confidence: 0.1
            }),
            makeRecord({
              id: "date-inferred",
              source: "web",
              provider: "web/default",
              url: undefined,
              title: undefined,
              timestamp: "invalid",
              confidence: 0.8,
              attributes: {
                published_at: isoHoursAgo(3)
              }
            }),
            makeRecord({
              id: "date-missing",
              source: "web",
              provider: "web/default",
              url: undefined,
              title: undefined,
              timestamp: "invalid",
              confidence: 0.8
            })
          ]
        });
      }
    });

    const fromAll = await runResearchWorkflow(rankingRuntime, {
      topic: "ranking",
      sourceSelection: "all",
      from: isoHoursAgo(48),
      to: isoHoursAhead(1),
      mode: "json"
    });
    const allMeta = fromAll.meta as { selection: { resolved_sources: string[] } };
    expect(allMeta.selection.resolved_sources).toEqual(["web", "community", "social", "shopping"]);

    const explicitSourcesNoSelection = await runResearchWorkflow(rankingRuntime, {
      topic: "ranking",
      sources: ["web", "web", "community"],
      from: isoHoursAgo(48),
      to: isoHoursAhead(1),
      mode: "json"
    });
    const explicitMeta = explicitSourcesNoSelection.meta as { selection: { source_selection: string; resolved_sources: string[] } };
    expect(explicitMeta.selection).toEqual({
      source_selection: "auto",
      resolved_sources: ["web", "community"]
    });

    const ids = (explicitSourcesNoSelection.records as Array<{ id: string }>).map((record) => record.id);
    expect(ids.indexOf("within-younger")).toBeLessThan(ids.indexOf("within-confidence-high"));
    expect(ids.indexOf("within-confidence-high")).toBeLessThan(ids.indexOf("within-confidence-low-a"));
    expect(ids.indexOf("within-confidence-low-a")).toBeLessThan(ids.indexOf("within-confidence-low-b"));
  });

  it("covers shopping provider normalization, all sort modes, and path output", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/others";

        if (providerId === "shopping/walmart") {
          return makeAggregate({
            ok: false,
            sourceSelection: "shopping",
            providerOrder: [providerId],
            failures: [makeFailure(providerId, "shopping", {
              code: "rate_limited",
              message: "anti-bot challenge",
              retryable: true
            })],
            metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
          });
        }

        const offerData = providerId === "shopping/amazon"
          ? { price: 30, shipping: 5, rating: 4.4, reviews: 30 }
          : { price: 15, shipping: 0, rating: 3.8, reviews: 4 };

        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [makeRecord({
            id: `offer-${providerId}`,
            source: "shopping",
            provider: providerId,
            url: `https://shop.example/${providerId}`,
            title: `Offer ${providerId}`,
            content: providerId === "shopping/amazon" ? "$30.00 ships" : "£15.00 limited",
            attributes: {
              shopping_offer: {
                provider: providerId,
                product_id: `${providerId}-product`,
                title: `Offer ${providerId}`,
                url: `https://shop.example/${providerId}`,
                price: {
                  amount: offerData.price,
                  currency: "USD",
                  retrieved_at: isoHoursAgo(1)
                },
                shipping: {
                  amount: offerData.shipping,
                  currency: "USD",
                  notes: "std"
                },
                availability: providerId === "shopping/amazon" ? "in_stock" : "limited",
                rating: offerData.rating,
                reviews_count: offerData.reviews
              }
            }
          })]
        });
      }
    });

    const baseInput = {
      query: "usb hub",
      providers: ["amazon", "shopping/others", "shopping/amazon", "walmart"]
    } as const;

    const lowest = await runShoppingWorkflow(runtime, {
      ...baseInput,
      sort: "lowest_price",
      mode: "json"
    });
    expect((lowest.offers as Array<{ provider: string }>)[0]?.provider).toBe("shopping/others");

    const highest = await runShoppingWorkflow(runtime, {
      ...baseInput,
      sort: "highest_rating",
      mode: "json"
    });
    expect((highest.offers as Array<{ provider: string }>)[0]?.provider).toBe("shopping/amazon");

    const fastest = await runShoppingWorkflow(runtime, {
      ...baseInput,
      sort: "fastest_shipping",
      mode: "json"
    });
    expect((fastest.offers as Array<{ provider: string }>)[0]?.provider).toBe("shopping/others");

    const bestDealPath = await runShoppingWorkflow(runtime, {
      ...baseInput,
      mode: "path"
    });
    expect(bestDealPath).toMatchObject({ mode: "path", path: expect.any(String) });

    await expect(runShoppingWorkflow(runtime, {
      query: "   ",
      mode: "json"
    })).rejects.toThrow("query is required");

    await expect(runShoppingWorkflow(runtime, {
      query: "usb hub",
      providers: ["unknown-provider"],
      mode: "json"
    })).rejects.toThrow("No valid shopping providers were requested");
  });

  it("applies shopping budget/region filters and tie-break sort branches", async () => {
    const search = vi.fn(async (input, options) => {
      const providerId = options?.providerIds?.[0] ?? "shopping/others";
      const shared = {
        sourceSelection: "shopping" as const,
        providerOrder: [providerId]
      };

      if (providerId === "shopping/amazon") {
        return makeAggregate({
          ...shared,
          records: [makeRecord({
            id: "tie-amazon",
            source: "shopping",
            provider: providerId,
            url: "https://shop.example/amazon-tie",
            title: "Tie Amazon",
            content: "$20.00",
            attributes: {
              shopping_offer: {
                provider: providerId,
                product_id: "tie-product",
                title: "Tie Product",
                url: "https://shop.example/tie-amazon",
                price: { amount: 20, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 3, currency: "USD", notes: "std" },
                availability: "unknown",
                rating: 4.5,
                reviews_count: 10
              }
            }
          })]
        });
      }

      return makeAggregate({
        ...shared,
        records: [makeRecord({
          id: "tie-others",
          source: "shopping",
          provider: providerId,
          url: "https://shop.example/others-tie",
          title: "Tie Others",
          content: "$10.00",
          attributes: {
              shopping_offer: {
                provider: providerId,
                product_id: "tie-product",
                title: "Tie Product",
                url: "https://shop.example/tie-others",
                price: { amount: 10, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 3, currency: "USD", notes: "std" },
                availability: "in_stock",
                rating: 4.5,
                reviews_count: 50
              }
            }
        })]
      });
    });

    const runtime = toRuntime({ search });
    const highest = await runShoppingWorkflow(runtime, {
      query: "tie-break",
      providers: ["shopping/amazon", "shopping/others"],
      budget: 100,
      region: "us",
      sort: "highest_rating",
      mode: "json"
    });
    expect((highest.offers as Array<{ provider: string }>)[0]?.provider).toBe("shopping/others");
    expect(search.mock.calls[0]?.[0]).toMatchObject({
      filters: { budget: 100, region: "us" }
    });

    const fastest = await runShoppingWorkflow(runtime, {
      query: "tie-break",
      providers: ["shopping/amazon", "shopping/others"],
      sort: "fastest_shipping",
      mode: "json"
    });
    expect((fastest.offers as Array<{ provider: string }>)[0]?.provider).toBe("shopping/others");
  });

  it("covers shopping offer extraction fallbacks and availability mapping branches", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/others";
        if (providerId === "shopping/amazon") {
          return makeAggregate({
            sourceSelection: "shopping",
            providerOrder: [providerId],
            records: [makeRecord({
              id: "offer-fallback-amazon",
              source: "shopping",
              provider: providerId,
              url: "https://amazon.com/item/1",
              title: "Fallback Amazon",
              content: "£99.50 only 2 left 4.2 out of 5 1,500 reviews",
              attributes: {
                shopping_offer: {
                  provider: providerId,
                  product_id: "",
                  title: "",
                  url: "",
                  price: {
                    amount: "99.50",
                    currency: "",
                    retrieved_at: ""
                  },
                  shipping: {
                    amount: "5",
                    currency: "",
                    notes: 42
                  },
                  availability: "limited",
                  rating: "4.2",
                  reviews_count: "1,500"
                }
              }
            })]
          });
        }

        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [makeRecord({
              id: "offer-out-of-stock",
              source: "shopping",
              provider: providerId,
              url: "https://others.example/out",
              title: "Out Offer",
              content: "sold out",
              attributes: {
                shopping_offer: {
                  provider: providerId,
                  product_id: "explicit-product-id",
                  title: "Out Offer",
                  url: "https://others.example/out",
                  price: {
                    amount: 0,
                    currency: "USD",
                    retrieved_at: new Date().toISOString()
                  },
                  shipping: {
                    amount: 0,
                    currency: "USD",
                    notes: "none"
                  },
                  availability: "out_of_stock",
                  rating: 0,
                  reviews_count: 0
                }
              }
            }),
            makeRecord({
              id: "offer-unknown",
              source: "shopping",
              provider: providerId,
              url: "https://others.example/unknown",
              title: "Unknown Offer",
              content: "no price listed",
              attributes: {}
            })
          ]
        });
      }
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "branch extraction",
      providers: ["shopping/amazon", "shopping/others"],
      sort: "best_deal",
      mode: "json"
    });

    const offers = output.offers as Array<{
      provider: string;
      title: string;
      availability: string;
      price: { amount: number; currency: string };
      shipping: { amount: number; currency: string; notes: string };
      product_id: string;
      reviews_count: number;
    }>;

    expect(offers.some((offer) => offer.availability === "limited")).toBe(true);
    expect(offers.some((offer) => offer.availability === "out_of_stock")).toBe(true);
    expect(offers.some((offer) => offer.availability === "unknown")).toBe(true);
    const limitedOffer = offers.find((offer) => offer.provider === "shopping/amazon");
    expect(limitedOffer?.price.currency).toBe("GBP");
    expect(limitedOffer?.shipping.currency).toBe("GBP");
    expect(limitedOffer?.shipping.notes).toBe("unknown");
    expect(limitedOffer?.reviews_count).toBe(1500);
  });

  it("covers numeric and fallback parsing branches for shopping offer extraction", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/others"],
        records: [makeRecord({
          id: "fallback-and-overflow",
          source: "shopping",
          provider: "shopping/others",
          title: undefined,
          url: undefined,
          content: "Fallback text includes €1,299.00 and details",
          attributes: {
            shopping_offer: {
              provider: "shopping/others",
              product_id: "",
              title: "",
              url: "",
              price: {
                amount: "9e9999",
                currency: "",
                retrieved_at: ""
              },
              shipping: {
                amount: "9e9999",
                currency: "",
                notes: "std"
              },
              availability: "unknown",
              rating: "9e9999",
              reviews_count: "9e9999"
            }
          }
        })]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "fallback-overflow",
      providers: ["shopping/others"],
      sort: "best_deal",
      mode: "json"
    });

    const offer = (output.offers as Array<{
      title: string;
      url: string;
      price: { amount: number; currency: string };
      shipping: { amount: number; currency: string };
      rating: number;
      reviews_count: number;
    }>)[0];

    expect(offer?.title).toBe("shopping/others");
    expect(offer?.url).toBe("");
    expect(offer?.price).toMatchObject({ amount: 1299, currency: "EUR" });
    expect(offer?.shipping).toMatchObject({ amount: 0, currency: "EUR" });
    expect(offer?.rating).toBe(0);
    expect(offer?.reviews_count).toBe(0);
  });

  it("aggregates transcript strategy failures while ignoring malformed attempt-chain entries", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "web",
        providerOrder: ["web/default"],
        failures: [
          makeFailure("web/default", "web", {
            code: "internal",
            message: "opaque provider failure"
          }),
          makeFailure("web/default", "web", {
            code: "unavailable",
            message: "captions missing",
            details: {
              attemptChain: "not-an-array"
            }
          }),
          makeFailure("web/default", "web", {
            code: "unavailable",
            message: "transcript unavailable",
            details: {
              attemptChain: [
                null,
                "bad",
                [],
                {},
                { strategy: 1, reasonCode: "caption_missing" },
                { strategy: "native_caption_parse", reasonCode: 7 },
                { strategy: "native_caption_parse", reasonCode: "caption_missing" },
                { strategy: "native_caption_parse", reasonCode: "caption_missing" }
              ]
            }
          })
        ],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "attempt-chain-summary",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });

    const metrics = (output.meta as {
      metrics: {
        reason_code_distribution: Record<string, number>;
        reasonCodeDistribution: Record<string, number>;
        transcript_strategy_failures: Record<string, number>;
        transcriptStrategyFailures: Record<string, number>;
        transcript_strategy_detail_failures: Record<string, number>;
        transcriptStrategyDetailFailures: Record<string, number>;
        transcript_strategy_detail_distribution: Record<string, number>;
        transcriptStrategyDetailDistribution: Record<string, number>;
        transcript_durability: {
          attempted: number;
          successful: number;
          failed: number;
          success_rate: number;
        };
        transcriptDurability: {
          attempted: number;
          successful: number;
          failed: number;
          success_rate: number;
        };
        anti_bot_pressure: {
          total_failures: number;
          anti_bot_failures: number;
          anti_bot_failure_ratio: number;
        };
        antiBotPressure: {
          total_failures: number;
          anti_bot_failures: number;
          anti_bot_failure_ratio: number;
        };
      };
    }).metrics;

    expect(metrics.reason_code_distribution).toMatchObject({
      caption_missing: 1,
      transcript_unavailable: 1
    });
    expect(metrics.reasonCodeDistribution).toEqual(metrics.reason_code_distribution);
    expect(metrics.reason_code_distribution.internal).toBeUndefined();
    expect(metrics.transcript_strategy_failures).toEqual({
      "native_caption_parse:caption_missing": 2
    });
    expect(metrics.transcriptStrategyFailures).toEqual(metrics.transcript_strategy_failures);
    expect(metrics.transcript_strategy_detail_failures).toEqual(metrics.transcript_strategy_failures);
    expect(metrics.transcriptStrategyDetailFailures).toEqual(metrics.transcript_strategy_detail_failures);
    expect(metrics.transcript_strategy_detail_distribution).toEqual({});
    expect(metrics.transcriptStrategyDetailDistribution).toEqual(metrics.transcript_strategy_detail_distribution);
    expect(metrics.transcript_durability).toEqual({
      attempted: 2,
      successful: 0,
      failed: 2,
      success_rate: 0
    });
    expect(metrics.transcriptDurability).toEqual(metrics.transcript_durability);
    expect(metrics.anti_bot_pressure).toEqual({
      total_failures: 3,
      anti_bot_failures: 0,
      anti_bot_failure_ratio: 0
    });
    expect(metrics.antiBotPressure).toEqual(metrics.anti_bot_pressure);
  });

  it("tracks caption-missing failures as transcript_unavailable alerts", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "social",
        providerOrder: ["social/youtube"],
        failures: [makeFailure("social/youtube", "social", {
          code: "unavailable",
          message: "captions missing",
          reasonCode: "caption_missing"
        })],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "caption-alert",
      sourceSelection: "social",
      days: 1,
      mode: "json"
    });

    const alerts = (output.meta as {
      alerts: Array<{ signal: string; reasonCode: string }>;
    }).alerts;
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        signal: "transcript_unavailable",
        reasonCode: "transcript_unavailable"
      })
    ]));
  });

  it("sorts multiple auto-excluded providers across social and shopping sources", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const source = (options?.source ?? "web") as ProviderSource;
        if (source === "social") {
          return makeAggregate({
            ok: false,
            sourceSelection: "social",
            providerOrder: ["social/youtube"],
            failures: [makeFailure("social/youtube", "social", {
              code: "rate_limited",
              message: "rate limited",
              retryable: true
            })],
            metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
          });
        }
        if (source === "shopping") {
          const providerId = options?.providerIds?.[0] ?? "shopping/walmart";
          return makeAggregate({
            ok: false,
            sourceSelection: "shopping",
            providerOrder: [providerId],
            failures: [makeFailure(providerId, "shopping", {
              code: "rate_limited",
              message: "rate limited",
              retryable: true
            })],
            metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
          });
        }
        return makeAggregate({
          sourceSelection: source,
          providerOrder: [`${source}/default`],
          records: [makeRecord({ source, provider: `${source}/default`, id: `${source}-ok` })]
        });
      }
    });

    await runResearchWorkflow(runtime, {
      topic: "seed-social-degraded-1",
      sourceSelection: "social",
      days: 1,
      mode: "json"
    });
    await runResearchWorkflow(runtime, {
      topic: "seed-social-degraded-2",
      sourceSelection: "social",
      days: 1,
      mode: "json"
    });
    await runShoppingWorkflow(runtime, {
      query: "seed-shopping-degraded-1",
      providers: ["shopping/walmart"],
      mode: "json"
    });
    await runShoppingWorkflow(runtime, {
      query: "seed-shopping-degraded-2",
      providers: ["shopping/walmart"],
      mode: "json"
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "excluded-provider-sort",
      sourceSelection: "auto",
      sources: ["shopping", "social"],
      days: 1,
      mode: "json"
    });

    const selection = (output.meta as {
      selection: { excluded_providers?: string[] };
    }).selection;
    expect(selection.excluded_providers).toEqual([
      "shopping/walmart",
      "social/youtube"
    ]);
  });

  it("normalizes product-video provider hints for shopping-domain URLs", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "amazon-product",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/example",
          title: "Amazon Product",
          content: "$19.99",
          attributes: {
            links: [],
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "amazon-product",
              title: "Amazon Product",
              url: "https://www.amazon.com/dp/example",
              price: { amount: 19.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.5,
              reviews_count: 25
            }
          }
        })]
      })
    });

    const normalizedHint = await runProductVideoWorkflow(runtime, {
      product_url: "https://www.amazon.com/dp/example",
      provider_hint: "amazon",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });
    expect((normalizedHint.product as { provider: string }).provider).toBe("amazon");

    const prefixedHint = await runProductVideoWorkflow(runtime, {
      product_url: "https://www.amazon.com/dp/example",
      provider_hint: "shopping/amazon",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });
    expect((prefixedHint.product as { provider: string }).provider).toBe("shopping/amazon");
  });

  it("pins product-video fetch to a normalized shopping provider id for shopping-domain URLs", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "amazon-pinned-provider",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/example",
        title: "Amazon Product",
        content: "$29.99",
        attributes: {
          links: [],
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "amazon-pinned-provider",
            title: "Amazon Product",
            url: "https://www.amazon.com/dp/example",
            price: { amount: 29.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.6,
            reviews_count: 31
          }
        }
      })]
    }));

    await runProductVideoWorkflow(toRuntime({ fetch }), {
      product_url: "https://www.amazon.com/dp/example",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect(fetch).toHaveBeenNthCalledWith(1, { url: "https://www.amazon.com/dp/example" }, {
      source: "shopping",
      providerIds: ["shopping/amazon"]
    });

    await runProductVideoWorkflow(toRuntime({ fetch }), {
      product_url: "https://www.amazon.com/dp/example",
      provider_hint: "amazon",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect(fetch).toHaveBeenNthCalledWith(2, { url: "https://www.amazon.com/dp/example" }, {
      source: "shopping",
      providerIds: ["shopping/amazon"]
    });
  });

  it("falls back to zero when transcript price parsing becomes non-finite", async () => {
    const hugePriceLiteral = `$${Array.from({ length: 180 }, () => "999").join(",")}`;
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/others"],
        records: [makeRecord({
          id: "overflow-price",
          source: "shopping",
          provider: "shopping/others",
          title: "Overflow Price",
          url: "https://shop.example/overflow",
          content: `${hugePriceLiteral} unbelievable deal`,
          attributes: {
            shopping_offer: {
              provider: "shopping/others",
              product_id: "",
              title: "",
              url: "",
              price: { amount: "", currency: "", retrieved_at: "" },
              shipping: { amount: 0, currency: "", notes: "std" },
              availability: "unknown",
              rating: 1,
              reviews_count: 1
            }
          }
        })]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "overflow price",
      providers: ["shopping/others"],
      mode: "json"
    });
    const offer = (output.offers as Array<{ price: { amount: number; currency: string } }>)[0];
    expect(offer?.price).toMatchObject({
      amount: 0,
      currency: "USD"
    });
  });

  it("validates product-video prerequisites and unresolved name flows", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({ sourceSelection: "shopping", providerOrder: ["shopping/amazon"] })
    });

    await expect(runProductVideoWorkflow(runtime, {})).rejects.toThrow("product_url or product_name is required");

    await expect(runProductVideoWorkflow(runtime, {
      product_name: "sample"
    })).rejects.toThrow("Unable to resolve product URL from product_name");

    const missingUrlRuntime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "offer-without-url",
          source: "shopping",
          provider: "shopping/amazon",
          url: "",
          title: "No URL Offer",
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "p-no-url",
              title: "No URL Offer",
              url: "",
              price: { amount: 9.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "std" },
              availability: "in_stock",
              rating: 3,
              reviews_count: 1
            }
          }
        })]
      })
    });

    await expect(runProductVideoWorkflow(missingUrlRuntime, {
      product_name: "missing-url"
    })).rejects.toThrow("Unable to resolve product URL");
  });

  it("builds product assets with image/screenshot fallback and web-source resolution", async () => {
    const fetch = vi.fn(async (_input, options) => {
      expect(options?.source).toBe("web");
      return makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "product-1",
          source: "web",
          provider: "web/default",
          url: "not-a-url",
          title: "Fallback Product",
          content: "Feature alpha with good detail. Feature beta with enough text for extraction.",
          attributes: {
            links: [
              "https://cdn.example.com/a.jpg",
              "https://cdn.example.com/b.webp"
            ],
            brand: "Acme",
            shopping_offer: {
              provider: "shopping/others",
              product_id: "p1",
              title: "Fallback Product",
              url: "not-a-url",
              price: { amount: 22.5, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "std" },
              availability: "in_stock",
              rating: 4.1,
              reviews_count: 8
            }
          }
        })]
      });
    });

    let fetchCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
        };
      }
      throw new Error("image fetch failure");
    }) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(toRuntime({ fetch }), {
      product_url: "not-a-url",
      include_screenshots: true,
      include_all_images: false,
      include_copy: false
    }, {
      captureScreenshot: async () => null
    });

    expect(output.path).toEqual(expect.any(String));
    expect(output.images).toEqual(["images/image-01.jpg"]);
    expect(output.screenshots).toEqual(["screenshots/screenshot-01.png"]);
    expect((output.product as { copy: string }).copy).toBe("");
    expect((output.product as { provider: string }).provider).toBe("web/default");
  });

  it("handles non-ok image fetches and empty product content safely", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/others"],
        records: [makeRecord({
          id: "product-empty-content",
          source: "shopping",
          provider: "shopping/others",
          url: "https://shop.example/item",
          title: "No Content Item",
          content: undefined,
          attributes: {
            links: "https://cdn.example.com/unavailable.jpg",
            shopping_offer: {
              provider: "shopping/others",
              product_id: "p-empty",
              title: "No Content Item",
              url: "https://shop.example/item",
              price: { amount: 12, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 1, currency: "USD", notes: "unknown" },
              availability: "unknown",
              rating: 0,
              reviews_count: 0
            }
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      arrayBuffer: async () => new Uint8Array().buffer
    })) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://shop.example/item",
      include_screenshots: true,
      include_all_images: true,
      include_copy: true
    });

    expect(output.images).toEqual([]);
    expect(output.screenshots).toEqual([]);
    expect((output.product as { brand: string }).brand).toBe("unknown");
    expect((output.product as { features: string[] }).features).toEqual([]);
  });

  it("routes known shopping domains through shopping source and applies image extension fallback", async () => {
    const fetch = vi.fn(async (_input, options) => {
      expect(options?.source).toBe("shopping");
      return makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "amazon-product",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/example",
          title: "Amazon Item",
          content: "Feature one with enough details to become a bullet point.",
          attributes: {
            links: ["https://cdn.example.com/no-extension.jpg"],
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "p-amz",
              title: "Amazon Item",
              url: "https://www.amazon.com/dp/example",
              price: { amount: 49, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.5,
              reviews_count: 99
            }
          }
        })]
      });
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer
    })) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(toRuntime({ fetch }), {
      product_url: "https://www.amazon.com/dp/example",
      include_screenshots: false,
      include_all_images: true,
      include_copy: true
    });

    expect(output.images).toEqual(["images/image-01.jpg"]);
    expect(output.screenshots).toEqual([]);
  });

  it("handles mixed image fetch success/failure and extension fallback in product assets", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/others"],
        records: [makeRecord({
          id: "product-image-mix",
          source: "shopping",
          provider: "shopping/others",
          url: "https://shop.example/item-mix",
          title: undefined,
          content: "Feature one is sufficiently descriptive. Feature two is also detailed enough.",
          attributes: {
            links: [
              "https://cdn.example.com/first.jpg",
              "https://cdn.example.com/second.webp"
            ],
            shopping_offer: {
              provider: "shopping/others",
              product_id: "p-mix",
              title: "Offer fallback title",
              url: "https://shop.example/item-mix",
              price: { amount: 25, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 1, currency: "USD", notes: "std" },
              availability: "in_stock",
              rating: 4,
              reviews_count: 2
            }
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("first.jpg")) {
        return {
          ok: true,
          arrayBuffer: async () => new Uint8Array([7, 7, 7]).buffer
        };
      }
      return {
        ok: false,
        arrayBuffer: async () => new Uint8Array([1]).buffer
      };
    }) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://shop.example/item-mix",
      include_screenshots: false,
      include_all_images: true,
      include_copy: true
    });

    expect(output.images).toEqual(["images/image-01.jpg"]);
    expect((output.product as { title: string }).title).toBe("Offer fallback title");
    expect(output.screenshots).toEqual([]);
  });

  it("surfaces product detail fetch failures", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        ok: false,
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        error: {
          code: "unavailable",
          message: "Product details unavailable upstream",
          retryable: false
        },
        failures: [makeFailure("shopping/amazon", "shopping", {
          code: "unavailable",
          message: "blocked",
          retryable: false
        })],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    await expect(runProductVideoWorkflow(runtime, {
      product_url: "https://shop.example/item"
    })).rejects.toThrow("Product details unavailable upstream");

    const emptyRuntime = toRuntime({
      fetch: async () => makeAggregate({
        ok: true,
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: []
      })
    });

    await expect(runProductVideoWorkflow(emptyRuntime, {
      product_url: "https://shop.example/item"
    })).rejects.toThrow("Product details unavailable");
  });
});
