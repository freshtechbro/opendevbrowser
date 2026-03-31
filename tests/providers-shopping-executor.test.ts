import { describe, expect, it, vi } from "vitest";
import { buildWorkflowResumeEnvelope } from "../src/providers/workflow-contracts";
import {
  compileShoppingExecutionPlan,
  createShoppingSearchStepId,
  deriveShoppingFetchSteps,
  readShoppingCheckpointState
} from "../src/providers/shopping-compiler";
import { executeShoppingWorkflowPlan } from "../src/providers/shopping-executor";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderError,
  ProviderFailureEntry,
  ProviderSource
} from "../src/providers/types";
import type { ProviderExecutor } from "../src/providers/workflows";

const isoHoursAgo = (hours: number): string => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const makeRecord = (overrides: Partial<NormalizedRecord> = {}): NormalizedRecord => ({
  id: "rec-1",
  source: "shopping",
  provider: "shopping/amazon",
  url: "https://www.amazon.com/dp/B0TEST1234",
  title: "Travel Monitor Pro",
  content: "$30.00 with standard shipping",
  timestamp: isoHoursAgo(2),
  confidence: 0.9,
  attributes: {
    retrievalPath: "shopping:search:result-card",
    shopping_offer: {
      provider: "shopping/amazon",
      product_id: "product-1",
      title: "Travel Monitor Pro",
      url: "https://www.amazon.com/dp/B0TEST1234",
      price: {
        amount: 30,
        currency: "USD",
        retrieved_at: isoHoursAgo(1)
      },
      shipping: {
        amount: 5,
        currency: "USD",
        notes: "std"
      },
      availability: "in_stock",
      rating: 4.7,
      reviews_count: 120
    }
  },
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
  trace: { requestId: "shopping-executor-test", ts: new Date().toISOString() },
  partial: false,
  failures: [],
  metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
  sourceSelection: "shopping",
  providerOrder: ["shopping/amazon"],
  ...overrides
});

const toRuntime = (handlers: {
  search?: ProviderExecutor["search"];
  fetch?: ProviderExecutor["fetch"];
}): ProviderExecutor => ({
  search: handlers.search ?? (async () => makeAggregate()),
  fetch: handlers.fetch ?? (async () => makeAggregate())
});

