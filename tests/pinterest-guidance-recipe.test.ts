import { describe, expect, it } from "vitest";
import {
  listSiteRecipes,
  resolveSiteRecipeForProvider,
  resolveSiteRecipeForUrl
} from "../src/guidance/recipes/site-registry";
import type { SiteRecipe } from "../src/guidance/types";
import { runBrowserNativeDiscovery } from "../src/providers/browser-native-discovery";
import { createProviderError } from "../src/providers/errors";
import type { NormalizedRecord, ProviderFailureEntry } from "../src/providers/types";

const makeSearchRecord = (overrides: Partial<NormalizedRecord> = {}): NormalizedRecord => ({
  id: "search",
  source: "social",
  provider: "social/pinterest",
  url: "https://www.pinterest.com/search/pins/?q=premium+photography+studio+landing+page",
  title: "Pinterest search",
  content: "",
  timestamp: "2026-05-20T00:00:00.000Z",
  confidence: 0.8,
  attributes: {},
  ...overrides
});

const makeFailure = (
  reasonCode: "env_limited" | "auth_required" | "challenge_detected" | "policy_blocked" | "rate_limited" | "token_required" = "env_limited",
  message = "blocked search shell"
): ProviderFailureEntry => ({
  provider: "social/pinterest",
  source: "social",
  error: createProviderError("unavailable", message, {
    reasonCode,
    provider: "social/pinterest",
    source: "social",
    retryable: true
  })
});

