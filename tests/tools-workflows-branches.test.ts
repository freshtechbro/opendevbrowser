import { describe, expect, it, vi } from "vitest";
import { ConfigStore, resolveConfig } from "../src/config";
import { resolveProviderRuntime } from "../src/tools/workflow-runtime";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

const parse = (value: string): Record<string, unknown> => JSON.parse(value) as Record<string, unknown>;

const makeProductRecord = () => ({
  id: "product-record",
  source: "shopping",
  provider: "shopping/amazon",
  url: "https://example.com/product",
  title: "Product",
  content: "Feature one. Feature two.",
  timestamp: new Date().toISOString(),
  confidence: 0.9,
  attributes: {
    links: [],
    shopping_offer: {
      provider: "shopping/amazon",
      product_id: "p1",
      title: "Product",
      url: "https://example.com/product",
      price: { amount: 29.99, currency: "USD", retrieved_at: new Date().toISOString() },
      shipping: { amount: 0, currency: "USD", notes: "free" },
      availability: "in_stock",
      rating: 4.3,
      reviews_count: 20
    }
  }
});

const makeDeps = (overrides: {
  manager?: Record<string, unknown>;
  providerRuntime?: Record<string, unknown>;
  config?: ConfigStore;
} = {}) => {
  const manager = {
    launch: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    screenshot: vi.fn().mockResolvedValue({ base64: Buffer.from([1, 2, 3]).toString("base64") }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides.manager
  };

  const providerRuntime = {
    search: vi.fn(async (input: { query: string }, options?: { source?: string; providerIds?: string[] }) => {
      const source = options?.source ?? "web";
      const providerId = options?.providerIds?.[0] ?? `${source}/default`;
      return {
        ok: true,
        records: [{
          id: `${providerId}-record`,
          source,
          provider: providerId,
          url: `https://example.com/${providerId}`,
          title: `${input.query} ${providerId}`,
          content: "$20.00",
          timestamp: new Date().toISOString(),
          confidence: 0.8,
          attributes: {
            shopping_offer: {
              provider: providerId,
              product_id: `${providerId}-product`,
              title: `${input.query} ${providerId}`,
              url: `https://example.com/${providerId}`,
              price: { amount: 20, currency: "USD", retrieved_at: new Date().toISOString() },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4,
              reviews_count: 2
            }
          }
        }],
        trace: { requestId: "req", ts: new Date().toISOString() },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: source,
        providerOrder: [providerId]
      };
    }),
    fetch: vi.fn(async () => ({
      ok: true,
      records: [makeProductRecord()],
      trace: { requestId: "req", ts: new Date().toISOString() },
      partial: false,
      failures: [],
      metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"]
    })),
    ...overrides.providerRuntime
  };

  const defaultConfig = new ConfigStore({ ...resolveConfig({}), relayToken: false });

  return {
    manager,
    annotationManager: {} as never,
    runner: {} as never,
    config: overrides.config ?? defaultConfig,
    skills: {} as never,
    providerRuntime
  };
};

describe("workflow tool branch coverage", () => {
  it("resolves provider runtime from deps and from default runtime fallback", () => {
    const injectedRuntime = {
      search: vi.fn(),
      fetch: vi.fn()
    };

    const fromDeps = resolveProviderRuntime({
      providerRuntime: injectedRuntime
    } as never);
    expect(fromDeps).toBe(injectedRuntime);

    const withoutConfig = resolveProviderRuntime({
      config: undefined
    } as never);
    expect(typeof withoutConfig.search).toBe("function");
    expect(typeof withoutConfig.fetch).toBe("function");

    const config = new ConfigStore({
      ...resolveConfig({}),
      blockerDetectionThreshold: 0.45,
      security: {
        ...resolveConfig({}).security,
        promptInjectionGuard: {
          ...resolveConfig({}).security.promptInjectionGuard,
          enabled: false
        }
      }
    });

    const withConfig = resolveProviderRuntime({
      config
    } as never);
    expect(typeof withConfig.search).toBe("function");
    expect(typeof withConfig.fetch).toBe("function");
  });

  it("uses compact mode defaults for research and shopping tools", async () => {
    const deps = makeDeps();
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");

    const researchTool = createResearchRunTool(deps as never);
    const shoppingTool = createShoppingRunTool(deps as never);

    const research = parse(await researchTool.execute({
      topic: "automation",
      sourceSelection: "web",
      days: 7
    } as never));
    expect(research.ok).toBe(true);
    expect(research.mode).toBe("compact");

    const shopping = parse(await shoppingTool.execute({
      query: "usb hub"
    } as never));
    expect(shopping.ok).toBe(true);
    expect(shopping.mode).toBe("compact");
  });

  it("returns structured failure for shopping workflow errors", async () => {
    const deps = makeDeps();
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");
    const shoppingTool = createShoppingRunTool(deps as never);

    const response = parse(await shoppingTool.execute({
      query: "   "
    } as never));

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "shopping_run_failed"
      }
    });
  });

  it("covers screenshot capture fallbacks and cleanup behavior in product-video tool", async () => {
    const depsWithEmptyScreenshot = makeDeps({
      manager: {
        launch: vi.fn().mockResolvedValue({ sessionId: "session-empty" }),
        screenshot: vi.fn().mockResolvedValue({ base64: "" }),
        disconnect: vi.fn().mockRejectedValue(new Error("disconnect failed"))
      }
    });

    const { createProductVideoRunTool } = await import("../src/tools/product_video_run");
    const toolA = createProductVideoRunTool(depsWithEmptyScreenshot as never);

    const emptyScreenshotResult = parse(await toolA.execute({
      product_url: "https://example.com/product",
      include_screenshots: true
    } as never));

    expect(emptyScreenshotResult.ok).toBe(true);
    expect(depsWithEmptyScreenshot.manager.launch).toHaveBeenCalledTimes(1);
    expect(depsWithEmptyScreenshot.manager.disconnect).toHaveBeenCalledTimes(1);

    const depsWithLaunchFailure = makeDeps({
      manager: {
        launch: vi.fn().mockRejectedValue(new Error("launch failed")),
        screenshot: vi.fn(),
        disconnect: vi.fn()
      }
    });
    const toolB = createProductVideoRunTool(depsWithLaunchFailure as never);

    const launchFailureResult = parse(await toolB.execute({
      product_url: "https://example.com/product",
      include_screenshots: true
    } as never));

    expect(launchFailureResult.ok).toBe(true);
    expect(depsWithLaunchFailure.manager.launch).toHaveBeenCalledTimes(1);
    expect(depsWithLaunchFailure.manager.screenshot).not.toHaveBeenCalled();

    const implicitScreenshotResult = parse(await toolB.execute({
      product_url: "https://example.com/product"
    } as never));
    expect(implicitScreenshotResult.ok).toBe(true);

    const missingInputResult = parse(await toolB.execute({
      include_screenshots: false
    } as never));
    expect(missingInputResult).toMatchObject({
      ok: false,
      error: {
        code: "product_video_run_failed"
      }
    });
  });
});
