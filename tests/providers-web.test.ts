import { describe, expect, it, vi } from "vitest";
import { createDefaultRuntime } from "../src/providers";
import { canonicalizeUrl, crawlWeb } from "../src/providers/web/crawler";
import { createWebProvider } from "../src/providers/web";
import {
  extractLinks,
  extractMetadata,
  extractSelectors,
  extractStructuredContent,
  extractText,
  toSnippet
} from "../src/providers/web/extract";
import { evaluateWebCrawlPolicy } from "../src/providers/web/policy";

const pages: Record<string, string> = {
  "https://example.com": `
    <html>
      <body>
        <h1>Home</h1>
        <a href="/a?utm_source=test#top">A</a>
        <a href="/b">B</a>
      </body>
    </html>
  `,
  "https://example.com/a": `
    <html>
      <body>
        <article id="main">Article A</article>
        <a href="https://example.com/b">B again</a>
      </body>
    </html>
  `,
  "https://example.com/b": `
    <html>
      <body>
        <p class="text">Article B</p>
      </body>
    </html>
  `
};

const fetcher = async (url: string) => {
  const html = pages[url];
  if (!html) {
    throw new Error("not found");
  }
  return { status: 200, html };
};

const context = (requestId: string) => ({
  trace: { requestId, ts: new Date().toISOString() },
  timeoutMs: 50,
  attempt: 1 as const
});

