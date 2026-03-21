import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredArtifacts, createArtifactBundle } from "../src/providers/artifacts";
import {
  workflowTestUtils,
  runProductVideoWorkflow,
  runResearchWorkflow,
  runShoppingWorkflow,
  type ProviderExecutor
} from "../src/providers/workflows";
import type { ProviderAggregateResult } from "../src/providers/types";

const makeAggregate = (overrides: Partial<ProviderAggregateResult> = {}): ProviderAggregateResult => ({
  ok: true,
  records: [],
  trace: { requestId: "req-1", ts: "2026-02-16T00:00:00.000Z" },
  partial: false,
  failures: [],
  metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
  sourceSelection: "web",
  providerOrder: ["web/default"],
  ...overrides
});

const toRuntime = (handlers: {
  search: ProviderExecutor["search"];
  fetch: ProviderExecutor["fetch"];
}): ProviderExecutor => ({
  search: handlers.search,
  fetch: handlers.fetch
});

describe("artifact and workflow runtime", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.doUnmock("fs/promises");
    vi.resetModules();
    workflowTestUtils.resetProviderSignalState();
    await Promise.all(createdDirs.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }));
    createdDirs.length = 0;
  });

  it("writes artifact bundles and cleans expired runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-artifacts-"));
    createdDirs.push(root);

    const expired = await createArtifactBundle({
      namespace: "research",
      outputDir: root,
      ttlHours: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
      files: [{ path: "summary.md", content: "summary" }]
    });

    const active = await createArtifactBundle({
      namespace: "research",
      outputDir: root,
      ttlHours: 24,
      now: new Date("2026-02-16T00:00:00.000Z"),
      files: [{ path: "summary.md", content: "summary" }]
    });

    expect(await stat(join(expired.basePath, "bundle-manifest.json"))).toBeDefined();
    const cleaned = await cleanupExpiredArtifacts(root, new Date("2026-02-16T12:00:00.000Z"));
    expect(cleaned.removed.some((entry) => entry.includes(expired.runId))).toBe(true);
    expect(cleaned.skipped.some((entry) => entry.includes(active.runId))).toBe(true);
  });

  it("skips invalid manifest layouts and non-expiring manifests safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-artifacts-layout-"));
    createdDirs.push(root);

    const namespaceDir = join(root, "research");
    const missingManifestRun = join(namespaceDir, "missing-manifest");
    const manifestAsDirectoryRun = join(namespaceDir, "manifest-as-directory");
    const invalidExpiryRun = join(namespaceDir, "invalid-expiry");

    await mkdir(missingManifestRun, { recursive: true });
    await mkdir(join(manifestAsDirectoryRun, "bundle-manifest.json"), { recursive: true });
    await mkdir(invalidExpiryRun, { recursive: true });
    await writeFile(join(invalidExpiryRun, "bundle-manifest.json"), JSON.stringify({
      run_id: "invalid-expiry",
      created_at: "2026-02-16T00:00:00.000Z",
      ttl_hours: 24,
      expires_at: "not-a-date",
      files: []
    }));

    const cleaned = await cleanupExpiredArtifacts(root, new Date("2026-02-20T00:00:00.000Z"));
    expect(cleaned.removed).toHaveLength(0);
    expect(cleaned.skipped).toContain(missingManifestRun);
    expect(cleaned.skipped).toContain(manifestAsDirectoryRun);
    expect(cleaned.skipped).toContain(invalidExpiryRun);
  });

  it("falls back to legacy manifest.json during artifact cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-artifacts-legacy-"));
    createdDirs.push(root);

    const legacy = await createArtifactBundle({
      namespace: "research",
      outputDir: root,
      ttlHours: 1,
      manifestFileName: "manifest.json",
      now: new Date("2026-02-01T00:00:00.000Z"),
      files: [{ path: "summary.md", content: "summary" }]
    });

    await expect(stat(join(legacy.basePath, "bundle-manifest.json"))).rejects.toThrow();
    expect(await readFile(join(legacy.basePath, "manifest.json"), "utf8")).toContain(`"run_id": "${legacy.runId}"`);

    const cleaned = await cleanupExpiredArtifacts(root, new Date("2026-02-16T12:00:00.000Z"));
    expect(cleaned.removed).toContain(legacy.basePath);
  });

  it("skips runs when a discovered manifest stops being a file before readback", async () => {
    const root = "/virtual-artifacts";
    const namespacePath = join(root, "research");
    const runPath = join(namespacePath, "run-1");
    const manifestPath = join(runPath, "bundle-manifest.json");
    let manifestStatCount = 0;
    vi.doMock("fs/promises", () => ({
      readdir: vi.fn(async (target: string) => {
        if (target === root) {
          return ["research"];
        }
        if (target === namespacePath) {
          return ["run-1"];
        }
        throw new Error(`unexpected path ${target}`);
      }),
      stat: vi.fn(async (target: string) => {
        if (target !== manifestPath) {
          throw new Error(`unexpected stat ${target}`);
        }
        manifestStatCount += 1;
        return {
          isFile: () => manifestStatCount === 1
        };
      }),
      readFile: vi.fn(async () => {
        throw new Error("read should not occur for non-file manifests");
      }),
      rm: vi.fn(async () => undefined),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined)
    }));

    const mockedFs = await import("fs/promises");
    const { cleanupExpiredArtifacts: cleanupWithMocks } = await import("../src/providers/artifacts");
    const cleaned = await cleanupWithMocks(root, new Date("2026-02-20T00:00:00.000Z"));

    expect(cleaned).toEqual({
      removed: [],
      skipped: [runPath]
    });
    expect(mockedFs.readFile).not.toHaveBeenCalled();
  });

  it("runs research workflow with strict source resolution and artifacts", async () => {
    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        const source = options?.source ?? "web";
        return makeAggregate({
          records: [
            {
              id: `${source}-inside`,
              source: source as "web" | "community" | "social" | "shopping",
              provider: `${source}/default`,
              url: `https://example.com/${source}/inside`,
              title: `${source} inside`,
              content: `${source} content`,
              timestamp: "2026-02-10T00:00:00.000Z",
              confidence: 0.8,
              attributes: {}
            },
            {
              id: `${source}-outside`,
              source: source as "web" | "community" | "social" | "shopping",
              provider: `${source}/default`,
              url: `https://example.com/${source}/outside`,
              title: `${source} outside`,
              content: `${source} content`,
              timestamp: "2025-01-01T00:00:00.000Z",
              confidence: 0.5,
              attributes: {}
            }
          ],
          sourceSelection: source as "web"
        });
      }),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "browser automation",
      days: 30,
      sourceSelection: "auto",
      mode: "compact"
    });

    expect(output).toMatchObject({
      mode: "compact",
      artifact_path: expect.any(String)
    });
    expect((output.records as Array<{ id: string }>).every((record) => record.id.includes("inside"))).toBe(true);

    const pathMode = await runResearchWorkflow(runtime, {
      topic: "browser automation",
      from: "2026-02-01T00:00:00.000Z",
      to: "2026-02-16T00:00:00.000Z",
      sourceSelection: "all",
      mode: "path"
    });

    expect(pathMode).toMatchObject({
      mode: "path",
      path: expect.any(String)
    });
  });

  it("runs shopping workflow, normalizes offers, and validates provider input", async () => {
    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/others";
        const price = providerId.includes("amazon") ? 25 : 15;
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [{
            id: providerId,
            source: "shopping",
            provider: providerId,
            url: `https://example.com/${providerId}`,
            title: `Offer ${providerId}`,
            content: `$${price}`,
            timestamp: "2026-02-16T00:00:00.000Z",
            confidence: 0.8,
            attributes: {
              shopping_offer: {
                provider: providerId,
                product_id: `${providerId}-product`,
                title: `Offer ${providerId}`,
                url: `https://example.com/${providerId}`,
                price: {
                  amount: price,
                  currency: "USD",
                  retrieved_at: "2026-02-16T00:00:00.000Z"
                },
                shipping: {
                  amount: 0,
                  currency: "USD",
                  notes: "free"
                },
                availability: "in_stock",
                rating: 4.6,
                reviews_count: 50
              }
            }
          }]
        });
      }),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "usb hub",
      providers: ["shopping/amazon", "shopping/others"],
      sort: "lowest_price",
      mode: "json"
    });

    const offers = output.offers as Array<{ provider: string; price: { amount: number } }>;
    expect(offers).toHaveLength(2);
    expect(offers[0]?.price.amount).toBeLessThanOrEqual(offers[1]?.price.amount);

    await expect(runShoppingWorkflow(runtime, {
      query: "usb hub",
      providers: ["invalid-provider"],
      mode: "json"
    })).rejects.toThrow("No valid shopping providers");
  });

  it("marks empty shopping provider runs as env-limited failures instead of silent success", async () => {
    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/walmart";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [{
            id: `${providerId}-index`,
            source: "shopping",
            provider: providerId,
            url: "https://www.walmart.com/search?q=portable+monitor",
            title: "Walmart search: portable monitor",
            content: "$10",
            timestamp: "2026-02-16T00:00:00.000Z",
            confidence: 0.4,
            attributes: {
              retrievalPath: "shopping:search:index",
              shopping_offer: {
                provider: providerId,
                product_id: "index-row",
                title: "Walmart search: portable monitor",
                url: "https://www.walmart.com/search?q=portable+monitor",
                price: { amount: 10, currency: "USD", retrieved_at: "2026-02-16T00:00:00.000Z" },
                shipping: { amount: 0, currency: "USD", notes: "unknown" },
                availability: "unknown",
                rating: 0,
                reviews_count: 0
              }
            }
          }]
        });
      }),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "portable monitor",
      providers: ["shopping/walmart"],
      mode: "json"
    });

    expect(output.offers).toEqual([]);
    expect((output.meta as {
      failures: Array<{ provider: string; error: { reasonCode?: string; details?: { noOfferRecords?: boolean } } }>;
      metrics: {
        failed_providers: string[];
        reason_code_distribution: Record<string, number>;
      };
    })).toMatchObject({
      failures: [{
        provider: "shopping/walmart",
        error: {
          reasonCode: "env_limited",
          details: {
            noOfferRecords: true
          }
        }
      }],
      metrics: {
        failed_providers: ["shopping/walmart"],
        reason_code_distribution: {
          env_limited: 1
        }
      }
    });
  });

  it("preserves auth-required blocker reasons when empty shopping runs are actually login pages", async () => {
    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/temu";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [{
            id: `${providerId}-login`,
            source: "shopping",
            provider: providerId,
            url: "https://www.temu.com/login.html?from=https%3A%2F%2Fwww.temu.com%2Fsearch_result.html",
            title: "Temu | Login",
            content: "Please log in to continue shopping.",
            timestamp: "2026-02-16T00:00:00.000Z",
            confidence: 0.6,
            attributes: {
              retrievalPath: "shopping:search:index"
            }
          }]
        });
      }),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "wireless mouse",
      providers: ["shopping/temu"],
      mode: "json"
    });

    expect((output.meta as {
      failures: Array<{ provider: string; error: { reasonCode?: string; details?: { blockerType?: string; title?: string } } }>;
      metrics: {
        reason_code_distribution: Record<string, number>;
      };
    })).toMatchObject({
      failures: [{
        provider: "shopping/temu",
        error: {
          reasonCode: "token_required",
          details: {
            blockerType: "auth_required",
            title: "Temu | Login"
          }
        }
      }],
      metrics: {
        reason_code_distribution: {
          token_required: 1
        }
      }
    });
  });

  it("filters search-index and asset rows out of shopping offers", async () => {
    const now = "2026-02-16T00:00:00.000Z";
    const runtime = toRuntime({
      search: vi.fn(async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [
          {
            id: "amazon-index",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/s?k=portable+monitor",
            title: "Amazon search: portable monitor",
            content: "$10",
            timestamp: now,
            confidence: 0.5,
            attributes: {
              retrievalPath: "shopping:search:index",
              shopping_offer: {
                provider: "shopping/amazon",
                product_id: "index",
                title: "Amazon search: portable monitor",
                url: "https://www.amazon.com/s?k=portable+monitor",
                price: { amount: 10, currency: "USD", retrieved_at: now },
                shipping: { amount: 0, currency: "USD", notes: "unknown" },
                availability: "limited",
                rating: 0,
                reviews_count: 0
              }
            }
          },
          {
            id: "amazon-asset",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://images-na.ssl-images-amazon.com/logo.png",
            title: "https://images-na.ssl-images-amazon.com/logo.png",
            content: "$10",
            timestamp: now,
            confidence: 0.4,
            attributes: {
              retrievalPath: "shopping:search:link",
              shopping_offer: {
                provider: "shopping/amazon",
                product_id: "asset",
                title: "https://images-na.ssl-images-amazon.com/logo.png",
                url: "https://images-na.ssl-images-amazon.com/logo.png",
                price: { amount: 10, currency: "USD", retrieved_at: now },
                shipping: { amount: 0, currency: "USD", notes: "unknown" },
                availability: "limited",
                rating: 0,
                reviews_count: 0
              }
            }
          },
          {
            id: "amazon-cdn-card",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://m.media-amazon.com/images/I/portable-monitor.jpg",
            title: "UPERFECT Portable Monitor 15.6 inch USB-C Travel Display",
            content: "$69.99",
            timestamp: now,
            confidence: 0.8,
            attributes: {
              retrievalPath: "shopping:search:result-card",
              shopping_offer: {
                provider: "shopping/amazon",
                product_id: "cdn-card",
                title: "UPERFECT Portable Monitor 15.6 inch USB-C Travel Display",
                url: "https://m.media-amazon.com/images/I/portable-monitor.jpg",
                price: { amount: 69.99, currency: "USD", retrieved_at: now },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4.8,
                reviews_count: 29
              }
            }
          },
          {
            id: "amazon-valid-card",
            source: "shopping",
            provider: "shopping/amazon",
            url: "https://www.amazon.com/dp/B0TEST1234",
            title: "UPERFECT Portable Monitor 15.6 inch USB-C Travel Display",
            content: "$69.99",
            timestamp: now,
            confidence: 0.9,
            attributes: {
              retrievalPath: "shopping:search:result-card",
              shopping_offer: {
                provider: "shopping/amazon",
                product_id: "valid-card",
                title: "UPERFECT Portable Monitor 15.6 inch USB-C Travel Display",
                url: "https://www.amazon.com/dp/B0TEST1234",
                price: { amount: 69.99, currency: "USD", retrieved_at: now },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4.8,
                reviews_count: 29
              }
            }
          }
        ]
      })),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "portable monitor",
      providers: ["shopping/amazon"],
      sort: "lowest_price",
      mode: "json"
    });

    expect(output.offers).toMatchObject([
      {
        provider: "shopping/amazon",
        url: "https://www.amazon.com/dp/B0TEST1234",
        title: "UPERFECT Portable Monitor 15.6 inch USB-C Travel Display"
      }
    ]);
  });

  it("blocks shopping workflows when legal review approval is expired", async () => {
    const search = vi.fn(async () => makeAggregate());
    const runtime = toRuntime({
      search,
      fetch: vi.fn(async () => makeAggregate())
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));

    await expect(runShoppingWorkflow(runtime, {
      query: "usb hub",
      mode: "json"
    })).rejects.toThrow("Provider legal review checklist invalid or expired");

    expect(search).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("builds product-video assets for URL and name flows", async () => {
    const runtime = toRuntime({
      search: vi.fn(async (input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/amazon";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [{
            id: "offer-1",
            source: "shopping",
            provider: providerId,
            url: "https://example.com/product/1",
            title: String(input.query),
            content: "$19.99",
            timestamp: "2026-02-16T00:00:00.000Z",
            confidence: 0.8,
            attributes: {
              shopping_offer: {
                provider: providerId,
                product_id: "p-1",
                title: "Sample Product",
                url: "https://example.com/product/1",
                price: { amount: 19.99, currency: "USD", retrieved_at: "2026-02-16T00:00:00.000Z" },
                shipping: { amount: 0, currency: "USD", notes: "free" },
                availability: "in_stock",
                rating: 4.5,
                reviews_count: 11
              }
            }
          }]
        });
      }),
      fetch: vi.fn(async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [{
          id: "product-1",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://example.com/product/1",
          title: "Sample Product",
          content: "Feature one. Feature two. Feature three.",
          timestamp: "2026-02-16T00:00:00.000Z",
          confidence: 0.9,
          attributes: {
            links: ["https://cdn.example.com/image-1.jpg"],
            headers: {
              authorization: "Bearer secret-token-123"
            },
            api_token: "sk_test_123",
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "p-1",
              title: "Sample Product",
              url: "https://example.com/product/1",
              price: { amount: 19.99, currency: "USD", retrieved_at: "2026-02-16T00:00:00.000Z" },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.5,
              reviews_count: 11
            }
          }
        }]
      }))
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })) as unknown as typeof fetch);

    const outputByUrl = await runProductVideoWorkflow(runtime, {
      product_url: "https://example.com/product/1",
      include_screenshots: true,
      include_all_images: true,
      include_copy: true
    }, {
      captureScreenshot: async () => Buffer.from([9, 8, 7])
    });

    expect(outputByUrl).toMatchObject({
      path: expect.any(String),
      manifest: {
        source_url: "https://example.com/product/1"
      }
    });

    const manifestRaw = await readFile(join(outputByUrl.path as string, "manifest.json"), "utf8");
    expect(JSON.parse(manifestRaw)).toMatchObject({
      source_url: "https://example.com/product/1"
    });

    const rawSourceRaw = await readFile(join(outputByUrl.path as string, "raw/source-record.json"), "utf8");
    const rawSource = JSON.parse(rawSourceRaw) as {
      attributes?: {
        headers?: { authorization?: string };
        api_token?: string;
      };
    };
    expect(rawSource.attributes?.headers?.authorization).toBe("[REDACTED]");
    expect(rawSource.attributes?.api_token).toBe("[REDACTED]");

    const outputByName = await runProductVideoWorkflow(runtime, {
      product_name: "sample product",
      provider_hint: "shopping/amazon",
      include_screenshots: false
    });

    expect(outputByName).toMatchObject({
      path: expect.any(String)
    });

    await expect(runProductVideoWorkflow(runtime, {})).rejects.toThrow("product_url or product_name is required");
  });
});
