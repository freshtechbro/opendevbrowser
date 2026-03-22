import { describe, expect, it } from "vitest";
import {
  BUILT_IN_CANVAS_KITS,
  listBuiltInCanvasInventoryItems,
  listBuiltInCanvasKitIds
} from "../src/canvas/kits/catalog";

describe("built-in canvas kit catalog", () => {
  it("ships the expected five built-in kit ids", () => {
    expect(listBuiltInCanvasKitIds()).toEqual([
      "dashboard.analytics-core",
      "dashboard.operations-control",
      "marketing.product-launch",
      "auth.multi-step",
      "settings.account-security"
    ]);
    expect(BUILT_IN_CANVAS_KITS).toHaveLength(5);
  });

  it("flattens inventory items with catalog metadata and reusable templates", () => {
    const items = listBuiltInCanvasInventoryItems();
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "kit.dashboard.analytics-core.metric-card",
        origin: "starter",
        sourceFamily: "starter_template",
        metadata: expect.objectContaining({
          catalog: expect.objectContaining({ kitId: "dashboard.analytics-core" }),
          template: expect.objectContaining({ rootNodeId: "metric-card" })
        })
      }),
      expect.objectContaining({
        id: "kit.marketing.product-launch.feature-hero",
        metadata: expect.objectContaining({
          catalog: expect.objectContaining({ kitId: "marketing.product-launch" })
        })
      })
    ]));
    expect(items.every((item) => item.metadata.template && item.metadata.catalog)).toBe(true);
  });
});
