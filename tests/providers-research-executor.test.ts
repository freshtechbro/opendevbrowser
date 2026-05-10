import { describe, expect, it, vi } from "vitest";
import {
  compileResearchExecutionPlan,
  createResearchFetchStepId,
  readResearchCheckpointState,
  type CompiledResearchExecutionPlan
} from "../src/providers/research-compiler";
import {
  executeResearchWorkflowPlan,
  resolveResearchWebFetchCandidates
} from "../src/providers/research-executor";
import { buildWorkflowResumeEnvelope, type WorkflowCheckpoint } from "../src/providers/workflow-contracts";
import type { ProviderExecutor, ResearchRunInput } from "../src/providers/workflows";
import type { NormalizedRecord, ProviderAggregateResult, ProviderSource } from "../src/providers/types";

const isoHoursAgo = (hours: number): string => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const makeRecord = (overrides: Partial<NormalizedRecord> = {}): NormalizedRecord => ({
  id: "rec-1",
  source: "web",
  provider: "web/default",
  url: "https://example.com/article",
  title: "Example article",
  content: "Example content",
  timestamp: isoHoursAgo(2),
  confidence: 0.7,
  attributes: {},
  ...overrides
});

const makeAggregate = (overrides: Partial<ProviderAggregateResult> = {}): ProviderAggregateResult => ({
  ok: true,
  records: [],
  trace: { requestId: "research-executor-test", ts: new Date().toISOString() },
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

const buildStepOptions = (captured: Array<Record<string, unknown>> = []) => (
  step: { input: { source: ProviderSource; url?: string } },
  envelope: ReturnType<typeof buildWorkflowResumeEnvelope>
) => {
  captured.push({
    source: step.input.source,
    envelope
  });
  return {
    source: step.input.source,
    suspendedIntent: {
      kind: "workflow.research",
      input: {
        workflow: envelope
      }
    }
  };
};

const checkpointedSearchResult = (records: NormalizedRecord[] = []): ProviderAggregateResult => makeAggregate({
  sourceSelection: "web",
  providerOrder: ["web/default"],
  records
});

const researchInput = (overrides: Partial<ResearchRunInput> = {}): ResearchRunInput => ({
  topic: "phase 4 research",
  mode: "json",
  limitPerSource: 5,
  ...overrides
});

describe("research workflow executor", () => {
  it("compiles research search steps, timebox state, exclusions, and capped follow-up budget", () => {
    const plan = compileResearchExecutionPlan({
      input: researchInput({
        sourceSelection: "auto",
        days: 7,
        includeEngagement: true
      }),
      now: new Date("2026-03-30T23:00:00.000Z"),
      getDegradedProviders: () => new Set(["social/youtube", "shopping/amazon"])
    });

    expect(plan.compiled).toMatchObject({
      topic: "phase 4 research",
      sourceSelection: "auto",
      resolvedSources: ["web", "community", "social"],
      autoExcludedProviders: ["social/youtube"],
      searchLimit: 5,
      followUpFetchLimit: 5,
      allowFollowUpWebFetch: true
    });
    expect(plan.compiled.timebox).toMatchObject({
      mode: "days",
      days: 7,
      applied: true
    });
    expect(plan.plan.steps.map((step) => step.id)).toEqual([
      "search:web",
      "search:community",
      "search:social"
    ]);
    expect(plan.plan.steps[0]?.input.filters).toEqual({
      include_engagement: true,
      timebox_from: plan.compiled.timebox.from,
      timebox_to: plan.compiled.timebox.to
    });
    expect(plan.plan.steps[1]?.input.filters).toEqual({
      include_engagement: true,
      timebox_from: plan.compiled.timebox.from,
      timebox_to: plan.compiled.timebox.to,
      pageLimit: 1,
      hopLimit: 1,
      expansionPerRecord: 2
    });
    expect(plan.plan.steps[2]?.input.filters).toEqual({
      include_engagement: true,
      timebox_from: plan.compiled.timebox.from,
      timebox_to: plan.compiled.timebox.to,
      pageLimit: 1,
      hopLimit: 0,
      expansionPerRecord: 0
    });
  });

  it("rejects malformed checkpoint state before execution", () => {
    const checkpoint = {
      stage: "execute",
      state: {
        completed_step_ids: [1],
        step_results_by_id: {}
      }
    } as unknown as WorkflowCheckpoint;

    expect(() => readResearchCheckpointState(checkpoint)).toThrow(
      "Research workflow checkpoint state is missing valid completed_step_ids."
    );
  });

  it("rejects malformed checkpoint records, result maps, and stored aggregate shapes", () => {
    expect(() => readResearchCheckpointState({
      stage: "execute",
      state: "not-a-record"
    } as unknown as WorkflowCheckpoint)).toThrow(
      "Research workflow checkpoint state must be a record."
    );

    expect(() => readResearchCheckpointState({
      stage: "execute",
      state: {
        completed_step_ids: [],
        step_results_by_id: []
      }
    } as unknown as WorkflowCheckpoint)).toThrow(
      "Research workflow checkpoint state is missing valid step_results_by_id."
    );

    expect(() => readResearchCheckpointState({
      stage: "execute",
      state: {
        completed_step_ids: ["search:web"],
        step_results_by_id: {
          "search:web": {
            ...makeAggregate(),
            failures: [{
              provider: "web/default",
              source: "web",
              error: {
                code: "bad_error_shape"
              }
            }]
          }
        }
      }
    } as unknown as WorkflowCheckpoint)).toThrow(
      "Research workflow checkpoint state contains an invalid result for search:web."
    );
  });

  it("resolves source selection edges and ignores unknown degraded providers", () => {
    const autoPlan = compileResearchExecutionPlan({
      input: researchInput({
        sources: ["web", "community", "social", "shopping"],
        sourceSelection: "auto"
      }),
      now: new Date("2026-03-30T23:00:00.000Z"),
      getDegradedProviders: () => new Set([
        "web/default",
        "community/reddit",
        "social/youtube",
        "shopping/amazon",
        "custom/provider"
      ])
    });

    expect(autoPlan.compiled.resolvedSources).toEqual(["web", "community", "social", "shopping"]);
    expect(autoPlan.compiled.autoExcludedProviders).toEqual([
      "community/reddit",
      "shopping/amazon",
      "social/youtube",
      "web/default"
    ]);

    const allPlan = compileResearchExecutionPlan({
      input: researchInput({
        sourceSelection: "all"
      }),
      now: new Date("2026-03-30T23:00:00.000Z")
    });

    expect(allPlan.compiled.sourceSelection).toBe("all");
    expect(allPlan.compiled.resolvedSources).toEqual(["web", "community", "social"]);
    expect(allPlan.compiled.allowFollowUpWebFetch).toBe(true);
  });

  it("accepts enriched checkpoint aggregates with mixed provider sources and optional metadata", () => {
    const checkpoint = {
      stage: "execute",
      state: {
        completed_step_ids: ["search:web"],
        step_results_by_id: {
          "search:web": makeAggregate({
            sourceSelection: "all",
            records: [
              makeRecord({
                id: "community-record",
                source: "community",
                provider: "community/default",
                url: "https://community.example.com/post",
                attributes: {
                  retrievalPath: "community:search:index"
                }
              }),
              makeRecord({
                id: "social-record",
                source: "social",
                provider: "social/youtube",
                url: "https://example.com/social",
                attributes: {
                  retrievalPath: "social:search:index"
                }
              }),
              makeRecord({
                id: "shopping-record",
                source: "shopping",
                provider: "shopping/amazon",
                url: "https://example.com/product",
                attributes: {
                  retrievalPath: "shopping:search:index"
                }
              })
            ],
            trace: {
              requestId: "research-trace",
              ts: new Date().toISOString(),
              sessionId: "session-1",
              targetId: "target-1",
              provider: "web/default"
            },
            failures: [{
              provider: "shopping/amazon",
              source: "community",
              error: {
                code: "upstream_error",
                message: "provider failed",
                retryable: true,
                reasonCode: "rate_limited",
                provider: "shopping/amazon",
                source: "shopping",
                details: {
                  stage: "search"
                }
              }
            }],
            providerOrder: ["community/default", "social/youtube", "shopping/amazon"],
            meta: {
              degraded_providers: ["social/youtube"]
            },
            diagnostics: {
              hint: "ok"
            },
            error: {
              code: "partial_failure",
              message: "partial",
              retryable: false,
              reasonCode: "env_limited",
              provider: "web/default",
              source: "social",
              details: {
                phase: "execute"
              }
            }
          })
        }
      }
    } as unknown as WorkflowCheckpoint;

    expect(readResearchCheckpointState(checkpoint)).toEqual({
      completed_step_ids: ["search:web"],
      step_results_by_id: expect.objectContaining({
        "search:web": expect.objectContaining({
          sourceSelection: "all",
          meta: {
            degraded_providers: ["social/youtube"]
          },
          diagnostics: {
            hint: "ok"
          },
          error: expect.objectContaining({
            code: "partial_failure",
            source: "social"
          })
        })
      })
    });
  });

  it("reuses completed search steps, preserves pre-suspend envelopes, and continues follow-up execution", async () => {
    const search = vi.fn(async (input, options) => {
      return makeAggregate({
        sourceSelection: options?.source ?? "community",
        providerOrder: ["community/default"],
        records: [makeRecord({
          id: `community-${input.query}`,
          source: "community",
          provider: "community/default",
          url: "https://community.example.com/post",
          title: input.query
        })]
      });
    });
    const fetch = vi.fn(async (input) => {
      return makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: "follow-up-one",
          source: "web",
          provider: "web/default",
          url: input.url,
          title: "Follow-up one",
          attributes: {
            retrievalPath: "web:fetch:url"
          }
        })]
      });
    });

    const webCheckpointRecord = makeRecord({
      id: "search-shell",
      source: "web",
      provider: "web/default",
      url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fone",
      title: "DDG shell",
      attributes: {
        retrievalPath: "web:search:index"
      }
    });
    const envelope = buildWorkflowResumeEnvelope("research", researchInput({
      sources: ["web", "community"]
    }) as unknown as Record<string, unknown>, {
      checkpoint: {
        stage: "execute",
        stepId: "search:web",
        stepIndex: 0,
        state: {
          completed_step_ids: ["search:web"],
          step_results_by_id: {
            "search:web": checkpointedSearchResult([webCheckpointRecord])
          }
        },
        updatedAt: "2026-03-30T23:00:00.000Z"
      },
      trace: [{
        at: "2026-03-30T23:00:00.000Z",
        stage: "compile",
        event: "compile_completed"
      }]
    });
    const plan = compileResearchExecutionPlan({
      input: envelope.input as unknown as ResearchRunInput,
      envelope,
      now: new Date("2026-03-30T23:05:00.000Z")
    });

    const execution = await executeResearchWorkflowPlan(toRuntime({ search, fetch }), plan, {
      trace: envelope.trace,
      buildStepOptions: buildStepOptions()
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "phase 4 research" }),
      expect.objectContaining({
        source: "community",
        suspendedIntent: expect.objectContaining({
          kind: "workflow.research",
          input: {
            workflow: expect.objectContaining({
              checkpoint: expect.objectContaining({
                stepId: "search:community",
                state: expect.objectContaining({
                  completed_step_ids: ["search:web"]
                })
              })
            })
          }
        })
      })
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://example.com/one" },
      expect.objectContaining({
        source: "web",
        suspendedIntent: expect.objectContaining({
          kind: "workflow.research",
          input: {
            workflow: expect.objectContaining({
              checkpoint: expect.objectContaining({
                state: expect.objectContaining({
                  completed_step_ids: ["search:web", "search:community"]
                })
              })
            })
          }
        })
      })
    );
    expect(execution.searchRuns).toHaveLength(2);
    expect(execution.followUpRuns).toEqual([
      expect.objectContaining({
        source: "web",
        url: "https://example.com/one"
      })
    ]);
    expect(execution.trace.some((entry) => entry.event === "step_reused" && entry.details?.stepId === "search:web")).toBe(true);
  });

  it("reuses completed follow-up fetch steps without replaying runtime.fetch", async () => {
    const searchRecord = makeRecord({
      id: "ddg-shell",
      source: "web",
      provider: "web/default",
      url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Freused",
      title: "DDG shell",
      attributes: {
        retrievalPath: "web:search:index"
      }
    });
    const fetchStepId = createResearchFetchStepId("https://example.com/reused");
    const plan = compileResearchExecutionPlan({
      input: researchInput({
        sources: ["web"]
      }),
      envelope: buildWorkflowResumeEnvelope("research", researchInput({
        sources: ["web"]
      }) as unknown as Record<string, unknown>, {
        checkpoint: {
          stage: "execute",
          stepId: fetchStepId,
          stepIndex: 1,
          state: {
            completed_step_ids: ["search:web", fetchStepId],
            step_results_by_id: {
              "search:web": checkpointedSearchResult([searchRecord]),
              [fetchStepId]: makeAggregate({
                sourceSelection: "web",
                providerOrder: ["web/default"],
                records: [makeRecord({
                  id: "fetched-reused",
                  source: "web",
                  provider: "web/default",
                  url: "https://example.com/reused",
                  attributes: {
                    retrievalPath: "web:fetch:url"
                  }
                })]
              })
            }
          },
          updatedAt: "2026-03-30T23:10:00.000Z"
        }
      })
    });
    const fetch = vi.fn(async () => makeAggregate());

    const execution = await executeResearchWorkflowPlan(toRuntime({ fetch }), plan, {
      buildStepOptions: buildStepOptions()
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(execution.followUpRuns).toEqual([
      expect.objectContaining({
        url: "https://example.com/reused"
      })
    ]);
    expect(execution.trace.some((entry) => entry.event === "step_reused" && entry.details?.stepId === fetchStepId)).toBe(true);
  });

  it("unwraps DuckDuckGo redirects, drops malformed urls, dedupes candidates, and enforces the fetch cap", async () => {
    const fetchedUrls: string[] = [];
    const search = vi.fn(async () => makeAggregate({
      sourceSelection: "web",
      providerOrder: ["web/default"],
      records: [
        makeRecord({
          id: "bad",
          url: "://bad",
          attributes: { retrievalPath: "web:search:index" }
        }),
        makeRecord({
          id: "ddg-one",
          url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fone",
          attributes: { retrievalPath: "web:search:index" }
        }),
        makeRecord({
          id: "ddg-one-dup",
          url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fone",
          attributes: { retrievalPath: "web:search:index" }
        }),
        makeRecord({
          id: "ddg-two",
          url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Ftwo",
          attributes: { retrievalPath: "web:search:index" }
        }),
        makeRecord({
          id: "ddg-three",
          url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fthree",
          attributes: { retrievalPath: "web:search:index" }
        }),
        makeRecord({
          id: "ddg-four",
          url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Ffour",
          attributes: { retrievalPath: "web:search:index" }
        })
      ]
    }));
    const fetch = vi.fn(async (input) => {
      fetchedUrls.push(input.url);
      return makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [makeRecord({
          id: input.url,
          source: "web",
          provider: "web/default",
          url: input.url,
          attributes: {
            retrievalPath: "web:fetch:url"
          }
        })]
      });
    });
    const plan = compileResearchExecutionPlan({
      input: researchInput({
        sources: ["web"],
        limitPerSource: 10
      })
    });

    const execution = await executeResearchWorkflowPlan(toRuntime({ search, fetch }), plan, {
      buildStepOptions: buildStepOptions()
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(fetchedUrls).toEqual([
      "https://example.com/one",
      "https://example.com/two",
      "https://example.com/three",
      "https://example.com/four"
    ]);
    expect(execution.searchRuns).toHaveLength(1);
    expect(execution.followUpRuns).toHaveLength(4);
  });

  it("does not widen non-web research selections into hidden web follow-up fetches", async () => {
    const search = vi.fn(async (_input, options) => makeAggregate({
      sourceSelection: options?.source ?? "social",
      providerOrder: ["social/youtube"],
      records: [makeRecord({
        id: "social-index-result",
        source: "social",
        provider: "social/youtube",
        url: "https://example.com/social-follow-up",
        title: "Social index result",
        attributes: {
          retrievalPath: "social:search:index"
        }
      })]
    }));
    const fetch = vi.fn(async () => makeAggregate());
    const plan = compileResearchExecutionPlan({
      input: researchInput({
        sources: ["social"]
      })
    });

    const execution = await executeResearchWorkflowPlan(toRuntime({ search, fetch }), plan, {
      buildStepOptions: buildStepOptions()
    });

    expect(plan.compiled.allowFollowUpWebFetch).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(execution.searchRuns).toHaveLength(1);
    expect(execution.followUpRuns).toEqual([]);
  });

  it("keeps web follow-up fetches enabled when web is part of the resolved source set", async () => {
    const search = vi.fn(async (_input, options) => {
      const source = options?.source ?? "web";
      let providerOrder = ["web/default"];
      if (source === "community") {
        providerOrder = ["community/default"];
      }
      if (source === "social") {
        providerOrder = ["social/youtube"];
      }
      if (source === "community") {
        return makeAggregate({
          sourceSelection: source,
          providerOrder,
          records: [makeRecord({
            id: "community-follow-up",
            source: "community",
            provider: "community/default",
            url: "https://example.com/community-follow-up",
            title: "Community result",
            attributes: {
              retrievalPath: "community:search:index"
            }
          })]
        });
      }
      if (source === "social") {
        return makeAggregate({
          sourceSelection: source,
          providerOrder,
          records: [makeRecord({
            id: "social-follow-up",
            source: "social",
            provider: "social/youtube",
            url: "https://example.com/social-follow-up",
            title: "Social result",
            attributes: {
              retrievalPath: "social:search:index"
            }
          })]
        });
      }
      return makeAggregate({ sourceSelection: source, providerOrder });
    });
    const fetch = vi.fn(async (input) => makeAggregate({
      sourceSelection: "web",
      providerOrder: ["web/default"],
      records: [makeRecord({
        id: "web-follow-up",
        source: "web",
        provider: "web/default",
        url: input.url,
        title: "Fetched follow-up",
        attributes: {
          retrievalPath: "web:fetch:url"
        }
      })]
    }));
    const plan = compileResearchExecutionPlan({
      input: researchInput({
        sources: ["community", "social", "web"]
      })
    });

    const execution = await executeResearchWorkflowPlan(toRuntime({ search, fetch }), plan, {
      buildStepOptions: buildStepOptions()
    });

    expect(plan.compiled.allowFollowUpWebFetch).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(execution.followUpRuns).toEqual([
      expect.objectContaining({
        url: "https://example.com/community-follow-up"
      }),
      expect.objectContaining({
        url: "https://example.com/social-follow-up"
      })
    ]);
  });

  it("filters unsupported follow-up candidates before tactical web fetches are scheduled", () => {
    const candidates = resolveResearchWebFetchCandidates([
      makeRecord({
        id: "ignored-path",
        attributes: {}
      }),
      {
        ...makeRecord({
          id: "missing-url",
          attributes: { retrievalPath: "web:search:index" }
        }),
        url: undefined
      },
      makeRecord({
        id: "invalid-redirect",
        url: "https://duckduckgo.com/l?uddg=%3A%2F%2Fbad",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "empty-redirect",
        url: "https://duckduckgo.com/l?uddg=",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "login-redirect",
        url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fwww.reddit.com%2Flogin%2F",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "privacy-redirect",
        url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fprivacy%2Fchoices",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "privacy-redirect-trailing",
        url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com%2Fprivacy%2Fchoices%2F",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "cookie-direct",
        url: "https://example.com/cookie-preferences",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "search-direct",
        url: "https://example.com/search?q=browser+automation",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "google-search",
        url: "https://www.google.com/search?q=browser+automation",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "non-http",
        url: "mailto:test@example.com",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "community-valid",
        url: "https://example.com/community-follow-up",
        attributes: { retrievalPath: "community:search:index" }
      }),
      makeRecord({
        id: "social-valid",
        url: "https://example.com/social-follow-up",
        attributes: { retrievalPath: "social:search:index" }
      }),
      makeRecord({
        id: "youtube-direct-valid",
        url: "https://example.com/youtube-direct-follow-up",
        attributes: { retrievalPath: "social:youtube:search:url" }
      }),
      makeRecord({
        id: "ddg-trailing-redirect",
        url: "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ftrailing-ddg-follow-up",
        attributes: { retrievalPath: "web:search:index" }
      }),
      makeRecord({
        id: "social-links",
        url: "https://www.reddit.com/search/?q=browser+automation",
        attributes: {
          retrievalPath: "social:search:index",
          links: [
            "https://www.reddit.com/login/",
            "https://example.com/social-linked-follow-up"
          ]
        }
      }),
      makeRecord({
        id: "web-valid",
        url: "https://example.com/web-follow-up",
        attributes: { retrievalPath: "web:search:index" }
      })
    ], 6);

    expect(candidates).toEqual([
      "https://example.com/community-follow-up",
      "https://example.com/social-follow-up",
      "https://example.com/youtube-direct-follow-up",
      "https://example.com/trailing-ddg-follow-up",
      "https://example.com/social-linked-follow-up",
      "https://example.com/web-follow-up"
    ]);
  });

  it("throws when a checkpointed step omits its stored result and keeps a fallback checkpoint for empty plans", async () => {
    const reusedStepPlan = compileResearchExecutionPlan({
      input: researchInput({
        sources: ["web"]
      }),
      envelope: buildWorkflowResumeEnvelope("research", researchInput({
        sources: ["web"]
      }) as unknown as Record<string, unknown>, {
        checkpoint: {
          stage: "execute",
          stepId: "search:web",
          stepIndex: 0,
          state: {
            completed_step_ids: ["search:web"],
            step_results_by_id: {}
          },
          updatedAt: "2026-03-30T23:00:00.000Z"
        }
      })
    });

    await expect(executeResearchWorkflowPlan(toRuntime({}), reusedStepPlan, {
      buildStepOptions: buildStepOptions()
    })).rejects.toThrow(
      "Research workflow checkpoint is missing result for completed step search:web."
    );

    const seededPlan = compileResearchExecutionPlan({
      input: researchInput({
        sources: ["web"]
      })
    });
    const emptyPlan = {
      ...seededPlan,
      compiled: {
        ...seededPlan.compiled,
        resolvedSources: []
      },
      plan: {
        ...seededPlan.plan,
        steps: []
      }
    } as CompiledResearchExecutionPlan;

    const execution = await executeResearchWorkflowPlan(toRuntime({}), emptyPlan, {
      buildStepOptions: buildStepOptions()
    });

    expect(execution.searchRuns).toEqual([]);
    expect(execution.followUpRuns).toEqual([]);
    expect(execution.checkpoint).toMatchObject({
      stage: "execute",
      stepId: "research:execute",
      stepIndex: 0
    });
  });
});