describe("web provider + crawler", () => {
  it("uses real retrieval defaults in createDefaultRuntime web path", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      return {
        status: 200,
        url,
        text: async () => `<html><body><main>web content ${url}</main><a href="https://example.com/b">B</a></body></html>`
      };
    }) as unknown as typeof fetch);

    try {
      const runtime = createDefaultRuntime();
      const result = await runtime.search(
        { query: "open dev browser", limit: 3 },
        { source: "web", providerIds: ["web/default"] }
      );

      expect(result.ok).toBe(true);
      expect(result.records.length).toBeGreaterThan(0);
      expect(result.failures).toHaveLength(0);
      expect(result.records[0]?.provider).toBe("web/default");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("covers adaptive crawl pipeline overrides and invalid numeric filter coercion", async () => {
    const overridePages: Record<string, string> = {
      "https://override.example": `
        <html><body>
          <a href="https://override.example/a">A</a>
        </body></html>
      `,
      "https://override.example/a": "<html><body><p>A</p></body></html>"
    };
    const overrideFetcher = async (url: string) => {
      const normalized = url.endsWith("/") ? url.slice(0, -1) : url;
      const html = overridePages[normalized];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const provider = createWebProvider({
      fetcher: overrideFetcher,
      queueMax: 8
    });

    const withOverrides = await provider.crawl?.({
      seedUrls: ["https://override.example"],
      filters: {
        fetchConcurrency: 3,
        frontierMax: 4
      }
    }, context("crawl-overrides"));
    expect(withOverrides).toBeDefined();

    const withInvalidOverrides = await provider.crawl?.({
      seedUrls: ["https://override.example"],
      filters: {
        fetchConcurrency: Number.POSITIVE_INFINITY,
        frontierMax: 0
      }
    }, context("crawl-invalid-overrides"));
    expect(withInvalidOverrides).toBeDefined();
  });

  it("carries explicit robots metadata and worker-thread crawl settings", async () => {
    const provider = createWebProvider({
      fetcher: async (url) => ({
        status: 200,
        url,
        html: "<html><body><a href=\"https://worker.example/next\">next</a></body></html>"
      }),
      policy: {
        allowCrossHost: false,
        robotsMode: "strict"
      },
      workerThreads: 2
    });

    expect(provider.capabilities().metadata).toMatchObject({
      crawler: true,
      robotsMode: "strict"
    });

    const crawled = await provider.crawl?.({
      seedUrls: ["https://worker.example"]
    }, context("crawl-worker-threads"));
    expect(crawled).toBeDefined();
  });

  it("covers fallback search URL validation and extraction-quality defaults", async () => {
    const fallbackProvider = createWebProvider({ fetcher });
    expect(fallbackProvider.capabilities().metadata).toMatchObject({
      crawler: true,
      robotsMode: "warn"
    });
    await expect(fallbackProvider.search?.({ query: "keyword" }, context("search-url-required")))
      .rejects.toMatchObject({ code: "invalid_input" });

    const indexedProvider = createWebProvider({
      searchIndex: async () => [{
        url: "https://example.com/indexed",
        title: "indexed result"
      }]
    });
    const records = await indexedProvider.search?.({ query: "indexed" }, context("search-indexed"));
    expect(records).toHaveLength(1);
    expect(records?.[0]?.attributes.extractionQuality).toMatchObject({
      hasContent: false,
      contentChars: 0,
      linkCount: 0
    });
  });

  it("hydrates URL fallback search results with structured metadata branches", async () => {
    const html = `
      <html>
        <head>
          <title>Travel Monitor Pro 14</title>
          <meta property="og:description" content="A bright travel monitor with dual USB-C inputs and a folding cover." />
          <meta property="og:site_name" content="DeskCo" />
          <meta property="og:image" content="https://shop.example/assets/travel-monitor-pro-14.png" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Travel Monitor Pro 14",
              "brand": { "@type": "Brand", "name": "DeskCo" },
              "image": ["https://shop.example/assets/travel-monitor-pro-14.png"],
              "offers": {
                "@type": "Offer",
                "price": 249,
                "priceCurrency": "USD"
              }
            }
          </script>
        </head>
        <body>
          <div class="feature">Dual USB-C inputs for one-cable laptop setups.</div>
          <div class="feature">Protective folding cover with adjustable stand.</div>
        </body>
      </html>
    `;

    const provider = createWebProvider({
      fetcher: async (url) => ({
        status: 200,
        url,
        html
      })
    });

    const records = await provider.search?.({
      query: "https://shop.example/products/travel-monitor-pro-14"
    }, context("search-url-structured"));

    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      url: "https://shop.example/products/travel-monitor-pro-14",
      title: "Travel Monitor Pro 14",
      content: "A bright travel monitor with dual USB-C inputs and a folding cover."
    });
    expect(records?.[0]?.attributes).toMatchObject({
      description: "A bright travel monitor with dual USB-C inputs and a folding cover.",
      brand: "DeskCo",
      image_urls: ["https://shop.example/assets/travel-monitor-pro-14.png"],
      features: [
        "Dual USB-C inputs for one-cable laptop setups.",
        "Protective folding cover with adjustable stand."
      ],
      shopping_offer: {
        provider: "web/default",
        metadata_source: "jsonld:price",
        price: {
          amount: 249,
          currency: "USD"
        }
      }
    });
  });

  it("canonicalizes URLs for dedupe", () => {
    expect(canonicalizeUrl("https://EXAMPLE.com/a/?utm_source=ad&b=2&a=1#hash"))
      .toBe("https://example.com/a?a=1&b=2");
    expect(canonicalizeUrl("https://example.com:443/path/"))
      .toBe("https://example.com/path");
    expect(canonicalizeUrl("  :::not-a-url:::  "))
      .toBe(":::not-a-url:::");
  });

  it("canonicalizes root urls and strips default http ports", () => {
    expect(canonicalizeUrl("HTTP://Example.com:80/?utm_source=ad&keep=1#hash"))
      .toBe("http://example.com?keep=1");
    expect(canonicalizeUrl("https://EXAMPLE.com/#top"))
      .toBe("https://example.com");
  });

  it("extracts text, links, and selectors", () => {
    const html = `
      <html><body>
        <h1>Heading</h1>
        <a href="/next">Next</a>
        <div id="hero">Hero text</div>
        <p class="lead">Lead text</p>
      </body></html>
    `;

    expect(extractText(html)).toContain("Heading");
    expect(extractLinks(html, "https://example.com")).toEqual(["https://example.com/next"]);
    expect(extractSelectors(html, ["#hero", ".lead", "h1"])).toEqual({
      "#hero": ["Hero text"],
      ".lead": ["Lead text"],
      h1: ["Heading"]
    });
  });

  it("handles empty href/selectors and snippet boundaries", () => {
    const html = `
      <html><body>
        <a href="   ">Blank</a>
        <a href="/ok">OK</a>
        <div class="empty"></div>
      </body></html>
    `;

    expect(extractLinks(html, "https://example.com")).toEqual(["https://example.com/ok"]);
    expect(extractSelectors(html, [".empty"])).toEqual({
      ".empty": []
    });
    expect(toSnippet("abcdef", 5)).toBe("abcd…");
    expect(toSnippet("abc", 5)).toBe("abc");
  });

  it("extracts structured product metadata for product detail pages", async () => {
    const appleHtml = `
      <html>
        <head>
          <title>Buy iPhone 16 and iPhone 16 Plus - Apple</title>
          <meta property="og:title" content="Buy iPhone 16 and iPhone 16 Plus" />
          <meta property="og:description" content="Get $35 - $685 off a new iPhone 16 or iPhone 16 Plus when you trade in an iPhone 8 or newer. 0% financing available. Buy now with free shipping." />
          <meta property="og:site_name" content="Apple" />
          <meta property="og:image" content="https://store.storeimages.cdn-apple.com/iphone-16.jpg" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "iPhone 16",
              "url": "https://www.apple.com/shop/buy-iphone/iphone-16",
              "brand": { "@type": "Brand", "name": "Apple" },
              "offers": [
                {
                  "@type": "AggregateOffer",
                  "lowPrice": 699.00,
                  "highPrice": 729.00,
                  "priceCurrency": "USD"
                }
              ],
              "image": "https://store.storeimages.cdn-apple.com/iphone-16.jpg"
            }
          </script>
        </head>
        <body>
          <div class="dd-feature"><p>Apple Intelligence</p></div>
          <div class="dd-feature"><p>Camera Control for faster access to photo and video tools</p></div>
        </body>
      </html>
    `;

    const provider = createWebProvider({
      fetcher: async () => ({
        status: 200,
        html: appleHtml
      })
    });

    const records = await provider.fetch?.({
      url: "https://www.apple.com/shop/buy-iphone/iphone-16"
    });

    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      title: "Buy iPhone 16 and iPhone 16 Plus",
      content: "Get $35 - $685 off a new iPhone 16 or iPhone 16 Plus when you trade in an iPhone 8 or newer. 0% financing available. Buy now with free shipping."
    });
    expect(records?.[0]?.attributes.brand).toBe("Apple");
    expect(records?.[0]?.attributes.image_urls).toEqual([
      "https://store.storeimages.cdn-apple.com/iphone-16.jpg"
    ]);
    expect(records?.[0]?.attributes.features).toEqual([
      "Apple Intelligence",
      "Camera Control for faster access to photo and video tools"
    ]);
    expect(records?.[0]?.attributes.shopping_offer).toMatchObject({
      title: "Buy iPhone 16 and iPhone 16 Plus",
      price: {
        amount: 699,
        currency: "USD"
      }
    });
  });

  it("extractMetadata flattens JSON-LD arrays and @graph nodes with exact-price and mixed image shapes", () => {
    const metadata = extractMetadata(`
      <html>
        <head>
          <script type="application/ld+json">
            [
              {
                "@context": "https://schema.org",
                "@type": ["Product", "Thing"],
                "name": "Graph Phone",
                "description": "Primary device description",
                "brand": { "@type": "Brand", "name": "Graph Brand" },
                "image": ["https://cdn.example.com/graph-phone.png"],
                "offers": {
                  "@type": "Offer",
                  "price": "1,299.50",
                  "priceCurrency": "CAD"
                }
              },
              {
                "@graph": [
                  {
                    "@type": "Product",
                    "image": { "url": "/gallery/graph-phone-alt.png" }
                  },
                  {
                    "@type": ["AggregateOffer"],
                    "lowPrice": "1299.50",
                    "priceCurrency": "CAD"
                  }
                ]
              }
            ]
          </script>
        </head>
      </html>
    `, "https://shop.example/products/graph-phone");

    expect(metadata).toMatchObject({
      title: "Graph Phone",
      description: "Primary device description",
      brand: "Graph Brand",
      price: {
        amount: 1299.5,
        currency: "CAD",
        source: "jsonld:price"
      }
    });
    expect(metadata.imageUrls).toEqual([
      "https://cdn.example.com/graph-phone.png",
      "https://shop.example/gallery/graph-phone-alt.png"
    ]);
  });

  it("extractMetadata skips empty or malformed JSON-LD and falls back through title, unquoted meta attrs, site-name brand, and recursive priceSpecification", () => {
    const metadata = extractMetadata(`
      <html>
        <head>
          <title>Fallback Product</title>
          <meta name=description content=Fallback&#32;desc>
          <meta name=application-name content=FallbackApp>
          <script type="application/ld+json">   </script>
          <script type="application/ld+json">{ "bad": </script>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "offers": {
                "@type": "Offer",
                "priceSpecification": {
                  "lowPrice": "88.40",
                  "priceCurrency": "EUR"
                }
              }
            }
          </script>
        </head>
      </html>
    `, "https://shop.example/fallback-product");

    expect(metadata).toEqual({
      title: "Fallback Product",
      description: "Fallback desc",
      brand: "FallbackApp",
      siteName: "FallbackApp",
      imageUrls: [],
      features: [],
      price: {
        amount: 88.4,
        currency: "EUR",
        source: "jsonld:lowPrice"
      }
    });
  });

  it("extractMetadata handles record image urls, offer arrays, and blank product fields without leaking empty metadata", () => {
    const metadata = extractMetadata(`
      <html>
        <head>
          <script type="application/ld+json">
            [
              {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "   ",
                "description": "   ",
                "brand": { "name": "   " },
                "image": { "url": "/images/device.png" },
                "offers": [
                  "bad-offer",
                  {
                    "@type": "Offer",
                    "price": "77.50",
                    "priceCurrency": "GBP"
                  }
                ]
              },
              {
                "@type": "Offer",
                "price": "not-a-number",
                "priceCurrency": "USD",
                "priceSpecification": {
                  "price": "0",
                  "priceCurrency": "USD"
                }
              }
            ]
          </script>
        </head>
      </html>
    `, "https://shop.example/products/device");

    expect(metadata).toEqual({
      imageUrls: ["https://shop.example/images/device.png"],
      features: [],
      price: {
        amount: 77.5,
        currency: "GBP",
        source: "jsonld:price"
      }
    });
  });

  it("preserves non-finite numeric entities and ignores record image entries without a usable url", () => {
    const hugeHexEntity = `&#x${"f".repeat(400)};`;
    const hugeDecEntity = `&#${"9".repeat(400)};`;

    expect(extractText(`<p>${hugeHexEntity} ${hugeDecEntity}</p>`)).toBe(`${hugeHexEntity} ${hugeDecEntity}`);

    const metadata = extractMetadata(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Entity Safe Device",
              "image": { "url": "   ", "caption": "ignored" },
              "offers": {
                "@type": "Offer",
                "price": "99.95",
                "priceCurrency": "USD"
              }
            }
          </script>
        </head>
      </html>
    `, "https://shop.example/products/entity-safe-device");

    expect(metadata).toEqual({
      title: "Entity Safe Device",
      imageUrls: [],
      features: [],
      price: {
        amount: 99.95,
        currency: "USD",
        source: "jsonld:price"
      }
    });
  });

  it("returns no price when offer arrays contain only invalid entries", () => {
    const metadata = extractMetadata(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Offerless Device",
              "offers": [
                "bad-offer",
                {
                  "@type": "Offer",
                  "price": "not-a-number",
                  "priceCurrency": "USD"
                }
              ]
            }
          </script>
        </head>
      </html>
    `, "https://shop.example/products/offerless-device");

    expect(metadata).toEqual({
      title: "Offerless Device",
      imageUrls: [],
      features: []
    });
  });

  it("extractStructuredContent decodes entities and rejects, dedupes, and caps feature candidates", () => {
    const structured = extractStructuredContent(`
      <html>
        <body>
          <p>Encoded &amp; text &#169; &#x2603; &bogus;</p>
          <div class="feature-card">Feature zero remains readable and useful for daily workflows.</div>
          <div class="feature-card">Quick View</div>
          <div class="feature-card">Feature zero remains readable and useful for daily workflows.</div>
          <ul>
            <li>Feature 01 keeps layout stable across responsive breakpoints.</li>
            <li>Feature 02 provides keyboard-friendly actions for every important control.</li>
            <li>Feature 03 synchronizes data without hidden loading flashes.</li>
            <li>Feature 04 supports collaborative review with durable annotations.</li>
            <li>Feature 05 preserves visual hierarchy during empty and loading states.</li>
            <li>Feature 06 keeps motion subtle while still explaining interface changes.</li>
            <li>Feature 07 makes pricing details legible in dense comparison tables.</li>
            <li>Feature 08 avoids jarring jumps when results stream into view.</li>
            <li>Feature 09 keeps calls to action obvious even in long documents.</li>
            <li>Feature 10 highlights important constraints before a user commits work.</li>
            <li>Feature 11 keeps export surfaces aligned with the live preview.</li>
            <li>Feature 12 clarifies ownership boundaries for stateful interactions.</li>
            <li>Feature 13 should be dropped because the feature cap is twelve.</li>
            <li>Free Shipping</li>
            <li>Will this work?</li>
            <li>$19.99</li>
          </ul>
        </body>
      </html>
    `, "https://shop.example/feature-page");

    expect(structured.text).toContain("Encoded & text © ☃ &bogus;");
    expect(structured.metadata.features).toHaveLength(12);
    expect(structured.metadata.features).toContain("Feature zero remains readable and useful for daily workflows.");
    expect(structured.metadata.features).toContain("Feature 11 keeps export surfaces aligned with the live preview.");
    expect(structured.metadata.features).not.toContain("Feature 13 should be dropped because the feature cap is twelve.");
    expect(structured.metadata.features).not.toContain("Quick View");
    expect(structured.metadata.features.filter((entry) =>
      entry === "Feature zero remains readable and useful for daily workflows."
    )).toHaveLength(1);
  });

  it("extractStructuredContent stops at the feature-block cap before falling through to list items", () => {
    const featureBlocks = Array.from({ length: 13 }, (_, index) => `
      <div class="feature-highlight">Feature ${String(index + 1).padStart(2, "0")} keeps product workflows deterministic and reviewable.</div>
    `).join("\n");

    const structured = extractStructuredContent(`
      <html>
        <body>
          ${featureBlocks}
          <ul>
            <li>Learn more</li>
            <li>$19 off should never become a feature bullet.</li>
            <li>Feature list item that should never be reached because block parsing already hit the cap.</li>
          </ul>
        </body>
      </html>
    `, "https://shop.example/feature-cap");

    expect(structured.metadata.features).toHaveLength(12);
    expect(structured.metadata.features[0]).toBe("Feature 01 keeps product workflows deterministic and reviewable.");
    expect(structured.metadata.features[11]).toBe("Feature 12 keeps product workflows deterministic and reviewable.");
    expect(structured.metadata.features).not.toContain(
      "Feature list item that should never be reached because block parsing already hit the cap."
    );
  });

  it("extractStructuredContent rejects question, price, and short features while keeping valid list fallbacks", () => {
    const structured = extractStructuredContent(`
      <html>
        <body>
          <div class="feature-highlight">Short</div>
          <div class="feature-highlight">Can I use this internationally?</div>
          <div class="feature-highlight">$19 monthly plan required.</div>
          <ul>
            <li>Learn more</li>
            <li>Battery lasts 18 hours through review and capture sessions.</li>
            <li>12345</li>
          </ul>
        </body>
      </html>
    `, "https://shop.example/feature-reject");

    expect(structured.metadata.features).toEqual([
      "Battery lasts 18 hours through review and capture sessions."
    ]);
  });

  it("ignores malformed metadata primitives and invalid meta images", () => {
    const metadata = extractMetadata(`
      <html>
        <head>
          <meta property="og:image">
          <meta property="twitter:image" content="javascript:alert('xss')">
          <meta name=description>
          <script type="application/ld+json">
            [
              null,
              {
                "@context": "https://schema.org",
                "@type": [],
                "name": "   ",
                "description": "   ",
                "brand": { "name": "   " },
                "image": { "url": "   " },
                "offers": [
                  "bad-offer",
                  {
                    "@type": "Offer",
                    "price": "not-a-number",
                    "priceCurrency": "USD",
                    "priceSpecification": "invalid"
                  }
                ]
              }
            ]
          </script>
        </head>
      </html>
    `, "https://shop.example/weird");

    expect(metadata).toEqual({
      imageUrls: [],
      features: []
    });
  });

  it("extractMetadata handles direct offer nodes, invalid record image urls, and fallback low prices", () => {
    const metadata = extractMetadata(`
      <html>
        <head>
          <script type="application/ld+json">
            [
              {
                "@type": "Offer",
                "price": "bad-number",
                "priceCurrency": "USD",
                "priceSpecification": {
                  "lowPrice": "19.25",
                  "priceCurrency": "USD"
                }
              },
              {
                "@type": "Product",
                "image": { "url": "javascript:alert('xss')" }
              }
            ]
          </script>
        </head>
      </html>
    `, "https://shop.example/products/direct-offer");

    expect(metadata).toEqual({
      imageUrls: [],
      features: [],
      price: {
        amount: 19.25,
        currency: "USD",
        source: "jsonld:lowPrice"
      }
    });
  });

  it("extractMetadata collects image candidates from img and srcset surfaces when metadata images are absent", () => {
    const metadata = extractMetadata(`
      <html>
        <body>
          <img src="/assets/logo.svg" />
          <img data-src="https://cdn.example.com/products/device-primary" />
          <source srcset="https://cdn.example.com/products/device-primary 1x, https://cdn.example.com/products/device-primary@2x 2x" />
          <img src="https://cdn.example.com/tracking-pixel.png?pixel=1" />
        </body>
      </html>
    `, "https://shop.example/products/device");

    expect(metadata).toEqual({
      imageUrls: [
        "https://cdn.example.com/products/device-primary",
        "https://cdn.example.com/products/device-primary@2x"
      ],
      features: []
    });
  });

  it("extractMetadata accepts lazy image attributes and rejects icon-like data-srcset entries", () => {
    const metadata = extractMetadata(`
      <html>
        <body>
          <img data-lazy-src="/assets/device-lazy.webp" />
          <source data-srcset="https://cdn.example.com/assets/favicon.ico 1x, /assets/device-alt.webp 2x" />
        </body>
      </html>
    `, "https://shop.example/products/device");

    expect(metadata).toEqual({
      imageUrls: [
        "https://shop.example/assets/device-lazy.webp",
        "https://shop.example/assets/device-alt.webp"
      ],
      features: []
    });
  });

  it("extractStructuredContent caps list-derived features at twelve when no feature blocks exist", () => {
    const listItems = Array.from({ length: 13 }, (_, index) => `
      <li>Feature ${String(index + 1).padStart(2, "0")} keeps product decisions auditable and easy to compare.</li>
    `).join("\n");

    const structured = extractStructuredContent(`
      <html>
        <body>
          <ul>
            ${listItems}
          </ul>
        </body>
      </html>
    `, "https://shop.example/list-feature-cap");

    expect(structured.metadata.features).toHaveLength(12);
    expect(structured.metadata.features[0]).toBe(
      "Feature 01 keeps product decisions auditable and easy to compare."
    );
    expect(structured.metadata.features[11]).toBe(
      "Feature 12 keeps product decisions auditable and easy to compare."
    );
    expect(structured.metadata.features).not.toContain(
      "Feature 13 keeps product decisions auditable and easy to compare."
    );
  });

  it("ignores selector matches that do not expose capture groups", () => {
    const htmlLike = {
      matchAll: (_pattern: RegExp) => [[undefined, undefined]]
    };

    expect(extractSelectors(htmlLike as unknown as string, ["section"])).toEqual({
      section: []
    });
  });

  it("enforces crawl budgets with dedupe + policy", async () => {
    const result = await crawlWeb({
      fetcher,
      strategy: "bfs",
      seeds: ["https://example.com"],
      budget: { maxDepth: 1, maxPages: 2, maxPerDomain: 2 },
      policy: { robotsMode: "warn", robotsBlockedDomains: ["example.com"] }
    });

    expect(result.pages).toHaveLength(2);
    expect(result.metrics.visited).toBe(2);
    expect(result.metrics.deduped).toBeGreaterThanOrEqual(0);
    expect(result.metrics.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.p95LatencyMs).toBeGreaterThanOrEqual(result.metrics.p50LatencyMs);
    expect(result.warnings.some((warning) =>
      warning.includes("per-domain")
      || warning.includes("fetch failed")
      || warning.includes("robots policy")
    )).toBe(true);
  });

  it("supports dfs strategy, default budgets, and duplicate-seed dedupe", async () => {
    const dfsPages: Record<string, string> = {
      "https://dfs.example": `
        <html><body>
          <a href="https://dfs.example/left">Left</a>
          <a href="https://dfs.example/right">Right</a>
        </body></html>
      `,
      "https://dfs.example/left": "<html><body><p>Left</p></body></html>",
      "https://dfs.example/right": "<html><body><p>Right</p></body></html>"
    };

    const dfsFetcher = async (url: string) => {
      const html = dfsPages[url];
      if (!html) throw new Error("not found");
      return { html };
    };

    const result = await crawlWeb({
      fetcher: dfsFetcher,
      strategy: "dfs",
      seeds: ["https://dfs.example", "https://dfs.example"]
    });

    expect(result.pages[0]?.status).toBe(200);
    expect(result.pages.map((page) => page.url)).toContain("https://dfs.example");
    expect(result.metrics.deduped).toBeGreaterThan(0);
  });

  it("supports strict robots policy + normalized provider outputs", async () => {
    const strict = evaluateWebCrawlPolicy("https://example.com", {
      robotsMode: "strict",
      robotsBlockedDomains: ["example.com"]
    });
    expect(strict.allowed).toBe(false);

    const provider = createWebProvider({
      fetcher,
      policy: { robotsMode: "off" },
      searchIndex: async (input) => [{
        url: "https://example.com/a",
        title: `Result ${input.query}`,
        content: "indexed"
      }]
    });

    const search = await provider.search?.({ query: "abc" }, {
      trace: { requestId: "r1", ts: new Date().toISOString() },
      timeoutMs: 50,
      attempt: 1
    });
    expect(search).toHaveLength(1);
    expect(search?.[0]?.provider).toBe("web/default");

    const fetched = await provider.fetch?.({ url: "https://example.com/a" }, {
      trace: { requestId: "r2", ts: new Date().toISOString() },
      timeoutMs: 50,
      attempt: 1
    });
    expect(fetched?.[0]?.attributes.status).toBe(200);

    const crawled = await provider.crawl?.({ seedUrls: ["https://example.com"], maxPages: 2 }, {
      trace: { requestId: "r3", ts: new Date().toISOString() },
      timeoutMs: 50,
      attempt: 1
    });
    expect(crawled?.length).toBe(2);

    const caps = provider.capabilities();
    expect(caps.operations.crawl.supported).toBe(true);
    expect(caps.operations.post.supported).toBe(false);
  });

  it("covers web crawl policy mapping branches", () => {
    expect(evaluateWebCrawlPolicy("not-a-url")).toMatchObject({
      allowed: false,
      reason: "Invalid URL"
    });

    expect(evaluateWebCrawlPolicy("https://blocked.example", {
      denyDomains: ["blocked.example"]
    })).toMatchObject({
      allowed: false,
      reason: "Domain denied by policy"
    });

    expect(evaluateWebCrawlPolicy("https://outside.example", {
      allowDomains: ["allowed.example"]
    })).toMatchObject({
      allowed: false,
      reason: "Domain not in allow list"
    });

    expect(evaluateWebCrawlPolicy("https://robots.example", {
      robotsMode: "off",
      robotsBlockedDomains: ["robots.example"]
    })).toEqual({
      allowed: true,
      warnings: []
    });
  });

  it("handles unavailable web operations and degraded health without fetcher", async () => {
    const provider = createWebProvider();
    await expect(provider.search?.({ query: "https://example.com/a" }, context("nf-search")))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.fetch?.({ url: "https://example.com/a" }, context("nf-fetch")))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.crawl?.({ seedUrls: ["https://example.com/a"] }, context("nf-crawl")))
      .rejects.toMatchObject({ code: "unavailable" });

    const health = await provider.health?.({
      trace: { requestId: "nf-health", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(health).toMatchObject({
      status: "degraded",
      reason: "Fetcher not configured"
    });

    const withFetcher = createWebProvider({ fetcher });
    await expect(withFetcher.crawl?.({ seedUrls: [] }, context("empty-seeds")))
      .rejects.toMatchObject({ code: "invalid_input" });
  });

  it("covers provider search/fetch/crawl fallback paths", async () => {
    const noFetcherProvider = createWebProvider();
    await expect(noFetcherProvider.search?.({ query: "https://example.com/a" }, context("no-fetcher-search")))
      .rejects.toMatchObject({ code: "unavailable" });

    const noStatusFetcher = async (url: string) => {
      const html = pages[url];
      if (!html) throw new Error("not found");
      return { html };
    };

    const provider = createWebProvider({
      fetcher: noStatusFetcher,
      defaultBudget: { maxPages: 1 }
    });

    const fetched = await provider.fetch?.({ url: "https://example.com/a" }, context("no-status-fetch"));
    expect(fetched?.[0]?.attributes.status).toBe(200);

    const crawled = await provider.crawl?.({ seedUrls: ["https://example.com"] }, context("default-budget-crawl"));
    expect(crawled).toHaveLength(1);
  });

  it("validates search input and supports fallback search via fetcher", async () => {
    const provider = createWebProvider({ fetcher });

    await expect(provider.search?.({ query: "   " }, context("search-invalid")))
      .rejects.toMatchObject({ code: "invalid_input" });

    const records = await provider.search?.({ query: "https://example.com/a" }, context("search-fetcher"));
    expect(records).toHaveLength(1);
    expect(records?.[0]?.attributes.status).toBe(200);
    expect(typeof records?.[0]?.content).toBe("string");

    const health = await provider.health?.({
      trace: { requestId: "search-health", ts: new Date().toISOString() },
      timeoutMs: 50
    });
    expect(health?.status).toBe("healthy");
  });

  it("filters invalid links and blocks denied links while crawling", async () => {
    const edgePages: Record<string, string> = {
      "https://edge.example": `
        <html><body>
          <a href="http://">broken</a>
          <a href="mailto:test@example.com">mail</a>
          <a href="https://blocked.example/private">blocked</a>
          <a href="https://edge.example/next">next</a>
        </body></html>
      `,
      "https://edge.example/next": "<html><body><p>Next</p></body></html>"
    };

    const edgeFetcher = async (url: string) => {
      const html = edgePages[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const result = await crawlWeb({
      fetcher: edgeFetcher,
      seeds: ["https://edge.example"],
      budget: { maxDepth: 1, maxPages: 3, maxPerDomain: 3 },
      policy: { denyDomains: ["blocked.example"] }
    });

    expect(result.pages[0]?.links).toContain("https://edge.example/next");
    expect(result.pages[0]?.links.some((link) => link.startsWith("mailto:"))).toBe(false);
    expect(result.warnings.some((warning) =>
      warning.includes("blocked.example")
      && warning.includes("Domain denied by policy")
    )).toBe(true);
  });

  it("records per-domain budget and fetch-failure warnings", async () => {
    const seedPages: Record<string, string> = {
      "https://same.example/one": "<html><body><a href=\"https://same.example/two\">Two</a></body></html>",
      "https://same.example/two": "<html><body><p>Two</p></body></html>"
    };

    const flakyFetcher = async (url: string) => {
      const html = seedPages[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const result = await crawlWeb({
      fetcher: flakyFetcher,
      seeds: ["https://same.example/one", "https://same.example/two", "https://missing.example/start"],
      budget: { maxDepth: 0, maxPages: 5, maxPerDomain: 1 }
    });

    expect(result.warnings.some((warning) => warning.includes("per-domain budget exceeded"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("fetch failed"))).toBe(true);
  });

  it("keeps latency percentiles at zero when policy blocks all seeds", async () => {
    let fetchCalled = false;

    const result = await crawlWeb({
      fetcher: async () => {
        fetchCalled = true;
        return { html: "<html></html>" };
      },
      seeds: ["https://blocked-seed.example"],
      policy: { denyDomains: ["blocked-seed.example"] }
    });

    expect(fetchCalled).toBe(false);
    expect(result.pages).toHaveLength(0);
    expect(result.metrics.p50LatencyMs).toBe(0);
    expect(result.metrics.p95LatencyMs).toBe(0);
  });

  it("produces deterministic crawl order with worker and non-worker pipelines", async () => {
    const deterministicPages: Record<string, string> = {
      "https://det.example/root": `
        <html><body>
          <a href="https://det.example/a">A</a>
          <a href="https://det.example/b">B</a>
        </body></html>
      `,
      "https://det.example/a": `
        <html><body>
          <a href="https://det.example/c">C</a>
          <p>A</p>
        </body></html>
      `,
      "https://det.example/b": "<html><body><p>B</p></body></html>",
      "https://det.example/c": "<html><body><p>C</p></body></html>"
    };

    const deterministicFetcher = async (url: string) => {
      const html = deterministicPages[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const withWorkersA = await crawlWeb({
      fetcher: deterministicFetcher,
      seeds: ["https://det.example/root"],
      pipeline: { workerThreads: 2, fetchConcurrency: 3, queueMax: 16, frontierMax: 16 }
    });
    const withWorkersB = await crawlWeb({
      fetcher: deterministicFetcher,
      seeds: ["https://det.example/root"],
      pipeline: { workerThreads: 2, fetchConcurrency: 3, queueMax: 16, frontierMax: 16 }
    });
    const noWorkers = await crawlWeb({
      fetcher: deterministicFetcher,
      seeds: ["https://det.example/root"],
      pipeline: { workerThreads: 0, fetchConcurrency: 3, queueMax: 16, frontierMax: 16 }
    });

    const workerOrderA = withWorkersA.pages.map((page) => page.url);
    const workerOrderB = withWorkersB.pages.map((page) => page.url);
    const noWorkerOrder = noWorkers.pages.map((page) => page.url);

    expect(workerOrderA).toEqual(workerOrderB);
    expect(workerOrderA).toEqual(noWorkerOrder);
  });

  it("falls back when worker queue is saturated and keeps crawl results", async () => {
    const saturatedPages: Record<string, string> = {
      "https://queue.example/root": `
        <html><body>
          <a href="https://queue.example/a">A</a>
          <a href="https://queue.example/b">B</a>
        </body></html>
      `,
      "https://queue.example/a": "<html><body><p>A</p></body></html>",
      "https://queue.example/b": "<html><body><p>B</p></body></html>"
    };

    const queueFetcher = async (url: string) => {
      const html = saturatedPages[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const result = await crawlWeb({
      fetcher: queueFetcher,
      seeds: ["https://queue.example/root"],
      pipeline: { workerThreads: 1, fetchConcurrency: 3, queueMax: 1, frontierMax: 8 }
    });

    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes("worker queue saturated"))).toBe(true);
  });

  it("warns when crawl frontier reaches the configured saturation limit", async () => {
    const pagesWithFanout: Record<string, string> = {
      "https://fanout.example/root": `
        <html><body>
          <a href="https://fanout.example/a">A</a>
          <a href="https://fanout.example/b">B</a>
          <a href="https://fanout.example/c">C</a>
        </body></html>
      `
    };

    const fetchFanout = async (url: string) => {
      const html = pagesWithFanout[url];
      if (!html) throw new Error("not found");
      return { status: 200, html };
    };

    const result = await crawlWeb({
      fetcher: fetchFanout,
      seeds: ["https://fanout.example/root"],
      budget: { maxDepth: 2, maxPages: 4, maxPerDomain: 10 },
      pipeline: { frontierMax: 0, fetchConcurrency: 1, workerThreads: 0, queueMax: 4 }
    });

    expect(result.pages).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes("crawl frontier saturated"))).toBe(true);
  });
});
