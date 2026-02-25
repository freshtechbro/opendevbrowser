import { describe, expect, it, vi } from "vitest";
import {
  SHOPPING_PROVIDER_PROFILES,
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

  it("routes non-url searches through every default provider searchPath", async () => {
    const fetcher = vi.fn(async ({ url }: { url: string }) => ({
      status: 200,
      url,
      html: "<html><body><main>catalog result</main></body></html>"
    }));

    for (const profile of SHOPPING_PROVIDER_PROFILES) {
      const provider = createShoppingProvider(profile, { fetcher });
      const rows = await provider.search?.({ query: "ergonomic office chair", limit: 1 }, context);
      expect(rows?.length).toBeGreaterThan(0);
    }

    expect(fetcher).toHaveBeenCalledTimes(SHOPPING_PROVIDER_PROFILES.length);
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

  it("uses browser fallback for auth-blocked shopping retrieval", async () => {
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.amazon.com/s?k=wireless%20mouse",
        html: `<html><body><main>fallback shopping content $59.99 4.5 out of 5 42 reviews in stock</main></body></html>`
      },
      details: {}
    }));
    const provider = createShoppingProvider(amazonProfile);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 403,
      url: String(input),
      text: async () => "auth"
    })) as unknown as typeof fetch);

    try {
      const records = await provider.search?.(
        { query: "wireless mouse", limit: 2 },
        {
          ...context,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      );

      expect(records?.length).toBeGreaterThan(0);
      expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
        provider: "shopping/amazon"
      });
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "shopping/amazon",
        operation: "search",
        reasonCode: "token_required"
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps original auth error when browser fallback rejects the request", async () => {
    const provider = createShoppingProvider(amazonProfile);
    const fallbackResolve = vi.fn(async () => ({
      ok: false,
      reasonCode: "token_required" as const,
      details: { message: "challenge still active" }
    }));

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 403,
      url: "https://www.amazon.com/s?k=wireless%20mouse",
      text: async () => "auth"
    })) as unknown as typeof fetch);

    try {
      await expect(provider.search?.(
        { query: "wireless mouse" },
        {
          ...context,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      )).rejects.toMatchObject({ code: "auth" });

      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "shopping/amazon",
        operation: "search",
        reasonCode: "token_required"
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses browser fallback on network failure when fallback output omits html/url", async () => {
    const provider = createShoppingProvider(amazonProfile);
    const fallbackResolve = vi.fn(async () => ({
      ok: true,
      reasonCode: "env_limited" as const,
      mode: "managed_headed" as const,
      output: {},
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch);

    try {
      const rows = await provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          ...context,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      );

      expect(rows?.length).toBeGreaterThan(0);
      expect(rows?.[0]?.url).toContain("amazon.com");
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        reasonCode: "env_limited"
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses browser fallback on rate-limited shopping retrieval", async () => {
    const provider = createShoppingProvider(amazonProfile);
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.amazon.com/s?k=wireless%20mouse",
        html: "<html><body><main>rate limit fallback</main></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 429,
      url: "https://www.amazon.com/s?k=wireless%20mouse",
      text: async () => "rate limited"
    })) as unknown as typeof fetch);

    try {
      const rows = await provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          ...context,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      );

      expect(rows?.length).toBeGreaterThan(0);
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        reasonCode: "rate_limited"
      }));
    } finally {
      vi.unstubAllGlobals();
    }
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
