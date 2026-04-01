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
    expect(links.filter((link) => link.includes("/canonical")).length).toBe(0);

    const byDefaultLimit = await provider.search?.({ query: "wireless mouse" }, context);
    expect(byDefaultLimit?.length).toBeLessThanOrEqual(11);
  });

  it("uses the Best Buy nosplash search path so browser fallback lands on live results", async () => {
    const fetcher = vi.fn(async ({ url }: { url: string }) => ({
      status: 200,
      url,
      html: "<html><body><main>$29.99 add to cart</main></body></html>"
    }));
    const provider = createShoppingProviderById("shopping/bestbuy", { fetcher });

    await provider.search?.({ query: "wireless mouse", limit: 1 }, context);

    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://www.bestbuy.com/site/searchpage.jsp?st=wireless%20mouse&intl=nosplash"
    }));
  });

  it("surfaces Best Buy international shells without fabricating a message body", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><head><title>Best Buy International</title></head><body></body></html>"
    })) as unknown as typeof fetch);
    const provider = createShoppingProviderById("shopping/bestbuy");

    await expect(provider.search?.({ query: "wireless mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "env_limited",
      details: {
        providerShell: "bestbuy_international_gate",
        title: "Best Buy International"
      }
    });
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

  it("classifies restricted-target fallback pages even for custom shopping provider ids", async () => {
    const customProvider = createShoppingProvider({
      ...profile,
      id: "shopping/custom-amazon"
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "chrome://settings",
      text: async () => "<html><body>Restricted browser target.</body></html>"
    })) as unknown as typeof fetch);

    await expect(customProvider.search?.({ query: "wireless mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "env_limited",
      details: {
        blockerType: "restricted_target",
        reasonCode: "env_limited",
        url: "chrome://settings"
      }
    });
  });

  it("extracts search result cards from newegg-style search pages instead of noisy navigation links", async () => {
    const provider = createShoppingProviderById("shopping/newegg", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <a href="https://www.newegg.com/p/pl?d=portable+monitor">Next Page</a>
            <div class="item-cell" id="item_cell_1">
              <div class="item-container position-relative">
                <a href="https://www.newegg.com/15-6-uperfect-m156t03-w/p/2NY-008V-00011" class="item-img">
                  <img src="https://c1.neweggimages.com/productimage/nb300/BJBBS240301087DZ93C.jpg" alt="UPERFECT Portable Monitor" />
                  <div class="btn btn-large btn-quickview">Quick View</div>
                </a>
                <div class="item-info">
                  <div class="item-branding has-brand-store">
                    <a href="https://www.newegg.com/Uperfect/BrandStore/ID-223234" class="item-brand"><img alt="Uperfect" /></a>
                    <a href="https://www.newegg.com/15-6-uperfect-m156t03-w/p/2NY-008V-00011#IsFeedbackTab" class="item-rating" title="Rating + 4.9"><span class="item-rating-num">(29)</span></a>
                  </div>
                  <a href="https://www.newegg.com/15-6-uperfect-m156t03-w/p/2NY-008V-00011" class="item-title">UPERFECT Portable Monitor 15.6 inch USB-C Travel Display</a>
                  <ul class="item-features"><li><strong>Brand:</strong> Uperfect</li></ul>
                </div>
                <div class="item-action">
                  <ul class="price">
                    <li class="price-current">$<strong>69</strong><sup>.99</sup></li>
                    <li class="price-ship">Free Shipping</li>
                  </ul>
                </div>
              </div>
            </div>
            <div class="item-cell" id="item_cell_2">
              <div class="item-container position-relative">
                <a href="https://www.newegg.com/p/2NY-008V-00067" class="item-img">
                  <img src="https://c1.neweggimages.com/productimage/nb300/BJBBS2510270ROHDY5A.jpg" alt="UPERFECT 18.4 4K Portable Monitor" />
                </a>
                <div class="item-info">
                  <a href="https://www.newegg.com/p/2NY-008V-00067" class="item-title">UPERFECT 18.4 inch 4K Portable Monitor</a>
                </div>
                <div class="item-action">
                  <ul class="price">
                    <li class="price-current">$<strong>299</strong><sup>.99</sup></li>
                  </ul>
                </div>
              </div>
            </div>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "portable monitor", limit: 5 }, context);
    expect(records).toHaveLength(2);
    expect(records?.map((record) => record.url)).toEqual([
      "https://www.newegg.com/15-6-uperfect-m156t03-w/p/2NY-008V-00011",
      "https://www.newegg.com/p/2NY-008V-00067"
    ]);
    expect(records?.every((record) => record.attributes.retrievalPath === "shopping:search:result-card")).toBe(true);
    expect(records?.[0]?.title).toBe("UPERFECT Portable Monitor 15.6 inch USB-C Travel Display");
    expect(records?.[0]?.attributes.brand).toBe("Uperfect");
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 69.99,
        currency: "USD"
      },
      reviews_count: 29,
      rating: 4.9,
      availability: "in_stock"
    });
  });

  it("falls back to aria-label or title when generic search anchors have empty inner html", async () => {
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div>$149.99 4.5 out of 5 42 reviews in stock</div>
            <a href="https://amazon.com/item-aria" aria-label="Ergonomic office chair with breathable mesh support"></a>
            <div>$189.99 4.7 out of 5 87 reviews in stock</div>
            <a href="https://amazon.com/item-title" title="Adjustable standing desk converter with stable frame"></a>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "desk setup", limit: 5 }, context);

    expect(records?.map((record) => record.title)).toEqual([
      "Ergonomic office chair with breathable mesh support",
      "Adjustable standing desk converter with stable frame"
    ]);
    expect(records?.every((record) => record.attributes.retrievalPath === "shopping:search:result-card")).toBe(true);
  });

  it("unwraps embedded tracking urls, keeps generic card images, and skips off-domain or asset anchors", async () => {
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div>USD 229.99 4.6 out of 5 84 reviews free shipping</div>
            <a href="https://tracker.example/redirect/https://amazon.com/item-42">
              <img src="https://cdn.example.com/portable-monitor.jpg" />
              Portable monitor with vivid panel and folding stand for travel
            </a>
            <a href="https://tracker.example/redirect/https://amazon.com/s?k=portable+monitor">
              Portable monitor search page that should be filtered as noisy navigation
            </a>
            <a href="https://other.example/item-77">Portable monitor from another domain with a long enough title</a>
            <a href="https://amazon.com/logo.png">Portable monitor asset link that should be ignored</a>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "portable monitor", limit: 5 }, context);

    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      url: "https://amazon.com/item-42",
      title: "Portable monitor with vivid panel and folding stand for travel"
    });
    expect(records?.[0]?.attributes.image_urls).toEqual(["https://cdn.example.com/portable-monitor.jpg"]);
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 229.99,
        currency: "USD"
      },
      rating: 4.6,
      reviews_count: 84,
      availability: "in_stock"
    });
  });

  it("unwraps DuckDuckGo HTML uddg redirect links for shopping/others search results", async () => {
    const provider = createShoppingProviderById("shopping/others", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.amazon.com%2FLogitech-Ergonomic-Performance-Ultra-Fast-Scrolling%2Fdp%2FB0FC5SJNQX">
              Logitech MX Master 4 Ergonomic Wireless Mouse
            </a>
            <div>USD 129.99 4.8 out of 5 412 reviews in stock</div>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "wireless mouse", limit: 5 }, context);

    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      url: "https://www.amazon.com/Logitech-Ergonomic-Performance-Ultra-Fast-Scrolling/dp/B0FC5SJNQX",
      title: "Logitech MX Master 4 Ergonomic Wireless Mouse"
    });
    expect(records?.[0]?.attributes.retrievalPath).toBe("shopping:search:result-card");
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 129.99,
        currency: "USD"
      },
      rating: 4.8,
      reviews_count: 412,
      availability: "in_stock"
    });
  });

  it("recognizes live provider product-url patterns beyond the legacy amazon-style hints", async () => {
    const scenarios = [
      {
        providerId: "shopping/walmart",
        url: "https://www.walmart.com/ip/Logitech-M185-Wireless-Mouse-Black/123456789",
        title: "Logitech wireless mouse with silent clicks and compact travel shell"
      },
      {
        providerId: "shopping/ebay",
        url: "https://www.ebay.com/itm/156789012345",
        title: "Certified refurbished wireless mouse with quiet scroll wheel"
      },
      {
        providerId: "shopping/bestbuy",
        url: "https://www.bestbuy.com/site/logitech-signature-m650-wireless-mouse-graphite/6501234.p?skuId=6501234",
        title: "Logitech Signature mouse with sculpted grip and multi-device pairing"
      },
      {
        providerId: "shopping/costco",
        url: "https://www.costco.com/corsair-m75-wireless-gaming-mouse.product.4000183702.html",
        title: "Corsair wireless gaming mouse bundle with precision charging dock"
      },
      {
        providerId: "shopping/aliexpress",
        url: "https://www.aliexpress.com/i/1005008123456789.html",
        title: "Portable Bluetooth mouse with aluminum shell and USB-C recharge"
      },
      {
        providerId: "shopping/temu",
        url: "https://www.temu.com/g-601099522700389.html",
        title: "Ergonomic mouse with magnetic top shell and travel sleeve"
      },
      {
        providerId: "shopping/others",
        url: "https://shop.example.com/product/wireless-mouse-pro",
        title: "Wireless mouse pro with low-profile buttons and canvas pouch"
      }
    ] as const;

    for (const scenario of scenarios) {
      const provider = createShoppingProviderById(scenario.providerId, {
        fetcher: async ({ url }) => ({
          status: 200,
          url,
          html: `
            <html><body>
              <div>USD 59.99 4.8 out of 5 145 reviews in stock</div>
              <a href="${scenario.url}">${scenario.title}</a>
            </body></html>
          `
        })
      });

      const records = await provider.search?.({ query: "wireless mouse", limit: 5 }, context);

      expect(records?.[0]).toMatchObject({
        url: scenario.url,
        title: scenario.title
      });
      expect(records?.[0]?.attributes.retrievalPath).toBe("shopping:search:result-card");
      expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
        price: {
          amount: 59.99,
          currency: "USD"
        },
        rating: 4.8,
        reviews_count: 145,
        availability: "in_stock"
      });
    }
  });

  it("unwraps walmart tracking redirects that hide the product url inside the rd query parameter", async () => {
    const provider = createShoppingProviderById("shopping/walmart", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div>USD 39.97 4.6 out of 5 128 reviews in stock</div>
            <a href="https://www.walmart.com/sp/track?bt=1&amp;eventST=click&amp;rd=https%3A%2F%2Fwww.walmart.com%2Fip%2FLogitech-Icon-Combo-Keyboard-Lilac%2F15458220925%3FadsRedirect%3Dtrue&amp;storeId=3081&amp;/ip/Logitech-Icon-Combo-Keyboard-Lilac/15458220925">
              Logitech POP Icon Bluetooth Keyboard and Mouse Combo, Lilac, Walmart Exclusive
            </a>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "wireless mouse", limit: 5 }, context);

    expect(records?.[0]).toMatchObject({
      url: "https://www.walmart.com/ip/Logitech-Icon-Combo-Keyboard-Lilac/15458220925?adsRedirect=true",
      title: "Logitech POP Icon Bluetooth Keyboard and Mouse Combo, Lilac, Walmart Exclusive"
    });
    expect(records?.[0]?.attributes.retrievalPath).toBe("shopping:search:result-card");
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 39.97,
        currency: "USD"
      },
      rating: 4.6,
      reviews_count: 128,
      availability: "in_stock"
    });
  });

  it("dedupes duplicate newegg result cards and keeps the richer candidate", async () => {
    const provider = createShoppingProviderById("shopping/newegg", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div class="item-cell" id="item_cell_sparse">
              <div class="item-container position-relative">
                <a href="https://www.newegg.com/p/2NY-008V-00077" class="item-title">UPERFECT 17 inch portable monitor</a>
                <div class="item-action">
                  <ul class="price">
                    <li class="price-current">USD 279.99</li>
                  </ul>
                </div>
              </div>
            </div>
            <div class="item-cell" id="item_cell_rich">
              <div class="item-container position-relative" data-brand="UPERFECT">
                <a href="https://www.newegg.com/p/2NY-008V-00077" class="item-img">
                  <img src="https://c1.neweggimages.com/productimage/nb300/rich.jpg" alt="UPERFECT 17 inch portable monitor" />
                </a>
                <div class="item-info">
                  <a href="https://www.newegg.com/p/2NY-008V-00077" class="item-title">UPERFECT 17 inch portable monitor</a>
                  <a href="https://www.newegg.com/p/2NY-008V-00077#IsFeedbackTab" class="item-rating" title="Rating + 4.8">
                    <span class="item-rating-num">(45)</span>
                  </a>
                </div>
                <div class="item-action">
                  <ul class="price">
                    <li class="price-current">USD 249.99</li>
                    <li class="price-ship">Free Shipping</li>
                  </ul>
                </div>
              </div>
            </div>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "portable monitor", limit: 5 }, context);

    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      url: "https://www.newegg.com/p/2NY-008V-00077",
      title: "UPERFECT 17 inch portable monitor"
    });
    expect(records?.[0]?.attributes.brand).toBe("UPERFECT");
    expect(records?.[0]?.attributes.image_urls).toEqual(["https://c1.neweggimages.com/productimage/nb300/rich.jpg"]);
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 249.99,
        currency: "USD"
      },
      rating: 4.8,
      reviews_count: 45,
      availability: "in_stock"
    });
  });

  it("filters malformed newegg cards, falls back to title attributes, and preserves raw invalid image urls", async () => {
    const provider = createShoppingProviderById("shopping/newegg", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div class="item-cell" id="missing_href">
              <a class="item-title">No href means this card should be ignored.</a>
            </div>
            <div class="item-cell" id="search_page">
              <a href="https://www.newegg.com/p/pl?d=portable+monitor" class="item-title">
                Portable monitor search results page
              </a>
            </div>
            <div class="item-cell" id="valid_alpha">
              <div class="item-container">
                <a href="http://[bad" class="item-img">
                  <img src="http://[bad" alt="Portable Monitor Alpha" />
                </a>
                <div class="item-info">
                  <a data-slot="hero" href="https://www.newegg.com/p/2NY-008V-00123" class="item-title" title="Portable Monitor Alpha with detachable stand"></a>
                  <a href="https://www.newegg.com/Alpha/BrandStore/ID-1" class="item-brand"><img title="AlphaDisplay" /></a>
                </div>
                <div class="promo-copy">USD 219.99 4.7 out of 5 17 reviews only 2 left</div>
              </div>
            </div>
            <div class="item-cell" id="noise_title">
              <a href="https://www.newegg.com/p/2NY-008V-00124" class="item-title">Quick View</a>
            </div>
            <div class="item-cell" id="valid_beta">
              <div class="item-container" data-brand="BetaDisplay">
                <a href="https://www.newegg.com/p/2NY-008V-00125" class="item-img">
                  <img src="https://c1.neweggimages.com/productimage/nb300/beta.jpg" alt="Portable Monitor Beta" />
                </a>
                <div class="item-info">
                  <a href="https://www.newegg.com/p/2NY-008V-00125" class="item-title" aria-label="Portable Monitor Beta with matte travel panel"></a>
                </div>
                <div class="promo-copy">$249.99 4.8 out of 5 28 reviews in stock</div>
              </div>
            </div>
            <div class="item-cell" id="beyond_limit">
              <a href="https://www.newegg.com/p/2NY-008V-00126" class="item-title">This third valid card should be excluded by the limit gate.</a>
            </div>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "portable monitor", limit: 2 }, context);

    expect(records).toHaveLength(2);
    expect(records?.map((record) => record.url)).toEqual([
      "https://www.newegg.com/p/2NY-008V-00123",
      "https://www.newegg.com/p/2NY-008V-00125"
    ]);
    expect(records?.[0]).toMatchObject({
      title: "Portable Monitor Alpha with detachable stand"
    });
    expect(records?.[0]?.attributes.brand).toBe("AlphaDisplay");
    expect(records?.[0]?.attributes.image_urls).toEqual(["http://[bad"]);
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 219.99,
        currency: "USD"
      },
      availability: "limited",
      rating: 4.7,
      reviews_count: 17
    });
    expect(records?.[1]?.title).toBe("Portable Monitor Beta with matte travel panel");
  });

  it("skips price-only anchors and unwraps tracking redirects on amazon-style search pages", async () => {
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <a href="https://www.amazon.com/MNN-Portable-15-6inch-Ultra-Slim-Speakers/dp/B0B9NNWXVP/ref=sr_1_1">
              MNN Portable Monitor 15.6inch FHD 1080P USB C HDMI Gaming Ultra-Slim IPS Display
            </a>
            <a href="https://www.amazon.com/MNN-Portable-15-6inch-Ultra-Slim-Speakers/dp/B0B9NNWXVP/ref=sr_1_1">
              CAD 68.63 CAD 68 . 63 List: CAD 123.54
            </a>
            <a href="https://aax-us-east-retail-direct.amazon.com/x/c/token/https://www.amazon.com/MNN-Portable-15-6inch-Ultra-Slim-Speakers/dp/B0B9NNWXVP/ref=sxin_18_sbv_search_btf">
              Portable Monitor 16&quot; 1200P FHD Laptop Screen Extender with Detachable Kickstand
            </a>
            <div>CAD 68.63 4.4 out of 5 123 reviews in stock</div>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "portable monitor", limit: 5 }, context);
    expect(records).toHaveLength(1);
    expect(records?.[0]?.url).toBe("https://www.amazon.com/MNN-Portable-15-6inch-Ultra-Slim-Speakers/dp/B0B9NNWXVP/ref=sr_1_1");
    expect(records?.[0]?.title).not.toMatch(/^CAD\b/);
    expect(records?.[0]?.title).not.toContain("aax-us-east");
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 68.63,
        currency: "CAD"
      },
      rating: 4.4,
      reviews_count: 123,
      availability: "in_stock"
    });
  });

  it("skips blank generic hrefs, uses unquoted aria labels, and preserves raw invalid generic card images", async () => {
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <a href="" title="Blank href should be ignored"></a>
            <div>USD 159.99 available now with fold-flat stand and cable routing.</div>
            <a data-slot="card" href="https://amazon.com/item-generic-1" aria-label=Portable-monitor-generic-card-with-built-in-kickstand-and-usb-c-power-pass-through>
              <img src="http://[oops" />
            </a>
            <div>Only 1 left in stock for this portable setup.</div>
            <a href="https://amazon.com/item-generic-2">Portable monitor generic backup card that should be skipped by the result limit.</a>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "portable monitor", limit: 1 }, context);

    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      url: "https://amazon.com/item-generic-1",
      title: "Portable-monitor-generic-card-with-built-in-kickstand-and-usb-c-power-pass-through"
    });
    expect(records?.[0]?.attributes.image_urls).toEqual(["http://[oops"]);
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 159.99,
        currency: "USD"
      },
      availability: "limited",
      rating: 0,
      reviews_count: 0
    });
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

  it("falls back to zero for non-finite code-based prices on generic search cards", async () => {
    const giantNumber = `9${",999".repeat(120)}`;
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div>USD ${giantNumber} available now</div>
            <a href="https://amazon.com/item-code-overflow">
              Portable monitor with a sufficiently descriptive title for overflow testing
            </a>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "portable monitor", limit: 2 }, context);
    const offer = records?.[0]?.attributes.shopping_offer as {
      price: { amount: number; currency: string };
    };

    expect(offer.price).toMatchObject({
      amount: 0,
      currency: "USD"
    });
  });

  it("covers newegg class-order edge cases, blank href skips, and price-only dedupe penalties", async () => {
    const provider = createShoppingProviderById("shopping/newegg", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div class="item-cell" id="price_only_duplicate">
              <a href="https://www.newegg.com/p/2NY-008V-00999">Ignored anchor without the required class token.</a>
              <a href="" class="item-title">Empty href should be skipped.</a>
              <a class="item-title" title="USD 299.99" href="https://www.newegg.com/p/2NY-008V-00999"></a>
              <div class="promo-copy">$299.99 4.1 out of 5 3 reviews in stock</div>
            </div>
            <div class="item-cell" id="richer_duplicate">
              <div class="item-container" data-brand="OmegaDisplay">
                <a href="https://www.newegg.com/p/2NY-008V-00999" class="item-title">Portable Monitor Omega with calibrated travel panel and folding stand</a>
                <div class="promo-copy">$249.99 4.8 out of 5 31 reviews in stock</div>
              </div>
            </div>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "portable monitor", limit: 5 }, context);

    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      url: "https://www.newegg.com/p/2NY-008V-00999",
      title: "Portable Monitor Omega with calibrated travel panel and folding stand"
    });
    expect(records?.[0]?.attributes.brand).toBe("OmegaDisplay");
  });

  it("prefers the priced duplicate when a later href-only card overflows to zero price", async () => {
    const giantNumber = `9${",999".repeat(120)}`;
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div>USD 199.99 4.7 out of 5 51 reviews in stock</div>
            <a href="https://amazon.com/item-duplicate-overflow">Portable workstation monitor with detachable stand and calibrated panel for travel desks</a>
            <div>USD ${giantNumber} 4.6 out of 5 89 reviews in stock</div>
            <a href="https://amazon.com/item-duplicate-overflow">Portable workstation monitor with detachable stand and calibrated panel for travel desks</a>
          </body></html>
        `
      })
    });

    const records = await provider.search?.({ query: "portable monitor", limit: 5 }, context);
    const offer = records?.[0]?.attributes.shopping_offer as {
      price: { amount: number; currency: string };
      rating: number;
      reviews_count: number;
    };

    expect(records).toHaveLength(1);
    expect(records?.[0]?.url).toBe("https://amazon.com/item-duplicate-overflow");
    expect(offer).toMatchObject({
      price: {
        amount: 199.99,
        currency: "USD"
      },
      rating: 4.7,
      reviews_count: 51
    });
  });

  it("extracts generic result cards from aria-label anchors with unquoted hrefs and forwards availability metadata", async () => {
    const provider = createShoppingProvider(profile, {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <a href=https://amazon.com/product/wireless-mouse-pro aria-label="Wireless Mouse Pro with sculpted shell and quiet clicks for compact travel desks">
              <img src="https://cdn.amazon.com/wireless-mouse-pro.jpg" alt="Wireless Mouse Pro" />
            </a>
            <div>CAD 89.50 4.4 out of 5 45 reviews only 3 left</div>
          </body></html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless mouse", limit: 1 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      url: "https://amazon.com/product/wireless-mouse-pro",
      title: "Wireless Mouse Pro with sculpted shell and quiet clicks for compact travel desks"
    });
    expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
      availability: "limited",
      price: {
        amount: 89.5,
        currency: "CAD"
      },
      rating: 4.4,
      reviews_count: 45
    });
    expect(rows?.[0]?.attributes.image_urls).toEqual(["https://cdn.amazon.com/wireless-mouse-pro.jpg"]);
  });

  it("unwraps tracking destinations from encoded params and nested redirect urls while filtering noise", async () => {
    const provider = createShoppingProviderById("shopping/others", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <a href="https://html.duckduckgo.com/l/?uddg=https://shop.example.com/product/wireless-mouse-pro">
              Wireless Mouse Pro with sculpted travel shell and whisper-quiet wheel for hybrid desks
            </a>
            <div>USD 49.99 4.8 out of 5 87 reviews only 2 left</div>
            <div>${"filler ".repeat(400)}</div>
            <a href="https://redirect.example/path:https://shop.example.com/product/travel-mouse-shell">
              Travel Mouse Shell with compact side grips and low-noise clicks for daily commuting
            </a>
            <div>USD 39.99 4.7 out of 5 51 reviews in stock</div>
            <a href="https://redirect.example/track?uddg=%25E0%25A4%25Ahttps://shop.example.com/product/bad-parse">
              Broken wrapper title that should be ignored after malformed decoding
            </a>
            <a href="https://redirect.example/track?url=https://shop.example.com/search?q=wireless+mouse">
              Search results page title that should be filtered as noise and never appear in rows
            </a>
          </body></html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless mouse", limit: 5 }, context);

    expect(rows).toHaveLength(2);
    expect(rows?.map((row) => row.url).sort()).toEqual([
      "https://shop.example.com/product/travel-mouse-shell",
      "https://shop.example.com/product/wireless-mouse-pro"
    ]);
    const travel = rows?.find((row) => row.url === "https://shop.example.com/product/travel-mouse-shell");
    const wireless = rows?.find((row) => row.url === "https://shop.example.com/product/wireless-mouse-pro");
    expect(travel?.attributes.shopping_offer).toMatchObject({
      availability: "in_stock"
    });
    expect(wireless?.attributes.shopping_offer).toMatchObject({
      availability: "limited"
    });
  });

  it("keeps original wrappers when tracking destinations decode to blanks", async () => {
    const provider = createShoppingProviderById("shopping/others", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <div>USD 49.99 4.4 out of 5 18 reviews only 2 left</div>
            <a href="https://redirect.example/product/wireless-shell?uddg=%20%20">
              Wireless shell product with compact grip panels and silent click switches
            </a>
          </body></html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless shell", limit: 5 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.url).toBe("https://redirect.example/product/wireless-shell?uddg=++");
  });

  it("unwraps double-encoded uddg destinations before extracting generic result cards", async () => {
    const provider = createShoppingProviderById("shopping/others", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <a href="https://html.duckduckgo.com/l/?uddg=https%253A%252F%252Fshop.example.com%252Fproduct%252Fwireless-mouse-pro">
              Wireless Mouse Pro with compact grip shell and whisper-quiet scroll wheel for hybrid desks
            </a>
            <div>USD 49.99 4.8 out of 5 87 reviews only 2 left</div>
          </body></html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless mouse", limit: 5 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      url: "https://shop.example.com/product/wireless-mouse-pro",
      title: "Wireless Mouse Pro with compact grip shell and whisper-quiet scroll wheel for hybrid desks"
    });
  });

  it("extracts title-only generic cards from href-first anchors and normalizes missing availability to unknown", async () => {
    const provider = createShoppingProviderById("shopping/others", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html><body>
            <a href="https://shop.example.com/product/wireless-shell" title="Wireless Shell Mouse with compact grip panels and silent click switches"></a>
            <div>USD 49.99 4.4 out of 5 18 reviews</div>
          </body></html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless shell", limit: 5 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      url: "https://shop.example.com/product/wireless-shell",
      title: "Wireless Shell Mouse with compact grip panels and silent click switches"
    });
    expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 49.99,
        currency: "USD"
      },
      availability: "unknown",
      rating: 4.4,
      reviews_count: 18
    });
  });

  it("surfaces Best Buy international shells with both title and message details", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <head><title>Best Buy International: Select your Country</title></head>
          <body>Choose a country for shopping and pickup options.</body>
        </html>
      `
    })) as unknown as typeof fetch);
    const provider = createShoppingProviderById("shopping/bestbuy");

    await expect(provider.search?.({ query: "wireless mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "env_limited",
      details: {
        providerShell: "bestbuy_international_gate",
        title: "Best Buy International: Select your Country",
        message: expect.stringContaining("Choose a country")
      }
    });
  });

  it("surfaces Target shell pages with the resolved title when classic shell markers are present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <head><title>"wireless mouse" : Target</title></head>
          <body>skip to main content skip to footer weekly ad registry target circle</body>
        </html>
      `
    })) as unknown as typeof fetch);
    const provider = createShoppingProviderById("shopping/target");

    await expect(provider.search?.({ query: "wireless mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "env_limited",
      details: {
        constraint: {
          kind: "render_required",
          evidenceCode: "target_shell_page"
        },
        providerShell: "target_shell_page",
        title: "\"wireless mouse\" : Target",
        message: expect.stringContaining("skip to main content")
      }
    });
  });

  it("flags Temu challenge shells even when the response omits a title", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html><body>
          <script src="https://static.kwcdn.com/upload-static/assets/chl/js/runtime.js"></script>
        </body></html>
      `
    })) as unknown as typeof fetch);
    const provider = createShoppingProviderById("shopping/temu");

    await expect(provider.search?.({ query: "wireless mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "challenge_detected",
      details: {
        blockerType: "anti_bot_challenge",
        reasonCode: "challenge_detected",
        providerShell: "temu_challenge_shell"
      }
    });
  });

  it("flags Temu challenge shells when the response also carries a title", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <head><title>Temu verification</title></head>
          <body>
            <script src="https://static.kwcdn.com/upload-static/assets/chl/js/runtime.js"></script>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);
    const provider = createShoppingProviderById("shopping/temu");

    await expect(provider.search?.({ query: "wireless mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "challenge_detected",
      details: {
        blockerType: "anti_bot_challenge",
        reasonCode: "challenge_detected",
        title: "Temu verification"
      }
    });
  });

  it("flags Temu empty shells even when the response omits a title", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => "<html><body>   </body></html>"
    })) as unknown as typeof fetch);
    const provider = createShoppingProviderById("shopping/temu");

    await expect(provider.search?.({ query: "wireless mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "env_limited",
      details: {
        constraint: {
          kind: "render_required",
          evidenceCode: "temu_empty_shell"
        },
        providerShell: "temu_empty_shell"
      }
    });
  });

  it("surfaces Target next-shell pages with the resolved title when product-grid markers are present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <head><title>"wireless mouse" : Target</title></head>
          <body>
            <script>window.__TGT_DATA__ = {"slots":{"1200":{"metadata":{"components":[{"placement_id":"WEB-search-product-grid-default"}]}}}}</script>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);
    const provider = createShoppingProviderById("shopping/target");

    await expect(provider.search?.({ query: "wireless mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "env_limited",
      details: {
        constraint: {
          kind: "render_required",
          evidenceCode: "target_shell_page"
        },
        providerShell: "target_shell_page",
        title: "\"wireless mouse\" : Target",
        message: "\"wireless mouse\" : Target"
      }
    });
  });

  it("does not treat Target product-grid pages as shells when a real /p/ product link is present", async () => {
    const provider = createShoppingProviderById("shopping/target", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html>
            <head><title>"wireless mouse" : Target</title></head>
            <body>
              <script>window.__TGT_DATA__ = {"slots":{"1200":{"metadata":{"components":[{"placement_id":"WEB-search-product-grid-default"}]}}}}</script>
              <a href="https://www.target.com/p/logitech-signature-m650-wireless-mouse/-/A-89123456">
                Logitech Signature wireless mouse with sculpted support and silent wheel
              </a>
              <div>USD 39.99 4.7 out of 5 205 reviews in stock</div>
            </body>
          </html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless mouse", limit: 1 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      url: "https://www.target.com/p/logitech-signature-m650-wireless-mouse/-/A-89123456",
      title: "Logitech Signature wireless mouse with sculpted support and silent wheel"
    });
    expect(rows?.[0]?.attributes.retrievalPath).toBe("shopping:search:result-card");
    expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 39.99,
        currency: "USD"
      },
      availability: "in_stock",
      rating: 4.7,
      reviews_count: 205
    });
  });

  it("normalizes Target product-grid rows to unknown availability when the card has no stock signal", async () => {
    const provider = createShoppingProviderById("shopping/target", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html>
            <head><title>"wireless mouse" : Target</title></head>
            <body>
              <script>window.__TGT_DATA__ = {"slots":{"1200":{"metadata":{"components":[{"placement_id":"WEB-search-product-grid-default"}]}}}}</script>
              <a href="https://www.target.com/p/logitech-signature-m650-wireless-mouse/-/A-89123456">
                Logitech Signature wireless mouse with sculpted support and silent wheel
              </a>
              <div>USD 39.99 4.7 out of 5 205 reviews</div>
            </body>
          </html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless mouse", limit: 1 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
      price: {
        amount: 39.99,
        currency: "USD"
      },
      availability: "unknown",
      rating: 4.7,
      reviews_count: 205
    });
  });

  it("does not misclassify Temu pages as challenge shells when kwcdn assets are present without challenge markers", async () => {
    const provider = createShoppingProviderById("shopping/temu", {
      fetcher: async ({ url }) => ({
        status: 200,
        url,
        html: `
          <html>
            <head>
              <title>Temu wireless mouse deals</title>
              <script src="https://static.kwcdn.com/upload-static/assets/js/runtime.js"></script>
            </head>
            <body>
              <a href="https://www.temu.com/g-601099522700389.html">
                Ergonomic mouse with travel sleeve, magnetic shell, and silent office clicks
              </a>
              <div>USD 18.99 4.5 out of 5 88 reviews in stock</div>
            </body>
          </html>
        `
      })
    });

    const rows = await provider.search?.({ query: "wireless mouse", limit: 1 }, context);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      url: "https://www.temu.com/g-601099522700389.html",
      title: "Ergonomic mouse with travel sleeve, magnetic shell, and silent office clicks"
    });
    expect(rows?.[0]?.attributes.shopping_offer).toMatchObject({
      availability: "in_stock",
      price: {
        amount: 18.99,
        currency: "USD"
      },
      rating: 4.5,
      reviews_count: 88
    });
  });

  it("flags obfuscated Temu challenge shells even without kwcdn asset markers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => ({
      status: 200,
      url: String(input),
      text: async () => `
        <html>
          <head><title>Temu verification</title></head>
          <body>
            challenge
            <script>function _0xa1b2(){return "gate";}</script>
          </body>
        </html>
      `
    })) as unknown as typeof fetch);
    const provider = createShoppingProviderById("shopping/temu");

    await expect(provider.search?.({ query: "wireless mouse" }, context)).rejects.toMatchObject({
      code: "unavailable",
      reasonCode: "challenge_detected",
      details: {
        blockerType: "anti_bot_challenge",
        reasonCode: "challenge_detected",
        title: "Temu verification"
      }
    });
  });

});
