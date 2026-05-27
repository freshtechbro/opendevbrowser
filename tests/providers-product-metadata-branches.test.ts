import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRODUCT_VIDEO_STEP_IDS } from "../src/providers/product-video-compiler";
import { normalizeRecord } from "../src/providers/normalize";
import { buildWorkflowResumeEnvelope } from "../src/providers/workflow-contracts";
import { runProductVideoWorkflow, type ProviderExecutor } from "../src/providers/workflows";
import type { ProviderAggregateResult } from "../src/providers/types";

const tempDirs: string[] = [];

const makeOutputDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "odb-product-metadata-branches-"));
  tempDirs.push(dir);
  return dir;
};

const makeAggregate = (overrides: Partial<ProviderAggregateResult> = {}): ProviderAggregateResult => ({
  ok: true,
  records: [],
  trace: { requestId: "product-metadata-branches", ts: "2026-05-23T00:00:00.000Z" },
  partial: false,
  failures: [],
  metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
  sourceSelection: "shopping",
  providerOrder: ["shopping/amazon"],
  ...overrides
});

const toRuntime = (handlers: {
  search?: ProviderExecutor["search"];
  fetch?: ProviderExecutor["fetch"];
}): ProviderExecutor => ({
  search: handlers.search ?? (async () => makeAggregate()),
  fetch: handlers.fetch ?? (async () => makeAggregate())
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("provider product metadata branch coverage", () => {
  it("keeps checkpointed product pricing when the resumed product URL is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("metadata refresh should be caught");
    }) as unknown as typeof fetch);
    const detailResult = makeAggregate({
      records: [normalizeRecord("shopping/amazon", "shopping", {
        url: "https://%",
        title: "Checkpointed Product Fixture",
        content: "Studio fixture product copy with durable materials.",
        attributes: {
          brand: "Fixture Brand",
          links: [],
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "CHECKPOINTED",
            title: "Checkpointed Product Fixture",
            url: "https://%",
            price: { amount: 29.99, currency: "USD", retrieved_at: "2026-05-23T00:00:00.000Z" },
            availability: "in_stock"
          }
        }
      })]
    });

    const output = await runProductVideoWorkflow(
      toRuntime({
        fetch: async () => {
          throw new Error("checkpointed fetch should not replay");
        }
      }),
      buildWorkflowResumeEnvelope(
        "product_video",
        {
          product_url: "https://www.amazon.com/dp/source-product",
          include_screenshots: false,
          include_all_images: false,
          include_copy: false,
          output_dir: makeOutputDir()
        },
        {
          checkpoint: {
            stage: "execute",
            stepId: PRODUCT_VIDEO_STEP_IDS.fetchProductDetail,
            stepIndex: 1,
            state: {
              completed_step_ids: [
                PRODUCT_VIDEO_STEP_IDS.normalizeInput,
                PRODUCT_VIDEO_STEP_IDS.fetchProductDetail
              ],
              resolved_product_url: "https://%",
              resolved_provider_hint: "shopping/amazon",
              detail_result: detailResult
            }
          }
        }
      )
    );

    expect(output.product).toEqual(expect.objectContaining({
      title: "Checkpointed Product Fixture",
      brand: "Fixture Brand",
      provider: "shopping/amazon",
      url: "https://%"
    }));
    expect(output.pricing).toEqual(expect.objectContaining({
      amount: 29.99,
      currency: "USD"
    }));
  });
});
