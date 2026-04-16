import { afterEach, describe, expect, it, vi } from "vitest";
import {
  workflowTestUtils,
  runProductVideoWorkflow,
  runResearchWorkflow,
  runShoppingWorkflow,
  type ProviderExecutor
} from "../src/providers/workflows";
import { buildWorkflowResumeEnvelope } from "../src/providers/workflow-contracts";
import type { ResearchRecord } from "../src/providers/enrichment";
import { SHOPPING_PROVIDER_IDS, SHOPPING_PROVIDER_PROFILES } from "../src/providers/shopping";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderError,
  ProviderFailureEntry,
  ProviderSource
} from "../src/providers/types";

type WorkflowKind = "research" | "shopping" | "product_video" | "inspiredesign";

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
  getAntiBotSnapshots?: ProviderExecutor["getAntiBotSnapshots"];
}): ProviderExecutor => ({
  search: handlers.search ?? (async () => makeAggregate()),
  fetch: handlers.fetch ?? (async () => makeAggregate()),
  ...(handlers.getAntiBotSnapshots ? { getAntiBotSnapshots: handlers.getAntiBotSnapshots } : {})
});

const expectBudgetedTimeout = (value: unknown, requestedTimeoutMs: number): void => {
  expect(typeof value).toBe("number");
  if (typeof value !== "number") {
    return;
  }
  expect(value).toBeGreaterThan(0);
  expect(value).toBeLessThanOrEqual(requestedTimeoutMs);
};

const WALMART_PREOWNED_AIRPODS_URL = "https://www.walmart.com/ip/Pre-Owned-Apple-AirPods-Pro-2nd-Generation-Lightning/19336719172?classType=REGULAR&conditionGroupCode=3&from=%2Fsearch";
const WALMART_NEW_AIRPODS_URL = "https://www.walmart.com/ip/Apple-AirPods-Pro-2nd-Generation-with-MagSafe-Case-USB-C/5689912134?classType=REGULAR&from=%2Fsearch";

