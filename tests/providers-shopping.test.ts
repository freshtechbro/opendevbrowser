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
import { resolveProviderRuntimePolicy } from "../src/providers/runtime-policy";

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

  it("exposes extension-first recovery hints for shopping providers", () => {
    expect(createShoppingProviderById("shopping/target").recoveryHints?.()).toMatchObject({
      preferredFallbackModes: ["extension", "managed_headed"]
    });
    expect(createShoppingProviderById("shopping/costco").recoveryHints?.()).toMatchObject({
      preferredFallbackModes: ["extension", "managed_headed"]
    });
    expect(createShoppingProviderById("shopping/amazon").recoveryHints?.()).toMatchObject({
      preferredFallbackModes: ["extension", "managed_headed"]
    });
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

  it("hydrates fetch metadata into brand image_urls and shopping_offer price", async () => {
    const provider = createShoppingProvider(amazonProfile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html>
            <head>
              <meta property="og:image" content="https://cdn.amazon.com/item-1.jpg" />
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Wireless Mouse Pro",
                  "brand": { "@type": "Brand", "name": "Amazon Basics" },
                  "image": "https://cdn.amazon.com/item-1.jpg",
                  "offers": {
                    "@type": "Offer",
                    "price": 59.99,
                    "priceCurrency": "USD"
                  }
                }
              </script>
            </head>
            <body>
              <main>Wireless Mouse Pro with ergonomic grip and silent buttons.</main>
            </body>
          </html>
        `
      })
    });

    const records = await provider.fetch?.({ url: "https://amazon.com/item-1" }, context);

    expect(records?.[0]?.attributes.brand).toBe("Amazon Basics");
    expect(records?.[0]?.attributes.image_urls).toEqual(["https://cdn.amazon.com/item-1.jpg"]);
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      title: "Wireless Mouse Pro with ergonomic grip and silent buttons.",
      price: {
        amount: 59.99,
        currency: "USD"
      }
    });
  });

  it("preserves all metadata image_urls on fetch records", async () => {
    const provider = createShoppingProvider(amazonProfile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html>
            <head>
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Wireless Mouse Pro",
                  "brand": { "@type": "Brand", "name": "Amazon Basics" },
                  "image": [
                    "https://cdn.amazon.com/item-1-primary",
                    "https://cdn.amazon.com/item-1-alt"
                  ],
                  "offers": {
                    "@type": "Offer",
                    "price": 59.99,
                    "priceCurrency": "USD"
                  }
                }
              </script>
            </head>
            <body>
              <main>Wireless Mouse Pro with ergonomic grip and silent buttons.</main>
            </body>
          </html>
        `
      })
    });

    const records = await provider.fetch?.({ url: "https://amazon.com/item-1" }, context);

    expect(records?.[0]?.attributes.image_urls).toEqual([
      "https://cdn.amazon.com/item-1-primary",
      "https://cdn.amazon.com/item-1-alt"
    ]);
  });

  it("keeps extracted search-card availability on shopping offers", async () => {
    const provider = createShoppingProvider(amazonProfile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <a href="https://amazon.com/dp/B012345678">Wireless mouse with contoured shell and silent clicks for all-day work</a>
            <div>USD 29.99 4.7 out of 5 81 reviews only 2 left</div>
          </body></html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless mouse", limit: 1 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.attributes.retrievalPath).toBe("shopping:search:result-card");
    expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
      availability: "limited",
      price: {
        amount: 29.99,
        currency: "USD"
      },
      rating: 4.7,
      reviews_count: 81
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

  it("falls back early when a recoverable Best Buy PDP fetch stalls", async () => {
    vi.useFakeTimers();
    const provider = createShoppingProviderById("shopping/bestbuy");
    const productUrl = "https://www.bestbuy.com/product/logitech-mx-master-3s-bluetooth-edition-performance-wireless-optical-mouse-with-ultra-fast-scrolling-and-quiet-clicks-wireless-black/J7H7ZYG559";
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? productUrl,
        html: "<html><body><main>Logitech MX Master 3S wireless mouse $88.99 4.8 out of 5 278 reviews in stock</main></body></html>"
      },
      details: {}
    }));
    const fetchMock = vi.fn((_: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        }, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const pending = provider.fetch?.(
        { url: productUrl },
        {
          ...context,
          timeoutMs: 120000,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      );

      await vi.advanceTimersByTimeAsync(15000);
      const records = await pending;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "shopping/bestbuy",
        operation: "fetch",
        url: productUrl
      }));
      expect(records?.length).toBeGreaterThan(0);
      expect(records?.[0]?.url).toBe(productUrl);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("falls back when the parent signal is already aborted and the timeout override is invalid", async () => {
    const provider = createShoppingProviderById("shopping/bestbuy");
    const productUrl = "https://www.bestbuy.com/site/sample-product/6501234.p?skuId=6501234";
    const controller = new AbortController();
    controller.abort("user_cancelled");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? productUrl,
        html: "<html><body><main>Recovered Best Buy page $88.99 4.8 out of 5 278 reviews in stock</main></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn((_: string | URL, init?: RequestInit) => {
      if ((init?.signal as AbortSignal | undefined)?.aborted) {
        return Promise.reject(new Error("aborted"));
      }
      return Promise.resolve({
        status: 200,
        url: productUrl,
        text: async () => "<html></html>"
      } as Response);
    }) as unknown as typeof fetch);

    try {
      const records = await provider.fetch?.(
        { url: productUrl },
        {
          ...context,
          timeoutMs: Number.POSITIVE_INFINITY,
          signal: controller.signal,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      );

      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "shopping/bestbuy",
        operation: "fetch",
        url: productUrl
      }));
      expect(records?.[0]?.url).toBe(productUrl);
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

  it("keeps browser fallback auth errors coherent when fallback omits extra details", async () => {
    const provider = createShoppingProvider(amazonProfile);
    const fallbackResolve = vi.fn(async () => ({
      ok: false,
      reasonCode: "auth_required" as const
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
      )).rejects.toMatchObject({
        code: "auth",
        details: {
          url: "https://amazon.com/s?k=wireless%20mouse"
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces auth blocker reasons from browser fallback after recoverable upstream failures", async () => {
    const provider = createShoppingProvider(amazonProfile);
    const fallbackResolve = vi.fn(async () => ({
      ok: false,
      reasonCode: "token_required" as const,
      details: { message: "Browser fallback reached auth_required page." }
    }));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch);

    try {
      await expect(provider.search?.(
        { query: "wireless mouse" },
        {
          ...context,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      )).rejects.toMatchObject({
        code: "auth",
        reasonCode: "token_required"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("detects Temu's obfuscated challenge shell and escalates to browser fallback", async () => {
    const provider = createShoppingProviderById("shopping/temu");
    const fallbackResolve = vi.fn(async () => ({
      ok: false,
      reasonCode: "token_required" as const,
      details: { message: "Browser fallback reached auth_required page." }
    }));

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.temu.com/search_result.html?search_key=wireless%20mouse",
      text: async () => "<html><body><script>function _0x24b9(){} var challenge='challenge';</script></body></html>"
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
      )).rejects.toMatchObject({
        code: "auth",
        reasonCode: "token_required"
      });

      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "shopping/temu",
        operation: "search",
        reasonCode: "challenge_detected",
        details: expect.objectContaining({
          blockerType: "anti_bot_challenge",
          providerShell: "temu_challenge_shell",
          reasonCode: "challenge_detected"
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects browser fallback output that still lands on Temu login shells", async () => {
    const provider = createShoppingProviderById("shopping/temu");
    const fallbackResolve = vi.fn(async () => ({
      ok: true,
      reasonCode: "env_limited" as const,
      mode: "managed_headed" as const,
      output: {
        url: "https://www.temu.com/login.html?from=https%3A%2F%2Fwww.temu.com%2Fsearch_result.html",
        html: "<html><head><title>Temu | Login</title></head><body>Please log in to continue shopping.</body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch);

    try {
      await expect(provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          ...context,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      )).rejects.toMatchObject({
        code: "unavailable",
        reasonCode: "token_required",
        details: expect.objectContaining({
          blockerType: "auth_required",
          title: "Temu | Login"
        })
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects browser fallback output that still lands on Temu challenge shells", async () => {
    const provider = createShoppingProviderById("shopping/temu");
    const fallbackResolve = vi.fn(async () => ({
      ok: true,
      reasonCode: "env_limited" as const,
      mode: "managed_headed" as const,
      output: {
        url: "https://www.temu.com/search_result.html?search_key=wireless%20mouse",
        html: "<html><body><script src=\"https://static.kwcdn.com/upload-static/assets/chl/js/challenge.js\"></script><script>window.challenge=true</script></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch);

    try {
      await expect(provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          ...context,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      )).rejects.toMatchObject({
        code: "unavailable",
        reasonCode: "challenge_detected",
        details: expect.objectContaining({
          blockerType: "anti_bot_challenge",
          providerShell: "temu_challenge_shell",
          reasonCode: "challenge_detected"
        })
      });
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

  it("preserves helper execution metadata on successful shopping browser fallback recovery", async () => {
    const provider = createShoppingProvider(amazonProfile);
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://amazon.com/s?k=wireless%20mouse",
        html: "<html><body><main>fallback shopping content</main><a href=\"https://amazon.com/product/1\">item</a></body></html>"
      },
      details: {
        cookieDiagnostics: {
          available: true,
          verifiedCount: 1
        },
        challengeOrchestration: {
          mode: "browser_with_helper",
          source: "config",
          status: "resolved"
        }
      }
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
      expect(rows?.[0]?.attributes).toMatchObject({
        browser_fallback_mode: "extension",
        browser_fallback_reason_code: "env_limited",
        browser_fallback_cookie_diagnostics: {
          available: true,
          verifiedCount: 1
        },
        browser_fallback_challenge_orchestration: {
          mode: "browser_with_helper",
          source: "config",
          status: "resolved"
        }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps token-required browser fallback failures to auth errors", async () => {
    const provider = createShoppingProvider(amazonProfile);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 403,
      url: String(input),
      text: async () => "auth blocked"
    })) as unknown as typeof fetch);

    try {
      await expect(provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          ...context,
          browserFallbackPort: {
            resolve: vi.fn(async () => ({
              ok: false,
              reasonCode: "token_required" as const,
              details: {
                message: "Login required for browser recovery."
              }
            }))
          }
        }
      )).rejects.toMatchObject({
        code: "auth",
        reasonCode: "token_required",
        message: "Login required for browser recovery."
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps rate-limited browser fallback failures to retryable rate_limited errors", async () => {
    const provider = createShoppingProvider(amazonProfile);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 429,
      url: String(input),
      text: async () => "rate limited"
    })) as unknown as typeof fetch);

    try {
      await expect(provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          ...context,
          browserFallbackPort: {
            resolve: vi.fn(async () => ({
              ok: false,
              reasonCode: "rate_limited" as const,
              details: {
                message: "Fallback browser hit a rate limit."
              }
            }))
          }
        }
      )).rejects.toMatchObject({
        code: "rate_limited",
        reasonCode: "rate_limited",
        retryable: true,
        message: "Fallback browser hit a rate limit."
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps non-env-limited browser fallback failures to unavailable with a default message", async () => {
    const provider = createShoppingProvider(amazonProfile);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 500,
      url: String(input),
      text: async () => "server error"
    })) as unknown as typeof fetch);

    try {
      await expect(provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          ...context,
          browserFallbackPort: {
            resolve: vi.fn(async () => ({
              ok: false,
              reasonCode: "challenge_detected" as const,
              details: {}
            }))
          }
        }
      )).rejects.toMatchObject({
        code: "unavailable",
        reasonCode: "challenge_detected",
        message: "Browser fallback failed for https://amazon.com/s?k=wireless%20mouse"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the original auth error when browser fallback stays env-limited", async () => {
    const provider = createShoppingProvider(amazonProfile);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 403,
      url: String(input),
      text: async () => "auth blocked"
    })) as unknown as typeof fetch);

    try {
      await expect(provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          ...context,
          browserFallbackPort: {
            resolve: vi.fn(async () => ({
              ok: false,
              reasonCode: "env_limited" as const,
              details: {
                message: "Extension still disconnected."
              }
            }))
          }
        }
      )).rejects.toMatchObject({
        code: "auth",
        reasonCode: "token_required"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces blocker metadata from fetched login pages before browser assistance fallback", async () => {
    const provider = createShoppingProvider(amazonProfile);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Sign in</title></head><body>Please sign in to continue.</body></html>"
    })) as unknown as typeof fetch);

    try {
      await expect(provider.search?.({ query: "wireless mouse", limit: 1 }, context))
        .rejects.toMatchObject({
          code: "unavailable",
          reasonCode: "token_required",
          details: expect.objectContaining({
            title: "Sign in",
            reasonCode: "token_required"
          })
        });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves untitled browser-assistance diagnostics for shopping/others shells", async () => {
    const provider = createShoppingProviderById("shopping/others");

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body>Redirected to the non-JavaScript site for this query.</body></html>"
    })) as unknown as typeof fetch);

    try {
      await provider.search?.({ query: "wireless mouse", limit: 1 }, context);
      throw new Error("Expected shopping/others shell detection to reject the search.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "unavailable",
        reasonCode: "env_limited",
        details: expect.objectContaining({
          providerShell: "duckduckgo_non_js_redirect",
          constraint: expect.objectContaining({
            kind: "render_required",
            evidenceCode: "duckduckgo_non_js_redirect"
          }),
          reasonCode: "env_limited"
        })
      });
      expect((error as { details?: Record<string, unknown> }).details?.title).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves titled browser-assistance diagnostics for shopping/others shells", async () => {
    const provider = createShoppingProviderById("shopping/others");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://html.duckduckgo.com/html/?q=wireless%20mouse%20buy",
        html: "<html><body><a href=\"https://shop.example.com/product/wireless-mouse-pro\">Wireless mouse pro with a brushed shell and quiet wheel for hybrid desks</a><div>USD 44.99 4.8 out of 5 91 reviews in stock</div></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>DuckDuckGo Lite</title></head><body>Redirected to the non-JavaScript site for this query.</body></html>"
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
      const request = fallbackResolve.mock.calls[0]?.[0] as { details?: Record<string, unknown> } | undefined;
      expect(request?.details).toMatchObject({
        browserRequired: true,
        providerShell: "duckduckgo_non_js_redirect",
        constraint: expect.objectContaining({
          kind: "render_required",
          evidenceCode: "duckduckgo_non_js_redirect"
        }),
        title: "DuckDuckGo Lite"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses browser fallback when a 200 response is actually an anti-bot challenge page", async () => {
    const provider = createShoppingProviderById("shopping/walmart");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.walmart.com/ip/logitech-mouse/123",
        html: "<html><body><a href=\"https://www.walmart.com/ip/logitech-mouse/123\">Wireless mouse with silent clicks and compact shell</a><div>USD 24.99 4.7 out of 5 81 reviews in stock</div></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.walmart.com/blocked?url=L3NlYXJjaD9xPXdpcmVsZXNzJTIwbW91c2U=&g=b",
      text: async () => "<html><head><title>Robot or human?</title></head><body>Activate and hold the button to confirm that you're human.</body></html>"
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
      expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
        provider: "shopping/walmart",
        availability: "in_stock"
      });
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "shopping/walmart",
        operation: "search",
        reasonCode: "challenge_detected"
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces challenge blocker diagnostics without synthesizing a title", async () => {
    const provider = createShoppingProviderById("shopping/walmart");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.walmart.com/ip/logitech-mouse/123",
        html: "<html><body><a href=\"https://www.walmart.com/ip/logitech-mouse/123\">Wireless mouse with sculpted support and silent scroll wheel for daily work</a><div>USD 27.99 4.7 out of 5 81 reviews in stock</div></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://www.walmart.com/blocked?url=L3NlYXJjaD9xPXdpcmVsZXNzJTIwbW91c2U=&g=b",
      text: async () => "<html><body>Activate and hold the button to confirm that you're human.</body></html>"
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
      const request = fallbackResolve.mock.calls[0]?.[0] as { details?: Record<string, unknown> } | undefined;
      expect(request?.details).toMatchObject({
        blockerType: "anti_bot_challenge",
        reasonCode: "challenge_detected"
      });
      expect(request?.details?.title).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes best buy international splash pages through browser fallback", async () => {
    const provider = createShoppingProviderById("shopping/bestbuy");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.bestbuy.com/site/searchpage.jsp?st=wireless%20mouse",
        html: "<html><body><a href=\"https://www.bestbuy.com/site/logitech-pebble-2-wireless-mouse/6581201.p?skuId=6581201\">Logitech Pebble 2 wireless mouse with dual-device pairing and quiet clicks</a><div>USD 29.99 4.6 out of 5 104 reviews in stock</div></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Best Buy International: Select your Country</title></head><body>Choose a country for shopping and pickup options.</body></html>"
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
        provider: "shopping/bestbuy",
        operation: "search",
        reasonCode: "env_limited",
        details: expect.objectContaining({
          browserRequired: true,
          providerShell: "bestbuy_international_gate"
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes body-only Best Buy international gates through browser fallback without synthesizing a title", async () => {
    const provider = createShoppingProviderById("shopping/bestbuy");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.bestbuy.com/site/searchpage.jsp?st=wireless%20mouse&intl=nosplash",
        html: "<html><body><a href=\"https://www.bestbuy.com/site/logitech-signature-m650-wireless-mouse/6581201.p?skuId=6581201\">Logitech Signature wireless mouse with sculpted thumb support and multi-device pairing</a><div>USD 39.99 4.7 out of 5 205 reviews in stock</div></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body>Best Buy International. Choose a country for shopping and pickup options.</body></html>"
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
      const request = fallbackResolve.mock.calls[0]?.[0] as { details?: Record<string, unknown> } | undefined;
      expect(request?.details).toMatchObject({
        browserRequired: true,
        providerShell: "bestbuy_international_gate"
      });
      expect(request?.details?.title).toBeUndefined();
      expect(request?.details?.message).toEqual(expect.stringContaining("Best Buy International"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parses eBay search cards when live markup emits unquoted href attributes", async () => {
    const provider = createShoppingProviderById("shopping/ebay", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div class="su-image">
              <a class="s-card__link image-treatment" href=https://www.ebay.com/itm/123456789012?itmmeta=abc123>
                Logitech Pebble wireless mouse with quiet clicks and slim travel shell
              </a>
            </div>
            <div>US $24.99 4.7 out of 5 1,204 reviews free shipping in stock</div>
          </body></html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless mouse", limit: 1 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      url: "https://www.ebay.com/itm/123456789012?itmmeta=abc123",
      title: "Logitech Pebble wireless mouse with quiet clicks and slim travel shell"
    });
    expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
      provider: "shopping/ebay",
      price: {
        amount: 24.99,
        currency: "USD"
      },
      availability: "in_stock",
      rating: 4.7,
      reviews_count: 1204
    });
  });

  it("parses inline-style-heavy eBay s-card results without losing the primary price", async () => {
    const noisyStyle = "display:block;visibility:visible;".repeat(90);
    const provider = createShoppingProviderById("shopping/ebay", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <ul class="srp-results srp-list clearfix">
              <li class="s-card s-card--horizontal" style="${noisyStyle}">
                <div class="su-card-container su-card-container--horizontal" style="${noisyStyle}">
                  <div class="su-card-container__media" style="${noisyStyle}">
                    <div class="su-image" style="${noisyStyle}">
                      <a class="s-card__link image-treatment" href="https://www.ebay.com/itm/298017366287?itmmeta=abc123" style="${noisyStyle}">
                        <img class="s-card__image" src="https://i.ebayimg.com/images/g/zSEAAeSwUaRpil-q/s-l500.webp" alt="Apple MacBook Pro 2023 A2918 14in M3 10 Core GPU 16GB RAM 512GB SSD Excellent" />
                      </a>
                    </div>
                  </div>
                  <div class="su-card-container__content" style="${noisyStyle}">
                    <div class="su-card-container__header" style="${noisyStyle}">
                      <a class="s-card__link" href="https://www.ebay.com/itm/298017366287?itmmeta=abc123" style="${noisyStyle}">
                        <div class="s-card__title" style="${noisyStyle}">
                          <span>Apple MacBook Pro 2023 A2918 14in M3 10 Core GPU 16GB RAM 512GB SSD Excellent</span>
                          <span class="clipped">Opens in a new window or tab</span>
                        </div>
                      </a>
                      <div class="s-card__subtitle-row" style="${noisyStyle}">
                        <div class="s-card__subtitle" style="${noisyStyle}"><span>FREE FEDEX 2 DAY - 60 DAY RETURNS - 1 YEAR WARRANTY</span></div>
                      </div>
                      <div class="s-card__subtitle-row" style="${noisyStyle}">
                        <div class="s-card__subtitle" style="${noisyStyle}"><span>Excellent - Refurbished</span></div>
                      </div>
                    </div>
                    <div class="su-card-container__attributes su-card-container__attributes--has-secondary" style="${noisyStyle}">
                      <div class="su-card-container__attributes__primary" style="${noisyStyle}">
                        <div class="s-card__attribute-row" style="${noisyStyle}">
                          <span class="su-styled-text primary bold large-1 s-card__price" style="${noisyStyle}">$1,082.95</span>
                          <span class="su-styled-text secondary strikethrough large" style="${noisyStyle}">$1,799.00</span>
                        </div>
                        <div class="s-card__attribute-row" style="${noisyStyle}"><span>Buy It Now</span></div>
                        <div class="s-card__attribute-row" style="${noisyStyle}"><span>+$272.06 delivery</span></div>
                        <div class="s-card__attribute-row" style="${noisyStyle}"><span>Located in United States</span></div>
                        <div class="s-card__attribute-row" style="${noisyStyle}"><span>17+ watchers</span></div>
                        <div class="s-card__attribute-row" style="${noisyStyle}"><span>$5 off 2+ with coupon</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            </ul>
          </body></html>
        `
      })
    });

    const rows = await provider.search?.({ query: "macbook pro m4 32gb ram", limit: 1 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      url: "https://www.ebay.com/itm/298017366287?itmmeta=abc123",
      title: "Apple MacBook Pro 2023 A2918 14in M3 10 Core GPU 16GB RAM 512GB SSD Excellent"
    });
    expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
      provider: "shopping/ebay",
      price: {
        amount: 1082.95,
        currency: "USD"
      }
    });
    expect(rows?.[0]?.attributes.image_urls).toEqual(["https://i.ebayimg.com/images/g/zSEAAeSwUaRpil-q/s-l500.webp"]);
  });

  it("falls back to aria-label text pricing and generic image extraction for eBay s-card variants", async () => {
    const provider = createShoppingProviderById("shopping/ebay", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <ul class="srp-results srp-list clearfix">
              <li class="s-card s-card--horizontal">
                <a class="s-card__link" href="https://www.ebay.com/sch/i.html?_nkw=macbook+pro+m4+32gb+ram">Search noise card</a>
              </li>
              <li class="s-card s-card--horizontal">
                <a
                  class="s-card__link image-treatment"
                  href="https://www.ebay.com/itm/987654321000?itmmeta=xyz123"
                  aria-label="Refurbished MacBook Pro M4 with 32GB RAM and 1TB SSD for studio editing"
                >
                  <img src="https://i.ebayimg.com/images/g/example/s-l500.webp" alt="Refurbished MacBook Pro M4" />
                </a>
                <div>USD 1,999.99 4.8 out of 5 205 reviews only 2 left</div>
              </li>
            </ul>
          </body></html>
        `
      })
    });

    const rows = await provider.search?.({ query: "macbook pro m4 32gb ram", limit: 2 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      url: "https://www.ebay.com/itm/987654321000?itmmeta=xyz123",
      title: "Refurbished MacBook Pro M4 with 32GB RAM and 1TB SSD for studio editing"
    });
    expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
      provider: "shopping/ebay",
      price: {
        amount: 1999.99,
        currency: "USD"
      },
      availability: "limited",
      rating: 4.8,
      reviews_count: 205
    });
    expect(rows?.[0]?.attributes.image_urls).toEqual(["https://i.ebayimg.com/images/g/example/s-l500.webp"]);
  });

  it("routes target shell pages through browser fallback", async () => {
    const provider = createShoppingProviderById("shopping/target");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.target.com/s?searchTerm=wireless%20mouse",
        html: "<html><body><a href=\"https://www.target.com/p/logitech-signature-m650-wireless-mouse/-/A-89123456\">Logitech Signature wireless mouse with sculpted support and silent wheel</a><div>USD 39.99 4.7 out of 5 205 reviews in stock</div></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>\"wireless mouse\" : Target</title></head><body>skip to main content skip to footer weekly ad registry target circle</body></html>"
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
        provider: "shopping/target",
        operation: "search",
        reasonCode: "env_limited",
        runtimePolicy: expect.objectContaining({
          browser: {
            preferredModes: ["extension", "managed_headed"],
            forceTransport: false
          }
        }),
        details: expect.objectContaining({
          browserRequired: true,
          providerShell: "target_shell_page",
          constraint: expect.objectContaining({
            kind: "render_required",
            evidenceCode: "target_shell_page"
          })
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces auth-required no-candidate shopping shells from custom fetchers", async () => {
    const provider = createShoppingProviderById("shopping/costco", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: "<html><head><title>Sign In | Costco</title></head><body>Please sign in to continue.</body></html>"
      })
    });

    await expect(provider.search?.({ query: "wireless mouse", limit: 1 }, context)).rejects.toMatchObject({
      code: "auth",
      reasonCode: "token_required",
      message: "Authentication required for https://www.costco.com/CatalogSearch?dept=All&keyword=wireless%20mouse",
      details: expect.objectContaining({
        title: "Sign In | Costco",
        message: "Sign In | Costco Please sign in to continue.",
        blockerType: "auth_required",
        constraint: {
          kind: "session_required",
          evidenceCode: "auth_required",
          message: "Sign In | Costco Please sign in to continue."
        }
      })
    });
  });

  it("surfaces auth-required shopping fetch pages through the shared surface-issue path", async () => {
    const provider = createShoppingProviderById("shopping/costco");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Sign In | Costco</title></head><body>Please sign in to continue.</body></html>"
    })) as unknown as typeof fetch);

    try {
      await expect(provider.fetch?.(
        { url: "https://www.costco.com/wireless-mouse.html" },
        context
      )).rejects.toMatchObject({
        reasonCode: "token_required"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes target next-shell search pages without inline product links through browser fallback", async () => {
    const provider = createShoppingProviderById("shopping/target");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.target.com/s?searchTerm=wireless%20mouse",
        html: "<html><body><a href=\"https://www.target.com/p/logitech-m240-wireless-mouse/-/A-89711228\">Logitech M240 Wireless Mouse</a><div>USD 24.99 4.6 out of 5 333 ratings in stock</div></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>&quot;wireless mouse&quot; : Target</title></head><body><script>window.__TGT_DATA__ = {\"slots\":{\"1200\":{\"metadata\":{\"components\":[{\"placement_id\":\"WEB-search-product-grid-default\"}]}}}}</script></body></html>"
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
        provider: "shopping/target",
        operation: "search",
        reasonCode: "env_limited",
        runtimePolicy: expect.objectContaining({
          browser: {
            preferredModes: ["extension", "managed_headed"],
            forceTransport: false
          }
        }),
        details: expect.objectContaining({
          browserRequired: true,
          providerShell: "target_shell_page",
          constraint: expect.objectContaining({
            kind: "render_required",
            evidenceCode: "target_shell_page"
          })
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves browser fallback metadata when target recovery still ends on a render-required shell", async () => {
    const provider = createShoppingProviderById("shopping/target");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.target.com/s?searchTerm=wireless%20mouse",
        html: "<html><head><title>\"wireless mouse\" : Target</title></head><body>skip to main content skip to footer weekly ad registry target circle</body></html>"
      },
      details: {
        cookieDiagnostics: {
          available: true,
          verifiedCount: 1
        },
        challengeOrchestration: {
          mode: "browser_with_helper",
          source: "config",
          status: "resolved"
        }
      }
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>\"wireless mouse\" : Target</title></head><body>skip to main content skip to footer weekly ad registry target circle</body></html>"
    })) as unknown as typeof fetch);

    try {
      await provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          ...context,
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        }
      );
      throw new Error("Expected target shell recovery to stay blocked");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderRuntimeError);
      expect((error as ProviderRuntimeError).reasonCode).toBe("env_limited");
      expect((error as ProviderRuntimeError).details).toMatchObject({
        browserFallbackMode: "extension",
        browserFallbackReasonCode: "env_limited",
        cookieDiagnostics: {
          available: true,
          verifiedCount: 1
        },
        challengeOrchestration: {
          mode: "browser_with_helper",
          source: "config",
          status: "resolved"
        },
        constraint: {
          kind: "render_required",
          evidenceCode: "target_shell_page"
        },
        providerShell: "target_shell_page"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps generic env-limited no-offer pages as tagged fallback rows", async () => {
    const provider = createShoppingProvider(amazonProfile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: "<html><body>This provider is not available in this environment right now.</body></html>"
      })
    });

    const rows = await provider.search?.({ query: "wireless mouse", limit: 1 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.attributes).toMatchObject({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      retrievalPath: "shopping:search:index"
    });
  });

  it("routes Temu empty shell pages through browser fallback", async () => {
    const provider = createShoppingProviderById("shopping/temu");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.temu.com/search_result.html?search_key=wireless%20mouse",
        html: "<html><body><a href=\"https://www.temu.com/g-601099522700389.html\">Ergonomic mouse with travel sleeve and magnetic top shell for remote work</a><div>USD 18.99 4.5 out of 5 88 reviews in stock</div></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body></body></html>"
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
        provider: "shopping/temu",
        operation: "search",
        reasonCode: "env_limited",
        details: expect.objectContaining({
          browserRequired: true,
          providerShell: "temu_empty_shell",
          constraint: expect.objectContaining({
            kind: "render_required",
            evidenceCode: "temu_empty_shell"
          })
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces challenge no-candidate shopping shells from custom fetchers", async () => {
    const provider = createShoppingProviderById("shopping/temu", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: "<html><head><title>Robot or human?</title></head><body>Activate and hold the button to confirm that you're human.</body></html>"
      })
    });

    await expect(provider.search?.({ query: "wireless mouse", limit: 1 }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "challenge_detected",
      message: "Detected anti-bot challenge while retrieving https://www.temu.com/search_result.html?search_key=wireless%20mouse",
      details: expect.objectContaining({
        blockerType: "anti_bot_challenge",
        reasonCode: "challenge_detected",
        title: "Robot or human?"
      })
    });
  });

  it("surfaces challenge shopping fetch pages through the shared surface-issue path", async () => {
    const provider = createShoppingProviderById("shopping/temu");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body><script src=\"https://static.kwcdn.com/upload-static/assets/chl/js/challenge.js\"></script><script>window.challenge=true</script></body></html>"
    })) as unknown as typeof fetch);

    try {
      await expect(provider.fetch?.(
        { url: "https://www.temu.com/g-601099522700389.html" },
        context
      )).rejects.toMatchObject({
        code: "unavailable",
        reasonCode: "challenge_detected",
        message: "Detected anti-bot challenge while retrieving https://www.temu.com/g-601099522700389.html"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes Temu challenge shells through browser fallback", async () => {
    const provider = createShoppingProviderById("shopping/temu");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.temu.com/search_result.html?search_key=wireless%20mouse",
        html: "<html><body><a href=\"https://www.temu.com/g-601099522700389.html\">Ergonomic mouse with magnetic shell and travel sleeve</a><div>USD 18.99 4.5 out of 5 88 reviews in stock</div></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body><script src=\"https://static.kwcdn.com/upload-static/assets/chl/js/challenge.js\"></script><script>window.challenge=true</script></body></html>"
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
        provider: "shopping/temu",
        operation: "search",
        reasonCode: "challenge_detected",
        details: expect.objectContaining({
          browserRequired: true,
          providerShell: "temu_challenge_shell",
          blockerType: "anti_bot_challenge",
          reasonCode: "challenge_detected"
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the DuckDuckGo HTML endpoint for shopping/others and falls back on non-JS redirect pages", async () => {
    const provider = createShoppingProviderById("shopping/others");
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://html.duckduckgo.com/html/?q=wireless%20mouse%20buy",
        html: "<html><body><a href=\"https://shop.example.com/product/wireless-mouse-pro\">Wireless mouse pro with low-profile buttons and an anodized aluminum shell</a><div>USD 49.99 4.8 out of 5 61 reviews in stock</div></body></html>"
      },
      details: {}
    }));
    const fetchMock = vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body>You are being redirected to the non-JavaScript site</body></html>"
    })) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

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
      expect(fetchMock).toHaveBeenCalledWith(
        "https://html.duckduckgo.com/html/?q=wireless%20mouse%20buy",
        expect.objectContaining({
          redirect: "follow"
        })
      );
        expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
          provider: "shopping/others",
          operation: "search",
          reasonCode: "env_limited",
          details: expect.objectContaining({
            browserRequired: true,
            providerShell: "duckduckgo_non_js_redirect",
            constraint: expect.objectContaining({
              kind: "render_required",
              evidenceCode: "duckduckgo_non_js_redirect"
            })
          })
        }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("generates shopping fallback traces and forwards cookie overrides for generic retrieval failures", async () => {
    const provider = createShoppingProvider(amazonProfile);
    const fallbackResolve = vi.fn(async (request: { reasonCode: string; url?: string }) => ({
      ok: true,
      reasonCode: request.reasonCode,
      mode: "managed_headed" as const,
      output: {
        url: request.url ?? "https://www.amazon.com/s?k=wireless%20mouse",
        html: "<html><body><main>upstream fallback</main></body></html>"
      },
      details: {}
    }));

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 503,
      url: String(input),
      text: async () => "server down"
    })) as unknown as typeof fetch);

    try {
      const rows = await provider.search?.(
        { query: "wireless mouse", limit: 1 },
        {
          timeoutMs: 1000,
          attempt: 1,
          runtimePolicy: resolveProviderRuntimePolicy({
            source: "shopping",
            preferredFallbackModes: ["managed_headed"],
            useCookies: true,
            cookiePolicyOverride: "required"
          }),
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        } as never
      );

      expect(rows?.length).toBeGreaterThan(0);
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "shopping/amazon",
        operation: "search",
        reasonCode: "env_limited",
        runtimePolicy: expect.objectContaining({
          browser: {
            preferredModes: ["managed_headed"],
            forceTransport: false
          },
          cookies: {
            requested: true,
            policy: "required"
          }
        }),
        settleTimeoutMs: 15000,
        captureDelayMs: 2000,
        trace: expect.objectContaining({
          provider: "shopping/amazon",
          requestId: expect.stringMatching(/^provider-fallback-/)
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses browser transport immediately when explicit browser mode is forced", async () => {
    const provider = createShoppingProvider(amazonProfile);
    const fallbackResolve = vi.fn(async (request: { url?: string }) => ({
      ok: true,
      reasonCode: "env_limited" as const,
      mode: "extension" as const,
      output: {
        url: request.url ?? "https://www.amazon.com/dp/macbook-pro-force-browser",
        html: `
          <html>
            <head>
              <title>Apple MacBook Pro 14</title>
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Apple MacBook Pro 14",
                  "offers": {
                    "@type": "Offer",
                    "price": 1999,
                    "priceCurrency": "USD"
                  }
                }
              </script>
            </head>
            <body>
              <main>Apple MacBook Pro 14 with M4 and 32GB unified memory.</main>
            </body>
          </html>
        `
      },
      details: {}
    }));
    const fetchMock = vi.fn(async () => {
      throw new Error("raw fetch should not run when browser transport is forced");
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      const rows = await provider.fetch?.(
        { url: "https://www.amazon.com/dp/macbook-pro-force-browser" },
        {
          ...context,
          runtimePolicy: resolveProviderRuntimePolicy({
            source: "shopping",
            runtimePolicy: {
              browserMode: "extension"
            }
          }),
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        } as never
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        provider: "shopping/amazon",
        operation: "fetch",
        reasonCode: "env_limited",
        runtimePolicy: expect.objectContaining({
          browser: {
            preferredModes: ["extension"],
            forceTransport: true
          }
        }),
        url: "https://www.amazon.com/dp/macbook-pro-force-browser"
      }));
      expect(rows?.[0]?.attributes.browser_fallback_mode).toBe("extension");
      expect(rows?.[0]?.title).toContain("Apple MacBook Pro 14");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves deferred fallback failure details when explicit browser mode cannot complete", async () => {
    const provider = createShoppingProvider(amazonProfile);
    const fallbackResolve = vi.fn(async () => ({
      ok: false,
      reasonCode: "env_limited" as const,
      disposition: "deferred" as const,
      mode: "extension" as const,
      details: {
        message: "Extension relay connection failed: Relay /cdp connectOverCDP failed after 512ms."
      }
    }));
    const fetchMock = vi.fn(async () => {
      throw new Error("raw fetch should not run when browser transport is forced");
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    try {
      await expect(provider.fetch?.(
        { url: "https://www.amazon.com/dp/macbook-pro-force-browser-failure" },
        {
          ...context,
          runtimePolicy: resolveProviderRuntimePolicy({
            source: "shopping",
            runtimePolicy: {
              browserMode: "extension"
            }
          }),
          browserFallbackPort: {
            resolve: fallbackResolve
          }
        } as never
      )).rejects.toMatchObject({
        message: "Extension relay connection failed: Relay /cdp connectOverCDP failed after 512ms.",
        reasonCode: "env_limited",
        details: {
          disposition: "deferred",
          browserFallbackMode: "extension",
          url: "https://www.amazon.com/dp/macbook-pro-force-browser-failure"
        }
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(fallbackResolve).toHaveBeenCalledWith(expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          browser: {
            preferredModes: ["extension"],
            forceTransport: true
          }
        })
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips shopping browser fallback for non-recoverable fetcher failures", async () => {
    const provider = createShoppingProvider(amazonProfile, {
      fetcher: async () => {
        throw new ProviderRuntimeError("invalid_input", "bad query", {
          retryable: false
        });
      }
    });
    const fallbackResolve = vi.fn(async () => ({
      ok: true,
      reasonCode: "env_limited" as const,
      mode: "managed_headed" as const,
      output: {},
      details: {}
    }));

    await expect(provider.search?.(
      { query: "wireless mouse" },
      {
        ...context,
        browserFallbackPort: {
          resolve: fallbackResolve
        }
      }
    )).rejects.toMatchObject({
      code: "invalid_input"
    });
    expect(fallbackResolve).not.toHaveBeenCalled();
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
