import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRODUCT_VIDEO_STEP_IDS,
  compileProductVideoExecutionPlan,
  readProductVideoCheckpointState,
  serializeProductVideoCheckpointState
} from "../src/providers/product-video-compiler";
import {
  PRODUCT_VIDEO_BRIEF_HELPER_PATH,
  buildProductVideoSuccessHandoff
} from "../src/providers/workflow-handoff";
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

afterEach(() => {
  vi.unstubAllGlobals();
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
    const handoff = buildProductVideoSuccessHandoff({
      productUrl: "https://www.amazon.com/dp/B0PHASE5001",
      providerHint: "shopping/amazon",
      browserMode: "extension"
    });

    const output = await runProductVideoWorkflow(toRuntime({ search, fetch }), productVideoInput({
      browserMode: "extension"
    }));

    expect(search).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Object.keys(output).sort()).toEqual([
      "artifact_path",
      "followthroughSummary",
      "images",
      "manifest",
      "meta",
      "pricing",
      "product",
      "screenshots",
      "suggestedNextAction",
      "suggestedSteps"
    ]);
    expect(output.followthroughSummary).toBe(handoff.followthroughSummary);
    expect(output.suggestedNextAction).toBe(handoff.suggestedNextAction);
    expect(output.suggestedSteps).toEqual(handoff.suggestedSteps);
    expect((output.suggestedSteps as Array<{ command?: string }>)[2]?.command).toContain("--browser-mode extension");
    expect(output.suggestedNextAction).toContain("product-video brief helper");
    expect(output.suggestedNextAction).not.toContain("<pack>");
    expect((output.suggestedSteps as Array<{ command?: string }>)[1]?.command).toBe(
      `${PRODUCT_VIDEO_BRIEF_HELPER_PATH} <pack>/manifest.json`
    );
    expect(output.meta).toMatchObject({
      followthroughSummary: handoff.followthroughSummary,
      presentationReadiness: {
        status: "partial",
        reasonCodes: expect.arrayContaining(["copy_omitted_by_request", "positive_spec_promoted"])
      },
      productVideoReadiness: {
        status: "partial"
      }
    });
    expect((output.manifest as { assets: { raw: string[] } }).assets.raw).toEqual(["raw/source-record.json"]);
    expect((output.manifest as {
      readiness: { presentation: { status: string }; productVideo: { status: string } };
    }).readiness).toMatchObject({
      presentation: { status: "partial" },
      productVideo: { status: "partial" }
    });
    expect((output.product as {
      presentationReadiness: { status: string; reasonCodes: string[] };
    }).presentationReadiness.reasonCodes).toEqual(expect.arrayContaining([
      "copy_omitted_by_request",
      "positive_spec_promoted"
    ]));
    expect(output.images).toEqual([]);
    expect(output.screenshots).toEqual([]);
  });

  it("uses presentation compiler output for noisy marketplace copy and features", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      records: [makeRecord({
        id: "ebay-noisy-product-record",
        provider: "shopping/ebay",
        url: "https://www.ebay.com/itm/123456",
        title: "Logitech Lift Vertical Ergonomic Mouse",
        content: [
          "Type Vertical Mouse Maximum DPI 1200 Connectivity Wireless Features Adjustable DPI, Ergonomic.",
          "Quantity 1 available.",
          "Condition: New: A brand-new, unused, unopened, undamaged item in its original packaging.",
          "May not ship to Canada.",
          "Seller feedback is 98% positive.",
          "Buy It Now and add to cart.",
          "Returns accepted within 30 days."
        ].join(" "),
        attributes: {
          links: [],
          brand: "Logitech",
          shopping_offer: {
            provider: "shopping/ebay",
            product_id: "123456",
            title: "Logitech Lift Vertical Ergonomic Mouse",
            url: "https://www.ebay.com/itm/123456",
            price: { amount: 79.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "USD", notes: "unknown" },
            availability: "in_stock",
            rating: 4.8,
            reviews_count: 42
          }
        }
      })]
    }));

    const output = await runProductVideoWorkflow(toRuntime({ fetch }), productVideoInput({
      product_url: "https://www.ebay.com/itm/123456",
      include_copy: true
    }));
    const publicText = [
      (output.product as { copy: string }).copy,
      ...((output.product as { features: string[] }).features)
    ].join("\n");

    expect((output.meta as {
      presentationReadiness: { status: string; reasonCodes: string[] };
    }).presentationReadiness).toMatchObject({
      status: "partial",
      reasonCodes: expect.arrayContaining(["marketplace_chrome_rejected", "positive_spec_promoted"])
    });
    expect(publicText).toMatch(/Vertical Mouse/i);
    expect(publicText).toMatch(/1200 DPI/i);
    expect(publicText).toMatch(/Wireless connectivity/i);
    expect(publicText).toMatch(/Adjustable DPI/i);
    expect(publicText).not.toMatch(/Quantity 1/i);
    expect(publicText).not.toMatch(/Condition: New/i);
    expect(publicText).not.toMatch(/May not ship to Canada/i);
    expect(publicText).not.toMatch(/Seller feedback/i);
    expect(publicText).not.toMatch(/Buy It Now/i);
    expect(publicText).not.toMatch(/original packaging/i);
    expect(publicText).not.toMatch(/Returns accepted/i);
  });

  it("does not switch selected records to a cleaner unrelated product with conflicting offer identity", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      records: [
        makeRecord({
          id: "requested-product-record",
          title: "Requested Product",
          content: [
            "Quantity 1 available.",
            "Condition: New: A brand-new item.",
            "Seller feedback is 98% positive.",
            "Buy It Now and checkout today."
          ].join(" "),
          attributes: {
            links: [],
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "B0REQUESTED",
              title: "Requested Product",
              url: "https://www.amazon.com/dp/B0REQUESTED",
              price: { amount: 29.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.8,
              reviews_count: 42
            }
          }
        }),
        makeRecord({
          id: "unrelated-clean-record",
          url: "https://www.amazon.com/dp/B0REQUESTED",
          title: "Unrelated Clean Product",
          content: "Type Vertical Mouse Maximum DPI 1200 Connectivity Wireless Features Adjustable DPI, Ergonomic.",
          attributes: {
            links: [],
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "B0OTHER",
              title: "Unrelated Clean Product",
              url: "https://www.amazon.com/dp/B0OTHER",
              price: { amount: 49.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.8,
              reviews_count: 42
            }
          }
        })
      ]
    }));

    const output = await runProductVideoWorkflow(toRuntime({ fetch }), productVideoInput({
      product_url: "https://www.amazon.com/dp/B0REQUESTED",
      include_copy: true
    }));
    const readiness = (output.meta as {
      presentationReadiness: { status: string; reasonCodes: string[] };
    }).presentationReadiness;

    expect((output.product as { title: string }).title).toBe("Requested Product");
    expect(readiness.status).toBe("fail");
    expect(readiness.reasonCodes).not.toContain("selected_record_changed");
    expect((output.product as { features: string[] }).features).toEqual([]);
  });

  it("switches selected records only when cleaner candidates share product identity", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      records: [
        makeRecord({
          id: "same-product-marketplace-record",
          title: "Same Product Marketplace Shell",
          url: "https://www.amazon.com/dp/B0SAMEPRODUCT",
          content: [
            "Quantity 1 available.",
            "Condition: New: A brand-new item.",
            "Seller feedback is 98% positive.",
            "Buy It Now and checkout today."
          ].join(" "),
          attributes: {
            links: [],
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "B0SAMEPRODUCT",
              title: "Same Product Marketplace Shell",
              price: { amount: 29.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.8,
              reviews_count: 42
            }
          }
        }),
        makeRecord({
          id: "clean-record-with-malformed-offer",
          url: undefined,
          title: "Malformed Offer Clean Product",
          content: "Type Vertical Mouse Maximum DPI 1200 Connectivity Wireless Features Adjustable DPI, Ergonomic.",
          attributes: {
            links: [],
            shopping_offer: []
          }
        }),
        makeRecord({
          id: "same-product-clean-record",
          url: undefined,
          title: "Same Product Clean Detail",
          content: "Type Vertical Mouse Maximum DPI 1200 Connectivity Wireless Features Adjustable DPI, Ergonomic.",
          attributes: {
            links: [],
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "B0SAMEPRODUCT",
              title: "Same Product Clean Detail",
              price: { amount: 29.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.8,
              reviews_count: 42
            }
          }
        })
      ]
    }));

    const output = await runProductVideoWorkflow(toRuntime({ fetch }), productVideoInput({
      product_url: "https://www.amazon.com/dp/B0SAMEPRODUCT",
      include_copy: true
    }));
    const product = output.product as { title: string; features: string[] };
    const readiness = (output.meta as {
      presentationReadiness: { status: string; reasonCodes: string[] };
    }).presentationReadiness;

    expect(product.title).toBe("Same Product Clean Detail");
    expect(product.features).toEqual(expect.arrayContaining([
      expect.stringMatching(/Vertical Mouse/i),
      expect.stringMatching(/1200 DPI/i),
      expect.stringMatching(/Wireless connectivity/i),
      expect.stringMatching(/Adjustable DPI/i)
    ]));
    expect(readiness.reasonCodes).toEqual(expect.arrayContaining([
      "selected_record_changed",
      "positive_spec_promoted"
    ]));
    expect(readiness.status).not.toBe("fail");
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
    expect((output.suggestedSteps as Array<{ command?: string }>)[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-url \"https://www.amazon.com/dp/B0PHASE5002\" --provider-hint shopping/amazon --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --output-format json"
    );
  });

  it("skips shopping resolution offers that do not contain a usable product url", async () => {
    const search = vi.fn(async () => makeAggregate({
      records: [
        makeRecord({
          id: "resolved-search-record-empty-url",
          url: "",
          title: "Top ranked but unusable offer",
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "B0EMPTYURL",
              title: "Top ranked but unusable offer",
              url: "",
              price: { amount: 19.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.9,
              reviews_count: 100
            }
          }
        }),
        makeRecord({
          id: "resolved-search-record-valid-url",
          url: "https://www.amazon.com/dp/B0PHASE5003",
          title: "Resolved Product Video Fixture",
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "B0PHASE5003",
              title: "Resolved Product Video Fixture",
              url: "https://www.amazon.com/dp/B0PHASE5003",
              price: { amount: 31.99, currency: "USD", retrieved_at: isoHoursAgo(1) },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.7,
              reviews_count: 11
            }
          }
        })
      ]
    }));
    const fetch = vi.fn(async () => makeAggregate({
      records: [makeRecord({
        id: "resolved-fetch-record-valid-url",
        url: "https://www.amazon.com/dp/B0PHASE5003",
        title: "Resolved Product Video Fixture"
      })]
    }));

    await runProductVideoWorkflow(toRuntime({ search, fetch }), productVideoInput({
      product_url: undefined,
      product_name: "Phase 5 product video",
      provider_hint: "amazon"
    }));

    expect(fetch).toHaveBeenCalledWith(
      { url: "https://www.amazon.com/dp/B0PHASE5003" },
      expect.objectContaining({
        providerIds: ["shopping/amazon"]
      })
    );
  });

  it("keeps usable product detail records even when fetch reports a non-ok aggregate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      url: "https://www.amazon.com/dp/B0PHASE5004",
      text: async () => "<html><head><title>Amazon.com</title></head><body></body></html>"
    })) as unknown as typeof fetch);
    const fetch = vi.fn(async () => makeAggregate({
      ok: false,
      error: {
        code: "unavailable",
        message: "upstream warning",
        retryable: false
      },
      failures: [makeFailure("shopping/amazon", "shopping", {
        code: "unavailable",
        message: "upstream warning",
        retryable: false
      })],
      records: [makeRecord({
        id: "non-ok-detail-record",
        url: "https://www.amazon.com/dp/B0PHASE5004",
        title: "Recovered Detail Record"
      })]
    }));

    const output = await runProductVideoWorkflow(toRuntime({ fetch }), productVideoInput({
      product_url: "https://www.amazon.com/dp/B0PHASE5004"
    }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((output.product as { title: string }).title).toBe("Recovered Detail Record");
  });

  it("uses Best Buy PDP content pricing when the structured marketplace price is missing", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      records: [makeRecord({
        id: "bestbuy-content-price-record",
        source: "shopping",
        provider: "shopping/bestbuy",
        url: "https://www.bestbuy.com/product/logitech-mx-master-3s-wireless-mouse/J7H7ZYG559",
        title: "$(csi.user.businessName) Skip to content Go to Product Search Assistive Survey Yardbird Best Buy Outlet Best Buy Business Menu…",
        content: [
          "$(csi.user.businessName) Skip to content Go to Product Search Assistive Survey Yardbird Best Buy Outlet Best Buy Business Menu",
          "Main Content Logitech - MX Master 3S Bluetooth Edition Performance Wireless Optical Mouse with Ultra-fast Scrolling and Quiet Clicks - Wireless - Black",
          "Rating 4.8 out of 5 stars with 290 reviews 4.8 (290 reviews)",
          "Back to top $86.99 $86.99 The price was $99.99 Add to cart",
          "or 4 payments starting at $21.75 with Learn more > Finance Options View your offers",
          "Availability Pickup Ready within 1 hour Shipping Get it by Sat, Apr 11"
        ].join(" "),
        attributes: {
          links: [],
          shopping_offer: {
            provider: "shopping/bestbuy",
            product_id: "J7H7ZYG559",
            title: "$(csi.user.businessName) Skip to content Go to Product Search Assistive Survey Yardbird Best Buy Outlet Best Buy Business Menu…",
            url: "https://www.bestbuy.com/product/logitech-mx-master-3s-wireless-mouse/J7H7ZYG559",
            price: { amount: 0, currency: "USD", retrieved_at: isoHoursAgo(1) },
            price_source: "unresolved",
            price_is_trustworthy: false,
            shipping: { amount: 0, currency: "USD", notes: "unknown" },
            availability: "in_stock",
            rating: 4.8,
            reviews_count: 290
          }
        }
      })]
    }));

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })) as typeof fetch);

    const output = await runProductVideoWorkflow(toRuntime({ fetch }), productVideoInput({
      product_url: "https://www.bestbuy.com/product/logitech-mx-master-3s-wireless-mouse/J7H7ZYG559"
    }));

    expect(output.pricing).toMatchObject({
      amount: 86.99,
      currency: "USD"
    });
    expect((output.product as { brand: string }).brand).toBe("Logitech");
    expect((output.product as { provider: string }).provider).toBe("shopping/bestbuy");
    expect((output.product as { title: string }).title).toBe(
      "Logitech - MX Master 3S Bluetooth Edition Performance Wireless Optical Mouse with Ultra-fast Scrolling and Quiet Clicks - Wireless - Black"
    );
  });

  it("rejects Best Buy error shells before emitting product-video assets", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      records: [makeRecord({
        id: "bestbuy-pdp-error-shell",
        source: "shopping",
        provider: "shopping/bestbuy",
        url: "https://www.bestbuy.com/site/logitech-mx-master-3s/6502574.p?skuId=6502574",
        title: "None Early Black Friday Deals New Doorbusters every Friday.",
        content: [
          "None Early Black Friday Deals New Doorbusters every Friday.",
          "We’re sorry, something went wrong.",
          "You can use our search bar or pick a category below.",
          "If you typed in a URL, check it for errors."
        ].join(" "),
        attributes: {
          links: ["https://pisces.bbystatic.com/image2/BestBuy_US/Gallery/GL-44932-vpt-error_lv-140337.jpg"],
          shopping_offer: {
            provider: "shopping/bestbuy",
            product_id: "6502574",
            title: "None Early Black Friday Deals New Doorbusters every Friday.",
            url: "https://www.bestbuy.com/site/logitech-mx-master-3s/6502574.p?skuId=6502574",
            price: { amount: 0, currency: "USD", retrieved_at: isoHoursAgo(1) },
            price_source: "unresolved",
            price_is_trustworthy: false,
            shipping: { amount: 0, currency: "USD", notes: "unknown" },
            availability: "in_stock",
            rating: 0,
            reviews_count: 0
          }
        }
      })]
    }));

    await expect(runProductVideoWorkflow(toRuntime({ fetch }), productVideoInput({
      product_url: "https://www.bestbuy.com/site/logitech-mx-master-3s/6502574.p?skuId=6502574"
    }))).rejects.toThrow("Best Buy product target returned a generic error shell");
  });

  it("fails honestly when an external seller overlay suppresses the only product price on a marketplace PDP", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      records: [makeRecord({
        id: "overlay-priced-record",
        title: "Apple AirPods Pro",
        content: "CAD 36.13 See current price, availability, shipping cost, and delivery date on mrhumanitygives.com. Continue to site. Shipper / Seller mrhumanitygives.com.",
        attributes: {
          links: [],
          brand: "Apple",
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "B0PHASE5005",
            title: "Apple AirPods Pro",
            url: "https://www.amazon.com/dp/B0PHASE5005",
            price: { amount: 36.13, currency: "CAD", retrieved_at: isoHoursAgo(1) },
            shipping: { amount: 0, currency: "CAD", notes: "unknown" },
            availability: "out_of_stock",
            rating: 4.7,
            reviews_count: 0
          }
        }
      })]
    }));

    await expect(runProductVideoWorkflow(toRuntime({ fetch }), productVideoInput({
      product_url: "https://www.amazon.com/dp/B0PHASE5005"
    }))).rejects.toThrow(
      "Amazon requires manual browser follow-up; this run did not determine a reliable PDP price."
    );
  });

  it("fails honestly when an Amazon PDP only contains review-body price pollution and no trustworthy price source", async () => {
    const fetch = vi.fn(async () => makeAggregate({
      records: [makeRecord({
        id: "review-body-price-record",
        title: "Apple AirPods Pro",
        content: "Customer review: I actually prefer my knockoff $70 earbuds for music.",
        attributes: {
          links: [],
          brand: "Apple",
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "B0PHASE5006",
            title: "Apple AirPods Pro",
            url: "https://www.amazon.com/dp/B0PHASE5006",
            price: { amount: 0, currency: "USD", retrieved_at: isoHoursAgo(1) },
            price_source: "unresolved",
            price_is_trustworthy: false,
            shipping: { amount: 0, currency: "USD", notes: "unknown" },
            availability: "out_of_stock",
            rating: 4.7,
            reviews_count: 11
          }
        }
      })]
    }));

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      url: "https://www.amazon.com/dp/B0PHASE5006",
      text: async () => "<html><head><title>Apple AirPods Pro</title></head><body><main>Customer review: I actually prefer my knockoff $70 earbuds for music.</main></body></html>"
    })) as unknown as typeof fetch);

    await expect(runProductVideoWorkflow(toRuntime({ fetch }), productVideoInput({
      product_url: "https://www.amazon.com/dp/B0PHASE5006"
    }))).rejects.toThrow(
      "Amazon requires manual browser follow-up; this run did not determine a reliable PDP price."
    );
  });

  it("reuses checkpointed resolution and fetch state without replaying completed adaptive steps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      url: "https://www.amazon.com/dp/B0PHASE5003",
      text: async () => "<html><head><title>Amazon.com</title></head><body></body></html>"
    })) as unknown as typeof fetch);
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

    const output = await runProductVideoWorkflow(
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
    expect((output.product as { provider: string }).provider).toBe("shopping/amazon");
    expect((output.suggestedSteps as Array<{ command?: string }>)[2]?.command).toBe(
      "npx opendevbrowser product-video run --product-url \"https://www.amazon.com/dp/B0PHASE5004\" --provider-hint shopping/amazon --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --output-format json"
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
