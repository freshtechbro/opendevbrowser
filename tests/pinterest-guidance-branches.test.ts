import { describe, expect, it } from "vitest";
import { normalizePinterestReferenceUrl, pinterestSiteRecipe } from "../src/guidance/recipes/pinterest";

describe("Pinterest guidance branch coverage", () => {
  it("rejects malformed pin and idea ids while preserving accepted relative boards", () => {
    expect(normalizePinterestReferenceUrl("/pin/not-digits/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/ideas/studio/not-digits/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/studio/_private/")).toBeNull();
    expect(normalizePinterestReferenceUrl(" /studio/editorial-lighting/?utm=1#section ")).toBe(
      "https://www.pinterest.com/studio/editorial-lighting/"
    );
  });

  it("extracts references from candidates that omit link arrays", () => {
    const extractReferenceUrls = pinterestSiteRecipe.browserNativeDiscovery?.extractReferenceUrls;

    expect(extractReferenceUrls?.({
      url: "/pin/61572719900827789/",
      content: "Use https://www.pinterest.com/ideas/editorial-lighting/studio/896364491640/ as a backup.",
      html: "<a href=\"/studio/editorial-lighting\">board</a>"
    })).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/",
      "https://www.pinterest.com/ideas/editorial-lighting/studio/896364491640/",
      "https://www.pinterest.com/studio/editorial-lighting"
    ]);
  });
});
