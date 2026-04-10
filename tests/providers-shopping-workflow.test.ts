import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileShoppingWorkflow,
  enforceShoppingLegalReviewGate,
  executeShoppingSearches,
  type ShoppingWorkflowRun
} from "../src/providers/shopping-workflow";
import {
  extractShoppingOffer,
  isLikelyOfferRecord,
  parsePriceFromContent,
  postprocessShoppingWorkflow,
  rankOffers,
  stripBrandSuffix
} from "../src/providers/shopping-postprocess";
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

  it("parses expanded currency tokens and spaced decimals from fallback content", () => {
    expect(parsePriceFromContent("Final sale CA$36 . 25 from reseller overlay")).toEqual({
      amount: 36.25,
      currency: "CAD"
    });
    expect(parsePriceFromContent("Buy now for USD 27 . 99 with free shipping")).toEqual({
      amount: 27.99,
      currency: "USD"
    });
  });

  it("ignores installment financing copy when a full product price is also present", () => {
    expect(parsePriceFromContent([
      "Main Content Logitech - MX Master 3S Bluetooth Edition Performance Wireless Optical Mouse with Ultra-fast Scrolling and Quiet Clicks - Wireless - Black",
      "Back to top $86.99 $86.99 The price was $99.99 Add to cart",
      "or 4 payments starting at $21.75 with Learn more Finance Options View your offers"
    ].join(" "))).toEqual({
      amount: 86.99,
      currency: "USD"
    });
  });

  it("preserves titles without a brand suffix and ignores zero-value fallback prices", () => {
    expect(stripBrandSuffix("Travel Monitor Pro", undefined)).toBe("Travel Monitor Pro");
    expect(parsePriceFromContent("Buy now for USD 0.00 with free shipping")).toEqual({
      amount: 0,
      currency: "USD"
    });
  });

  it("drops mismatched-currency offers when a region hint is provided", () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const compiled = compileShoppingWorkflow({
      query: "wireless earbuds",
      providers: ["shopping/amazon", "shopping/walmart"],
      region: "us",
      mode: "json"
    }, {
      now: new Date("2026-03-31T16:00:00.000Z")
    });

    const runs: ShoppingWorkflowRun[] = [
      {
        providerId: "shopping/amazon",
        result: makeAggregate({
          providerOrder: ["shopping/amazon"],
          records: [makeRecord({
            id: "amazon-cad-offer",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/dp/B0CADPRICE",
            title: "Wireless Earbuds",
            content: "Visit the Apple Store CAD 36 . 25 Final sale",
            attributes: {
              retrievalPath: "shopping:search:result-card",
              shopping_offer: {
                provider: "shopping/amazon",
                product_id: "amazon-cad-offer",
                title: "Wireless Earbuds",
                url: "https://www.amazon.com/dp/B0CADPRICE",
                price: {
                  amount: 36.25,
                  currency: "CAD",
                  retrieved_at: isoHoursAgo(1)
                },
                shipping: {
                  amount: 0,
                  currency: "CAD",
                  notes: "unknown"
                },
                availability: "in_stock",
                rating: 4.7,
                reviews_count: 120
              }
            }
          })]
        })
      },
      {
        providerId: "shopping/walmart",
        result: makeAggregate({
          providerOrder: ["shopping/walmart"],
          records: [makeRecord({
            id: "walmart-usd-offer",
            provider: "shopping/walmart",
            url: "https://www.walmart.com/ip/B0USDPRICE",
            title: "Wireless Earbuds",
            content: "$39.99 with free shipping",
            attributes: {
              retrievalPath: "shopping:search:result-card",
              shopping_offer: {
                provider: "shopping/walmart",
                product_id: "walmart-usd-offer",
                title: "Wireless Earbuds",
                url: "https://www.walmart.com/ip/B0USDPRICE",
                price: {
                  amount: 39.99,
                  currency: "USD",
                  retrieved_at: isoHoursAgo(1)
                },
                shipping: {
                  amount: 0,
                  currency: "USD",
                  notes: "free"
                },
                availability: "in_stock",
                rating: 4.6,
                reviews_count: 88
              }
            }
          })]
        })
      }
    ];

    const output = postprocessShoppingWorkflow(compiled, runs);

    expect(output.offers).toHaveLength(1);
    expect(output.offers[0]?.provider).toBe("shopping/walmart");
    expect(output.regionCurrencyExcluded).toBe(1);
    expect(output.budgetExcluded).toBe(0);
    expect(output.offerFilterDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: "shopping/amazon",
        candidateOffers: 1,
        pricedOffers: 1,
        regionMatchedOffers: 0,
        regionCurrencyExcluded: 1,
        allCandidateOffersDroppedByRegionCurrency: true
      })
    ]));
    expect(output.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "shopping/amazon",
        error: expect.objectContaining({
          reasonCode: "env_limited",
          details: expect.objectContaining({
            noOfferRecords: true,
            filterReason: "region_currency",
            regionCurrencyExcluded: 1,
            expectedCurrency: "USD"
          })
        })
      })
    ]));
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
    expect(output.budgetExcluded).toBe(0);
    expect(output.regionCurrencyExcluded).toBe(0);
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

  it("reports budget-filtered priced offers as a constraint-driven empty result", () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const compiled = compileShoppingWorkflow({
      query: "27 inch 4k monitor",
      providers: ["shopping/amazon"],
      budget: 350,
      mode: "json"
    }, {
      now: new Date("2026-03-30T18:00:00.000Z")
    });

    const runs: ShoppingWorkflowRun[] = [{
      providerId: "shopping/amazon",
      result: makeAggregate({
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "over-budget-offer",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/B0OVERBUDGET",
          title: "4K Monitor",
          content: "$399.99",
          attributes: {
            retrievalPath: "shopping:search:result-card",
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "over-budget-offer",
              title: "4K Monitor",
              url: "https://www.amazon.com/dp/B0OVERBUDGET",
              price: {
                amount: 399.99,
                currency: "USD",
                retrieved_at: isoHoursAgo(1)
              },
              shipping: {
                amount: 0,
                currency: "USD",
                notes: "free"
              },
              availability: "in_stock",
              rating: 4.7,
              reviews_count: 120
            }
          }
        })]
      })
    }];

    const output = postprocessShoppingWorkflow(compiled, runs);

    expect(output.offers).toEqual([]);
    expect(output.budgetExcluded).toBe(1);
    expect(output.failures).toEqual([
      expect.objectContaining({
        provider: "shopping/amazon",
        error: expect.objectContaining({
          reasonCode: "env_limited",
          details: expect.objectContaining({
            filterReason: "budget",
            budgetExcluded: 1,
            candidateOffers: 1
          })
        })
      })
    ]);
  });

  it("does not revive fetch-record body prices when a PDP offer has no trusted nested price", () => {
    const offer = extractShoppingOffer(makeRecord({
      id: "fetch-review-price",
      content: "Customer review: I actually prefer my knockoff $70 earbuds for music.",
      attributes: {
        retrievalPath: "shopping:fetch:url",
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "fetch-review-price",
          title: "Travel Monitor Pro",
          url: "https://www.amazon.com/dp/B0FETCHREVIEW",
          price: {
            amount: 0,
            currency: "USD",
            retrieved_at: isoHoursAgo(1)
          },
          price_source: "unresolved",
          price_is_trustworthy: false,
          shipping: {
            amount: 0,
            currency: "USD",
            notes: "std"
          },
          availability: "out_of_stock",
          rating: 0,
          reviews_count: 0
        }
      }
    }), new Date("2026-04-01T00:00:00.000Z"));

    expect(offer.price).toMatchObject({
      amount: 0,
      currency: "USD"
    });
  });

  it("ranks blank-query best-deal results by deal score without applying intent penalties", () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const cheaperOffer = extractShoppingOffer(makeRecord({
      id: "blank-query-cheaper",
      url: "https://www.amazon.com/dp/B0BLANK0001",
      title: "Portable Monitor Core",
      content: "$89.99",
      attributes: {
        retrievalPath: "shopping:search:result-card",
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "blank-query-cheaper",
          title: "Portable Monitor Core",
          url: "https://www.amazon.com/dp/B0BLANK0001",
          price: {
            amount: 89.99,
            currency: "USD",
            retrieved_at: isoHoursAgo(1)
          },
          shipping: {
            amount: 0,
            currency: "USD",
            notes: "free"
          },
          availability: "in_stock",
          rating: 4.5,
          reviews_count: 45
        }
      }
    }), now);
    const pricierOffer = extractShoppingOffer(makeRecord({
      id: "blank-query-pricier",
      url: "https://www.amazon.com/dp/B0BLANK0002",
      title: "Portable Monitor Plus",
      content: "$129.99",
      attributes: {
        retrievalPath: "shopping:search:result-card",
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "blank-query-pricier",
          title: "Portable Monitor Plus",
          url: "https://www.amazon.com/dp/B0BLANK0002",
          price: {
            amount: 129.99,
            currency: "USD",
            retrieved_at: isoHoursAgo(1)
          },
          shipping: {
            amount: 0,
            currency: "USD",
            notes: "free"
          },
          availability: "in_stock",
          rating: 4.5,
          reviews_count: 45
        }
      }
    }), now);

    expect(rankOffers([pricierOffer, cheaperOffer], "best_deal", "   ")[0]?.url).toBe(cheaperOffer.url);
  });

  it("prefers direct product matches over accessory listings for best-deal ranking", () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const directOffer = extractShoppingOffer(makeRecord({
      id: "direct-monitor",
      url: "https://www.amazon.com/dp/B0DIRECTMON",
      title: "Portable Monitor 15.6 inch",
      content: "$149.99",
      attributes: {
        retrievalPath: "shopping:search:result-card",
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "direct-monitor",
          title: "Portable Monitor 15.6 inch",
          url: "https://www.amazon.com/dp/B0DIRECTMON",
          price: {
            amount: 149.99,
            currency: "USD",
            retrieved_at: isoHoursAgo(1)
          },
          shipping: {
            amount: 0,
            currency: "USD",
            notes: "free"
          },
          availability: "in_stock",
          rating: 4.4,
          reviews_count: 82
        }
      }
    }), now);
    const accessoryOffer = extractShoppingOffer(makeRecord({
      id: "monitor-stand",
      url: "https://www.amazon.com/dp/B0MONITORSTD",
      title: "Portable Monitor Stand",
      content: "$19.99",
      attributes: {
        retrievalPath: "shopping:search:result-card",
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "monitor-stand",
          title: "Portable Monitor Stand",
          url: "https://www.amazon.com/dp/B0MONITORSTD",
          price: {
            amount: 19.99,
            currency: "USD",
            retrieved_at: isoHoursAgo(1)
          },
          shipping: {
            amount: 0,
            currency: "USD",
            notes: "free"
          },
          availability: "in_stock",
          rating: 4.9,
          reviews_count: 500
        }
      }
    }), now);

    expect(rankOffers([accessoryOffer, directOffer], "best_deal", "portable monitor")[0]?.url).toBe(directOffer.url);
  });

  it("keeps already-direct matches ahead of accessory rows during best-deal ranking", () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const directOffer = extractShoppingOffer(makeRecord({
      id: "direct-first-rank",
      url: "https://www.amazon.com/dp/B0DIRECTKEEP",
      title: "Portable Monitor 15.6 inch",
      content: "$149.99",
      attributes: {
        retrievalPath: "shopping:search:result-card",
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "direct-first-rank",
          title: "Portable Monitor 15.6 inch",
          url: "https://www.amazon.com/dp/B0DIRECTKEEP",
          price: {
            amount: 149.99,
            currency: "USD",
            retrieved_at: isoHoursAgo(1)
          },
          shipping: {
            amount: 0,
            currency: "USD",
            notes: "free"
          },
          availability: "in_stock",
          rating: 4.4,
          reviews_count: 82
        }
      }
    }), now);
    const accessoryOffer = extractShoppingOffer(makeRecord({
      id: "accessory-second-rank",
      url: "https://www.amazon.com/dp/B0STANDKEEP",
      title: "Portable Monitor Stand",
      content: "$19.99",
      attributes: {
        retrievalPath: "shopping:search:result-card",
        shopping_offer: {
          provider: "shopping/amazon",
          product_id: "accessory-second-rank",
          title: "Portable Monitor Stand",
          url: "https://www.amazon.com/dp/B0STANDKEEP",
          price: {
            amount: 19.99,
            currency: "USD",
            retrieved_at: isoHoursAgo(1)
          },
          shipping: {
            amount: 0,
            currency: "USD",
            notes: "free"
          },
          availability: "in_stock",
          rating: 4.9,
          reviews_count: 500
        }
      }
    }), now);

    expect(rankOffers([directOffer, accessoryOffer], "best_deal", "portable monitor")[0]?.url).toBe(directOffer.url);
  });

  it("rejects shopping search records that are seed rows, assets, or provider-domain mismatches", () => {
    expect(isLikelyOfferRecord(makeRecord({
      attributes: {
        retrievalPath: "shopping:search:index"
      }
    }))).toBe(false);
    expect(isLikelyOfferRecord(makeRecord({
      url: "https://images.example.com/item.png"
    }))).toBe(false);
    expect(isLikelyOfferRecord(makeRecord({
      provider: "shopping/amazon",
      url: "https://www.walmart.com/ip/123",
      attributes: {
        retrievalPath: "shopping:search:result-card"
      }
    }))).toBe(false);
  });

  it("keeps no-url records but rejects bare URL titles for likely-offer detection", () => {
    expect(isLikelyOfferRecord(makeRecord({
      url: "",
      title: "Offer without canonical url"
    }))).toBe(true);
    expect(isLikelyOfferRecord(makeRecord({
      title: "https://www.amazon.com/dp/B0TEST1234"
    }))).toBe(false);
  });

  it("treats unsupported region codes as advisory and keeps priced offers available", () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const compiled = compileShoppingWorkflow({
      query: "wireless earbuds",
      providers: ["shopping/amazon"],
      region: "apac",
      mode: "json"
    }, {
      now: new Date("2026-03-31T16:00:00.000Z")
    });

    const output = postprocessShoppingWorkflow(compiled, [{
      providerId: "shopping/amazon",
      result: makeAggregate({
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "unsupported-region-offer",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/B0APAC0001",
          title: "Wireless Earbuds",
          content: "CAD 36.25",
          attributes: {
            retrievalPath: "shopping:search:result-card",
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "unsupported-region-offer",
              title: "Wireless Earbuds",
              url: "https://www.amazon.com/dp/B0APAC0001",
              price: {
                amount: 36.25,
                currency: "CAD",
                retrieved_at: isoHoursAgo(1)
              },
              shipping: {
                amount: 0,
                currency: "CAD",
                notes: "free"
              },
              availability: "in_stock",
              rating: 4.7,
              reviews_count: 120
            }
          }
        })]
      })
    }]);

    expect(output.offers).toHaveLength(1);
    expect(output.regionCurrencyExcluded).toBe(0);
    expect(output.offerFilterDiagnostics).toEqual([
      expect.objectContaining({
        requestedRegion: "apac",
        finalOffers: 1
      })
    ]);
    expect(output.offerFilterDiagnostics[0]).not.toHaveProperty("expectedCurrency");
  });

  it("reports zero-price-only candidate sets as a zero-price filter failure", () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const compiled = compileShoppingWorkflow({
      query: "usb-c dock",
      providers: ["shopping/amazon"],
      mode: "json"
    }, {
      now: new Date("2026-03-30T18:00:00.000Z")
    });

    const output = postprocessShoppingWorkflow(compiled, [{
      providerId: "shopping/amazon",
      result: makeAggregate({
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "zero-only-offer",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/B0ZEROONLY1",
          title: "USB-C Dock",
          content: "Price unavailable",
          attributes: {
            retrievalPath: "shopping:search:result-card",
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "zero-only-offer",
              title: "USB-C Dock",
              url: "https://www.amazon.com/dp/B0ZEROONLY1",
              price: {
                amount: 0,
                currency: "USD",
                retrieved_at: isoHoursAgo(1)
              },
              shipping: {
                amount: 0,
                currency: "USD",
                notes: "free"
              },
              availability: "in_stock",
              rating: 4.5,
              reviews_count: 50
            }
          }
        })]
      })
    }]);

    expect(output.offers).toEqual([]);
    expect(output.zeroPriceExcluded).toBe(1);
    expect(output.failures).toEqual([
      expect.objectContaining({
        provider: "shopping/amazon",
        error: expect.objectContaining({
          details: expect.objectContaining({
            filterReason: "zero_price",
            zeroPriceExcluded: 1
          })
        })
      })
    ]);
  });

  it("includes region currency context when budget filtering removes every priced offer", () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const compiled = compileShoppingWorkflow({
      query: "27 inch 4k monitor",
      providers: ["shopping/amazon"],
      budget: 100,
      region: "us",
      mode: "json"
    }, {
      now: new Date("2026-03-30T18:00:00.000Z")
    });

    const output = postprocessShoppingWorkflow(compiled, [{
      providerId: "shopping/amazon",
      result: makeAggregate({
        providerOrder: ["shopping/amazon"],
        records: [makeRecord({
          id: "over-budget-region-offer",
          provider: "shopping/amazon",
          url: "https://www.amazon.com/dp/B0OVERBUDGET2",
          title: "4K Monitor",
          content: "$120.00",
          attributes: {
            retrievalPath: "shopping:search:result-card",
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "over-budget-region-offer",
              title: "4K Monitor",
              url: "https://www.amazon.com/dp/B0OVERBUDGET2",
              price: {
                amount: 120,
                currency: "USD",
                retrieved_at: isoHoursAgo(1)
              },
              shipping: {
                amount: 0,
                currency: "USD",
                notes: "free"
              },
              availability: "in_stock",
              rating: 4.7,
              reviews_count: 120
            }
          }
        })]
      })
    }]);

    expect(output.offers).toEqual([]);
    expect(output.failures[0]?.error.message).toContain("USD currency heuristic for region us");
  });

  it("prioritizes render-required issue hints over generic env-limited search shells", () => {
    vi.spyOn(shoppingModule, "validateShoppingLegalReviewChecklist")
      .mockReturnValue({ valid: true });
    const compiled = compileShoppingWorkflow({
      query: "portable monitor",
      providers: ["shopping/amazon"],
      mode: "json"
    }, {
      now: new Date("2026-03-30T18:00:00.000Z")
    });

    const output = postprocessShoppingWorkflow(compiled, [{
      providerId: "shopping/amazon",
      result: makeAggregate({
        providerOrder: ["shopping/amazon"],
        records: [
          makeRecord({
            id: "generic-env-limited-shell",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/s?k=portable+monitor",
            title: "Search results",
            content: "No usable offer cards were extracted.",
            attributes: {
              retrievalPath: "shopping:search:index",
              reasonCode: "env_limited"
            }
          }),
          makeRecord({
            id: "render-required-shell",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/s?k=portable+monitor",
            title: "Search results",
            content: "Enable JavaScript to continue.",
            attributes: {
              retrievalPath: "shopping:search:index",
              constraint: {
                kind: "render_required",
                summary: "Browser-rendered search results are required."
              }
            }
          })
        ]
      })
    }]);

    expect(output.failures).toEqual([
      expect.objectContaining({
        provider: "shopping/amazon",
        error: expect.objectContaining({
          message: "Provider requires browser-rendered results for query \"portable monitor\".",
          details: expect.objectContaining({
            reasonCode: "env_limited",
            recordsCount: 2,
            title: "Search results",
            url: "https://www.amazon.com/s?k=portable+monitor"
          })
        })
      })
    ]);
  });

  it("penalizes used-condition offers for generic queries but preserves used-intent and used-only fallbacks", () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const genericQuery = "Apple AirPods Pro 2nd Generation";
    const usedQuery = "Apple AirPods Pro 2nd Generation used";
    const preownedOffer = extractShoppingOffer(makeRecord({
      id: "walmart-preowned-airpods",
      provider: "shopping/walmart",
      url: "https://www.walmart.com/ip/Pre-Owned-Apple-AirPods-Pro-2nd-Generation-Lightning/19336719172?classType=REGULAR&conditionGroupCode=3&from=%2Fsearch",
      title: "Pre-Owned Apple AirPods Pro (2nd Generation) - Lightning",
      content: "$139.99",
      attributes: {
        retrievalPath: "shopping:search:result-card",
        shopping_offer: {
          provider: "shopping/walmart",
          product_id: "walmart-preowned-airpods",
          title: "Pre-Owned Apple AirPods Pro (2nd Generation) - Lightning",
          url: "https://www.walmart.com/ip/Pre-Owned-Apple-AirPods-Pro-2nd-Generation-Lightning/19336719172?classType=REGULAR&conditionGroupCode=3&from=%2Fsearch",
          price: {
            amount: 139.99,
            currency: "USD",
            retrieved_at: isoHoursAgo(1)
          },
          shipping: {
            amount: 0,
            currency: "USD",
            notes: "free"
          },
          availability: "in_stock",
          rating: 3.8,
          reviews_count: 2158
        }
      }
    }), now);
    const newOffer = extractShoppingOffer(makeRecord({
      id: "walmart-new-airpods",
      provider: "shopping/walmart",
      url: "https://www.walmart.com/ip/Apple-AirPods-Pro-2nd-Generation-with-MagSafe-Case-USB-C/5689912134?classType=REGULAR&from=%2Fsearch",
      title: "Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)",
      content: "$189.99",
      attributes: {
        retrievalPath: "shopping:search:result-card",
        shopping_offer: {
          provider: "shopping/walmart",
          product_id: "walmart-new-airpods",
          title: "Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)",
          url: "https://www.walmart.com/ip/Apple-AirPods-Pro-2nd-Generation-with-MagSafe-Case-USB-C/5689912134?classType=REGULAR&from=%2Fsearch",
          price: {
            amount: 189.99,
            currency: "USD",
            retrieved_at: isoHoursAgo(1)
          },
          shipping: {
            amount: 0,
            currency: "USD",
            notes: "free"
          },
          availability: "in_stock",
          rating: 4.7,
          reviews_count: 325
        }
      }
    }), now);

    expect(rankOffers([preownedOffer, newOffer], "best_deal", genericQuery)[0]?.url).toBe(newOffer.url);
    expect(rankOffers([preownedOffer, newOffer], "best_deal", usedQuery)[0]?.url).toBe(preownedOffer.url);
    expect(rankOffers([preownedOffer], "best_deal", genericQuery)[0]?.url).toBe(preownedOffer.url);
  });
});