describe("shopping bounded executor", () => {
  it("compiles deterministic search steps for the effective providers", () => {
    const plan = compileShoppingExecutionPlan({
      input: {
        query: "portable monitor",
        providers: ["shopping/amazon", "shopping/walmart"],
        mode: "json"
      },
      now: new Date("2026-03-30T22:00:00.000Z")
    });

    expect(plan.plan.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      providerId: step.input.providerId
    }))).toEqual([
      { id: "search:shopping/amazon", kind: "search", providerId: "shopping/amazon" },
      { id: "search:shopping/walmart", kind: "search", providerId: "shopping/walmart" }
    ]);
    expect(plan.checkpointState).toEqual({
      completed_step_ids: [],
      step_results_by_id: {}
    });
  });

  it("derives one deterministic fetch step from completed zero-offer search output", () => {
    const searchStepId = createShoppingSearchStepId("shopping/amazon");
    const plan = compileShoppingExecutionPlan({
      input: {
        query: "portable monitor",
        providers: ["shopping/amazon"],
        mode: "json"
      }
    });

    const fetchSteps = deriveShoppingFetchSteps(plan.compiled, {
      completed_step_ids: [searchStepId],
      step_results_by_id: {
        [searchStepId]: makeAggregate({
          sourceSelection: "shopping",
          providerOrder: ["shopping/amazon"],
          records: [makeRecord({
            id: "search-index",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/s?k=portable+monitor",
            title: "Search Results",
            attributes: {
              retrievalPath: "shopping:search:index",
              links: ["https://www.amazon.com/dp/B0FETCH0001"]
            }
          })]
        })
      }
    });

    expect(fetchSteps).toHaveLength(1);
    expect(fetchSteps[0]).toMatchObject({
      kind: "fetch",
      input: {
        providerId: "shopping/amazon",
        url: "https://www.amazon.com/dp/B0FETCH0001"
      }
    });
    expect(fetchSteps[0]?.id).toMatch(/^fetch:shopping\/amazon:/);
  });

  it("reads rich checkpoint state and rejects malformed checkpoint payloads", () => {
    const searchStepId = createShoppingSearchStepId("shopping/amazon");
    const richResult = makeAggregate({
      trace: {
        requestId: "shopping-executor-test",
        ts: new Date().toISOString(),
        sessionId: "session-1",
        targetId: "target-1",
        provider: "shopping/amazon"
      },
      failures: [makeFailure("shopping/amazon", "shopping", {
        provider: "shopping/amazon",
        source: "shopping",
        reasonCode: "env_limited",
        details: {
          region: "us"
        }
      })],
      meta: {
        resume: "checkpoint"
      },
      diagnostics: {
        stage: "execute"
      },
      error: {
        code: "blocked",
        message: "soft block",
        retryable: true,
        provider: "shopping/amazon",
        source: "shopping",
        reasonCode: "env_limited",
        details: {
          blocker: "captcha"
        }
      }
    });

    expect(readShoppingCheckpointState({
      stage: "execute",
      stepId: searchStepId,
      stepIndex: 0,
      state: {
        completed_step_ids: [searchStepId],
        step_results_by_id: {
          [searchStepId]: richResult
        }
      },
      updatedAt: "2026-03-30T22:00:00.000Z"
    })).toEqual({
      completed_step_ids: [searchStepId],
      step_results_by_id: {
        [searchStepId]: richResult
      }
    });

    expect(() => readShoppingCheckpointState({
      stage: "execute",
      stepId: searchStepId,
      stepIndex: 0,
      state: "invalid" as unknown as Record<string, JsonValue>,
      updatedAt: "2026-03-30T22:00:00.000Z"
    })).toThrow("Shopping workflow checkpoint state must be a record.");
    expect(() => readShoppingCheckpointState({
      stage: "execute",
      stepId: searchStepId,
      stepIndex: 0,
      state: {
        completed_step_ids: [1],
        step_results_by_id: {}
      } as unknown as Record<string, JsonValue>,
      updatedAt: "2026-03-30T22:00:00.000Z"
    })).toThrow("Shopping workflow checkpoint state is missing valid completed_step_ids.");
    expect(() => readShoppingCheckpointState({
      stage: "execute",
      stepId: searchStepId,
      stepIndex: 0,
      state: {
        completed_step_ids: [searchStepId],
        step_results_by_id: []
      } as unknown as Record<string, JsonValue>,
      updatedAt: "2026-03-30T22:00:00.000Z"
    })).toThrow("Shopping workflow checkpoint state is missing valid step_results_by_id.");
    expect(() => readShoppingCheckpointState({
      stage: "execute",
      stepId: searchStepId,
      stepIndex: 0,
      state: {
        completed_step_ids: [searchStepId],
        step_results_by_id: {
          [searchStepId]: {
            ok: true
          }
        }
      } as unknown as Record<string, JsonValue>,
      updatedAt: "2026-03-30T22:00:00.000Z"
    })).toThrow(`Shopping workflow checkpoint state contains an invalid result for ${searchStepId}.`);
  });

  it("skips fetch derivation until search is complete and deduplicates recovered candidate urls", () => {
    const searchStepId = createShoppingSearchStepId("shopping/amazon");
    const plan = compileShoppingExecutionPlan({
      input: {
        query: "portable monitor",
        providers: ["shopping/amazon"],
        mode: "json"
      }
    });

    expect(deriveShoppingFetchSteps(plan.compiled, {
      completed_step_ids: [],
      step_results_by_id: {}
    })).toEqual([]);

    const fetchSteps = deriveShoppingFetchSteps(plan.compiled, {
      completed_step_ids: [searchStepId],
      step_results_by_id: {
        [searchStepId]: makeAggregate({
          sourceSelection: "shopping",
          providerOrder: ["shopping/amazon"],
          records: [
            makeRecord({
              id: "non-offer-record",
              url: "https://www.amazon.com/dp/B0FETCH0002",
              title: "https://www.amazon.com/dp/B0FETCH0002",
              attributes: {
                retrievalPath: 42 as unknown as string
              }
            }),
            makeRecord({
              id: "candidate-source",
              url: "https://www.amazon.com/s?k=portable+monitor",
              title: "Search Results",
              content: "Search result index",
              attributes: {
                retrievalPath: "shopping:search:index",
                links: [
                  "mailto:merchant@example.com",
                  "https://www.amazon.com/dp/B0FETCH0002",
                  "https://www.amazon.com/dp/B0FETCH0002"
                ]
              }
            })
          ]
        })
      }
    });

    expect(fetchSteps).toHaveLength(1);
    expect(fetchSteps[0]).toMatchObject({
      kind: "fetch",
      input: {
        providerId: "shopping/amazon",
        url: "https://www.amazon.com/dp/B0FETCH0002"
      }
    });
  });

  it("returns an empty result set when the execution plan contains no tactical steps", async () => {
    const result = await executeShoppingWorkflowPlan(toRuntime({}), {
      input: {
        query: "portable monitor",
        providers: ["shopping/amazon"],
        mode: "json"
      },
      compiled: {
        query: "portable monitor",
        now: new Date("2026-03-30T22:00:00.000Z"),
        providerIds: ["shopping/amazon"],
        hasExplicitProviderSelection: true,
        autoExcludedProviders: [],
        effectiveProviderIds: ["shopping/amazon"],
        regionDiagnostics: [],
        sort: "best_deal"
      },
      plan: {
        kind: "shopping",
        steps: []
      },
      checkpointState: {
        completed_step_ids: [],
        step_results_by_id: {}
      }
    }, {
      buildStepOptions: () => ({
        source: "shopping",
        providerIds: ["shopping/amazon"],
        timeoutMs: 123
      })
    });

    expect(result.runs).toEqual([]);
    expect(result.trace).toEqual([]);
    expect(result.checkpoint).toMatchObject({
      stage: "execute",
      stepId: "shopping:execute",
      stepIndex: 0
    });
    expect((result.checkpoint.state as Record<string, unknown>).completed_step_ids).toEqual([]);
  });

  it("fails fast when a resumed search step is marked complete without a stored result", async () => {
    const searchStepId = createShoppingSearchStepId("shopping/amazon");
    const plan = compileShoppingExecutionPlan({
      input: {
        query: "portable monitor",
        providers: ["shopping/amazon"],
        mode: "json"
      }
    });

    await expect(executeShoppingWorkflowPlan(toRuntime({}), {
      ...plan,
      checkpointState: {
        completed_step_ids: [searchStepId],
        step_results_by_id: {}
      }
    }, {
      buildStepOptions: (step, envelope) => ({
        source: "shopping",
        providerIds: [step.input.providerId],
        timeoutMs: 123,
        suspendedIntent: {
          kind: "workflow.shopping",
          input: {
            workflow: envelope
          }
        }
      })
    })).rejects.toThrow(
      `Shopping workflow checkpoint is missing result for completed step ${searchStepId}.`
    );
  });

  it("reuses checkpointed search steps and aggregates provider-level fetch recovery without replay", async () => {
    const searchStepId = createShoppingSearchStepId("shopping/amazon");
    const checkpointSearchResult = makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "search-index",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/s?k=portable+monitor",
        title: "Search Results",
        attributes: {
          retrievalPath: "shopping:search:index",
          links: ["https://www.amazon.com/dp/B0FETCH0001"]
        }
      })]
    });
    const plan = compileShoppingExecutionPlan({
      input: {
        query: "portable monitor",
        providers: ["shopping/amazon"],
        mode: "json"
      },
      envelope: buildWorkflowResumeEnvelope("shopping", {
        query: "portable monitor",
        providers: ["shopping/amazon"],
        mode: "json"
      } as unknown as JsonValue, {
        checkpoint: {
          stage: "execute",
          stepId: searchStepId,
          stepIndex: 0,
          state: {
            completed_step_ids: [searchStepId],
            step_results_by_id: {
              [searchStepId]: checkpointSearchResult
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
    });

    const search = vi.fn(async () => {
      throw new Error("checkpointed search step should not replay");
    });
    const fetch = vi.fn(async () => makeAggregate({
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"],
      records: [makeRecord({
        id: "fetch-offer",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/B0FETCH0001",
        title: "Portable Monitor Pro",
        content: "$199.99",
        attributes: {
          retrievalPath: "shopping:search:result-card",
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "B0FETCH0001",
            title: "Portable Monitor Pro",
            url: "https://www.amazon.com/dp/B0FETCH0001",
            price: { amount: 199.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.8,
            reviews_count: 31
          }
        }
      })]
    }));

    const result = await executeShoppingWorkflowPlan(toRuntime({ search, fetch }), plan, {
      trace: [{
        at: "2026-03-30T22:00:00.000Z",
        stage: "compile",
        event: "compile_completed"
      }],
      buildStepOptions: (step, envelope) => ({
        source: "shopping",
        providerIds: [step.input.providerId],
        timeoutMs: 321,
        suspendedIntent: {
          kind: "workflow.shopping",
          input: { workflow: envelope }
        }
      })
    });

    expect(search).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.amazon.com/dp/B0FETCH0001" },
      expect.objectContaining({
        source: "shopping",
        providerIds: ["shopping/amazon"],
        timeoutMs: 321,
        suspendedIntent: expect.objectContaining({
          kind: "workflow.shopping",
          input: {
            workflow: expect.objectContaining({
              checkpoint: expect.objectContaining({
                state: expect.objectContaining({
                  completed_step_ids: [searchStepId]
                })
              })
            })
          }
        })
      })
    );
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      providerId: "shopping/amazon"
    });
    expect(result.runs[0]?.result.records.map((record) => record.id)).toEqual([
      "search-index",
      "fetch-offer"
    ]);
    expect(result.trace.map((entry) => entry.event)).toEqual(expect.arrayContaining([
      "step_reused",
      "tactical_decision",
      "step_started",
      "pre_suspend_checkpoint",
      "step_completed"
    ]));
    expect((result.checkpoint.state as Record<string, unknown>).completed_step_ids).toEqual(
      expect.arrayContaining([searchStepId, expect.stringMatching(/^fetch:shopping\/amazon:/)])
    );
  });
});
