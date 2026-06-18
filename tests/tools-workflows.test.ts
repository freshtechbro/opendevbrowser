import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { ConfigStore, resolveConfig } from "../src/config";
import { DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS } from "../src/cli/transport-timeouts";
import { PRODUCT_VIDEO_BRIEF_HELPER_PATH } from "../src/providers/workflow-handoff";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

const parse = (value: string): Record<string, unknown> => JSON.parse(value) as Record<string, unknown>;

const makeDeps = (workspaceRoot?: string) => {
  const manager = {
    launch: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    cookieImport: vi.fn().mockResolvedValue({ imported: 1, rejected: [] }),
    cookieList: vi.fn().mockResolvedValue({
      count: 1,
      cookies: [{ name: "sid" }]
    }),
    goto: vi.fn().mockResolvedValue({ ok: true }),
    waitForLoad: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue({
      content: "snapshot content",
      refCount: 1,
      warnings: []
    }),
    clonePage: vi.fn().mockResolvedValue({
      component: "<section>clone</section>",
      css: ".hero{display:block;}",
      warnings: []
    }),
    clonePageHtmlWithOptions: vi.fn().mockResolvedValue({ html: "<html><body>clone</body></html>" }),
    screenshot: vi.fn().mockResolvedValue({ base64: Buffer.from([1, 2, 3]).toString("base64") }),
    setSessionChallengeAutomationMode: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined)
  };

  const providerRuntime = {
    search: vi.fn(async (input: { query: string }, options?: { source?: string; providerIds?: string[] }) => {
      const source = options?.source ?? "web";
      const providerId = options?.providerIds?.[0] ?? `${source}/default`;
      const price = providerId.includes("others") ? 10 : 20;
      const timestamp = new Date().toISOString();
      return {
        ok: true,
        records: [{
          id: `${providerId}-record`,
          source,
          provider: providerId,
          url: `https://example.com/${providerId}`,
          title: `${input.query} ${providerId}`,
          content: `$${price}`,
          timestamp,
          confidence: 0.8,
          attributes: {
            shopping_offer: {
              provider: providerId,
              product_id: `${providerId}-product`,
              title: `${input.query} ${providerId}`,
              url: `https://example.com/${providerId}`,
              price: { amount: price, currency: "USD", retrieved_at: timestamp },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.5,
              reviews_count: 2
            }
          }
        }],
        trace: { requestId: "req", ts: "2026-02-16T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: source,
        providerOrder: [providerId]
      };
    }),
    fetch: vi.fn(async () => ({
      ok: true,
      records: [{
        id: "product-record",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://example.com/product",
        title: "Product",
        content: "Feature one. Feature two. Feature three.",
        timestamp: "2026-02-16T00:00:00.000Z",
        confidence: 0.9,
        attributes: {
          links: [],
          product_type: "Wireless Mouse",
          connectivity: "Wireless",
          features: ["Ergonomic shell"],
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "p1",
            title: "Product",
            url: "https://example.com/product",
            price: { amount: 29.99, currency: "USD", retrieved_at: "2026-02-16T00:00:00.000Z" },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.3,
            reviews_count: 20
          }
        }
      }],
      trace: { requestId: "req", ts: "2026-02-16T00:00:00.000Z" },
      partial: false,
      failures: [],
      metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"]
    }))
  };

  const baseConfig = resolveConfig({});
  const config = new ConfigStore({ ...baseConfig, relayToken: false });

  return {
    manager,
    annotationManager: {} as never,
    runner: {} as never,
    config,
    skills: {} as never,
    providerRuntime,
    ...(workspaceRoot ? { workspaceRoot } : {})
  };
};