describe("Pinterest guidance recipe", () => {
  it("resolves Pinterest by provider id and host without registering a social provider", () => {
    expect(resolveSiteRecipeForProvider("social/pinterest")?.id).toBe("social/pinterest");
    expect(resolveSiteRecipeForUrl("https://uk.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/")?.id).toBe("social/pinterest");
    expect(resolveSiteRecipeForUrl("not a url")).toBeUndefined();
    expect(resolveSiteRecipeForProvider("social/not-pinterest")).toBeUndefined();

    const recipes = listSiteRecipes();
    recipes[0] = { ...recipes[0] as SiteRecipe, id: "mutated" };
    expect(listSiteRecipes()[0]?.id).toBe("social/pinterest");
    expect(Object.isFrozen(resolveSiteRecipeForProvider("social/pinterest"))).toBe(true);
    expect(Object.isFrozen(resolveSiteRecipeForProvider("social/pinterest")?.navigationSteps)).toBe(true);
  });

  it("returns typed recovery diagnostics instead of widening to unrelated web providers", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium photography studio landing page",
      maxReferences: 3,
      browserMode: "managed",
      useCookies: false,
      cookiePolicy: "required"
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.provider).toBe("social/pinterest");
    expect(result.failures[0]?.error.reasonCode).toBe("auth_required");
    expect(result.diagnostics.siteRecipeId).toBe("social/pinterest");
  });

  it("does not require an authenticated browser session when cookies are preferred but not required", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium photography studio landing page",
      maxReferences: 3,
      browserMode: "managed",
      useCookies: false
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      attempted: false,
      reason: "fetch_executor_missing",
      siteRecipeId: "social/pinterest"
    }));
  });

  it("generates an executable Pinterest search reference for authenticated browser-native discovery", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium photography studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [{
          ...makeSearchRecord(),
          content: '<a href="/pin/61572719900827789/">Studio pin</a><a href="/ideas/web-design-parallax-scrolling/896364491640/">Idea</a><a href="https://notpinterest.com/pin/1/">Spoof</a><a href="/studio/portrait-lighting/">Board</a>',
        }],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/",
      "https://www.pinterest.com/ideas/web-design-parallax-scrolling/896364491640/",
      "https://www.pinterest.com/studio/portrait-lighting/"
    ]);
    expect(result.diagnostics.reason).toBe("reference_urls_extracted");
  });

  it("blocks challenge pages before extracting embedded Pinterest URLs", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const cases = [
      {
        content: 'Complete the captcha verification challenge <a href="/studio/portrait-lighting/">Board</a>',
        reasonCode: "challenge_detected",
        badStateId: "challenge"
      }
    ];

    for (const item of cases) {
      const result = await runBrowserNativeDiscovery({
        recipe,
        query: "premium photography studio landing page",
        maxReferences: 3,
        browserMode: "extension",
        useCookies: true,
        cookiePolicy: "required",
        fetchSearchPage: async () => ({
          records: [makeSearchRecord({ content: item.content })],
          failures: []
        })
      });

      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error.reasonCode).toBe(item.reasonCode);
      expect(result.diagnostics).toEqual(expect.objectContaining({
        reason: item.reasonCode,
        badStateId: item.badStateId
      }));
    }
  });

  it("blocks upstream challenge failures even when records include Pinterest URLs", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium photography studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          content: '<a href="/pin/61572719900827789/">Studio pin</a>'
        })],
        failures: [makeFailure("challenge_detected", "Complete the browser challenge before continuing.")]
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("challenge_detected");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "challenge_detected",
      fetchedRecordCount: 1
    }));
  });

  it("blocks upstream auth, token, policy, and rate-limit failures before extracting stale Pinterest URLs", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const blockedReasons = ["auth_required", "token_required", "policy_blocked", "rate_limited"] as const;
    for (const reasonCode of blockedReasons) {
      const result = await runBrowserNativeDiscovery({
        recipe,
        query: "premium photography studio landing page",
        maxReferences: 3,
        browserMode: "extension",
        useCookies: true,
        cookiePolicy: "required",
        fetchSearchPage: async () => ({
          records: [makeSearchRecord({
            content: '<a href="/pin/61572719900827789/">Stale studio pin</a>'
          })],
          failures: [makeFailure(reasonCode, `Upstream returned ${reasonCode}.`)]
        })
      });

      expect(result.records).toEqual([]);
      expect(result.failures[0]?.error.reasonCode).toBe(reasonCode);
      expect(result.diagnostics).toEqual(expect.objectContaining({
        reason: reasonCode,
        fetchedRecordCount: 1
      }));
    }
  });

  it("blocks required-auth login pages even when records include Pinterest URLs", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium photography studio landing page",
      maxReferences: 3,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          content: 'Log in to continue <a href="/pin/61572719900827789/">Studio pin</a>'
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("auth_required");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "auth_required",
      badStateId: "login"
    }));
  });

  it("does not treat normal logged-in Pinterest chrome as a blocker when references are present", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium photography studio landing page",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: "Pinterest search",
          content: 'Your profile <span>Pin card</span> <a href="/pin/61572719900827789/">Studio pin</a>'
        })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/"
    ]);
  });

  it("classifies search-shell pages after extraction fails", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium photography studio landing page",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: "Pinterest search shell",
          content: "When autocomplete results are available use up and down arrows."
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      badStateId: "search-shell",
      reason: "env_limited"
    }));
  });

  it("extracts absolute www Pinterest URLs from browser HTML", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium photography studio landing page",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          content: '<a href="https://www.pinterest.com/pin/61572719900827789/">Studio pin</a><a href="https://www.pinterest.com/studio/portrait-lighting/">Board</a>'
        })],
        failures: []
      })
    });

    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/",
      "https://www.pinterest.com/studio/portrait-lighting/"
    ]);
  });

  it("rejects profile chrome paths and dedupes tracked Pinterest references", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "premium photography studio landing page",
      maxReferences: 5,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          content: [
            '<a href="/someuser/pins/">Profile pins</a>',
            '<a href="/someuser/following/">Following</a>',
            '<a href="/studio/portrait-lighting/?utm_source=search#section">Board</a>',
            '<a href="https://www.pinterest.com/studio/portrait-lighting/?tracking=1">Tracked duplicate</a>',
            '<a href="/pin/61572719900827789/?utm_source=search#comments">Pin</a>'
          ].join("")
        })],
        failures: []
      })
    });

    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/studio/portrait-lighting/",
      "https://www.pinterest.com/pin/61572719900827789/"
    ]);
  });

  it("reports missing browser executors with the recipe search URL", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required"
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      attempted: false,
      reason: "fetch_executor_missing",
      searchUrl: expect.stringContaining("pinterest.com/search/pins")
    }));
  });

  it("reports unsupported site recipes when discovery does not define a search URL", async () => {
    const pinterest = resolveSiteRecipeForProvider("social/pinterest");
    expect(pinterest).toBeDefined();
    if (!pinterest) return;
    const recipe: SiteRecipe = {
      ...pinterest,
      id: "web/no-search-recipe",
      providerIds: ["web/no-search-recipe"],
      hostnames: ["no-search.example"],
      authMode: "public",
      browserNativeDiscovery: undefined
    };

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "gallery inspiration",
      maxReferences: 2,
      browserMode: "managed",
      useCookies: false
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      attempted: false,
      reason: "unsupported_site_recipe"
    }));
  });

  it("deduplicates extracted references and handles recipes without extraction", async () => {
    const pinterest = resolveSiteRecipeForProvider("social/pinterest");
    expect(pinterest).toBeDefined();
    if (!pinterest) return;
    const duplicateRecipe: SiteRecipe = {
      ...pinterest,
      id: "web/duplicate-gallery",
      providerIds: ["web/duplicate-gallery"],
      hostnames: ["duplicate-gallery.example"],
      authMode: "public",
      browserNativeDiscovery: {
        buildSearchUrl: () => "https://duplicate-gallery.example/search",
        extractReferenceUrls: () => ["", "https://www.pinterest.com/pin/12345/", "https://www.pinterest.com/pin/12345/"]
      }
    };
    const noExtractorRecipe: SiteRecipe = {
      ...duplicateRecipe,
      id: "web/no-extractor-gallery",
      providerIds: ["web/no-extractor-gallery"],
      browserNativeDiscovery: {
        buildSearchUrl: () => "https://no-extractor-gallery.example/search"
      }
    };

    const deduped = await runBrowserNativeDiscovery({
      recipe: duplicateRecipe,
      query: "gallery inspiration",
      maxReferences: 3,
      browserMode: "managed",
      useCookies: false,
      fetchSearchPage: async () => ({ records: [makeSearchRecord()], failures: [] })
    });
    const noExtractor = await runBrowserNativeDiscovery({
      recipe: noExtractorRecipe,
      query: "gallery inspiration",
      maxReferences: 3,
      browserMode: "managed",
      useCookies: false,
      fetchSearchPage: async () => ({ records: [makeSearchRecord()], failures: [] })
    });

    expect(deduped.records.map((record) => record.url)).toEqual(["https://www.pinterest.com/pin/12345/"]);
    expect(noExtractor.records).toEqual([]);
    expect(noExtractor.diagnostics.reason).toBe("no_reference_urls_extracted");
  });

  it("keeps search-shell failures when no Pinterest reference URLs can be extracted", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const failure = makeFailure();

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({ content: "<main>No usable pins</main>" })],
        failures: [failure]
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures).toEqual([failure]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      attempted: true,
      reason: "no_reference_urls_extracted",
      fetchedRecordCount: 1
    }));
  });

  it("uses hard-failure details when upstream challenge failures omit top-level reason codes", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const failure = makeFailure("env_limited", "Complete the browser challenge before continuing.");
    const detailsOnlyChallenge: ProviderFailureEntry = {
      ...failure,
      error: {
        ...failure.error,
        reasonCode: undefined,
        details: {
          ...failure.error.details,
          reasonCode: "challenge_detected"
        }
      }
    };

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          content: '<a href="/pin/61572719900827789/">Studio pin</a>'
        })],
        failures: [detailsOnlyChallenge]
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures).toEqual([detailsOnlyChallenge]);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "challenge_detected",
      fetchedRecordCount: 1
    }));
  });

  it("falls back to env_limited for recipe bad states with invalid reason codes", async () => {
    const pinterest = resolveSiteRecipeForProvider("social/pinterest");
    expect(pinterest).toBeDefined();
    if (!pinterest) return;
    const recipe: SiteRecipe = {
      ...pinterest,
      id: "web/invalid-bad-state",
      providerIds: ["web/invalid-bad-state"],
      authMode: "public",
      badStates: [{
        id: "invalid",
        markers: ["blocked marker"],
        reasonCode: "not_a_provider_reason",
        recoveryAction: "Use a page with visible design references."
      }]
    };

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 2,
      browserMode: "managed",
      useCookies: false,
      cookiePolicy: "optional",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          title: undefined,
          content: "Blocked marker with no usable references."
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.reasonCode).toBe("env_limited");
    expect(result.diagnostics).toEqual(expect.objectContaining({
      reason: "env_limited",
      badStateId: "invalid"
    }));
  });

  it("creates an extraction failure when search records have no pin, idea, or board URLs", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: "https://www.pinterest.com/search/pins/?q=studio",
          content: '<a href="/search/pins/?q=studio">Search</a><a href="/_internal/private">Private</a>'
        })],
        failures: [],
        errorMessage: "search shell did not expose references"
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.message).toBe("search shell did not expose references");
    expect(result.failures[0]?.error.details).toEqual(expect.objectContaining({
      siteRecipeId: "social/pinterest",
      searchUrl: expect.stringContaining("pinterest.com/search/pins")
    }));
  });

  it("rejects non-concrete Pinterest pin and idea paths from direct candidate URLs", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [
          makeSearchRecord({ url: "https://www.pinterest.com/pin/" }),
          makeSearchRecord({ url: "https://www.pinterest.com/ideas/" })
        ],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.diagnostics.reason).toBe("no_reference_urls_extracted");
  });

  it("rejects spoofed hosts and reports the default extraction message", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 2,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: "https://evil.example/pin/61572719900827789/",
          content: "https://notpinterest.com/pin/61572719900827789/"
        })],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.failures[0]?.error.message).toBe("social/pinterest search did not expose recipe-approved URLs that can be used as references.");
  });

  it("extracts references from record html attributes and stops at the requested maximum", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 1,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({
          url: "https://www.pinterest.com/search/pins/?q=studio",
          content: "",
          attributes: {
            html: '<a href="/pin/61572719900827789/">Studio pin</a><a href="/pin/61572719900827790/">Second pin</a>'
          }
        })],
        failures: []
      })
    });

    expect(result.records.map((record) => record.url)).toEqual([
      "https://www.pinterest.com/pin/61572719900827789/"
    ]);
  });

  it("treats sparse search records as extraction failures", async () => {
    const recipe = resolveSiteRecipeForProvider("social/pinterest");
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const sparseRecord = makeSearchRecord({
      url: undefined as never,
      content: undefined as never,
      attributes: {}
    });
    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "cinematic photography studio",
      maxReferences: 1,
      browserMode: "extension",
      useCookies: true,
      cookiePolicy: "required",
      fetchSearchPage: async () => ({
        records: [sparseRecord],
        failures: []
      })
    });

    expect(result.records).toEqual([]);
    expect(result.diagnostics.reason).toBe("no_reference_urls_extracted");
  });

  it("allows public web recipes without authenticated extension cookies", async () => {
    const pinterest = resolveSiteRecipeForProvider("social/pinterest");
    expect(pinterest).toBeDefined();
    if (!pinterest) return;
    let fetchedSearchUrl = "";
    const publicRecipe: SiteRecipe = {
      ...pinterest,
      id: "web/public-inspiration",
      providerIds: ["web/public-inspiration"],
      authMode: "public"
    };

    const result = await runBrowserNativeDiscovery({
      recipe: publicRecipe,
      query: "public inspiration",
      maxReferences: 1,
      browserMode: "managed",
      useCookies: false,
      cookiePolicy: "optional",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({ url: "https://www.pinterest.com/pin/12345/" })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records[0]).toEqual(expect.objectContaining({
      provider: "web/public-inspiration",
      source: "web",
      url: "https://www.pinterest.com/pin/12345/",
      title: "Site visual reference 1 for public inspiration"
    }));
  });

  it("allows authenticated-preferred recipes without cookies when cookies are not required", async () => {
    const pinterest = resolveSiteRecipeForProvider("social/pinterest");
    expect(pinterest).toBeDefined();
    if (!pinterest) return;
    const recipe: SiteRecipe = {
      ...pinterest,
      id: "web/auth-preferred-gallery",
      providerIds: ["web/auth-preferred-gallery"],
      hostnames: ["auth-preferred-gallery.example"],
      authMode: "authenticated_preferred"
    };

    const result = await runBrowserNativeDiscovery({
      recipe,
      query: "public Pinterest inspiration",
      maxReferences: 1,
      browserMode: "managed",
      useCookies: false,
      cookiePolicy: "optional",
      fetchSearchPage: async () => ({
        records: [makeSearchRecord({ url: "https://www.pinterest.com/pin/12345/" })],
        failures: []
      })
    });

    expect(result.failures).toEqual([]);
    expect(result.records[0]?.url).toBe("https://www.pinterest.com/pin/12345/");
  });

  it("uses recipe-owned search and extraction for non-Pinterest browser-native discovery", async () => {
    const pinterest = resolveSiteRecipeForProvider("social/pinterest");
    expect(pinterest).toBeDefined();
    if (!pinterest) return;
    let fetchedSearchUrl = "";
    const publicRecipe: SiteRecipe = {
      ...pinterest,
      id: "web/gallery",
      providerIds: ["web/gallery"],
      hostnames: ["gallery.example"],
      authMode: "public",
      browserNativeDiscovery: {
        buildSearchUrl: (query) => `https://gallery.example/search?q=${encodeURIComponent(query)}`,
        extractReferenceUrls: (candidate) => candidate.url?.includes("gallery.example/ref/")
          ? [candidate.url]
          : []
      }
    };

    const result = await runBrowserNativeDiscovery({
      recipe: publicRecipe,
      query: "cinematic studio",
      maxReferences: 1,
      browserMode: "managed",
      useCookies: false,
      cookiePolicy: "optional",
      fetchSearchPage: async (url) => {
        fetchedSearchUrl = url;
        return {
          records: [makeSearchRecord({
            provider: "web/gallery",
            source: "web",
            url: "https://gallery.example/ref/one"
          })],
          failures: []
        };
      }
    });

    expect(fetchedSearchUrl).toBe("https://gallery.example/search?q=cinematic%20studio");
    expect(result.failures).toEqual([]);
    expect(result.records[0]).toEqual(expect.objectContaining({
      provider: "web/gallery",
      source: "web",
      url: "https://gallery.example/ref/one",
      title: "Site visual reference 1 for cinematic studio"
    }));
  });
});
