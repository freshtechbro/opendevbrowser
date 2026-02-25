import { describe, expect, it, vi } from "vitest";
import { ConfigStore, resolveConfig } from "../src/config";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

const parse = (value: string): Record<string, unknown> => JSON.parse(value) as Record<string, unknown>;

const makeDeps = () => {
  const manager = {
    launch: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    screenshot: vi.fn().mockResolvedValue({ base64: Buffer.from([1, 2, 3]).toString("base64") }),
    disconnect: vi.fn().mockResolvedValue(undefined)
  };

  const providerRuntime = {
    search: vi.fn(async (input: { query: string }, options?: { source?: string; providerIds?: string[] }) => {
      const source = options?.source ?? "web";
      const providerId = options?.providerIds?.[0] ?? `${source}/default`;
      const price = providerId.includes("others") ? 10 : 20;
      return {
        ok: true,
        records: [{
          id: `${providerId}-record`,
          source,
          provider: providerId,
          url: `https://example.com/${providerId}`,
          title: `${input.query} ${providerId}`,
          content: `$${price}`,
          timestamp: "2026-02-16T00:00:00.000Z",
          confidence: 0.8,
          attributes: {
            shopping_offer: {
              provider: providerId,
              product_id: `${providerId}-product`,
              title: `${input.query} ${providerId}`,
              url: `https://example.com/${providerId}`,
              price: { amount: price, currency: "USD", retrieved_at: "2026-02-16T00:00:00.000Z" },
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
        content: "Feature one. Feature two.",
        timestamp: "2026-02-16T00:00:00.000Z",
        confidence: 0.9,
        attributes: {
          links: [],
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
    providerRuntime
  };
};

describe("workflow tools", () => {
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
      include_all_images: false
    } as never));

    expect(response.ok).toBe(true);
    expect(response.path).toEqual(expect.any(String));
    expect(deps.manager.launch).toHaveBeenCalledTimes(1);
    expect(deps.manager.screenshot).toHaveBeenCalledTimes(1);
    expect(deps.manager.disconnect).toHaveBeenCalledTimes(1);
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
