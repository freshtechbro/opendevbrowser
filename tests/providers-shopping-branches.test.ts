import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShoppingProvider,
  createShoppingProviderById,
  type ShoppingProviderProfile
} from "../src/providers/shopping";

const context = {
  trace: { requestId: "shopping-branches", ts: new Date().toISOString() },
  timeoutMs: 1000,
  attempt: 1 as const
};

const profile: ShoppingProviderProfile = {
  name: "amazon",
  id: "shopping/amazon",
  displayName: "Amazon",
  domains: ["amazon.com"],
  tier: "tier1",
  extractionFocus: "offer parsing",
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

describe("shopping provider branches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("covers URL-vs-index search paths, link dedupe, and limit clamping", async () => {
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => {
        const longLinks = Array.from({ length: 40 }, (_, index) => `<a href=\"https://amazon.com/item-${index}\">${index}</a>`).join("\n");
        return {
          status: 200,
          url,
          html: `<html><body><main>$19.99 4.8 out of 5 1,234 reviews in stock</main>
            <a href=\"https://amazon.com/item-1\">one</a>
            <a href=\"https://amazon.com/item-1\">dup</a>
            <a href=\"https://amazon.com/canonical#frag-a\">frag-a</a>
            <a href=\"https://amazon.com/canonical#frag-b\">frag-b</a>
            <a href=\"mailto:test@example.com\">mail</a>
            ${longLinks}
          </body></html>`
        };
      }
    });

    const byUrl = await provider.search?.({ query: "https://amazon.com/s?k=mouse", limit: 1 }, context);
    expect(byUrl?.length).toBeLessThanOrEqual(2);
    expect(byUrl?.[0]?.attributes.retrievalPath).toBe("shopping:search:url");

    const byIndex = await provider.search?.({ query: "wireless mouse", limit: 50 }, context);
    expect(byIndex?.[0]?.attributes.retrievalPath).toBe("shopping:search:index");
    expect(byIndex?.length).toBeLessThanOrEqual(21);

    const links = (byIndex?.[0]?.attributes.links ?? []) as string[];
    expect(links).toContain("https://amazon.com/item-0");
    expect(links).not.toContain("mailto:test@example.com");
    expect(links.filter((link) => link.includes("/canonical")).length).toBe(1);

    const byDefaultLimit = await provider.search?.({ query: "wireless mouse" }, context);
    expect(byDefaultLimit?.length).toBeLessThanOrEqual(11);
  });

  it("parses availability, currency, rating and reviews across content variants", async () => {
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => {
        if (url.includes("limited")) {
          return {
            status: 200,
            url,
            html: "<html><body><main>Great offer €1,299.00 only 2 left 4.9 out of 5 1,234 reviews</main></body></html>"
          };
        }
        if (url.includes("sold")) {
          return {
            status: 200,
            url,
            html: "<html><body><main>Sold out now £99.99 3.5 out of 5 12 reviews</main></body></html>"
          };
        }
        return {
          status: 200,
          url,
          html: url.includes("no-text")
            ? "<html><body></body></html>"
            : "<html><body><main>No inventory text here</main></body></html>"
        };
      }
    });

    const limited = await provider.fetch?.({ url: "https://amazon.com/limited" }, context);
    const limitedOffer = limited?.[0]?.attributes.shopping_offer as {
      availability: string;
      price: { currency: string; amount: number };
      rating: number;
      reviews_count: number;
    };
    expect(limitedOffer.availability).toBe("limited");
    expect(limitedOffer.price.currency).toBe("EUR");
    expect(limitedOffer.price.amount).toBe(1299);
    expect(limitedOffer.rating).toBe(4.9);
    expect(limitedOffer.reviews_count).toBe(1234);

    const sold = await provider.fetch?.({ url: "https://amazon.com/sold" }, context);
    const soldOffer = sold?.[0]?.attributes.shopping_offer as {
      availability: string;
      price: { currency: string };
    };
    expect(soldOffer.availability).toBe("out_of_stock");
    expect(soldOffer.price.currency).toBe("GBP");

    const unknown = await provider.fetch?.({ url: "https://amazon.com/unknown" }, context);
    const unknownOffer = unknown?.[0]?.attributes.shopping_offer as {
      availability: string;
      price: { amount: number };
    };
    expect(unknownOffer.availability).toBe("unknown");
    expect(unknownOffer.price.amount).toBe(0);

    const noText = await provider.fetch?.({ url: "https://amazon.com/no-text" }, context);
    expect(noText?.[0]?.title).toBe("https://amazon.com/no-text");
  });

  it("maps default fetcher network/auth/unavailable branches and url fallback", async () => {
    const provider = createShoppingProvider(profile);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);
    await expect(provider.search?.({ query: "mouse" }, context)).rejects.toMatchObject({ code: "network" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 401,
      url: "https://amazon.com/s?k=mouse",
      text: async () => "auth"
    })) as unknown as typeof fetch);
    await expect(provider.search?.({ query: "mouse" }, context)).rejects.toMatchObject({ code: "auth" });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 404,
      url: "https://amazon.com/s?k=mouse",
      text: async () => "missing"
    })) as unknown as typeof fetch);
    await expect(provider.search?.({ query: "mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      retryable: false
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "",
      text: async () => "<html><body><main>$10.00</main></body></html>"
    })) as unknown as typeof fetch);

    const fetched = await provider.fetch?.({ url: "https://amazon.com/item" }, context);
    expect(fetched?.[0]?.url).toBe("https://amazon.com/item");
  });

  it("supports custom adapter overrides and provider-id resolution", async () => {
    const provider = createShoppingProvider(profile, {
      id: "shopping/custom-amazon",
      search: async () => ([{
        url: "https://example.com/custom-search",
        title: "custom search",
        content: "custom content"
      }]),
      fetch: async () => ({
        url: "https://example.com/custom-fetch",
        title: "custom fetch",
        content: "custom fetch content",
        confidence: 0.95,
        attributes: {
          shopping_offer: {
            provider: "shopping/custom-amazon",
            product_id: "custom-product",
            title: "custom fetch",
            url: "https://example.com/custom-fetch",
            price: { amount: 20, currency: "USD", retrieved_at: new Date().toISOString() },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 5,
            reviews_count: 1
          }
        }
      })
    });

    const searched = await provider.search?.({ query: "custom" }, context);
    expect(searched?.[0]?.provider).toBe("shopping/custom-amazon");

    const fetched = await provider.fetch?.({ url: "https://example.com/custom-fetch" }, context);
    expect(fetched?.[0]?.provider).toBe("shopping/custom-amazon");

    const health = await provider.health?.({
      trace: context.trace,
      timeoutMs: context.timeoutMs
    });
    expect(health).toMatchObject({ status: "healthy" });

    const caps = provider.capabilities();
    expect(caps.providerId).toBe("shopping/custom-amazon");
    expect(caps.operations.search.supported).toBe(true);

    expect(createShoppingProviderById("amazon").id).toBe("shopping/amazon");
  });

  it("handles numeric overflow branches for price and review parsing", async () => {
    const giantNumber = `9${",999".repeat(120)}`;
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `<html><body><main>$${giantNumber} 4.5 out of 5 ${giantNumber} reviews in stock</main></body></html>`
      })
    });

    const fetched = await provider.fetch?.({ url: "https://amazon.com/overflow" }, context);
    const offer = fetched?.[0]?.attributes.shopping_offer as {
      price: { amount: number };
      reviews_count: number;
    };
    expect(offer.price.amount).toBe(0);
    expect(offer.reviews_count).toBe(0);
  });
});
