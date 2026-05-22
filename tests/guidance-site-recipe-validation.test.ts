import { describe, expect, it, vi } from "vitest";
import {
  isNonCanonicalPinterestLikeUrl,
  isPinterestLikeUrl,
  requiresProviderUrlSiteRecipeCompatibility,
  validateProviderScopedUrlCanonicality,
  validateProviderUrlSiteRecipeCompatibility
} from "../src/guidance/recipes/site-recipe-validation";

const PIN_URL = "https://www.pinterest.com/pin/27654985208435505/";
const browserNativeDiscovery = {
  buildSearchUrl: (query: string): string => `https://example.com/search?q=${encodeURIComponent(query)}`
};

describe("site recipe URL compatibility validation", () => {
  it("classifies malformed and non-canonical Pinterest-like URLs", () => {
    expect(isPinterestLikeUrl("not a url")).toBe(false);
    expect(isPinterestLikeUrl("https://www.pinterest.com/search/pins/?q=studio")).toBe(true);
    expect(isNonCanonicalPinterestLikeUrl("https://www.pinterest.com/search/pins/?q=studio")).toBe(true);
    expect(isNonCanonicalPinterestLikeUrl(PIN_URL)).toBe(false);
    expect(isNonCanonicalPinterestLikeUrl("https://example.com/reference")).toBe(false);
  });

  it("accepts canonical Pinterest reference URL variants", () => {
    for (const url of [
      PIN_URL,
      "http://www.pinterest.com/pin/27654985208435505/?utm_source=test#comments",
      "https://uk.pinterest.com/pin/27654985208435505/",
      "https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/",
      "https://www.pinterest.com/studioeditorial/fashion-campaigns/"
    ]) {
      expect(validateProviderUrlSiteRecipeCompatibility({
        providers: ["social/pinterest"],
        urls: [url]
      })).toEqual({ ok: true, recipeId: "social/pinterest" });
    }
  });

  it("accepts Pinterest provider alias and Pinterest URLs", () => {
    expect(validateProviderUrlSiteRecipeCompatibility({
      providers: ["pinterest"],
      urls: [PIN_URL]
    })).toEqual({ ok: true, recipeId: "social/pinterest" });
  });

  it("does not use URL-only compatibility validation when a query is present", () => {
    expect(requiresProviderUrlSiteRecipeCompatibility({
      providers: ["pinterest"],
      urls: ["https://www.pinterest.com/search/pins/?q=studio"],
      query: "studio references"
    })).toBe(false);
    expect(validateProviderScopedUrlCanonicality({
      providers: ["pinterest"],
      urls: ["https://www.pinterest.com/search/pins/?q=studio"]
    })).toEqual({
      ok: false,
      message: "URL https://www.pinterest.com/search/pins/?q=studio is not a canonical social/pinterest reference URL for provider-scoped recovery."
    });
  });

  it("rejects Pinterest chrome URLs that are not canonical references", () => {
    for (const url of [
      "https://www.pinterest.com/",
      "https://www.pinterest.com/search/pins/?q=fashion%20studio",
      "https://www.pinterest.com/pin/create/",
      "https://www.pinterest.com/login/",
      "https://www.pinterest.com/help/article/",
      "https://www.pinterest.com/ads/overview/",
      "https://www.pinterest.com/studio/",
      "https://www.pinterest.com/studio/pins/",
      "https://www.pinterest.com/studio/boards/"
    ]) {
      expect(validateProviderUrlSiteRecipeCompatibility({
        providers: ["social/pinterest"],
        urls: [url]
      })).toEqual({
        ok: false,
        message: `URL ${url} is not a canonical social/pinterest reference URL for provider-scoped recovery.`
      });
    }
  });

  it("rejects Pinterest chrome URLs in mixed-provider query runs", () => {
    expect(validateProviderScopedUrlCanonicality({
      providers: ["social/pinterest", "web/default"],
      urls: ["https://www.pinterest.com/search/pins/?q=studio"]
    })).toEqual({
      ok: false,
      message: "URL https://www.pinterest.com/search/pins/?q=studio is not a canonical social/pinterest reference URL for provider-scoped recovery."
    });
    expect(validateProviderScopedUrlCanonicality({
      providers: ["social/pinterest", "web/default"],
      urls: [PIN_URL]
    })).toEqual({ ok: true });
    for (const url of [
      "https://pinterest.example.com/pin/27654985208435505/",
      "https://www.pinterest.co.uk/pin/27654985208435505/"
    ]) {
      expect(validateProviderScopedUrlCanonicality({
        providers: ["social/pinterest", "web/default"],
        urls: [url]
      })).toEqual({
        ok: false,
        message: `URL ${url} is not a canonical social/pinterest reference URL for provider-scoped recovery.`
      });
    }
  });

  it("rejects non-Pinterest hosts even when paths look like Pinterest references", () => {
    for (const url of [
      "https://evilpinterest.com/pin/27654985208435505/",
      "https://pinterest.example.com/pin/27654985208435505/"
    ]) {
      expect(validateProviderUrlSiteRecipeCompatibility({
        providers: ["social/pinterest"],
        urls: [url]
      })).toEqual({
        ok: false,
        message: `URL ${url} does not match a browser-native site recipe for provider-scoped recovery.`
      });
    }
  });

  it("rejects Pinterest providers paired with non-Pinterest URLs", () => {
    expect(validateProviderUrlSiteRecipeCompatibility({
      providers: ["social/pinterest"],
      urls: ["https://example.com/reference"]
    })).toEqual({
      ok: false,
      message: "URL https://example.com/reference does not match a browser-native site recipe for provider-scoped recovery."
    });
    expect(validateProviderScopedUrlCanonicality({
      providers: ["social/pinterest"],
      urls: ["https://example.com/reference"]
    })).toEqual({
      ok: false,
      message: "URL https://example.com/reference is not a canonical social/pinterest reference URL for provider-scoped recovery."
    });
  });

  it("rejects generic providers paired with URLs", () => {
    expect(validateProviderUrlSiteRecipeCompatibility({
      providers: ["web/default"],
      urls: [PIN_URL]
    })).toEqual({
      ok: false,
      message: "Provider web/default does not support URL-only site recipe recovery."
    });
  });

  it("rejects missing providers and URLs with clear messages", () => {
    expect(validateProviderUrlSiteRecipeCompatibility({
      providers: [],
      urls: [PIN_URL]
    })).toEqual({
      ok: false,
      message: "Provider-scoped URL recovery requires at least one provider."
    });
    expect(validateProviderUrlSiteRecipeCompatibility({
      providers: ["social/pinterest"],
      urls: []
    })).toEqual({
      ok: false,
      message: "Provider-scoped URL recovery requires at least one URL."
    });
  });

  it("rejects multiple-provider mismatches", () => {
    expect(validateProviderUrlSiteRecipeCompatibility({
      providers: ["social/pinterest", "web/default"],
      urls: [PIN_URL]
    })).toEqual({
      ok: false,
      message: "Provider web/default does not support URL-only site recipe recovery."
    });
  });

  it("rejects provider and URL recipes that resolve to different site recipes", async () => {
    vi.resetModules();
    vi.doMock("../src/guidance/recipes/site-registry", () => ({
      resolveSiteRecipeForProvider: vi.fn(() => ({ id: "social/pinterest", browserNativeDiscovery })),
      resolveSiteRecipeForUrl: vi.fn(() => ({ id: "social/example", browserNativeDiscovery }))
    }));

    const { validateProviderUrlSiteRecipeCompatibility: validateWithMismatchedRecipes } = await import(
      "../src/guidance/recipes/site-recipe-validation"
    );

    expect(validateWithMismatchedRecipes({
      providers: ["social/pinterest"],
      urls: [PIN_URL]
    })).toEqual({
      ok: false,
      message: "Provider-scoped URL recovery requires every provider and URL to resolve to the same site recipe."
    });

    vi.doUnmock("../src/guidance/recipes/site-registry");
    vi.resetModules();
  });

  it("rejects matching site recipes without browser-native discovery support", async () => {
    vi.resetModules();
    vi.doMock("../src/guidance/recipes/site-registry", () => ({
      resolveSiteRecipeForProvider: vi.fn(() => ({ id: "social/example" })),
      resolveSiteRecipeForUrl: vi.fn(() => ({ id: "social/example" }))
    }));

    const { validateProviderUrlSiteRecipeCompatibility: validateWithoutBrowserNativeDiscovery } = await import(
      "../src/guidance/recipes/site-recipe-validation"
    );

    expect(validateWithoutBrowserNativeDiscovery({
      providers: ["social/example"],
      urls: ["https://example.com/reference"]
    })).toEqual({
      ok: false,
      message: "Provider social/example does not support browser-native URL-only site recipe recovery."
    });

    vi.doUnmock("../src/guidance/recipes/site-registry");
    vi.resetModules();
  });

  it("rejects URL recipes without browser-native discovery support", async () => {
    vi.resetModules();
    vi.doMock("../src/guidance/recipes/site-registry", () => ({
      resolveSiteRecipeForProvider: vi.fn(() => ({ id: "social/example", browserNativeDiscovery })),
      resolveSiteRecipeForUrl: vi.fn(() => ({ id: "social/example" }))
    }));

    const { validateProviderUrlSiteRecipeCompatibility: validateWithNonNativeUrlRecipe } = await import(
      "../src/guidance/recipes/site-recipe-validation"
    );

    expect(validateWithNonNativeUrlRecipe({
      providers: ["social/example"],
      urls: ["https://example.com/reference"]
    })).toEqual({
      ok: false,
      message: "URL https://example.com/reference does not match a browser-native site recipe for provider-scoped recovery."
    });

    vi.doUnmock("../src/guidance/recipes/site-registry");
    vi.resetModules();
  });

  it("accepts browser-native non-Pinterest recipes without Pinterest canonicality checks", async () => {
    vi.resetModules();
    vi.doMock("../src/guidance/recipes/site-registry", () => ({
      resolveSiteRecipeForProvider: vi.fn(() => ({ id: "social/example", browserNativeDiscovery })),
      resolveSiteRecipeForUrl: vi.fn(() => ({ id: "social/example", browserNativeDiscovery }))
    }));

    const { validateProviderUrlSiteRecipeCompatibility: validateNonPinterestRecipe } = await import(
      "../src/guidance/recipes/site-recipe-validation"
    );

    expect(validateNonPinterestRecipe({
      providers: ["social/example"],
      urls: ["https://example.com/reference"]
    })).toEqual({ ok: true, recipeId: "social/example" });

    vi.doUnmock("../src/guidance/recipes/site-registry");
    vi.resetModules();
  });

  it("rejects unresolved recipe ids from malformed registry responses", async () => {
    vi.resetModules();
    vi.doMock("../src/guidance/recipes/site-registry", () => ({
      resolveSiteRecipeForProvider: vi.fn(() => ({ browserNativeDiscovery })),
      resolveSiteRecipeForUrl: vi.fn(() => ({ browserNativeDiscovery }))
    }));

    const { validateProviderUrlSiteRecipeCompatibility: validateWithMalformedRegistry } = await import(
      "../src/guidance/recipes/site-recipe-validation"
    );

    expect(validateWithMalformedRegistry({
      providers: ["social/pinterest"],
      urls: [PIN_URL]
    })).toEqual({
      ok: false,
      message: "Provider-scoped URL recovery could not resolve a site recipe."
    });

    vi.doUnmock("../src/guidance/recipes/site-registry");
    vi.resetModules();
  });
});
