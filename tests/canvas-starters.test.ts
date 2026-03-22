import { describe, expect, it } from "vitest";
import {
  getBuiltInCanvasStarterDefinition,
  listBuiltInCanvasStarterIds,
  listBuiltInCanvasStarterTemplates
} from "../src/canvas/starters/catalog";

describe("built-in canvas starter catalog", () => {
  it("ships the expected eight starter ids", () => {
    expect(listBuiltInCanvasStarterIds()).toEqual([
      "hero.saas-product",
      "pricing.subscription",
      "dashboard.analytics",
      "dashboard.ops",
      "auth.sign-in",
      "auth.sign-up",
      "settings.account",
      "docs.reference"
    ]);
    expect(listBuiltInCanvasStarterTemplates()).toHaveLength(8);
  });

  it("derives kit linkage and framework compatibility from the starter and kit catalogs", () => {
    expect(getBuiltInCanvasStarterDefinition("dashboard.analytics")).toMatchObject({
      template: {
        id: "dashboard.analytics",
        defaultFrameworkId: "react",
        compatibleFrameworkIds: ["react", "nextjs", "remix"],
        kitIds: ["dashboard.analytics-core"]
      }
    });
    expect(getBuiltInCanvasStarterDefinition("hero.saas-product")).toMatchObject({
      template: {
        id: "hero.saas-product",
        defaultFrameworkId: "nextjs",
        kitIds: ["marketing.product-launch"]
      }
    });
    expect(getBuiltInCanvasStarterDefinition("docs.reference")).toMatchObject({
      template: {
        id: "docs.reference",
        compatibleFrameworkIds: ["astro", "nextjs", "react", "remix"],
        kitIds: []
      }
    });
  });

  it("returns null for unknown starter ids and keeps framework-neutral starters detached from kit hooks", () => {
    expect(getBuiltInCanvasStarterDefinition("starter.unknown")).toBeNull();
    expect(getBuiltInCanvasStarterDefinition("docs.reference")).toMatchObject({
      template: {
        id: "docs.reference",
        defaultFrameworkId: "astro",
        kitIds: []
      }
    });
  });
});
