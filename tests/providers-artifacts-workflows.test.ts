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
