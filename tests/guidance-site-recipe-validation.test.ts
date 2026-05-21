import { describe, expect, it, vi } from "vitest";
import { validateProviderUrlSiteRecipeCompatibility } from "../src/guidance/recipes/site-recipe-validation";

const PIN_URL = "https://www.pinterest.com/pin/27654985208435505/";
const browserNativeDiscovery = {
  buildSearchUrl: (query: string): string => `https://example.com/search?q=${encodeURIComponent(query)}`
};

describe("site recipe URL compatibility validation", () => {
  it("accepts canonical Pinterest provider and Pinterest URLs", () => {
    expect(validateProviderUrlSiteRecipeCompatibility({
      providers: ["social/pinterest"],
      urls: [PIN_URL]
    })).toEqual({ ok: true, recipeId: "social/pinterest" });
  });

  it("accepts Pinterest provider alias and Pinterest URLs", () => {
    expect(validateProviderUrlSiteRecipeCompatibility({
      providers: ["pinterest"],
      urls: [PIN_URL]
    })).toEqual({ ok: true, recipeId: "social/pinterest" });
  });

  it("rejects Pinterest providers paired with non-Pinterest URLs", () => {
    expect(validateProviderUrlSiteRecipeCompatibility({
      providers: ["social/pinterest"],
      urls: ["https://example.com/reference"]
    })).toEqual({
      ok: false,
      message: "URL https://example.com/reference does not match a browser-native site recipe for provider-scoped recovery."
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
