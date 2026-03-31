import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileShoppingWorkflow,
  enforceShoppingLegalReviewGate,
  executeShoppingSearches,
  type ShoppingWorkflowRun
} from "../src/providers/shopping-workflow";
import { postprocessShoppingWorkflow } from "../src/providers/shopping-postprocess";
import * as shoppingModule from "../src/providers/shopping";
import type {
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
  trace: { requestId: "shopping-workflow-test", ts: new Date().toISOString() },
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
  getAntiBotSnapshots?: ProviderExecutor["getAntiBotSnapshots"];
}): ProviderExecutor => ({
  search: handlers.search ?? (async () => makeAggregate()),
  fetch: handlers.fetch ?? (async () => makeAggregate()),
  ...(handlers.getAntiBotSnapshots ? { getAntiBotSnapshots: handlers.getAntiBotSnapshots } : {})
});

describe("shopping workflow seam extraction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates legal review and region diagnostics while auto-excluding degraded default providers", () => {
    const defaultProviderIds = shoppingModule.SHOPPING_PROVIDER_PROFILES
      .filter((profile) => profile.tier === "tier1")
      .map((profile) => profile.id);
    const degradedProvider = defaultProviderIds[0]!;
    const effectiveProviders = defaultProviderIds.slice(1);
    const validateSpy = vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const diagnostics = [{
      provider: effectiveProviders[0] ?? "shopping/others",
      requestedRegion: "us",
      enforced: false,
      strategy: "default_storefront" as const,
      storefrontDomain: "example.com",
      reason: "provider_search_path_ignores_region" as const
    }];
    const diagnosticsSpy = vi.spyOn(shoppingModule, "getShoppingRegionSupportDiagnostics")
      .mockReturnValue(diagnostics);

    const compiled = compileShoppingWorkflow({
      query: "portable monitor",
      region: "us",
      mode: "json"
    }, {
      now: new Date("2026-03-30T18:00:00.000Z"),
      getDegradedProviders: () => new Set([degradedProvider])
    });

    expect(compiled.autoExcludedProviders).toEqual([degradedProvider]);
    expect(compiled.effectiveProviderIds).toEqual(effectiveProviders);
    expect(validateSpy).toHaveBeenCalledTimes(effectiveProviders.length);
    expect(validateSpy).toHaveBeenCalledWith(effectiveProviders[0], expect.any(Date));
    expect(diagnosticsSpy).toHaveBeenCalledWith(effectiveProviders, "us");
    expect(compiled.regionDiagnostics).toEqual(diagnostics);
  });

  it("throws a missing_checklist summary when legal review validation fails without a reason code", () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: false });

    expect(() => enforceShoppingLegalReviewGate(
      ["shopping/amazon"],
      new Date("2026-03-30T18:00:00.000Z")
    )).toThrow("Provider legal review checklist invalid or expired: shopping/amazon:missing_checklist");
  });

  it("preserves shopping search filters and run options in the extracted executor", async () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const aggregate = makeAggregate({
      providerOrder: ["shopping/amazon"],
      records: [makeRecord()]
    });
    const search = vi.fn(async () => aggregate);
    const observeResult = vi.fn();
    const compiled = compileShoppingWorkflow({
      query: "standing desk",
      providers: ["shopping/amazon"],
      budget: 120,
      region: "ca",
      sort: "lowest_price",
      mode: "json"
    });

    const runs = await executeShoppingSearches(toRuntime({ search }), compiled, {
      buildSearchOptions: (providerId) => ({
        source: "shopping",
        providerIds: [providerId],
        timeoutMs: 777
      }),
      observeResult
    });

    expect(search).toHaveBeenCalledWith({
      query: "standing desk",
      limit: 8,
      filters: {
        budget: 120,
        region: "ca"
      }
    }, {
      source: "shopping",
      providerIds: ["shopping/amazon"],
      timeoutMs: 777
    });
    expect(observeResult).toHaveBeenCalledWith(aggregate);
    expect(runs).toEqual([{
      providerId: "shopping/amazon",
      result: aggregate
    }]);
  });

  it("passes an empty filter map when budget and region are omitted", async () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const search = vi.fn(async () => makeAggregate());
    const compiled = compileShoppingWorkflow({
      query: "standing desk",
      providers: ["shopping/amazon"],
      mode: "json"
    });

    await executeShoppingSearches(toRuntime({ search }), compiled, {
      buildSearchOptions: (providerId) => ({
        source: "shopping",
        providerIds: [providerId],
        timeoutMs: 555
      })
    });

    expect(search).toHaveBeenCalledWith({
      query: "standing desk",
      limit: 8,
      filters: {}
    }, {
      source: "shopping",
      providerIds: ["shopping/amazon"],
      timeoutMs: 555
    });
  });

  it("postprocesses offers without changing output shape and synthesizes empty-result failures", () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const compiled = compileShoppingWorkflow({
      query: "portable monitor",
      providers: ["shopping/amazon", "shopping/others"],
      mode: "json"
    }, {
      now: new Date("2026-03-30T18:00:00.000Z")
    });

    const runs: ShoppingWorkflowRun[] = [
      {
        providerId: "shopping/amazon",
        result: makeAggregate({
          providerOrder: ["shopping/amazon"],
          records: [
            makeRecord(),
            makeRecord({
              id: "zero-price",
              url: "https://www.amazon.com/dp/B0ZEROPRICE",
              content: "Call for price",
              attributes: {
                retrievalPath: "shopping:search:result-card",
                shopping_offer: {
                  provider: "shopping/amazon",
                  product_id: "product-zero",
                  title: "Travel Monitor Pro",
                  url: "https://www.amazon.com/dp/B0ZEROPRICE",
                  price: {
                    amount: 0,
                    currency: "USD",
                    retrieved_at: isoHoursAgo(1)
                  },
                  shipping: {
                    amount: 0,
                    currency: "USD",
                    notes: "std"
                  },
                  availability: "in_stock",
                  rating: 4.6,
                  reviews_count: 10
                }
              }
            })
          ]
        })
      },
      {
        providerId: "shopping/others",
        result: makeAggregate({
          providerOrder: ["shopping/others"],
          records: [makeRecord({
            id: "search-index",
            provider: "shopping/others",
            url: "https://shop.example/search?q=portable+monitor",
            title: "Search Results",
            attributes: {
              retrievalPath: "shopping:search:index"
            }
          })]
        })
      }
    ];

    const output = postprocessShoppingWorkflow(compiled, runs);

    expect(output.offers).toHaveLength(1);
    expect(output.offers[0]).toEqual(expect.objectContaining({
      offer_id: expect.any(String),
      product_id: expect.any(String),
      provider: "shopping/amazon",
      url: "https://www.amazon.com/dp/B0TEST1234",
      title: "Travel Monitor Pro",
      price: expect.objectContaining({
        amount: 30,
        currency: "USD",
        retrieved_at: expect.any(String)
      }),
      shipping: expect.objectContaining({
        amount: 5,
        currency: "USD"
      }),
      availability: "in_stock",
      rating: 4.7,
      reviews_count: 120,
      deal_score: expect.any(Number),
      attributes: expect.objectContaining({
        source_record_id: "rec-1"
      })
    }));
    expect(output.zeroPriceExcluded).toBe(1);
    expect(output.records).toHaveLength(3);
    expect(output.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "shopping/others",
        source: "shopping",
        error: expect.objectContaining({
          code: "unavailable",
          reasonCode: "env_limited",
          details: expect.objectContaining({
            noOfferRecords: true
          })
        })
      })
    ]));
  });
});