const makeWalmartPreownedAirpodsRecord = (): NormalizedRecord => makeRecord({
  id: "walmart-preowned-airpods",
  source: "shopping",
  provider: "shopping/walmart",
  url: WALMART_PREOWNED_AIRPODS_URL,
  title: "Pre-Owned Apple AirPods Pro (2nd Generation) - Lightning - Walmart.com Skip to Main Content Pickup or delivery? Cancel …",
  content: [
    "Pre-Owned Apple AirPods Pro (2nd Generation) - Lightning",
    "Key item features",
    "‌Richer audio experience Apple-designed H2 chip, the new force behind AirPods Pro, pushes advanced audio performance even further.",
    "Brand Apple Color White View full specifications Current price is USD $139.99",
    "Free shipping",
    "Sold and shipped by TheRightOne"
  ].join(" "),
  attributes: {
    brand: "Apple",
    shopping_offer: {
      provider: "shopping/walmart",
      product_id: "shopping/walmart:1:aHR0cHM6",
      title: "Pre-Owned Apple AirPods Pro (2nd Generation) - Lightning - Walmart.com Skip to Main Content Pickup or delivery? Cancel …",
      url: WALMART_PREOWNED_AIRPODS_URL,
      price: { amount: 139.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
      shipping: { amount: 0, currency: "USD", notes: "free" },
      availability: "in_stock",
      rating: 3.8,
      reviews_count: 2158
    }
  }
});

const makeWalmartNewAirpodsRecord = (): NormalizedRecord => makeRecord({
  id: "walmart-new-airpods",
  source: "shopping",
  provider: "shopping/walmart",
  url: WALMART_NEW_AIRPODS_URL,
  title: "Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C) - Walmart.com",
  content: [
    "Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)",
    "Key item features",
    "Adaptive audio and active noise cancellation for focused listening.",
    "Brand Apple View full specifications Current price is USD $189.99",
    "Free shipping",
    "Sold and shipped by Walmart"
  ].join(" "),
  attributes: {
    brand: "Apple",
    shopping_offer: {
      provider: "shopping/walmart",
      product_id: "walmart-new-airpods",
      title: "Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C) - Walmart.com",
      url: WALMART_NEW_AIRPODS_URL,
      price: { amount: 189.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
      shipping: { amount: 0, currency: "USD", notes: "free" },
      availability: "in_stock",
      rating: 4.7,
      reviews_count: 325
    }
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

describe("workflow branch coverage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("keeps non-web research runs inside their declared source scope", async () => {
    const search = vi.fn(async (_input, options) => makeAggregate({
      sourceSelection: "social",
      providerOrder: ["social/youtube"],
      records: [makeRecord({
        id: "social-only-record",
        source: "social",
        provider: "social/youtube",
        url: "https://example.com/social-only",
        title: "Social-only result",
        content: "Operators reported a reliable extension debugging workflow.",
        attributes: {}
      })]
    }));
    const fetch = vi.fn(async () => makeAggregate());

    const output = await runResearchWorkflow(toRuntime({ search, fetch }), {
      topic: "extension debugging sessions",
      sources: ["social"],
      mode: "json",
      limitPerSource: 3
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(output.meta).toMatchObject({
      selection: {
        source_selection: "auto",
        resolved_sources: ["social"]
      }
    });
    expect((output.records as Array<{ source: string }>).map((record) => record.source)).toEqual(["social"]);
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

  it("keeps degraded alerts active during healthy-window cooldown recovery", async () => {
    const provider = "web/recovery-cooldown";
    let callCount = 0;
    const runtime = toRuntime({
      search: async () => {
        callCount += 1;
        if (callCount <= 2) {
          return makeAggregate({
            ok: false,
            sourceSelection: "web",
            providerOrder: [provider],
            failures: [makeFailure(provider, "web", {
              code: "rate_limited",
              message: "rate limited",
              retryable: true
            })],
            metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
          });
        }
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: [provider],
          records: [makeRecord({
            id: "recovered-once",
            source: "web",
            provider
          })]
        });
      }
    });

    await runResearchWorkflow(runtime, {
      topic: "recovery stage one",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });
    await runResearchWorkflow(runtime, {
      topic: "recovery stage two",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });
    const recoveredOnce = await runResearchWorkflow(runtime, {
      topic: "recovery stage three",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });

    const alerts = (recoveredOnce.meta as {
      alerts: Array<{ provider: string; state: string; reason: string }>;
    }).alerts;
    expect(alerts).toContainEqual(expect.objectContaining({
      provider,
      state: "degraded",
      reason: "signal ratio >= 25% for two consecutive windows"
    }));
  });

  it("clears alerts after enough healthy windows following a degraded period", async () => {
    const provider = "web/recovery-waiting";
    let callCount = 0;
    const runtime = toRuntime({
      search: async () => {
        callCount += 1;
        if (callCount <= 2) {
          return makeAggregate({
            ok: false,
            sourceSelection: "web",
            providerOrder: [provider],
            failures: [makeFailure(provider, "web", {
              code: "rate_limited",
              message: "rate limited",
              retryable: true
            })],
            metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
          });
        }
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: [provider],
          records: [makeRecord({
            id: `healthy-${callCount}`,
            source: "web",
            provider
          })]
        });
      }
    });

    await runResearchWorkflow(runtime, {
      topic: "recovery waiting seed one",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });
    await runResearchWorkflow(runtime, {
      topic: "recovery waiting seed two",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });

    let finalOutput: Record<string, unknown> | null = null;
    for (let index = 0; index < 12; index += 1) {
      finalOutput = await runResearchWorkflow(runtime, {
        topic: `recovery waiting healthy ${index}`,
        sourceSelection: "web",
        days: 1,
        mode: "json"
      });
    }

    const alerts = (finalOutput?.meta as {
      alerts: Array<{ provider: string; state: string; reason: string }>;
    }).alerts;
    expect(alerts).toEqual([]);
  });

  it("downgrades degraded alerts to warning once recovery lowers the ratio below the degraded threshold", async () => {
    const provider = "web/recovery-waiting-pending";
    let callCount = 0;
    const runtime = toRuntime({
      search: async () => {
        callCount += 1;
        if (callCount <= 2) {
          return makeAggregate({
            ok: false,
            sourceSelection: "web",
            providerOrder: [provider],
            failures: [makeFailure(provider, "web", {
              code: "rate_limited",
              message: "rate limited",
              retryable: true
            })],
            metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
          });
        }
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: [provider],
          records: [makeRecord({
            id: `healthy-${callCount}`,
            source: "web",
            provider
          })]
        });
      }
    });

    await runResearchWorkflow(runtime, {
      topic: "recovery waiting pending seed one",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });
    await runResearchWorkflow(runtime, {
      topic: "recovery waiting pending seed two",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });

    let recoveryOutput: Record<string, unknown> | null = null;
    for (let index = 0; index < 7; index += 1) {
      recoveryOutput = await runResearchWorkflow(runtime, {
        topic: `recovery waiting pending healthy ${index}`,
        sourceSelection: "web",
        days: 1,
        mode: "json"
      });
    }
    if (!recoveryOutput) {
      throw new Error("expected recovery output");
    }
    const alerts = (recoveryOutput.meta as {
      alerts: Array<{ provider: string; state: string; reason: string }>;
    }).alerts;
    const recoveryAlert = alerts.find((alert) => alert.provider === provider);

    expect(recoveryAlert).toEqual(expect.objectContaining({
      provider,
      state: "warning",
      reason: "signal ratio >= 15%"
    }));
  });

  it("uses runtime snapshots to emit degraded challenge and cooldown alerts", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "web",
        providerOrder: ["web/default"],
        failures: [makeFailure("web/default", "web")],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      }),
      getAntiBotSnapshots: () => [{
        providerId: "web/default",
        activeChallenges: 1,
        recentChallengeRatio: 0.1,
        recentRateLimitRatio: 0.1,
        cooldownUntilMs: Date.now() + 60_000
      }]
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "runtime snapshot alerts",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });

    const alerts = (output.meta as {
      alerts: Array<{ signal: string; state: string; reason: string }>;
    }).alerts;
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        signal: "anti_bot_challenge",
        state: "degraded",
        reason: "preserved challenge session is still active"
      }),
      expect.objectContaining({
        signal: "rate_limited",
        state: "degraded",
        reason: "cooldown active"
      })
    ]));
  });

  it("uses runtime snapshot ratios for warning alerts and dedupes transcript failures", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "social",
        providerOrder: ["social/youtube"],
        failures: [
          makeFailure("social/youtube", "social", {
            code: "unavailable",
            message: "captions unavailable",
            reasonCode: "transcript_unavailable"
          }),
          makeFailure("social/youtube", "social", {
            code: "unavailable",
            message: "captions still unavailable",
            reasonCode: "transcript_unavailable"
          }),
          makeFailure("social/youtube", "social", {
            code: "rate_limited",
            message: "rate limited",
            reasonCode: "rate_limited"
          })
        ],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      }),
      getAntiBotSnapshots: () => [{
        providerId: "social/youtube",
        activeChallenges: 0,
        recentChallengeRatio: 0.2,
        recentRateLimitRatio: 0.2,
        cooldownUntilMs: 0
      }]
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "runtime snapshot warning alerts",
      sourceSelection: "social",
      days: 1,
      mode: "json"
    });

    const alerts = (output.meta as {
      alerts: Array<{ provider: string; signal: string; state: string; reason: string }>;
    }).alerts;
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "social/youtube",
        signal: "anti_bot_challenge",
        state: "warning",
        reason: "signal ratio >= 15%"
      }),
      expect.objectContaining({
        provider: "social/youtube",
        signal: "rate_limited",
        state: "warning",
        reason: "signal ratio >= 15%"
      }),
      expect.objectContaining({
        provider: "social/youtube",
        signal: "transcript_unavailable",
        state: "warning"
      })
    ]));
    expect(alerts.filter((alert) => alert.signal === "transcript_unavailable")).toHaveLength(1);
  });

  it("uses runtime snapshot ratios to emit degraded alerts without preserved sessions or cooldowns", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "social",
        providerOrder: ["social/x"],
        failures: [makeFailure("social/x", "social", {
          code: "rate_limited",
          message: "rate limited",
          reasonCode: "rate_limited"
        })],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      }),
      getAntiBotSnapshots: () => [{
        providerId: "social/x",
        activeChallenges: 0,
        recentChallengeRatio: 0.3,
        recentRateLimitRatio: 0.3,
        cooldownUntilMs: 0
      }]
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "runtime snapshot degraded ratio alerts",
      sourceSelection: "social",
      days: 1,
      mode: "json"
    });

    const alerts = (output.meta as {
      alerts: Array<{ provider: string; signal: string; state: string; reason: string }>;
    }).alerts;
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "social/x",
        signal: "anti_bot_challenge",
        state: "degraded",
        reason: "signal ratio >= 25%"
      }),
      expect.objectContaining({
        provider: "social/x",
        signal: "rate_limited",
        state: "degraded",
        reason: "signal ratio >= 25%"
      })
    ]));
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

  it("excludes runtime-degraded shopping providers from default routing", async () => {
    const calledProviders: string[][] = [];
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerIds = [...(options?.providerIds ?? [])];
        calledProviders.push(providerIds);
        const providerId = providerIds[0] ?? "shopping/others";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: providerIds,
          records: [makeRecord({
            id: `runtime-${providerId}`,
            source: "shopping",
            provider: providerId,
            url: `https://shop.example/${providerId}`,
            title: `Offer ${providerId}`,
            content: "$10.00",
            attributes: {
              shopping_offer: {
                provider: providerId,
                product_id: `${providerId}-product`,
                title: `Offer ${providerId}`,
                url: `https://shop.example/${providerId}`,
                price: { amount: 10, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4.5,
                reviews_count: 3
              }
            }
          })]
        });
      },
      getAntiBotSnapshots: (providerIds) => (providerIds ?? SHOPPING_PROVIDER_IDS).map((providerId) => ({
        providerId,
        activeChallenges: providerId === "shopping/amazon" ? 1 : 0,
        recentChallengeRatio: providerId === "shopping/amazon" ? 1 : 0,
        recentRateLimitRatio: 0,
        cooldownUntilMs: 0
      }))
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "runtime-degraded-routing",
      mode: "json"
    });

    expect(calledProviders[0]).toBeDefined();
    expect(calledProviders[0]).not.toContain("shopping/amazon");
    expect((output.meta as {
      selection: { excluded_providers?: string[] };
    }).selection.excluded_providers).toContain("shopping/amazon");
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

  it("covers pure nextSignalState recovery helper branches outside end-to-end tracked-window alert emission", () => {
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

  it("covers workflow helper branches for resume payload wrapping, brand parsing, and http url validation", () => {
    const rawPayload = workflowTestUtils.buildWorkflowResumePayload("workflow.research", {
      topic: "browser automation"
    } as JsonValue);
    expect(rawPayload.workflow).toMatchObject({
      kind: "research",
      input: { topic: "browser automation" }
    });

    const existingEnvelope = buildWorkflowResumeEnvelope("shopping", {
      query: "portable monitor"
    } as JsonValue);
    expect(
      workflowTestUtils.buildWorkflowResumePayload("workflow.shopping", existingEnvelope)
    ).toEqual({ workflow: existingEnvelope });
    const inspiredesignEnvelope = buildWorkflowResumeEnvelope("inspiredesign", {
      brief: "Synthesize inspiration",
      urls: ["https://example.com"]
    } as JsonValue);
    expect(
      workflowTestUtils.buildWorkflowResumePayload("workflow.inspiredesign", inspiredesignEnvelope)
    ).toEqual({ workflow: inspiredesignEnvelope });

    expect(
      workflowTestUtils.inferBrandFromContent("Brand Acme Audio keeps setup simple for travel.")
    ).toBe("Acme Audio keeps setup simple for travel");

    expect(workflowTestUtils.isValidHttpUrl("http://shop.example/item")).toBe(true);
    expect(workflowTestUtils.isValidHttpUrl("https://shop.example/item")).toBe(true);
    expect(workflowTestUtils.isValidHttpUrl("ftp://shop.example/item")).toBe(false);
  });

  it("covers helper branches for feature sanitization and price parsing", () => {
    const sanitized = workflowTestUtils.sanitizeFeatureList([
      "short",
      "1234567890",
      "Save $199 instantly on launch day.",
      "Will my carrier support this device after setup?",
      "Feature 01 keeps device setup simple for remote teams.",
      "Feature 01 keeps device setup simple for remote teams.",
      "Feature 02 keeps cable routing clean in compact desks.",
      "Feature 03 keeps brightness stable in bright offices.",
      "Feature 04 keeps the stand steady on shared tables.",
      "Feature 05 keeps webcam framing comfortable all day.",
      "Feature 06 keeps accessory pairing predictable and fast.",
      "Feature 07 keeps daily travel packing lightweight.",
      "Feature 08 keeps media playback smooth on long flights.",
      "Feature 09 keeps typing posture comfortable in hotel desks.",
      "Feature 10 keeps review screenshots readable at a glance.",
      "Feature 11 keeps power delivery reliable during demos.",
      "Feature 12 keeps contrast strong for spreadsheet work.",
      "Feature 13 should be dropped once the feature cap is reached.",
      "L".repeat(170)
    ]);

    expect(sanitized).toHaveLength(12);
    expect(sanitized).toContain("Feature 01 keeps device setup simple for remote teams.");
    expect(sanitized).not.toContain("short");
    expect(sanitized).not.toContain("1234567890");
    expect(sanitized).not.toContain("Save $199 instantly on launch day.");
    expect(sanitized).not.toContain("Will my carrier support this device after setup?");
    expect(sanitized).not.toContain("Feature 13 should be dropped once the feature cap is reached.");

    expect(workflowTestUtils.parsePriceFromContent(undefined)).toEqual({
      amount: 0,
      currency: "USD"
    });
    expect(workflowTestUtils.parsePriceFromContent(
      "Buy now for €1,299.00 with a travel sleeve included."
    )).toEqual({
      amount: 1299,
      currency: "EUR"
    });
    expect(workflowTestUtils.parsePriceFromContent(
      "Save $999 today with trade-in credits and a $5 /mo service fee."
    )).toEqual({
      amount: 0,
      currency: "USD"
    });
    expect(workflowTestUtils.parsePriceFromContent(
      "From £799.00 unlocked or buy for $999.00 with extra accessories."
    )).toEqual({
      amount: 799,
      currency: "GBP"
    });
    expect(workflowTestUtils.parsePriceFromContent(
      "Buy now for $199.00 with keyboard cover included. Buy now for $149.00 with stylus included."
    )).toEqual({
      amount: 149,
      currency: "USD"
    });
    expect(workflowTestUtils.parsePriceFromContent(
      "Buy now for $129.00 with travel stand. Buy now for $129.00 with matte sleeve."
    )).toEqual({
      amount: 129,
      currency: "USD"
    });
    expect(workflowTestUtils.parsePriceFromContent(
      "Standard bundle lists $199.00 with keyboard cover. Alternate bundle lists $149.00 with stylus dock."
    )).toEqual({
      amount: 149,
      currency: "USD"
    });
    expect(workflowTestUtils.parsePriceFromContent(
      "Model A bundle lists $129.00 with carrying sleeve. Model B bundle lists $129.00 with desk stand."
    )).toEqual({
      amount: 129,
      currency: "USD"
    });
    expect(workflowTestUtils.parsePriceFromContent(
      "Starting at $249.00 for the base trim and buy for $199.00 with the travel keyboard included."
    )).toEqual({
      amount: 199,
      currency: "USD"
    });
  });

  it("covers helper branches for shopping url resolution and metadata refresh gating", () => {
    expect(workflowTestUtils.resolveShoppingProviderIdForUrl("https://www.amazon.com/dp/B0TEST1234"))
      .toBe("shopping/amazon");
    expect(workflowTestUtils.resolveShoppingProviderIdForUrl("https://unknown.example/product"))
      .toBe("shopping/others");
    expect(workflowTestUtils.resolveShoppingProviderIdForUrl("not-a-valid-url"))
      .toBeNull();

    expect(workflowTestUtils.needsProductMetadataRefresh(
      makeRecord({
        title: "Ignored title",
        attributes: {
          brand: "Trusted Brand",
          shopping_offer: {
            price: {
              amount: 199,
              currency: "USD"
            }
          }
        }
      }),
      "product-name-only"
    )).toBe(false);

    expect(workflowTestUtils.needsProductMetadataRefresh(
      makeRecord({
        title: "https://shop.example/product",
        attributes: {
          brand: "unknown",
          shopping_offer: "invalid-shape" as never
        }
      }),
      "https://shop.example/product"
    )).toBe(true);

    expect(workflowTestUtils.needsProductMetadataRefresh(
      makeRecord({
        title: "Travel Monitor Pro",
        attributes: {
          brand: "DeskCo",
          shopping_offer: {
            price: {
              amount: 0,
              currency: "USD"
            }
          }
        }
      }),
      "https://shop.example/product"
    )).toBe(true);

    expect(workflowTestUtils.needsProductMetadataRefresh(
      makeRecord({
        title: "Travel Monitor Pro",
        attributes: {
          brand: "DeskCo",
          shopping_offer: {
            price: {
              amount: 199,
              currency: "USD"
            }
          }
        }
      }),
      "https://shop.example/product"
    )).toBe(false);
  });

  it("covers transcript success, brand inference, and offer-record gating helpers", () => {
    expect(workflowTestUtils.hasTranscriptSuccess(makeRecord({
      attributes: {
        transcript_available: true
      }
    }))).toBe(true);
    expect(workflowTestUtils.hasTranscriptSuccess(makeRecord({
      attributes: {
        transcript_strategy: "fallback_captions"
      }
    }))).toBe(true);
    expect(workflowTestUtils.hasTranscriptSuccess(makeRecord({
      attributes: {
        transcript_strategy: "   "
      }
    }))).toBe(false);

    expect(workflowTestUtils.inferBrandFromUrl(undefined)).toBeUndefined();
    expect(workflowTestUtils.inferBrandFromUrl("not-a-valid-url")).toBeUndefined();
    expect(workflowTestUtils.inferBrandFromUrl("https://www.amazon.com/dp/B0TEST1234")).toBe("Amazon");
    expect(workflowTestUtils.inferBrandFromUrl("https://checkout.walmart.com/item/desk")).toBe("Walmart");
    expect(workflowTestUtils.inferBrandFromUrl("https://www.newegg.com/p/N82E16834156399")).toBe("Newegg");
    expect(workflowTestUtils.inferBrandFromUrl("https://unknown.example/product")).toBeUndefined();

    expect(workflowTestUtils.isLikelyOfferRecord(makeRecord({
      provider: "shopping/amazon",
      url: "https://www.amazon.com/s?k=portable+monitor",
      title: "Amazon search: portable monitor",
      attributes: {
        retrievalPath: "shopping:search:index"
      }
    }))).toBe(false);
    expect(workflowTestUtils.isLikelyOfferRecord(makeRecord({
      provider: "shopping/amazon",
      url: "https://cdn.example.com/product.png",
      title: "Travel Monitor Pro",
      attributes: {
        retrievalPath: "shopping:search:result-card"
      }
    }))).toBe(false);
    expect(workflowTestUtils.isLikelyOfferRecord(makeRecord({
      provider: "shopping/amazon",
      url: "https://www.amazon.com/dp/B0TEST1234",
      title: "https://www.amazon.com/dp/B0TEST1234",
      attributes: {
        retrievalPath: "shopping:search:result-card"
      }
    }))).toBe(false);
    expect(workflowTestUtils.isLikelyOfferRecord(makeRecord({
      provider: "shopping/amazon",
      url: "https://other.example/product",
      title: "Travel Monitor Pro",
      attributes: {
        retrievalPath: "shopping:search:result-card"
      }
    }))).toBe(false);
    expect(workflowTestUtils.isLikelyOfferRecord(makeRecord({
      provider: "shopping/amazon",
      url: "https://www.amazon.com/dp/B0TEST1234",
      title: "Travel Monitor Pro - Amazon",
      attributes: {
        retrievalPath: "shopping:search:result-card"
      }
    }))).toBe(true);
    expect(workflowTestUtils.isLikelyOfferRecord(makeRecord({
      provider: "shopping/amazon",
      url: "http://[bad",
      title: "Travel Monitor Pro",
      attributes: {
        retrievalPath: "shopping:search:result-card"
      }
    }))).toBe(false);
  });

  it("returns an empty object when redaction output is not a plain object", () => {
    expect(workflowTestUtils.redactRawCapture(["authorization=Bearer token"])).toEqual({});
  });

  it("falls back to shopping provider profile domains when the host is not in the static brand map", () => {
    const profile = SHOPPING_PROVIDER_PROFILES.find((entry) => entry.id === "shopping/bestbuy");
    expect(profile).toBeDefined();

    const customDomain = "bestbuy-custom.example";
    const originalDomains = [...(profile?.domains ?? [])];
    profile!.domains = [...originalDomains, customDomain];
    try {
      expect(workflowTestUtils.inferBrandFromUrl(`https://offers.${customDomain}/sku/123`)).toBe("Best Buy");
    } finally {
      profile!.domains = originalDomains;
    }
  });

  it("returns null when image fetch throws in workflow fetchBinary helper", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);
    await expect(workflowTestUtils.fetchBinary("https://cdn.example.com/image.jpg")).resolves.toBeNull();
  });

  it("applies a timeout signal to workflow fetchBinary helper calls when requested", async () => {
    let capturedSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      };
    }) as unknown as typeof fetch);

    await expect(workflowTestUtils.fetchBinary("https://cdn.example.com/image.jpg", 4321)).resolves.toEqual(
      Buffer.from([1, 2, 3])
    );
    expect(capturedSignal).toBeDefined();
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

  it("limits default shopping routing to tier1 providers unless the caller opts into specific providers", async () => {
    const search = vi.fn(async (_input, options) => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: [options?.providerIds?.[0] ?? "shopping/amazon"],
      records: []
    }));

    await runShoppingWorkflow(toRuntime({ search }), {
      query: "macbook air m4 32gb",
      mode: "json"
    });

    const requestedProviders = search.mock.calls
      .map(([, options]) => options?.providerIds?.[0])
      .filter((value): value is string => typeof value === "string");
    expect(requestedProviders).toEqual(
      SHOPPING_PROVIDER_PROFILES
        .filter((profile) => profile.tier === "tier1")
        .map((profile) => profile.id)
    );
    expect(requestedProviders).not.toContain("shopping/target");
    expect(requestedProviders).not.toContain("shopping/temu");
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

  it("fetches top web research result URLs before sanitizing search-index shells", async () => {
    const fetch = vi.fn(async (input) => {
      const url = input.url;
      if (url === "https://design.example.com/inspiration") {
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [makeRecord({
            id: "fetched-design-page",
            source: "web",
            provider: "web/default",
            url,
            title: "Coffee shop inspiration",
            content: "Cafe design systems, visual references, and photography direction.",
            attributes: {
              retrievalPath: "web:fetch:url"
            }
          })]
        });
      }
      if (url === "https://dribbble.com/tags/coffee-shop-website") {
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [makeRecord({
            id: "fetched-js-shell",
            source: "web",
            provider: "web/default",
            url,
            title: url,
            content: "JavaScript is disabled. In order to continue, we need to verify that you're not a robot.",
            attributes: {}
          })]
        });
      }
      return makeAggregate();
    });
    const runtime = toRuntime({
      search: async (_input, options) => {
        const source = (options?.source ?? "web") as ProviderSource;
        if (source !== "web") {
          return makeAggregate({
            sourceSelection: source,
            providerOrder: [`${source}/default`],
            records: []
          });
        }
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [
            makeRecord({
              id: "duckduckgo-search-result",
              source: "web",
              provider: "web/default",
              url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fdesign.example.com%2Finspiration",
              title: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fdesign.example.com%2Finspiration",
              content: "coffee shop website design inspiration at DuckDuckGo",
              attributes: {
                retrievalPath: "web:search:index"
              }
            }),
            makeRecord({
              id: "duckduckgo-js-shell-result",
              source: "web",
              provider: "web/default",
              url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fdribbble.com%2Ftags%2Fcoffee-shop-website",
              title: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fdribbble.com%2Ftags%2Fcoffee-shop-website",
              content: "coffee shop website design inspiration at DuckDuckGo",
              attributes: {
                retrievalPath: "web:search:index"
              }
            })
          ]
        });
      },
      fetch
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "coffee shop website design inspiration",
      sourceSelection: "auto",
      days: 30,
      mode: "json"
    });

    expect(fetch).toHaveBeenCalledWith({
      url: "https://design.example.com/inspiration"
    }, expect.objectContaining({
      source: "web"
    }));
    expect((output.records as Array<{ id: string }>).map((record) => record.id)).toEqual(["fetched-design-page"]);
    expect(output.meta).toMatchObject({
      metrics: {
        sanitized_records: 3,
        final_records: 1
      }
    });
  });

  it("forwards explicit timeout overrides through research search and follow-up fetch", async () => {
    const search = vi.fn(async () => makeAggregate({
      sourceSelection: "web",
      providerOrder: ["web/default"],
      records: [makeRecord({
        id: "research-timeout-forwarded-search",
        source: "web",
        provider: "web/default",
        url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fresearch-timeout-forwarded",
        title: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fresearch-timeout-forwarded",
        content: "browser automation timeout forwarded",
        attributes: {
          retrievalPath: "web:search:index"
        }
      })]
    }));
    const fetch = vi.fn(async () => makeAggregate({
      sourceSelection: "web",
      providerOrder: ["web/default"],
      records: [makeRecord({
        id: "research-timeout-forwarded-fetch",
        source: "web",
        provider: "web/default",
        url: "https://example.com/research-timeout-forwarded",
        title: "Research Timeout Forwarded",
        content: "Concrete browser automation notes with reproducible details.",
        attributes: {
          retrievalPath: "web:fetch:url"
        }
      })]
    }));

    await runResearchWorkflow(toRuntime({ search, fetch }), {
      topic: "browser automation timeout forwarded",
      sourceSelection: "web",
      days: 7,
      timeoutMs: 4321,
      mode: "json"
    });

    expect(search).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "web",
      timeoutMs: 4321,
      suspendedIntent: expectWorkflowSuspendedIntent("research", {
        topic: "browser automation timeout forwarded",
        sourceSelection: "web",
        days: 7,
        timeoutMs: 4321,
        mode: "json"
      })
    }));
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/research-timeout-forwarded" },
      expect.objectContaining({
        source: "web",
        timeoutMs: 4321,
        suspendedIntent: expectWorkflowSuspendedIntent("research", {
          topic: "browser automation timeout forwarded",
          sourceSelection: "web",
          days: 7,
          timeoutMs: 4321,
          mode: "json"
        })
      })
    );
  });

  it("preserves research timeout failures in structured workflow output", async () => {
    const output = await runResearchWorkflow(toRuntime({
      search: async () => makeAggregate({
        ok: false,
        records: [],
        partial: false,
        failures: [makeFailure("web/default", "web", {
          code: "timeout",
          message: "Browser fallback timed out after 15000ms",
          retryable: true,
          details: {
            stage: "capture",
            timeoutMs: 15000
          }
        })],
        metrics: {
          attempted: 1,
          succeeded: 0,
          failed: 1,
          retries: 0,
          latencyMs: 15000
        },
        sourceSelection: "web",
        providerOrder: ["web/default"],
        error: {
          code: "timeout",
          message: "Browser fallback timed out after 15000ms",
          retryable: true,
          details: {
            stage: "capture",
            timeoutMs: 15000
          }
        }
      })
    }), {
      topic: "browser automation timeout",
      sourceSelection: "web",
      days: 7,
      mode: "json"
    });

    expect(output.records).toEqual([]);
    expect(output.meta).toMatchObject({
      failures: [{
        provider: "web/default",
        error: {
          code: "timeout",
          retryable: true,
          details: {
            stage: "capture",
            timeoutMs: 15000
          }
        }
      }],
      metrics: {
        failed_sources: ["web"]
      }
    });
    expect((output.meta as {
      failures: Array<{ error: { reasonCode?: string } }>;
    }).failures[0]?.error.reasonCode).not.toBe("env_limited");
  });

  it("does not synthesize primary constraint summaries for timeout-only research failures", async () => {
    const output = await runResearchWorkflow(toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "social",
        providerOrder: ["social/x"],
        records: [],
        partial: false,
        failures: [makeFailure("social/x", "social", {
          code: "timeout",
          message: "Rendered social search timed out after 15000ms",
          retryable: true,
          details: {
            stage: "capture",
            timeoutMs: 15000,
            browserRequired: true,
            providerShell: "social_render_shell"
          }
        })],
        metrics: {
          attempted: 1,
          succeeded: 0,
          failed: 1,
          retries: 0,
          latencyMs: 15000
        }
      })
    }), {
      topic: "browser automation timeout masking",
      sourceSelection: "social",
      days: 7,
      mode: "compact"
    });

    expect(output.summary).toBe("No records matched the requested timebox.");
    expect(output.meta).not.toHaveProperty("primary_constraint");
    expect(output.meta).not.toHaveProperty("primaryConstraint");
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");
    expect(output.meta).not.toHaveProperty("primaryConstraintSummary");
    expect((output.meta as {
      failures: Array<{ error: { code?: string; reasonCode?: string } }>;
    }).failures[0]?.error).toMatchObject({
      code: "timeout"
    });
    expect((output.meta as {
      failures: Array<{ error: { reasonCode?: string } }>;
    }).failures[0]?.error.reasonCode).not.toBe("env_limited");
  });

  it("keeps real research primary constraint summaries when timeout failures are mixed with auth failures", async () => {
    const output = await runResearchWorkflow(toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "social",
        providerOrder: ["social/x", "social/linkedin"],
        records: [],
        partial: false,
        failures: [
          makeFailure("social/x", "social", {
            code: "timeout",
            message: "Rendered social search timed out after 15000ms",
            retryable: true,
            details: {
              stage: "capture",
              timeoutMs: 15000,
              browserRequired: true,
              providerShell: "social_render_shell"
            }
          }),
          makeFailure("social/linkedin", "social", {
            code: "auth",
            message: "Authentication required",
            retryable: false,
            reasonCode: "token_required",
            details: {
              blockerType: "auth_required",
              constraint: {
                kind: "session_required",
                evidenceCode: "auth_required"
              }
            }
          })
        ],
        metrics: {
          attempted: 2,
          succeeded: 0,
          failed: 2,
          retries: 0,
          latencyMs: 15001
        }
      })
    }), {
      topic: "browser automation linkedin timeout masking",
      sourceSelection: "social",
      days: 7,
      mode: "compact"
    });

    expect((output.meta as {
      failures: Array<{ provider: string; error: { code?: string } }>;
    }).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "social/x",
        error: expect.objectContaining({
          code: "timeout"
        })
      }),
      expect.objectContaining({
        provider: "social/linkedin",
        error: expect.objectContaining({
          code: "auth"
        })
      })
    ]));
    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Linkedin requires login or an existing session."
    });
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");
    expect(output.summary).toContain("Primary constraint: Linkedin requires login or an existing session.");
  });

  it("keeps failed_sources derived from search failures only when web follow-up fetches fail", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      ok: false,
      sourceSelection: "web",
      providerOrder: ["web/default"],
      failures: [makeFailure("web/default", "web", {
        code: "unavailable",
        message: "follow-up fetch failed",
        retryable: false
      })],
      metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
    }));
    const runtime = toRuntime({
      search: async (_input, options) => {
        const source = (options?.source ?? "web") as ProviderSource;
        if (source !== "web") {
          return makeAggregate({
            sourceSelection: source,
            providerOrder: [`${source}/default`],
            records: []
          });
        }
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [makeRecord({
            id: "search-shell",
            source: "web",
            provider: "web/default",
            url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Ffollow-up",
            title: "search shell",
            content: "resume topic",
            attributes: {
              retrievalPath: "web:search:index"
            }
          })]
        });
      },
      fetch
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "follow-up failure accounting",
      sourceSelection: "auto",
      days: 7,
      mode: "json"
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(output.meta).toMatchObject({
      metrics: {
        failed_sources: []
      }
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

  it("propagates primary constraint summaries into research meta and compact empty-state output", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "social",
        providerOrder: ["social/linkedin"],
        failures: [makeFailure("social/linkedin", "social", {
          code: "auth",
          message: "Authentication required",
          retryable: false,
          reasonCode: "token_required",
          details: {
            blockerType: "auth_required",
            constraint: {
              kind: "session_required",
              evidenceCode: "auth_required"
            }
          }
        })],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "browser automation linkedin",
      sourceSelection: "social",
      mode: "compact",
      days: 7
    });

    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Linkedin requires login or an existing session."
    });
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");
    expect(output.summary).toContain("No records matched the requested timebox.");
    expect(output.summary).toContain("Primary constraint: Linkedin requires login or an existing session.");
  });

  it("threads cookie overrides and aggregates cookie diagnostics across failures, records, and attempt chains", async () => {
    const search = vi.fn(async () => {
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

    const searchOptions = search.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(searchOptions).toBeDefined();
    expect(searchOptions).toMatchObject({
      source: "web",
      runtimePolicy: {
        useCookies: true,
        cookiePolicyOverride: "required"
      }
    });
    expect(searchOptions).not.toHaveProperty("useCookies");
    expect(searchOptions).not.toHaveProperty("cookiePolicyOverride");

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
    expect(allMeta.selection.resolved_sources).toEqual(["web", "community", "social"]);

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

  it("prefers direct product matches over accessories for best-deal shopping queries", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/amazon";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [
            makeRecord({
              id: "macbook-direct",
              source: "shopping",
              provider: providerId,
              url: "https://www.amazon.com/dp/B0DIRECTM4",
              title: "Apple MacBook Air Laptop 13-inch M4 32GB 1TB",
              content: "$1899.00",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: providerId,
                  product_id: "macbook-direct",
                  title: "Apple MacBook Air Laptop 13-inch M4 32GB 1TB",
                  url: "https://www.amazon.com/dp/B0DIRECTM4",
                  price: { amount: 1899, currency: "USD", retrieved_at: isoHoursAgo(1) },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 4.8,
                  reviews_count: 129
                }
              }
            }),
            makeRecord({
              id: "macbook-accessory",
              source: "shopping",
              provider: providerId,
              url: "https://www.amazon.com/dp/B0CASEM4001",
              title: "Protective Case for MacBook Air 13-inch M4",
              content: "$29.99",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: providerId,
                  product_id: "macbook-accessory",
                  title: "Protective Case for MacBook Air 13-inch M4",
                  url: "https://www.amazon.com/dp/B0CASEM4001",
                  price: { amount: 29.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 5,
                  reviews_count: 999
                }
              }
            })
          ]
        });
      }
    });

    const bestDeal = await runShoppingWorkflow(runtime, {
      query: "macbook air m4 32gb",
      providers: ["shopping/amazon"],
      mode: "json"
    });
    expect((bestDeal.offers as Array<{ title: string }>).map((offer) => offer.title)).toEqual([
      "Apple MacBook Air Laptop 13-inch M4 32GB 1TB",
      "Protective Case for MacBook Air 13-inch M4"
    ]);

    const lowestPrice = await runShoppingWorkflow(runtime, {
      query: "macbook air m4 32gb",
      providers: ["shopping/amazon"],
      sort: "lowest_price",
      mode: "json"
    });
    expect((lowestPrice.offers as Array<{ title: string }>)[0]?.title).toBe("Protective Case for MacBook Air 13-inch M4");
  });

  it("does not treat echoed search query params as product-intent matches", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/ebay";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [
            makeRecord({
              id: "wrong-spec-query-echo",
              source: "shopping",
              provider: providerId,
              url: "https://www.ebay.com/itm/111?_skw=macbook+air+m4+32gb",
              title: "Apple MacBook Air 15-inch M3 8GB 256GB Midnight",
              content: "$775.00",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: providerId,
                  product_id: "wrong-spec-query-echo",
                  title: "Apple MacBook Air 15-inch M3 8GB 256GB Midnight",
                  url: "https://www.ebay.com/itm/111?_skw=macbook+air+m4+32gb",
                  price: { amount: 775, currency: "USD", retrieved_at: isoHoursAgo(1) },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 4.8,
                  reviews_count: 32
                }
              }
            }),
            makeRecord({
              id: "requested-spec-match",
              source: "shopping",
              provider: providerId,
              url: "https://www.ebay.com/itm/222",
              title: "Apple MacBook Air 15-inch M4 32GB 1TB Midnight",
              content: "$1329.99",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: providerId,
                  product_id: "requested-spec-match",
                  title: "Apple MacBook Air 15-inch M4 32GB 1TB Midnight",
                  url: "https://www.ebay.com/itm/222",
                  price: { amount: 1329.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 4.6,
                  reviews_count: 14
                }
              }
            })
          ]
        });
      }
    });

    const bestDeal = await runShoppingWorkflow(runtime, {
      query: "macbook air m4 32gb",
      providers: ["shopping/ebay"],
      mode: "json"
    });

    expect((bestDeal.offers as Array<{ title: string }>).map((offer) => offer.title)).toEqual([
      "Apple MacBook Air 15-inch M4 32GB 1TB Midnight",
      "Apple MacBook Air 15-inch M3 8GB 256GB Midnight"
    ]);
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
    expect(highest.meta).toMatchObject({
      selection: {
        requested_region: "us",
        region_enforced: false,
        region_authoritative: false,
        region_support: expect.arrayContaining([
          expect.objectContaining({
            provider: "shopping/amazon",
            requestedRegion: "us",
            enforced: false,
            reason: "provider_search_path_ignores_region"
          })
        ])
      },
      alerts: expect.arrayContaining([
        expect.objectContaining({
          signal: "region_unenforced",
          reasonCode: "region_unenforced"
        })
      ])
    });

    const fastest = await runShoppingWorkflow(runtime, {
      query: "tie-break",
      providers: ["shopping/amazon", "shopping/others"],
      sort: "fastest_shipping",
      mode: "json"
    });
    expect((fastest.offers as Array<{ provider: string }>)[0]?.provider).toBe("shopping/others");
  });

  it("drops shopping offers with missing or out-of-budget prices when a budget is supplied", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/amazon";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [
            makeRecord({
              id: "under-budget",
              source: "shopping",
              provider: providerId,
              url: "https://www.amazon.com/dp/B0UNDER0001",
              title: "Under Budget Monitor",
              content: "$59.99",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: providerId,
                  product_id: "under-budget",
                  title: "Under Budget Monitor",
                  url: "https://www.amazon.com/dp/B0UNDER0001",
                  price: { amount: 59.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 4.7,
                  reviews_count: 20
                }
              }
            }),
            makeRecord({
              id: "missing-price",
              source: "shopping",
              provider: providerId,
              url: "https://www.amazon.com/dp/B0MISS00001",
              title: "Missing Price Monitor",
              content: "Price unavailable",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: providerId,
                  product_id: "missing-price",
                  title: "Missing Price Monitor",
                  url: "https://www.amazon.com/dp/B0MISS00001",
                  price: { amount: 0, currency: "USD", retrieved_at: isoHoursAgo(1) },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 4.9,
                  reviews_count: 10
                }
              }
            }),
            makeRecord({
              id: "over-budget",
              source: "shopping",
              provider: providerId,
              url: "https://www.amazon.com/dp/B0OVER00001",
              title: "Over Budget Monitor",
              content: "$399.99",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: providerId,
                  product_id: "over-budget",
                  title: "Over Budget Monitor",
                  url: "https://www.amazon.com/dp/B0OVER00001",
                  price: { amount: 399.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 4.8,
                  reviews_count: 30
                }
              }
            })
          ]
        });
      }
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "portable monitor",
      providers: ["shopping/amazon"],
      budget: 100,
      mode: "json"
    });

    expect((output.offers as Array<{ title: string }>).map((offer) => offer.title)).toEqual(["Under Budget Monitor"]);
  });

  it("explains region-filtered empty shopping runs as non-authoritative currency-heuristic results", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/amazon";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [makeRecord({
            id: "cad-only-offer",
            source: "shopping",
            provider: providerId,
            url: "https://www.amazon.com/dp/B0CADONLY01",
            title: "Region-mismatched earbuds",
            content: "CAD 36.25",
            attributes: {
              retrievalPath: "shopping:search:result-card",
              shopping_offer: {
                provider: providerId,
                product_id: "cad-only-offer",
                title: "Region-mismatched earbuds",
                url: "https://www.amazon.com/dp/B0CADONLY01",
                price: { amount: 36.25, currency: "CAD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "CAD", notes: "free" },
                availability: "in_stock",
                rating: 4.7,
                reviews_count: 120
              }
            }
          })]
        });
      }
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "wireless earbuds",
      providers: ["shopping/amazon"],
      region: "us",
      mode: "compact"
    });

    expect(output.offers).toEqual([]);
    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Requested region us was not enforced by the selected providers, and all candidate offers were filtered by the USD currency heuristic.",
      selection: {
        requested_region: "us",
        region_enforced: false,
        region_authoritative: false
      },
      metrics: {
        candidate_offers: 1,
        region_currency_excluded: 1,
        zero_price_excluded: 0
      }
    });
    expect(output.summary).toContain("Primary constraint: Requested region us was not enforced by the selected providers, and all candidate offers were filtered by the USD currency heuristic.");
  });

  it("explains budget-filtered empty shopping runs instead of collapsing to generic no-offer output", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/bestbuy";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [makeRecord({
            id: "over-budget-offer",
            source: "shopping",
            provider: providerId,
            url: "https://www.bestbuy.com/site/4k-monitor/123.p",
            title: "4K Monitor",
            content: "$399.99",
            attributes: {
              retrievalPath: "shopping:search:result-card",
              shopping_offer: {
                provider: providerId,
                product_id: "over-budget-offer",
                title: "4K Monitor",
                url: "https://www.bestbuy.com/site/4k-monitor/123.p",
                price: { amount: 399.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4.6,
                reviews_count: 88
              }
            }
          })]
        });
      }
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "27 inch 4k monitor",
      providers: ["shopping/bestbuy"],
      budget: 350,
      mode: "compact"
    });

    expect(output.offers).toEqual([]);
    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "All candidate offers exceeded the requested budget of 350.00.",
      metrics: {
        candidate_offers: 1,
        budget_excluded: 1,
        zero_price_excluded: 0
      },
      failures: [{
        provider: "shopping/bestbuy",
        error: {
          details: {
            filterReason: "budget",
            budgetExcluded: 1
          }
        }
      }]
    });
    expect(output.summary).toContain("Primary constraint: All candidate offers exceeded the requested budget of 350.00.");
  });

  it("drops zero-price shopping offers even without a budget and reports the exclusion count", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/amazon";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [
            makeRecord({
              id: "priced-offer",
              source: "shopping",
              provider: providerId,
              url: "https://www.amazon.com/dp/B0PRICE0001",
              title: "Priced Dock",
              content: "$89.99",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: providerId,
                  product_id: "priced-offer",
                  title: "Priced Dock",
                  url: "https://www.amazon.com/dp/B0PRICE0001",
                  price: { amount: 89.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 4.6,
                  reviews_count: 18
                }
              }
            }),
            makeRecord({
              id: "zero-offer",
              source: "shopping",
              provider: providerId,
              url: "https://www.amazon.com/dp/B0ZERO00001",
              title: "Zero Price Dock",
              content: "Price unavailable",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: providerId,
                  product_id: "zero-offer",
                  title: "Zero Price Dock",
                  url: "https://www.amazon.com/dp/B0ZERO00001",
                  price: { amount: 0, currency: "USD", retrieved_at: isoHoursAgo(1) },
                  shipping: { amount: 0, currency: "USD", notes: "free" },
                  availability: "in_stock",
                  rating: 5,
                  reviews_count: 999
                }
              }
            })
          ]
        });
      }
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "usb-c dock",
      providers: ["shopping/amazon"],
      mode: "json"
    });

    expect((output.offers as Array<{ title: string }>).map((offer) => offer.title)).toEqual(["Priced Dock"]);
    expect(output.meta).toMatchObject({
      metrics: {
        zero_price_excluded: 1
      }
    });
  });

  it("summarizes zero-price-only shopping runs as a trustworthy-price constraint", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/amazon";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [makeRecord({
            id: "zero-price-only-offer",
            source: "shopping",
            provider: providerId,
            url: "https://www.amazon.com/dp/B0ZEROONLY2",
            title: "USB-C Dock",
            content: "Price unavailable",
            attributes: {
              retrievalPath: "shopping:search:result-card",
              shopping_offer: {
                provider: providerId,
                product_id: "zero-price-only-offer",
                title: "USB-C Dock",
                url: "https://www.amazon.com/dp/B0ZEROONLY2",
                price: { amount: 0, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4.4,
                reviews_count: 74
              }
            }
          })]
        });
      }
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "usb-c dock",
      providers: ["shopping/amazon"],
      mode: "compact"
    });

    expect(output.offers).toEqual([]);
    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Selected providers returned only zero-price or missing-price offers, so this run could not determine a trustworthy deal price.",
      metrics: {
        candidate_offers: 1,
        zero_price_excluded: 1
      },
      failures: [{
        provider: "shopping/amazon",
        error: {
          details: {
            filterReason: "zero_price"
          }
        }
      }]
    });
    expect(output.summary).toContain("Primary constraint: Selected providers returned only zero-price or missing-price offers, so this run could not determine a trustworthy deal price.");
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
                retrievalPath: "shopping:search:result-card",
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
    expect(output.meta).toMatchObject({
      metrics: {
        zero_price_excluded: 2
      }
    });
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
            retrievalPath: "shopping:search:result-card",
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

  it("filters malformed shopping pseudo-offers and emits an empty-result failure when nothing usable remains", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [
          makeRecord({
            id: "unexpected-search-path",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/dp/B0BAD00001",
            title: "Unexpected search row",
            attributes: {
              retrievalPath: "shopping:search:unexpected",
              shopping_offer: {
                provider: "shopping/amazon",
                product_id: "unexpected-search-path",
                title: "Unexpected search row",
                url: "https://www.amazon.com/dp/B0BAD00001",
                price: { amount: 10, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4,
                reviews_count: 1
              }
            }
          }),
          makeRecord({
            id: "url-title",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/dp/B0BAD00002",
            title: "https://www.amazon.com/dp/B0BAD00002",
            attributes: {
              retrievalPath: "shopping:search:result-card"
            }
          }),
          makeRecord({
            id: "asset-url",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://images-na.ssl-images-amazon.com/logo.png",
            title: "Amazon asset",
            attributes: {
              retrievalPath: "shopping:search:result-card"
            }
          }),
          makeRecord({
            id: "non-http-url",
            source: "shopping",
            provider: "shopping/amazon",
            url: "data:text/html,not-a-product",
            title: "Portable monitor with bright matte display",
            attributes: {
              retrievalPath: "shopping:search:result-card"
            }
          }),
          makeRecord({
            id: "provider-domain-mismatch",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://store.example.com/item-22",
            title: "Portable monitor with vivid panel and folding stand",
            attributes: {
              retrievalPath: "shopping:search:result-card"
            }
          })
        ]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "portable monitor",
      providers: ["shopping/amazon"],
      mode: "json"
    });

    expect(output.offers).toEqual([]);
    expect(output.meta).toMatchObject({
      failures: [{
        provider: "shopping/amazon",
        error: {
          reasonCode: "env_limited",
          details: {
            noOfferRecords: true,
            recordsCount: 5
          }
        }
      }],
      metrics: {
        total_offers: 0,
        failed_providers: ["shopping/amazon"],
        reasonCodeDistribution: {
          env_limited: 1
        }
      }
    });
    expect((output.meta as { metrics: Record<string, unknown> }).metrics).not.toHaveProperty("reason_code_distribution");
  });

  it("preserves restricted-target blockers when empty shopping runs only surface browser-owned URLs", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "restricted-target-shell",
          source: "shopping",
          provider: "shopping/amazon",
          url: "chrome://settings",
          title: "   ",
          content: "   ",
          attributes: {
            retrievalPath: "shopping:search:index"
          }
        })]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "browser-owned target",
      providers: ["shopping/amazon"],
      mode: "json"
    });

    expect(output.offers).toEqual([]);
    expect(output.meta).toMatchObject({
      failures: [{
        provider: "shopping/amazon",
        error: {
          reasonCode: "env_limited",
          details: {
            blockerType: "restricted_target",
            reasonCode: "env_limited",
            url: "chrome://settings"
          }
        }
      }]
    });
  });

  it("preserves blocker envelopes when empty shopping runs only surface message-only env-limited shells", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "message-only-env-limited",
          source: "shopping",
          provider: "shopping/amazon",
          url: undefined,
          title: "   ",
          content: "This provider is not available in this environment right now.",
          attributes: {
            retrievalPath: "shopping:search:index"
          }
        })]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "message only env limited",
      providers: ["shopping/amazon"],
      mode: "json"
    });

    expect(output.offers).toEqual([]);
    expect(output.meta).toMatchObject({
      failures: [{
        provider: "shopping/amazon",
        error: {
          reasonCode: "env_limited",
          details: {
            noOfferRecords: true,
            recordsCount: 1,
            blockerType: "env_limited",
            reasonCode: "env_limited"
          }
        }
      }]
    });
    expect((output.meta as {
      failures: Array<{ error: { details: Record<string, unknown> } }>;
    }).failures[0]?.error.details.url).toBeUndefined();
    expect((output.meta as {
      failures: Array<{ error: { details: Record<string, unknown> } }>;
    }).failures[0]?.error.details.title).toBeUndefined();
  });

  it("promotes carried shopping constraints into no-offer failures and primary summaries", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/costco"],
        records: [makeRecord({
          id: "membership-gated-shell",
          source: "shopping",
          provider: "shopping/costco",
          url: "https://www.costco.com/CatalogSearch?keyword=wireless%20mouse",
          title: "Sign In | Costco",
          content: "Please sign in to continue.",
          attributes: {
            retrievalPath: "shopping:search:index",
            reasonCode: "token_required",
            blockerType: "auth_required",
            constraint: {
              kind: "session_required",
              evidenceCode: "auth_required"
            }
          }
        })]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "membership gate",
      providers: ["shopping/costco"],
      mode: "compact"
    });

    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Costco requires login or an existing session.",
      failures: [{
        provider: "shopping/costco",
        error: {
          code: "auth",
          reasonCode: "token_required",
          details: {
            noOfferRecords: true,
            blockerType: "auth_required",
            constraint: {
              kind: "session_required",
              evidenceCode: "auth_required"
            }
          }
        }
      }]
    });
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");
    expect(output.summary).toContain("Primary constraint: Costco requires login or an existing session.");
  });

  it("promotes carried render-required shopping constraints into no-offer failures and primary summaries", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/target"],
        records: [makeRecord({
          id: "target-shell",
          source: "shopping",
          provider: "shopping/target",
          url: "https://www.target.com/s?searchTerm=wireless%20mouse",
          title: "\"wireless mouse\" : Target",
          content: "Skip to main content",
          attributes: {
            retrievalPath: "shopping:search:index",
            reasonCode: "env_limited",
            blockerType: "env_limited",
            providerShell: "target_shell_page",
            constraint: {
              kind: "render_required",
              evidenceCode: "target_shell_page"
            }
          }
        })]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "target shell",
      providers: ["shopping/target"],
      mode: "compact"
    });

    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Target requires a live browser-rendered page.",
      failures: [{
        provider: "shopping/target",
        error: {
          reasonCode: "env_limited",
          details: {
            blockerType: "env_limited",
            providerShell: "target_shell_page",
            constraint: {
              kind: "render_required",
              evidenceCode: "target_shell_page"
            }
          }
        }
      }]
    });
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");
    expect(output.summary).toContain("Primary constraint: Target requires a live browser-rendered page.");
  });

  it("promotes Macy's access denied shells into live-browser-rendered primary summaries", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/macys"],
        records: [makeRecord({
          id: "macys-access-denied",
          source: "shopping",
          provider: "shopping/macys",
          url: "https://www.macys.com/shop/featured/wireless%20mouse",
          title: "Access Denied",
          content: "You don't have permission to access this page on this server.",
          attributes: {
            retrievalPath: "shopping:search:index",
            reasonCode: "env_limited",
            blockerType: "env_limited",
            providerShell: "macys_access_denied_shell",
            constraint: {
              kind: "render_required",
              evidenceCode: "macys_access_denied_shell"
            }
          }
        })]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "wireless mouse",
      providers: ["shopping/macys"],
      mode: "compact"
    });

    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Macys requires a live browser-rendered page.",
      failures: [{
        provider: "shopping/macys",
        error: {
          reasonCode: "env_limited",
          details: {
            blockerType: "env_limited",
            providerShell: "macys_access_denied_shell",
            constraint: {
              kind: "render_required",
              evidenceCode: "macys_access_denied_shell"
            }
          }
        }
      }]
    });
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");
    expect(output.summary).toContain("Primary constraint: Macys requires a live browser-rendered page.");
  });

  it("surfaces blocker-specific recovery fetch failures instead of generic no-offer output", async () => {
    const search = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/costco"],
      records: [makeRecord({
        id: "costco-search-index",
        source: "shopping",
        provider: "shopping/costco",
        url: "https://www.costco.com/CatalogSearch?keyword=wireless%20mouse",
        title: "Search Results",
        attributes: {
          retrievalPath: "shopping:search:index",
          links: ["https://www.costco.com/wireless-mouse.html"]
        }
      })]
    }));
    const fetch = vi.fn(async () => makeAggregate({
      ok: false,
      partial: true,
      sourceSelection: "shopping",
      providerOrder: ["shopping/costco"],
      records: [makeRecord({
        id: "costco-auth-shell",
        source: "shopping",
        provider: "shopping/costco",
        url: "https://www.costco.com/wireless-mouse.html",
        title: "Sign In | Costco",
        content: "Please sign in to continue.",
        attributes: {
          retrievalPath: "shopping:fetch:url",
          reasonCode: "auth_required",
          blockerType: "auth_required",
          constraint: {
            kind: "session_required",
            evidenceCode: "auth_required"
          }
        }
      })],
      failures: [makeFailure("shopping/costco", "shopping", {
        code: "auth",
        message: "Authentication required",
        reasonCode: "auth_required",
        provider: "shopping/costco",
        source: "shopping",
        details: {
          blockerType: "auth_required",
          constraint: {
            kind: "session_required",
            evidenceCode: "auth_required"
          }
        }
      })],
      metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
    }));

    const output = await runShoppingWorkflow(toRuntime({ search, fetch }), {
      query: "membership gate",
      providers: ["shopping/costco"],
      mode: "compact"
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Costco requires login or an existing session.",
      failures: [{
        provider: "shopping/costco",
        error: {
          reasonCode: "auth_required"
        }
      }]
    });
    expect(output.summary).toContain("Primary constraint: Costco requires login or an existing session.");
  });

  it("upgrades higher-priority auth_required no-offer records even when url and title are missing", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/costco"],
        records: [
          makeRecord({
            id: "render-shell-first",
            source: "shopping",
            provider: "shopping/costco",
            url: "https://www.costco.com/CatalogSearch?keyword=wireless%20mouse",
            title: "Costco shell",
            content: "Skip to main content",
            attributes: {
              retrievalPath: "shopping:search:index",
              reasonCode: "env_limited",
              blockerType: "env_limited",
              providerShell: "target_shell_page",
              constraint: {
                kind: "render_required",
                evidenceCode: "target_shell_page"
              }
            }
          }),
          makeRecord({
            id: "auth-shell-second",
            source: "shopping",
            provider: "shopping/costco",
            url: undefined,
            title: "   ",
            content: "Please sign in to continue.",
            attributes: {
              retrievalPath: "shopping:search:index",
              reasonCode: "auth_required",
              blockerType: "auth_required",
              constraint: {
                kind: "session_required",
                evidenceCode: "auth_required"
              }
            }
          })
        ]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "membership gate",
      providers: ["shopping/costco"],
      mode: "compact"
    });

    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Costco requires login or an existing session.",
      failures: [{
        provider: "shopping/costco",
        error: {
          code: "auth",
          reasonCode: "auth_required",
          details: {
            noOfferRecords: true,
            blockerType: "auth_required",
            constraint: {
              kind: "session_required",
              evidenceCode: "auth_required"
            }
          }
        }
      }]
    });
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");

    const failureDetails = ((output.meta as {
      failures: Array<{ error: { details: Record<string, unknown> } }>;
    }).failures[0]?.error.details ?? {});
    expect(failureDetails.url).toBeUndefined();
    expect(failureDetails.title).toBeUndefined();
    expect(failureDetails.providerShell).toBeUndefined();
    expect(output.summary).toContain("Primary constraint: Costco requires login or an existing session.");
  });

  it("prioritizes carried challenge diagnostics over render-required no-offer records", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/temu"],
        records: [
          makeRecord({
            id: "temu-render-shell",
            source: "shopping",
            provider: "shopping/temu",
            url: "https://www.temu.com/search_result.html?search_key=wireless%20mouse",
            title: "Temu shell",
            content: "Temu returned an empty shell page.",
            attributes: {
              retrievalPath: "shopping:search:index",
              reasonCode: "env_limited",
              blockerType: "env_limited",
              providerShell: "temu_empty_shell",
              constraint: {
                kind: "render_required",
                evidenceCode: "temu_empty_shell"
              }
            }
          }),
          makeRecord({
            id: "temu-challenge-shell",
            source: "shopping",
            provider: "shopping/temu",
            url: "https://www.temu.com/search_result.html?search_key=wireless%20mouse",
            title: "Temu verification",
            content: "Challenge page",
            attributes: {
              retrievalPath: "shopping:search:index",
              reasonCode: "challenge_detected",
              blockerType: "anti_bot_challenge",
              providerShell: "temu_challenge_shell"
            }
          })
        ]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "temu challenge",
      providers: ["shopping/temu"],
      mode: "compact"
    });

    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Temu hit an anti-bot challenge that requires manual completion.",
      failures: [{
        provider: "shopping/temu",
        error: {
          code: "unavailable",
          reasonCode: "challenge_detected",
          details: {
            blockerType: "anti_bot_challenge",
            providerShell: "temu_challenge_shell"
          }
        }
      }]
    });
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");
    expect(output.summary).toContain("Primary constraint: Temu hit an anti-bot challenge that requires manual completion.");
  });

  it("keeps subtype-free env-limited no-offer failures explicit about manual browser follow-up", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/costco"],
        records: [makeRecord({
          id: "costco-generic-shell",
          source: "shopping",
          provider: "shopping/costco",
          url: "https://www.costco.com/CatalogSearch?keyword=wireless%20mouse",
          title: "wireless mouse search",
          content: "No usable product cards were extracted from this search page.",
          attributes: {
            retrievalPath: "shopping:search:index",
            reasonCode: "env_limited"
          }
        })]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "wireless mouse",
      providers: ["shopping/costco"],
      mode: "compact"
    });

    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Costco requires manual browser follow-up; this run did not determine whether login or page rendering is required.",
      failures: [{
        provider: "shopping/costco",
        error: {
          reasonCode: "env_limited",
          details: {
            noOfferRecords: true,
            reasonCode: "env_limited"
          }
        }
      }]
    });
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");
    expect(output.summary).toContain("Primary constraint: Costco requires manual browser follow-up; this run did not determine whether login or page rendering is required.");
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

    expect(metrics.reasonCodeDistribution).toMatchObject({
      caption_missing: 1,
      transcript_unavailable: 1
    });
    expect(metrics).not.toHaveProperty("reason_code_distribution");
    expect(metrics.reasonCodeDistribution.internal).toBeUndefined();
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

  it("sanitizes shell research records before enrichment and ranking", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const source = (options?.source ?? "web") as ProviderSource;
        if (source === "web") {
          return makeAggregate({
            sourceSelection: "web",
            providerOrder: ["web/default"],
            records: [makeRecord({
              id: "duckduckgo-shell",
              source: "web",
              provider: "web/default",
              url: "https://html.duckduckgo.com/html",
              title: "https://html.duckduckgo.com/html",
              content: "coffee shop website design inspiration at DuckDuckGo",
              attributes: {
                retrievalPath: "web:search:index"
              }
            })]
          });
        }
        if (source === "community") {
          return makeAggregate({
            sourceSelection: "community",
            providerOrder: ["community/default"],
            records: [
              makeRecord({
                id: "reddit-search-shell",
                source: "community",
                provider: "community/default",
                url: "https://www.reddit.com/search/?q=coffee+shop+website+design+inspiration",
                title: "Community search: coffee shop website design inspiration",
                content: "All Posts Communities Comments Search results",
                attributes: {
                  retrievalPath: "community:search:index"
                }
              }),
              makeRecord({
                id: "reddit-login-shell",
                source: "community",
                provider: "community/default",
                url: "https://www.reddit.com/login",
                title: "https://www.reddit.com/login",
                content: "Welcome to Reddit. Log in to continue.",
                attributes: {
                  retrievalPath: "community:fetch:url"
                }
              })
            ]
          });
        }
        return makeAggregate({
          sourceSelection: "social",
          providerOrder: ["social/default"],
          records: [
            makeRecord({
              id: "bluesky-js-shell",
              source: "social",
              provider: "social/default",
              url: "https://bsky.app/search?q=coffee+shop+website+design+inspiration",
              title: "Bluesky search",
              content: "JavaScript is not available.",
              attributes: {
                retrievalPath: "social:fetch:url"
              }
            }),
            makeRecord({
              id: "reddit-generic-shell",
              source: "social",
              provider: "social/default",
              url: "https://www.reddit.com/answers/example?q=coffee+shop+website+design+inspiration",
              title: "https://www.reddit.com/answers/example?q=coffee+shop+website+design+inspiration",
              content: "Reddit - The heart of the internet. Please wait for verification. Skip to main content.",
              attributes: {
                retrievalPath: "social:fetch:url"
              }
            }),
            makeRecord({
              id: "clean-inspiration-record",
              source: "social",
              provider: "social/default",
              url: "https://studio.example.com/inspiration/coffee-shop",
              title: "Coffee shop website design inspiration",
              content: "A warm editorial coffee shop website with strong typography and photography.",
              attributes: {
                retrievalPath: "social:post:url"
              }
            })
          ]
        });
      }
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "coffee shop website design inspiration",
      sourceSelection: "auto",
      days: 30,
      mode: "json"
    });

    expect((output.records as Array<{ id: string }>).map((record) => record.id)).toEqual(["clean-inspiration-record"]);
    expect(output.meta).toMatchObject({
      metrics: {
        sanitized_records: 5,
        sanitized_reason_distribution: {
          search_index_shell: 2,
          login_shell: 1,
          js_required_shell: 1,
          search_results_shell: 1
        }
      }
    });
  });

  it("fails research runs when every gathered record sanitizes away without explicit provider failures", async () => {
    const runtime = toRuntime({
      search: async (_input, options) => {
        const source = (options?.source ?? "web") as ProviderSource;
        if (source === "web") {
          return makeAggregate({
            sourceSelection: "web",
            providerOrder: ["web/default"],
            records: [makeRecord({
              id: "duckduckgo-shell",
              source: "web",
              provider: "web/default",
              url: "https://html.duckduckgo.com/html",
              title: "https://html.duckduckgo.com/html",
              content: "browser automation blockers at DuckDuckGo",
              attributes: {
                retrievalPath: "web:search:index"
              }
            })]
          });
        }
        if (source === "community") {
          return makeAggregate({
            sourceSelection: "community",
            providerOrder: ["community/default"],
            records: [makeRecord({
              id: "reddit-login-shell",
              source: "community",
              provider: "community/default",
              url: "https://www.reddit.com/login",
              title: "https://www.reddit.com/login",
              content: "Welcome to Reddit. Log in to continue.",
              attributes: {
                retrievalPath: "community:fetch:url"
              }
            })]
          });
        }
        return makeAggregate({
          sourceSelection: "social",
          providerOrder: ["social/default"],
          records: [makeRecord({
            id: "bluesky-js-shell",
            source: "social",
            provider: "social/default",
            url: "https://bsky.app/search?q=browser+automation+blockers",
            title: "Bluesky search",
            content: "JavaScript is not available.",
            attributes: {
              retrievalPath: "social:fetch:url"
            }
          })]
        });
      }
    });

    await expect(runResearchWorkflow(runtime, {
      topic: "browser automation blockers",
      sourceSelection: "auto",
      days: 14,
      mode: "json"
    })).rejects.toThrow(
      "Research workflow produced only shell records and no usable results"
    );
  });

  it("fails research runs when sanitized survivors all fall outside the requested timebox without explicit provider failures", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [
          makeRecord({
            id: "duckduckgo-shell",
            source: "web",
            provider: "web/default",
            url: "https://html.duckduckgo.com/html",
            title: "https://html.duckduckgo.com/html",
            content: "browser automation blockers at DuckDuckGo",
            attributes: {
              retrievalPath: "web:search:index"
            }
          }),
          makeRecord({
            id: "historic-launch-roundup",
            source: "web",
            provider: "web/default",
            url: "https://example.com/agentic-browser-launches",
            title: "Agentic browser tooling launches roundup",
            content: "A detailed roundup of agentic browser tooling launches and operator workflows from earlier this quarter.",
            timestamp: isoHoursAgo(24 * 90),
            attributes: {
              retrievalPath: "web:fetch:url"
            }
          })
        ]
      })
    });

    await expect(runResearchWorkflow(runtime, {
      topic: "agentic browser tooling launches",
      sourceSelection: "web",
      from: isoHoursAgo(72),
      to: isoHoursAhead(1),
      mode: "json"
    })).rejects.toThrow(
      "Research workflow produced no usable in-timebox results after sanitization."
    );
  });

  it("caps research web follow-up fetches and ignores malformed search redirect urls", async () => {
    const fetch = vi.fn(async (input: { url: string }) => makeAggregate({
      sourceSelection: "web",
      providerOrder: ["web/default"],
      records: [makeRecord({
        id: input.url,
        source: "web",
        provider: "web/default",
        url: input.url,
        title: `Resolved ${input.url}`,
        content: "Coffee shop design inspiration with strong photography and typography.",
        attributes: {
          retrievalPath: "web:fetch:url"
        }
      })]
    }));
    const runtime = toRuntime({
      search: async (_input, options) => {
        const source = (options?.source ?? "web") as ProviderSource;
        if (source !== "web") {
          return makeAggregate({
            sourceSelection: source,
            providerOrder: [`${source}/default`],
            records: []
          });
        }
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [
            makeRecord({
              id: "bad-redirect-url",
              source: "web",
              provider: "web/default",
              url: "://bad",
              title: "https://duckduckgo.com/l?uddg=%3A%2F%2Fbad",
              content: "coffee shop website design inspiration",
              attributes: {
                retrievalPath: "web:search:index"
              }
            }),
            makeRecord({
              id: "ddg-1",
              source: "web",
              provider: "web/default",
              url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fone",
              title: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fone",
              content: "coffee shop website design inspiration",
              attributes: {
                retrievalPath: "web:search:index"
              }
            }),
            makeRecord({
              id: "ddg-2",
              source: "web",
              provider: "web/default",
              url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Ftwo",
              title: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Ftwo",
              content: "coffee shop website design inspiration",
              attributes: {
                retrievalPath: "web:search:index"
              }
            }),
            makeRecord({
              id: "ddg-3",
              source: "web",
              provider: "web/default",
              url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fthree",
              title: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fthree",
              content: "coffee shop website design inspiration",
              attributes: {
                retrievalPath: "web:search:index"
              }
            }),
            makeRecord({
              id: "ddg-4",
              source: "web",
              provider: "web/default",
              url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Ffour",
              title: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Ffour",
              content: "coffee shop website design inspiration",
              attributes: {
                retrievalPath: "web:search:index"
              }
            })
          ]
        });
      },
      fetch
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "coffee shop website design inspiration",
      sourceSelection: "auto",
      days: 30,
      mode: "json"
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(1, { url: "https://example.com/one" }, expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, { url: "https://example.com/two" }, expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(3, { url: "https://example.com/three" }, expect.any(Object));
    expect((output.records as Array<{ id: string }>).map((record) => record.id)).toHaveLength(3);
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

  it("refreshes metadata when shopping offers are missing structured price objects", () => {
    expect(workflowTestUtils.needsProductMetadataRefresh(makeRecord({
      title: "Resolved Product",
      attributes: {
        brand: "Acme",
        shopping_offer: "bad-shape"
      }
    }), "https://shop.example.com/product/acme")).toBe(true);

    expect(workflowTestUtils.needsProductMetadataRefresh(makeRecord({
      title: "Resolved Product",
      attributes: {
        brand: "Acme",
        shopping_offer: {
          price: "bad-shape"
        }
      }
    }), "https://shop.example.com/product/acme")).toBe(true);
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

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      { url: "https://www.amazon.com/dp/example" },
      expect.objectContaining({
        source: "shopping",
        providerIds: ["shopping/amazon"],
        suspendedIntent: expectWorkflowSuspendedIntent("product_video", {
          product_url: "https://www.amazon.com/dp/example"
        })
      })
    );

    await runProductVideoWorkflow(toRuntime({ fetch }), {
      product_url: "https://www.amazon.com/dp/example",
      provider_hint: "amazon",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      { url: "https://www.amazon.com/dp/example" },
      expect.objectContaining({
        source: "shopping",
        providerIds: ["shopping/amazon"],
        suspendedIntent: expectWorkflowSuspendedIntent("product_video", {
          product_url: "https://www.amazon.com/dp/example",
          provider_hint: "amazon"
        })
      })
    );
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
    expect(output.offers).toEqual([]);
    expect(output.meta).toMatchObject({
      metrics: {
        zero_price_excluded: 1
      }
    });
  });

  it("forwards explicit timeout overrides into shopping workflow searches", async () => {
    const search = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "timeout-forwarded",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/timeout-forwarded",
        title: "Timeout Forwarded Offer",
        content: "$29.99",
        attributes: {
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "timeout-forwarded",
            title: "Timeout Forwarded Offer",
            url: "https://www.amazon.com/dp/timeout-forwarded",
            price: { amount: 29.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.5,
            reviews_count: 14
          }
        }
      })]
    }));

    await runShoppingWorkflow(toRuntime({ search }), {
      query: "timeout forwarded",
      providers: ["shopping/amazon"],
      timeoutMs: 4321,
      mode: "json"
    });

    const searchOptions = search.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(searchOptions).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/amazon"]
    });
    expectBudgetedTimeout(searchOptions?.timeoutMs, 4321);
  });

  it("preserves shopping timeout failures in structured workflow output", async () => {
    const output = await runShoppingWorkflow(toRuntime({
      search: async () => makeAggregate({
        ok: false,
        records: [],
        partial: false,
        failures: [{
          provider: "shopping/ebay",
          source: "shopping",
          error: {
            code: "timeout",
            message: "Browser fallback timed out after 15000ms",
            retryable: true,
            details: {
              stage: "capture",
              timeoutMs: 15000
            }
          }
        }],
        metrics: {
          attempted: 1,
          succeeded: 0,
          failed: 1,
          retries: 0,
          latencyMs: 15000
        },
        sourceSelection: "shopping",
        providerOrder: ["shopping/ebay"],
        error: {
          code: "timeout",
          message: "Browser fallback timed out after 15000ms",
          retryable: true,
          details: {
            stage: "capture",
            timeoutMs: 15000
          }
        }
      })
    }), {
      query: "portable monitor",
      providers: ["shopping/ebay"],
      mode: "json"
    });

    expect(output.offers).toEqual([]);
    expect(output.meta).toMatchObject({
      failures: [{
        provider: "shopping/ebay",
        error: {
          code: "timeout",
          retryable: true,
          details: {
            stage: "capture",
            timeoutMs: 15000
          }
        }
      }],
      metrics: {
        total_offers: 0,
        failed_providers: ["shopping/ebay"]
      }
    });
  });

  it("forwards explicit shopping browser-mode overrides into provider run options", async () => {
    const search = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "browser-mode-forwarded",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/browser-mode-forwarded",
        title: "Browser Mode Forwarded",
        content: "$49.99",
        attributes: {
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "browser-mode-forwarded",
            title: "Browser Mode Forwarded",
            url: "https://www.amazon.com/dp/browser-mode-forwarded",
            price: { amount: 49.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.4,
            reviews_count: 12
          }
        }
      })]
    }));

    const extensionOutput = await runShoppingWorkflow(toRuntime({ search }), {
      query: "browser mode extension",
      providers: ["shopping/amazon"],
      browserMode: "extension",
      mode: "json"
    });
    const managedOutput = await runShoppingWorkflow(toRuntime({ search }), {
      query: "browser mode managed",
      providers: ["shopping/amazon"],
      browserMode: "managed",
      mode: "json"
    });
    const autoOutput = await runShoppingWorkflow(toRuntime({ search }), {
      query: "browser mode auto",
      providers: ["shopping/amazon"],
      browserMode: "auto",
      mode: "json"
    });

    const extensionCall = search.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    const managedCall = search.mock.calls[1]?.[1] as Record<string, unknown> | undefined;
    const autoCall = search.mock.calls[2]?.[1] as Record<string, unknown> | undefined;

    expect(extensionCall).toBeDefined();
    expect(extensionCall).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/amazon"],
      runtimePolicy: {
        browserMode: "extension"
      }
    });
    expect(managedCall).toBeDefined();
    expect(managedCall).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/amazon"],
      runtimePolicy: {
        browserMode: "managed"
      }
    });
    expect(autoCall).toBeDefined();
    expect(autoCall).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/amazon"],
      runtimePolicy: {
        browserMode: "auto"
      }
    });
    for (const callOptions of [extensionCall, managedCall, autoCall]) {
      expect(callOptions).not.toHaveProperty("preferredFallbackModes");
      expect(callOptions).not.toHaveProperty("forceBrowserTransport");
    }
    expect(extensionOutput.meta).toMatchObject({
      selection: {
        requested_browser_mode: "extension"
      },
      metrics: {
        browser_fallback_modes_observed: []
      }
    });
    expect(managedOutput.meta).toMatchObject({
      selection: {
        requested_browser_mode: "managed"
      },
      metrics: {
        browser_fallback_modes_observed: []
      }
    });
    expect(autoOutput.meta).toMatchObject({
      selection: {
        requested_browser_mode: "auto"
      },
      metrics: {
        browser_fallback_modes_observed: []
      }
    });
  });

  it("resumes shopping without replaying completed provider searches", async () => {
    const resumeNowMs = Date.parse("2026-03-30T22:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => resumeNowMs);
    let searchOptions: Record<string, unknown> | undefined;
    const search = vi.fn(async (input, options) => {
      searchOptions = options as Record<string, unknown>;
      expect(options?.providerIds).toEqual(["shopping/walmart"]);
      return makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/walmart"],
        records: [makeRecord({
          id: "resume-walmart",
          source: "shopping",
          provider: "shopping/walmart",
          url: "https://www.walmart.com/ip/resume-walmart",
          title: input.query,
          content: "$24.99",
          attributes: {
            shopping_offer: {
              provider: "shopping/walmart",
              product_id: "resume-walmart",
              title: input.query,
              url: "https://www.walmart.com/ip/resume-walmart",
              price: { amount: 24.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.1,
              reviews_count: 8
            }
          }
        })]
      });
    });

    const checkpointedAmazonResult = makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "resume-amazon",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/resume-amazon",
        title: "Resume Amazon",
        content: "$19.99",
        attributes: {
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "resume-amazon",
            title: "Resume Amazon",
            url: "https://www.amazon.com/dp/resume-amazon",
            price: { amount: 19.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.8,
            reviews_count: 18
          }
        }
      })]
    });

    const envelope = buildWorkflowResumeEnvelope("shopping", {
      query: "resume without replay",
      providers: ["shopping/amazon", "shopping/walmart"],
      mode: "json",
      timeoutMs: 4321,
      browserMode: "extension",
      useCookies: true,
      challengeAutomationMode: "browser_with_helper",
      cookiePolicyOverride: "required"
    } as unknown as JsonValue, {
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
    });

    const output = await runShoppingWorkflow(toRuntime({ search }), envelope);

    expect(search).toHaveBeenCalledTimes(1);
    expect(searchOptions).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/walmart"],
      runtimePolicy: {
        browserMode: "extension",
        useCookies: true,
        challengeAutomationMode: "browser_with_helper",
        cookiePolicyOverride: "required"
      },
      suspendedIntent: {
        kind: "workflow.shopping",
        input: {
          workflow: {
            checkpoint: {
              state: {
                completed_step_ids: ["search:shopping/amazon"]
              }
            }
          }
        }
      }
    });
    expectBudgetedTimeout(searchOptions?.timeoutMs, 4321);
    expect((output.offers as Array<{ provider: string }>).map((offer) => offer.provider)).toEqual(
      expect.arrayContaining(["shopping/amazon", "shopping/walmart"])
    );
  });

  it("forwards timeout, browser mode, and cookie overrides through shopping search and derived fetch steps", async () => {
    let nowMs = Date.parse("2026-04-08T12:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    let searchOptions: Record<string, unknown> | undefined;
    let fetchOptions: Record<string, unknown> | undefined;
    const search = vi.fn(async (_input, options) => {
      searchOptions = options as Record<string, unknown>;
      const result = makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "derived-fetch-search-index",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/s?k=derived+fetch",
          title: "Search Results",
          attributes: {
            retrievalPath: "shopping:search:index",
            links: ["https://www.amazon.com/dp/DERIVEDFETCH001"]
          }
        })]
      });
      nowMs += 250;
      return result;
    });
    const fetch = vi.fn(async (_input, options) => {
      fetchOptions = options as Record<string, unknown>;
      return makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "derived-fetch-offer",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/DERIVEDFETCH001",
          title: "Derived Fetch Offer",
          content: "$59.99",
          attributes: {
            retrievalPath: "shopping:search:result-card",
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "DERIVEDFETCH001",
              title: "Derived Fetch Offer",
              url: "https://www.amazon.com/dp/DERIVEDFETCH001",
              price: { amount: 59.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.6,
              reviews_count: 16
            }
          }
        })]
      });
    });

    const output = await runShoppingWorkflow(toRuntime({ search, fetch }), {
      query: "derived fetch",
      providers: ["shopping/amazon"],
      timeoutMs: 4321,
      browserMode: "extension",
      useCookies: true,
      challengeAutomationMode: "browser_with_helper",
      cookiePolicyOverride: "required",
      mode: "json"
    });

    expect(searchOptions).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/amazon"],
      timeoutMs: 4321,
      runtimePolicy: {
        browserMode: "extension",
        useCookies: true,
        challengeAutomationMode: "browser_with_helper",
        cookiePolicyOverride: "required"
      },
      suspendedIntent: {
        kind: "workflow.shopping",
        input: {
          workflow: {
            checkpoint: {
              stepId: "search:shopping/amazon",
              state: {
                completed_step_ids: []
              }
            }
          }
        }
      }
    });
    expect(fetchOptions).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/amazon"],
      runtimePolicy: {
        browserMode: "extension",
        useCookies: true,
        challengeAutomationMode: "browser_with_helper",
        cookiePolicyOverride: "required"
      },
      suspendedIntent: {
        kind: "workflow.shopping",
        input: {
          workflow: {
            checkpoint: {
              state: {
                completed_step_ids: ["search:shopping/amazon"]
              }
            }
          }
        }
      }
    });
    expect(fetchOptions?.timeoutMs).toBe(4071);
    expect((output.offers as Array<{ provider: string }>)[0]?.provider).toBe("shopping/amazon");
  });

  it("keeps auto shopping preserved extension challenges as single-run manual-yield outcomes", async () => {
    const search = vi.fn(async (_input, options) => {
      const providerId = options?.providerIds?.[0] ?? "shopping/walmart";
      return makeAggregate({
        ok: false,
        sourceSelection: "shopping",
        providerOrder: [providerId],
        failures: [makeFailure(providerId, "shopping", {
          code: "unavailable",
          message: "challenge remains active",
          reasonCode: "challenge_detected",
          provider: providerId,
          source: "shopping",
          details: {
            disposition: "challenge_preserved",
            browserFallbackMode: "extension",
            browserFallbackReasonCode: "challenge_detected",
            preservedSessionId: "preserved-session-1",
            preservedTargetId: "tab-123",
            challengeOrchestration: {
              mode: "browser_with_helper",
              source: "config",
              status: "deferred"
            }
          }
        })],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      });
    });

    const output = await runShoppingWorkflow(toRuntime({ search }), {
      query: "macbook pro m4 32gb ram",
      providers: ["shopping/walmart"],
      browserMode: "auto",
      mode: "json"
    });

    expect(search).toHaveBeenCalledTimes(1);
    const autoCall = search.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(autoCall).toBeDefined();
    expect(autoCall).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/walmart"]
    });
    expect(autoCall).not.toHaveProperty("preferredFallbackModes");
    expect(autoCall).not.toHaveProperty("forceBrowserTransport");
    expect(output.offers).toEqual([]);
    expect(output.meta).toMatchObject({
      selection: {
        requested_browser_mode: "auto"
      },
      metrics: {
        browser_fallback_modes_observed: ["extension"]
      },
      failures: [{
        provider: "shopping/walmart",
        error: {
          reasonCode: "challenge_detected",
          details: {
            disposition: "challenge_preserved",
            browserFallbackMode: "extension",
            preservedSessionId: "preserved-session-1",
            preservedTargetId: "tab-123"
          }
        }
      }]
    });
  });

  it("forwards explicit timeout overrides through product-video search and fetch", async () => {
    const search = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "product-timeout-forwarded-search",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/product-timeout-forwarded",
        title: "Product Timeout Forwarded",
        content: "$39.99",
        attributes: {
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "product-timeout-forwarded-search",
            title: "Product Timeout Forwarded",
            url: "https://www.amazon.com/dp/product-timeout-forwarded",
            price: { amount: 39.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.7,
            reviews_count: 18
          }
        }
      })]
    }));
    const fetch = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "product-timeout-forwarded-fetch",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/product-timeout-forwarded",
        title: "Product Timeout Forwarded",
        content: "Feature one with enough detail. Feature two with enough detail.",
        attributes: {
          links: [],
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "product-timeout-forwarded-fetch",
            title: "Product Timeout Forwarded",
            url: "https://www.amazon.com/dp/product-timeout-forwarded",
            price: { amount: 39.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.7,
            reviews_count: 18
          }
        }
      })]
    }));

    await runProductVideoWorkflow(toRuntime({ search, fetch }), {
      product_name: "product timeout forwarded",
      provider_hint: "amazon",
      timeoutMs: 4321,
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    const searchOptions = search.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(searchOptions).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/amazon"],
      suspendedIntent: expectWorkflowSuspendedIntent("shopping", {
        query: "product timeout forwarded",
        providers: ["amazon"],
        mode: "json",
        timeoutMs: 4321
      })
    });
    expectBudgetedTimeout(searchOptions?.timeoutMs, 4321);
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.amazon.com/dp/product-timeout-forwarded" },
      expect.objectContaining({
        source: "shopping",
        providerIds: ["shopping/amazon"],
        timeoutMs: 4321,
        suspendedIntent: expectWorkflowSuspendedIntent("product_video", {
          product_name: "product timeout forwarded",
          provider_hint: "amazon",
          timeoutMs: 4321
        })
      })
    );
  });

  it("forwards runtime-policy overrides through product-video resolution and detail fetch", async () => {
    const search = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "product-runtime-policy-forwarded-search",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/product-runtime-policy-forwarded",
        title: "Product Runtime Policy Forwarded",
        content: "$44.99",
        attributes: {
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "product-runtime-policy-forwarded-search",
            title: "Product Runtime Policy Forwarded",
            url: "https://www.amazon.com/dp/product-runtime-policy-forwarded",
            price: { amount: 44.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.5,
            reviews_count: 19
          }
        }
      })]
    }));
    const fetch = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "product-runtime-policy-forwarded-fetch",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/product-runtime-policy-forwarded",
        title: "Product Runtime Policy Forwarded",
        content: "Feature one with enough detail. Feature two with enough detail.",
        attributes: {
          links: [],
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "product-runtime-policy-forwarded-fetch",
            title: "Product Runtime Policy Forwarded",
            url: "https://www.amazon.com/dp/product-runtime-policy-forwarded",
            price: { amount: 44.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.5,
            reviews_count: 19
          }
        }
      })]
    }));

    await runProductVideoWorkflow(toRuntime({ search, fetch }), {
      product_name: "product runtime policy forwarded",
      provider_hint: "amazon",
      timeoutMs: 4321,
      useCookies: true,
      challengeAutomationMode: "browser_with_helper",
      cookiePolicyOverride: "required",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    const searchOptions = search.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(searchOptions).toMatchObject({
      source: "shopping",
      providerIds: ["shopping/amazon"],
      runtimePolicy: {
        useCookies: true,
        challengeAutomationMode: "browser_with_helper",
        cookiePolicyOverride: "required"
      },
      suspendedIntent: expectWorkflowSuspendedIntent("shopping", {
        query: "product runtime policy forwarded",
        providers: ["amazon"],
        mode: "json",
        timeoutMs: 4321,
        useCookies: true,
        challengeAutomationMode: "browser_with_helper",
        cookiePolicyOverride: "required"
      })
    });
    expectBudgetedTimeout(searchOptions?.timeoutMs, 4321);
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.amazon.com/dp/product-runtime-policy-forwarded" },
      expect.objectContaining({
        source: "shopping",
        providerIds: ["shopping/amazon"],
        timeoutMs: 4321,
        runtimePolicy: {
          useCookies: true,
          challengeAutomationMode: "browser_with_helper",
          cookiePolicyOverride: "required"
        },
        suspendedIntent: expectWorkflowSuspendedIntent("product_video", {
          product_name: "product runtime policy forwarded",
          provider_hint: "amazon",
          timeoutMs: 4321,
          useCookies: true,
          challengeAutomationMode: "browser_with_helper",
          cookiePolicyOverride: "required"
        })
      })
    );
  });

  it("validates product-video prerequisites and unresolved name flows", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({ sourceSelection: "shopping", providerOrder: ["shopping/amazon"] })
    });

    await expect(runProductVideoWorkflow(runtime, {})).rejects.toThrow("product_url or product_name is required");

    await expect(runProductVideoWorkflow(runtime, {
      product_name: "sample"
    })).rejects.toThrow(
      "Amazon requires manual browser follow-up; this run did not determine whether login or page rendering is required."
    );

    await expect(runProductVideoWorkflow(runtime, {
      product_url: "not-a-url"
    })).rejects.toThrow("product_url must be an http(s) URL");

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

  it("prefers shopping constraint summaries when product-name resolution returns no offers", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        ok: false,
        sourceSelection: "shopping",
        providerOrder: ["shopping/target"],
        failures: [makeFailure("shopping/target", "shopping", {
          code: "unavailable",
          message: "Browser assistance required",
          retryable: true,
          reasonCode: "env_limited",
          details: {
            blockerType: "env_limited",
            providerShell: "target_shell_page",
            constraint: {
              kind: "render_required",
              evidenceCode: "target_shell_page"
            }
          }
        })],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    await expect(runProductVideoWorkflow(runtime, {
      product_name: "ergonomic wireless mouse",
      provider_hint: "shopping/target"
    })).rejects.toThrow("Target requires a live browser-rendered page.");
  });

  it("rejects obvious 404 product targets before metadata refresh or asset fetches", async () => {
    const auxiliaryFetch = vi.fn(async () => ({
      ok: true,
      url: "https://www.shoott.com/headshots",
      text: async () => "<html></html>",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    }));
    vi.stubGlobal("fetch", auxiliaryFetch as unknown as typeof fetch);

    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "shoott-404",
          source: "web",
          provider: "web/default",
          url: "https://www.shoott.com/headshots",
          title: "Shoott | 404",
          content: "Error 404 We can’t seem to find the page you were looking for.",
          attributes: {
            status: 404,
            links: ["https://cdn.example.com/404-image.jpg"]
          }
        })]
      })
    });

    await expect(runProductVideoWorkflow(runtime, {
      product_url: "https://www.shoott.com/headshots",
      include_screenshots: true,
      include_all_images: true,
      include_copy: true
    })).rejects.toThrow("Product target appears to be a not-found page");
    expect(auxiliaryFetch).not.toHaveBeenCalled();
  });

  it("rejects strong not-found product targets even when the fetch response omits status metadata", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "shoott-not-found-copy",
          source: "web",
          provider: "web/default",
          url: "https://www.shoott.com/headshots",
          title: "Shoott | 404",
          content: "We can’t seem to find the page you were looking for. Return to homepage.",
          attributes: {
            links: ["https://cdn.example.com/404-image.jpg"]
          }
        })]
      })
    });

    await expect(runProductVideoWorkflow(runtime, {
      product_url: "https://www.shoott.com/headshots",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    })).rejects.toThrow("Product target appears to be a not-found page");
  });

  it("threads provider hints into product-name shopping resolution before fetching the product page", async () => {
    const search = vi.fn(async (_input, options) => {
      expect(options).toMatchObject({
        source: "shopping",
        providerIds: ["shopping/amazon"],
        suspendedIntent: expectWorkflowSuspendedIntent("shopping", {
          query: "hint resolved product",
          providers: ["amazon"],
          mode: "json"
        })
      });
      return makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "provider-hint-resolution",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/B0HINT00001",
          title: "Hint Resolved Product",
          content: "$41.99",
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "provider-hint-resolution",
              title: "Hint Resolved Product",
              url: "https://www.amazon.com/dp/B0HINT00001",
              price: { amount: 41.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.6,
              reviews_count: 27
            }
          }
        })]
      });
    });
    const fetch = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "provider-hint-fetch",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/B0HINT00001",
        title: "Hint Resolved Product",
        content: "$41.99",
        attributes: {
          links: [],
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "provider-hint-fetch",
            title: "Hint Resolved Product",
            url: "https://www.amazon.com/dp/B0HINT00001",
            price: { amount: 41.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.6,
            reviews_count: 27
          }
        }
      })]
    }));

    const output = await runProductVideoWorkflow(toRuntime({ search, fetch }), {
      product_name: "hint resolved product",
      provider_hint: "amazon",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.amazon.com/dp/B0HINT00001" },
      expect.objectContaining({
        source: "shopping",
        providerIds: ["shopping/amazon"],
        suspendedIntent: expectWorkflowSuspendedIntent("product_video", {
          product_name: "hint resolved product",
          provider_hint: "amazon"
        })
      })
    );
    expect((output.product as { provider: string }).provider).toBe("shopping/amazon");
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
          url: "https://example.com/fallback-product",
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
              url: "https://example.com/fallback-product",
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
      product_url: "https://example.com/fallback-product",
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

  it("uses captured screenshots directly when the browser capture succeeds", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "product-screenshot-direct",
          source: "web",
          provider: "web/default",
          url: "https://shop.example/direct-screenshot",
          title: "Direct Screenshot Product",
          content: "Feature alpha with enough detail. Feature beta with enough detail.",
          attributes: {
            links: [],
            brand: "Acme",
            shopping_offer: {
              provider: "shopping/others",
              product_id: "direct-screenshot",
              title: "Direct Screenshot Product",
              url: "https://shop.example/direct-screenshot",
              price: { amount: 32, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.4,
              reviews_count: 12
            }
          }
        })]
      })
    });

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://shop.example/direct-screenshot",
      include_screenshots: true,
      include_all_images: false,
      include_copy: false
    }, {
      captureScreenshot: async () => Buffer.from([9, 8, 7, 6])
    });

    expect(output.images).toEqual([]);
    expect(output.screenshots).toEqual(["screenshots/screenshot-01.png"]);
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

  it("defaults product-video image extensions to jpg when source urls omit one", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "product-no-extension-image",
          source: "web",
          provider: "web/default",
          url: "https://shop.example/item",
          title: "https://shop.example/item",
          content: "Feature alpha with enough detail. Feature beta with enough detail.",
          attributes: {
            shopping_offer: {
              provider: "shopping/others",
              product_id: "p-no-extension",
              title: "https://shop.example/item",
              url: "https://shop.example/item",
              price: { amount: 0, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.2,
              reviews_count: 9
            }
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://shop.example/item") {
        return {
          ok: true,
          url,
          text: async () => `
            <html>
              <head>
                <meta property="og:image" content="https://cdn.example.com/assets/no-extension-image" />
              </head>
              <body>No extension image metadata</body>
            </html>
          `
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      };
    }) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://shop.example/item",
      include_screenshots: false,
      include_all_images: true,
      include_copy: false
    });

    expect(output.images).toEqual(["images/image-01.jpg"]);
  });

  it("uses structured shopping image urls without file extensions before metadata refresh", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/bestbuy"],
        records: [makeRecord({
          id: "bestbuy-no-extension-image",
          source: "shopping",
          provider: "shopping/bestbuy",
          url: "https://www.bestbuy.com/site/sample-product/6501234.p?skuId=6501234",
          title: "Sample Best Buy Product",
          content: "Feature alpha with enough detail. Feature beta with enough detail.",
          attributes: {
            brand: "Best Buy",
            image_urls: [
              "https://pisces.bbystatic.com/image2/BestBuy_US/images/products/6501/6501234_sa"
            ],
            shopping_offer: {
              provider: "shopping/bestbuy",
              product_id: "6501234",
              title: "Sample Best Buy Product",
              url: "https://www.bestbuy.com/site/sample-product/6501234.p?skuId=6501234",
              price: { amount: 89.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.6,
              reviews_count: 51
            }
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://www.bestbuy.com/site/sample-product/6501234.p?skuId=6501234",
      include_screenshots: false,
      include_all_images: true,
      include_copy: false
    });

    expect(output.images).toEqual(["images/image-01.jpg"]);
    expect(output.screenshots).toEqual([]);
  });

  it("prefers structured metadata over noisy raw copy in product-video outputs", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "apple-product",
          source: "web",
          provider: "web/default",
          url: "https://www.apple.com/shop/buy-iphone/iphone-16",
          title: "Buy iPhone 16 and iPhone 16 Plus",
          content: "Save up to $441.36. No trade-in needed. This is noisy promotional copy.",
          attributes: {
            description: "Get $35 - $685 off a new iPhone 16 or iPhone 16 Plus when you trade in an iPhone 8 or newer. 0% financing available. Buy now with free shipping.",
            brand: "Apple",
            features: [
              "Apple Intelligence",
              "Camera Control for faster access to photo and video tools"
            ],
            image_urls: ["https://store.storeimages.cdn-apple.com/iphone-16.jpg"],
            shopping_offer: {
              provider: "web/default",
              product_id: "",
              title: "Buy iPhone 16 and iPhone 16 Plus",
              url: "https://www.apple.com/shop/buy-iphone/iphone-16",
              price: { amount: 699, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "unknown",
              rating: 0,
              reviews_count: 0
            }
          }
        })]
      })
    });

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://www.apple.com/shop/buy-iphone/iphone-16",
      include_screenshots: false,
      include_all_images: false,
      include_copy: true
    });

    expect(output.pricing).toMatchObject({
      amount: 699,
      currency: "USD"
    });
    expect(output.product).toMatchObject({
      title: "Buy iPhone 16 and iPhone 16 Plus",
      brand: "Apple",
      features: [
        "Apple Intelligence",
        "Camera Control for faster access to photo and video tools"
      ],
      copy: "Get $35 - $685 off a new iPhone 16 or iPhone 16 Plus when you trade in an iPhone 8 or newer. 0% financing available. Buy now with free shipping."
    });
  });

  it("refreshes weak product metadata before building product-video outputs", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "apple-weak-product",
          source: "web",
          provider: "web/default",
          url: "https://www.apple.com/shop/buy-iphone/iphone-16",
          title: "https://www.apple.com/shop/buy-iphone/iphone-16",
          content: "Save up to $441.36. No trade-in needed. Frequently Asked Questions. Carrier deals everywhere.",
          attributes: {
            links: []
          }
        })]
      })
    });

    const seenSignals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL, init?: RequestInit) => {
      if (init?.signal) {
        seenSignals.push(init.signal);
      }
      const accept = String(init?.headers && "accept" in (init.headers as Record<string, string>)
        ? (init.headers as Record<string, string>).accept
        : "");
      if (accept.includes("text/html")) {
        return {
          ok: true,
          url: "https://www.apple.com/shop/buy-iphone/iphone-16",
          text: async () => `
            <html>
              <head>
                <title>Buy iPhone 16 and iPhone 16 Plus - Apple</title>
                <meta property="og:title" content="Buy iPhone 16 and iPhone 16 Plus" />
                <meta property="og:description" content="Get $35 - $685 off a new iPhone 16 or iPhone 16 Plus when you trade in an iPhone 8 or newer. 0% financing available. Buy now with free shipping." />
                <meta property="og:site_name" content="Apple" />
                <meta property="og:image" content="https://store.storeimages.cdn-apple.com/iphone-16.jpg" />
                <script type="application/ld+json">
                  {
                    "@context": "https://schema.org",
                    "@type": "Product",
                    "name": "iPhone 16",
                    "url": "https://www.apple.com/shop/buy-iphone/iphone-16",
                    "offers": [{ "@type": "AggregateOffer", "lowPrice": 699.00, "priceCurrency": "USD" }],
                    "description": "Get $35 - $685 off a new iPhone 16 or iPhone 16 Plus when you trade in an iPhone 8 or newer. 0% financing available. Buy now with free shipping."
                  }
                </script>
              </head>
              <body>
                <div class="dd-feature"><p>Apple Intelligence</p></div>
                <div class="dd-feature"><p>Camera Control for faster access to photo and video tools</p></div>
              </body>
            </html>
          `
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([5, 6, 7]).buffer
      };
    }) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://www.apple.com/shop/buy-iphone/iphone-16",
      timeoutMs: 4321,
      include_screenshots: false,
      include_all_images: false,
      include_copy: true
    });

    expect(output.pricing).toMatchObject({
      amount: 699,
      currency: "USD"
    });
    expect(output.product).toMatchObject({
      title: "Buy iPhone 16 and iPhone 16 Plus",
      brand: "Apple",
      features: [
        "Apple Intelligence",
        "Camera Control for faster access to photo and video tools"
      ],
      copy: "Get $35 - $685 off a new iPhone 16 or iPhone 16 Plus when you trade in an iPhone 8 or newer. 0% financing available. Buy now with free shipping."
    });
    expect(output.images).toEqual(["images/image-01.jpg"]);
    expect(seenSignals.length).toBeGreaterThan(0);
  });

  it("compacts refreshed image urls after skipping empty entries in product-video assets", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "empty-refreshed-image-product",
          source: "web",
          provider: "web/default",
          url: "https://shop.example/refreshed-images",
          title: "https://shop.example/refreshed-images",
          content: "Buy now for $249.00 with the travel keyboard included.",
          attributes: {
            links: []
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const accept = String(init?.headers && "accept" in (init.headers as Record<string, string>)
        ? (init.headers as Record<string, string>).accept
        : "");
      if (accept.includes("text/html")) {
        return {
          ok: true,
          url: "https://shop.example/refreshed-images",
          text: async () => `
            <html>
              <head>
                <meta property="og:title" content="Refreshed Image Product" />
                <meta property="og:description" content="Detachable keyboard and bright matte display." />
                <meta property="og:image" content="" />
                <meta property="og:image" content="https://cdn.example.com/refreshed-image.png" />
              </head>
              <body></body>
            </html>
          `
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer
      };
    }) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://shop.example/refreshed-images",
      include_screenshots: true,
      include_all_images: true,
      include_copy: false
    }, {
      captureScreenshot: async () => null
    });

    expect(output.images).toEqual(["images/image-01.jpg"]);
    expect(output.screenshots).toEqual(["screenshots/screenshot-01.png"]);
  });

  it("falls back cleanly when weak product metadata refresh fails", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "refresh-failure-product",
          source: "web",
          provider: "web/default",
          url: "https://www.apple.com/shop/buy-iphone/iphone-16",
          title: "https://www.apple.com/shop/buy-iphone/iphone-16",
          content: "Buy now for $699. Super Retina XDR display keeps colors visible outdoors.",
          attributes: {
            description: "Fallback description title. Additional backup copy survives."
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      text: async () => ""
    })) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://www.apple.com/shop/buy-iphone/iphone-16",
      include_screenshots: false,
      include_all_images: false,
      include_copy: true
    });

    expect(output.pricing).toMatchObject({
      amount: 699,
      currency: "USD"
    });
    expect(output.product).toMatchObject({
      title: "Fallback description title.",
      brand: "Apple",
      copy: "Fallback description title. Additional backup copy survives."
    });
    expect(output.images).toEqual([]);
  });

  it("uses site_name brand fallback and preserves the product url when refreshed metadata stays empty", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/others"],
        records: [makeRecord({
          id: "site-name-fallback-product",
          source: "shopping",
          provider: "shopping/others",
          url: "https://brandless.example/item",
          title: "https://brandless.example/item",
          content: undefined,
          attributes: {
            site_name: "Acme Surface",
            shopping_offer: {
              provider: "shopping/others",
              product_id: "site-name-fallback",
              title: "",
              url: "https://brandless.example/item",
              price: { amount: 0, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "std" },
              availability: "unknown",
              rating: 0,
              reviews_count: 0
            }
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      url: "",
      text: async () => "<html><body><main></main></body></html>"
    })) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://brandless.example/item",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect(output.product).toMatchObject({
      brand: "Acme Surface",
      title: "https://brandless.example/item",
      copy: ""
    });
    expect(output.images).toEqual([]);
    expect(output.screenshots).toEqual([]);
  });

  it("fails honestly when storefront chrome leaves only a polluted marketplace overlay price on a marketplace PDP", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "marketplace-overlay-product",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/B0CHWRXH8B",
          title: "Amazon.com: Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging : Electronics",
          content: [
            "Shipper / Seller mrhumanitygives.com",
            "See current price, availability, shipping cost, and delivery date on mrhumanitygives.com.",
            "Continue to site.",
            "Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging, White",
            "Visit the Apple Store",
            "Brand Apple",
            "About this item",
            "RICHER AUDIO EXPERIENCE - The Apple-designed H2 chip helps to create more intelligent noise cancellation and deeply immersive sound.",
            "NEXT-LEVEL ACTIVE NOISE CANCELLATION - Up to 2x more Active Noise Cancellation for dramatically less noise when you want to focus.",
            "Report an issue with this product or seller",
            "About this item From the Brand From the Author Similar Product information Questions Reviews"
          ].join(" "),
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "B0CHWRXH8B",
              title: "Amazon.com: Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging : Electronics",
              url: "https://www.amazon.com/dp/B0CHWRXH8B",
              price: { amount: 36.25, currency: "CAD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "CAD", notes: "unknown" },
              availability: "out_of_stock",
              rating: 4.7,
              reviews_count: 28_597
            }
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      url: "https://www.amazon.com/dp/B0CHWRXH8B",
      text: async () => [
        "<html><head>",
        "<title>Amazon.com: Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging : Electronics</title>",
        "<meta property=\"og:site_name\" content=\"Amazon\" />",
        "<meta name=\"description\" content=\"Shipper / Seller Main content\" />",
        "</head><body>",
        "<ul>",
        "<li>Shipper / Seller</li>",
        "<li>Main content</li>",
        "<li>About this item</li>",
        "<li>Buying options</li>",
        "<li>Compare with similar items</li>",
        "</ul>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    await expect(runProductVideoWorkflow(runtime, {
      product_url: "https://www.amazon.com/dp/B0CHWRXH8B",
      include_screenshots: false,
      include_all_images: false,
      include_copy: true
    })).rejects.toThrow(
      "Amazon requires manual browser follow-up; this run did not determine a reliable PDP price."
    );
  });

  it("uses refreshed trustworthy PDP pricing after suppressing a polluted marketplace overlay price", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "marketplace-overlay-refreshed-price",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/B0CHWRXH8B",
          title: "Amazon.com: Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging : Electronics",
          content: [
            "Shipper / Seller mrhumanitygives.com",
            "See current price, availability, shipping cost, and delivery date on mrhumanitygives.com.",
            "Continue to site.",
            "Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging, White",
            "Visit the Apple Store",
            "Brand Apple",
            "About this item",
            "RICHER AUDIO EXPERIENCE - The Apple-designed H2 chip helps to create more intelligent noise cancellation and deeply immersive sound.",
            "NEXT-LEVEL ACTIVE NOISE CANCELLATION - Up to 2x more Active Noise Cancellation for dramatically less noise when you want to focus.",
            "Report an issue with this product or seller"
          ].join(" "),
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "B0CHWRXH8B",
              title: "Amazon.com: Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging : Electronics",
              url: "https://www.amazon.com/dp/B0CHWRXH8B",
              price: { amount: 36.25, currency: "CAD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "CAD", notes: "unknown" },
              availability: "out_of_stock",
              rating: 4.7,
              reviews_count: 28_597
            }
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      url: "https://www.amazon.com/dp/B0CHWRXH8B",
      text: async () => [
        "<html><head>",
        "<title>Amazon.com: Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging : Electronics</title>",
        "<meta property=\"og:site_name\" content=\"Amazon\" />",
        "<meta name=\"description\" content=\"Apple AirPods Pro (2nd Generation) with USB-C deliver adaptive audio and all-day comfort.\" />",
        "<script type=\"application/ld+json\">",
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging",
          brand: { "@type": "Brand", name: "Apple" },
          offers: { "@type": "Offer", price: 249.99, priceCurrency: "USD" },
          description: "Apple AirPods Pro (2nd Generation) with USB-C deliver adaptive audio and all-day comfort."
        }),
        "</script>",
        "</head><body>",
        "<ul>",
        "<li>The Apple-designed H2 chip helps to create more intelligent noise cancellation and deeply immersive sound.</li>",
        "<li>Up to 2x more Active Noise Cancellation for dramatically less noise when you want to focus.</li>",
        "</ul>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://www.amazon.com/dp/B0CHWRXH8B",
      include_screenshots: false,
      include_all_images: false,
      include_copy: true
    });

    expect(output.pricing).toMatchObject({
      amount: 249.99,
      currency: "USD"
    });
    expect(output.product).toMatchObject({
      brand: "Apple",
      title: "Apple AirPods Pro (2nd Generation) Wireless Ear Buds with USB-C Charging",
      copy: "Apple AirPods Pro (2nd Generation) with USB-C deliver adaptive audio and all-day comfort."
    });
    expect((output.product as { features: string[] }).features).toEqual([
      "The Apple-designed H2 chip helps to create more intelligent noise cancellation and deeply immersive sound.",
      "Up to 2x more Active Noise Cancellation for dramatically less noise when you want to focus."
    ]);
  });

  it("prefers Walmart key item features over retailer branding, specs, and shipping chrome", async () => {
    const productUrl = "https://www.walmart.com/ip/FIFINE-USB-Microphone-for-Recording-Computer-Condenser-Mic-Plug-Play-in-PC-Laptop-for-Meeting-Voice-Overs-Black-K669/5635598352?adsRedirect=true&classType=VARIANT";
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/walmart"],
        records: [makeRecord({
          id: "walmart-feature-section-product",
          source: "shopping",
          provider: "shopping/walmart",
          url: productUrl,
          title: "Free Shipping! FIFINE USB Microphone for PC PS5 Gaming Streaming Recording with Gain Control Metal Condenser - Walmart.com",
          content: [
            "Pickup or delivery? Cancel",
            "Visit the FIFINE Store",
            "FIFINE K669B USB Microphone for PC, Laptop, PS5 Gaming, Metal Condenser Microphone with Gain Control for Streaming, Vocal Recording, Online Meetings",
            "Key item features",
            "Clear Audio : Durable metal construction and a 16mm capsule reduce vibrations and focus on mouth sounds, rejecting 70% of fan/AC noise for clear output.",
            "Precise Control : An integrated volume knob allows for smooth and stable sound adjustment, enabling precise volume setting for meetings or voice recording without software.",
            "Robust Build : Features a solid, sturdy metal design with a stable tripod stand, making it convenient for voice-overs or livestreams.",
            "Universal Connectivity : Comes with a Type-B to Type-C USB cable, offering plug-and-play compatibility with PC, PS4, and PS5 for gaming or recording.",
            "Portable Design : The PC microphone is only 4.8 inches long, lightweight, and portable, suitable for urgent meetings during business trips or outdoor communication.",
            "Included Accessories : The box contains one condenser microphone with a USB cable, one tripod stand, and a user manual.",
            "Technical Specifications : Model K669B is a cardioid condenser microphone with a USB connector, a frequency range of 80Hz-20KHz, and -43±3dB sensitivity.",
            "View all item details Generated by AI Specs Connection USB Microphone polar pattern Cardioid Mic tech Condenser",
            "Departments Services"
          ].join(" "),
          attributes: {
            brand: "Walmart.com",
            shopping_offer: {
              provider: "shopping/walmart",
              product_id: "5635598352",
              title: "Free Shipping! FIFINE USB Microphone for PC PS5 Gaming Streaming Recording with Gain Control Metal Condenser - Walmart.com",
              url: productUrl,
              price: { amount: 23.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.6,
              reviews_count: 191
            }
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      url: productUrl,
      text: async () => [
        "<html><head>",
        "<title>FIFINE K669B USB Microphone for PC, Laptop, PS5 Gaming, Metal Condenser Microphone with Gain Control for Streaming, Vocal Recording, Online Meetings - Walmart.com</title>",
        "<meta property=\"og:title\" content=\"FIFINE K669B USB Microphone for PC, Laptop, PS5 Gaming, Metal Condenser Microphone with Gain Control for Streaming, Vocal Recording, Online Meetings - Walmart.com\" />",
        "<meta property=\"og:site_name\" content=\"Walmart.com\" />",
        "<meta name=\"description\" content=\"Free Shipping! FIFINE USB Microphone for PC PS5 Gaming Streaming Recording with Gain Control Metal Condenser\" />",
        "</head><body>",
        "<ul>",
        "<li>Connection</li>",
        "<li>Microphone polar pattern</li>",
        "<li>Mic tech</li>",
        "<li>Freq range</li>",
        "<li>Maximum sound pressure level</li>",
        "</ul>",
        "</body></html>"
      ].join("")
    })) as unknown as typeof fetch);

    const output = await runProductVideoWorkflow(runtime, {
      product_url: productUrl,
      include_screenshots: false,
      include_all_images: false,
      include_copy: true
    });

    expect(output.pricing).toMatchObject({
      amount: 23.99,
      currency: "USD"
    });
    expect(output.product).toMatchObject({
      brand: "FIFINE",
      title: "FIFINE K669B USB Microphone for PC, Laptop, PS5 Gaming, Metal Condenser Microphone with Gain Control for Streaming, Vocal Recording, Online Meetings",
      copy: expect.stringContaining("Durable metal construction and a 16mm capsule reduce vibrations")
    });
    expect((output.product as { copy: string }).copy).not.toContain("Free Shipping!");
    expect((output.product as { copy: string }).copy).not.toContain("Departments");
    expect((output.product as { features: string[] }).features).toEqual([
      "Durable metal construction and a 16mm capsule reduce vibrations and focus on mouth sounds, rejecting 70% of fan/AC noise for clear output.",
      "An integrated volume knob allows for smooth and stable sound adjustment, enabling precise volume setting for meetings or voice recording without software.",
      "Features a solid, sturdy metal design with a stable tripod stand, making it convenient for voice-overs or livestreams.",
      "Comes with a Type-B to Type-C USB cable, offering plug-and-play compatibility with PC, PS4, and PS5 for gaming or recording.",
      "The PC microphone is only 4.8 inches long, lightweight, and portable, suitable for urgent meetings during business trips or outdoor communication.",
      "The box contains one condenser microphone with a USB cable, one tripod stand, and a user manual."
    ]);
  });

  it("strips Walmart storefront chrome from direct product-video title and brand output without a metadata refresh", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/walmart"],
        records: [makeWalmartPreownedAirpodsRecord()]
      })
    });

    const output = await runProductVideoWorkflow(runtime, {
      product_url: WALMART_PREOWNED_AIRPODS_URL,
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect(output.pricing).toMatchObject({
      amount: 139.99,
      currency: "USD"
    });
    expect(output.product).toMatchObject({
      brand: "Apple",
      title: "Pre-Owned Apple AirPods Pro (2nd Generation) - Lightning",
      provider: "shopping/walmart",
      url: WALMART_PREOWNED_AIRPODS_URL
    });
  });

  it("prefers a new Walmart listing over a pre-owned listing for generic product-name resolution while keeping the resolved PDP output clean", async () => {
    const search = vi.fn(async (_input, options) => {
      expect(options?.providerIds).toEqual(["shopping/walmart"]);
      return makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/walmart"],
        records: [
          makeRecord({
            id: "walmart-search-match-preowned",
            source: "shopping",
            provider: "shopping/walmart",
            url: WALMART_PREOWNED_AIRPODS_URL,
            title: "Pre-Owned Apple AirPods Pro (2nd Generation) - Lightning",
            content: "$139.99",
            attributes: {
              shopping_offer: {
                provider: "shopping/walmart",
                product_id: "walmart-search-match-preowned",
                title: "Pre-Owned Apple AirPods Pro (2nd Generation) - Lightning",
                url: WALMART_PREOWNED_AIRPODS_URL,
                price: { amount: 139.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 3.8,
                reviews_count: 2158
              }
            }
          }),
          makeRecord({
            id: "walmart-search-match-new",
            source: "shopping",
            provider: "shopping/walmart",
            url: WALMART_NEW_AIRPODS_URL,
            title: "Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)",
            content: "$189.99",
            attributes: {
              shopping_offer: {
                provider: "shopping/walmart",
                product_id: "walmart-search-match-new",
                title: "Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)",
                url: WALMART_NEW_AIRPODS_URL,
                price: { amount: 189.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4.7,
                reviews_count: 325
              }
            }
          })
        ]
      });
    });
    const fetch = vi.fn(async (_input, options) => {
      expect(options?.providerIds).toEqual(["shopping/walmart"]);
      return makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/walmart"],
        records: [makeWalmartNewAirpodsRecord()]
      });
    });

    const output = await runProductVideoWorkflow(toRuntime({ search, fetch }), {
      product_name: "Apple AirPods Pro 2nd Generation",
      provider_hint: "shopping/walmart",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(output.pricing).toMatchObject({
      amount: 189.99,
      currency: "USD"
    });
    expect(output.product).toMatchObject({
      brand: "Apple",
      title: "Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)",
      provider: "shopping/walmart",
      url: WALMART_NEW_AIRPODS_URL
    });
  });

  it("prefers the eBay product summary over marketplace navigation chrome in product-video outputs", async () => {
    const productUrl = "https://www.ebay.com/p/4062765295?iid=327063271610";
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/ebay"],
        records: [makeRecord({
          id: "ebay-product-summary",
          source: "shopping",
          provider: "shopping/ebay",
          url: productUrl,
          title: "Apple AirPods Pro 2nd Generation with MagSafe Wireless Charging Case (USB‑C) - White for sale online | eBay Skip to main content",
          content: [
            "Hi! Sign in or register Deals Brand Outlet Gift Cards Help & Contact Sell Watchlist Expand Watch List My eBay Expand My eBay Summary",
            "Expand Cart Loading...",
            "Apple AirPods Pro 2nd Generation with MagSafe Wireless Charging Case (USB‑C) - White for sale online | eBay",
            "Condition: New New",
            "The Apple AirPods Pro 2nd Generation with MagSafe Wireless Charging Case is a premium pair of wireless earbuds designed for an immersive listening experience.",
            "With Active Noise Cancellation and water-resistant features, these white earbuds provide high-quality sound in a sleek and compact design.",
            "The built-in microphone and Bluetooth connectivity ensure hands-free calls and easy connection to your devices.",
            "Perfect for those who value style, functionality, and convenience in their audio accessories.",
            "Buy It Now Apple AirPods Pro 2nd Generation with MagSafe Wireless Charging Case (USB‑C)...",
            "Sign in to check out Check out as guest Add to cart Adding to your cart See all details Oops!",
            "About this product Product Identifiers Brand Apple MPN MTJV3AM/A UPC 0195949052484 Model Apple AirPods Pro (2nd generation)",
            "All listings for this product Ratings and Reviews"
          ].join(" "),
          attributes: {
            brand: "eBay",
            shopping_offer: {
              provider: "shopping/ebay",
              product_id: "4062765295",
              title: "Apple AirPods Pro 2nd Generation with MagSafe Wireless Charging Case (USB‑C) - White for sale online | eBay",
              url: productUrl,
              price: { amount: 110, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "unknown" },
              availability: "in_stock",
              rating: 4.1,
              reviews_count: 325
            }
          }
        })]
      })
    });

    const output = await runProductVideoWorkflow(runtime, {
      product_url: productUrl,
      include_screenshots: false,
      include_all_images: false,
      include_copy: true
    });

    expect(output.pricing).toMatchObject({
      amount: 110,
      currency: "USD"
    });
    expect(output.product).toMatchObject({
      brand: "Apple",
      title: "Apple AirPods Pro 2nd Generation with MagSafe Wireless Charging Case (USB‑C) - White",
      copy: expect.stringContaining("With Active Noise Cancellation and water-resistant features")
    });
    expect((output.product as { copy: string }).copy).not.toContain("Expand Cart Loading");
    expect((output.product as { copy: string }).copy).not.toContain("Watchlist");
    expect((output.product as { features: string[] }).features).toEqual([
      "The Apple AirPods Pro 2nd Generation with MagSafe Wireless Charging Case is a premium pair of wireless earbuds designed for an immersive listening experience.",
      "With Active Noise Cancellation and water-resistant features, these white earbuds provide high-quality sound in a sleek and compact design.",
      "The built-in microphone and Bluetooth connectivity ensure hands-free calls and easy connection to your devices.",
      "Perfect for those who value style, functionality, and convenience in their audio accessories."
    ]);
  });

  it("refreshes malformed shopping-offer payloads and still resolves stable product output", async () => {
    const makeRuntime = (shoppingOffer: unknown) => toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/others"],
        records: [makeRecord({
          id: "malformed-shopping-offer",
          source: "shopping",
          provider: "shopping/others",
          url: "https://fallback.example/device",
          title: "https://fallback.example/device",
          content: undefined,
          attributes: {
            site_name: "Fallback Site",
            shopping_offer: shoppingOffer as never
          }
        })]
      })
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      url: "",
      text: async () => "<html><body></body></html>"
    })) as unknown as typeof fetch);

    const fromString = await runProductVideoWorkflow(makeRuntime("bad-payload"), {
      product_url: "https://fallback.example/device",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });
    const fromMissingPrice = await runProductVideoWorkflow(makeRuntime({ provider: "shopping/others" }), {
      product_url: "https://fallback.example/device",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect((fromString.product as { brand: string; title: string }).brand).toBe("Fallback Site");
    expect((fromString.product as { title: string }).title).toBe("https://fallback.example/device");
    expect((fromMissingPrice.product as { brand: string; title: string }).brand).toBe("Fallback Site");
    expect((fromMissingPrice.product as { title: string }).title).toBe("https://fallback.example/device");
  });

  it("emits canonical product-video summary keys when detail fetch succeeds with follow-up failures", async () => {
    const productUrl = "https://www.costco.com/studio-display.html";
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/costco"],
        records: [makeRecord({
          id: "costco-product-video-summary",
          source: "shopping",
          provider: "shopping/costco",
          url: productUrl,
          title: "Studio Display",
          content: "Brilliant OLED panel with stable product detail copy.",
          attributes: {
            shopping_offer: {
              provider: "shopping/costco",
              product_id: "costco-product-video-summary",
              title: "Studio Display",
              url: productUrl,
              price: { amount: 699, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.7,
              reviews_count: 21
            }
          }
        })],
        failures: [makeFailure("shopping/costco", "shopping", {
          code: "unavailable",
          message: "Costco login required",
          retryable: false,
          reasonCode: "auth_required"
        })],
        metrics: { attempted: 1, succeeded: 1, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    const output = await runProductVideoWorkflow(runtime, {
      product_url: productUrl,
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect(output.meta).toMatchObject({
      primaryConstraintSummary: "Costco requires login or an existing session.",
      reasonCodeDistribution: {
        auth_required: 1
      }
    });
    expect(output.meta).not.toHaveProperty("primary_constraint_summary");
    expect(output.meta).not.toHaveProperty("reason_code_distribution");
  });

  it("sanitizes noisy feature lists and ignores negative-context promotional prices", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "price-sanitized-product",
          source: "web",
          provider: "web/default",
          url: "https://example.com/design-monitor",
          title: "Design Monitor Pro",
          content: [
            "Trade-in credit saves $441.36 during launch week.",
            "Unlocked model costs $699 today for direct purchase.",
            "Setup fee is $5.",
            "Brilliant OLED panel stays color-accurate in daylight studio work.",
            "Battery life lasts up to 18 hours for travel-friendly review sessions.",
            "Frequently Asked Questions.",
            "Privacy policy."
          ].join(" "),
          attributes: {
            brand: "Studio Display Co."
          }
        })]
      })
    });

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://example.com/design-monitor",
      include_screenshots: false,
      include_all_images: false,
      include_copy: true
    });

    expect(output.pricing).toMatchObject({
      amount: 699,
      currency: "USD"
    });
    expect((output.product as { brand: string }).brand).toBe("Studio Display Co.");
    expect((output.product as { features: string[] }).features).toEqual([
      "Brilliant OLED panel stays color-accurate in daylight studio work.",
      "Battery life lasts up to 18 hours for travel-friendly review sessions."
    ]);
  });

  it("drops invalid fallback features and returns zero price when only negative-context pricing exists", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "negative-only-pricing",
          source: "web",
          provider: "web/default",
          url: "https://example.com/negative-only-pricing",
          title: "Negative Only Pricing Example",
          content: [
            "12345",
            "Can I use this internationally?",
            "$5 monthly service fee applies after activation.",
            "Trade-in credit saves $441.36 during launch week.",
            "Battery lasts 18 hours through review and capture sessions.",
            "Privacy policy."
          ].join("\n"),
          attributes: {}
        })]
      })
    });

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "https://example.com/negative-only-pricing",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect(output.pricing).toMatchObject({
      amount: 0,
      currency: "USD"
    });
    expect((output.product as { features: string[] }).features).toEqual([
      "Battery lasts 18 hours through review and capture sessions."
    ]);
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

  it("prefers canonical summaries for product detail fetch failures and keeps generic fallbacks", async () => {
    const constrainedRuntime = toRuntime({
      fetch: async () => makeAggregate({
        ok: false,
        sourceSelection: "shopping",
        providerOrder: ["shopping/temu"],
        error: {
          code: "unavailable",
          message: "Product details unavailable upstream",
          retryable: false
        },
        failures: [makeFailure("shopping/temu", "shopping", {
          code: "unavailable",
          message: "blocked",
          retryable: false,
          reasonCode: "challenge_detected",
          details: {
            blockerType: "anti_bot_challenge",
            providerShell: "temu_challenge_shell"
          }
        })],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
      })
    });

    await expect(runProductVideoWorkflow(constrainedRuntime, {
      product_url: "https://www.temu.com/item"
    })).rejects.toThrow("Temu hit an anti-bot challenge that requires manual completion.");

    const upstreamRuntime = toRuntime({
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

    await expect(runProductVideoWorkflow(upstreamRuntime, {
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

  it("tracks research sanitization reason counts across multiple shell variants", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [
          makeRecord({
            id: "community-index-shell",
            url: "https://www.reddit.com/search?q=browser+automation",
            title: "Community search index",
            content: "Search index",
            attributes: {
              retrievalPath: "community:search:index"
            }
          }),
          makeRecord({
            id: "duckduckgo-index-shell",
            url: "https://duckduckgo.com/?q=browser+automation",
            title: "DuckDuckGo",
            content: "Result overview",
            attributes: {
              retrievalPath: "web:search:index"
            }
          }),
          makeRecord({
            id: "generic-results-shell",
            url: "https://example.com/result",
            title: "https://example.com/result",
            content: "Skip to main content",
            attributes: {
              retrievalPath: "social:fetch:url"
            }
          }),
          makeRecord({
            id: "search-results-shell",
            url: "https://example.com/search?q=browser+automation",
            title: "Search page",
            content: "Search results",
            attributes: {
              retrievalPath: "community:fetch:url"
            }
          }),
          makeRecord({
            id: "url-search-shell",
            url: "https://example.com/search?q=deep+browser+automation",
            title: "https://example.com/search?q=deep+browser+automation",
            content: "Detailed page body",
            attributes: {
              retrievalPath: "community:fetch:url"
            }
          }),
          makeRecord({
            id: "duckduckgo-redirect-shell",
            url: "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fbrowser-automation",
            title: "Redirect result",
            content: "Detailed page body",
            attributes: {
              retrievalPath: "community:fetch:url"
            }
          }),
          makeRecord({
            id: "duckduckgo-html-shell",
            url: "https://html.duckduckgo.com/html/?q=browser+automation",
            title: "HTML shell",
            content: "Detailed page body",
            attributes: {
              retrievalPath: "community:fetch:url"
            }
          }),
          makeRecord({
            id: "login-shell",
            url: "https://example.com/login",
            title: "Sign in",
            content: "Continue with Google"
          }),
          makeRecord({
            id: "js-shell",
            url: "https://example.com/article",
            title: "Article",
            content: "You need to enable JavaScript"
          }),
          makeRecord({
            id: "not-found-shell",
            url: "https://example.com/missing",
            title: "Error 404",
            content: "Page not found"
          }),
          makeRecord({
            id: "usable-record",
            url: "https://example.com/usable-record",
            title: "Usable record",
            content: "Concrete browser automation field notes with reproducible details."
          })
        ]
      })
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "research shell inventory",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    });

    const metrics = (output.meta as {
      metrics: {
        total_records: number;
        sanitized_records: number;
        sanitized_reason_distribution: Record<string, number>;
        sanitizedReasonDistribution: Record<string, number>;
      };
    }).metrics;

    expect(metrics.total_records).toBe(11);
    expect(metrics.sanitized_records).toBe(10);
    expect(metrics.sanitized_reason_distribution).toEqual({
      search_index_shell: 2,
      search_results_shell: 5,
      login_shell: 1,
      js_required_shell: 1,
      not_found_shell: 1
    });
    expect(metrics.sanitizedReasonDistribution).toEqual(metrics.sanitized_reason_distribution);
  });

  it("fails research when only out-of-timebox records remain after sanitization", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "stale-usable-record",
          url: "https://example.com/stale-record",
          title: "Stale usable record",
          content: "Concrete browser automation field notes.",
          timestamp: "2020-01-01T00:00:00.000Z"
        })]
      })
    });

    await expect(runResearchWorkflow(runtime, {
      topic: "stale browser automation incident",
      sourceSelection: "web",
      days: 1,
      mode: "json"
    })).rejects.toThrow("Research workflow produced no usable in-timebox results after sanitization.");
  });

  it("rejects mismatched research and shopping workflow envelopes", async () => {
    const runtime = toRuntime({});
    const shoppingEnvelope = buildWorkflowResumeEnvelope("shopping", {
      query: "kind mismatch shopping",
      mode: "json"
    } as unknown as JsonValue);
    const researchEnvelope = buildWorkflowResumeEnvelope("research", {
      topic: "kind mismatch research",
      days: 1,
      mode: "json"
    } as unknown as JsonValue);

    await expect(runResearchWorkflow(runtime, shoppingEnvelope)).rejects.toThrow(
      "Research workflow envelope kind mismatch. Expected research but received shopping."
    );
    await expect(runShoppingWorkflow(runtime, researchEnvelope)).rejects.toThrow(
      "Shopping workflow envelope kind mismatch. Expected shopping but received research."
    );
  });

  it("keeps only structured challenge-orchestration diagnostics in shopping metrics", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [
          makeRecord({
            id: "challenge-orchestration-offer",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/dp/challenge-orchestration-offer",
            title: "Challenge Orchestration Offer",
            content: "$49.99",
            attributes: {
              browser_fallback_challenge_orchestration: {
                status: "recorded"
              },
              browser_fallback_reason_code: "challenge_detected",
              browser_fallback_mode: "managed_headed",
              shopping_offer: {
                provider: "shopping/amazon",
                product_id: "challenge-orchestration-offer",
                title: "Challenge Orchestration Offer",
                url: "https://www.amazon.com/dp/challenge-orchestration-offer",
                price: { amount: 49.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4.3,
                reviews_count: 27
              }
            }
          }),
          makeRecord({
            id: "challenge-orchestration-noise",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/dp/challenge-orchestration-noise",
            title: "Noise",
            attributes: {
              browser_fallback_challenge_orchestration: [],
              browser_fallback_reason_code: "challenge_detected",
              browser_fallback_mode: "extension"
            }
          })
        ],
        failures: [
          makeFailure("shopping/amazon", "shopping", {
            code: "unavailable",
            message: "challenge preserved",
            reasonCode: "challenge_detected",
            details: {
              challengeOrchestration: {
                status: "deferred",
                mode: "browser_with_helper"
              },
              browserFallbackReasonCode: "challenge_detected",
              browserFallbackMode: "extension"
            }
          }),
          makeFailure("shopping/amazon", "shopping", {
            code: "unavailable",
            message: "bad challenge diagnostics",
            details: {
              challengeOrchestration: []
            }
          }),
          makeFailure("shopping/amazon", "shopping", {
            code: "unavailable",
            message: "structured challenge diagnostics without fallback metadata",
            details: {
              challengeOrchestration: {
                status: "pending"
              }
            }
          })
        ]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "challenge orchestration metrics",
      providers: ["shopping/amazon"],
      mode: "json"
    });

    const metrics = (output.meta as {
      metrics: {
        challenge_orchestration: Array<Record<string, unknown>>;
        challengeOrchestration: Array<Record<string, unknown>>;
        browser_fallback_modes_observed: string[];
        browserFallbackModesObserved: string[];
      };
    }).metrics;

    expect(metrics.challenge_orchestration).toHaveLength(3);
    expect(metrics.challenge_orchestration).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "shopping/amazon",
        source: "shopping",
        reasonCode: "challenge_detected",
        browserFallbackReasonCode: "challenge_detected",
        browserFallbackMode: "extension",
        status: "deferred",
        mode: "browser_with_helper"
        }),
        expect.objectContaining({
          provider: "shopping/amazon",
          source: "shopping",
          browserFallbackReasonCode: "challenge_detected",
          browserFallbackMode: "managed_headed",
          status: "recorded"
        }),
        expect.objectContaining({
        provider: "shopping/amazon",
        source: "shopping",
        status: "pending"
      })
    ]));
    expect(metrics.challengeOrchestration).toEqual(metrics.challenge_orchestration);
    expect(metrics.browser_fallback_modes_observed).toEqual(["extension", "managed_headed"]);
    expect(metrics.browserFallbackModesObserved).toEqual(metrics.browser_fallback_modes_observed);
  });

  it("omits fallback metadata when challenge-orchestration diagnostics are present without reason or mode labels", async () => {
    const runtime = toRuntime({
      search: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [
          makeRecord({
            id: "challenge-orchestration-record-only",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/dp/challenge-orchestration-record-only",
            title: "Challenge Orchestration Record Only",
            content: "$39.99",
            attributes: {
              browser_fallback_challenge_orchestration: {
                status: "pending"
              },
              shopping_offer: {
                provider: "shopping/amazon",
                product_id: "challenge-orchestration-record-only",
                title: "Challenge Orchestration Record Only",
                url: "https://www.amazon.com/dp/challenge-orchestration-record-only",
                price: { amount: 39.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4.1,
                reviews_count: 11
              }
            }
          })
        ],
        failures: [{
          provider: "shopping/amazon",
          source: "shopping",
          error: {
            code: "",
            message: "",
            retryable: true,
            details: {
              challengeOrchestration: {
                status: "pending"
              }
            }
          }
        }]
      })
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "challenge orchestration labels",
      providers: ["shopping/amazon"],
      mode: "json"
    });

    const diagnostics = ((output.meta as {
      metrics: {
        challenge_orchestration: Array<Record<string, unknown>>;
      };
    }).metrics.challenge_orchestration);
    const recordDiagnostic = diagnostics.find((entry) => entry.status === "pending" && entry.provider === "shopping/amazon");

    expect(recordDiagnostic).toBeDefined();
    expect(recordDiagnostic).not.toHaveProperty("reasonCode");
    expect(recordDiagnostic).not.toHaveProperty("browserFallbackReasonCode");
    expect(recordDiagnostic).not.toHaveProperty("browserFallbackMode");
  });

  it("rejects product-video urls that use non-http protocols even when they parse cleanly", async () => {
    const runtime = toRuntime({});

    await expect(runProductVideoWorkflow(runtime, {
      product_url: "ftp://example.com/item"
    })).rejects.toThrow("product_url must be an http(s) URL");
  });

  it("accepts plain http product-video urls and continues into product retrieval", async () => {
    const runtime = toRuntime({
      fetch: async () => makeAggregate({
        ok: true,
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "plain-http-product",
          url: "http://shop.example/item",
          title: "Plain HTTP Product",
          content: "A concise product summary with stable detail copy."
        })]
      })
    });

    const output = await runProductVideoWorkflow(runtime, {
      product_url: "http://shop.example/item"
    });

    expect((output.product as { url: string; title: string }).url).toBe("http://shop.example/item");
    expect((output.product as { url: string; title: string }).title).toBe("Plain HTTP Product");
  });

  it("derives product brands from top-brand and product-identifier copy when storefront labels are absent", async () => {
    const topBrandRuntime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "top-brand-product",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/top-brand-product",
          title: "Amazon.com: Noise Canceling Headphones : Electronics",
          content: "Top Brand: Bose. Noise Canceling Headphones About this item Immersive audio. All-day battery life.",
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "top-brand-product",
              title: "Amazon.com: Noise Canceling Headphones : Electronics",
              url: "https://www.amazon.com/dp/top-brand-product",
              price: { amount: 199, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.8,
              reviews_count: 120
            }
          }
        })]
      })
    });
    const identifierRuntime = toRuntime({
      fetch: async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/ebay"],
        records: [makeRecord({
          id: "identifier-brand-product",
          source: "shopping",
          provider: "shopping/ebay",
          url: "https://www.ebay.com/p/identifier-brand-product",
          title: "Wireless Earbuds for sale online | eBay",
          content: "About this product Product Identifiers Brand Acme Audio MPN A1 UPC 000000000000 Model Wireless Earbuds",
          attributes: {
            shopping_offer: {
              provider: "shopping/ebay",
              product_id: "identifier-brand-product",
              title: "Wireless Earbuds for sale online | eBay",
              url: "https://www.ebay.com/p/identifier-brand-product",
              price: { amount: 89, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.2,
              reviews_count: 48
            }
          }
        })]
      })
    });

    const topBrandOutput = await runProductVideoWorkflow(topBrandRuntime, {
      product_url: "https://www.amazon.com/dp/top-brand-product",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });
    const identifierOutput = await runProductVideoWorkflow(identifierRuntime, {
      product_url: "https://www.ebay.com/p/identifier-brand-product",
      include_screenshots: false,
      include_all_images: false,
      include_copy: false
    });

    expect((topBrandOutput.product as { brand: string }).brand).toBe("Bose");
    expect((identifierOutput.product as { brand: string }).brand).toBe("Acme Audio");
  });
});
