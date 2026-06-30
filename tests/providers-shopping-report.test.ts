import { describe, expect, it } from "vitest";
import {
  buildShoppingBriefing,
  renderShoppingBriefingMarkdown,
  type ShoppingBriefing,
  type ShoppingBriefingInput,
  type ShoppingReportOfferEvidence
} from "../src/providers/shopping-report";
import {
  anchorDiscountForOffer,
  assessQueryRelevance,
  assessTitleQuality,
  buildDuplicateGroups,
  buildMarketBaseline,
  buildShoppingOfferEvidence
} from "../src/providers/shopping-report/rules";
import type { ShoppingOffer } from "../src/providers/renderer";

const REFERENCE_TIME = "2026-06-15T12:00:00.000Z";
const FRESH_TIME = "2026-06-15T10:00:00.000Z";
const STALE_TIME = "2026-05-01T10:00:00.000Z";

interface OfferOptions {
  id?: string;
  productId?: string;
  provider?: string;
  title?: string;
  url?: string;
  amount?: number;
  currency?: string;
  shipping?: number;
  availability?: ShoppingOffer["availability"];
  retrievedAt?: string;
  nestedRetrievedAt?: string | null;
  captureTimestamp?: string;
  priceTrust?: boolean | null;
  priceSource?: string;
  anchorPrice?: number;
  shippingCurrency?: string;
  dealScore?: number;
  attributes?: Record<string, unknown>;
}

const nestedShoppingOffer = (options: Required<Pick<OfferOptions, "title" | "url" | "amount" | "currency">> & OfferOptions): Record<string, unknown> => {
  const price: Record<string, unknown> = {
    amount: options.amount,
    currency: options.currency
  };
  if (options.nestedRetrievedAt) price.retrieved_at = options.nestedRetrievedAt;
  const nested: Record<string, unknown> = {
    provider: options.provider ?? "shopping/amazon",
    product_id: options.productId ?? options.id ?? "offer-1",
    title: options.title,
    url: options.url,
    price,
    price_source: options.priceSource ?? "structured_metadata",
    shipping: {
      amount: options.shipping ?? 0,
      currency: options.shippingCurrency ?? options.currency,
      notes: "reported"
    },
    availability: options.availability ?? "in_stock"
  };
  if (options.priceTrust !== null) nested.price_is_trustworthy = options.priceTrust ?? true;
  if (options.captureTimestamp) nested.capture_timestamp = options.captureTimestamp;
  if (options.anchorPrice) nested.list_price = { amount: options.anchorPrice, currency: options.currency };
  return nested;
};

const offer = (options: OfferOptions = {}): ShoppingOffer => {
  const id = options.id ?? "offer-1";
  const productId = options.productId ?? id;
  const provider = options.provider ?? "shopping/amazon";
  const title = options.title ?? "Logitech Lift Vertical Ergonomic Mouse";
  const url = options.url ?? `https://example.com/${id}`;
  const amount = options.amount ?? 79.99;
  const currency = options.currency ?? "USD";
  const nested = nestedShoppingOffer({
    ...options,
    id,
    productId,
    provider,
    title,
    url,
    amount,
    currency,
    nestedRetrievedAt: options.nestedRetrievedAt === null ? undefined : options.nestedRetrievedAt ?? FRESH_TIME
  });
  return {
    offer_id: id,
    product_id: productId,
    provider,
    url,
    title,
    price: {
      amount,
      currency,
      retrieved_at: options.retrievedAt ?? (options.nestedRetrievedAt === null ? FRESH_TIME : options.nestedRetrievedAt ?? FRESH_TIME)
    },
    shipping: {
      amount: options.shipping ?? 0,
      currency: options.shippingCurrency ?? currency,
      notes: "reported"
    },
    availability: options.availability ?? "in_stock",
    rating: 4.6,
    reviews_count: 120,
    deal_score: options.dealScore ?? 0.9,
    attributes: {
      retrievalPath: "shopping:search:result-card",
      canonicalUrl: url,
      shopping_offer: nested,
      ...(options.attributes ?? {})
    }
  };
};

const briefingInput = (overrides: Partial<ShoppingBriefingInput> = {}): ShoppingBriefingInput => ({
  query: "ergonomic mouse",
  offers: [
    offer({ id: "a", amount: 80 }),
    offer({
      id: "b",
      provider: "shopping/bestbuy",
      title: "Anker Vertical Ergonomic Mouse",
      amount: 90,
      url: "https://bestbuy.example/mouse"
    })
  ],
  meta: {
    selection: {
      providers: ["shopping/amazon", "shopping/bestbuy"],
      requested_region: "US",
      region_authoritative: true
    }
  },
  freshnessReferenceIso: REFERENCE_TIME,
  ...overrides
});
const markdownFor = (input: ShoppingBriefingInput): string => renderShoppingBriefingMarkdown(buildShoppingBriefing(input));

const sectionIndex = (markdown: string, heading: string): number => markdown.indexOf(heading);

