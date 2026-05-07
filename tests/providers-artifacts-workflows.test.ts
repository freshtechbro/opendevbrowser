import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredArtifacts, createArtifactBundle, type ArtifactManifest } from "../src/providers/artifacts";
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

const RESEARCH_ARTIFACT_FILES = [
  "summary.md",
  "report.md",
  "records.json",
  "context.json",
  "meta.json",
  "bundle-manifest.json"
];

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

  const makeWorkspaceDir = async (prefix: string): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    createdDirs.push(directory);
    return directory;
  };

  const expectArtifactPath = (artifactPath: string, root: string, namespace: string): void => {
    expect(dirname(dirname(artifactPath))).toBe(root);
    expect(basename(dirname(artifactPath))).toBe(namespace);
    expect(basename(artifactPath)).toMatch(/^[0-9a-f-]{36}$/);
  };

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

  it("uses the temporary artifact root for direct bundles without outputDir", async () => {
    const bundle = await createArtifactBundle({
      namespace: "research",
      now: new Date("2026-02-16T00:00:00.000Z"),
      files: [{ path: "summary.md", content: "summary" }]
    });

    try {
      expectArtifactPath(bundle.basePath, join(tmpdir(), "opendevbrowser"), "research");
      expect(await stat(join(bundle.basePath, "bundle-manifest.json"))).toBeDefined();
    } finally {
      await rm(bundle.basePath, { recursive: true, force: true });
    }
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

  it("handles missing cleanup roots and corrupt artifact manifests safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-artifacts-corrupt-"));
    createdDirs.push(root);
    const corruptRun = join(root, "research", "corrupt-manifest");

    await writeFile(join(root, "not-a-namespace"), "artifact namespace placeholder");
    await mkdir(corruptRun, { recursive: true });
    await writeFile(join(corruptRun, "bundle-manifest.json"), "{not-json");

    await expect(cleanupExpiredArtifacts(join(root, "missing"), new Date("2026-02-20T00:00:00.000Z"))).resolves.toEqual({
      removed: [],
      skipped: []
    });
    await expect(cleanupExpiredArtifacts(root, new Date("2026-02-20T00:00:00.000Z"))).resolves.toEqual({
      removed: [],
      skipped: [corruptRun]
    });
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T00:00:00.000Z"));

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

  it("stores default research artifacts under the workspace research directory", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T00:00:00.000Z"));
    const workspaceDir = await makeWorkspaceDir("odb-research-workspace-");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);

    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        expect(options?.suspendedIntent).toMatchObject({
          kind: "workflow.research",
          input: {
            workflow: {
              kind: "research",
              input: { outputDir: join(workspaceDir, ".opendevbrowser") }
            }
          }
        });
        return makeAggregate({
        records: [{
          id: "research-record",
          source: "web",
          provider: "web/default",
          url: "https://example.com/research",
          title: "Research record",
          content: "A concrete research artifact record.",
          timestamp: "2026-02-10T00:00:00.000Z",
          confidence: 0.9,
          attributes: {}
        }]
        });
      }),
      fetch: vi.fn(async () => makeAggregate())
    });

    try {
      const output = await runResearchWorkflow(runtime, {
        topic: "artifact storage",
        days: 30,
        mode: "json"
      });

      const artifactPath = String(output.artifact_path);
      expectArtifactPath(artifactPath, join(workspaceDir, ".opendevbrowser"), "research");
      const manifest = JSON.parse(
        await readFile(join(artifactPath, "bundle-manifest.json"), "utf8")
      ) as ArtifactManifest;
      const report = await readFile(join(artifactPath, "report.md"), "utf8");
      expect(manifest.files).toEqual(RESEARCH_ARTIFACT_FILES);
      expect(report).toContain("# Research Report");
      expect(report).toContain("A concrete research artifact record.");
      expect(report).toContain("https://example.com/research");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("persists sanitized research output without shell records", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));
    const root = await mkdtemp(join(tmpdir(), "odb-research-sanitized-"));
    createdDirs.push(root);

    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        const source = options?.source ?? "web";
        if (source === "web") {
          return makeAggregate({
            sourceSelection: "web",
            providerOrder: ["web/default"],
            records: [{
              id: "duckduckgo-shell",
              source: "web",
              provider: "web/default",
              url: "https://html.duckduckgo.com/html",
              title: "https://html.duckduckgo.com/html",
              content: "coffee shop website design inspiration at DuckDuckGo",
              timestamp: "2026-03-10T00:00:00.000Z",
              confidence: 0.7,
              attributes: {
                retrievalPath: "web:search:index"
              }
            }]
          });
        }
        if (source === "community") {
          return makeAggregate({
            sourceSelection: "community",
            providerOrder: ["community/default"],
            records: [{
              id: "reddit-login-shell",
              source: "community",
              provider: "community/default",
              url: "https://www.reddit.com/login",
              title: "https://www.reddit.com/login",
              content: "Welcome to Reddit. Log in to continue.",
              timestamp: "2026-02-10T00:00:00.000Z",
              confidence: 0.6,
              attributes: {
                retrievalPath: "community:fetch:url"
              }
            }]
          });
        }
        return makeAggregate({
          sourceSelection: "social",
          providerOrder: ["social/default"],
          records: [
            {
              id: "reddit-generic-shell",
              source: "social",
              provider: "social/default",
              url: "https://www.reddit.com/answers/example?q=coffee+shop+website+design+inspiration",
              title: "https://www.reddit.com/answers/example?q=coffee+shop+website+design+inspiration",
              content: "Reddit - The heart of the internet. Please wait for verification. Skip to main content.",
              timestamp: "2026-03-10T00:00:00.000Z",
              confidence: 0.6,
              attributes: {
                retrievalPath: "social:fetch:url"
              }
            },
            {
              id: "clean-inspiration-record",
              source: "social",
              provider: "social/default",
              url: "https://studio.example.com/inspiration/coffee-shop",
              title: "Coffee shop website design inspiration",
              content: "A warm editorial coffee shop website with strong typography and photography.",
              timestamp: "2026-03-10T00:00:00.000Z",
              confidence: 0.95,
              attributes: {
                retrievalPath: "social:post:url"
              }
            }
          ]
        });
      }),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "coffee shop website design inspiration",
      days: 30,
      sourceSelection: "auto",
      mode: "json",
      outputDir: root
    });

    expect((output.records as Array<{ id: string }>).map((record) => record.id)).toEqual(["clean-inspiration-record"]);
    expect((output.meta as {
      metrics: {
        sanitized_records: number;
        sanitized_reason_distribution: Record<string, number>;
      };
    }).metrics).toMatchObject({
      sanitized_records: 3,
      sanitized_reason_distribution: {
        search_index_shell: 1,
        login_shell: 1,
        search_results_shell: 1
      }
    });

    const artifactPath = output.artifact_path as string;
    const recordsPayload = JSON.parse(await readFile(join(artifactPath, "records.json"), "utf8")) as {
      records: Array<{ id: string }>;
    };
    const metaPayload = JSON.parse(await readFile(join(artifactPath, "meta.json"), "utf8")) as {
      metrics: {
        sanitized_records: number;
      };
    };
    expect(recordsPayload.records.map((record) => record.id)).toEqual(["clean-inspiration-record"]);
    expect(metaPayload.metrics.sanitized_records).toBe(3);
    const report = await readFile(join(artifactPath, "report.md"), "utf8");
    expect(report).toContain("Coffee shop website design inspiration");
    expect(report).toContain("login_shell: 1");
  });

  it("reports provider-limited research runs when usable records survive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));
    const root = await mkdtemp(join(tmpdir(), "odb-research-provider-limited-"));
    createdDirs.push(root);

    const runtime = toRuntime({
      search: vi.fn(async () => makeAggregate({
        ok: false,
        partial: true,
        sourceSelection: "web",
        providerOrder: ["web/default"],
        metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 5 },
        records: [{
          id: "provider-limited-survivor",
          source: "web",
          provider: "web/default",
          url: "https://research.example.com/provider-limited",
          title: "Provider-limited survivor",
          content: "A usable finding survived despite provider limitations.",
          timestamp: "2026-03-10T00:00:00.000Z",
          confidence: 0.88,
          attributes: {}
        }],
        failures: [{
          provider: "web/default",
          source: "web",
          error: {
            code: "unavailable",
            message: "Live source returned a login shell",
            retryable: false,
            reasonCode: "env_limited"
          }
        }]
      })),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "provider-limited research",
      days: 30,
      sourceSelection: "web",
      mode: "json",
      outputDir: root
    });

    const artifactPath = String(output.artifact_path);
    const manifest = JSON.parse(
      await readFile(join(artifactPath, "bundle-manifest.json"), "utf8")
    ) as ArtifactManifest;
    const report = await readFile(join(artifactPath, "report.md"), "utf8");
    expect(manifest.files).toEqual(RESEARCH_ARTIFACT_FILES);
    expect(report).toContain("Provider-limited survivor");
    expect(report).toContain("A usable finding survived despite provider limitations.");
    expect(report).toContain("Live source returned a login shell");
    expect(report).toContain("env_limited");
  });

  it("persists fetched web research pages after search-index shells are sanitized", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));
    const root = await mkdtemp(join(tmpdir(), "odb-research-web-fetch-"));
    createdDirs.push(root);

    const fetch = vi.fn(async (input) => {
      if (input.url === "https://design.example.com/inspiration") {
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [{
            id: "fetched-design-page",
            source: "web",
            provider: "web/default",
            url: "https://design.example.com/inspiration",
            title: "Coffee shop inspiration",
            content: "A warm editorial coffee shop website with strong typography and photography.",
            timestamp: "2026-03-10T00:00:00.000Z",
            confidence: 0.95,
            attributes: {
              retrievalPath: "web:fetch:url"
            }
          }]
        });
      }
      if (input.url === "https://dribbble.com/tags/coffee-shop-website") {
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [{
            id: "fetched-js-shell",
            source: "web",
            provider: "web/default",
            url: "https://dribbble.com/tags/coffee-shop-website",
            title: "https://dribbble.com/tags/coffee-shop-website",
            content: "JavaScript is disabled. In order to continue, we need to verify that you're not a robot.",
            timestamp: "2026-03-10T00:00:00.000Z",
            confidence: 0.5,
            attributes: {}
          }]
        });
      }
      return makeAggregate();
    });
    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        const source = options?.source ?? "web";
        if (source !== "web") {
          return makeAggregate({
            sourceSelection: source as "web",
            providerOrder: [`${source}/default`],
            records: []
          });
        }
        return makeAggregate({
          sourceSelection: "web",
          providerOrder: ["web/default"],
          records: [{
            id: "duckduckgo-shell-link",
            source: "web",
            provider: "web/default",
            url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fdesign.example.com%2Finspiration",
            title: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fdesign.example.com%2Finspiration",
            content: "coffee shop website design inspiration at DuckDuckGo",
            timestamp: "2026-03-10T00:00:00.000Z",
            confidence: 0.7,
            attributes: {
              retrievalPath: "web:search:index"
            }
          }, {
            id: "duckduckgo-js-shell-link",
            source: "web",
            provider: "web/default",
            url: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fdribbble.com%2Ftags%2Fcoffee-shop-website",
            title: "https://duckduckgo.com/l?uddg=https%3A%2F%2Fdribbble.com%2Ftags%2Fcoffee-shop-website",
            content: "coffee shop website design inspiration at DuckDuckGo",
            timestamp: "2026-03-10T00:00:00.000Z",
            confidence: 0.65,
            attributes: {
              retrievalPath: "web:search:index"
            }
          }]
        });
      }),
      fetch
    });

    const output = await runResearchWorkflow(runtime, {
      topic: "coffee shop website design inspiration",
      days: 30,
      sourceSelection: "auto",
      mode: "json",
      outputDir: root
    });

    expect(fetch).toHaveBeenCalledWith({
      url: "https://design.example.com/inspiration"
    }, expect.objectContaining({
      source: "web"
    }));
    expect((output.records as Array<{ id: string }>).map((record) => record.id)).toEqual(["fetched-design-page"]);

    const artifactPath = output.artifact_path as string;
    const recordsPayload = JSON.parse(await readFile(join(artifactPath, "records.json"), "utf8")) as {
      records: Array<{ id: string }>;
    };
    const metaPayload = JSON.parse(await readFile(join(artifactPath, "meta.json"), "utf8")) as {
      metrics: {
        sanitized_records: number;
        final_records: number;
      };
    };
    expect(recordsPayload.records.map((record) => record.id)).toEqual(["fetched-design-page"]);
    expect(metaPayload.metrics).toMatchObject({
      sanitized_records: 3,
      final_records: 1
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

  it("stores default shopping artifacts under the workspace shopping directory", async () => {
    const workspaceDir = await makeWorkspaceDir("odb-shopping-workspace-");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);

    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        expect(options?.suspendedIntent).toMatchObject({
          kind: "workflow.shopping",
          input: {
            workflow: {
              kind: "shopping",
              input: { outputDir: join(workspaceDir, ".opendevbrowser") }
            }
          }
        });
        const providerId = options?.providerIds?.[0] ?? "shopping/amazon";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [{
            id: "shopping-offer",
            source: "shopping",
            provider: providerId,
            url: "https://example.com/shopping-offer",
            title: "Shopping offer",
            content: "$25",
            timestamp: "2026-02-16T00:00:00.000Z",
            confidence: 0.9,
            attributes: {
              shopping_offer: {
                provider: providerId,
                product_id: "shopping-offer",
                title: "Shopping offer",
                url: "https://example.com/shopping-offer",
                price: {
                  amount: 25,
                  currency: "USD",
                  retrieved_at: "2026-02-16T00:00:00.000Z"
                },
                availability: "in_stock"
              }
            }
          }]
        });
      }),
      fetch: vi.fn(async () => makeAggregate())
    });

    try {
      const output = await runShoppingWorkflow(runtime, {
        query: "artifact storage",
        providers: ["shopping/amazon"],
        mode: "json"
      });

      expectArtifactPath(String(output.artifact_path), join(workspaceDir, ".opendevbrowser"), "shopping");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("rejects blank workflow artifact roots", async () => {
    const search = vi.fn(async () => makeAggregate());
    const fetch = vi.fn(async () => makeAggregate());
    const runtime = toRuntime({
      search,
      fetch
    });

    await expect(runResearchWorkflow(runtime, {
      topic: "artifact storage",
      mode: "json",
      outputDir: ""
    })).rejects.toThrow("outputDir cannot be empty");
    await expect(runShoppingWorkflow(runtime, {
      query: "artifact storage",
      mode: "json",
      outputDir: ""
    })).rejects.toThrow("outputDir cannot be empty");
    await expect(runResearchWorkflow(runtime, {
      topic: "artifact storage",
      mode: "json",
      outputDir: "   "
    })).rejects.toThrow("outputDir cannot be empty");
    await expect(runShoppingWorkflow(runtime, {
      query: "artifact storage",
      mode: "json",
      outputDir: "   "
    })).rejects.toThrow("outputDir cannot be empty");
    await expect(runProductVideoWorkflow(runtime, {
      product_url: "https://example.com/product",
      output_dir: "   "
    })).rejects.toThrow("outputDir cannot be empty");
    expect(search).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses direct caller relative workflow artifact roots from the current process directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-relative-root-"));
    createdDirs.push(root);
    const previousCwd = process.cwd();
    process.chdir(root);
    const runtime = toRuntime({
      search: vi.fn(async () => makeAggregate({
        records: [{
          id: "research-record",
          source: "web",
          provider: "web/search",
          url: "https://example.com/research",
          title: "Research artifact",
          content: "Artifact content",
          timestamp: new Date().toISOString(),
          confidence: 0.9,
          attributes: {}
        }]
      })),
      fetch: vi.fn(async () => makeAggregate())
    });

    try {
      const output = await runResearchWorkflow(runtime, {
        topic: "artifact storage",
        mode: "json",
        outputDir: "direct-artifacts"
      });

      const artifactPath = String(output.artifact_path);
      expectArtifactPath(artifactPath, await realpath(join(root, "direct-artifacts")), "research");
      expect(await stat(join(artifactPath, "bundle-manifest.json"))).toBeDefined();
    } finally {
      process.chdir(previousCwd);
    }
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
        reasonCodeDistribution: Record<string, number>;
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
        reasonCodeDistribution: {
          env_limited: 1
        }
      }
    });
    expect((output.meta as { metrics: Record<string, unknown> }).metrics).not.toHaveProperty("reason_code_distribution");
  });

  it("summarizes shopping challenge orchestration from successful browser-assisted records", async () => {
    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/target";
        return makeAggregate({
          sourceSelection: "shopping",
          providerOrder: [providerId],
          records: [{
            id: `${providerId}-offer`,
            source: "shopping",
            provider: providerId,
            url: "https://www.target.com/p/portable-monitor/-/A-123",
            title: "Portable monitor",
            content: "$129.99",
            timestamp: "2026-02-16T00:00:00.000Z",
            confidence: 0.8,
            attributes: {
              retrievalPath: "shopping:search:result-card",
              browser_fallback_mode: "extension",
              browser_fallback_reason_code: "challenge_detected",
              browser_fallback_challenge_orchestration: {
                mode: "browser_with_helper",
                source: "config",
                status: "resolved"
              },
              shopping_offer: {
                provider: providerId,
                product_id: "target-monitor",
                title: "Portable monitor",
                url: "https://www.target.com/p/portable-monitor/-/A-123",
                price: {
                  amount: 129.99,
                  currency: "USD",
                  retrieved_at: "2026-02-16T00:00:00.000Z"
                },
                shipping: {
                  amount: 0,
                  currency: "USD",
                  notes: "free"
                },
                availability: "in_stock",
                rating: 4.7,
                reviews_count: 42
              }
            }
          }]
        });
      }),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "portable monitor",
      providers: ["shopping/target"],
      mode: "json"
    });

    expect((output.meta as {
      metrics: {
        challenge_orchestration: Array<Record<string, unknown>>;
      };
    }).metrics.challenge_orchestration).toEqual([
      expect.objectContaining({
        provider: "shopping/target",
        browserFallbackMode: "extension",
        browserFallbackReasonCode: "challenge_detected",
        mode: "browser_with_helper",
        source: "config",
        status: "resolved"
      })
    ]);
  });

  it("summarizes shopping challenge orchestration from failure details when browser recovery stays blocked", async () => {
    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/temu";
        return makeAggregate({
          ok: false,
          sourceSelection: "shopping",
          providerOrder: [providerId],
          failures: [{
            provider: providerId,
            source: "shopping",
            error: {
              code: "unavailable",
              message: "challenge remains active",
              retryable: false,
              reasonCode: "challenge_detected",
              provider: providerId,
              source: "shopping",
              details: {
                browserFallbackMode: "extension",
                browserFallbackReasonCode: "challenge_detected",
                challengeOrchestration: {
                  mode: "browser_with_helper",
                  source: "config",
                  status: "deferred"
                }
              }
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
      metrics: {
        challenge_orchestration: Array<Record<string, unknown>>;
      };
    }).metrics.challenge_orchestration).toEqual([
      expect.objectContaining({
        provider: "shopping/temu",
        reasonCode: "challenge_detected",
        browserFallbackMode: "extension",
        browserFallbackReasonCode: "challenge_detected",
        mode: "browser_with_helper",
        source: "config",
        status: "deferred"
      })
    ]);
  });

  it("reports preserved extension challenge diagnostics unchanged for auto shopping mode", async () => {
    const runtime = toRuntime({
      search: vi.fn(async (_input, options) => {
        const providerId = options?.providerIds?.[0] ?? "shopping/walmart";
        return makeAggregate({
          ok: false,
          sourceSelection: "shopping",
          providerOrder: [providerId],
          failures: [{
            provider: providerId,
            source: "shopping",
            error: {
              code: "unavailable",
              message: "challenge remains active",
              retryable: false,
              reasonCode: "challenge_detected",
              provider: providerId,
              source: "shopping",
              details: {
                disposition: "challenge_preserved",
                browserFallbackMode: "extension",
                browserFallbackReasonCode: "challenge_detected",
                preservedSessionId: "preserved-session-1",
                preservedTargetId: "tab-123",
                challengeOrchestration: {
                  mode: "browser_with_helper",
                  source: "config",
                  status: "deferred"
                }
              }
            }
          }],
          metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 }
        });
      }),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "macbook pro m4 32gb ram",
      providers: ["shopping/walmart"],
      browserMode: "auto",
      mode: "json"
    });

    expect((output.meta as {
      selection: { requested_browser_mode?: string };
      metrics: {
        browser_fallback_modes_observed: string[];
        challenge_orchestration: Array<Record<string, unknown>>;
      };
    })).toMatchObject({
      selection: {
        requested_browser_mode: "auto"
      },
      metrics: {
        browser_fallback_modes_observed: ["extension"],
        challenge_orchestration: [
          expect.objectContaining({
            provider: "shopping/walmart",
            reasonCode: "challenge_detected",
            browserFallbackMode: "extension",
            browserFallbackReasonCode: "challenge_detected",
            mode: "browser_with_helper",
            source: "config",
            status: "deferred"
          })
        ]
      }
    });
    expect((output.meta as {
      metrics: { browser_fallback_modes_observed: string[] };
    }).metrics.browser_fallback_modes_observed).not.toContain("managed_headed");
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
      primaryConstraint: {
        guidance: {
          reason: string;
          recommendedNextCommands: string[];
        };
      };
      metrics: {
        reasonCodeDistribution: Record<string, number>;
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
      primaryConstraint: {
        guidance: {
          reason: "Temu needs an authenticated session before retrying.",
          recommendedNextCommands: [
            "Reuse an authenticated browser session, import logged-in cookies, or use the provider sign-in flow.",
            "Rerun the same provider or workflow once the session is active."
          ]
        }
      },
      metrics: {
        reasonCodeDistribution: {
          token_required: 1
        }
      }
    });
    expect((output.meta as { metrics: Record<string, unknown> }).metrics).not.toHaveProperty("reason_code_distribution");
  });

  it("clears stale provider guidance when shopping offer filtering overrides the primary summary", async () => {
    const runtime = toRuntime({
      search: vi.fn(async () => makeAggregate({
        ok: false,
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [{
          id: "offer-over-budget",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://example.com/offer-over-budget",
          title: "Expensive monitor",
          content: "$99.00",
          timestamp: "2026-02-16T00:00:00.000Z",
          confidence: 0.9,
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "offer-over-budget",
              title: "Expensive monitor",
              url: "https://example.com/offer-over-budget",
              price: {
                amount: 99,
                currency: "USD",
                retrieved_at: "2026-02-16T00:00:00.000Z"
              }
            }
          }
        }],
        failures: [{
          provider: "shopping/amazon",
          source: "shopping",
          error: {
            code: "unavailable",
            message: "provider follow-up required",
            retryable: false,
            reasonCode: "env_limited",
            provider: "shopping/amazon",
            source: "shopping",
            details: {
              reasonCode: "env_limited"
            }
          }
        }]
      })),
      fetch: vi.fn(async () => makeAggregate())
    });

    const output = await runShoppingWorkflow(runtime, {
      query: "portable monitor",
      providers: ["shopping/amazon"],
      budget: 10,
      mode: "json"
    });

    expect((output.meta as {
      primaryConstraintSummary: string;
      primaryConstraint: Record<string, unknown>;
    })).toMatchObject({
      primaryConstraintSummary: "All candidate offers exceeded the requested budget of 10.00.",
      primaryConstraint: {
        summary: "All candidate offers exceeded the requested budget of 10.00.",
        guidance: {
          reason: "Amazon needs a live browser-rendered page before retrying."
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

  it("stores default product-video artifacts under the workspace product-assets directory", async () => {
    const workspaceDir = await makeWorkspaceDir("odb-product-workspace-");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);

    const runtime = toRuntime({
      search: vi.fn(async () => makeAggregate()),
      fetch: vi.fn(async (_input, options) => {
        expect(options?.suspendedIntent).toMatchObject({
          kind: "workflow.product_video",
          input: {
            workflow: {
              kind: "product_video",
              input: { output_dir: join(workspaceDir, ".opendevbrowser") }
            }
          }
        });
        return makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [{
          id: "product-artifact",
          source: "shopping",
          provider: "shopping/amazon",
          url: "https://example.com/product-artifact",
          title: "Workspace Product",
          content: "Feature one. Feature two. Feature three.",
          timestamp: "2026-02-16T00:00:00.000Z",
          confidence: 0.9,
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "product-artifact",
              title: "Workspace Product",
              url: "https://example.com/product-artifact",
              price: {
                amount: 49,
                currency: "USD",
                retrieved_at: "2026-02-16T00:00:00.000Z"
              },
              availability: "in_stock"
            }
          }
        }]
        });
      })
    });

    try {
      const output = await runProductVideoWorkflow(runtime, {
        product_url: "https://example.com/product-artifact"
      });

      expectArtifactPath(String(output.path), join(workspaceDir, ".opendevbrowser"), "product-assets");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("stores product-video name-resolution artifacts under the requested root", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-product-nested-"));
    createdDirs.push(root);
    const productUrl = "https://example.com/product-artifact";

    const runtime = toRuntime({
      search: vi.fn(async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [{
          id: "resolved-offer",
          source: "shopping",
          provider: "shopping/amazon",
          url: productUrl,
          title: "Workspace Product",
          content: "$49",
          timestamp: "2026-02-16T00:00:00.000Z",
          confidence: 0.9,
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "resolved-offer",
              title: "Workspace Product",
              url: productUrl,
              price: {
                amount: 49,
                currency: "USD",
                retrieved_at: "2026-02-16T00:00:00.000Z"
              },
              availability: "in_stock"
            }
          }
        }]
      })),
      fetch: vi.fn(async () => makeAggregate({
        sourceSelection: "shopping",
        providerOrder: ["shopping/amazon"],
        records: [{
          id: "product-artifact",
          source: "shopping",
          provider: "shopping/amazon",
          url: productUrl,
          title: "Workspace Product",
          content: "Feature one. Feature two. Feature three.",
          timestamp: "2026-02-16T00:00:00.000Z",
          confidence: 0.9,
          attributes: {
            shopping_offer: {
              provider: "shopping/amazon",
              product_id: "product-artifact",
              title: "Workspace Product",
              url: productUrl,
              price: {
                amount: 49,
                currency: "USD",
                retrieved_at: "2026-02-16T00:00:00.000Z"
              },
              availability: "in_stock"
            }
          }
        }]
      }))
    });

    const output = await runProductVideoWorkflow(runtime, {
      product_name: "Workspace Product",
      provider_hint: "shopping/amazon",
      output_dir: root,
      ttl_hours: 12
    });

    const shoppingRuns = await readdir(join(root, "shopping"));
    expect(shoppingRuns).toHaveLength(1);
    expectArtifactPath(String(output.path), root, "product-assets");
    const shoppingManifest = JSON.parse(
      await readFile(join(root, "shopping", shoppingRuns[0] ?? "", "bundle-manifest.json"), "utf8")
    ) as ArtifactManifest;
    const productManifest = JSON.parse(
      await readFile(join(String(output.path), "bundle-manifest.json"), "utf8")
    ) as ArtifactManifest;
    expect(shoppingManifest.ttl_hours).toBe(12);
    expect(productManifest.ttl_hours).toBe(12);
  });

  it("rejects invalid product targets before creating a product-video artifact bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "odb-product-invalid-"));
    createdDirs.push(root);

    const auxiliaryFetch = vi.fn(async () => ({
      ok: true,
      url: "https://www.shoott.com/headshots",
      text: async () => "<html></html>",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    }));
    vi.stubGlobal("fetch", auxiliaryFetch as unknown as typeof fetch);

    const runtime = toRuntime({
      search: vi.fn(async () => makeAggregate()),
      fetch: vi.fn(async () => makeAggregate({
        sourceSelection: "web",
        providerOrder: ["web/default"],
        records: [{
          id: "shoott-404",
          source: "web",
          provider: "web/default",
          url: "https://www.shoott.com/headshots",
          title: "Shoott | 404",
          content: "Error 404 We can’t seem to find the page you were looking for.",
          timestamp: "2026-02-16T00:00:00.000Z",
          confidence: 0.8,
          attributes: {
            status: 404,
            links: ["https://cdn.example.com/404-image.jpg"]
          }
        }]
      }))
    });

    await expect(runProductVideoWorkflow(runtime, {
      product_url: "https://www.shoott.com/headshots",
      output_dir: root,
      include_screenshots: true,
      include_all_images: true,
      include_copy: true
    })).rejects.toThrow("Product target appears to be a not-found page");

    await expect(stat(join(root, "product-assets"))).rejects.toThrow();
    expect(auxiliaryFetch).not.toHaveBeenCalled();
  });
});