describe("workflow tools", () => {
  const originalCwd = process.cwd();
  const createdDirs: string[] = [];

  const makeTempDir = async (prefix: string): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    createdDirs.push(directory);
    return directory;
  };

  const expectArtifactPath = (artifactPath: string, root: string, namespace: string): void => {
    expect(dirname(artifactPath)).toBe(join(root, namespace));
    expect(basename(artifactPath)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
    );
  };

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    while (createdDirs.length > 0) {
      const directory = createdDirs.pop();
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("uses workspace .opendevbrowser for omitted direct research output roots", async () => {
    const invocationRoot = await makeTempDir("odb-direct-research-cwd-");
    const workspaceRoot = await makeTempDir("odb-direct-research-workspace-");
    process.chdir(invocationRoot);
    const deps = makeDeps(workspaceRoot);
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const tool = createResearchRunTool(deps as never);

    const response = parse(await tool.execute({
      topic: "automation",
      mode: "compact",
      sourceSelection: "web",
      days: 30
    } as never));
    expect(response.ok).toBe(true);
    expectArtifactPath(response.artifact_path as string, join(workspaceRoot, ".opendevbrowser"), "research");
  });

  it("uses workspace .opendevbrowser for omitted direct shopping output roots", async () => {
    const invocationRoot = await makeTempDir("odb-direct-shopping-cwd-");
    const workspaceRoot = await makeTempDir("odb-direct-shopping-workspace-");
    process.chdir(invocationRoot);
    const deps = makeDeps(workspaceRoot);
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");
    const tool = createShoppingRunTool(deps as never);

    const response = parse(await tool.execute({
      query: "usb microphone",
      providers: ["shopping/amazon"],
      mode: "json"
    } as never));

    expect(response.ok).toBe(true);
    expectArtifactPath(response.artifact_path as string, join(workspaceRoot, ".opendevbrowser"), "shopping");
  });

  it("uses workspace .opendevbrowser for omitted direct inspiredesign output roots", async () => {
    const invocationRoot = await makeTempDir("odb-direct-inspiredesign-cwd-");
    const workspaceRoot = await makeTempDir("odb-direct-inspiredesign-workspace-");
    process.chdir(invocationRoot);
    const deps = makeDeps(workspaceRoot);
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      mode: "json"
    } as never));

    expect(response.ok).toBe(true);
    expectArtifactPath(response.artifact_path as string, join(workspaceRoot, ".opendevbrowser"), "inspiredesign");
  });

  it("produces product-ready Pinterest harvest from snapshot-ready public tool evidence", async () => {
    const deps = makeDeps();
    deps.providerRuntime.fetch.mockResolvedValueOnce({
      ok: true,
      records: [{
        id: "pinterest-pin",
        source: "social",
        provider: "social/pinterest",
        url: "https://www.pinterest.com/pin/1234567890/",
        title: "Editorial atelier pin",
        content: "<img data-test-id=\"closeup-image\" src=\"/pin.jpg\" alt=\"Pin image showing a full-bleed fashion composition with couture fabric drape.\" />",
        timestamp: "2026-05-23T12:00:00.000Z",
        confidence: 0.9,
        attributes: { links: [] }
      }],
      trace: { requestId: "req", ts: "2026-05-23T12:00:00.000Z" },
      partial: false,
      failures: [],
      metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
      sourceSelection: "social",
      providerOrder: ["social/pinterest"]
    });
    deps.manager.screenshot.mockImplementationOnce(async (_sessionId: string, options: { path?: string }) => {
      if (options.path) {
        await writeFile(options.path, Buffer.alloc(2048, 1));
      }
      return {
        path: options.path,
        warnings: []
      };
    });
    deps.manager.snapshot.mockResolvedValueOnce({
      url: "https://www.pinterest.com/pin/1234567890/",
      content: "Pin image showing a full-bleed fashion composition with couture fabric drape.",
      refCount: 1,
      warnings: []
    });
    deps.manager.clonePageHtmlWithOptions.mockResolvedValueOnce({
      html: "<main><img data-test-id=\"closeup-image\" src=\"/pin.jpg\" alt=\"Full-bleed fashion composition with couture fabric drape\" /></main>"
    });
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a fashion atelier landing page",
      harvest: true,
      urls: ["https://www.pinterest.com/pin/1234567890/"],
      visualEvidence: "required",
      mode: "json"
    } as never));

    expect(response.ok).toBe(true);
    expect(response.productSuccess).toBe(true);
    expect(response.artifactAuthority).toBe("product_ready");
    expect(response.evidenceAuthority).toBe("snapshot_ready");
  });

  it("uses workspace .opendevbrowser for omitted direct product-video output roots", async () => {
    const invocationRoot = await makeTempDir("odb-direct-product-video-cwd-");
    const workspaceRoot = await makeTempDir("odb-direct-product-video-workspace-");
    process.chdir(invocationRoot);
    const deps = makeDeps(workspaceRoot);
    const { createProductVideoRunTool } = await import("../src/tools/product_video_run");
    const tool = createProductVideoRunTool(deps as never);

    const response = parse(await tool.execute({
      product_url: "https://example.com/product",
      include_screenshots: false
    } as never));

    expect(response.ok).toBe(true);
    expectArtifactPath(response.artifact_path as string, join(workspaceRoot, ".opendevbrowser"), "product-video");
  });

  it("leaves omitted direct workflow output roots unresolved without a workspace root", async () => {
    const { resolveWorkflowToolOutputDir } = await import("../src/tools/workflow-output");

    expect(resolveWorkflowToolOutputDir({ workspaceRoot: undefined })).toBeUndefined();
  });

  it("falls through to provider cwd .opendevbrowser for direct research without a workspace root", async () => {
    const invocationRoot = await makeTempDir("odb-direct-provider-cwd-");
    process.chdir(invocationRoot);
    const invocationCwd = process.cwd();
    const deps = makeDeps();
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const tool = createResearchRunTool(deps as never);

    const response = parse(await tool.execute({
      topic: "provider cwd fallback",
      mode: "compact",
      sourceSelection: "web"
    } as never));

    expect(response.ok).toBe(true);
    expectArtifactPath(response.artifact_path as string, join(invocationCwd, ".opendevbrowser"), "research");
  });

  it("preserves explicit relative direct workflow output roots", async () => {
    const invocationRoot = await makeTempDir("odb-direct-explicit-cwd-");
    const workspaceRoot = await makeTempDir("odb-direct-explicit-workspace-");
    process.chdir(invocationRoot);
    const invocationCwd = process.cwd();
    const deps = makeDeps(workspaceRoot);
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const { createProductVideoRunTool } = await import("../src/tools/product_video_run");

    const researchResponse = parse(await createResearchRunTool(deps as never).execute({
      topic: "automation",
      mode: "compact",
      sourceSelection: "web",
      outputDir: "custom-output"
    } as never));
    const shoppingResponse = parse(await createShoppingRunTool(deps as never).execute({
      query: "usb microphone",
      providers: ["shopping/amazon"],
      mode: "json",
      outputDir: "custom-output"
    } as never));
    const inspiredesignResponse = parse(await createInspiredesignRunTool(deps as never).execute({
      brief: "Design a premium docs website",
      mode: "json",
      outputDir: "custom-output"
    } as never));
    const productVideoResponse = parse(await createProductVideoRunTool(deps as never).execute({
      product_url: "https://example.com/product",
      include_screenshots: false,
      output_dir: "custom-output"
    } as never));

    expect(researchResponse.ok).toBe(true);
    expect(shoppingResponse.ok).toBe(true);
    expect(inspiredesignResponse.ok).toBe(true);
    expect(productVideoResponse.ok).toBe(true);
    expectArtifactPath(researchResponse.artifact_path as string, join(invocationCwd, "custom-output"), "research");
    expectArtifactPath(shoppingResponse.artifact_path as string, join(invocationCwd, "custom-output"), "shopping");
    expectArtifactPath(inspiredesignResponse.artifact_path as string, join(invocationCwd, "custom-output"), "inspiredesign");
    expectArtifactPath(productVideoResponse.artifact_path as string, join(invocationCwd, "custom-output"), "product-video");
  });

  it("rejects blank direct workflow output roots", async () => {
    const workspaceRoot = await makeTempDir("odb-direct-blank-workspace-");
    const deps = makeDeps(workspaceRoot);
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const { createProductVideoRunTool } = await import("../src/tools/product_video_run");

    const researchResponse = parse(await createResearchRunTool(deps as never).execute({
      topic: "automation",
      outputDir: ""
    } as never));
    const shoppingResponse = parse(await createShoppingRunTool(deps as never).execute({
      query: "usb microphone",
      outputDir: "   "
    } as never));
    const inspiredesignResponse = parse(await createInspiredesignRunTool(deps as never).execute({
      brief: "Design a premium docs website",
      outputDir: ""
    } as never));
    const productVideoResponse = parse(await createProductVideoRunTool(deps as never).execute({
      product_url: "https://example.com/product",
      output_dir: "   "
    } as never));

    for (const response of [researchResponse, shoppingResponse, inspiredesignResponse, productVideoResponse]) {
      expect(response.ok).toBe(false);
      expect((response.error as { message?: string }).message).toBe("outputDir cannot be empty");
    }
  });

  it("executes research and shopping workflow tools", async () => {
    const deps = makeDeps();
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");

    const researchTool = createResearchRunTool(deps as never);
    const shoppingTool = createShoppingRunTool(deps as never);

    const research = parse(await researchTool.execute({
      topic: "automation",
      mode: "compact",
      sourceSelection: "auto",
      days: 30
    } as never));

    expect(research.ok).toBe(true);
    expect(research.followthroughSummary).toContain("ranked records");
    expect(research.suggestedNextAction).toContain("artifact path");
    expect(research.suggestedNextAction).toContain("npx opendevbrowser research run");
    expect(research.suggestedSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining("support") }),
        expect.objectContaining({
          reason: expect.stringContaining("narrower timebox"),
          command: expect.stringContaining("npx opendevbrowser research run")
        })
      ])
    );
    expect(research.meta).toEqual(expect.objectContaining({
      followthroughSummary: expect.stringContaining("publishable claim")
    }));
    expect((research.meta as { selection: { resolved_sources: string[] } }).selection.resolved_sources).toEqual([
      "web",
      "community",
      "social"
    ]);

    const shopping = parse(await shoppingTool.execute({
      query: "usb microphone",
      providers: ["shopping/amazon", "shopping/others"],
      mode: "json",
      sort: "lowest_price"
    } as never));

    expect(shopping.ok).toBe(true);
    expect(shopping.followthroughSummary).toContain("offer set");
    expect(shopping.suggestedNextAction).toContain("offerFilterDiagnostics");
    expect(shopping.suggestedNextAction).toContain("npx opendevbrowser shopping run");
    expect(shopping.suggestedSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining("filters") }),
        expect.objectContaining({
          reason: expect.stringContaining("updated budget and region"),
          command: expect.stringContaining("npx opendevbrowser shopping run")
        })
      ])
    );
    expect(shopping.meta).toEqual(expect.objectContaining({
      followthroughSummary: expect.stringContaining("strong deal")
    }));
    const offers = shopping.offers as Array<{ provider: string; price: { amount: number } }>;
    expect(offers[0]?.price.amount).toBeLessThanOrEqual(offers[1]?.price.amount);
  });

  it("executes product-video tool and captures screenshots through manager", async () => {
    const deps = makeDeps();
    const { createProductVideoRunTool } = await import("../src/tools/product_video_run");
    const tool = createProductVideoRunTool(deps as never);

    const response = parse(await tool.execute({
      product_url: "https://example.com/product",
      include_screenshots: true,
      include_all_images: false,
      timeoutMs: 9876
    } as never));

    expect(response.ok).toBe(true);
    expect(response.artifact_path).toEqual(expect.any(String));
    expect(response.followthroughSummary).toContain("asset pack");
    expect(response.suggestedNextAction).toContain("product-video brief helper");
    expect(response.suggestedNextAction).not.toContain("<pack>");
    expect(response.suggestedSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining("metadata-first") }),
        expect.objectContaining({
          reason: expect.stringContaining("adjusted provider or media flags"),
          command: expect.stringContaining("npx opendevbrowser product-video run")
        })
      ])
    );
    expect((response.suggestedSteps as Array<{ command?: string }>)[1]?.command).toBe(
      `${PRODUCT_VIDEO_BRIEF_HELPER_PATH} <pack>/manifest.json`
    );
    expect((response.suggestedSteps as Array<{ command?: string }>)[2]?.command).toContain(
      "npx opendevbrowser product-video run"
    );
    expect(response.meta).toEqual(expect.objectContaining({
      followthroughSummary: expect.stringContaining("visual-ready")
    }));
    expect(deps.manager.launch).toHaveBeenCalledTimes(1);
    expect(deps.manager.screenshot).toHaveBeenCalledTimes(1);
    expect(deps.manager.disconnect).toHaveBeenCalledTimes(1);
    expect(deps.providerRuntime.fetch).toHaveBeenCalledWith(
      { url: "https://example.com/product" },
      expect.objectContaining({ timeoutMs: 9876 })
    );
  });

  it("executes inspiredesign tool with default capture-mode off when no urls are supplied", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      mode: "json"
    } as never));

    expect(response.ok).toBe(true);
    expect(response.suggestedNextAction).toBe("Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence.");
    expect(response.nextStepGuidance).toEqual(expect.objectContaining({
      readiness: "ready",
      reasonCode: "design_ready"
    }));
    expect(response.followthroughSummary).toBe("Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence.");
    expect(response.meta).toEqual(expect.objectContaining({
      followthroughSummary: "Canvas continuation unavailable until ranked references include authoritative visual, motion, or pin-media evidence.",
      nextStepGuidance: expect.objectContaining({ readiness: "ready" })
    }));
    expect(deps.manager.launch).not.toHaveBeenCalled();
    expect(deps.providerRuntime.fetch).not.toHaveBeenCalled();
  });

  it("forces inspiredesign deep capture through browser manager helpers when urls are supplied", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      urls: ["https://example.com/reference"],
      mode: "compact",
      timeoutMs: 45000
    } as never));

    expect(response.ok).toBe(true);
    expect(deps.manager.launch).toHaveBeenCalledTimes(1);
    expect(deps.manager.goto).toHaveBeenCalledWith(
      "session-1",
      "https://example.com/reference",
      "load",
      expect.any(Number)
    );
    expect(deps.manager.goto.mock.calls[0]?.[3]).toBeGreaterThan(0);
    expect(deps.manager.goto.mock.calls[0]?.[3]).toBeLessThanOrEqual(30000);
    expect(deps.manager.waitForLoad).toHaveBeenCalledTimes(1);
    expect(deps.manager.snapshot).toHaveBeenCalledTimes(1);
    expect(deps.manager.clonePage).toHaveBeenCalledTimes(1);
    expect(deps.manager.clonePageHtmlWithOptions).toHaveBeenCalledTimes(1);
    expect(deps.manager.disconnect).toHaveBeenCalledWith("session-1", true);
  });

  it("keeps inspiredesign deep capture parity with daemon cookie-source imports", async () => {
    const deps = makeDeps();
    const cookieSource = {
      type: "inline" as const,
      value: [{ name: "sid", value: "abc", url: "https://example.com/reference" }]
    };
    deps.config = new ConfigStore({
      ...resolveConfig({}),
      relayToken: false,
      providers: { cookieSource }
    });
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      urls: ["https://example.com/reference"],
      captureMode: "off",
      mode: "compact",
      useCookies: true,
      cookiePolicyOverride: "required",
      challengeAutomationMode: "browser"
    } as never));

    expect(response.ok).toBe(true);
    expect(deps.manager.launch).toHaveBeenCalledTimes(1);
    expect(deps.manager.cookieImport).toHaveBeenCalledWith(
      "session-1",
      cookieSource.value,
      false,
      undefined,
      expect.any(Number)
    );
    expect(deps.manager.cookieList).toHaveBeenCalledWith(
      "session-1",
      ["https://example.com/reference"],
      undefined,
      expect.any(Number)
    );
    expect(deps.manager.setSessionChallengeAutomationMode).toHaveBeenCalledWith("session-1", "browser");
  });

  it("defaults inspiredesign tool mode to compact when omitted", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      urls: ["https://example.com/reference"]
    } as never));

    expect(response.ok).toBe(true);
    expect(response.mode).toBe("compact");
  });

  it("forwards inspiredesign harvest discovery fields and defaults to path mode", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      harvest: true,
      query: "premium docs references",
      providers: ["web/default"],
      maxReferences: 2,
      visualEvidence: "auto"
    } as never));

    expect(response.ok).toBe(true);
    expect(response.mode).toBe("path");
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      { query: "premium docs references", limit: 2 },
      expect.objectContaining({ providerIds: ["web/default"] })
    );
    expect(deps.providerRuntime.fetch).toHaveBeenCalledWith(
      { url: "https://example.com/web/default" },
      expect.any(Object)
    );
    expect(deps.manager.launch).toHaveBeenCalledTimes(1);
  });

  it("applies inspiredesign harvest defaults for references and required visual evidence", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      harvest: true,
      query: "premium docs references"
    } as never));

    expect(response.ok).toBe(true);
    expect(response.mode).toBe("path");
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      { query: "premium docs references", limit: 5 },
      expect.any(Object)
    );
    expect(deps.manager.screenshot).toHaveBeenCalledTimes(1);
  });

  it("rejects inspiredesign tool query unless harvest is enabled", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      query: "premium docs references"
    } as never));

    expect(response.ok).toBe(false);
    expect(response.error).toEqual({
      code: "inspiredesign_run_failed",
      message: "query is only supported when harvest is true."
    });
    expect(deps.providerRuntime.search).not.toHaveBeenCalled();
  });

  it("accepts inspiredesign tool Pinterest provider URL recovery", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"]
    } as never));

    expect(response.ok).toBe(true);
    expect(deps.providerRuntime.search).not.toHaveBeenCalled();
    expect(deps.providerRuntime.fetch).toHaveBeenCalled();
  });

  it("keeps direct-tool diagnostic Pinterest harvest out of Canvas continuation", async () => {
    const artifactRoot = await makeTempDir("odb-direct-inspiredesign-diagnostic-");
    const deps = makeDeps();
    deps.providerRuntime.fetch.mockResolvedValue({
      ok: false,
      records: [],
      trace: { requestId: "req", ts: "2026-02-16T00:00:00.000Z" },
      partial: false,
      failures: [],
      metrics: { attempted: 1, succeeded: 0, failed: 1, retries: 0, latencyMs: 1 },
      sourceSelection: "web",
      providerOrder: ["social/pinterest"],
      error: {
        code: "provider_unavailable",
        message: "Provider circuit is open",
        provider: "social/pinterest",
        source: "social"
      }
    });
    deps.manager.snapshot.mockResolvedValue({
      content: "Skip to content Your profile Pin card Home Updates Messages Accounts Settings",
      refCount: 8,
      warnings: []
    });
    deps.manager.clonePage.mockResolvedValue({
      component: "Skip to content Your profile Home Updates Messages Accounts Settings",
      css: "",
      warnings: []
    });
    deps.manager.clonePageHtmlWithOptions.mockResolvedValue({ html: "" });
    deps.manager.screenshot.mockImplementation(async (_sessionId: string, options?: { path?: string }) => {
      if (options?.path) {
        await writeFile(options.path, Buffer.from("png"));
      }
      return { path: options?.path, warnings: [] };
    });
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium fashion studio landing page",
      harvest: true,
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"],
      visualEvidence: "auto",
      includePrototypeGuidance: true,
      mode: "path",
      outputDir: artifactRoot
    } as never));

    expect(response.ok).toBe(true);
    expect(response).toEqual(expect.objectContaining({
      ready: false,
      readiness: "needs_recovery",
      harvestReadiness: "needs_recovery",
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0
    }));
    expect(response.suggestedNextAction).toContain("Pinterest browser-native");
    expect(response.artifact_path).toEqual(expect.stringContaining(join(artifactRoot, "inspiredesign")));
    expect(response.meta).toEqual(expect.objectContaining({
      productSuccess: false,
      artifactAuthority: "diagnostic_only",
      rankedReferenceCount: 0,
      nextStepGuidance: expect.objectContaining({
        readiness: "needs_recovery",
        reasonCode: "pinterest_browser_native_recovery",
        primaryAction: expect.objectContaining({
          id: "recover_reference_evidence",
          summary: expect.stringContaining("Pinterest browser-native recipe")
        }),
        commands: expect.arrayContaining([
          expect.objectContaining({
            id: "inspiredesign-harvest-rerun",
            command: expect.stringContaining("--provider social/pinterest")
          })
        ]),
        doNotProceedIf: expect.arrayContaining([
          "rankedReferences is empty",
          "top ranked reference is diagnostic-only or off brief"
        ])
      })
    }));
    const artifactPath = response.artifact_path as string;
    const rankedReferences = JSON.parse(await readFile(join(artifactPath, "ranked-references.json"), "utf8")) as {
      references: unknown[];
      rejectedReferences: Array<{ captured?: boolean; capturedButRejectedReason?: string; reason?: string }>;
    };
    expect(rankedReferences.references).toEqual([]);
    expect(rankedReferences.rejectedReferences).toEqual([
      expect.objectContaining({
        fetchStatus: "failed",
        captureStatus: "off",
        reason: "Fetch did not produce usable creative evidence."
      })
    ]);
    const handoff = JSON.parse(await readFile(join(artifactPath, "design-agent-handoff.json"), "utf8")) as {
      artifactGuide: Record<string, unknown>;
      commandExamples: { continueInCanvas: string };
      implementationContext: { referenceSynthesis: { requiredArtifacts: string[] } };
      nextStepGuidance: { readiness: string; commands: Array<{ command: string }> };
    };
    expect(handoff.commandExamples.continueInCanvas).toBe("Unavailable until harvest readiness is ready with authoritative visual, motion, or pin-media evidence.");
    expect(handoff.artifactGuide).not.toHaveProperty("canvas-plan.request.json");
    expect(handoff.artifactGuide).not.toHaveProperty("prototype-guidance.md");
    expect(handoff.implementationContext.referenceSynthesis.requiredArtifacts).not.toContain("canvas-plan.request.json");
    expect(handoff.implementationContext.referenceSynthesis.requiredArtifacts).not.toContain("prototype-guidance.md");
    expect(JSON.stringify(handoff)).not.toContain("canvas-plan.request.json");
    expect(handoff.nextStepGuidance.readiness).toBe("needs_recovery");
    expect(handoff.nextStepGuidance.commands[0]?.command).toContain("--provider social/pinterest");
    expect(handoff.nextStepGuidance.commands[0]?.command).toContain("--query");
    expect(handoff.nextStepGuidance.commands[0]?.command).not.toContain("--url");
    const designMarkdown = await readFile(join(artifactPath, "design.md"), "utf8");
    expect(designMarkdown).toContain("Prototype guidance omitted because next-step guidance is not ready.");
    expect(designMarkdown).not.toContain("Prototype guidance Markdown for the first HTML pass");
    expect(designMarkdown).not.toContain("## 6.1 Reference Anchors");
    const manifest = JSON.parse(await readFile(join(artifactPath, "bundle-manifest.json"), "utf8")) as { files: string[] };
    expect(manifest.files).toEqual(expect.arrayContaining([
      "ranked-references.json",
      "design-agent-handoff.json",
      "bundle-manifest.json"
    ]));
    expect(manifest.files).not.toContain("canvas-plan.request.json");
    expect(manifest.files).not.toContain("prototype-guidance.md");
  });

  it("rejects inspiredesign tool providers without a query or compatible URL", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      harvest: true,
      providers: ["web/default"]
    } as never));

    expect(response.ok).toBe(false);
    expect(response.error).toEqual({
      code: "inspiredesign_run_failed",
      message: "Provider-scoped URL recovery requires at least one URL."
    });
    expect(deps.providerRuntime.search).not.toHaveBeenCalled();

    const genericUrlResponse = parse(await tool.execute({
      brief: "Design a premium docs website",
      harvest: true,
      providers: ["web/default"],
      urls: ["https://www.pinterest.com/pin/27654985208435505/"]
    } as never));

    expect(genericUrlResponse.ok).toBe(false);
    expect(genericUrlResponse.error).toEqual({
      code: "inspiredesign_run_failed",
      message: "Provider web/default does not support URL-only site recipe recovery."
    });
  });

  it("rejects direct-tool Pinterest query harvests with non-canonical explicit URLs", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const searchUrlResponse = parse(await tool.execute({
      brief: "Design a premium docs website",
      harvest: true,
      query: "studio references",
      providers: ["social/pinterest"],
      urls: ["https://www.pinterest.com/search/pins/?q=studio"]
    } as never));

    expect(searchUrlResponse.ok).toBe(false);
    expect(searchUrlResponse.error).toEqual({
      code: "inspiredesign_run_failed",
      message: "URL https://www.pinterest.com/search/pins/?q=studio is not a canonical social/pinterest reference URL for provider-scoped recovery."
    });
    expect(deps.providerRuntime.search).not.toHaveBeenCalled();

    const aliasResponse = parse(await tool.execute({
      brief: "Design a premium docs website",
      harvest: true,
      query: "studio references",
      providers: ["pinterest"],
      urls: ["https://www.pinterest.com/search/pins/?q=studio"]
    } as never));

    expect(aliasResponse.ok).toBe(false);
    expect(aliasResponse.error).toEqual(searchUrlResponse.error);

    const unrelatedReferenceResponse = parse(await tool.execute({
      brief: "Design a premium docs website",
      harvest: true,
      query: "studio references",
      providers: ["social/pinterest"],
      urls: ["https://example.com/pin/27654985208435505/"]
    } as never));

    expect(unrelatedReferenceResponse.ok).toBe(false);
    expect(unrelatedReferenceResponse.error).toEqual({
      code: "inspiredesign_run_failed",
      message: "URL https://example.com/pin/27654985208435505/ is not a canonical social/pinterest reference URL for provider-scoped recovery."
    });
  });

  it("rejects inspiredesign tool harvest without query or URLs", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      harvest: true
    } as never));

    expect(response.ok).toBe(false);
    expect(response.error).toEqual({
      code: "inspiredesign_run_failed",
      message: "inspiredesign harvest requires query or URLs."
    });
    expect(deps.providerRuntime.search).not.toHaveBeenCalled();
  });

  it("uses the CLI default workflow timeout for inspiredesign tool runs", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      urls: ["https://example.com/reference"],
      mode: "compact"
    } as never));

    expect(response.ok).toBe(true);
    const fetchCallOptions = deps.providerRuntime.fetch.mock.calls[0]?.[1];
    expect(deps.providerRuntime.fetch).toHaveBeenCalledWith(
      { url: "https://example.com/reference" },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    expect(fetchCallOptions?.timeoutMs).toBeGreaterThan(DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS - 1_000);
    expect(fetchCallOptions?.timeoutMs).toBeLessThanOrEqual(DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS);
    expect(deps.manager.launch).toHaveBeenCalledWith(expect.any(Object), 30_000);
    expect(deps.manager.snapshot.mock.calls[0]?.[5]).toEqual(expect.any(Number));
  });

  it("forwards challengeAutomationMode through workflow tools", async () => {
    const deps = makeDeps();
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");
    const { createProductVideoRunTool } = await import("../src/tools/product_video_run");
    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");

    const researchTool = createResearchRunTool(deps as never);
    const shoppingTool = createShoppingRunTool(deps as never);
    const productVideoTool = createProductVideoRunTool(deps as never);
    const macroTool = createMacroResolveTool(deps as never);

    await researchTool.execute({
      topic: "automation",
      sourceSelection: "web",
      days: 7,
      challengeAutomationMode: "browser_with_helper"
    } as never);
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          challengeAutomationMode: "browser_with_helper"
        })
      })
    );

    deps.providerRuntime.search.mockClear();
    await shoppingTool.execute({
      query: "usb microphone",
      providers: ["shopping/amazon"],
      challengeAutomationMode: "browser"
    } as never);
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          challengeAutomationMode: "browser"
        })
      })
    );

    await productVideoTool.execute({
      product_url: "https://example.com/product",
      include_screenshots: false,
      challengeAutomationMode: "off"
    } as never);
    expect(deps.providerRuntime.fetch).toHaveBeenCalledWith(
      { url: "https://example.com/product" },
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          challengeAutomationMode: "off"
        })
      })
    );

    deps.providerRuntime.search.mockClear();
    await macroTool.execute({
      expression: "@community.search(\"browser automation\")",
      execute: true,
      challengeAutomationMode: "browser"
    } as never);
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        challengeAutomationMode: "browser"
      })
    );
  });

  it("forwards browserMode through workflow tools", async () => {
    const deps = makeDeps();
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");
    const { createProductVideoRunTool } = await import("../src/tools/product_video_run");
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const { createMacroResolveTool } = await import("../src/tools/macro_resolve");

    const researchTool = createResearchRunTool(deps as never);
    const shoppingTool = createShoppingRunTool(deps as never);
    const productVideoTool = createProductVideoRunTool(deps as never);
    const inspiredesignTool = createInspiredesignRunTool(deps as never);
    const macroTool = createMacroResolveTool(deps as never);

    await researchTool.execute({
      topic: "authenticated social search",
      sourceSelection: "social",
      browserMode: "extension"
    } as never);
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          browserMode: "extension"
        })
      })
    );

    deps.providerRuntime.search.mockClear();
    await shoppingTool.execute({
      query: "usb microphone",
      providers: ["shopping/amazon"],
      browserMode: "managed"
    } as never);
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          browserMode: "managed"
        })
      })
    );

    deps.providerRuntime.fetch.mockClear();
    await productVideoTool.execute({
      product_url: "https://example.com/product",
      include_screenshots: false,
      browserMode: "extension"
    } as never);
    expect(deps.providerRuntime.fetch).toHaveBeenCalledWith(
      { url: "https://example.com/product" },
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          browserMode: "extension"
        })
      })
    );

    deps.providerRuntime.fetch.mockClear();
    await inspiredesignTool.execute({
      brief: "Reference audit",
      urls: ["https://example.com/reference"],
      captureMode: "off",
      browserMode: "managed"
    } as never);
    expect(deps.providerRuntime.fetch).toHaveBeenCalledWith(
      { url: "https://example.com/reference" },
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          browserMode: "managed"
        })
      })
    );

    deps.providerRuntime.search.mockClear();
    await macroTool.execute({
      expression: "@community.search(\"browser automation\")",
      execute: true,
      browserMode: "extension",
      useCookies: true,
      cookiePolicyOverride: "required"
    } as never);
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          browserMode: "extension",
          useCookies: true,
          cookiePolicyOverride: "required"
        })
      })
    );
  });

  it("locks operator surfaces to the canonical challengeAutomationMode enum", async () => {
    const deps = makeDeps();
    const { createStatusCapabilitiesTool } = await import("../src/tools/status_capabilities");
    const { createSessionInspectorPlanTool } = await import("../src/tools/session_inspector_plan");
    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");

    const operatorTools = [
      createStatusCapabilitiesTool(deps as never),
      createSessionInspectorPlanTool(deps as never),
      createSessionInspectorAuditTool(deps as never)
    ];

    for (const operatorTool of operatorTools) {
      const challengeAutomationMode = operatorTool.args.challengeAutomationMode;
      expect(challengeAutomationMode.safeParse("off").success).toBe(true);
      expect(challengeAutomationMode.safeParse("browser").success).toBe(true);
      expect(challengeAutomationMode.safeParse("browser_with_helper").success).toBe(true);
      expect(challengeAutomationMode.safeParse("invalid").success).toBe(false);
    }
  });

  it("returns structured unavailability errors for operator tools", async () => {
    const deps = makeDeps();
    const { createReviewDesktopTool } = await import("../src/tools/review_desktop");
    const { createStatusCapabilitiesTool } = await import("../src/tools/status_capabilities");
    const { createSessionInspectorPlanTool } = await import("../src/tools/session_inspector_plan");
    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");

    const review = parse(await createReviewDesktopTool(deps as never).execute({
      sessionId: "session-1"
    } as never));
    const status = parse(await createStatusCapabilitiesTool(deps as never).execute({} as never));
    const plan = parse(await createSessionInspectorPlanTool(deps as never).execute({
      sessionId: "session-1"
    } as never));
    const audit = parse(await createSessionInspectorAuditTool(deps as never).execute({
      sessionId: "session-1"
    } as never));

    expect(review.error).toMatchObject({ code: "automation_coordinator_unavailable" });
    expect(status.error).toMatchObject({ code: "automation_coordinator_unavailable" });
    expect(plan.error).toMatchObject({ code: "automation_coordinator_unavailable" });
    expect(audit.error).toMatchObject({ code: "automation_coordinator_unavailable" });
  });

  it("executes review, status, and inspect-plan operator tools through the coordinator", async () => {
    const deps = makeDeps();
    deps.automationCoordinator = {
      reviewDesktop: vi.fn(async () => ({
        browserSessionId: "session-1",
        observation: { observationId: "obs-1" },
        verification: { observationId: "obs-1" }
      })),
      inspectChallengePlan: vi.fn(async () => ({
        summary: "inspect-plan",
        mode: "browser_with_helper"
      })),
      statusCapabilities: vi.fn(async () => ({
        host: {
          desktopObservation: {
            available: true
          }
        }
      }))
    } as never;
    const { createReviewDesktopTool } = await import("../src/tools/review_desktop");
    const { createStatusCapabilitiesTool } = await import("../src/tools/status_capabilities");
    const { createSessionInspectorPlanTool } = await import("../src/tools/session_inspector_plan");

    const review = parse(await createReviewDesktopTool(deps as never).execute({
      sessionId: "session-1",
      targetId: "target-1"
    } as never));
    const status = parse(await createStatusCapabilitiesTool(deps as never).execute({
      sessionId: "session-1",
      targetId: "target-1"
    } as never));
    const plan = parse(await createSessionInspectorPlanTool(deps as never).execute({
      sessionId: "session-1",
      targetId: "target-1",
      challengeAutomationMode: "browser"
    } as never));

    expect(review.ok).toBe(true);
    expect(status.ok).toBe(true);
    expect(plan.ok).toBe(true);
    expect(deps.automationCoordinator.reviewDesktop).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      reason: undefined,
      maxChars: undefined,
      cursor: undefined
    });
    expect(deps.automationCoordinator.statusCapabilities).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      runMode: undefined
    });
    expect(deps.automationCoordinator.inspectChallengePlan).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      runMode: "browser"
    });
  });

  it("reports session-inspector unavailability before composing the audit bundle", async () => {
    const deps = makeDeps();
    deps.automationCoordinator = {
      reviewDesktop: vi.fn(),
      inspectChallengePlan: vi.fn(),
      statusCapabilities: vi.fn()
    } as never;
    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");

    const audit = parse(await createSessionInspectorAuditTool(deps as never).execute({
      sessionId: "session-1"
    } as never));

    expect(audit.error).toMatchObject({ code: "session_inspector_unavailable" });
    expect(deps.automationCoordinator.reviewDesktop).not.toHaveBeenCalled();
  });

  it("builds correlated audit bundles with and without relay status", async () => {
    const runAudit = async (relayStatus?: Record<string, unknown>) => {
      const deps = makeDeps();
      deps.automationCoordinator = {
        reviewDesktop: vi.fn(async () => ({
          browserSessionId: "session-1",
          observation: {
            observationId: "obs-1",
            requestedAt: "2026-04-15T00:00:00.000Z",
            status: {
              platform: "darwin",
              permissionLevel: "observe",
              available: true,
              capabilities: ["observe.screen"],
              auditArtifactsDir: "/tmp/audit"
            }
          },
          verification: {
            observationId: "obs-1",
            verifiedAt: "2026-04-15T00:00:01.000Z",
            review: {
              sessionId: "session-1",
              targetId: "target-1",
              mode: "managed",
              snapshotId: "snapshot-1",
              content: "review content",
              truncated: false,
              refCount: 1,
              timingMs: 5
            }
          }
        })),
        inspectChallengePlan: vi.fn(async () => ({
          challengeId: "challenge-1",
          summary: "inspect-plan",
          mode: "browser_with_helper",
          source: "config",
          helperEligibility: { allowed: true, reason: "helper available" },
          yield: { required: false, reason: "none" },
          decision: {
            lane: "generic_browser_autonomy",
            rationale: "safe",
            attemptBudget: 1,
            noProgressLimit: 1,
            verificationLevel: "full",
            stopConditions: [],
            allowedActionFamilies: ["verification"]
          },
          classification: "auth_required",
          authState: "credentials_required",
          allowedActionFamilies: ["verification"],
          forbiddenActionFamilies: [],
          governedLanes: [],
          capabilityMatrix: {
            canNavigateToAuth: false,
            canReuseExistingSession: false,
            canReuseCookies: false,
            canFillNonSecretFields: false,
            canExploreClicks: false,
            canUseOwnedEnvironmentFixture: false,
            canUseSanctionedIdentity: false,
            canUseServiceAdapter: false,
            canUseComputerUseBridge: true,
            helperEligibility: { allowed: true, reason: "helper available" },
            mustYield: false,
            mustDefer: false
          },
          helper: {
            status: "suggested",
            reason: "helper available",
            suggestedSteps: []
          },
          suggestedSteps: [],
          evidence: {
            blockerState: "active",
            loginRefs: [],
            sessionReuseRefs: [],
            humanVerificationRefs: [],
            checkpointRefs: []
          }
        }))
      } as never;
      deps.manager.createSessionInspector = vi.fn(() => ({
        status: vi.fn(async () => ({
          sessionId: "session-1",
          mode: "managed",
          activeTargetId: "target-1",
          url: "https://example.com/session",
          title: "Session",
          meta: { blockerState: "active", dialog: { open: false } }
        })),
        listTargets: vi.fn(async () => ({
          activeTargetId: "target-1",
          targets: [{ targetId: "target-1", type: "page", title: "Session", url: "https://example.com/session" }]
        })),
        debugTraceSnapshot: vi.fn(async () => ({
          channels: {},
          meta: {},
          page: { url: "https://example.com/session", title: "Session" }
        }))
      })) as never;
      deps.relay = relayStatus
        ? {
          refresh: vi.fn(async () => {
            throw new Error("ignored refresh failure");
          }),
          status: vi.fn(() => relayStatus)
        } as never
        : undefined;
      const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");
      return parse(await createSessionInspectorAuditTool(deps as never).execute({
        sessionId: "session-1",
        targetId: "target-1",
        challengeAutomationMode: "browser_with_helper"
      } as never));
    };

    const withoutRelay = await runAudit();
    const withRelay = await runAudit({
      running: true,
      extensionConnected: false,
      extensionHandshakeComplete: true,
      annotationConnected: false,
      opsConnected: true,
      canvasConnected: false,
      cdpConnected: false,
      pairingRequired: false,
      health: {
        ok: true,
        challengeState: "clear",
        blockedSessions: [],
        waitingForExtension: false,
        actionable: []
      }
    });

    expect(withoutRelay.ok).toBe(true);
    expect(withRelay.ok).toBe(true);
    expect(withoutRelay.sessionInspector.relay).toBeNull();
    expect(withRelay.sessionInspector.relay).toMatchObject({ running: true, opsConnected: true });
  });

  it("returns structured errors when required workflow input is missing", async () => {
    const deps = makeDeps();
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const tool = createResearchRunTool(deps as never);

    const response = parse(await tool.execute({
      topic: "",
      mode: "compact"
    } as never));

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "research_run_failed"
      }
    });
  });
});
