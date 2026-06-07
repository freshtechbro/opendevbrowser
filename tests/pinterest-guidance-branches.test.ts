import { describe, expect, it } from "vitest";
import {
  isAllowedPinterestReferenceHost,
  normalizePinterestReferenceUrl,
  pinterestSiteRecipe
} from "../src/guidance/recipes/pinterest";

describe("Pinterest guidance branch coverage", () => {
  it("rejects malformed pin and idea ids while preserving accepted relative boards", () => {
    expect(isAllowedPinterestReferenceHost("fr.pinterest.com")).toBe(true);
    expect(isAllowedPinterestReferenceHost("explore.pinterest.com")).toBe(false);
    expect(normalizePinterestReferenceUrl("ftp://www.pinterest.com/pin/61572719900827789/")).toBeNull();
    expect(normalizePinterestReferenceUrl("https://example.com/pin/61572719900827789/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/pin/not-digits/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/pin/61572719900827789/extra/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/pin//")).toBeNull();
    expect(normalizePinterestReferenceUrl("/ideas/studio/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/ideas/studio/not-digits/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/ideas/create/studio/61572719900827789/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/ideas/studio/collection/not-digits/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/search/editorial-lighting/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/studio/pins/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/studio/_private/")).toBeNull();
    expect(normalizePinterestReferenceUrl("/pin/61572719900827789/")).toBe(
      "https://www.pinterest.com/pin/61572719900827789/"
    );
    expect(normalizePinterestReferenceUrl("/ideas/studio/61572719900827789/")).toBe(
      "https://www.pinterest.com/ideas/studio/61572719900827789/"
    );
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

    expect(extractReferenceUrls?.({
      links: [
        "https://uk.pinterest.com/pin/123456789012345678/",
        "https://example.com/not-pinterest"
      ]
    })).toEqual(["https://uk.pinterest.com/pin/123456789012345678/"]);
  });
});
