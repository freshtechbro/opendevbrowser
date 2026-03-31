import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_VIDEO_STEP_IDS,
  compileProductVideoExecutionPlan,
  readProductVideoCheckpointState,
  serializeProductVideoCheckpointState
} from "../src/providers/product-video-compiler";
import { buildWorkflowResumeEnvelope, type WorkflowCheckpoint } from "../src/providers/workflow-contracts";
import { runProductVideoWorkflow, type ProviderExecutor, type ProductVideoRunInput } from "../src/providers/workflows";
import type {
  JsonValue,
  NormalizedRecord,
  ProviderAggregateResult,
  ProviderError,
  ProviderFailureEntry,
  ProviderSource
} from "../src/providers/types";

const isoHoursAgo = (hours: number): string => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const makeRecord = (overrides: Partial<NormalizedRecord> = {}): NormalizedRecord => ({
  id: "product-video-record",
  source: "shopping",
  provider: "shopping/amazon",
  url: "https://www.amazon.com/dp/B0PHASE5001",
  title: "Product Video Fixture",
  content: "Feature alpha with enough detail. Feature beta with enough detail.",
  timestamp: isoHoursAgo(2),
  confidence: 0.95,
  attributes: {
    links: [],
    shopping_offer: {
      provider: "shopping/amazon",
      product_id: "B0PHASE5001",
      title: "Product Video Fixture",
      url: "https://www.amazon.com/dp/B0PHASE5001",
      price: { amount: 29.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
      shipping: { amount: 0, currency: "USD", notes: "free" },
      availability: "in_stock",
      rating: 4.8,
      reviews_count: 42
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
  trace: { requestId: "product-video-phase-5", ts: new Date().toISOString() },
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

const productVideoInput = (overrides: Partial<ProductVideoRunInput> = {}): ProductVideoRunInput => ({
  product_url: "https://www.amazon.com/dp/B0PHASE5001",
  include_screenshots: false,
  include_all_images: false,
  include_copy: false,
  ...overrides
});

describe("product-video substrate adoption", () => {
  it("compiles a fixed direct-url stage sequence without shopping resolution", () => {
    const plan = compileProductVideoExecutionPlan({
      input: productVideoInput()
    });

    expect(plan.compiled).toMatchObject({
      productUrl: "https://www.amazon.com/dp/B0PHASE5001",
      resolutionRequired: false,
      includeScreenshots: false,
      includeAllImages: false,
      includeCopy: false
    });
    expect(plan.plan.steps.map((step) => step.id)).toEqual([
      PRODUCT_VIDEO_STEP_IDS.normalizeInput,
      PRODUCT_VIDEO_STEP_IDS.fetchProductDetail,
      PRODUCT_VIDEO_STEP_IDS.extractProductData,
      PRODUCT_VIDEO_STEP_IDS.assembleArtifacts
    ]);
  });

  it("compiles a fixed product-name stage sequence with only the resolution seam added", () => {
    const plan = compileProductVideoExecutionPlan({
      input: productVideoInput({
        product_url: undefined,
        product_name: "Phase 5 product video",
        provider_hint: "amazon"
      })
    });

    expect(plan.compiled).toMatchObject({
      productName: "Phase 5 product video",
      providerHint: "amazon",
      resolutionRequired: true
    });
    expect(plan.plan.steps.map((step) => step.id)).toEqual([
      PRODUCT_VIDEO_STEP_IDS.normalizeInput,
      PRODUCT_VIDEO_STEP_IDS.resolveProductUrl,
      PRODUCT_VIDEO_STEP_IDS.fetchProductDetail,
      PRODUCT_VIDEO_STEP_IDS.extractProductData,
      PRODUCT_VIDEO_STEP_IDS.assembleArtifacts
    ]);
  });

  it("defaults artifact flags to true and omits unset checkpoint fields when serializing", () => {
    const detailResult = makeAggregate({
      records: [makeRecord()]
    });
    const plan = compileProductVideoExecutionPlan({
      input: {
        product_url: "https://www.amazon.com/dp/B0PHASE5001"
      }
    });

    expect(plan.compiled).toMatchObject({
      includeScreenshots: true,
      includeAllImages: true,
      includeCopy: true,
      resolutionRequired: false
    });
    expect(plan.plan.meta).toMatchObject({
      resolution_required: false,
      include_screenshots: true,
      include_all_images: true,
      include_copy: true
    });
    expect(plan.plan.steps.find((step) => step.id === PRODUCT_VIDEO_STEP_IDS.assembleArtifacts)).toMatchObject({
      input: {
        include_screenshots: true,
        include_all_images: true,
        include_copy: true
      }
    });
    expect(readProductVideoCheckpointState()).toEqual({
      completed_step_ids: []
    });
    expect(serializeProductVideoCheckpointState({
      completed_step_ids: []
    })).toEqual({
      completed_step_ids: []
    });
    expect(serializeProductVideoCheckpointState({
      completed_step_ids: [PRODUCT_VIDEO_STEP_IDS.fetchProductDetail],
      resolved_product_url: "https://www.amazon.com/dp/B0PHASE5001",
      resolved_provider_hint: "shopping/amazon",
      detail_result: detailResult
    })).toEqual({
      completed_step_ids: [PRODUCT_VIDEO_STEP_IDS.fetchProductDetail],
      resolved_product_url: "https://www.amazon.com/dp/B0PHASE5001",
      resolved_provider_hint: "shopping/amazon",
      detail_result: detailResult
    });
  });

  it("reads rich checkpoint state and rejects malformed product-video checkpoint payloads", () => {
    const richResult = makeAggregate({
      failures: [makeFailure("shopping/amazon", "shopping", {
        provider: "shopping/amazon",
        source: "shopping",
        reasonCode: "env_limited",
        details: {
          blocker: "captcha"
        }
      })],
      meta: {
        resume: "phase-5"
      },
      diagnostics: {
        stage: "execute"
      }
    });

    expect(readProductVideoCheckpointState({
      stage: "execute",
      stepId: PRODUCT_VIDEO_STEP_IDS.fetchProductDetail,
      stepIndex: 2,
      state: {
        completed_step_ids: [
          PRODUCT_VIDEO_STEP_IDS.normalizeInput,
          PRODUCT_VIDEO_STEP_IDS.resolveProductUrl,
          PRODUCT_VIDEO_STEP_IDS.fetchProductDetail
        ],
        resolved_product_url: "https://www.amazon.com/dp/B0PHASE5001",
        resolved_provider_hint: "shopping/amazon",
        detail_result: richResult
      },
      updatedAt: "2026-03-30T23:00:00.000Z"
    })).toEqual({
      completed_step_ids: [
        PRODUCT_VIDEO_STEP_IDS.normalizeInput,
        PRODUCT_VIDEO_STEP_IDS.resolveProductUrl,
        PRODUCT_VIDEO_STEP_IDS.fetchProductDetail
      ],
      resolved_product_url: "https://www.amazon.com/dp/B0PHASE5001",
      resolved_provider_hint: "shopping/amazon",
      detail_result: richResult
    });

    expect(() => readProductVideoCheckpointState({
      stage: "execute",
      state: {
        completed_step_ids: [1]
      }
    } as unknown as WorkflowCheckpoint)).toThrow(
      "Product-video workflow checkpoint state is missing valid completed_step_ids."
    );

    expect(() => readProductVideoCheckpointState({
      stage: "execute",
      state: {
        completed_step_ids: [PRODUCT_VIDEO_STEP_IDS.fetchProductDetail],
        detail_result: {
          ...makeAggregate(),
          failures: [{
            provider: "shopping/amazon",
            source: "shopping",
            error: {
              code: "bad_error_shape"
            }
          }]
        }
      } as unknown as Record<string, JsonValue>
    } as unknown as WorkflowCheckpoint)).toThrow(
      "Product-video workflow checkpoint state has an invalid detail_result."
    );
  });

  it("accepts checkpoint detail results that exercise optional trace and error fields", () => {
    const detailResult = makeAggregate({
      records: [makeRecord({
        url: undefined,
        title: undefined,
        content: undefined
      })],
      trace: {
        requestId: "product-video-phase-5-optional-trace",
        ts: new Date().toISOString(),
        sessionId: "session-1",
        targetId: "target-1",
        provider: "shopping/amazon"
      },
      failures: [makeFailure("shopping/amazon", "shopping", {
        provider: "shopping/amazon",
        source: "shopping",
        reasonCode: "challenge_detected",
        details: {
          blockerType: "anti_bot_challenge"
        }
      })],
      error: {
        code: "unavailable",
        message: "upstream failure",
        retryable: false,
        provider: "shopping/amazon",
        source: "shopping",
        reasonCode: "challenge_detected",
        details: {
          blockerType: "anti_bot_challenge"
        }
      },
      meta: {
        resume: "phase-5"
      },
      diagnostics: {
        stage: "execute"
      }
    });

    expect(readProductVideoCheckpointState({
      stage: "execute",
      stepId: PRODUCT_VIDEO_STEP_IDS.fetchProductDetail,
      stepIndex: 2,
      state: {
        completed_step_ids: [PRODUCT_VIDEO_STEP_IDS.fetchProductDetail],
        detail_result: detailResult
      }
    })).toEqual({
      completed_step_ids: [PRODUCT_VIDEO_STEP_IDS.fetchProductDetail],
      detail_result: detailResult
    });
  });

  it("rejects non-record checkpoint payloads and invalid resolution field types", () => {
    expect(() => readProductVideoCheckpointState({
      stage: "execute",
      state: "bad-state" as unknown as Record<string, JsonValue>
    } as WorkflowCheckpoint)).toThrow(
      "Product-video workflow checkpoint state must be a record."
    );

    expect(() => readProductVideoCheckpointState({
      stage: "execute",
      state: {
        completed_step_ids: [],
        resolved_product_url: 42
      } as unknown as Record<string, JsonValue>
    } as WorkflowCheckpoint)).toThrow(
      "Product-video workflow checkpoint state has an invalid resolved_product_url."
    );

    expect(() => readProductVideoCheckpointState({
      stage: "execute",
      state: {
        completed_step_ids: [],
        resolved_provider_hint: 42
      } as unknown as Record<string, JsonValue>
    } as WorkflowCheckpoint)).toThrow(
      "Product-video workflow checkpoint state has an invalid resolved_provider_hint."
    );
  });

  it("uses fetch only for direct-url execution and preserves the current asset payload shape", async () => {
    const search = vi.fn(async () => {
      throw new Error("shopping resolution should not run when product_url is provided");
    });
    const fetch = vi.fn(async () => makeAggregate({
      records: [makeRecord()]
    }));

    const output = await runProductVideoWorkflow(toRuntime({ search, fetch }), productVideoInput());

    expect(search).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Object.keys(output).sort()).toEqual([
      "images",
      "manifest",
      "meta",
      "path",
      "pricing",
      "product",
      "screenshots"
    ]);
    expect((output.manifest as { assets: { raw: string[] } }).assets.raw).toEqual(["raw/source-record.json"]);
    expect(output.images).toEqual([]);
    expect(output.screenshots).toEqual([]);
  });

  it("uses shopping only for URL resolution when the product name must be resolved", async () => {
    const search = vi.fn(async () => makeAggregate({
      records: [makeRecord({
        id: "resolved-search-record",
        url: "https://www.amazon.com/dp/B0PHASE5002",
        title: "Resolved Product Video Fixture",
        attributes: {
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "B0PHASE5002",
            title: "Resolved Product Video Fixture",
            url: "https://www.amazon.com/dp/B0PHASE5002",
            price: { amount: 31.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.7,
            reviews_count: 11
          }
        }
      })]
    }));
    const fetch = vi.fn(async () => makeAggregate({
      records: [makeRecord({
        id: "resolved-fetch-record",
        url: "https://www.amazon.com/dp/B0PHASE5002",
        title: "Resolved Product Video Fixture"
      })]
    }));

    const output = await runProductVideoWorkflow(toRuntime({ search, fetch }), productVideoInput({
      product_url: undefined,
      product_name: "Phase 5 product video",
      provider_hint: "amazon"
    }));

    expect(search).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.amazon.com/dp/B0PHASE5002" },
      expect.objectContaining({
        providerIds: ["shopping/amazon"]
      })
    );
    expect((output.product as { provider: string }).provider).toBe("shopping/amazon");
  });

  it("reuses checkpointed resolution and fetch state without replaying completed adaptive steps", async () => {
    const search = vi.fn(async () => {
      throw new Error("checkpointed resolution should not replay");
    });
    const fetch = vi.fn(async () => {
      throw new Error("checkpointed fetch should not replay");
    });
    const detailResult = makeAggregate({
      records: [makeRecord({
        id: "checkpoint-detail-record",
        url: "https://www.amazon.com/dp/B0PHASE5003",
        title: "Checkpointed Product Video Fixture"
      })]
    });

    const output = await runProductVideoWorkflow(
      toRuntime({ search, fetch }),
      buildWorkflowResumeEnvelope(
        "product_video",
        {
          product_name: "Checkpointed product video",
          include_screenshots: false,
          include_all_images: false,
          include_copy: false
        },
        {
          checkpoint: {
            stage: "execute",
            stepId: PRODUCT_VIDEO_STEP_IDS.fetchProductDetail,
            stepIndex: 2,
            state: {
              completed_step_ids: [
                PRODUCT_VIDEO_STEP_IDS.normalizeInput,
                PRODUCT_VIDEO_STEP_IDS.resolveProductUrl,
                PRODUCT_VIDEO_STEP_IDS.fetchProductDetail
              ],
              resolved_product_url: "https://www.amazon.com/dp/B0PHASE5003",
              resolved_provider_hint: "shopping/amazon",
              detail_result: detailResult
            }
          },
          trace: [
            {
              at: "2026-03-30T23:05:00.000Z",
              stage: "resume",
              event: "resume_seed"
            }
          ]
        }
      )
    );

    expect(search).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect((output.product as { provider: string }).provider).toBe("shopping/amazon");
    expect((output.product as { title: string }).title).toBe("Checkpointed Product Video Fixture");
  });

  it("rejects workflow envelopes from other kinds before product-video execution begins", async () => {
    await expect(runProductVideoWorkflow(
      toRuntime({}),
      buildWorkflowResumeEnvelope("research", {
        topic: "wrong-kind",
        mode: "json"
      })
    )).rejects.toThrow(
      "Product-video workflow envelope kind mismatch. Expected product_video but received research."
    );
  });

  it("rejects completed resolution checkpoints that omit resolved urls", async () => {
    await expect(runProductVideoWorkflow(
      toRuntime({}),
      buildWorkflowResumeEnvelope(
        "product_video",
        {
          product_name: "checkpointed product video",
          include_screenshots: false,
          include_all_images: false,
          include_copy: false
        },
        {
          checkpoint: {
            stage: "execute",
            stepId: PRODUCT_VIDEO_STEP_IDS.resolveProductUrl,
            stepIndex: 1,
            state: {
              completed_step_ids: [
                PRODUCT_VIDEO_STEP_IDS.normalizeInput,
                PRODUCT_VIDEO_STEP_IDS.resolveProductUrl
              ]
            }
          }
        }
      )
    )).rejects.toThrow(
      "Product-video workflow checkpoint is missing resolved_product_url for a completed resolution step."
    );
  });

  it("reuses compiled provider hints when checkpointed resolution lacks a resolved provider hint", async () => {
    const search = vi.fn(async () => {
      throw new Error("checkpointed resolution should not replay");
    });
    const fetch = vi.fn(async () => makeAggregate({
      records: [makeRecord({
        id: "checkpointed-provider-hint",
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/B0PHASE5004",
        title: "Checkpointed Hint Product"
      })]
    }));

    await runProductVideoWorkflow(
      toRuntime({ search, fetch }),
      buildWorkflowResumeEnvelope(
        "product_video",
        {
          product_name: "checkpointed product video",
          provider_hint: "amazon",
          include_screenshots: false,
          include_all_images: false,
          include_copy: false
        },
        {
          checkpoint: {
            stage: "execute",
            stepId: PRODUCT_VIDEO_STEP_IDS.resolveProductUrl,
            stepIndex: 1,
            state: {
              completed_step_ids: [
                PRODUCT_VIDEO_STEP_IDS.normalizeInput,
                PRODUCT_VIDEO_STEP_IDS.resolveProductUrl
              ],
              resolved_product_url: "https://www.amazon.com/dp/B0PHASE5004"
            }
          }
        }
      )
    );

    expect(search).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.amazon.com/dp/B0PHASE5004" },
      expect.objectContaining({
        source: "shopping",
        providerIds: ["shopping/amazon"]
      })
    );
  });

  it("rejects completed fetch checkpoints that omit detail results", async () => {
    await expect(runProductVideoWorkflow(
      toRuntime({}),
      buildWorkflowResumeEnvelope(
        "product_video",
        {
          product_name: "checkpointed product video",
          provider_hint: "amazon",
          include_screenshots: false,
          include_all_images: false,
          include_copy: false
        },
        {
          checkpoint: {
            stage: "execute",
            stepId: PRODUCT_VIDEO_STEP_IDS.fetchProductDetail,
            stepIndex: 2,
            state: {
              completed_step_ids: [
                PRODUCT_VIDEO_STEP_IDS.normalizeInput,
                PRODUCT_VIDEO_STEP_IDS.resolveProductUrl,
                PRODUCT_VIDEO_STEP_IDS.fetchProductDetail
              ],
              resolved_product_url: "https://www.amazon.com/dp/B0PHASE5005",
              resolved_provider_hint: "shopping/amazon"
            }
          }
        }
      )
    )).rejects.toThrow(
      "Product-video workflow checkpoint is missing detail_result for a completed fetch step."
    );
  });
});
