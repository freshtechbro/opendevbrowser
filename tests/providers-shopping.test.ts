import { describe, expect, it, vi } from "vitest";
import {
  SHOPPING_PROVIDER_IDS,
  createShoppingProvider,
  createShoppingProviderById,
  createShoppingProviders,
  validateLegalReviewChecklist,
  validateShoppingLegalReviewChecklist,
  type ShoppingProviderProfile
} from "../src/providers/shopping";
import { ProviderRuntimeError } from "../src/providers/errors";

const context = {
  trace: { requestId: "shopping-test", ts: "2026-02-16T00:00:00.000Z" },
  timeoutMs: 1000,
  attempt: 1 as const
};

const amazonProfile: ShoppingProviderProfile = {
  name: "amazon",
  id: "shopping/amazon",
  displayName: "Amazon",
  domains: ["amazon.com"],
  tier: "tier1",
  extractionFocus: "focus",
  legalReview: {
    providerId: "shopping/amazon",
    termsReviewDate: "2026-02-16",
    allowedExtractionSurfaces: ["public pages"],
    prohibitedFlows: ["checkout"],
    reviewer: "test-reviewer",
    approvalExpiryDate: "2030-12-31T00:00:00.000Z",
    signedOff: true
  },
  searchPath: (query) => `https://amazon.com/s?k=${encodeURIComponent(query)}`
};

const createChecklist = (overrides: Partial<ShoppingProviderProfile["legalReview"]> = {}): ShoppingProviderProfile["legalReview"] => ({
  providerId: "shopping/amazon",
  termsReviewDate: "2026-02-16",
  allowedExtractionSurfaces: ["public pages"],
  prohibitedFlows: ["checkout"],
  reviewer: "test-reviewer",
  approvalExpiryDate: "2030-12-31T00:00:00.000Z",
  signedOff: true,
  ...overrides
});

describe("shopping providers", () => {
  it("registers all v1 shopping providers", () => {
    const providers = createShoppingProviders();
    expect(providers).toHaveLength(11);
    expect(new Set(providers.map((provider) => provider.id))).toEqual(new Set(SHOPPING_PROVIDER_IDS));
  });

  it("validates legal review checklist metadata", () => {
    expect(validateShoppingLegalReviewChecklist("shopping/amazon").valid).toBe(true);
    expect(validateShoppingLegalReviewChecklist("shopping/unknown").valid).toBe(false);

    const invalid = validateLegalReviewChecklist(
      createChecklist({
        approvalExpiryDate: "2020-01-01T00:00:00.000Z"
      }),
      "shopping/amazon"
    );
    expect(invalid).toMatchObject({
      valid: false,
      reasonCode: "approval_expired"
    });
  });

  it("returns granular legal-review reason codes", () => {
    const now = new Date("2026-02-16T00:00:00.000Z");
    const cases: Array<{
      expected: string;
      checklist?: ShoppingProviderProfile["legalReview"];
      providerId?: string;
      at?: Date;
    }> = [
      { expected: "missing_checklist", checklist: undefined },
      { expected: "provider_mismatch", checklist: createChecklist({ providerId: "shopping/walmart" }) },
      { expected: "missing_terms_review_date", checklist: createChecklist({ termsReviewDate: "   " }) },
      { expected: "invalid_terms_review_date", checklist: createChecklist({ termsReviewDate: "bad-date" }) },
      { expected: "missing_allowed_surfaces", checklist: createChecklist({ allowedExtractionSurfaces: ["   "] }) },
      { expected: "missing_prohibited_flows", checklist: createChecklist({ prohibitedFlows: ["   "] }) },
      { expected: "missing_reviewer", checklist: createChecklist({ reviewer: "   " }) },
      { expected: "missing_approval_expiry", checklist: createChecklist({ approvalExpiryDate: "   " }) },
      { expected: "invalid_approval_expiry", checklist: createChecklist({ approvalExpiryDate: "not-a-date" }) },
      { expected: "approval_expired", checklist: createChecklist({ approvalExpiryDate: "2026-02-15T23:59:59.000Z" }) },
      { expected: "not_signed_off", checklist: createChecklist({ signedOff: false }) }
    ];

    cases.forEach(({ checklist, expected, providerId, at }) => {
      const result = validateLegalReviewChecklist(checklist, providerId ?? "shopping/amazon", at ?? now);
      expect(result).toMatchObject({
        valid: false,
        reasonCode: expected
      });
    });
  });

  it("creates providers by id and rejects unknown provider ids", () => {
    const provider = createShoppingProviderById("shopping/amazon");
    expect(provider.id).toBe("shopping/amazon");

    expect(() => createShoppingProviderById("shopping/unknown")).toThrow(ProviderRuntimeError);
  });

  it("normalizes search and fetch records with shopping_offer metadata", async () => {
    const provider = createShoppingProvider(amazonProfile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `<html><body><a href="${url}/item-1">item</a><main>Great product $39.99 4.8 out of 5 120 reviews in stock</main></body></html>`
      })
    });

    const searchRecords = await provider.search?.({ query: "wireless mouse", limit: 2 }, context);
    expect(searchRecords?.length).toBeGreaterThan(0);
    expect(searchRecords?.[0]?.source).toBe("shopping");
    expect(searchRecords?.[0]?.attributes.shopping_offer).toMatchObject({
      provider: "shopping/amazon",
      availability: "in_stock"
    });

    const fetchRecords = await provider.fetch?.({ url: "https://amazon.com/item-1" }, context);
    expect(fetchRecords?.[0]?.attributes.shopping_offer).toMatchObject({
      provider: "shopping/amazon"
    });
  });

  it("maps auth/rate-limit/unavailable status codes through the default fetcher", async () => {
    const provider = createShoppingProvider(amazonProfile);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 429,
      url: "https://amazon.com/s?k=mouse",
      text: async () => "rate limited"
    })) as unknown as typeof fetch);

    await expect(provider.search?.({ query: "wireless mouse" }, context))
      .rejects.toMatchObject({ code: "rate_limited" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 403,
      url: "https://amazon.com/s?k=mouse",
      text: async () => "auth"
    })) as unknown as typeof fetch);

    await expect(provider.search?.({ query: "wireless mouse" }, context))
      .rejects.toMatchObject({ code: "auth" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 500,
      url: "https://amazon.com/s?k=mouse",
      text: async () => "error"
    })) as unknown as typeof fetch);

    await expect(provider.search?.({ query: "wireless mouse" }, context))
      .rejects.toMatchObject({ code: "unavailable", retryable: true });

    vi.unstubAllGlobals();
  });

  it("validates required queries", async () => {
    const provider = createShoppingProvider(amazonProfile, {
      fetcher: async ({ url }) => ({ status: 200, url, html: "<html></html>" })
    });

    await expect(provider.search?.({ query: "   " }, context)).rejects.toMatchObject({
      code: "invalid_input"
    });
  });
});