describe("shopping-report", () => {
  it("renders the deterministic shopping briefing section order", () => {
    const markdown = markdownFor(briefingInput());
    const headings = [
      "# Shopping Buying Brief",
      "## Buying Readiness Gate",
      "## Recommendation",
      "## Best Candidate Offers",
      "## Market Baseline",
      "## Warnings and Constraints",
      "## Excluded or Constrained Offers",
      "## Evidence Appendix"
    ];

    let previous = -1;
    for (const heading of headings) {
      const current = sectionIndex(markdown, heading);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it("evaluates pass, partial, and fail gate statuses", () => {
    const pass = buildShoppingBriefing(briefingInput());
    const partial = buildShoppingBriefing(briefingInput({
      offers: [offer({ id: "unknown", availability: "unknown" })]
    }));
    const fail = buildShoppingBriefing(briefingInput({ offers: [] }));

    expect(pass.gate.status).toBe("pass");
    expect(partial.gate.status).toBe("partial");
    expect(fail.gate.status).toBe("fail");
  });

  it("renders missing buyer limitations without downgrading otherwise healthy pass guidance", () => {
    const briefing = buildShoppingBriefing(briefingInput());
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.gate.status).toBe("pass");
    expect(markdown).toContain("buyer limitation: seller trust not reported");
    expect(markdown).toContain("buyer limitation: return policy not reported");
    expect(markdown).toContain("buyer limitation: warranty coverage not reported");
    expect(markdown).toContain("buyer limitation: item condition not reported");
    expect(markdown).toContain("buyer limitation: shipping certainty not reported");
  });

  it("allows pass readiness with healthy runtime-shaped filter diagnostics", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      meta: {
        selection: {
          providers: ["shopping/amazon", "shopping/bestbuy"],
          requested_region: "US",
          region_authoritative: true
        },
        offerFilterDiagnostics: [
          {
            providerId: "shopping/amazon",
            candidateOffers: 2,
            pricedOffers: 2,
            regionMatchedOffers: 2,
            zeroPriceExcluded: 0,
            regionCurrencyExcluded: 0,
            budgetExcluded: 0,
            finalOffers: 2,
            allCandidateOffersDroppedByZeroPrice: false,
            allCandidateOffersDroppedByRegionCurrency: false,
            allCandidateOffersDroppedByBudget: false
          },
          {
            providerId: "shopping/bestbuy",
            candidateOffers: 1,
            pricedOffers: 1,
            regionMatchedOffers: 1,
            zeroPriceExcluded: 0,
            regionCurrencyExcluded: 0,
            budgetExcluded: 0,
            finalOffers: 1,
            allCandidateOffersDroppedByZeroPrice: false,
            allCandidateOffersDroppedByRegionCurrency: false,
            allCandidateOffersDroppedByBudget: false
          }
        ]
      }
    }));

    expect(briefing.gate.status).toBe("pass");
    expect(briefing.metaView.offerFilterDiagnostics).toEqual([]);
  });

  it("does not use confident buying language when the gate fails", () => {
    const markdown = markdownFor(briefingInput({ offers: [] }));

    expect(markdown).toContain("Status: fail");
    expect(markdown).not.toMatch(/Strong buy|best deal|recommended/i);
  });

  it("keeps partial-gate user-facing markdown free of recommended labels", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "clean", amount: 80 }),
        offer({
          id: "unknown-stock",
          title: "Anker Vertical Ergonomic Mouse",
          amount: 90,
          availability: "unknown",
          url: "https://example.com/unknown-stock"
        })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.gate.status).toBe("partial");
    expect(briefing.assessments.every((assessment) => assessment.recommendation !== "recommended")).toBe(true);
    expect(markdown).not.toContain("[recommended]");
    expect(markdown).not.toMatch(/\brecommended\b/i);
  });

  it("warns and lowers readiness for duplicate same-title or same-product pressure", () => {
    const duplicateTitle = "Logitech Lift Vertical Ergonomic Mouse";
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "dup-a", productId: "p-shared", title: duplicateTitle, url: "https://market.example/a" }),
        offer({ id: "dup-b", productId: "p-shared", title: duplicateTitle, url: "https://market.example/b" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.gate.status).toBe("partial");
    expect(briefing.duplicateGroups.length).toBeGreaterThanOrEqual(1);
    expect(markdown).toMatch(/duplicate pressure/i);
  });

  it("excludes weak relevance and suspicious rating-title offers from confident guidance", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "generic", title: "Wireless Optical Mouse", url: "https://example.com/wireless-optical" }),
        offer({ id: "rating", title: "Rated 4.7 out of 5 stars with 214 reviews", url: "https://example.com/rating" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.gate.status).toBe("fail");
    expect(briefing.assessments.map((assessment) => assessment.recommendation)).toEqual(["excluded", "excluded"]);
    expect(markdown).toMatch(/weak relevance/i);
    expect(markdown).toMatch(/suspicious title/i);
  });

  it("rejects product-noun false positives in query relevance", () => {
    const mouseBriefing = buildShoppingBriefing(briefingInput({
      query: "mouse",
      offers: [
        offer({ id: "keyboard-a", title: "Logitech MX Keys Wireless Keyboard", url: "https://example.com/mouse-keyboard-a" }),
        offer({ id: "keyboard-b", title: "Keychron Low Profile Wireless Keyboard", url: "https://example.com/mouse-keyboard-b" })
      ]
    }));
    const earbudsBriefing = buildShoppingBriefing(briefingInput({
      query: "wireless earbuds",
      offers: [
        offer({ id: "charger-a", title: "Anker Wireless Charging Pad", url: "https://example.com/earbuds-charger-a" }),
        offer({ id: "charger-b", title: "Belkin Wireless Charger Stand", url: "https://example.com/earbuds-charger-b" })
      ]
    }));

    expect(mouseBriefing.gate.status).toBe("fail");
    expect(mouseBriefing.assessments.every((assessment) => assessment.recommendation === "excluded")).toBe(true);
    expect(earbudsBriefing.gate.status).toBe("fail");
    expect(earbudsBriefing.assessments.every((assessment) => assessment.recommendation === "excluded")).toBe(true);
  });

  it("accepts common product synonyms, numeric descriptors, and soft wireless descriptors", () => {
    const microphoneBriefing = buildShoppingBriefing(briefingInput({
      query: "usb microphone",
      offers: [
        offer({ id: "mic-a", title: "Blue Yeti USB Mic", url: "https://example.com/mic-a" }),
        offer({ id: "mic-b", title: "Rode USB Microphone", url: "https://example.com/mic-b" })
      ]
    }));
    const monitorBriefing = buildShoppingBriefing(briefingInput({
      query: "27 inch 4k monitor",
      offers: [
        offer({ id: "monitor-a", title: "Dell 27 4K Monitor", url: "https://example.com/monitor-a" }),
        offer({ id: "monitor-b", title: "LG 27 4K Monitor", url: "https://example.com/monitor-b" })
      ]
    }));
    const wirelessMouseBriefing = buildShoppingBriefing(briefingInput({
      query: "wireless ergonomic mouse",
      offers: [
        offer({ id: "mouse-a", title: "Logitech Lift Vertical Ergonomic Mouse", url: "https://example.com/mouse-a" }),
        offer({ id: "mouse-b", title: "Anker Vertical Ergonomic Mouse", url: "https://example.com/mouse-b" })
      ]
    }));

    for (const briefing of [microphoneBriefing, monitorBriefing, wirelessMouseBriefing]) {
      expect(briefing.gate.status).toBe("pass");
      expect(briefing.assessments.every((assessment) => assessment.evidence.queryRelevance.status !== "weak")).toBe(true);
      expect(briefing.assessments.every((assessment) => assessment.recommendation === "recommended")).toBe(true);
    }
  });

  it("normalizes common plural product query terms and bare budget tokens", () => {
    const relevantCases = [
      { query: "ergo mice", title: "Logitech Ergo Mouse" },
      { query: "wireless earbuds", title: "Jabra Wireless Earbud" },
      { query: "headphones", title: "Sony Headphone" },
      { query: "monitors", title: "Dell Monitor" },
      { query: "speakers", title: "JBL Speaker" },
      { query: "webcams", title: "Logitech Webcam" }
    ];

    for (const relevantCase of relevantCases) {
      const relevance = assessQueryRelevance(relevantCase.query, relevantCase.title);
      expect(relevance.status).toBe("strong");
      expect(relevance.missingTokens).toEqual([]);
    }

    const budgetRelevance = assessQueryRelevance("mice $150", "Logitech Wireless Mouse");
    const emptyQueryRelevance = assessQueryRelevance("and the", "Logitech Wireless Mouse");
    expect(budgetRelevance.status).toBe("strong");
    expect(budgetRelevance.missingTokens).not.toContain("150");
    expect(emptyQueryRelevance.score).toBe(1);
    expect(emptyQueryRelevance.missingTokens).toEqual([]);
  });

  it("ignores budget price numbers in query relevance while preserving product spec numbers", () => {
    const budgetBriefing = buildShoppingBriefing(briefingInput({
      query: "ergonomic mouse under $150",
      offers: [
        offer({ id: "mouse-a", title: "Logitech Lift Vertical Ergonomic Mouse", amount: 80, url: "https://example.com/mouse-a" }),
        offer({ id: "mouse-b", title: "Anker Vertical Ergonomic Mouse", amount: 90, url: "https://example.com/mouse-b" })
      ]
    }));
    const specMissingBriefing = buildShoppingBriefing(briefingInput({
      query: "27 inch 4k monitor",
      offers: [
        offer({ id: "monitor-a", title: "Dell 24 Inch 4K Monitor", amount: 200, url: "https://example.com/monitor-a" }),
        offer({ id: "monitor-b", title: "LG 27 Inch Monitor", amount: 220, url: "https://example.com/monitor-b" })
      ]
    }));

    expect(budgetBriefing.gate.status).toBe("pass");
    expect(budgetBriefing.assessments.every((assessment) => assessment.evidence.queryRelevance.missingTokens.includes("150"))).toBe(false);
    expect(specMissingBriefing.gate.status).toBe("fail");
    expect(specMissingBriefing.assessments.map((assessment) => assessment.evidence.queryRelevance.missingTokens)).toEqual([
      ["27"],
      ["4k"]
    ]);
  });

  it("uses structured product attributes for relevance while ignoring URL-only attribute text", () => {
    const numericAttribute = buildShoppingBriefing(briefingInput({
      query: "27 monitor",
      offers: [
        offer({ id: "model-a", title: "Dell UltraSharp Monitor", attributes: { model_number: 27 } }),
        offer({ id: "model-b", title: "LG UltraFine Monitor", url: "https://example.com/model-b", attributes: { model_number: 27 } })
      ]
    }));
    const urlAttributeOnly = buildShoppingBriefing(briefingInput({
      query: "ergonomic monitor",
      offers: [
        offer({ id: "url-attr-a", title: "Dell Monitor", attributes: { description: "https://example.com/ergonomic-monitor" } }),
        offer({
          id: "url-attr-b",
          title: "LG Monitor",
          url: "https://example.com/url-attr-b",
          attributes: { description: "https://example.com/ergonomic-monitor" }
        })
      ]
    }));

    expect(numericAttribute.gate.status).toBe("pass");
    expect(numericAttribute.evidence.every((entry) => entry.queryRelevance.matchedTokens.includes("27"))).toBe(true);
    expect(urlAttributeOnly.gate.status).toBe("fail");
    expect(urlAttributeOnly.assessments.every((assessment) => assessment.recommendation === "excluded")).toBe(true);
    expect(urlAttributeOnly.evidence.every((entry) => entry.queryRelevance.missingTokens.includes("ergonomic"))).toBe(true);
  });

  it("flags short URL price-only and generic product titles as suspicious", () => {
    expect(assessTitleQuality("USB").reasons).toContain("title is too short to verify a product");
    expect(assessTitleQuality("https://store.example/product").reasons).toContain("title looks like a URL");
    expect(assessTitleQuality("$79.99").reasons).toContain("title is price-only");
    expect(assessTitleQuality("Shop Now").reasons).toContain("title is generic interface text");
  });

  it("constrains untrusted and unknown price trust evidence", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "trusted-a", amount: 80 }),
        offer({ id: "trusted-b", amount: 90, url: "https://example.com/trusted-b" }),
        offer({ id: "untrusted", amount: 70, priceTrust: false, url: "https://example.com/untrusted" }),
        offer({ id: "unknown-trust", amount: 75, priceTrust: null, url: "https://example.com/unknown-trust" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.gate.status).toBe("partial");
    expect(briefing.confidence).toBe("medium");
    expect(markdown).toMatch(/price source is marked untrusted/i);
    expect(markdown).toMatch(/price trust was not reported/i);
  });

  it("classifies capture timestamps invalid freshness references and malformed observed times", () => {
    const captured = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "captured", nestedRetrievedAt: null, retrievedAt: "", captureTimestamp: FRESH_TIME }),
        offer({
          id: "fresh-peer",
          title: "Anker Vertical Ergonomic Mouse",
          url: "https://example.com/fresh-peer"
        })
      ]
    }));
    const invalidReference = buildShoppingBriefing(briefingInput({
      freshnessReferenceIso: "not-a-date",
      offers: [
        offer({ id: "invalid-reference", nestedRetrievedAt: FRESH_TIME }),
        offer({
          id: "invalid-reference-peer",
          title: "Anker Vertical Ergonomic Mouse",
          url: "https://example.com/invalid-reference-peer"
        })
      ]
    }));
    const malformedObserved = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "malformed-observed", nestedRetrievedAt: "not-a-date", retrievedAt: "" }),
        offer({
          id: "fresh-peer-two",
          title: "Anker Vertical Ergonomic Mouse",
          url: "https://example.com/fresh-peer-two"
        })
      ]
    }));

    expect(captured.evidence[0]?.freshness).toMatchObject({
      status: "observed",
      source: "attributes.shopping_offer.capture_timestamp"
    });
    expect(invalidReference.evidence[0]?.freshness).toMatchObject({
      status: "inferred",
      label: "observed timestamp cannot be aged without a freshness reference"
    });
    expect(malformedObserved.evidence[0]?.freshness.status).toBe("missing");
  });


  it("excludes invalid prices from actionable candidates and recommendations", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "valid-a", title: "Logitech Lift Vertical Ergonomic Mouse", amount: 100 }),
        offer({ id: "valid-b", title: "Anker Vertical Ergonomic Mouse", amount: 120, url: "https://example.com/valid-b" }),
        offer({ id: "zero", title: "Microsoft Sculpt Ergonomic Mouse", amount: 0, url: "https://example.com/zero" }),
        offer({ id: "negative", title: "Kensington Ergonomic Mouse", amount: -5, url: "https://example.com/negative" }),
        offer({ id: "nan", title: "Contour Ergonomic Mouse", amount: Number.NaN, url: "https://example.com/nan" }),
        offer({ id: "bad-ship", title: "Goldtouch Ergonomic Mouse", amount: 80, shipping: -1, url: "https://example.com/bad-ship" }),
        offer({ id: "nan-ship", title: "Razer Ergonomic Mouse", amount: 80, shipping: Number.NaN, url: "https://example.com/nan-ship" })
      ]
    }));
    const invalid = briefing.assessments.filter((assessment) => ["zero", "negative", "nan", "bad-ship", "nan-ship"].includes(assessment.evidence.offerId));

    expect(invalid).toHaveLength(5);
    expect(invalid.every((assessment) => assessment.recommendation === "excluded")).toBe(true);
    expect(invalid.flatMap((assessment) => assessment.warnings).join("\n")).toContain("invalid price");
    expect(briefing.assessments.filter((assessment) => assessment.recommendation === "recommended").map((assessment) => assessment.evidence.offerId)).toEqual(["valid-a", "valid-b"]);
  });

  it("records product-specific exclusion reasons for invalid stock weak relevance and title quality failures", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "invalid-price", amount: 0 }),
        offer({ id: "out-stock", availability: "out_of_stock", url: "https://example.com/out-stock" }),
        offer({ id: "weak-relevance", title: "Logitech Wireless Keyboard", url: "https://example.com/weak-relevance" }),
        offer({ id: "suspicious-title", title: "https://store.example/ergonomic-mouse", url: "https://example.com/suspicious-title" })
      ]
    }));
    const reasonsById = new Map(briefing.assessments.map((assessment) => [
      assessment.evidence.offerId,
      assessment.reasons[0]
    ]));

    expect(reasonsById.get("invalid-price")).toBe("excluded because price evidence is invalid");
    expect(reasonsById.get("out-stock")).toBe("excluded because availability is out of stock");
    expect(reasonsById.get("weak-relevance")).toBe("excluded because query relevance is weak");
    expect(reasonsById.get("suspicious-title")).toBe("excluded because title quality is suspicious");
  });

  it("constrains unknown availability and excludes out-of-stock offers", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "unknown-stock", availability: "unknown" }),
        offer({ id: "out-stock", availability: "out_of_stock", url: "https://example.com/out-stock" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.gate.status).toBe("partial");
    expect(briefing.assessments[0]?.recommendation).toBe("constrained");
    expect(briefing.assessments[1]?.recommendation).toBe("excluded");
    expect(markdown).toMatch(/unknown availability/i);
    expect(markdown).toContain("out-of-stock offer cannot be promoted");
  });

  it("keeps limited-stock product offers usable while lowering their quality score", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "limited-stock", availability: "limited", amount: 80 }),
        offer({
          id: "in-stock",
          title: "Anker Vertical Ergonomic Mouse",
          amount: 80,
          url: "https://example.com/in-stock"
        })
      ]
    }));
    const limited = briefing.assessments.find((assessment) => assessment.evidence.offerId === "limited-stock");
    const inStock = briefing.assessments.find((assessment) => assessment.evidence.offerId === "in-stock");

    expect(limited?.recommendation).toBe("recommended");
    expect(inStock?.recommendation).toBe("recommended");
    expect(inStock?.qualityScore).toBeGreaterThan(limited?.qualityScore ?? 0);
  });

  it("uses optional product metadata when present and suppresses reported buyer limitation gaps", () => {
    const richNestedOffer = (id: string, title: string, amount: number): Record<string, unknown> => ({
      ...nestedShoppingOffer({
        id,
        productId: id,
        provider: "shopping/amazon",
        title,
        url: `https://example.com/${id}`,
        amount,
        currency: "USD",
        nestedRetrievedAt: FRESH_TIME
      }),
      seller_rating: 4.8,
      return_policy: "30 day returns",
      warranty: "2 year warranty",
      condition: "new",
      original_price: { amount: amount + 40, currency: "USD" },
      shipping: {
        amount: 0,
        currency: "USD",
        checkout_verified: true
      }
    });
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({
          id: "rich-a",
          title: "Logitech Lift Vertical Ergonomic Mouse",
          amount: 80,
          attributes: {
            brand: "Logitech",
            shopping_offer: richNestedOffer("rich-a", "Logitech Lift Vertical Ergonomic Mouse", 80)
          }
        }),
        offer({
          id: "rich-b",
          title: "Anker Vertical Ergonomic Mouse",
          amount: 90,
          url: "https://example.com/rich-b",
          attributes: {
            brand: "Anker",
            shopping_offer: richNestedOffer("rich-b", "Anker Vertical Ergonomic Mouse", 90)
          }
        })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.gate.status).toBe("pass");
    expect(briefing.evidence.every((entry) => entry.buyerLimitations.length === 0)).toBe(true);
    expect(briefing.evidence[0]).toMatchObject({
      brand: "Logitech",
      priceSource: "structured_metadata",
      retrievalPath: "shopping:search:result-card"
    });
    expect(markdown).toContain("anchor discount: USD 40.00");
    expect(markdown).toContain("Explicit anchor/list price evidence present for 2 same-currency offer(s).");
    expect(markdown).toContain("## Warnings and Constraints\n- None reported.");
    expect(markdown).toContain("## Excluded or Constrained Offers\n- No offers were excluded or constrained by the report gate.");
    expect(markdown).not.toContain("buyer limitation:");
  });

  it("falls back safely when optional offer metadata is absent", () => {
    const plainOffer: ShoppingOffer = {
      offer_id: "plain",
      product_id: "plain",
      provider: "shopping/example",
      url: "https://example.com/plain",
      title: "Logitech Lift Vertical Ergonomic Mouse",
      price: { amount: 80, currency: "USD", retrieved_at: FRESH_TIME },
      shipping: { amount: 0, currency: "USD", notes: "reported" },
      availability: "in_stock",
      rating: 4.4,
      reviews_count: 20,
      deal_score: 0.7,
      attributes: {
        shopping_offer: {
          price: { amount: 80, currency: "USD", retrieved_at: FRESH_TIME },
          shipping: { amount: 0, currency: "USD" },
          price_is_trustworthy: true
        }
      }
    };
    const evidence = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: plainOffer,
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });

    expect(evidence.canonicalUrl).toBe("https://example.com/plain");
    expect("retrievalPath" in evidence).toBe(false);
    expect("priceSource" in evidence).toBe(false);
    expect("brand" in evidence).toBe(false);
    expect(anchorDiscountForOffer(evidence)).toBeUndefined();
  });

  it("reads anchor money from numeric and currencyless object evidence shapes", () => {
    const numericAnchor = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "numeric-anchor", attributes: { original_price: 120 } }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });
    const currencylessAnchor = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "currencyless-anchor", attributes: { anchor_price: { amount: 140 } } }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });
    const missingAmountAnchor = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "missing-anchor-amount", attributes: { msrp: { currency: "USD" } } }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });

    expect(anchorDiscountForOffer(numericAnchor)?.amount).toBeCloseTo(40.01);
    expect(currencylessAnchor.anchorPrice).toEqual({ amount: 140, currency: "USD" });
    expect(missingAmountAnchor.anchorPrice).toBeUndefined();
  });

  it("falls back to item or shipping currency when one price currency is missing", () => {
    const itemCurrencyMissing = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "missing-item-currency", currency: "", shippingCurrency: "USD" }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });
    const shippingCurrencyMissing = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "missing-shipping-currency", currency: "USD", shippingCurrency: "" }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });

    expect(itemCurrencyMissing.totalPrice.currency).toBe("USD");
    expect(itemCurrencyMissing.currencyMismatch).toBe(true);
    expect(shippingCurrencyMissing.shippingPrice.currency).toBe("USD");
    expect(shippingCurrencyMissing.currencyMismatch).toBe(false);
    expect(buildMarketBaseline([], 2)).toMatchObject({
      status: "unavailable",
      sampleCount: 0,
      offerIds: []
    });
  });

  it("distinguishes missing, inferred, and stale freshness evidence", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "missing", retrievedAt: "", nestedRetrievedAt: null, captureTimestamp: undefined }),
        offer({ id: "inferred", retrievedAt: REFERENCE_TIME, nestedRetrievedAt: null, captureTimestamp: undefined }),
        offer({ id: "stale", nestedRetrievedAt: STALE_TIME, url: "https://example.com/stale" })
      ]
    }));
    const statuses = briefing.evidence.map((entry) => entry.freshness.status);
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(statuses).toEqual(["missing", "inferred", "stale"]);
    expect(markdown).toMatch(/price freshness missing/i);
    expect(markdown).toMatch(/price freshness inferred/i);
    expect(markdown).toMatch(/price freshness stale/i);
  });

  it("constrains future-dated price freshness evidence", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "future-a", nestedRetrievedAt: "2026-07-01T10:00:00.000Z" }),
        offer({
          id: "fresh-b",
          nestedRetrievedAt: FRESH_TIME,
          title: "Anker Vertical Ergonomic Mouse",
          amount: 90,
          url: "https://example.com/fresh-b"
        })
      ]
    }));
    const future = briefing.assessments.find((assessment) => assessment.evidence.offerId === "future-a");
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(future?.evidence.freshness.status).toBe("future");
    expect(future?.recommendation).toBe("constrained");
    expect(briefing.gate.status).toBe("partial");
    expect(markdown).toMatch(/price freshness future/i);
  });


  it("covers direct duplicate and baseline edge branches without promoting weak evidence", () => {
    const uniqueEvidence = [
      buildShoppingOfferEvidence({
        query: "ergonomic mouse less than $150",
        offer: offer({ id: "unique-a", productId: "", title: "Logitech Lift Ergonomic Mouse", amount: 90 }),
        referenceIso: REFERENCE_TIME,
        staleAfterDays: 7
      }),
      buildShoppingOfferEvidence({
        query: "ergonomic mouse $150",
        offer: offer({ id: "unique-b", productId: "", title: "Anker Vertical Ergonomic Mouse", amount: 110, url: "https://example.com/unique-b" }),
        referenceIso: REFERENCE_TIME,
        staleAfterDays: 7
      })
    ];
    const highScoreDuplicate = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "score-a", productId: "score-a", title: "Microsoft Sculpt Ergonomic Mouse", amount: 100, dealScore: 0.2, url: "https://example.com/scored" }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });
    const lowScoreDuplicate = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "score-b", productId: "score-b", title: "Kensington Pro Ergonomic Mouse", amount: 100, dealScore: 0.9, url: "https://example.com/scored" }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });
    const cadWithAnchor = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "cad-anchor", currency: "CAD", amount: 70, anchorPrice: 120, title: "Contour Ergonomic Mouse", url: "https://example.ca/cad-anchor" }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });

    expect(uniqueEvidence[0]?.queryRelevance.missingTokens).not.toContain("150");
    expect(uniqueEvidence[1]?.queryRelevance.missingTokens).not.toContain("150");
    expect(buildDuplicateGroups(uniqueEvidence)).toEqual([]);

    const baseline = buildMarketBaseline([
      ...uniqueEvidence,
      highScoreDuplicate,
      lowScoreDuplicate,
      cadWithAnchor
    ], 2);

    expect(baseline).toMatchObject({
      status: "computed",
      currency: "USD",
      sampleCount: 2,
      offerIds: ["unique-b", "score-b"],
      excludedDifferentCurrencyCount: 1,
      anchorEvidenceCount: 0
    });
  });


  it("keeps symbol-only budget amounts out of relevance while preserving product numbers", () => {
    const relevance = assessQueryRelevance(
      "$150 27 inch monitor",
      "Dell 27 inch USB-C Monitor",
      ""
    );

    expect(relevance.status).toBe("strong");
    expect(relevance.missingTokens).not.toContain("150");
    expect(relevance.matchedTokens).toContain("27");
  });

  it("ignores blank duplicate keys while preserving valid duplicate groups", () => {
    const blankUrlA = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "blank-url-a", productId: "blank-a", url: "", title: "Logitech Lift Vertical Ergonomic Mouse" }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });
    const blankUrlB = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "blank-url-b", productId: "blank-b", url: "", title: "Logitech Lift Vertical Ergonomic Mouse" }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });
    const sameProductA = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "same-product-a", productId: "shared-product", title: "Logitech Lift Mouse A", url: "https://example.com/a" }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });
    const sameProductB = buildShoppingOfferEvidence({
      query: "ergonomic mouse",
      offer: offer({ id: "same-product-b", productId: "shared-product", title: "Logitech Lift Mouse B", url: "https://example.com/b" }),
      referenceIso: REFERENCE_TIME,
      staleAfterDays: 7
    });

    const groups = buildDuplicateGroups([blankUrlA, blankUrlB, sameProductA, sameProductB]);

    expect(groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "same_title", offerIds: ["blank-url-a", "blank-url-b"] }),
      expect.objectContaining({ reason: "same_product", offerIds: ["same-product-a", "same-product-b"] })
    ]));
    expect(groups.some((group) => group.groupId === "url:")).toBe(false);
  });

  it("excludes baseline samples when duplicate identity fields are blank", () => {
    const blankIdentity = (id: string, amount: number): ShoppingReportOfferEvidence => ({
      ...buildShoppingOfferEvidence({
        query: "ergonomic mouse",
        offer: offer({ id, productId: "", title: " ", url: "", amount }),
        referenceIso: REFERENCE_TIME,
        staleAfterDays: 7
      }),
      productId: "",
      title: "",
      canonicalUrl: ""
    });

    const baseline = buildMarketBaseline([
      blankIdentity("blank-identity-a", 70),
      blankIdentity("blank-identity-b", 80)
    ], 2);

    expect(baseline).toMatchObject({
      status: "unavailable",
      sampleCount: 0,
      offerIds: []
    });
  });

  it("renders market baseline unavailable when filtered quality evidence is below threshold", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "trusted", currency: "USD", amount: 100 }),
        offer({ id: "untrusted", currency: "USD", amount: 90, priceTrust: false, url: "https://example.com/untrusted" })
      ]
    }));

    expect(briefing.marketBaseline.status).toBe("unavailable");
    expect(briefing.marketBaseline.sampleCount).toBe(1);
  });

  it("renders market baseline unavailable when no same-currency sample reaches the threshold", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "usd", currency: "USD", amount: 100 }),
        offer({ id: "cad", currency: "CAD", amount: 100, url: "https://example.ca/cad" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.marketBaseline.status).toBe("unavailable");
    expect(markdown).toMatch(/market baseline unavailable/i);
  });

  it("computes market baseline only from same-currency evidence and avoids unsupported anchor discounts", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "usd-low", currency: "USD", amount: 100 }),
        offer({ id: "usd-high", currency: "USD", amount: 200, title: "Anker Vertical Ergonomic Mouse", url: "https://example.com/high" }),
        offer({ id: "cad-low", currency: "CAD", amount: 10, title: "Microsoft Sculpt Ergonomic Mouse", url: "https://example.ca/low" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.marketBaseline.status).toBe("computed");
    expect(briefing.marketBaseline.currency).toBe("USD");
    expect(briefing.marketBaseline.sampleCount).toBe(2);
    expect(briefing.marketBaseline.averageTotal).toBe(150);
    expect(briefing.marketBaseline.excludedDifferentCurrencyCount).toBe(1);
    expect(markdown).toContain("Average total: USD 150.00");
    expect(markdown).toContain("Different-currency offers excluded from baseline: 1");
    expect(markdown).toContain("Anchor/list discount comparison unavailable");
    expect(markdown).not.toMatch(/\d+(?:\.\d+)?%\)/);
  });

  it("renders same-currency anchor discounts only when the anchor exceeds the offer total", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "discounted", amount: 80, anchorPrice: 120 }),
        offer({
          id: "not-discounted",
          title: "Anker Vertical Ergonomic Mouse",
          amount: 100,
          anchorPrice: 90,
          url: "https://example.com/not-discounted"
        })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);
    const discounted = briefing.assessments.find((assessment) => assessment.evidence.offerId === "discounted");
    const notDiscounted = briefing.assessments.find((assessment) => assessment.evidence.offerId === "not-discounted");

    expect(discounted?.anchorDiscount).toMatchObject({ amount: 40 });
    expect(notDiscounted?.anchorDiscount).toBeUndefined();
    expect(markdown).toContain("anchor discount: USD 40.00 (33.3%)");
    expect(markdown).not.toContain("USD -10.00");
  });

  it("escapes same-currency market baseline currency text in markdown", () => {
    const maliciousCurrency = "USD\n## Injected";
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "malicious-a", currency: maliciousCurrency, amount: 100, url: "https://example.com/malicious-a" }),
        offer({ id: "malicious-b", title: "Anker Vertical Ergonomic Mouse", currency: maliciousCurrency, amount: 110, url: "https://example.com/malicious-b" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.marketBaseline.status).toBe("computed");
    expect(markdown).not.toContain("USD\n## INJECTED");
    expect(markdown).toContain("same-currency USD \\#\\# INJECTED offer(s)");
  });

  it("filters baseline inputs to positive trusted fresh same-item-shipping currency evidence", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "good-a", currency: "USD", amount: 100 }),
        offer({ id: "good-b", currency: "USD", amount: 200, title: "Anker Vertical Ergonomic Mouse", url: "https://example.com/good-b" }),
        offer({ id: "out-stock", currency: "USD", amount: 10, availability: "out_of_stock", url: "https://example.com/out-stock" }),
        offer({ id: "keyboard", currency: "USD", amount: 20, title: "Wireless Mechanical Keyboard", url: "https://example.com/keyboard" }),
        offer({ id: "rating", currency: "USD", amount: 30, title: "Rated 4.7 out of 5 stars with 214 reviews", url: "https://example.com/rating" }),
        offer({ id: "stale", currency: "USD", amount: 40, nestedRetrievedAt: STALE_TIME, url: "https://example.com/stale" }),
        offer({ id: "inferred", currency: "USD", amount: 50, nestedRetrievedAt: null, url: "https://example.com/inferred" }),
        offer({ id: "untrusted", currency: "USD", amount: 60, priceTrust: false, url: "https://example.com/untrusted" }),
        offer({ id: "unknown-trust", currency: "USD", amount: 70, priceTrust: null, url: "https://example.com/unknown-trust" }),
        offer({ id: "zero-total", currency: "USD", amount: 0, url: "https://example.com/zero-total" }),
        offer({ id: "shipping-mismatch", currency: "USD", shippingCurrency: "CAD", amount: 5, url: "https://example.com/shipping-mismatch" }),
        offer({ id: "cad-good", currency: "CAD", amount: 1, title: "Microsoft Sculpt Ergonomic Mouse", url: "https://example.ca/cad-good" })
      ]
    }));

    expect(briefing.marketBaseline.status).toBe("computed");
    expect(briefing.marketBaseline.currency).toBe("USD");
    expect(briefing.marketBaseline.offerIds).toEqual(["good-a", "good-b"]);
    expect(briefing.marketBaseline.sampleCount).toBe(2);
    expect(briefing.marketBaseline.averageTotal).toBe(150);
    expect(briefing.marketBaseline.excludedDifferentCurrencyCount).toBe(1);
  });

  it("does not recommend offers outside the computed same-currency market baseline", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "usd-a", currency: "USD", amount: 100, title: "Logitech Lift Vertical Ergonomic Mouse" }),
        offer({ id: "usd-b", currency: "USD", amount: 110, title: "Anker Vertical Ergonomic Mouse", url: "https://example.com/usd-b" }),
        offer({ id: "cad-cheap", currency: "CAD", amount: 10, title: "Microsoft Sculpt Ergonomic Mouse", url: "https://example.ca/cad-cheap" })
      ]
    }));
    const cadAssessment = briefing.assessments.find((assessment) => assessment.evidence.offerId === "cad-cheap");

    expect(briefing.marketBaseline.status).toBe("computed");
    expect(briefing.marketBaseline.offerIds).toEqual(["usd-a", "usd-b"]);
    expect(cadAssessment?.inMarketBaseline).toBe(false);
    expect(cadAssessment?.recommendation).toBe("candidate");
    expect(briefing.gate.status).toBe("partial");
    expect(briefing.assessments.every((assessment) => assessment.recommendation !== "recommended")).toBe(true);
    expect(briefing.assessments.filter((assessment) => assessment.inMarketBaseline).map((assessment) => assessment.evidence.offerId)).toEqual(["usd-a", "usd-b"]);
  });

  it("constrains item and shipping currency mismatches without rendering a misleading total", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "clean-a", currency: "USD", amount: 100 }),
        offer({ id: "clean-b", currency: "USD", amount: 110, url: "https://example.com/clean-b" }),
        offer({ id: "mixed", currency: "USD", shippingCurrency: "CAD", amount: 80, shipping: 5, url: "https://example.com/mixed" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);
    const mixed = briefing.assessments.find((assessment) => assessment.evidence.offerId === "mixed");

    expect(mixed?.recommendation).toBe("constrained");
    expect(mixed?.warnings).toContain("item and shipping currencies differ; total price is unavailable");
    expect(markdown).toContain("total unavailable due to currency mismatch");
    expect(markdown).not.toContain("USD 85.00");
  });

  it("ranks assessments deterministically by tier and evidence quality", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "expensive", amount: 200, title: "Logitech Lift Vertical Ergonomic Mouse" }),
        offer({ id: "cheap", amount: 90, title: "Anker Cheap Vertical Ergonomic Mouse", url: "https://example.com/cheap" }),
        offer({ id: "mismatch", amount: 10, title: "Microsoft Sculpt Ergonomic Mouse", shippingCurrency: "CAD", url: "https://example.com/mismatch" })
      ]
    }));

    expect(briefing.assessments.map((assessment) => assessment.evidence.offerId)).toEqual(["cheap", "expensive", "mismatch"]);
    expect(briefing.recommendation[0]).toContain("constrained shortlist");
  });

  it("preserves input order when tied recommended offers have equal totals and quality", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "first-tie", title: "Logitech Lift Vertical Ergonomic Mouse", amount: 100, dealScore: 0.8 }),
        offer({ id: "second-tie", title: "Anker Vertical Ergonomic Mouse", amount: 100, dealScore: 0.8, url: "https://example.com/second-tie" })
      ]
    }));

    expect(briefing.gate.status).toBe("pass");
    expect(briefing.assessments.map((assessment) => assessment.evidence.offerId)).toEqual(["first-tie", "second-tie"]);
  });

  it("does not satisfy core query descriptors from URL-only matches", () => {
    const urlOnly = buildShoppingBriefing(briefingInput({
      query: "ergonomic mouse",
      offers: [
        offer({ id: "url-a", title: "Logitech Lift Mouse", url: "https://example.com/ergonomic/url-a" }),
        offer({ id: "url-b", title: "Anker Vertical Mouse", url: "https://example.com/ergonomic/url-b" })
      ]
    }));
    const structured = buildShoppingBriefing(briefingInput({
      query: "ergonomic mouse",
      offers: [
        offer({ id: "attr-a", title: "Logitech Lift Mouse", attributes: { style: "ergonomic" } }),
        offer({ id: "attr-b", title: "Anker Vertical Mouse", url: "https://example.com/attr-b", attributes: { style: "ergonomic" } })
      ]
    }));

    expect(urlOnly.gate.status).toBe("fail");
    expect(urlOnly.assessments.every((assessment) => assessment.recommendation === "excluded")).toBe(true);
    expect(structured.gate.status).toBe("pass");
  });

  it("does not satisfy query relevance from arbitrary non-product attributes", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      query: "ergonomic mouse",
      offers: [
        offer({ id: "query-a", title: "Logitech Wireless Keyboard", attributes: { searchQuery: "ergonomic mouse" } }),
        offer({
          id: "query-b",
          title: "Anker Wireless Keyboard",
          url: "https://example.com/query-b",
          attributes: { providerNote: "ergonomic mouse" }
        })
      ]
    }));

    expect(briefing.gate.status).toBe("fail");
    expect(briefing.assessments.every((assessment) => assessment.recommendation === "excluded")).toBe(true);
  });

  it("collapses duplicate groups in buyer-facing best candidates", () => {
    const duplicateTitle = "Logitech Lift Vertical Ergonomic Mouse";
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "dup-a", productId: "shared", title: duplicateTitle, amount: 100, url: "https://example.com/dup-a" }),
        offer({ id: "dup-b", productId: "shared", title: duplicateTitle, amount: 95, url: "https://example.com/dup-b" }),
        offer({ id: "unique", title: "Anker Vertical Ergonomic Mouse", amount: 120, url: "https://example.com/unique" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);
    const bestCandidates = markdown.slice(
      markdown.indexOf("## Best Candidate Offers"),
      markdown.indexOf("## Market Baseline")
    );

    expect(bestCandidates.match(/Logitech Lift Vertical Ergonomic Mouse/g)).toHaveLength(1);
    expect(markdown).toContain("same_product");
  });


  it("does not let same-url same-title duplicates inflate the market baseline", () => {
    const duplicateTitle = "Logitech Lift Vertical Ergonomic Mouse";
    const duplicateUrl = "https://example.com/same-product";
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "same-a", productId: "product-a", title: duplicateTitle, amount: 100, url: duplicateUrl }),
        offer({ id: "same-b", productId: "product-b", title: duplicateTitle, amount: 95, url: duplicateUrl })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);
    const bestCandidates = markdown.slice(
      markdown.indexOf("## Best Candidate Offers"),
      markdown.indexOf("## Market Baseline")
    );

    expect(briefing.duplicateGroups.some((group) => group.reason === "same_url")).toBe(true);
    expect(briefing.duplicateGroups.some((group) => group.reason === "same_title")).toBe(true);
    expect(briefing.marketBaseline.status).toBe("unavailable");
    expect(briefing.marketBaseline.sampleCount).toBe(1);
    expect(briefing.assessments.some((assessment) => assessment.recommendation === "recommended")).toBe(false);
    expect(briefing.gate.status).toBe("partial");
    expect(bestCandidates.match(/Logitech Lift Vertical Ergonomic Mouse/g)).toHaveLength(1);
  });


  it("collapses overlapping duplicate groups as one connected component", () => {
    const sharedUrl = "https://example.com/shared-url";
    const sharedTitle = "Anker Vertical Ergonomic Mouse";
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "a", productId: "product-a", title: "Logitech Lift Vertical Ergonomic Mouse", amount: 100, url: sharedUrl }),
        offer({ id: "b", productId: "product-b", title: sharedTitle, amount: 90, url: sharedUrl }),
        offer({ id: "c", productId: "product-c", title: sharedTitle, amount: 80, url: "https://example.com/title-overlap" }),
        offer({ id: "d", productId: "product-d", title: "Microsoft Sculpt Ergonomic Mouse", amount: 200, url: "https://example.com/unique" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);
    const bestCandidates = markdown.slice(
      markdown.indexOf("## Best Candidate Offers"),
      markdown.indexOf("## Market Baseline")
    );

    expect(briefing.duplicateGroups.some((group) => group.reason === "same_url")).toBe(true);
    expect(briefing.duplicateGroups.some((group) => group.reason === "same_title")).toBe(true);
    expect(briefing.marketBaseline.offerIds).toEqual(["c", "d"]);
    expect(briefing.marketBaseline.sampleCount).toBe(2);
    expect(bestCandidates).toContain("Anker Vertical Ergonomic Mouse");
    expect(bestCandidates).not.toContain("Logitech Lift Vertical Ergonomic Mouse");
  });


  it("uses ineligible duplicate bridges when selecting baseline representatives", () => {
    const bridgeTitle = "Bridge Vertical Ergonomic Mouse";
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "a", productId: "a", title: "Logitech Lift Vertical Ergonomic Mouse", amount: 100, url: "https://example.com/shared-url" }),
        offer({ id: "bridge", productId: "bridge", title: bridgeTitle, amount: 90, url: "https://example.com/shared-url", nestedRetrievedAt: STALE_TIME }),
        offer({ id: "c", productId: "c", title: bridgeTitle, amount: 80, url: "https://example.com/bridge-title" }),
        offer({ id: "d", productId: "d", title: "Microsoft Sculpt Ergonomic Mouse", amount: 200, url: "https://example.com/unique-d" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);
    const bestCandidates = markdown.slice(
      markdown.indexOf("## Best Candidate Offers"),
      markdown.indexOf("## Market Baseline")
    );

    expect(briefing.marketBaseline.offerIds).toEqual(["c", "d"]);
    expect(briefing.marketBaseline.sampleCount).toBe(2);
    expect(bestCandidates).toContain("Bridge Vertical Ergonomic Mouse");
    expect(bestCandidates).not.toContain("Logitech Lift Vertical Ergonomic Mouse");
  });

  it("constrains pass when a computed baseline excludes different-currency eligible offers", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "usd-a", currency: "USD", amount: 100, title: "Logitech Lift Vertical Ergonomic Mouse" }),
        offer({ id: "usd-b", currency: "USD", amount: 110, title: "Anker Vertical Ergonomic Mouse", url: "https://example.com/usd-b" }),
        offer({ id: "cad", currency: "CAD", amount: 90, title: "Microsoft Sculpt Ergonomic Mouse", url: "https://example.ca/cad" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.marketBaseline.status).toBe("computed");
    expect(briefing.marketBaseline.currency).toBe("USD");
    expect(briefing.marketBaseline.excludedDifferentCurrencyCount).toBe(1);
    expect(briefing.gate.status).toBe("partial");
    expect(briefing.warnings).toContain("currency coverage incomplete: 1 eligible different-currency offer(s) excluded from USD baseline");
    expect(markdown).toContain("visible outside baseline currency");
    expect(markdown).toContain("currency coverage incomplete");
  });

  it("does not name one top candidate when mixed currencies make the market baseline unavailable", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "usd", currency: "USD", amount: 100, title: "Logitech Lift Vertical Ergonomic Mouse" }),
        offer({ id: "cad", currency: "CAD", amount: 10, title: "Anker Vertical Ergonomic Mouse", url: "https://example.ca/cad" })
      ]
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);
    const recommendationSection = markdown.slice(
      markdown.indexOf("## Recommendation"),
      markdown.indexOf("## Best Candidate Offers")
    );

    expect(briefing.marketBaseline.status).toBe("unavailable");
    expect(briefing.marketBaseline.excludedDifferentCurrencyCount).toBe(1);
    expect(briefing.assessments.every((assessment) => assessment.recommendation === "constrained")).toBe(true);
    expect(recommendationSection).toContain("currency-separated evidence only");
    expect(recommendationSection).not.toContain("CAD");
    expect(recommendationSection).not.toContain("USD");
    expect(recommendationSection).not.toContain("Logitech");
    expect(recommendationSection).not.toContain("Anker");
  });

  it("renders no visible candidate branch when every product offer is excluded", () => {
    const markdown = markdownFor(briefingInput({
      offers: [
        offer({ id: "rating-title", title: "Rated 4.7 out of 5 stars with 214 reviews" }),
        offer({ id: "keyboard", title: "Logitech Wireless Keyboard", url: "https://example.com/keyboard" })
      ]
    }));

    expect(markdown).toContain("Status: fail");
    expect(markdown).toContain("- No candidate offers met the report gate.");
  });

  it("renders defensive fallback labels for handcrafted partial briefing states", () => {
    const briefing = buildShoppingBriefing(briefingInput());
    const recommended = briefing.assessments[0];
    const constrained = briefing.assessments[1];
    if (!recommended || !constrained) throw new Error("expected two shopping assessments");
    const constrainedWithoutWarnings = {
      ...constrained,
      recommendation: "constrained" as const,
      warnings: [],
      reasons: ["manual product verification required"]
    };
    const handcrafted: ShoppingBriefing = {
      ...briefing,
      gate: { ...briefing.gate, status: "partial" },
      marketBaseline: {
        status: "computed",
        reason: "manual renderer fallback baseline",
        minSample: 2,
        sampleCount: 2,
        offerIds: [],
        excludedDifferentCurrencyCount: 0,
        anchorEvidenceCount: 0
      },
      recommendation: [],
      warnings: [],
      assessments: [
        { ...recommended, recommendation: "recommended" },
        constrainedWithoutWarnings
      ],
      constrainedOffers: [constrainedWithoutWarnings]
    };
    const markdown = renderShoppingBriefingMarkdown(handcrafted);

    expect(markdown).toContain("## Recommendation\n- None reported.");
    expect(markdown).toContain("[candidate] provider-supplied title");
    expect(markdown).toContain("Average total:  0.00.");
    expect(markdown).toContain("[constrained] Anker Vertical Ergonomic Mouse: manual product verification required");
  });

  it("surfaces failed providers, filter diagnostics, constraints, and alert reason codes", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      meta: {
        primaryConstraintSummary: "Region filter was advisory only",
        selection: {
          providers: ["shopping/amazon", "shopping/walmart"],
          requested_region: "US",
          region_authoritative: false
        },
        metrics: {
          failed_providers: ["shopping/walmart"]
        },
        alerts: [{ reasonCode: "region_unenforced" }],
        failures: [{ provider: "shopping/walmart", reasonCode: "provider_timeout" }],
        offerFilterDiagnostics: [{ reasonCode: "region_currency_filtered", count: 3 }]
      }
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.gate.status).toBe("partial");
    expect(markdown).toContain("primary constraint: Region filter was advisory only");
    expect(markdown).toContain("failed providers: shopping/walmart");
    expect(markdown).toContain("region\\_unenforced");
    expect(markdown).toContain("provider\\_timeout");
    expect(markdown).toContain("region\\_currency\\_filtered");
  });

  it("renders code reason and unclassified fallback diagnostics from shopping metadata", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      meta: {
        selection: {
          providers: ["shopping/amazon"],
          requested_region: "US",
          region_authoritative: true
        },
        metrics: {
          total_offers: 2,
          candidate_offers: 2
        },
        alerts: [{ code: "price_drift" }],
        failures: [{ reason: "provider_empty" }],
        offerFilterDiagnostics: [{ allCandidateOffersDroppedByBudget: true }]
      }
    }));
    const markdown = renderShoppingBriefingMarkdown(briefing);

    expect(briefing.gate.status).toBe("partial");
    expect(briefing.metaView.totalOffers).toBe(2);
    expect(briefing.metaView.candidateOffers).toBe(2);
    expect(markdown).toContain("price\\_drift");
    expect(markdown).toContain("provider\\_empty");
    expect(markdown).toContain("unclassified");
  });

  it("deduplicates same product groups before computing market baseline", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "dup-high", productId: "shared", amount: 150, url: "https://example.com/dup-high" }),
        offer({ id: "dup-low", productId: "shared", amount: 100, url: "https://example.com/dup-low" }),
        offer({ id: "unique", productId: "unique", title: "Anker Vertical Ergonomic Mouse", amount: 200, url: "https://example.com/unique" })
      ]
    }));

    expect(briefing.marketBaseline.status).toBe("computed");
    expect(briefing.marketBaseline.offerIds).toEqual(["dup-low", "unique"]);
    expect(briefing.marketBaseline.sampleCount).toBe(2);
    expect(briefing.marketBaseline.averageTotal).toBe(150);
  });

  it("computes odd medians and uses deal score to break duplicate representative ties", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "tie-low-score", productId: "shared", amount: 100, dealScore: 0.2, url: "https://example.com/tie-low" }),
        offer({ id: "tie-high-score", productId: "shared", amount: 100, dealScore: 0.95, url: "https://example.com/tie-high" }),
        offer({ id: "mid", productId: "mid", title: "Anker Vertical Ergonomic Mouse", amount: 200, url: "https://example.com/mid" }),
        offer({ id: "high", productId: "high", title: "Microsoft Sculpt Ergonomic Mouse", amount: 300, url: "https://example.com/high" })
      ]
    }));

    expect(briefing.marketBaseline.status).toBe("computed");
    expect(briefing.marketBaseline.offerIds).toEqual(["tie-high-score", "mid", "high"]);
    expect(briefing.marketBaseline.averageTotal).toBe(200);
    expect(briefing.marketBaseline.medianTotal).toBe(200);
  });

  it("uses total price as the deterministic tie-breaker for equal quality assessments", () => {
    const briefing = buildShoppingBriefing(briefingInput({
      offers: [
        offer({ id: "lower-total", productId: "lower-total", amount: 100, dealScore: 0.8, url: "https://example.com/lower-total" }),
        offer({ id: "higher-total", productId: "higher-total", title: "Anker Vertical Ergonomic Mouse", amount: 200, dealScore: 0.81, url: "https://example.com/higher-total" }),
        offer({ id: "cad-total", productId: "cad-total", title: "Microsoft Sculpt Ergonomic Mouse", amount: 50, currency: "CAD", url: "https://example.ca/cad-total" })
      ]
    }));

    expect(briefing.assessments.slice(0, 2).map((assessment) => assessment.evidence.offerId)).toEqual([
      "lower-total",
      "higher-total"
    ]);
    expect(briefing.marketBaseline.status).toBe("computed");
    expect(briefing.warnings).toContain("currency coverage incomplete: 1 eligible different-currency offer(s) excluded from USD baseline");
  });

});
